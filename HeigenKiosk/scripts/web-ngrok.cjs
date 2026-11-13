const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { URL } = require("url");

const root = path.resolve(__dirname, "..");
const distRoot = path.join(root, "dist");
const port = Number(process.env.PORT || 8090);
const backendPort = Number(process.env.HEIGEN_BACKEND_PORT || 8000);
const apiPrefix = "/api";
const monorepoRoot = path.resolve(root, "..");
const djangoRoot = path.join(monorepoRoot, "Snaplytics");
let djangoProcess;

function contentType(filePath) {
    const types = {
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
    };
    return types[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function buildExport() {
    const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
    const args = process.platform === "win32"
        ? ["/d", "/s", "/c", "npm run web:build"]
        : ["run", "web:build"];
    const result = spawnSync(command, args, {
        cwd: root,
        env: { ...process.env, CI: "1", BROWSER: "none" },
        stdio: "inherit",
        windowsHide: true,
    });
    return result.status === 0 && fs.existsSync(path.join(distRoot, "index.html"));
}

function proxyApi(request, response) {
    const incoming = new URL(request.url || "/api", "http://localhost");
    const headers = { ...request.headers };
    delete headers.host;
    delete headers["x-forwarded-host"];
    delete headers["x-forwarded-proto"];
    headers.host = `127.0.0.1:${backendPort}`;
    headers.accept = "application/json";
    headers["ngrok-skip-browser-warning"] = "true";
    const proxy = http.request(
        {
            hostname: "127.0.0.1",
            port: backendPort,
            path: `${incoming.pathname}${incoming.search}`,
            method: request.method,
            headers,
        },
        (upstream) => {
            const contentType = String(upstream.headers["content-type"] || "").toLowerCase();
            if (contentType.includes("text/html")) {
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
                        upstreamContentType: contentType,
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

function isBackendRunning() {
    return new Promise((resolve) => {
        const probe = http.request(
            { hostname: "127.0.0.1", port: backendPort, path: "/api/packages/", method: "GET" },
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

async function startDjango() {
    if (process.env.HEIGEN_AUTO_START_DJANGO === "false" || await isBackendRunning()) {
        return;
    }
    const python = process.env.PYTHON_EXECUTABLE ||
        (process.platform === "win32"
            ? path.join(djangoRoot, ".venv", "Scripts", "python.exe")
            : path.join(djangoRoot, ".venv", "bin", "python"));
    if (!fs.existsSync(python) || !fs.existsSync(path.join(djangoRoot, "manage.py"))) {
        console.error(`Django environment was not found. Expected Python at ${python}`);
        return;
    }
    djangoProcess = spawn(python, ["manage.py", "runserver", String(backendPort)], {
        cwd: djangoRoot,
        env: { ...process.env, HEIGEN_MONOREPO_ROOT: monorepoRoot },
        stdio: "inherit",
        windowsHide: true,
    });
    djangoProcess.on("error", (error) => {
        console.error(`Unable to start Django: ${error.message}`);
    });
    console.log(`Starting Django on http://127.0.0.1:${backendPort}`);
}

function serve(request, response) {
    const requestUrl = new URL(request.url || "/", "http://localhost");
    const requested = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.slice(1);
    const candidate = path.resolve(distRoot, requested);
    const safeRoot = path.resolve(distRoot) + path.sep;
    const filePath = candidate.startsWith(safeRoot) ? candidate : path.join(distRoot, "index.html");
    const fallback = path.join(distRoot, "index.html");

    fs.readFile(filePath, (error, data) => {
        const selected = error ? fallback : filePath;
        fs.readFile(selected, (fallbackError, content) => {
            if (fallbackError) {
                response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
                response.end("Kiosk export is unavailable.");
                return;
            }
            response.writeHead(200, {
                "Cache-Control": "no-cache",
                "Content-Type": contentType(selected),
            });
            response.end(content);
        });
    });
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
}
if (!buildExport()) {
    process.exit(1);
}

const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    if (pathname === apiPrefix || pathname.startsWith(`${apiPrefix}/`)) {
        proxyApi(request, response);
        return;
    }
    serve(request, response);
});

server.on("error", (error) => {
    console.error(`Kiosk server failed: ${error.message}`);
    process.exitCode = 1;
});

let ngrok;
server.listen(port, "127.0.0.1", async () => {
    console.log(`Kiosk: http://127.0.0.1:${port}`);
    await startDjango();
    const command = process.env.NGROK_PATH ||
        (process.platform === "win32" ? "ngrok.exe" : "ngrok");
    ngrok = spawn(command, ["http", String(port)], {
        stdio: "inherit",
        shell: process.platform === "win32",
        windowsHide: true,
    });
    ngrok.on("error", (error) => {
        console.error(`Unable to start ngrok: ${error.message}`);
    });
});

function shutdown() {
    if (ngrok && !ngrok.killed) ngrok.kill();
    if (djangoProcess && !djangoProcess.killed) djangoProcess.kill();
    server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
