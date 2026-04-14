/**
 * After assembleRelease, copy the APK to dist/ so it is easy to find (Gradle default path is deep).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(
  root,
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "release",
  "app-release.apk"
);
const destDir = path.join(root, "dist");
const dest = path.join(destDir, "HeigenStudioKiosk-release.apk");

if (!fs.existsSync(src)) {
  console.error("Release APK not found at:\n  " + src);
  console.error("Run a successful assembleRelease first.");
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
const abs = path.resolve(dest);
console.log("\nInstallable APK (copy this to your phone):\n  " + abs + "\n");
