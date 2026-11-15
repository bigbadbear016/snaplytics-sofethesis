"""
SVD++ package recommender for returning customers.

Training data (same recipe as the original pipeline): one row per
(customer, item) the customer booked, rating 1, where items are packages and
add-ons ("addon::<id>"); plus NEGATIVES_PER_CUSTOMER packages the customer
never booked, rating 0.

The live app uses the model only to fill recommendation cards left empty after
the customer's own most-booked packages (see recommender.service). Customers
the model has never seen get no SVD++ cards.
"""
import json
import logging
import pickle
import random
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_PATH = MODEL_DIR / "surprise_model.pkl"
META_PATH = MODEL_DIR / "surprise_model_meta.json"

PARAMS = dict(n_factors=50, n_epochs=20)
NEGATIVES_PER_CUSTOMER = 2
SEED = 42
SOURCE = "svdpp"

_lock = threading.Lock()
_cache = {"stamp": None, "algo": None}


def package_item(package_id):
    return str(int(package_id))


def addon_item(addon_id):
    return f"addon::{int(addon_id)}"


def build_ratings(bookings, booking_addons, seed=SEED):
    """
    bookings: iterable of (booking_id, customer_id, package_id).
    booking_addons: dict booking_id -> iterable of addon ids.
    Returns a sorted list of (customer_id, item, rating).
    """
    positives = set()
    for booking_id, customer_id, package_id in bookings:
        if customer_id is None or package_id is None:
            continue
        positives.add((int(customer_id), package_item(package_id)))
        for addon_id in booking_addons.get(booking_id, ()):
            positives.add((int(customer_id), addon_item(addon_id)))

    packages = sorted({item for _, item in positives if not item.startswith("addon::")})
    rows = [(customer, item, 1.0) for customer, item in sorted(positives)]
    rng = random.Random(seed)
    for customer in sorted({customer for customer, _ in positives}):
        candidates = [p for p in packages if (customer, p) not in positives]
        for item in rng.sample(candidates, min(NEGATIVES_PER_CUSTOMER, len(candidates))):
            rows.append((customer, item, 0.0))
    return rows


def fit(ratings, seed=SEED):
    import pandas as pd
    from surprise import Dataset, Reader, SVDpp

    frame = pd.DataFrame(ratings, columns=["user_id", "item_id", "rating"])
    data = Dataset.load_from_df(frame, Reader(rating_scale=(0, 1)))
    return SVDpp(random_state=seed, **PARAMS).fit(data.build_full_trainset())


def rank_packages(algo, customer_id, package_ids):
    """
    [(package_id, predicted score)] best first, for packages the model knows.
    None when the model has never seen this customer.
    """
    try:
        algo.trainset.to_inner_uid(int(customer_id))
    except ValueError:
        return None
    scored = []
    for package_id in package_ids:
        item = package_item(package_id)
        try:
            algo.trainset.to_inner_iid(item)
        except ValueError:
            continue
        scored.append((int(package_id), float(algo.predict(int(customer_id), item).est)))
    scored.sort(key=lambda pair: (-pair[1], -pair[0]))
    return scored


def save(algo, meta):
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    tmp_model = MODEL_PATH.with_name(MODEL_PATH.name + ".tmp")
    tmp_meta = META_PATH.with_name(META_PATH.name + ".tmp")
    with open(tmp_model, "wb") as handle:
        pickle.dump(algo, handle)
    tmp_meta.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    tmp_model.replace(MODEL_PATH)
    tmp_meta.replace(META_PATH)


def load_live_model():
    """The saved model, reloaded when the file changes. None if missing or unreadable."""
    try:
        stamp = MODEL_PATH.stat().st_mtime_ns
    except OSError:
        return None
    with _lock:
        if _cache["stamp"] != stamp:
            try:
                with open(MODEL_PATH, "rb") as handle:
                    _cache["algo"] = pickle.load(handle)
            except Exception:
                logger.exception("Could not load SVD++ model from %s", MODEL_PATH)
                _cache["algo"] = None
            _cache["stamp"] = stamp
        return _cache["algo"]
