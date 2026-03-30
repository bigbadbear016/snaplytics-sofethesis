const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

let djangoProcess;
let mainWindow;
let djangoReady = false;
const DJANGO_READY_TIMEOUT_MS = 2000;
const DJANGO_READY_MARKERS = [
    "Starting development server",
    "Watching for file changes",
    "Quit the server with CTRL-BREAK",
];
const MAIN_WINDOW_BOUNDS = {
    width: 1400,
    height: 900,
};
const MAIN_WINDOW_WEB_PREFERENCES = {
    nodeIntegration: false,
    contextIsolation: true,
};
const PYTHON_EXECUTABLE = process.env.PYTHON_EXECUTABLE || "python";

// Used to avoid an arbitrary startup delay; resolved once Django reports it's ready.
let resolveDjangoReady;
const djangoReadyPromise = new Promise((resolve) => {
    resolveDjangoReady = resolve;
});

function startDjango() {
    // Path to Django project (Snaplytics backend - sibling folder)
    const snaplyticsRoot = path.join(__dirname, "../Snaplytics");
    djangoProcess = spawn(
        PYTHON_EXECUTABLE,
        [path.join(snaplyticsRoot, "manage.py"), "runserver"],
        { cwd: snaplyticsRoot },
    );

    djangoProcess.stdout.on("data", (data) => {
        const text = data.toString();
        console.log(`Django: ${text}`);

        // Django's default dev server logs include one of these lines when ready.
        // Keep this heuristic narrow to prevent false positives.
        if (
            !djangoReady &&
            DJANGO_READY_MARKERS.some((marker) => text.includes(marker))
        ) {
            djangoReady = true;
            resolveDjangoReady();
        }
    });

    djangoProcess.stderr.on("data", (data) => {
        console.error(`Django stderr: ${data.toString()}`);
    });

    djangoProcess.on("exit", (code, signal) => {
        console.log(`Django exited (code=${code}, signal=${signal || "none"})`);
    });
}

function stopDjango() {
    if (djangoProcess && !djangoProcess.killed) {
        try {
            djangoProcess.kill();
        } catch {
            // Swallow errors if the process already exited.
        }
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        ...MAIN_WINDOW_BOUNDS,
        webPreferences: MAIN_WINDOW_WEB_PREFERENCES,
    });

    mainWindow.loadFile("index.html");
    mainWindow.webContents.openDevTools(); // Remove in production
}

app.whenReady().then(() => {
    startDjango();

    // Wait for Django to be ready, but keep the existing max startup time behavior.
    // This avoids creating the window too early and removes unnecessary delay when Django starts faster.
    Promise.race([
        djangoReadyPromise,
        new Promise((resolve) => setTimeout(resolve, DJANGO_READY_TIMEOUT_MS)),
    ]).then(() => {
        createWindow();
    });
});

app.on("window-all-closed", () => {
    stopDjango();
    app.quit();
});

app.on("before-quit", () => {
    stopDjango();
});

