/**
 * Builds the offline front-end assets so the app never depends on a CDN:
 *   1. Copies Chart.js / jsPDF / jsPDF-AutoTable into vendor/
 *   2. Copies the Inter + Montserrat variable fonts into styles/fonts/
 *   3. Compiles Tailwind (scans pages, auth, scripts) into styles/tailwind.css
 *
 * Run: npm run build:assets   (or npm run watch:css while editing markup)
 * The outputs are committed, so the app works without running this first;
 * re-run it after adding new Tailwind classes to HTML/JS.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const nm = (...p) => path.join(root, "node_modules", ...p);

function copy(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log("  copied", path.relative(root, dest));
}

console.log("[assets] vendor libraries");
copy(nm("chart.js", "dist", "chart.umd.js"), path.join(root, "vendor", "chart.umd.min.js"));
copy(nm("jspdf", "dist", "jspdf.umd.min.js"), path.join(root, "vendor", "jspdf.umd.min.js"));
copy(
    nm("jspdf-autotable", "dist", "jspdf.plugin.autotable.min.js"),
    path.join(root, "vendor", "jspdf.plugin.autotable.min.js"),
);

console.log("[assets] fonts");
for (const [pkg, prefix] of [
    ["inter", "inter"],
    ["montserrat", "montserrat"],
]) {
    for (const subset of ["latin", "latin-ext"]) {
        const file = `${prefix}-${subset}-wght-normal.woff2`;
        copy(nm("@fontsource-variable", pkg, "files", file), path.join(root, "styles", "fonts", file));
    }
}

if (process.argv.includes("--no-css")) process.exit(0);

console.log("[assets] tailwind");
const cli = nm("tailwindcss", "lib", "cli.js");
const args = [
    cli,
    "-c", path.join(root, "tailwind.config.cjs"),
    "-i", path.join(root, "styles", "tailwind.src.css"),
    "-o", path.join(root, "styles", "tailwind.css"),
    "--minify",
];
if (process.argv.includes("--watch")) args.push("--watch");
const r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
process.exit(r.status === null ? 1 : r.status);
