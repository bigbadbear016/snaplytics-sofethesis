// scripts/notif.js
// ============================================================================
// BOOKING STATUS NOTIFICATION PANEL — works on every page, no redirect needed
// ============================================================================

let pendingBookings = [];
let _notifPanelOpen = false;

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
    if (content) {
        content.innerHTML = `
          <div class="notif-loading">
            <div class="notif-spinner"></div>
            <span>Loading bookings…</span>
          </div>`;
    }
    try {
        const all = await window.apiClient.bookings.listPendingOngoing();
        pendingBookings = Array.isArray(all) ? all : [];
        updateNotificationBadge();
        renderBookingItems();
    } catch (err) {
        console.error("loadPendingBookings:", err);
        if (content) {
            content.innerHTML = `<div class="empty-bookings" style="color:#c00;">
              Could not load bookings.<br><small>${err.message}</small>
            </div>`;
        }
    }
}

function updateNotificationBadge() {
    const badge = document.getElementById("notificationBadge");
    if (!badge) return;
    // Only count true Pending (kiosk-originated, not yet accepted)
    const pending = pendingBookings.filter(b => b.session_status === "Pending");
    const count   = pending.length;
    badge.textContent   = count;
    badge.style.display = count > 0 ? "flex" : "none";
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderBookingItems() {
    const content = document.getElementById("bookingStatusContent");
    if (!content) return;

    if (!pendingBookings.length) {
        content.innerHTML = '<div class="empty-bookings">No pending bookings</div>';
        return;
    }

    content.innerHTML = pendingBookings.map((booking) => {
        const name    = booking.customer_name ?? "Unknown Customer";
        const rawDate = booking.session_date ?? booking.created_at;
        const dateStr = rawDate ? new Date(rawDate).toLocaleDateString("en-US") : "";
        const status  = booking.session_status ?? "Pending";
        const isPending  = status === "Pending";
        const isOngoing  = status === "Ongoing";

        const pendingIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2" fill="none"/>
            <path d="M12 6V12L16 14" stroke="white" stroke-width="2" stroke-linecap="round"/>
          </svg>`;
        const ongoingIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2" fill="none"/>
            <path d="M8 12H16M12 8V16" stroke="white" stroke-width="2" stroke-linecap="round"/>
          </svg>`;

        const actions = isPending ? `
            <button class="booking-action-btn start"  onclick="handleStartBooking(${booking.id})">Accept</button>
            <button class="booking-action-btn deny"   onclick="handleDenyBooking(${booking.id})">Deny</button>` : "";
        const ongoingActions = isOngoing ? `
            <button class="booking-action-btn done"   onclick="handleDoneBooking(${booking.id})">Done</button>
            <button class="booking-action-btn cancel" onclick="handleCancelBooking(${booking.id})">Cancel</button>` : "";

        const cid = booking.customerId ?? booking.customer_id;
        const recordsBtn = cid
            ? `<button type="button" class="booking-action-btn summary" onclick="openCustomerRecordsPage(${cid})">Records</button>`
            : "";
        const couponBtn = cid
            ? `<button type="button" class="booking-action-btn summary" onclick="openBookingCouponDialog(${booking.id})">Apply coupon</button>`
            : "";

        return `
          <div class="booking-item">
            <div class="booking-item-top">
              <div class="booking-customer-info">
                <div class="booking-customer-label">Customer</div>
                <div class="booking-customer-name">${name}</div>
              </div>
              <div class="booking-meta">
                ${dateStr ? `<div class="booking-date">${dateStr}</div>` : ""}
                <div class="booking-status-badge ${status.toLowerCase()}">
                  ${isPending ? pendingIcon : ongoingIcon}
                  ${status}
                </div>
              </div>
            </div>
            <div class="booking-actions">
              ${actions}${ongoingActions}
              ${recordsBtn}${couponBtn}
              <button class="booking-action-btn summary" onclick="handleViewBookingSummary(${booking.id})">Summary</button>
            </div>
          </div>`;
    }).join("");
}

// ── Status mutations ──────────────────────────────────────────────────────────

async function handleStartBooking(bookingId) {
    try {
        _setItemLoading(bookingId, true);
        await window.apiClient.bookings.updateStatus(bookingId, "Ongoing");
        await loadPendingBookings();
    } catch (err) {
        console.error("handleStartBooking:", err);
        alert("Failed to accept booking: " + err.message);
        await loadPendingBookings();
    }
}

async function handleDoneBooking(bookingId) {
    try {
        _setItemLoading(bookingId, true);
        await window.apiClient.bookings.updateStatus(bookingId, "BOOKED");
        await loadPendingBookings();
    } catch (err) {
        console.error("handleDoneBooking:", err);
        alert("Failed to complete booking: " + err.message);
        await loadPendingBookings();
    }
}

async function handleDenyBooking(bookingId) {
    if (!confirm("Deny this booking? This cannot be undone.")) return;
    try {
        _setItemLoading(bookingId, true);
        await window.apiClient.bookings.removeById(bookingId);
        await loadPendingBookings();
    } catch (err) {
        console.error("handleDenyBooking:", err);
        alert("Failed to deny booking: " + err.message);
        await loadPendingBookings();
    }
}

async function handleCancelBooking(bookingId) {
    if (!confirm("Move this booking back to Pending?")) return;
    try {
        _setItemLoading(bookingId, true);
        await window.apiClient.bookings.updateStatus(bookingId, "Pending");
        await loadPendingBookings();
    } catch (err) {
        console.error("handleCancelBooking:", err);
        alert("Failed to cancel booking: " + err.message);
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
    const preferredDate = booking.preferred_date ?? null;
    const bookingDate   = booking.date ?? null;

    const customerName = booking.customer_name    ?? null;
    const email        = booking.customer_email   ?? null;  // from customer.email
    const contact      = booking.customer_contact ?? null;  // from customer.contact_number
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
              <span>Voucher</span>
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
    window.location.href = `./customer-details.html?id=${encodeURIComponent(customerId)}`;
}

function closeNotifCouponModal() {
    const el = document.getElementById("notifCouponModal");
    if (el) el.remove();
}

function openBookingCouponDialog(bookingId) {
    const booking = pendingBookings.find((b) => b.id === bookingId);
    if (!booking) return;
    const cid = booking.customerId ?? booking.customer_id;
    if (!cid) {
        alert("Customer is not linked to this booking.");
        return;
    }
    closeNotifCouponModal();
    const subtotal = Number(booking.subtotal ?? 0);
    const wrap = document.createElement("div");
    wrap.id = "notifCouponModal";
    wrap.className = "ns-overlay";
    wrap.innerHTML = `
      <div class="ns-dialog" role="dialog" aria-modal="true" style="max-width:420px;">
        <div class="ns-header">
          <span class="ns-title">Apply coupon</span>
          <button type="button" class="ns-close-btn" onclick="closeNotifCouponModal()" aria-label="Close">✕</button>
        </div>
        <div class="ns-body">
          <p style="font-size:13px;color:#616161;margin-bottom:10px;">Subtotal used for validation: ₱${subtotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p>
          <input type="text" id="notifCouponCodeInput" placeholder="Coupon code"
            style="width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:8px;">
          <p id="notifCouponErr" style="font-size:12px;color:#c00;margin:0;min-height:16px;"></p>
        </div>
        <div class="ns-footer" style="display:flex;gap:8px;justify-content:flex-end;">
          <button type="button" class="booking-action-btn summary" onclick="closeNotifCouponModal()">Cancel</button>
          <button type="button" class="booking-action-btn start" id="notifCouponApplyBtn">Apply</button>
        </div>
      </div>`;
    wrap.addEventListener("click", (e) => {
        if (e.target === wrap) closeNotifCouponModal();
    });
    document.body.appendChild(wrap);
    const inp = document.getElementById("notifCouponCodeInput");
    const errEl = document.getElementById("notifCouponErr");
    const btn = document.getElementById("notifCouponApplyBtn");
    if (inp) inp.focus();

    async function apply() {
        const code = (inp?.value || "").trim();
        if (!code) {
            errEl.textContent = "Enter a coupon code.";
            return;
        }
        errEl.textContent = "";
        btn.disabled = true;
        try {
            const res = await window.apiClient.coupons.validate(code, cid, subtotal);
            if (!res.valid) {
                errEl.textContent = res.error || "Invalid coupon.";
                return;
            }
            await window.apiClient.bookings.patch(bookingId, {
                coupon_id: res.coupon_id,
            });
            closeNotifCouponModal();
            closeNotifSummary();
            await loadPendingBookings();
        } catch (e) {
            errEl.textContent = e.message || "Could not apply coupon.";
        } finally {
            btn.disabled = false;
        }
    }
    btn.addEventListener("click", apply);
    inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") apply();
    });
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
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove("refreshing");
        }
    }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        if (window.apiClient) loadPendingBookings();
    }, 400);

    // Refresh badge every 30 s in the background
    setInterval(() => {
        if (window.apiClient && !_notifPanelOpen) loadPendingBookings();
    }, 30_000);
});
