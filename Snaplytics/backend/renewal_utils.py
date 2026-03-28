from django.db.models import Avg, Count, Sum
from django.utils import timezone
from datetime import timedelta

from .models import Booking, Renewal

ACCEPTED_BOOKING_STATUSES = ("Ongoing", "BOOKED")


def recompute_customer_renewal_profile(customer):
    """
    Rebuild Renewal metrics from live booking data for one customer.
    """
    bookings_qs = (
        Booking.objects.filter(
            customer=customer, session_status__in=ACCEPTED_BOOKING_STATUSES
        )
        .select_related("package")
        .order_by("session_date", "created_at", "id")
    )
    total_bookings = bookings_qs.count()

    if total_bookings == 0:
        renewal, _ = Renewal.objects.update_or_create(
            customer=customer,
            defaults={
                "total_bookings": 0,
                "avg_booking_value": 0.0,
                "booking_frequency": 0.0,
                "renewed_within_366": False,
                "total_spent": 0.0,
                "preferred_package_type": "",
            },
        )
        return renewal

    agg = bookings_qs.aggregate(
        avg_booking_value=Avg("total_price"),
        total_spent=Sum("total_price"),
    )
    avg_booking_value = float(agg.get("avg_booking_value") or 0.0)
    total_spent = float(agg.get("total_spent") or 0.0)

    preferred = (
        bookings_qs.values("package__category")
        .annotate(count=Count("id"))
        .order_by("-count")
        .first()
    )
    preferred_package_type = (
        str(preferred.get("package__category")).strip()
        if preferred and preferred.get("package__category")
        else ""
    )

    booking_dates = []
    for booking in bookings_qs:
        dt = booking.session_date or booking.created_at
        if dt:
            booking_dates.append(dt.date())

    if booking_dates:
        # Use trailing 365-day booking count for a stable, non-explosive yearly rate.
        # This prevents unrealistic values like 365/year for newly created accounts.
        one_year_ago = timezone.now().date() - timedelta(days=365)
        trailing_365_count = sum(1 for d in booking_dates if d >= one_year_ago)
        booking_frequency = float(trailing_365_count)
    else:
        booking_frequency = 0.0

    renewed_within_366 = False
    if len(booking_dates) >= 2:
        sorted_dates = sorted(set(booking_dates))
        for prev, curr in zip(sorted_dates, sorted_dates[1:]):
            gap_days = (curr - prev).days
            if 1 <= gap_days <= 366:
                renewed_within_366 = True
                break

    renewal, _ = Renewal.objects.update_or_create(
        customer=customer,
        defaults={
            "total_bookings": int(total_bookings),
            "avg_booking_value": avg_booking_value,
            "booking_frequency": booking_frequency,
            "renewed_within_366": renewed_within_366,
            "total_spent": total_spent,
            "preferred_package_type": preferred_package_type,
        },
    )
    return renewal
