// scripts/notif.js
// ============================================================================
// BOOKING STATUS NOTIFICATION PANEL — works on every page, no redirect needed
// ============================================================================

let pendingBookings = [];
/** Monotonic counter so overlapping loadPendingBookings() replies drop stale results */
let _loadPendingBookingsSeq = 0;
let _notifPanelOpen = false;
let _lastPendingCount = null;
let _notifSoundEnabled = true;
let _notifAudioCtx = null;
const NOTIF_SOUND_PREF_KEY = "heigen_notif_sound_enabled_v1";
/** Booking status panel: filter + sort (client-side) */
let _bookingStatusSearch = "";
let _bookingStatusSort = "ongoing_then_latest";
const IS_STAFF_EMBED =
    window.self !== window.top ||
    new URLSearchParams(window.location.search).get("embed") === "1";

/** Booking summary dates: MM-DD-YYYY. YYYY-MM-DD → local parse. */
function _formatBookingSummaryDate(v) {
    if (v == null || v === "") return null;
    const s = String(v).trim();
    if (!s) return null;
    let d;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [y, m, day] = s.slice(0, 10).split("-").map(Number);
        d = new Date(y, m - 1, day);
    } else {
        d = new Date(s);
    }
    if (Number.isNaN(d.getTime())) return s;
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}-${dd}-${yyyy}`;
}

if (IS_STAFF_EMBED) {
    window.toggleBookingStatusPanel = function () {
        try {
            if (
                window.parent &&
                typeof window.parent.toggleBookingStatusPanel === "function"
            ) {
                window.parent.toggleBookingStatusPanel();
            }
        } catch (e) {}
    };
    window.closeBookingStatusPanel = function () {
        try {
            if (
                window.parent &&
                typeof window.parent.closeBookingStatusPanel === "function"
            ) {
                window.parent.closeBookingStatusPanel();
            }
        } catch (e) {}
    };
    window.refreshPage = async function () {
        try {
            if (window.parent && typeof window.parent.refreshPage === "function") {
                await window.parent.refreshPage();
            }
        } catch (e) {}
    };
}

function _readNotifSoundPref() {
    try {
        const raw = localStorage.getItem(NOTIF_SOUND_PREF_KEY);
        if (raw === null) return true;
        return raw === "1";
    } catch (_) {
        return true;
    }
}

function _writeNotifSoundPref(enabled) {
    try {
        localStorage.setItem(NOTIF_SOUND_PREF_KEY, enabled ? "1" : "0");
    } catch (_) {}
}

/** Chromium/Electron keep AudioContext suspended until user gesture — prime on first tap/key. */
let _notifAudioUnlockAttached = false;
function _unlockNotifAudioOnce() {
    if (_notifAudioUnlockAttached) return;
    _notifAudioUnlockAttached = true;
    const unlock = () => {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            if (!_notifAudioCtx) _notifAudioCtx = new AudioCtx();
            void _notifAudioCtx.resume();
        } catch (_) {}
        document.removeEventListener("pointerdown", unlock);
        document.removeEventListener("keydown", unlock);
    };
    document.addEventListener("pointerdown", unlock, { capture: true });
    document.addEventListener("keydown", unlock, { capture: true });
}

/** Schedule oscillators only after context is running — resume() is async; old code fired while still suspended → silence. */
function _scheduleNewBookingChime(ctx) {
    const now = ctx.currentTime;
    const peak = 0.15;
    function ding(t0, hz, len) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(hz, t0);
        gain.gain.setValueAtTime(0.001, t0);
        gain.gain.linearRampToValueAtTime(peak, t0 + 0.018);
        gain.gain.linearRampToValueAtTime(0.001, t0 + len);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + len + 0.02);
    }
    ding(now, 659.25, 0.11);
    ding(now + 0.13, 880, 0.14);
}

function _playNotifSound() {
    if (!_notifSoundEnabled) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!_notifAudioCtx) _notifAudioCtx = new AudioCtx();
        const ctx = _notifAudioCtx;
        const run = () => {
            try {
                _scheduleNewBookingChime(ctx);
            } catch (err) {
                console.warn("notif sound:", err);
            }
        };
        if (ctx.state === "suspended") {
            void ctx.resume().then(run);
        } else {
            run();
        }
    } catch (err) {
        console.warn("notif sound ctx:", err);
    }
}

function _updateSoundToggleButton() {
    const btn = document.getElementById("notifSoundToggleBtn");
    if (!btn) return;
    btn.textContent = _notifSoundEnabled ? "🔔" : "🔕";
    btn.setAttribute(
        "aria-label",
        _notifSoundEnabled
            ? "Turn notification sound off"
            : "Turn notification sound on",
    );
    btn.title = _notifSoundEnabled ? "Sound on" : "Sound off";
}

function _ensureSoundToggleButton() {
    const panel = document.getElementById("bookingStatusPanel");
    if (!panel) return;
    const header = panel.querySelector(".booking-status-header");
    if (!header) return;
    const closeBtn = header.querySelector(".close-panel-btn");
    if (!closeBtn) return;

    let actions = header.querySelector(".booking-status-header-actions");
    if (!actions) {
        actions = document.createElement("div");
        actions.className = "booking-status-header-actions";
        header.appendChild(actions);
    }
    if (closeBtn.parentElement !== actions) {
        actions.appendChild(closeBtn);
    }

    let soundBtn = document.getElementById("notifSoundToggleBtn");
    if (!soundBtn) {
        soundBtn = document.createElement("button");
        soundBtn.id = "notifSoundToggleBtn";
        soundBtn.className = "sound-toggle-btn";
        soundBtn.type = "button";
        soundBtn.addEventListener("click", () => {
            _notifSoundEnabled = !_notifSoundEnabled;
            _writeNotifSoundPref(_notifSoundEnabled);
            _updateSoundToggleButton();
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx && !_notifAudioCtx) _notifAudioCtx = new AudioCtx();
                void _notifAudioCtx?.resume();
            } catch (_) {}
        });
        actions.insertBefore(soundBtn, closeBtn);
    }
    _updateSoundToggleButton();
}

// ── Panel toggle ──────────────────────────────────────────────────────────────

function toggleBookingStatusPanel() {
    const panel   = document.getElementById("bookingStatusPanel");
    const overlay = document.getElementById("bookingStatusOverlay");
    if (!panel || !overlay) return;

    _notifPanelOpen = !_notifPanelOpen;
    panel.style.display   = _notifPanelOpen ? "flex" : "none";
    overlay.classList.toggle("active", _notifPanelOpen);

    if (_notifPanelOpen) loadPendingBookings();
}

function closeBookingStatusPanel() {
    _notifPanelOpen = false;
    const panel   = document.getElementById("bookingStatusPanel");
    const overlay = document.getElementById("bookingStatusOverlay");
    if (panel)   panel.style.display = "none";
    if (overlay) overlay.classList.remove("active");
}

// ── Data ──────────────────────────────────────────────────────────────────────

async function loadPendingBookings() {
    const content = document.getElementById("bookingStatusContent");
    const seq = ++_loadPendingBookingsSeq;
    if (content) {
        content.innerHTML = `
          <div class="notif-loading">
            <div class="notif-spinner"></div>
            <span>Loading bookings…</span>
          </div>`;
    }
    try {
        const all = await window.apiClient.bookings.listPendingOngoing();
        if (seq !== _loadPendingBookingsSeq) return;
        pendingBookings = _dedupeBookingsById(Array.isArray(all) ? all : []);
        updateNotificationBadge();
        renderBookingItems();
    } catch (err) {
        console.error("loadPendingBookings:", err);
        if (seq !== _loadPendingBookingsSeq) return;
        if (content) {
            content.innerHTML = `<div class="empty-bookings" style="color:#c00;">
              Could not load bookings.<br><small>${err.message}</small>
            </div>`;
        }
    }
}

function updateNotificationBadge() {
    const badge = document.getElementById("notificationBadge");
    // Only count true Pending (kiosk-originated, not yet accepted)
    const pending = pendingBookings.filter(b => b.session_status === "Pending");
    const count   = pending.length;
    if (_lastPendingCount !== null && count > _lastPendingCount && !_notifPanelOpen) {
        _playNotifSound();
    }
    _lastPendingCount = count;

    if (!badge) return;
    badge.textContent   = count;
    badge.style.display = count > 0 ? "flex" : "none";
}

function _bookingStatusRank(status) {
    const s = String(status || "").toLowerCase();
    if (s === "pending") return 0;
    if (s === "ongoing") return 1;
    return 2;
}

function _bookingStatusTimeMs(booking) {
    const raw = booking.session_date ?? booking.created_at;
    if (!raw) return 0;
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : 0;
}

/** Newest booking first: creation time, then session date */
function _bookingRecencyMs(booking) {
    const raw = booking.created_at ?? booking.session_date;
    if (!raw) return 0;
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : 0;
}

/** Ongoing at top of queue, then Pending, then anything else */
function _ongoingFirstRank(status) {
    const s = String(status || "").toLowerCase();
    if (s === "ongoing") return 0;
    if (s === "pending") return 1;
    return 2;
}

function _compareBookingIdDesc(a, b) {
    const na = Number(a.id);
    const nb = Number(b.id);
    if (Number.isFinite(na) && Number.isFinite(nb) && (na !== 0 || nb !== 0)) {
        return nb - na;
    }
    return String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
}

/** Keep one row per booking id (API/client edge cases can repeat the same id). */
function _dedupeBookingsById(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const b of list) {
        const id = b?.id;
        if (id === undefined || id === null) {
            out.push(b);
            continue;
        }
        const key = String(id);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(b);
    }
    return out;
}

function _filterBookingsForPanel(list, q) {
    const needle = String(q || "").trim().toLowerCase();
    if (!needle) return list.slice();
    return list.filter((b) => {
        const name = String(b.customer_name ?? "").toLowerCase();
        const email = String(b.customer_email ?? "").toLowerCase();
        const contact = String(b.customer_contact ?? "").toLowerCase();
        const status = String(b.session_status ?? "").toLowerCase();
        const idStr = String(b.id ?? "");
        return (
            name.includes(needle) ||
            email.includes(needle) ||
            contact.includes(needle) ||
            status.includes(needle) ||
            idStr.includes(needle)
        );
    });
}

function _sortBookingsForPanel(list, sortKey) {
    const out = list.slice();
    out.sort((a, b) => {
        const stA = a.session_status ?? "Pending";
        const stB = b.session_status ?? "Pending";
        if (sortKey === "ongoing_then_latest") {
            const ra = _ongoingFirstRank(stA);
            const rb = _ongoingFirstRank(stB);
            if (ra !== rb) return ra - rb;
            const ta = _bookingRecencyMs(a);
            const tb = _bookingRecencyMs(b);
            if (ta !== tb) return tb - ta;
            return _compareBookingIdDesc(a, b);
        }
        if (sortKey === "status_ongoing_first") {
            const d = _bookingStatusRank(stA) - _bookingStatusRank(stB);
            if (d !== 0) return -d;
        } else if (sortKey === "status_pending_first") {
            const d = _bookingStatusRank(stA) - _bookingStatusRank(stB);
            if (d !== 0) return d;
        }
        if (sortKey === "date_asc" || sortKey === "date_desc") {
            const ta = _bookingStatusTimeMs(a);
            const tb = _bookingStatusTimeMs(b);
            if (ta !== tb) return sortKey === "date_asc" ? ta - tb : tb - ta;
        }
        if (sortKey === "name_asc" || sortKey === "name_desc") {
            const na = String(a.customer_name ?? "");
            const nb = String(b.customer_name ?? "");
            const c = na.localeCompare(nb, undefined, { sensitivity: "base" });
            if (c !== 0) return sortKey === "name_asc" ? c : -c;
        }
        const ta = _bookingRecencyMs(a);
        const tb = _bookingRecencyMs(b);
        if (ta !== tb) return tb - ta;
        return _compareBookingIdDesc(a, b);
    });
    return out;
}

const BOOKING_STATUS_TOOLBAR_HTML = `
      <div class="booking-status-controls">
        <div id="bookingStatusMetaHost" class="booking-status-meta-host" aria-live="polite"></div>
        <div class="booking-status-toolbar">
        <label class="booking-toolbar-field booking-toolbar-field--search">
          <span class="booking-toolbar-label">Search</span>
          <input type="search" id="bookingStatusSearchInput" class="booking-status-search" placeholder="Name, email, phone, status, ID…" autocomplete="off">
        </label>
        <label class="booking-toolbar-field booking-toolbar-field--sort">
          <span class="booking-toolbar-label">Sort by</span>
          <select id="bookingStatusSortSelect" class="booking-status-sort" aria-label="Sort bookings">
            <option value="ongoing_then_latest">Ongoing first · newest booking</option>
            <option value="status_pending_first">Pending first · newest within group</option>
            <option value="date_asc">Date (soonest)</option>
            <option value="date_desc">Date (latest)</option>
            <option value="name_asc">Name (A–Z)</option>
            <option value="name_desc">Name (Z–A)</option>
          </select>
        </label>
        </div>
      </div>
      <div id="bookingStatusListHost" class="booking-status-list-host"></div>`;

function _attachBookingStatusPanelDelegation() {
    const content = document.getElementById("bookingStatusContent");
    if (!content || content.dataset.bookingPanelDelegation === "1") return;
    content.dataset.bookingPanelDelegation = "1";
    content.addEventListener("input", (e) => {
        const t = e.target;
        if (t && t.id === "bookingStatusSearchInput") {
            _bookingStatusSearch = String(t.value || "");
            renderBookingListRowsOnly();
        }
    });
    content.addEventListener("change", (e) => {
        const t = e.target;
        if (t && t.id === "bookingStatusSortSelect") {
            _bookingStatusSort = String(t.value || "ongoing_then_latest");
            renderBookingListRowsOnly();
        }
    });
    content.addEventListener("toggle", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLDetailsElement) || !t.classList.contains("booking-more")) return;
        if (!t.open) return;
        for (const d of content.querySelectorAll("details.booking-more[open]")) {
            if (d !== t) d.removeAttribute("open");
        }
    });
    content.addEventListener("click", (e) => {
        const inMenu = e.target.closest(".booking-more-panel");
        const onToggle = e.target.closest("summary.booking-more-toggle");
        if (inMenu || onToggle) {
            const item = e.target.closest(".booking-menu-item");
            if (item) {
                const det = item.closest("details.booking-more");
                if (det) det.removeAttribute("open");
            }
            return;
        }
        if (e.target.closest("details.booking-more")) return;
        for (const d of content.querySelectorAll("details.booking-more[open]")) {
            d.removeAttribute("open");
        }
    });
    content.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        for (const d of content.querySelectorAll("details.booking-more[open]")) {
            d.removeAttribute("open");
        }
    });
}

function _ensureBookingStatusPanelChrome() {
    const content = document.getElementById("bookingStatusContent");
    if (!content) return false;
    _attachBookingStatusPanelDelegation();
    if (content.querySelector("#bookingStatusListHost")) return true;
    content.innerHTML = BOOKING_STATUS_TOOLBAR_HTML;
    return !!content.querySelector("#bookingStatusListHost");
}

function _syncBookingStatusToolbarInputs() {
    const searchEl = document.getElementById("bookingStatusSearchInput");
    const sortEl = document.getElementById("bookingStatusSortSelect");
    if (searchEl) searchEl.value = _bookingStatusSearch;
    if (sortEl) sortEl.value = _bookingStatusSort;
}

function renderBookingListRowsOnly() {
    const host = document.getElementById("bookingStatusListHost");
    const metaHost = document.getElementById("bookingStatusMetaHost");
    if (!host) return;

    if (!pendingBookings.length) {
        if (metaHost) metaHost.innerHTML = "";
        host.innerHTML =
            '<div class="empty-bookings">No pending or ongoing bookings</div>';
        return;
    }

    const filtered = _filterBookingsForPanel(
        _dedupeBookingsById(pendingBookings),
        _bookingStatusSearch,
    );
    const sorted = _sortBookingsForPanel(filtered, _bookingStatusSort);

    if (!sorted.length) {
        if (metaHost) {
            metaHost.innerHTML =
                '<div class="booking-status-meta booking-status-meta--hint" role="status">No results for this filter.</div>';
        }
        host.innerHTML =
            '<div class="empty-bookings">Try another search or clear the box.</div>';
        return;
    }

    const pendingN = sorted.filter(
        b => (b.session_status ?? "Pending") === "Pending",
    ).length;
    const ongoingN = sorted.length - pendingN;

    const metaRow = `
      <div class="booking-status-meta" role="status">
        <span class="booking-status-meta-title">Active queue</span>
        <span class="booking-status-meta-chips">
          <span class="booking-meta-chip booking-meta-chip--pending">${pendingN} pending</span>
          <span class="booking-meta-chip booking-meta-chip--ongoing">${ongoingN} ongoing</span>
        </span>
      </div>`;

    const listHeader = `
      <div class="booking-list-header" aria-hidden="true">
        <span class="booking-list-header-cell booking-list-header-cell--customer">Customer</span>
        <span class="booking-list-header-cell booking-list-header-cell--session">Session</span>
        <span class="booking-list-header-cell booking-list-header-cell--status">Status</span>
        <span class="booking-list-header-cell booking-list-header-cell--actions">Actions</span>
      </div>`;

    const hasOngoingSession = sorted.some(
        (b) => (b.session_status ?? "Pending") === "Ongoing",
    );

    const rows = sorted.map((booking) => {
        const name    = booking.customer_name ?? "Unknown Customer";
        const rawDate = booking.session_date ?? booking.created_at;
        const dateStr = rawDate ? new Date(rawDate).toLocaleDateString("en-US") : "—";
        const status  = booking.session_status ?? "Pending";
        const isPending  = status === "Pending";
        const isOngoing  = status === "Ongoing";
        const rowMod = isPending
            ? "booking-item--pending"
            : isOngoing
              ? "booking-item--ongoing"
              : "";

        const pendingIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2" fill="none"/>
            <path d="M12 6V12L16 14" stroke="white" stroke-width="2" stroke-linecap="round"/>
          </svg>`;
        const ongoingIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2" fill="none"/>
            <path d="M8 12H16M12 8V16" stroke="white" stroke-width="2" stroke-linecap="round"/>
          </svg>`;

        const acceptLocked = isPending && hasOngoingSession;
        const actions = isPending ? `
            <button type="button" class="booking-action-btn start${acceptLocked ? " is-locked" : ""}"
              ${acceptLocked ? "disabled title=\"Finish the ongoing session before accepting another booking\"" : `onclick="handleStartBooking(${booking.id})"`}
              >Accept</button>
            <button type="button" class="booking-action-btn deny" onclick="handleDenyBooking(${booking.id})">Deny</button>` : "";
        const ongoingActions = isOngoing ? `
            <button class="booking-action-btn done"   onclick="handleDoneBooking(${booking.id})">Done</button>
            <button class="booking-action-btn cancel" onclick="handleCancelBooking(${booking.id})">Cancel</button>` : "";

        const cid = booking.customerId ?? booking.customer_id;
        const menuParts = [];
        if (cid) {
            menuParts.push(
                `<button type="button" class="booking-menu-item" onclick="openCustomerRecordsPage(${cid})">Records</button>`,
                `<button type="button" class="booking-menu-item" onclick="openBookingCouponDialog(${booking.id})">Apply coupon</button>`,
            );
        }
        menuParts.push(
            `<button type="button" class="booking-menu-item" onclick="handleViewBookingSummary(${booking.id})">Summary</button>`,
        );
        const moreChevron = `<svg class="booking-more-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const moreBlock = `
            <details class="booking-more">
              <summary class="booking-more-toggle">
                <span class="booking-more-toggle-text">More</span>
                ${moreChevron}
              </summary>
              <div class="booking-more-panel" role="menu">${menuParts.join("")}</div>
            </details>`;

        const primaryBlock = `${actions}${ongoingActions}`;

        return `
          <div class="booking-item${rowMod ? ` ${rowMod}` : ""}">
            <div class="booking-col booking-col-customer">
              <div class="booking-customer-name" title="${_nsEscapeHtml(name)}">${_nsEscapeHtml(name)}</div>
            </div>
            <div class="booking-col booking-col-date">
              <div class="booking-date booking-date--cell">${dateStr}</div>
            </div>
            <div class="booking-col booking-col-status">
              <div class="booking-status-badge ${String(status).toLowerCase()}">
                ${isPending ? pendingIcon : ongoingIcon}
                ${status}
              </div>
            </div>
            <div class="booking-col booking-col-actions">
              <div class="booking-actions">
                ${primaryBlock ? `<div class="booking-actions-primary">${primaryBlock}</div>` : ""}
                ${moreBlock}
              </div>
            </div>
          </div>`;
    }).join("");

    if (metaHost) metaHost.innerHTML = metaRow;
    host.innerHTML = listHeader + rows;
}

function renderBookingItems() {
    const content = document.getElementById("bookingStatusContent");
    if (!content) return;
    if (!_ensureBookingStatusPanelChrome()) return;
    _syncBookingStatusToolbarInputs();
    renderBookingListRowsOnly();
}

// ── Status mutations ──────────────────────────────────────────────────────────

async function handleStartBooking(bookingId) {
    await withBookingMutation(bookingId, "handleStartBooking", "Failed to accept booking", async () => {
        await window.apiClient.bookings.updateStatus(bookingId, "Ongoing");
    });
}

async function handleDoneBooking(bookingId) {
    await withBookingMutation(bookingId, "handleDoneBooking", "Failed to complete booking", async () => {
        await window.apiClient.bookings.updateStatus(bookingId, "BOOKED");
    });
}

async function handleDenyBooking(bookingId) {
    const ok = await window.heigenConfirm("Deny this booking? This cannot be undone.", {
        title: "Deny booking",
        confirmText: "Deny",
        dangerous: true,
    });
    if (!ok) return;
    await withBookingMutation(bookingId, "handleDenyBooking", "Failed to deny booking", async () => {
        await window.apiClient.bookings.removeById(bookingId);
    });
}

async function handleCancelBooking(bookingId) {
    const ok = await window.heigenConfirm("Move this booking back to Pending?", {
        title: "Return to pending",
        confirmText: "Move to Pending",
        dangerous: false,
    });
    if (!ok) return;
    await withBookingMutation(bookingId, "handleCancelBooking", "Failed to cancel booking", async () => {
        await window.apiClient.bookings.updateStatus(bookingId, "Pending");
    });
}

async function withBookingMutation(bookingId, logLabel, failPrefix, run) {
    try {
        _setItemLoading(bookingId, true);
        await run();
        await loadPendingBookings();
    } catch (err) {
        console.error(`${logLabel}:`, err);
        window.heigenAlert(`${failPrefix}: ${err.message}`);
        await loadPendingBookings();
    }
}

function handleViewBookingSummary(bookingId) {
    const booking = pendingBookings.find(b => b.id === bookingId);
    if (!booking) return;

    const existing = document.getElementById("notifSummaryModal");
    if (existing) existing.remove();

    // ── Field resolution: maps to the updated backend serializer fields ─────────
    const status      = booking.session_status ?? "Pending";
    const statusColor = status === "Pending" ? "#f57c00" : "#1976d2";

    // preferred_date: now serialized from session_date by the backend
    const preferredDate = _formatBookingSummaryDate(booking.preferred_date);
    const bookingDate   = _formatBookingSummaryDate(booking.date);

    const customerName = booking.customer_name    ?? null;
    const email        = booking.customer_email   ?? null;  // from customer.email
    const contact      = booking.customer_contact ?? null;  // from customer.contact_number
    const appliedCouponCode = booking.appliedCouponCode ?? null;
    const type         = booking.type             ?? null;
    const category     = booking.category_name    ?? null;  // from package.category
    const pkgName      = booking.packageName      ?? null;
    const pkgPrice     = Number(booking.packagePrice ?? 0);

    // total: 0 is a known backend bug — fall back to subtotal
    const subtotal  = Number(booking.subtotal ?? pkgPrice);
    const discount  = Number(booking.discount ?? 0);
    const total     = Number(booking.total) > 0
        ? Number(booking.total)
        : subtotal - discount;

    // Addons
    const addons = Array.isArray(booking.addons) ? booking.addons : [];
    const addonsHTML = addons.length
        ? addons.map(a => `
            <div class="ns-addon-row">
              <span class="ns-addon-name">${a.name}${(a.quantity ?? 1) > 1 ? ` ×${a.quantity}` : ""}</span>
              <span class="ns-addon-price">+₱${((a.price ?? 0) * (a.quantity ?? 1)).toLocaleString("en-PH", {minimumFractionDigits:2})}</span>
            </div>`).join("")
        : `<div class="ns-no-addons">No add-ons</div>`;

    // ── Helper: only render a field row if value is non-null/empty ─────────────
    const field = (label, value) => value
        ? `<div class="ns-field">
             <div class="ns-field-label">${label}</div>
             <div class="ns-field-value">${value}</div>
           </div>`
        : "";

    // ── Payment method ────────────────────────────────────────────────────────
    const paymentMethod = booking.gcash_payment != null ? "GCash"
        : booking.cash_payment  != null ? "Cash"
        : null;

    const modal = document.createElement("div");
    modal.id = "notifSummaryModal";
    modal.className = "ns-overlay";
    modal.innerHTML = `
      <div class="ns-dialog" role="dialog" aria-modal="true">

        <div class="ns-header">
          <span class="ns-title">Booking Summary</span>
          <button class="ns-close-btn" onclick="closeNotifSummary()" aria-label="Close">✕</button>
        </div>

        <div class="ns-ribbon" style="background:${statusColor};">
          ${status.toUpperCase()}
        </div>

        <div class="ns-body">

          <!-- Customer section: build fields first, only render section if any exist -->
          ${(() => {
            const rows = [
              field("Full Name",     customerName),
              field("Email",         email),
              field("Contact",       contact),
              field("Preferred Date",preferredDate),
              field("Booking Date",  bookingDate),
            ].filter(Boolean).join("");
            return rows ? `
              <div class="ns-section-label">Customer</div>
              <div class="ns-grid">${rows}</div>
              <div class="ns-divider"></div>` : "";
          })()}

          <!-- Booking section -->
          ${(() => {
            const rows = [
              field("Type",     type),
              field("Category", category),
              field("Payment",  paymentMethod),
            ].filter(Boolean).join("");
            return rows ? `
              <div class="ns-section-label">Booking</div>
              <div class="ns-grid">${rows}</div>` : "";
          })()}

          <!-- Package -->
          ${pkgName ? `
          <div class="ns-pkg-row">
            <div style="flex:1;">
              <div class="ns-field-label">Package</div>
              <div class="ns-field-value ns-pkg-name">${pkgName}</div>
            </div>
            <div class="ns-pkg-price">₱${pkgPrice.toLocaleString("en-PH", {minimumFractionDigits:2})}</div>
          </div>` : ""}

          <!-- Add-ons -->
          <div class="ns-field-label" style="margin-top:12px;">Add-ons</div>
          <div class="ns-addons-block">${addonsHTML}</div>

          <div class="ns-divider"></div>

          <!-- Totals -->
          <div class="ns-totals">
            ${subtotal !== total ? `
            <div class="ns-total-row">
              <span>Subtotal</span>
              <span>₱${subtotal.toLocaleString("en-PH", {minimumFractionDigits:2})}</span>
            </div>` : ""}
            ${discount > 0 ? `
            <div class="ns-total-row">
              <span>Voucher${appliedCouponCode ? ` (${_nsEscapeHtml(appliedCouponCode)})` : ""}</span>
              <span style="color:#2d8a6e;">−₱${discount.toLocaleString("en-PH", {minimumFractionDigits:2})}</span>
            </div>` : ""}
            <div class="ns-total-row ns-total-grand">
              <span>Total</span>
              <span>₱${total.toLocaleString("en-PH", {minimumFractionDigits:2})}</span>
            </div>
          </div>

        </div>

        <div class="ns-footer" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;align-items:center;">
          ${(() => {
            const cid = booking.customerId ?? booking.customer_id;
            if (!cid) return "";
            return `<button type="button" class="booking-action-btn summary" onclick="openCustomerRecordsPage(${cid})">Records</button>
              <button type="button" class="booking-action-btn summary" onclick="closeNotifSummary();openBookingCouponDialog(${booking.id})">Apply coupon</button>`;
          })()}
          <button class="booking-action-btn summary" onclick="closeNotifSummary()">Close</button>
        </div>

      </div>`;

    modal.addEventListener("click", e => { if (e.target === modal) closeNotifSummary(); });
    document.body.appendChild(modal);
}

function closeNotifSummary() {
    const modal = document.getElementById("notifSummaryModal");
    if (modal) modal.remove();
}

function openCustomerRecordsPage(customerId) {
    if (!customerId) return;
    const target = `customer-details.html?id=${encodeURIComponent(customerId)}`;
    if (
        typeof window.staffShellNav === "function" &&
        document.getElementById("staffFrame")
    ) {
        window.staffShellNav(target);
        return;
    }
    window.location.href = `./${target}`;
}

function closeNotifCouponModal() {
    const el = document.getElementById("notifCouponModal");
    if (el) el.remove();
}

function _nsEscapeHtml(s) {
    if (s == null || s === "") return "";
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
}

function _nsCouponValueLabel(c) {
    if (!c) return "";
    if (c.discount_type === "percent") {
        return `${c.discount_value}% off`;
    }
    return `₱${Number(c.discount_value).toLocaleString("en-PH", { minimumFractionDigits: 0 })} off`;
}

function _nsCouponMetaLine(c) {
    const parts = [];
    if (c.max_discount_amount != null && c.max_discount_amount !== "") {
        parts.push(`max ₱${Number(c.max_discount_amount).toLocaleString("en-PH")}`);
    }
    if (c.expires_at) {
        try {
            parts.push(`exp. ${new Date(c.expires_at).toLocaleDateString()}`);
        } catch (_) {}
    }
    if (c.use_limit != null) {
        parts.push(`limit ${c.use_limit}/cust.`);
    }
    parts.push(`used ${c.times_used ?? 0}× (all)`);
    return parts.join(" · ");
}

function openBookingCouponDialog(bookingId) {
    const booking = pendingBookings.find((b) => b.id === bookingId);
    if (!booking) return;
    const cid = booking.customerId ?? booking.customer_id;
    if (!cid) {
        window.heigenAlert("Customer is not linked to this booking.");
        return;
    }
    closeNotifCouponModal();

    const subtotal = Number(booking.subtotal ?? 0);
    const appliedId = booking.appliedCouponId ?? booking.coupon_id ?? null;
    const appliedCode = booking.appliedCouponCode ?? null;
    const appliedDiscount = Number(booking.discount ?? 0);
    const totalNum = Number(booking.total);
    const totalAfter =
        totalNum > 0 ? totalNum : Math.max(0, subtotal - appliedDiscount);

    const wrap = document.createElement("div");
    wrap.id = "notifCouponModal";
    wrap.className = "ns-overlay";
    wrap.innerHTML = `
      <div class="ns-dialog ncoupon-dialog" role="dialog" aria-modal="true">
        <div class="ns-header">
          <span class="ns-title">Apply coupon</span>
          <button type="button" class="ns-close-btn" onclick="closeNotifCouponModal()" aria-label="Close">✕</button>
        </div>
        <div class="ns-body ncoupon-body" id="notifCouponBody">
          <div class="notif-loading">
            <div class="notif-spinner"></div>
            <span>Loading coupons…</span>
          </div>
        </div>
      </div>`;
    wrap.addEventListener("click", (e) => {
        if (e.target === wrap) closeNotifCouponModal();
    });
    document.body.appendChild(wrap);

    (async () => {
        const bodyEl = document.getElementById("notifCouponBody");
        if (!bodyEl) return;

        const fmt = (n) =>
            Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 });

        async function applyCouponByCode(code) {
            const res = await window.apiClient.coupons.validate(
                code,
                cid,
                subtotal,
            );
            if (!res.valid) {
                window.heigenAlert(res.error || "This coupon is not valid for this booking.");
                return;
            }
            await window.apiClient.bookings.patch(bookingId, {
                coupon_id: res.coupon_id,
            });
            closeNotifCouponModal();
            closeNotifSummary();
            await loadPendingBookings();
        }

        try {
            const [allCoupons, customerCoupons] = await Promise.all([
                window.apiClient.coupons.list(),
                window.apiClient.coupons.customerList(cid).catch(() => []),
            ]);
            const sorted = Array.isArray(allCoupons)
                ? [...allCoupons].sort((a, b) =>
                      String(a.code || "").localeCompare(String(b.code || "")),
                  )
                : [];
            const sentToCustomer = Array.isArray(customerCoupons)
                ? customerCoupons
                : [];
            const sentCodeSet = new Set(
                sentToCustomer.map((c) => String(c?.code || "").toUpperCase()),
            );

            const rows = await Promise.all(
                sorted.map(async (c) => {
                    const isApplied =
                        appliedId != null && Number(c.id) === Number(appliedId);
                    if (isApplied) {
                        return { c, isApplied: true };
                    }
                    const res = await window.apiClient.coupons.validate(
                        c.code,
                        cid,
                        subtotal,
                    );
                    return { c, isApplied: false, res };
                }),
            );

            let summaryBlock = "";
            if (appliedId != null) {
                const codeLabel = appliedCode || `Coupon #${appliedId}`;
                summaryBlock = `
                  <div class="ncoupon-summary ncoupon-summary--active">
                    <div class="ncoupon-summary-title">Currently applied</div>
                    <div class="ncoupon-summary-row">
                      <span><strong>${_nsEscapeHtml(codeLabel)}</strong></span>
                      <span class="ncoupon-disc">−₱${fmt(appliedDiscount)}</span>
                    </div>
                    <div class="ncoupon-summary-row ncoupon-muted">
                      <span>Subtotal</span><span>₱${fmt(subtotal)}</span>
                    </div>
                    <div class="ncoupon-summary-row ncoupon-grand">
                      <span>Total</span><span>₱${fmt(totalAfter)}</span>
                    </div>
                    <button type="button" class="ncoupon-remove-btn" id="notifCouponRemoveBtn">Remove coupon</button>
                  </div>`;
            } else {
                summaryBlock = `
                  <div class="ncoupon-summary ncoupon-summary--none">
                    <div class="ncoupon-summary-title">No coupon applied</div>
                    <p class="ncoupon-muted ncoupon-subtotal-line">Booking subtotal: <strong>₱${fmt(subtotal)}</strong></p>
                  </div>`;
            }

            const decoratedRows = rows.map(({ c, isApplied, res }, idx) => {
                const discountAmount =
                    isApplied ? appliedDiscount : Number(res?.discount_amount ?? 0);
                return {
                    c,
                    isApplied,
                    res,
                    idx,
                    discountAmount,
                    valid: Boolean(isApplied || res?.valid),
                };
            });
            decoratedRows.sort((a, b) => {
                if (a.isApplied && !b.isApplied) return -1;
                if (!a.isApplied && b.isApplied) return 1;
                if (a.valid !== b.valid) return a.valid ? -1 : 1;
                return b.discountAmount - a.discountAmount;
            });

            const rowTemplate = ({ c, isApplied, res, idx, discountAmount }) => {
                    const def = _nsCouponValueLabel(c);
                    const meta = _nsEscapeHtml(_nsCouponMetaLine(c));
                    let statusLine = "";
                    let btnHtml = "";
                    if (isApplied) {
                        statusLine = `<div class="ncoupon-est ncoupon-est--ok">On this booking: <strong>−₱${fmt(appliedDiscount)}</strong></div>`;
                        btnHtml = `<span class="ncoupon-applied-pill">Applied</span>`;
                    } else if (res && res.valid) {
                        const d = discountAmount;
                        statusLine = `<div class="ncoupon-est ncoupon-est--ok">If applied: <strong>−₱${fmt(d)}</strong> · New total <strong>₱${fmt(Math.max(0, subtotal - d))}</strong></div>`;
                        btnHtml = `<button type="button" class="ncoupon-apply-btn" data-ncoupon-idx="${idx}">Apply</button>`;
                    } else {
                        const err = _nsEscapeHtml(
                            (res && res.error) || "Not valid for this customer",
                        );
                        statusLine = `<div class="ncoupon-est ncoupon-est--bad">${err}</div>`;
                    }
                    return `
                    <div class="ncoupon-row${isApplied ? " ncoupon-row--applied" : ""}">
                      <div class="ncoupon-row-top">
                        <span class="ncoupon-code">${_nsEscapeHtml(c.code)}</span>
                        <span class="ncoupon-def">${_nsEscapeHtml(def)}</span>
                      </div>
                      <div class="ncoupon-meta">${meta}</div>
                      ${statusLine}
                      <div class="ncoupon-row-actions">${btnHtml}</div>
                    </div>`;
                };
            const customerCouponRows = decoratedRows.filter((r) =>
                sentCodeSet.has(String(r.c?.code || "").toUpperCase()),
            );
            const otherRows = decoratedRows.filter(
                (r) => !sentCodeSet.has(String(r.c?.code || "").toUpperCase()),
            );
            const customerAvailableHtml =
                customerCouponRows.map(rowTemplate).join("");
            const otherRowsHtml = otherRows.map(rowTemplate).join("");

            const manualBlock = `
              <div class="ncoupon-manual">
                <div class="ncoupon-list-title">Enter code manually</div>
                <input type="text" id="notifCouponCodeInput" class="ncoupon-manual-input" placeholder="Coupon code" autocomplete="off">
                <p id="notifCouponErr" class="ncoupon-manual-err"></p>
                <div class="ncoupon-manual-actions">
                  <button type="button" class="ncoupon-manual-btn ncoupon-manual-btn--cancel" onclick="closeNotifCouponModal()">Cancel</button>
                  <button type="button" class="ncoupon-manual-btn ncoupon-manual-btn--apply" id="notifCouponApplyBtn">Apply code</button>
                </div>
              </div>`;

            const validCandidates = decoratedRows.filter(
                (r) => !r.isApplied && r.res && r.res.valid,
            );
            const bestCoupon = validCandidates[0] || null;
            const bestBlock = bestCoupon
                ? `<div class="ncoupon-best-row">
                    <div class="ncoupon-best-label">
                      Best for this booking: <strong>${_nsEscapeHtml(bestCoupon.c.code)}</strong> (−₱${fmt(bestCoupon.discountAmount)})
                    </div>
                    <button type="button" id="notifCouponApplyBestBtn" class="ncoupon-apply-btn">Apply best</button>
                  </div>`
                : "";

            bodyEl.innerHTML =
                summaryBlock +
                `<div class="ncoupon-tabs">
                    <button type="button" class="ncoupon-tab-btn is-active" data-coupon-tab="mine">Coupons</button>
                    <button type="button" class="ncoupon-tab-btn" data-coupon-tab="code">Enter code</button>
                 </div>
                 <div id="couponTabMine" class="ncoupon-tab-pane">
                    ${bestBlock}
                    <input type="text" id="notifCouponSearchInput" class="ncoupon-manual-input ncoupon-search-input" placeholder="Search coupon code">
                    <div class="ncoupon-list" id="notifCouponListWrap">
                        ${customerAvailableHtml
                            ? `<div class="ncoupon-list-title">Customer coupons (sent via email)</div>${customerAvailableHtml}`
                            : '<p class="ncoupon-muted">No customer coupons sent via email for this customer.</p>'}
                        ${otherRowsHtml
                            ? `<div class="ncoupon-list-title ncoupon-list-title--secondary">All coupons</div>${otherRowsHtml}`
                            : ""}
                    </div>
                 </div>
                 <div id="couponTabCode" class="ncoupon-tab-pane hidden">
                    ${manualBlock}
                 </div>`;

            const removeBtn = document.getElementById("notifCouponRemoveBtn");
            if (removeBtn) {
                removeBtn.addEventListener("click", async () => {
                    removeBtn.disabled = true;
                    try {
                        await window.apiClient.bookings.patch(bookingId, {
                            coupon_id: null,
                        });
                        closeNotifCouponModal();
                        closeNotifSummary();
                        await loadPendingBookings();
                    } catch (e) {
                        window.heigenAlert(e.message || "Could not remove coupon.");
                    } finally {
                        removeBtn.disabled = false;
                    }
                });
            }

            bodyEl.querySelectorAll(".ncoupon-apply-btn[data-ncoupon-idx]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const idx = Number(btn.getAttribute("data-ncoupon-idx"));
                    const row = rows[idx];
                    if (!row || !row.c || !row.c.code) return;
                    btn.disabled = true;
                    try {
                        await applyCouponByCode(row.c.code);
                    } catch (e) {
                        window.heigenAlert(e.message || "Could not apply coupon.");
                    } finally {
                        btn.disabled = false;
                    }
                });
            });

            const applyBestBtn = document.getElementById("notifCouponApplyBestBtn");
            if (applyBestBtn && bestCoupon?.c?.code) {
                applyBestBtn.addEventListener("click", async () => {
                    applyBestBtn.disabled = true;
                    try {
                        await applyCouponByCode(bestCoupon.c.code);
                    } catch (e) {
                        window.heigenAlert(e.message || "Could not apply best coupon.");
                    } finally {
                        applyBestBtn.disabled = false;
                    }
                });
            }

            const tabButtons = bodyEl.querySelectorAll(".ncoupon-tab-btn");
            const tabMine = document.getElementById("couponTabMine");
            const tabCode = document.getElementById("couponTabCode");
            tabButtons.forEach((btn) => {
                btn.addEventListener("click", () => {
                    const isMine = btn.getAttribute("data-coupon-tab") === "mine";
                    tabButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
                    if (tabMine) tabMine.classList.toggle("hidden", !isMine);
                    if (tabCode) tabCode.classList.toggle("hidden", isMine);
                    if (!isMine) {
                        const input = document.getElementById("notifCouponCodeInput");
                        if (input) input.focus();
                    }
                });
            });

            const searchInput = document.getElementById("notifCouponSearchInput");
            const listWrap = document.getElementById("notifCouponListWrap");
            if (searchInput && listWrap) {
                searchInput.addEventListener("input", () => {
                    const query = (searchInput.value || "").trim().toLowerCase();
                    const rowsEl = listWrap.querySelectorAll(".ncoupon-row");
                    let visibleCount = 0;
                    rowsEl.forEach((rowEl) => {
                        const codeEl = rowEl.querySelector(".ncoupon-code");
                        const codeText = (codeEl?.textContent || "").toLowerCase();
                        const visible = !query || codeText.includes(query);
                        rowEl.style.display = visible ? "" : "none";
                        if (visible) visibleCount += 1;
                    });
                    let empty = listWrap.querySelector(".ncoupon-empty-search");
                    if (!visibleCount && query) {
                        if (!empty) {
                            empty = document.createElement("p");
                            empty.className = "ncoupon-muted ncoupon-empty-search";
                            listWrap.appendChild(empty);
                        }
                        empty.textContent = "No coupons match your search.";
                    } else if (empty) {
                        empty.remove();
                    }
                });
            }

            const inp = document.getElementById("notifCouponCodeInput");
            const errEl = document.getElementById("notifCouponErr");
            const applyBtn = document.getElementById("notifCouponApplyBtn");
            if (inp) inp.focus();

            async function applyManual() {
                const code = (inp?.value || "").trim();
                if (!code) {
                    if (errEl) errEl.textContent = "Enter a coupon code.";
                    return;
                }
                if (errEl) errEl.textContent = "";
                if (applyBtn) applyBtn.disabled = true;
                try {
                    await applyCouponByCode(code);
                } catch (e) {
                    if (errEl) errEl.textContent = e.message || "Could not apply coupon.";
                } finally {
                    if (applyBtn) applyBtn.disabled = false;
                }
            }
            if (applyBtn) applyBtn.addEventListener("click", applyManual);
            if (inp) {
                inp.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") applyManual();
                });
            }
        } catch (e) {
            bodyEl.innerHTML = `<p class="ncoupon-fatal-err">${_nsEscapeHtml(e.message || "Failed to load coupons.")}</p>
              <div class="ncoupon-manual-actions" style="margin-top:12px;">
                <button type="button" class="booking-action-btn summary" onclick="closeNotifCouponModal()">Close</button>
              </div>`;
        }
    })();
}

function _setItemLoading(bookingId, on) {
    // Grey out the item while waiting
    const items = document.querySelectorAll(".booking-item");
    items.forEach(item => {
        const btns = item.querySelectorAll("[onclick*='" + bookingId + "']");
        if (btns.length) item.style.opacity = on ? "0.5" : "1";
    });
}

// ── Refresh helper (called by refresh buttons on each page) ──────────────────

async function refreshPage() {
    if (IS_STAFF_EMBED) {
        try {
            if (window.parent && typeof window.parent.refreshPage === "function") {
                await window.parent.refreshPage();
            }
        } catch (e) {}
        return;
    }
    const btn = document.getElementById("globalRefreshBtn");
    if (btn) {
        btn.disabled = true;
        btn.classList.add("refreshing");
    }
    try {
        await loadPendingBookings();
        // If the page has its own reload function, call it
        if (typeof loadCustomers === "function")               await loadCustomers();
        else if (typeof refreshDashboardRecs === "function")  { await refreshDashboardRecs(); if(typeof initCharts==="function") initCharts(); }
        else if (typeof loadDashboardData === "function")     { await loadDashboardData();    if(typeof initCharts==="function") initCharts(); }
        else if (typeof loadPackagesData === "function")       await loadPackagesData();
        else if (typeof initializeCustomerDetails === "function") await initializeCustomerDetails();
        else {
            const frame = document.getElementById("staffFrame");
            const page = frame ? (new URL(frame.src, window.location.href).pathname.split("/").pop() || "dashboard.html") : "dashboard.html";
            if (typeof window.staffShellNav === "function" && page) {
                window.staffShellNav(page);
            }
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove("refreshing");
        }
    }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    if (IS_STAFF_EMBED) return;
    _notifSoundEnabled = _readNotifSoundPref();
    _unlockNotifAudioOnce();
    _ensureSoundToggleButton();
    setTimeout(() => {
        if (window.apiClient) loadPendingBookings();
    }, 400);

    // Refresh badge every 30 s in the background
    setInterval(() => {
        if (window.apiClient && !_notifPanelOpen) loadPendingBookings();
    }, 30_000);
});
