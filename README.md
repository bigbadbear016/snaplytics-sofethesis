# Snaplytics / Heigen Studio

Monorepo for Heigen Studio systems:

- Django REST API (`Snaplytics/`)
- Electron staff admin app (`electron-app/`)
- Expo kiosk app (`HeigenKiosk/`)

## Repository Layout


| Directory       | Role                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `Snaplytics/`   | Django project (`manage.py`, models, migrations, `endpoints/` API)      |
| `electron-app/` | Electron desktop app (staff workflows: customers, coupons, action logs) |
| `HeigenKiosk/`  | Expo/React Native kiosk app for customer booking flow                   |


## Requirements

### Global tooling

- Git
- Node.js 18+ (Node.js 20 LTS recommended)
- npm 9+
- Python 3.11+ (3.12 recommended)

### Per-app requirements


| App                           | Requirements                                          | Details                                                |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| Backend (`Snaplytics/`)       | Python virtualenv + `pip install -r requirements.txt` | See `[Snaplytics/README.md](Snaplytics/README.md)`     |
| Staff Admin (`electron-app/`) | `npm install` + Electron runtime                      | See `[electron-app/README.md](electron-app/README.md)` |
| Kiosk (`HeigenKiosk/`)        | `npm install` + Expo runtime                          | See `[HeigenKiosk/README.md](HeigenKiosk/README.md)`   |


## Quick Start

### One-click Windows setup

Install all backend, kiosk, and Electron dependencies by double-clicking
[`install.bat`](install.bat) (or
[`install-and-start-windows.bat`](install-and-start-windows.bat)). The script
creates `Snaplytics/.venv`, installs Python and npm dependencies, runs database
migrations, and opens the backend, kiosk, and Electron app in separate windows.

To install without launching the apps, use
[`install-windows.bat`](install-windows.bat), then double-click
[`start-all-windows.bat`](start-all-windows.bat).

For a graphical launcher, double-click [`starter.bat`](starter.bat). It
provides separate **Start Backend**, **Start Staff**, **Start Kiosk**, and
**Start All** buttons, plus **Install / Repair**. Install / Repair opens a
visible command window that remains open so setup errors and diagnostics can be
read.

Requirements: Windows, Node.js 20 LTS, and Python 3.11+ installed and available
through the standard `node`, `npm`, or `python` commands. The installer
prefers the working `python` command and falls back to Python 3.12 through the
Python launcher, avoiding stale launcher entries. It validates the repository,
repairs broken virtual environments, retries npm installs after cache
verification, writes diagnostics to `install.log`, and can install missing
Node.js/Python through `winget` when available.

If automatic installation is unavailable, install these versions manually:

- Python 3.12: <https://www.python.org/downloads/release/python-31210/>
- Node.js 20 LTS: <https://nodejs.org/en/download>
- Microsoft C++ Build Tools: <https://visualstudio.microsoft.com/visual-cpp-build-tools/>

The default backend install does not require Microsoft C++ Build Tools:
`scikit-surprise` and PySpark are optional offline recommender-training
dependencies. Live recommendations use booking history and popularity data.
Install `Snaplytics/requirements-ml.txt` separately only when offline model
training is needed; that optional package may require Microsoft C++ Build Tools
on Windows.

### 0) Install requirements (all apps)

Run this once after cloning:

```bash
# Backend Python dependencies
cd Snaplytics
python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt

# Staff Admin dependencies
cd ..\electron-app
npm install

# Kiosk dependencies
cd ..\HeigenKiosk
npm install
```

If dependency install fails, re-check versions in the **Requirements** section above.

### 1) Backend (Django API)

```bash
cd Snaplytics
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

API is served at `http://localhost:8000` with routes under `/api/...`.

`createsuperuser` creates an `OWNER` account.

### Renewal shadow mode

The renewal shadow process tests renewal predictions safely before they are
used in the live app. It reads current booking data from Supabase, records
what the existing heuristic predicts, and later checks whether each customer
actually books again within 365 days.

Shadow mode does not change customer-facing predictions or send outreach. It
only collects results and metrics, so the team can compare the model with the
current heuristic before approving a change. Daily runs happen in the
background through Windows Task Scheduler. Failed runs appear as notifications
in the staff app.

Once enough mature results exist, the monthly process can train a challenger
model. Automatic training is optional and controlled by an ADMIN or OWNER.
Candidate models never replace the live heuristic automatically; promotion is
reviewed separately.

For a detailed, plain-language explanation of the complete renewal workflow,
including live predictions, shadow monitoring, outcomes, metrics, training,
notifications, and permissions, see
[Docs/renewal-shadow-mode.md](Docs/renewal-shadow-mode.md).

### Internal Records + Dev Mode

- Staff admin UI now labels recycle-bin features as **Internal Records**.
- Permanent delete ("Delete forever") from Internal Records requires `dev_mode=true` on the account profile.
- `dev_mode` is **not** configurable from Manage accounts UI or staff account API.
- `dev_mode` is set via backend CLI command only:

```bash
cd Snaplytics
python manage.py create_dev_account --username zxcdev --password zxcdev
```

This command creates or updates an `ADMIN` account and enables `StaffProfile.dev_mode=True`.

If your backend needs environment variables, create `Snaplytics/.env` before `runserver`.

### 2) Staff Admin (Electron)

```bash
cd electron-app
npm install
npm start
```

Staff shell kiosk modal default URL: `http://localhost:8090` (overridden when `kioskWebUrl` exists in browser `localStorage`).

Detailed requirements: `[electron-app/README.md](electron-app/README.md)`.

#### Browser hosting with one ngrok tunnel

The Electron shell itself cannot be hosted in a browser, but its HTML/CSS/JS
frontend can be served on port `4173`. The web server proxies `/api/...`
requests to local Django on port `8000`, so only the frontend port needs an
ngrok tunnel:

```powershell
cd ..
ngrok config add-authtoken "YOUR_NEW_TOKEN"
Start-Process python -ArgumentList "manage.py", "runserver", "8000" `
    -WorkingDirectory "$PWD\Snaplytics"
cd .\electron-app
npm run web:ngrok
```

Keep the ngrok token in the CLI's local configuration. Never commit it or put
it in source code. Revoke and replace any token that has been shared publicly.

### 3) Kiosk (Expo)

```bash
cd HeigenKiosk
npm install
npm start
```

`npm start` is configured as `expo start --port 8090`, so Expo Go uses port `8090` automatically.

For kiosk requirements and details (API URL, queue flow, booking flow), see `[HeigenKiosk/README.md](HeigenKiosk/README.md)`.

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
