from datetime import timedelta

from django.utils import timezone

from .models import Booking, Customer, RenewalShadowPrediction
from .renewal_model import (
    days_since,
    features_from_renewal,
    live_model_version,
    predict_from_features,
)
from .renewal_utils import (
    ACCEPTED_BOOKING_STATUSES,
    clean_price,
    recompute_customer_renewal_profile,
    unique_bookings,
)


def build_live_features(customer):
    bookings = unique_bookings(
        Booking.objects.filter(
            customer=customer,
            session_status__in=ACCEPTED_BOOKING_STATUSES,
        )
        .select_related("package")
        .order_by("session_date", "created_at", "id")
    )
    # Sort by the booking's own date (session date, else created date), the same
    # date the live model and the API use for "days since last booking".
    booking_dates = sorted(
        (b.session_date or b.created_at).date()
        for b in bookings
        if b.session_date or b.created_at
    )
    latest_date = booking_dates[-1] if booking_dates else timezone.now().date()
    prices = [clean_price(b.total_price) for b in bookings]
    package_ids = [b.package_id for b in bookings if b.package_id is not None]
    previous_date = booking_dates[-2] if len(booking_dates) > 1 else None
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


def record_shadow_predictions():
    """
    Save today's prediction from the live XGBoost model for every active
    customer. Returns (model_version, created, updated). Raises if no model loads.
    """
    model_version = live_model_version()
    if model_version is None:
        raise RuntimeError(
            "The renewal XGBoost model could not be loaded; no predictions recorded."
        )
    today = timezone.now().date()
    created = 0
    updated = 0
    for customer in Customer.objects.filter(deleted_at__isnull=True).iterator(
        chunk_size=500
    ):
        renewal = recompute_customer_renewal_profile(customer)
        features, latest_date = build_live_features(customer)
        model_input = features_from_renewal(
            renewal, latest_date if features["total_bookings"] else None, today
        )
        # Store every model input so each saved prediction can be rebuilt later.
        features["bookings_last_365_days"] = float(renewal.booking_frequency or 0.0)
        features["renewed_within_366"] = bool(renewal.renewed_within_366)
        features["days_since_last_booking"] = (
            days_since(latest_date, today) if features["total_bookings"] else None
        )
        features["booking_strength"] = model_input[0] if model_input else 0.0
        prediction = predict_from_features([model_input])[0]
        if prediction["model_version"] != model_version:
            raise RuntimeError("The renewal XGBoost model changed or failed during the run.")
        _, was_created = RenewalShadowPrediction.objects.update_or_create(
            customer=customer,
            snapshot_date=today,
            model_version=model_version,
            defaults={
                "probability": prediction["probability"],
                "predicted_renewal": prediction["predicted_renewal"],
                "feature_snapshot": features,
                "outcome_due_date": today + timedelta(days=365),
            },
        )
        if was_created:
            created += 1
        else:
            updated += 1
    return model_version, created, updated


def evaluate_mature_shadow_predictions(model_version=None):
    """Resolve mature predictions; model_version=None resolves every version."""
    today = timezone.now().date()
    predictions = RenewalShadowPrediction.objects.filter(
        outcome_due_date__lte=today,
        actual_renewal__isnull=True,
    )
    if model_version:
        predictions = predictions.filter(model_version=model_version)
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
