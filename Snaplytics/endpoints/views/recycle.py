"""Internal Records (recycle bin) helpers shared by catalog, customers, and coupons."""

from backend.models import Category, Package, StaffProfile
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from ._common import (
    _get_request_sender_label,
    _get_request_user,
    _is_admin_or_owner_user,
    _write_action_log,
)


# PACKAGE / ADDON VIEWSETS  (unchanged from original)
# ═══════════════════════════════════════════════════════════════════════════════


def _recycle_item_label(obj):
    fn = getattr(obj, "full_name", None)
    if fn and str(fn).strip():
        return str(fn).strip()
    name = getattr(obj, "name", None) or getattr(obj, "code", None)
    return name or f"#{obj.pk}"


def _apply_customer_internal_records_fields(instance):
    """Clear live email (unique), stash copy, set deleted_at. No logging."""
    email_live = instance.email
    instance.email_recycled = email_live
    instance.email = None
    instance.deleted_at = timezone.now()
    instance.last_updated = timezone.now()
    instance.save(
        update_fields=[
            "email_recycled",
            "email",
            "deleted_at",
            "last_updated",
        ]
    )


def _soft_delete_customer_to_internal_records(request, instance):
    cid = instance.customer_id
    name = instance.full_name or ""
    email_live = instance.email
    _apply_customer_internal_records_fields(instance)
    actor_name = _get_request_sender_label(request)
    _write_action_log(
        request,
        "customer_recycled",
        f"{actor_name} moved customer {name or ('#' + str(cid))} to Internal Records",
        metadata={
            "customer_id": cid,
            "name": name,
            "email": email_live or "",
        },
    )


def _co_restore_category_for_package(request, package):
    """
    Package.category is a string; if the Category row for that name is in the Internal Records,
    restore it when the package is restored.
    """
    cat_name = (package.category or "").strip()
    if not cat_name:
        return None
    cat = Category.objects.filter(
        name__iexact=cat_name, deleted_at__isnull=False
    ).first()
    if cat is None:
        return None
    cat.deleted_at = None
    cat.last_updated = timezone.now()
    cat.save(update_fields=["deleted_at", "last_updated"])
    actor_name = _get_request_sender_label(request)
    _write_action_log(
        request,
        "category_restored",
        (
            f"{actor_name} restored category {cat.name} from Internal Records "
            f"(with package {package.name})"
        ),
        metadata={
            "category_id": cat.id,
            "package_id": package.pk,
            "co_restore": "with_package",
        },
    )
    return cat


def _co_restore_packages_for_category(request, category):
    """
    Restore all soft-deleted packages whose category string matches this category name.
    """
    name = (category.name or "").strip()
    if not name:
        return 0
    qs = Package.objects.filter(category__iexact=name, deleted_at__isnull=False)
    ids = list(qs.values_list("id", flat=True))
    if not ids:
        return 0
    now = timezone.now()
    Package.objects.filter(pk__in=ids).update(deleted_at=None, last_updated=now)
    actor_name = _get_request_sender_label(request)
    _write_action_log(
        request,
        "package_restored",
        (
            f"{actor_name} restored {len(ids)} package(s) from Internal Records "
            f"(with category {category.name})"
        ),
        metadata={
            "category_id": category.pk,
            "package_ids": ids,
            "co_restore": "with_category",
            "count": len(ids),
        },
    )
    return len(ids)


def _can_purge_internal_records(user):
    """
    Permanent purge from Internal Records: StaffProfile.dev_mode (Dev tier above Owner).
    """
    if not user or not getattr(user, "is_authenticated", False):
        return False
    profile = StaffProfile.objects.filter(user=user).first()
    return bool(profile and getattr(profile, "dev_mode", False))


class RecycleBinActionsMixin:
    """
    Soft-deleted rows use deleted_at. Archive (is_archived) is separate.
    View/restore: ADMIN or OWNER. Permanent purge: StaffProfile.dev_mode (any role).
    """

    recycle_restore_type = "item_restored"
    recycle_purge_type = "item_purged"
    recycle_soft_delete_type = "item_recycled"
    recycle_entity_label = "item"

    def _recycle_admin_gate(self, request):
        user = _get_request_user(request)
        if not user or not getattr(user, "is_authenticated", False):
            return Response(
                {"detail": "Authentication required"},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if not _is_admin_or_owner_user(user):
            return Response(
                {"detail": "Only ADMIN or OWNER can manage Internal Records."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None

    def _recycle_purge_gate(self, request):
        err = self._recycle_admin_gate(request)
        if err:
            return err
        user = _get_request_user(request)
        if not _can_purge_internal_records(user):
            return Response(
                {
                    "detail": "Permanent delete requires Dev mode.",
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        return None

    @action(detail=True, methods=["post"], url_path="restore")
    def restore(self, request, pk=None):
        err = self._recycle_admin_gate(request)
        if err:
            return err
        instance = self.get_object()
        if instance.deleted_at is None:
            return Response(
                {"detail": "This item is not in Internal Records."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        instance.deleted_at = None
        instance.last_updated = timezone.now()
        instance.save(update_fields=["deleted_at", "last_updated"])
        actor_name = _get_request_sender_label(request)
        label = _recycle_item_label(instance)
        _write_action_log(
            request,
            self.recycle_restore_type,
            f"{actor_name} restored {self.recycle_entity_label} {label} from Internal Records",
            metadata={"id": instance.pk},
        )
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=["post"], url_path="purge")
    def purge(self, request, pk=None):
        err = self._recycle_purge_gate(request)
        if err:
            return err
        instance = self.get_object()
        if instance.deleted_at is None:
            return Response(
                {
                    "detail": "Permanent delete is only available for items in Internal Records.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        pk_val = instance.pk
        label = _recycle_item_label(instance)
        instance.delete()
        actor_name = _get_request_sender_label(request)
        _write_action_log(
            request,
            self.recycle_purge_type,
            f"{actor_name} permanently deleted {self.recycle_entity_label} {label}",
            metadata={"id": pk_val},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
