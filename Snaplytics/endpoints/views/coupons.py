"""Coupons, loyalty settings, coupon emails, email templates, and the kiosk confirmation email."""

from datetime import timedelta

from backend.booking_email import send_booking_confirmation_email
from backend.coupon_utils import validate_coupon_for_customer
from backend.loyalty_utils import (
    eligible_customers,
    get_loyalty_settings,
    recalculate_balances_for_earn_rate,
)
from decimal import Decimal, InvalidOperation

from django.db import transaction
from backend.models import (
    Booking,
    Coupon,
    CouponSent,
    CouponUsage,
    Customer,
    EmailTemplate,
)
from django.conf import settings
from django.db.models import Count, Q
from django.db.models.functions import Lower
from django.db.utils import OperationalError, ProgrammingError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.html import strip_tags
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from ._common import (
    _coupon_discount_preview,
    _get_request_sender_label,
    _get_request_user,
    _is_admin_or_owner_user,
    _write_action_log,
    logger,
)
from .recycle import RecycleBinActionsMixin
from ..serializers import (
    CouponSerializer,
    EmailTemplateSerializer,
    LoyaltySettingsSerializer,
)


# COUPON VIEWSET
# ═══════════════════════════════════════════════════════════════════════════════


class CouponViewSet(RecycleBinActionsMixin, viewsets.ModelViewSet):
    recycle_restore_type = "coupon_restored"
    recycle_purge_type = "coupon_purged"
    recycle_soft_delete_type = "coupon_recycled"
    recycle_entity_label = "coupon"

    queryset = Coupon.objects.annotate(times_used=Count("couponusage")).order_by("-created_at")
    serializer_class = CouponSerializer
    pagination_class = None
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = Coupon.objects.annotate(times_used=Count("couponusage")).order_by("-created_at")
        action = getattr(self, "action", None)
        if action in ("restore", "purge"):
            return qs
        return qs.filter(deleted_at__isnull=True)

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
        instance.deleted_at = timezone.now()
        instance.last_updated = timezone.now()
        instance.save(update_fields=["deleted_at", "last_updated"])
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            self.recycle_soft_delete_type,
            f"{actor_name} moved coupon {coupon_code} to Internal Records",
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

        from_addr = getattr(settings, "EMAIL_FROM_ADDRESS", "")
        if not from_addr:
            return Response(
                {"detail": "SMTP is not configured (set EMAIL_HOST_USER or DEFAULT_FROM_EMAIL in .env)"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        sender_name = getattr(settings, "EMAIL_SENDER_NAME", "")
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
            .select_related("customer", "booking", "booking__package").defer("booking__package__image_url")
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


@api_view(["GET", "PATCH"])
@permission_classes([AllowAny])
def loyalty_settings(request):
    """
    GET /api/loyalty-settings/  — current earn/redeem rates (singleton row).
    PATCH — ADMIN or OWNER only; updates pesos per point for earn and claim.
    """
    row = get_loyalty_settings()
    if request.method == "GET":
        return Response(LoyaltySettingsSerializer(row).data)
    request_user = _get_request_user(request)
    if not _is_admin_or_owner_user(request_user):
        return Response(
            {"detail": "Only ADMIN or OWNER can update loyalty settings."},
            status=status.HTTP_403_FORBIDDEN,
        )
    prev_earn = row.pesos_per_point_earn
    prev_redeem = row.pesos_per_point_redeem
    ser = LoyaltySettingsSerializer(row, data=request.data, partial=True)
    ser.is_valid(raise_exception=True)
    recalculated = None
    with transaction.atomic():
        ser.save()
        row.refresh_from_db()
        # Points follow both rates: earned points the earn rate (moved from whatever
        # rate balances actually reflect), claimed packages the claim rate. Runs on
        # every rate save; a no-op once everything already matches.
        if "pesos_per_point_earn" in request.data or "pesos_per_point_redeem" in request.data:
            recalculated = recalculate_balances_for_earn_rate(
                prev_earn, row.pesos_per_point_earn, new_redeem_rate=row.pesos_per_point_redeem
            )
    if (
        prev_earn != row.pesos_per_point_earn
        or prev_redeem != row.pesos_per_point_redeem
        or (recalculated and recalculated["affected"])
    ):
        _write_action_log(
            request,
            "loyalty_settings_updated",
            (
                f"{_get_request_sender_label(request)} updated loyalty rates "
                f"(earn ₱{row.pesos_per_point_earn} per pt earned, "
                f"redeem ₱{row.pesos_per_point_redeem} per pt spent)"
            ),
            metadata={
                "previous_pesos_per_point_earn": str(prev_earn),
                "previous_pesos_per_point_redeem": str(prev_redeem),
                "pesos_per_point_earn": str(row.pesos_per_point_earn),
                "pesos_per_point_redeem": str(row.pesos_per_point_redeem),
                "points_recalculated": recalculated and {
                    k: recalculated[k] for k in ("affected", "increased", "decreased", "floored", "claims_repriced")
                },
            },
        )
    data = dict(LoyaltySettingsSerializer(row).data)
    if recalculated is not None:
        data["recalculated"] = recalculated
    return Response(data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def loyalty_settings_preview(request):
    """
    POST /api/loyalty-settings/preview/
    Body: { "pesos_per_point_earn": 120, "pesos_per_point_redeem": 40 } (either or both)
    Dry run: how customers' balances and claims would change with these rates. Writes nothing.
    ADMIN or OWNER only, like saving the rates.
    """
    if not _is_admin_or_owner_user(_get_request_user(request)):
        return Response(
            {"detail": "Only ADMIN or OWNER can change loyalty settings."},
            status=status.HTTP_403_FORBIDDEN,
        )
    row = get_loyalty_settings()
    rates = {}
    for key, current in (("pesos_per_point_earn", row.pesos_per_point_earn),
                         ("pesos_per_point_redeem", row.pesos_per_point_redeem)):
        raw = request.data.get(key)
        try:
            rates[key] = current if raw in (None, "") else Decimal(str(raw))
        except (InvalidOperation, TypeError, ValueError):
            return Response({"detail": f"{key} must be a number"}, status=status.HTTP_400_BAD_REQUEST)
        if rates[key] <= 0:
            return Response({"detail": f"{key} must be positive"}, status=status.HTTP_400_BAD_REQUEST)
    summary = recalculate_balances_for_earn_rate(
        row.pesos_per_point_earn, rates["pesos_per_point_earn"], dry_run=True,
        new_redeem_rate=rates["pesos_per_point_redeem"],
    )
    return Response(summary)


LOYALTY_EMAIL_MAX_RECIPIENTS = 500


def _format_points(value) -> str:
    """112.5 → "112.5", 120.0 → "120"."""
    text = f"{value:,.1f}"
    return text[:-2] if text.endswith(".0") else text


def _serialize_eligible(row: dict) -> dict:
    c = row["customer"]
    return {
        "id": c.customer_id,
        "name": c.full_name or "",
        "email": c.email or "",
        "points": float(row["points"]),
        "packages": [
            {
                "id": pkg.pk,
                "name": pkg.name,
                "category": pkg.category,
                "points_cost": float(cost),
            }
            for pkg, cost in row["packages"]
        ],
    }


def _render_loyalty_template(template: str, row: dict, as_html: bool) -> str:
    """Fill {customer_name}, {current_points}, {claimable_packages} for one customer.

    Values are escaped for HTML so a customer's name can never inject markup.
    """
    from django.utils.html import escape

    if not template:
        return ""
    c = row["customer"]
    name = (c.full_name or "").strip() or "there"
    points = _format_points(row["points"])
    if as_html:
        items = "".join(
            f"<li>{escape(pkg.name)} &mdash; {escape(_format_points(cost))} points</li>"
            for pkg, cost in row["packages"]
        )
        packages = f'<ul style="margin:8px 0;padding-left:20px;">{items}</ul>'
        name = escape(name)
    else:
        packages = ", ".join(
            f"{pkg.name} ({_format_points(cost)} points)" for pkg, cost in row["packages"]
        )
    return (
        template.replace("{customer_name}", name)
        .replace("{current_points}", points)
        .replace("{claimable_packages}", packages)
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def loyalty_eligible(request):
    """
    GET /api/loyalty/eligible/
    Customers who can claim at least one package with their points right now,
    with the packages each one can afford (same rules as the claim endpoint).
    """
    rows = [_serialize_eligible(r) for r in eligible_customers()]
    return Response({"count": len(rows), "results": rows})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def loyalty_eligible_email(request):
    """
    POST /api/loyalty/eligible/email/
    Body: { "customer_ids": [...], "subject": "...", "html_body": "..." }
    Sends one personalised email per customer. Eligibility and email address
    are re-checked here; anyone who fails a check is skipped and reported.
    (Customer.consent is about using their photos, not email, so it is not checked.)
    """
    from email.utils import formataddr

    from django.core.mail import EmailMultiAlternatives

    raw_ids = request.data.get("customer_ids") or []
    subject = (request.data.get("subject") or "").strip()
    html_body = (request.data.get("html_body") or "").strip()
    try:
        customer_ids = list(dict.fromkeys(int(x) for x in raw_ids))
    except (TypeError, ValueError):
        return Response({"detail": "customer_ids must be integers"}, status=status.HTTP_400_BAD_REQUEST)
    if not customer_ids:
        return Response({"detail": "Select at least one customer."}, status=status.HTTP_400_BAD_REQUEST)
    if len(customer_ids) > LOYALTY_EMAIL_MAX_RECIPIENTS:
        return Response(
            {"detail": f"Send to at most {LOYALTY_EMAIL_MAX_RECIPIENTS} customers at a time."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not subject:
        return Response({"detail": "Subject is required."}, status=status.HTTP_400_BAD_REQUEST)
    if not html_body:
        return Response({"detail": "Email body is required."}, status=status.HTTP_400_BAD_REQUEST)

    from_addr = getattr(settings, "EMAIL_FROM_ADDRESS", "")
    if not from_addr:
        return Response(
            {"detail": "SMTP is not configured (set EMAIL_HOST_USER or DEFAULT_FROM_EMAIL in .env)"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    from_header = formataddr((getattr(settings, "EMAIL_SENDER_NAME", ""), from_addr))

    rows = {r["customer"].customer_id: r for r in eligible_customers(customer_ids)}
    sent_ids, skipped, errors = [], [], []
    for cid in customer_ids:
        row = rows.get(cid)
        if row is None:
            skipped.append({"id": cid, "reason": "No longer has enough points"})
            continue
        c = row["customer"]
        email_addr = (c.email or "").strip()
        if not email_addr:
            skipped.append({"id": cid, "name": c.full_name, "reason": "No email address"})
            continue
        try:
            final_html = _render_loyalty_template(html_body, row, as_html=True)
            text_template = strip_tags(html_body).strip()
            msg = EmailMultiAlternatives(
                subject=_render_loyalty_template(subject, row, as_html=False),
                body=_render_loyalty_template(text_template, row, as_html=False),
                from_email=from_header,
                to=[email_addr],
            )
            msg.attach_alternative(final_html, "text/html")
            msg.encoding = "utf-8"
            msg.send(fail_silently=False)
            sent_ids.append(cid)
        except Exception as e:
            logger.exception("loyalty email to %s", email_addr)
            errors.append(f"{email_addr}: {e}")

    _write_action_log(
        request,
        "loyalty_email_sent",
        f"{_get_request_sender_label(request)} emailed {len(sent_ids)} customer(s) about claiming packages with loyalty points",
        metadata={
            "customer_ids": sent_ids,
            "sent_count": len(sent_ids),
            "skipped_count": len(skipped),
            "errors_count": len(errors),
        },
    )
    return Response(
        {"sent_count": len(sent_ids), "skipped": skipped, "errors": errors},
        status=status.HTTP_200_OK,
    )


# COUPON API (validate, customer coupons, cron)
# ═══════════════════════════════════════════════════════════════════════════════


KIOSK_CONFIRMATION_WINDOW = timedelta(minutes=10)


@api_view(["POST"])
@permission_classes([AllowAny])
def kiosk_send_booking_confirmation(request):
    """
    POST /api/kiosk/send-booking-confirmation/
    Body: { "booking_id": <int> }
    Used by the kiosk right after it creates a booking. No login, so it only
    sends for a Pending booking created in the last few minutes, and never
    returns the customer's email address.
    """
    import time

    raw_id = request.data.get("booking_id")
    if raw_id is None or str(raw_id).strip() == "":
        return Response(
            {"sent": False, "detail": "booking_id is required"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        booking_pk = int(raw_id)
    except (TypeError, ValueError):
        return Response(
            {"sent": False, "detail": "booking_id must be an integer"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def _load_booking():
        return (
            Booking.objects.select_related("customer", "package", "coupon").defer("package__image_url")
            .prefetch_related("bookingaddon_set__addon")
            .filter(pk=booking_pk)
            .first()
        )

    booking = _load_booking()
    if booking is None:
        time.sleep(0.35)
        booking = _load_booking()
    if booking is None:
        logger.warning("kiosk_send_booking_confirmation: booking %s not found", booking_pk)
        return Response(
            {
                "sent": False,
                "booking_id": booking_pk,
                "detail": f"Booking #{booking_pk} not found",
            },
            status=status.HTTP_404_NOT_FOUND,
        )

    # shortcut: the same fresh booking can still be re-sent within the window;
    # add a sent-at field on Booking if that is ever abused.
    if (
        booking.session_status != "Pending"
        or booking.created_at < timezone.now() - KIOSK_CONFIRMATION_WINDOW
    ):
        return Response(
            {
                "sent": False,
                "booking_id": booking.pk,
                "detail": "Only a booking just made at the kiosk can be confirmed here.",
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    customer_email = (booking.customer.email or "").strip() if booking.customer else ""
    if not customer_email:
        return Response(
            {
                "sent": False,
                "booking_id": booking.pk,
                "detail": "Customer has no email on file",
            },
            status=status.HTTP_200_OK,
        )

    sent = send_booking_confirmation_email(booking)
    if not sent:
        logger.warning(
            "kiosk_send_booking_confirmation: SMTP failed booking_id=%s to=%s",
            booking.pk,
            customer_email,
        )
        return Response(
            {
                "sent": False,
                "booking_id": booking.pk,
                "detail": "SMTP send failed (check EMAIL_* in .env)",
            },
            status=status.HTTP_200_OK,
        )

    logger.info(
        "kiosk_send_booking_confirmation: sent booking_id=%s to=%s",
        booking.pk,
        customer_email,
    )
    return Response(
        {"sent": True, "booking_id": booking.pk},
        status=status.HTTP_200_OK,
    )


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
    customer = get_object_or_404(
        Customer.objects.filter(deleted_at__isnull=True),
        customer_id=customer_id,
    )
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
@permission_classes([IsAuthenticated])
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
@permission_classes([IsAuthenticated])
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
