// scripts/customer-data.js
// ============================================================================
// CUSTOMER DATA PAGE — data from window.apiClient (Django / Snaplytics).
//
// Filtering: pageState.filterState + window.customerFilters.filterCustomers()
//   uses renewalRate and bookings from GET /api/customers/all/ (DB-backed).
// Booking import: window.bookingImport + POST /api/bookings/import-batch/.
// ============================================================================

const DEFAULT_PAGE_SIZE = 10;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 10;

/** DOM ids for readStateFromDom */
const CUSTOMER_FILTER_IDS = {
    risk: "filterRenewalRisk",
    booking: "filterBookingActivity",
    consent: "filterConsentAgreed",
    dateFrom: "filterDateFrom",
    dateTo: "filterDateTo",
};

const pageState = {
    customers: [],
    selectedRows: new Set(),
    viewMode: "default", // "default" | "select" | "edit"
    showModal: false,
    editingCustomer: null,
    currentPage: 1,
    itemsPerPage: DEFAULT_PAGE_SIZE,
    deleteConfirmation: false,
    selectedSort: "id-asc",
    /** Applied search text (updated when user clicks Apply filters or Reset). */
    searchTerm: "",
    /**
     * Applied filter state (updated on Apply / Clear / Reset).
     * Initialized in DOMContentLoaded — do not call customerFilters at parse time.
     */
    filterState: null,
};

function getItemsPerPage() {
    const n = Number(pageState.itemsPerPage);
    if (!Number.isFinite(n)) return DEFAULT_PAGE_SIZE;
    return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor(n)));
}

function handleCustomerPageSizeChange(el) {
    let v = parseInt(el?.value, 10);
    if (!Number.isFinite(v)) v = DEFAULT_PAGE_SIZE;
    v = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor(v)));
    pageState.itemsPerPage = v;
    if (el) el.value = String(v);
    pageState.currentPage = 1;
    renderTable();
}

function getCurrentUserRole() {
    try {
        const user = JSON.parse(sessionStorage.getItem("user") || "{}");
        return String(user.role || "").toUpperCase();
    } catch (_) {
        return "";
    }
}

function isStaffRole() {
    return getCurrentUserRole() === "STAFF";
}

function applyBookingImportRoleGuard() {
    if (!isStaffRole()) return;
    const importWrap = document.querySelector(".customer-import-below");
    if (importWrap) importWrap.remove();
}

function openBookingImportFormatModal() {
    const container = document.getElementById("modalsContainer");
    if (!container) return;
    container.innerHTML = `
      <div class="customer-import-format-modal-overlay" id="bookingImportFormatModal"
           onclick="if(event.target.id==='bookingImportFormatModal') closeBookingImportFormatModal()">
        <div class="customer-import-format-modal" role="dialog" aria-modal="true" aria-label="Booking import format guide">
          <div class="customer-import-format-header">
            <div>
              <h2 class="customer-import-format-title">Booking Import Format Guide</h2>
              <p class="customer-import-format-subtitle">Customer Data import accepts Excel, JSON, and TXT files.</p>
            </div>
            <button type="button" class="customer-import-format-close" aria-label="Close format guide"
                    onclick="closeBookingImportFormatModal()">×</button>
          </div>
          <div class="customer-import-format-rules">
            <span class="customer-import-rule-chip"><strong>Required:</strong> <code>customer_id</code> or <code>customer_email</code></span>
            <span class="customer-import-rule-chip"><strong>Required:</strong> <code>package_id</code> or <code>total_price</code></span>
            <span class="customer-import-rule-chip"><strong>Optional:</strong> <code>session_date</code>, <code>session_status</code></span>
          </div>

          <section class="customer-import-format-section">
            <h3 class="customer-import-format-heading">Excel (.xlsx / .xls)</h3>
            <p class="customer-import-format-note">Use these column headers in row 1 (case-insensitive).</p>
            <pre class="customer-import-format-code customer-import-format-code--single">customer_id | customer_email | package_id | total_price | session_date | session_status</pre>
            <p class="customer-import-format-note">Sample row:</p>
            <pre class="customer-import-format-code customer-import-format-code--single">1056 | jecylaguilaryurag2@gmail.com | 2 | 359 | 2026-04-03T11:00:00 | BOOKED</pre>
          </section>

          <section class="customer-import-format-section">
            <h3 class="customer-import-format-heading">JSON (.json)</h3>
            <p class="customer-import-format-note">Use either a top-level array or an object with a <code>rows</code> array.</p>
            <pre class="customer-import-format-code">[
  {
    "customer_id": 1056,
    "package_id": 2,
    "total_price": 359,
    "session_date": "2026-04-03T11:00:00",
    "session_status": "BOOKED"
  }
]</pre>
          </section>

          <section class="customer-import-format-section">
            <h3 class="customer-import-format-heading">TXT (.txt as NDJSON)</h3>
            <p class="customer-import-format-note">One JSON object per line (UTF-8 text file).</p>
            <pre class="customer-import-format-code">{"customer_email":"jecylaguilaryurag2@gmail.com","package_id":2,"total_price":359,"session_date":"2026-04-03T11:00:00","session_status":"BOOKED"}
{"customer_id":1056,"package_id":3,"total_price":499}</pre>
          </section>

          <div class="customer-import-format-footer">
            <button type="button" class="customer-toolbar-btn customer-toolbar-btn--primary font-poppins"
                    onclick="closeBookingImportFormatModal()">Close</button>
          </div>
        </div>
      </div>`;
}

function closeBookingImportFormatModal() {
    document.getElementById("bookingImportFormatModal")?.remove();
}

function setBookingImportStatus(message, tone = "neutral") {
    const statusEl = document.getElementById("bookingImportStatus");
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.remove(
        "is-neutral",
        "is-loading",
        "is-success",
        "is-warning",
        "is-error",
    );
    statusEl.classList.add(`is-${tone}`);
}

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

// ── Data loading ──────────────────────────────────────────────────────────────

function setCustomerDataLoadingUi(loading) {
    const loadingEl = document.getElementById("customersLoading");
    const sectionEl = document.getElementById("customerDataLoadedSection");
    if (loadingEl) loadingEl.classList.toggle("hidden", !loading);
    if (sectionEl) sectionEl.classList.toggle("hidden", loading);
}

async function loadCustomers() {
    setCustomerDataLoadingUi(true);
    try {
        const data = await window.apiClient.customers.listAll();
        pageState.customers = Array.isArray(data) ? data : (data.results ?? []);
        renderTable();
    } catch (err) {
        console.error("loadCustomers:", err);
        const tb = document.getElementById("tableBody");
        if (tb) {
            tb.innerHTML =
                `<tr><td colspan="9" class="px-4 py-10 text-center text-sm text-red-700">
               Could not load customers. Is the Django server running?<br>
               <span class="text-red-600/90">${cdEscape(err.message)}</span>
             </td></tr>`;
        }
        const meta = document.getElementById("customerToolbarCountMeta");
        if (meta) meta.textContent = "—";
    } finally {
        setCustomerDataLoadingUi(false);
    }
}

// ── Filter / sort helpers (filtering delegated to customer-filters.js) ───────

/** Copy form → applied state and refresh the table (runs on Apply filters). */
function applyCustomerFiltersFromForm() {
    const f = window.customerFilters;
    if (!pageState.filterState) {
        pageState.filterState = f.createDefaultCustomerFilterState();
    }
    f.readStateFromDom(CUSTOMER_FILTER_IDS, pageState.filterState);
    const si = document.getElementById("searchInput");
    pageState.searchTerm = (si && si.value) ? si.value.trim() : "";
    pageState.currentPage = 1;
    renderTable();
}

/** Reset filter form widgets to default (does not touch sort). */
function resetCustomerFilterFormWidgets() {
    const riskEl = document.getElementById(CUSTOMER_FILTER_IDS.risk);
    if (riskEl) riskEl.value = "all";
    const bookEl = document.getElementById(CUSTOMER_FILTER_IDS.booking);
    if (bookEl) bookEl.value = "all";
    const fromEl = document.getElementById(CUSTOMER_FILTER_IDS.dateFrom);
    const toEl = document.getElementById(CUSTOMER_FILTER_IDS.dateTo);
    const consentEl = document.getElementById(CUSTOMER_FILTER_IDS.consent);
    if (fromEl) fromEl.value = "";
    if (toEl) toEl.value = "";
    if (consentEl) consentEl.checked = false;
}

/** Sort keys look like `field-asc` / `field-desc` (field uses camelCase, no extra hyphens). */
function parseCustomerSort(sortStr) {
    const s = String(sortStr || "id-asc").trim();
    const i = s.lastIndexOf("-");
    if (i <= 0) return { field: "id", dir: "asc" };
    const field = s.slice(0, i);
    const dirRaw = s.slice(i + 1).toLowerCase();
    const dir = dirRaw === "desc" ? "desc" : "asc";
    return { field, dir };
}

function _customerSortComparable(customer, field) {
    switch (field) {
        case "id": {
            const n = Number(customer.id);
            return Number.isFinite(n) ? n : 0;
        }
        case "bookings": {
            const n = Number(customer.bookings);
            return Number.isFinite(n) ? n : 0;
        }
        case "renewalRate": {
            const n = Number(customer.renewalRate);
            return Number.isFinite(n) ? n : -1;
        }
        case "loyaltyPoints": {
            const n = Number(customer.loyaltyPoints);
            return Number.isFinite(n) ? n : -1;
        }
        case "contactNo":
            return String(customer.contactNo ?? "").toLowerCase();
        case "consent":
            return normalizeConsent(customer.consent ?? "").toLowerCase();
        case "name":
        case "email":
            return String(customer[field] ?? "").toLowerCase();
        default:
            return String(customer[field] ?? "").toLowerCase();
    }
}

function _compareCustomerSortPair(a, b, field, asc) {
    const va = _customerSortComparable(a, field);
    const vb = _customerSortComparable(b, field);
    const numFields = new Set([
        "id",
        "bookings",
        "renewalRate",
        "loyaltyPoints",
    ]);
    if (numFields.has(field)) {
        if (va < vb) return asc ? -1 : 1;
        if (va > vb) return asc ? 1 : -1;
        return 0;
    }
    if (va < vb) return asc ? -1 : 1;
    if (va > vb) return asc ? 1 : -1;
    return 0;
}

function getFilteredAndSortedCustomers(customers, searchTerm, sort) {
    const f = window.customerFilters;
    const state =
        pageState.filterState || f.createDefaultCustomerFilterState();
    const list = f.filterCustomers(customers, searchTerm, state);

    const { field, dir } = parseCustomerSort(sort);
    const asc = dir !== "desc";
    list.sort((a, b) => {
        let cmp = _compareCustomerSortPair(a, b, field, asc);
        if (cmp !== 0) return cmp;
        cmp = _compareCustomerSortPair(a, b, "id", true);
        return cmp;
    });

    return list;
}

function handleCustomerSortHeaderClick(field) {
    const key = String(field || "").trim();
    if (!key) return;
    const { field: cur, dir } = parseCustomerSort(pageState.selectedSort);
    let nextDir = "asc";
    if (cur === key) {
        nextDir = dir === "asc" ? "desc" : "asc";
    }
    pageState.selectedSort = `${key}-${nextDir}`;
    pageState.currentPage = 1;
    syncSortControlValue();
    renderTable();
}

function syncCustomerSortHeaders() {
    const { field, dir } = parseCustomerSort(pageState.selectedSort);
    document.querySelectorAll(".customer-sort-btn").forEach((btn) => {
        const f = btn.getAttribute("data-sort-field");
        const active = f === field;
        btn.classList.toggle("customer-sort-btn--active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
        const hint = btn.querySelector(".customer-sort-btn__hint");
        if (hint) {
            hint.textContent = active ? (dir === "asc" ? "▲" : "▼") : "";
        }
        btn.setAttribute(
            "aria-sort",
            active ? (dir === "asc" ? "ascending" : "descending") : "none",
        );
    });
}

function syncSortControlValue() {
    const sortSelect = document.getElementById("sortSelect");
    if (!sortSelect) return;
    const v = pageState.selectedSort || "id-asc";
    const has = [...sortSelect.options].some((o) => o.value === v);
    sortSelect.value = has ? v : sortSelect.options[0]?.value ?? v;
}

function setFilterModalOpen(open) {
    const overlay = document.getElementById("customerFilterModalOverlay");
    const toggleBtn = document.getElementById("filterToggleBtn");
    if (!overlay) return;
    overlay.hidden = !open;
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

/** Display renewal as percent; API sends 0..1 from Snaplytics heuristic. */
function formatRenewalRateDisplay(c) {
    const p = Number(c.renewalRate);
    if (Number.isNaN(p)) return "—";
    return `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
}

function formatLoyaltyPointsDisplay(c) {
    const v = c.loyaltyPoints;
    if (v == null || Number.isNaN(Number(v))) return "0.0";
    return Number(v).toFixed(1);
}

/** Select-mode UI (checkbox column) stays visible while editing a selected row */
function customerTableSelectionUiActive() {
    return (
        pageState.viewMode === "select" || pageState.viewMode === "edit"
    );
}

function _cellTitleAttr(value) {
    const s = String(value ?? "").trim();
    return s ? ` title="${s.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"` : "";
}

function cdEscape(v) {
    const div = document.createElement("div");
    div.textContent = v == null ? "" : String(v);
    return div.innerHTML;
}

/** Pill-style consent badge (Manage Accounts–style UI). */
function consentBadgeHtml(c) {
    const label = normalizeConsent(c.consent ?? "");
    const agree = label === "I Agree";
    if (agree) {
        return '<span class="customer-consent-pill customer-consent-pill--agreed">Agreed</span>';
    }
    return '<span class="customer-consent-pill customer-consent-pill--declined">Declined</span>';
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderTable() {
    const sorted = getFilteredAndSortedCustomers(
        pageState.customers,
        pageState.searchTerm,
        pageState.selectedSort,
    );
    const ipp = getItemsPerPage();
    const totalPages = Math.max(1, Math.ceil(sorted.length / ipp));
    if (pageState.currentPage > totalPages) pageState.currentPage = totalPages;

    const start = (pageState.currentPage - 1) * ipp;
    const visible = sorted.slice(start, start + ipp);

    const tableRoot = document.getElementById("customerDataTable");
    if (tableRoot) {
        tableRoot.classList.toggle(
            "customer-data-heigen-table--select",
            customerTableSelectionUiActive(),
        );
    }

    // ── header checkbox (first column when selecting) ───────────────────────────
    const header = document.getElementById("tableHeader");
    const existCb = header.querySelector(".customer-th-check input");
    if (customerTableSelectionUiActive()) {
        if (!existCb) {
            const th = document.createElement("th");
            th.className =
                "customer-th-check px-2 py-3 text-center align-middle w-11";
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.className = "customer-row-checkbox";
            cb.setAttribute("aria-label", "Select all on this page");
            cb.onchange = handleSelectAll;
            th.appendChild(cb);
            header.insertBefore(th, header.firstChild);
        }
    } else {
        const checkTh = header.querySelector(".customer-th-check");
        if (checkTh) checkTh.remove();
    }

    document.getElementById("tableBody").innerHTML = visible
        .map((c) => {
            let cells = "";
            if (customerTableSelectionUiActive()) {
                cells += `<td class="customer-td customer-td--check px-2 py-3 text-center align-middle">
                <input type="checkbox" class="customer-row-checkbox"
                       ${pageState.selectedRows.has(c.id) ? "checked" : ""}
                       onchange="handleSelectRow(${c.id})"
                       aria-label="Select customer ${c.id}">
              </td>`;
            }
            cells += `
          <td class="customer-td customer-td--id px-3 py-3 text-center align-middle tabular-nums">${c.id}</td>
          <td class="customer-td customer-td--name pl-4 pr-2 py-3 align-middle"${_cellTitleAttr(c.name)}>${cdEscape(c.name ?? "")}</td>
          <td class="customer-td customer-td--email pl-2 pr-4 py-3 align-middle"${_cellTitleAttr(c.email)}>${cdEscape(c.email ?? "")}</td>
          <td class="customer-td customer-td--contact px-4 py-3 align-middle"${_cellTitleAttr(c.contactNo)}>${cdEscape(c.contactNo ?? "")}</td>
          <td class="customer-td customer-td--consent px-2 py-3 text-center align-middle">${consentBadgeHtml(c)}</td>
          <td class="customer-td customer-td--renewal px-2 py-3 text-center align-middle tabular-nums">${formatRenewalRateDisplay(c)}</td>
          <td class="customer-td customer-td--bookings px-2 py-3 text-center align-middle tabular-nums">${c.bookings ?? 0}</td>
          <td class="customer-td customer-td--pts px-2 py-3 text-center align-middle tabular-nums">${formatLoyaltyPointsDisplay(c)}</td>
          <td class="customer-td customer-td--actions py-3 align-middle text-right">
            <button type="button" class="customer-action-view" onclick="navigateToCustomerDetails(${c.id})">View</button>
          </td>`;
            return `<tr class="customer-table-row">${cells}</tr>`;
        })
        .join("");

    const countMeta = document.getElementById("customerToolbarCountMeta");
    if (countMeta) {
        const total = sorted.length;
        countMeta.textContent = `${total} ${total === 1 ? "result" : "results"}`;
    }

    renderActionButtons();
    renderPagination(totalPages);
    syncCustomerSortHeaders();
}

function renderActionButtons() {
    const container = document.getElementById("actionButtons");
    if (!container) return;

    if (pageState.viewMode === "default") {
        container.innerHTML = `
          <button type="button" class="customer-toolbar-footer-btn customer-toolbar-footer-btn--outline" onclick="handleSelectMode()">Select</button>
          <button type="button" class="customer-toolbar-footer-btn customer-toolbar-footer-btn--primary" onclick="handleAddCustomer()">Add</button>`;
    } else if (pageState.viewMode === "select") {
        const many = pageState.selectedRows.size !== 1;
        container.innerHTML = `
          <button type="button" class="customer-toolbar-footer-btn customer-toolbar-footer-btn--danger-outline" onclick="handleDeleteCustomer()">Move</button>
          <button type="button" class="customer-toolbar-footer-btn customer-toolbar-footer-btn--outline"
                  onclick="handleEditCustomer()" ${many ? "disabled" : ""}>Edit</button>
          <button type="button" class="customer-toolbar-footer-btn customer-toolbar-footer-btn--ghost" onclick="handleCancel()">Cancel</button>`;
    } else if (pageState.viewMode === "edit") {
        container.innerHTML = `
          <button type="button" class="customer-toolbar-footer-btn customer-toolbar-footer-btn--primary" onclick="handleSave()">Save</button>
          <button type="button" class="customer-toolbar-footer-btn customer-toolbar-footer-btn--ghost" onclick="handleCancel()">Cancel</button>`;
    }
}

function handleCustomerPagePrev() {
    if (pageState.currentPage <= 1) return;
    pageState.currentPage -= 1;
    renderTable();
}

function handleCustomerPageNext() {
    const sorted = getFilteredAndSortedCustomers(
        pageState.customers,
        pageState.searchTerm,
        pageState.selectedSort,
    );
    const totalPages = Math.max(1, Math.ceil(sorted.length / getItemsPerPage()));
    if (pageState.currentPage >= totalPages) return;
    pageState.currentPage += 1;
    renderTable();
}

function renderPagination(totalPages) {
    const pg = document.getElementById("pagination");
    if (!pg) return;
    let opts = "";
    for (let i = 1; i <= totalPages; i++) {
        opts += `<option value="${i}"
                         ${i === pageState.currentPage ? "selected" : ""}>${i}</option>`;
    }
    const atFirst = pageState.currentPage <= 1;
    const atLast = pageState.currentPage >= totalPages;
    const ipp = getItemsPerPage();
    pg.innerHTML = `
      <button type="button" class="pagination-nav-btn"
              ${atFirst ? "disabled" : ""}
              onclick="handleCustomerPagePrev()"
              aria-label="Previous page">Back</button>
      <div class="pagination-page-group">
      <span class="pagination-label">Page</span>
      <select class="pagination-select"
              onchange="pageState.currentPage = parseInt(this.value, 10); renderTable();"
              aria-label="Current page">
        ${opts}
      </select>
      <span class="pagination-of">of ${totalPages}</span>
      </div>
      <button type="button" class="pagination-nav-btn"
              ${atLast ? "disabled" : ""}
              onclick="handleCustomerPageNext()"
              aria-label="Next page">Next</button>
      <span class="pagination-toolbar-sep" aria-hidden="true"></span>
      <label class="pagination-label pagination-label--rows" for="customerPageSizeInput">Rows</label>
      <input type="number" id="customerPageSizeInput" name="customerPageSizeInput"
             class="pagination-page-size-input"
             min="${MIN_PAGE_SIZE}" max="${MAX_PAGE_SIZE}" step="1"
             value="${ipp}" title="Rows per page (${MIN_PAGE_SIZE}-${MAX_PAGE_SIZE})"
             aria-label="Rows per page" />`;
}

// ── Event handlers ────────────────────────────────────────────────────────────

function handleSelectAll() {
    const sorted = getFilteredAndSortedCustomers(
        pageState.customers,
        pageState.searchTerm,
        pageState.selectedSort,
    );
    const ipp = getItemsPerPage();
    const start = (pageState.currentPage - 1) * ipp;
    const pageIds = sorted
        .slice(start, start + ipp)
        .map((c) => c.id);
    pageState.selectedRows.size === pageIds.length
        ? pageState.selectedRows.clear()
        : (pageState.selectedRows.clear(),
          pageIds.forEach((id) => pageState.selectedRows.add(id)));
    renderTable();
}

function handleSelectRow(id) {
    pageState.selectedRows.has(id)
        ? pageState.selectedRows.delete(id)
        : pageState.selectedRows.add(id);
    renderTable();
}

function handleSelectMode() {
    pageState.viewMode = "select";
    pageState.selectedRows.clear();
    renderTable();
}

function handleCancel() {
    pageState.selectedRows.clear();
    pageState.viewMode = "default";
    pageState.showModal = false;
    pageState.editingCustomer = null;
    pageState.deleteConfirmation = false;
    document.getElementById("modalsContainer").innerHTML = "";
    renderTable();
}

function handleSave() {
    handleCancel();
}

function navigateToCustomerDetails(id) {
    window.location.href = `customer-details.html?id=${id}`;
}

// ── Add / Edit ───────────────────────────────────────────────────────────────

function handleAddCustomer() {
    pageState.editingCustomer = null;
    pageState.showModal = true;
    renderCustomerModal();
}

function handleEditCustomer() {
    if (pageState.selectedRows.size !== 1) return;
    const id = [...pageState.selectedRows][0];
    const c = pageState.customers.find((x) => x.id === id);
    if (!c) return;
    pageState.editingCustomer = JSON.parse(JSON.stringify(c));
    pageState.viewMode = "edit";
    pageState.showModal = true;
    renderCustomerModal();
    renderTable();
}

function renderCustomerModal() {
    const c = pageState.editingCustomer || {};

    // Build the modal HTML without any value="" attributes
    document.getElementById("modalsContainer").innerHTML = `
      <div class="modal-overlay" id="customerModal"
           onclick="if(event.target.id==='customerModal') closeCustomerModal()">
        <div class="modal-content">
          <h2 class="modal-title">Customer Info</h2>
          <form onsubmit="handleSaveCustomer(event)"
                style="width:100%;display:flex;flex-direction:column;gap:32px;">
            <div class="form-group">
              <label class="form-label">Name</label>
              <input type="text" id="customerName"
                     placeholder="Enter full name"
                     class="form-input" required
                     autocomplete="off">
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" id="customerEmail"
                     placeholder="Enter email"
                     class="form-input" required
                     autocomplete="off">
            </div>
            <div class="form-group">
              <label class="form-label">Contact No.</label>
              <input type="tel" id="customerContactNo"
                     placeholder="Enter contact no."
                     class="form-input"
                     autocomplete="off">
            </div>
            <div class="checkbox-wrapper">
              <input type="checkbox" id="customerConsent" class="checkbox">
              <label class="checkbox-label">
                I hereby consent to Heigen Studio releasing my photos on
                public and social media platforms.
              </label>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn-back"
                      onclick="closeCustomerModal()">Back</button>
              <button type="submit" class="btn-next">Save</button>
            </div>
          </form>
        </div>
      </div>`;

    // Set values via .value property AFTER DOM insertion — this is always editable
    document.getElementById("customerName").value = c.name ?? "";
    document.getElementById("customerEmail").value = c.email ?? "";
    document.getElementById("customerContactNo").value = c.contactNo ?? "";
    document.getElementById("customerConsent").checked =
        normalizeConsent(c.consent) === "I Agree";
}

async function handleSaveCustomer(event) {
    event.preventDefault();
    const payload = {
        name: document.getElementById("customerName").value.trim(),
        email: document.getElementById("customerEmail").value.trim(),
        contactNo: document.getElementById("customerContactNo").value.trim(),
        consent: document.getElementById("customerConsent").checked
            ? "I Agree"
            : "I Disagree",
    };
    const overlay = document.getElementById("pageLoadingOverlay");
    if (overlay) { overlay.style.display = "flex"; overlay.querySelector(".loading-label").textContent = "Saving…"; }
    try {
        if (pageState.editingCustomer) {
            const updated = await window.apiClient.customers.update(
                pageState.editingCustomer.id,
                payload,
            );
            const idx = pageState.customers.findIndex(
                (c) => c.id === pageState.editingCustomer.id,
            );
            if (idx !== -1)
                pageState.customers[idx] = {
                    ...pageState.customers[idx],
                    ...updated,
                };
        } else {
            const created = await window.apiClient.customers.create(payload);
            pageState.customers.push(created);
            const total = Math.ceil(
                pageState.customers.length / getItemsPerPage(),
            );
            pageState.currentPage = total;
        }
    } catch (err) {
        console.error("handleSaveCustomer:", err);
        window.heigenAlert("Failed to save customer: " + err.message);
        if (overlay) overlay.style.display = "none";
        return;
    } finally {
        if (overlay) overlay.style.display = "none";
    }
    pageState.viewMode = "default";
    pageState.showModal = false;
    pageState.editingCustomer = null;
    document.getElementById("modalsContainer").innerHTML = "";
    renderTable();
}

function closeCustomerModal() {
    pageState.showModal = false;
    pageState.editingCustomer = null;
    document.getElementById("customerModal")?.remove();
    if (pageState.viewMode === "edit") {
        pageState.viewMode = "select";
        renderTable();
    }
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function handleDeleteCustomer() {
    if (!pageState.selectedRows.size) return;
    const count = pageState.selectedRows.size;
    const ok = await window.heigenConfirm(
        `Move ${count} ${count === 1 ? "customer" : "customers"} to Internal Records?\n\nAdmin/Owner can restore from Internal Records.`,
        {
            title: "Remove customers",
            confirmText: "Remove",
            dangerous: true,
        },
    );
    if (!ok) return;

    const overlay = document.getElementById("pageLoadingOverlay");
    if (overlay) {
        overlay.style.display = "flex";
        overlay.querySelector(".loading-label").textContent = "Removing…";
    }
    try {
        await window.apiClient.customers.bulkDelete(pageState.selectedRows);
        pageState.customers = pageState.customers.filter(
            (c) => !pageState.selectedRows.has(c.id),
        );
    } catch (err) {
        console.error("handleDeleteCustomer:", err);
        window.heigenAlert("Delete failed: " + err.message);
        if (overlay) overlay.style.display = "none";
        return;
    } finally {
        if (overlay) overlay.style.display = "none";
    }
    const newTotal = Math.ceil(pageState.customers.length / getItemsPerPage());
    if (pageState.currentPage > newTotal && newTotal > 0)
        pageState.currentPage = newTotal;
    pageState.selectedRows.clear();
    pageState.viewMode = "default";
    pageState.deleteConfirmation = false;
    document.getElementById("modalsContainer").innerHTML = "";
    renderTable();
}

// ── Wire up filters / search / sort on DOMContentLoaded ──────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    if (!window.customerFilters) {
        console.error("customer-filters.js must load before customer-data.js");
        return;
    }
    pageState.filterState =
        window.customerFilters.createDefaultCustomerFilterState();
    applyBookingImportRoleGuard();

    document.getElementById("tableHeader")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".customer-sort-btn");
        if (!btn) return;
        const field = btn.getAttribute("data-sort-field");
        if (field) handleCustomerSortHeaderClick(field);
    });

    await loadCustomers();

    document.addEventListener("change", (e) => {
        if (e.target?.id === "customerPageSizeInput") {
            handleCustomerPageSizeChange(e.target);
        }
    });
    document.addEventListener("keydown", (e) => {
        if (e.target?.id === "customerPageSizeInput" && e.key === "Enter") {
            e.preventDefault();
            handleCustomerPageSizeChange(e.target);
        }
    });

    document.getElementById("searchInput")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            applyCustomerFiltersFromForm();
        }
    });

    document.getElementById("filterApplyBtn")?.addEventListener("click", () => {
        applyCustomerFiltersFromForm();
        setFilterModalOpen(false);
    });

    document.getElementById("filterBarClearBtn")?.addEventListener("click", () => {
        resetCustomerFilterFormWidgets();
        pageState.filterState =
            window.customerFilters.createDefaultCustomerFilterState();
        pageState.searchTerm = "";
        const si = document.getElementById("searchInput");
        if (si) si.value = "";
        pageState.currentPage = 1;
        renderTable();
    });

    // Booking import → POST import-batch → reload list (renewal rates refresh server-side).
    document.getElementById("bookingImportBtn")?.addEventListener("click", async () => {
        if (isStaffRole()) {
            window.heigenAlert("Booking data import is restricted to ADMIN and OWNER.");
            return;
        }
        const input = document.getElementById("bookingImportFile");
        const file = input?.files?.[0];
        if (!file) {
            setBookingImportStatus(
                "Choose a file first (.xlsx, .xls, .json, .txt).",
                "error",
            );
            return;
        }
        setBookingImportStatus("Parsing file...", "loading");
        try {
            const { rows, parseErrors } = await window.bookingImport.parseBookingFile(file);
            if (parseErrors.length) {
                const sample = parseErrors
                    .slice(0, 3)
                    .map((e) => `row ${e.row_index + 1}: ${e.error}`)
                    .join("; ");
                setBookingImportStatus(
                    `Fix ${parseErrors.length} row(s). ${sample}`,
                    "error",
                );
                return;
            }
            if (!rows.length) {
                setBookingImportStatus("No valid rows to import.", "error");
                return;
            }
            setBookingImportStatus("Uploading rows...", "loading");
            const res = await window.apiClient.bookings.importBatch(rows);
            const apiErrs = res.errors || [];
            const created = res.created_count ?? 0;
            const errMsg =
                apiErrs.length > 0
                    ? ` API row errors: ${apiErrs
                          .slice(0, 3)
                          .map((e) => `#${e.row_index}:${e.error}`)
                          .join("; ")}`
                    : "";
            const tone = apiErrs.length > 0 ? "warning" : "success";
            setBookingImportStatus(`Imported ${created} booking(s).${errMsg}`, tone);
            await loadCustomers();
            input.value = "";
        } catch (err) {
            console.error("booking import:", err);
            setBookingImportStatus(err.message || "Import failed.", "error");
        }
    });

    document
        .getElementById("bookingImportFormatBtn")
        ?.addEventListener("click", () => {
            if (isStaffRole()) {
                window.heigenAlert("Import format guide is available only for ADMIN and OWNER.");
                return;
            }
            openBookingImportFormatModal();
        });

    document.getElementById("bookingImportFile")?.addEventListener("change", (e) => {
        const name = e?.target?.files?.[0]?.name;
        if (name) {
            setBookingImportStatus(`Selected file: ${name}`, "neutral");
            return;
        }
        setBookingImportStatus("", "neutral");
    });

    document.getElementById("filterToggleBtn")?.addEventListener("click", () => {
        const overlay = document.getElementById("customerFilterModalOverlay");
        const isOpen = !!overlay && !overlay.hidden;
        setFilterModalOpen(!isOpen);
    });

    document.getElementById("filterModalCloseBtn")?.addEventListener("click", () => {
        setFilterModalOpen(false);
    });

    document.getElementById("customerFilterModalOverlay")?.addEventListener("click", (e) => {
        if (e.target?.id === "customerFilterModalOverlay") {
            setFilterModalOpen(false);
        }
    });

    document.getElementById("sortSelect")?.addEventListener("change", (e) => {
        pageState.selectedSort = e.target.value || "id-asc";
        pageState.currentPage = 1;
        renderTable();
    });

    // Sort menu
    const sortBtn = document.getElementById("sortBtn");
    const sortMenu = document.getElementById("sortMenuPopup");
    const sortOpts = sortMenu?.querySelectorAll(".sort-option") ?? [];

    sortBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        const visible = sortMenu.style.display !== "none";
        sortMenu.style.display = visible ? "none" : "block";
        if (!visible) {
            void sortMenu.offsetWidth;
            const menuW = sortMenu.getBoundingClientRect().width || 220;
            const r = sortBtn.getBoundingClientRect();
            const pad = 8;
            let right = window.innerWidth - r.right;
            if (right + menuW > window.innerWidth - pad) {
                right = Math.max(pad, window.innerWidth - r.left - menuW);
            }
            Object.assign(sortMenu.style, {
                position: "fixed",
                top: r.bottom + pad + "px",
                left: "auto",
                right: right + "px",
                width: "max-content",
            });
        }
    });

    sortOpts.forEach((opt) => {
        opt.addEventListener("click", function () {
            pageState.selectedSort = this.dataset.sort;
            pageState.currentPage = 1;
            syncSortControlValue();
            sortOpts.forEach((o) => o.classList.remove("active"));
            this.classList.add("active");
            sortMenu.style.display = "none";
            renderTable();
        });
    });

    document.addEventListener("click", (e) => {
        if (
            !e.target.closest("#sortBtn") &&
            !e.target.closest("#sortMenuPopup")
        )
            sortMenu.style.display = "none";
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") setFilterModalOpen(false);
    });

    // Notification panel is handled globally by notif.js
    syncSortControlValue();
    syncCustomerSortHeaders();
    setFilterModalOpen(false);
});

window.openBookingImportFormatModal = openBookingImportFormatModal;
window.closeBookingImportFormatModal = closeBookingImportFormatModal;
window.handleCustomerSortHeaderClick = handleCustomerSortHeaderClick;
window.closeCustomerModal = closeCustomerModal;
