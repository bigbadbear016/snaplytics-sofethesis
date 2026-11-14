"""
Train the live renewal XGBoost model from past bookings.

Each training row is one customer at one month-end ("cutoff"):
  features = what was known on that date (see backend.renewal_model.FEATURES)
  label    = did the customer book again within the next 365 days

Before the final fit, the command runs a fair time-separated test: for each
test date, the model only learns from cutoffs whose 365-day outcome had already
ended by that date. The result is compared with saying "no renewal" for
everyone (always-no) and with random ranking (ROC-AUC 0.5).
"""
import csv
import json
import os
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import numpy as np
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.utils import timezone
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    f1_score,
    matthews_corrcoef,
    precision_score,
    recall_score,
    roc_auc_score,
)
from xgboost import XGBClassifier

from backend.models import Booking
from backend.renewal_model import (
    FEATURES,
    META_PATH,
    MODEL_DIR,
    MODEL_PATH,
    booking_strength,
)
from backend.renewal_utils import (
    ACCEPTED_BOOKING_STATUSES,
    BOOKING_IDENTITY_FIELDS,
    clean_price,
    unique_bookings,
)

OUTCOME_DAYS = 365
# Feature directions, in FEATURES order: a higher booking strength, more
# bookings, more bookings in the last year, and a past renewal can only raise
# the chance; more days since the last booking can only lower it.
MONOTONE = (1, 1, 1, 1, -1)
PARAMS = dict(
    n_estimators=150,
    max_depth=2,
    learning_rate=0.05,
    subsample=0.8,
    min_child_weight=20,
    reg_lambda=10.0,
    eval_metric="logloss",
    random_state=42,
)
# Groups by rank among today's customers with bookings: top 5%, next 10%,
# next 15%, rest.
BAND_TOP_SHARES = (("very_likely", 0.05), ("likely", 0.15), ("unlikely", 0.30))


def load_history():
    """
    Every accepted booking in the live database, past and current. Customers
    later moved to Internal Records are included: their bookings were real.
    Identical duplicate bookings count once.
    """
    hist = defaultdict(list)
    rows = unique_bookings(
        Booking.objects.filter(session_status__in=ACCEPTED_BOOKING_STATUSES)
        .order_by("id")
        .values(*BOOKING_IDENTITY_FIELDS, "created_at")
    )
    for row in rows:
        when = row["session_date"] or row["created_at"]
        if when is not None:
            hist[row["customer_id"]].append((when.date(), clean_price(row["total_price"])))
    for bookings in hist.values():
        bookings.sort()
    return hist


def features_at(bookings, cutoff):
    """Model inputs (FEATURES order) from bookings on or before cutoff; None if none."""
    past = [b for b in bookings if b[0] <= cutoff]
    if not past:
        return None
    dates = [b[0] for b in past]
    unique_dates = sorted(set(dates))
    total = len(past)
    last_365 = sum(1 for d in dates if d >= cutoff - timedelta(days=365))
    renewed = any(1 <= (b - a).days <= 366 for a, b in zip(unique_dates, unique_dates[1:]))
    avg_value = sum(b[1] for b in past) / total
    return (
        booking_strength(total, last_365, avg_value, renewed),
        float(total),
        float(last_365),
        float(renewed),
        float((cutoff - dates[-1]).days),
    )


def renewed_after(bookings, cutoff):
    end = cutoff + timedelta(days=OUTCOME_DAYS)
    return any(cutoff < b[0] <= end for b in bookings)


def month_ends(start, end):
    out, year, month = [], start.year, start.month
    while True:
        next_month = date(year + (month == 12), month % 12 + 1, 1)
        last_day = next_month - timedelta(days=1)
        if last_day > end:
            return out
        out.append(last_day)
        year, month = next_month.year, next_month.month


def binary_metrics(y, probabilities, threshold):
    predicted = (probabilities >= threshold).astype(int)
    top = np.argsort(-probabilities)[: max(1, int(round(0.1 * len(y))))]
    return {
        "accuracy": float(accuracy_score(y, predicted)),
        "precision": float(precision_score(y, predicted, zero_division=0)),
        "recall": float(recall_score(y, predicted, zero_division=0)),
        "f1": float(f1_score(y, predicted, zero_division=0)),
        "mcc": float(matthews_corrcoef(y, predicted)) if 0 < predicted.sum() < len(y) else 0.0,
        "roc_auc": float(roc_auc_score(y, probabilities)),
        "pr_auc": float(average_precision_score(y, probabilities)),
        "top10_renew_rate": float(y[top].mean()),
        "renew_rate": float(y.mean()),
        "always_no_accuracy": float((y == 0).mean()),
    }


class Command(BaseCommand):
    help = "Train the live renewal XGBoost model from past bookings."

    def add_arguments(self, parser):
        parser.add_argument(
            "--data-end",
            help="Last date with complete booking data (YYYY-MM-DD). "
            "Default: the latest accepted booking date.",
        )
        parser.add_argument("--model-version", default="xgboost-v3")
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Run the fair test and report, but do not save the model.",
        )

    def handle(self, *args, **options):
        hist = load_history()
        if not hist:
            raise CommandError("No accepted bookings found.")
        db = connection.settings_dict
        self.stdout.write(
            f"Data source: {connection.vendor} database {db.get('NAME')} "
            f"on {db.get('HOST') or 'local'}"
        )
        self.stdout.write(
            f"Bookings used: {sum(len(d) for d in hist.values())} accepted "
            f"({', '.join(ACCEPTED_BOOKING_STATUSES)}) from {len(hist)} customers"
        )
        first = min(b[0][0] for b in hist.values())
        data_end = (
            date.fromisoformat(options["data_end"])
            if options["data_end"]
            else max(b[-1][0] for b in hist.values())
        )
        cutoffs = month_ends(first, data_end - timedelta(days=OUTCOME_DAYS))
        if len(cutoffs) < 2:
            raise CommandError(
                f"Need at least 2 month-ends between {first} and "
                f"{data_end - timedelta(days=OUTCOME_DAYS)}; found {len(cutoffs)}."
            )

        rows_by_cutoff = {}
        for cutoff in cutoffs:
            rows = []
            for dates in hist.values():
                f = features_at(dates, cutoff)
                if f is not None:
                    rows.append(f + (float(renewed_after(dates, cutoff)),))
            rows_by_cutoff[cutoff] = np.array(rows, dtype=float)

        def stack(cs):
            data = np.vstack([rows_by_cutoff[c] for c in cs])
            return data[:, :-1], data[:, -1].astype(int)

        def fit(x, y):
            model = XGBClassifier(
                monotone_constraints="(" + ",".join(map(str, MONOTONE)) + ")", **PARAMS
            )
            return model.fit(x, y)

        # ── Fair time-separated test ────────────────────────────────────────
        per_date = []
        for test_cutoff in cutoffs:
            train_cutoffs = [
                c for c in cutoffs if c + timedelta(days=OUTCOME_DAYS) <= test_cutoff
            ]
            if not train_cutoffs:
                continue
            x_train, y_train = stack(train_cutoffs)
            x_test, y_test = stack([test_cutoff])
            if len(y_train) < 100 or y_train.sum() < 20 or len(set(y_test)) < 2:
                continue
            model = fit(x_train, y_train)
            # Flag as many customers as the share that renewed in training.
            train_p = model.predict_proba(x_train)[:, 1]
            threshold = float(np.quantile(train_p, 1 - y_train.mean()))
            per_date.append(
                {
                    "test_date": test_cutoff.isoformat(),
                    "train_dates": f"{train_cutoffs[0]}..{train_cutoffs[-1]}",
                    "train_rows": int(len(y_train)),
                    "test_rows": int(len(y_test)),
                    "xgboost": binary_metrics(
                        y_test, model.predict_proba(x_test)[:, 1], threshold
                    ),
                }
            )

        fair_test = {
            "test_dates": [d["test_date"] for d in per_date],
            "xgboost": {
                metric: float(np.mean([d["xgboost"][metric] for d in per_date]))
                for metric in per_date[0]["xgboost"]
            } if per_date else {},
            "per_date": per_date,
        }
        if per_date:
            m = fair_test["xgboost"]
            self.stdout.write(f"Fair test over {len(per_date)} test date(s):")
            self.stdout.write(
                f"  ROC-AUC={m['roc_auc']:.3f} (random 0.500)  PR-AUC={m['pr_auc']:.3f} "
                f"(random {m['renew_rate']:.3f})  top10%={m['top10_renew_rate']:.3f} "
                f"(average {m['renew_rate']:.3f})"
            )
            self.stdout.write(
                f"  accuracy={m['accuracy']:.3f} (always-no {m['always_no_accuracy']:.3f})  "
                f"precision={m['precision']:.3f} recall={m['recall']:.3f} MCC={m['mcc']:.3f}"
            )
            for d in per_date:
                self.stdout.write(
                    f"    {d['test_date']}: train rows {d['train_rows']}, "
                    f"ROC-AUC {d['xgboost']['roc_auc']:.3f}, "
                    f"top10% {d['xgboost']['top10_renew_rate']:.3f}"
                )
        else:
            self.stdout.write(self.style.WARNING("Not enough history for a fair test yet."))

        # ── Final model on every cutoff ─────────────────────────────────────
        x_all, y_all = stack(cutoffs)
        model = fit(x_all, y_all)
        p_all = model.predict_proba(x_all)[:, 1]

        # Group cutoffs by rank among today's customers with bookings.
        today = timezone.now().date()
        current = np.array(
            [f for f in (features_at(d, today) for d in hist.values()) if f is not None],
            dtype=float,
        )
        current_p = model.predict_proba(current)[:, 1]
        band_cutoffs = {
            band: float(np.quantile(current_p, 1 - share))
            for band, share in BAND_TOP_SHARES
        }

        meta = {
            "version": options["model_version"],
            "trained_at": timezone.now().isoformat(),
            "data_start": first.isoformat(),
            "data_end": data_end.isoformat(),
            "training_dates": f"{cutoffs[0]}..{cutoffs[-1]}",
            "training_rows": int(len(y_all)),
            "training_renewals": int(y_all.sum()),
            "outcome_days": OUTCOME_DAYS,
            "features": list(FEATURES),
            "monotone_constraints": list(MONOTONE),
            "params": PARAMS,
            "band_cutoffs": band_cutoffs,
            "band_top_shares": dict(BAND_TOP_SHARES),
            "in_sample": {
                "mean_predicted": float(p_all.mean()),
                "actual_renew_rate": float(y_all.mean()),
            },
            "fair_test": fair_test,
        }
        self.stdout.write(
            f"Final model: {len(y_all)} rows, {int(y_all.sum())} renewals, "
            f"dates {cutoffs[0]}..{cutoffs[-1]}; mean predicted {p_all.mean():.3f} "
            f"vs actual {y_all.mean():.3f}."
        )
        self.stdout.write(f"Group cutoffs (probability): {json.dumps(band_cutoffs)}")

        if options["dry_run"]:
            self.stdout.write(self.style.WARNING("Dry run: model not saved."))
            return

        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        # Keep the .json ending: XGBoost picks the file format from it.
        tmp_model = MODEL_PATH.with_name(MODEL_PATH.stem + ".tmp.json")
        tmp_meta = META_PATH.with_name(META_PATH.stem + ".tmp.json")
        model.save_model(str(tmp_model))
        tmp_meta.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        os.replace(tmp_model, MODEL_PATH)
        os.replace(tmp_meta, META_PATH)

        if per_date:
            outputs = Path(settings.BASE_DIR) / "renewal" / "outputs"
            outputs.mkdir(parents=True, exist_ok=True)
            metrics = fair_test["xgboost"]
            with open(
                outputs / "renewal_xgboost_live_metrics.csv", "w", newline="", encoding="utf-8"
            ) as f:
                writer = csv.DictWriter(f, fieldnames=list(metrics) + ["test_dates"])
                writer.writeheader()
                writer.writerow(
                    {**metrics, "test_dates": f"{per_date[0]['test_date']}..{per_date[-1]['test_date']}"}
                )
        self.stdout.write(self.style.SUCCESS(f"Live model saved: {MODEL_PATH}"))
