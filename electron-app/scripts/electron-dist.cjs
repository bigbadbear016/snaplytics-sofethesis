/**
 * Runs electron-builder with CSC_IDENTITY_AUTO_DISCOVERY=false so unsigned
 * builds skip code-sign lookup. Uses Node (no cross-env) so Windows cmd
 * resolves the script the same as macOS/Linux.
 */
const { spawnSync } = require("child_process");
const path = require("path");

process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";

const projectRoot = path.join(__dirname, "..");
const builderRoot = path.dirname(require.resolve("electron-builder/package.json"));
const cli = path.join(builderRoot, "cli.js");
const args = process.argv.slice(2);

const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
});

if (r.error) {
    console.error(r.error);
    process.exit(1);
}
process.exit(r.status === null ? 1 : r.status);
