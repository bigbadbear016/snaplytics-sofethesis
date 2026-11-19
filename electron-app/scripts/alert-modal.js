// Lightweight global alert modal (replaces native alert). Load before other app scripts.
(function installAlertModal(global) {
    if (!global || typeof document === "undefined") return;
    if (global.__heigenAlertInstalled) return;
    global.__heigenAlertInstalled = true;

    const nativeAlert = global.alert ? global.alert.bind(global) : null;
    const nativeConfirm = global.confirm ? global.confirm.bind(global) : null;
    let modalEl = null;
    let messageEl = null;
    let alertTitleEl = null;
    let okBtn = null;
    let confirmModalEl = null;
    let confirmTitleEl = null;
    let confirmMessageEl = null;
    let confirmOkBtn = null;
    let confirmCancelBtn = null;
    let confirmResolver = null;

    /*
     * Native modal hosting. Wraps an existing full-screen overlay element in a
     * <dialog> opened with showModal(), so the page behind is inert, focus stays
     * inside, and the overlay sits in the top layer (above every z-index).
     * The overlay markup and styling stay as they are.
     *   HeigenModal.open(overlay[, onDismiss])  - Esc calls onDismiss; default is
     *                                             overlay.click() (the usual
     *                                             click-outside-to-close handler)
     *   HeigenModal.close(overlay)              - unwraps it back in place
     * Removing the overlay (or its container) from the DOM also closes the modal.
     */
    function hostOf(overlay) {
        const p = overlay && overlay.parentElement;
        return p && p.matches("dialog.hg-modal-host") ? p : null;
    }
    function openModal(overlay, onDismiss) {
        if (!overlay) return null;
        let host = hostOf(overlay);
        if (!host) {
            host = document.createElement("dialog");
            host.className = "hg-modal-host";
            if (overlay.isConnected) overlay.before(host);
            else document.body.appendChild(host);
            host.appendChild(overlay);
            // The native modal supplies dialog semantics; move the overlay's
            // manual role/aria-modal labelling onto it instead of nesting dialogs.
            const ARIA_DIALOG = '[role="dialog"],[role="alertdialog"]';
            const labelled = overlay.matches(ARIA_DIALOG) ? overlay : overlay.querySelector(ARIA_DIALOG);
            if (labelled) {
                if (labelled.getAttribute("role") === "alertdialog") host.setAttribute("role", "alertdialog");
                ["aria-labelledby", "aria-label", "aria-describedby"].forEach((a) => {
                    if (labelled.hasAttribute(a)) host.setAttribute(a, labelled.getAttribute(a));
                });
                labelled.removeAttribute("role");
                labelled.removeAttribute("aria-modal");
            }
            const dismiss = () => (onDismiss ? onDismiss() : overlay.click());
            host.addEventListener("cancel", (e) => {
                e.preventDefault();
                dismiss();
            });
            // Browsers may force-close on repeated Esc; keep page state in sync.
            host.addEventListener("close", () => {
                if (host.contains(overlay)) dismiss();
                if (host.contains(overlay)) host.replaceWith(overlay);
            });
            new MutationObserver(() => {
                if (!host.contains(overlay)) {
                    if (host.open) host.close();
                    host.remove();
                }
            }).observe(host, { childList: true });
        }
        if (!host.open) host.showModal();
        return host;
    }
    function closeModal(overlay) {
        const host = hostOf(overlay);
        if (!host) return;
        host.replaceWith(overlay);
    }
    global.HeigenModal = { open: openModal, close: closeModal };

    // Pages render their modals into #modalsContainer; host each one natively.
    function watchModalsContainer() {
        const mc = document.getElementById("modalsContainer");
        if (!mc) return;
        new MutationObserver((muts) => {
            for (const m of muts) {
                for (const n of m.addedNodes) {
                    if (n.nodeType === 1 && n.isConnected && !n.matches("dialog.hg-modal-host")) openModal(n);
                }
            }
        }).observe(mc, { childList: true });
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", watchModalsContainer, { once: true });
    } else {
        watchModalsContainer();
    }

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
            <div class="heigen-alert-card" role="alertdialog" aria-labelledby="heigenAlertTitle">
                <div id="heigenAlertTitle" class="heigen-alert-title">Notice</div>
                <div id="heigenAlertMsg"></div>
                <div class="heigen-alert-actions">
                    <button id="heigenAlertOk" type="button">OK</button>
                </div>
            </div>`;
        document.body.appendChild(modalEl);
        alertTitleEl = modalEl.querySelector("#heigenAlertTitle");
        messageEl = modalEl.querySelector("#heigenAlertMsg");
        okBtn = modalEl.querySelector("#heigenAlertOk");
        const hide = () => {
            modalEl.style.display = "none";
            closeModal(modalEl);
        };
        modalEl.addEventListener("click", (e) => {
            if (e.target === modalEl) hide();
        });
        okBtn.addEventListener("click", hide);
    }

    function ensureConfirmModal() {
        if (confirmModalEl) return;
        confirmModalEl = document.createElement("div");
        confirmModalEl.className = "heigen-alert-host";
        confirmModalEl.innerHTML = `
            <div class="heigen-alert-card heigen-confirm-card" role="alertdialog" aria-labelledby="heigenConfirmTitle">
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
            closeModal(confirmModalEl);
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
    }

    global.heigenAlert = function heigenAlert(message, opts) {
        try {
            ensureModal();
            if (!modalEl || !messageEl || !alertTitleEl) {
                throw new Error("Alert modal unavailable");
            }
            const options = opts || {};
            alertTitleEl.textContent =
                options.title != null ? String(options.title) : "Notice";
            messageEl.innerHTML = escHtml(message);
            modalEl.style.display = "flex";
            openModal(modalEl);
            okBtn?.focus();
        } catch (_) {
            if (nativeAlert) nativeAlert(message);
        }
    };

    global.alert = function heigenAlertCompat(message) {
        global.heigenAlert(message);
    };

    global.heigenConfirm = function heigenConfirm(message, opts) {
        try {
            ensureConfirmModal();
            if (!confirmModalEl || !confirmMessageEl) throw new Error("Confirm modal unavailable");
            const options = opts || {};
            const title = options.title || "Confirm Action";
            const confirmText = options.confirmText || "Confirm";
            const cancelText = options.cancelText || "Cancel";
            const dangerous = options.dangerous === true;

            confirmTitleEl.textContent = title;
            confirmMessageEl.innerHTML = escHtml(message);
            confirmOkBtn.textContent = confirmText;
            confirmCancelBtn.textContent = cancelText;
            confirmOkBtn.classList.remove("heigen-confirm-danger", "heigen-confirm-safe");
            confirmOkBtn.classList.add(
                dangerous ? "heigen-confirm-danger" : "heigen-confirm-safe",
            );

            confirmModalEl.style.display = "flex";
            openModal(confirmModalEl, () => confirmCancelBtn.click());
            // Destructive actions start on the safe choice
            (dangerous ? confirmCancelBtn : confirmOkBtn).focus();

            const { promise, resolve } = Promise.withResolvers();
            confirmResolver = resolve;
            return promise;
        } catch (_) {
            return Promise.resolve(nativeConfirm ? !!nativeConfirm(message) : false);
        }
    };
})(typeof window !== "undefined" ? window : globalThis);
