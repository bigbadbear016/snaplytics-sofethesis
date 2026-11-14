import math
from collections import Counter
from datetime import timedelta

from django.utils import timezone

from .models import Booking, Renewal

# Renewal predictions use completed/booked records only. In-progress bookings
# should not increase a customer's renewal score.
ACCEPTED_BOOKING_STATUSES = ("BOOKED",)

# Fields that make two bookings "the same booking". Rows equal in all of them
# are treated as one booking by the renewal model (import duplicates).
BOOKING_IDENTITY_FIELDS = (
    "customer_id",
    "session_date",
    "package_id",
    "total_price",
    "gcash_payment",
    "cash_payment",
    "discounts",
    "coupon_id",
    "coupon_discount_amount",
    "session_status",
)


def clean_price(value):
    """Booking price as a float; missing or NaN counts as 0."""
    value = float(value or 0.0)
    return 0.0 if math.isnan(value) else value


def booking_identity(row):
    """Hashable key for a booking dict/object; NaN prices compare as equal."""
    key = []
    for field in BOOKING_IDENTITY_FIELDS:
        value = row[field] if isinstance(row, dict) else getattr(row, field)
        if isinstance(value, float) and math.isnan(value):
            value = "nan"
        key.append(value)
    return tuple(key)


def unique_bookings(rows):
    """Keep the first of each group of identical bookings (rows sorted by caller)."""
    seen = set()
    out = []
    for row in rows:
        key = booking_identity(row)
        if key not in seen:
            seen.add(key)
            out.append(row)
    return out


def recompute_customer_renewal_profile(customer):
    """
    Rebuild Renewal metrics from live booking data for one customer.
    Identical duplicate bookings count once.
    """
    bookings = unique_bookings(
        Booking.objects.filter(
            customer=customer, session_status__in=ACCEPTED_BOOKING_STATUSES
        )
        .select_related("package")
        .order_by("session_date", "created_at", "id")
    )
    total_bookings = len(bookings)

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

    prices = [clean_price(b.total_price) for b in bookings]
    total_spent = sum(prices)
    avg_booking_value = total_spent / total_bookings

    categories = Counter(
        b.package.category.strip()
        for b in bookings
        if b.package is not None and b.package.category
    )
    preferred_package_type = categories.most_common(1)[0][0] if categories else ""

    booking_dates = []
    for booking in bookings:
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
