# Snaplytics / Heigen Studio

Monorepo for Heigen Studio systems:
- Django REST API (`Snaplytics/`)
- Electron staff admin app (`electron-app/`)
- Expo kiosk app (`HeigenKiosk/`)

## Repository Layout

| Directory | Role |
|---|---|
| `Snaplytics/` | Django project (`manage.py`, models, migrations, `endpoints/` API) |
| `electron-app/` | Electron desktop app (staff workflows: customers, coupons, action logs) |
| `HeigenKiosk/` | Expo/React Native kiosk app for customer booking flow |

## Quick Start

### 1) Backend (Django API)

```bash
cd Snaplytics
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

API is served at `http://localhost:8000` with routes under `/api/...`.

### 2) Staff Admin (Electron)

```bash
cd electron-app
npm install
npm start
```

### 3) Kiosk (Expo)

```bash
cd HeigenKiosk
npm install
npx expo start
```

For kiosk details (API URL, queue flow, booking flow), see [`HeigenKiosk/README.md`](HeigenKiosk/README.md).

## Coupon Email Composer Notes

### Template storage and API

Email templates are persisted in DB per authenticated user.

Endpoints:
- `GET /api/email-templates/`
- `POST /api/email-templates/`
- `PUT /api/email-templates/<id>/`
- `DELETE /api/email-templates/<id>/`

### Required migration

If you pulled recent coupon/email changes, run:

```bash
cd Snaplytics
python manage.py migrate
```

### Supported placeholders

Both placeholders are supported in subject/body/html:
- `{{code}}`
- `{{coupon}}`

Both resolve to the selected coupon code when sending.

### HTML mode behavior (staff admin)

- Radio options: `Plain text` and `HTML Editor`.
- Selecting `HTML Editor` shows inline HTML textbox.
- `View HTML editor and preview` opens the separate editor+preview modal.
- HTML preview is isolated to avoid CSS leaking into app UI.
- Fullscreen modal supports editor-only, preview-only, or both views.

## Development Notes

- Start Django before testing Electron/Expo features that call the API.
- This repo is a monorepo; git operations apply to all subprojects unless scoped.
