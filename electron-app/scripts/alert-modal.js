// Lightweight global alert modal (replaces native alert). Load before other app scripts.
(function installAlertModal(global) {
    if (!global || typeof document === "undefined") return;
    if (global.__heigenAlertInstalled) return;
    global.__heigenAlertInstalled = true;

    const nativeAlert = global.alert ? global.alert.bind(global) : null;
    let modalEl = null;
    let messageEl = null;
    let okBtn = null;

    function escHtml(s) {
        return String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function ensureModal() {
        if (modalEl) return;
        modalEl = document.createElement("div");
        modalEl.className = "heigen-alert-host";
        modalEl.innerHTML = `
            <div class="heigen-alert-card" role="alertdialog" aria-modal="true" aria-labelledby="heigenAlertTitle">
                <div id="heigenAlertTitle" class="heigen-alert-title">Notice</div>
                <div id="heigenAlertMsg"></div>
                <div class="heigen-alert-actions">
                    <button id="heigenAlertOk" type="button">OK</button>
                </div>
            </div>`;
        document.body.appendChild(modalEl);
        messageEl = modalEl.querySelector("#heigenAlertMsg");
        okBtn = modalEl.querySelector("#heigenAlertOk");
        modalEl.addEventListener("click", (e) => {
            if (e.target === modalEl) {
                modalEl.style.display = "none";
            }
        });
        okBtn.addEventListener("click", () => {
            modalEl.style.display = "none";
        });
        global.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && modalEl.style.display !== "none") {
                modalEl.style.display = "none";
            }
        });
    }

    global.alert = function heigenAlertModal(message) {
        try {
            ensureModal();
            if (!modalEl || !messageEl) throw new Error("Alert modal unavailable");
            messageEl.innerHTML = escHtml(message);
            modalEl.style.display = "flex";
            okBtn?.focus();
        } catch (_) {
            if (nativeAlert) nativeAlert(message);
        }
    };
})(typeof window !== "undefined" ? window : globalThis);
