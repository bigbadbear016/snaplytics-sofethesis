# Electron Staff Admin Requirements

## Runtime Requirements

- Node.js 18+ (Node.js 20 LTS recommended)
- npm 9+ (ships with modern Node.js)
- Running backend API at `http://localhost:8000`

## Install Requirements

```bash
cd electron-app
npm install
```

Quick version check:

```bash
node -v
npm -v
```

## Project Dependencies

Dependencies are managed in `package.json`:

- `electron` (dev dependency)
- `dotenv`

Install and run from a shell:

```bash
cd electron-app
npm install
npm start
```

## Host the UI in a browser

The Electron shell cannot be hosted through ngrok, but the existing HTML/CSS/JS
frontend can be served as a regular website:

```bash
cd electron-app
npm run web
```

Open `http://127.0.0.1:4173`. To expose that UI publicly, install and authenticate the **official ngrok CLI**
once, then run:

```bash
npm run web:ngrok
```

The launcher uses the `ngrok` executable on your `PATH`, rather than the npm
package. This ensures it uses the same authenticated configuration as a direct
`ngrok http 4173` command. Confirm it is available with `ngrok version`.
If `ngrok` is installed but is not on the current terminal's `PATH`, set its
full path for this session, for example:

```powershell
$env:NGROK_PATH = "C:\path\to\ngrok.exe"
npm run web:ngrok
```

Authenticate the official CLI once. Keep the token in ngrok's local
configuration; do not put it in `package.json`, source code, or a committed
`.env` file:

```powershell
ngrok config add-authtoken "YOUR_NEW_TOKEN"
ngrok config check
```

If a token has been pasted into chat, source control, or another shared
location, revoke it and create a replacement before using it.

Only one process can use port `4173`. If you already ran `npm run web`, stop
that process with its PID, or use another port:

```powershell
$env:PORT = "4174"
npm run web:ngrok
```

Alternatively, if the existing local web server is still running, expose it
directly without starting a second web server:

```powershell
npx --yes ngrok http 4173
```

The default web server proxies browser `/api/...` requests to local Django on
port `8000`. This means you only need one ngrok tunnel. To start both local
processes from one PowerShell terminal:

```powershell
cd ..
Start-Process python -ArgumentList "manage.py", "runserver", "8000" `
    -WorkingDirectory "$PWD\Snaplytics"
cd .\electron-app
npm run web:ngrok
```

The same web server exposes a static Expo web export at `/kiosk/`.
`npm run web:ngrok` rebuilds the kiosk on every start into
`HeigenKiosk/dist-kiosk` with `KIOSK_BASE_URL=/kiosk`, so routes and asset
URLs live under `/kiosk/`. It also starts Django on `0.0.0.0:8000` when it is
not already running:

```powershell
cd electron-app
npm run web:ngrok
```

The public kiosk uses the static export and does not use Expo's development
server or port `8090`.

Then open `https://YOUR-NGROK-DOMAIN.ngrok-free.app/kiosk/` (including the
trailing slash). The kiosk uses
the same proxied `/api` path when opened through this public URL.

Do **not** run `ngrok http 8090` for this setup. Port `8090` is Expo's
development server and does not contain a `/kiosk` route, so that produces an
`Unmatched Route` page. The ngrok tunnel must target the web proxy on port
`4173`:

```powershell
cd electron-app
npm run web:ngrok
```

Before running it, start Django in the same terminal or another local process:

```powershell
cd ..\Snaplytics
python manage.py runserver 8000
cd ..\electron-app
npm run web:ngrok
```

For a separate public API tunnel, set
`$env:HEIGEN_API_URL = "https://YOUR-DJANGO-TUNNEL.ngrok-free.app/api"` and
`$env:HEIGEN_PROXY_API = "false"`. Electron desktop startup is unchanged and
continues to use its local API fallback.

## Run from desktop (no `npm start` typing)

Requires **Node.js** and **npm** on your PATH (same as `npm start`).

For a complete Windows setup, double-click
`..\install.bat` from the repository root. It installs the
backend, kiosk, and Electron dependencies, runs migrations, and starts all
three local services. The Electron launcher skips its embedded Django process
when started by `start-all-windows.bat`, so only one backend listens on port
8000.

| OS | What to do |
|----|----------------|
| **Windows** | Double-click `electron-app/Heigen-Admin.bat`, or copy a shortcut to your Desktop. |
| **macOS** | Double-click `electron-app/Heigen-Admin.command` (opens Terminal briefly, then Electron). |
| **Linux** | Run `chmod +x Heigen-Admin.sh` once, then double-click `Heigen-Admin.sh` if your file manager allows, **or** run `npm run desktop:install-menu` to add an app-menu entry (and a Desktop symlink when `~/Desktop` exists). |

The launch scripts set `HEIGEN_MONOREPO_ROOT` to the parent folder of `electron-app` so Django can find `Snaplytics/`. Override with env `HEIGEN_MONOREPO_ROOT` (or legacy `HEIGEN_REPO_ROOT`) if your layout differs.

## Packaged `.exe` / installers (electron-builder)

The all-in-one Windows installer bundles the Django backend and its Python
runtime. The target computer does not need Python, Node.js, or a repository
checkout.

```text
cd Snaplytics
python -m pip install -r requirements.txt
python -m pip install pyinstaller
cd ..\electron-app
npm install
npm run dist:win:all
```

| Command | Output (under `electron-app/release/`) |
|---------|----------------------------------------|
| `npm run dist:win:all` | **NSIS** setup plus portable and zip outputs, with the backend bundled. |
| `npm run dist:win` | Electron-only build; it still requires Python and backend dependencies. |
| `npm run dist:win-cross` | **Portable** exe + **zip** only — use from Linux/macOS CI **without Wine**. Unzip the zip if you prefer a folder layout. |
| `npm run dist:linux` | **AppImage** (x64). |
| `npm run dist:mac` | **DMG** (needs macOS). |

`dist:*` scripts run **`node scripts/electron-dist.cjs`** (sets `CSC_IDENTITY_AUTO_DISCOVERY=false` for unsigned builds) so **Windows** does not need the `cross-env` CLI.

Installed layout: `Snaplytics/` and the packaged `backend/` runtime are copied
under `resources/`. The all-in-one installer starts the bundled backend.

The backend still needs deployment configuration, including database and SMTP
environment variables. Do not commit credentials; provide a `.env` file next
to the installed `resources` directory or configure those variables in the
deployment environment.

Icons for the packaged app, shortcuts, and taskbar use **`assets/splash-heigen.png`** (see `build.icon` in `package.json` and `main.js`).

## Notes

- Electron starts Django from `Snaplytics/manage.py` on launch (see `main.js`).
- If environment variables are needed, define them in a local `.env` file.
- Staff auth token is required for protected API endpoints.
- Staff shell kiosk modal auto-detects Expo web using a smart scan (priority ports + local ranges like `8090-8110`) and uses the first reachable URL.
- When the Electron shell is running while an ngrok tunnel is active locally, it also checks the ngrok inspector and uses the public `/kiosk/` route automatically.
- `kioskWebUrl` in `localStorage` is still respected and checked first.
- Last successful kiosk URL is cached and retried first on the next open.
- Start kiosk web with `cd ../HeigenKiosk && npm start` (configured to `expo start --port 8090`) for Electron shell embedding.
