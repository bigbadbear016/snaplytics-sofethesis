"""Groq-backed helpers for ADMIN/OWNER: business insights and coupon email drafts.

Only aggregate numbers and coupon terms are sent to Groq: never customer names,
emails, or phone numbers.
"""

import json
import random
import re
import time
from string import Template
from datetime import timedelta
from functools import lru_cache
from pathlib import Path

from backend.groq_client import GroqUnavailable, chat_json
from backend.models import (
    Addon,
    Booking,
    BookingAddon,
    Category,
    Coupon,
    CouponSent,
    CouponUsage,
    Customer,
    Package,
)
from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, Max, Q, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone
from django.utils.html import escape
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from ._common import (
    ACCEPTED_BOOKING_STATUSES,
    _get_request_sender_label,
    _get_request_user,
    _is_admin_or_owner_user,
    _write_action_log,
    logger,
)
from .catalog import CATALOG_VERSION_KEY
from .dashboard import dashboard_analytics

MAX_PROMPT_CHARS = 500
AI_UNAVAILABLE = {"detail": "AI unavailable"}

# shortcut: regex sanitizer, upgrade to bleach if HTML is ever rendered unsandboxed.
_SCRIPT_RE = re.compile(r"<script\b[^>]*>.*?</script\s*>", re.IGNORECASE | re.DOTALL)
_EVENT_ATTR_RE = re.compile(r"\s+on[a-z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.IGNORECASE)
_JS_URL_RE = re.compile(r"javascript\s*:", re.IGNORECASE)


# One is picked at random per draft so repeated drafts don't look the same.
COUPON_LAYOUTS = {
    "hero-ticket": (
        "1) HERO BAND under the header: full-width cell, solid theme bgcolor plus "
        "background-image: linear-gradient(135deg, theme1, theme2); centered small uppercase "
        "letter-spaced eyebrow (e.g. 'HALLOWEEN SPECIAL'), the discount as a huge number "
        "(48-56px, weight 800, e.g. '20% OFF'), a 2-4 emoji row, and a one-line tagline in white.\n"
        "2) Body: a 22px headline and 2 short, lively sentences.\n"
        "3) TICKET COUPON: 2-cell table, rounded: left cell (35%, theme bgcolor, white) shows "
        "the discount stacked ('20%' big over 'OFF' small); right cell (light tint bgcolor, "
        "border-left 2px dashed as a perforation) shows a small uppercase label and {{code}} "
        "in 24px bold letter-spaced text.\n"
        "4) CTA button in a theme color, 8px radius, padding 14px 32px."
    ),
    "polaroid": (
        "Photo-studio POLAROID look.\n"
        "1) Under the header, a soft theme-tint section (padding 32px) holding a 'polaroid' "
        "card: white cell, padding 16px 16px 48px, box-shadow 0 8px 24px rgba(0,0,0,.12), "
        "rotated feel faked with a thin 1px border. Inside the photo area: a 200px-tall cell "
        "with a theme linear-gradient and a big centered emoji scene (3-4 large emoji, 48px). "
        "Below the photo, a handwritten-style caption in Georgia italic 18px (e.g. 'Spooky "
        "season, captured.').\n"
        "2) A circular discount badge (120px, border-radius 50%, theme bgcolor, white, centered "
        "text: discount 30px bold over 'OFF' 12px) centered below the polaroid, overlapping "
        "visually via negative-free spacing (just place it right under).\n"
        "3) Body: Georgia serif 24px headline, 2 warm sentences in the sans stack.\n"
        "4) STAMP-style code box: centered inline-block, border 3px double theme color, "
        "padding 12px 28px, 'YOUR CODE' tiny label above {{code}} in 26px bold monospace.\n"
        "5) Pill CTA button (border-radius 999px) in the theme color."
    ),
    "receipt": (
        "Bold typographic RECEIPT look.\n"
        "1) Under the header, a dark block (theme dark color bgcolor, padding 36px 32px), "
        "LEFT-aligned: eyebrow in the theme accent color, then the discount in a giant 64px "
        "weight-900 line, then a short white tagline. Below it, a 6px full-width stripe in the "
        "accent color.\n"
        "2) Body: 22px headline and 2 punchy sentences.\n"
        "3) RECEIPT box: light cream bgcolor (#fffaf0), border-top and border-bottom 2px dashed "
        "#c9c2b4, monospace font ('Courier New', monospace), padding 20px 24px. A centered "
        "'*** HEIGEN STUDIO RECEIPT ***' line, then rows as a 2-column table with dotted "
        "bottom borders: 'ITEM' / 'Photo session', 'DISCOUNT' / the discount, 'CODE' / "
        "{{code}} (bold, accent color, 20px), and 'VALID UNTIL' / the date only if expires_at is "
        "set. End with a centered 'THANK YOU!' line.\n"
        "4) Full-width CTA button (100% width cell) in the accent color, square corners."
    ),
    # Rendered from a fixed server template; the AI only supplies theme colors and copy.
    "gift-card": None,
}


def _forbidden():
    return Response(
        {"detail": "Only ADMIN or OWNER can use AI features."},
        status=status.HTTP_403_FORBIDDEN,
    )


@lru_cache(maxsize=1)
def _coupon_reference_html():
    """The studio's hand-made coupon email; the AI restyles copy but keeps this design."""
    path = Path(__file__).resolve().parents[2] / "backend" / "email_refs" / "coupon_reference.html"
    return path.read_text(encoding="utf-8")


_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _discount_text(coupon):
    value = coupon.discount_value
    shown = f"{value:g}" if coupon.discount_type == Coupon.DISCOUNT_PERCENT else f"{value:,.0f}"
    return f"{shown}% OFF" if coupon.discount_type == Coupon.DISCOUNT_PERCENT else f"₱{shown} OFF"


def _render_gift_card(coupon, fields):
    """Fill the gift-card template; only colors and short copy come from the AI."""
    def color(key, default):
        value = str(fields.get(key) or "").strip()
        return value if _HEX_RE.match(value) else default

    def text(key, default, limit):
        return escape(str(fields.get(key) or default).strip()[:limit])

    expiry = ""
    if coupon.expires_at:
        expiry = (
            '<p style="margin: 0; font-size: 12px; color: #6c8a96;">Valid until '
            f'{coupon.expires_at:%B} {coupon.expires_at.day}, {coupon.expires_at.year}</p>'
        )
    path = Path(__file__).resolve().parents[2] / "backend" / "email_refs" / "coupon_gift_card.html"
    return Template(path.read_text(encoding="utf-8")).safe_substitute(
        dark=color("dark", "#0f2e3a"),
        mid=color("mid", "#244855"),
        emoji=text("emoji", "🎁", 8),
        headline=text("headline", "A gift for your next session", 80),
        subline=text("subline", "A little something from all of us at Heigen Studio.", 120),
        body=text("body", "Use this gift on your next photo session with us.", 260),
        cta=text("cta", "Book Your Next Session", 40),
        discount=escape(_discount_text(coupon)),
        expiry=expiry,
    )


def _clean_html(html):
    # The model sometimes double-escapes quotes (style=\"...\"), which breaks every attribute.
    html = (html or "").replace('\\"', '"').replace("\\n", "\n")
    html = _SCRIPT_RE.sub("", html)
    html = _EVENT_ATTR_RE.sub("", html)
    return _JS_URL_RE.sub("", html)


@api_view(["GET"])
def ai_owner_insights(request):
    """
    GET /api/ai/insights/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

    Returns {"insights": [{"title", "detail", "action"}, ...]} or 503 when Groq is unavailable.
    """
    if not _is_admin_or_owner_user(_get_request_user(request)):
        return _forbidden()

    # Reuse the dashboard aggregates (same date filters) so numbers match the charts.
    analytics = dashboard_analytics(request._request)
    if analytics.status_code != 200:
        return Response(analytics.data, status=analytics.status_code)
    now = timezone.now()
    stats = dict(analytics.data)
    stats["coupons"] = {
        "active": Coupon.objects.filter(deleted_at__isnull=True)
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
        .count(),
        "redemptions_last_90_days": CouponUsage.objects.filter(
            used_at__gte=now - timedelta(days=90)
        ).count(),
    }
    for ds in stats.get("package_popularity", {}).get("datasets", []):
        ds.pop("backgroundColor", None)  # chart styling, not useful to the model

    system = (
        "You are a business advisor for a small photo studio in the Philippines. "
        "Currency is Philippine peso (PHP). Given aggregate analytics as JSON, give the owner "
        "practical, specific ideas to grow bookings and revenue (promotions, coupons, packages, "
        "timing, retention of customers unlikely to renew). Base every point on the numbers. "
        'Reply only with JSON: {"insights":[{"title":str,"detail":str,"action":str}]} '
        "with at most 5 items. Keep each detail under 60 words."
    )
    try:
        result = chat_json(system, json.dumps(stats, default=str))
    except GroqUnavailable as exc:
        logger.warning("AI insights unavailable: %s", exc)
        return Response(AI_UNAVAILABLE, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    insights = [
        {
            "title": str(item.get("title", "")),
            "detail": str(item.get("detail", "")),
            "action": str(item.get("action", "")),
        }
        for item in (result.get("insights") or [])[:5]
        if isinstance(item, dict)
    ]
    return Response({"insights": insights}, status=status.HTTP_200_OK)


@api_view(["POST"])
def ai_coupon_html(request):
    """
    POST /api/ai/coupon-html/  {"coupon_id": int, "prompt": str}

    Returns {"subject": str, "html_body": str}. The HTML keeps the {{code}} token,
    which the send-email action replaces with the real code.
    """
    if not _is_admin_or_owner_user(_get_request_user(request)):
        return _forbidden()

    prompt = str(request.data.get("prompt") or "").strip()
    if len(prompt) > MAX_PROMPT_CHARS:
        return Response(
            {"detail": f"prompt must be {MAX_PROMPT_CHARS} characters or fewer"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    coupon_id = str(request.data.get("coupon_id") or "")
    coupon = None
    if coupon_id.isdigit():
        coupon = Coupon.objects.filter(pk=int(coupon_id), deleted_at__isnull=True).first()
    if coupon is None:
        return Response({"detail": "coupon not found"}, status=status.HTTP_404_NOT_FOUND)

    terms = {
        "discount_type": coupon.discount_type,
        "discount_value": coupon.discount_value,
        "max_discount_amount_php": coupon.max_discount_amount,
        "expires_at": coupon.expires_at.date().isoformat() if coupon.expires_at else None,
    }
    layout_name = request.data.get("layout")
    if layout_name not in COUPON_LAYOUTS:
        layout_name = random.choice(list(COUPON_LAYOUTS))
    layout = COUPON_LAYOUTS[layout_name]
    if layout is None:
        return _ai_gift_card(coupon, terms, prompt)
    system = (
        "You are a senior email designer for Heigen Studio, a photo studio in the Philippines "
        "(write amounts like ₱200). Below is the studio's base coupon email (brand reference). "
        "Design a BOLDER, themed version of it; it must look clearly different from the base.\n"
        "Keep from the base: the 'HEIGEN STUDIO' header bar (#244855), outer gray background, "
        "560px rounded white card, font stacks, 'Hi there,' greeting, CTA link "
        "https://www.facebook.com/heigenstudio, sign-off and footer.\n"
        "Theme: pick a 2-3 color palette that fits the owner's request (e.g. Halloween: pumpkin "
        "orange #ff7518, deep purple #2d1b4e; Christmas: red #c0392b, pine #1e5631, gold "
        "#d4af37; Valentine: rose #e84a6f, blush #fde2e7; summer: coral #ff6b5b, sunny "
        "#ffd166, sea #118ab2). With no theme, use teal #244855, sky #9bc4d1 and warm "
        "sand #f4e3c3.\n"
        "LAYOUT (follow it closely; it decides how the email looks):\n" + layout + "\n"
        "In every layout: the CTA is a bulletproof button (table cell with bgcolor, bold white "
        "text) linking to the Facebook URL; if expires_at is set, show that date in small muted "
        "text; if null, no date or deadline anywhere; end with the sign-off and footer.\n"
        "Never invent dates, prices, or offers not in the coupon terms. "
        "Inline CSS only; no <script>, <style>, <link>, forms, or images. Keep the literal "
        "placeholder {{code}} (never invent a code). Never use customer names.\n"
        'Reply only with JSON: {"subject":str,"html_body":str}. html_body starts with the outer '
        "<table>. Subject: catchy, under 60 characters, one emoji allowed.\n\n"
        "REFERENCE DESIGN:\n" + _coupon_reference_html()
    )
    user = json.dumps(
        {"coupon": terms, "owner_request": prompt or "A general promo email."},
        ensure_ascii=False,
    )
    try:
        result = chat_json(system, user, max_tokens=4000)
    except GroqUnavailable as exc:
        logger.warning("AI coupon HTML unavailable: %s", exc)
        return Response(AI_UNAVAILABLE, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    html_body = _clean_html(str(result.get("html_body") or ""))
    if not html_body.strip():
        return Response(AI_UNAVAILABLE, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response(
        {
            "subject": str(result.get("subject") or "")[:200],
            "html_body": html_body,
            "layout": layout_name,
        },
        status=status.HTTP_200_OK,
    )


def _ai_gift_card(coupon, terms, prompt):
    system = (
        "You write copy and pick colors for a gift-card coupon email from Heigen Studio, a "
        "photo studio in the Philippines. Fit the owner's request and theme. Colors: DARK and "
        "MID are deep, saturated hex colors (white text must be readable on both; never pastel "
        "or near-white), e.g. Valentine #8e1b3a/#e84a6f, Halloween #2d1b4e/#ff7518, Christmas "
        "#1e5631/#c0392b, summer #0b6e8a/#ff6b5b, default #0f2e3a/#244855. "
        "Never mention dates, prices, or discounts (they are added separately) and never use "
        "customer names.\n"
        'Reply only with JSON: {"subject":str (catchy, under 60 chars, one emoji allowed), '
        '"headline":str (under 45 chars), "subline":str (under 70 chars), '
        '"body":str (2 short warm sentences), "cta":str (booking button label starting with Book, under 28 chars), '
        '"emoji":str (one emoji), "dark":"#rrggbb", "mid":"#rrggbb"}'
    )
    user = json.dumps(
        {"coupon": terms, "owner_request": prompt or "A general promo email."},
        ensure_ascii=False,
    )
    try:
        fields = chat_json(system, user, max_tokens=1500)
    except GroqUnavailable as exc:
        logger.warning("AI coupon HTML unavailable: %s", exc)
        return Response(AI_UNAVAILABLE, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response(
        {
            "subject": str(fields.get("subject") or "")[:200],
            "html_body": _render_gift_card(coupon, fields),
            "layout": "gift-card",
        },
        status=status.HTTP_200_OK,
    )


# Groq free tier caps a request at 8k tokens (prompt + reply), so context stays compact.
MAX_CHAT_TURNS = 8
MAX_CHAT_CHARS = 1500


def _catalog_context():
    """Active catalog plus 12-month booking stats. Aggregates only; no customer data."""
    since = timezone.now() - timedelta(days=365)
    accepted = Q(
        booking__session_status__in=ACCEPTED_BOOKING_STATUSES,
        booking__loyalty_claim=False,
        booking__session_date__gte=since,
    )
    packages = (
        Package.objects.filter(deleted_at__isnull=True, is_archived=False)
        .annotate(bookings_12m=Count("booking", filter=accepted))
        .order_by("category", "price")
    )
    addons = Addon.objects.filter(deleted_at__isnull=True).annotate(
        qty_12m=Sum(
            "bookingaddon__addon_quantity",
            filter=Q(
                bookingaddon__booking__session_status__in=ACCEPTED_BOOKING_STATUSES,
                bookingaddon__booking__session_date__gte=since,
            ),
        )
    )
    pairs = (
        BookingAddon.objects.filter(
            booking__session_status__in=ACCEPTED_BOOKING_STATUSES,
            booking__session_date__gte=since,
            booking__package__isnull=False,
        )
        .values("booking__package_id", "addon__name")
        .annotate(qty=Sum("addon_quantity"))
        .order_by("booking__package_id", "-qty")
    )
    top_addons = {}
    for row in pairs:
        names = top_addons.setdefault(row["booking__package_id"], [])
        if len(names) < 3:
            names.append(row["addon__name"])
    return {
        "categories": list(
            Category.objects.filter(deleted_at__isnull=True).values_list("name", flat=True)
        ),
        "packages": [
            {
                "category": p.category,
                "name": p.name,
                "price": p.price,
                "promo_price": p.promo_price,
                "max_people": p.max_people,
                "inclusions": p.inclusions,
                "freebies": p.freebies,
                "bookings_12m": p.bookings_12m,
                "top_addons": top_addons.get(p.pk, []),
            }
            for p in packages
        ],
        "archived_packages": [
            f"{c} / {n}"
            for c, n in Package.objects.filter(deleted_at__isnull=True, is_archived=True)
            .values_list("category", "name")
        ],
        "addons": [
            {
                "name": a.name,
                "price": a.price,
                "applies_to": a.applies_to,
                "qty_12m": a.qty_12m or 0,
            }
            for a in addons
        ],
    }


def _compact(value):
    """Drop null/empty fields to keep the prompt small."""
    if isinstance(value, dict):
        return {k: _compact(v) for k, v in value.items() if v not in (None, "", [], {})}
    if isinstance(value, list):
        return [_compact(v) for v in value]
    return value


def _str_list(value, limit=12):
    if not isinstance(value, list):
        return []
    return [str(v).strip()[:200] for v in value if str(v).strip()][:limit]


def _clean_package_draft(draft, categories):
    """Validate the model's package idea into fields PackageSerializer accepts."""
    if not isinstance(draft, dict) or not str(draft.get("name") or "").strip():
        return None
    try:
        price = round(float(draft.get("price")), 2)
    except (TypeError, ValueError):
        return None
    if price <= 0:
        return None
    try:
        max_people = int(draft["max_people"]) if draft.get("max_people") else None
    except (TypeError, ValueError):
        max_people = None
    category = " ".join(str(draft.get("category") or "").split())[:60]
    existing = {c.lower(): c for c in categories}
    if not category:
        category = existing.get("regular") or (categories[0] if categories else "General")
    # Match existing names case-insensitively; anything else is a new category that the
    # package create endpoint adds automatically (_ensure_category_exists).
    category = existing.get(category.lower(), category)
    return {
        "category": category,
        "new_category": category.lower() not in existing,
        "name": str(draft["name"]).strip()[:120],
        "price": price,
        "max_people": max_people,
        "inclusions": _str_list(draft.get("inclusions")),
        "freebies": _str_list(draft.get("freebies"), 6),
        "notes": str(draft.get("notes") or "").strip()[:500],
        "suggested_addons": _str_list(draft.get("suggested_addons"), 5),
    }


def _brief_catalog(catalog):
    """Catalog without inclusions/add-on details, for pages that only need an overview."""
    return {
        "categories": catalog["categories"],
        "packages": [
            {k: p[k] for k in ("category", "name", "price", "bookings_12m")}
            for p in catalog["packages"]
        ],
        "addons": [{k: a[k] for k in ("name", "price", "qty_12m")} for a in catalog["addons"]],
    }


def _coupon_usage():
    used = {
        r["coupon_id"]: r
        for r in CouponUsage.objects.values("coupon_id").annotate(
            used=Count("id"), discount_given=Sum("discount_amount")
        )
    }
    sent = dict(
        CouponSent.objects.values("coupon_id").annotate(n=Count("id")).values_list("coupon_id", "n")
    )
    return used, sent


def _dashboard_context(catalog):
    now = timezone.now()
    monthly = (
        Booking.objects.filter(
            session_status__in=ACCEPTED_BOOKING_STATUSES,
            loyalty_claim=False,
            session_date__gte=now - timedelta(days=365),
        )
        .annotate(month=TruncMonth("session_date"))
        .values("month")
        .annotate(bookings=Count("id"), revenue=Sum("total_price"))
        .order_by("month")
    )
    used, _ = _coupon_usage()
    recent = CouponUsage.objects.filter(used_at__gte=now - timedelta(days=90)).aggregate(
        n=Count("id"), total=Sum("discount_amount")
    )
    return {
        "today": now.date().isoformat(),
        "monthly_12m": [
            {"month": r["month"].strftime("%Y-%m"), "bookings": r["bookings"],
             "revenue": round(r["revenue"] or 0)}
            for r in monthly if r["month"]
        ],
        "top_packages_12m": sorted(
            _brief_catalog(catalog)["packages"], key=lambda p: -p["bookings_12m"]
        )[:8],
        "coupons": {
            "active": Coupon.objects.filter(deleted_at__isnull=True)
            .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
            .count(),
            "redemptions_90d": recent["n"],
            "discount_given_90d": round(recent["total"] or 0),
            "redemptions_all_time": sum(r["used"] for r in used.values()),
        },
    }


def _coupons_context(catalog):
    now = timezone.now()
    used, sent = _coupon_usage()
    return {
        "today": now.date().isoformat(),
        "coupons": [
            {
                "code": c.code,
                "type": c.discount_type,
                "value": c.discount_value,
                "max_discount": c.max_discount_amount,
                "use_limit": c.use_limit,
                "per_customer_limit": c.per_customer_limit,
                "expires": c.expires_at.date().isoformat() if c.expires_at else None,
                "expired": bool(c.expires_at and c.expires_at <= now),
                "sent_to": sent.get(c.pk, 0),
                "used": used.get(c.pk, {}).get("used", 0),
                "discount_given": round(used.get(c.pk, {}).get("discount_given") or 0),
            }
            for c in Coupon.objects.filter(deleted_at__isnull=True).order_by("-created_at")[:40]
        ],
        "catalog": _brief_catalog(catalog),
    }


def _customers_context(catalog):
    """Customer base for the AI: totals plus rows keyed by customer_id only.

    Never sends name, email, phone, Instagram, or consent text; the owner looks up an ID
    on Customer Data to see who it is.
    """
    now = timezone.now()
    paid = Q(bookings__session_status__in=ACCEPTED_BOOKING_STATUSES, bookings__loyalty_claim=False)
    rows = list(
        Customer.objects.filter(deleted_at__isnull=True)
        .annotate(
            n_bookings=Count("bookings", filter=paid),
            spent=Sum("bookings__total_price", filter=paid),
            last_session=Max("bookings__session_date", filter=paid),
        )
        .values(
            "customer_id", "acquisition_source", "loyalty_points", "created_at",
            "n_bookings", "spent", "last_session",
        )
    )

    def days_since(r):
        return (now - r["last_session"]).days if r["last_session"] else None

    def row(r):
        return {
            "id": r["customer_id"],
            "bookings": r["n_bookings"],
            "spent": round(r["spent"] or 0),
            "last_session": r["last_session"].date().isoformat() if r["last_session"] else None,
            "days_since_last": days_since(r),
            "loyalty_points": float(r["loyalty_points"] or 0),
            "source": r["acquisition_source"],
        }

    recency = {"0-90d": 0, "91-180d": 0, "181-365d": 0, "over_365d": 0, "never_booked": 0}
    for r in rows:
        d = days_since(r)
        key = ("never_booked" if d is None else "0-90d" if d <= 90 else "91-180d" if d <= 180
               else "181-365d" if d <= 365 else "over_365d")
        recency[key] += 1
    sources = {}
    for r in rows:
        src = (r["acquisition_source"] or "unknown").strip() or "unknown"
        sources[src] = sources.get(src, 0) + 1
    new_by_month = {}
    for r in rows:
        if r["created_at"] and r["created_at"] >= now - timedelta(days=365):
            m = r["created_at"].strftime("%Y-%m")
            new_by_month[m] = new_by_month.get(m, 0) + 1
    by_spend = sorted((r for r in rows if r["n_bookings"]), key=lambda r: -(r["spent"] or 0))
    booked = sum(1 for r in rows if r["n_bookings"])
    return {
        "today": now.date().isoformat(),
        "customers": len(rows),
        "booked_at_least_once": booked,
        "repeat_customers": sum(1 for r in rows if r["n_bookings"] >= 2),
        "bookings_per_customer": {
            "0": len(rows) - booked,
            "1": sum(1 for r in rows if r["n_bookings"] == 1),
            "2": sum(1 for r in rows if r["n_bookings"] == 2),
            "3+": sum(1 for r in rows if r["n_bookings"] >= 3),
        },
        "last_session_recency": recency,
        "acquisition_sources": dict(sorted(sources.items(), key=lambda kv: -kv[1])[:10]),
        "new_customers_by_month_12m": dict(sorted(new_by_month.items())),
        "with_loyalty_points": sum(1 for r in rows if (r["loyalty_points"] or 0) > 0),
        "top_spenders": [row(r) for r in by_spend[:20]],
        "lapsed_high_value": [row(r) for r in by_spend if (days_since(r) or 0) > 180][:15],
        "catalog": _brief_catalog(catalog),
    }


# Each staff page sends only its own data: Groq's free tier allows ~8k tokens per request.
CHAT_PAGES = {
    "packages": (
        "The owner is on the Packages page. Focus on packages and add-ons: explain or compare "
        "packages, suggest add-on pairings, spot weak or missing offers, and design new packages.",
        lambda catalog: catalog,
    ),
    "dashboard": (
        "The owner is on the Dashboard. Focus on business performance: booking and revenue "
        "trends, best and worst sellers, seasonality, and concrete next steps to grow.",
        _dashboard_context,
    ),
    "coupons": (
        "The owner is on the Coupons page. Focus on promotions: which coupons work (sent vs "
        "used), which to retire or extend, and new coupon ideas (type, value, limits, timing, "
        "which packages to target) with reasons.",
        _coupons_context,
    ),
    "customers": (
        "The owner is on the Customer Data page. Focus on the customer base: retention, repeat "
        "rate, lapsed high-value customers to win back, acquisition sources, and loyalty. "
        "Customers are identified only by numeric id (no names or contact details are shared); "
        "refer to them as 'customer #id' and never invent names or contact details.",
        _customers_context,
    ),
}


@api_view(["POST"])
def ai_package_chat(request):
    """
    POST /api/ai/package-chat/  {"page": "packages"|"dashboard"|"coupons"|"customers",
                                 "messages": [{"role": "user"|"assistant", "content": str}, ...]}

    The last message must be from the user. Returns {"reply": str, "package_draft": {...}|null}.
    """
    if not _is_admin_or_owner_user(_get_request_user(request)):
        return _forbidden()

    messages = request.data.get("messages")
    if not isinstance(messages, list) or not messages:
        return Response({"detail": "messages is required"}, status=status.HTTP_400_BAD_REQUEST)
    turns = []
    for m in messages[-MAX_CHAT_TURNS:]:
        role = m.get("role") if isinstance(m, dict) else None
        content = str(m.get("content") or "").strip() if isinstance(m, dict) else ""
        if role not in ("user", "assistant") or not content or len(content) > MAX_CHAT_CHARS:
            return Response(
                {"detail": f"each message needs role user/assistant and 1-{MAX_CHAT_CHARS} chars"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        turns.append({"role": role, "content": content})
    if turns[-1]["role"] != "user":
        return Response(
            {"detail": "last message must be from the user"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    page = request.data.get("page")
    focus, build_context = CHAT_PAGES.get(page) or CHAT_PAGES["packages"]
    catalog = _catalog_context()
    system = (
        "You are the business assistant for Heigen Studio, a photo studio in the Philippines "
        "(PHP; write prices like ₱1,299). " + focus + " You can also answer general questions "
        "about the studio's packages, add-ons, coupons, and bookings from the data below; if "
        "the data does not cover a question, say so instead of guessing. Base advice on the "
        "data and cite the numbers when useful. Price new packages in line with "
        "similar existing ones and say why. Be concise and practical; plain text, short "
        "paragraphs or '-' bullets, no markdown headings, bold, or tables.\n"
        "When (and only when) the owner asks you to create, generate, or design a package, also "
        "return package_draft; otherwise package_draft is null. A draft uses an existing "
        "category name from the catalog, unless the owner asks for a new category (e.g. "
        "'create a Barkada category'): then use that new name (short, Title Case) and make the "
        "draft an example starter package for it. Never reuse a package name that already "
        "exists in the same category. Inclusions/freebies are short phrases in the "
        "same style as existing packages.\n"
        'Reply only with JSON: {"reply": str, "package_draft": null | {"category": str, '
        '"name": str, "price": number, "max_people": int|null, "inclusions": [str], '
        '"freebies": [str], "notes": str, "suggested_addons": [existing add-on names]}}\n\n'
        "DATA:\n"
        + json.dumps(
            _compact(build_context(catalog)), ensure_ascii=False, separators=(",", ":"), default=str
        )
    )
    try:
        result = chat_json(system, turns[-1]["content"], max_tokens=2000, history=turns[:-1])
    except GroqUnavailable as exc:
        logger.warning("AI package chat unavailable: %s", exc)
        return Response(AI_UNAVAILABLE, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    reply = str(result.get("reply") or "").strip()
    if not reply:
        return Response(AI_UNAVAILABLE, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response(
        {
            "reply": reply[:4000],
            "package_draft": _with_conflict(
                _clean_package_draft(result.get("package_draft"), catalog["categories"])
            ),
        },
        status=status.HTTP_200_OK,
    )


def _draft_conflict(draft):
    """Why this draft can't be created as-is, or None. Same name in another category is fine."""
    live_category = Category.objects.filter(
        name__iexact=draft["category"], deleted_at__isnull=True
    ).first()
    if live_category is None and Category.objects.filter(
        name__iexact=draft["category"], deleted_at__isnull=False
    ).exists():
        return (
            f'A category named "{draft["category"]}" is in the Recycle Bin. Restore it from '
            "Internal Records, or use a different category name."
        )
    clash = Package.objects.filter(
        name__iexact=draft["name"], category__iexact=draft["category"], deleted_at__isnull=True
    ).first()
    if clash:
        where = "archived" if clash.is_archived else "live"
        return (
            f'"{clash.name}" already exists in {clash.category} ({where}). '
            "Rename the package before creating it."
        )
    return None


def _with_conflict(draft):
    if draft:
        draft["conflict"] = _draft_conflict(draft)
    return draft


@api_view(["POST"])
def ai_package_create(request):
    """
    POST /api/ai/package-create/  {"draft": {...package_draft, possibly edited by the owner}}

    Creates the package archived (and its category archived, if new) so nothing reaches the
    kiosk until the owner restores it. 409 with a message on a name/category conflict.
    """
    if not _is_admin_or_owner_user(_get_request_user(request)):
        return _forbidden()
    categories = list(
        Category.objects.filter(deleted_at__isnull=True).values_list("name", flat=True)
    )
    draft = _clean_package_draft(request.data.get("draft"), categories)
    if draft is None:
        return Response(
            {"detail": "The draft needs a name and a price above 0."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    with transaction.atomic():
        conflict = _draft_conflict(draft)
        if conflict:
            return Response({"detail": conflict}, status=status.HTTP_409_CONFLICT)
        category_created = draft["new_category"]
        if category_created:
            Category.objects.create(name=draft["category"], is_archived=True)
        package = Package.objects.create(
            category=draft["category"],
            name=draft["name"],
            price=draft["price"],
            max_people=draft["max_people"],
            inclusions=draft["inclusions"],
            freebies=draft["freebies"],
            notes=draft["notes"] or None,
            is_archived=True,
        )
    cache.set(CATALOG_VERSION_KEY, time.time_ns(), None)  # refresh cached catalog lists
    _write_action_log(
        request,
        "package_created",
        f"{_get_request_sender_label(request)} created package {package.name} (AI draft, archived)",
        metadata={
            "package_id": package.id,
            "name": package.name,
            "category": package.category,
            "price": package.price,
            "category_created": category_created,
        },
    )
    return Response(
        {"package_id": package.id, "category": package.category, "category_created": category_created},
        status=status.HTTP_201_CREATED,
    )
