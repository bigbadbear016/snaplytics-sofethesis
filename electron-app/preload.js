const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("heigenElectron", {
    getNgrokUrl: () => ipcRenderer.invoke("heigen:get-ngrok-url"),
});