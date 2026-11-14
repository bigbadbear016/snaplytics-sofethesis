"""
Live renewal model: XGBoost trained on past bookings.

The model and its metadata are written by `manage.py train_renewal_xgboost`
into backend/ml/ (inside the backend package, so the packaged app bundles
them). If the model cannot be loaded, predictions are "unavailable": the
probability and group are None and an error is logged. There is no fallback.
"""
import json
import logging
import math
import threading
from datetime import datetime
from pathlib import Path

import numpy as np
from django.db.models import Max
from django.db.models.functions import Coalesce
from django.utils import timezone

from .models import Booking
from .renewal_utils import ACCEPTED_BOOKING_STATUSES

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parent / "ml"
MODEL_PATH = MODEL_DIR / "renewal_xgboost.json"
META_PATH = MODEL_DIR / "renewal_xgboost_meta.json"

# Order matters: it must match the column order used in training.
FEATURES = (
    "booking_strength",
    "total_bookings",
    "bookings_last_365_days",
    "renewed_within_366",
    "days_since_last_booking",
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
    "very_likely": "Highest chance to renew",
    "likely": "Higher chance to renew",
    "unlikely": "Needs follow-up",
    "very_unlikely": "At risk of not renewing",
}
UNAVAILABLE_TEXT = "Renewal prediction unavailable"

_lock = threading.Lock()
_cache = {"stamp": None, "booster": None, "meta": None}


def _load():
    """Return (booster, meta), reloading when the files change; (None, None) if unavailable."""
    try:
        stamp = (MODEL_PATH.stat().st_mtime_ns, META_PATH.stat().st_mtime_ns)
    except OSError:
        logger.error("Renewal XGBoost model files not found in %s.", MODEL_DIR)
        return None, None
    with _lock:
        if _cache["stamp"] == stamp:
            return _cache["booster"], _cache["meta"]
        try:
            from xgboost import Booster

            booster = Booster()
            booster.load_model(str(MODEL_PATH))
            meta = json.loads(META_PATH.read_text(encoding="utf-8"))
            if tuple(meta.get("features", ())) != FEATURES:
                raise ValueError(f"Model features {meta.get('features')} != {FEATURES}")
        except Exception:
            logger.exception("Renewal XGBoost model could not be loaded.")
            _cache.update(stamp=stamp, booster=None, meta=None)
            return None, None
        _cache.update(stamp=stamp, booster=booster, meta=meta)
        return booster, meta


def live_model_version():
    """Version of the loaded model, e.g. 'xgboost-v2'; None if no model loads."""
    _, meta = _load()
    return meta["version"] if meta else None


def last_booking_dates(customer_ids=None):
    """customer_id -> date of the latest accepted booking (session date, else created date)."""
    qs = Booking.objects.filter(session_status__in=ACCEPTED_BOOKING_STATUSES)
    if customer_ids is not None:
        qs = qs.filter(customer_id__in=list(customer_ids))
    rows = qs.values("customer_id").annotate(
        last=Max(Coalesce("session_date", "created_at"))
    )
    return {row["customer_id"]: row["last"].date() for row in rows if row["last"]}


def days_since(last_date, today=None):
    if last_date is None:
        return None
    if isinstance(last_date, datetime):
        last_date = last_date.date()
    today = today or timezone.now().date()
    # Upcoming sessions count as "today".
    return max(0, (today - last_date).days)


def band_for_probability(probability, meta):
    cutoffs = meta["band_cutoffs"]
    if probability >= cutoffs["very_likely"]:
        return "very_likely"
    if probability >= cutoffs["likely"]:
        return "likely"
    if probability >= cutoffs["unlikely"]:
        return "unlikely"
    return "very_unlikely"


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
        "predicted_renewal": band in ("likely", "very_likely"),
        "model_version": version,
    }


def features_from_renewal(renewal, last_date, today=None):
    """Model inputs from a Renewal row; None when the customer has no bookings."""
    if renewal is None or not int(renewal.total_bookings or 0):
        return None
    days = days_since(last_date, today)
    if days is None:
        return None
    return (
        booking_strength(
            renewal.total_bookings,
            renewal.booking_frequency,
            renewal.avg_booking_value,
            renewal.renewed_within_366,
        ),
        float(renewal.total_bookings or 0),
        float(renewal.booking_frequency or 0.0),
        float(bool(renewal.renewed_within_366)),
        float(days),
    )


def predict_from_features(rows):
    """
    rows: list of feature tuples in FEATURES order, or None for a customer with
    no bookings. Returns one prediction dict per row. A customer with no
    bookings gets 0% and the lowest group. Without a model every prediction is
    unavailable.
    """
    booster, meta = _load()
    if booster is None:
        return [_result(None, None, None) for _ in rows]
    results = [None] * len(rows)
    to_score = []
    for i, row in enumerate(rows):
        if row is None:
            results[i] = _result(0.0, "very_unlikely", meta["version"])
        else:
            to_score.append(i)
    if to_score:
        x = np.array([rows[i] for i in to_score], dtype=float)
        for i, p in zip(to_score, booster.inplace_predict(x)):
            p = float(p)
            results[i] = _result(p, band_for_probability(p, meta), meta["version"])
    return results


def predict_for_renewals(renewals, last_dates=None, today=None):
    """
    Predict for many Renewal rows at once.
    renewals: iterable of Renewal. last_dates: customer_id -> date; looked up
    from the database when not given. Returns customer_id -> prediction dict.
    """
    renewals = [r for r in renewals if r is not None]
    if last_dates is None:
        last_dates = last_booking_dates([r.customer_id for r in renewals])
    rows = [
        features_from_renewal(r, last_dates.get(r.customer_id), today) for r in renewals
    ]
    return {
        r.customer_id: prediction
        for r, prediction in zip(renewals, predict_from_features(rows))
    }


def predict_for_renewal(renewal, last_date=None, today=None):
    """Prediction dict for one Renewal row (None means no bookings)."""
    if renewal is not None and last_date is None:
        last_date = last_booking_dates([renewal.customer_id]).get(renewal.customer_id)
    return predict_from_features([features_from_renewal(renewal, last_date, today)])[0]
