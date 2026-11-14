"""Packages, categories, and add-ons."""

from backend.models import Addon, Category, Package
from django.db import IntegrityError
from django.db.models import Count
from django.db.models.functions import Lower
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from ._common import _get_request_sender_label, _write_action_log
from .recycle import (
    _co_restore_category_for_package,
    _co_restore_packages_for_category,
    _recycle_item_label,
    RecycleBinActionsMixin,
)
from ..serializers import AddonSerializer, CategorySerializer, PackageSerializer


class PackageViewSet(RecycleBinActionsMixin, viewsets.ModelViewSet):
    recycle_restore_type = "package_restored"
    recycle_purge_type = "package_purged"
    recycle_soft_delete_type = "package_recycled"
    recycle_entity_label = "package"

    queryset = Package.objects.all().order_by("id")
    serializer_class = PackageSerializer
    pagination_class = None
    permission_classes = [AllowAny]

    def get_queryset(self):
        qs = Package.objects.all().order_by("id")
        action = getattr(self, "action", None)
        if action in ("restore", "purge"):
            return qs
        if action != "list":
            return qs.filter(deleted_at__isnull=True)
        include_archived = (
            str(self.request.query_params.get("include_archived", "")).lower()
            in {"1", "true", "yes"}
        )
        qs = qs.filter(deleted_at__isnull=True)
        if include_archived:
            return qs
        return qs.filter(is_archived=False)

    def _ensure_category_exists(self, category_name):
        if not category_name:
            return
        if Category.objects.filter(
            name__iexact=category_name, deleted_at__isnull=True
        ).exists():
            return
        try:
            Category.objects.create(name=category_name)
        except IntegrityError:
            # Name held by a soft-deleted row (unique constraint); restore from Internal Records instead.
            pass

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
        instance.deleted_at = timezone.now()
        instance.last_updated = timezone.now()
        instance.save(update_fields=["deleted_at", "last_updated"])
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            self.recycle_soft_delete_type,
            f"{actor_name} moved package {name} to Internal Records",
            metadata={"package_id": package_id, "name": name},
        )

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
        co_cat = _co_restore_category_for_package(request, instance)
        data = self.get_serializer(instance).data
        if co_cat is not None:
            data = dict(data)
            data["category_co_restored"] = True
            data["category_id"] = co_cat.id
        return Response(data)


class CategoryViewSet(RecycleBinActionsMixin, viewsets.ModelViewSet):
    recycle_restore_type = "category_restored"
    recycle_purge_type = "category_purged"
    recycle_soft_delete_type = "category_recycled"
    recycle_entity_label = "category"

    queryset = Category.objects.all().order_by("name")
    serializer_class = CategorySerializer
    pagination_class = None
    permission_classes = [AllowAny]

    def get_queryset(self):
        qs = Category.objects.all().order_by("name")
        action = getattr(self, "action", None)
        if action in ("restore", "purge"):
            return qs
        if action != "list":
            return qs.filter(deleted_at__isnull=True)
        include_archived = (
            str(self.request.query_params.get("include_archived", "")).lower()
            in {"1", "true", "yes"}
        )
        qs = qs.filter(deleted_at__isnull=True)
        if include_archived:
            return qs
        return qs.filter(is_archived=False)

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        category_names = list(queryset.values_list("name", flat=True))
        normalized_names = [str(name).lower() for name in category_names if name]

        count_map = {}
        if normalized_names:
            for row in (
                Package.objects.annotate(category_key=Lower("category"))
                .filter(is_archived=False, deleted_at__isnull=True)
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
        old = self.get_object()
        old_name = old.name
        old_archived = bool(old.is_archived)
        category = serializer.save(last_updated=timezone.now())
        if old_name != category.name:
            Package.objects.filter(category__iexact=old_name).update(
                category=category.name,
                last_updated=timezone.now(),
            )
        if old_archived != bool(category.is_archived):
            Package.objects.filter(category__iexact=category.name).update(
                is_archived=category.is_archived,
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
                "old_archived": old_archived,
                "new_archived": bool(category.is_archived),
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
        instance.deleted_at = timezone.now()
        instance.last_updated = timezone.now()
        instance.save(update_fields=["deleted_at", "last_updated"])
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            self.recycle_soft_delete_type,
            f"{actor_name} moved category {name} to Internal Records",
            metadata={"category_id": category_id, "name": name},
        )

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
        n = _co_restore_packages_for_category(request, instance)
        data = self.get_serializer(instance).data
        if n:
            data = dict(data)
            data["packages_co_restored"] = n
        return Response(data)


class AddonViewSet(RecycleBinActionsMixin, viewsets.ModelViewSet):
    recycle_restore_type = "addon_restored"
    recycle_purge_type = "addon_purged"
    recycle_soft_delete_type = "addon_recycled"
    recycle_entity_label = "add-on"

    queryset = Addon.objects.all().order_by("id")
    serializer_class = AddonSerializer
    pagination_class = None
    permission_classes = [AllowAny]

    def get_queryset(self):
        qs = Addon.objects.all().order_by("id")
        action = getattr(self, "action", None)
        if action in ("restore", "purge"):
            return qs
        return qs.filter(deleted_at__isnull=True)

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
        instance.deleted_at = timezone.now()
        instance.last_updated = timezone.now()
        instance.save(update_fields=["deleted_at", "last_updated"])
        actor_name = _get_request_sender_label(self.request)
        _write_action_log(
            self.request,
            self.recycle_soft_delete_type,
            f"{actor_name} moved add-on {name} to Internal Records",
            metadata={"addon_id": addon_id, "name": name},
        )


# ═══════════════════════════════════════════════════════════════════════════════
