// pages/guest/js/customer-info.js
// Guest intake entry point integrated with backend customer records.

(function initGuestCustomerInfo() {
    const API_BASE = "http://127.0.0.1:8000/api";
    const form = document.getElementById("bookingForm");
    if (!form) return;

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
            const detail =
                (data && (data.detail || data.message || data.error)) ||
                `HTTP ${response.status}`;
            throw new Error(detail);
        }
        return data;
    }

    function normalizeConsent(checked) {
        return checked ? "I Agree" : "I Disagree";
    }

    async function findCustomerByEmail(email) {
        try {
            const trimmed = (email || "").trim().toLowerCase();
            if (!trimmed) return null;
            return await apiRequest(
                `/customers/by-email/?email=${encodeURIComponent(trimmed)}`
            );
        } catch (_) {
            return null;
        }
    }

    async function upsertCustomer(payload) {
        const existing = await findCustomerByEmail(payload.email);
        if (existing && existing.id) {
            const updated = await apiRequest(`/customers/${existing.id}/`, {
                method: "PUT",
                body: JSON.stringify(payload),
            });
            return updated;
        }
        return apiRequest("/customers/", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    function setSubmitState(isSubmitting) {
        const submitBtn = form.querySelector('button[type="submit"]');
        if (!submitBtn) return;
        submitBtn.disabled = isSubmitting;
        submitBtn.style.opacity = isSubmitting ? "0.7" : "1";
        submitBtn.textContent = isSubmitting ? "Saving..." : "Next";
    }

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
    }

    // In-page toast — avoids native alert() which can grab keyboard focus on Linux/Electron
    function ensureToast() {
        let el = document.getElementById("guestToast");
        if (el) return el;
        el = document.createElement("div");
        el.id = "guestToast";
        el.style.cssText =
            "position:fixed;bottom:32px;left:50%;transform:translateX(-50%);" +
            "background:#b91c1c;color:#fff;padding:14px 24px;border-radius:10px;" +
            "font-weight:700;font-size:14px;z-index:10000;opacity:0;" +
            "transition:opacity 0.25s;pointer-events:none;text-align:center;" +
            "max-width:90vw;box-shadow:0 4px 16px rgba(0,0,0,0.25);";
        document.body.appendChild(el);
        return el;
    }

    function showError(message) {
        const el = ensureToast();
        el.textContent = message;
        el.style.opacity = "1";
        setTimeout(() => { el.style.opacity = "0"; }, 3500);
    }

    // Capture listener blocks legacy inline listeners so only this backend-aware flow runs.
    form.addEventListener(
        "submit",
        async (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();

            const formData = new FormData(form);
            const firstVisit = String(formData.get("firstVisit") || "")
                .trim()
                .toLowerCase();
            const fullName = String(formData.get("name") || "").trim();
            const email = String(formData.get("email") || "").trim();
            const contactNo = String(formData.get("contactNo") || "").trim();
            const consent = formData.get("consent") === "on";

            if (!fullName || !email || !contactNo || !firstVisit) {
                showError("Please complete all required fields.");
                return;
            }

            const payload = {
                name: fullName,
                email,
                contactNo,
                consent: normalizeConsent(consent),
                is_first_time: firstVisit === "yes",
                acquisition_source: "Guest Web Booking",
            };

            try {
                setSubmitState(true);
                setLoading(true, "Saving customer info...");
                const customer = await upsertCustomer(payload);
                sessionStorage.setItem(
                    "guestCustomer",
                    JSON.stringify({
                        id: customer?.id || customer?.customer_id || null,
                        name: fullName,
                        email,
                        contactNo,
                        consent,
                        firstVisit: firstVisit === "yes",
                    }),
                );
                window.location.href = "bookingform_packagelist.html";
            } catch (err) {
                console.error("Guest customer submit error:", err);
                showError(
                    `Unable to save customer info right now.\n\n${err.message || "Please try again."}`,
                );
            } finally {
                setLoading(false);
                setSubmitState(false);
            }
        },
        true,
    );

    // Clear loading overlay if this page is restored from bfcache
    window.addEventListener("pageshow", function (event) {
        if (event.persisted) {
            setLoading(false);
            setSubmitState(false);
        }
    });
})();
