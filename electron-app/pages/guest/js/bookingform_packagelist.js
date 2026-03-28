// pages/guest/js/bookingform_packagelist.js
// Guest web booking: categories + recommendation cards from live backend data.

(function initGuestCategoryPage() {
    const API_BASE = "http://127.0.0.1:8000/api";
    const categoryGrid = document.querySelector(".package-grid");
    const recGrid = document.querySelector(".recommendation-grid");
    if (!categoryGrid) return;

    function getGuestContext() {
        try {
            return JSON.parse(sessionStorage.getItem("guestCustomer") || "{}");
        } catch (_) {
            return {};
        }
    }

    const guest = getGuestContext();
    if (!guest || !guest.id) {
        window.location.href = "customer-info.html";
        return;
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

    function mergeCategories(categories, packages) {
        const pkgByCategory = new Map();
        (packages || []).forEach((pkg) => {
            const k = String(pkg.category || "").trim().toLowerCase();
            if (!k || pkgByCategory.has(k)) return;
            pkgByCategory.set(k, pkg);
        });
        return (categories || []).map((cat) => {
            const key = String(cat.name || "").trim().toLowerCase();
            const pkg = pkgByCategory.get(key);
            return {
                key,
                name: cat.name,
                image: cat.image_url || pkg?.image_url || "",
            };
        });
    }

    function renderCategoryCards(categories) {
        if (!categories.length) {
            categoryGrid.innerHTML =
                '<div class="empty-state">No categories available right now.</div>';
            return;
        }
        categoryGrid.innerHTML = categories
            .map(
                (cat) => `
                <div class="package-card"
                   style="cursor:pointer;"
                   onclick="setGuestLoading(true,'Opening category...');window.location.href='bookingform_packagelist2.html?category=${encodeURIComponent(cat.name)}'">
                <img src="${cat.image || "https://images.unsplash.com/photo-1520854221256-17451cc331bf?w=1000"}"
                     alt="${cat.name}"
                     class="package-card-image"
                     style="background-color:#f0f4f5;height:220px;object-fit:cover;"/>
                <div class="package-card-content">
                  <div class="package-card-text" style="font-size:18px;line-height:1.35;white-space:normal;">${cat.name.toUpperCase()}</div>
                </div>
              </div>`,
            )
            .join("");
    }

    function sourceBadge(source) {
        if (source === "customer_booking_history") return "Booking Loyalty";
        if (source === "popular_fallback") return "Popular Choice";
        return "Recommended";
    }

    function renderRecommendationCards(data) {
        if (!recGrid) return;
        const recs = Array.isArray(data?.recommendations)
            ? data.recommendations
            : [];
        if (!recs.length) {
            recGrid.innerHTML =
                '<div class="empty-state">No recommendations available.</div>';
            return;
        }

        recGrid.innerHTML = recs
            .slice(0, 3)
            .map((rec) => {
                const pkg = rec.package || {};
                const addons = Array.isArray(rec.addons) ? rec.addons : [];
                const addonRows = addons
                    .map(
                        (a) => `
                    <div class="addon-item">
                      <span>${a.name}</span>
                      <span>₱${Number(a.price || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</span>
                    </div>`,
                    )
                    .join("");
                const addonIds = addons
                    .map((a) => a.id)
                    .filter((x) => Number.isFinite(Number(x)))
                    .join(",");
                return `
                <div class="recommendation-card">
                  <h3>${pkg.name || "Recommended Package"}</h3>
                  <p style="font-size:12px;color:#6b7280;margin-bottom:8px;">${pkg.category || ""} • ${sourceBadge(rec.source)}</p>
                  ${
                      Array.isArray(pkg.inclusions) && pkg.inclusions.length
                          ? `<ul>${pkg.inclusions
                                .slice(0, 4)
                                .map((inc) => `<li>${inc}</li>`)
                                .join("")}</ul>`
                          : "<ul><li>Popular customer pick</li></ul>"
                  }
                  <h4>Add-ons</h4>
                  ${addonRows || '<div class="addon-item"><span>No add-ons</span><span>₱0.00</span></div>'}
                  <div class="card-footer">
                    <div class="total-price">₱${Number(rec.total_price || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</div>
                    <button class="btn btn-primary"
                            onclick="setGuestLoading(true,'Opening booking form...');window.location.href='bookingform_packageinfo.html?packageId=${encodeURIComponent(pkg.id || "")}&addonIds=${encodeURIComponent(addonIds)}'">
                      Book
                    </button>
                  </div>
                </div>`;
            })
            .join("");
    }

    async function loadPageData() {
        try {
            setLoading(true, "Loading booking options...");
            categoryGrid.innerHTML =
                '<div class="empty-state">Loading categories...</div>';
            if (recGrid) {
                recGrid.innerHTML =
                    '<div class="empty-state">Loading recommendations...</div>';
            }

            const [packages, categories, recs] = await Promise.all([
                apiRequest("/packages/"),
                apiRequest("/categories/"),
                apiRequest(`/recommendations/${guest.id}/?k=3`),
            ]);
            renderCategoryCards(mergeCategories(categories, packages));
            renderRecommendationCards(recs);
        } catch (err) {
            console.error("Guest package list load error:", err);
            categoryGrid.innerHTML =
                '<div class="empty-state">Failed to load categories.</div>';
            if (recGrid) {
                recGrid.innerHTML =
                    '<div class="empty-state">Failed to load recommendations.</div>';
            }
        } finally {
            setLoading(false);
        }
    }

    loadPageData();

    // Clear loading overlay if this page is restored from bfcache
    window.addEventListener("pageshow", function (event) {
        if (event.persisted) {
            setLoading(false);
        }
    });
})();
