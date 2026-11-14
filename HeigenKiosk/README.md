# Heigen Studio Kiosk — React Native App

A complete Expo (React Native) kiosk booking system for Heigen Studio, connected to your existing Django REST backend.

---

## 📁 Project Structure

```
HeigenKiosk/
├── app/
│   ├── index.js              ← Kiosk booking flow (customer-facing)
│   └── admin.js              ← Staff booking queue (admin-facing)
├── src/
│   ├── api/
│   │   └── client.js         ← ALL Django API calls (single source of truth)
│   ├── constants/
│   │   ├── api.js            ← Base URL + endpoint constants
│   │   └── theme.js          ← Design tokens (colors, spacing, typography)
│   ├── components/
│   │   ├── ui.js             ← Shared primitive components
│   │   ├── Icon.js           ← Icon component
│   │   └── FullscreenBars.js ← Hides status bar + Android navigation bar
│   ├── hooks/
│   │   ├── useApi.js         ← Data fetching hooks
│   │   ├── useScale.js       ← Screen size / tablet scaling
│   │   └── useKeyboardHeight.js ← Keeps dialogs above the on-screen keyboard
│   ├── utils/                ← Add-on lines, date display, loyalty claim helpers
│   └── screens/
│       ├── KioskApp.js         ← Root orchestrator (step wizard)
│       ├── CategoryScreen.js   ← Step 1: choose category
│       ├── PackageScreen.js    ← Step 2: choose package (+ popular from data)
│       ├── AddonsScreen.js     ← Step 3: add-ons (+ popular from bookings)
│       ├── CustomerFormModal.js  ← Customer info collection
│       ├── BookingSummaryModal.js ← Review before submit
│       ├── ConfirmationScreen.js  ← Success state (auto-resets in 4s)
│       └── AdminBookingQueue.js   ← Staff queue: Pending → Ongoing → Done
├── shared_package_data.js    ← Updated admin web app data layer
├── package-api.js            ← Updated admin category page (with Refresh AI btn)
├── app.json
├── app.config.js             ← Extends app.json; reads KIOSK_BASE_URL for web exports
├── babel.config.js
└── package.json
```

---

## 🚀 Setup

### 0. Verify requirements

- Node.js 18+ (Node.js 20 LTS recommended)
- npm 9+
- Expo via `npx expo ...` (no global install required)
- Django API running and reachable from your emulator/device

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

### 2. Configure API URL

Edit **`src/constants/api.js`**:

```js
// For Android emulator:
export const API_BASE_URL = 'http://10.0.2.2:8000/api';

// For iOS simulator:
export const API_BASE_URL = 'http://localhost:8000/api';

// For physical device (replace with your machine's LAN IP):
export const API_BASE_URL = 'http://192.168.1.42:8000/api';
```

### 3. Start the app

```bash
# Start Django first
cd ../Snaplytics
python manage.py runserver

# Then start Expo
cd ../HeigenKiosk
npm start
```

`npm start` runs `expo start --port 8090`, so Expo Go defaults to port `8090` automatically.

`python manage.py runserver` with no address listens on `0.0.0.0:8000`, so a
phone on the same Wi-Fi can reach the API at `http://<this PC's LAN IP>:8000/api`.

### Web export under a sub-path

Set `KIOSK_BASE_URL` to export the web build for a sub-path. `app.config.js`
passes it to Expo Router's `experiments.baseUrl`:

```powershell
$env:KIOSK_BASE_URL = "/kiosk"
npx expo export -p web --output-dir dist-kiosk --clear
```

`npm run web:ngrok` in `electron-app` runs this automatically and serves the
result at `/kiosk/`.

### Standalone ngrok web test

To test the kiosk by itself through ngrok, run:

```powershell
npm run kiosk:ngrok
```

Open the HTTPS URL printed by ngrok at its root:

```text
https://YOUR-NGROK-DOMAIN.ngrok-free.app/
```

This command builds the web export, starts Django on port `8000` if it is not
already running, serves the kiosk on port `8090`, proxies `/api` to local
Django, and starts ngrok. Do not append `/kiosk` in this standalone mode.

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
6. **Confirm** → Creates/finds customer via `POST /api/customers/`, then creates booking via `POST /api/customers/{id}/bookings/` with `session_status: "Pending"`. The confirmation email is then requested via `POST /api/kiosk/send-booking-confirmation/` in the background; an SMTP failure does not block the confirmation screen
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

The button in the admin queue header (`package-api.js`) calls `refreshRecommender()` which hits the Django `/api/recommendations/` endpoint, triggering the recommender service's recompute. If you add a dedicated Django endpoint like:

```python
# endpoints/urls.py
path('recommendations/refresh/', refresh_recommender_cache, name='refresh-recommender'),
```

Update `refreshRecommender()` in `shared_package_data.js` to hit that instead.

---

## 🔌 Django API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/packages/` | All packages (category filtered client-side) |
| GET | `/api/addons/` | All add-ons |
| GET | `/api/bookings/` | Booking counts for popularity |
| GET | `/api/bookings/?status=Pending,Ongoing` | Admin queue |
| GET | `/api/customers/by-email/?email=xxx` | Get single customer by email (404 if not found) |
| POST | `/api/customers/` | Create new customer |
| POST | `/api/customers/{id}/bookings/` | Submit booking as Pending |
| PATCH | `/api/bookings/{id}/status/` | Update booking status |
| POST | `/api/kiosk/send-booking-confirmation/` | Send booking confirmation email |
| GET | `/api/recommendations/{id}/` | Recommender (admin refresh) |

All endpoints match your existing `endpoints/urls.py` exactly — no backend changes required.

---

## 🎨 Design System

The app mirrors the web kiosk's visual design:

- **Accent color**: `#d97706` (amber)
- **Popular items**: gradient border cards with ★ headers
- **Sticky bottom panel**: package + addons + total on add-ons screen
- **Step indicator**: amber circles matching web version
- **Modals**: slide-up bottom sheets with drag handle; on tablets and wide screens, centered dialogs that scroll when the screen is short
- **Full screen**: status bar and Android navigation bar are hidden; a swipe from the edge shows them briefly

---

## 📦 Requirements

### Runtime requirements

- Node.js 18+ (Node.js 20 LTS recommended)
- npm 9+
- Expo CLI via `npx expo ...`
- Django backend running at `http://localhost:8000` (or reachable LAN host for device testing)

### Project dependencies

Dependencies are defined in `package.json`. Key packages:

- `expo` `^58.0.25`
- `expo-router` `~58.0.31`
- `expo-navigation-bar` `~58.0.4`
- `expo-splash-screen` `~58.0.14`
- `react-native` `0.88.1`
- `react` / `react-dom` `19.3.0`
- `react-native-web` `^0.21.4`
- `@react-native-async-storage/async-storage` `2.2.0`
- `@react-native-community/datetimepicker` `9.2.1`
- `react-native-safe-area-context` `~5.11.1`
- `react-native-screens` `~4.30.1`

Install with:

```bash
npm install
```

---

## 🗂 Admin Web App Updates

The `shared_package_data.js` file has been fully rewritten to pull from Django instead of localStorage. It exports:

- `getCategories()` — derived from packages
- `getPackagesByCategory(name)` — filtered packages
- `getAddonsByCategory(name)` — filtered add-ons
- `getCustomers()` / `getCustomer(id)`
- `getBookings()` / `getCustomerBookings(customerId)`
- `updateBookingStatus(bookingId, status)`
- `refreshRecommender()` — triggers recommender recompute

The `package-api.js` admin page now includes a **"✦ Refresh AI Recommendations"** button — add this to your admin HTML:

```html
<button id="refreshRecommenderBtn" onclick="refreshRecommenderData()">
  ✦ Refresh AI Recommendations
</button>
```
