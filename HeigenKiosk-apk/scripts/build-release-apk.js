/**
 * Full release APK build from a temp directory (paths with "!" break Kotlin/Android tooling).
 * Copies project → %LOCALAPPDATA%\Temp\heigen-kiosk-apk-build, npm install, gradlew assembleRelease,
 * copies HeigenStudioKiosk-release.apk back to ./dist/
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const tempRoot = path.join(
  process.env.LOCALAPPDATA || process.env.TEMP || "/tmp",
  "heigen-kiosk-apk-build",
);
const tempProject = path.join(tempRoot, "HeigenKiosk-apk");

function run(label, command, cwd, shell = true) {
  console.error(`\n>> ${label}\n`);
  const r = spawnSync(command, {
    cwd,
    shell,
    stdio: "inherit",
    env: { ...process.env },
  });
  if (r.status !== 0) {
    console.error(`\nFailed: ${label} (exit ${r.status})\n`);
    process.exit(r.status ?? 1);
  }
}

fs.rmSync(tempProject, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });

const robocopyCmd = `robocopy "${projectRoot}" "${tempProject}" /E /XD node_modules android\\.gradle android\\app\\build android\\build /NFL /NDL /NJH /NJS`;
const rc = spawnSync(robocopyCmd, { shell: true, encoding: "utf8" });
// Robocopy: 0 = nothing, 1-7 = success with copies, >=8 = error
if (rc.status != null && rc.status >= 8) {
  console.error("robocopy failed:", rc.status, rc.stderr || rc.stdout);
  process.exit(1);
}

const envSrc = path.join(projectRoot, ".env");
const envDst = path.join(tempProject, ".env");
if (fs.existsSync(envSrc)) {
  fs.copyFileSync(envSrc, envDst);
  console.error("Copied .env into temp build tree.");
} else {
  console.error(
    "No .env in project root — build continues; set EXPO_PUBLIC_SUPABASE_* in .env for embedded config.",
  );
}

run("npm install", "npm install", tempProject);

const gradlew =
  process.platform === "win32"
    ? "gradlew.bat assembleRelease --no-daemon"
    : "./gradlew assembleRelease --no-daemon";
run("Gradle assembleRelease", gradlew, path.join(tempProject, "android"));

const apkSrc = path.join(
  tempProject,
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "release",
  "app-release.apk",
);
if (!fs.existsSync(apkSrc)) {
  console.error("Release APK not found:\n ", apkSrc);
  process.exit(1);
}

const distDir = path.join(projectRoot, "dist");
const apkDest = path.join(distDir, "HeigenStudioKiosk-release.apk");
fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(apkSrc, apkDest);
const abs = path.resolve(apkDest);
console.error("\n=== APK ready ===\n" + abs + "\n");
