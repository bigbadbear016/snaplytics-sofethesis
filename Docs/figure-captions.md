# Snaplytics Figure Captions

## Figure 1 - Data Flow Diagram (DFD)
**File:** `dfd-snaplytics.png`  
**Caption:** Data flow across Snaplytics components, showing how Electron Staff Admin and HeigenKiosk clients interact with Django REST API processes (authentication, customer/booking/coupon management, and reporting), while data is persisted to PostgreSQL and import staging; outbound coupon communication is routed through an external email service.

## Figure 2 - Entity Relationship Diagram (ERD)
**File:** `erd-snaplytics.png`  
**Caption:** Core relational model for the Snaplytics backend, highlighting customer-booking-package relationships, coupon lifecycle tables (`CouponSent`, `CouponUsage`), addon bridge (`BookingAddon`), and user-linked administrative entities (`StaffProfile`, `EmailTemplate`, `ActionLog`, `PasswordResetRequest`), including one-to-many and one-to-one cardinalities.

## Figure 3 - High-Level Architecture
**File:** `architecture-snaplytics.png`  
**Caption:** Layered system architecture for the monorepo, where Electron and Expo clients call a centralized Django REST API for business logic and token-protected endpoints, with downstream integrations to PostgreSQL persistence, email delivery, media storage, and analytics/export workflows.
