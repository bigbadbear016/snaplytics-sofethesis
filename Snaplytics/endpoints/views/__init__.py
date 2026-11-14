"""API views, split by area. Re-exports the public views so urls.py is unchanged."""

from .customers import CustomerViewSet
from .bookings import bookings_import_batch, BookingViewSet, CustomerBookingsViewSet
from .recycle import RecycleBinActionsMixin
from .catalog import AddonViewSet, CategoryViewSet, PackageViewSet
from .coupons import (
    coupon_validate,
    CouponViewSet,
    cron_send_coupon_emails,
    customer_coupons,
    email_template_detail,
    email_templates,
    kiosk_send_booking_confirmation,
    loyalty_settings,
)
from .recommendations import (
    build_recommendation_response,
    customer_recommendations,
    customer_renewal_prediction,
    generate_key_factors,
    generate_recommendation_explanation,
    get_global_popular_packages,
    get_popular_addons_for_package,
    popular_recommendations,
    rebuild_popularity,
)
from .dashboard import (
    dashboard_analytics,
    dashboard_model_metrics,
    recompute_recommendation_model_metrics,
)
from .renewal import (
    approve_renewal_training,
    renewal_training_notifications,
    renewal_training_settings,
)
from .accounts import (
    auth_login,
    auth_logout,
    auth_profile,
    auth_reset_password,
    auth_signup,
    auth_staff_account_detail,
    auth_staff_account_purge,
    auth_staff_account_restore,
    auth_staff_accounts,
)
from .records import action_logs, recycle_bin

__all__ = [
    "CustomerViewSet",
    "BookingViewSet",
    "CustomerBookingsViewSet",
    "bookings_import_batch",
    "RecycleBinActionsMixin",
    "AddonViewSet",
    "CategoryViewSet",
    "PackageViewSet",
    "CouponViewSet",
    "coupon_validate",
    "cron_send_coupon_emails",
    "customer_coupons",
    "email_template_detail",
    "email_templates",
    "kiosk_send_booking_confirmation",
    "loyalty_settings",
    "build_recommendation_response",
    "customer_recommendations",
    "customer_renewal_prediction",
    "generate_key_factors",
    "generate_recommendation_explanation",
    "get_global_popular_packages",
    "get_popular_addons_for_package",
    "popular_recommendations",
    "rebuild_popularity",
    "dashboard_analytics",
    "dashboard_model_metrics",
    "recompute_recommendation_model_metrics",
    "approve_renewal_training",
    "renewal_training_notifications",
    "renewal_training_settings",
    "auth_login",
    "auth_logout",
    "auth_profile",
    "auth_reset_password",
    "auth_signup",
    "auth_staff_account_detail",
    "auth_staff_account_purge",
    "auth_staff_account_restore",
    "auth_staff_accounts",
    "action_logs",
    "recycle_bin",
]
