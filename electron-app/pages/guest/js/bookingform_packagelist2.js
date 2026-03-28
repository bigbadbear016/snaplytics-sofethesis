// pages/guest/js/bookingform_packagelist2.js
// Guest category detail page: list backend packages for selected category.

(function initGuestPackageListPage() {
    const API_BASE = "http://127.0.0.1:8000/api";
    const grid = document.getElementById("packages-grid");
    const titleEl = document.querySelector(".header h1");
    if (!grid) return;

    const params = new URLSearchParams(window.location.search);
    const category = String(params.get("category") || "").trim();

    function getGuestContext() {
        try {
            return JSON.parse(sessionStorage.getItem("guestCustomer") || "{}");
        } catch (_) {
            return {};
        }
    }
    if (!getGuestContext().id) {
        window.location.href = "customer-info.html";
        return;
    }

    async function apiRequest(path) {
        const response = await fetch(`${API_BASE}${path}`, {
            headers: { "Content-Type": "application/json" },
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
    window.setGuestLoading = setLoading;

    function renderPackages(packages) {
        if (!packages.length) {
            grid.innerHTML =
                '<div class="empty-state">No packages available for this category.</div>';
            return;
        }
        grid.innerHTML = packages
            .map((pkg) => {
                const displayPrice =
                    Number(pkg.promo_price || 0) > 0 ? pkg.promo_price : pkg.price;
                return `
                <div class="package-card">
                  <img src="${pkg.image_url || "https://images.unsplash.com/photo-1554941426-5eb1f0fbc37d?w=1000"}"
                       alt="${pkg.name || "Package"}"
                       class="package-image">
                  <div class="package-content">
                    <div class="package-header">
                      <div class="package-name">${pkg.name || "Package"}</div>
                      <div class="package-actions">
                        <button class="btn-book"
                                onclick="setGuestLoading(true,'Opening package details...');window.location.href='bookingform_packageinfo.html?packageId=${encodeURIComponent(pkg.id)}'">Book</button>
                      </div>
                    </div>
                    <div class="package-price">₱${Number(displayPrice || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</div>
                    <div class="package-pax">${
                        pkg.max_people
                            ? `Up to ${pkg.max_people} pax`
                            : "Studio Session"
                    }</div>
                    <div class="package-details">${
                        Array.isArray(pkg.inclusions) && pkg.inclusions.length
                            ? pkg.inclusions.slice(0, 4).join(" • ")
                            : pkg.notes || "Tap Book to continue"
                    }</div>
                  </div>
                </div>`;
            })
            .join("");
    }

    async function loadPackages() {
        try {
            setLoading(true, "Loading packages...");
            grid.innerHTML = '<div class="empty-state">Loading packages...</div>';
            const all = await apiRequest("/packages/");
            const list = Array.isArray(all) ? all : [];
            const filtered = category
                ? list.filter(
                      (p) =>
                          String(p.category || "").toLowerCase() ===
                          category.toLowerCase(),
                  )
                : list;
            if (titleEl && category) {
                titleEl.textContent = `Booking Form - ${category} Packages`;
            }
            renderPackages(filtered);
        } catch (err) {
            console.error("Guest category package load error:", err);
            grid.innerHTML =
                '<div class="empty-state">Failed to load packages.</div>';
        } finally {
            setLoading(false);
        }
    }

    loadPackages();

    // Clear loading overlay if this page is restored from bfcache
    window.addEventListener("pageshow", function (event) {
        if (event.persisted) {
            setLoading(false);
        }
    });
})();
