// Lightweight global alert modal (replaces native alert). Load before other app scripts.
(function installAlertModal(global) {
    if (!global || typeof document === "undefined") return;
    if (global.__heigenAlertInstalled) return;
    global.__heigenAlertInstalled = true;

    const nativeAlert = global.alert ? global.alert.bind(global) : null;
    let modalEl = null;
    let messageEl = null;
    let okBtn = null;
    let confirmModalEl = null;
    let confirmTitleEl = null;
    let confirmMessageEl = null;
    let confirmOkBtn = null;
    let confirmCancelBtn = null;
    let confirmResolver = null;

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

    function ensureConfirmModal() {
        if (confirmModalEl) return;
        confirmModalEl = document.createElement("div");
        confirmModalEl.className = "heigen-alert-host";
        confirmModalEl.innerHTML = `
            <div class="heigen-alert-card heigen-confirm-card" role="dialog" aria-modal="true" aria-labelledby="heigenConfirmTitle">
                <div id="heigenConfirmTitle" class="heigen-alert-title">Confirm Action</div>
                <div id="heigenConfirmMsg" class="heigen-confirm-msg"></div>
                <div class="heigen-confirm-actions">
                    <button id="heigenConfirmCancel" type="button" class="heigen-confirm-btn heigen-confirm-cancel">Cancel</button>
                    <button id="heigenConfirmOk" type="button" class="heigen-confirm-btn heigen-confirm-ok">Confirm</button>
                </div>
            </div>`;
        document.body.appendChild(confirmModalEl);
        confirmTitleEl = confirmModalEl.querySelector("#heigenConfirmTitle");
        confirmMessageEl = confirmModalEl.querySelector("#heigenConfirmMsg");
        confirmOkBtn = confirmModalEl.querySelector("#heigenConfirmOk");
        confirmCancelBtn = confirmModalEl.querySelector("#heigenConfirmCancel");

        function settle(value) {
            confirmModalEl.style.display = "none";
            if (confirmResolver) {
                const resolve = confirmResolver;
                confirmResolver = null;
                resolve(value);
            }
        }

        confirmModalEl.addEventListener("click", (e) => {
            if (e.target === confirmModalEl) {
                settle(false);
            }
        });
        confirmCancelBtn.addEventListener("click", () => settle(false));
        confirmOkBtn.addEventListener("click", () => settle(true));
        global.addEventListener("keydown", (e) => {
            if (confirmModalEl.style.display === "none") return;
            if (e.key === "Escape") settle(false);
            if (e.key === "Enter") settle(true);
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

    global.heigenConfirm = function heigenConfirm(message, opts) {
        try {
            ensureConfirmModal();
            if (!confirmModalEl || !confirmMessageEl) throw new Error("Confirm modal unavailable");
            const options = opts || {};
            const title = options.title || "Confirm Action";
            const confirmText = options.confirmText || "Confirm";
            const cancelText = options.cancelText || "Cancel";
            const dangerous = options.dangerous !== false;

            confirmTitleEl.textContent = title;
            confirmMessageEl.innerHTML = escHtml(message);
            confirmOkBtn.textContent = confirmText;
            confirmCancelBtn.textContent = cancelText;
            confirmOkBtn.classList.remove("heigen-confirm-danger", "heigen-confirm-safe");
            confirmOkBtn.classList.add(
                dangerous ? "heigen-confirm-danger" : "heigen-confirm-safe",
            );

            confirmModalEl.style.display = "flex";
            confirmOkBtn.focus();

            return new Promise((resolve) => {
                confirmResolver = resolve;
            });
        } catch (_) {
            return Promise.resolve(global.confirm(message));
        }
    };
})(typeof window !== "undefined" ? window : globalThis);
