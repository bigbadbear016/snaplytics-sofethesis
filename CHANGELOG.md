# Changelog

## Unreleased - Renewal prediction uses XGBoost only

- Renewal predictions in the app now come from one XGBoost model
  (`xgboost-v3`), trained on every accepted booking in Supabase with
  `python manage.py train_renewal_xgboost`. Its inputs are a booking strength
  score, total bookings, bookings in the last 365 days, renewed before, and
  days since the last booking. In the time-separated test, ROC-AUC is 0.557
  (random is 0.500).
- The hand-written `heuristic-v1` model, its calibration, and its fallback
  are removed. Its formula is kept only as the `booking_strength` input. If the model cannot be loaded, the app shows the renewal
  prediction as unavailable.
- Renewal groups are set by rank: top 5%, next 10%, next 15%, rest. The risk
  filters use these groups.
- The daily shadow run records the live model only. The challenger uses the
  same inputs and must beat the live model to be saved.
- The renewal metrics on the dashboard now show the live model's
  time-separated test instead of the old offline results.
- Fixed: the always-no baseline in `report_renewal_shadow_metrics` used the
  wrong formula.
- The renewal model counts identical duplicate bookings once, and treats a
  missing or NaN booking price as 0.
- New `clean_booking_data` command reports and (with `--apply`) fixes
  duplicate bookings, duplicate customer records, and leftover `nan` text,
  with a backup and `--restore`.

## Unreleased - Documentation refresh

- `Snaplytics/docs/overall_architecture_documentation.md` now covers the
  `endpoints/views/` package, `StaffOrKioskAction` permissions, roles and
  `dev_mode`, coupons, loyalty, action logs, Internal Records, renewal shadow
  mode, and public links.
- `Snaplytics/docs/windows_vscode_setup_documentation.md` now uses Python 3.12,
  describes the one-click installer, explains the kiosk's automatic API URL,
  and fixes the kiosk path in the quick start.
- The generated code reference (`file_by_file_documentation.md`,
  `method_line_by_line_documentation*.md`, `function_groups_documentation.md`)
  is regenerated. The generator scripts now find `electron-app/` and
  `HeigenKiosk/` at the repository root, include `Snaplytics/endpoints/`, skip
  build output, and skip the `.docx` export when pandoc is not installed.
- `Snaplytics/README.md` lists the code layout, API access rules, tests, and
  management commands. `HeigenKiosk/README.md` shows which endpoints need a
  staff login. `HeigenKiosk-apk/README.md` lists the current files.
- `Docs/README.md` now indexes the whole folder.

## Unreleased - Cloudflare public link and runtime installer

### Security

- The API now requires a staff login, except for what the customer kiosk
  needs: reading packages, categories, and add-ons; finding a customer by
  email; creating a customer; creating a booking; recommendations; coupon
  validation; and the booking confirmation email. Before, anyone who could
  reach the API (for example through a public link) could read, change, or
  delete customers, bookings, and the catalog.
- Bookings created without a login are always `Pending`.
- The kiosk's `/admin` booking queue no longer works without a login; manage
  bookings in the staff app.
- The public web server (`npm run web`, `web:ngrok`, `web:cloudflare`) serves
  only the staff web files (`index.html`, `splash.html`, `pages/`, `scripts/`,
  `styles/`, `assets/`, `auth/`). Before, it served every file under
  `electron-app/`, including `node_modules/`, `release/`, and `backend-dist/`.

### Other changes

- New `npm run web:cloudflare` and starter row "Public link (Cloudflare)":
  staff web + kiosk over a Cloudflare Quick Tunnel on port 4174. No account
  or bandwidth cap. `cloudflared` installs automatically on first use.
- `tools/install-runtime.ps1` installs Node.js, Python, or cloudflared:
  winget first, then the signed official download, then a manual link.
- Installer pins Node.js 22.20.0 and Python 3.12.10. A supported newer Node.js
  is kept; an unsupported one (23.x, 25.x) is upgraded to the newest LTS.
  Python 3.12 is installed next to newer versions; the backend venv always
  uses 3.12.
- Installer stops at the first error (before, it continued after failures).
- Staff app: the sidebar shows as an icon rail in narrow windows instead of
  disappearing.

## Unreleased - Code structure and action log paging

- `endpoints/views.py` (4,892 lines) is split into the `endpoints/views/`
  package, one module per area. View code is unchanged, and `urls.py` imports
  stay the same.
- Action logs page: "Load more" button fetches older logs 100 at a time.
  Before, only the newest 250 logs could be seen.
- `GET /api/action-logs/` accepts `offset` and `exclude_type_prefix`.
- First backend tests in `endpoints/tests.py`. Run with
  `python manage.py test endpoints --settings=Snaplytics.settings_test`.

## 2026-11-14 - Starter, kiosk upgrade, and public kiosk export

### Starter and Windows scripts

- `starter.bat` shows one row per service (backend, kiosk, staff app, ngrok)
  with live status and **Start**, **Stop**, and **Open** buttons.
- New headless options: `-StartAll`, `-StopAll`, `-Status`,
  `-Start <name>`, and `-Stop <name>`.
- `start-all-windows.bat` now runs `starter.ps1 -StartAll`.
- New `stop-all-windows.bat` stops all services and closes their windows.
- New `HeigenStarter.exe` backup launcher opens the starter without a console.
  Rebuild it with `tools\starter-exe\build.bat`.
- `install-and-start-windows.bat` was removed. Use `install.bat`.

### Backend

- `python manage.py runserver` with no address now listens on `0.0.0.0:8000`,
  so phones on the same Wi-Fi can reach the API. An explicit address still
  wins. Override the default with `DJANGO_RUNSERVER_ADDR`.

### Kiosk

- Upgraded to Expo SDK 58, React 19.3, and React Native 0.88.
- The splash screen is configured through the `expo-splash-screen` plugin.
- The kiosk hides the status bar and Android navigation bar (`FullscreenBars`).
- Customer form and booking summary dialogs stay above the on-screen keyboard
  and scroll on short screens, such as phones in landscape.
- The booking confirmation email is sent after the booking is created. An SMTP
  failure no longer blocks the confirmation screen.
- New `app.config.js` reads `KIOSK_BASE_URL` to export the web build under a
  sub-path.

### Public kiosk through ngrok

- `npm run web:ngrok` in `electron-app` rebuilds the kiosk on every start into
  `HeigenKiosk/dist-kiosk` with `KIOSK_BASE_URL=/kiosk`. It no longer rewrites
  paths in served files.

## 2026-11-12 - Renewal shadow mode

### Renewal shadow and training

- Daily shadow predictions use live Supabase booking data.
- Successful daily shadow runs are recorded quietly.
- Failed shadow runs show an Electron notification.
- Shadow monitoring is always on and has no switch.
- Mature outcomes can be checked with `evaluate_renewal_shadow`.
- Metrics can be viewed with `report_renewal_shadow_metrics`.
- Monthly training uses `run_renewal_monthly.ps1`.
- With automatic training OFF, the monthly job creates an approval notice.
- With automatic training ON, the monthly job starts challenger training and
  still shows a notice to staff and admins.
- Only ADMIN or OWNER can approve manual training or change automatic training.
- Candidate models never replace the live heuristic automatically.
- Training notices remain visible for 30 days.

### Setup

Run migrations once from the `Snaplytics` folder:

```powershell
python manage.py migrate
```

Use Windows Task Scheduler for:

- `scripts\run_renewal_shadow.ps1` — daily
- `scripts\run_renewal_monthly.ps1` — monthly
