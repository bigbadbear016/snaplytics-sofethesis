/**
 * Merge EMAIL_* / HEIGEN_SMTP_* from parent .env files into HeigenKiosk-apk/.env
 * as EXPO_PUBLIC_SMTP_* (required for standalone APK confirmation email).
 */
const fs = require("fs");
const path = require("path");

const apkRoot = path.join(__dirname, "..");
const envPath = path.join(apkRoot, ".env");

const sources = [
  path.join(apkRoot, ".env"),
  path.join(apkRoot, "..", ".env"),
  path.join(apkRoot, "..", "Snaplytics", ".env"),
  path.join(apkRoot, "..", "HeigenKiosk", ".env"),
];

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function pick(map, keys) {
  for (const k of keys) {
    const v = map[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

const merged = {};
for (const src of sources) {
  Object.assign(merged, parseEnvFile(src));
}

const smtp = {
  EXPO_PUBLIC_SMTP_HOST: pick(merged, [
    "EXPO_PUBLIC_SMTP_HOST",
    "HEIGEN_SMTP_HOST",
    "EMAIL_HOST",
  ]),
  EXPO_PUBLIC_SMTP_PORT: pick(merged, [
    "EXPO_PUBLIC_SMTP_PORT",
    "HEIGEN_SMTP_PORT",
    "EMAIL_PORT",
  ]),
  EXPO_PUBLIC_SMTP_USE_TLS: pick(merged, [
    "EXPO_PUBLIC_SMTP_USE_TLS",
    "HEIGEN_SMTP_USE_TLS",
    "EMAIL_USE_TLS",
  ]),
  EXPO_PUBLIC_SMTP_USER: pick(merged, [
    "EXPO_PUBLIC_SMTP_USER",
    "HEIGEN_SMTP_USERNAME",
    "EMAIL_HOST_USER",
  ]),
  EXPO_PUBLIC_SMTP_PASSWORD: pick(merged, [
    "EXPO_PUBLIC_SMTP_PASSWORD",
    "HEIGEN_SMTP_PASSWORD",
    "EMAIL_HOST_PASSWORD",
  ]).replace(/\s+/g, ""),
  EXPO_PUBLIC_SMTP_FROM_EMAIL: pick(merged, [
    "EXPO_PUBLIC_SMTP_FROM_EMAIL",
    "HEIGEN_SMTP_FROM_EMAIL",
    "DEFAULT_FROM_EMAIL",
    "EMAIL_HOST_USER",
  ]),
  EXPO_PUBLIC_SMTP_FROM_NAME: pick(merged, [
    "EXPO_PUBLIC_SMTP_FROM_NAME",
    "HEIGEN_SMTP_SENDER_NAME",
  ]),
};

if (!smtp.EXPO_PUBLIC_SMTP_HOST) smtp.EXPO_PUBLIC_SMTP_HOST = "smtp.gmail.com";
if (!smtp.EXPO_PUBLIC_SMTP_PORT) smtp.EXPO_PUBLIC_SMTP_PORT = "587";
if (!smtp.EXPO_PUBLIC_SMTP_USE_TLS) smtp.EXPO_PUBLIC_SMTP_USE_TLS = "true";
if (!smtp.EXPO_PUBLIC_SMTP_FROM_NAME) smtp.EXPO_PUBLIC_SMTP_FROM_NAME = "Heigen Studio";

let existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const lines = existing.split(/\r?\n/).filter((line) => {
  const t = line.trim();
  return t && !t.startsWith("EXPO_PUBLIC_SMTP_");
});

const smtpBlock = [
  "",
  "# Standalone confirmation email (auto-merged from project .env at build time)",
  ...Object.entries(smtp).map(([k, v]) => `${k}=${v}`),
];
fs.writeFileSync(envPath, [...lines, ...smtpBlock].join("\n").trim() + "\n", "utf8");

if (!smtp.EXPO_PUBLIC_SMTP_USER || !smtp.EXPO_PUBLIC_SMTP_PASSWORD) {
  console.error(
    "WARNING: SMTP user/password missing — confirmation email will not send. Set EMAIL_HOST_USER in project root .env",
  );
  process.exit(1);
}
console.error("Merged SMTP into HeigenKiosk-apk/.env");
