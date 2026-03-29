# Snaplytics / Heigen Studio

Monorepo for Heigen Studio: Django REST API, Electron staff admin, and Expo kiosk.

## Layout

| Directory | Role |
|-----------|------|
| `Snaplytics/` | Django project (`manage.py`, apps, `endpoints/` API) |
| `electron-app/` | Electron desktop app (staff admin: customers, coupons, kiosk pages) |
| `HeigenKiosk/` | Expo / React Native customer kiosk and booking flow |

## Backend (Django)

```bash
cd Snaplytics
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

API routes live under `Snaplytics/endpoints/`. Point clients at `http://localhost:8000` (or your host) and the `/api/...` paths your apps expect.

## Staff admin (Electron)

```bash
cd electron-app
npm install
npm start
```

Configure API base URL via the app’s settings or `.env` as documented in `electron-app` (uses `dotenv`).

## Customer kiosk (Expo)

See **[HeigenKiosk/README.md](HeigenKiosk/README.md)** for install steps, `API_BASE_URL`, booking flow, and admin queue.

```bash
cd HeigenKiosk
npm install
npx expo start
```

## Development notes

- Run the Django server before exercising API-dependent UIs (Electron kiosk pages, Expo app).
- Git status and branches apply to this whole tree unless you use sparse checkouts.
