# Project Setup Guide (Windows + VS Code)

## 1. Purpose

This guide explains how to run the full Snaplytics stack in a new **Windows** local environment using **VS Code**:

- Django backend (`backend`, `endpoints`, `Snaplytics`)
- Electron admin app (`electron-app`)
- HeigenKiosk React Native app (`HeigenKiosk`)

## 2. Prerequisites (Windows)

Install these first:

1. **Git for Windows**
2. **Python 3.12** (the backend's `numpy==1.26.4` has no wheels for 3.13+):
   <https://www.python.org/downloads/windows/>
3. **Node.js 22.13+, 24.3+, or 26+** with npm 9+ (the kiosk's Expo SDK 58 needs it):
   <https://nodejs.org/en/download>
4. **VS Code**
5. **PostgreSQL client access** (local DB or hosted Supabase credentials)
6. **Java 17 + Android Studio** (only for the Android emulator):
   <https://developer.android.com/studio>

The one-click installer (Section 2.1) installs Python 3.12 and Node.js for you
when they are missing.

Microsoft C++ Build Tools are needed only for the optional
`requirements-ml.txt` (offline recommender training):
<https://visualstudio.microsoft.com/visual-cpp-build-tools/>

Optional but recommended:

- VS Code extensions: `Python`, `Pylance`, `ESLint`, `Prettier`

## 2.1 One-Click Setup (Recommended)

From the repository root:

- Double-click `install.bat` to install everything (Python and npm
  dependencies, migrations) and open the backend, kiosk, and Electron app.
- Or run `install-windows.bat` to install only, then `start-all-windows.bat`.
- Use `starter.bat` (or `HeigenStarter.exe`) to start, stop, and open each
  service, including the ngrok and Cloudflare public links.

The installer writes diagnostics to `install.log`. See the root `README.md`
for details. Sections 5 to 7 describe the manual setup.

## 3. Clone and Open in VS Code

```powershell
git clone <YOUR_REPO_URL>
cd snaplytics
code .
```

Use the VS Code integrated terminal (`Terminal > New Terminal`) for all commands below.

## 4. Environment Variables

Create a `.env` file in the backend project root (`Snaplytics/.env`).

Use this template (replace with your own values):

```env
DB_NAME=postgres
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_HOST=your_db_host
DB_PORT=5432

EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_HOST_USER=your_email@example.com
EMAIL_HOST_PASSWORD=your_app_password
EMAIL_USE_TLS=true
DEFAULT_FROM_EMAIL=your_email@example.com

# Coupon cron (optional)
CRON_SECRET=your-random-32-char-secret
COUPON_AT_RISK_ID=5
```

Notes:

- `Snaplytics/settings.py` reads `DB_*` and `EMAIL_*` variables.
  `HEIGEN_SMTP_*` variables, when set, override `EMAIL_*` for booking emails.
- Do not commit real credentials to git.

## 5. Backend Setup (Django)

Run from the Django project root (`Snaplytics/`):

```powershell
py -3.12 -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; .\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Optional, only for offline recommender training (needs Microsoft C++ Build Tools):

```powershell
pip install -r requirements-ml.txt
```

Apply migrations and run backend:

```powershell
python manage.py migrate
python manage.py runserver
```

Backend should be available at:

- `http://127.0.0.1:8000`
- API base: `http://127.0.0.1:8000/api`

`runserver` with no address listens on `0.0.0.0:8000`, so phones on the same
Wi-Fi can reach it. Set `DJANGO_RUNSERVER_ADDR` to change the default.

Run the backend tests (in-memory SQLite, no Supabase or real email needed):

```powershell
python manage.py test endpoints --settings=Snaplytics.settings_test
```

## 6. Electron App Setup (Admin)

The Electron admin app lives at the workspace root (`electron-app/`), alongside `Snaplytics` and `HeigenKiosk`.

Open a new terminal in VS Code:

```powershell
cd electron-app
npm install
npm start
```

Important behavior:

- `electron-app/main.js` spawns Django from the sibling `Snaplytics/` folder.
- For Windows stability, run Django manually first (Section 5), then run Electron.

## 7. HeigenKiosk Setup (Expo React Native)

Open another terminal:

```powershell
cd HeigenKiosk
npm install
npm start
```

`npm start` runs `expo start --port 8090`.

For the Android emulator: in Android Studio, open
Tools > Device Manager > Add Virtual Device > Tablet, download an image, and
run it. Then press `a` in the terminal running Metro.

### 7.1 Kiosk API base URL

`HeigenKiosk/src/constants/api.js` picks the URL automatically:

- Expo Go on a phone: the PC's LAN IP from the Expo dev server, port `8000`.
- Android emulator: `http://10.0.2.2:8000/api`.
- Web kiosk on a public link (`/kiosk/`): same origin, `/api`.

To override it, set `EXPO_PUBLIC_API_BASE_URL` (full URL) or
`EXPO_PUBLIC_API_HOST` / `EXPO_PUBLIC_API_PORT` before `npm start`.

## 8. API URL Alignment Check

Confirm all clients point to the same backend host:

- Electron admin client: `electron-app/scripts/api-client.js` uses `window.HEIGEN_API_BASE`, else `http://127.0.0.1:8000/api`
- Kiosk client: `HeigenKiosk/src/constants/api.js` (see Section 7.1)

## 9. Recommended VS Code Workspace Workflow

Use 3 terminals:

1. Backend terminal
```powershell
cd Snaplytics
.\.venv\Scripts\Activate.ps1
python manage.py runserver
```
2. Electron terminal
```powershell
cd electron-app
npm start
```
3. Kiosk terminal
```powershell
cd HeigenKiosk
npm run start
```

## 10. First-Run Validation Checklist

1. Backend starts without DB/auth import errors.
2. `http://127.0.0.1:8000/api/packages/` responds (most other endpoints return `401` until you sign in).
3. Electron app opens and loads dashboard pages.
4. Kiosk app loads categories/packages from backend.
5. Creating a booking from kiosk appears in admin booking queue.

## 11. Common Windows Issues + Fixes

### 11.1 PowerShell script execution blocked

Error when activating venv:

```text
... cannot be loaded because running scripts is disabled ...
```

Fix (PowerShell as Admin):

```powershell
Set-ExecutionPolicy RemoteSigned
```

### 11.2 Python version mismatch

If install fails with native packages, ensure Python 3.12 is used:

```powershell
py -0p
py -3.12 -m venv .venv
```

### 11.3 DB connection errors

- Verify `.env` values are correct.
- Confirm DB host/port reachable from Windows machine.
- Confirm SSL requirements for hosted PostgreSQL are satisfied.

### 11.4 Kiosk cannot reach backend on device/emulator

- Emulator: use `10.0.2.2`, not `localhost`.
- Physical device: set `EXPO_PUBLIC_API_HOST` to the PC LAN IP and ensure both are on same network.
- Make sure Django listens on `0.0.0.0:8000` (the default), not `127.0.0.1`.
- Allow inbound port `8000` in Windows Firewall if needed.

### 11.5 Electron opens but API calls fail

- Ensure Django is already running.
- Confirm `API_BASE` in `electron-app/scripts/api-client.js` points to the active backend URL.
- A `401` response means the session expired; sign in again.

## 12. Coupon Module – Cron Jobs

### 12.1 Send Coupon Emails (SMTP)

When you send a coupon to customers from the desktop app, the system creates `CouponSent` records. A cron job sends the actual emails via SMTP.

1. Apply migration: `python manage.py migrate` (adds `email_sent_at` to CouponSent)
2. Configure SMTP in `.env` (`EMAIL_HOST`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, etc.)

**Option A – Supabase pg_cron (when using Supabase):**

1. Add to `.env`: `CRON_SECRET=your-random-secret` (32+ chars)
2. Supabase Dashboard > Database > Extensions: enable **pg_cron** and **pg_net**
3. Run `Snaplytics/supabase/cron_send_coupon_emails.sql` (replace `YOUR-DJANGO-URL` and `YOUR_CRON_SECRET`)
4. Django must be publicly reachable (deploy it, or use ngrok or a Cloudflare Tunnel for local testing)

**Option B – Windows Task Scheduler:**

Create a task to run every 5 minutes:

```powershell
cd <repo>\Snaplytics
.\.venv\Scripts\python.exe manage.py send_coupon_emails
```

**Test without sending:** `python manage.py send_coupon_emails --dry-run`

**Test cron endpoint manually:**

```powershell
curl -X POST http://127.0.0.1:8000/api/cron/send-coupon-emails/ -H "Authorization: Bearer YOUR_CRON_SECRET" -H "Content-Type: application/json"
```

### 12.2 Auto-Suggest Coupons for At-Risk Customers

Customers with low return probability (very_unlikely, unlikely) can be auto-sent a coupon.

1. Create a coupon for at-risk customers (e.g. "WELCOMEBACK20") in the desktop app
2. Add to `.env`: `COUPON_AT_RISK_ID=5` (use your coupon's ID)
3. Run daily (e.g. via Task Scheduler at 9am):

```powershell
cd <repo>\Snaplytics
.\.venv\Scripts\python.exe manage.py suggest_coupons_for_at_risk
```

**Options:**

- `--recompute` – Recompute all renewal profiles before suggesting (slower, fresher data)
- `--dry-run` – List at-risk customers without creating CouponSent records

## 13. Optional: Run ETL and Recommender Rebuild

From `Snaplytics/` (with venv active):

```powershell
python manage.py run_etl --merge
```

Rebuild popularity/recommendation artifacts (through API):

- POST `http://127.0.0.1:8000/api/recommendations/rebuild/`

## 14. Quick Start Command Summary

```powershell
# Terminal 1 (backend)
cd <repo>\Snaplytics
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver

# Terminal 2 (electron admin)
cd <repo>\electron-app
npm install
npm start

# Terminal 3 (kiosk)
cd <repo>\HeigenKiosk
npm install
npm run start
```

---

This setup gives you a complete local Windows development environment in VS Code for backend + desktop admin + kiosk client.
