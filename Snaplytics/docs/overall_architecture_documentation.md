# Overall Architecture Documentation

## 1. System Overview

Snaplytics is a multi-client platform with a shared Django backend and PostgreSQL datastore.

- `Snaplytics/backend/` + `Snaplytics/endpoints/` provide the domain model, REST APIs, auth, analytics, recommendation, and renewal prediction.
- `electron-app/` (at workspace root, alongside Snaplytics) provides a desktop admin/staff interface for operations (customers, packages, bookings, dashboard, auth/profile).
- `HeigenKiosk/` provides a React Native kiosk application for walk-in booking capture and guided customer flow.
- `recommender/` and `renewal/` provide recommendation and renewal model pipelines and evaluation artifacts.
- `etl/` provides ingestion/staging/merge jobs for operational data files.

The architecture is API-centric: both frontends consume Django REST endpoints under `/api/`.

## 2. High-Level Component Model

### 2.1 Backend Layer (Django + DRF)

Primary modules:

- `Snaplytics/settings.py`: project configuration (PostgreSQL, DRF auth/pagination, CORS, installed apps).
- `Snaplytics/urls.py`: mounts all REST endpoints through `path('api/', include('endpoints.urls'))`.
- `backend/models.py`: core business entities and relationships.
- `endpoints/views.py`: viewsets and function endpoints for CRUD, auth, analytics, recommendations, renewal prediction.
- `endpoints/serializers.py`: request/response shaping, nested booking/add-on representation, write/read adaptation.
- `backend/renewal_utils.py`: live recomputation of renewal profile metrics from booking history.
- `backend/signals.py`: automatic `StaffProfile` creation via Django user `post_save`.

### 2.2 Admin Client Layer (Electron)

Primary modules:

- `electron-app/main.js`: desktop shell bootstrap; spawns Django `runserver` from sibling `Snaplytics/` folder; creates browser window.
- `electron-app/scripts/api-client.js`: centralized HTTP client with domain-specific API wrappers.
- `electron-app/scripts/*`: page-level logic for customers, packages, onboarding/auth, profile, notifications, recommendations.
- `electron-app/pages/*`: staff admin and guest HTML/CSS/JS pages.

Electron acts as a thin client over the DRF API and does not host primary business logic or direct DB access.

### 2.3 Kiosk Client Layer (React Native)

Primary modules:

- `HeigenKiosk/src/screens/KioskApp.js`: kiosk orchestration state machine and step navigation.
- `HeigenKiosk/src/api/client.js`: API request layer for categories/packages/add-ons/customers/bookings/recommendations.
- `HeigenKiosk/src/screens/*`: category/package/add-ons/confirmation/customer form/booking queue screens.
- `HeigenKiosk/src/components/*`: reusable UI primitives.

Kiosk flow is transactional: collect selections and customer info, resolve recommendations, submit booking.

### 2.4 Data & Intelligence Layer

- `recommender/`: popularity artifacts, recommendation generation from booking history and fallbacks, evaluation scripts.
- `renewal/`: renewal feature engineering/model results used by dashboard metrics endpoints.
- `etl/`: extract-transform-load into staging and optional merge into canonical customer/booking domain.

## 3. Runtime Topology

### 3.1 Development Runtime

- Electron `main.js` starts Django via child process.
- Django serves API at `http://127.0.0.1:8000/api`.
- Electron renderer and React Native app call backend over HTTP.
- Database is PostgreSQL (SSL-enabled connection options in settings).

### 3.2 Process Boundaries

- Process A: Django app server (API/business logic).
- Process B: Electron main + renderer (desktop UI shell).
- Process C: React Native runtime (mobile/tablet kiosk UI).
- Optional jobs: ETL commands and recommendation pipeline scripts (subprocess execution).

## 4. Core Domain Model

From `backend/models.py`:

- `Category`: package categorization metadata.
- `Package`: service offerings with pricing, promo metadata, inclusions, image.
- `Addon`: optional upsell items and pricing.
- `Customer`: customer profile/contact/source and optional package relation.
- `Booking`: transaction linking customer + package, status, payment, totals, schedule.
- `BookingAddon`: line-item add-on quantities/costs for a booking.
- `Renewal`: derived per-customer renewal metrics (booking frequency/value/spend/preferred package type).
- `StagingBooking`: ETL staging record for raw/canonical transformed rows and status.
- `StaffProfile`: operational profile for platform users.
- `PasswordResetRequest`: reset request approval workflow tracking.

## 5. API Surface Architecture

### 5.1 REST Routing

`endpoints/urls.py` exposes:

- CRUD resources via `DefaultRouter`: `/customers`, `/bookings`, `/packages`, `/addons`, `/categories`.
- Nested customer bookings: `/customers/<customer_pk>/bookings/...`.
- Auth endpoints: `/auth/login`, `/auth/signup`, `/auth/reset-password`, `/auth/logout`, `/auth/profile`.
- Recommendation endpoints: `/recommendations/<customer_id>`, `/recommendations/popular`, `/recommendations/rebuild`.
- Analytics endpoints: `/analytics/dashboard`, `/analytics/model-metrics`, `/analytics/model-metrics/recompute-recommendation`.
- Renewal endpoint: `/renewal/<customer_id>/`.

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
- Current permission defaults are permissive (`AllowAny`) on many endpoints; role-hardening is a future architecture control.

## 8. Analytics and Intelligence Architecture

### 8.1 Renewal Intelligence

- Renewal metrics computed from accepted booking statuses (`Ongoing`, `BOOKED`).
- `recompute_customer_renewal_profile` recalculates per-customer aggregates and writes `Renewal`.
- Renewal endpoint builds probability banding and explanatory factors for UI consumption.

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
- Widespread `AllowAny` permissions should be tightened for production.
- Running long recompute pipelines in request/response cycle can block workers; background job queue is recommended.
- Recommender/renewal artifacts and ETL file paths rely on local filesystem conventions.
- API gateway/config abstraction for environment switching (dev/staging/prod) should be unified across clients.

## 11. Suggested Target Architecture (Next Iteration)

- Keep Django API as core system-of-record boundary.
- Introduce job queue (Celery/RQ) for ETL/recompute/rebuild workflows.
- Enforce role-based permissions on all mutating endpoints.
- Externalize config for base URLs and service discovery per environment.
- Split analytics/model endpoints into dedicated service layer if workload grows.
- Add observability stack (structured logs, metrics, trace IDs) across API and clients.

## 12. Architecture Summary

Snaplytics uses a centralized Django REST backend with two independent clients (Electron admin and React Native kiosk). Core business operations (catalog, customers, bookings, auth) flow through DRF endpoints backed by PostgreSQL. Recommendation, renewal scoring, and ETL pipelines are integrated as supporting subsystems. The current architecture is strong for rapid multi-client delivery and should next focus on production hardening: security boundaries, async pipelines, and environment-aware deployment patterns.
