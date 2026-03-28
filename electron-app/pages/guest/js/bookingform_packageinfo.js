// pages/guest/js/bookingform_packageinfo.js
// Guest booking form: package + add-ons -> creates Pending booking in backend.

(function initGuestPackageInfo() {
    const API_BASE = "http://127.0.0.1:8000/api";
    const form = document.getElementById("packageForm");
    const packageSelect = document.getElementById("packageName");
    const addonsContainer = document.getElementById("addonsContainer");
    if (!form || !packageSelect || !addonsContainer) return;

    const params = new URLSearchParams(window.location.search);
    const preselectedPackageId = Number(params.get("packageId") || 0);
    const preselectedAddonIds = String(params.get("addonIds") || "")
        .split(",")
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0);

    function getGuestContext() {
        try {
            return JSON.parse(sessionStorage.getItem("guestCustomer") || "{}");
        } catch (_) {
            return {};
        }
    }
    const guest = getGuestContext();
    if (!guest.id) {
        window.location.href = "customer-info.html";
        return;
    }

    let packages = [];
    let addons = [];
    let activePackage = null;

    function ensureLoadingOverlay() {
        let el = document.getElementById("guestLoadingOverlay");
        if (el) return el;
        el = document.createElement("div");
        el.id = "guestLoadingOverlay";
        el.style.cssText =
            "position:fixed;inset:0;background:rgba(15,23,42,0.28);display:none;align-items:center;justify-content:center;z-index:9999;";
        el.innerHTML =
            '<div style="background:#fff;padding:14px 18px;border-radius:12px;font-weight:700;color:#165166;box-shadow:0 8px 24px rgba(0,0,0,0.18);">Loading...</div>';
        document.body.appendChild(el);
        return el;
    }

    function setLoading(on, text = "Loading...") {
        const overlay = ensureLoadingOverlay();
        const box = overlay.firstElementChild;
        if (box) box.textContent = text;
        overlay.style.display = on ? "flex" : "none";
        console.debug("[GUEST_DEBUG] packageinfo.setLoading", {
            on,
            text,
            overlayDisplay: overlay.style.display,
            bodyPointerEvents: document.body.style.pointerEvents || "(unset)",
        });
    }

    // In-page toast — avoids native alert() which can grab keyboard focus on Linux/Electron
    function ensureToast() {
        let el = document.getElementById("guestToast");
        if (el) return el;
        el = document.createElement("div");
        el.id = "guestToast";
        el.style.cssText =
            "position:fixed;bottom:32px;left:50%;transform:translateX(-50%);" +
            "background:#165166;color:#fff;padding:14px 24px;border-radius:10px;" +
            "font-weight:700;font-size:14px;z-index:10000;opacity:0;" +
            "transition:opacity 0.25s;pointer-events:none;text-align:center;" +
            "max-width:90vw;box-shadow:0 4px 16px rgba(0,0,0,0.25);";
        document.body.appendChild(el);
        return el;
    }

    function showToast(message, durationMs = 2500) {
        const el = ensureToast();
        el.textContent = message;
        el.style.opacity = "1";
        return new Promise((resolve) => {
            setTimeout(() => {
                el.style.opacity = "0";
                setTimeout(resolve, 260);
            }, durationMs);
        });
    }

    function showError(message) {
        const el = ensureToast();
        el.style.background = "#b91c1c";
        el.textContent = message;
        el.style.opacity = "1";
        setTimeout(() => { el.style.opacity = "0"; }, 3500);
    }

    async function apiRequest(path, options = {}) {
        const response = await fetch(`${API_BASE}${path}`, {
            headers: { "Content-Type": "application/json" },
            ...options,
        });
        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch (_) {
            data = null;
        }
        if (!response.ok) {
            throw new Error(
                (data && (data.detail || data.message || data.error)) ||
                    `HTTP ${response.status}`,
            );
        }
        return data;
    }

    function packagePrice(pkg) {
        const promo = Number(pkg?.promo_price || 0);
        if (promo > 0) return promo;
        return Number(pkg?.price || 0);
    }

    function setPackageOptions() {
        packageSelect.innerHTML =
            '<option value="">Select Package</option>' +
            packages
                .map(
                    (pkg) =>
                        `<option value="${pkg.id}">${pkg.name} – ₱${packagePrice(pkg).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</option>`,
                )
                .join("");
        if (preselectedPackageId) {
            packageSelect.value = String(preselectedPackageId);
        }
    }

    function renderAddonRows() {
        if (!activePackage) {
            addonsContainer.innerHTML =
                '<div class="empty-state">Select a package to view available add-ons.</div>';
            return;
        }
        const category = String(activePackage.category || "").toLowerCase();
        const applicable = addons.filter((a) => {
            if (!a.applies_to) return true;
            const applies = String(a.applies_to || "").toLowerCase();
            return applies.includes(category) || applies.includes("*");
        });

        if (!applicable.length) {
            addonsContainer.innerHTML =
                '<div class="empty-state">No add-ons for this package.</div>';
            return;
        }

        addonsContainer.innerHTML = applicable
            .map((addon) => {
                const prechecked = preselectedAddonIds.includes(Number(addon.id));
                return `
                <label class="addon-row" data-addon-row="${addon.id}" style="display:flex;align-items:center;gap:12px;padding:8px 0;">
                  <input type="checkbox" data-addon-id="${addon.id}" ${
                      prechecked ? "checked" : ""
                  } />
                  <span style="flex:1;">${addon.name}</span>
                  <span style="font-weight:700;color:#165166;">+₱${Number(addon.price || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</span>
                </label>`;
            })
            .join("");
    }

    function getSelectedAddons() {
        const checks = addonsContainer.querySelectorAll("input[data-addon-id]:checked");
        const ids = Array.from(checks).map((c) => Number(c.getAttribute("data-addon-id")));
        return ids
            .map((id) => addons.find((a) => Number(a.id) === id))
            .filter(Boolean);
    }

    async function loadData() {
        setLoading(true, "Loading package details...");
        try {
            const [pkgData, addonData] = await Promise.all([
                apiRequest("/packages/"),
                apiRequest("/addons/"),
            ]);
            packages = Array.isArray(pkgData) ? pkgData : [];
            addons = Array.isArray(addonData) ? addonData : [];
            setPackageOptions();
            activePackage =
                packages.find((p) => Number(p.id) === Number(packageSelect.value)) ||
                null;
            renderAddonRows();
        } finally {
            setLoading(false);
        }
    }

    packageSelect.addEventListener("change", () => {
        activePackage = packages.find((p) => Number(p.id) === Number(packageSelect.value)) || null;
        renderAddonRows();
    });

    form.addEventListener("submit", (e) => {
        e.preventDefault();
    });

    const nextBtn = document.querySelector(".btn-next");
    if (nextBtn) {
        nextBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            activePackage = packages.find((p) => Number(p.id) === Number(packageSelect.value)) || null;
            if (!activePackage) {
                showError("Please select a package.");
                return;
            }

            const selectedAddons = getSelectedAddons();
            const addonsInput = selectedAddons.map((a) => ({
                addonId: a.id,
                quantity: 1,
            }));
            const total =
                packagePrice(activePackage) +
                selectedAddons.reduce((sum, a) => sum + Number(a.price || 0), 0);

            try {
                console.debug("[GUEST_DEBUG] booking.submit.start", {
                    guestId: guest.id,
                    packageId: activePackage.id,
                    addonIds: selectedAddons.map((a) => a.id),
                    total,
                    currentUrl: window.location.href,
                });
                nextBtn.disabled = true;
                nextBtn.textContent = "Booking...";
                setLoading(true, "Submitting booking request...");
                await apiRequest(`/customers/${guest.id}/bookings/`, {
                    method: "POST",
                    body: JSON.stringify({
                        package_id: activePackage.id,
                        addons_input: addonsInput,
                        session_status: "Pending",
                        total_price: total,
                    }),
                });
                sessionStorage.setItem(
                    "guestDebugLastBooking",
                    JSON.stringify({
                        at: new Date().toISOString(),
                        guestId: guest.id,
                        packageId: activePackage.id,
                        addonIds: selectedAddons.map((a) => a.id),
                    }),
                );
                console.debug("[GUEST_DEBUG] booking.submit.success", {
                    guestId: guest.id,
                    packageId: activePackage.id,
                    redirectTo: "bookingform_packagelist.html",
                });
                // Hide loading overlay BEFORE any UI notification to avoid focus grab
                setLoading(false);
                nextBtn.disabled = false;
                nextBtn.textContent = "Submit Request";
                await showToast("Booking request submitted!\nYour request is now pending staff approval.", 2500);
                window.location.href = "bookingform_packagelist.html";
                return; // skip finally re-run of setLoading/nextBtn reset
            } catch (err) {
                console.error("Guest booking create error:", err);
                console.debug("[GUEST_DEBUG] booking.submit.error", {
                    guestId: guest.id,
                    packageId: activePackage.id,
                    message: err?.message || null,
                });
                showError(`Failed to submit booking.\n\n${err.message || "Please try again."}`);
            } finally {
                setLoading(false);
                nextBtn.disabled = false;
                nextBtn.textContent = "Submit Request";
                console.debug("[GUEST_DEBUG] booking.submit.finally", {
                    nextBtnDisabled: nextBtn.disabled,
                    nextBtnText: nextBtn.textContent,
                    overlayDisplay:
                        document.getElementById("guestLoadingOverlay")?.style.display ||
                        "(missing)",
                });
            }
        });
    }

    const backBtn = document.querySelector(".btn-back");
    if (backBtn) {
        backBtn.addEventListener("click", (e) => {
            e.preventDefault();
            window.history.back();
        });
    }

    loadData().catch((err) => {
        console.error("Guest package info load error:", err);
        addonsContainer.innerHTML =
            '<div class="empty-state">Failed to load package details.</div>';
    });

    // Clear loading overlay if this page is restored from bfcache
    window.addEventListener("pageshow", function (event) {
        if (event.persisted) {
            setLoading(false);
        }
    });
})();
