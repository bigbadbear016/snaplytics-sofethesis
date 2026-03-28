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
    auth_login,
    auth_signup,
    auth_reset_password,
    auth_logout,
    auth_profile,
    coupon_validate,
    customer_coupons,
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
    path("", include(router.urls)),
    # ── auth ───────────────────────────────────────────────────────────────
    path("auth/login/", auth_login, name="auth-login"),
    path("auth/signup/", auth_signup, name="auth-signup"),
    path("auth/reset-password/", auth_reset_password, name="auth-reset-password"),
    path("auth/logout/", auth_logout, name="auth-logout"),
    path("auth/profile/", auth_profile, name="auth-profile"),
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
