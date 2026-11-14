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
- Node.js 22.13+ or 24.3+ (current LTS recommended). The kiosk's Expo SDK 58 needs it.
- npm 9+
- Python 3.12 (the backend's `numpy==1.26.4` has no wheels for 3.13+)

### Per-app requirements


| App                           | Requirements                                          | Details                                                |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| Backend (`Snaplytics/`)       | Python virtualenv + `pip install -r requirements.txt` | See [Snaplytics/README.md](Snaplytics/README.md)     |
| Staff Admin (`electron-app/`) | `npm install` + Electron runtime                      | See [electron-app/README.md](electron-app/README.md) |
| Kiosk (`HeigenKiosk/`)        | `npm install` + Expo runtime                          | See [HeigenKiosk/README.md](HeigenKiosk/README.md)   |


## Quick Start

### One-click Windows setup

Install all backend, kiosk, and Electron dependencies by double-clicking
[`install.bat`](install.bat). The script
creates `Snaplytics/.venv`, installs Python and npm dependencies, runs database
migrations, and opens the backend, kiosk, and Electron app in separate windows.

To install without launching the apps, use
[`install-windows.bat`](install-windows.bat), then double-click
[`start-all-windows.bat`](start-all-windows.bat).

For a graphical launcher, double-click [`starter.bat`](starter.bat). It shows
one row per service with a live status (Running / Starting / Stopped) and its own
**Start**, **Stop**, and **Open** buttons:

| Service | What it runs |
| --- | --- |
| Backend (Django API) | `manage.py runserver 0.0.0.0:8000` |
| Kiosk (Expo) | `npm start` in `HeigenKiosk` (Expo Go: `exp://<this PC's LAN IP>:8090`) |
| Staff app (Electron) | `npm start` in `electron-app` |
| Public link (ngrok) | `npm run web:ngrok` in `electron-app`: staff web at the public URL and the kiosk at `/kiosk/`. Starts the backend first if needed. **Open** copies and opens the public kiosk link. Requires the ngrok CLI with an auth token. |
| Public link (Cloudflare) | `npm run web:cloudflare` in `electron-app`: same as ngrok, through a Cloudflare Quick Tunnel. No account or bandwidth cap; the link changes on every start. Installs `cloudflared` the first time. |

It also has **Start All** (backend, kiosk, staff app), **Stop All** (everything,
including ngrok), **Copy Expo Go URL**, **Install / Repair**, and an activity
log. Status checks and start/stop run in the background, so the window stays
responsive, and only one action runs at a time. Services run in their own
windows, so closing the starter does not stop them.
Install / Repair opens a visible command window that remains open so setup
errors and diagnostics can be read.

Backup launcher: `HeigenStarter.exe` in the project root opens the same starter
window without a console (useful if `.bat` files are blocked). Arguments work the
same, e.g. `HeigenStarter.exe -Status`. Rebuild it with
[`tools/starter-exe/build.bat`](tools/starter-exe/build.bat), which uses the C#
compiler built into Windows.

To stop everything without the window, double-click
[`stop-all-windows.bat`](stop-all-windows.bat). From a terminal you can also run
`starter.bat -StartAll`, `-StopAll`, `-Status`, or control one service with
`-Start <name>` / `-Stop <name>` (`backend`, `kiosk`, `staff`, `ngrok`, `cloudflare`).

Requirements: Windows, Node.js 22.13+, 24.3+, or 26+, and Python 3.12. The
installer looks for Python 3.12 through the Python launcher (`py -3.12`), then
the `python` command, then the standard install folders. It validates the repository,
repairs broken virtual environments, retries npm installs after cache
verification, and writes diagnostics to `install.log`.

When Node.js or Python 3.12 is missing, the installer installs a pinned version
with [`tools/install-runtime.ps1`](tools/install-runtime.ps1):

1. winget: `winget install --id OpenJS.NodeJS.22 --version 22.20.0` or
   `winget install --id Python.Python.3.12 --version 3.12.10`.
2. If winget is missing or fails, it downloads the same version from
   nodejs.org or python.org, checks the digital signature (and the SHA-256
   checksum for Node.js), and installs it silently.
3. If that also fails, it prints the direct download link for a manual install.

Newer versions already on the PC:

- **Node.js**: a supported version (22.13+, 24.3+, 26+) is kept as it is. An
  unsupported newer version, such as 23.x or 25.x, is upgraded to the newest
  LTS (`winget install --id OpenJS.NodeJS.LTS`), because the Node.js installer
  cannot downgrade. Node.js installs for all users; Windows asks for
  administrator permission once.
- **Python**: versions install side by side. If only a newer Python (for
  example 3.13 or 3.14) exists, Python 3.12.10 is installed next to it for the
  current user, without administrator permission. The other Python stays, and
  `Snaplytics\.venv` is always built with 3.12 (recreated if it used another
  version).

Manual install, then run the installer again:

- Node.js 22.20.0: <https://nodejs.org/dist/v22.20.0/node-v22.20.0-x64.msi>
- Python 3.12.10: <https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe>
  (tick "Add python.exe to PATH")
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

`python manage.py runserver` with no address listens on `0.0.0.0:8000`, so
phones running Expo Go on the same Wi-Fi can reach the API. An explicit
address still wins, for example `python manage.py runserver 127.0.0.1:8000`.
Set `DJANGO_RUNSERVER_ADDR` to change the default.

`createsuperuser` creates an `OWNER` account.

### Renewal prediction and shadow mode

The app predicts renewals with one XGBoost model. The model is trained on
every accepted booking in Supabase:

```powershell
cd Snaplytics
python manage.py train_renewal_xgboost
```

The shadow process records the live model's predictions from current Supabase
booking data. It later checks whether each customer actually books again
within 365 days.

Shadow mode does not change customer-facing predictions or send outreach. It
only collects results and metrics. Daily runs happen in the background through
Windows Task Scheduler. Failed runs appear as notifications in the staff app.

Once enough mature results exist, the monthly process can train a challenger
model. Automatic training is optional and controlled by an ADMIN or OWNER.
Candidate models never replace the live model automatically; promotion is
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

Detailed requirements: [electron-app/README.md](electron-app/README.md).

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

Use the URL printed by `npm run web:ngrok` and append `/kiosk/` for the
remote kiosk. Do not tunnel port `8090` directly; the public tunnel must target
the Electron web proxy on port `4173`.

Keep the ngrok token in the CLI's local configuration. Never commit it or put
it in source code. Revoke and replace any token that has been shared publicly.

#### Public link with Cloudflare Tunnel (no bandwidth cap)

`npm run web:cloudflare` works like `web:ngrok`, but uses a Cloudflare
[Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
instead of ngrok. It needs no account and has no bandwidth cap.

```powershell
cd electron-app
npm run web:cloudflare
```

It builds the kiosk, starts Django if needed, serves the staff web on port
`4174` (so it can run next to the ngrok link on `4173`), and opens the tunnel.
It prints a link such as `https://word-word-word-word.trycloudflare.com/`;
add `/kiosk/` for the kiosk. A new link can take a few seconds to start
working.

- `cloudflared` is installed automatically the first time (winget, otherwise
  the signed download from
  [GitHub](https://github.com/cloudflare/cloudflared/releases/latest)).
  `install.bat` also installs it. Set `CLOUDFLARED_PATH` to use another copy.
- The link changes on every start. For a link that never changes, use a named
  Cloudflare Tunnel with your own domain.
- Quick Tunnels are meant for testing: up to 200 requests in progress at once
  and no uptime guarantee.

### 3) Kiosk (Expo)

```bash
cd HeigenKiosk
npm install
npm start
```

`npm start` is configured as `expo start --port 8090`, so Expo Go uses port `8090` automatically.

For kiosk requirements and details (API URL, queue flow, booking flow), see [HeigenKiosk/README.md](HeigenKiosk/README.md).

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

## API access

Signed-in staff can use the whole API (role checks still apply). Without a
login, only the kiosk's actions work: reading the catalog, finding or creating
a customer, creating a `Pending` booking, recommendations, loyalty settings,
customer coupons, coupon validation, and the booking confirmation email. The rule lives in
[`Snaplytics/endpoints/permissions.py`](Snaplytics/endpoints/permissions.py);
each viewset lists its anonymous actions in `kiosk_actions`.

## Development Notes

- Start Django before testing Electron/Expo features that call the API.
- Run the backend tests from `Snaplytics/` with
  `python manage.py test endpoints --settings=Snaplytics.settings_test`.
  The test settings use an in-memory SQLite database, so tests need no
  Supabase connection and send no real email.
- API views live in `Snaplytics/endpoints/views/`, one module per area
  (customers, bookings, catalog, coupons, recommendations, dashboard, renewal,
  accounts, records), with shared helpers in `_common.py` and `recycle.py`.

## Documentation

- [Snaplytics/docs/overall_architecture_documentation.md](Snaplytics/docs/overall_architecture_documentation.md): architecture, data model, API surface, access rules
- [Snaplytics/docs/windows_vscode_setup_documentation.md](Snaplytics/docs/windows_vscode_setup_documentation.md): manual Windows + VS Code setup, coupon cron jobs
- [Snaplytics/docs/recommendations-and-suggestions.md](Snaplytics/docs/recommendations-and-suggestions.md): recommendation logic
- [Docs/renewal-shadow-mode.md](Docs/renewal-shadow-mode.md): renewal predictions and shadow mode
- [Docs/README.md](Docs/README.md): thesis diagrams and literature
- [CHANGELOG.md](CHANGELOG.md): recent changes
- This repo is a monorepo; git operations apply to all subprojects unless scoped.
