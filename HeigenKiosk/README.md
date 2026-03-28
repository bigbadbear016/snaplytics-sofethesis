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
├── shared_package_data.js    ← Updated admin web app data layer
├── package-api.js            ← Updated admin category page (with Refresh AI btn)
├── app.json
├── babel.config.js
└── package.json
```

---

## 🚀 Setup

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
python manage.py runserver

# Then start Expo
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
| GET | `/api/recommendations/{id}/` | Recommender (admin refresh) |

All endpoints match your existing `endpoints/urls.py` exactly — no backend changes required.

---

## 🎨 Design System

The app mirrors the web kiosk's visual design:

- **Accent color**: `#d97706` (amber)
- **Popular items**: gradient border cards with ★ headers
- **Sticky bottom panel**: package + addons + total on add-ons screen
- **Step indicator**: amber circles matching web version
- **Modals**: slide-up bottom sheets with drag handle

---

## 📦 Required Dependencies

```json
{
  "expo": "~51.0.0",
  "expo-router": "~3.5.23",
  "expo-linear-gradient": "~13.0.2",
  "@expo/vector-icons": "^14.0.2",
  "react-native-safe-area-context": "4.10.5",
  "react-native-screens": "3.31.1"
}
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
