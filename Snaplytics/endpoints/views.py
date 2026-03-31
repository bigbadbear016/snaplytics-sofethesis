# endpoints/views.py
import logging
import math
import csv
import subprocess
import sys
import hashlib
from datetime import datetime
from pathlib import Path

from django.db.utils import OperationalError, ProgrammingError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.html import strip_tags
from django.contrib.auth import authenticate, get_user_model
from django.conf import settings

from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.authtoken.models import Token

from backend.models import (
    Category,
    Customer,
    Coupon,
    EmailTemplate,
    CouponSent,
    CouponUsage,
    Package,
    Addon,
    Booking,
    BookingAddon,
    Renewal,
    StaffProfile,
    PasswordResetRequest,
    ActionLog,
)
from backend.renewal_utils import recompute_customer_renewal_profile
from .serializers import (
    CustomerListSerializer,
    CustomerDetailSerializer,
    CustomerWriteSerializer,
    CategorySerializer,
    PackageSerializer,
    AddonSerializer,
    BookingSerializer,
    CouponSerializer,
    EmailTemplateSerializer,
    ActionLogSerializer,
)
from django.db.models.functions import TruncMonth, Coalesce, Lower
from django.db.models import Count, Q, Sum, Avg, F
from recommender.service import get_recommendations
from backend.coupon_utils import validate_coupon_for_customer

logger = logging.getLogger(__name__)
ACCEPTED_BOOKING_STATUSES = ("Ongoing", "BOOKED")
VISIBLE_CUSTOMER_BOOKING_FILTER = (
    Q(bookings__session_status="BOOKED")
    | Q(bookings__session_status__isnull=True)
    | Q(bookings__session_status="")
)


# ═══════════════════════════════════════════════════════════════════════════════
# CUSTOMER VIEWSET
# ═══════════════════════════════════════════════════════════════════════════════


class CustomerViewSet(viewsets.ModelViewSet):
    """
    Standard CRUD plus two extra actions:
      GET  /api/customers/all/           → full unpaginated list (table page)
      POST /api/customers/bulk-delete/   → delete multiple by id array
    """

    permission_classes = [AllowAny]

    def get_queryset(self):
        return (
            Customer.objects.select_related("renewal")
            .annotate(
                booking_count=Count(
                    "bookings", filter=VISIBLE_CUSTOMER_BOOKING_FILTER
                )
            )
            .order_by("created_at")
        )

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
            customer = Customer.objects.annotate(
                booking_count=Count("bookings", filter=VISIBLE_CUSTOMER_BOOKING_FILTER)
            ).get(email__iexact=email)
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
        customers = list(
            Customer.objects.filter(customer_id__in=ids).values(
                "customer_id", "full_name", "email"
            )
        )
        deleted_count, _ = Customer.objects.filter(customer_id__in=ids).delete()
        actor_name = _get_request_sender_label(request)
        _write_action_log(
            request,
            "customer_bulk_deleted",
            f"{actor_name} bulk deleted {deleted_count} customer record(s)",
            metadata={
                "deleted_count": deleted_count,
                "requested_ids": ids,
                "customers": customers[:100],
            },
        )
        return Response(
            {"deleted": deleted_count},
            status=status.HTTP_200_OK,
        )

    # ── override retrieve to use CustomerDetailSerializer ─────────────────────
    def retrieve(self, request, *args, **kwargs):
        instance = get_object_or_404(
            Customer.objects.prefetch_related(
                "bookings__bookingaddon_set__addon",
                "bookings__package",
                "bookings__coupon",
            ),
            pk=kwargs["pk"],
        )
        serializer = CustomerDetailSerializer(instance)
        return Response(serializer.data)

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
        old_name = instance.full_name or ""
        old_email = instance.email or ""
        old_contact = instance.contact_number or ""
        write_ser = CustomerWriteSerializer(
            instance, data=request.data, partial=partial
        )
        write_ser.is_valid(raise_exception=True)
        customer = write_ser.save()
        actor_name = _get_request_sender_label(request)
        _write_action_log(
            request,
            "customer_updated",
            f"{actor_name} updated customer {customer.full_name or ('#' + str(customer.customer_id))}",
            metadata={
                "customer_id": customer.customer_id,
                "old_name": old_name,
                "new_name": customer.full_name or "",
                "old_email": old_email,
                "new_email": customer.email or "",
                "old_contact_number": old_contact,
                "new_contact_number": customer.contact_number or "",
            },
        )
        return Response(CustomerListSerializer(customer).data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        customer_id = instance.customer_id
        name = instance.full_name or ""
        email = instance.email or ""
        self.perform_destroy(instance)
        actor_name = _get_request_sender_label(request)
        _write_action_log(
            request,
            "customer_deleted",
            f"{actor_name} deleted customer {name or ('#' + str(customer_id))}",
            metadata={
                "customer_id": customer_id,
                "name": name,
                "email": email,
            },
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


# ═══════════════════════════════════════════════════════════════════════════════
# BOOKING VIEWSET
# ═══════════════════════════════════════════════════════════════════════════════


class BookingViewSet(viewsets.ModelViewSet):
    """
    Standard CRUD plus:
      GET   /api/bookings/?status=Pending,Ongoing  → notification panel feed
      PATCH /api/bookings/<id>/status/             → lightweight status mutation
    """

    serializer_class = BookingSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        qs = (
            Booking.objects.select_related("customer", "package", "coupon")
            .prefetch_related("bookingaddon_set__addon")
            .order_by("created_at")
        )

        # ?status=Pending,Ongoing  filter used by the notification panel
        status_param = self.request.query_params.get("status", "")
        if status_param:
            statuses = [s.strip() for s in status_param.split(",") if s.strip()]
            qs = qs.filter(session_status__in=statuses)

        # ?customer_id=N  filter used by the customer-scoped booking list
        customer_id = self.request.query_params.get("customer_id", "")
        if customer_id:
            qs = qs.filter(customer_id=customer_id)

        return qs

    # ── PATCH /api/bookings/<id>/status/ ──────────────────────────────────────
    @action(detail=True, methods=["patch"], url_path="status")
    def update_status(self, request, pk=None):
        VALID_STATUSES = {"Pending", "Ongoing", "BOOKED", "Cancelled"}

        booking = self.get_object()
        old_status = booking.session_status or ""
        new_status = request.data.get("session_status")

        if new_status not in VALID_STATUSES:
            return Response(
                {"detail": f"Invalid status. Must be one of: {VALID_STATUSES}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        booking.session_status = new_status
        booking.last_updated = timezone.now()
        booking.save(update_fields=["session_status", "last_updated"])
        customer_name = (booking.customer.full_name or "").strip() if booking.customer else ""
        actor_name = _get_request_sender_label(request)
        _write_action_log(
            request,
            "booking_status_updated",
            f"{actor_name} changed booking #{booking.pk} status to {new_status}"
            + (f" for {customer_name}" if customer_name else ""),
            metadata={
                "booking_id": booking.pk,
                "customer_id": booking.customer_id,
                "customer_name": customer_name,
                "from_status": old_status,
                "to_status": new_status,
            },
        )
        return Response(BookingSerializer(booking).data)

    def perform_destroy(self, instance):
        booking_id = instance.pk
        customer = instance.customer
        customer_name = (customer.full_name or "").strip() if customer else ""
        super().perform_destroy(instance)
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            "booking_deleted",
            f"{actor_name} deleted booking #{booking_id}"
            + (f" for {customer_name}" if customer_name else ""),
            metadata={
                "booking_id": booking_id,
                "customer_id": customer.customer_id if customer else None,
                "customer_name": customer_name,
            },
        )
        if customer:
            recompute_customer_renewal_profile(customer)

    # ── nested booking routes under /api/customers/<cid>/bookings/ ─────────────
    # These are called from CustomerBookingsViewSet below; this ViewSet handles
    # the top-level /api/bookings/ routes only.


# ═══════════════════════════════════════════════════════════════════════════════
# CUSTOMER-SCOPED BOOKINGS  (/api/customers/<customer_pk>/bookings/)
# ═══════════════════════════════════════════════════════════════════════════════


class CustomerBookingsViewSet(viewsets.ViewSet):
    """
    Nested viewset scoped to a single customer.
    Registered manually in urls.py (not through the default router).

    Routes:
      GET    /api/customers/<customer_pk>/bookings/
      POST   /api/customers/<customer_pk>/bookings/
      GET    /api/customers/<customer_pk>/bookings/<pk>/
      PUT    /api/customers/<customer_pk>/bookings/<pk>/
      DELETE /api/customers/<customer_pk>/bookings/<pk>/
    """

    def _get_customer(self, customer_pk):
        return get_object_or_404(Customer, pk=customer_pk)

    def _get_booking(self, customer_pk, pk):
        return get_object_or_404(
            Booking.objects.select_related("customer", "package", "coupon").prefetch_related(
                "bookingaddon_set__addon"
            ),
            pk=pk,
            customer_id=customer_pk,
        )

    def list(self, request, customer_pk=None):
        self._get_customer(customer_pk)  # 404 if customer missing
        qs = (
            Booking.objects.filter(customer_id=customer_pk)
            .select_related("customer", "package", "coupon")
            .prefetch_related("bookingaddon_set__addon")
            .order_by("created_at")
        )
        return Response(BookingSerializer(qs, many=True).data)

    def create(self, request, customer_pk=None):
        customer = self._get_customer(customer_pk)
        data = {**request.data, "customer_id": customer.pk}
        ser = BookingSerializer(data=data)
        ser.is_valid(raise_exception=True)
        booking = ser.save()
        actor_name = _get_request_sender_label(request)
        _write_action_log(
            request,
            "booking_created",
            f"{actor_name} created booking #{booking.pk} for {customer.full_name or ('customer #' + str(customer.pk))}",
            metadata={
                "booking_id": booking.pk,
                "customer_id": customer.pk,
                "customer_name": customer.full_name or "",
                "session_status": booking.session_status or "",
            },
        )
        # Re-fetch with relations for the response
        booking = self._get_booking(customer_pk, booking.pk)
        return Response(BookingSerializer(booking).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, customer_pk=None, pk=None):
        booking = self._get_booking(customer_pk, pk)
        return Response(BookingSerializer(booking).data)

    def update(self, request, customer_pk=None, pk=None):
        booking = self._get_booking(customer_pk, pk)
        previous_status = booking.session_status or ""
        ser = BookingSerializer(booking, data=request.data, partial=False)
        ser.is_valid(raise_exception=True)
        ser.save()
        actor_name = _get_request_sender_label(request)
        _write_action_log(
            request,
            "booking_updated",
            f"{actor_name} updated booking #{booking.pk}",
            metadata={
                "booking_id": booking.pk,
                "customer_id": booking.customer_id,
                "from_status": previous_status,
                "to_status": booking.session_status or "",
            },
        )
        booking = self._get_booking(customer_pk, pk)  # re-fetch
        return Response(BookingSerializer(booking).data)

    def destroy(self, request, customer_pk=None, pk=None):
        booking = self._get_booking(customer_pk, pk)
        booking_id = booking.pk
        customer = booking.customer
        booking.delete()
        actor_name = _get_request_sender_label(request)
        _write_action_log(
            request,
            "booking_deleted",
            f"{actor_name} deleted booking #{booking_id}"
            + (f" for {customer.full_name}" if customer and customer.full_name else ""),
            metadata={
                "booking_id": booking_id,
                "customer_id": customer.customer_id if customer else None,
                "customer_name": customer.full_name if customer else "",
            },
        )
        if customer:
            recompute_customer_renewal_profile(customer)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ═══════════════════════════════════════════════════════════════════════════════
# PACKAGE / ADDON VIEWSETS  (unchanged from original)
# ═══════════════════════════════════════════════════════════════════════════════


class PackageViewSet(viewsets.ModelViewSet):
    queryset = Package.objects.all().order_by("id")
    serializer_class = PackageSerializer
    pagination_class = None

    def _ensure_category_exists(self, category_name):
        if not category_name:
            return
        Category.objects.get_or_create(name=category_name)

    def perform_create(self, serializer):
        package = serializer.save()
        self._ensure_category_exists(package.category)
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            "package_created",
            f"{actor_name} created package {package.name}",
            metadata={
                "package_id": package.id,
                "name": package.name,
                "category": package.category,
                "price": package.price,
            },
        )

    def perform_update(self, serializer):
        old = self.get_object()
        package = serializer.save()
        self._ensure_category_exists(package.category)
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            "package_updated",
            f"{actor_name} updated package {package.name}",
            metadata={
                "package_id": package.id,
                "old_name": old.name,
                "new_name": package.name,
                "old_category": old.category,
                "new_category": package.category,
                "old_price": old.price,
                "new_price": package.price,
            },
        )

    def perform_destroy(self, instance):
        package_id = instance.id
        name = instance.name
        super().perform_destroy(instance)
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            "package_deleted",
            f"{actor_name} deleted package {name}",
            metadata={"package_id": package_id, "name": name},
        )


class CategoryViewSet(viewsets.ModelViewSet):
    queryset = Category.objects.all().order_by("name")
    serializer_class = CategorySerializer
    pagination_class = None

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        category_names = list(queryset.values_list("name", flat=True))
        normalized_names = [str(name).lower() for name in category_names if name]

        count_map = {}
        if normalized_names:
            for row in (
                Package.objects.annotate(category_key=Lower("category"))
                .filter(category_key__in=normalized_names)
                .values("category_key")
                .annotate(total=Count("id"))
            ):
                count_map[row["category_key"]] = row["total"]

        serializer = self.get_serializer(
            queryset,
            many=True,
            context={
                **self.get_serializer_context(),
                "category_package_counts": count_map,
            },
        )
        return Response(serializer.data)

    def perform_update(self, serializer):
        old_name = self.get_object().name
        category = serializer.save(last_updated=timezone.now())
        if old_name != category.name:
            Package.objects.filter(category__iexact=old_name).update(
                category=category.name,
                last_updated=timezone.now(),
            )
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            "category_updated",
            f"{actor_name} updated category {old_name} to {category.name}",
            metadata={
                "category_id": category.id,
                "old_name": old_name,
                "new_name": category.name,
            },
        )

    def perform_create(self, serializer):
        category = serializer.save(last_updated=timezone.now())
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            "category_created",
            f"{actor_name} created category {category.name}",
            metadata={"category_id": category.id, "name": category.name},
        )

    def perform_destroy(self, instance):
        category_id = instance.id
        name = instance.name
        super().perform_destroy(instance)
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            "category_deleted",
            f"{actor_name} deleted category {name}",
            metadata={"category_id": category_id, "name": name},
        )

class AddonViewSet(viewsets.ModelViewSet):
    queryset = Addon.objects.all().order_by("id")
    serializer_class = AddonSerializer
    pagination_class = None

    def perform_create(self, serializer):
        addon = serializer.save()
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            "addon_created",
            f"{actor_name} created add-on {addon.name}",
            metadata={
                "addon_id": addon.id,
                "name": addon.name,
                "price": addon.price,
            },
        )

    def perform_update(self, serializer):
        old = self.get_object()
        addon = serializer.save()
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            "addon_updated",
            f"{actor_name} updated add-on {addon.name}",
            metadata={
                "addon_id": addon.id,
                "old_name": old.name,
                "new_name": addon.name,
                "old_price": old.price,
                "new_price": addon.price,
            },
        )

    def perform_destroy(self, instance):
        addon_id = instance.id
        name = instance.name
        super().perform_destroy(instance)
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            "addon_deleted",
            f"{actor_name} deleted add-on {name}",
            metadata={"addon_id": addon_id, "name": name},
        )


# ═══════════════════════════════════════════════════════════════════════════════
# COUPON VIEWSET
# ═══════════════════════════════════════════════════════════════════════════════


class CouponViewSet(viewsets.ModelViewSet):
    queryset = Coupon.objects.annotate(times_used=Count("couponusage")).order_by("-created_at")
    serializer_class = CouponSerializer
    pagination_class = None
    permission_classes = [AllowAny]

    def list(self, request, *args, **kwargs):
        try:
            return super().list(request, *args, **kwargs)
        except (OperationalError, ProgrammingError) as e:
            logger.exception("Coupon list failed (migration may be missing)")
            return Response(
                {
                    "detail": "Coupon tables not found. Run: python manage.py migrate",
                    "hint": str(e),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

    def perform_create(self, serializer):
        coupon = serializer.save()
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            "coupon_created",
            f"{actor_name} created coupon {coupon.code}",
            metadata={
                "coupon_id": coupon.id,
                "coupon_code": coupon.code,
                "discount_type": coupon.discount_type,
                "discount_value": coupon.discount_value,
            },
        )

    def perform_update(self, serializer):
        old = self.get_object()
        coupon = serializer.save()
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            "coupon_updated",
            f"{actor_name} updated coupon {coupon.code}",
            metadata={
                "coupon_id": coupon.id,
                "coupon_code": coupon.code,
                "old_discount_type": old.discount_type,
                "new_discount_type": coupon.discount_type,
                "old_discount_value": old.discount_value,
                "new_discount_value": coupon.discount_value,
            },
        )

    def perform_destroy(self, instance):
        coupon_id = instance.pk
        coupon_code = instance.code
        super().perform_destroy(instance)
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            "coupon_deleted",
            f"{actor_name} deleted coupon {coupon_code}",
            metadata={
                "coupon_id": coupon_id,
                "coupon_code": coupon_code,
            },
        )

    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        coupon = self.get_object()
        customer_ids = request.data.get("customer_ids", [])
        search = request.data.get("search", "").strip()
        sender_label = _get_request_sender_label(request)

        if search:
            qs = Customer.objects.filter(
                Q(email__icontains=search)
                | Q(full_name__icontains=search)
            )
            customer_ids = list(qs.values_list("customer_id", flat=True))

        if not customer_ids:
            return Response(
                {"detail": "No customers specified"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created = 0
        for cid in customer_ids:
            cs, created_flag = CouponSent.objects.get_or_create(
                coupon=coupon,
                customer_id=cid,
                defaults={"sent_at": timezone.now(), "sender_label": sender_label},
            )
            if not created_flag and sender_label and cs.sender_label != sender_label:
                cs.sender_label = sender_label
                cs.save(update_fields=["sender_label"])
            if created_flag:
                created += 1

        actor_name = _get_request_sender_label(request)
        _write_action_log(
            request,
            "coupon_registered",
            f"{actor_name} registered coupon {coupon.code} to {len(customer_ids)} customer(s)",
            metadata={
                "coupon_id": coupon.id,
                "coupon_code": coupon.code,
                "customer_ids": list(customer_ids),
                "registered_count": created,
            },
        )

        return Response({"sent_count": created, "customer_ids": list(customer_ids)})

    @action(detail=True, methods=["post"], url_path="send-email")
    def send_email(self, request, pk=None):
        """
        POST /api/coupons/<id>/send-email/
        Body: { "customer_ids": [...], "subject": "...", "body": "...", "html_body": "..." }
        Sends one email per recipient via SMTP (env-configured).
        """
        from django.core.mail import EmailMultiAlternatives
        from email.utils import formataddr

        coupon = self.get_object()
        customer_ids = request.data.get("customer_ids") or []
        subject = (request.data.get("subject") or "").strip()
        body = (request.data.get("body") or "").strip()
        html_body = (request.data.get("html_body") or "").strip()
        sender_label = _get_request_sender_label(request)

        if not customer_ids:
            return Response(
                {"detail": "customer_ids is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not subject:
            return Response(
                {"detail": "subject is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not body and not html_body:
            return Response(
                {"detail": "body or html_body is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from_addr = getattr(settings, "HEIGEN_SMTP_FROM_EMAIL", "") or getattr(
            settings, "DEFAULT_FROM_EMAIL", ""
        )
        if not from_addr:
            return Response(
                {"detail": "SMTP is not configured (missing DEFAULT_FROM_EMAIL / HEIGEN_SMTP_FROM_EMAIL)"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        sender_name = "Heigen Studio"
        from_header = (
            formataddr((sender_name, from_addr)) if sender_name else from_addr
        )

        def _apply_coupon_tokens(template, coupon_code):
            if not template:
                return template
            return (
                template.replace("{{code}}", coupon_code).replace("{{coupon}}", coupon_code)
            )

        sent = 0
        errors = []
        customer_map = Customer.objects.in_bulk(customer_ids)
        for cid in customer_ids:
            customer = customer_map.get(cid)
            if customer is None:
                try:
                    customer = customer_map.get(int(cid))
                except (TypeError, ValueError):
                    customer = None
            if customer is None:
                errors.append(f"Unknown customer id {cid}")
                continue
            email_addr = (customer.email or "").strip()
            if not email_addr:
                errors.append(f"Customer {cid} has no email")
                continue
            try:
                final_subject = _apply_coupon_tokens(subject, coupon.code)
                final_body = _apply_coupon_tokens(body, coupon.code)
                final_html_body = _apply_coupon_tokens(html_body, coupon.code)
                text_body = final_body
                if final_html_body and not text_body:
                    text_body = strip_tags(final_html_body).strip()
                msg = EmailMultiAlternatives(
                    subject=final_subject,
                    body=text_body or final_body,
                    from_email=from_header,
                    to=[email_addr],
                )
                if final_html_body:
                    msg.attach_alternative(final_html_body, "text/html")
                msg.encoding = "utf-8"
                msg.send(fail_silently=False)
                sent += 1
                # Keep History in sync: email-only flow previously skipped CouponSent.
                cs, _ = CouponSent.objects.get_or_create(
                    coupon=coupon,
                    customer_id=cid,
                    defaults={"sent_at": timezone.now(), "sender_label": sender_label},
                )
                cs.email_sent_at = timezone.now()
                if sender_label:
                    cs.sender_label = sender_label
                    cs.save(update_fields=["email_sent_at", "sender_label"])
                else:
                    cs.save(update_fields=["email_sent_at"])
            except Exception as e:
                logger.exception("send_email to %s", email_addr)
                errors.append(f"{email_addr}: {e}")

        actor_name = _get_request_sender_label(request)
        _write_action_log(
            request,
            "coupon_email_sent",
            f"{actor_name} sent coupon {coupon.code} email to {sent} customer(s)",
            metadata={
                "coupon_id": coupon.id,
                "coupon_code": coupon.code,
                "customer_ids": list(customer_ids),
                "sent_count": sent,
                "errors_count": len(errors),
            },
        )

        return Response(
            {
                "sent_count": sent,
                "errors": errors,
                "coupon_code": coupon.code,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        """
        GET /api/coupons/<id>/history/
        Recipients: CouponSent rows plus any customer who redeemed but has no sent
        record (older data / kiosk-only redemptions).
        Redemptions (CouponUsage): each use with booking context (when / package).
        """
        coupon = self.get_object()
        usage_counts = {
            row["customer_id"]: row["n"]
            for row in CouponUsage.objects.filter(coupon=coupon)
            .values("customer_id")
            .annotate(n=Count("id"))
        }
        usage_customer_ids = set(
            CouponUsage.objects.filter(coupon=coupon).values_list(
                "customer_id", flat=True
            )
        )

        sent_by_customer = {
            cs.customer_id: cs
            for cs in CouponSent.objects.filter(coupon=coupon).select_related(
                "customer"
            )
        }
        all_recipient_ids = set(sent_by_customer.keys()) | usage_customer_ids
        customers_map = Customer.objects.in_bulk(all_recipient_ids)

        recipients = []
        for cid in all_recipient_ids:
            cs = sent_by_customer.get(cid)
            cust = customers_map.get(cid)
            if cust is None:
                continue
            if cs is not None:
                recipients.append(
                    {
                        "customer_id": cid,
                        "name": cust.full_name or "",
                        "email": cust.email or "",
                        "sent_at": cs.sent_at,
                        "email_sent_at": cs.email_sent_at,
                        "times_used": usage_counts.get(cid, 0),
                        "sender_label": cs.sender_label or "",
                        "source": "registered",
                    }
                )
            else:
                recipients.append(
                    {
                        "customer_id": cid,
                        "name": cust.full_name or "",
                        "email": cust.email or "",
                        "sent_at": None,
                        "email_sent_at": None,
                        "times_used": usage_counts.get(cid, 0),
                        "source": "redeemed_only",
                    }
                )
        recipients.sort(
            key=lambda r: (
                (r["name"] or "").lower(),
                r["customer_id"],
            )
        )

        redemptions = []
        for u in (
            CouponUsage.objects.filter(coupon=coupon)
            .select_related("customer", "booking", "booking__package")
            .order_by("-used_at")
        ):
            b = u.booking
            pkg = b.package
            redemptions.append(
                {
                    "customer_id": u.customer.customer_id,
                    "name": u.customer.full_name or "",
                    "email": u.customer.email or "",
                    "used_at": u.used_at,
                    "discount_amount": float(u.discount_amount),
                    "booking_id": b.pk,
                    "session_date": b.session_date,
                    "session_status": b.session_status or "",
                    "package_category": pkg.category if pkg else "",
                    "package_name": pkg.name if pkg else "",
                }
            )

        return Response(
            {
                "coupon_id": coupon.id,
                "code": coupon.code,
                "recipients": recipients,
                "redemptions": redemptions,
            }
        )


# ═══════════════════════════════════════════════════════════════════════════════
# RECOMMENDATIONS  (unchanged — already correct architecture)
# ═══════════════════════════════════════════════════════════════════════════════


def get_global_popular_packages(k=3):
    popular = (
        Package.objects.annotate(
            booking_count=Count(
                "booking",
                filter=Q(booking__session_status__in=ACCEPTED_BOOKING_STATUSES),
            )
        )
        .filter(booking_count__gt=0)
        .order_by("-booking_count")[:k]
    )
    if not popular.exists():
        popular = Package.objects.all()[:k]
    return list(popular)


def get_popular_addons_for_package(package_id, top_m=3):
    addon_stats = (
        BookingAddon.objects.filter(
            booking__package_id=package_id,
            booking__session_status__in=ACCEPTED_BOOKING_STATUSES,
        )
        .values("addon_id")
        .annotate(
            total_quantity=Sum("addon_quantity"),
            booking_count=Count("booking_id"),
        )
        .order_by("-total_quantity")[:top_m]
    )
    addon_ids = [s["addon_id"] for s in addon_stats]
    return Addon.objects.filter(id__in=addon_ids)


def build_recommendation_response(customer, recommendations, target_date, k=3):
    result = []
    for rec in recommendations[:k]:
        try:
            package_id = int(float(rec.get("package_id")))
        except (TypeError, ValueError, Package.DoesNotExist):
            continue  # skip invalid recommendations
        addon_ids = rec.get("addon_ids", [])
        try:
            package = Package.objects.get(id=package_id)
            package_data = PackageSerializer(package).data
            if addon_ids:
                addons_qs = Addon.objects.filter(id__in=addon_ids)
                addons_list = AddonSerializer(addons_qs, many=True).data
            else:
                addons_list = AddonSerializer(
                    get_popular_addons_for_package(package_id, top_m=2), many=True
                ).data
            base_price = package.promo_price or package.price
            total_price = base_price + sum(a["price"] for a in addons_list)
            result.append(
                {
                    "package": package_data,
                    "addons": addons_list,
                    "base_price": base_price,
                    "total_price": total_price,
                    "score": rec.get("score", 0),
                    "source": rec.get("source", "unknown"),
                }
            )
        except Package.DoesNotExist:
            logger.warning(f"Package {package_id} not found")
            continue

    # fill remaining slots with popular packages
    if len(result) < k:
        for package in get_global_popular_packages(k - len(result)):
            if any(r["package"]["id"] == package.id for r in result):
                continue
            package_data = PackageSerializer(package).data
            addons_list = AddonSerializer(
                get_popular_addons_for_package(package.id, top_m=2), many=True
            ).data
            base_price = package.promo_price or package.price
            total_price = base_price + sum(a["price"] for a in addons_list)
            result.append(
                {
                    "package": package_data,
                    "addons": addons_list,
                    "base_price": base_price,
                    "total_price": total_price,
                    "score": 0,
                    "source": "popular_fallback",
                }
            )

    total_bookings = Booking.objects.filter(
        customer=customer, session_status__in=ACCEPTED_BOOKING_STATUSES
    ).count()
    return {
        "customer_id": customer.customer_id,
        "customer_name": customer.full_name or "Customer",
        "customer_email": customer.email or "",
        "target_date": target_date,
        "total_bookings": total_bookings,
        "recommendations": result,
        "key_factors": generate_key_factors(customer, result),
    }


def generate_key_factors(customer, recommendations):
    factors = []
    total_bookings = Booking.objects.filter(
        customer=customer, session_status__in=ACCEPTED_BOOKING_STATUSES
    ).count()
    if total_bookings == 0:
        factors.append("First-time customer - showing popular packages")
        factors.append("Recommendations based on overall booking trends")
    else:
        factors.append(f"Based on {total_bookings} previous booking(s)")
        preferred = (
            Booking.objects.filter(
                customer=customer, session_status__in=ACCEPTED_BOOKING_STATUSES
            )
            .values("package__category")
            .annotate(count=Count("id"))
            .order_by("-count")
            .first()
        )
        if preferred and preferred["package__category"]:
            factors.append(f"Preference for {preferred['package__category']} packages")
    sources = [r.get("source", "") for r in recommendations]
    if "customer_booking_history" in sources:
        factors.append("Package loyalty from this customer's booking history")
    elif "loader" in sources or "collaborative_filtering" in sources:
        factors.append("Collaborative filtering based on similar customers")
    elif "popular_package_monthly" in sources:
        factors.append("Seasonal popularity trends considered")
    if any(len(r.get("addons", [])) > 0 for r in recommendations):
        factors.append("Add-ons selected based on popular combinations")
    return factors[:5]


@api_view(["GET"])
def customer_recommendations(request, customer_id):
    try:
        customer = get_object_or_404(Customer, customer_id=customer_id)
        target_date_str = request.GET.get("date")
        k = int(request.GET.get("k", 3))
        if target_date_str:
            for fmt in ("%Y-%m-%d", "%Y-%m"):
                try:
                    target_date = datetime.strptime(target_date_str, fmt).date()
                    break
                except ValueError:
                    continue
            else:
                return Response(
                    {"detail": "Invalid date format. Use YYYY-MM-DD or YYYY-MM"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            target_date = datetime.now().date()
        recommendations = get_recommendations(customer_id, target_date, k)
        response_data = build_recommendation_response(
            customer, recommendations, target_date.strftime("%Y-%m-%d"), k
        )
        logger.info(
            f"Returning {len(response_data['recommendations'])} "
            f"recommendations for customer {customer_id}"
        )
        return Response(response_data, status=status.HTTP_200_OK)
    except Exception as e:
        logger.exception(f"Error in recommendations for {customer_id}")
        return Response(
            {"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(["GET"])
def customer_renewal_prediction(request, customer_id):
    customer = get_object_or_404(Customer, customer_id=customer_id)
    bookings_qs = Booking.objects.filter(
        customer=customer, session_status__in=ACCEPTED_BOOKING_STATUSES
    )
    renewal = recompute_customer_renewal_profile(customer)

    avg_booking_value = float(
        bookings_qs.aggregate(v=Avg("total_price")).get("v") or 0.0
    )
    total_spent = float(
        bookings_qs.aggregate(v=Sum("total_price")).get("v") or 0.0
    )

    total_bookings = int(renewal.total_bookings or 0)
    booking_frequency = float(renewal.booking_frequency or 0.0)
    preferred_package_type = (
        str(renewal.preferred_package_type).strip()
        if renewal.preferred_package_type is not None
        else ""
    )

    # Explicit no-booking guardrail: no history => 0% renewal probability.
    if total_bookings == 0:
        probability = 0.0
    else:
        base_prob = 0.05
        base_prob += min(booking_frequency / 8.0, 0.4)
        base_prob += min(total_bookings / 10.0, 0.25)
        base_prob += min((avg_booking_value or 0.0) / 15000.0, 0.15)
        if renewal.renewed_within_366:
            base_prob += 0.15
        probability = max(0.0, min(base_prob, 0.99))

    if probability >= 0.7:
        band = "very_likely"
        status_text = "Very likely to renew"
    elif probability >= 0.5:
        band = "likely"
        status_text = "Likely to renew"
    elif probability >= 0.3:
        band = "unlikely"
        status_text = "Needs follow-up"
    else:
        band = "very_unlikely"
        status_text = "At risk of not renewing"

    preferred = (
        bookings_qs.values("package__category")
        .annotate(count=Count("id"))
        .order_by("-count")
        .first()
    )
    factors = []
    if total_bookings > 0:
        factors.append(f"{total_bookings} completed booking(s)")
    else:
        factors.append("No booking history yet")
    if preferred and preferred.get("package__category"):
        factors.append(f"Prefers {preferred['package__category']} package category")
    if avg_booking_value > 0:
        factors.append(f"Average booking value: ₱{avg_booking_value:,.2f}")
    factors.append("Renewal profile rebuilt from live booking records")

    if not preferred_package_type and preferred and preferred.get("package__category"):
        preferred_package_type = str(preferred["package__category"]).strip()

    return Response(
        {
            "customer_id": customer.customer_id,
            "customer_name": customer.full_name or "Customer",
            "renewal_probability": round(probability, 4),
            "predicted_renewal": probability >= 0.5,
            "renewal_band": band,
            "status_text": status_text,
            "total_bookings": total_bookings,
            "booking_frequency": round(booking_frequency, 2),
            "preferred_package_type": preferred_package_type or "N/A",
            "avg_booking_value": round(avg_booking_value, 2),
            "total_spent": round(total_spent, 2),
            "key_factors": factors[:5],
            "generated_at": _now_iso(),
        },
        status=status.HTTP_200_OK,
    )


def _append_batch_import_error(errors, row_index, message):
    errors.append({"row_index": row_index, "error": message})


def _resolve_batch_customer(row):
    customer_id_raw = row.get("customer_id")
    customer_email = (row.get("customer_email") or "").strip()
    if customer_id_raw is not None and str(customer_id_raw).strip() != "":
        return Customer.objects.get(pk=int(customer_id_raw))
    if customer_email:
        return Customer.objects.get(email__iexact=customer_email)
    raise ValueError("missing_customer")


def _resolve_batch_package(row):
    package_id_raw = row.get("package_id")
    if package_id_raw is None or str(package_id_raw).strip() == "":
        return None
    return Package.objects.get(pk=int(package_id_raw))


def _resolve_batch_total_price(row, package):
    total_price = row.get("total_price")
    if total_price is None and package is not None:
        total_price = float(package.promo_price or package.price or 0.0)
    return float(total_price) if total_price is not None else None


def _parse_batch_session_date(raw_session_date):
    if raw_session_date in (None, ""):
        return None
    parsed = parse_datetime(str(raw_session_date))
    if parsed is None:
        raise ValueError("invalid_session_date")
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


@api_view(["POST"])
@permission_classes([AllowAny])
def bookings_import_batch(request):
    """
    POST /api/bookings/import-batch/
    Body: { "rows": [ { customer_id | customer_email, package_id?, session_date?, session_status?, total_price? }, ... ] }
    Creates Booking rows and recomputes renewal profiles. See frontend booking-import-format.js for schema.
    """
    request_user = _get_request_user(request)
    if not _is_admin_or_owner_user(request_user):
        return Response(
            {"detail": "Only ADMIN or OWNER can import booking data."},
            status=status.HTTP_403_FORBIDDEN,
        )

    rows = request.data.get("rows")
    if not isinstance(rows, list):
        return Response(
            {"detail": "Request body must include a JSON array in 'rows'."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    errors = []
    created_ids = []

    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            _append_batch_import_error(errors, idx, "Each row must be an object.")
            continue

        try:
            customer = _resolve_batch_customer(row)
        except ValueError:
            _append_batch_import_error(
                errors, idx, "Provide customer_id or customer_email."
            )
            continue
        except (Customer.DoesNotExist, TypeError):
            _append_batch_import_error(errors, idx, "Customer not found.")
            continue

        try:
            package = _resolve_batch_package(row)
        except (Package.DoesNotExist, ValueError, TypeError):
            _append_batch_import_error(errors, idx, "Invalid package_id.")
            continue

        try:
            total_price_f = _resolve_batch_total_price(row, package)
        except (TypeError, ValueError):
            _append_batch_import_error(errors, idx, "total_price must be numeric.")
            continue

        if total_price_f is None:
            _append_batch_import_error(
                errors, idx, "total_price is required when package_id is missing."
            )
            continue

        session_status = (row.get("session_status") or "BOOKED") or "BOOKED"
        try:
            session_date = _parse_batch_session_date(row.get("session_date"))
        except ValueError:
            _append_batch_import_error(
                errors, idx, "session_date must be ISO 8601 datetime."
            )
            continue

        booking = Booking.objects.create(
            customer=customer,
            package=package,
            session_status=session_status,
            session_date=session_date,
            total_price=total_price_f,
        )
        recompute_customer_renewal_profile(customer)
        created_ids.append(booking.pk)

    actor_name = _get_request_sender_label(request)
    _write_action_log(
        request,
        "bookings_import_batch",
        f"{actor_name} imported {len(created_ids)} booking(s)"
        + (f" with {len(errors)} row error(s)" if errors else ""),
        metadata={
            "created_count": len(created_ids),
            "created_ids": created_ids[:100],
            "errors_count": len(errors),
            "rows_submitted": len(rows),
        },
    )

    return Response(
        {
            "created_count": len(created_ids),
            "created_ids": created_ids,
            "errors": errors,
        },
        status=status.HTTP_200_OK,
    )


@api_view(["GET"])
def popular_recommendations(request):
    """
    GET /api/recommendations/popular/?k=3

    Returns top-K globally popular package+addon combos based on real booking
    history. Uses the same response shape as customer_recommendations so the
    frontend can use one unified card renderer.

    Response:
    {
      "recommendations": [
        {
          "package":     { ...PackageSerializer fields... },
          "addons":      [ { ...AddonSerializer fields... }, ... ],
          "base_price":  float,
          "total_price": float,
          "score":       int,          # booking_count for this package
          "source":      "popularity"
        },
        ...
      ],
      "count": 3,
      "generated_at": "2025-..."
    }
    """
    k = int(request.GET.get("k", 3))

    popular_pkgs = get_global_popular_packages(k)

    result = []
    for pkg in popular_pkgs:
        try:
            package_data = PackageSerializer(pkg).data
            addons_qs    = get_popular_addons_for_package(pkg.id, top_m=4)
            addons_list  = AddonSerializer(addons_qs, many=True).data
            base_price   = float(pkg.promo_price or pkg.price or 0)
            addon_total  = sum(float(a.get("price") or 0) for a in addons_list)
            booking_count = getattr(pkg, "booking_count", 0)
            result.append({
                "package":     package_data,
                "addons":      addons_list,
                "base_price":  base_price,
                "total_price": round(base_price + addon_total, 2),
                "score":       int(booking_count),
                "source":      "popularity",
            })
        except Exception as e:
            logger.warning(f"popular_recommendations: skipping pkg {pkg.id}: {e}")
            continue

    return Response({
        "recommendations": result,
        "count":           len(result),
        "generated_at":    _now_iso(),
    }, status=status.HTTP_200_OK)


def _rebuild_recommender_exports_and_artifacts():
    """
    Internal helper used by both:
      - POST /api/recommendations/rebuild/
      - POST /api/analytics/model-metrics/recompute-recommendation/
    """
    import os, csv
    from django.db.models import F
    from recommender.popularity_builder import build_monthly_popularity
    import recommender.service as svc

    BOOKINGS_CSV      = "recommender/data/merged_bookings.csv"
    BOOKING_ADDONS_CSV = "recommender/data/booking_addons.csv"
    ARTIFACTS_DIR      = "recommender/artifacts"

    os.makedirs("recommender/data", exist_ok=True)
    os.makedirs(ARTIFACTS_DIR,      exist_ok=True)

    # ── 1. Export bookings from DB → CSV ────────────────────────────────────
    # "customer_id" clashes with Django's auto FK column on Booking.customer,
    # so we alias it as "cust_pk" and remap when writing the CSV row.
    bookings_qs = (
        Booking.objects.filter(session_status__in=ACCEPTED_BOOKING_STATUSES)
        .select_related("customer", "package")
        .values(
            booking_id = F("id"),
            cust_pk    = F("customer__customer_id"),   # alias avoids clash
            pkg_id     = F("package__id"),
            s_date     = F("session_date"),
            s_status   = F("session_status"),
        )
    )
    with open(BOOKINGS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "booking_id", "customer_id", "package_id",
            "session_date", "session_status",
        ])
        writer.writeheader()
        for row in bookings_qs:
            writer.writerow({
                "booking_id":     row["booking_id"],
                "customer_id":    row["cust_pk"],           # remap → CSV column
                "package_id":     row["pkg_id"],
                "session_date":   str(row["s_date"]) if row["s_date"] else None,
                "session_status": row["s_status"] or "",
            })

    # ── 2. Export booking_addons from DB → CSV ───────────────────────────────
    # booking_id and addon_id would clash with Django's auto FK columns on
    # BookingAddon.booking and BookingAddon.addon, so we read them directly
    # via select_related and build plain dicts instead.
    ba_rows = (
        BookingAddon.objects
        .select_related("booking", "addon")
        .only("booking_id", "addon_id", "addon_quantity")
    )
    with open(BOOKING_ADDONS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["booking_id", "addon_id", "addon_quantity"])
        writer.writeheader()
        for ba in ba_rows:
            writer.writerow({
                "booking_id":     ba.booking_id,
                "addon_id":       ba.addon_id,
                "addon_quantity":  ba.addon_quantity or 0,
            })

    # ── 3. Rebuild popularity artifact CSVs ─────────────────────────────────
    # Validate the CSV we just wrote parses cleanly before passing to builder.
    # Rows with no session_date are dropped because popularity is month-keyed.
    import pandas as _pd
    _bk = _pd.read_csv(BOOKINGS_CSV, low_memory=False)
    _bk["session_date"] = _pd.to_datetime(_bk["session_date"], errors="coerce")
    _bk = _bk.dropna(subset=["session_date"])
    _bk.to_csv(BOOKINGS_CSV, index=False)   # overwrite with clean version
    del _bk, _pd

    build_monthly_popularity(BOOKINGS_CSV, BOOKING_ADDONS_CSV, ARTIFACTS_DIR)

    # ── 4. Bust in-memory service caches ─────────────────────────────────────
    svc._popular_packages_cache = None
    svc._popular_combos_cache   = None
    svc._addon_counts_cache      = None

    return {
        "status":              "ok",
        "message":             "Popularity artifacts rebuilt and caches cleared.",
        "bookings_exported":   bookings_qs.count(),
        "customers_exported":  Customer.objects.count(),
    }


@api_view(["POST"])
def rebuild_popularity(request):
    """
    POST /api/recommendations/rebuild/
    """
    try:
        payload = _rebuild_recommender_exports_and_artifacts()
    except Exception as e:
        logger.exception("rebuild_popularity failed")
        return Response(
            {"detail": f"Artifact rebuild failed: {e}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    _write_action_log(
        request,
        "recommendation_rebuild",
        f"{_get_request_sender_label(request)} rebuilt recommendation popularity artifacts",
        metadata={"status": payload.get("status"), "bookings_exported": payload.get("bookings_exported")},
    )
    return Response(payload, status=status.HTTP_200_OK)


@api_view(["GET"])
def dashboard_analytics(request):
    """
    GET /api/analytics/dashboard/

    Returns all chart data for the dashboard in one round-trip:

    {
      "risk_overview": {
          "very_unlikely": int,   # customers with low booking frequency, not renewed
          "unlikely":      int,   # low-ish frequency, renewed
          "likely":        int,   # moderate frequency, not renewed
          "very_likely":   int,   # high frequency, renewed
          "booking_rate":  float  # ratio of renewed customers / total with renewal records
      },
      "booking_trends": {
          "labels":   ["2024-10", "2024-11", ...],  # last 12 months YYYY-MM
          "bookings": [12, 8, ...],                  # total bookings per month
          "revenue":  [12500.0, 9800.0, ...]         # total revenue per month
      },
      "package_popularity": {
          "labels":   ["Jan 2025", "Feb 2025", ...],  # last 6 months
          "packages": ["Delight", "Ecstasy", ...],    # top-N package names
          "datasets": [                                # one per package
              {"label": "Delight", "data": [4, 6, 3, 5, 8, 7]},
              ...
          ]
      }
    }
    """
    from backend.models import Renewal
    from django.utils import timezone
    from datetime import timedelta
    from dateutil.relativedelta import relativedelta
    import calendar

    # ── 1. RISK OVERVIEW ─────────────────────────────────────────────────────
    # Segment customers using Renewal records.
    # Axis A: renewed_within_366 (True/False)
    # Axis B: booking_frequency quartile (above/below median)
    # If no Renewal records yet, fall back to raw booking-count segmentation.

    renewal_qs = Renewal.objects.all()
    risk_data = {"very_unlikely": 0, "unlikely": 0, "likely": 0, "very_likely": 0, "booking_rate": 0.0}

    if renewal_qs.exists():
        # Compute median booking_frequency across all renewal records
        freqs = list(renewal_qs.values_list("booking_frequency", flat=True))
        freqs_sorted = sorted(f for f in freqs if f is not None)
        if freqs_sorted:
            mid = len(freqs_sorted) // 2
            median_freq = (
                (freqs_sorted[mid - 1] + freqs_sorted[mid]) / 2
                if len(freqs_sorted) % 2 == 0
                else freqs_sorted[mid]
            )
        else:
            median_freq = 1.0

        for r in renewal_qs:
            freq = r.booking_frequency or 0
            renewed = bool(r.renewed_within_366)
            high_freq = freq >= median_freq
            if not renewed and not high_freq:
                risk_data["very_unlikely"] += 1
            elif not renewed and high_freq:
                risk_data["unlikely"] += 1
            elif renewed and not high_freq:
                risk_data["likely"] += 1
            else:
                risk_data["very_likely"] += 1

        total_with_records = renewal_qs.count()
        renewed_count = renewal_qs.filter(renewed_within_366=True).count()
        risk_data["booking_rate"] = round(renewed_count / total_with_records, 2) if total_with_records else 0.0

    else:
        # Fallback: segment by raw booking count tiers (no Renewal table data)
        cust_booking_counts = (
            Customer.objects
            .annotate(bc=Count("bookings"))
            .values_list("bc", flat=True)
        )
        counts = sorted(cust_booking_counts)
        total = len(counts)
        if total:
            q1 = counts[total // 4]
            q3 = counts[(3 * total) // 4]
            for bc in counts:
                if bc <= q1:
                    risk_data["very_unlikely"] += 1
                elif bc <= q3:
                    risk_data["unlikely"] += 1
                else:
                    risk_data["likely"] += 1
            # very_likely = customers with bookings above q3 + repeat bookings
            risk_data["very_likely"] = max(0, risk_data["likely"] - total // 5)
            total_booked = sum(1 for bc in counts if bc > 0)
            risk_data["booking_rate"] = round(total_booked / total, 2) if total else 0.0

    # ── 2–3. BOOKING TRENDS + PACKAGE POPULARITY (optional date_from / date_to) ─
    from collections import defaultdict
    from django.utils.dateparse import parse_date

    now = timezone.now()
    twelve_months_ago = now - timedelta(days=365)
    six_months_ago = now - relativedelta(months=6)

    date_from_s = (request.query_params.get("date_from") or "").strip()
    date_to_s = (request.query_params.get("date_to") or "").strip()
    df = parse_date(date_from_s) if date_from_s else None
    dt = parse_date(date_to_s) if date_to_s else None
    use_custom_range = df is not None and dt is not None
    if use_custom_range and df > dt:
        df, dt = dt, df
    if use_custom_range and (dt - df).days > 730:
        return Response(
            {"detail": "date range cannot exceed 730 days"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if use_custom_range:
        trend_start = timezone.make_aware(datetime.combine(df, datetime.min.time()))
        trend_end = timezone.make_aware(datetime.combine(dt, datetime.max.time()))
        pop_filter_start = trend_start
        pop_filter_end = trend_end
    else:
        trend_start = twelve_months_ago
        trend_end = now
        pop_filter_start = six_months_ago
        pop_filter_end = now

    booking_base = Booking.objects.annotate(
        event_date=Coalesce("session_date", "created_at")
    ).filter(event_date__gte=trend_start, event_date__lte=trend_end)

    monthly_bookings = (
        booking_base.annotate(month=TruncMonth("event_date"))
        .values("month")
        .annotate(
            booking_count=Count("id"),
            revenue=Sum("total_price"),
        )
        .order_by("month")
    )

    month_map = {
        row["month"].strftime("%Y-%m"): row
        for row in monthly_bookings
        if row["month"]
    }

    trend_labels, trend_bookings, trend_revenue = [], [], []
    if use_custom_range:
        cur = df.replace(day=1)
        end_m = dt.replace(day=1)
        while cur <= end_m:
            key = cur.strftime("%Y-%m")
            trend_labels.append(cur.strftime("%b %Y"))
            row = month_map.get(key)
            trend_bookings.append(row["booking_count"] if row else 0)
            trend_revenue.append(round(row["revenue"] or 0, 2) if row else 0.0)
            cur = cur + relativedelta(months=1)
    else:
        for i in range(11, -1, -1):
            m = now - relativedelta(months=i)
            key = m.strftime("%Y-%m")
            trend_labels.append(m.strftime("%b %Y"))
            row = month_map.get(key)
            trend_bookings.append(row["booking_count"] if row else 0)
            trend_revenue.append(round(row["revenue"] or 0, 2) if row else 0.0)

    booking_trends = {
        "labels":   trend_labels,
        "bookings": trend_bookings,
        "revenue":  trend_revenue,
    }

    package_popularity = {"labels": [], "packages": [], "datasets": []}
    PALETTE = ["#165166", "#9BB5BC", "#4F9BB8", "#E8A838", "#6BA38A"]

    pkg_qs = (
        Booking.objects.annotate(event_date=Coalesce("session_date", "created_at"))
        .filter(
            event_date__gte=pop_filter_start,
            event_date__lte=pop_filter_end,
            package__isnull=False,
        )
    )
    pkg_monthly = (
        pkg_qs.annotate(month=TruncMonth("event_date"))
        .values("month", "package__id", "package__name")
        .annotate(count=Count("id"))
        .order_by("month", "-count")
    )

    pkg_totals = {}
    current_month_counts = {}
    current_month_key = now.strftime("%Y-%m")
    for row in pkg_monthly:
        pid = row["package__id"]
        if pid is None:
            continue
        pkg_totals[pid] = pkg_totals.get(pid, 0) + row["count"]
        if row["month"] and row["month"].strftime("%Y-%m") == current_month_key:
            current_month_counts[pid] = current_month_counts.get(pid, 0) + row["count"]

    top_pkg_ids = []
    for pid, _ in sorted(current_month_counts.items(), key=lambda kv: kv[1], reverse=True):
        if pid not in top_pkg_ids:
            top_pkg_ids.append(pid)
        if len(top_pkg_ids) >= 5:
            break
    for pid in sorted(pkg_totals, key=pkg_totals.get, reverse=True):
        if pid not in top_pkg_ids:
            top_pkg_ids.append(pid)
        if len(top_pkg_ids) >= 5:
            break

    if use_custom_range:
        recent_month_keys = []
        pop_labels = []
        cur = df.replace(day=1)
        end_m = dt.replace(day=1)
        while cur <= end_m:
            recent_month_keys.append(cur.strftime("%Y-%m"))
            pop_labels.append(cur.strftime("%b '%y"))
            cur = cur + relativedelta(months=1)
    else:
        recent_month_keys = [
            (now - relativedelta(months=i)).strftime("%Y-%m")
            for i in range(5, -1, -1)
        ]
        pop_labels = [
            datetime.strptime(mk, "%Y-%m").strftime("%b '%y")
            for mk in recent_month_keys
        ]

    month_pkg_counts = defaultdict(lambda: defaultdict(int))
    pkg_names = {}
    for row in pkg_monthly:
        if row["package__id"] in top_pkg_ids and row["month"]:
            mk = row["month"].strftime("%Y-%m")
            month_pkg_counts[mk][row["package__id"]] = row["count"]
            pkg_names[row["package__id"]] = row["package__name"]

    datasets = []
    for idx, pid in enumerate(top_pkg_ids):
        data_points = [
            month_pkg_counts[mk].get(pid, 0)
            for mk in recent_month_keys
        ]
        datasets.append(
            {
                "label": pkg_names.get(pid, f"Pkg #{pid}"),
                "data": data_points,
                "backgroundColor": PALETTE[idx % len(PALETTE)],
            }
        )

    package_popularity = {
        "labels": pop_labels,
        "packages": [pkg_names.get(pid, f"Pkg #{pid}") for pid in top_pkg_ids],
        "datasets": datasets,
    }

    applied_from = date_from_s if use_custom_range else twelve_months_ago.date().isoformat()
    applied_to = date_to_s if use_custom_range else now.date().isoformat()

    return Response({
        "risk_overview":       risk_data,
        "booking_trends":      booking_trends,
        "package_popularity":  package_popularity,
        "filters": {
            "date_from": applied_from,
            "date_to":   applied_to,
            "custom":    use_custom_range,
        },
    }, status=status.HTTP_200_OK)


def _parse_recommender_csv_value(value):
    if value is None:
        return value
    text = str(value).strip()
    if text == "":
        return text
    try:
        num = float(text)
        if num.is_integer() and ("." not in text):
            return int(num)
        return num
    except (TypeError, ValueError):
        return text


def _read_single_row_metrics(path_obj):
    if not path_obj.exists():
        return None
    with open(path_obj, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        row = next(reader, None)
        if not row:
            return None
        parsed = {}
        for k, v in row.items():
            try:
                parsed[k] = float(v)
            except (TypeError, ValueError):
                parsed[k] = v
        return parsed


def _mean_of_field(rows, field):
    vals = []
    for row in rows:
        try:
            vals.append(float(row.get(field, 0) or 0))
        except (TypeError, ValueError):
            continue
    return (sum(vals) / len(vals)) if vals else 0.0


def _std_of_field(rows, field):
    vals = []
    for row in rows:
        try:
            vals.append(float(row.get(field, 0) or 0))
        except (TypeError, ValueError):
            continue
    if not vals:
        return 0.0
    mean = sum(vals) / len(vals)
    variance = sum((x - mean) ** 2 for x in vals) / len(vals)
    return variance ** 0.5


def _read_recommender_summary(path_obj):
    if not path_obj.exists():
        return None

    rows = []
    with open(path_obj, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            parsed_row = {k: _parse_recommender_csv_value(v) for k, v in row.items()}
            rows.append(parsed_row)

    if not rows:
        return None

    columns = list(rows[0].keys())
    numeric_fields = []
    for col in columns:
        if all(isinstance(r.get(col), (int, float)) for r in rows if r.get(col) != ""):
            numeric_fields.append(col)

    user_count = len(rows)
    hit3_count = sum(
        1 for r in rows if str(r.get("hit@3", "0")).strip() in ("1", "1.0", "True", "true")
    )
    hit5_count = sum(
        1 for r in rows if str(r.get("hit@5", "0")).strip() in ("1", "1.0", "True", "true")
    )

    summary = {
        "rows_evaluated": user_count,
        "ndcg_at_3": _mean_of_field(rows, "ndcg@3"),
        "ndcg_at_5": _mean_of_field(rows, "ndcg@5"),
        "hit_rate_at_3": _mean_of_field(rows, "hit@3"),
        "hit_rate_at_5": _mean_of_field(rows, "hit@5"),
        "users_with_hit_at_3": hit3_count,
        "users_with_hit_at_5": hit5_count,
        "user_coverage_at_3": (hit3_count / user_count) if user_count else 0.0,
        "user_coverage_at_5": (hit5_count / user_count) if user_count else 0.0,
    }
    summary["ndcg_at_3_std"] = _std_of_field(rows, "ndcg@3")
    summary["ndcg_at_5_std"] = _std_of_field(rows, "ndcg@5")
    summary["hit_rate_at_3_percent"] = summary["hit_rate_at_3"] * 100.0
    summary["hit_rate_at_5_percent"] = summary["hit_rate_at_5"] * 100.0

    return {
        "summary": summary,
        "details": {
            "columns": columns,
            "numeric_fields": numeric_fields,
            "rows": rows,
        },
    }


def _build_live_recommender_summary():
    candidates = list(
        Customer.objects.annotate(booking_count=Count("bookings"))
        .filter(booking_count__gte=2)
        .only("customer_id")
    )
    if not candidates:
        return None

    ndcg3_vals, ndcg5_vals = [], []
    hit3_vals, hit5_vals = [], []

    for customer in candidates:
        recent_booking = (
            Booking.objects.filter(
                customer=customer,
                package__isnull=False,
                session_status__in=ACCEPTED_BOOKING_STATUSES,
            )
            .annotate(event_date=Coalesce("session_date", "created_at"))
            .order_by("-event_date", "-id")
            .first()
        )
        if not recent_booking or not recent_booking.package_id:
            continue

        recs = get_recommendations(customer.customer_id, datetime.now().date(), k=5)
        payload = build_recommendation_response(
            customer,
            recs,
            datetime.now().strftime("%Y-%m-%d"),
            k=5,
        )
        pkg_ids = [
            int(r["package"]["id"])
            for r in payload.get("recommendations", [])
            if r.get("package") and r["package"].get("id") is not None
        ]
        if not pkg_ids:
            continue

        target = int(recent_booking.package_id)

        def ndcg_at(k):
            top = pkg_ids[:k]
            if target not in top:
                return 0.0
            rank = top.index(target) + 1
            return 1.0 / math.log2(rank + 1)

        hit3 = 1.0 if target in pkg_ids[:3] else 0.0
        hit5 = 1.0 if target in pkg_ids[:5] else 0.0

        ndcg3_vals.append(ndcg_at(3))
        ndcg5_vals.append(ndcg_at(5))
        hit3_vals.append(hit3)
        hit5_vals.append(hit5)

    rows = len(hit5_vals)
    if rows == 0:
        return None

    users_with_hit3 = int(sum(hit3_vals))
    users_with_hit5 = int(sum(hit5_vals))
    return {
        "rows_evaluated": rows,
        "ndcg_at_3": float(sum(ndcg3_vals) / rows),
        "ndcg_at_5": float(sum(ndcg5_vals) / rows),
        "hit_rate_at_3": float(sum(hit3_vals) / rows),
        "hit_rate_at_5": float(sum(hit5_vals) / rows),
        "users_with_hit_at_3": users_with_hit3,
        "users_with_hit_at_5": users_with_hit5,
        "user_coverage_at_3": float(users_with_hit3 / rows),
        "user_coverage_at_5": float(users_with_hit5 / rows),
    }


@api_view(["GET"])
@permission_classes([AllowAny])
def dashboard_model_metrics(request):
    """
    GET /api/analytics/model-metrics/
    Returns evaluation artifacts for renewal and recommendation models.
    """
    base_dir = Path(settings.BASE_DIR)
    renewal_saved_path = base_dir / "renewal" / "outputs" / "xgboost_saved_model_results.csv"
    renewal_engineered_path = base_dir / "renewal" / "outputs" / "xgboost_engineered_results.csv"
    recommender_path = base_dir / "recommender" / "results" / "evaluation_results.csv"
    allow_live_fallback = (
        str(request.query_params.get("live_fallback", "0")).strip().lower()
        in ("1", "true", "yes")
    )

    try:
        renewal_saved = _read_single_row_metrics(renewal_saved_path)
        renewal_engineered = _read_single_row_metrics(renewal_engineered_path)
        recommender_payload = _read_recommender_summary(recommender_path)
        recommender_summary = recommender_payload["summary"] if recommender_payload else None
        recommender_details = recommender_payload["details"] if recommender_payload else None
        if recommender_summary and allow_live_fallback:
            signal_sum = (
                float(recommender_summary.get("ndcg_at_3", 0) or 0)
                + float(recommender_summary.get("ndcg_at_5", 0) or 0)
                + float(recommender_summary.get("hit_rate_at_3", 0) or 0)
                + float(recommender_summary.get("hit_rate_at_5", 0) or 0)
            )
            if signal_sum == 0:
                try:
                    live_summary = _build_live_recommender_summary()
                except Exception as exc:
                    logger.warning(
                        "dashboard_model_metrics live recommender fallback failed: %s",
                        exc,
                    )
                    live_summary = None
                if live_summary:
                    recommender_summary = live_summary
                    recommender_details = None
    except Exception as exc:
        logger.exception("dashboard_model_metrics failed to load metrics")
        renewal_saved = None
        renewal_engineered = None
        recommender_summary = None
        recommender_details = None
        return Response(
            _build_model_metrics_response(
                base_dir,
                renewal_saved_path,
                renewal_engineered_path,
                recommender_path,
                renewal_saved,
                renewal_engineered,
                recommender_summary,
                recommender_details,
                error=exc,
            ),
            status=status.HTTP_200_OK,
        )

    return Response(
        _build_model_metrics_response(
            base_dir,
            renewal_saved_path,
            renewal_engineered_path,
            recommender_path,
            renewal_saved,
            renewal_engineered,
            recommender_summary,
            recommender_details,
        ),
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def recompute_recommendation_model_metrics(request):
    """
    POST /api/analytics/model-metrics/recompute-recommendation/
    Re-runs recommender evaluation and regenerates:
      recommender/results/evaluation_results.csv
    """
    base_dir = Path(settings.BASE_DIR)
    scripts = [
        base_dir / "recommender" / "data_builder.py",
        base_dir / "recommender" / "create_train_test_split.py",
        base_dir / "recommender" / "trainer.py",
        base_dir / "recommender" / "evaluate_model.py",
    ]
    output_path = base_dir / "recommender" / "results" / "evaluation_results.csv"

    missing = [str(p) for p in scripts if not p.exists()]
    if missing:
        return Response(
            {"detail": "One or more recommender scripts are missing.", "missing": missing},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)

    before_hash = _file_sha256(output_path)
    before_mtime = output_path.stat().st_mtime if output_path.exists() else None

    # First, rebuild popularity artifacts/exports from live DB.
    try:
        rebuild_payload = _rebuild_recommender_exports_and_artifacts()
    except Exception as exc:
        logger.exception(
            "recompute_recommendation_model_metrics: prerequisite rebuild failed"
        )
        return Response(
            {
                "detail": "Failed to rebuild recommendation data/artifacts before evaluation.",
                "rebuild_error": str(exc),
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    pipeline_results = []
    try:
        for script_path in scripts:
            proc = subprocess.run(
                [sys.executable, str(script_path)],
                cwd=str(base_dir),
                capture_output=True,
                text=True,
                timeout=300,
            )
            stage = script_path.name
            pipeline_results.append(
                {
                    "stage": stage,
                    "returncode": proc.returncode,
                    "stdout_tail": proc.stdout[-1200:],
                    "stderr_tail": proc.stderr[-1200:],
                }
            )
            if proc.returncode != 0:
                logger.error(
                    "recompute_recommendation_model_metrics stage failed (%s): %s",
                    stage,
                    proc.stderr.strip() or proc.stdout.strip(),
                )
                return Response(
                    {
                        "detail": f"Recommendation pipeline failed at {stage}.",
                        "pipeline": pipeline_results,
                    },
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
    except subprocess.TimeoutExpired:
        return Response(
            {
                "detail": "Recommendation pipeline timed out.",
                "pipeline": pipeline_results,
            },
            status=status.HTTP_504_GATEWAY_TIMEOUT,
        )
    except Exception as exc:
        logger.exception("recompute_recommendation_model_metrics failed to start")
        return Response(
            {"detail": f"Failed to start evaluation: {exc}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    after_hash = _file_sha256(output_path)
    after_mtime = output_path.stat().st_mtime if output_path.exists() else None
    changed = bool(before_hash != after_hash or before_mtime != after_mtime)

    # Quick post-run sanity stats from regenerated CSV.
    rows = 0
    nonzero = {"ndcg@3": 0, "hit@3": 0, "ndcg@5": 0, "hit@5": 0}
    if output_path.exists():
        with open(output_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows += 1
                for k in nonzero.keys():
                    try:
                        if float(row.get(k, 0) or 0) != 0:
                            nonzero[k] += 1
                    except (TypeError, ValueError):
                        continue

    response_payload = {
            "status": "ok",
            "message": "Recommendation pipeline completed (data→split→train→evaluate).",
            "rebuild": rebuild_payload,
            "output_file": str(output_path.relative_to(base_dir)),
            "rows": rows,
            "nonzero_counts": nonzero,
            "changed": changed,
            "before_hash": before_hash,
            "after_hash": after_hash,
            "before_mtime": before_mtime,
            "after_mtime": after_mtime,
            "pipeline": pipeline_results,
    }
    _write_action_log(
        request,
        "recommendation_metrics_recomputed",
        f"{_get_request_sender_label(request)} recomputed recommendation model metrics",
        metadata={"rows": rows, "changed": changed},
    )
    return Response(response_payload, status=status.HTTP_200_OK)


# ═══════════════════════════════════════════════════════════════════════════════
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
    return {
        "id": user.id,
        "name": name,
        "username": user.username,
        "email": user.email,
        "role": role,
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


def _is_admin_or_owner_user(user):
    if not user:
        return False
    return bool(getattr(user, "is_superuser", False) or getattr(user, "is_staff", False))


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


def _coupon_discount_preview(coupon):
    preview = (
        f"{coupon.discount_value}% off"
        if coupon.discount_type == Coupon.DISCOUNT_PERCENT
        else f"₱{coupon.discount_value:,.0f} off"
    )
    if coupon.max_discount_amount:
        preview += f" (max ₱{coupon.max_discount_amount:,.0f})"
    return preview


@api_view(["POST"])
def auth_login(request):
    email = (request.data.get("email") or "").strip()
    password = (request.data.get("password") or "").strip()

    if not email or not password:
        return Response(
            {"success": False, "error": "Username/email and password are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = _find_user_by_email_or_username(email)
    if not user:
        return Response(
            {"success": False, "error": "Invalid username/email or password."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    auth_user = authenticate(username=user.username, password=password)
    if not auth_user:
        return Response(
            {"success": False, "error": "Invalid username/email or password."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    if not auth_user.is_active:
        return Response(
            {"success": False, "error": "Account is inactive."},
            status=status.HTTP_403_FORBIDDEN,
        )

    token, _ = Token.objects.get_or_create(user=auth_user)
    profile = _get_profile(auth_user)
    needs_profile_setup = bool(
        profile.must_change_password or not profile.profile_completed
    )
    staff_profile = StaffProfile.objects.filter(user=auth_user).first()
    login_actor = (
        ((staff_profile.nickname or "").strip() if staff_profile else "")
        or (auth_user.get_full_name() or "").strip()
        or (auth_user.username or "").strip()
        or (auth_user.email or "").strip()
        or "User"
    )
    _write_action_log(
        request,
        "login",
        f"{login_actor} logged in",
        metadata={
            "user_id": auth_user.id,
            "email": auth_user.email or "",
        },
    )

    return Response(
        {
            "success": True,
            "token": token.key,
            "user": _build_user_payload(auth_user),
            "needs_profile_setup": needs_profile_setup,
            "profile": {
                "must_change_password": profile.must_change_password,
                "profile_completed": profile.profile_completed,
                "profile_photo_url": profile.profile_photo_url,
            },
        },
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
def auth_signup(request):
    request_user = _get_request_user(request)
    if not request_user or not (
        getattr(request_user, "is_staff", False) or getattr(request_user, "is_superuser", False)
    ):
        return Response(
            {"success": False, "error": "Only admin/owner can create staff accounts."},
            status=status.HTTP_403_FORBIDDEN,
        )

    first_name = (request.data.get("first_name") or "").strip()
    last_name = (request.data.get("last_name") or "").strip()
    username = (request.data.get("username") or "").strip()
    email = (request.data.get("email") or "").strip()
    password = request.data.get("password") or ""
    phone_number = (request.data.get("phone_number") or "").strip()
    nickname = (request.data.get("nickname") or "").strip()
    requested_role = (request.data.get("role") or "STAFF").strip().upper()

    if not first_name or not last_name or not username or not email:
        return Response(
            {
                "success": False,
                "error": "First name, last name, username, and email are required.",
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if requested_role not in {"STAFF", "ADMIN"}:
        return Response(
            {"success": False, "error": "Role must be STAFF or ADMIN."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if requested_role == "ADMIN" and not getattr(request_user, "is_superuser", False):
        return Response(
            {"success": False, "error": "Only owner/superadmin can create ADMIN accounts."},
            status=status.HTTP_403_FORBIDDEN,
        )

    User = get_user_model()
    if User.objects.filter(email__iexact=email).exists():
        return Response(
            {"success": False, "error": "Email already registered."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if User.objects.filter(username__iexact=username).exists():
        return Response(
            {"success": False, "error": "Username already taken."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    generated_password = ""
    if not password:
        generated_password = "123456"
        password = generated_password

    user = User.objects.create_user(
        username=username,
        email=email,
        first_name=first_name,
        last_name=last_name,
        password=password,
        is_staff=(requested_role == "ADMIN"),
        is_superuser=False,
    )
    profile = _get_profile(user)
    profile.must_change_password = True
    if phone_number:
        profile.phone_number = phone_number
    if nickname:
        profile.nickname = nickname
    profile.save(update_fields=["must_change_password", "phone_number", "nickname"])
    _write_action_log(
        request,
        "staff_created",
        (
            f"{_get_request_sender_label(request)} created {requested_role} account "
            f"for {first_name} {last_name}"
        ),
        metadata={
            "created_user_id": user.id,
            "username": username,
            "email": email,
            "role": requested_role,
        },
    )
    response_payload = {
        "success": True,
        "message": f"{requested_role} account created successfully.",
        "user": _build_user_payload(user),
    }
    if generated_password:
        response_payload["temporary_password"] = generated_password
        response_payload["message"] = (
            f"{requested_role} account created successfully. "
            f"Temporary password: {generated_password}"
        )

    return Response(response_payload, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def auth_reset_password(request):
    email = (request.data.get("email") or "").strip()
    if not email:
        return Response(
            {"success": False, "error": "Email is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = _find_user_by_email_or_username(email)
    if not user or not (user.is_staff or user.is_superuser):
        return Response(
            {
                "success": True,
                "message": "If the account exists, a temporary password was sent to the registered email.",
            },
            status=status.HTTP_200_OK,
        )

    already_pending = PasswordResetRequest.objects.filter(
        user=user,
        status=PasswordResetRequest.STATUS_PENDING,
    ).exists()
    if not already_pending:
        PasswordResetRequest.objects.create(
            user=user,
            requested_email=user.email or email,
            status=PasswordResetRequest.STATUS_PENDING,
        )

    return Response(
        {
            "success": True,
            "message": (
                "Request submitted. A superuser must approve it before a temporary password is emailed."
                if not already_pending
                else "A password reset request is already pending superuser approval."
            ),
        },
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
def auth_logout(request):
    token_key = _extract_token(request)
    if token_key:
        Token.objects.filter(key=token_key).delete()
    return Response({"success": True}, status=status.HTTP_200_OK)


@api_view(["GET", "PUT"])
def auth_profile(request):
    token_key = _extract_token(request)
    if not token_key:
        return Response(
            {"success": False, "error": "Authorization token missing."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    token = Token.objects.select_related("user").filter(key=token_key).first()
    if not token:
        return Response(
            {"success": False, "error": "Invalid token."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    user = token.user
    profile = _get_profile(user)

    if request.method == "GET":
        return Response(
            {
                "success": True,
                "user": _build_user_payload(user),
                "profile": {
                    "must_change_password": profile.must_change_password,
                    "profile_completed": profile.profile_completed,
                    "profile_photo_url": profile.profile_photo_url,
                    "phone_number": profile.phone_number,
                    "date_of_birth": (
                        profile.date_of_birth.isoformat()
                        if profile.date_of_birth
                        else None
                    ),
                    "nickname": profile.nickname,
                },
            },
            status=status.HTTP_200_OK,
        )

    first_name = (request.data.get("first_name") or "").strip()
    last_name = (request.data.get("last_name") or "").strip()
    username = (request.data.get("username") or "").strip()
    profile_photo_url = (request.data.get("profile_photo_url") or "").strip()
    new_password = request.data.get("new_password") or ""
    phone_number = (request.data.get("phone_number") or "").strip()
    nickname = (request.data.get("nickname") or "").strip()
    date_of_birth = (request.data.get("date_of_birth") or "").strip()
    previous_nickname = (profile.nickname or "").strip()
    previous_username = (user.username or "").strip()

    if username and username.lower() != (user.username or "").lower():
        User = get_user_model()
        if User.objects.exclude(id=user.id).filter(username__iexact=username).exists():
            return Response(
                {"success": False, "error": "Username already taken."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.username = username

    if (first_name or last_name) and not _is_admin_or_owner_user(user):
        return Response(
            {"success": False, "error": "STAFF cannot edit first or last name."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if first_name:
        user.first_name = first_name
    if last_name:
        user.last_name = last_name
    user_update_fields = []
    if first_name or last_name:
        user_update_fields.extend(["first_name", "last_name"])
    if username and username.lower() != previous_username.lower():
        user_update_fields.append("username")
    if user_update_fields:
        user.save(update_fields=user_update_fields)

    if profile_photo_url:
        profile.profile_photo_url = profile_photo_url
    if phone_number:
        profile.phone_number = phone_number
    if nickname:
        profile.nickname = nickname
    if date_of_birth:
        try:
            profile.date_of_birth = timezone.datetime.fromisoformat(
                date_of_birth
            ).date()
        except ValueError:
            return Response(
                {"success": False, "error": "Invalid date_of_birth format."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    if new_password:
        user.set_password(new_password)
        user.save(update_fields=["password"])
        profile.must_change_password = False

    if (
        not profile.must_change_password
        and profile.profile_photo_url
        and (user.first_name or user.last_name)
    ):
        profile.profile_completed = True

    profile.save(update_fields=[
        "profile_photo_url",
        "phone_number",
        "date_of_birth",
        "nickname",
        "must_change_password",
        "profile_completed",
    ])

    if nickname and nickname != previous_nickname:
        _write_action_log(
            request,
            "profile_nickname_changed",
            f"{_get_request_sender_label(request)} changed nickname to {nickname}",
            metadata={
                "user_id": user.id,
                "old_nickname": previous_nickname,
                "new_nickname": nickname,
            },
        )

    if new_password:
        _write_action_log(
            request,
            "profile_password_changed",
            f"{_get_request_sender_label(request)} changed account password",
            metadata={
                "user_id": user.id,
            },
        )

    if username and username.lower() != previous_username.lower():
        _write_action_log(
            request,
            "profile_username_changed",
            f"{_get_request_sender_label(request)} changed username to {user.username}",
            metadata={
                "user_id": user.id,
                "old_username": previous_username,
                "new_username": user.username,
            },
        )

    return Response(
        {
            "success": True,
            "message": "Profile updated successfully.",
            "needs_profile_setup": bool(
                profile.must_change_password or not profile.profile_completed
            ),
        },
        status=status.HTTP_200_OK,
    )


def _staff_account_payload(user):
    profile = StaffProfile.objects.filter(user=user).first()
    return {
        "id": user.id,
        "first_name": user.first_name or "",
        "last_name": user.last_name or "",
        "username": user.username or "",
        "email": user.email or "",
        "role": _role_name_for_user(user),
        "is_active": bool(user.is_active),
        "profile": {
            "phone_number": (profile.phone_number or "") if profile else "",
            "nickname": (profile.nickname or "") if profile else "",
            "profile_photo_url": (profile.profile_photo_url or "") if profile else "",
            "must_change_password": bool(profile.must_change_password) if profile else True,
            "profile_completed": bool(profile.profile_completed) if profile else False,
        },
    }


@api_view(["GET"])
def auth_staff_accounts(request):
    request_user = _get_request_user(request)
    if not _is_admin_or_owner_user(request_user):
        return Response(
            {"success": False, "error": "Only admin/owner can manage staff accounts."},
            status=status.HTTP_403_FORBIDDEN,
        )

    User = get_user_model()
    if getattr(request_user, "is_superuser", False):
        qs = (
            User.objects.filter(
                Q(is_staff=True) | Q(is_superuser=True) | Q(staff_profile__isnull=False)
            )
            .distinct()
            .order_by("is_superuser", "is_staff", "first_name", "last_name", "username")
        )
    else:
        # ADMIN can manage STAFF accounts only.
        qs = User.objects.filter(is_superuser=False, is_staff=False).order_by(
            "first_name", "last_name", "username"
        )
    return Response(
        {
            "success": True,
            "accounts": [_staff_account_payload(u) for u in qs],
        },
        status=status.HTTP_200_OK,
    )


@api_view(["PUT"])
def auth_staff_account_detail(request, user_id):
    request_user = _get_request_user(request)
    if not _is_admin_or_owner_user(request_user):
        return Response(
            {"success": False, "error": "Only admin/owner can manage staff accounts."},
            status=status.HTTP_403_FORBIDDEN,
        )

    User = get_user_model()
    target = User.objects.filter(id=user_id).first()
    if not target:
        return Response(
            {"success": False, "error": "Account not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    first_name = (request.data.get("first_name") or "").strip()
    last_name = (request.data.get("last_name") or "").strip()
    username = (request.data.get("username") or "").strip()
    email = (request.data.get("email") or "").strip()
    role = (request.data.get("role") or "STAFF").strip().upper()
    phone_number = (request.data.get("phone_number") or "").strip()
    nickname = (request.data.get("nickname") or "").strip()
    profile_photo_url = (request.data.get("profile_photo_url") or "").strip()
    new_password = request.data.get("new_password") or ""
    set_active = request.data.get("is_active")
    force_password_change = request.data.get("must_change_password")

    if not first_name or not last_name or not username or not email:
        return Response(
            {
                "success": False,
                "error": "First name, last name, username, and email are required.",
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if role not in {"STAFF", "ADMIN", "OWNER"}:
        return Response(
            {"success": False, "error": "Role must be STAFF, ADMIN, or OWNER."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    is_owner_request = bool(getattr(request_user, "is_superuser", False))
    if not is_owner_request:
        # ADMIN restrictions: only edit STAFF, cannot promote/demote roles.
        if getattr(target, "is_staff", False) or getattr(target, "is_superuser", False):
            return Response(
                {"success": False, "error": "ADMIN can only edit STAFF accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )
        role = "STAFF"

    if (
        User.objects.exclude(id=target.id)
        .filter(username__iexact=username)
        .exists()
    ):
        return Response(
            {"success": False, "error": "Username already taken."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if User.objects.exclude(id=target.id).filter(email__iexact=email).exists():
        return Response(
            {"success": False, "error": "Email already registered."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if target.id == request_user.id and role != "OWNER":
        return Response(
            {"success": False, "error": "You cannot remove your own OWNER role."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if target.id == request_user.id and set_active is False:
        return Response(
            {"success": False, "error": "You cannot deactivate your own account."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    previous_role = _role_name_for_user(target)

    target.first_name = first_name
    target.last_name = last_name
    target.username = username
    target.email = email
    target.is_superuser = role == "OWNER"
    target.is_staff = role in {"ADMIN", "OWNER"}
    if isinstance(set_active, bool):
        target.is_active = set_active

    update_fields = [
        "first_name",
        "last_name",
        "username",
        "email",
        "is_superuser",
        "is_staff",
        "is_active",
    ]
    if new_password:
        target.set_password(new_password)
        update_fields.append("password")
    target.save(update_fields=update_fields)

    profile = _get_profile(target)
    profile.phone_number = phone_number
    profile.nickname = nickname
    profile.profile_photo_url = profile_photo_url
    if isinstance(force_password_change, bool):
        profile.must_change_password = force_password_change
    profile.profile_completed = bool(profile.profile_photo_url and (target.first_name or target.last_name))
    profile.save(
        update_fields=[
            "phone_number",
            "nickname",
            "profile_photo_url",
            "must_change_password",
            "profile_completed",
        ]
    )

    updated_role = _role_name_for_user(target)
    role_action_type = {
        "STAFF": "staff_account_updated",
        "ADMIN": "admin_account_updated",
        "OWNER": "owner_account_updated",
    }.get(updated_role, "staff_account_updated")
    _write_action_log(
        request,
        role_action_type,
        f"{_get_request_sender_label(request)} updated account for {target.username}",
        metadata={
            "updated_user_id": target.id,
            "updated_username": target.username,
            "updated_email": target.email,
            "previous_role": previous_role,
            "updated_role": updated_role,
            "is_active": target.is_active,
            "password_changed": bool(new_password),
        },
    )

    return Response(
        {
            "success": True,
            "message": "Account updated successfully.",
            "account": _staff_account_payload(target),
        },
        status=status.HTTP_200_OK,
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

    qs = qs[:limit]
    return Response(ActionLogSerializer(qs, many=True).data, status=status.HTTP_200_OK)


# ═══════════════════════════════════════════════════════════════════════════════
# COUPON API (validate, customer coupons, cron)
# ═══════════════════════════════════════════════════════════════════════════════


@api_view(["POST"])
@permission_classes([AllowAny])
def coupon_validate(request):
    code = (request.data.get("code") or "").strip()
    customer_id = request.data.get("customer_id")
    subtotal = float(request.data.get("subtotal", 0) or 0)

    if not code:
        return Response(
            {"valid": False, "error": "Coupon code is required"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not customer_id:
        return Response(
            {"valid": False, "error": "Customer ID is required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    valid, discount_amount, coupon, error = validate_coupon_for_customer(
        code, customer_id, subtotal
    )
    if not valid:
        return Response(
            {"valid": False, "error": error},
            status=status.HTTP_200_OK,
        )
    return Response(
        {
            "valid": True,
            "discount_amount": round(discount_amount, 2),
            "coupon_id": coupon.id,
        },
        status=status.HTTP_200_OK,
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def customer_coupons(request, customer_id):
    customer = get_object_or_404(Customer, customer_id=customer_id)
    now = timezone.now()

    sent = CouponSent.objects.filter(customer=customer).select_related("coupon")
    usage_counts = {
        row["coupon_id"]: row["n"]
        for row in (
            CouponUsage.objects.filter(customer=customer)
            .values("coupon_id")
            .annotate(n=Count("id"))
        )
    }
    result = []
    for cs in sent:
        c = cs.coupon
        if c.expires_at and c.expires_at < now:
            continue
        limit_per_user = c.use_limit if c.use_limit is not None else c.per_customer_limit
        customer_used = usage_counts.get(c.id, 0)
        if customer_used >= limit_per_user:
            continue

        result.append({
            "id": c.id,
            "code": c.code,
            "discount_type": c.discount_type,
            "discount_value": c.discount_value,
            "max_discount_amount": c.max_discount_amount,
            "expires_at": c.expires_at.isoformat() if c.expires_at else None,
            "discount_preview": _coupon_discount_preview(c),
        })
    return Response(result)


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def email_templates(request):
    user = _get_request_user(request)
    if user is None:
        return Response({"detail": "Authentication required."}, status=status.HTTP_401_UNAUTHORIZED)

    if request.method == "GET":
        # Shared template library: visible to all staff users.
        qs = EmailTemplate.objects.all().order_by(Lower("name"), "-created_at")
        return Response(EmailTemplateSerializer(qs, many=True).data)

    serializer = EmailTemplateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    template = serializer.save(user=user, last_updated=timezone.now())
    _write_action_log(
        request,
        "email_template_created",
        f"{_get_request_sender_label(request)} created email template {template.name}",
        metadata={"template_id": template.id, "name": template.name},
    )
    return Response(EmailTemplateSerializer(template).data, status=status.HTTP_201_CREATED)


@api_view(["PUT", "DELETE"])
@permission_classes([AllowAny])
def email_template_detail(request, template_id):
    user = _get_request_user(request)
    if user is None:
        return Response({"detail": "Authentication required."}, status=status.HTTP_401_UNAUTHORIZED)

    # Shared template library: any authenticated staff can edit/delete.
    template = get_object_or_404(EmailTemplate, id=template_id)
    if request.method == "DELETE":
        template_name = template.name
        template.delete()
        _write_action_log(
            request,
            "email_template_deleted",
            f"{_get_request_sender_label(request)} deleted email template {template_name}",
            metadata={"template_id": template_id, "name": template_name},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = EmailTemplateSerializer(template, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    old_name = template.name
    saved = serializer.save(last_updated=timezone.now())
    _write_action_log(
        request,
        "email_template_updated",
        f"{_get_request_sender_label(request)} updated email template {saved.name}",
        metadata={
            "template_id": saved.id,
            "old_name": old_name,
            "new_name": saved.name,
        },
    )
    return Response(EmailTemplateSerializer(saved).data)


@api_view(["POST"])
@permission_classes([AllowAny])
def cron_send_coupon_emails(request):
    import os
    secret = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    expected = os.getenv("CRON_SECRET", "")
    if not expected or secret != expected:
        return Response({"detail": "Unauthorized"}, status=status.HTTP_401_UNAUTHORIZED)

    from django.core.mail import send_mail
    from django.conf import settings

    pending = CouponSent.objects.filter(email_sent_at__isnull=True).select_related(
        "coupon", "customer"
    )
    sent_count = 0
    for cs in pending:
        customer = cs.customer
        if not customer.email:
            continue
        subject = f"Your coupon: {cs.coupon.code}"
        desc = _coupon_discount_preview(cs.coupon)
        body = f"Hi {customer.full_name or 'Customer'},\n\nYou have received a coupon: {cs.coupon.code}"
        body += f"\n{desc}\n\nUse it at checkout!"
        try:
            send_mail(
                subject,
                body,
                getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@snaplytics.local"),
                [customer.email],
                fail_silently=False,
            )
            cs.email_sent_at = timezone.now()
            cs.save(update_fields=["email_sent_at"])
            sent_count += 1
        except Exception as e:
            logger.exception("Failed to send coupon email to %s: %s", customer.email, e)
    return Response({"sent_count": sent_count})
