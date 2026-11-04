const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");
const { request: httpRequest } = require("http");

const ROOT = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || process.env.HEIGEN_WEB_PORT || 4173);
const apiBase = String(
    process.env.HEIGEN_API_URL || "/api",
).replace(/\/+$/, "");
const proxyApi = process.env.HEIGEN_PROXY_API !== "false";
const kioskPort = Number(process.env.HEIGEN_KIOSK_PORT || 8090);
const enableNgrok = process.argv.includes("--ngrok");

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
    const targetPath = new URL(request.url || "/api", "http://localhost").pathname +
        new URL(request.url || "/api", "http://localhost").search;
    const proxy = httpRequest(
        {
            hostname: "127.0.0.1",
            port: Number(process.env.HEIGEN_BACKEND_PORT || 8000),
            path: targetPath,
            method: request.method,
            headers: { ...request.headers, host: "127.0.0.1:8000" },
        },
        (upstream) => {
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

function proxyKioskRequest(request, response) {
    const incoming = new URL(request.url || "/kiosk", "http://localhost");
    const kioskPath = incoming.pathname.replace(/^\/kiosk(?:\/|$)/, "/") || "/";
    const targetPath = `${kioskPath}${incoming.search}`;
    const proxy = httpRequest(
        {
            hostname: "127.0.0.1",
            port: kioskPort,
            path: targetPath,
            method: request.method,
            headers: { ...request.headers, host: `127.0.0.1:${kioskPort}` },
        },
        (upstream) => {
            const headers = { ...upstream.headers };
            const contentType = String(headers["content-type"] || "");
            if (contentType.includes("text/html")) {
                let body = "";
                upstream.setEncoding("utf8");
                upstream.on("data", (chunk) => {
                    body += chunk;
                });
                upstream.on("end", () => {
                    body = body.replace(
                        /((?:src|href|action)=["'])\/(?!\/)/g,
                        "$1/kiosk/",
                    );
                    response.writeHead(upstream.statusCode || 502, {
                        ...headers,
                        "content-length": Buffer.byteLength(body),
                    });
                    response.end(body);
                });
                return;
            }
            response.writeHead(upstream.statusCode || 502, headers);
            upstream.pipe(response);
        },
    );
    proxy.on("error", () => {
        if (!response.headersSent) {
            response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        }
        response.end("Kiosk is unavailable. Start HeigenKiosk on port " + kioskPort + ".");
    });
    request.pipe(proxy);
}

const server = http.createServer((request, response) => {
    if (proxyApi && (request.url === "/api" || request.url?.startsWith("/api/"))) {
        proxyApiRequest(request, response);
        return;
    }
    if (request.url === "/kiosk" || request.url?.startsWith("/kiosk/")) {
        proxyKioskRequest(request, response);
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

server.listen(port, "127.0.0.1", () => {
    console.log(`Web UI: http://127.0.0.1:${port}`);
    console.log(`API: ${apiBase}${proxyApi ? " (proxied to local Django)" : ""}`);

    if (enableNgrok) {
        const command =
            process.env.NGROK_PATH ||
            (process.platform === "win32" ? "ngrok.exe" : "ngrok");
        const ngrok = spawn(command, ["http", String(port)], {
            stdio: "inherit",
            shell: process.platform === "win32",
        });
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
    server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
