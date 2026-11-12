from datetime import timedelta

from django.utils import timezone

from collections import Counter, defaultdict

from .models import Booking, Customer, Package, Renewal, RenewalShadowPrediction
from .renewal_utils import (
    ACCEPTED_BOOKING_STATUSES,
    heuristic_renewal_probability,
)


SHADOW_MODEL_VERSION = "heuristic-v1"


def build_live_features(customer):
    bookings = list(
        Booking.objects.filter(
            customer=customer,
            session_status__in=ACCEPTED_BOOKING_STATUSES,
        )
        .select_related("package")
        .order_by("session_date", "created_at", "id")
    )
    dated_bookings = [b for b in bookings if b.session_date or b.created_at]
    latest = dated_bookings[-1] if dated_bookings else None
    latest_date = (
        (latest.session_date or latest.created_at).date()
        if latest is not None
        else timezone.now().date()
    )
    prices = [float(b.total_price or 0.0) for b in bookings]
    package_ids = [b.package_id for b in bookings if b.package_id is not None]
    previous_date = (
        (dated_bookings[-2].session_date or dated_bookings[-2].created_at).date()
        if len(dated_bookings) > 1
        else None
    )
    return {
        "total_bookings": len(bookings),
        "avg_booking_value": sum(prices) / len(prices) if prices else 0.0,
        "total_spent": sum(prices),
        "days_since_previous_booking": (
            (latest_date - previous_date).days if previous_date else None
        ),
        "distinct_packages": len(set(package_ids)),
        "has_missing_booking_date": any(
            b.session_date is None for b in bookings
        ),
    }, latest_date


def record_shadow_predictions(model_version=SHADOW_MODEL_VERSION, threshold=0.5):
    today = timezone.now().date()
    created = 0
    updated = 0
    customers = list(
        Customer.objects.filter(deleted_at__isnull=True).only("customer_id")
    )
    bookings_by_customer = defaultdict(list)
    for booking in Booking.objects.filter(
        customer_id__in=[customer.customer_id for customer in customers],
        session_status__in=ACCEPTED_BOOKING_STATUSES,
    ).values(
        "id",
        "customer_id",
        "package_id",
        "session_date",
        "created_at",
        "total_price",
    ).iterator(chunk_size=2000):
        bookings_by_customer[booking["customer_id"]].append(booking)
    package_categories = dict(
        Package.objects.filter(
            id__in={
                booking["package_id"]
                for bookings in bookings_by_customer.values()
                for booking in bookings
                if booking["package_id"] is not None
            }
        ).values_list("id", "category")
    )

    for customer in customers:
        bookings = bookings_by_customer.get(customer.customer_id, [])
        dated_bookings = [
            booking for booking in bookings
            if booking["session_date"] or booking["created_at"]
        ]
        dated_bookings.sort(
            key=lambda booking: (
                booking["session_date"] or booking["created_at"],
                booking["id"],
            )
        )
        dates = [
            (booking["session_date"] or booking["created_at"]).date()
            for booking in dated_bookings
        ]
        prices = [float(booking["total_price"] or 0.0) for booking in bookings]
        package_ids = {
            booking["package_id"] for booking in bookings
            if booking["package_id"] is not None
        }
        category_counts = Counter(
            package_categories[booking["package_id"]]
            for booking in bookings
            if booking["package_id"] in package_categories
        )
        one_year_ago = today - timedelta(days=365)
        renewal = Renewal.objects.update_or_create(
            customer_id=customer.customer_id,
            defaults={
                "total_bookings": len(bookings),
                "avg_booking_value": sum(prices) / len(prices) if prices else 0.0,
                "booking_frequency": sum(date >= one_year_ago for date in dates),
                "renewed_within_366": any(
                    1 <= (curr - prev).days <= 366
                    for prev, curr in zip(sorted(set(dates)), sorted(set(dates))[1:])
                ),
                "total_spent": sum(prices),
                "preferred_package_type": (
                    category_counts.most_common(1)[0][0]
                    if category_counts
                    else ""
                ),
            },
        )[0]
        latest_date = dates[-1] if dates else today
        features = {
            "total_bookings": len(bookings),
            "avg_booking_value": sum(prices) / len(prices) if prices else 0.0,
            "total_spent": sum(prices),
            "days_since_previous_booking": (
                (latest_date - dates[-2]).days if len(dates) > 1 else None
            ),
            "distinct_packages": len(package_ids),
            "has_missing_booking_date": any(
                booking["session_date"] is None for booking in bookings
            ),
        }
        probability = float(heuristic_renewal_probability(renewal))
        _, was_created = RenewalShadowPrediction.objects.update_or_create(
            customer_id=customer.customer_id,
            snapshot_date=today,
            model_version=model_version,
            defaults={
                "probability": probability,
                "predicted_renewal": probability >= threshold,
                "feature_snapshot": features,
                "outcome_due_date": today + timedelta(days=365),
            },
        )
        if was_created:
            created += 1
        else:
            updated += 1
    return created, updated


def evaluate_mature_shadow_predictions(model_version=SHADOW_MODEL_VERSION):
    today = timezone.now().date()
    predictions = RenewalShadowPrediction.objects.filter(
        model_version=model_version,
        outcome_due_date__lte=today,
        actual_renewal__isnull=True,
    )
    evaluated = 0
    prediction_rows = list(
        predictions.values("id", "customer_id", "snapshot_date", "outcome_due_date")
    )
    bookings_by_customer = defaultdict(list)
    for booking in Booking.objects.filter(
        customer_id__in={row["customer_id"] for row in prediction_rows},
        session_status__in=ACCEPTED_BOOKING_STATUSES,
    ).values("customer_id", "session_date", "created_at").iterator(chunk_size=2000):
        bookings_by_customer[booking["customer_id"]].append(booking)

    evaluated_at = timezone.now()
    for row in prediction_rows:
        renewed = any(
            row["snapshot_date"]
            < (booking["session_date"] or booking["created_at"]).date()
            <= row["outcome_due_date"]
            for booking in bookings_by_customer[row["customer_id"]]
        )
        prediction = RenewalShadowPrediction(id=row["id"])
        prediction.actual_renewal = renewed
        prediction.evaluated_at = evaluated_at
        prediction.save(update_fields=["actual_renewal", "evaluated_at"])
        evaluated += 1
    return evaluated
