"""Renewal training notifications, settings, and approval."""

import io
from datetime import timedelta

from backend.models import (
    RenewalShadowRun,
    RenewalTrainingRequest,
    RenewalTrainingSettings,
)
from django.core.management import call_command
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ._common import (
    _get_request_sender_label,
    _is_admin_or_owner_user,
    _role_name_for_user,
    _write_action_log,
)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def renewal_training_notifications(request):
    """Show pending training requests to every signed-in staff user."""
    cutoff = timezone.now() - timedelta(days=30)
    requests = RenewalTrainingRequest.objects.filter(
        Q(status=RenewalTrainingRequest.STATUS_PENDING)
        | Q(
            status=RenewalTrainingRequest.STATUS_APPROVED,
            requested_at__gte=cutoff,
        )
    ).order_by("-requested_at")
    role = _role_name_for_user(request.user)
    settings_row = RenewalTrainingSettings.objects.first()
    latest_run = RenewalShadowRun.objects.order_by("-run_date").first()
    latest_monthly = RenewalShadowRun.objects.filter(
        run_type="MONTHLY"
    ).order_by("-run_date").first()
    shadow = None
    if latest_run and latest_run.status == RenewalShadowRun.STATUS_FAILED:
        shadow = {
            "type": "failure",
            "run_date": latest_run.run_date,
            "message": latest_run.error_message or "The daily shadow run failed.",
        }
    elif latest_monthly:
        shadow = {
            "type": "monthly_summary",
            "run_date": latest_monthly.run_date,
            "status": latest_monthly.status,
            "details": latest_monthly.details if _is_admin_or_owner_user(request.user) else {},
        }
    return Response(
        {
            "can_approve": _is_admin_or_owner_user(request.user),
            "can_change_automatic_training": _is_admin_or_owner_user(request.user),
            "automatic_training_enabled": bool(
                settings_row and settings_row.automatic_training_enabled
            ),
            "shadow": shadow,
            "role": role,
            "requests": [
                {
                    "id": item.id,
                    "status": item.status,
                    "source_model_version": item.source_model_version,
                    "requested_at": item.requested_at,
                    "automatic": item.status == RenewalTrainingRequest.STATUS_APPROVED,
                    "notes": item.notes,
                }
                for item in requests
            ],
        }
    )


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def renewal_training_settings(request):
    if not _is_admin_or_owner_user(request.user):
        return Response(
            {"detail": "Only ADMIN or OWNER can change automatic training."},
            status=status.HTTP_403_FORBIDDEN,
        )
    enabled = request.data.get("automatic_training_enabled")
    if not isinstance(enabled, bool):
        return Response(
            {"detail": "automatic_training_enabled must be true or false."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    settings_row, _ = RenewalTrainingSettings.objects.get_or_create(pk=1)
    settings_row.automatic_training_enabled = enabled
    settings_row.updated_at = timezone.now()
    settings_row.save(update_fields=["automatic_training_enabled", "updated_at"])
    _write_action_log(
        request,
        "renewal_automatic_training_changed",
        f"{_get_request_sender_label(request)} changed automatic renewal training to {'on' if enabled else 'off'}",
        {"automatic_training_enabled": enabled},
    )
    return Response({"automatic_training_enabled": enabled})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def approve_renewal_training(request, request_id):
    """Approve and run a candidate training job; ADMIN/OWNER only."""
    if not _is_admin_or_owner_user(request.user):
        return Response(
            {"detail": "Only ADMIN or OWNER can approve renewal training."},
            status=status.HTTP_403_FORBIDDEN,
        )
    training_request = get_object_or_404(
        RenewalTrainingRequest,
        pk=request_id,
        status=RenewalTrainingRequest.STATUS_PENDING,
    )
    training_request.status = RenewalTrainingRequest.STATUS_APPROVED
    training_request.reviewed_by = request.user
    training_request.reviewed_at = timezone.now()
    training_request.save(update_fields=["status", "reviewed_by", "reviewed_at"])
    output = io.StringIO()
    try:
        call_command(
            "train_renewal_challenger",
            request_id=str(training_request.id),
            stdout=output,
            stderr=output,
        )
    except Exception as exc:
        training_request.status = RenewalTrainingRequest.STATUS_PENDING
        training_request.notes = str(exc)
        training_request.save(update_fields=["status", "notes"])
        return Response(
            {"detail": "Training failed.", "error": str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    _write_action_log(
        request,
        "renewal_training_approved",
        f"{_get_request_sender_label(request)} approved renewal challenger training request {training_request.id}",
        {"training_request_id": training_request.id},
    )
    return Response(
        {"request_id": training_request.id, "status": training_request.status, "output": output.getvalue()}
    )
