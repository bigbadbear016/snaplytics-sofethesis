"""Shared constants and helpers used by several view modules."""

import hashlib
import logging
import re
from datetime import datetime

from backend.models import ActionLog, Coupon, StaffProfile
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from rest_framework.authtoken.models import Token


logger = logging.getLogger(__name__)
ACCEPTED_BOOKING_STATUSES = ("Ongoing", "BOOKED")
USERNAME_PLACEHOLDER_PREFIX = "staffuser_"
VISIBLE_CUSTOMER_BOOKING_FILTER = (
    Q(bookings__session_status="BOOKED")
    | Q(bookings__session_status__isnull=True)
    | Q(bookings__session_status="")
)


def _snapshot_customer_editable_fields(customer):
    """Fields written by CustomerWriteSerializer — used for action-log diffs."""
    return {
        "name": (customer.full_name or "").strip(),
        "email": (customer.email or "").strip(),
        "contact_number": (customer.contact_number or "").strip(),
        "consent": (customer.consent or "").strip(),
        "is_first_time": customer.is_first_time,
        "acquisition_source": (customer.acquisition_source or "").strip(),
    }


def _customer_editable_field_changes(before, after):
    return [k for k in before if before[k] != after[k]]


def _format_customer_updated_action_text(actor_name, customer, changed_keys):
    customer_label = customer.full_name or f"#{customer.customer_id}"
    labels = {
        "name": "name",
        "email": "email",
        "contact_number": "contact",
        "consent": "consent",
        "is_first_time": "first-time",
        "acquisition_source": "acquisition source",
    }
    parts = [labels.get(k, k) for k in changed_keys]
    detail = ", ".join(parts) if parts else "profile"
    return f"{actor_name} updated customer {customer_label} ({detail})"


def _iso_booking_dt(dt):
    if dt is None:
        return None
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt.isoformat()


def _snapshot_booking_for_action_log(booking):
    """Serializable booking state for action-log diffs (matches serializer-driven edits)."""
    addons = []
    try:
        for ba in booking.bookingaddon_set.all():
            addons.append(
                {
                    "addon_id": ba.addon_id,
                    "quantity": int(ba.addon_quantity or 1),
                }
            )
    except Exception:
        pass
    addons.sort(key=lambda x: (x["addon_id"], x["quantity"]))
    tp = booking.total_price
    gp = booking.gcash_payment
    cp = booking.cash_payment
    return {
        "package_id": booking.package_id,
        "coupon_id": booking.coupon_id,
        "session_date": _iso_booking_dt(booking.session_date),
        "total_price": float(tp) if tp is not None else None,
        "session_status": booking.session_status or "",
        "discounts": booking.discounts or "",
        "gcash_payment": float(gp) if gp is not None else None,
        "cash_payment": float(cp) if cp is not None else None,
        "addons": addons,
    }


def _booking_snapshot_changes(before, after):
    return [k for k in before if before[k] != after[k]]


def _format_booking_updated_action_text(actor_name, booking, changed_keys):
    labels = {
        "package_id": "package",
        "coupon_id": "coupon",
        "session_date": "session date",
        "total_price": "total",
        "session_status": "status",
        "discounts": "discounts",
        "gcash_payment": "GCash",
        "cash_payment": "cash",
        "addons": "add-ons",
    }
    parts = [labels.get(k, k) for k in changed_keys]
    detail = ", ".join(parts) if parts else "details"
    cust = getattr(booking, "customer", None)
    cname = (cust.full_name or "").strip() if cust else ""
    suffix = f" for {cname}" if cname else ""
    return f"{actor_name} updated booking #{booking.pk}{suffix} ({detail})"


def _write_booking_updated_action_log(request, booking, before, after):
    changed = _booking_snapshot_changes(before, after)
    if not changed:
        return
    cid = getattr(booking, "customer_id", None)
    actor_name = _get_request_sender_label(request)
    _write_action_log(
        request,
        "booking_updated",
        _format_booking_updated_action_text(actor_name, booking, changed),
        metadata={
            "booking_id": booking.pk,
            "customer_id": cid,
            "changed_fields": changed,
            "previous": before,
            "current": after,
        },
    )


# AUTH / STAFF ONBOARDING
# ═══════════════════════════════════════════════════════════════════════════════


def _build_user_payload(user):
    name = f"{user.first_name} {user.last_name}".strip() or user.username
    if user.is_superuser:
        role = "OWNER"
    elif user.is_staff:
        role = "ADMIN"
    else:
        role = "STAFF"
    profile = StaffProfile.objects.filter(user=user).first()
    dev_mode = bool(profile.dev_mode) if profile else False
    return {
        "id": user.id,
        "name": name,
        "username": user.username,
        "email": user.email,
        "role": role,
        "dev_mode": dev_mode,
    }


def _get_profile(user):
    profile, _ = StaffProfile.objects.get_or_create(user=user)
    return profile


def _extract_token(request):
    auth = request.headers.get("Authorization", "").strip()
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    if auth.startswith("Token "):
        return auth[6:].strip()
    return None


def _get_request_user(request):
    user = getattr(request, "user", None)
    if user is not None and getattr(user, "is_authenticated", False):
        return user
    token_key = _extract_token(request)
    if not token_key:
        return None
    token = Token.objects.select_related("user").filter(key=token_key).first()
    return token.user if token is not None else None


def _get_request_sender_label(request):
    user = _get_request_user(request)
    if user is not None and getattr(user, "is_authenticated", False):
        profile = StaffProfile.objects.filter(user=user).first()
        nickname = (getattr(profile, "nickname", "") or "").strip() if profile else ""
        full_name = ""
        try:
            full_name = (user.get_full_name() or "").strip()
        except Exception:
            full_name = ""
        username = (getattr(user, "username", "") or "").strip()
        label_name = nickname or full_name or username or "Heigen User"
        return label_name
    return "Heigen Studio"


def _role_name_for_user(user):
    if not user:
        return ""
    if getattr(user, "is_superuser", False):
        return "OWNER"
    if getattr(user, "is_staff", False):
        return "ADMIN"
    return "STAFF"


def _is_dev_mode_user(user):
    if not user or not getattr(user, "is_authenticated", False):
        return False
    profile = StaffProfile.objects.filter(user=user).first()
    return bool(profile and getattr(profile, "dev_mode", False))


def _is_owner_or_dev_user(user):
    if not user:
        return False
    return bool(getattr(user, "is_superuser", False) or _is_dev_mode_user(user))


def _is_admin_or_owner_user(user):
    if not user:
        return False
    return bool(getattr(user, "is_superuser", False) or getattr(user, "is_staff", False))


def _is_staff_admin_or_owner_user(user):
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if _is_admin_or_owner_user(user):
        return True
    return StaffProfile.objects.filter(user=user).exists()


def _write_action_log(request, action_type, action_text, metadata=None):
    user = _get_request_user(request)
    actor_role = _role_name_for_user(user)
    merged_metadata = {"actor_role": actor_role}
    if metadata:
        merged_metadata.update(metadata)
    ActionLog.objects.create(
        actor_user=user if user and getattr(user, "is_authenticated", False) else None,
        actor_label=_get_request_sender_label(request),
        action_type=action_type,
        action_text=action_text,
        metadata=merged_metadata,
    )


def _now_iso():
    return datetime.now().isoformat()


def _file_sha256(path_obj):
    if not path_obj.exists():
        return None
    h = hashlib.sha256()
    with open(path_obj, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _build_model_metrics_response(
    base_dir,
    renewal_saved_path,
    renewal_engineered_path,
    recommender_path,
    renewal_saved,
    renewal_engineered,
    recommender_summary,
    recommender_details,
    error=None,
):
    payload = {
        "renewal": {
            "saved_model": renewal_saved,
            "engineered_baseline": renewal_engineered,
            "source_files": {
                "saved_model": str(renewal_saved_path.relative_to(base_dir)),
                "engineered_baseline": str(renewal_engineered_path.relative_to(base_dir)),
            },
        },
        "recommendation": {
            "summary": recommender_summary,
            "details": recommender_details,
            "source_files": {
                "evaluation_results": str(recommender_path.relative_to(base_dir)),
            },
        },
        "generated_at": _now_iso(),
    }
    if error is not None:
        payload["error"] = str(error)
    return payload


def _find_user_by_email_or_username(email_or_username):
    user_model = get_user_model()
    return (
        user_model.objects.filter(email__iexact=email_or_username).first()
        or user_model.objects.filter(username__iexact=email_or_username).first()
    )


def _is_placeholder_username(username):
    value = (username or "").strip().lower()
    return bool(value) and value.startswith(USERNAME_PLACEHOLDER_PREFIX)


def _sanitize_username_seed(value):
    cleaned = re.sub(r"[^a-z0-9_]+", "_", (value or "").strip().lower())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned


def _build_generated_username(email, first_name, last_name, user_model):
    seed = _sanitize_username_seed((email or "").split("@")[0])
    if not seed:
        seed = _sanitize_username_seed(f"{first_name}_{last_name}")
    if not seed:
        seed = "user"
    seed = seed[:20]
    suffix = 1
    while True:
        candidate = f"{USERNAME_PLACEHOLDER_PREFIX}{seed}{suffix}"
        if not user_model.objects.filter(username__iexact=candidate).exists():
            return candidate
        suffix += 1


def _coupon_discount_preview(coupon):
    preview = (
        f"{coupon.discount_value}% off"
        if coupon.discount_type == Coupon.DISCOUNT_PERCENT
        else f"₱{coupon.discount_value:,.0f} off"
    )
    if coupon.max_discount_amount:
        preview += f" (max ₱{coupon.max_discount_amount:,.0f})"
    return preview
