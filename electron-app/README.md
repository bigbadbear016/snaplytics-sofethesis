# Electron Staff Admin Requirements

## Runtime Requirements

- Node.js 18+ (Node.js 20 LTS recommended)
- npm 9+ (ships with modern Node.js)
- Running backend API at `http://localhost:8000`

## Project Dependencies

Dependencies are managed in `package.json`:

- `electron` (dev dependency)
- `dotenv`

Install and run:

```bash
npm install
npm start
```

## Notes

- Start Django (`Snaplytics/`) before using API-backed screens.
- If environment variables are needed, define them in a local `.env` file.
