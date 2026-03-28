// customer-api.js

function toggleMobileSidebar(show) {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("mobileOverlay");

    if (show) {
        sidebar.classList.add("mobile-open");
        overlay.classList.add("show");
    } else {
        sidebar.classList.remove("mobile-open");
        overlay.classList.remove("show");
    }
}

function navigateTo(section) {
    // Hide all sections
    document.querySelectorAll(".section").forEach((s) => {
        s.classList.remove("active");
    });

    // Remove active from all nav items
    document.querySelectorAll(".nav-item").forEach((item) => {
        item.classList.remove("active");
    });

    // Show selected section
    const selectedSection = document.getElementById(section);
    if (selectedSection) {
        selectedSection.classList.add("active");
    }

    // Set active nav item
    const navItems = document.querySelectorAll(".nav-item");
    navItems.forEach((item, index) => {
        if (section === "dashboard" && index === 0) {
            item.classList.add("active");
        } else if (section === "customer-data" && index === 1) {
            item.classList.add("active");
        } else if (section === "package-list" && index === 2) {
            item.classList.add("active");
        } else if (section === "survey-form" && index === 3) {
            item.classList.add("active");
        } else if (section === "edit-profile" && index === 5) {
            item.classList.add("active");
        } else if (section === "logout" && index === 6) {
            item.classList.add("active");
        }
    });

    // Close mobile sidebar
    toggleMobileSidebar(false);

    // Initialize charts when dashboard is shown
    if (section === "dashboard") {
        setTimeout(initCharts, 100);
    }
}
function openLogoutModal(e) {
    e.preventDefault();
    document.getElementById("logoutModal").classList.remove("hidden");
    document.getElementById("logoutModal").classList.add("flex");
}

function closeLogoutModal() {
    document.getElementById("logoutModal").classList.add("hidden");
    document.getElementById("logoutModal").classList.remove("flex");
}

function confirmLogout() {
    // ðŸ” CHANGE THIS PATH IF NEEDED
    window.location.href = "../index.html";
}

function normalizeConsent(value) {
    if (value === true) return "I Agree";
    if (value === false || value === null || value === undefined) return "I Disagree";
    const v = String(value).trim().toLowerCase();
    if (["i agree", "agree", "yes", "approved", "true"].includes(v)) {
        return "I Agree";
    }
    if (["i disagree", "disagree", "no", "not approved", "false"].includes(v)) {
        return "I Disagree";
    }
    return value;
}

const app = {
    mode: "default", // default, select, edit
    selectedRows: new Set(),
    customers: [],
    editingCell: null,
    editValue: "",
    currentPage: 1,
    pageSize: 20,
    totalCount: 0,
    totalPages: 1,

    loadCustomers(page = 1) {
        fetch(`http://127.0.0.1:8000/api/customers/?page=${page}`)
            .then((res) => res.json())
            .then((data) => {
                this.customers = data.results;

                this.currentPage = page;
                this.totalCount = data.count;
                this.totalPages = Math.ceil(data.count / this.pageSize);

                this.renderTable();
                this.renderPaginationDropdown();
            })
            .catch((err) => {
                console.error("Error loading customers:", err);
            });
    },

    viewCustomerDetails(customerId) {
        fetch(`http://127.0.0.1:8000/api/customers/${customerId}/`)
            .then((res) => res.json())
            .then((customer) => {
                this.showCustomerSection(customer);
            })
            .catch((err) => {
                console.error("Error loading customer details:", err);
            });
    },

    // ----------------------------
    // Show customer details section
    // ----------------------------
    showCustomerSection(customer) {
        // Hide the table / list
        document.getElementById("customers-list").classList.add("hidden");

        // Show the customer details section
        const detailsSection = document.getElementById("customer-details");
        detailsSection.classList.remove("hidden");

        // Fill the basic info
        document.getElementById("detail-name").innerText = customer.name || "—";
        document.getElementById("detail-email").innerText =
            customer.email || "—";
        document.getElementById("detail-contact").innerText =
            customer.contactNo || "—";
        document.getElementById("detail-booking-type").innerText =
            customer.booking_type || "—";

        // Consent: text + color
        const consentSpan = document.getElementById("detail-consent");
        const consentLabel = normalizeConsent(customer.consent);
        consentSpan.innerText = consentLabel;
        if (consentLabel === "I Agree") {
            consentSpan.className = "col-span-2 text-green-600 font-bold";
        } else {
            consentSpan.className = "col-span-2 text-red-600 font-bold";
        }

        // Optionally populate Booking History if available
        const historyContainer = document.getElementById("customerHistory");
        historyContainer.innerHTML =
            "<p class='font-semibold'>Booking History</p>"; // clear old history
        if (customer.history && customer.history.length > 0) {
            customer.history.forEach((item) => {
                const p = document.createElement("p");
                p.innerText = `• ${item.date}: ${item.type}`;
                historyContainer.appendChild(p);
            });
        } else {
            const p = document.createElement("p");
            p.innerText = "No booking history available.";
            historyContainer.appendChild(p);
        }

        // Hide history initially
        historyContainer.classList.add("hidden");
    },

    // ----------------------------
    // Toggle booking history visibility
    // ----------------------------
    toggleHistory() {
        const historyContainer = document.getElementById("customerHistory");
        historyContainer.classList.toggle("hidden");
    },

    // ----------------------------
    // Back button: return to table
    // ----------------------------
    backToCustomers() {
        document.getElementById("customer-details").classList.add("hidden");
        document.getElementById("customers-section").classList.remove("hidden");
    },

    init() {
        this.loadCustomers(1);
        this.renderButtons();
        document
            .getElementById("select-all")
            .addEventListener("change", () => this.toggleSelectAll());
    },

    renderPaginationDropdown() {
        const select = document.getElementById("page-select");
        const indicator = document.getElementById("page-indicator");

        if (!select) return;

        select.innerHTML = "";

        for (let i = 1; i <= this.totalPages; i++) {
            const option = document.createElement("option");
            option.value = i;
            option.textContent = `Page ${i}`;
            if (i === this.currentPage) {
                option.selected = true;
            }
            select.appendChild(option);
        }

        if (indicator) {
            indicator.textContent = `of ${this.totalPages}`;
        }
    },

    goToPage(page) {
        const pageNum = parseInt(page, 10);
        if (!isNaN(pageNum)) {
            this.loadCustomers(pageNum);
        }
    },

    renderTable() {
        const tbody = document.getElementById("table-body");
        tbody.innerHTML = "";

        this.customers.forEach((customer) => {
            const tr = document.createElement("tr");
            let html = "";

            // Checkbox for select/edit mode
            if (this.mode !== "default") {
                const isChecked = this.selectedRows.has(customer.id);
                html += `<td>
                                <input type="checkbox" data-id="${customer.id}" 
                                    ${isChecked ? "checked" : ""} 
                                    onchange="app.toggleRow(${customer.id})">
                            </td>`;
            }

            // Customer ID column
            html += `<td>${customer.id}</td>`;

            // Editable columns
            ["name", "email", "contactNo", "consent", "bookings"].forEach(
                (field) => {
                    const isEditing =
                        this.editingCell?.rowId === customer.id &&
                        this.editingCell?.field === field;
                    if (isEditing) {
                        html += `<td>
                                    <input type="text" class="cell-edit" 
                                        value="${customer[field]}" 
                                        onblur="app.saveCellEdit(${customer.id}, '${field}')" 
                                        onkeydown="app.handleCellKeydown(event, ${customer.id}, '${field}')" 
                                        autofocus>
                                </td>`;
                    } else {
                        const displayValue =
                            field === "consent"
                                ? normalizeConsent(customer[field])
                                : customer[field];
                        html += `<td class="editable-cell" 
                                    ondblclick="app.startEditCell(${customer.id}, '${field}', '${customer[field]}')">
                                    ${displayValue}
                                </td>`;
                    }
                },
            );

            // ✅ Dynamic "View Details" link
            html += `<td>
                            <a href="#" class="text-blue-600 hover:underline"
                            onclick="app.viewCustomerDetails(${customer.id})">
                            View Details
                            </a>
                        </td>`;

            tr.innerHTML = html;
            tbody.appendChild(tr);
        });

        this.updateCheckboxHeader();
    },

    updateCheckboxHeader() {
        const header = document.getElementById("checkbox-header");
        header.style.display = this.mode !== "default" ? "table-cell" : "none";

        const checkbox = document.getElementById("select-all");
        checkbox.checked =
            this.selectedRows.size === this.customers.length &&
            this.customers.length > 0;
    },

    renderButtons() {
        const container = document.getElementById("button-container");
        container.innerHTML = "";

        if (this.mode === "default") {
            container.innerHTML = `
                    <button class="btn btn-default" onclick="app.setMode('select')">Select</button>
                    <button class="btn btn-default" onclick="app.openAddModal()">Add</button>
                `;
        } else if (this.mode === "select") {
            const hasSelection = this.selectedRows.size > 0;
            container.innerHTML = `
                    <button class="btn btn-delete" ${hasSelection ? "" : "disabled"} onclick="app.openDeleteModal()">Delete</button>
                    <button class="btn btn-edit" ${hasSelection ? "" : "disabled"} onclick="app.setMode('edit')">Edit</button>
                    <button class="btn btn-cancel" onclick="app.cancelSelect()">Cancel</button>
                `;
        } else if (this.mode === "edit") {
            container.innerHTML = `
                    <button class="btn btn-save" onclick="app.saveEdits()">Save</button>
                    <button class="btn btn-cancel" onclick="app.cancelEdit()">Cancel</button>
                `;
        }
    },

    setMode(newMode) {
        this.mode = newMode;
        if (newMode === "default") {
            this.selectedRows.clear();
        }
        this.renderTable();
        this.renderButtons();
    },

    toggleRow(id) {
        if (this.selectedRows.has(id)) {
            this.selectedRows.delete(id);
        } else {
            this.selectedRows.add(id);
        }
        this.renderTable();
        this.renderButtons();
    },

    toggleSelectAll() {
        if (this.selectedRows.size === this.customers.length) {
            this.selectedRows.clear();
        } else {
            this.customers.forEach((c) => this.selectedRows.add(c.id));
        }
        this.renderTable();
        this.renderButtons();
    },

    startEditCell(rowId, field, value) {
        if (this.mode === "edit") {
            this.editingCell = { rowId, field };
            this.editValue = value;
            this.renderTable();
        }
    },

    saveCellEdit(rowId, field) {
        const input = document.querySelector(".cell-edit");
        if (input) {
            const customer = this.customers.find((c) => c.id === rowId);
            if (customer) {
                customer[field] = input.value;
            }
        }
        this.editingCell = null;
        this.renderTable();
    },

    handleCellKeydown(event, rowId, field) {
        if (event.key === "Enter") {
            this.saveCellEdit(rowId, field);
        } else if (event.key === "Escape") {
            this.editingCell = null;
            this.renderTable();
        }
    },

    cancelSelect() {
        this.mode = "default";
        this.selectedRows.clear();
        this.renderTable();
        this.renderButtons();
    },

    cancelEdit() {
        this.editingCell = null;
        this.setMode("select");
    },

    saveEdits() {
        this.editingCell = null;
        this.mode = "default";
        this.selectedRows.clear();
        this.renderTable();
        this.renderButtons();
    },

    openAddModal() {
        document.getElementById("add-modal").classList.add("active");
    },

    closeAddModal() {
        document.getElementById("add-modal").classList.remove("active");
        document.getElementById("add-name").value = "";
        document.getElementById("add-email").value = "";
        document.getElementById("add-contact").value = "";
        document.getElementById("add-booking").value = "";
        document.getElementById("add-consent").checked = false;
    },

    saveCustomer() {
        const name = document.getElementById("add-name").value.trim();
        const email = document.getElementById("add-email").value.trim();
        const contactNo = document.getElementById("add-contact").value.trim();
        const bookingType = document.getElementById("add-booking").value;
        const consent = document.getElementById("add-consent").checked
            ? "I Agree"
            : "I Disagree";

        if (name && email && contactNo && bookingType) {
            const newId = Math.max(...this.customers.map((c) => c.id)) + 1;
            this.customers.push({
                id: newId,
                name,
                email,
                contactNo,
                consent,
                bookings: "0",
            });
            this.renderTable();
            this.closeAddModal();
        } else {
            alert("Please fill in all fields");
        }
    },

    openDeleteModal() {
        const count = this.selectedRows.size;
        const text = `Are you sure you want to delete ${count} selected ${count === 1 ? "customer" : "customers"}?`;
        document.getElementById("delete-text").textContent = text;
        document.getElementById("delete-modal").classList.add("active");
    },

    closeDeleteModal() {
        document.getElementById("delete-modal").classList.remove("active");
    },

    confirmDelete() {
        this.customers = this.customers.filter(
            (c) => !this.selectedRows.has(c.id),
        );
        this.selectedRows.clear();
        this.mode = "default";
        this.closeDeleteModal();
        this.renderTable();
        this.renderButtons();
    },
};

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => app.init());

