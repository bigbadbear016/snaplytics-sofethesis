const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { URL } = require("url");
const { request: httpRequest } = require("http");

const ROOT = path.resolve(__dirname, "..");
const enableNgrok = process.argv.includes("--ngrok");
const enableCloudflare = process.argv.includes("--cloudflare");
// Public modes build the kiosk and start Django automatically.
const publicMode = enableNgrok || enableCloudflare;
// Cloudflare uses its own default port so it can run next to the ngrok link.
const port = Number(
    process.env.PORT || process.env.HEIGEN_WEB_PORT || (enableCloudflare ? 4174 : 4173),
);
const apiBase = String(
    process.env.HEIGEN_API_URL || "/api",
).replace(/\/+$/, "");
const proxyApi = process.env.HEIGEN_PROXY_API !== "false";
const kioskRoot = path.resolve(ROOT, "..", "HeigenKiosk");
const kioskDistRoot = path.join(kioskRoot, "dist-kiosk");
const monorepoRoot = path.resolve(ROOT, "..");
const djangoRoot = path.join(monorepoRoot, "Snaplytics");
// The starter reads the Cloudflare Quick Tunnel URL from this file.
const cloudflareUrlFile = path.join(os.tmpdir(), "heigen-cloudflare-url.txt");
let djangoProcess;
let tunnelProcess;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT/HEIGEN_WEB_PORT must be an integer between 1 and 65535.");
}

function contentType(filePath) {
    const types = {
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
        ".woff2": "font/woff2",
    };
    return types[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

// Only the staff web front end is served. Everything else in electron-app
// (node_modules, release, backend-dist, main.js, package.json, dot files, ...)
// stays private, because public links expose this server to the internet.
const PUBLIC_FILES = new Set(["index.html", "splash.html"]);
const PUBLIC_DIRS = new Set(["pages", "scripts", "styles", "assets", "auth"]);

function safeFilePath(requestUrl) {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
    } catch (_) {
        return null;
    }
    const requested = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.resolve(ROOT, `.${requested}`);
    if (!filePath.startsWith(`${ROOT}${path.sep}`)) return null;
    const parts = path.relative(ROOT, filePath).split(path.sep);
    if (parts.some((part) => part.startsWith("."))) return null;
    const allowed = parts.length === 1
        ? PUBLIC_FILES.has(parts[0])
        : PUBLIC_DIRS.has(parts[0]);
    return allowed ? filePath : null;
}

function injectWebConfig(html) {
    const config = `<script>window.HEIGEN_API_BASE=${JSON.stringify(apiBase)};</script>`;
    return html.replace("</head>", `${config}</head>`);
}

function proxyApiRequest(request, response) {
    const incoming = new URL(request.url || "/api", "http://localhost");
    const headers = { ...request.headers };
    delete headers.host;
    delete headers["x-forwarded-host"];
    delete headers["x-forwarded-proto"];
    headers.host = `127.0.0.1:${process.env.HEIGEN_BACKEND_PORT || 8000}`;
    headers.accept = "application/json";
    const proxy = httpRequest(
        {
            hostname: "127.0.0.1",
            port: Number(process.env.HEIGEN_BACKEND_PORT || 8000),
            path: `${incoming.pathname}${incoming.search}`,
            method: request.method,
            headers,
        },
        (upstream) => {
            const upstreamType = String(upstream.headers["content-type"] || "").toLowerCase();
            if (upstreamType.includes("text/html")) {
                let body = "";
                upstream.setEncoding("utf8");
                upstream.on("data", (chunk) => {
                    body += chunk;
                });
                upstream.on("end", () => {
                    response.writeHead(502, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({
                        detail: "The backend returned HTML instead of JSON.",
                        upstreamStatus: upstream.statusCode || 502,
                        preview: body.slice(0, 160),
                    }));
                });
                return;
            }
            response.writeHead(upstream.statusCode || 502, upstream.headers);
            upstream.pipe(response);
        },
    );
    proxy.on("error", () => {
        if (!response.headersSent) {
            response.writeHead(502, { "Content-Type": "application/json" });
        }
        response.end(JSON.stringify({ detail: "Backend API is unavailable." }));
    });
    request.pipe(proxy);
}

function buildKioskForPublicWeb() {
    if (!publicMode || process.env.HEIGEN_AUTO_BUILD_KIOSK === "false") return;
    if (!fs.existsSync(path.join(kioskRoot, "package.json"))) {
        console.error(`Kiosk project was not found: ${kioskRoot}`);
        return;
    }
    // Always rebuild so /kiosk/ never serves a stale export. The export uses
    // Expo Router's baseUrl so routes and asset URLs live under /kiosk.
    const exportCommand = "npx expo export -p web --output-dir dist-kiosk --clear";
    const buildCommand = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "sh";
    const buildArgs = process.platform === "win32"
        ? ["/d", "/s", "/c", exportCommand]
        : ["-c", exportCommand];
    const result = spawnSync(buildCommand, buildArgs, {
        cwd: kioskRoot,
        env: { ...process.env, BROWSER: "none", CI: "1", KIOSK_BASE_URL: "/kiosk" },
        stdio: "inherit",
        windowsHide: true,
    });
    if (result.error || result.status !== 0 || !fs.existsSync(path.join(kioskDistRoot, "index.html"))) {
        console.error(`Kiosk web export failed with exit code ${result.status ?? "unknown"}.`);
        process.exitCode = 1;
        return;
    }
    console.log(`Kiosk static export ready: ${kioskDistRoot}`);
}

function isBackendRunning() {
    return new Promise((resolve) => {
        const probe = httpRequest(
            { hostname: "127.0.0.1", port: Number(process.env.HEIGEN_BACKEND_PORT || 8000), path: "/api/packages/", method: "GET" },
            (upstream) => {
                upstream.resume();
                resolve(true);
            },
        );
        probe.on("error", () => resolve(false));
        probe.setTimeout(700, () => {
            probe.destroy();
            resolve(false);
        });
    });
}

async function startDjangoForPublicWeb() {
    if (!publicMode || process.env.HEIGEN_AUTO_START_DJANGO === "false" || await isBackendRunning()) {
        return;
    }
    const venvPython = process.platform === "win32"
        ? path.join(djangoRoot, ".venv", "Scripts", "python.exe")
        : path.join(djangoRoot, ".venv", "bin", "python");
    const candidates = [venvPython, process.env.PYTHON_EXECUTABLE].filter(Boolean);
    const python = candidates.find((candidate) => {
        if (!fs.existsSync(candidate)) return false;
        const check = spawnSync(candidate, ["-c", "import django"], {
            cwd: djangoRoot,
            stdio: "ignore",
            windowsHide: true,
        });
        return check.status === 0;
    });
    if (!python || !fs.existsSync(path.join(djangoRoot, "manage.py"))) {
        console.error(
            `Django is not installed in ${venvPython}. Run ` +
            `"${venvPython}" -m pip install -r requirements.txt ` +
            `from ${djangoRoot}, then retry.`,
        );
        process.exitCode = 1;
        return;
    }
    djangoProcess = spawn(python, ["manage.py", "runserver", `0.0.0.0:${process.env.HEIGEN_BACKEND_PORT || 8000}`], {
        cwd: djangoRoot,
        env: { ...process.env, HEIGEN_MONOREPO_ROOT: monorepoRoot },
        stdio: "inherit",
        windowsHide: true,
    });
    djangoProcess.on("error", (error) => {
        console.error(`Unable to start Django: ${error.message}`);
    });
    console.log(`Starting Django on http://127.0.0.1:${process.env.HEIGEN_BACKEND_PORT || 8000}`);
}

function serveKioskStatic(request, response, requestUrl) {
    const relativePath = requestUrl.pathname.replace(/^\/kiosk(?:\/|$)/, "") || "index.html";
    const candidate = path.resolve(kioskDistRoot, relativePath);
    const safeRoot = path.resolve(kioskDistRoot) + path.sep;
    const filePath = candidate.startsWith(safeRoot) ? candidate : path.join(kioskDistRoot, "index.html");
    const fallbackPath = path.join(kioskDistRoot, "index.html");

    fs.readFile(filePath, (error, data) => {
        const selectedPath = error ? fallbackPath : filePath;
        fs.readFile(selectedPath, (fallbackError, content) => {
            if (fallbackError) {
                response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
                response.end("Kiosk export is not ready. Wait for the kiosk build to finish and reload.");
                return;
            }
            response.writeHead(200, {
                "Cache-Control": "no-cache",
                "Content-Type": contentType(selectedPath),
            });
            response.end(content);
        });
    });
}

const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://localhost");
    if (proxyApi && (request.url === "/api" || request.url?.startsWith("/api/"))) {
        proxyApiRequest(request, response);
        return;
    }
    if (requestUrl.pathname === "/kiosk") {
        response.writeHead(308, { Location: "/kiosk/" });
        response.end();
        return;
    }
    if (requestUrl.pathname.startsWith("/kiosk/")) {
        serveKioskStatic(request, response, requestUrl);
        return;
    }

    const filePath = safeFilePath(request.url || "/");
    if (!filePath) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
    }

    fs.readFile(filePath, (error, data) => {
        if (error) {
            const status = error.code === "ENOENT" ? 404 : 500;
            response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
            response.end(status === 404 ? "Not found" : "Unable to read file");
            return;
        }

        const isHtml = path.extname(filePath).toLowerCase() === ".html";
        const body = isHtml ? injectWebConfig(data.toString("utf8")) : data;
        response.writeHead(200, {
            "Cache-Control": "no-cache",
            "Content-Type": contentType(filePath),
        });
        response.end(body);
    });
});

server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(
            `Port ${port} is already in use. Stop the existing web server or choose another port, for example:\n` +
                `  $env:PORT = "4175"; npm run ${enableCloudflare ? "web:cloudflare" : enableNgrok ? "web:ngrok" : "web"}`,
        );
        process.exitCode = 1;
        return;
    }
    console.error(`Unable to start the web server: ${error.message}`);
    process.exitCode = 1;
});

if (publicMode) {
    buildKioskForPublicWeb();
}

// cloudflared from CLOUDFLARED_PATH, PATH, or the usual install folders.
function findCloudflared() {
    if (process.env.CLOUDFLARED_PATH && fs.existsSync(process.env.CLOUDFLARED_PATH)) {
        return process.env.CLOUDFLARED_PATH;
    }
    const lookup = spawnSync(process.platform === "win32" ? "where" : "which", ["cloudflared"], {
        encoding: "utf8",
        windowsHide: true,
    });
    if (lookup.status === 0) {
        const first = String(lookup.stdout || "").split(/\r?\n/).find((line) => line.trim());
        if (first) return first.trim();
    }
    if (process.platform !== "win32") return null;
    const folders = [
        process.env["ProgramFiles(x86)"],
        process.env.ProgramFiles,
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs"),
    ].filter(Boolean);
    return folders
        .map((folder) => path.join(folder, "cloudflared", "cloudflared.exe"))
        .find((candidate) => fs.existsSync(candidate)) || null;
}

// One-time install through tools/install-runtime.ps1 (winget, then GitHub download).
function installCloudflared() {
    const script = path.join(monorepoRoot, "tools", "install-runtime.ps1");
    if (process.platform !== "win32" || !fs.existsSync(script)) return false;
    console.log("cloudflared was not found. Installing it (one time)...");
    const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Runtime", "cloudflared"],
        { stdio: "inherit" },
    );
    return result.status === 0;
}

// Cloudflare Quick Tunnel: no account, random https://*.trycloudflare.com URL.
function startCloudflareTunnel() {
    let command = findCloudflared();
    if (!command && installCloudflared()) command = findCloudflared();
    if (!command) {
        console.error(
            "cloudflared is not installed. Install it with\n" +
                "  winget install --id Cloudflare.cloudflared\n" +
                "or download it from https://github.com/cloudflare/cloudflared/releases/latest, then try again.",
        );
        process.exitCode = 1;
        return;
    }
    fs.rmSync(cloudflareUrlFile, { force: true });
    tunnelProcess = spawn(
        command,
        ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );

    // cloudflared prints the URL in its log; output can arrive in pieces.
    let recent = "";
    let publicUrl = null;
    const onOutput = (chunk) => {
        const text = chunk.toString();
        process.stderr.write(text);
        if (publicUrl) return;
        recent = (recent + text).slice(-2000);
        const match = recent.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (!match) return;
        publicUrl = match[0];
        fs.writeFileSync(cloudflareUrlFile, publicUrl);
        console.log(
            `\nPublic staff web: ${publicUrl}/\n` +
                `Public kiosk:     ${publicUrl}/kiosk/\n` +
                "(A new link can take a few seconds to start working.)\n",
        );
    };
    tunnelProcess.stdout.on("data", onOutput);
    tunnelProcess.stderr.on("data", onOutput);
    tunnelProcess.on("error", (error) => {
        console.error(`Unable to start cloudflared: ${error.message}`);
    });
    tunnelProcess.on("exit", (code, signal) => {
        fs.rmSync(cloudflareUrlFile, { force: true });
        if (code !== 0 && signal !== "SIGTERM") {
            console.error(`cloudflared exited with code ${code ?? "unknown"}.`);
        }
    });
}

server.listen(port, "127.0.0.1", async () => {
    console.log(`Web UI: http://127.0.0.1:${port}`);
    console.log(`API: ${apiBase}${proxyApi ? " (proxied to local Django)" : ""}`);

    if (enableNgrok) {
        await startDjangoForPublicWeb();
        const command =
            process.env.NGROK_PATH ||
            (process.platform === "win32" ? "ngrok.exe" : "ngrok");
        const ngrok = spawn(command, ["http", String(port)], {
            stdio: "inherit",
            shell: process.platform === "win32",
        });
        console.log(
            `Public site: https://<ngrok-domain> (tunnel target: http://127.0.0.1:${port})`,
        );
        console.log("Open the kiosk at the public site's /kiosk/ path; do not tunnel port 8090 directly.");
        ngrok.on("error", (error) => {
            if (error.code === "ENOENT") {
                console.error(
                    "ngrok was not found on PATH. Install the official ngrok CLI, " +
                        "run `ngrok config add-authtoken YOUR_TOKEN`, and try again.",
                );
                return;
            }
            console.error(`Unable to start ngrok: ${error.message}`);
        });
        ngrok.on("exit", (code, signal) => {
            if (code !== 0 && signal !== "SIGTERM") {
                console.error(`ngrok exited with code ${code ?? "unknown"}.`);
            }
        });
        server.on("close", () => ngrok.kill());
    }

    if (enableCloudflare) {
        await startDjangoForPublicWeb();
        console.log(`Opening a Cloudflare Quick Tunnel to http://127.0.0.1:${port} ...`);
        startCloudflareTunnel();
    }
});

function shutdown() {
    if (djangoProcess && !djangoProcess.killed) djangoProcess.kill();
    if (tunnelProcess && !tunnelProcess.killed) tunnelProcess.kill();
    fs.rmSync(cloudflareUrlFile, { force: true });
    server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
