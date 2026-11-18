// scripts/coupon-api.js – Coupon CRUD and Send
let coupons = [];
let editingId = null;
let sendCouponId = null;
let selectedCustomerIds = new Set();
let sendListRequest = 0;
let sendMatchCount = 0;
let selectedEmailPresetId = null;
let composerFullscreenMode = null;
let composerIsMinimized = false;
// Tall enough to read a typical coupon email without scrolling inside the card.
let composerEditorHeight = 340;
let composerPreviewHeight = 400;
const TEXT_PREVIEW_HEIGHT = 220;
let composerResizeDragging = false;
let composerResizeStartY = 0;
let composerResizeStartEditor = 0;
let composerResizeStartPreview = 0;
// Expanded HTML composer opens on the rendered preview; staff switch to source on demand.
let composerModalViewMode = "preview";
/** Inline HTML mode view: "preview" (rendered, default) or "source" (raw HTML). */
let sendHtmlView = "preview";
/** Last focused message field, so Insert chips know where to put a variable. */
let sendLastField = null;
/** id → name for customers seen in the Send list (preview uses the first selected). */
let sendCustomerNames = new Map();
let sendPreviewNameRequests = new Set();
let sendLastPreviewKey = null;
const SEND_SAMPLE_CUSTOMER_NAME = "Maria Santos";

const SEND_FILTER_IDS = {
    risk: "sendFilterRenewalRisk",
    booking: "sendFilterBookingActivity",
    dateFrom: "sendFilterDateFrom",
    dateTo: "sendFilterDateTo",
};

/** Applied list filters (updated on Apply filters in Send modal). */
let sendAppliedFilterState = null;
let sendAppliedSearch = "";
const COUPONS_PER_PAGE = 20;
const SEND_CUSTOMERS_PER_PAGE = 50;
let couponPage = 1;
let sendPage = 1;

let emailPresetsCache = [];

/** Main list: search + sort (default soonest expiry first; expired rows pinned bottom). */
let couponSearchQuery = "";
let couponSort = { key: "expires", dir: "asc" };
const COUPON_SORT_LABELS = {
    "expires:asc": "Expiry (soonest)",
    "expires:desc": "Expiry (latest)",
    "code:asc": "Code (A-Z)",
    "code:desc": "Code (Z-A)",
    "discount_type:asc": "Type (A-Z)",
    "discount_type:desc": "Type (Z-A)",
    "value:asc": "Value (low-high)",
    "value:desc": "Value (high-low)",
    "use_limit:asc": "Use limit (low-high)",
    "use_limit:desc": "Use limit (high-low)",
    "max_discount:asc": "Max discount (low-high)",
    "max_discount:desc": "Max discount (high-low)",
    "used:asc": "Used (least first)",
    "used:desc": "Used (most first)",
};

function setFlexModalVisible(modalId, visible) {
    const el = document.getElementById(modalId);
    if (!el) return;
    if (visible) {
        el.classList.remove("hidden");
        el.classList.add("flex");
    } else {
        el.classList.add("hidden");
        el.classList.remove("flex");
    }
}

function showToast(msg, type = "success") {
    const toast = document.getElementById("toast");
    if (toast) {
        toast.textContent = msg;
        toast.className = `toast toast-${type}`;
        toast.style.display = "block";
        setTimeout(() => { toast.style.display = "none"; }, 3000);
    } else {
        window.heigenAlert(msg);
    }
}

// Earn rate as last loaded/saved — a change re-prices every customer's points
let loyaltySavedEarnRate = null;
let loyaltySavedRedeemRate = null;

async function loadLoyaltySettingsForCouponsPage() {
    const earn = document.getElementById("loyaltyPesosPerPointEarn");
    const redeem = document.getElementById("loyaltyPesosPerPointRedeem");
    if (!earn || !redeem || !window.apiClient?.loyaltySettings) return;
    try {
        const s = await window.apiClient.loyaltySettings.get();
        loyaltySavedEarnRate = s.pesos_per_point_earn != null ? Number(s.pesos_per_point_earn) : null;
        loyaltySavedRedeemRate = s.pesos_per_point_redeem != null ? Number(s.pesos_per_point_redeem) : null;
        earn.value =
            s.pesos_per_point_earn != null ? String(s.pesos_per_point_earn) : "";
        redeem.value =
            s.pesos_per_point_redeem != null
                ? String(s.pesos_per_point_redeem)
                : "";
    } catch (e) {
        console.warn("loadLoyaltySettingsForCouponsPage:", e);
    }
}

/** Rates are Admin/Owner only (the API enforces this too); Staff see them read-only. */
function canEditLoyaltyRates() {
    if (window.staffAuth && typeof window.staffAuth.isAdminOrOwner === "function") {
        return window.staffAuth.isAdminOrOwner();
    }
    try {
        const role = String(JSON.parse(sessionStorage.getItem("user") || "{}").role || "").toUpperCase();
        return role === "ADMIN" || role === "OWNER";
    } catch (_) {
        return false;
    }
}

function applyLoyaltyRatesPermission() {
    const editable = canEditLoyaltyRates();
    ["loyaltyPesosPerPointEarn", "loyaltyPesosPerPointRedeem"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.readOnly = !editable;
        el.classList.toggle("lp-readonly", !editable);
        el.setAttribute("aria-readonly", editable ? "false" : "true");
    });
    const actions = document.getElementById("loyaltyRatesActions");
    if (actions) actions.hidden = !editable;
    const note = document.getElementById("loyaltyRatesLockedNote");
    if (note) note.hidden = editable;
    const label = document.querySelector(".coupons-loyalty-label");
    if (label) label.textContent = editable ? "Configure loyalty points" : "Loyalty points";
}

async function openLoyaltySettingsModal() {
    applyLoyaltyRatesPermission();
    const statusEl = document.getElementById("loyaltySettingsStatus");
    if (statusEl) statusEl.classList.add("hidden");
    setFlexModalVisible("loyaltySettingsModal", true);
    if (window.lpEligible) window.lpEligible.load();
    // Re-read current rates so the form never shows stale values
    await loadLoyaltySettingsForCouponsPage();
    // Staff can't edit the rates, so start them in the customer list instead
    const first = canEditLoyaltyRates()
        ? document.getElementById("loyaltyPesosPerPointEarn")
        : document.getElementById("lpSearch");
    if (first) first.focus();
}

function closeLoyaltySettingsModal() {
    setFlexModalVisible("loyaltySettingsModal", false);
    const trigger = document.getElementById("loyaltySettingsOpenBtn");
    if (trigger) trigger.focus();
}

document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (window.lpEligible && window.lpEligible.isComposerOpen()) {
        window.lpEligible.closeComposer();
        return;
    }
    const m = document.getElementById("loyaltySettingsModal");
    if (m && !m.classList.contains("hidden")) closeLoyaltySettingsModal();
});

async function saveLoyaltySettings() {
    if (!canEditLoyaltyRates()) {
        showToast("Only an Admin or Owner can change loyalty rates.", "error");
        return;
    }
    const earn = document.getElementById("loyaltyPesosPerPointEarn");
    const redeem = document.getElementById("loyaltyPesosPerPointRedeem");
    const statusEl = document.getElementById("loyaltySettingsStatus");
    if (!earn || !redeem) return;
    const btn = document.getElementById("loyaltySettingsSaveBtn");
    const payload = {
        pesos_per_point_earn: Number(earn.value),
        pesos_per_point_redeem: Number(redeem.value),
    };
    if (!(payload.pesos_per_point_earn > 0) || !(payload.pesos_per_point_redeem > 0)) {
        showToast("Enter positive numbers for both rates.", "error");
        return;
    }
    try {
        if (btn) btn.disabled = true;
        // Always dry-run: balances may reflect a different rate than the saved one
        // (an earlier change that didn't re-price). Asks only if anything will move.
        if (!(await confirmLoyaltyRecalculation(payload))) return;
        const saved = await window.apiClient.loyaltySettings.patch(payload);
        loyaltySavedEarnRate = Number(saved?.pesos_per_point_earn ?? payload.pesos_per_point_earn);
        loyaltySavedRedeemRate = Number(saved?.pesos_per_point_redeem ?? payload.pesos_per_point_redeem);
        const recalc = saved?.recalculated;
        const n = recalc?.affected || 0;
        const claims = recalc?.claims_repriced || 0;
        const claimsNote = claims ? `, ${claims} claim${claims === 1 ? "" : "s"} re-priced` : "";
        showToast(n || claims
            ? `Saved. Points updated for ${n} customer${n === 1 ? "" : "s"}${claimsNote}.`
            : "Loyalty settings saved.");
        if (statusEl) {
            statusEl.textContent = n || claims
                ? `Saved — ${n} customer${n === 1 ? "'s" : "s'"} points recalculated${claimsNote}; eligible list updated.`
                : "Saved — points already match these rates; eligible list updated.";
            statusEl.classList.remove("hidden");
        }
        // New rates change who can claim: refresh the list and the badge
        if (window.lpEligible) window.lpEligible.load();
    } catch (e) {
        showToast(e.message || "Failed to save loyalty settings.", "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

/** Dry-run the new rates and ask before customers' points are re-priced. */
async function confirmLoyaltyRecalculation(payload) {
    const newEarn = payload.pesos_per_point_earn;
    const newRedeem = payload.pesos_per_point_redeem;
    let preview = null;
    try {
        preview = await window.apiClient.loyaltySettings.preview(payload);
    } catch (e) {
        console.warn("loyalty preview:", e);
    }
    const fmt = (v) => {
        const t = Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        return t.endsWith(".0") ? t.slice(0, -2) : t;
    };
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    // Nothing to re-price (or preview unavailable and nothing changed): just save
    if (preview && !preview.affected && !preview.claims_repriced) return true;
    if (!preview && Number(loyaltySavedEarnRate) === Number(newEarn)
        && Number(loyaltySavedRedeemRate) === Number(newRedeem)) return true;

    const lines = [];
    const basis = preview?.basis_rate;
    if (basis && Number(basis) !== Number(newEarn) && Number(basis) !== Number(loyaltySavedEarnRate)) {
        lines.push(`Customers' current points were earned at ₱${fmt(basis)} per point — an earlier rate change didn't update them. ` +
            `Earned points will now follow ₱${fmt(newEarn)} per point.`);
    } else if (Number(loyaltySavedEarnRate) !== Number(newEarn)) {
        lines.push(`Earn rate: ₱${fmt(loyaltySavedEarnRate)} → ₱${fmt(newEarn)} per point.`);
    }
    if (Number(loyaltySavedRedeemRate) !== Number(newRedeem)) {
        lines.push(`Claim rate: ₱${fmt(loyaltySavedRedeemRate)} → ₱${fmt(newRedeem)} per point.`);
    }
    let message = lines.join("\n") + "\n\n";
    if (preview) {
        if (preview.affected) {
            message += `Points will be recalculated for ${plural(preview.affected, "customer", "customers")}` +
                ` (${preview.increased} up, ${preview.decreased} down).`;
        }
        if (preview.claims_repriced) {
            message += `${preview.affected ? " " : ""}${plural(preview.claims_repriced, "claimed package is", "claimed packages are")}` +
                " re-priced at the new claim rate — customers get back or pay the difference.";
        }
        if (preview.examples?.length) {
            message += "\n\n" + preview.examples
                .map((ex) => `• ${ex.name || "Customer #" + ex.id}: ${fmt(ex.before)} → ${fmt(ex.after)} pts`)
                .join("\n");
        }
        if (preview.floored) {
            message += `\n\n${plural(preview.floored, "customer", "customers")} would go below 0 and will be set to 0 instead.`;
        }
    } else {
        message += "Customers' points will be recalculated at the new rates.";
    }
    if (typeof window.heigenConfirm !== "function") return true;
    return window.heigenConfirm(message, {
        title: "Recalculate loyalty points",
        confirmText: "Save & recalculate",
        dangerous: false,
    });
}

function isCouponExpired(c) {
    if (!c?.expires_at) return false;
    const t = new Date(c.expires_at).getTime();
    return Number.isFinite(t) && t < Date.now();
}

function couponExpiresMs(c) {
    if (!c?.expires_at) return null;
    const t = new Date(c.expires_at).getTime();
    return Number.isFinite(t) ? t : null;
}

function couponSortValue(c, key) {
    if (key === "code") return String(c.code || "");
    if (key === "discount_type") return String(c.discount_type || "");
    if (key === "value") return Number(c.discount_value);
    if (key === "use_limit") return c.use_limit != null ? Number(c.use_limit) : "";
    if (key === "max_discount") return c.max_discount_amount != null ? Number(c.max_discount_amount) : "";
    if (key === "used") return Number(c.times_used ?? 0);
    return "";
}

function filterCouponsLocal(list) {
    const q = String(couponSearchQuery || "").trim().toLowerCase();
    if (!q) return (Array.isArray(list) ? list : []).slice();
    return (Array.isArray(list) ? list : []).filter((c) => {
        const val =
            c.discount_type === "percent"
                ? `${c.discount_value}%`
                : `₱${Number(c.discount_value).toLocaleString()}`;
        const hay = [
            c.code,
            c.discount_type,
            val,
            String(c.use_limit ?? ""),
            c.max_discount_amount != null ? String(c.max_discount_amount) : "",
            String(c.times_used ?? ""),
            c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "",
            c.expires_at ? new Date(c.expires_at).toISOString() : "",
        ]
            .join(" ")
            .toLowerCase();
        return hay.includes(q);
    });
}

function compareCouponsPrimary(a, b) {
    const key = couponSort.key || "expires";
    const dirMul = couponSort.dir === "desc" ? -1 : 1;

    if (key === "expires") {
        const aEx = isCouponExpired(a);
        const bEx = isCouponExpired(b);
        const aMs = couponExpiresMs(a);
        const bMs = couponExpiresMs(b);
        if (!aEx && !bEx) {
            const av = aMs == null ? Infinity : aMs;
            const bv = bMs == null ? Infinity : bMs;
            if (av !== bv) return av < bv ? -1 * dirMul : 1 * dirMul;
        } else if (aEx && bEx) {
            const av = aMs ?? 0;
            const bv = bMs ?? 0;
            if (av !== bv) return av < bv ? -1 * dirMul : 1 * dirMul;
        }
        return 0;
    }

    if (key === "value") {
        const av = Number(a.discount_value);
        const bv = Number(b.discount_value);
        if (av !== bv) return av < bv ? -1 * dirMul : 1 * dirMul;
        return 0;
    }

    if (key === "use_limit") {
        const av = a.use_limit != null ? Number(a.use_limit) : Infinity;
        const bv = b.use_limit != null ? Number(b.use_limit) : Infinity;
        if (av !== bv) return av < bv ? -1 * dirMul : 1 * dirMul;
        return 0;
    }

    if (key === "max_discount") {
        const av = a.max_discount_amount != null ? Number(a.max_discount_amount) : Infinity;
        const bv = b.max_discount_amount != null ? Number(b.max_discount_amount) : Infinity;
        if (av !== bv) return av < bv ? -1 * dirMul : 1 * dirMul;
        return 0;
    }

    if (key === "used") {
        const av = Number(a.times_used ?? 0);
        const bv = Number(b.times_used ?? 0);
        if (av !== bv) return av < bv ? -1 * dirMul : 1 * dirMul;
        return 0;
    }

    const av = couponSortValue(a, key);
    const bv = couponSortValue(b, key);
    const aEmpty = av === "" || av == null;
    const bEmpty = bv === "" || bv == null;
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    const cmp = String(av).localeCompare(String(bv), undefined, {
        sensitivity: "base",
        numeric: true,
    });
    if (cmp !== 0) return cmp * dirMul;
    return 0;
}

function sortCouponsLocal(list) {
    const arr = (Array.isArray(list) ? list : []).slice();
    return arr.sort((a, b) => {
        const aEx = isCouponExpired(a) ? 1 : 0;
        const bEx = isCouponExpired(b) ? 1 : 0;
        if (aEx !== bEx) return aEx - bEx;

        let cmp = compareCouponsPrimary(a, b);
        if (cmp !== 0) return cmp;

        const tie = String(a.code || "").localeCompare(String(b.code || ""), undefined, {
            sensitivity: "base",
        });
        if (tie !== 0) return tie;
        return (a.id ?? 0) - (b.id ?? 0);
    });
}

function refreshCouponSortIndicators() {
    document.querySelectorAll("#couponsTable .accounts-sort-btn").forEach((btn) => {
        const key = String(btn.getAttribute("data-sort-key") || "");
        const indicator = btn.querySelector(".accounts-sort-indicator");
        if (!indicator) return;
        if (key === couponSort.key) {
            indicator.textContent = couponSort.dir === "desc" ? "▼" : "▲";
            btn.classList.add("font-extrabold");
            btn.classList.add("text-white");
        } else {
            indicator.textContent = "";
            btn.classList.remove("font-extrabold");
            btn.classList.remove("text-white");
        }
    });
}

function updateCouponSortUiState() {
    const sortBtn = document.getElementById("couponsSortBtn");
    if (sortBtn) {
        const label =
            COUPON_SORT_LABELS[`${couponSort.key}:${couponSort.dir}`] ||
            COUPON_SORT_LABELS["expires:asc"];
        sortBtn.textContent = `Sort: ${label}`;
    }
    document.querySelectorAll("#couponsSortMenu .accounts-sort-option").forEach((opt) => {
        const key = String(opt.getAttribute("data-sort-key") || "");
        const dir = String(opt.getAttribute("data-sort-dir") || "");
        const isActive = key === couponSort.key && dir === couponSort.dir;
        opt.classList.toggle("accounts-sort-option--active", isActive);
        opt.classList.toggle("font-extrabold", isActive);
    });
}

function updateCouponsCountBadge(visibleCount, totalCount) {
    const badge = document.getElementById("couponsCountBadge");
    if (!badge) return;
    if (visibleCount === totalCount) {
        badge.textContent = `${totalCount} coupon${totalCount === 1 ? "" : "s"}`;
        return;
    }
    badge.textContent = `${visibleCount}/${totalCount} shown`;
}

function renderCouponsTable(page = 1) {
    const loading = document.getElementById("listLoading");
    const table = document.getElementById("couponsTable");
    const empty = document.getElementById("couponsEmpty");
    const body = document.getElementById("couponsBody");
    if (!body || !table) return;

    const filtered = filterCouponsLocal(coupons);
    const sorted = sortCouponsLocal(filtered);
    updateCouponsCountBadge(sorted.length, coupons.length);
    couponPage = renderPager("couponsPagination", page, sorted.length, COUPONS_PER_PAGE, "renderCouponsTable");
    const pageStart = (couponPage - 1) * COUPONS_PER_PAGE;

    body.innerHTML = sorted
        .slice(pageStart, pageStart + COUPONS_PER_PAGE)
        .map((c) => {
            const expired = isCouponExpired(c);
            const expires = c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "—";
            const maxDisc =
                c.max_discount_amount != null
                    ? `₱${Number(c.max_discount_amount).toLocaleString()}`
                    : "—";
            const val =
                c.discount_type === "percent"
                    ? `${c.discount_value}%`
                    : `₱${Number(c.discount_value).toLocaleString()}`;
            const expClass = expired ? " coupon-expired-text" : "";
            return `
                <tr>
                    <td class="px-4 py-3 heigen-td-strong">${escapeHtml(c.code)}</td>
                    <td class="px-4 py-3">${c.discount_type}</td>
                    <td class="px-4 py-3">${val}</td>
                    <td class="px-4 py-3">${c.use_limit ?? "—"}</td>
                    <td class="px-4 py-3">${maxDisc}</td>
                    <td class="px-4 py-3${expClass}">${expires}</td>
                    <td class="px-4 py-3">${c.times_used ?? 0}</td>
                    <td class="px-4 py-3 whitespace-nowrap">
                        <button type="button" onclick="openEditModal(${c.id})" class="heigen-table-action">Edit</button>
                        <button type="button" onclick="openHistoryModal(${c.id})" class="heigen-table-action">History</button>
                        <button type="button" onclick="openSendModal(${c.id})" class="heigen-table-action">Send</button>
                        <button type="button" onclick="deleteCoupon(${c.id})" class="heigen-table-action heigen-table-action--danger">Delete</button>
                    </td>
                </tr>`;
        })
        .join("");

    if (loading) loading.classList.add("hidden");
    refreshCouponSortIndicators();
    updateCouponSortUiState();

    if (!coupons.length) {
        table.classList.add("hidden");
        if (empty) {
            if (window.HeigenUI && typeof openCreateModal === "function") {
                empty.innerHTML = "";
                empty.appendChild(
                    window.HeigenUI.emptyState({
                        icon: "tag",
                        title: "No coupons yet",
                        text: "Coupons give customers a discount on their next booking. Create one to get started.",
                        actionLabel: "Create coupon",
                        onAction: () => openCreateModal(),
                    }),
                );
            } else {
                empty.innerHTML =
                    '<p class="staff-muted-text font-semibold">No coupons yet.</p>';
            }
            empty.classList.remove("hidden");
        }
        return;
    }
    if (!sorted.length) {
        table.classList.add("hidden");
        if (empty) {
            if (window.HeigenUI) {
                empty.innerHTML = "";
                empty.appendChild(
                    window.HeigenUI.emptyState({
                        icon: "search",
                        title: "No coupons match your search",
                        text: "Check the spelling, or clear the search box to see every coupon.",
                        actionLabel: "Clear search",
                        onAction: () => {
                            const si = document.getElementById("couponsSearchInput");
                            if (si) {
                                si.value = "";
                                si.dispatchEvent(new Event("input", { bubbles: true }));
                            }
                        },
                    }),
                );
            } else {
                empty.innerHTML =
                    '<p class="staff-muted-text font-semibold">No coupons match your search.</p>';
            }
            empty.classList.remove("hidden");
        }
        return;
    }
    table.classList.remove("hidden");
    if (empty) empty.classList.add("hidden");
}

async function loadCoupons() {
    const loading = document.getElementById("listLoading");
    const table = document.getElementById("couponsTable");
    const empty = document.getElementById("couponsEmpty");
    loading.classList.remove("hidden");
    table.classList.add("hidden");
    if (empty) empty.classList.add("hidden");
    try {
        coupons = await window.apiClient.coupons.list();
        renderCouponsTable(couponPage);
    } catch (e) {
        loading.classList.add("hidden");
        showToast(e.message || "Failed to load coupons", "error");
    }
}

function escapeHtml(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}

/** Renewal column: API sends 0..1 from Snaplytics. */
function formatSendRenewalDisplay(c) {
    if (c.renewalRate == null) return "—";
    const p = Number(c.renewalRate);
    if (Number.isNaN(p)) return "—";
    return `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
}

function formatSendBookingsCount(c) {
    const n = c.bookings;
    if (n == null || Number.isNaN(Number(n))) return "0";
    return String(Math.max(0, Math.floor(Number(n))));
}

function toggleCodeMode(mode) {
    const input = document.getElementById("couponCode");
    const btn = document.getElementById("generateCodeBtn");
    if (mode === "manual") {
        input.disabled = false;
        input.placeholder = "e.g. WELCOMEBACK20";
        input.value = "";
        btn.classList.add("hidden");
    } else {
        input.disabled = false;
        input.placeholder = "Click Generate to create a code";
        btn.classList.remove("hidden");
        if (!input.value) generateRandomCode();
    }
}

function generateRandomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    document.getElementById("couponCode").value = code;
}

function openCreateModal() {
    editingId = null;
    document.getElementById("couponModalTitle").textContent = "Create Coupon";
    document.getElementById("couponCode").value = "";
    document.getElementById("couponCode").disabled = false;
    document.getElementById("codeModeOptions").style.display = "flex";
    document.querySelector('input[name="codeMode"][value="manual"]').checked = true;
    toggleCodeMode("manual");
    document.getElementById("couponDiscountType").value = "percent";
    document.getElementById("couponDiscountValue").value = "";
    document.getElementById("couponUseLimit").value = "";
    document.getElementById("couponMaxDiscount").value = "";
    document.getElementById("couponExpires").value = "";
    setFlexModalVisible("couponModal", true);
}

function openEditModal(id) {
    const c = coupons.find((x) => x.id === id);
    if (!c) return;
    editingId = id;
    document.getElementById("couponModalTitle").textContent = "Edit Coupon";
    document.getElementById("couponCode").value = c.code;
    document.getElementById("couponCode").disabled = true;
    document.getElementById("codeModeOptions").style.display = "none";
    document.getElementById("generateCodeBtn").classList.add("hidden");
    document.getElementById("couponDiscountType").value = c.discount_type;
    document.getElementById("couponDiscountValue").value = c.discount_value;
    document.getElementById("couponUseLimit").value = c.use_limit ?? "";
    document.getElementById("couponMaxDiscount").value = c.max_discount_amount ?? "";
    document.getElementById("couponExpires").value = c.expires_at ? c.expires_at.slice(0, 16) : "";
    setFlexModalVisible("couponModal", true);
}

function closeCouponModal() {
    setFlexModalVisible("couponModal", false);
}

async function saveCoupon() {
    const code = document.getElementById("couponCode").value.trim();
    const discountType = document.getElementById("couponDiscountType").value;
    const discountValue = parseFloat(document.getElementById("couponDiscountValue").value);
    const useLimit = document.getElementById("couponUseLimit").value.trim();
    const maxDiscount = document.getElementById("couponMaxDiscount").value.trim();
    const expires = document.getElementById("couponExpires").value;

    if (!code) {
        showToast("Code is required", "error");
        return;
    }
    if (isNaN(discountValue) || discountValue <= 0) {
        showToast("Valid discount value is required", "error");
        return;
    }

    const data = {
        code,
        discount_type: discountType,
        discount_value: discountValue,
        use_limit: useLimit ? parseInt(useLimit, 10) : null,
        max_discount_amount: maxDiscount ? parseFloat(maxDiscount) : null,
        expires_at: expires ? new Date(expires).toISOString() : null,
    };

    const btn = document.getElementById("couponSaveBtn");
    btn.disabled = true;
    try {
        if (editingId) {
            await window.apiClient.coupons.update(editingId, data);
            showToast("Coupon updated");
        } else {
            await window.apiClient.coupons.create(data);
            showToast("Coupon created");
        }
        closeCouponModal();
        loadCoupons();
    } catch (e) {
        showToast(e.message || "Failed to save", "error");
    } finally {
        btn.disabled = false;
    }
}

async function deleteCoupon(id) {
    const c = coupons.find((x) => x.id === id);
    const label = c ? c.code : String(id);
    const ok = await window.heigenConfirm(`Delete coupon "${label}"?`, {
        title: "Delete coupon",
        confirmText: "Delete",
        dangerous: true,
    });
    if (!ok) return;
    try {
        await window.apiClient.coupons.remove(id);
        showToast("Coupon deleted");
        loadCoupons();
    } catch (e) {
        showToast(e.message || "Failed to delete", "error");
    }
}

function formatCouponDateTime(iso) {
    if (!iso) return "—";
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return "—";
        return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch (_) {
        return "—";
    }
}

async function openHistoryModal(id) {
    const c = coupons.find((x) => x.id === id);
    if (!c) return;
    document.getElementById("historyModalTitle").textContent = `Coupon history — ${c.code}`;
    setFlexModalVisible("historyModal", true);
    document.getElementById("historyLoading").classList.remove("hidden");
    document.getElementById("historyContent").classList.add("hidden");
    try {
        const data = await window.apiClient.coupons.history(id);
        document.getElementById("historyLoading").classList.add("hidden");
        document.getElementById("historyContent").classList.remove("hidden");
        historyRecipients = data.recipients || [];
        historyRedemptions = data.redemptions || [];
        renderHistoryRecipients(1);
        renderHistoryRedemptions(1);
    } catch (e) {
        document.getElementById("historyLoading").classList.add("hidden");
        showToast(e.message || "Failed to load history", "error");
        closeHistoryModal();
    }
}

const HISTORY_PER_PAGE = 20;
let historyRecipients = [];
let historyRedemptions = [];

function historyPageRows(rows, page, pagerId, goFn) {
    const cur = renderPager(pagerId, page, rows.length, HISTORY_PER_PAGE, goFn);
    return rows.slice((cur - 1) * HISTORY_PER_PAGE, cur * HISTORY_PER_PAGE);
}

function renderHistoryRecipients(page = 1) {
    const recBody = document.getElementById("historyRecipientsBody");
    const rows = historyPageRows(historyRecipients, page, "historyRecipientsPagination", "renderHistoryRecipients");
    if (!rows.length) {
        recBody.innerHTML = `<tr><td colspan="6" class="px-3 py-4 text-center staff-muted-text">No customers linked to this coupon yet.</td></tr>`;
    } else {
        recBody.innerHTML = rows.map((r) => {
            const name = escapeHtml(r.name || "");
            const email = escapeHtml(r.email || "");
            const cid = r.customer_id;
            const src =
                r.source === "redeemed_only"
                    ? "Redeem only"
                    : escapeHtml(r.sender_label || "Staff send / register");
            return `<tr class="border-b border-[color:var(--heigen-border-ui)]">
                <td class="px-3 py-2"><a href="customer-details.html?id=${cid}" class="staff-nested-table-link">${name || "—"}</a></td>
                <td class="px-3 py-2">${email || "—"}</td>
                <td class="px-3 py-2">${formatCouponDateTime(r.sent_at)}</td>
                <td class="px-3 py-2">${formatCouponDateTime(r.email_sent_at)}</td>
                <td class="px-3 py-2">${src}</td>
                <td class="px-3 py-2 text-right tabular-nums">${r.times_used ?? 0}</td>
            </tr>`;
        }).join("");
    }
}

function renderHistoryRedemptions(page = 1) {
    const redBody = document.getElementById("historyRedemptionsBody");
    const rows = historyPageRows(historyRedemptions, page, "historyRedemptionsPagination", "renderHistoryRedemptions");
    if (!rows.length) {
        redBody.innerHTML = `<tr><td colspan="7" class="px-3 py-4 text-center staff-muted-text">No redemptions recorded yet.</td></tr>`;
    } else {
        redBody.innerHTML = rows.map((r) => {
            const name = escapeHtml(r.name || "");
            const email = escapeHtml(r.email || "");
            const pkg = [r.package_category, r.package_name].filter(Boolean).join(" · ") || "—";
            const cid = r.customer_id;
            const bid = r.booking_id;
            const sessionCell = `${r.session_date ? formatCouponDateTime(r.session_date) : "—"}${
                r.session_status
                    ? ` <span class="opacity-80">(${escapeHtml(r.session_status)})</span>`
                    : ""
            }`;
            return `<tr class="border-b border-[color:var(--heigen-border-ui)]">
                <td class="px-3 py-2"><a href="customer-details.html?id=${cid}" class="staff-nested-table-link">${name || "—"}</a></td>
                <td class="px-3 py-2">${email || "—"}</td>
                <td class="px-3 py-2">${formatCouponDateTime(r.used_at)}</td>
                <td class="px-3 py-2 text-right tabular-nums">₱${Number(r.discount_amount).toLocaleString()}</td>
                <td class="px-3 py-2">${sessionCell}</td>
                <td class="px-3 py-2">${escapeHtml(pkg)}</td>
                <td class="px-3 py-2 font-mono tabular-nums">#${bid}</td>
            </tr>`;
        }).join("");
    }
}

function closeHistoryModal() {
    setFlexModalVisible("historyModal", false);
}

// ── Built-in starter templates (read-only; "Save" makes an editable copy) ──
// Email-client-safe HTML: tables + inline styles, no external CSS or images.
// Studio-supplied design. Placeholders are filled per customer when sent.
const BUILTIN_COUPON_BOOKING_URL = "https://www.facebook.com/heigenstudio";
const BUILTIN_COUPON_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>A little something for your next visit!</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
</head>
<body style="margin: 0; padding: 0; background-color: #f3f6f8; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #244855;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f3f6f8; padding: 32px 16px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #244855;">
    <tr>
      <td align="center">
        <!-- Main Container -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 560px; background-color: #ffffff; border: 1px solid #d9e2e6; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(36, 72, 85, 0.06);">

          <!-- Header -->
          <tr>
            <td style="background-color: #244855; padding: 24px 32px; text-align: center;">
              <span style="font-family: 'Montserrat', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 20px; font-weight: 700; letter-spacing: 0.6px; color: #ffffff;">HEIGEN STUDIO</span>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 36px 32px 28px 32px;">
              <h1 style="margin: 0 0 16px 0; font-family: 'Montserrat', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 22px; font-weight: 700; color: #244855; line-height: 1.3;">
                A little something for your next visit!
              </h1>

              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #365c6b;">
                Hi {customer_name},
              </p>

              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #365c6b;">
                We’d love to see you again! To thank you for choosing us, here is a special discount for your next session with us.
              </p>

              <!-- Highlighted Coupon Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 0 0 28px 0;">
                <tr>
                  <td align="center" style="background-color: #f4f8f9; border: 2px dashed #244855; border-radius: 10px; padding: 22px 16px;">
                    <p style="margin: 0 0 10px 0; font-family: 'Montserrat', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.2px; color: #527380;">
                      Your Personal Coupon Code
                    </p>
                    <div style="display: inline-block; background-color: #244855; color: #ffffff; font-family: 'Montserrat', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 22px; font-weight: 700; letter-spacing: 1.5px; padding: 10px 26px; border-radius: 6px;">
                      {{coupon_code}}
                    </div>
                    <p style="margin: 12px 0 0 0; font-size: 14px; font-weight: 600; color: #244855;">
                      {{coupon_details}}
                    </p>
                    <p style="margin: 6px 0 0 0; font-size: 13px; color: #527380;">
                      Apply this code at checkout or when booking your next visit
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 0 0 28px 0;">
                <tr>
                  <td align="center">
                    <a href="${BUILTIN_COUPON_BOOKING_URL}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #244855; color: #ffffff; font-family: 'Montserrat', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 0.4px; text-decoration: none; padding: 14px 28px; border-radius: 8px;">
                      Book Your Next Session
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #527380;">
                If you have any questions or need help scheduling, just reply to this email—we’re always happy to help.
              </p>

              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #365c6b;">
                See you soon,<br />
                <strong style="font-family: 'Montserrat', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #244855;">The Heigen Studio Team</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f4f8f9; padding: 16px 32px; text-align: center; border-top: 1px solid #d9e2e6;">
              <p style="margin: 0; font-size: 12px; color: #6c8a96;">
                © ${new Date().getFullYear()} Heigen Studio. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const BUILTIN_EMAIL_TEMPLATES = [
    {
        id: "builtin:coupon-branded",
        name: "Branded coupon",
        subject: "{customer_name}, here's a little something for your next visit",
        body:
            "Hi {customer_name},\n\n" +
            "We’d love to see you again! To thank you for choosing us, here is a special discount for your next session with us.\n\n" +
            "Your personal coupon code: {{coupon_code}}\n{{coupon_details}}\n" +
            "Apply this code at checkout or when booking your next visit.\n\n" +
            `Book your next session: ${BUILTIN_COUPON_BOOKING_URL}\n\n` +
            "If you have any questions or need help scheduling, just reply to this email—we’re always happy to help.\n\n" +
            "See you soon,\nThe Heigen Studio Team",
        html_body: BUILTIN_COUPON_HTML,
    },
];

// ── Yearly occasion templates ────────────────────────────────────────
// Same layout as the Branded coupon, re-coloured and re-worded per occasion.
// `on` is the (approximate) month/day, used only to list the next occasion first.
const OCCASION_TEMPLATES = [
    {
        key: "new-year", name: "New Year", emoji: "🎆", on: [1, 1],
        colors: { header: "#1c2541", accent: "#b8892b", soft: "#fbf7ee", page: "#f2f3f7", heading: "#1c2541" },
        subject: "🎆 {customer_name}, start the new year with a fresh photo session",
        eyebrow: "Happy New Year",
        headline: "New year, new memories!",
        intro: "Kick off the year with a session at Heigen Studio. Whether it's a fresh portrait or a family photo to start the year right, here's a gift to get you started.",
        couponLabel: "Your New Year Coupon",
        signoff: "Here's to a wonderful year,",
    },
    {
        key: "valentines", name: "Valentine's Day", emoji: "💝", on: [2, 14],
        colors: { header: "#8c1d40", accent: "#c2185b", soft: "#fdf0f4", page: "#f9f1f3", heading: "#8c1d40" },
        subject: "💝 A little love from Heigen Studio, {customer_name}",
        eyebrow: "Happy Valentine's Day",
        headline: "Celebrate the people you love",
        intro: "Capture the moments that matter with your favorite person, whether that's your partner, your best friend, or the whole family. Here's a sweet discount for your Valentine's session.",
        couponLabel: "Your Valentine's Coupon",
        signoff: "With love,",
    },
    {
        key: "summer", name: "Summer", emoji: "☀️", on: [4, 1],
        colors: { header: "#0e6f78", accent: "#e07a1f", soft: "#fff5ea", page: "#eef6f6", heading: "#0e6f78" },
        subject: "☀️ Summer sessions are here, {customer_name}!",
        eyebrow: "Summer Sessions",
        headline: "Make this summer one to remember",
        intro: "Sunny days call for fresh photos. Bring the barkada or the whole family and enjoy a special summer discount on your next session.",
        couponLabel: "Your Summer Coupon",
        signoff: "Stay sunny,",
    },
    {
        key: "graduation", name: "Graduation", emoji: "🎓", on: [4, 15],
        colors: { header: "#1f2a44", accent: "#a87b16", soft: "#f8f4e9", page: "#f2f3f6", heading: "#1f2a44" },
        subject: "🎓 Congratulations, grad! A gift for you, {customer_name}",
        eyebrow: "Graduation Season",
        headline: "Celebrate your milestone",
        intro: "Graduation is a moment worth keeping. Mark it with a graduation shoot for the grad or the whole proud family, with a little gift from us.",
        couponLabel: "Your Graduation Coupon",
        signoff: "Congratulations and see you soon,",
    },
    {
        key: "mothers-day", name: "Mother's Day", emoji: "💐", on: [5, 10],
        colors: { header: "#7d3f5f", accent: "#b0567c", soft: "#fbf0f5", page: "#f8f1f4", heading: "#7d3f5f" },
        subject: "💐 Something special for Mom, {customer_name}",
        eyebrow: "Happy Mother's Day",
        headline: "For the moms who do it all",
        intro: "Celebrate Mother's Day with a portrait session she'll treasure, just her or the whole family together. Here's a special discount to make it happen.",
        couponLabel: "Your Mother's Day Coupon",
        signoff: "With love and thanks to every mom,",
    },
    {
        key: "fathers-day", name: "Father's Day", emoji: "👔", on: [6, 21],
        colors: { header: "#22404f", accent: "#2f6690", soft: "#eef4f8", page: "#eff3f5", heading: "#22404f" },
        subject: "👔 Celebrate Dad this Father's Day, {customer_name}",
        eyebrow: "Happy Father's Day",
        headline: "Here's to the dads",
        intro: "Give Dad a memory to keep: a Father's Day session for him, the kids, or the whole family. Here's a little something to help you book it.",
        couponLabel: "Your Father's Day Coupon",
        signoff: "Cheers to all the dads,",
    },
    {
        key: "halloween", name: "Halloween", emoji: "🎃", on: [10, 31],
        colors: { header: "#2b1b3d", accent: "#d9631e", soft: "#fff3ea", page: "#f4f1f6", heading: "#2b1b3d" },
        subject: "🎃 A treat (no tricks) for you, {customer_name}",
        eyebrow: "Happy Halloween",
        headline: "Trick or treat? Definitely treat.",
        intro: "Costumes, spooky props, or matching family looks: this Halloween, let's make it frightfully fun. Here's a treat for your next session.",
        couponLabel: "Your Halloween Treat",
        signoff: "Spooky regards,",
    },
    {
        key: "christmas", name: "Christmas", emoji: "🎄", on: [12, 25],
        colors: { header: "#1f4d36", accent: "#b3262e", soft: "#f3f8f4", page: "#f1f5f2", heading: "#1f4d36" },
        subject: "🎄 Merry Christmas from Heigen Studio, {customer_name}!",
        eyebrow: "Merry Christmas",
        headline: "A holiday gift, just for you",
        intro: "'Tis the season for family photos, matching outfits, and holiday cards. Here's our gift to you for a festive session with your loved ones.",
        couponLabel: "Your Christmas Gift",
        signoff: "Merry Christmas and happy holidays,",
    },
];

const HEADING_FONT = "'Montserrat', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const BODY_FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function occasionCouponHtml(o) {
    const c = o.colors;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${o.headline}</title>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
</head>
<body style="margin: 0; padding: 0; background-color: ${c.page}; font-family: ${BODY_FONT}; color: #244855;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: ${c.page}; padding: 32px 16px; font-family: ${BODY_FONT}; color: #244855;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 560px; background-color: #ffffff; border: 1px solid #d9e2e6; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(36, 72, 85, 0.06);">

          <!-- Header -->
          <tr>
            <td style="background-color: ${c.header}; padding: 22px 32px; text-align: center;">
              <div style="font-size: 28px; line-height: 1; margin-bottom: 8px;">${o.emoji}</div>
              <span style="font-family: ${HEADING_FONT}; font-size: 20px; font-weight: 700; letter-spacing: 0.6px; color: #ffffff;">HEIGEN STUDIO</span>
              <div style="font-family: ${HEADING_FONT}; font-size: 11px; font-weight: 600; letter-spacing: 1.6px; text-transform: uppercase; color: rgba(255, 255, 255, 0.78); margin-top: 6px;">${o.eyebrow}</div>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 36px 32px 28px 32px;">
              <h1 style="margin: 0 0 16px 0; font-family: ${HEADING_FONT}; font-size: 22px; font-weight: 700; color: ${c.heading}; line-height: 1.3;">
                ${o.headline}
              </h1>

              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #365c6b;">
                Hi {customer_name},
              </p>

              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #365c6b;">
                ${o.intro}
              </p>

              <!-- Highlighted Coupon Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 0 0 28px 0;">
                <tr>
                  <td align="center" style="background-color: ${c.soft}; border: 2px dashed ${c.accent}; border-radius: 10px; padding: 22px 16px;">
                    <p style="margin: 0 0 10px 0; font-family: ${HEADING_FONT}; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.2px; color: #527380;">
                      ${o.couponLabel}
                    </p>
                    <div style="display: inline-block; background-color: ${c.accent}; color: #ffffff; font-family: ${HEADING_FONT}; font-size: 22px; font-weight: 700; letter-spacing: 1.5px; padding: 10px 26px; border-radius: 6px;">
                      {{coupon_code}}
                    </div>
                    <p style="margin: 12px 0 0 0; font-size: 14px; font-weight: 600; color: ${c.heading};">
                      {{coupon_details}}
                    </p>
                    <p style="margin: 6px 0 0 0; font-size: 13px; color: #527380;">
                      Apply this code at checkout or when booking your next visit
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 0 0 28px 0;">
                <tr>
                  <td align="center">
                    <a href="${BUILTIN_COUPON_BOOKING_URL}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: ${c.header}; color: #ffffff; font-family: ${HEADING_FONT}; font-size: 14px; font-weight: 600; letter-spacing: 0.4px; text-decoration: none; padding: 14px 28px; border-radius: 8px;">
                      Book Your Session
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #527380;">
                If you have any questions or need help scheduling, just reply to this email—we’re always happy to help.
              </p>

              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #365c6b;">
                ${o.signoff}<br />
                <strong style="font-family: ${HEADING_FONT}; color: ${c.heading};">The Heigen Studio Team</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: ${c.soft}; padding: 16px 32px; text-align: center; border-top: 1px solid #d9e2e6;">
              <p style="margin: 0; font-size: 12px; color: #6c8a96;">
                © ${new Date().getFullYear()} Heigen Studio. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function occasionCouponText(o) {
    return (
        `Hi {customer_name},\n\n${o.headline}\n\n${o.intro}\n\n` +
        `${o.couponLabel}: {{coupon_code}}\n{{coupon_details}}\n` +
        "Apply this code at checkout or when booking your next visit.\n\n" +
        `Book your session: ${BUILTIN_COUPON_BOOKING_URL}\n\n` +
        "If you have any questions or need help scheduling, just reply to this email—we’re always happy to help.\n\n" +
        `${o.signoff}\nThe Heigen Studio Team`
    );
}

/** Days from today until the occasion's next date (0 = today). */
function daysUntilOccasion([month, day], now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let next = new Date(now.getFullYear(), month - 1, day);
    if (next < today) next = new Date(now.getFullYear() + 1, month - 1, day);
    return Math.round((next - today) / 86400000);
}

const OCCASION_SOON_DAYS = 45;
OCCASION_TEMPLATES.forEach((o) => {
    BUILTIN_EMAIL_TEMPLATES.push({
        id: `builtin:occasion-${o.key}`,
        name: `${o.emoji} ${o.name}`,
        occasion: o,
        subject: o.subject,
        body: occasionCouponText(o),
        html_body: occasionCouponHtml(o),
    });
});
let selectedBuiltinTemplateId = null;

function applyBuiltinTemplate(id) {
    const t = BUILTIN_EMAIL_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    selectedEmailPresetId = null;
    selectedBuiltinTemplateId = t.id;
    const sub = document.getElementById("emailSubject");
    const body = document.getElementById("emailBody");
    const htmlBody = document.getElementById("emailHtmlBody");
    if (sub) sub.value = t.subject;
    if (body) body.value = t.body;
    if (htmlBody) htmlBody.value = t.html_body;
    // Show it as the customer will see it.
    setSendComposerView("preview");
    renderPresetList();
}

async function loadEmailPresets() {
    try {
        const list = await window.apiClient.emailTemplates.list();
        emailPresetsCache = Array.isArray(list) ? list : [];
    } catch (e) {
        emailPresetsCache = [];
        showToast(e.message || "Failed to load templates", "error");
    }
    return emailPresetsCache;
}

async function renderPresetList() {
    const el = document.getElementById("presetList");
    if (!el) return;
    const list = await loadEmailPresets();
    const pickClass = (active) =>
        `preset-pick w-full text-left px-2 py-1.5 rounded text-xs font-semibold ${
            active ? "bg-[#165166] text-white" : "hover:bg-gray-100 text-[#424242]"
        }`;
    const builtinButton = (t, badge = "") =>
        `<button type="button" data-builtin-id="${escapeHtml(t.id)}" class="${pickClass(t.id === selectedBuiltinTemplateId)}" title="Ready-made HTML email. Click Save to keep your own editable copy.">${escapeHtml(t.name)}${badge}</button>`;
    const general = BUILTIN_EMAIL_TEMPLATES.filter((t) => !t.occasion).map((t) => builtinButton(t)).join("");
    // Occasions: the next one coming up first, flagged "Soon" when it's close.
    const occasions = BUILTIN_EMAIL_TEMPLATES.filter((t) => t.occasion)
        .map((t) => ({ t, days: daysUntilOccasion(t.occasion.on) }))
        .sort((a, b) => a.days - b.days)
        .map(({ t, days }) =>
            builtinButton(t, days <= OCCASION_SOON_DAYS ? `<span class="send-builtin-badge">Soon</span>` : ""),
        )
        .join("");
    const saved = list.length
        ? list
            .map(
                (p) =>
                    `<button type="button" data-preset-id="${escapeHtml(p.id)}" class="${pickClass(p.id === selectedEmailPresetId)}">${escapeHtml(p.name)}</button>`,
            )
            .join("")
        : `<p class="text-gray-400 text-xs px-1">No saved templates</p>`;
    el.innerHTML =
        `<div class="send-templates-group-label">Saved</div>${saved}` +
        `<div class="send-templates-group-label">Built-in</div>${general}` +
        `<div class="send-templates-group-label">Occasions</div>${occasions}`;
    el.querySelectorAll("[data-preset-id]").forEach((btn) => {
        btn.onclick = () => applyEmailPreset(btn.getAttribute("data-preset-id"));
    });
    el.querySelectorAll("[data-builtin-id]").forEach((btn) => {
        btn.onclick = () => applyBuiltinTemplate(btn.getAttribute("data-builtin-id"));
    });
}

async function applyEmailPreset(id) {
    const p = emailPresetsCache.find((x) => String(x.id) === String(id));
    if (!p) return;
    selectedBuiltinTemplateId = null;
    selectedEmailPresetId = p.id;
    const sub = document.getElementById("emailSubject");
    const body = document.getElementById("emailBody");
    const htmlBody = document.getElementById("emailHtmlBody");
    if (sub) sub.value = p.subject || "";
    if (body) body.value = p.body || "";
    if (htmlBody) htmlBody.value = p.html_body || "";
    refreshHtmlPreview();
    await renderPresetList();
}

function startNewPreset() {
    selectedEmailPresetId = null;
    selectedBuiltinTemplateId = null;
    const nameEl = document.getElementById("presetNameInput");
    const sub = document.getElementById("emailSubject");
    const body = document.getElementById("emailBody");
    const htmlBody = document.getElementById("emailHtmlBody");
    if (nameEl) nameEl.value = "";
    if (sub) sub.value = "";
    if (body) body.value = "";
    if (htmlBody) htmlBody.value = "";
    refreshHtmlPreview();
    renderPresetList();
    showToast("New template started");
}

async function saveCurrentPreset() {
    const nameEl = document.getElementById("presetNameInput");
    const name = (nameEl?.value || "").trim();
    if (!name) {
        showToast("Enter a preset name to save", "error");
        return;
    }
    const subject = (document.getElementById("emailSubject")?.value || "").trim();
    const body = (document.getElementById("emailBody")?.value || "").trim();
    const html_body = (document.getElementById("emailHtmlBody")?.value || "").trim();
    try {
        const created = await window.apiClient.emailTemplates.create({
            name,
            subject,
            body,
            html_body,
        });
        if (nameEl) nameEl.value = "";
        selectedEmailPresetId = created?.id ?? null;
        selectedBuiltinTemplateId = null;
        await renderPresetList();
        showToast("Template saved");
    } catch (e) {
        showToast(e.message || "Failed to save template", "error");
    }
}

async function updateSelectedPreset() {
    if (selectedBuiltinTemplateId) {
        showToast("Built-in templates can't be changed. Enter a name and click Save to keep your own copy.", "error");
        return;
    }
    if (!selectedEmailPresetId) {
        showToast("Select a preset first, then click Update", "error");
        return;
    }
    const nameEl = document.getElementById("presetNameInput");
    const newName = (nameEl?.value || "").trim();
    const subject = (document.getElementById("emailSubject")?.value || "").trim();
    const body = (document.getElementById("emailBody")?.value || "").trim();
    const html_body = (document.getElementById("emailHtmlBody")?.value || "").trim();
    const existing = emailPresetsCache.find(
        (p) => String(p.id) === String(selectedEmailPresetId),
    );
    if (!existing) {
        showToast("Selected preset no longer exists", "error");
        return;
    }
    try {
        await window.apiClient.emailTemplates.update(selectedEmailPresetId, {
            name: newName || existing.name,
            subject,
            body,
            html_body,
        });
        if (nameEl) nameEl.value = "";
        await renderPresetList();
        showToast("Template updated");
    } catch (e) {
        showToast(e.message || "Failed to update template", "error");
    }
}

async function deleteSelectedPreset() {
    if (selectedBuiltinTemplateId) {
        showToast("Built-in templates can't be deleted.", "error");
        return;
    }
    if (!selectedEmailPresetId) {
        showToast("Select a preset first", "error");
        return;
    }
    const ok = await window.heigenConfirm("Delete this email template preset?", {
        title: "Delete preset",
        confirmText: "Delete",
        dangerous: true,
    });
    if (!ok) return;
    try {
        await window.apiClient.emailTemplates.remove(selectedEmailPresetId);
        selectedEmailPresetId = null;
        await renderPresetList();
        showToast("Template deleted");
    } catch (e) {
        showToast(e.message || "Failed to delete template", "error");
    }
}

function ensureSendFiltersModule() {
    return typeof window.customerFilters !== "undefined";
}

function resetSendFilterFormWidgets() {
    const riskEl = document.getElementById(SEND_FILTER_IDS.risk);
    if (riskEl) riskEl.value = "all";
    const sortEl = document.getElementById("sendSortSelect");
    if (sortEl) sortEl.value = "name-asc";
    const bookEl = document.getElementById(SEND_FILTER_IDS.booking);
    if (bookEl) bookEl.value = "all";
    const df = document.getElementById(SEND_FILTER_IDS.dateFrom);
    const dt = document.getElementById(SEND_FILTER_IDS.dateTo);
    if (df) df.value = "";
    if (dt) dt.value = "";
    const searchEl = document.getElementById("sendSearchInput");
    if (searchEl) searchEl.value = "";
}

function applySendFiltersFromForm() {
    if (!ensureSendFiltersModule()) return;
    const f = window.customerFilters;
    if (!sendAppliedFilterState) {
        sendAppliedFilterState = f.createDefaultCustomerFilterState();
    }
    f.readStateFromDom(SEND_FILTER_IDS, sendAppliedFilterState);
    sendAppliedSearch =
        document.getElementById("sendSearchInput")?.value.trim() || "";
    renderSendCustomerList();
}

/** Applied Send filters as /api/customers/ query params (same names as Customer Data). */
function sendCustomerQueryParams() {
    const st = sendAppliedFilterState || {};
    const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
    return {
        search: sendAppliedSearch,
        risk: st.renewalRisk === "all" ? "" : st.renewalRisk,
        booking: st.bookingActivity === "all" ? "" : st.bookingActivity,
        date_from: day(st.dateFrom),
        date_to: day(st.dateTo),
        sort: document.getElementById("sendSortSelect")?.value || "name-asc",
    };
}

async function selectAllFilteredCustomers() {
    try {
        const res = await window.apiClient.customers.listPage({
            ...sendCustomerQueryParams(),
            ids_only: 1,
        });
        (res?.ids || []).forEach((id) => selectedCustomerIds.add(id));
        await renderSendCustomerList(sendPage);
    } catch (e) {
        showToast(e.message || "Failed to select customers", "error");
    }
}

function clearSendSelection() {
    selectedCustomerIds = new Set();
    renderSendCustomerList(sendPage);
}

async function openSendModal(id) {
    if (!ensureSendFiltersModule()) {
        showToast("Filter module missing. Reload the page.", "error");
        return;
    }
    sendCouponId = id;
    selectedCustomerIds = new Set();
    selectedEmailPresetId = null;
    selectedBuiltinTemplateId = null;
    sendAppliedFilterState =
        window.customerFilters.createDefaultCustomerFilterState();
    sendAppliedSearch = "";
    resetSendFilterFormWidgets();

    const subEl = document.getElementById("emailSubject");
    const bodyEl = document.getElementById("emailBody");
    const htmlBodyEl = document.getElementById("emailHtmlBody");
    if (subEl) subEl.value = "";
    if (bodyEl) bodyEl.value = "";
    if (htmlBodyEl) htmlBodyEl.value = "";
    setEmailImportImagePreview("");
    sendCustomerNames = new Map();
    sendLastField = null;
    sendHtmlView = "preview";
    composerModalViewMode = "preview";
    const textRadio = document.getElementById("emailModeText");
    if (textRadio) textRadio.checked = true;
    setInlineComposerByRadio();
    const hint = document.getElementById("sendModalHint");
    const couponRow = coupons.find((x) => x.id === id);
    if (hint) {
        const code = escapeTemplateValue(couponRow ? couponRow.code : "the coupon code");
        const details = escapeTemplateValue(couponDetailsText(couponRow) || "discount and expiry");
        hint.innerHTML =
            "Tip: these are filled in for each customer in the subject and message: " +
            "<code>{customer_name}</code> → their name (or “there” if none is on file) · " +
            `<code>{{code}}</code> / <code>{{coupon}}</code> → <strong>${code}</strong> · ` +
            `<code>{{coupon_details}}</code> → ${details}.`;
    }
    const chip = document.getElementById("sendModalCouponCode");
    if (chip) {
        chip.textContent = couponRow ? couponRow.code : "";
        chip.classList.toggle("hidden", !couponRow);
    }
    sendMatchCount = 0;
    updateSendSelectionSummary();
    syncComposerSizing();
    renderPresetList();
    const searchEl = document.getElementById("sendSearchInput");
    try {
        await renderSendCustomerList();
        setFlexModalVisible("sendModal", true);
    } catch (e) {
        showToast(e.message || "Failed to load customers", "error");
    }

    if (searchEl) {
        searchEl.onkeydown = (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                applySendFiltersFromForm();
            }
        };
    }

    const applyBtn = document.getElementById("sendFilterApplyBtn");
    if (applyBtn) applyBtn.onclick = () => applySendFiltersFromForm();
    const sortSelect = document.getElementById("sendSortSelect");
    if (sortSelect) sortSelect.onchange = () => renderSendCustomerList(1);
    const clearBtn = document.getElementById("sendFilterClearBtn");
    if (clearBtn) {
        clearBtn.onclick = () => {
            resetSendFilterFormWidgets();
            sendAppliedFilterState =
                window.customerFilters.createDefaultCustomerFilterState();
            sendAppliedSearch = "";
            renderSendCustomerList();
        };
    }
}

/** Fetches one page from /api/customers/ (server filters) so the tunnel never sends the full list. */
async function renderSendCustomerList(page = 1) {
    if (!ensureSendFiltersModule()) return;
    if (!sendAppliedFilterState) {
        sendAppliedFilterState =
            window.customerFilters.createDefaultCustomerFilterState();
    }
    const list = document.getElementById("sendCustomerList");
    if (!list) return;
    const requestId = ++sendListRequest;
    list.innerHTML = `<p class="p-4 text-center text-sm text-gray-500">Loading customers…</p>`;
    let data;
    try {
        data = await window.apiClient.customers.listPage({
            ...sendCustomerQueryParams(),
            page,
            page_size: SEND_CUSTOMERS_PER_PAGE,
        });
    } catch (e) {
        if (requestId !== sendListRequest) return;
        list.innerHTML = `<p class="p-4 text-center text-sm text-red-700">Could not load customers: ${escapeHtml(e.message || "")}</p>`;
        return;
    }
    if (requestId !== sendListRequest) return; // a newer page/filter request won
    const rows = Array.isArray(data?.results) ? data.results : [];
    rows.forEach((c) => sendCustomerNames.set(c.id ?? c.customer_id, c.name || ""));
    sendMatchCount = Number(data?.count) || 0;
    sendPage = renderPager("sendCustomerPagination", page, sendMatchCount, SEND_CUSTOMERS_PER_PAGE, "renderSendCustomerList");
    updateSendSelectionSummary();
    if (!rows.length) {
        list.innerHTML =
            `<p class="p-6 text-center text-sm text-gray-500">No customers match these filters.</p>`;
        return;
    }
    list.innerHTML = rows
        .map((c) => {
            const id = c.id ?? c.customer_id;
            const checked = selectedCustomerIds.has(id);
            const name = escapeHtml(c.name || c.email || "—");
            const email = escapeHtml(c.email || "");
            const renewal = escapeHtml(formatSendRenewalDisplay(c));
            const bookings = Number(formatSendBookingsCount(c));
            const bandClass =
                c.renewalBand === "likely" ? "send-pill--likely" : c.renewalBand === "unlikely" ? "send-pill--risk" : "";
            const bandTitle =
                c.renewalBand === "likely" ? "Likely to renew" : c.renewalBand === "unlikely" ? "At risk" : "No prediction";
            return `
                <label class="send-customer-row${checked ? " is-selected" : ""}">
                    <input type="checkbox" class="flex-shrink-0 w-4 h-4 accent-[#165166]" ${checked ? "checked" : ""} onchange="toggleSendCustomer(${id}, this.checked, this)">
                    <span class="flex-1 min-w-0 leading-tight">
                        <span class="send-customer-name">${name}</span>
                        <span class="send-customer-email">${email || "—"}</span>
                    </span>
                    <span class="send-pill ${bandClass}" title="${bandTitle}">${c.renewalRate == null ? "No score" : `${renewal} renew`}</span>
                    <span class="send-pill" title="Bookings">${bookings} booking${bookings === 1 ? "" : "s"}</span>
                </label>`;
        })
        .join("");
}

function toggleSendCustomer(id, checked, input) {
    if (checked) selectedCustomerIds.add(id);
    else selectedCustomerIds.delete(id);
    input?.closest(".send-customer-row")?.classList.toggle("is-selected", checked);
    updateSendSelectionSummary();
}

/** "N selected of M matching" above the list and "Sending to N" in the footer. */
function updateSendSelectionSummary() {
    const n = selectedCustomerIds.size;
    const top = document.getElementById("sendSelectionSummary");
    if (top) {
        top.textContent = `${n.toLocaleString()} selected · ${sendMatchCount.toLocaleString()} matching`;
    }
    const foot = document.getElementById("sendFooterSummary");
    if (foot) {
        foot.innerHTML = n
            ? `Sending to <strong class="text-[#165166]">${n.toLocaleString()}</strong> customer${n === 1 ? "" : "s"}`
            : "No customers selected";
    }
    refreshPreviewIfRecipientChanged();
}

function closeSendModal() {
    setFlexModalVisible("sendModal", false);
    setEmailImportImagePreview("");
    closeComposerFullscreen();
    endComposerResize();
}

function syncComposerSizing() {
    // The preview card sizes to its iframe (taller for HTML, shorter for plain text).
    const htmlInput = document.getElementById("emailHtmlBody");
    if (htmlInput) htmlInput.style.height = `${composerEditorHeight}px`;
}

function setComposerPaneHeights(editorPx, previewPx) {
    const minEditor = 120;
    const minPreview = 160;
    composerEditorHeight = Math.max(minEditor, Math.floor(editorPx));
    composerPreviewHeight = Math.max(minPreview, Math.floor(previewPx));
    syncComposerSizing();
    refreshHtmlPreview();
}

function beginComposerResize(e) {
    const pointerY = e.clientY ?? (e.touches && e.touches[0] && e.touches[0].clientY);
    if (pointerY == null) return;
    composerResizeDragging = true;
    composerResizeStartY = pointerY;
    composerResizeStartEditor = composerEditorHeight;
    composerResizeStartPreview = composerPreviewHeight;
    document.body.style.userSelect = "none";
}

function moveComposerResize(e) {
    if (!composerResizeDragging) return;
    const pointerY = e.clientY ?? (e.touches && e.touches[0] && e.touches[0].clientY);
    if (pointerY == null) return;
    const delta = pointerY - composerResizeStartY;
    setComposerPaneHeights(
        composerResizeStartEditor + delta,
        composerResizeStartPreview - delta,
    );
}

function endComposerResize() {
    if (!composerResizeDragging) return;
    composerResizeDragging = false;
    document.body.style.userSelect = "";
}

function syncFullscreenPreview() {
    const frame = document.getElementById("composerFullscreenPreviewFrame");
    const htmlInput = document.getElementById("emailHtmlBody");
    if (!frame || !htmlInput) return;
    const recipient = previewRecipient();
    frame.srcdoc = buildGmailLikePreviewSrcdoc(htmlInput.value, recipient.name);
    const asEl = document.getElementById("composerFullscreenPreviewAs");
    if (asEl) asEl.innerHTML = previewAsLabelHtml(recipient);
    const subjectEl = document.getElementById("composerFullscreenSubject");
    if (subjectEl) {
        const subjectRaw = document.getElementById("emailSubject")?.value || "";
        subjectEl.textContent =
            renderCouponTemplate(subjectRaw, recipient.name, currentSendCoupon(), false) || "(no subject yet)";
    }
}

function setInlineComposerByRadio() {
    const mode = getEmailComposerMode();
    const textWrap = document.getElementById("emailTextWrap");
    const htmlWrap = document.getElementById("emailHtmlWrap");
    const previewWrap = document.getElementById("emailPreviewWrap");
    const resizeHandle = document.getElementById("htmlComposerResizeHandle");
    if (!textWrap || !htmlWrap || !previewWrap || !resizeHandle) return;
    resizeHandle.classList.add("hidden");
    if (mode === "html") {
        // Staff see the rendered email first; raw HTML only on "Edit HTML".
        const source = sendHtmlView === "source";
        textWrap.classList.add("hidden");
        htmlWrap.classList.toggle("hidden", !source);
        previewWrap.classList.toggle("hidden", source);
    } else {
        // Plain text: editor with the personalised preview right below it.
        textWrap.classList.remove("hidden");
        htmlWrap.classList.add("hidden");
        previewWrap.classList.remove("hidden");
    }
    const active = sendComposerSwitchKey();
    document.querySelectorAll("#sendComposerSwitch .send-tab").forEach((t) => {
        const on = t.getAttribute("data-send-switch") === active;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-pressed", on ? "true" : "false");
    });
    // Import image adds to the HTML; nothing to edit on the read-only Visual Preview.
    const imageTools = document.getElementById("sendImageTools");
    if (imageTools) imageTools.hidden = active === "preview";
    refreshHtmlPreview();
}

/** Which segment of the switcher is active: "preview" | "source" | "text". */
function sendComposerSwitchKey() {
    return getEmailComposerMode() === "text" ? "text" : sendHtmlView;
}

/** Switcher click: sets the underlying mode radio + HTML view in one step. */
function setSendComposerView(key, { focus = false } = {}) {
    const radio = document.getElementById(key === "text" ? "emailModeText" : "emailModeHtml");
    if (radio) radio.checked = true;
    if (key !== "text") sendHtmlView = key === "source" ? "source" : "preview";
    setInlineComposerByRadio();
    if (!focus) return;
    if (key === "source") document.getElementById("emailHtmlBody")?.focus();
    else if (key === "text") document.getElementById("emailBody")?.focus();
}

function setSendHtmlView(view, { focus = false } = {}) {
    sendHtmlView = view === "source" ? "source" : "preview";
    setInlineComposerByRadio();
    if (focus && sendHtmlView === "source") document.getElementById("emailHtmlBody")?.focus();
}

/** Insert text at the caret of an input/textarea (or at the end if it never had focus). */
function insertAtCaret(el, token) {
    if (!el) return;
    const len = el.value.length;
    const start = typeof el.selectionStart === "number" ? el.selectionStart : len;
    const end = typeof el.selectionEnd === "number" ? el.selectionEnd : start;
    el.focus();
    el.setRangeText(token, start, end, "end");
}

/** Insert chip above subject/body: goes into the subject if that was last focused, else the body. */
function insertSendVariable(token) {
    let target;
    if (sendLastField === "emailSubject") {
        target = document.getElementById("emailSubject");
    } else if (getEmailComposerMode() === "html") {
        if (sendHtmlView !== "source") setSendHtmlView("source");
        target = document.getElementById("emailHtmlBody");
    } else {
        target = document.getElementById("emailBody");
    }
    insertAtCaret(target, token);
    refreshHtmlPreview();
}

/** Insert chip inside the expanded HTML editor. */
function insertFullscreenVariable(token) {
    if (composerModalViewMode === "preview") setComposerModalView("both");
    const editor = document.getElementById("composerFullscreenEditor");
    insertAtCaret(editor, token);
    const base = document.getElementById("emailHtmlBody");
    if (base && editor) base.value = editor.value;
    refreshHtmlPreview();
}

function setComposerModalView(mode) {
    composerModalViewMode = mode;
    const editorWrap = document.getElementById("composerFullscreenEditorWrap");
    const previewWrap = document.getElementById("composerFullscreenPreviewWrap");
    const editorBtn = document.getElementById("fullscreenEditorOnlyBtn");
    const previewBtn = document.getElementById("fullscreenPreviewOnlyBtn");
    const bothBtn = document.getElementById("fullscreenBothBtn");
    if (!editorWrap || !previewWrap) return;
    if (mode === "editor") {
        editorWrap.classList.remove("hidden");
        previewWrap.classList.add("hidden");
    } else if (mode === "preview") {
        editorWrap.classList.add("hidden");
        previewWrap.classList.remove("hidden");
        syncFullscreenPreview();
    } else {
        editorWrap.classList.remove("hidden");
        previewWrap.classList.remove("hidden");
        syncFullscreenPreview();
    }
    if (editorBtn) editorBtn.classList.toggle("bg-[#165166]", mode === "editor");
    if (editorBtn) editorBtn.classList.toggle("text-white", mode === "editor");
    if (previewBtn) previewBtn.classList.toggle("bg-[#165166]", mode === "preview");
    if (previewBtn) previewBtn.classList.toggle("text-white", mode === "preview");
    if (bothBtn) bothBtn.classList.toggle("bg-[#165166]", mode === "both");
    if (bothBtn) bothBtn.classList.toggle("text-white", mode === "both");
}

function openComposerFullscreen() {
    const modal = document.getElementById("composerFullscreenModal");
    const title = document.getElementById("composerFullscreenTitle");
    const editorWrap = document.getElementById("composerFullscreenEditorWrap");
    const previewWrap = document.getElementById("composerFullscreenPreviewWrap");
    const editor = document.getElementById("composerFullscreenEditor");
    const htmlInput = document.getElementById("emailHtmlBody");
    if (!modal || !title || !editorWrap || !previewWrap || !htmlInput) return;

    composerFullscreenMode = "workspace";
    composerIsMinimized = false;
    const dock = document.getElementById("composerMinimizedDock");
    if (dock) {
        dock.classList.add("hidden");
        dock.classList.remove("flex");
    }
    modal.classList.remove("hidden");
    title.textContent = "HTML Editor";
    editorWrap.classList.remove("hidden");
    previewWrap.classList.remove("hidden");
    if (editor) editor.value = htmlInput.value || "";
    setComposerModalView(composerModalViewMode || "preview");
    if (editor && composerModalViewMode !== "preview") editor.focus();
}

function closeComposerFullscreen() {
    const modal = document.getElementById("composerFullscreenModal");
    const editor = document.getElementById("composerFullscreenEditor");
    const htmlInput = document.getElementById("emailHtmlBody");
    const dock = document.getElementById("composerMinimizedDock");
    if (!modal) return;
    if (editor && htmlInput) {
        htmlInput.value = editor.value || "";
        refreshHtmlPreview();
    }
    composerFullscreenMode = null;
    composerIsMinimized = false;
    modal.classList.add("hidden");
    if (dock) {
        dock.classList.add("hidden");
        dock.classList.remove("flex");
    }
}

function minimizeComposerFullscreen() {
    const modal = document.getElementById("composerFullscreenModal");
    const dock = document.getElementById("composerMinimizedDock");
    if (!modal || !composerFullscreenMode) return;
    modal.classList.add("hidden");
    composerIsMinimized = true;
    if (dock) {
        dock.classList.remove("hidden");
        dock.classList.add("flex");
    }
}

function restoreComposerFullscreen() {
    const modal = document.getElementById("composerFullscreenModal");
    const dock = document.getElementById("composerMinimizedDock");
    if (!modal || !composerFullscreenMode) return;
    composerIsMinimized = false;
    modal.classList.remove("hidden");
    if (dock) {
        dock.classList.add("hidden");
        dock.classList.remove("flex");
    }
    syncFullscreenPreview();
}

function getEmailComposerMode() {
    return document.querySelector('input[name="emailBodyMode"]:checked')?.value || "text";
}

// ── Per-customer variables ───────────────────────────────────────────
// Mirrors the server's _render_coupon_template (endpoints/views/coupons.py):
// one pass, so a customer's name is never itself scanned for placeholders, and
// values are HTML-escaped in HTML mode. Same rules → preview matches the email.
const COUPON_TOKEN_RE =
    /\{\{\s*(code|coupon|coupon_code|coupon_details|customer_name)\s*\}\}|\{(customer_name)\}/g;
const STUDIO_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Same output as Django's escape(): & < > " ' */
function escapeTemplateValue(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

/** 5000 → "₱5,000", 99.5 → "₱99.50" (server: _format_peso) */
function formatPeso(value) {
    const n = Number(value) || 0;
    const opts = Number.isInteger(n)
        ? { maximumFractionDigits: 0 }
        : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    return `₱${n.toLocaleString("en-US", opts)}`;
}

/** "20% off (up to ₱5,000) · valid until Dec 31, 2026" (server: _coupon_details_text) */
function couponDetailsText(coupon) {
    if (!coupon) return "";
    const value = Number(coupon.discount_value) || 0;
    let text;
    if (coupon.discount_type === "percent") {
        text = `${value}% off`;
        if (Number(coupon.max_discount_amount)) {
            text += ` (up to ${formatPeso(coupon.max_discount_amount)})`;
        }
    } else {
        text = `${formatPeso(value)} off`;
    }
    if (coupon.expires_at) {
        const t = new Date(coupon.expires_at);
        if (!Number.isNaN(t.getTime())) {
            const d = new Date(t.getTime() + 8 * 3600 * 1000); // studio time, UTC+8
            text += ` · valid until ${STUDIO_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
        }
    }
    return text;
}

function renderCouponTemplate(template, customerName, coupon, asHtml) {
    if (!template) return "";
    const code = coupon?.code || "";
    const values = {
        customer_name: String(customerName || "").trim() || "there",
        code,
        coupon: code,
        coupon_code: code,
        coupon_details: couponDetailsText(coupon),
    };
    return template.replace(COUPON_TOKEN_RE, (_m, a, b) => {
        const v = values[a || b];
        return asHtml ? escapeTemplateValue(v) : v;
    });
}

function currentSendCoupon() {
    return coupons.find((x) => x.id === sendCouponId) || null;
}

function fetchPreviewCustomerName(id) {
    if (sendPreviewNameRequests.has(id) || !window.apiClient?.customers?.get) return;
    sendPreviewNameRequests.add(id);
    window.apiClient.customers
        .get(id)
        .then((c) => sendCustomerNames.set(id, c?.name || ""))
        .catch(() => sendCustomerNames.set(id, ""))
        .finally(() => {
            sendPreviewNameRequests.delete(id);
            refreshHtmlPreview();
        });
}

/**
 * Who the preview is rendered for: the first selected recipient, or a sample
 * customer when nobody is selected yet.
 */
function previewRecipient() {
    const first = selectedCustomerIds.values().next();
    if (first.done) return { name: SEND_SAMPLE_CUSTOMER_NAME, sample: true };
    const id = first.value;
    if (!sendCustomerNames.has(id)) {
        // Picked via "Select all matching" on another page: look the name up once.
        fetchPreviewCustomerName(id);
        return { name: SEND_SAMPLE_CUSTOMER_NAME, sample: true, loading: true };
    }
    return { name: sendCustomerNames.get(id), sample: false };
}

function previewAsLabelHtml(r) {
    if (r.loading) {
        return `Previewing as <strong>${escapeTemplateValue(r.name)}</strong> <em>(loading the first selected customer…)</em>`;
    }
    if (r.sample) {
        return `Previewing as <strong>${escapeTemplateValue(r.name)}</strong> <em>(sample customer — select recipients to see a real name)</em>`;
    }
    if (!String(r.name || "").trim()) {
        return `Previewing as the first selected customer <em>(no name on file — they'll see "there")</em>`;
    }
    return `Previewing as <strong>${escapeTemplateValue(r.name)}</strong> <span>(first selected customer)</span>`;
}

const EMPTY_PREVIEW_HTML =
    "<p style='color:#8a99a3;font-family:Arial,sans-serif'>Nothing to preview yet. Pick a saved template, import an image, or open <b>Edit HTML</b> to write the message.</p>";

function buildGmailLikePreviewSrcdoc(rawHtml, customerName) {
    const substituted = rawHtml
        ? renderCouponTemplate(rawHtml, customerName, currentSendCoupon(), true)
        : EMPTY_PREVIEW_HTML;
    const styleBlocks = Array.from(
        substituted.matchAll(/<style[\s\S]*?<\/style>/gi),
    )
        .map((m) => m[0])
        .join("\n");
    const bodyMatch = substituted.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : substituted;

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${styleBlocks}
  <style>
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      min-height: auto !important;
      height: auto !important;
      background: #fff !important;
      overflow: auto !important;
    }
    body {
      display: block !important;
      box-sizing: border-box !important;
      padding: 16px !important;
      justify-content: initial !important;
      align-items: initial !important;
    }
  </style>
</head>
<body>${bodyContent}</body>
</html>`;
}

/** Plain-text body shown as the customer would read it. */
function buildPlainTextPreviewSrcdoc(text) {
    const body = text
        ? escapeTemplateValue(text)
        : "<span style='color:#8a99a3'>Nothing to preview yet. Write your message above.</span>";
    return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:16px;background:#fff;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f3b47;line-height:1.55;white-space:pre-wrap;word-wrap:break-word}
</style></head><body>${body}</body></html>`;
}

/** Re-render only when the previewed recipient changed (selection clicks, list paging). */
function refreshPreviewIfRecipientChanged() {
    const r = previewRecipient();
    const key = `${r.sample ? "~" : ""}${r.loading ? "…" : ""}${r.name}`;
    if (key !== sendLastPreviewKey) refreshHtmlPreview();
}

function refreshHtmlPreview() {
    const preview = document.getElementById("emailHtmlPreview");
    const htmlInput = document.getElementById("emailHtmlBody");
    if (!preview || !htmlInput) return;
    const coupon = currentSendCoupon();
    const recipient = previewRecipient();
    sendLastPreviewKey = `${recipient.sample ? "~" : ""}${recipient.loading ? "…" : ""}${recipient.name}`;
    const mode = getEmailComposerMode();
    const subjectRaw = document.getElementById("emailSubject")?.value || "";
    const subjectEl = document.getElementById("sendPreviewSubject");
    if (subjectEl) {
        subjectEl.textContent =
            renderCouponTemplate(subjectRaw, recipient.name, coupon, false) || "(no subject yet)";
    }
    const asEl = document.getElementById("sendPreviewAs");
    if (asEl) asEl.innerHTML = previewAsLabelHtml(recipient);
    let iframe = preview.querySelector("iframe[data-preview-frame='1']");
    if (!iframe) {
        iframe = document.createElement("iframe");
        iframe.setAttribute("data-preview-frame", "1");
        iframe.setAttribute("sandbox", "allow-same-origin");
        iframe.style.width = "100%";
        iframe.style.height = `${composerPreviewHeight}px`;
        iframe.style.border = "0";
        iframe.style.background = "#fff";
        iframe.style.display = "block";
        preview.innerHTML = "";
        preview.appendChild(iframe);
    }
    iframe.style.height = `${mode === "html" ? composerPreviewHeight : TEXT_PREVIEW_HEIGHT}px`;
    iframe.srcdoc =
        mode === "html"
            ? buildGmailLikePreviewSrcdoc(htmlInput.value, recipient.name)
            : buildPlainTextPreviewSrcdoc(
                renderCouponTemplate(document.getElementById("emailBody")?.value || "", recipient.name, coupon, false),
            );
    if (composerFullscreenMode) syncFullscreenPreview();
}

function setEmailImportImagePreview(url) {
    const img = document.getElementById("emailImageImportPreview");
    const wrap = document.getElementById("emailImageImportPreviewWrap");
    if (!img || !wrap) return;
    const u = (url && String(url).trim()) || "";
    if (u) {
        img.src = u;
        wrap.classList.remove("hidden");
    } else {
        img.removeAttribute("src");
        wrap.classList.add("hidden");
    }
}

async function importCouponComposerImage(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith("image/")) {
        showToast("Please select an image file", "error");
        return;
    }
    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result || "");
            reader.onerror = () => reject(new Error("Failed to read image file"));
            reader.readAsDataURL(file);
        });
        const htmlInput = document.getElementById("emailHtmlBody");
        if (!htmlInput) return;
        const snippet = `<p><img src="${dataUrl}" alt="Coupon image" style="max-width:100%;height:auto;" /></p>`;
        htmlInput.value = `${htmlInput.value || ""}\n${snippet}`.trim();
        const htmlRadio = document.getElementById("emailModeHtml");
        if (htmlRadio) htmlRadio.checked = true;
        setInlineComposerByRadio();
        refreshHtmlPreview();
        setEmailImportImagePreview(dataUrl);
    } catch (e) {
        showToast(e.message || "Failed to import image", "error");
    }
}

async function confirmSendCoupon() {
    if (!sendCouponId || selectedCustomerIds.size === 0) {
        showToast("Select at least one customer", "error");
        return;
    }
    const btn = document.getElementById("sendBtn");
    btn.disabled = true;
    try {
        const res = await window.apiClient.coupons.send(sendCouponId, {
            customer_ids: Array.from(selectedCustomerIds),
        });
        showToast(`Registered coupon for ${res.sent_count} customer(s)`);
        closeSendModal();
    } catch (e) {
        showToast(e.message || "Failed to register", "error");
    } finally {
        btn.disabled = false;
    }
}

async function sendCouponEmail() {
    if (!sendCouponId || selectedCustomerIds.size === 0) {
        showToast("Select at least one customer", "error");
        return;
    }
    const subject = (document.getElementById("emailSubject")?.value || "").trim();
    const mode = getEmailComposerMode();
    const bodyRaw = (document.getElementById("emailBody")?.value || "").trim();
    const htmlBodyRaw = (document.getElementById("emailHtmlBody")?.value || "").trim();
    if (!subject) {
        showToast("Email subject is required", "error");
        return;
    }
    if (mode === "text" && !bodyRaw) {
        showToast("Email body is required", "error");
        return;
    }
    if (mode === "html" && !htmlBodyRaw) {
        showToast("HTML body is required", "error");
        return;
    }
    const btn = document.getElementById("sendEmailBtn");
    btn.disabled = true;
    try {
        // Raw templates: the server fills {customer_name} and the coupon variables
        // per recipient (and builds the plain-text part from the HTML in HTML mode).
        const res = await window.apiClient.coupons.sendEmail(sendCouponId, {
            customer_ids: Array.from(selectedCustomerIds),
            subject,
            body: mode === "html" ? "" : bodyRaw,
            html_body: mode === "html" ? htmlBodyRaw : "",
        });
        const n = res.sent_count ?? 0;
        const errPart =
            res.errors && res.errors.length
                ? ` Some errors: ${res.errors.slice(0, 2).join("; ")}`
                : "";
        showToast(`Email sent to ${n} recipient(s).${errPart}`);
        if (n > 0) closeSendModal();
    } catch (e) {
        showToast(e.message || "Failed to send email", "error");
    } finally {
        btn.disabled = false;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document
        .querySelectorAll('input[name="emailBodyMode"]')
        .forEach((el) => {
            el.onchange = () => setInlineComposerByRadio();
        });
    // Live preview + remember which field the Insert chips should target
    ["emailSubject", "emailBody", "emailHtmlBody"].forEach((fieldId) => {
        const el = document.getElementById(fieldId);
        if (!el) return;
        el.addEventListener("input", refreshHtmlPreview);
        el.addEventListener("focus", () => { sendLastField = fieldId; });
    });
    document.querySelectorAll("[data-send-var]").forEach((b) => {
        b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the caret
        b.addEventListener("click", () => insertSendVariable(b.getAttribute("data-send-var")));
    });
    document.querySelectorAll("[data-send-fs-var]").forEach((b) => {
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", () => insertFullscreenVariable(b.getAttribute("data-send-fs-var")));
    });
    document.querySelectorAll("#sendComposerSwitch .send-tab").forEach((t) => {
        t.addEventListener("click", () =>
            setSendComposerView(t.getAttribute("data-send-switch"), { focus: true }),
        );
    });
    const imageInput = document.getElementById("emailImageUpload");
    if (imageInput) {
        imageInput.addEventListener("change", (e) => {
            const f = e.target.files && e.target.files[0];
            importCouponComposerImage(f);
            e.target.value = "";
        });
    }
    const showWorkspaceBtn = document.getElementById("showHtmlWorkspaceBtn");
    if (showWorkspaceBtn) {
        showWorkspaceBtn.onclick = () => {
            // The expanded editor edits the HTML email, so make that the mode being sent.
            if (getEmailComposerMode() === "text") setSendComposerView("preview");
            openComposerFullscreen();
        };
    }
    const fullEditorOnlyBtn = document.getElementById("fullscreenEditorOnlyBtn");
    if (fullEditorOnlyBtn) fullEditorOnlyBtn.onclick = () => setComposerModalView("editor");
    const fullPreviewOnlyBtn = document.getElementById("fullscreenPreviewOnlyBtn");
    if (fullPreviewOnlyBtn) fullPreviewOnlyBtn.onclick = () => setComposerModalView("preview");
    const fullBothBtn = document.getElementById("fullscreenBothBtn");
    if (fullBothBtn) fullBothBtn.onclick = () => setComposerModalView("both");
    const resizeHandle = document.getElementById("htmlComposerResizeHandle");
    if (resizeHandle) {
        resizeHandle.addEventListener("mousedown", beginComposerResize);
        resizeHandle.addEventListener("touchstart", beginComposerResize, {
            passive: true,
        });
    }
    window.addEventListener("mousemove", moveComposerResize);
    window.addEventListener("touchmove", moveComposerResize, { passive: true });
    window.addEventListener("mouseup", endComposerResize);
    window.addEventListener("touchend", endComposerResize);
    const fullModal = document.getElementById("composerFullscreenModal");
    if (fullModal) {
        fullModal.onclick = (e) => {
            if (e.target === fullModal) closeComposerFullscreen();
        };
    }
    const fullEditor = document.getElementById("composerFullscreenEditor");
    if (fullEditor) {
        fullEditor.addEventListener("input", () => {
            const base = document.getElementById("emailHtmlBody");
            if (base) base.value = fullEditor.value || "";
            refreshHtmlPreview();
        });
    }
    syncComposerSizing();
    setInlineComposerByRadio();
    loadLoyaltySettingsForCouponsPage();
    applyLoyaltyRatesPermission();

    const couponsSearchInput = document.getElementById("couponsSearchInput");
    if (couponsSearchInput) {
        couponsSearchInput.addEventListener("input", () => {
            couponSearchQuery = String(couponsSearchInput.value || "");
            renderCouponsTable();
        });
    }
    const couponsSortBtn = document.getElementById("couponsSortBtn");
    const couponsSortMenu = document.getElementById("couponsSortMenu");
    if (couponsSortBtn && couponsSortMenu) {
        couponsSortBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            couponsSortMenu.classList.toggle("hidden");
        });
    }
    document.querySelectorAll("#couponsSortMenu .accounts-sort-option").forEach((opt) => {
        opt.addEventListener("click", () => {
            couponSort.key = String(opt.getAttribute("data-sort-key") || "expires");
            couponSort.dir = String(opt.getAttribute("data-sort-dir") || "asc");
            if (couponsSortMenu) couponsSortMenu.classList.add("hidden");
            renderCouponsTable();
        });
    });
    document.addEventListener("click", (e) => {
        if (!couponsSortMenu || couponsSortMenu.classList.contains("hidden")) return;
        if (
            e.target instanceof Element &&
            !e.target.closest("#couponsSortMenu") &&
            !e.target.closest("#couponsSortBtn")
        ) {
            couponsSortMenu.classList.add("hidden");
        }
    });
    document.querySelectorAll("#couponsTable .accounts-sort-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = String(btn.getAttribute("data-sort-key") || "expires");
            if (couponSort.key === key) {
                couponSort.dir = couponSort.dir === "asc" ? "desc" : "asc";
            } else {
                couponSort.key = key;
                couponSort.dir = "asc";
            }
            renderCouponsTable();
        });
    });
    const couponsResetBtn = document.getElementById("couponsResetBtn");
    if (couponsResetBtn) {
        couponsResetBtn.addEventListener("click", () => {
            couponSearchQuery = "";
            couponSort = { key: "expires", dir: "asc" };
            if (couponsSearchInput) couponsSearchInput.value = "";
            if (couponsSortMenu) couponsSortMenu.classList.add("hidden");
            renderCouponsTable();
        });
    }
    updateCouponSortUiState();
    loadCoupons();
});
