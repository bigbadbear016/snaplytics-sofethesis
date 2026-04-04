"""
Shared coupon validation and discount calculation logic.
Coupons are accessible to all users; receiving the coupon email is not required.
"""
from django.utils import timezone

from backend.models import Coupon, CouponUsage, Customer


def compute_coupon_discount(coupon, subtotal):
    """
    Compute discount amount for a coupon given a subtotal.
    Applies max_discount_amount cap.
    """
    if coupon.discount_type == Coupon.DISCOUNT_PERCENT:
        raw_discount = subtotal * (coupon.discount_value / 100.0)
    else:
        raw_discount = coupon.discount_value
    cap = coupon.max_discount_amount
    capped = min(raw_discount, cap) if cap is not None else raw_discount
    return max(0.0, capped)


def validate_coupon_for_customer(code, customer_id, subtotal):
    """
    Validate a coupon for a customer and subtotal.
    Returns (valid: bool, discount_amount: float, coupon: Coupon|None, error: str)
    """
    coupon = Coupon.objects.filter(
        code__iexact=code.strip(), deleted_at__isnull=True
    ).first()
    if coupon is None:
        return False, 0.0, None, "Coupon not found"

    if coupon.expires_at and coupon.expires_at < timezone.now():
        return False, 0.0, coupon, "Coupon has expired"

    try:
        customer = Customer.objects.get(pk=customer_id)
    except Customer.DoesNotExist:
        return False, 0.0, coupon, "Customer not found"

    # Per-user limit (by email): use_limit is the max times each customer can use this coupon
    limit_per_user = coupon.use_limit if coupon.use_limit is not None else coupon.per_customer_limit
    customer_used = CouponUsage.objects.filter(coupon=coupon, customer=customer).count()
    if customer_used >= limit_per_user:
        return False, 0.0, coupon, "You have reached the limit for this coupon"

    discount_amount = compute_coupon_discount(coupon, subtotal)
    return True, discount_amount, coupon, None
