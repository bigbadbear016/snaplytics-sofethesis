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
let composerEditorHeight = 112;
let composerPreviewHeight = 260;
let composerResizeDragging = false;
let composerResizeStartY = 0;
let composerResizeStartEditor = 0;
let composerResizeStartPreview = 0;
let composerModalViewMode = "both";

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
    if (!list.length) {
        el.innerHTML = `<p class="text-gray-400 text-xs px-1">No saved templates</p>`;
        return;
    }
    el.innerHTML = list
        .map((p) => {
            const active = p.id === selectedEmailPresetId;
            return `<button type="button" data-preset-id="${escapeHtml(p.id)}" class="preset-pick w-full text-left px-2 py-1.5 rounded text-xs font-semibold ${
                active ? "bg-[#165166] text-white" : "hover:bg-gray-100 text-[#424242]"
            }">${escapeHtml(p.name)}</button>`;
        })
        .join("");
    el.querySelectorAll(".preset-pick").forEach((btn) => {
        btn.onclick = () => applyEmailPreset(btn.getAttribute("data-preset-id"));
    });
}

async function applyEmailPreset(id) {
    const p = emailPresetsCache.find((x) => String(x.id) === String(id));
    if (!p) return;
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
        await renderPresetList();
        showToast("Template saved");
    } catch (e) {
        showToast(e.message || "Failed to save template", "error");
    }
}

async function updateSelectedPreset() {
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
    const textRadio = document.getElementById("emailModeText");
    if (textRadio) textRadio.checked = true;
    setInlineComposerByRadio();
    const hint = document.getElementById("sendModalHint");
    const couponRow = coupons.find((x) => x.id === id);
    if (hint) {
        hint.textContent = "Tip: {{code}} or {{coupon}} in the subject or body is replaced with the coupon code.";
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
}

function closeSendModal() {
    setFlexModalVisible("sendModal", false);
    setEmailImportImagePreview("");
    closeComposerFullscreen();
    endComposerResize();
}

function syncComposerSizing() {
    const htmlInput = document.getElementById("emailHtmlBody");
    const preview = document.getElementById("emailHtmlPreview");
    if (htmlInput) htmlInput.style.height = `${composerEditorHeight}px`;
    if (preview) preview.style.height = `${composerPreviewHeight}px`;
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
    const c = coupons.find((x) => x.id === sendCouponId);
    const code = c ? c.code : "";
    frame.srcdoc = buildGmailLikePreviewSrcdoc(htmlInput.value, code);
}

function setInlineComposerByRadio() {
    const mode = getEmailComposerMode();
    const textWrap = document.getElementById("emailTextWrap");
    const htmlWrap = document.getElementById("emailHtmlWrap");
    const previewWrap = document.getElementById("emailPreviewWrap");
    const resizeHandle = document.getElementById("htmlComposerResizeHandle");
    if (!textWrap || !htmlWrap || !previewWrap || !resizeHandle) return;
    if (mode === "html") {
        textWrap.classList.add("hidden");
        htmlWrap.classList.remove("hidden");
        previewWrap.classList.add("hidden");
        resizeHandle.classList.add("hidden");
    } else {
        textWrap.classList.remove("hidden");
        htmlWrap.classList.add("hidden");
        previewWrap.classList.add("hidden");
        resizeHandle.classList.add("hidden");
    }
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
    if (editor) {
        editor.value = htmlInput.value || "";
        editor.focus();
    }
    setComposerModalView(composerModalViewMode || "both");
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

function stripHtmlTags(html) {
    const temp = document.createElement("div");
    temp.innerHTML = html || "";
    return (temp.textContent || temp.innerText || "").trim();
}

function applyCouponTokens(template, code) {
    return (template || "").replace(/\{\{(code|coupon)\}\}/g, code || "");
}

function buildGmailLikePreviewSrcdoc(rawHtml, code) {
    const substituted = applyCouponTokens(
        rawHtml || "<p style='color:#999'>Preview is empty.</p>",
        code,
    );
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

function refreshHtmlPreview() {
    const preview = document.getElementById("emailHtmlPreview");
    const htmlInput = document.getElementById("emailHtmlBody");
    if (!preview || !htmlInput) return;
    const c = coupons.find((x) => x.id === sendCouponId);
    const code = c ? c.code : "";
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
    iframe.style.height = `${composerPreviewHeight}px`;
    const content = buildGmailLikePreviewSrcdoc(htmlInput.value, code);
    iframe.srcdoc = content;
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
    const c = coupons.find((x) => x.id === sendCouponId);
    const code = c ? c.code : "";
    const finalSubject = applyCouponTokens(subject, code);
    const body = applyCouponTokens(bodyRaw, code);
    const htmlBody = applyCouponTokens(htmlBodyRaw, code);
    const textFallback = mode === "html" ? stripHtmlTags(htmlBody) : body;
    const btn = document.getElementById("sendEmailBtn");
    btn.disabled = true;
    try {
        const res = await window.apiClient.coupons.sendEmail(sendCouponId, {
            customer_ids: Array.from(selectedCustomerIds),
            subject: finalSubject,
            body: textFallback,
            html_body: mode === "html" ? htmlBody : "",
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
    const htmlInput = document.getElementById("emailHtmlBody");
    if (htmlInput) htmlInput.addEventListener("input", refreshHtmlPreview);
    const imageInput = document.getElementById("emailImageUpload");
    if (imageInput) {
        imageInput.addEventListener("change", (e) => {
            const f = e.target.files && e.target.files[0];
            importCouponComposerImage(f);
            e.target.value = "";
        });
    }
    const showWorkspaceBtn = document.getElementById("showHtmlWorkspaceBtn");
    if (showWorkspaceBtn) showWorkspaceBtn.onclick = () => openComposerFullscreen();
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
