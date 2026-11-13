const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { URL } = require("url");
const { request: httpRequest } = require("http");

const ROOT = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || process.env.HEIGEN_WEB_PORT || 4173);
const apiBase = String(
    process.env.HEIGEN_API_URL || "/api",
).replace(/\/+$/, "");
const proxyApi = process.env.HEIGEN_PROXY_API !== "false";
const enableNgrok = process.argv.includes("--ngrok");
const kioskRoot = path.resolve(ROOT, "..", "HeigenKiosk");
const kioskDistRoot = path.join(kioskRoot, "dist");
const monorepoRoot = path.resolve(ROOT, "..");
const djangoRoot = path.join(monorepoRoot, "Snaplytics");
let djangoProcess;

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

function safeFilePath(requestUrl) {
    const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
    const requested = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.resolve(ROOT, `.${requested}`);
    return filePath === ROOT || filePath.startsWith(`${ROOT}${path.sep}`)
        ? filePath
        : null;
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
    if (!enableNgrok || process.env.HEIGEN_AUTO_BUILD_KIOSK === "false") return;
    if (!fs.existsSync(path.join(kioskRoot, "package.json"))) {
        console.error(`Kiosk project was not found: ${kioskRoot}`);
        return;
    }
    if (fs.existsSync(path.join(kioskDistRoot, "index.html"))) {
        console.log(`Kiosk static export: ${kioskDistRoot}`);
        return;
    }

    const buildCommand = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
    const buildArgs = process.platform === "win32"
        ? ["/d", "/s", "/c", "npm run web:build"]
        : ["run", "web:build"];
    const result = spawnSync(buildCommand, buildArgs, {
        cwd: kioskRoot,
        env: { ...process.env, BROWSER: "none", CI: "1" },
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
    if (!enableNgrok || process.env.HEIGEN_AUTO_START_DJANGO === "false" || await isBackendRunning()) {
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
    djangoProcess = spawn(python, ["manage.py", "runserver", String(process.env.HEIGEN_BACKEND_PORT || 8000)], {
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
            const isHtml = path.extname(selectedPath).toLowerCase() === ".html";
            let body = content;
            if (isHtml) {
                body = content.toString("utf8").replace(
                    /((?:src|href|action)=["'])\/(?!\/)/g,
                    "$1/kiosk/",
                );
            }
            response.writeHead(200, {
                "Cache-Control": "no-cache",
                "Content-Type": isHtml ? "text/html; charset=utf-8" : contentType(selectedPath),
            });
            response.end(body);
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
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Invalid path");
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
                `  $env:PORT = "4174"; npm run web:ngrok`,
        );
        process.exitCode = 1;
        return;
    }
    console.error(`Unable to start the web server: ${error.message}`);
    process.exitCode = 1;
});

if (enableNgrok) {
    buildKioskForPublicWeb();
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
});

function shutdown() {
    if (djangoProcess && !djangoProcess.killed) djangoProcess.kill();
    server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
