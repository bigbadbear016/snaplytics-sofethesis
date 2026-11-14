"""Internal Records listing and action logs."""

from backend.models import (
    ActionLog,
    Addon,
    Category,
    Coupon,
    Customer,
    Package,
    StaffProfile,
)
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from ._common import _get_request_user, _is_admin_or_owner_user
from .accounts import _deleted_account_payload
from ..serializers import (
    ActionLogSerializer,
    AddonSerializer,
    CategorySerializer,
    CouponSerializer,
    PackageSerializer,
)


@api_view(["GET"])
def recycle_bin(request):
    """
    Soft-deleted catalog items (deleted_at set). Not the same as archive (is_archived).
    """
    user = _get_request_user(request)
    if not user or not getattr(user, "is_authenticated", False):
        return Response(
            {"detail": "Authentication required"},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    if not _is_admin_or_owner_user(user):
        return Response(
            {"detail": "Only ADMIN or OWNER can view Internal Records."},
            status=status.HTTP_403_FORBIDDEN,
        )

    categories = Category.objects.filter(deleted_at__isnull=False).order_by("-deleted_at")
    packages = Package.objects.filter(deleted_at__isnull=False).order_by("-deleted_at")
    coupons = (
        Coupon.objects.annotate(times_used=Count("couponusage"))
        .filter(deleted_at__isnull=False)
        .order_by("-deleted_at")
    )
    addons = Addon.objects.filter(deleted_at__isnull=False).order_by("-deleted_at")
    deleted_customers = Customer.objects.filter(deleted_at__isnull=False).order_by(
        "-deleted_at"
    )
    deleted_staff_profiles = (
        StaffProfile.objects.select_related("user")
        .filter(deleted_at__isnull=False)
        .order_by("-deleted_at")
    )

    return Response(
        {
            "categories": CategorySerializer(categories, many=True).data,
            "packages": PackageSerializer(packages, many=True).data,
            "coupons": CouponSerializer(coupons, many=True).data,
            "addons": AddonSerializer(addons, many=True).data,
            "customers": [
                {
                    "id": c.customer_id,
                    "name": c.full_name or "",
                    "email": c.email_recycled or "",
                    "deleted_at": c.deleted_at,
                }
                for c in deleted_customers
            ],
            "accounts": [_deleted_account_payload(p) for p in deleted_staff_profiles],
        }
    )


@api_view(["GET"])
def action_logs(request):
    user = _get_request_user(request)
    if not _is_admin_or_owner_user(user):
        return Response(
            {"detail": "Only ADMIN or OWNER can view action logs."},
            status=status.HTTP_403_FORBIDDEN,
        )

    try:
        limit = int(request.query_params.get("limit", 200))
    except (TypeError, ValueError):
        limit = 200
    limit = max(1, min(limit, 500))
    try:
        offset = int(request.query_params.get("offset", 0))
    except (TypeError, ValueError):
        offset = 0
    offset = max(0, offset)

    q = (request.query_params.get("q") or "").strip()
    actor = (request.query_params.get("actor") or "").strip()
    action_type = (request.query_params.get("action_type") or "").strip()
    date_from = (request.query_params.get("date_from") or "").strip()
    date_to = (request.query_params.get("date_to") or "").strip()

    qs = ActionLog.objects.select_related("actor_user").all()
    if q:
        qs = qs.filter(
            Q(action_text__icontains=q)
            | Q(actor_label__icontains=q)
            | Q(action_type__icontains=q)
        )
    if actor:
        actor_filter = (
            Q(actor_label__icontains=actor)
            | Q(actor_user__username__icontains=actor)
            | Q(actor_user__email__icontains=actor)
        )
        if actor.isdigit():
            actor_filter = actor_filter | Q(actor_user_id=int(actor))
        qs = qs.filter(actor_filter)
    if action_type and action_type.lower() != "all":
        qs = qs.filter(action_type=action_type)
    # Lets the client hide whole groups (e.g. coupon_*) before paging, so every
    # page holds `limit` visible rows.
    exclude_prefix = (request.query_params.get("exclude_type_prefix") or "").strip()
    if exclude_prefix:
        qs = qs.exclude(action_type__startswith=exclude_prefix)
    if date_from:
        parsed_from = parse_datetime(f"{date_from}T00:00:00")
        if parsed_from is not None:
            if timezone.is_naive(parsed_from):
                parsed_from = timezone.make_aware(
                    parsed_from, timezone.get_current_timezone()
                )
            qs = qs.filter(created_at__gte=parsed_from)
    if date_to:
        parsed_to = parse_datetime(f"{date_to}T23:59:59")
        if parsed_to is not None:
            if timezone.is_naive(parsed_to):
                parsed_to = timezone.make_aware(
                    parsed_to, timezone.get_current_timezone()
                )
            qs = qs.filter(created_at__lte=parsed_to)

    # Ordering comes from ActionLog.Meta (-created_at, -id), so offsets are stable.
    qs = qs[offset:offset + limit]
    return Response(ActionLogSerializer(qs, many=True).data, status=status.HTTP_200_OK)


# ═══════════════════════════════════════════════════════════════════════════════
