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
    isHistoryExpanded: false,
    currentBooking: null,
    selectedBooking: null,
    isEditingBooking: false,
    activeView: null,
    deleteConfirmation: null,
};

const INVOICE_LOGO_URL =
    "https://api.builder.io/api/v1/image/assets/TEMP/0fdade257f0aa6c53979aa05f0c346a41b70e926?width=475";
const INVOICE_LOGO_FILTER =
    "invert(100%) sepia(8%) saturate(333%) hue-rotate(163deg) brightness(92%) contrast(92%)";

// ── Init ──────────────────────────────────────────────────────────────────────

function getParameterByName(name) {
    const r = new RegExp("[?&]" + name + "=([^&#]*)").exec(
        window.location.href,
    );
    return r ? decodeURIComponent(r[1].replace(/\+/g, " ")) : null;
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
        const [customer, packages, addons] = await Promise.all([
            window.apiClient.customers.get(customerId),
            window.apiClient.packages.list(),
            window.apiClient.addons.list(),
        ]);
        if (!customer) throw new Error("Customer not found");
        detailsState.customer = customer;
        // Only show confirmed (BOOKED) bookings on the customer profile.
        // Pending/Ongoing bookings from the kiosk are managed via the
        // notification panel and must not appear until accepted.
        if (Array.isArray(customer.bookings)) {
            customer.bookings = customer.bookings.filter(
                (b) => !b.session_status || b.session_status === "BOOKED",
            );
        }
        detailsState.packages = Array.isArray(packages) ? packages : [];
        detailsState.addons = Array.isArray(addons) ? addons : [];
        ensureRecommendationStyles();
        renderCustomerDetails();
    } catch (err) {
        console.error("initializeCustomerDetails:", err);
        document.querySelector(".page-wrapper").innerHTML =
            `<div class="p-10" style="color:#c00;">
               Failed to load customer: ${err.message}
             </div>`;
    } finally {
        if (overlay) overlay.style.display = "none";
    }
}

// ── Core render ───────────────────────────────────────────────────────────────

function renderCustomerDetails() {
    const c = detailsState.customer;
    const bookingCount = Array.isArray(c.bookings) ? c.bookings.length : 0;

    document.getElementById("customerHeader").textContent =
        `${c.name}'s Details`;

    document.getElementById("accountInfo").innerHTML = `
      <div class="info-row">
        <span class="info-label">Full name</span>
        <span class="info-value">${c.name ?? ""}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Consent</span>
        <span class="info-value">${normalizeConsent(c.consent ?? "")}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Email</span>
        <span class="info-value">${c.email ?? ""}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Contact no.</span>
        <span class="info-value">${c.contactNo ?? ""}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Bookings</span>
        <span class="info-value">${bookingCount}</span>
      </div>
      <div class="info-row info-actions">
        <button class="info-link" onclick="toggleBookingHistory()">
          ${detailsState.isHistoryExpanded ? "Collapse history" : "View history"}
        </button>
        <button class="info-link" onclick="handleAddBooking()">Add</button>
      </div>`;

    renderBookingHistory();
    renderViewButtons();
}

// ── Booking history ───────────────────────────────────────────────────────────

function renderBookingHistory() {
    const container = document.getElementById("bookingHistory");
    const c = detailsState.customer;

    detailsState.isHistoryExpanded
        ? container.classList.add("expanded")
        : container.classList.remove("expanded");

    const bookings = Array.isArray(c.bookings) ? c.bookings : [];
    if (!bookings.length) {
        container.innerHTML =
            '<div class="flex flex-col gap-2-5">' +
            '<div class="empty-state">No booking history</div></div>';
        return;
    }

    container.innerHTML =
        '<div class="flex flex-col gap-2-5">' +
        bookings
            .map((b) => {
                const date = b.date ?? "N/A";
                const total = Number(b.total ?? b.totalPrice ?? 0);
                return `
              <div class="booking-item">
                <div class="booking-header">
                  <div class="booking-date">${date}</div>
                  <div class="booking-field" style="width:150px;min-width:150px;">
                    <div class="booking-field-label">Full Name</div>
                    <div class="booking-field-value booking-text-truncate">
                      ${b.customer_name ?? c.name ?? ""}
                    </div>
                  </div>
                  <div class="booking-field" style="width:140px;min-width:140px;">
                    <div class="booking-field-label">Email</div>
                    <div class="booking-field-value booking-text-truncate">
                      ${c.email ?? ""}
                    </div>
                  </div>
                  <div class="booking-field" style="width:80px;min-width:80px;">
                    <div class="booking-field-label">Type</div>
                    <div class="booking-field-value">${b.type ?? "Walk-In"}</div>
                  </div>
                  <div class="booking-field" style="width:100px;min-width:100px;">
                    <div class="booking-field-label">Package</div>
                    <div class="booking-field-value booking-text-truncate">
                      ${b.packageName ?? ""}
                    </div>
                  </div>
                  <div class="booking-field" style="width:90px;min-width:90px;">
                    <div class="booking-field-label">Total:</div>
                    <div class="booking-field-value">₱${total.toFixed(2)}</div>
                  </div>
                  <div class="booking-actions">
                    <button class="booking-action-btn"
                            onclick="handleViewInvoice(${b.id})">Invoice</button>
                    <button class="booking-action-btn"
                            onclick="handleEditBooking(${b.id})">Edit</button>
                  </div>
                  <button class="booking-delete-btn" style="margin-left:auto;"
                          onclick="handleDeleteBooking(${b.id})" title="Delete">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M11.333 2.667V1.333A1.333 1.333 0 0 0 10 0H6a1.333
                               1.333 0 0 0-1.333 1.333V2.667H1.333V4h1.334V14A2
                               2 0 0 0 4.667 16h6.666A2 2 0 0 0 13.333 14V4h1.334
                               V2.667H11.333ZM7.333 11.333H6V7.333h1.333v4ZM10
                               11.333H8.667V7.333H10v4ZM10 2.667H6V1.333h4v1.334Z"
                            fill="#7DA3AC"/>
                    </svg>
                  </button>
                </div>
              </div>`;
            })
            .join("") +
        "</div>";
}

// ── View buttons ──────────────────────────────────────────────────────────────

function renderViewButtons() {
    document.getElementById("viewButtons").innerHTML = `
      <button class="view-button ${detailsState.activeView === "predict" ? "active" : "inactive"}"
              onclick="togglePredictView()">Predict Renewal</button>
      <button class="view-button ${detailsState.activeView === "recommendation" ? "active" : "inactive"}"
              onclick="toggleRecommendationView()">Recommendation</button>`;
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
    if (val) val.textContent = `${Math.round(p)}%`;
    if (status && p < 100) {
        status.textContent =
            p < 30
                ? "Analysing customer data..."
                : p < 60
                  ? "Generating recommendations..."
                  : p < 90
                    ? "Fetching package details..."
                    : "Almost ready...";
    }
}

function updatePredictionProgress(p) {
    predictionProgress = p;
    const bar = document.querySelector(".loading-progress-bar-fill");
    const val = document.querySelector(".loading-progress-value");
    const status = document.querySelector(".loading-progress-status");
    if (bar) bar.style.width = `${p}%`;
    if (val) val.textContent = `${Math.round(p)}%`;
    if (status && p < 100) {
        status.textContent =
            p < 30
                ? "Preparing renewal model..."
                : p < 60
                  ? "Analyzing booking history..."
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
        "renewal/outputs/xgboost_saved_model_results.csv";
    const sourceEng =
        modelMetricsCache?.renewal?.source_files?.engineered_baseline ||
        "renewal/outputs/xgboost_engineered_results.csv";

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
              <div class="model-metrics-title">Saved Model (${escapeHtml(sourceSaved)})</div>
              ${renderMetricsRows(saved)}
            </div>`
                  : ""
          }
          ${
              engineered
                  ? `<div class="model-metrics-block">
              <div class="model-metrics-title">Engineered Baseline (${escapeHtml(sourceEng)})</div>
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

function getRenewalBadgeClass(band) {
    if (band === "very_likely" || band === "likely") return "ai-badge";
    if (band === "very_unlikely") return "popular-badge";
    return "trending-badge";
}

function renderRenewalPanel(data) {
    const {
        customer_name,
        total_bookings,
        booking_frequency,
        preferred_package_type,
        renewal_probability,
        predicted_renewal,
        status_text,
        key_factors,
        avg_booking_value,
        total_spent,
        renewal_band,
        generated_at,
    } = data || {};

    const pct = Math.max(
        0,
        Math.min(100, Math.round((renewal_probability || 0) * 100)),
    );
    const factorsHTML = (key_factors || [])
        .map((f) => `<li class="factor-item">${f}</li>`)
        .join("");
    const radius = 78;
    const circumference = 2 * Math.PI * radius;
    const dash = (pct / 100) * circumference;
    const frequencyValue = Number(booking_frequency || 0);
    const frequencyLabel = Number.isFinite(frequencyValue)
        ? `${frequencyValue.toFixed(2)} / year`
        : "0.00 / year";
    const preferredPackage =
        preferred_package_type && String(preferred_package_type).trim()
            ? String(preferred_package_type)
            : "N/A";

    return `
      <div class="flex gap-5" style="flex-direction:row;">
        <div class="recommendation-panel">
          <div class="recommendation-header">
            <div class="recommendation-header-title">RENEWAL PREDICTION</div>
            <button class="panel-refresh-btn"
                    onclick="refreshRenewalPanel()"
                    title="Refresh renewal prediction"
                    aria-label="Refresh renewal prediction">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          </div>
          <div class="recommendation-content">
            <div style="display:flex;justify-content:center;align-items:center;flex-direction:column;margin-bottom:24px;">
              <div style="position:relative;width:220px;height:220px;">
                <svg width="220" height="220" viewBox="0 0 220 220">
                  <circle cx="110" cy="110" r="${radius}" fill="none" stroke="#E5EDF0" stroke-width="18"></circle>
                  <circle cx="110" cy="110" r="${radius}" fill="none" stroke="#165166" stroke-width="18"
                    stroke-linecap="round" transform="rotate(-90 110 110)"
                    stroke-dasharray="${dash} ${circumference - dash}"></circle>
                </svg>
                <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;">
                  <div style="font-size:44px;font-weight:800;color:#165166;line-height:1;">${pct}%</div>
                  <div style="font-size:12px;color:#4F6E79;font-weight:700;margin-top:4px;">Renewal Score</div>
                </div>
              </div>
              <div style="margin-top:12px;text-align:center;">
                <div class="user-name">${customer_name ?? detailsState.customer?.name ?? "Customer"}</div>
                <div class="user-bookings">${total_bookings ?? 0} booking(s)</div>
                <span class="source-badge ${getRenewalBadgeClass(renewal_band)}">
                  ${predicted_renewal ? "Likely Renew" : "Needs Follow-up"}
                </span>
              </div>
              <div style="margin-top:8px;font-size:13px;color:#616161;text-align:center;">
                ${status_text || "Renewal status"}
              </div>
            </div>

            <div style="margin-top:24px;">
              <h3 class="section-title">Renewal Insights</h3>
              <p class="section-subtitle">
                Dynamic prediction from current renewal profile and booking behavior.
              </p>
            </div>

            <div class="packages-grid renewal-metrics-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));">
              <div class="package-card" style="min-height:unset;">
                <div class="package-card-header"><h3 class="package-name">Total Bookings</h3></div>
                <div class="package-card-body"><div class="price-value">${Number(total_bookings || 0)}</div></div>
              </div>
              <div class="package-card" style="min-height:unset;">
                <div class="package-card-header"><h3 class="package-name">Booking Frequency</h3></div>
                <div class="package-card-body"><div class="price-value">${frequencyLabel}</div></div>
              </div>
              <div class="package-card" style="min-height:unset;">
                <div class="package-card-header"><h3 class="package-name">Preferred Package Type</h3></div>
                <div class="package-card-body"><div class="price-value">${preferredPackage}</div></div>
              </div>
              <div class="package-card" style="min-height:unset;">
                <div class="package-card-header"><h3 class="package-name">Average Booking Value</h3></div>
                <div class="package-card-body"><div class="price-value">${formatPrice(avg_booking_value || 0)}</div></div>
              </div>
              <div class="package-card" style="min-height:unset;">
                <div class="package-card-header"><h3 class="package-name">Total Spent</h3></div>
                <div class="package-card-body"><div class="price-value">${formatPrice(total_spent || 0)}</div></div>
              </div>
            </div>

            <div class="key-factors" style="margin-top:24px;">
              <div class="factors-list">
                <h3 class="factors-title">Key Factors Considered</h3>
                <ul class="factors-items">
                  ${factorsHTML || "<li class='factor-item'>Insufficient data</li>"}
                </ul>
              </div>
              <div class="date-reference">
                <span class="date-label">Generated</span>
                <span class="date-value">${generated_at ? new Date(generated_at).toLocaleString() : "-"}</span>
              </div>
            </div>
            <div id="renewalMetricsContainer">
              ${renderRenewalMetricsCollapsible()}
            </div>
          </div>
        </div>
      </div>`;
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
        const needsLoad =
            !renewalCache ||
            renewalCache.customer_id !== detailsState.customer.id;
        if (needsLoad) {
            predictionProgress = 0;
            container.innerHTML = `
              <div class="flex gap-5" style="flex-direction:row;">
                <div class="recommendation-panel">
                  <div class="recommendation-header">
                    <div class="recommendation-header-title">RENEWAL PREDICTION</div>
                    <button class="panel-refresh-btn"
                            onclick="refreshRenewalPanel()"
                            title="Refresh renewal prediction"
                            aria-label="Refresh renewal prediction">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                      </svg>
                    </button>
                  </div>
                  <div class="recommendation-content">
                    <div class="loading-container">
                      <div class="loading-progress-item">
                        <div class="loading-progress-badge">
                          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                            <circle cx="18" cy="18" r="16" stroke="white"
                                    stroke-width="2" fill="none" opacity="0.3"/>
                            <path d="M18 2 A16 16 0 0 1 34 18" stroke="white"
                                  stroke-width="2" fill="none" stroke-linecap="round">
                              <animateTransform attributeName="transform" type="rotate"
                                from="0 18 18" to="360 18 18" dur="1s"
                                repeatCount="indefinite"/>
                            </path>
                          </svg>
                        </div>
                        <div class="loading-progress-info">
                          <div class="loading-progress-percentage">
                            <span class="loading-progress-value">0%</span>
                            <span class="loading-progress-status">Preparing renewal model...</span>
                          </div>
                          <div class="loading-progress-bar">
                            <div class="loading-progress-bar-fill"
                                 style="width:0%"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>`;
            const data = await loadRenewalPrediction(detailsState.customer.id);
            if (!data) {
                container.innerHTML = `
                  <div class="flex gap-5" style="flex-direction:row;">
                    <div class="recommendation-panel">
                      <div class="recommendation-header">
                        <div class="recommendation-header-title">RENEWAL PREDICTION</div>
                        <button class="panel-refresh-btn"
                                onclick="refreshRenewalPanel()"
                                title="Refresh renewal prediction"
                                aria-label="Refresh renewal prediction">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                          </svg>
                        </button>
                      </div>
                      <div class="recommendation-content">
                        <div class="error-container">
                          <div class="error-icon">⚠️</div>
                          <p class="error-message">Failed to load renewal prediction. Please try again.</p>
                          <button class="retry-button" onclick="renderPanels()">Retry</button>
                        </div>
                      </div>
                    </div>
                  </div>`;
                return;
            }
        }
        container.innerHTML = renderRenewalPanel(renewalCache);
        return;
    }

    if (detailsState.activeView === "recommendation") {
        const needsLoad =
            !recommendationCache ||
            recommendationCache.customer_id !== detailsState.customer.id;

        if (needsLoad) {
            loadingProgress = 0;
            container.innerHTML = `
              <div class="flex gap-5" style="flex-direction:row;">
                <div class="recommendation-panel">
                  <div class="recommendation-header">
                    <div class="recommendation-header-title">RECOMMENDATION RESULT</div>
                    <button class="panel-refresh-btn"
                            onclick="refreshRecommendationPanel()"
                            title="Refresh recommendations"
                            aria-label="Refresh recommendations">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                      </svg>
                    </button>
                  </div>
                  <div class="recommendation-content">
                    <div class="loading-container">
                      <div class="loading-progress-item">
                        <div class="loading-progress-badge">
                          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                            <circle cx="18" cy="18" r="16" stroke="white"
                                    stroke-width="2" fill="none" opacity="0.3"/>
                            <path d="M18 2 A16 16 0 0 1 34 18" stroke="white"
                                  stroke-width="2" fill="none" stroke-linecap="round">
                              <animateTransform attributeName="transform" type="rotate"
                                from="0 18 18" to="360 18 18" dur="1s"
                                repeatCount="indefinite"/>
                            </path>
                          </svg>
                        </div>
                        <div class="loading-progress-info">
                          <div class="loading-progress-percentage">
                            <span class="loading-progress-value">0%</span>
                            <span class="loading-progress-status">Starting…</span>
                          </div>
                          <div class="loading-progress-bar">
                            <div class="loading-progress-bar-fill"
                                 style="width:0%"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>`;

            const data = await loadRecommendations(detailsState.customer.id);
            if (!data) {
                container.innerHTML = `
                  <div class="flex gap-5" style="flex-direction:row;">
                    <div class="recommendation-panel">
                      <div class="recommendation-header">
                        <div class="recommendation-header-title">
                          RECOMMENDATION RESULT
                        </div>
                        <button class="panel-refresh-btn"
                                onclick="refreshRecommendationPanel()"
                                title="Refresh recommendations"
                                aria-label="Refresh recommendations">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                          </svg>
                        </button>
                      </div>
                      <div class="recommendation-content">
                        <div class="error-container">
                          <div class="error-icon">⚠️</div>
                          <p class="error-message">
                            Failed to load recommendations. Please try again.
                          </p>
                          <button class="retry-button"
                                  onclick="renderPanels()">Retry</button>
                        </div>
                      </div>
                    </div>
                  </div>`;
                return;
            }
        }
        console.log("Recommendation Data:", recommendationCache);
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
        alert("Package flow storage is not available.");
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
    document.getElementById("custAddPkgConfirmBtn").onclick = () => {
        const sel = document.getElementById("custAddPkgCatSelect");
        const neu = document.getElementById("custAddPkgCatNew");
        let cat = (neu.value || "").trim();
        if (!cat) cat = (sel.value || "").trim();
        if (!cat) {
            alert("Select or enter a category.");
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
        alert(`Saved under “${cat}”.`);
    };
}

function renderRecommendationPanel(data) {
    const {
        recommendations,
        key_factors,
        customer_name,
        customer_email,
        target_date,
        total_bookings,
    } = data;

    window.__custRecsCache = recommendations ?? [];

    const cardsHTML = window.__custRecsCache
        .map((rec, recIndex) => {
            const {
                package: pkg,
                addons,
                total_price,
                base_price,
                source,
            } = rec;

            const inclusionsHTML = pkg.inclusions?.length
                ? `<div class="package-inclusions">
                 <h4 class="inclusions-title">Package Inclusions:</h4>
                 <ul class="inclusions-list">
                   ${pkg.inclusions.map((i) => `<li>${i}</li>`).join("")}
                 </ul>
               </div>`
                : "";

            const portraitsHTML = pkg.included_portraits?.length
                ? `<div class="package-portraits">
                 <h4 class="portraits-title">Included Portraits:</h4>
                 <ul class="portraits-list">
                   ${pkg.included_portraits.map((i) => `<li>${i}</li>`).join("")}
                 </ul>
               </div>`
                : "";

            const freebiesHTML = pkg.freebies?.length
                ? `<div class="package-freebies">
                 <h4 class="freebies-title">Freebies:</h4>
                 <ul class="freebies-list">
                   ${pkg.freebies.map((i) => `<li>${i}</li>`).join("")}
                 </ul>
               </div>`
                : "";

            const addonsHTML = addons?.length
                ? `<div class="package-addons-section">
                 <h4 class="addons-section-title">Recommended Add-ons:</h4>
                 ${addons
                     .map(
                         (a) => `
                   <div class="addon-item">
                     <div class="addon-header">
                       <span class="addon-name">${a.name}</span>
                       <span class="addon-price">${formatPrice(a.price)}</span>
                     </div>
                     ${
                         a.additional_info
                             ? `<p class="addon-info">${a.additional_info}</p>`
                             : ""
                     }
                     ${
                         a.applies_to
                             ? `<p class="addon-applies">Applies to: ${a.applies_to}</p>`
                             : ""
                     }
                   </div>`,
                     )
                     .join("")}
               </div>`
                : "";

            const promoBadge =
                pkg.promo_price && pkg.promo_price < pkg.price
                    ? `<div class="promo-badge">
                 <span class="promo-text">PROMO</span>
                 <span class="original-price">${formatPrice(pkg.price)}</span>
               </div>`
                    : "";

            // Safe serialisation for onclick attributes
            const addonIdsJson = JSON.stringify(
                (addons ?? []).map((a) => a.id),
            ).replace(/"/g, "&quot;");
            const safeName = (pkg.name ?? "").replace(/'/g, "\\'");
            const numericBasePrice = Number(base_price ?? pkg.promo_price ?? pkg.price ?? 0);
            const numericTotalPrice = Number(total_price ?? 0);

            return `
          <div class="package-card" data-package-id="${pkg.id}">
            <div class="package-card-header">
              <div class="package-header-top">
                <h3 class="package-name">${pkg.name}</h3>
                ${getSourceBadge(source)}
              </div>
              <p class="package-category">${pkg.category}</p>
              ${promoBadge}
            </div>
            <div class="package-card-body">
              <div class="package-price-row">
                <span class="price-label">Base Package</span>
                <span class="price-value">${formatPrice(base_price)}</span>
              </div>
              ${
                  pkg.promo_price_condition
                      ? `<div class="promo-condition">
                       <small>${pkg.promo_price_condition}</small>
                     </div>`
                      : ""
              }
              ${
                  pkg.max_people
                      ? `<div class="package-capacity">
                       <span class="capacity-icon">👥</span>
                       <span>Up to ${pkg.max_people} people</span>
                     </div>`
                      : ""
              }
              ${inclusionsHTML}${portraitsHTML}${freebiesHTML}${addonsHTML}
              ${
                  pkg.notes
                      ? `<div class="package-notes">
                       <p class="notes-text"><em>${pkg.notes}</em></p>
                     </div>`
                      : ""
              }
            </div>
            <div class="package-card-footer">
              <div class="total-price-row">
                <span class="total-label">Total Price</span>
                <span class="total-value">${formatPrice(total_price)}</span>
              </div>
              <button class="book-button"
                      onclick="handleBookPackage(${pkg.id},'${safeName}',${numericTotalPrice},${addonIdsJson},${numericBasePrice})">
                <span class="book-icon">📅</span>
                <span>Book Now</span>
              </button>
              <button type="button" class="book-button"
                      style="margin-top:10px;background:#fff;color:#165166;border:2px solid #165166;"
                      onclick="openCustomerAddToPackageModal(${recIndex})">
                <span>Add to Package</span>
              </button>
            </div>
          </div>`;
        })
        .join("");

    const factorsHTML = (key_factors ?? [])
        .map((f) => `<li class="factor-item">${f}</li>`)
        .join("");

    return `
      <div class="flex gap-5" style="flex-direction:row;">
        <div class="recommendation-panel">
          <div class="recommendation-header">
            <div class="recommendation-header-title">RECOMMENDATION RESULT</div>
            <button class="panel-refresh-btn"
                    onclick="refreshRecommendationPanel()"
                    title="Refresh recommendations"
                    aria-label="Refresh recommendations">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          </div>
          <div class="recommendation-content">
            <div class="progress-item">
              <div class="progress-badge">
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                  <path d="M15.87 23.37C15.57 23.37 15.285 23.25 15.075 23.04
                           L10.83 18.8C10.395 18.36 10.395 17.64 10.83 17.21
                           C11.265 16.77 11.985 16.77 12.42 17.21L15.87 20.66
                           L23.58 12.95C24.015 12.51 24.735 12.51 25.17 12.95
                           C25.605 13.38 25.605 14.1 25.17 14.54L16.665 23.04
                           C16.455 23.25 16.17 23.37 15.87 23.37Z"
                        fill="white"/>
                </svg>
              </div>
              <div class="progress-info">
                <div class="progress-percentage">
                  <span class="progress-value">100%</span>
                  <span class="progress-status">Completed</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-bar-fill" style="width:100%"></div>
                </div>
              </div>
              <div class="user-reference">
                <div class="user-name">${customer_name ?? "Customer"}</div>
                <div class="user-email">${customer_email ?? ""}</div>
                ${
                    total_bookings > 0
                        ? `<div class="user-bookings">
                         ${total_bookings} previous booking${total_bookings > 1 ? "s" : ""}
                       </div>`
                        : `<div class="user-bookings">First-time customer</div>`
                }
              </div>
            </div>
            <div style="margin-top:24px;">
              <h3 class="section-title">Recommended Packages for You</h3>
              <p class="section-subtitle">
                ${
                    total_bookings > 0
                        ? "Personalised recommendations based on your booking history."
                        : "Popular packages chosen for first-time customers."
                }
              </p>
            </div>
            <div class="packages-grid">
              ${cardsHTML || "<p class='no-recommendations'>No recommendations available.</p>"}
            </div>
            <div class="key-factors" style="margin-top:24px;">
              <div class="factors-list">
                <h3 class="factors-title">Key Factors Considered</h3>
                <ul class="factors-items">
                  ${factorsHTML || "<li class='factor-item'>General popularity</li>"}
                </ul>
              </div>
              <div class="date-reference">
                <span class="date-label">Date</span>
                <span class="date-value">${target_date}</span>
              </div>
            </div>
            <div id="recommendationMetricsContainer">
              ${renderRecommendationMetricsCollapsible()}
            </div>
          </div>
        </div>
      </div>`;
}

// ── handleBookPackage — the missing function ───────────────────────────────────

function handleBookPackage(
    packageId,
    packageName,
    totalPrice,
    addonIds,
    recommendedBasePrice,
) {
    const numericTotalPrice = Number(totalPrice);
    if (
        !confirm(
            `Book "${packageName}" for ${formatPrice(Number.isFinite(numericTotalPrice) ? numericTotalPrice : 0)}?\n\n` +
                `This will create a new booking for the customer.`,
        )
    )
        return;

    const packageIdNum = Number(packageId);
    const pkg = detailsState.packages.find((p) => Number(p.id) === packageIdNum);
    if (!pkg) {
        alert("Package data not available. Use the Add button instead.");
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
    renderCustomerDetails();
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
    detailsState.currentBooking = JSON.parse(JSON.stringify(b));
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

function handleDeleteBooking(bookingId) {
    const b = detailsState.customer.bookings.find((x) => x.id === bookingId);
    if (!b) return;
    detailsState.deleteConfirmation = { bookingId, date: b.date };
    renderDeleteConfirmation();
}

async function confirmDeleteBooking() {
    const { bookingId } = detailsState.deleteConfirmation;

    // Clear confirmation UI immediately
    detailsState.deleteConfirmation = null;
    document.getElementById("bookingDeleteConfirm").innerHTML = "";

    try {
        await window.apiClient.bookings.remove(
            detailsState.customerId,
            bookingId,
        );
    } catch (err) {
        // A 404 here means it was already deleted — treat as success
        if (!err.message.includes("404")) {
            alert("Failed to delete booking: " + err.message);
            return;
        }
    }

    // Update local state by removing the booking
    detailsState.customer.bookings = (
        detailsState.customer.bookings ?? []
    ).filter((b) => b.id !== bookingId);

    renderCustomerDetails();
}

function cancelDeleteBooking() {
    detailsState.deleteConfirmation = null;
    document.getElementById("bookingDeleteConfirm").innerHTML = "";
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
                `<option value="${p.name}"
                 ${booking.packageName === p.name ? "selected" : ""}>
           ${p.name} – ₱${p.price}
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
        alert("Please select a package first.");
        return;
    }
    if (!getAvailableAddonsForBooking(booking).length) {
        alert("No add-ons available for the selected package.");
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
        alert("Please select a package");
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
    document.getElementById("modalsContainer").innerHTML = "";
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
        alert("Package not found. Please go back and reselect the package.");
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
        } else {
            saved = await window.apiClient.bookings.create(
                detailsState.customerId,
                apiPayload,
            );
            // Merge display fields onto the saved object for immediate rendering
            c.bookings.push(_mergeBookingDisplay(saved, cb, pkg));
        }
    } catch (err) {
        console.error("confirmBookingSummary:", err);
        alert("Failed to save booking: " + err.message);
        return;
    }

    Object.assign(detailsState, {
        currentBooking: null,
        isEditingBooking: false,
        selectedBooking: null,
        isHistoryExpanded: true,
    });
    if (overlay) overlay.style.display = "none";
    document.getElementById("modalsContainer").innerHTML = "";
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
    document.getElementById("modalsContainer").innerHTML = "";
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
             ${a.name} x ${a.quantity}
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
                    ${b.packageName ?? "N/A"}
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
    document.getElementById("modalsContainer").innerHTML = "";
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
             ${a.name} x ${a.quantity}
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
                    ${b.customer_name ?? c.name ?? "N/A"}
                  </span>
                </div>
              </div>
              <div class="invoice-item">
                <div style="display:flex;flex-direction:column;gap:8px;">
                  <span style="color:#ABB7C2;font-size:12px;">Email</span>
                  <span style="color:#909090;font-size:14px;">
                    ${c.email ?? "N/A"}
                  </span>
                </div>
              </div>
              <div class="invoice-item">
                <div style="display:flex;flex-direction:column;gap:8px;">
                  <span style="color:#ABB7C2;font-size:12px;">Type</span>
                  <span style="color:#909090;font-size:14px;">
                    ${b.type ?? "Walk-In"}
                  </span>
                </div>
              </div>
              <div class="invoice-item">
                <div style="display:flex;flex-direction:column;gap:8px;">
                  <span style="color:#ABB7C2;font-size:12px;">Date</span>
                  <span style="color:#909090;font-size:14px;">
                    ${b.date ?? "N/A"}
                  </span>
                </div>
              </div>
              <div class="invoice-item">
                <div style="display:flex;flex-direction:column;gap:8px;">
                  <span style="color:#ABB7C2;font-size:14px;">Package Name</span>
                  <div style="display:flex;justify-content:space-between;">
                    <span style="color:#909090;font-size:14px;">
                      ${b.packageName ?? "N/A"}
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
    document.getElementById("modalsContainer").innerHTML = "";
}

function handleEditBookingFromInvoice() {
    const id = detailsState.selectedBooking?.id;
    closeInvoiceModal();
    if (id) handleEditBooking(id);
}

// ── Delete confirmation ───────────────────────────────────────────────────────

function renderDeleteConfirmation() {
    document.getElementById("bookingDeleteConfirm").innerHTML = `
      <div class="confirmation-dialog">
        <div class="confirmation-content">
          <h3 class="confirmation-title">Delete Booking</h3>
          <p class="confirmation-message">
            Delete the booking from
            <strong>${detailsState.deleteConfirmation.date}</strong>?
            This cannot be undone.
          </p>
          <div class="confirmation-actions">
            <button class="btn-confirm-cancel"
                    onclick="cancelDeleteBooking()">Cancel</button>
            <button class="btn-confirm-delete"
                    onclick="confirmDeleteBooking()">Delete</button>
          </div>
        </div>
      </div>`;
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
      <div class="row"><b>Customer:</b><span>${b.customer_name ?? c.name}</span></div>
      <div class="row"><b>Email:</b><span>${c.email ?? ""}</span></div>
      <div class="row"><b>Date:</b><span>${b.date ?? "N/A"}</span></div>
      <div class="div"></div>
      <div class="row"><span>${b.packageName ?? "N/A"}</span>
        <span>₱${(b.packagePrice ?? 0).toFixed(2)}</span></div>
      ${(b.addons ?? [])
          .map(
              (a) =>
                  `<div class="row" style="padding-left:20px;font-size:12px;color:#666">
             <span>${a.name} x ${a.quantity}</span>
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
    confirmDeleteBooking,
    cancelDeleteBooking,
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
});

document.addEventListener("DOMContentLoaded", async () => {
    await initializeCustomerDetails();
    window.debugDetailsState = () => console.log(detailsState);
});
