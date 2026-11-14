"""Bookings, customer-scoped bookings, and batch booking import."""

from datetime import datetime, timedelta

from backend.booking_email import (
    notify_booking_completed_email,
    send_booking_confirmation_email,
)
from backend.loyalty_utils import maybe_credit_booking
from backend.models import Booking, Customer, Package
from backend.renewal_utils import recompute_customer_renewal_profile
from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ._common import (
    _get_request_sender_label,
    _get_request_user,
    _is_admin_or_owner_user,
    _snapshot_booking_for_action_log,
    _write_action_log,
    _write_booking_updated_action_log,
)
from ..permissions import StaffOrKioskAction
from ..serializers import BookingSerializer


# BOOKING VIEWSET
# ═══════════════════════════════════════════════════════════════════════════════


class BookingViewSet(viewsets.ModelViewSet):
    """
    Standard CRUD plus:
      GET   /api/bookings/?status=Pending,Ongoing  → notification panel feed
      PATCH /api/bookings/<id>/status/             → lightweight status mutation
    """

    serializer_class = BookingSerializer
    # Anonymous callers may only use kiosk_actions; see endpoints/permissions.py.
    permission_classes = [StaffOrKioskAction]
    # Staff only. (The kiosk's /admin queue now needs the staff app.)
    kiosk_actions = ()

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

    def perform_create(self, serializer):
        super().perform_create(serializer)
        booking = (
            Booking.objects.select_related("customer", "package", "coupon")
            .prefetch_related("bookingaddon_set__addon")
            .get(pk=serializer.instance.pk)
        )
        actor_name = _get_request_sender_label(self.request)
        cust = booking.customer
        cust_label = (
            (cust.full_name or ("customer #" + str(cust.pk)))
            if cust
            else "unknown customer"
        )
        _write_action_log(
            self.request,
            "booking_created",
            f"{actor_name} created booking #{booking.pk} for {cust_label}",
            metadata={
                "booking_id": booking.pk,
                "customer_id": cust.customer_id if cust else None,
                "customer_name": (cust.full_name or "") if cust else "",
                "session_status": booking.session_status or "",
            },
        )
        send_booking_confirmation_email(booking)

    def update(self, request, *args, **kwargs):
        """PUT/PATCH /api/bookings/<id>/ — log edits (e.g. coupon_id via patch from notif)."""
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        before = _snapshot_booking_for_action_log(instance)
        serializer = self.get_serializer(
            instance, data=request.data, partial=partial
        )
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        inst = (
            Booking.objects.select_related("customer", "package", "coupon")
            .prefetch_related("bookingaddon_set__addon")
            .get(pk=serializer.instance.pk)
        )
        after = _snapshot_booking_for_action_log(inst)
        _write_booking_updated_action_log(request, inst, before, after)
        return Response(BookingSerializer(inst).data)

    # ── POST /api/bookings/<id>/send-confirmation/ ─────────────────────────────
    @action(detail=True, methods=["post"], url_path="send-confirmation")
    def send_confirmation(self, request, pk=None):
        """SMTP booking confirmation (used when kiosk writes via pooler, not DRF create)."""
        booking = (
            Booking.objects.select_related("customer", "package", "coupon")
            .prefetch_related("bookingaddon_set__addon")
            .get(pk=self.get_object().pk)
        )
        sent = send_booking_confirmation_email(booking)
        return Response(
            {"sent": bool(sent), "booking_id": booking.pk},
            status=status.HTTP_200_OK,
        )

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
        if new_status == "BOOKED":
            maybe_credit_booking(booking.pk)
        notify_booking_completed_email(booking.pk, old_status)
        customer_name = (booking.customer.full_name or "").strip() if booking.customer else ""
        actor_name = _get_request_sender_label(request)
        actor_user = _get_request_user(request)
        prev_st = (old_status or "").strip()
        is_accept = prev_st == "Pending" and new_status == "Ongoing"
        if is_accept:
            _write_action_log(
                request,
                "booking_accepted",
                f"{actor_name} accepted booking #{booking.pk}"
                + (f" for {customer_name}" if customer_name else ""),
                metadata={
                    "booking_id": booking.pk,
                    "customer_id": booking.customer_id,
                    "customer_name": customer_name,
                    "from_status": old_status,
                    "to_status": new_status,
                    "accepted_by_label": actor_name,
                    "accepted_by_user_id": actor_user.pk
                    if actor_user and getattr(actor_user, "is_authenticated", False)
                    else None,
                },
            )
        else:
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

    # Anonymous callers may only use kiosk_actions; see endpoints/permissions.py.
    permission_classes = [StaffOrKioskAction]
    # Kiosk: submit a booking for a customer.
    kiosk_actions = ("create",)

    def _get_customer(self, customer_pk):
        return get_object_or_404(
            Customer.objects.filter(deleted_at__isnull=True),
            pk=customer_pk,
        )

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
        if not request.user.is_authenticated:
            # Kiosk (anonymous) bookings always start as Pending; staff accept them.
            data["session_status"] = "Pending"
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
        before = _snapshot_booking_for_action_log(booking)
        ser = BookingSerializer(booking, data=request.data, partial=False)
        ser.is_valid(raise_exception=True)
        ser.save()
        booking = self._get_booking(customer_pk, pk)
        after = _snapshot_booking_for_action_log(booking)
        _write_booking_updated_action_log(request, booking, before, after)
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


def _append_batch_import_error(errors, row_index, message):
    errors.append({"row_index": row_index, "error": message})


def _resolve_batch_customer(row):
    customer_id_raw = row.get("customer_id")
    customer_email = (row.get("customer_email") or row.get("email") or "").strip()
    full_name = (row.get("full_name") or row.get("name") or "").strip()
    contact_number = (row.get("contact_number") or row.get("number") or "").strip()

    if customer_id_raw is not None and str(customer_id_raw).strip() != "":
        try:
            customer_id = int(customer_id_raw)
        except (TypeError, ValueError):
            raise ValueError("invalid_customer_id")
        customer = Customer.objects.filter(
            pk=customer_id, deleted_at__isnull=True
        ).first()
        if customer is not None:
            return customer
        # Imported files can contain stale or incorrectly copied IDs. If the
        # row also has an email or name, resolve it using those stable fields.
        if not customer_email and not full_name:
            raise Customer.DoesNotExist

    if customer_email:
        customer = Customer.objects.filter(
            email__iexact=customer_email, deleted_at__isnull=True
        ).first()
        if customer is not None:
            return customer

    if full_name:
        customer = Customer.objects.filter(
            full_name__iexact=full_name,
            deleted_at__isnull=True,
        ).first()
        if customer is not None:
            return customer

        # Customer.customer_id is an AutoField, so leaving it unset here
        # generates the ID for a newly imported customer.
        customer_kwargs = {"full_name": full_name}
        if contact_number:
            customer_kwargs["contact_number"] = contact_number
        if customer_email:
            customer_kwargs["email"] = customer_email
        consent = (row.get("consent") or "").strip()
        if consent:
            customer_kwargs["consent"] = consent
        return Customer.objects.create(**customer_kwargs)

    raise ValueError("missing_customer")


def _resolve_batch_package(row):
    package_id_raw = row.get("package_id")
    if package_id_raw is None or str(package_id_raw).strip() == "":
        return None
    pkg = Package.objects.filter(
        pk=int(package_id_raw), deleted_at__isnull=True
    ).first()
    if pkg is None:
        raise Package.DoesNotExist
    return pkg


def _resolve_batch_total_price(row, package):
    total_price = row.get("total_price")
    if total_price is None and package is not None:
        total_price = float(package.promo_price or package.price or 0.0)
    return float(total_price) if total_price is not None else None


def _parse_batch_session_date(raw_session_date):
    if raw_session_date in (None, ""):
        return None
    raw_value = str(raw_session_date).strip()
    parsed = parse_datetime(raw_value)
    if parsed is None:
        parsed_date = parse_date(raw_value)
        if parsed_date is not None:
            parsed = datetime.combine(parsed_date, datetime.min.time())
    if parsed is None:
        # Excel date-only cells can arrive as their serial day number
        # (for example, 45984). Excel's 1900 date system uses 1899-12-30
        # as the conversion epoch, including its leap-year compatibility bug.
        try:
            excel_serial = float(raw_value)
        except (TypeError, ValueError):
            excel_serial = None
        if excel_serial is not None and 0 <= excel_serial < 2958466:
            parsed = datetime(1899, 12, 30) + timedelta(days=excel_serial)
    if parsed is None:
        raise ValueError("invalid_session_date")
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def bookings_import_batch(request):
    """
    POST /api/bookings/import-batch/
    Body: { "rows": [ { customer_id | email | full_name, package_id?, session_date?, session_status?, total_price? }, ... ] }
    Creates Booking rows and recomputes renewal profiles. A full_name matches an
    existing customer case-insensitively or creates one with an auto-generated ID.
    Note: addons are NOT processed; add them post-import via the booking editor.
    See frontend booking-import-format.js for schema.
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
    customer_ids_touched = []

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
        except ValueError as exc:
            message = (
                "customer_id must be numeric."
                if str(exc) == "invalid_customer_id"
                else "Provide customer_id, customer_email, or full_name."
            )
            _append_batch_import_error(errors, idx, message)
            continue
        except (Customer.DoesNotExist, TypeError):
            _append_batch_import_error(errors, idx, "Customer not found.")
            continue
        except IntegrityError:
            _append_batch_import_error(
                errors, idx, "A customer with this email already exists."
            )
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
        if session_status == "BOOKED":
            maybe_credit_booking(booking.pk)
        created_ids.append(booking.pk)
        customer_ids_touched.append(customer.customer_id)

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
            "affected_customer_ids": list(dict.fromkeys(customer_ids_touched)),
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
