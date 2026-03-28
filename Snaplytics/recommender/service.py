# recommender/service.py (patched to use multi-addon loader)
from pyspark.sql import Row
from .loader import load_popularity_tables
from pyspark.sql import SparkSession
from .popularity_builder import build_monthly_popularity as build_popularity_tables
from backend.models import Booking, BookingAddon
from django.db.models import Count, Sum
from collections import defaultdict, Counter
import logging

logger = logging.getLogger(__name__)
ACCEPTED_BOOKING_STATUSES = ("Ongoing", "BOOKED")

# Lazy caches — NOT computed at import time
_popular_packages_cache = None
_popular_combos_cache = None
_addon_counts_cache = None


def get_popularity_tables():
    global _popular_packages_cache, _popular_combos_cache
    if _popular_packages_cache is None or _popular_combos_cache is None:
        # build_popularity_tables used in other contexts writes artifacts - keep interface compatibility
        # We expect build_popularity_tables / popularity_builder to create CSV artifacts already,
        # but returning an in-memory mapping here is useful in tests/interactive mode.
        try:
            # try building (no-op if artifacts already exist)
            build_popularity_tables(
                "recommender/data/merged_bookings.csv",
                "recommender/data/booking_addons.csv",
                "recommender/artifacts",
            )
        except Exception:
            # ignore; we'll load artifacts below
            pass
        tables = load_popularity_tables()
        _popular_packages_cache = tables.get("package", None)
        _popular_combos_cache = tables.get("cooccurrence", None)
    return _popular_packages_cache, _popular_combos_cache


def get_addon_counts():
    global _addon_counts_cache
    if _addon_counts_cache is None:
        addon_counts = defaultdict(Counter)
        for ba in BookingAddon.objects.select_related("booking").filter(
            booking__session_status__in=ACCEPTED_BOOKING_STATUSES
        ):
            pkg = ba.booking.package_id
            if pkg:
                addon_counts[pkg][ba.addon_id] += ba.addon_quantity or 1
        _addon_counts_cache = addon_counts
    return _addon_counts_cache


def get_spark():
    return SparkSession.builder.getOrCreate()


# def recommend_packages(customer_id, k=3):
# Spark & model are initialized lazily inside the function (safe in Django)
#    spark = get_spark()
#    model = load_model()

#    user_df = spark.createDataFrame([Row(user=int(customer_id))])
#    rec = model.recommendForUserSubset(user_df, k).collect()

#    if not rec:
#        return []

#    return [(r.item, float(r.rating)) for r in rec[0].recommendations]


def recommend_packages(customer_id, k=3):
    """
    DEPRECATED: This function was designed for Spark ALS but load_model() returns Surprise SVDpp
    This should not be called anymore - the loader.py's recommend_for_user handles both
    """
    logger.warning(
        "recommend_packages() called but is deprecated - should use loader's recommend_for_user"
    )
    raise NotImplementedError(
        "recommend_packages is deprecated - use loader.recommend_for_user instead"
    )


def get_top_addons_for_package(package_id, top_m=2):
    addon_counts = get_addon_counts()
    counts = addon_counts.get(package_id)
    if not counts:
        return []
    return [a for a, c in counts.most_common(top_m)]


def get_history_based_recommendations(customer_id, k=3):
    """
    Return recommendations from the customer's live booking history.
    If no history exists, return [] and let caller use popularity fallback.
    """
    package_stats = (
        Booking.objects.filter(
            customer_id=customer_id,
            package_id__isnull=False,
            session_status__in=ACCEPTED_BOOKING_STATUSES,
        )
        .values("package_id")
        .annotate(count=Count("id"))
        .order_by("-count", "-package_id")
    )
    if not package_stats:
        return []

    total = sum(int(p["count"]) for p in package_stats) or 1
    results = []

    for row in package_stats[:k]:
        package_id = int(row["package_id"])
        addon_rows = (
            BookingAddon.objects.filter(
                booking__customer_id=customer_id,
                booking__package_id=package_id,
                booking__session_status__in=ACCEPTED_BOOKING_STATUSES,
            )
            .values("addon_id")
            .annotate(total_quantity=Sum("addon_quantity"), booking_count=Count("booking_id"))
            .order_by("-total_quantity", "-booking_count")[:2]
        )
        addon_ids = [int(a["addon_id"]) for a in addon_rows]
        score = float(row["count"]) / float(total)
        results.append(
            {
                "package_id": package_id,
                "addon_ids": addon_ids,
                "score": score,
                "source": "customer_booking_history",
            }
        )
    return results


def get_recommendations(customer_id, target_date, k=3):
    """
    Updated flow with fixed fallback handling
    """
    # Primary behavior: always use this customer's booking history if available.
    history_recs = get_history_based_recommendations(customer_id, k)
    if history_recs:
        logger.info(
            "Returning %s history-based recommendations for customer %s",
            len(history_recs),
            customer_id,
        )
        return history_recs[:k]

    # New users / no history: return [] so the view layer fills with DB popularity.
    logger.info(
        "Customer %s has no booking history; using popularity fallback",
        customer_id,
    )
    return []
