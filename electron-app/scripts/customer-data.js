// scripts/customer-data.js
// ============================================================================
// CUSTOMER DATA PAGE  –  all data through window.apiClient (no Supabase)
// ============================================================================

const ITEMS_PER_PAGE = 16;

const pageState = {
    customers: [],
    selectedRows: new Set(),
    viewMode: "default", // "default" | "select" | "edit"
    showModal: false,
    editingCustomer: null,
    selectedModified: null,
    currentPage: 1,
    deleteConfirmation: false,
    selectedSort: "id-asc",
    searchTerm: "",
};

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

// ── Filter / sort helper ──────────────────────────────────────────────────────

function getFilteredAndSortedCustomers(customers, searchTerm, modified, sort) {
    let list = [...customers];

    if (searchTerm) {
        const q = searchTerm.toLowerCase();
        list = list.filter(
            (c) =>
                (c.name ?? "").toLowerCase().includes(q) ||
                (c.email ?? "").toLowerCase().includes(q) ||
                String(c.id).includes(q),
        );
    }

    if (modified) {
        const now = new Date();
        list = list.filter((c) => {
            if (!c.updatedAt) return false;
            const d = new Date(c.updatedAt);
            if (modified === "Today")
                return d.toDateString() === now.toDateString();
            if (modified === "Last 7 Days") return (now - d) / 86400000 <= 7;
            if (modified === "Last 30 Days") return (now - d) / 86400000 <= 30;
            if (modified === "This year")
                return d.getFullYear() === now.getFullYear();
            return true;
        });
    }

    const [field, dir] = (sort ?? "id-asc").split("-");
    const asc = dir !== "desc";
    list.sort((a, b) => {
        let va = field === "bookings" ? (a.bookings ?? 0) : (a[field] ?? "");
        let vb = field === "bookings" ? (b.bookings ?? 0) : (b[field] ?? "");
        if (typeof va === "string") va = va.toLowerCase();
        if (typeof vb === "string") vb = vb.toLowerCase();
        if (va < vb) return asc ? -1 : 1;
        if (va > vb) return asc ? 1 : -1;
        return 0;
    });

    return list;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderTable() {
    const sorted = getFilteredAndSortedCustomers(
        pageState.customers,
        pageState.searchTerm,
        pageState.selectedModified,
        pageState.selectedSort,
    );
    const totalPages = Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE));
    if (pageState.currentPage > totalPages) pageState.currentPage = totalPages;

    const start = (pageState.currentPage - 1) * ITEMS_PER_PAGE;
    const visible = sorted.slice(start, start + ITEMS_PER_PAGE);

    // ── header checkbox ───────────────────────────────────────────────────────
    const header = document.getElementById("tableHeader");
    const existCb = header.querySelector("input[type='checkbox']");
    if (pageState.viewMode === "select") {
        if (!existCb) {
            const wrap = document.createElement("div");
            wrap.style.cssText =
                "width:20px;height:20px;flex-shrink:0;" +
                "display:flex;align-items:center;justify-content:center;";
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.style.cssText =
                "width:20px;height:20px;border-radius:4px;" +
                "border:2px solid #37352F;cursor:pointer;";
            cb.onchange = handleSelectAll;
            wrap.appendChild(cb);
            header.insertBefore(wrap, header.firstChild);
        }
    } else if (existCb) {
        existCb.parentElement.remove();
    }

    // ── rows ──────────────────────────────────────────────────────────────────
    // bookings field from the API is already the integer count
    document.getElementById("tableBody").innerHTML = visible
        .map((c) => {
            let row = '<div class="table-row">';
            if (pageState.viewMode === "select") {
                row += `
              <div style="width:20px;height:20px;flex-shrink:0;
                          display:flex;align-items:center;justify-content:center;">
                <input type="checkbox"
                       ${pageState.selectedRows.has(c.id) ? "checked" : ""}
                       onchange="handleSelectRow(${c.id})"
                       style="width:20px;height:20px;border-radius:4px;
                              border:2px solid #37352F;cursor:pointer;">
              </div>`;
            }
            row += `
          <div style="flex:0.5;">${c.id}</div>
          <div style="flex:2;">${c.name ?? ""}</div>
          <div style="flex:2;">${c.email ?? ""}</div>
          <div style="flex:1;">${c.contactNo ?? ""}</div>
          <div style="flex:0.75;">${normalizeConsent(c.consent ?? "")}</div>
          <div style="flex:0.75;">${c.bookings ?? 0}</div>
          <div style="flex:0.8;color:#006FC9;cursor:pointer;"
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
        pageState.selectedModified,
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
        pageState.selectedModified,
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
    await loadCustomers();

    // Search
    document.getElementById("searchInput")?.addEventListener("input", (e) => {
        pageState.searchTerm = e.target.value;
        pageState.currentPage = 1;
        renderTable();
    });

    // Filter dropdown
    const filterBtn = document.getElementById("filterBtn");
    const filterClear = document.getElementById("filterClear");
    const filterMenu = document.getElementById("filterMenu");

    filterBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        filterMenu.style.display =
            filterMenu.style.display === "none" ? "block" : "none";
    });

    filterMenu?.querySelectorAll(".filter-option").forEach((opt) => {
        opt.addEventListener("click", function () {
            pageState.selectedModified = this.dataset.value;
            filterBtn.textContent = this.dataset.value;
            filterBtn.classList.add("active");
            filterClear.style.display = "flex";
            filterMenu.style.display = "none";
            pageState.currentPage = 1;
            renderTable();
        });
    });

    filterClear?.addEventListener("click", (e) => {
        e.stopPropagation();
        pageState.selectedModified = null;
        filterBtn.textContent = "Modified Date";
        filterBtn.classList.remove("active");
        filterClear.style.display = "none";
        filterMenu.style.display = "none";
        pageState.currentPage = 1;
        renderTable();
    });

    document.addEventListener("click", (e) => {
        if (!e.target.closest("#filterDropdown"))
            filterMenu.style.display = "none";
    });

    // Reset
    document.getElementById("resetBtn")?.addEventListener("click", () => {
        pageState.selectedSort = "id-asc";
        pageState.searchTerm = "";
        pageState.selectedModified = null;
        pageState.currentPage = 1;
        document.getElementById("searchInput").value = "";
        filterBtn.textContent = "Modified Date";
        filterBtn.classList.remove("active");
        filterClear.style.display = "none";
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
            const r = sortBtn.getBoundingClientRect();
            Object.assign(sortMenu.style, {
                position: "fixed",
                top: r.bottom + 10 + "px",
                right: window.innerWidth - r.right + "px",
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
