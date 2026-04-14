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

Install and run:

```bash
cd electron-app
npm install
npm start
```

## Notes

- Start Django (`Snaplytics/`) before using API-backed screens.
- If environment variables are needed, define them in a local `.env` file.
- Staff auth token is required for protected API endpoints.
- Staff shell kiosk modal auto-detects Expo web using a smart scan (priority ports + local ranges like `8090-8110`) and uses the first reachable URL.
- `kioskWebUrl` in `localStorage` is still respected and checked first.
- Last successful kiosk URL is cached and retried first on the next open.
- Start kiosk web with `cd ../HeigenKiosk && npm start` (configured to `expo start --port 8090`) for Electron shell embedding.
