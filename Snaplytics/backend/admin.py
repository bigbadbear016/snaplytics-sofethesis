from django import forms
from django.contrib import admin
from django.contrib import messages
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import User

from .models import (
    Customer,
    Package,
    Addon,
    Booking,
    BookingAddon,
    Renewal,
    StaffProfile,
    PasswordResetRequest,
)
from .auth_utils import issue_staff_temporary_password
from django.utils import timezone


class UserCreationNoPasswordForm(forms.ModelForm):
    class Meta:
        model = User
        fields = (
            "username",
            "email",
            "first_name",
            "last_name",
            "is_staff",
            "is_superuser",
            "is_active",
            "groups",
            "user_permissions",
        )

    def save(self, commit=True):
        user = super().save(commit=False)
        if commit:
            user.save()
            self.save_m2m()
        return user


class UserAdmin(BaseUserAdmin):
    add_form = UserCreationNoPasswordForm
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "username",
                    "email",
                    "first_name",
                    "last_name",
                    "is_staff",
                    "is_superuser",
                    "is_active",
                    "groups",
                    "user_permissions",
                ),
            },
        ),
    )

    def save_model(self, request, obj, form, change):
        is_new = not change

        super().save_model(request, obj, form, change)

        if is_new:
            issue_staff_temporary_password(
                obj,
                can_send_email=bool(request.user and request.user.is_superuser),
                reset_profile_completed=True,
            )


admin.site.register(Customer)
admin.site.register(Package)
admin.site.register(Addon)
admin.site.register(Booking)
admin.site.register(BookingAddon)
admin.site.register(Renewal)
admin.site.register(StaffProfile)


@admin.register(PasswordResetRequest)
class PasswordResetRequestAdmin(admin.ModelAdmin):
    list_display = (
        "requested_email",
        "user",
        "status",
        "requested_at",
        "reviewed_at",
        "reviewed_by",
    )
    list_filter = ("status", "requested_at", "reviewed_at")
    search_fields = ("requested_email", "user__email", "user__username")
    ordering = ("-requested_at",)
    readonly_fields = ("requested_at", "reviewed_at", "reviewed_by")
    actions = ("approve_requests", "reject_requests")

    def _can_review(self, request):
        return bool(request.user and request.user.is_superuser)

    @admin.action(description="Approve selected reset requests and send temporary password")
    def approve_requests(self, request, queryset):
        if not self._can_review(request):
            self.message_user(
                request,
                "Only superusers can approve requests.",
                level=messages.ERROR,
            )
            return

        pending = queryset.filter(status=PasswordResetRequest.STATUS_PENDING).select_related("user")
        approved_count = 0
        emailed_count = 0
        for row in pending:
            if row.user and (row.user.is_staff or row.user.is_superuser):
                result = issue_staff_temporary_password(
                    row.user,
                    can_send_email=True,
                    reset_profile_completed=False,
                )
                if result.get("email_sent"):
                    emailed_count += 1

            row.status = PasswordResetRequest.STATUS_APPROVED
            row.reviewed_at = timezone.now()
            row.reviewed_by = request.user
            row.save(update_fields=["status", "reviewed_at", "reviewed_by"])
            approved_count += 1

        self.message_user(
            request,
            f"Approved {approved_count} request(s). Email sent for {emailed_count} account(s).",
        )

    @admin.action(description="Reject selected reset requests")
    def reject_requests(self, request, queryset):
        if not self._can_review(request):
            self.message_user(
                request,
                "Only superusers can reject requests.",
                level=messages.ERROR,
            )
            return

        rejected = queryset.filter(status=PasswordResetRequest.STATUS_PENDING).update(
            status=PasswordResetRequest.STATUS_REJECTED,
            reviewed_at=timezone.now(),
            reviewed_by=request.user,
        )
        self.message_user(request, f"Rejected {rejected} request(s).")

try:
    admin.site.unregister(User)
except admin.sites.NotRegistered:
    pass
admin.site.register(User, UserAdmin)
