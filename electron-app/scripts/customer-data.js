// scripts/customer-data.js
// ============================================================================
// CUSTOMER DATA PAGE — data from window.apiClient (Django / Snaplytics).
//
// Filtering: pageState.filterState + window.customerFilters.filterCustomers()
//   uses renewalRate and bookings from GET /api/customers/all/ (DB-backed).
// Booking import: window.bookingImport + POST /api/bookings/import-batch/.
// ============================================================================

const ITEMS_PER_PAGE = 16;

/** DOM ids for readStateFromDom */
const CUSTOMER_FILTER_IDS = {
    risk: "filterRenewalRisk",
    booking: "filterBookingActivity",
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

async function loadCustomers() {
    const overlay = document.getElementById("pageLoadingOverlay");
    if (overlay) overlay.style.display = "flex";
    try {
        const data = await window.apiClient.customers.listAll();
        pageState.customers = Array.isArray(data) ? data : (data.results ?? []);
        renderTable();
    } catch (err) {
        console.error("loadCustomers:", err);
        document.getElementById("tableBody").innerHTML =
            `<div style="padding:20px;color:#c00;">
               Could not load customers. Is the Django server running?<br>
               <small>${err.message}</small>
             </div>`;
    } finally {
        if (overlay) overlay.style.display = "none";
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
    if (fromEl) fromEl.value = "";
    if (toEl) toEl.value = "";
}

function getFilteredAndSortedCustomers(customers, searchTerm, sort) {
    const f = window.customerFilters;
    const state =
        pageState.filterState || f.createDefaultCustomerFilterState();
    const list = f.filterCustomers(customers, searchTerm, state);

    const [field, dir] = (sort ?? "id-asc").split("-");
    const asc = dir !== "desc";
    list.sort((a, b) => {
        let va;
        let vb;
        if (field === "bookings") {
            va = a.bookings ?? 0;
            vb = b.bookings ?? 0;
        } else if (field === "renewalRate") {
            va = a.renewalRate ?? 0;
            vb = b.renewalRate ?? 0;
        } else {
            va = a[field] ?? "";
            vb = b[field] ?? "";
        }
        if (typeof va === "string") va = va.toLowerCase();
        if (typeof vb === "string") vb = vb.toLowerCase();
        if (va < vb) return asc ? -1 : 1;
        if (va > vb) return asc ? 1 : -1;
        return 0;
    });

    return list;
}

/** Display renewal as percent; API sends 0..1 from Snaplytics heuristic. */
function formatRenewalRateDisplay(c) {
    const p = Number(c.renewalRate);
    if (Number.isNaN(p)) return "—";
    return `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderTable() {
    const sorted = getFilteredAndSortedCustomers(
        pageState.customers,
        pageState.searchTerm,
        pageState.selectedSort,
    );
    const totalPages = Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE));
    if (pageState.currentPage > totalPages) pageState.currentPage = totalPages;

    const start = (pageState.currentPage - 1) * ITEMS_PER_PAGE;
    const visible = sorted.slice(start, start + ITEMS_PER_PAGE);

    const tableRoot = document.getElementById("customerDataTable");
    if (tableRoot) {
        tableRoot.classList.toggle(
            "customer-data-table--select",
            pageState.viewMode === "select",
        );
    }

    // ── header checkbox (grid first column when selecting) ────────────────────
    const header = document.getElementById("tableHeader");
    const existCb = header.querySelector(".customer-col--check input");
    if (pageState.viewMode === "select") {
        if (!existCb) {
            const wrap = document.createElement("div");
            wrap.className =
                "customer-col customer-col--check";
            wrap.style.cssText =
                "display:flex;align-items:center;justify-content:center;";
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.style.cssText =
                "width:18px;height:18px;border-radius:4px;" +
                "border:2px solid #37352F;cursor:pointer;";
            cb.onchange = handleSelectAll;
            wrap.appendChild(cb);
            header.insertBefore(wrap, header.firstChild);
        }
    } else {
        const checkWrap = header.querySelector(".customer-col--check");
        if (checkWrap) checkWrap.remove();
    }

    // ── rows: same grid columns as header (customers.css .customer-data-grid) ─
    document.getElementById("tableBody").innerHTML = visible
        .map((c) => {
            let row =
                '<div class="table-row customer-data-grid">';
            if (pageState.viewMode === "select") {
                row += `
              <div class="customer-col customer-col--check" style="display:flex;align-items:center;justify-content:center;">
                <input type="checkbox"
                       ${pageState.selectedRows.has(c.id) ? "checked" : ""}
                       onchange="handleSelectRow(${c.id})"
                       style="width:18px;height:18px;border-radius:4px;border:2px solid #37352F;cursor:pointer;">
              </div>`;
            }
            row += `
          <div class="customer-col customer-col--id">${c.id}</div>
          <div class="customer-col">${c.name ?? ""}</div>
          <div class="customer-col">${c.email ?? ""}</div>
          <div class="customer-col">${c.contactNo ?? ""}</div>
          <div class="customer-col">${normalizeConsent(c.consent ?? "")}</div>
          <div class="customer-col customer-col--num">${formatRenewalRateDisplay(c)}</div>
          <div class="customer-col customer-col--num">${c.bookings ?? 0}</div>
          <div class="customer-col customer-col--actions"
               onclick="navigateToCustomerDetails(${c.id})">View Details</div>
        </div>`;
            return row;
        })
        .join("");

    renderActionButtons();
    renderPagination(totalPages);
}

function renderActionButtons() {
    const container = document.getElementById("actionButtons");
    if (!container) return;

    if (pageState.viewMode === "default") {
        container.innerHTML = `
          <button class="btn btn-select" onclick="handleSelectMode()">Select</button>
          <button class="btn btn-add"    onclick="handleAddCustomer()">Add</button>`;
    } else if (pageState.viewMode === "select") {
        const none = pageState.selectedRows.size === 0;
        const many = pageState.selectedRows.size !== 1;
        container.innerHTML = `
          <button class="btn btn-delete" onclick="handleDeleteCustomer()">Delete</button>
          <button class="btn btn-edit ${many ? "disabled" : ""}"
                  onclick="handleEditCustomer()" ${many ? "disabled" : ""}>Edit</button>
          <button class="btn btn-cancel" onclick="handleCancel()">Cancel</button>`;
    } else if (pageState.viewMode === "edit") {
        container.innerHTML = `
          <button class="btn btn-save"   onclick="handleSave()">Save</button>
          <button class="btn btn-cancel" onclick="handleCancel()">Cancel</button>`;
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
    const totalPages = Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE));
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
    pg.innerHTML = `
      <button type="button" class="pagination-nav-btn"
              ${atFirst ? "disabled" : ""}
              onclick="handleCustomerPagePrev()"
              aria-label="Previous page">Back</button>
      <span class="pagination-label">Page</span>
      <select class="pagination-select"
              onchange="pageState.currentPage = parseInt(this.value, 10); renderTable();">
        ${opts}
      </select>
      <span class="pagination-label">of ${totalPages}</span>
      <button type="button" class="pagination-nav-btn"
              ${atLast ? "disabled" : ""}
              onclick="handleCustomerPageNext()"
              aria-label="Next page">Next</button>`;
}

// ── Event handlers ────────────────────────────────────────────────────────────

function handleSelectAll() {
    const sorted = getFilteredAndSortedCustomers(
        pageState.customers,
        pageState.searchTerm,
        pageState.selectedSort,
    );
    const start = (pageState.currentPage - 1) * ITEMS_PER_PAGE;
    const pageIds = sorted
        .slice(start, start + ITEMS_PER_PAGE)
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
                pageState.customers.length / ITEMS_PER_PAGE,
            );
            pageState.currentPage = total;
        }
    } catch (err) {
        console.error("handleSaveCustomer:", err);
        alert("Failed to save customer: " + err.message);
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
}

// ── Delete ────────────────────────────────────────────────────────────────────

function handleDeleteCustomer() {
    if (!pageState.selectedRows.size) return;
    const count = pageState.selectedRows.size;
    document.getElementById("modalsContainer").innerHTML = `
      <div class="confirmation-dialog" id="deleteConfirmModal">
        <div class="confirmation-content">
          <h3 class="confirmation-title">Delete Customers</h3>
          <p class="confirmation-message">
            Delete ${count} ${count === 1 ? "customer" : "customers"}?
            This cannot be undone.
          </p>
          <div class="confirmation-actions">
            <button class="btn-confirm-cancel"
                    onclick="cancelDeleteCustomer()">Cancel</button>
            <button class="btn-confirm-delete"
                    onclick="confirmDeleteCustomer()">Delete</button>
          </div>
        </div>
      </div>`;
}

async function confirmDeleteCustomer() {
    const overlay = document.getElementById("pageLoadingOverlay");
    if (overlay) { overlay.style.display = "flex"; overlay.querySelector(".loading-label").textContent = "Deleting…"; }
    try {
        await window.apiClient.customers.bulkDelete(pageState.selectedRows);
        pageState.customers = pageState.customers.filter(
            (c) => !pageState.selectedRows.has(c.id),
        );
    } catch (err) {
        console.error("confirmDeleteCustomer:", err);
        alert("Delete failed: " + err.message);
        if (overlay) overlay.style.display = "none";
        return;
    } finally {
        if (overlay) overlay.style.display = "none";
    }
    const newTotal = Math.ceil(pageState.customers.length / ITEMS_PER_PAGE);
    if (pageState.currentPage > newTotal && newTotal > 0)
        pageState.currentPage = newTotal;
    pageState.selectedRows.clear();
    pageState.viewMode = "default";
    pageState.deleteConfirmation = false;
    document.getElementById("modalsContainer").innerHTML = "";
    renderTable();
}

function cancelDeleteCustomer() {
    pageState.deleteConfirmation = false;
    document.getElementById("modalsContainer").innerHTML = "";
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

    await loadCustomers();

    document.getElementById("searchInput")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            applyCustomerFiltersFromForm();
        }
    });

    document.getElementById("filterApplyBtn")?.addEventListener("click", () => {
        applyCustomerFiltersFromForm();
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
            alert("Booking data import is restricted to ADMIN and OWNER.");
            return;
        }
        const input = document.getElementById("bookingImportFile");
        const statusEl = document.getElementById("bookingImportStatus");
        const file = input?.files?.[0];
        if (!file) {
            if (statusEl) statusEl.textContent = "Choose a file first (.xlsx, .json, .txt).";
            return;
        }
        if (statusEl) statusEl.textContent = "Parsing…";
        try {
            const { rows, parseErrors } = await window.bookingImport.parseBookingFile(file);
            if (parseErrors.length) {
                const sample = parseErrors
                    .slice(0, 3)
                    .map((e) => `row ${e.row_index + 1}: ${e.error}`)
                    .join("; ");
                if (statusEl) {
                    statusEl.textContent = `Fix ${parseErrors.length} row(s). ${sample}`;
                }
                return;
            }
            if (!rows.length) {
                if (statusEl) statusEl.textContent = "No valid rows to import.";
                return;
            }
            if (statusEl) statusEl.textContent = "Uploading…";
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
            if (statusEl) {
                statusEl.textContent = `Imported ${created} booking(s).${errMsg}`;
            }
            await loadCustomers();
            input.value = "";
        } catch (err) {
            console.error("booking import:", err);
            if (statusEl) statusEl.textContent = err.message || "Import failed.";
        }
    });

    document.getElementById("resetBtn")?.addEventListener("click", () => {
        pageState.selectedSort = "id-asc";
        pageState.currentPage = 1;
        resetCustomerFilterFormWidgets();
        pageState.filterState =
            window.customerFilters.createDefaultCustomerFilterState();
        pageState.searchTerm = "";
        const si = document.getElementById("searchInput");
        if (si) si.value = "";
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

    // Notification panel is handled globally by notif.js
});
