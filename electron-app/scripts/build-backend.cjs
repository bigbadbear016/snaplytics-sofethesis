const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const appRoot = path.resolve(__dirname, "..");
const spec = path.join(appRoot, "backend-build", "heigen-backend.spec");
const python = process.env.PYTHON_EXECUTABLE || "python";
const distPath = path.join(appRoot, "backend-dist");
const workPath = path.join(appRoot, "backend-build", "work");

if (!fs.existsSync(spec)) {
    console.error(`Backend PyInstaller spec was not found: ${spec}`);
    process.exit(1);
}

const result = spawnSync(
    python,
    [
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--distpath",
        distPath,
        "--workpath",
        workPath,
        spec,
    ],
    {
        cwd: projectRoot,
        env: process.env,
        stdio: "inherit",
    },
);

if (result.error) {
    console.error(result.error);
    process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
