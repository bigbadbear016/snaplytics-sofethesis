"""Booking confirmation email via Django SMTP (HEIGEN_SMTP_* in settings)."""

from __future__ import annotations

import logging
import math
import os
from decimal import Decimal
from html import escape

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from backend.loyalty_utils import earn_points_from_booking_total, get_loyalty_settings
from backend.models import Booking, Customer

logger = logging.getLogger(__name__)

# ── electron-app/styles/main.css + styles.css :root (light staff shell) ────────
E_PAGE_BG = "linear-gradient(165deg,#b4ccd4 0%,#9bb5bc 48%,#89a8b4 100%)"
E_HEADER_GRADIENT = "linear-gradient(145deg,#1a6578 0%,#165166 45%,#0f3d4d 100%)"
E_TEAL = "#165166"
E_TEAL_DK = "#134152"
E_SLATE = "#5f6e79"
E_SLATE_DK = "#4f6e79"
E_TEXT_BODY = "#616161"
E_TEXT_STRONG = "#37352F"
E_BORDER = "#E0E0E0"
E_CREAM = "#f6efe3"
E_CARD_WARM = "#fffefb"
E_SURFACE = "#ffffff"
E_SHADOW_CARD = "0 8px 32px rgba(22,81,102,0.14)"
E_FONT = '"Segoe UI","Inter",Roboto,Helvetica,Arial,sans-serif'

# Default matches electron-app invoice logo (customer-details.js INVOICE_LOGO_URL)
_DEFAULT_HEIGEN_LOGO_URL = (
    "https://api.builder.io/api/v1/image/assets/TEMP/"
    "0fdade257f0aa6c53979aa05f0c346a41b70e926?width=475"
)


def _heigen_email_logo_url() -> str:
    return (
        os.getenv("HEIGEN_EMAIL_LOGO_URL", "").strip()
        or getattr(settings, "HEIGEN_EMAIL_LOGO_URL", "").strip()
        or _DEFAULT_HEIGEN_LOGO_URL
    )


def _heigen_email_banner_url() -> str:
    """Optional wide banner under logo (set HEIGEN_EMAIL_BANNER_URL)."""
    return os.getenv("HEIGEN_EMAIL_BANNER_URL", "").strip() or getattr(
        settings, "HEIGEN_EMAIL_BANNER_URL", ""
    ).strip()


def _safe_http_url(url: str | None) -> str | None:
    if not url or not isinstance(url, str):
        return None
    u = url.strip()
    if u.startswith("https://") or u.startswith("http://"):
        return u
    return None


def _format_money_peso(amount: float | None) -> str:
    """PHP amounts: comma thousands + exactly 2 decimals."""
    if amount is None:
        return "—"
    try:
        x = float(amount)
        if math.isnan(x):
            return "—"
        return f"₱{x:,.2f}"
    except (TypeError, ValueError):
        return "—"


def _format_num_2(value: Decimal | float | int | None) -> str:
    """Two decimal places (loyalty points, rates shown as decimals)."""
    if value is None:
        return "0.00"
    try:
        d = value if isinstance(value, Decimal) else Decimal(str(float(value)))
        q = d.quantize(Decimal("0.01"))
        return f"{q:.2f}"
    except Exception:
        return "0.00"


def _html_email_header_logo(logo_url: str | None = None) -> str:
    """
    Logo centered on the header row only (parent td uses E_HEADER_GRADIENT).
    Default Builder asset is a light mark — avoid pale inner card (it washed it out).
    """
    url = (logo_url or "").strip() or _heigen_email_logo_url()
    logo_src = escape(url)
    return (
        f'<img src="{logo_src}" alt="Heigen Studio" width="200" '
        f'style="display:block;margin:0 auto;border:0;width:200px;max-width:100%;'
        f'height:auto;line-height:0;" />'
    )


def _preferred_session_date_only(booking: Booking) -> str:
    """Calendar date only (no time) for preferred session line."""
    dt = booking.session_date or booking.created_at
    if not dt:
        return "—"
    if timezone.is_aware(dt):
        dt = timezone.localtime(dt)
    return f"{dt.month}/{dt.day}/{dt.year}"


def build_booking_confirmation_email(booking: Booking) -> tuple[str, str, str]:
    """
    Subject, plain-text body, and HTML body with booking summary.
    """
    customer = booking.customer
    name = (customer.full_name or "").strip() or "Customer"
    pkg = booking.package
    pkg_label = pkg.name if pkg else "—"

    date_line = _preferred_session_date_only(booking)
    status_line = (booking.session_status or "").strip() or "—"

    addon_plain: list[str] = []
    addon_rows_html: list[str] = []
    for ba in booking.bookingaddon_set.all():
        an = ba.addon.name if ba.addon else "Add-on"
        qty = ba.addon_quantity or 1
        extra = ba.total_addon_cost if ba.total_addon_cost is not None else 0.0
        price = _format_money_peso(extra)
        addon_plain.append(f"  • {an} × {qty} — {price}")
        addon_rows_html.append(
            "<tr>"
            f'<td style="padding:8px 0;border-bottom:1px solid {E_BORDER};font-size:14px;color:{E_SLATE_DK};">'
            f"{escape(an)} <span style=\"color:{E_SLATE};\">× {qty}</span></td>"
            f'<td style="padding:8px 0;border-bottom:1px solid {E_BORDER};text-align:right;'
            f'font-size:14px;color:{E_TEXT_STRONG};white-space:nowrap;">{escape(price)}</td>'
            "</tr>"
        )

    addons_plain = "\n".join(addon_plain) if addon_plain else "  (none)"
    addons_html = (
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        'style="margin:0;">'
        + "".join(addon_rows_html)
        + "</table>"
        if addon_rows_html
        else f'<p style="margin:0;font-size:14px;color:{E_SLATE};">(none)</p>'
    )

    total = booking.total_price
    total_str = _format_money_peso(total)

    discount_plain = ""
    discount_html = ""
    if booking.discounts:
        discount_plain = f"\nDiscount / coupon note: {booking.discounts}"
        discount_html = (
            f'<p style="margin:16px 0 0;font-size:14px;color:{E_SLATE_DK};">'
            f"<strong>Discount / coupon</strong><br>"
            f'{escape(str(booking.discounts))}</p>'
        )
    elif booking.coupon_discount_amount:
        d = _format_money_peso(booking.coupon_discount_amount)
        discount_plain = f"\nCoupon discount: {d}"
        discount_html = (
            f'<p style="margin:16px 0 0;font-size:14px;color:{E_SLATE_DK};">'
            f"<strong>Coupon discount</strong> · {escape(d)}</p>"
        )

    subject = f"Heigen Studio — booking confirmed (#{booking.pk})"

    plain = (
        f"Hi {name},\n\n"
        f"Booking reference: #{booking.pk}\n"
        f"Package: {pkg_label}\n"
        f"Preferred session date: {date_line}\n"
        f"Status: {status_line}\n\n"
        f"Add-ons:\n{addons_plain}\n"
        f"{discount_plain}\n\n"
        f"Total due: {total_str}\n\n"
        f"If anything looks wrong, reply to this email or contact the studio.\n\n"
        f"— Heigen Studio\n"
    )

    # HTML: escape user-facing copy; booking id is numeric
    e_name = escape(name)
    e_pkg = escape(pkg_label)
    e_date = escape(date_line)
    e_status = escape(status_line)
    e_total = escape(total_str)

    logo_card = _html_email_header_logo()

    html = f"""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:{E_PAGE_BG};-webkit-text-size-adjust:100%;font-family:{E_FONT};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:{E_PAGE_BG};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:{E_SURFACE};border-radius:12px;overflow:hidden;box-shadow:{E_SHADOW_CARD};">
<tr><td style="background:{E_HEADER_GRADIENT};padding:28px 20px 26px;text-align:center;">
{logo_card}
<h1 style="margin:20px 0 0;font-size:22px;font-weight:600;color:#ffffff;line-height:1.3;">Booking confirmed</h1>
</td></tr>
<tr><td style="padding:28px 24px 8px;background:linear-gradient(180deg,{E_CARD_WARM} 0%,{E_SURFACE} 28%);">
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:{E_TEXT_BODY};">Hi {e_name},</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
<tr><td style="padding:10px 0;font-size:13px;color:{E_SLATE};width:42%;vertical-align:top;">Booking reference</td>
<td style="padding:10px 0;font-size:14px;color:{E_TEAL};font-weight:600;">#{booking.pk}</td></tr>
<tr><td style="padding:10px 0;font-size:13px;color:{E_SLATE};vertical-align:top;">Package</td>
<td style="padding:10px 0;font-size:14px;color:{E_TEXT_STRONG};">{e_pkg}</td></tr>
<tr><td style="padding:10px 0;font-size:13px;color:{E_SLATE};vertical-align:top;">Preferred session date</td>
<td style="padding:10px 0;font-size:14px;color:{E_TEXT_STRONG};">{e_date}</td></tr>
<tr><td style="padding:10px 0;font-size:13px;color:{E_SLATE};vertical-align:top;">Status</td>
<td style="padding:10px 0;font-size:14px;color:{E_TEXT_STRONG};">{e_status}</td></tr>
</table>
<h2 style="margin:24px 0 12px;font-size:13px;font-weight:600;color:{E_TEAL};text-transform:uppercase;letter-spacing:0.04em;">Add-ons</h2>
{addons_html}
{discount_html}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;border-top:2px solid {E_BORDER};">
<tr><td style="padding:16px 0 8px;font-size:15px;color:{E_SLATE_DK};">Total due</td>
<td style="padding:16px 0 8px;text-align:right;font-size:20px;font-weight:700;color:{E_TEAL};white-space:nowrap;">{e_total}</td></tr>
</table>
<p style="margin:28px 0 0;font-size:14px;line-height:1.6;color:{E_SLATE};">If anything looks wrong, reply to this email or contact the studio.</p>
<p style="margin:20px 0 0;font-size:14px;color:{E_TEAL_DK};font-weight:600;">— Heigen Studio</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""

    return subject, plain, html


def build_booking_receipt_email(
    booking: Booking, customer: Customer
) -> tuple[str, str, str]:
    """
    Thank-you + receipt when booking is completed (BOOKED). Includes loyalty snapshot.
    """
    settings_row = get_loyalty_settings()
    pesos_per_pt = settings_row.pesos_per_point_earn or Decimal("100")

    name = (customer.full_name or "").strip() or "Customer"
    pkg = booking.package
    pkg_label = pkg.name if pkg else "—"
    pkg_img = _safe_http_url(pkg.image_url) if pkg else None

    logo_url = _heigen_email_logo_url()
    banner_url = _heigen_email_banner_url()

    dt_completed = timezone.localtime(timezone.now())
    completed_str = f"{dt_completed.month}/{dt_completed.day}/{dt_completed.year}"

    session_date_str = _preferred_session_date_only(booking)

    addon_plain: list[str] = []
    addon_rows_html: list[str] = []
    for ba in booking.bookingaddon_set.all():
        an = ba.addon.name if ba.addon else "Add-on"
        qty = ba.addon_quantity or 1
        extra = ba.total_addon_cost if ba.total_addon_cost is not None else 0.0
        price = _format_money_peso(extra)
        addon_plain.append(f"  • {an} × {qty} — {price}")
        addon_rows_html.append(
            "<tr>"
            f'<td style="padding:8px 0;border-bottom:1px solid {E_BORDER};font-size:14px;color:{E_SLATE_DK};">'
            f"{escape(an)} <span style=\"color:{E_SLATE};\">× {qty}</span></td>"
            f'<td style="padding:8px 0;border-bottom:1px solid {E_BORDER};text-align:right;'
            f'font-size:14px;color:{E_TEXT_STRONG};white-space:nowrap;">{escape(price)}</td>'
            "</tr>"
        )

    addons_plain = "\n".join(addon_plain) if addon_plain else "  (none)"
    addons_html = (
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0;">'
        + "".join(addon_rows_html)
        + "</table>"
        if addon_rows_html
        else f'<p style="margin:0;font-size:14px;color:{E_SLATE};">(none)</p>'
    )

    subtotal_base = 0.0
    if pkg:
        subtotal_base = float(pkg.promo_price or pkg.price or 0.0)
    pkg_price_str = _format_money_peso(subtotal_base)

    total = booking.total_price
    total_str = _format_money_peso(total)

    discount_plain = ""
    discount_html = ""
    if booking.discounts:
        discount_plain = f"\nDiscount / coupon: {booking.discounts}"
        discount_html = (
            f'<tr><td style="padding:8px 0;font-size:14px;color:{E_TEAL_DK};">'
            f'Discount / coupon</td><td style="padding:8px 0;text-align:right;'
            f'font-size:14px;color:{E_TEAL_DK};">{escape(str(booking.discounts))}</td></tr>'
        )
    elif booking.coupon_discount_amount:
        d = _format_money_peso(booking.coupon_discount_amount)
        discount_plain = f"\nCoupon discount: -{d}"
        discount_html = (
            f'<tr><td style="padding:8px 0;font-size:14px;color:{E_TEAL_DK};">'
            f'Coupon discount</td><td style="padding:8px 0;text-align:right;'
            f'font-size:14px;color:{E_TEAL_DK};">-{escape(d)}</td></tr>'
        )

    pay_lines_plain: list[str] = []
    pay_rows_html: list[str] = []
    for label, val in (
        ("GCash", booking.gcash_payment),
        ("Cash", booking.cash_payment),
    ):
        if val is None:
            continue
        try:
            vf = float(val)
        except (TypeError, ValueError):
            continue
        if vf <= 0:
            continue
        ps = _format_money_peso(vf)
        pay_lines_plain.append(f"{label}: {ps}")
        pay_rows_html.append(
            "<tr>"
            f'<td style="padding:6px 0;font-size:13px;color:{E_SLATE};">{escape(label)}</td>'
            f'<td style="padding:6px 0;text-align:right;font-size:14px;color:{E_TEXT_STRONG};">'
            f"{escape(ps)}</td></tr>"
        )
    pay_plain = ("\n" + "\n".join(pay_lines_plain)) if pay_lines_plain else ""
    pay_html = (
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        'style="margin-top:12px;">'
        + "".join(pay_rows_html)
        + "</table>"
        if pay_rows_html
        else ""
    )

    if booking.loyalty_points_credited:
        pts_earned = earn_points_from_booking_total(booking.total_price, settings_row)
    else:
        pts_earned = Decimal("0.0")
    balance = customer.loyalty_points or Decimal("0.0")
    pts_display = _format_num_2(pts_earned)
    bal_display = _format_num_2(balance)

    earn_rule = f"₱{float(pesos_per_pt):,.2f} spent ≈ 1 loyalty point (rounded)."

    subject = f"Heigen Studio — thank you · receipt #{booking.pk}"

    plain = (
        f"Hi {name},\n\n"
        f"Thank you for visiting Heigen Studio. Here is your receipt.\n\n"
        f"Receipt #: #{booking.pk}\n"
        f"Completed: {completed_str}\n"
        f"Session date (reference): {session_date_str}\n\n"
        f"Package: {pkg_label} — {pkg_price_str}\n"
        f"Add-ons:\n{addons_plain}\n"
        f"{discount_plain}\n"
        f"Total: {total_str}"
        f"{pay_plain}\n\n"
        f"Loyalty — points earned this visit: {pts_display}\n"
        f"Your balance now: {bal_display} points\n"
        f"({earn_rule})\n\n"
        f"We appreciate your business.\n\n"
        f"— Heigen Studio\n"
    )

    e_name = escape(name)
    e_pkg = escape(pkg_label)
    e_completed = escape(completed_str)
    e_session_ref = escape(session_date_str)
    e_total = escape(total_str)
    e_pkg_price = escape(pkg_price_str)
    logo_card = _html_email_header_logo(logo_url)
    banner_block = ""
    if banner_url:
        banner_block = (
            f'<tr><td style="padding:0 0 16px;">'
            f'<img src="{escape(banner_url)}" alt="" width="560" '
            f'style="display:block;width:100%;max-width:560px;height:auto;border:0;'
            f'border-radius:0 0 8px 8px;" /></td></tr>'
        )
    pkg_photo_block = ""
    if pkg_img:
        pkg_photo_block = (
            f'<tr><td style="padding:0 0 20px;text-align:center;">'
            f'<img src="{escape(pkg_img)}" alt="{e_pkg}" width="520" '
            f'style="max-width:100%;height:auto;border-radius:10px;border:1px solid {E_BORDER};" />'
            f"</td></tr>"
        )

    html = f"""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:{E_PAGE_BG};-webkit-text-size-adjust:100%;font-family:{E_FONT};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:{E_PAGE_BG};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:{E_SURFACE};border-radius:14px;overflow:hidden;box-shadow:{E_SHADOW_CARD};">
<tr><td style="background:{E_HEADER_GRADIENT};padding:28px 20px 24px;text-align:center;">
{logo_card}
</td></tr>
{banner_block}
<tr><td style="padding:12px 24px 0;background:linear-gradient(180deg,{E_CARD_WARM} 0%,{E_SURFACE} 35%);">
<p style="margin:0 0 8px;font-size:20px;font-weight:700;color:{E_TEAL};text-align:center;font-family:{E_FONT};">Thank you</p>
<p style="margin:0;font-size:15px;line-height:1.6;color:{E_SLATE};text-align:center;">We hope you loved your session.</p>
</td></tr>
{pkg_photo_block}
<tr><td style="padding:16px 24px;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:{E_TEXT_BODY};">Hi {e_name},</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:{E_TEXT_BODY};">Below is your receipt and loyalty summary.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
<tr><td style="padding:8px 0;font-size:13px;color:{E_SLATE};width:44%;">Receipt #</td>
<td style="padding:8px 0;font-size:15px;color:{E_TEAL};font-weight:700;text-align:right;">#{booking.pk}</td></tr>
<tr><td style="padding:8px 0;font-size:13px;color:{E_SLATE};">Completed</td>
<td style="padding:8px 0;font-size:14px;color:{E_TEXT_STRONG};text-align:right;">{e_completed}</td></tr>
<tr><td style="padding:8px 0;font-size:13px;color:{E_SLATE};">Session date (reference)</td>
<td style="padding:8px 0;font-size:14px;color:{E_TEXT_STRONG};text-align:right;">{e_session_ref}</td></tr>
</table>
<h2 style="margin:24px 0 10px;font-size:13px;font-weight:600;color:{E_TEAL};text-transform:uppercase;letter-spacing:0.06em;">Services</h2>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
<tr><td style="padding:10px 0;border-bottom:1px solid {E_BORDER};font-size:14px;color:{E_SLATE_DK};">{e_pkg}</td>
<td style="padding:10px 0;border-bottom:1px solid {E_BORDER};text-align:right;font-size:14px;color:{E_TEXT_STRONG};white-space:nowrap;">{e_pkg_price}</td></tr>
</table>
<h2 style="margin:20px 0 10px;font-size:13px;font-weight:600;color:{E_TEAL};text-transform:uppercase;letter-spacing:0.06em;">Add-ons</h2>
{addons_html}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px;">
{discount_html}
<tr><td style="padding:14px 0 6px;font-size:15px;font-weight:700;color:{E_SLATE_DK};border-top:2px solid {E_BORDER};">Total</td>
<td style="padding:14px 0 6px;text-align:right;font-size:20px;font-weight:800;color:{E_TEAL};white-space:nowrap;border-top:2px solid {E_BORDER};">{e_total}</td></tr>
</table>
{pay_html}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;background:linear-gradient(180deg,{E_CARD_WARM} 0%,{E_CREAM} 100%);border-radius:12px;border:1px solid rgba(22,81,102,0.18);">
<tr><td style="padding:20px 18px;">
<p style="margin:0 0 12px;font-size:13px;font-weight:700;color:{E_TEAL};text-transform:uppercase;letter-spacing:0.05em;">Loyalty rewards</p>
<p style="margin:0 0 6px;font-size:15px;color:{E_SLATE_DK};"><strong>Points earned this visit:</strong>
<span style="font-size:18px;font-weight:800;color:{E_TEAL};">{pts_display}</span></p>
<p style="margin:0 0 12px;font-size:15px;color:{E_SLATE_DK};"><strong>Your balance now:</strong>
<span style="font-size:18px;font-weight:800;color:{E_TEAL_DK};">{bal_display}</span> points</p>
<p style="margin:0;font-size:12px;line-height:1.5;color:{E_SLATE};">{escape(earn_rule)}</p>
</td></tr>
</table>
<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:{E_SLATE};">Questions about your visit? Reply to this email — we are happy to help.</p>
<p style="margin:16px 0 0;font-size:14px;color:{E_TEAL_DK};font-weight:600;">— Heigen Studio</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""

    return subject, plain, html


def send_booking_receipt_email(booking: Booking) -> bool:
    """
    Thank-you + receipt after booking marked complete (BOOKED). Uses SMTP like confirmation.
    """
    if not booking.customer_id:
        return False
    customer = Customer.objects.only("email", "full_name", "loyalty_points").get(
        pk=booking.customer_id
    )
    email_addr = (customer.email or "").strip()
    if not email_addr:
        return False

    subject, plain_body, html_body = build_booking_receipt_email(booking, customer)
    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", None) or "webmaster@localhost"

    try:
        send_mail(
            subject,
            plain_body,
            from_email,
            [email_addr],
            fail_silently=False,
            html_message=html_body,
        )
        return True
    except Exception:
        logger.exception(
            "Booking receipt email failed booking_id=%s to=%s",
            booking.pk,
            email_addr,
        )
        return False


def notify_booking_completed_email(
    booking_pk: int, previous_status: str | None
) -> None:
    """
    When status moves to BOOKED (Done), send receipt + loyalty summary once per transition.
    previous_status is session_status before the change (None on create).
    """
    prev = (previous_status or "").strip().upper()
    if prev == "BOOKED":
        return
    booking = (
        Booking.objects.select_related("customer", "package", "coupon")
        .prefetch_related("bookingaddon_set__addon")
        .filter(pk=booking_pk)
        .first()
    )
    if not booking or (booking.session_status or "").strip().upper() != "BOOKED":
        return
    send_booking_receipt_email(booking)


def send_booking_confirmation_email(booking: Booking) -> bool:
    """
    Send confirmation to customer.email using configured SMTP (multipart HTML + plain).
    Returns True if send attempted and succeeded; False if skipped or failed.
    """
    email = (booking.customer.email or "").strip() if booking.customer else ""
    if not email:
        return False

    subject, plain_body, html_body = build_booking_confirmation_email(booking)
    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", None) or "webmaster@localhost"

    try:
        send_mail(
            subject,
            plain_body,
            from_email,
            [email],
            fail_silently=False,
            html_message=html_body,
        )
        return True
    except Exception:
        logger.exception(
            "Booking confirmation email failed booking_id=%s to=%s",
            booking.pk,
            email,
        )
        return False


def build_test_branding_email() -> tuple[str, str, str]:
    """Minimal HTML to verify logo card + SMTP (same logo treatment as booking emails)."""
    subject = "Heigen Studio — email rendering test"
    plain = (
        "Heigen email test.\n"
        "HTML uses electron-app light theme (main.css). Logo sits on dark teal header only (no cream card)."
    )
    card = _html_email_header_logo()
    html = f"""\
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:{E_PAGE_BG};font-family:{E_FONT};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:20px 12px;background:{E_PAGE_BG};">
<tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:{E_SURFACE};border-radius:12px;overflow:hidden;box-shadow:{E_SHADOW_CARD};">
<tr><td style="background:{E_HEADER_GRADIENT};padding:28px 20px;text-align:center;">
{card}
<p style="margin:18px 0 0;font-family:{E_FONT};font-size:15px;color:rgba(255,255,255,0.95);">Theme palette test (electron light shell)</p>
</td></tr>
<tr><td style="padding:22px 24px;font-family:{E_FONT};font-size:14px;color:{E_TEXT_BODY};line-height:1.5;">
<p style="margin:0;">Background matches staff page gradient (#b4ccd4 → #9bb5bc → #89a8b4). Header matches hero teal gradient (#1a6578 → #165166 → #0f3d4d).</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""
    return subject, plain, html


def send_test_branding_email(to_email: str) -> bool:
    subject, plain, html = build_test_branding_email()
    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", None) or "webmaster@localhost"
    addr = (to_email or "").strip()
    if not addr:
        return False
    try:
        send_mail(
            subject,
            plain,
            from_email,
            [addr],
            fail_silently=False,
            html_message=html,
        )
        return True
    except Exception:
        logger.exception("send_test_branding_email failed to=%s", addr)
        return False
