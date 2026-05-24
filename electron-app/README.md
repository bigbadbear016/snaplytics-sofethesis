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

## Run from desktop (no `npm start` typing)

Requires **Node.js** and **npm** on your PATH (same as `npm start`).

| OS | What to do |
|----|----------------|
| **Windows** | Double-click `electron-app/Heigen-Admin.bat`, or copy a shortcut to your Desktop. |
| **macOS** | Double-click `electron-app/Heigen-Admin.command` (opens Terminal briefly, then Electron). |
| **Linux** | Run `chmod +x Heigen-Admin.sh` once, then double-click `Heigen-Admin.sh` if your file manager allows, **or** run `npm run desktop:install-menu` to add an app-menu entry (and a Desktop symlink when `~/Desktop` exists). |

The launch scripts set `HEIGEN_MONOREPO_ROOT` to the parent folder of `electron-app` so Django can find `Snaplytics/`. Override with env `HEIGEN_MONOREPO_ROOT` (or legacy `HEIGEN_REPO_ROOT`) if your layout differs.

## Packaged `.exe` / installers (electron-builder)

Build from `electron-app` after `npm install`:

| Command | Output (under `electron-app/release/`) |
|---------|----------------------------------------|
| `npm run dist:win` | **NSIS** setup (e.g. `Heigen Admin Setup <version>.exe`), **portable** exe (e.g. `Heigen Admin <version>.exe`), and a **zip** archive. Use a **Windows** machine, or Linux with **Wine** (NSIS packaging calls Wine off Windows). |
| `npm run dist:win-cross` | **Portable** exe + **zip** only — use from Linux/macOS CI **without Wine**. Unzip the zip if you prefer a folder layout. |
| `npm run dist:linux` | **AppImage** (x64). |
| `npm run dist:mac` | **DMG** (needs macOS). |

`dist:*` scripts run **`node scripts/electron-dist.cjs`** (sets `CSC_IDENTITY_AUTO_DISCOVERY=false` for unsigned builds) so **Windows** does not need the `cross-env` CLI.

Installed layout: `Snaplytics/` is copied next to `app.asar` under `resources/` so Django can start without a separate repo checkout.

**Still required on the machine:** **Python 3.11+** on `PATH` (same as dev). After install, open a terminal as Administrator and install Python deps once, for example:

```text
cd "%ProgramFiles%\Heigen Admin\resources\Snaplytics"
python -m pip install -r requirements.txt
```

(Adjust the folder if you changed the install directory; portable build uses the folder next to `Heigen Admin.exe` → `resources\Snaplytics`.)

Optional: copy a `.env` next to `resources` (same folder that contains `Snaplytics`) or set `HEIGEN_MONOREPO_ROOT` if you relocate the backend.

Icons for the packaged app, shortcuts, and taskbar use **`assets/splash-heigen.png`** (see `build.icon` in `package.json` and `main.js`).

## Notes

- Electron starts Django from `Snaplytics/manage.py` on launch (see `main.js`).
- If environment variables are needed, define them in a local `.env` file.
- Staff auth token is required for protected API endpoints.
- Staff shell kiosk modal auto-detects Expo web using a smart scan (priority ports + local ranges like `8090-8110`) and uses the first reachable URL.
- `kioskWebUrl` in `localStorage` is still respected and checked first.
- Last successful kiosk URL is cached and retried first on the next open.
- Start kiosk web with `cd ../HeigenKiosk && npm start` (configured to `expo start --port 8090`) for Electron shell embedding.
