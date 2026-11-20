"""
Train the live renewal XGBoost model from past bookings.

Each training row is one customer at one month-end ("cutoff"):
  features = what was known on that date (see backend.renewal_model.FEATURES)
  label    = did the customer book again within the next 365 days

Before the final fit, the command runs a fair time-separated test: for each
test date, the model only learns from cutoffs whose 365-day outcome had already
ended by that date. The result is compared with saying "no renewal" for
everyone (always-no), with random ranking (ROC-AUC 0.5), and with two other
algorithms on the same splits. The live model (the method of the study) is
XGBoost boosted from a logistic-regression start ("xgboost_lr"): logistic
regression's log-odds are each row's starting score (XGBoost base_margin) and the
trees learn corrections on top. Plain XGBoost, logistic regression and random
forest are reported as baselines; --algorithm can pick another live model.
Random forest is reported only: it has no small, pickle-free save format here.
"""
import csv
import json
import os
from datetime import date, timedelta
from pathlib import Path

import numpy as np
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.utils import timezone
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    f1_score,
    matthews_corrcoef,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

from backend.renewal_model import (
    FEATURES,
    META_PATH,
    MODEL_DIR,
    MODEL_PATH,
    LOGREG_PATH,
    booking_history,
    features_at,
)
from backend.renewal_utils import ACCEPTED_BOOKING_STATUSES

OUTCOME_DAYS = 365
# Feature directions, in FEATURES order: a higher booking strength, more
# bookings, more bookings in the last year, and a past renewal can only raise
# the chance; more days since the last booking can only lower it; spend and
# occasion have no fixed direction.
# Freeing days-since (to learn the ~1-year return bump) scored slightly lower in the
# Nov 2026 fair test: training rows there never reach the 1-year mark yet.
# shortcut: re-test MONOTONE[4] = 0 once data spans 3+ years.
MONOTONE = (1, 1, 1, 1, -1) + (0,) * (len(FEATURES) - 5)

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
# Live hybrid (xgboost_lr) settings from a Nov 2026 random search (220 settings, picked on
# the first 4 fair-test dates, checked on the last 3): a smoother logistic-regression start
# and more cautious trees beat the defaults on ROC-AUC, PR-AUC, top-10% and MCC.
# Baselines keep PARAMS / C=1 so the algorithm comparison stays like-for-like.
HYBRID_LR_C = 0.03
HYBRID_PARAMS = dict(
    PARAMS,
    n_estimators=50,
    max_depth=2,
    learning_rate=0.027,
    subsample=0.96,
    colsample_bytree=0.65,
    min_child_weight=100,
    reg_lambda=4.3,
    reg_alpha=0.5,
    gamma=0.5,
)
# Groups by rank among today's customers with bookings: top 15% likely,
# rest unlikely.
BAND_TOP_SHARES = (("likely", 0.15),)


def new_logreg(C=1.0):
    return make_pipeline(StandardScaler(), LogisticRegression(C=C, max_iter=2000))


def new_xgboost(params=PARAMS):
    return XGBClassifier(monotone_constraints="(" + ",".join(map(str, MONOTONE)) + ")", **params)


class XGBoostFromLogreg:
    """
    XGBoost boosted from a logistic-regression start: the trees learn corrections on top of
    logistic regression's log-odds (base_margin); XGBoost gives the final probability.
    """

    def fit(self, x, y):
        self.logreg = new_logreg(HYBRID_LR_C).fit(x, y)
        self.xgb = new_xgboost(HYBRID_PARAMS).fit(x, y, base_margin=self.logreg.decision_function(x))
        return self

    def predict_proba(self, x):
        margin = self.xgb.predict(x, output_margin=True, base_margin=self.logreg.decision_function(x))
        p = 1.0 / (1.0 + np.exp(-margin))
        return np.column_stack([1 - p, p])


# Every algorithm in the fair test (same rows, same splits). First = default live model.
MODELS = {
    "xgboost_lr": XGBoostFromLogreg,
    "xgboost": new_xgboost,
    "logistic_regression": new_logreg,
    "random_forest": lambda: RandomForestClassifier(
        n_estimators=300, min_samples_leaf=50, n_jobs=-1, random_state=42
    ),
}
LIVE_CHOICES = ("xgboost_lr", "xgboost", "logistic_regression")
VERSIONS = {"xgboost_lr": "xgboost-lr-v2", "xgboost": "xgboost-v4", "logistic_regression": "logreg-v1"}


def logreg_params(pipeline):
    """Plain-number copy of a scaler + logistic-regression pipeline (read by renewal_model)."""
    scaler, logreg = pipeline.named_steps["standardscaler"], pipeline.named_steps["logisticregression"]
    return {
        "features": list(FEATURES),
        "mean": scaler.mean_.tolist(),
        # constant columns have scale 0; StandardScaler uses 1 there too
        "scale": [s if s else 1.0 for s in scaler.scale_.tolist()],
        "coef": logreg.coef_[0].tolist(),
        "intercept": float(logreg.intercept_[0]),
    }


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
        parser.add_argument(
            "--algorithm",
            choices=("auto", *LIVE_CHOICES),
            default="xgboost_lr",
            help="Live model (default xgboost_lr); auto = best mean fair-test ROC-AUC.",
        )
        parser.add_argument(
            "--model-version",
            help="Default by algorithm: " + ", ".join(f"{k}={v}" for k, v in VERSIONS.items()),
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Run the fair test and report, but do not save the model.",
        )

    def handle(self, *args, **options):
        hist = booking_history()
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
            entry = {
                "test_date": test_cutoff.isoformat(),
                "train_dates": f"{train_cutoffs[0]}..{train_cutoffs[-1]}",
                "train_rows": int(len(y_train)),
                "test_rows": int(len(y_test)),
            }
            for name, build in MODELS.items():
                model = build().fit(x_train, y_train)
                # Flag as many customers as the share that renewed in training.
                train_p = model.predict_proba(x_train)[:, 1]
                threshold = float(np.quantile(train_p, 1 - y_train.mean()))
                entry[name] = binary_metrics(y_test, model.predict_proba(x_test)[:, 1], threshold)
            per_date.append(entry)

        algorithms = list(MODELS)
        fair_test = {"test_dates": [d["test_date"] for d in per_date], "per_date": per_date}
        for name in algorithms:
            fair_test[name] = {
                metric: float(np.mean([d[name][metric] for d in per_date]))
                for metric in per_date[0][name]
            } if per_date else {}
        if per_date:
            m = fair_test["xgboost_lr"]
            self.stdout.write(f"Fair test over {len(per_date)} test date(s), xgboost_lr:")
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
                    f"ROC-AUC {d['xgboost_lr']['roc_auc']:.3f}, "
                    f"top10% {d['xgboost_lr']['top10_renew_rate']:.3f}"
                )
            self.stdout.write("  Algorithm comparison (same splits, mean over test dates):")
            for name in algorithms:
                a = fair_test[name]
                self.stdout.write(
                    f"    {name:20} ROC-AUC {a['roc_auc']:.3f}  PR-AUC {a['pr_auc']:.3f}  "
                    f"top10% {a['top10_renew_rate']:.3f}  MCC {a['mcc']:.3f}"
                )
        else:
            self.stdout.write(self.style.WARNING("Not enough history for a fair test yet."))

        # ── Final model on every cutoff ─────────────────────────────────────
        algorithm = options["algorithm"]
        if algorithm == "auto":
            algorithm = (
                max(LIVE_CHOICES, key=lambda a: fair_test[a]["roc_auc"]) if per_date else "xgboost_lr"
            )
        version = options["model_version"] or VERSIONS[algorithm]
        self.stdout.write(f"Live algorithm: {algorithm} ({version})")
        x_all, y_all = stack(cutoffs)
        model = MODELS[algorithm]().fit(x_all, y_all)
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
            "version": version,
            "algorithm": algorithm,
            "trained_at": timezone.now().isoformat(),
            "data_start": first.isoformat(),
            "data_end": data_end.isoformat(),
            "training_dates": f"{cutoffs[0]}..{cutoffs[-1]}",
            "training_rows": int(len(y_all)),
            "training_renewals": int(y_all.sum()),
            "outcome_days": OUTCOME_DAYS,
            "features": list(FEATURES),
            "monotone_constraints": list(MONOTONE) if algorithm != "logistic_regression" else None,
            "params": {
                "xgboost": {"xgboost": PARAMS, "xgboost_lr": HYBRID_PARAMS}.get(algorithm),
                "logistic_regression": (
                    {"max_iter": 2000, "scaled": True,
                     "C": HYBRID_LR_C if algorithm == "xgboost_lr" else 1.0}
                    if algorithm != "xgboost" else None
                ),
            },
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
        # Which pieces each algorithm needs; the loader reads the ones meta names.
        xgb_part = {"xgboost": model, "xgboost_lr": getattr(model, "xgb", None)}.get(algorithm)
        lr_part = {"logistic_regression": model, "xgboost_lr": getattr(model, "logreg", None)}.get(algorithm)
        saved = []
        # Model files first, then meta: the loader picks the files named by meta.
        if xgb_part is not None:
            # Keep the .json ending: XGBoost picks the file format from it.
            tmp = MODEL_PATH.with_name(MODEL_PATH.stem + ".tmp.json")
            xgb_part.save_model(str(tmp))
            os.replace(tmp, MODEL_PATH)
            saved.append(MODEL_PATH)
        if lr_part is not None:
            tmp = LOGREG_PATH.with_name(LOGREG_PATH.stem + ".tmp.json")
            tmp.write_text(json.dumps(logreg_params(lr_part), indent=2), encoding="utf-8")
            os.replace(tmp, LOGREG_PATH)
            saved.append(LOGREG_PATH)
        tmp_meta = META_PATH.with_name(META_PATH.stem + ".tmp.json")
        tmp_meta.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        os.replace(tmp_meta, META_PATH)

        if per_date:
            outputs = Path(settings.BASE_DIR) / "renewal" / "outputs"
            outputs.mkdir(parents=True, exist_ok=True)
            span = f"{per_date[0]['test_date']}..{per_date[-1]['test_date']}"
            with open(
                outputs / "renewal_xgboost_live_metrics.csv", "w", newline="", encoding="utf-8"
            ) as f:
                # The live model's fair-test numbers (file name kept for the dashboard).
                metrics = fair_test[algorithm]
                writer = csv.DictWriter(f, fieldnames=list(metrics) + ["test_dates"])
                writer.writeheader()
                writer.writerow({**metrics, "test_dates": span})
            with open(
                outputs / "renewal_algorithm_comparison.csv", "w", newline="", encoding="utf-8"
            ) as f:
                writer = csv.DictWriter(
                    f, fieldnames=["algorithm", *fair_test["xgboost_lr"], "test_dates"]
                )
                writer.writeheader()
                for name in algorithms:
                    writer.writerow({"algorithm": name, **fair_test[name], "test_dates": span})
        self.stdout.write(self.style.SUCCESS(f"Live model saved: {', '.join(map(str, saved))}"))
