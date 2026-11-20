"""
Live renewal model trained on past bookings (meta["algorithm"] says which):
  xgboost_lr          XGBoost boosted from a logistic-regression start (default)
  xgboost             plain XGBoost
  logistic_regression plain logistic regression

The model and its metadata are written by `manage.py train_renewal_xgboost`
into backend/ml/ (inside the backend package, so the packaged app bundles
them). Logistic regression is stored as plain JSON numbers (no pickle). If the model cannot be loaded, predictions are "unavailable": the
probability and group are None and an error is logged. There is no fallback.
"""
import json
import logging
import math
import threading
from pathlib import Path

from collections import defaultdict
from datetime import timedelta

import numpy as np
from django.utils import timezone

from .models import Booking
from .occasions import OCCASIONS
from .renewal_utils import (
    ACCEPTED_BOOKING_STATUSES,
    BOOKING_IDENTITY_FIELDS,
    clean_price,
    unique_bookings,
)

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parent / "ml"
MODEL_PATH = MODEL_DIR / "renewal_xgboost.json"
META_PATH = MODEL_DIR / "renewal_xgboost_meta.json"
LOGREG_PATH = MODEL_DIR / "renewal_logreg.json"

# Occasion of the last booking, one column per specific occasion ("general" = all zeros).
OCCASION_FEATURES = tuple(f"last_occasion_{k}" for k in OCCASIONS if k != "general")

# Order matters: it must match the column order used in training.
FEATURES = (
    "booking_strength",
    "total_bookings",
    "bookings_last_365_days",
    "renewed_within_366",
    "days_since_last_booking",
    # Average spend: the one added input that measurably helped in the fair test.
    "log_avg_booking_value",
    # Occasion of the last booking: neutral today (most past bookings are General),
    # kept so new occasion-tagged packages feed the model as data grows.
    *OCCASION_FEATURES,
)


def booking_strength(total_bookings, bookings_last_365, avg_booking_value, renewed_within_366):
    """
    Engineered XGBoost input (0..0.99) that sums capped booking signals.
    It gives the model a stable summary when training data is thin; in the
    time-separated test it raised ROC-AUC from 0.516 to 0.561.
    """
    total_bookings = int(total_bookings or 0)
    if total_bookings == 0:
        return 0.0
    avg_booking_value = float(avg_booking_value or 0.0)
    if math.isnan(avg_booking_value):
        avg_booking_value = 0.0
    score = 0.05
    score += min(float(bookings_last_365 or 0.0) / 8.0, 0.4)
    score += min(total_bookings / 10.0, 0.25)
    score += min(avg_booking_value / 15000.0, 0.15)
    if renewed_within_366:
        score += 0.15
    return max(0.0, min(score, 0.99))

BAND_TEXT = {
    "likely": "Likely to renew",
    "unlikely": "At risk of not renewing",
}
UNAVAILABLE_TEXT = "Renewal prediction unavailable"

_lock = threading.Lock()
_cache = {"stamp": None, "scorer": None, "meta": None}


def _mtime(path):
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return None


def logreg_margin(params):
    """Log-odds function from saved logistic-regression numbers (scaler + weights)."""
    mean = np.array(params["mean"], dtype=float)
    scale = np.array(params["scale"], dtype=float)
    coef = np.array(params["coef"], dtype=float)
    intercept = float(params["intercept"])
    return lambda x: ((x - mean) / scale) @ coef + intercept


def logreg_scorer(params):
    """Probability function from saved logistic-regression numbers."""
    margin = logreg_margin(params)
    return lambda x: 1.0 / (1.0 + np.exp(-margin(x)))


def _load():
    """
    Return (scorer, meta), reloading when the files change; (None, None) if unavailable.
    scorer(x) maps an (n, len(FEATURES)) array to n probabilities.
    """
    stamp = (_mtime(META_PATH), _mtime(MODEL_PATH), _mtime(LOGREG_PATH))
    if stamp[0] is None:
        logger.error("Renewal model metadata not found in %s.", MODEL_DIR)
        return None, None
    with _lock:
        if _cache["stamp"] == stamp:
            return _cache["scorer"], _cache["meta"]
        try:
            meta = json.loads(META_PATH.read_text(encoding="utf-8"))
            if tuple(meta.get("features", ())) != FEATURES:
                raise ValueError(f"Model features {meta.get('features')} != {FEATURES}")
            algorithm = meta.get("algorithm", "xgboost")
            if algorithm == "logistic_regression":
                scorer = logreg_scorer(json.loads(LOGREG_PATH.read_text(encoding="utf-8")))
            else:
                from xgboost import Booster

                booster = Booster()
                booster.load_model(str(MODEL_PATH))
                scorer = booster.inplace_predict
                if algorithm == "xgboost_lr":
                    margin = logreg_margin(json.loads(LOGREG_PATH.read_text(encoding="utf-8")))
                    # Trees add their corrections to logistic regression's log-odds.
                    scorer = lambda x: booster.inplace_predict(x, base_margin=margin(x))  # noqa: E731
        except Exception:
            logger.exception("Renewal model could not be loaded.")
            _cache.update(stamp=stamp, scorer=None, meta=None)
            return None, None
        _cache.update(stamp=stamp, scorer=scorer, meta=meta)
        return scorer, meta


def live_model_version():
    """Version of the loaded model, e.g. 'logreg-v1'; None if no model loads."""
    _, meta = _load()
    return meta["version"] if meta else None


def booking_history(customer_ids=None):
    """
    customer_id -> sorted [(date, price, occasion)] of accepted bookings (session date,
    else created date). Identical duplicate bookings count once. Shared by training
    and live predictions so both compute features the same way.
    """
    qs = Booking.objects.filter(
        session_status__in=ACCEPTED_BOOKING_STATUSES, loyalty_claim=False
    )
    if customer_ids is not None:
        qs = qs.filter(customer_id__in=list(customer_ids))
    rows = unique_bookings(
        qs.order_by("id").values(*BOOKING_IDENTITY_FIELDS, "created_at", "package__occasion")
    )
    hist = defaultdict(list)
    for row in rows:
        when = row["session_date"] or row["created_at"]
        if when is not None:
            hist[row["customer_id"]].append(
                (when.date(), clean_price(row["total_price"]), row["package__occasion"] or "general")
            )
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
    renewed = any(1 <= (y - x).days <= 366 for x, y in zip(unique_dates, unique_dates[1:]))
    avg_value = sum(b[1] for b in past) / total
    last_date, _, last_occasion = past[-1]
    return (
        booking_strength(total, last_365, avg_value, renewed),
        float(total),
        float(last_365),
        float(renewed),
        # Upcoming sessions count as "today".
        float(max(0, (cutoff - last_date).days)),
        math.log1p(max(avg_value, 0.0)),
        *(float(last_occasion == col[len("last_occasion_"):]) for col in OCCASION_FEATURES),
    )


def band_for_probability(probability, meta):
    return "likely" if probability >= meta["band_cutoffs"]["likely"] else "unlikely"


def _result(probability, band, version):
    if band is None:
        return {
            "probability": None,
            "band": None,
            "status_text": UNAVAILABLE_TEXT,
            "predicted_renewal": None,
            "model_version": None,
        }
    return {
        "probability": float(probability),
        "band": band,
        "status_text": BAND_TEXT[band],
        "predicted_renewal": band == "likely",
        "model_version": version,
    }


def predict_from_features(rows):
    """
    rows: list of feature tuples in FEATURES order, or None for a customer with
    no bookings. Returns one prediction dict per row. A customer with no
    bookings gets 0% and the lowest group. Without a model every prediction is
    unavailable.
    """
    scorer, meta = _load()
    if scorer is None:
        return [_result(None, None, None) for _ in rows]
    results = [None] * len(rows)
    to_score = []
    for i, row in enumerate(rows):
        if row is None:
            results[i] = _result(0.0, "unlikely", meta["version"])
        else:
            to_score.append(i)
    if to_score:
        x = np.array([rows[i] for i in to_score], dtype=float)
        for i, p in zip(to_score, scorer(x)):
            p = float(p)
            results[i] = _result(p, band_for_probability(p, meta), meta["version"])
    return results


def predict_for_renewals(renewals, last_dates=None, today=None):
    """
    Predict for many Renewal rows at once (one booking query for all of them).
    renewals: iterable of Renewal. last_dates is accepted for older callers and ignored:
    features come from the booking history. Returns customer_id -> prediction dict.
    """
    renewals = [r for r in renewals if r is not None]
    today = today or timezone.now().date()
    hist = booking_history([r.customer_id for r in renewals])
    rows = [features_at(hist.get(r.customer_id, []), today) for r in renewals]
    return {
        r.customer_id: prediction
        for r, prediction in zip(renewals, predict_from_features(rows))
    }


def predict_for_renewal(renewal, last_date=None, today=None):
    """Prediction dict for one Renewal row (no bookings means 0% / unlikely)."""
    if renewal is None:
        return predict_from_features([None])[0]
    return predict_for_renewals([renewal], today=today)[renewal.customer_id]
