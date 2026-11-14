# Changelog

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
