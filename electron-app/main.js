const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

let djangoProcess;
let mainWindow;

/**
 * 
 * function startDjango() {
    // Adjust path to your Django project
    djangoProcess = spawn(
        "python",
        [path.join(__dirname, "../manage.py"), "runserver"],
        { cwd: path.join(__dirname, "../backend") },
    );

    djangoProcess.stdout.on("data", (data) => {
        console.log(`Django: ${data}`);
    });
}
 */
function startDjango() {
    // Path to Django project (Snaplytics backend - sibling folder)
    const snaplyticsRoot = path.join(__dirname, "../Snaplytics");
    djangoProcess = spawn(
        "python",
        [path.join(snaplyticsRoot, "manage.py"), "runserver"],
        { cwd: snaplyticsRoot },
    );

    djangoProcess.stdout.on("data", (data) => {
        console.log(`Django: ${data}`);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    mainWindow.loadFile("index.html");
    mainWindow.webContents.openDevTools(); // Remove in production
}

app.whenReady().then(() => {
    startDjango();
    setTimeout(createWindow, 2000); // Wait for Django to start
});

app.on("window-all-closed", () => {
    if (djangoProcess) djangoProcess.kill();
    app.quit();
});

