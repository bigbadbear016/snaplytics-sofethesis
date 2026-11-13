const { spawnSync } = require("child_process");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const kioskRoot = path.join(projectRoot, "HeigenKiosk");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const result = spawnSync(
    npmCommand,
    ["run", "web:build"],
    {
        cwd: kioskRoot,
        env: {
            ...process.env,
            EXPO_NO_DOCTOR: "1",
        },
        stdio: "inherit",
    },
);

if (result.error) {
    console.error(result.error);
    process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
