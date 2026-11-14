"""Customer CRUD, list, bulk delete, and Internal Records actions."""

from decimal import Decimal, ROUND_HALF_UP

from backend.loyalty_utils import claim_points_for_package, get_loyalty_settings
from backend.models import ActionLog, Customer, Package, Renewal
from backend.renewal_utils import heuristic_renewal_probability
from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ._common import (
    _customer_editable_field_changes,
    _format_customer_updated_action_text,
    _get_request_sender_label,
    _snapshot_customer_editable_fields,
    _write_action_log,
    VISIBLE_CUSTOMER_BOOKING_FILTER,
)
from .recycle import (
    _apply_customer_internal_records_fields,
    _recycle_item_label,
    _soft_delete_customer_to_internal_records,
    RecycleBinActionsMixin,
)
from ..permissions import StaffOrKioskAction
from ..serializers import (
    ActionLogSerializer,
    CustomerDetailSerializer,
    CustomerListSerializer,
    CustomerWriteSerializer,
)


# ═══════════════════════════════════════════════════════════════════════════════
# CUSTOMER VIEWSET
# ═══════════════════════════════════════════════════════════════════════════════


class CustomerViewSet(viewsets.ModelViewSet):
    """
    Standard CRUD plus two extra actions:
      GET  /api/customers/all/           → full unpaginated list (table page)
      POST /api/customers/bulk-delete/   → soft-delete multiple (Internal Records)
    Delete → soft-delete + customer_recycled log; restore/purge like catalog recycle.
    """

    # Anonymous callers may only use kiosk_actions; see endpoints/permissions.py.
    permission_classes = [StaffOrKioskAction]
    # Kiosk: find a customer by email, or create one.
    kiosk_actions = ("create", "by_email")

    class CustomerPagination(PageNumberPagination):
        page_size = 20
        page_size_query_param = "page_size"
        max_page_size = 100

    pagination_class = CustomerPagination

    def get_queryset(self):
        qs = (
            Customer.objects.select_related("renewal", "package")
            .annotate(
                booking_count=Count(
                    "bookings", filter=VISIBLE_CUSTOMER_BOOKING_FILTER
                )
            )
        )
        action = getattr(self, "action", None)
        if action in ("restore", "purge"):
            return qs.order_by("created_at")
        qs = qs.filter(deleted_at__isnull=True)
        if action == "list":
            search = (self.request.query_params.get("search") or "").strip()
            if search:
                search_filter = (
                    Q(full_name__icontains=search)
                    | Q(email__icontains=search)
                    | Q(contact_number__icontains=search)
                )
                if search.isdigit():
                    search_filter |= Q(customer_id=int(search))
                qs = qs.filter(search_filter)

            booking_filter = self.request.query_params.get("booking")
            if booking_filter == "one":
                qs = qs.filter(booking_count=1)
            elif booking_filter == "two_three":
                qs = qs.filter(booking_count__gte=2, booking_count__lte=3)
            elif booking_filter == "four_plus":
                qs = qs.filter(booking_count__gte=4)

            risk_filter = self.request.query_params.get("risk")
            if risk_filter in {"at_risk", "high_risk", "likely"}:
                renewal_ids = []
                for renewal in Renewal.objects.only(
                    "customer_id",
                    "total_bookings",
                    "booking_frequency",
                    "avg_booking_value",
                    "renewed_within_366",
                ):
                    probability = heuristic_renewal_probability(renewal)
                    matches = (
                        risk_filter == "at_risk" and probability < 0.5
                    ) or (
                        risk_filter == "high_risk" and probability < 0.3
                    ) or (
                        risk_filter == "likely" and probability >= 0.5
                    )
                    if matches:
                        renewal_ids.append(renewal.customer_id)
                qs = qs.filter(customer_id__in=renewal_ids)

            if self.request.query_params.get("consent") == "agreed":
                qs = qs.filter(
                    Q(consent__iexact="I Agree")
                    | Q(consent__iexact="agree")
                    | Q(consent__iexact="yes")
                    | Q(consent__iexact="approved")
                    | Q(consent__iexact="true")
                )

            date_from = self.request.query_params.get("date_from")
            date_to = self.request.query_params.get("date_to")
            if date_from:
                qs = qs.filter(last_updated__date__gte=date_from)
            if date_to:
                qs = qs.filter(last_updated__date__lte=date_to)

        sort_fields = {
            "id": "customer_id",
            "name": "full_name",
            "email": "email",
            "contactNo": "contact_number",
            "consent": "consent",
            "bookings": "booking_count",
            "updatedAt": "last_updated",
        }
        sort = self.request.query_params.get("sort", "id-asc")
        field, _, direction = sort.rpartition("-")
        order_field = sort_fields.get(field, "customer_id")
        prefix = "-" if direction == "desc" else ""
        return qs.order_by(f"{prefix}{order_field}", "customer_id")

    def get_serializer_class(self):
        if self.action in ("retrieve",):
            return CustomerDetailSerializer
        if self.action in ("create", "update", "partial_update"):
            return CustomerWriteSerializer
        return CustomerListSerializer

    # ── extra read action: GET /api/customers/all/ ─────────────────────────────
    @action(detail=False, methods=["get"], url_path="all")
    def list_all(self, request):
        """
        Returns every customer with live booking count.
        Used by the customer data table (client-side filter/sort/page).
        """
        qs = self.get_queryset()
        serializer = CustomerListSerializer(qs, many=True)
        return Response(serializer.data)

    # ── extra read action: GET /api/customers/by-email/?email=xxx ─────────────
    @action(detail=False, methods=["get"], url_path="by-email")
    def by_email(self, request):
        """
        Returns a single customer by email (case-insensitive).
        404 if not found. Used for kiosk email lookup and validation.
        """
        email = (request.query_params.get("email") or "").strip()
        if not email:
            return Response(
                {"detail": "Email query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            customer = (
                Customer.objects.select_related("package")
                .annotate(
                    booking_count=Count(
                        "bookings", filter=VISIBLE_CUSTOMER_BOOKING_FILTER
                    )
                )
                .filter(deleted_at__isnull=True)
                .get(email__iexact=email)
            )
            serializer = CustomerListSerializer(customer)
            return Response(serializer.data)
        except Customer.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

    # ── extra write action: POST /api/customers/bulk-delete/ ──────────────────
    @action(detail=False, methods=["post"], url_path="bulk-delete")
    def bulk_delete(self, request):
        ids = request.data.get("ids", [])
        if not ids:
            return Response(
                {"detail": "No ids provided."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        qs = Customer.objects.filter(
            customer_id__in=ids, deleted_at__isnull=True
        )
        customers_preview = list(
            qs.values("customer_id", "full_name", "email")[:100]
        )
        affected_customer_ids = []
        n = 0
        for cust in qs:
            _apply_customer_internal_records_fields(cust)
            affected_customer_ids.append(cust.customer_id)
            n += 1
        actor_name = _get_request_sender_label(request)
        _write_action_log(
            request,
            "customers_bulk_recycled",
            f"{actor_name} moved {n} customer record(s) to Internal Records",
            metadata={
                "recycled_count": n,
                "requested_ids": ids,
                "customers": customers_preview,
                "affected_customer_ids": affected_customer_ids,
            },
        )
        return Response(
            {"deleted": n},
            status=status.HTTP_200_OK,
        )

    # ── override retrieve to use CustomerDetailSerializer ─────────────────────
    def retrieve(self, request, *args, **kwargs):
        instance = get_object_or_404(
            self.filter_queryset(self.get_queryset())
            .select_related("package")
            .prefetch_related(
                "bookings__bookingaddon_set__addon",
                "bookings__package",
                "bookings__coupon",
            ),
            pk=kwargs["pk"],
        )
        serializer = CustomerDetailSerializer(instance)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="claim-package")
    def claim_package(self, request, pk=None):
        customer = self.get_object()
        raw_pid = request.data.get("package_id")
        try:
            package_id = int(raw_pid)
        except (TypeError, ValueError):
            return Response(
                {"detail": "package_id is required and must be an integer."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        pkg = Package.objects.filter(
            pk=package_id, deleted_at__isnull=True
        ).first()
        if not pkg:
            return Response(
                {"detail": "Package not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        settings_row = get_loyalty_settings()
        cost = claim_points_for_package(pkg, settings_row)
        if cost <= 0:
            msg = (
                "This package cannot be claimed with points until it has a positive "
                "price (list or promo). Update the package in Packages or contact an admin."
            )
            return Response(
                {
                    "detail": msg,
                    "message": msg,
                    "code": "invalid_claim_price",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        prev_pkg_id = customer.package_id
        prev_pkg_name = None
        if prev_pkg_id:
            prev_pkg = Package.objects.filter(pk=prev_pkg_id).only("name").first()
            prev_pkg_name = prev_pkg.name if prev_pkg else None

        with transaction.atomic():
            cust = Customer.objects.select_for_update().get(pk=customer.pk)
            bal = cust.loyalty_points or Decimal("0")
            if bal < cost:
                bal_f = float(bal)
                cost_f = float(cost)
                shortfall = float(cost - bal)
                msg = (
                    f"You need {cost_f:g} points to claim “{pkg.name}”. "
                    f"Current balance is {bal_f:g} points "
                    f"({shortfall:g} short). "
                    "Customers earn points when bookings are completed (BOOKED)."
                )
                return Response(
                    {
                        "detail": msg,
                        "message": msg,
                        "code": "insufficient_loyalty_points",
                        "required_points": cost_f,
                        "balance_points": bal_f,
                        "shortfall": shortfall,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            new_bal = (bal - cost).quantize(
                Decimal("0.1"), rounding=ROUND_HALF_UP
            )
            cust.loyalty_points = new_bal
            cust.package_id = pkg.pk
            cust.last_updated = timezone.now()
            cust.save(
                update_fields=["loyalty_points", "package_id", "last_updated"]
            )
        cust = Customer.objects.select_related("package").get(pk=cust.pk)
        actor_name = _get_request_sender_label(request)
        _write_action_log(
            request,
            "customer_loyalty_claim",
            f"{actor_name} claimed package {pkg.name!r} for customer "
            f"#{cust.customer_id} ({float(cost):g} points)",
            metadata={
                "customer_id": cust.customer_id,
                "previous_package_id": prev_pkg_id,
                "previous_package_name": prev_pkg_name,
                "package_id": pkg.pk,
                "package_name": pkg.name,
                "points_spent": float(cost),
            },
        )
        return Response(CustomerListSerializer(cust).data)

    @action(
        detail=True,
        methods=["get"],
        url_path="action-logs",
        permission_classes=[IsAuthenticated],
    )
    def customer_action_logs(self, request, pk=None):
        """
        Staff-authenticated: action log rows whose metadata references this customer_id.
        """
        customer = self.get_object()
        cid = customer.customer_id
        log_tbl = ActionLog._meta.db_table
        qs = (
            ActionLog.objects.select_related("actor_user")
            .extra(
                where=[
                    f"""(
                        ({log_tbl}.metadata->'customer_id') IS NOT NULL
                        AND ({log_tbl}.metadata->'customer_id')::text::bigint = %s
                    ) OR (
                        %s::bigint = ANY(
                            SELECT (jsonb_array_elements_text(
                                COALESCE({log_tbl}.metadata->'affected_customer_ids', '[]'::jsonb)
                            ))::bigint
                        )
                    )"""
                ],
                params=[cid, cid],
            )
            .order_by("-created_at")[:200]
        )
        return Response(ActionLogSerializer(qs, many=True).data)

    # ── override create/update to return detail representation ────────────────
    def create(self, request, *args, **kwargs):
        write_ser = CustomerWriteSerializer(data=request.data)
        write_ser.is_valid(raise_exception=True)
        customer = write_ser.save()
        actor_name = _get_request_sender_label(request)
        _write_action_log(
            request,
            "customer_created",
            f"{actor_name} created customer {customer.full_name or ('#' + str(customer.customer_id))}",
            metadata={
                "customer_id": customer.customer_id,
                "name": customer.full_name or "",
                "email": customer.email or "",
            },
        )
        return Response(
            CustomerListSerializer(customer).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        before = _snapshot_customer_editable_fields(instance)
        write_ser = CustomerWriteSerializer(
            instance, data=request.data, partial=partial
        )
        write_ser.is_valid(raise_exception=True)
        customer = write_ser.save()
        after = _snapshot_customer_editable_fields(customer)
        changed = _customer_editable_field_changes(before, after)
        if changed:
            actor_name = _get_request_sender_label(request)
            _write_action_log(
                request,
                "customer_updated",
                _format_customer_updated_action_text(actor_name, customer, changed),
                metadata={
                    "customer_id": customer.customer_id,
                    "changed_fields": changed,
                    "previous": before,
                    "current": after,
                },
            )
        return Response(CustomerListSerializer(customer).data)

    def perform_destroy(self, instance):
        _soft_delete_customer_to_internal_records(self.request, instance)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self.perform_destroy(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="restore")
    def restore_customer(self, request, pk=None):
        """ADMIN/OWNER: restore customer from Internal Records (email must not clash)."""
        err = RecycleBinActionsMixin._recycle_admin_gate(self, request)
        if err:
            return err
        instance = self.get_object()
        if instance.deleted_at is None:
            return Response(
                {"detail": "This customer is not in Internal Records."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        restore_email = instance.email_recycled
        if restore_email:
            clash = (
                Customer.objects.filter(
                    email__iexact=restore_email, deleted_at__isnull=True
                )
                .exclude(pk=instance.pk)
                .exists()
            )
            if clash:
                return Response(
                    {
                        "detail": "Cannot restore: another active customer already "
                        "uses this email.",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
        instance.email = restore_email
        instance.email_recycled = None
        instance.deleted_at = None
        instance.last_updated = timezone.now()
        instance.save(
            update_fields=[
                "email",
                "email_recycled",
                "deleted_at",
                "last_updated",
            ]
        )
        actor_name = _get_request_sender_label(request)
        label = _recycle_item_label(instance)
        _write_action_log(
            request,
            "customer_restored",
            f"{actor_name} restored customer {label} from Internal Records",
            metadata={
                "customer_id": instance.customer_id,
                "email": instance.email or "",
            },
        )
        return Response(CustomerListSerializer(instance).data)

    @action(detail=True, methods=["post"], url_path="purge")
    def purge_customer(self, request, pk=None):
        """Dev mode: permanently delete customer row (and cascaded data)."""
        err = RecycleBinActionsMixin._recycle_purge_gate(self, request)
        if err:
            return err
        instance = self.get_object()
        if instance.deleted_at is None:
            return Response(
                {
                    "detail": "Permanent delete is only available for customers "
                    "in Internal Records.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        cid = instance.customer_id
        label = _recycle_item_label(instance)
        instance.delete()
        actor_name = _get_request_sender_label(request)
        _write_action_log(
            request,
            "customer_purged",
            f"{actor_name} permanently deleted customer {label}",
            metadata={"customer_id": cid},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


# ═══════════════════════════════════════════════════════════════════════════════
