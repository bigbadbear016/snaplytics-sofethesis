# backend/loyalty_utils.py
from __future__ import annotations

import math
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal

from django.db import transaction
from django.utils import timezone

from backend.models import Booking, Customer, LoyaltySettings, Package


def get_loyalty_settings() -> LoyaltySettings:
    row, _ = LoyaltySettings.objects.get_or_create(
        pk=1,
        defaults={
            "pesos_per_point_earn": Decimal("100"),
            "pesos_per_point_redeem": Decimal("50"),
        },
    )
    return row


def _quantize_balance(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def earn_points_from_booking_total(
    total_peso: float | None,
    settings_row: LoyaltySettings | None = None,
) -> Decimal:
    settings_row = settings_row or get_loyalty_settings()
    rate = settings_row.pesos_per_point_earn or Decimal("100")
    if rate <= 0:
        rate = Decimal("100")
    if total_peso is None:
        return Decimal("0.0")
    try:
        t = Decimal(str(total_peso))
    except Exception:
        return Decimal("0.0")
    if t <= 0 or math.isnan(float(t)):
        return Decimal("0.0")
    earned = t / rate
    return _quantize_balance(earned)


def effective_package_price(pkg: Package) -> Decimal:
    """
    Same rule as kiosk/package cards: use promo only when it is a positive sale price.
    If promo is unset or 0, fall back to list price (promo_price=0 must not zero out claims).
    """
    promo = pkg.promo_price
    if promo is not None:
        try:
            p = Decimal(str(promo))
            if p > 0:
                return p
        except Exception:
            pass
    try:
        return Decimal(str(pkg.price or 0))
    except Exception:
        return Decimal("0")


def claim_points_for_package(
    pkg: Package,
    settings_row: LoyaltySettings | None = None,
) -> Decimal:
    settings_row = settings_row or get_loyalty_settings()
    rate = settings_row.pesos_per_point_redeem or Decimal("50")
    if rate <= 0:
        rate = Decimal("50")
    price = effective_package_price(pkg)
    if price <= 0:
        return Decimal("0.0")
    n = (price / rate).to_integral_value(rounding=ROUND_CEILING)
    return Decimal(n).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def maybe_credit_booking(booking_id: int) -> None:
    """
    Idempotent: credits customer's loyalty_points once when booking is BOOKED.
    """
    with transaction.atomic():
        booking = (
            Booking.objects.select_related("customer")
            .select_for_update()
            .filter(pk=booking_id)
            .first()
        )
        if not booking or not booking.customer_id:
            return
        if booking.session_status != "BOOKED":
            return
        if booking.loyalty_points_credited:
            return

        settings_row = get_loyalty_settings()
        pts = earn_points_from_booking_total(booking.total_price, settings_row)

        customer = Customer.objects.select_for_update().get(
            pk=booking.customer_id
        )
        new_bal = _quantize_balance(
            (customer.loyalty_points or Decimal("0")) + pts
        )
        customer.loyalty_points = new_bal
        customer.last_updated = timezone.now()
        customer.save(update_fields=["loyalty_points", "last_updated"])

        booking.loyalty_points_credited = True
        booking.save(update_fields=["loyalty_points_credited"])
