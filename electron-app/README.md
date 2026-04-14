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
- Staff shell kiosk modal defaults to `http://localhost:8090` when `kioskWebUrl` is not set in `localStorage`.
- Start kiosk web with `cd ../HeigenKiosk && npx expo start --web --port 8090` for Electron shell embedding.
