# Heigen Studio Kiosk APK — React Native App

A standalone Expo (React Native) kiosk booking system for Heigen Studio that talks directly to Supabase PostgREST on the underlying PostgreSQL database.

---

## 📁 Project Structure

```
HeigenKiosk/
├── app/
│   ├── index.js              ← Kiosk booking flow (customer-facing)
│   └── admin.js              ← Staff booking queue (admin-facing)
├── src/
│   ├── api/
│   │   ├── client.js         ← APK data layer (Supabase/PostgREST)
│   │   └── standalone-backend.js ← shared Supabase helpers
│   ├── constants/
│   │   ├── api.js            ← Base URL + endpoint constants
│   │   └── theme.js          ← Design tokens (colors, spacing, typography)
│   ├── components/
│   │   └── ui.js             ← Shared primitive components
│   ├── hooks/
│   │   └── useApi.js         ← Data fetching hooks
│   └── screens/
│       ├── KioskApp.js         ← Root orchestrator (step wizard)
│       ├── CategoryScreen.js   ← Step 1: choose category
│       ├── PackageScreen.js    ← Step 2: choose package (+ popular from data)
│       ├── AddonsScreen.js     ← Step 3: add-ons (+ popular from bookings)
│       ├── CustomerFormModal.js  ← Customer info collection
│       ├── BookingSummaryModal.js ← Review before submit
│       ├── ConfirmationScreen.js  ← Success state (auto-resets in 4s)
│       └── AdminBookingQueue.js   ← Staff queue: Pending → Ongoing → Done
├── shared_package_data.js    ← Admin web app data layer (same standalone backend)
├── package-api.js            ← Updated admin category page (with Refresh AI btn)
├── app.json
├── babel.config.js
└── package.json
```

---

## 🚀 Setup

### 0. Verify requirements

- Node.js 18+ (Node.js 20 LTS recommended)
- npm 9+
- Expo via `npx expo ...` (no global install required)
- Supabase project with PostgREST enabled and RLS policies configured

Quick version check:

```bash
node -v
npm -v
```

### 1. Install dependencies

```bash
cd HeigenKiosk
npm install
```

### 2. Configure Supabase

Copy `.env.example` to `.env` and fill in your Supabase URL and anon key.

### 3. Start the app

```bash
# Start Expo
cd ../HeigenKiosk
npx expo start
```

---

## 📱 Booking Flow (Customer Kiosk)

```
Category → Package → Add-ons → [Customer Form Modal] → [Summary Modal] → Confirmation
```

1. **Category Screen** — Fetches categories dynamically from `GET /api/packages/` (derived by unique `category` field)
2. **Package Screen** — Fetches packages for the selected category. The **most-booked** package (computed from booking counts) is highlighted as "Most Booked Package"
3. **Add-ons Screen** — Fetches add-ons. **Most-selected** add-ons (computed from `BookingAddon` records) float to the top as "Frequently Added"
4. **Customer Form** — Collects name, email, phone, optional preferred date, and consent
5. **Summary** — Review with total price breakdown
6. **Confirm** → Creates/finds customer via `POST /api/customers/`, then creates booking via `POST /api/customers/{id}/bookings/` with `session_status: "Pending"`
7. **Confirmation** — Auto-resets to home after 4 seconds

---

## 👥 Admin Booking Queue

Located at `app/admin.js`. Staff can:

| Action | Result |
|--------|--------|
| Tap a Pending booking → "Accept" | `PATCH /api/bookings/{id}/status/` → `"Ongoing"` |
| Tap an Ongoing booking → "Mark Done" | `PATCH /api/bookings/{id}/status/` → `"BOOKED"` |
| Tap any → "Cancel" | `PATCH /api/bookings/{id}/status/` → `"Cancelled"` |
| **Refresh AI** button | Re-queries the recommender; popular choices update from latest booking data |

Pull-to-refresh updates the queue in real time.

---

## 🤖 Recommender Integration

### How popularity is computed

The app **doesn't cache** popularity — it computes it **live from bookings** every time a screen loads:

- **Popular package**: counts `Booking` rows per package within the selected category → top by count
- **Popular add-ons**: counts `BookingAddon.addon_quantity` grouped by `addon_id` → top 3

This means **as soon as a booking is completed, the next customer sees updated recommendations automatically** — no manual refresh needed for the kiosk.

### Admin "Refresh AI" button

The button in the admin queue header (`package-api.js`) calls `refreshRecommender()` which refreshes live popularity data from the same Supabase-backed tables. If you later add a dedicated refresh function, wire it in here:

```python
# endpoints/urls.py
path('recommendations/refresh/', refresh_recommender_cache, name='refresh-recommender'),
```

Update `refreshRecommender()` in `shared_package_data.js` to hit that instead.

---

## 🔌 Standalone Data Layer

The APK reads and writes directly to the Postgres tables exposed by Supabase PostgREST:

- `backend_category`
- `backend_package`
- `backend_addon`
- `backend_customer`
- `backend_booking`
- `backend_bookingaddon`
- `backend_coupon`
- `backend_couponsent`
- `backend_couponusage`

The kiosk keeps the same flow and UI behavior. Recommendations, popular packages, booking queue, customer lookup, and coupon validation are computed from the same live data in the APK.

---

## 🎨 Design System

The app mirrors the web kiosk's visual design:

- **Accent color**: `#d97706` (amber)
- **Popular items**: gradient border cards with ★ headers
- **Sticky bottom panel**: package + addons + total on add-ons screen
- **Step indicator**: amber circles matching web version
- **Modals**: slide-up bottom sheets with drag handle

---

## 📦 Requirements

### Runtime requirements

- Node.js 18+ (Node.js 20 LTS recommended)
- npm 9+
- Expo CLI via `npx expo ...`
- Supabase project with the anon key configured for the APK build

### Project dependencies

Dependencies are defined in `package.json`. Key packages:

- `expo` `~51.0.0`
- `expo-router` `~3.5.23`
- `react-native` `0.74.5`
- `react` / `react-dom` `18.2.0`
- `@react-native-async-storage/async-storage` `1.23.1`
- `@react-native-community/datetimepicker` `8.0.1`
- `react-native-safe-area-context` `4.10.5`
- `react-native-screens` `3.31.1`

Install with:

```bash
npm install
```

---

## 🗂 Admin Web App Updates

The `shared_package_data.js` file now shares the same standalone backend helpers as the APK. It exports:

- `getCategories()` — derived from packages
- `getPackagesByCategory(name)` — filtered packages
- `getAddonsByCategory(name)` — filtered add-ons
- `getCustomers()` / `getCustomer(id)`
- `getBookings()` / `getCustomerBookings(customerId)`
- `updateBookingStatus(bookingId, status)`
- `refreshRecommender()` — refreshes live popularity data

The `package-api.js` admin page now includes a **"✦ Refresh AI Recommendations"** button — add this to your admin HTML:

```html
<button id="refreshRecommenderBtn" onclick="refreshRecommenderData()">
  ✦ Refresh AI Recommendations
</button>
```
