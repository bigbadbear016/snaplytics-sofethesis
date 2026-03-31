// scripts/notif.js
// ============================================================================
// BOOKING STATUS NOTIFICATION PANEL — works on every page, no redirect needed
// ============================================================================

let pendingBookings = [];
let _notifPanelOpen = false;
const IS_STAFF_EMBED =
    window.self !== window.top ||
    new URLSearchParams(window.location.search).get("embed") === "1";

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
        alert("Customer is not linked to this booking.");
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
                alert(res.error || "This coupon is not valid for this booking.");
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
                        alert(e.message || "Could not remove coupon.");
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
                        alert(e.message || "Could not apply coupon.");
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
                        alert(e.message || "Could not apply best coupon.");
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
    setTimeout(() => {
        if (window.apiClient) loadPendingBookings();
    }, 400);

    // Refresh badge every 30 s in the background
    setInterval(() => {
        if (window.apiClient && !_notifPanelOpen) loadPendingBookings();
    }, 30_000);
});
