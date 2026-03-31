# endpoints/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    CustomerViewSet,
    CategoryViewSet,
    PackageViewSet,
    AddonViewSet,
    BookingViewSet,
    CustomerBookingsViewSet,
    CouponViewSet,
    customer_recommendations,
    popular_recommendations,
    rebuild_popularity,
    dashboard_analytics,
    dashboard_model_metrics,
    recompute_recommendation_model_metrics,
    customer_renewal_prediction,
    bookings_import_batch,
    auth_login,
    auth_signup,
    auth_reset_password,
    auth_logout,
    auth_profile,
    auth_staff_accounts,
    auth_staff_account_detail,
    action_logs,
    coupon_validate,
    customer_coupons,
    email_templates,
    email_template_detail,
    cron_send_coupon_emails,
)

router = DefaultRouter()
router.register(r"customers", CustomerViewSet, basename="customer")
router.register(r"bookings", BookingViewSet, basename="booking")
router.register(r"packages", PackageViewSet, basename="package")
router.register(r"addons", AddonViewSet, basename="addon")
router.register(r"categories", CategoryViewSet, basename="category")
router.register(r"coupons", CouponViewSet, basename="coupon")

# Nested customer-scoped booking routes wired manually because
# DRF's DefaultRouter does not support nested prefixes natively.
customer_booking_list = CustomerBookingsViewSet.as_view(
    {
        "get": "list",
        "post": "create",
    }
)
customer_booking_detail = CustomerBookingsViewSet.as_view(
    {
        "get": "retrieve",
        "put": "update",
        "delete": "destroy",
    }
)

urlpatterns = [
    # ── coupons (must be before router so coupons/validate/ is not matched as coupons/<pk>/) ──
    path("coupons/validate/", coupon_validate, name="coupon-validate"),
    # ── batch booking import (before router: avoid /bookings/<pk>/) ──
    path(
        "bookings/import-batch/",
        bookings_import_batch,
        name="bookings-import-batch",
    ),
    path("", include(router.urls)),
    # ── auth ───────────────────────────────────────────────────────────────
    path("auth/login/", auth_login, name="auth-login"),
    path("auth/signup/", auth_signup, name="auth-signup"),
    path("auth/reset-password/", auth_reset_password, name="auth-reset-password"),
    path("auth/logout/", auth_logout, name="auth-logout"),
    path("auth/profile/", auth_profile, name="auth-profile"),
    path("auth/staff-accounts/", auth_staff_accounts, name="auth-staff-accounts"),
    path(
        "auth/staff-accounts/<int:user_id>/",
        auth_staff_account_detail,
        name="auth-staff-account-detail",
    ),
    path("action-logs/", action_logs, name="action-logs"),
    # ── nested bookings ───────────────────────────────────────────────────────
    path(
        "customers/<int:customer_pk>/bookings/",
        customer_booking_list,
        name="customer-booking-list",
    ),
    path(
        "customers/<int:customer_pk>/bookings/<int:pk>/",
        customer_booking_detail,
        name="customer-booking-detail",
    ),
    # ── popular recommendations (dashboard widget) ─────────────────────────
    path(
        "recommendations/popular/",
        popular_recommendations,
        name="popular-recommendations",
    ),
    # ── rebuild popularity artifacts (called by refresh button) ───────────
    path(
        "recommendations/rebuild/",
        rebuild_popularity,
        name="rebuild-popularity",
    ),
    # ── for dashboard charts ─────────────────────
    path("analytics/dashboard/", dashboard_analytics, name="dashboard-analytics"),
    path("analytics/model-metrics/", dashboard_model_metrics, name="dashboard-model-metrics"),
    path(
        "analytics/model-metrics/recompute-recommendation/",
        recompute_recommendation_model_metrics,
        name="recompute-recommendation-model-metrics",
    ),
    path(
        "renewal/<int:customer_id>/",
        customer_renewal_prediction,
        name="customer-renewal-prediction",
    ),
    # ── coupons ──────────────────────────────────────
    path(
        "customers/<int:customer_id>/coupons/",
        customer_coupons,
        name="customer-coupons",
    ),
    path("email-templates/", email_templates, name="email-templates"),
    path(
        "email-templates/<int:template_id>/",
        email_template_detail,
        name="email-template-detail",
    ),
    path(
        "cron/send-coupon-emails/",
        cron_send_coupon_emails,
        name="cron-send-coupon-emails",
    ),
    # ── customer recommendations ─────────────────────
    path(
        "recommendations/<int:customer_id>/",
        customer_recommendations,
        name="customer-recommendations",
    ),
]
