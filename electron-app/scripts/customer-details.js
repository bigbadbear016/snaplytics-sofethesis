// scripts/customer-details.js
import { getCustomerRecommendations, formatPrice } from "./recommendations.js";

function ensureRecommendationStyles() {
    if (!document.querySelector('link[href*="recommendations_styles.css"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "../../styles/recommendations_styles.css";
        document.head.appendChild(link);
    }
}

// ── State ─────────────────────────────────────────────────────────────────────

function normalizeConsent(value) {
    if (value === true) return "I Agree";
    if (value === false || value === null || value === undefined)
        return "I Disagree";
    const v = String(value).trim().toLowerCase();
    if (["i agree", "agree", "yes", "approved", "true"].includes(v)) {
        return "I Agree";
    }
    if (["i disagree", "disagree", "no", "not approved", "false"].includes(v)) {
        return "I Disagree";
    }
    return value;
}

const detailsState = {
    customerId: null,
    customer: null,
    packages: [],
    addons: [],
    loyaltySettings: null,
    isHistoryExpanded: false,
    currentBooking: null,
    selectedBooking: null,
    isEditingBooking: false,
    activeView: null,
};

function formatCustomerLoyaltyPoints(c) {
    const v = c?.loyaltyPoints;
    if (v == null || Number.isNaN(Number(v))) return "0.0";
    return Number(v).toFixed(1);
}

function sortBookingsLatestFirst(bookings) {
    if (!Array.isArray(bookings)) return;
    bookings.sort((a, b) => Number(b.id) - Number(a.id));
}

const INVOICE_LOGO_URL =
    "https://api.builder.io/api/v1/image/assets/TEMP/0fdade257f0aa6c53979aa05f0c346a41b70e926?width=475";
const INVOICE_LOGO_FILTER =
    "invert(100%) sepia(8%) saturate(333%) hue-rotate(163deg) brightness(92%) contrast(92%)";

// ── Init ──────────────────────────────────────────────────────────────────────

function getParameterByName(name) {
    return new URLSearchParams(window.location.search).get(name);
}

async function initializeCustomerDetails() {
    const customerId = parseInt(getParameterByName("id"), 10);
    if (!customerId || isNaN(customerId)) {
        document.querySelector(".page-wrapper").innerHTML =
            '<div class="p-10">Customer not found</div>';
        return;
    }
    detailsState.customerId = customerId;

    const overlay = document.getElementById("pageLoadingOverlay");
    if (overlay) overlay.style.display = "flex";
    try {
        const [customer, packages, addons, loyaltySettings] =
            await Promise.all([
                window.apiClient.customers.get(customerId),
                window.apiClient.packages.list(),
                window.apiClient.addons.list(),
                window.apiClient.loyaltySettings.get().catch(() => null),
            ]);
        if (!customer) throw new Error("Customer not found");
        detailsState.customer = customer;
        detailsState.loyaltySettings = loyaltySettings || window.loyaltyClaim.DEFAULT_SETTINGS;
        // Only show confirmed (BOOKED) bookings on the customer profile.
        // Pending/Ongoing bookings from the kiosk are managed via the
        // notification panel and must not appear until accepted.
        if (Array.isArray(customer.bookings)) {
            customer.bookings = customer.bookings.filter(
                (b) => !b.session_status || b.session_status === "BOOKED",
            );
            sortBookingsLatestFirst(customer.bookings);
        }
        detailsState.packages = Array.isArray(packages) ? packages : [];
        detailsState.addons = Array.isArray(addons) ? addons : [];
        ensureRecommendationStyles();
        renderCustomerDetails();
    } catch (err) {
        console.error("initializeCustomerDetails:", err);
        document.querySelector(".page-wrapper").innerHTML =
            `<div class="cdx-card"><div class="hg-empty">
               <div class="hg-empty-title">Couldn't load this customer</div>
               <div class="hg-empty-text">${escapeHtml(err.message)}</div>
               <button type="button" class="cdx-btn cdx-btn--primary hg-empty-action" onclick="location.reload()">Try again</button>
             </div></div>`;
    } finally {
        if (overlay) overlay.style.display = "none";
    }
}

// ── Core render ───────────────────────────────────────────────────────────────

function cdxInitials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    const first = parts[0][0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
}

function cdxPeso(v) {
    const n = Number(v || 0);
    return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cdxFormatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return escapeHtml(value);
    return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function cdxConsentBadge(consent) {
    const text = normalizeConsent(consent ?? "");
    const t = String(text).toLowerCase();
    const tone = /agree|yes|given|true/.test(t) && !/disagree|not/.test(t)
        ? "success"
        : /disagree|no|declin|false|not/.test(t)
          ? "danger"
          : "neutral";
    return `<span class="hg-badge hg-badge--${tone}">Consent: ${escapeHtml(text || "Not set")}</span>`;
}

function cdxRenewalBadge(band) {
    if (band === "likely") return '<span class="hg-badge hg-badge--success">Likely to book again</span>';
    if (band === "unlikely") return '<span class="hg-badge hg-badge--warning">At risk of not returning</span>';
    return "";
}

function cdxBackToList() {
    try {
        if (window.parent && window.parent !== window && typeof window.parent.staffShellNav === "function") {
            window.parent.staffShellNav("customers.html");
            return;
        }
    } catch (_) {}
    window.location.href = "./customers.html";
}

function renderCustomerDetails() {
    const c = detailsState.customer;
    const bookings = Array.isArray(c.bookings) ? c.bookings : [];
    const bookingCount = bookings.length;
    const customerId = c.id ?? c.customer_id ?? detailsState.customerId ?? "";
    const displayName = c.name ? `${c.name}` : `Customer #${customerId}`;

    document.getElementById("customerHeader").textContent = displayName;
    document.title = `${displayName} · Heigen`;
    const avatar = document.getElementById("cdxAvatar");
    if (avatar) avatar.textContent = cdxInitials(c.name);

    const meta = document.getElementById("cdxHeroMeta");
    if (meta) {
        meta.innerHTML = `
          <span class="cdx-chip">ID ${escapeHtml(customerId)}</span>
          ${cdxConsentBadge(c.consent)}
          ${cdxRenewalBadge(c.renewalBand)}`;
    }

    const canClaim = window.loyaltyClaim.canClaim(c, detailsState.packages, detailsState.loyaltySettings);
    const actions = document.getElementById("cdxHeroActions");
    if (actions) {
        actions.innerHTML = `
          <button type="button" class="cdx-btn cdx-btn--ghost" onclick="openCustomerEditModal()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>
            Edit profile
          </button>
          ${canClaim
              ? `<button type="button" class="cdx-btn cdx-btn--ghost" onclick="handleClaimPackage()">
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><path d="M12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
                   Claim with points
                 </button>`
              : ""}
          <button type="button" class="cdx-btn cdx-btn--primary" onclick="handleAddBooking()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            Add booking
          </button>`;
    }

    const paid = bookings.filter((b) => !b.loyaltyClaim);
    const totalSpent = paid.reduce((sum, b) => sum + Number(b.total ?? b.totalPrice ?? 0), 0);
    // Latest session date (list order is by record id, so don't rely on bookings[0])
    const lastVisit = bookings.reduce((best, b) => {
        const t = new Date(b.date).getTime();
        return Number.isFinite(t) && (best == null || t > new Date(best).getTime()) ? b.date : best;
    }, null);
    const stats = document.getElementById("cdxStats");
    if (stats) {
        const tile = (label, value, hint, accent) => `
          <div class="cdx-stat" style="--cdx-accent:${accent}">
            <div class="cdx-stat-label">${label}</div>
            <div class="cdx-stat-value">${value}</div>
            <div class="cdx-stat-hint">${hint}</div>
          </div>`;
        stats.innerHTML =
            tile("Bookings", bookingCount.toLocaleString("en-PH"), bookingCount === 1 ? "1 confirmed visit" : `${bookingCount} confirmed visits`, "#165166") +
            tile("Total spent", cdxPeso(totalSpent), paid.length ? `Avg ${cdxPeso(totalSpent / paid.length)} per booking` : "No paid bookings yet", "#c98a1e") +
            tile("Loyalty points", formatCustomerLoyaltyPoints(c), canClaim ? "Enough to claim a package" : "Earned from completed bookings", "#7c3aed") +
            tile("Last visit", lastVisit ? cdxFormatDate(lastVisit) : "—", lastVisit ? "Most recent booking" : "No visits yet", "#22a06b");
    }

    const row = (label, value) => `
      <div class="cdx-detail">
        <dt>${label}</dt>
        <dd>${value}</dd>
      </div>`;
    const email = c.email ? `<span class="cdx-detail-select">${escapeHtml(c.email)}</span>` : '<span class="cdx-muted">Not provided</span>';
    const phone = c.contactNo ? escapeHtml(c.contactNo) : '<span class="cdx-muted">Not provided</span>';
    document.getElementById("accountInfo").innerHTML =
        row("Full name", escapeHtml(c.name || "—")) +
        row("Email", email) +
        row("Contact no.", phone) +
        row("Consent", escapeHtml(normalizeConsent(c.consent ?? "") || "Not set")) +
        row("Claimed package", c.claimedPackageName ? escapeHtml(c.claimedPackageName) : '<span class="cdx-muted">None</span>') +
        row("Customer ID", escapeHtml(customerId));

    renderBookingHistory();
    renderViewButtons();
}

// ── Booking history ───────────────────────────────────────────────────────────

/** The history list shows 3 bookings; from the 4th one it scrolls (see .cdx-history in CSS). */
const CDX_HISTORY_VISIBLE = 3;

function renderBookingHistory() {
    const container = document.getElementById("bookingHistory");
    const c = detailsState.customer;
    const sub = document.getElementById("cdxHistorySub");
    const bookings = Array.isArray(c.bookings) ? c.bookings : [];

    container.classList.toggle("is-scrollable", bookings.length > CDX_HISTORY_VISIBLE);
    container.classList.toggle("is-empty", bookings.length === 0);
    container.scrollTop = 0;
    if (sub) {
        sub.textContent = bookings.length
            ? `${bookings.length} booking${bookings.length === 1 ? "" : "s"} · latest first${bookings.length > CDX_HISTORY_VISIBLE ? " · scroll for more" : ""}`
            : "Latest bookings first.";
    }

    if (!bookings.length) {
        container.replaceChildren();
        if (window.HeigenUI) {
            container.appendChild(
                window.HeigenUI.emptyState({
                    icon: "calendar",
                    title: "No bookings yet",
                    text: "Bookings you add for this customer will show up here.",
                    actionLabel: "Add booking",
                    onAction: () => handleAddBooking(),
                }),
            );
        } else {
            container.innerHTML = '<div class="empty-state">No booking history</div>';
        }
        return;
    }

    container.innerHTML =
        '<ul class="cdx-history-list">' +
        bookings
            .map((b) => {
                const total = Number(b.total ?? b.totalPrice ?? 0);
                const d = new Date(b.date);
                const valid = !Number.isNaN(d.getTime());
                const day = valid ? d.toLocaleDateString("en-PH", { day: "2-digit" }) : "—";
                const mon = valid ? d.toLocaleDateString("en-PH", { month: "short" }) : "";
                const yr = valid ? d.getFullYear() : "";
                const type = b.type ?? "Walk-In";
                return `
              <li class="cdx-booking">
                <div class="cdx-booking-date" aria-label="${escapeHtml(b.date ?? "")}">
                  <span class="cdx-booking-day">${day}</span>
                  <span class="cdx-booking-mon">${mon} ${yr}</span>
                </div>
                <div class="cdx-booking-main">
                  <div class="cdx-booking-pkg" title="${escapeHtml(b.packageName ?? "")}">${escapeHtml(b.packageName || "Package")}</div>
                  <div class="cdx-booking-sub">
                    <span class="cdx-chip cdx-chip--sm">${escapeHtml(type)}</span>
                    ${b.loyaltyClaim ? '<span class="hg-badge hg-badge--info">Claimed with points</span>' : ""}
                  </div>
                </div>
                <div class="cdx-booking-total">${b.loyaltyClaim ? "Points" : cdxPeso(total)}</div>
                <div class="cdx-booking-actions">
                  <button type="button" class="cdx-icon-btn" onclick="handleViewInvoice(${b.id})" data-tip="Invoice" aria-label="View invoice">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
                  </button>
                  <button type="button" class="cdx-icon-btn" onclick="handleEditBooking(${b.id})" data-tip="Edit" aria-label="Edit booking">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  </button>
                  <button type="button" class="cdx-icon-btn cdx-icon-btn--danger" onclick="handleDeleteBooking(${b.id})" data-tip="Delete" aria-label="Delete booking">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                  </button>
                </div>
              </li>`;
            })
            .join("") +
        "</ul>";
}

// ── View buttons ──────────────────────────────────────────────────────────────

function renderViewButtons() {
    const tab = (view, label, icon, onclick) => {
        const active = detailsState.activeView === view;
        return `
      <button type="button" role="tab" aria-selected="${active}"
              class="cdx-tab ${active ? "is-active" : ""}" onclick="${onclick}">
        ${icon}<span>${label}</span>
      </button>`;
    };
    document.getElementById("viewButtons").innerHTML =
        tab(
            "predict",
            "Predict renewal",
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
            "togglePredictView()",
        ) +
        tab(
            "recommendation",
            "Recommendations",
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
            "toggleRecommendationView()",
        );
    const panels = document.getElementById("panelsContainer");
    if (panels && !detailsState.activeView) {
        panels.innerHTML = `
          <div class="cdx-insights-idle">
            <div class="cdx-idle-option" onclick="togglePredictView()" role="button" tabindex="0">
              <div class="cdx-idle-icon" style="--cdx-accent:#7c3aed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
              <div><div class="cdx-idle-title">Predict renewal</div><div class="cdx-idle-text">Estimate how likely this customer is to book again.</div></div>
            </div>
            <div class="cdx-idle-option" onclick="toggleRecommendationView()" role="button" tabindex="0">
              <div class="cdx-idle-icon" style="--cdx-accent:#c98a1e"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg></div>
              <div><div class="cdx-idle-title">Recommend packages</div><div class="cdx-idle-text">Get the 3 best packages to offer, with reasons.</div></div>
            </div>
          </div>`;
        panels.querySelectorAll(".cdx-idle-option").forEach((el) => {
            el.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    el.click();
                }
            });
        });
    }
}

// ── Recommendation / prediction ───────────────────────────────────────────────

let recommendationCache = null;
let renewalCache = null;
let modelMetricsCache = null;
let modelMetricsError = "";
let modelMetricsLoadAttempted = false;
let modelMetricsPromise = null;
const MODEL_METRICS_TIMEOUT_MS = 12000;
let modelMetricsRecomputeInFlight = false;
let loadingProgress = 0;
let predictionProgress = 0;
const MODEL_METRICS_DEBUG = true;

function debugModelMetrics(message, payload = undefined) {
    if (!MODEL_METRICS_DEBUG) return;
    if (payload === undefined) {
        console.log(`[ModelMetrics] ${message}`);
        return;
    }
    console.log(`[ModelMetrics] ${message}`, payload);
}

function updateLoadingProgress(p) {
    loadingProgress = p;
    const bar = document.querySelector(".loading-progress-bar-fill");
    const val = document.querySelector(".loading-progress-value");
    const status = document.querySelector(".loading-progress-status");
    if (bar) bar.style.width = `${p}%`;
    cdxSyncSteps(p);
    if (val) val.textContent = `${Math.round(p)}%`;
    if (status && p < 100) {
        status.textContent =
            p < 30
                ? "Reading customer profile..."
                : p < 60
                  ? "Finding similar customers..."
                  : p < 90
                    ? "Ranking packages..."
                    : "Almost ready...";
    }
}

function updatePredictionProgress(p) {
    predictionProgress = p;
    const bar = document.querySelector(".loading-progress-bar-fill");
    const val = document.querySelector(".loading-progress-value");
    const status = document.querySelector(".loading-progress-status");
    if (bar) bar.style.width = `${p}%`;
    cdxSyncSteps(p);
    if (val) val.textContent = `${Math.round(p)}%`;
    if (status && p < 100) {
        status.textContent =
            p < 30
                ? "Preparing renewal model..."
                : p < 60
                  ? "Reading booking history..."
                  : p < 90
                    ? "Calculating renewal score..."
                    : "Almost ready...";
    }
}
async function loadRecommendations(customerId) {
    try {
        updateLoadingProgress(10);
        const iv = setInterval(() => {
            if (loadingProgress < 90)
                updateLoadingProgress(loadingProgress + 10);
        }, 200);
        const data = await getCustomerRecommendations(customerId, null, 3);
        clearInterval(iv);
        updateLoadingProgress(100);
        recommendationCache = data;
        console.log("Recommendation Data:", recommendationCache);
        await new Promise((r) => setTimeout(r, 300));
        return data;
    } catch (e) {
        console.error("loadRecommendations:", e);
        return null;
    }
}

async function loadRenewalPrediction(customerId) {
    try {
        updatePredictionProgress(10);
        const iv = setInterval(() => {
            if (predictionProgress < 90)
                updatePredictionProgress(predictionProgress + 10);
        }, 220);
        const data = await window.apiClient.renewal.forCustomer(customerId);
        clearInterval(iv);
        updatePredictionProgress(100);
        renewalCache = data;
        return data;
    } catch (e) {
        console.error("loadRenewalPrediction:", e);
        return null;
    }
}

async function loadModelMetrics() {
    if (modelMetricsPromise) return modelMetricsPromise;
    modelMetricsLoadAttempted = true;
    debugModelMetrics("loadModelMetrics:start", {
        activeView: detailsState.activeView,
        customerId: detailsState.customerId,
    });
    modelMetricsPromise = (async () => {
        try {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(
                        new Error(
                            `Model metrics request timed out after ${MODEL_METRICS_TIMEOUT_MS}ms`,
                        ),
                    );
                }, MODEL_METRICS_TIMEOUT_MS);
            });
            const data = await Promise.race([
                window.apiClient.analytics.modelMetrics(),
                timeoutPromise,
            ]);
            modelMetricsCache = data;
            modelMetricsError = "";
            debugModelMetrics("loadModelMetrics:success", {
                topKeys: Object.keys(data || {}),
                renewalKeys: Object.keys(data?.renewal || {}),
                recommendationKeys: Object.keys(data?.recommendation || {}),
                hasRenewalSavedModel: Boolean(data?.renewal?.saved_model),
                hasRenewalEngineered: Boolean(
                    data?.renewal?.engineered_baseline,
                ),
                hasRecommendationSummary: Boolean(
                    data?.recommendation?.summary,
                ),
                hasRecommendationDetails: Boolean(
                    data?.recommendation?.details?.rows?.length,
                ),
                backendError: data?.error || null,
            });
            return data;
        } catch (e) {
            console.error("loadModelMetrics:", e);
            modelMetricsError = String(e?.message || e || "Unknown error");
            debugModelMetrics("loadModelMetrics:error", {
                error: modelMetricsError,
                stack: e?.stack || null,
            });
            return null;
        } finally {
            debugModelMetrics("loadModelMetrics:finally", {
                hasCache: Boolean(modelMetricsCache),
                loadAttempted: modelMetricsLoadAttempted,
                currentError: modelMetricsError || null,
            });
            modelMetricsPromise = null;
        }
    })();
    return modelMetricsPromise;
}

function ensureModelMetricsLoaded() {
    debugModelMetrics("ensureModelMetricsLoaded:check", {
        hasCache: Boolean(modelMetricsCache),
        inFlight: Boolean(modelMetricsPromise),
        loadAttempted: modelMetricsLoadAttempted,
        activeView: detailsState.activeView,
    });
    if (modelMetricsCache) return;
    if (modelMetricsPromise) return;
    loadModelMetrics().then((data) => {
        debugModelMetrics("ensureModelMetricsLoaded:resolved", {
            hasData: Boolean(data),
            hasCache: Boolean(modelMetricsCache),
            error: modelMetricsError || null,
            activeView: detailsState.activeView,
        });
        if (!data) return;
        updateVisibleMetricsInPlace();
    });
}

function updateVisibleMetricsInPlace() {
    if (detailsState.activeView === "predict") {
        const el = document.getElementById("renewalMetricsContainer");
        if (el) {
            el.innerHTML = renderRenewalMetricsCollapsible();
            debugModelMetrics("updateVisibleMetricsInPlace:renewal-updated");
        }
        return;
    }
    if (detailsState.activeView === "recommendation") {
        const el = document.getElementById("recommendationMetricsContainer");
        if (el) {
            el.innerHTML = renderRecommendationMetricsCollapsible();
            debugModelMetrics(
                "updateVisibleMetricsInPlace:recommendation-updated",
            );
        }
    }
}

function resetModelMetrics() {
    debugModelMetrics("resetModelMetrics:clear-cache");
    modelMetricsCache = null;
    modelMetricsError = "";
    modelMetricsLoadAttempted = false;
    modelMetricsPromise = null;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function pct(value) {
    if (!Number.isFinite(Number(value))) return "-";
    return `${(Number(value) * 100).toFixed(2)}%`;
}

function isRatioMetric(key) {
    return (
        key.includes("rate") ||
        key.includes("auc") ||
        key.includes("accuracy") ||
        key.includes("precision") ||
        key.includes("recall") ||
        key.includes("f1") ||
        key.includes("mcc") ||
        key.includes("coverage") ||
        key.includes("ndcg")
    );
}

function formatMetricLabel(key) {
    const labels = {
        accuracy: "Accuracy",
        precision: "Precision",
        recall: "Recall",
        f1: "F1 Score",
        mcc: "Matthews CC",
        roc_auc: "ROC-AUC",
        ndcg_at_3: "NDCG@3",
        ndcg_at_5: "NDCG@5",
        ndcg_at_3_std: "NDCG@3 Std Dev",
        ndcg_at_5_std: "NDCG@5 Std Dev",
        hit_rate_at_3: "Hit Rate@3",
        hit_rate_at_5: "Hit Rate@5",
        hit_rate_at_3_percent: "Hit Rate@3 (%)",
        hit_rate_at_5_percent: "Hit Rate@5 (%)",
        user_coverage_at_3: "User Coverage@3",
        user_coverage_at_5: "User Coverage@5",
        users_with_hit_at_3: "Users w/ Hit@3",
        users_with_hit_at_5: "Users w/ Hit@5",
        rows_evaluated: "Users Evaluated",
    };
    if (labels[key]) return labels[key];
    return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMetricValue(key, raw) {
    if (typeof raw !== "number") return String(raw ?? "-");
    if (key.endsWith("_percent")) return `${raw.toFixed(2)}%`;
    if (isRatioMetric(key)) return pct(raw);
    if (Number.isInteger(raw)) return raw.toLocaleString("en-US");
    return raw.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function renderMetricsRows(metricMap, excludedKeys = []) {
    if (!metricMap || typeof metricMap !== "object") return "";
    return Object.keys(metricMap)
        .filter((key) => !excludedKeys.includes(key))
        .map((key) => {
            const raw = metricMap[key];
            const label = formatMetricLabel(key);
            const value = formatMetricValue(key, raw);
            return `
              <div class="model-metrics-row">
                <span class="model-metrics-key">${escapeHtml(label)}</span>
                <span class="model-metrics-value">${escapeHtml(value)}</span>
              </div>`;
        })
        .join("");
}

function renderRecommendationRowsTable(details) {
    const columns = Array.isArray(details?.columns) ? details.columns : [];
    const rows = Array.isArray(details?.rows) ? details.rows : [];
    if (!columns.length || !rows.length) return "";

    const head = columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("");
    const body = rows
        .map((row) => {
            const cells = columns
                .map((col) => {
                    const value = row[col];
                    if (typeof value === "number" && !Number.isInteger(value)) {
                        return `<td>${escapeHtml(value.toFixed(6))}</td>`;
                    }
                    return `<td>${escapeHtml(value)}</td>`;
                })
                .join("");
            return `<tr>${cells}</tr>`;
        })
        .join("");

    return `
      <div class="model-metrics-subtitle">Per-user Evaluation Details (${rows.length})</div>
      <div class="model-metrics-table-wrap">
        <table class="model-metrics-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
}

function renderMetricsCollapsible({ title, subtitle, content, open = false }) {
    return `
      <details class="model-metrics-collapsible" ${open ? "open" : ""}>
        <summary class="model-metrics-summary">
          <div class="model-metrics-summary-main">
            <span class="model-metrics-chevron" aria-hidden="true">▸</span>
            <span>${escapeHtml(title)}</span>
          </div>
          <span class="model-metrics-summary-hint">${escapeHtml(subtitle)}</span>
        </summary>
        <div class="model-metrics-content">
          ${content}
        </div>
      </details>`;
}

function renderRenewalMetricsCollapsible() {
    const saved = modelMetricsCache?.renewal?.saved_model;
    const engineered = modelMetricsCache?.renewal?.engineered_baseline;
    const sourceSaved =
        modelMetricsCache?.renewal?.source_files?.saved_model ||
        "renewal/outputs/renewal_xgboost_live_metrics.csv";
    const sourceEng =
        modelMetricsCache?.renewal?.source_files?.engineered_baseline ||
        "";

    const hasMetrics = Boolean(saved || engineered);
    if (!hasMetrics) {
        debugModelMetrics("renderRenewalMetricsCollapsible:unavailable", {
            hasCache: Boolean(modelMetricsCache),
            hasRenewal: Boolean(modelMetricsCache?.renewal),
            hasSavedModel: Boolean(saved),
            hasEngineeredBaseline: Boolean(engineered),
            error: modelMetricsError || null,
            sourceFiles: modelMetricsCache?.renewal?.source_files || null,
        });
    }

    const content = hasMetrics
        ? `
          ${
              saved
                  ? `<div class="model-metrics-block">
              <div class="model-metrics-title">Live XGBoost model, fair test (${escapeHtml(sourceSaved)})</div>
              ${renderMetricsRows(saved)}
            </div>`
                  : ""
          }
          ${
              engineered
                  ? `<div class="model-metrics-block">
              <div class="model-metrics-title">Baseline (${escapeHtml(sourceEng)})</div>
              ${renderMetricsRows(engineered)}
            </div>`
                  : ""
          }`
        : `
            <div class="model-metrics-empty">
              Metrics are unavailable right now. Click the refresh button on this card to reload.
            </div>
            ${modelMetricsError ? `<div class="model-metrics-error">${escapeHtml(modelMetricsError)}</div>` : ""}
          `;

    return renderMetricsCollapsible({
        title: "Model Metrics",
        subtitle: "Click to expand",
        content,
    });
}

function renderRecommendationMetricsCollapsible() {
    const summary = modelMetricsCache?.recommendation?.summary;
    const details = modelMetricsCache?.recommendation?.details;
    const source =
        modelMetricsCache?.recommendation?.source_files?.evaluation_results ||
        "recommender/results/evaluation_results.csv";
    const hasMetrics = Boolean(summary || details);
    const summaryAllZero = Boolean(
        summary &&
            Number(summary.ndcg_at_3 || 0) === 0 &&
            Number(summary.ndcg_at_5 || 0) === 0 &&
            Number(summary.hit_rate_at_3 || 0) === 0 &&
            Number(summary.hit_rate_at_5 || 0) === 0,
    );
    if (!hasMetrics) {
        debugModelMetrics(
            "renderRecommendationMetricsCollapsible:unavailable",
            {
                hasCache: Boolean(modelMetricsCache),
                hasRecommendation: Boolean(modelMetricsCache?.recommendation),
                hasSummary: Boolean(summary),
                hasDetails: Boolean(details),
                detailRowCount: details?.rows?.length || 0,
                error: modelMetricsError || null,
                sourceFiles:
                    modelMetricsCache?.recommendation?.source_files || null,
            },
        );
    }
    const content = summary
        ? `
            <div class="model-metrics-actions">
              <button
                class="model-metrics-recompute-btn"
                onclick="recomputeRecommendationEvaluation()"
                ${modelMetricsRecomputeInFlight ? "disabled" : ""}
              >
                ${
                    modelMetricsRecomputeInFlight
                        ? "Recomputing Evaluation..."
                        : "Recompute Evaluation"
                }
              </button>
            </div>
            ${
                summaryAllZero
                    ? `<div class="model-metrics-warning">All recommendation evaluation metrics are currently zero in the source file. This usually means the evaluated model produced no hits on the evaluation set.</div>`
                    : ""
            }
            <div class="model-metrics-block">
              <div class="model-metrics-title">Evaluation Summary (${escapeHtml(source)})</div>
              ${renderMetricsRows(summary)}
            </div>
            ${
                Array.isArray(details?.columns)
                    ? `
            <div class="model-metrics-block">
              <div class="model-metrics-title">Raw Fields (${details.columns.length})</div>
              <div class="model-metrics-fields">${details.columns
                  .map(
                      (col) =>
                          `<span class="model-metrics-field">${escapeHtml(col)}</span>`,
                  )
                  .join("")}</div>
            </div>`
                    : ""
            }
            ${renderRecommendationRowsTable(details)}
          `
        : `
            <div class="model-metrics-actions">
              <button
                class="model-metrics-recompute-btn"
                onclick="recomputeRecommendationEvaluation()"
                ${modelMetricsRecomputeInFlight ? "disabled" : ""}
              >
                ${
                    modelMetricsRecomputeInFlight
                        ? "Recomputing Evaluation..."
                        : "Recompute Evaluation"
                }
              </button>
            </div>
            <div class="model-metrics-empty">
              Metrics are unavailable right now. Click the refresh button on this card to reload.
            </div>
            ${modelMetricsError ? `<div class="model-metrics-error">${escapeHtml(modelMetricsError)}</div>` : ""}
          `;

    return renderMetricsCollapsible({
        title: "Model Metrics",
        subtitle: hasMetrics
            ? "Click to expand full evaluation fields"
            : "Unavailable",
        content,
    });
}

// ── Insight panels: shared shell, loading and error states ───────────────────

const CDX_PANEL_META = {
    predict: {
        title: "Renewal prediction",
        sub: "How likely this customer is to book again.",
        refresh: "refreshRenewalPanel()",
        steps: ["Preparing renewal model", "Reading booking history", "Calculating renewal score", "Almost ready"],
    },
    recommendation: {
        title: "Recommended packages",
        sub: "The best packages to offer this customer next.",
        refresh: "refreshRecommendationPanel()",
        steps: ["Reading customer profile", "Finding similar customers", "Ranking packages", "Almost ready"],
    },
};

const CDX_REFRESH_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';

function cdxPanel(kind, inner, { showRefresh = true } = {}) {
    const m = CDX_PANEL_META[kind];
    return `
      <div class="cdx-panel" data-kind="${kind}">
        <div class="cdx-panel-head">
          <div>
            <div class="cdx-panel-title">${m.title}</div>
            <div class="cdx-panel-sub">${m.sub}</div>
          </div>
          ${showRefresh
              ? `<button type="button" class="cdx-btn cdx-btn--ghost cdx-btn--sm" onclick="${m.refresh}" aria-label="Run again">
                   ${CDX_REFRESH_ICON}<span>Run again</span>
                 </button>`
              : ""}
        </div>
        ${inner}
      </div>`;
}

function cdxLoadingPanel(kind) {
    const m = CDX_PANEL_META[kind];
    const steps = m.steps
        .map((s, i) => `<li class="cdx-step" data-step="${i}"><span class="cdx-step-dot"></span>${s}</li>`)
        .join("");
    const skeletonCards =
        kind === "recommendation"
            ? `<div class="cdx-rec-grid" aria-hidden="true">${[0, 1, 2]
                  .map(
                      () => `<div class="cdx-rec cdx-rec--skel">
                        <span class="hg-skel" style="width:40%;height:.9rem"></span>
                        <span class="hg-skel" style="width:75%;height:1.3rem;margin-top:.8rem"></span>
                        <span class="hg-skel" style="width:100%;height:.5rem;margin-top:1.2rem"></span>
                        <span class="hg-skel" style="width:90%;margin-top:1.2rem"></span>
                        <span class="hg-skel" style="width:70%;margin-top:.5rem"></span>
                        <span class="hg-skel" style="width:50%;height:1.6rem;margin-top:1.4rem"></span>
                      </div>`,
                  )
                  .join("")}</div>`
            : `<div class="cdx-renewal-top" aria-hidden="true">
                 <div class="cdx-ring-skel hg-skel"></div>
                 <div style="flex:1;display:flex;flex-direction:column;gap:.7rem">
                   <span class="hg-skel" style="width:35%;height:1.4rem"></span>
                   <span class="hg-skel" style="width:70%"></span>
                   <span class="hg-skel" style="width:100%;height:.6rem;margin-top:.6rem"></span>
                 </div>
               </div>`;
    return cdxPanel(
        kind,
        `<div class="cdx-loading" role="status" aria-live="polite">
           <div class="cdx-loading-row">
             <div class="cdx-spinner" aria-hidden="true"></div>
             <div class="cdx-loading-text">
               <div class="cdx-loading-title">
                 <span class="loading-progress-status">${m.steps[0]}…</span>
                 <span class="loading-progress-value">0%</span>
               </div>
               <div class="cdx-meter loading-progress-bar"><div class="cdx-meter-fill loading-progress-bar-fill" style="width:0%"></div></div>
             </div>
           </div>
           <ol class="cdx-steps">${steps}</ol>
         </div>
         ${skeletonCards}`,
        { showRefresh: false },
    );
}

function cdxErrorPanel(kind) {
    const what = kind === "predict" ? "the renewal prediction" : "recommendations";
    return cdxPanel(
        kind,
        `<div class="hg-empty">
           <div class="hg-empty-icon" style="background:var(--hg-danger-bg);color:var(--hg-danger-fg)" aria-hidden="true">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
           </div>
           <div class="hg-empty-title">Couldn't load ${what}</div>
           <div class="hg-empty-text">Check that the server is running and your internet connection is working, then try again.</div>
           <button type="button" class="cdx-btn cdx-btn--primary hg-empty-action" onclick="renderPanels()">Try again</button>
         </div>`,
        { showRefresh: false },
    );
}

/** Moves the step checklist forward to match the progress percentage. */
function cdxSyncSteps(p) {
    const items = document.querySelectorAll(".cdx-steps .cdx-step");
    if (!items.length) return;
    // Same thresholds as the status text in updateLoadingProgress/updatePredictionProgress
    const activeIdx = Math.min(items.length - 1, p < 30 ? 0 : p < 60 ? 1 : p < 90 ? 2 : 3);
    items.forEach((el, i) => {
        el.classList.toggle("is-done", i < activeIdx || p >= 100);
        el.classList.toggle("is-active", i === activeIdx && p < 100);
    });
}

// ── Renewal result ────────────────────────────────────────────────────────────

function getRenewalBadgeClass(band) {
    if (band === "likely") return "ai-badge";
    if (band === "unlikely") return "popular-badge";
    return "trending-badge";
}

function renderRenewalPanel(data) {
    const {
        total_bookings,
        booking_frequency,
        preferred_package_type,
        renewal_probability,
        status_text,
        key_factors,
        avg_booking_value,
        total_spent,
        renewal_band,
        generated_at,
    } = data || {};

    const available = renewal_probability != null;
    const pct = available ? Math.max(0, Math.min(100, Math.round(renewal_probability * 100))) : 0;
    const tone = !available ? "neutral" : renewal_band === "likely" ? "success" : "warning";
    const verdict = !available
        ? "Prediction unavailable"
        : renewal_band === "likely"
          ? "Likely to book again"
          : "At risk of not returning";
    const nextStep = !available
        ? "The renewal model isn't available right now. Try again later, or check the model status below."
        : renewal_band === "likely"
          ? "A good time to suggest an upgrade or add-ons for their next visit."
          : "Reach out with a personal follow-up or a coupon to win them back.";

    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const dash = (pct / 100) * circumference;

    const frequencyValue = Number(booking_frequency || 0);
    const frequencyLabel = Number.isFinite(frequencyValue) ? `${frequencyValue.toFixed(2)} / year` : "0.00 / year";
    const preferredPackage =
        preferred_package_type && String(preferred_package_type).trim() && preferred_package_type !== "N/A"
            ? String(preferred_package_type)
            : "—";

    const tile = (label, value) => `
      <div class="cdx-mini">
        <div class="cdx-mini-label">${label}</div>
        <div class="cdx-mini-value">${value}</div>
      </div>`;

    const factors = (key_factors || []).length ? key_factors : ["Not enough booking data yet"];

    return cdxPanel(
        "predict",
        `<div class="cdx-renewal-top cdx-fade-in">
           <div class="cdx-ring cdx-ring--${tone}" role="img" aria-label="Renewal score ${available ? pct + "%" : "unavailable"}">
             <svg viewBox="0 0 128 128" aria-hidden="true">
               <circle class="cdx-ring-track" cx="64" cy="64" r="${radius}" fill="none" stroke-width="12"></circle>
               <circle class="cdx-ring-fill" cx="64" cy="64" r="${radius}" fill="none" stroke-width="12"
                 stroke-linecap="round" transform="rotate(-90 64 64)"
                 stroke-dasharray="${dash} ${circumference - dash}"></circle>
             </svg>
             <div class="cdx-ring-center">
               <div class="cdx-ring-pct">${available ? `${pct}%` : "—"}</div>
               <div class="cdx-ring-label">renewal score</div>
             </div>
           </div>
           <div class="cdx-renewal-summary">
             <span class="hg-badge hg-badge--${tone} cdx-verdict">${verdict}</span>
             <p class="cdx-renewal-status">${escapeHtml(status_text || "")}</p>
             <div class="cdx-scale" aria-hidden="true">
               <div class="cdx-scale-track"><div class="cdx-scale-fill cdx-scale-fill--${tone}" style="width:${pct}%"></div></div>
               <div class="cdx-scale-labels"><span>Unlikely</span><span>Likely</span></div>
             </div>
             <div class="cdx-next-step">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>
               <div>
                 <div class="cdx-next-title">Suggested next step</div>
                 <div class="cdx-next-text">${nextStep}</div>
               </div>
               <button type="button" class="cdx-btn cdx-btn--ghost cdx-btn--sm" onclick="toggleRecommendationView()">See packages to offer</button>
             </div>
           </div>
         </div>

         <div class="cdx-mini-grid">
           ${tile("Total bookings", Number(total_bookings || 0).toLocaleString("en-PH"))}
           ${tile("Booking frequency", frequencyLabel)}
           ${tile("Preferred package type", escapeHtml(preferredPackage))}
           ${tile("Average booking value", cdxPeso(avg_booking_value || 0))}
           ${tile("Total spent", cdxPeso(total_spent || 0))}
         </div>

         <div class="cdx-factors">
           <div class="cdx-factors-title">What the prediction is based on</div>
           <ul>${factors.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
           <div class="cdx-generated">Generated ${generated_at ? escapeHtml(new Date(generated_at).toLocaleString()) : "—"}</div>
         </div>

         <div id="renewalMetricsContainer" class="cdx-metrics">
           ${renderRenewalMetricsCollapsible()}
         </div>`,
    );
}

async function renderPanels() {
    const container = document.getElementById("panelsContainer");
    debugModelMetrics("renderPanels:start", {
        activeView: detailsState.activeView,
        hasCache: Boolean(modelMetricsCache),
        loadAttempted: modelMetricsLoadAttempted,
        modelMetricsError: modelMetricsError || null,
    });
    ensureModelMetricsLoaded();

    if (detailsState.activeView === "predict") {
        const needsLoad = !renewalCache || renewalCache.customer_id !== detailsState.customer.id;
        if (needsLoad) {
            predictionProgress = 0;
            container.innerHTML = cdxLoadingPanel("predict");
            cdxSyncSteps(0);
            const data = await loadRenewalPrediction(detailsState.customer.id);
            if (detailsState.activeView !== "predict") return; // user switched tabs meanwhile
            if (!data) {
                container.innerHTML = cdxErrorPanel("predict");
                return;
            }
        }
        container.innerHTML = renderRenewalPanel(renewalCache);
        return;
    }

    if (detailsState.activeView === "recommendation") {
        const needsLoad =
            !recommendationCache || recommendationCache.customer_id !== detailsState.customer.id;
        if (needsLoad) {
            loadingProgress = 0;
            container.innerHTML = cdxLoadingPanel("recommendation");
            cdxSyncSteps(0);
            const data = await loadRecommendations(detailsState.customer.id);
            if (detailsState.activeView !== "recommendation") return;
            if (!data) {
                container.innerHTML = cdxErrorPanel("recommendation");
                return;
            }
        }
        container.innerHTML = renderRecommendationPanel(recommendationCache);
    }
}

function getSourceBadge(source) {
    const map = {
        customer_booking_history:
            '<span class="source-badge ai-badge">Booking Loyalty</span>',
        loader: '<span class="source-badge ai-badge">AI Recommended</span>',
        collaborative_filtering:
            '<span class="source-badge ai-badge">AI Recommended</span>',
        popular_package_monthly:
            '<span class="source-badge trending-badge">Trending</span>',
        popular_package_overall:
            '<span class="source-badge popular-badge">Popular</span>',
        popular_fallback:
            '<span class="source-badge popular-badge">Popular Choice</span>',
    };
    return map[source] ?? '<span class="source-badge">Recommended</span>';
}

function closeCustomerAddToPackageModal() {
    const m = document.getElementById("custAddToPackageModal");
    if (m) m.remove();
}

function openCustomerAddToPackageModal(index) {
    const rec = (window.__custRecsCache || [])[index];
    if (!rec || !window.PackageFlowStorage) {
        window.heigenAlert("Package flow storage is not available.");
        return;
    }
    const pkg = rec.package || {};
    const existing = window.PackageFlowStorage.listCategories();
    closeCustomerAddToPackageModal();
    const overlay = document.createElement("div");
    overlay.id = "custAddToPackageModal";
    overlay.className = "fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4";
    const esc = (s) =>
        String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/"/g, "&quot;");
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" role="dialog">
        <h3 class="text-[#165166] font-bold text-lg mb-2">Add to Package</h3>
        <p class="text-sm text-gray-600 mb-4">Select an existing category or create a new one.</p>
        <label class="text-xs font-bold text-[#5F6E79] block mb-1">Category</label>
        <select id="custAddPkgCatSelect" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2">
          ${existing.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
        </select>
        <input id="custAddPkgCatNew" type="text" placeholder="New category name"
          class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4" />
        <div class="flex justify-end gap-2">
          <button type="button" onclick="closeCustomerAddToPackageModal()"
            class="rounded-full border border-[#165166] text-[#165166] text-xs font-bold px-5 py-2">Cancel</button>
          <button type="button" id="custAddPkgConfirmBtn"
            class="rounded-full bg-[#165166] text-white text-xs font-bold px-5 py-2">Add</button>
        </div>
      </div>`;
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeCustomerAddToPackageModal();
    });
    document.body.appendChild(overlay);
    window.HeigenModal?.open(overlay);
    document.getElementById("custAddPkgConfirmBtn").onclick = () => {
        const sel = document.getElementById("custAddPkgCatSelect");
        const neu = document.getElementById("custAddPkgCatNew");
        let cat = (neu.value || "").trim();
        if (!cat) cat = (sel.value || "").trim();
        if (!cat) {
            window.heigenAlert("Select or enter a category.");
            return;
        }
        window.PackageFlowStorage.add(cat, {
            packageId: pkg.id,
            packageName: pkg.name,
            category: pkg.category || rec.category || "",
            basePrice: rec.base_price ?? rec.price,
            totalPrice: rec.total_price,
            source: rec.source || "",
        });
        closeCustomerAddToPackageModal();
        window.heigenAlert(`Saved under “${cat}”.`);
    };
}

function cdxRecSignal(rec) {
    const factors = Array.isArray(rec.explanation_factors) ? rec.explanation_factors : [];
    const match = factors.find((f) => f && f.type === "predicted_match");
    if (match && Number.isFinite(Number(match.value))) {
        const pct = Math.max(0, Math.min(100, Math.round(Number(match.value) * 100)));
        return {
            label: "Match score",
            value: `${pct}%`,
            pct,
            hint: "How closely this fits customers with similar bookings",
        };
    }
    if (rec.source === "customer_booking_history") {
        return { label: "Signal", value: "Booked before", pct: null, hint: "This customer has chosen this package in the past" };
    }
    if (/popular/.test(String(rec.source || ""))) {
        return { label: "Signal", value: "Popular with customers", pct: null, hint: "One of the most-booked packages" };
    }
    return { label: "Signal", value: "Suggested", pct: null, hint: "" };
}

function cdxSourceTone(source) {
    if (source === "svdpp" || source === "collaborative_filtering" || source === "loader") return "info";
    if (source === "customer_booking_history") return "success";
    if (/popular/.test(String(source || ""))) return "warning";
    return "neutral";
}

function cdxList(title, items) {
    if (!items?.length) return "";
    return `<div class="cdx-incl-group">
      <div class="cdx-incl-title">${title}</div>
      <ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
    </div>`;
}

/** Book from a recommendation card (looked up by index so names with quotes are safe). */
function cdxBookRecommendation(index) {
    const rec = (window.__custRecsCache || [])[index];
    if (!rec) return;
    const pkg = rec.package || {};
    return handleBookPackage(
        pkg.id,
        pkg.name ?? "",
        Number(rec.total_price ?? 0),
        (rec.addons ?? []).map((a) => a.id),
        Number(rec.base_price ?? pkg.promo_price ?? pkg.price ?? 0),
    );
}

function renderRecommendationPanel(data) {
    const { recommendations, key_factors, target_date, total_bookings } = data;

    window.__custRecsCache = recommendations ?? [];
    const rankLabels = ["Best match", "Second pick", "Third pick"];

    const cardsHTML = window.__custRecsCache
        .map((rec, recIndex) => {
            const { package: pkg = {}, addons, total_price, base_price, source } = rec;
            const signal = cdxRecSignal(rec);
            const sourceLabel = rec.source_label || "Suggested";

            const numericTotalPrice = Number(total_price ?? 0);
            const onPromo = pkg.promo_price && Number(pkg.promo_price) < Number(pkg.price);

            const addonsHTML = addons?.length
                ? `<div class="cdx-rec-addons">
                     <div class="cdx-incl-title">Suggested add-ons</div>
                     <div class="cdx-addon-chips">
                       ${addons
                           .map(
                               (a) => `<span class="cdx-addon" title="${escapeHtml(a.additional_info || "")}">
                                 ${escapeHtml(a.name)} <b>+${cdxPeso(Number(a.price || 0))}</b>
                               </span>`,
                           )
                           .join("")}
                     </div>
                   </div>`
                : "";

            const inclusionGroups =
                cdxList("Inclusions", pkg.inclusions) +
                cdxList("Included portraits", pkg.included_portraits) +
                cdxList("Freebies", pkg.freebies);

            return `
          <article class="cdx-rec ${recIndex === 0 ? "cdx-rec--top" : ""}" data-package-id="${pkg.id}">
            <div class="cdx-rec-top">
              <span class="cdx-rank">#${recIndex + 1} · ${rankLabels[recIndex] || "Pick"}</span>
              <span class="hg-badge hg-badge--${cdxSourceTone(source)}">${escapeHtml(sourceLabel)}</span>
            </div>
            <h4 class="cdx-rec-name">${escapeHtml(pkg.name || "Package")}</h4>
            <div class="cdx-rec-cat">
              ${escapeHtml(pkg.category || "")}
              ${pkg.max_people ? ` · Up to ${escapeHtml(pkg.max_people)} people` : ""}
            </div>

            <div class="cdx-signal" title="${escapeHtml(signal.hint)}">
              <div class="cdx-signal-row">
                <span>${signal.label}</span>
                <b>${escapeHtml(signal.value)}</b>
              </div>
              ${signal.pct != null
                  ? `<div class="cdx-meter cdx-meter--thin"><div class="cdx-meter-fill" style="width:${signal.pct}%"></div></div>`
                  : ""}
            </div>

            ${rec.explanation
                ? `<div class="cdx-why">
                     <div class="cdx-incl-title">Why this package</div>
                     <p>${escapeHtml(rec.explanation)}</p>
                     ${rec.explanation_detail && rec.explanation_detail !== rec.explanation
                         ? `<details><summary>More detail</summary><p>${escapeHtml(rec.explanation_detail)}</p></details>`
                         : ""}
                   </div>`
                : ""}

            ${addonsHTML}

            ${inclusionGroups
                ? `<details class="cdx-incl"><summary>What's included</summary>${inclusionGroups}
                     ${pkg.notes ? `<p class="cdx-incl-note">${escapeHtml(pkg.notes)}</p>` : ""}
                   </details>`
                : ""}

            <div class="cdx-rec-foot">
              <div class="cdx-price">
                <div class="cdx-price-row"><span>Package</span><span>${onPromo ? `<s>${cdxPeso(Number(pkg.price))}</s> ` : ""}${cdxPeso(Number(base_price || 0))}</span></div>
                ${addons?.length ? `<div class="cdx-price-row"><span>Add-ons</span><span>+${cdxPeso(Math.max(0, numericTotalPrice - Number(base_price || 0)))}</span></div>` : ""}
                <div class="cdx-price-total"><span>Total</span><span>${cdxPeso(numericTotalPrice)}</span></div>
                ${pkg.promo_price_condition ? `<div class="cdx-promo-note">${onPromo ? '<span class="hg-badge hg-badge--warning">Promo</span> ' : ""}${escapeHtml(pkg.promo_price_condition)}</div>` : onPromo ? '<div class="cdx-promo-note"><span class="hg-badge hg-badge--warning">Promo price</span></div>' : ""}
              </div>
              <div class="cdx-rec-actions">
                <button type="button" class="cdx-btn cdx-btn--primary"
                        onclick="cdxBookRecommendation(${recIndex})">
                  Book this package
                </button>
                <button type="button" class="cdx-btn cdx-btn--ghost" onclick="openCustomerAddToPackageModal(${recIndex})">
                  Save to a list
                </button>
              </div>
            </div>
          </article>`;
        })
        .join("");

    const factors = (key_factors ?? []).length ? key_factors : ["General popularity"];
    const emptyHTML = `<div class="hg-empty">
        <div class="hg-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1"/></svg></div>
        <div class="hg-empty-title">No recommendations available</div>
        <div class="hg-empty-text">There are no active packages to suggest right now. Add or un-archive packages in the Package List.</div>
      </div>`;

    return cdxPanel(
        "recommendation",
        `<div class="cdx-rec-intro cdx-fade-in">
           <span class="cdx-chip">${total_bookings > 0 ? `${total_bookings} previous booking${total_bookings > 1 ? "s" : ""}` : "First-time customer"}</span>
           <span class="cdx-rec-intro-text">${total_bookings > 0
               ? "Personalised from this customer's booking history and customers with similar choices."
               : "No history yet, so these are the packages first-time customers book most."}</span>
         </div>
         ${cardsHTML ? `<div class="cdx-rec-grid cdx-fade-in">${cardsHTML}</div>` : emptyHTML}
         <div class="cdx-factors">
           <div class="cdx-factors-title">What the recommendations are based on</div>
           <ul>${factors.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
           <div class="cdx-generated">For ${escapeHtml(target_date || "—")}</div>
         </div>
         <div id="recommendationMetricsContainer" class="cdx-metrics">
           ${renderRecommendationMetricsCollapsible()}
         </div>`,
    );
}

// ── handleBookPackage — the missing function ───────────────────────────────────

async function handleBookPackage(
    packageId,
    packageName,
    totalPrice,
    addonIds,
    recommendedBasePrice,
) {
    const numericTotalPrice = Number(totalPrice);
    const ok = await window.heigenConfirm(
        `Book "${packageName}" for ${formatPrice(Number.isFinite(numericTotalPrice) ? numericTotalPrice : 0)}?\n\n` +
            `This will create a new booking for the customer.`,
        {
            title: "Create booking",
            confirmText: "Book",
            dangerous: false,
        },
    );
    if (!ok) return;

    const packageIdNum = Number(packageId);
    const pkg = detailsState.packages.find((p) => Number(p.id) === packageIdNum);
    if (!pkg) {
        window.heigenAlert("Package data not available. Use the Add button instead.");
        return;
    }

    const ids = (Array.isArray(addonIds) ? addonIds : []).map((id) => Number(id));
    const recommendedAddons = detailsState.addons
        .filter((a) => ids.includes(a.id))
        .map((a) => ({
            addonId: a.id,
            name: a.name,
            price: Number(a.price ?? 0),
            quantity: 1,
        }));

    const addonsTotal = recommendedAddons.reduce(
        (s, a) => s + Number(a.price || 0) * Number(a.quantity || 1),
        0,
    );
    let basePrice = Number(recommendedBasePrice);
    if (!Number.isFinite(basePrice) || basePrice < 0) {
        basePrice = Number(pkg.promo_price ?? pkg.price ?? 0);
    }
    if (!Number.isFinite(basePrice) || basePrice < 0) basePrice = 0;
    const computedTotal = basePrice + addonsTotal;
    const safeTotal =
        Number.isFinite(numericTotalPrice) && numericTotalPrice > 0
            ? numericTotalPrice
            : computedTotal;

    detailsState.currentBooking = {
        type: "Walk-In",
        packageName: pkg.name,
        packagePrice: basePrice,
        addons: recommendedAddons,
        discount: 0,
        subtotal: computedTotal,
        total: safeTotal,
    };
    detailsState.isEditingBooking = false;
    renderBookingSummaryModal();
}

// ── Toggle handlers ───────────────────────────────────────────────────────────

function toggleBookingHistory() {
    detailsState.isHistoryExpanded = !detailsState.isHistoryExpanded;
    renderBookingHistory();
}

function togglePredictView() {
    detailsState.activeView =
        detailsState.activeView === "predict" ? null : "predict";
    renderViewButtons();
    renderPanels();
}

async function toggleRecommendationView() {
    detailsState.activeView =
        detailsState.activeView === "recommendation" ? null : "recommendation";
    renderViewButtons();
    await renderPanels();
}

async function refreshRenewalPanel() {
    renewalCache = null;
    resetModelMetrics();
    detailsState.activeView = "predict";
    renderViewButtons();
    await renderPanels();
}

async function refreshRecommendationPanel() {
    recommendationCache = null;
    resetModelMetrics();
    detailsState.activeView = "recommendation";
    renderViewButtons();
    await renderPanels();
}

async function recomputeRecommendationEvaluation() {
    if (modelMetricsRecomputeInFlight) return;
    modelMetricsRecomputeInFlight = true;
    updateVisibleMetricsInPlace();
    debugModelMetrics("recomputeRecommendationEvaluation:start");
    try {
        const result =
            await window.apiClient.analytics.recomputeRecommendationMetrics();
        debugModelMetrics("recomputeRecommendationEvaluation:success", result);
        if (result && result.changed === false) {
            console.warn(
                "[ModelMetrics] Recompute completed but evaluation_results.csv content is unchanged.",
                result,
            );
        }
        resetModelMetrics();
        await loadModelMetrics();
        updateVisibleMetricsInPlace();
    } catch (err) {
        console.error("recomputeRecommendationEvaluation:", err);
        modelMetricsError = String(err?.message || err || "Unknown error");
        debugModelMetrics("recomputeRecommendationEvaluation:error", {
            error: modelMetricsError,
        });
        updateVisibleMetricsInPlace();
    } finally {
        modelMetricsRecomputeInFlight = false;
        updateVisibleMetricsInPlace();
        debugModelMetrics("recomputeRecommendationEvaluation:finally");
    }
}

// ── Booking CRUD ──────────────────────────────────────────────────────────────

function handleAddBooking() {
    detailsState.currentBooking = { addons: [] };
    detailsState.isEditingBooking = false;
    renderPackageInfoModal();
}

function handleEditBooking(bookingId) {
    const b = detailsState.customer.bookings.find((x) => x.id === bookingId);
    if (!b) return;
    detailsState.currentBooking = structuredClone(b);
    detailsState.selectedBooking = b;
    detailsState.isEditingBooking = true;
    renderPackageInfoModal();
}

function handleViewInvoice(bookingId) {
    const b = (detailsState.customer.bookings ?? []).find(
        (x) => x.id === bookingId,
    );
    if (!b) {
        console.error("Booking not found:", bookingId);
        return;
    }
    detailsState.selectedBooking = b;
    renderInvoiceModal();
}

async function handleDeleteBooking(bookingId) {
    const b = detailsState.customer.bookings.find((x) => x.id === bookingId);
    if (!b) return;
    const ok = await window.heigenConfirm(
        `Delete the booking from ${b.date}?\n\nThis cannot be undone.`,
        {
            title: "Delete booking",
            confirmText: "Delete",
            dangerous: true,
        },
    );
    if (!ok) return;

    try {
        await window.apiClient.bookings.remove(
            detailsState.customerId,
            bookingId,
        );
    } catch (err) {
        // A 404 here means it was already deleted — treat as success
        if (!err.message.includes("404")) {
            window.heigenAlert("Failed to delete booking: " + err.message);
            return;
        }
    }

    detailsState.customer.bookings = (
        detailsState.customer.bookings ?? []
    ).filter((x) => x.id !== bookingId);

    renderCustomerDetails();
}

function normalizeAddonFilterToken(value) {
    return String(value ?? "").trim().toLowerCase();
}

function addonAppliesToPackage(addon, pkg) {
    if (!addon || !pkg) return false;
    const appliesTo = addon.applies_to;
    if (appliesTo == null || appliesTo === "") return true;

    const pkgCategory = normalizeAddonFilterToken(pkg.category);
    const pkgName = normalizeAddonFilterToken(pkg.name);
    const matches = (raw) => {
        const token = normalizeAddonFilterToken(raw);
        if (!token) return false;
        if (token === pkgCategory || token === pkgName) return true;
        return (
            (pkgCategory && token.includes(pkgCategory)) ||
            (pkgName && token.includes(pkgName))
        );
    };

    if (Array.isArray(appliesTo)) {
        return appliesTo.some(matches);
    }
    if (typeof appliesTo === "string") {
        const raw = appliesTo.trim();
        if (!raw) return true;
        return raw.split(/[|,/]/).some(matches) || matches(raw);
    }
    return false;
}

function getAvailableAddonsForBooking(booking) {
    const packageName = booking?.packageName;
    if (!packageName) return [];
    const pkg = detailsState.packages.find((p) => p.name === packageName);
    if (!pkg) return [];
    return detailsState.addons.filter((addon) =>
        addonAppliesToPackage(addon, pkg),
    );
}

function pruneCurrentBookingUnavailableAddons() {
    const booking = detailsState.currentBooking || {};
    const availableAddonIds = new Set(
        getAvailableAddonsForBooking(booking).map((a) => Number(a.id)),
    );
    booking.addons = (booking.addons || []).filter((a) => {
        const id = Number(a?.addonId ?? a?.id);
        // Keep empty rows so users can add/select an addon after pressing "+".
        if (!Number.isFinite(id)) return true;
        return availableAddonIds.has(id);
    });
    detailsState.currentBooking = booking;
}

// ── Package info modal ────────────────────────────────────────────────────────

function renderPackageInfoModal() {
    const booking = detailsState.currentBooking || {};
    pruneCurrentBookingUnavailableAddons();
    const packages = detailsState.packages;
    const addons = getAvailableAddonsForBooking(booking);

    const pkgOptions = packages
        .map(
            (p) =>
                `<option value="${escapeHtml(p.name)}"
                 ${booking.packageName === p.name ? "selected" : ""}>
           ${escapeHtml(p.name)} – ₱${p.price}
         </option>`,
        )
        .join("");

    const addonsRows = (booking.addons || [])
        .map(
            (addon, idx) => `
      <div class="addon-item">
        <select class="addon-select"
                onchange="handleAddonChange(${idx}, this.value)">
          <option value="">Select Addons</option>
          ${addons
              .map(
                  (a) =>
                      `<option value="${a.id}"
                       ${
                           addon.addonId === a.id || addon.name === a.name
                               ? "selected"
                               : ""
                       }>
                 ${a.name} – ₱${a.price}
               </option>`,
              )
              .join("")}
        </select>
        <div class="quantity-input" id="quantity-${idx}">
          ${addon.quantity ?? 1}
        </div>
        <div class="quantity-buttons">
          <button type="button" class="quantity-button"
                  onclick="handleAddonQuantity(${idx}, 1)">+</button>
          <button type="button" class="quantity-button"
                  onclick="handleAddonQuantity(${idx}, -1)">−</button>
        </div>
        <button type="button" class="addon-remove"
                onclick="handleRemoveAddon(${idx})">🗑</button>
      </div>`,
        )
        .join("");

    document.getElementById("modalsContainer").innerHTML = `
      <div class="modal-overlay" id="packageModal"
           onclick="if(event.target.id==='packageModal') closePackageModal()">
        <div class="modal-content">
          <h2 class="modal-title">Package Info</h2>
          <form class="modal-form" onsubmit="handlePackageInfoNext(event)">
            <div class="form-group">
              <label class="form-label">Booking Type</label>
              <select class="form-select" id="bookingType">
                <option value="Walk-In"
                  ${(booking.type ?? "Walk-In") === "Walk-In" ? "selected" : ""}>
                  Walk-In</option>
                <option value="Reserved"
                  ${booking.type === "Reserved" ? "selected" : ""}>
                  Reserved</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Package Name</label>
              <select class="form-select" id="packageName"
                      onchange="handlePackageSelect(this.value)" required>
                <option value="">Select Package</option>
                ${pkgOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Addons</label>
              <div id="addonsList">${addonsRows}</div>
              <button type="button" class="addon-add"
                      onclick="handleAddAddon()">+</button>
            </div>
            <div class="form-group">
              <label class="form-label">Discount</label>
              <input type="number" id="discount" min="0" step="1"
                     value="${booking.discount ?? 0}" class="form-input">
            </div>
            <div class="modal-actions">
              <button type="button" class="btn-back"
                      onclick="closePackageModal()">Back</button>
              <button type="submit" class="btn-next">Next</button>
            </div>
          </form>
        </div>
      </div>`;
}

function handlePackageSelect(value) {
    const pkg = detailsState.packages.find((p) => p.name === value);
    detailsState.currentBooking = detailsState.currentBooking || {};
    if (!pkg) {
        detailsState.currentBooking.packageName = "";
        detailsState.currentBooking.packagePrice = 0;
        detailsState.currentBooking.addons = [];
        renderPackageInfoModal();
        return;
    }
    detailsState.currentBooking.packageName = value;
    detailsState.currentBooking.packagePrice =
        pkg.promo_price ?? pkg.price ?? 0;
    pruneCurrentBookingUnavailableAddons();
    renderPackageInfoModal();
}

function handleAddonChange(index, value) {
    const availableAddons = getAvailableAddonsForBooking(
        detailsState.currentBooking || {},
    );
    const found = availableAddons.find((a) => a.id === parseInt(value, 10));
    if (!found) return;
    const qty = detailsState.currentBooking.addons[index]?.quantity ?? 1;
    detailsState.currentBooking.addons[index] = {
        addonId: found.id,
        name: found.name,
        price: found.price ?? 0,
        quantity: qty,
    };
}

function handleAddonQuantity(index, delta) {
    const addon = detailsState.currentBooking.addons[index];
    if (!addon) return;
    addon.quantity = Math.max(1, (addon.quantity ?? 1) + delta);
    const el = document.getElementById(`quantity-${index}`);
    if (el) el.textContent = addon.quantity;
}

function handleRemoveAddon(index) {
    detailsState.currentBooking.addons.splice(index, 1);
    renderPackageInfoModal();
}

function handleAddAddon() {
    const booking = detailsState.currentBooking || {};
    if (!booking.packageName) {
        window.heigenAlert("Please select a package first.");
        return;
    }
    if (!getAvailableAddonsForBooking(booking).length) {
        window.heigenAlert("No add-ons available for the selected package.");
        return;
    }
    (detailsState.currentBooking.addons =
        detailsState.currentBooking.addons || []).push({
        name: "",
        quantity: 1,
        price: 0,
    });
    renderPackageInfoModal();
}

function handlePackageInfoNext(event) {
    event.preventDefault();
    const packageName = document.getElementById("packageName").value;
    if (!packageName) {
        window.heigenAlert("Please select a package");
        return;
    }

    const bookingType = document.getElementById("bookingType").value;
    const discount = parseFloat(document.getElementById("discount").value) || 0;

    // ── Always look up the price fresh — never trust currentBooking.packagePrice
    // which may be stale if the modal was re-rendered after addon changes
    const pkg = detailsState.packages.find((p) => p.name === packageName);
    console.log("Package: ", pkg);
    console.log("package.price: ", pkg.price);
    const packagePrice = pkg.price ? pkg.price : 0;

    const addonsTotal = (detailsState.currentBooking.addons || []).reduce(
        (s, a) => s + (a.price ?? 0) * (a.quantity ?? 1),
        0,
    );
    console.log("Package price: ", detailsState.currentBooking.packagePrice);

    const subtotal = packagePrice + addonsTotal;
    const total = subtotal - discount;

    detailsState.currentBooking = {
        ...detailsState.currentBooking,
        type: bookingType,
        packageName,
        packagePrice, // ← now always correct
        discount,
        subtotal,
        total,
    };
    document.getElementById("modalsContainer").replaceChildren();
    renderBookingSummaryModal();
}

function goBackToPackageInfo() {
    renderPackageInfoModal();
}

async function confirmBookingSummary() {
    const c = detailsState.customer;
    const cb = detailsState.currentBooking;

    // ── Translate frontend state → API field names ────────────────────────────
    // Find the package by name to get its id
    const pkg = detailsState.packages.find((p) => p.name === cb.packageName);
    if (!pkg) {
        window.heigenAlert("Package not found. Please go back and reselect the package.");
        return;
    }

    const apiPayload = {
        package_id: pkg.id,
        customer_id: detailsState.customerId,
        session_status: "BOOKED", // Staff-added bookings are confirmed immediately
        total_price: cb.total ?? 0,
        discounts: cb.discount ? String(cb.discount) : "",
        // addons_input: array of { addonId, quantity } for the serializer
        addons_input: (cb.addons ?? [])
            .filter((a) => a.addonId || a.id)
            .map((a) => ({
                addonId: a.addonId ?? a.id,
                quantity: a.quantity ?? 1,
            })),
    };

    const overlay = document.getElementById("pageLoadingOverlay");
    if (overlay) {
        overlay.style.display = "flex";
        overlay.querySelector(".loading-label").textContent = "Saving booking…";
    }
    try {
        let saved;
        if (detailsState.isEditingBooking && detailsState.selectedBooking) {
            saved = await window.apiClient.bookings.update(
                detailsState.customerId,
                detailsState.selectedBooking.id,
                apiPayload,
            );
            const idx = c.bookings.findIndex(
                (b) => b.id === detailsState.selectedBooking.id,
            );
            if (idx !== -1) {
                // Merge API response back — use returned data for display fields
                c.bookings[idx] = _mergeBookingDisplay(saved, cb, pkg);
            }
            sortBookingsLatestFirst(c.bookings);
        } else {
            saved = await window.apiClient.bookings.create(
                detailsState.customerId,
                apiPayload,
            );
            // Merge display fields onto the saved object for immediate rendering
            c.bookings.push(_mergeBookingDisplay(saved, cb, pkg));
            sortBookingsLatestFirst(c.bookings);
        }
    } catch (err) {
        console.error("confirmBookingSummary:", err);
        window.heigenAlert("Failed to save booking: " + err.message);
        return;
    }

    Object.assign(detailsState, {
        currentBooking: null,
        isEditingBooking: false,
        selectedBooking: null,
        isHistoryExpanded: true,
    });
    if (overlay) overlay.style.display = "none";
    document.getElementById("modalsContainer").replaceChildren();
    renderCustomerDetails();
}

/**
 * Merges the API response (which has correct id, customer_name, etc.)
 * with the frontend booking state (which has packageName, packagePrice,
 * addons with names) for immediate display before the next full reload.
 */
function _mergeBookingDisplay(apiResponse, localBooking, pkg) {
    return {
        ...apiResponse,
        // API response has these from BookingSerializer computed fields,
        // but ensure they're populated even if the API returned nulls
        packageName: apiResponse.packageName ?? localBooking.packageName,
        packagePrice: apiResponse.packagePrice ?? localBooking.packagePrice,
        total: apiResponse.total ?? localBooking.total ?? 0,
        subtotal: apiResponse.subtotal ?? localBooking.subtotal ?? 0,
        discount: apiResponse.discount ?? localBooking.discount ?? 0,
        type: apiResponse.type ?? localBooking.type ?? "Walk-In",
        date: apiResponse.date ?? _todayString(),
        // Preserve full addon objects (with names) from local state for display
        addons:
            (apiResponse.addons?.length ? apiResponse.addons : null) ??
            localBooking.addons ??
            [],
    };
}

function _todayString() {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function closePackageModal() {
    Object.assign(detailsState, {
        currentBooking: null,
        isEditingBooking: false,
    });
    document.getElementById("modalsContainer").replaceChildren();
}

// ── Summary modal ─────────────────────────────────────────────────────────────

function renderBookingSummaryModal() {
    const b = detailsState.currentBooking;
    if (!b) return;
    const addonsRows = (b.addons || [])
        .map(
            (a) =>
                `<div style="display:flex;justify-content:space-between;">
           <span style="color:#909090;font-size:14px;">
             ${escapeHtml(a.name)} x ${a.quantity}
           </span>
           <span style="color:#909090;font-size:14px;">
             ₱${((a.price ?? 0) * (a.quantity ?? 1)).toFixed(2)}
           </span>
         </div>`,
        )
        .join("");

    document.getElementById("modalsContainer").innerHTML = `
      <div class="modal-overlay" id="summaryModal"
           onclick="if(event.target.id==='summaryModal') closeBookingSummaryModal()">
        <div class="modal-content" style="justify-content:center;align-items:center;">
          <div style="display:flex;flex-direction:column;align-items:center;
                      gap:20px;width:100%;">
            <h2 class="modal-title">Summary</h2>
            <div style="width:310px;display:flex;flex-direction:column;gap:20px;">
              <div style="display:flex;flex-direction:column;gap:8px;">
                <span style="color:#ABB7C2;font-size:14px;">Package Name</span>
                <div style="display:flex;justify-content:space-between;">
                  <span style="color:#909090;font-size:14px;">
                    ${escapeHtml(b.packageName ?? "N/A")}
                  </span>
                  <span style="color:#909090;font-size:14px;">
                    ₱${(b.packagePrice ?? 0).toFixed(2)}
                  </span>
                </div>
              </div>
              ${
                  b.addons?.length
                      ? `<div style="display:flex;flex-direction:column;gap:12px;">
                       <span style="color:#616161;font-size:12px;">Addon</span>
                       ${addonsRows}
                     </div>`
                      : ""
              }
              <div style="height:1px;background:#A2A2A2;"></div>
              <div style="display:flex;flex-direction:column;gap:12px;">
                <div style="display:flex;justify-content:space-between;">
                  <span style="color:#616161;font-size:14px;">Subtotal:</span>
                  <span style="color:#616161;font-size:14px;">
                    ₱${(b.subtotal ?? 0).toFixed(2)}
                  </span>
                </div>
                <div style="display:flex;justify-content:space-between;">
                  <span style="color:#616161;font-size:14px;">Voucher Amount:</span>
                  <span style="color:#616161;font-size:14px;">
                    ₱${(b.discount ?? 0).toFixed(2)}
                  </span>
                </div>
                <div style="display:flex;justify-content:space-between;">
                  <span style="color:#616161;font-size:14px;font-weight:700;">
                    Total:
                  </span>
                  <span style="color:#616161;font-size:14px;font-weight:700;">
                    ₱${(b.total ?? 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:15px;">
              <button type="button" class="btn-back"
                      onclick="goBackToPackageInfo()">Back</button>
              <button type="button" class="btn-next"
                      onclick="confirmBookingSummary()">Confirm</button>
            </div>
          </div>
        </div>
      </div>`;
}

function closeBookingSummaryModal() {
    document.getElementById("modalsContainer").replaceChildren();
}

// ── Invoice modal ─────────────────────────────────────────────────────────────

function renderInvoiceModal() {
    const b = detailsState.selectedBooking;
    if (!b) return;
    const c = detailsState.customer;
    const addonsRows = (b.addons || [])
        .map(
            (a) =>
                `<div style="display:flex;justify-content:space-between;">
           <span style="color:#909090;font-size:14px;">
             ${escapeHtml(a.name)} x ${a.quantity}
           </span>
           <span style="color:#909090;font-size:14px;">
             ₱${((a.price ?? 0) * (a.quantity ?? 1)).toFixed(2)}
           </span>
         </div>`,
        )
        .join("");

    document.getElementById("modalsContainer").innerHTML = `
      <div class="modal-overlay" id="invoiceModal"
           onclick="if(event.target.id==='invoiceModal') closeInvoiceModal()">
        <div class="modal-content invoice-modal">
          <div style="display:flex;flex-direction:column;align-items:center;
                      gap:20px;width:100%;">
            <h2 class="modal-title">Invoice</h2>
            <div style="background:#ffffff;border-radius:10px;padding:8px 12px;margin-top:-8px;">
              <img src="${INVOICE_LOGO_URL}" alt="Heigen Studio Logo"
                   style="width:180px;height:auto;object-fit:contain;filter:${INVOICE_LOGO_FILTER};">
            </div>
            <div class="invoice-items">
              <div class="invoice-item">
                <div style="display:flex;flex-direction:column;gap:8px;">
                  <span style="color:#ABB7C2;font-size:12px;">Full Name</span>
                  <span style="color:#909090;font-size:14px;">
                    ${escapeHtml(b.customer_name ?? c.name ?? "N/A")}
                  </span>
                </div>
              </div>
              <div class="invoice-item">
                <div style="display:flex;flex-direction:column;gap:8px;">
                  <span style="color:#ABB7C2;font-size:12px;">Email</span>
                  <span style="color:#909090;font-size:14px;">
                    ${escapeHtml(c.email ?? "N/A")}
                  </span>
                </div>
              </div>
              <div class="invoice-item">
                <div style="display:flex;flex-direction:column;gap:8px;">
                  <span style="color:#ABB7C2;font-size:12px;">Type</span>
                  <span style="color:#909090;font-size:14px;">
                    ${escapeHtml(b.type ?? "Walk-In")}
                  </span>
                </div>
              </div>
              <div class="invoice-item">
                <div style="display:flex;flex-direction:column;gap:8px;">
                  <span style="color:#ABB7C2;font-size:12px;">Date</span>
                  <span style="color:#909090;font-size:14px;">
                    ${escapeHtml(b.date ?? "N/A")}
                  </span>
                </div>
              </div>
              <div class="invoice-item">
                <div style="display:flex;flex-direction:column;gap:8px;">
                  <span style="color:#ABB7C2;font-size:14px;">Package Name</span>
                  <div style="display:flex;justify-content:space-between;">
                    <span style="color:#909090;font-size:14px;">
                      ${escapeHtml(b.packageName ?? "N/A")}
                    </span>
                    <span style="color:#909090;font-size:14px;">
                      ₱${(b.packagePrice ?? 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
              ${
                  b.addons?.length
                      ? `<div class="invoice-item">
                       <div style="display:flex;flex-direction:column;gap:4px;">
                         <span style="color:#616161;font-size:12px;">Addon</span>
                         ${addonsRows}
                       </div>
                     </div>`
                      : ""
              }
            </div>
            <div class="invoice-divider"></div>
            <div class="summary-section">
              <div class="summary-row">
                <span class="summary-label">Subtotal:</span>
                <span class="summary-value">
                  ₱${(b.subtotal ?? 0).toFixed(2)}
                </span>
              </div>
              <div class="summary-row">
                <span class="summary-label">Voucher Amount:</span>
                <span class="summary-value">
                  ₱${(b.discount ?? 0).toFixed(2)}
                </span>
              </div>
              <div class="summary-row">
                <span class="summary-label bold">Total:</span>
                <span class="summary-value bold">
                  ₱${(b.total ?? 0).toFixed(2)}
                </span>
              </div>
            </div>
            <div class="invoice-actions">
              <button type="button" class="btn-download"
                      onclick="downloadInvoicePDF()">
                <span class="btn-download-text">Download PDF</span>
              </button>
              <div style="display:flex;align-items:center;gap:15px;">
                <button type="button" class="btn-edit"
                        onclick="handleEditBookingFromInvoice()">Edit</button>
                <button type="button" class="btn-back"
                        onclick="closeInvoiceModal()">Back</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
}

function closeInvoiceModal() {
    detailsState.selectedBooking = null;
    document.getElementById("modalsContainer").replaceChildren();
}

function handleEditBookingFromInvoice() {
    const id = detailsState.selectedBooking?.id;
    closeInvoiceModal();
    if (id) handleEditBooking(id);
}

// ── PDF download ──────────────────────────────────────────────────────────────

function downloadInvoicePDF() {
    const b = detailsState.selectedBooking;
    if (!b) return;
    const c = detailsState.customer;
    const win = window.open("", "", "height=600,width=800");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head>
      <title>Invoice</title>
      <style>
        body{font-family:'Segoe UI',Arial,sans-serif;padding:30px;max-width:600px;margin:0 auto}
        .logo-wrap{display:flex;justify-content:center;margin:0 auto 12px auto}
        .logo-box{background:#fff;border-radius:10px;padding:8px 12px;display:inline-block}
        .logo{display:block;width:170px;height:auto;object-fit:contain;filter:${INVOICE_LOGO_FILTER}}
        .title{font-size:28px;font-weight:bold;color:#165166;text-align:center}
        .row{display:flex;justify-content:space-between;padding:8px 0;font-size:13px}
        .bold{font-weight:bold;font-size:16px;color:#165166}
        .div{height:1px;background:#ddd;margin:20px 0}
      </style></head><body>
      <div class="logo-wrap"><div class="logo-box">
        <img class="logo" src="${INVOICE_LOGO_URL}" alt="Heigen Studio Logo" />
      </div></div>
      <p class="title">INVOICE</p>
      <p style="text-align:center;font-size:12px;color:#666;margin-bottom:20px">
        Héigen Studio
      </p>
      <div class="row"><b>Customer:</b><span>${escapeHtml(b.customer_name ?? c.name)}</span></div>
      <div class="row"><b>Email:</b><span>${escapeHtml(c.email ?? "")}</span></div>
      <div class="row"><b>Date:</b><span>${escapeHtml(b.date ?? "N/A")}</span></div>
      <div class="div"></div>
      <div class="row"><span>${escapeHtml(b.packageName ?? "N/A")}</span>
        <span>₱${(b.packagePrice ?? 0).toFixed(2)}</span></div>
      ${(b.addons ?? [])
          .map(
              (a) =>
                  `<div class="row" style="padding-left:20px;font-size:12px;color:#666">
             <span>${escapeHtml(a.name)} x ${a.quantity}</span>
             <span>₱${((a.price ?? 0) * (a.quantity ?? 1)).toFixed(2)}</span>
           </div>`,
          )
          .join("")}
      <div class="div"></div>
      <div class="row"><span>Subtotal:</span>
        <span>₱${(b.subtotal ?? 0).toFixed(2)}</span></div>
      <div class="row"><span>Discount:</span>
        <span>₱${(b.discount ?? 0).toFixed(2)}</span></div>
      <div class="row bold"><span>TOTAL:</span>
        <span>₱${(b.total ?? 0).toFixed(2)}</span></div>
      <p style="text-align:center;margin-top:40px;font-size:11px;color:#999">
        Thank you! Generated ${new Date().toLocaleString()}
      </p>
      <script>window.onload=function(){window.print();window.close()}<\/script>
    </body></html>`);
    win.document.close();
}

async function handleClaimPackage() {
    const updated = await window.loyaltyClaim.openClaimModal(
        { ...detailsState.customer, id: detailsState.customerId },
        detailsState.packages,
        detailsState.loyaltySettings,
    );
    if (!updated) return;
    detailsState.customer = {
        ...detailsState.customer,
        loyaltyPoints: updated.loyaltyPoints,
        claimedPackageId: updated.claimedPackageId,
        claimedPackageName: updated.claimedPackageName,
    };
    renderCustomerDetails();
}

function normalizeConsentDetail(value) {
    if (value === true) return "I Agree";
    if (value === false || value === null || value === undefined)
        return "I Disagree";
    const v = String(value).trim().toLowerCase();
    if (["i agree", "agree", "yes", "approved", "true"].includes(v)) {
        return "I Agree";
    }
    if (["i disagree", "disagree", "no", "not approved", "false"].includes(v)) {
        return "I Disagree";
    }
    return String(value);
}

function openCustomerEditModal() {
    const c = detailsState.customer;
    if (!c) return;
    const container = document.getElementById("modalsContainer");
    if (!container) return;
    container.innerHTML = `
      <div class="modal-overlay" id="customerEditModal"
           onclick="if(event.target.id==='customerEditModal') closeCustomerEditModal()">
        <div class="modal-content">
          <h2 class="modal-title">Edit customer</h2>
          <form id="customerEditForm"
                style="width:100%;display:flex;flex-direction:column;gap:32px;">
            <div class="form-group">
              <label class="form-label">Name</label>
              <input type="text" id="customerEditName"
                     placeholder="Enter full name"
                     class="form-input" required
                     autocomplete="off">
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" id="customerEditEmail"
                     placeholder="Enter email"
                     class="form-input" required
                     autocomplete="off">
            </div>
            <div class="form-group">
              <label class="form-label">Contact No.</label>
              <input type="tel" id="customerEditContactNo"
                     placeholder="Enter contact no."
                     class="form-input"
                     autocomplete="off">
            </div>
            <div class="checkbox-wrapper">
              <input type="checkbox" id="customerEditConsent" class="checkbox">
              <label class="checkbox-label">
                I hereby consent to Heigen Studio releasing my photos on
                public and social media platforms.
              </label>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn-back"
                      onclick="closeCustomerEditModal()">Cancel</button>
              <button type="submit" class="btn-next">Save</button>
            </div>
          </form>
        </div>
      </div>`;
    document.getElementById("customerEditName").value = c.name ?? "";
    document.getElementById("customerEditEmail").value = c.email ?? "";
    document.getElementById("customerEditContactNo").value = c.contactNo ?? "";
    document.getElementById("customerEditConsent").checked =
        normalizeConsentDetail(c.consent) === "I Agree";
    document.getElementById("customerEditForm").addEventListener(
        "submit",
        handleSaveCustomerEdit,
    );
}

function closeCustomerEditModal() {
    document.getElementById("customerEditModal")?.remove();
}

async function handleSaveCustomerEdit(event) {
    event.preventDefault();
    const id = detailsState.customerId;
    if (!id) return;
    const payload = {
        name: document.getElementById("customerEditName").value.trim(),
        email: document.getElementById("customerEditEmail").value.trim(),
        contactNo: document.getElementById("customerEditContactNo").value.trim(),
        consent: document.getElementById("customerEditConsent").checked
            ? "I Agree"
            : "I Disagree",
    };
    const overlay = document.getElementById("pageLoadingOverlay");
    if (overlay) {
        overlay.style.display = "flex";
        overlay.querySelector(".loading-label").textContent = "Saving…";
    }
    try {
        const updated = await window.apiClient.customers.update(id, payload);
        const prev = detailsState.customer;
        detailsState.customer = {
            ...prev,
            ...updated,
            bookings: prev.bookings,
        };
        closeCustomerEditModal();
        renderCustomerDetails();
    } catch (err) {
        console.error("handleSaveCustomerEdit:", err);
        window.heigenAlert("Failed to save customer: " + err.message);
    } finally {
        if (overlay) overlay.style.display = "none";
    }
}

// ── Global window exposure ────────────────────────────────────────────────────
// Required because this file is loaded as type="module" — module scope does
// not automatically expose functions to inline onclick handlers.

Object.assign(window, {
    initializeCustomerDetails,
    toggleBookingHistory,
    handleAddBooking,
    handleEditBooking,
    handleViewInvoice,
    handleDeleteBooking,
    handlePackageSelect,
    handleAddonChange,
    handleAddonQuantity,
    handleRemoveAddon,
    handleAddAddon,
    handlePackageInfoNext,
    goBackToPackageInfo,
    confirmBookingSummary,
    closePackageModal,
    closeBookingSummaryModal,
    closeInvoiceModal,
    handleEditBookingFromInvoice,
    downloadInvoicePDF,
    handleBookPackage,
    togglePredictView,
    toggleRecommendationView,
    refreshRenewalPanel,
    refreshRecommendationPanel,
    recomputeRecommendationEvaluation,
    renderPanels,
    openCustomerAddToPackageModal,
    closeCustomerAddToPackageModal,
    handleClaimPackage,
    openCustomerEditModal,
    closeCustomerEditModal,
    cdxBackToList,
    cdxBookRecommendation,
});

document.addEventListener("DOMContentLoaded", async () => {
    await initializeCustomerDetails();
    window.debugDetailsState = () => console.log(detailsState);
});
