# Overall Architecture Documentation

## 1. System Overview

Snaplytics is a multi-client platform with a shared Django backend and PostgreSQL datastore.

- `Snaplytics/backend/` + `Snaplytics/endpoints/` provide the domain model, REST APIs, auth, analytics, recommendation, and renewal prediction.
- `electron-app/` (at workspace root, alongside Snaplytics) provides a desktop admin/staff interface for operations (dashboard, customers, packages, bookings, coupons, manage accounts, action logs, Internal Records, auth/profile). The same pages can also be served to a browser by `scripts/web-server.cjs`.
- `HeigenKiosk/` provides a React Native kiosk application for walk-in booking capture and guided customer flow.
- `recommender/` and `renewal/` provide recommendation and renewal model pipelines and evaluation artifacts.
- `etl/` provides ingestion/staging/merge jobs for operational data files.

The architecture is API-centric: both frontends consume Django REST endpoints under `/api/`.

## 2. High-Level Component Model

### 2.1 Backend Layer (Django + DRF)

Primary modules:

- `Snaplytics/settings.py`: project configuration (PostgreSQL, DRF auth/pagination, CORS, installed apps). `Snaplytics/settings_test.py` swaps in an in-memory SQLite database and a local email backend for tests.
- `Snaplytics/urls.py`: mounts all REST endpoints through `path('api/', include('endpoints.urls'))`.
- `backend/models.py`: core business entities and relationships.
- `endpoints/views/`: viewsets and function endpoints, one module per area: `customers`, `bookings`, `catalog`, `coupons`, `recommendations`, `dashboard`, `renewal`, `accounts`, `records`. Shared helpers live in `_common` (role checks, action-log writers, user payloads) and `recycle` (soft delete, restore, and purge mixin). `__init__.py` re-exports every view for `endpoints/urls.py`.
- `endpoints/permissions.py`: `StaffOrKioskAction`, which lets anonymous callers use only the actions listed in a viewset's `kiosk_actions`.
- `endpoints/serializers.py`: request/response shaping, nested booking/add-on representation, write/read adaptation.
- `backend/renewal_utils.py`: live recomputation of renewal profile metrics from booking history.
- `backend/renewal_shadow.py`: daily shadow predictions and evaluation of matured outcomes.
- `backend/coupon_utils.py`: coupon discount calculation and per-customer validation.
- `backend/loyalty_utils.py`: loyalty point earning, redemption ("claim package"), and booking crediting.
- `backend/booking_email.py`: HTML booking confirmation and receipt emails.
- `backend/auth_utils.py`: temporary passwords for new staff accounts.
- `backend/signals.py`: automatic `StaffProfile` creation via Django user `post_save`.
- `backend/management/commands/`: CLI jobs (ETL, coupon emails, at-risk coupon suggestions, renewal shadow runs, challenger training, dev account creation).

### 2.2 Admin Client Layer (Electron)

Primary modules:

- `electron-app/main.js`: desktop shell bootstrap; spawns Django `runserver` from sibling `Snaplytics/` folder (skipped when `HEIGEN_SKIP_DJANGO=1`); creates browser window.
- `electron-app/scripts/api-client.js`: centralized HTTP client with domain-specific API wrappers. `window.HEIGEN_API_BASE` overrides the default `http://127.0.0.1:8000/api`.
- `electron-app/scripts/*`: page-level logic for customers, customer details, booking import, packages, coupons, manage accounts, action logs, Internal Records (`recycle-bin.js`), onboarding/auth, profile, notifications, and recommendations.
- `electron-app/scripts/staff-shell.js` + `pages/staff_admin/shell.html`: sidebar shell that embeds each page; on narrow windows the sidebar collapses to an icon rail.
- `electron-app/pages/staff_admin/*`: staff admin HTML pages (`dashboard`, `customers`, `customer-details`, `packages`, `packages-list`, `coupons`, `manage-accounts`, `action-logs`, `recycle-bin`, `profile`, `onboarding`, `signup`, `forgot_pass`).
- `electron-app/scripts/web-server.cjs`: serves the staff pages and the built kiosk (`/kiosk/`) over HTTP and proxies `/api/...` to Django, optionally behind an ngrok or Cloudflare Quick Tunnel.

Electron acts as a thin client over the DRF API and does not host primary business logic or direct DB access.

### 2.3 Kiosk Client Layer (React Native)

Primary modules:

- `HeigenKiosk/src/screens/KioskApp.js`: kiosk orchestration state machine and step navigation.
- `HeigenKiosk/src/api/client.js`: API request layer for categories/packages/add-ons/customers/bookings/recommendations.
- `HeigenKiosk/src/constants/api.js`: resolves the API base URL (Expo host, `EXPO_PUBLIC_API_*` variables, or same-origin `/api` for the public web kiosk).
- `HeigenKiosk/src/screens/*`: category/package/add-ons/confirmation/customer form/booking summary/booking queue screens.
- `HeigenKiosk/src/components/*`: reusable UI primitives and `FullscreenBars` (hides system bars on Android).
- `HeigenKiosk/src/hooks/*`: data fetching, screen scaling, and on-screen keyboard height.
- `HeigenKiosk/src/utils/*`: add-on line totals, date display, and loyalty point claim calculation.

`HeigenKiosk-apk/` is a separate standalone variant that talks to Supabase PostgREST directly instead of the Django API.

Kiosk flow is transactional: collect selections and customer info, resolve recommendations, submit booking.

### 2.4 Data & Intelligence Layer

- `recommender/`: popularity artifacts, recommendation generation from booking history and fallbacks, evaluation scripts.
- `renewal/`: renewal feature engineering/model results used by dashboard metrics endpoints.
- `etl/`: extract-transform-load into staging and optional merge into canonical customer/booking domain.

## 3. Runtime Topology

### 3.1 Development Runtime

- On Windows, `install.bat` / `install-windows.bat` install Python 3.12, Node.js, and dependencies; `starter.bat` (or `HeigenStarter.exe`) starts and stops each service.
- Electron `main.js` starts Django via child process.
- `manage.py runserver` listens on `0.0.0.0:8000` by default (`DJANGO_RUNSERVER_ADDR` overrides it), so Expo Go devices on the same network can reach the API.
- Electron renderer and React Native app call backend over HTTP at `/api`.
- Expo dev server runs on port `8090`.
- Database is PostgreSQL on Supabase (SSL-enabled connection options in settings).

### 3.1.1 Public Links

- `npm run web:ngrok` (port `4173`) or `npm run web:cloudflare` (port `4174`) in `electron-app/` builds the kiosk, starts Django if needed, and exposes the staff web and `/kiosk/` through one tunnel.
- Only the web proxy port is tunneled; Django stays on localhost behind the `/api` proxy.

### 3.2 Process Boundaries

- Process A: Django app server (API/business logic).
- Process B: Electron main + renderer (desktop UI shell).
- Process C: React Native runtime (mobile/tablet kiosk UI).
- Optional jobs: ETL commands and recommendation pipeline scripts (subprocess execution).

## 4. Core Domain Model

From `backend/models.py`:

- `Category`: package categorization metadata (archivable, soft-deletable).
- `Package`: service offerings with pricing, promo metadata, inclusions, portraits, freebies, image (archivable, soft-deletable).
- `Addon`: optional upsell items and pricing (soft-deletable).
- `Customer`: customer profile/contact/source, optional package relation, and loyalty point balance (soft-deletable; the email moves to `email_recycled` while the record is in Internal Records).
- `Booking`: transaction linking customer + package, optional coupon and discount, status, GCash/cash payment, totals, schedule, loyalty credit flag.
- `BookingAddon`: line-item add-on quantities/costs for a booking.
- `Coupon`: discount code (percent or fixed), usage limits, per-customer limit, expiry.
- `CouponSent`: record that a coupon was sent to a customer, with email delivery time.
- `CouponUsage`: coupon redemption tied to a booking.
- `EmailTemplate`: per-user saved coupon email template (subject, plain body, HTML body).
- `LoyaltySettings`: pesos per point for earning and redeeming.
- `Renewal`: derived per-customer renewal metrics (booking frequency/value/spend/preferred package type).
- `RenewalShadowPrediction`: one shadow prediction per customer, snapshot date, and model version, with its later outcome.
- `RenewalShadowRun`: log of daily and monthly shadow job runs.
- `RenewalTrainingRequest`: challenger training request with its approval status, candidate model, and metrics.
- `RenewalTrainingSettings`: switch for automatic monthly challenger training.
- `StagingBooking`: ETL staging record for raw/canonical transformed rows and status.
- `StaffProfile`: operational profile for platform users (photo, phone, nickname, soft delete, `dev_mode`).
- `PasswordResetRequest`: reset request approval workflow tracking.
- `ActionLog`: audit trail of staff actions (actor, type, text, metadata).

## 5. API Surface Architecture

### 5.1 REST Routing

`endpoints/urls.py` exposes:

- CRUD resources via `DefaultRouter`: `/customers`, `/bookings`, `/packages`, `/addons`, `/categories`, `/coupons`.
- Extra viewset actions: `/customers/all/`, `/customers/by-email/`, `/customers/bulk-delete/`, `/customers/<id>/claim-package/`, `/bookings/<id>/status/`, `/bookings/<id>/send-confirmation/`, `/coupons/<id>/send-email/`, and `restore` / `purge` on soft-deletable resources.
- Nested customer bookings: `/customers/<customer_pk>/bookings/...`.
- Booking import: `/bookings/import-batch/`.
- Auth endpoints: `/auth/login`, `/auth/signup`, `/auth/reset-password`, `/auth/logout`, `/auth/profile`.
- Staff account management: `/auth/staff-accounts/`, `/auth/staff-accounts/<user_id>/`, `.../restore/`, `.../purge/`.
- Audit and Internal Records: `/action-logs/`, `/recycle-bin/`.
- Coupons, loyalty, and email: `/coupons/validate/`, `/customers/<customer_id>/coupons/`, `/email-templates/`, `/email-templates/<template_id>/`, `/cron/send-coupon-emails/`, `/loyalty-settings/`, `/kiosk/send-booking-confirmation/`.
- Recommendation endpoints: `/recommendations/<customer_id>`, `/recommendations/popular`, `/recommendations/rebuild`.
- Analytics endpoints: `/analytics/dashboard`, `/analytics/model-metrics`, `/analytics/model-metrics/recompute-recommendation`.
- Renewal endpoints: `/renewal/<customer_id>/`, `/renewal-training/notifications/`, `/renewal-training/<request_id>/approve/`, `/renewal-training/settings/`.

### 5.2 Serialization Pattern

`endpoints/serializers.py` provides:

- Domain serializers for package/category/add-on/customer/booking.
- Read/write split behavior for booking payloads:
  - Read: flattened and enriched fields (`customer_name`, `packageName`, nested add-ons, computed totals).
  - Write: `customer_id`, `package_id`, `addons_input`, `session_date`, `total_price`.
- Input validation, including base64 image payload size enforcement.

## 6. Cross-Component Data Flows

### 6.1 Admin Operations Flow (Electron)

1. Electron renderer calls `window.apiClient.*` wrappers.
2. HTTP requests hit DRF viewsets/functions.
3. Serializers validate/shape payloads.
4. ORM reads/writes PostgreSQL.
5. API response updates admin pages.

### 6.2 Kiosk Booking Flow (React Native)

1. Kiosk loads categories/packages/add-ons via `src/api/client.js`.
2. Customer form submits email; backend customer lookup happens.
3. If customer exists, personalized recommendations fetched; otherwise popular recommendations fetched.
4. On confirm, kiosk submits booking payload (customer linkage, package, add-ons, preferred date, total).
5. Backend persists booking and booking add-ons; renewal profile recomputation hooks run.

### 6.3 Recommendation Refresh / Metrics Flow

1. Admin triggers rebuild endpoint.
2. Backend exports booking + booking_addon data to recommender CSVs.
3. Popularity artifacts rebuilt and in-memory caches invalidated.
4. Optional pipeline recompute endpoint runs scripts: data build -> split -> train -> evaluate.
5. Metrics endpoint returns aggregated evaluation artifacts for dashboard use.

### 6.4 ETL Flow

1. `run_etl` extracts files from incoming directory.
2. Transform produces canonical rows.
3. Rows are inserted into staging (`StagingBooking`).
4. Optional merge writes into customer/booking canonical domain.
5. Processed files moved to processed directory.

## 7. Authentication & Access Architecture

- Token-based auth support via DRF token model.
- Custom auth endpoints perform login/signup/logout/profile actions.
- `StaffProfile` extends user account operational data and setup state.
- Password reset is approval-based through `PasswordResetRequest` records.
- Roles: `OWNER` (superuser), `ADMIN` (`is_staff`), `STAFF` (other accounts). `dev_mode` on `StaffProfile` adds an elevated tier for permanent purge in Internal Records; only `manage.py create_dev_account` sets it.
- Default DRF permission is `IsAuthenticated`. Viewsets use `StaffOrKioskAction`: signed-in staff may call every action, anonymous callers only the actions in `kiosk_actions` (catalog reads, customer create and lookup by email, booking create). Some function views stay `AllowAny`: login and password reset requests, plus the kiosk's recommendations, loyalty settings, customer coupons, coupon validation, and booking confirmation email. `/cron/send-coupon-emails/` is also `AllowAny` but checks its own secret (`/cron/send-coupon-emails/` checks `CRON_SECRET`).
- Views apply role checks on top, for example ADMIN/OWNER-only restore and training approval.
- Staff actions are written to `ActionLog` and shown on the Action Logs page.

## 8. Analytics and Intelligence Architecture

### 8.1 Renewal Intelligence

- Renewal metrics computed from accepted booking statuses (`Ongoing`, `BOOKED`).
- `recompute_customer_renewal_profile` recalculates per-customer aggregates and writes `Renewal`.
- Renewal endpoint builds probability banding and explanatory factors for UI consumption.
- Shadow mode (`run_renewal_shadow`, `evaluate_renewal_shadow`, `report_renewal_shadow_metrics`) records predictions daily without changing the live heuristic, then scores them after the 365-day outcome window. A monthly job can request or start challenger training; it never replaces the live heuristic automatically. See `Docs/renewal-shadow-mode.md`.
- `suggest_coupons_for_at_risk` can send a win-back coupon to customers with low renewal probability.

### 8.2 Recommendation Intelligence

- Primary strategy: customer booking history ranking.
- Fallback strategy: global popular packages and top add-on combinations.
- Service caching reduces repeated artifact loading.
- Dashboard metrics endpoint can consume saved CSV artifacts and optional live fallback evaluation.

## 9. Architectural Strengths

- Clear API-first integration between multiple client applications.
- Shared domain model ensures consistent customer/package/booking semantics.
- Layer separation exists between UI, API orchestration, and data/model pipelines.
- Recommender and renewal capabilities are integrated without coupling frontends to ML internals.
- ETL and recompute flows support operational backfills and model refresh.

## 10. Architectural Risks and Improvement Targets

- Current local-only API base URLs and child-process startup model are dev-oriented.
- Public tunnels (ngrok, Cloudflare Quick Tunnel) are for testing; Quick Tunnel links change on every start and have no uptime guarantee.
- The remaining `AllowAny` kiosk endpoints should be rate-limited before long-term public exposure.
- Running long recompute pipelines in request/response cycle can block workers; background job queue is recommended.
- Recommender/renewal artifacts and ETL file paths rely on local filesystem conventions.
- API gateway/config abstraction for environment switching (dev/staging/prod) should be unified across clients.

## 11. Suggested Target Architecture (Next Iteration)

- Keep Django API as core system-of-record boundary.
- Introduce job queue (Celery/RQ) for ETL/recompute/rebuild workflows.
- Move remaining in-view role checks into reusable DRF permission classes.
- Externalize config for base URLs and service discovery per environment.
- Split analytics/model endpoints into dedicated service layer if workload grows.
- Add observability stack (structured logs, metrics, trace IDs) across API and clients.

## 12. Architecture Summary

Snaplytics uses a centralized Django REST backend with two independent clients (Electron admin and React Native kiosk). Core business operations (catalog, customers, bookings, auth) flow through DRF endpoints backed by PostgreSQL. Recommendation, renewal scoring, and ETL pipelines are integrated as supporting subsystems. The current architecture is strong for rapid multi-client delivery and should next focus on production hardening: security boundaries, async pipelines, and environment-aware deployment patterns.
