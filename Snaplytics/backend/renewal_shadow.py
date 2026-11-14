from datetime import timedelta

from django.utils import timezone

from .models import Booking, Customer, RenewalShadowPrediction
from .renewal_utils import (
    ACCEPTED_BOOKING_STATUSES,
    heuristic_renewal_probability,
    recompute_customer_renewal_profile,
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
    for customer in Customer.objects.filter(deleted_at__isnull=True).iterator(
        chunk_size=500
    ):
        renewal = recompute_customer_renewal_profile(customer)
        features, _ = build_live_features(customer)
        # Store the heuristic's own inputs so each saved score can be rebuilt later.
        features["bookings_last_365_days"] = float(renewal.booking_frequency or 0.0)
        features["renewed_within_366"] = bool(renewal.renewed_within_366)
        probability = float(heuristic_renewal_probability(renewal))
        _, was_created = RenewalShadowPrediction.objects.update_or_create(
            customer=customer,
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
    for prediction in predictions.select_related("customer").iterator(
        chunk_size=500
    ):
        renewed = False
        for booking in Booking.objects.filter(
            customer=prediction.customer,
            session_status__in=ACCEPTED_BOOKING_STATUSES,
        ).iterator():
            booking_date = (booking.session_date or booking.created_at).date()
            if prediction.snapshot_date < booking_date <= prediction.outcome_due_date:
                renewed = True
                break
        prediction.actual_renewal = renewed
        prediction.evaluated_at = timezone.now()
        prediction.save(update_fields=["actual_renewal", "evaluated_at"])
        evaluated += 1
    return evaluated
