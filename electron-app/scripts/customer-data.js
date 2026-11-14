// scripts/customer-data.js
// ============================================================================
// CUSTOMER DATA PAGE — data from window.apiClient (Django / Snaplytics).
//
// Filtering: pageState.filterState + window.customerFilters.filterCustomers()
//   uses renewalRate and bookings from GET /api/customers/all/ (DB-backed).
// Booking import: window.bookingImport + POST /api/bookings/import-batch/.
// ============================================================================

const DEFAULT_PAGE_SIZE = 20;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;

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
    totalCustomers: 0,
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
    loadCustomers(1);
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

function downloadBookingImportSample(format) {
    const sampleRows = [
        {
            customer_id: 1056,
            full_name: "Jecyl Aguilar",
            email: "jecylaguilaryurag2@gmail.com",
            number: "09171234567",
            consent: "Agreed",
            package_id: 2,
            addons: [7, 12],
            total_price: 359,
            session_date: "2026-04-03",
            session_status: "BOOKED",
        },
        {
            customer_id: 1057,
            full_name: "Maria Dela Cruz",
            email: "maria.delacruz@example.com",
            number: "09181234567",
            consent: "Declined",
            package_id: 3,
            addons: [5],
            total_price: 499,
            session_date: "2026-04-05",
            session_status: "CONFIRMED",
        },
    ];

    const jsonContent = JSON.stringify(sampleRows, null, 2);
    const txtContent = sampleRows
        .map((row) => JSON.stringify(row))
        .join("\n");

    let fileName = "booking_sample.json";
    let blob = new Blob([jsonContent], { type: "application/json;charset=utf-8" });

    if (format === "excel") {
        fileName = "booking_sample.xlsx";
        const sheet = XLSX.utils.json_to_sheet(sampleRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, "Bookings");
        const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
        blob = new Blob([buffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
    } else if (format === "txt") {
        fileName = "booking_sample.txt";
        blob = new Blob([txtContent], { type: "text/plain;charset=utf-8" });
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
            <span class="customer-import-rule-chip"><strong>Required:</strong> <code>customer_id</code> or <code>email</code></span>
            <span class="customer-import-rule-chip"><strong>Required:</strong> <code>package_id</code> or <code>total_price</code></span>
            <span class="customer-import-rule-chip"><strong>Optional:</strong> <code>full_name</code>, <code>number</code>, <code>consent</code>, <code>addons</code>, <code>session_date</code>, <code>session_status</code></span>
          </div>

          <div class="customer-import-format-downloads" style="display:flex; gap:10px; flex-wrap:wrap; margin: 18px 0 6px;">
            <button type="button" class="customer-toolbar-btn customer-toolbar-btn--primary font-poppins" onclick="downloadBookingImportSample('excel')">Download Excel sample</button>
            <button type="button" class="customer-toolbar-btn customer-toolbar-btn--outline font-poppins" onclick="downloadBookingImportSample('json')">Download JSON sample</button>
            <button type="button" class="customer-toolbar-btn customer-toolbar-btn--outline font-poppins" onclick="downloadBookingImportSample('txt')">Download TXT sample</button>
          </div>

          <section class="customer-import-format-section">
            <h3 class="customer-import-format-heading">Excel (.xlsx / .xls)</h3>
            <p class="customer-import-format-note">Use these column headers in row 1 (case-insensitive). The app can match by customer_id, email, or full_name + number.</p>
            <pre class="customer-import-format-code customer-import-format-code--single">customer_id | full_name | email | number | consent | package_id | addons | total_price | session_date | session_status</pre>
            <p class="customer-import-format-note">Sample row:</p>
            <pre class="customer-import-format-code customer-import-format-code--single">1056 | Jecyl Aguilar | jecylaguilaryurag2@gmail.com | 09171234567 | Agreed | 2 | 7,12 | 359 | 2026-04-03 | BOOKED</pre>
          </section>

          <section class="customer-import-format-section">
            <h3 class="customer-import-format-heading">JSON (.json)</h3>
            <p class="customer-import-format-note">Use either a top-level array or an object with a <code>rows</code> array.</p>
            <pre class="customer-import-format-code">[
  {
    "customer_id": 1056,
    "full_name": "Jecyl Aguilar",
    "email": "jecylaguilaryurag2@gmail.com",
    "number": "09171234567",
    "consent": "Agreed",
    "package_id": 2,
    "addons": [7, 12],
    "total_price": 359,
    "session_date": "2026-04-03",
    "session_status": "BOOKED"
  }
]</pre>
          </section>

          <section class="customer-import-format-section">
            <h3 class="customer-import-format-heading">TXT (.txt as NDJSON)</h3>
            <p class="customer-import-format-note">One JSON object per line (UTF-8 text file). If customer_id is blank, the app will auto-generate a value when it can match the customer by email or full name + contact.</p>
            <pre class="customer-import-format-code">{"customer_id":1056,"full_name":"Jecyl Aguilar","email":"jecylaguilaryurag2@gmail.com","number":"09171234567","consent":"Agreed","package_id":2,"addons":[7,12],"total_price":359,"session_date":"2026-04-03","session_status":"BOOKED"}

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

function getBookingImportFieldLabel(fieldName) {
    const labels = {
        customer_id: "customer_id",
        customer_email: "email",
        full_name: "name",
        contact_number: "number",
        consent: "consent",
        package_id: "package",
        addons: "add-ons",
        total_price: "total",
        session_date: "date",
        session_status: "status",
    };
    return labels[fieldName] || String(fieldName || "").replace(/_/g, " ");
}

function formatBookingImportPreviewValue(value, fieldName) {
    if (value === null || value === undefined) return "—";
    if (fieldName === "addons") {
        if (Array.isArray(value)) {
            const count = value.filter(Boolean).length;
            return count ? String(count) : "Add-ons";
        }
        if (typeof value === "string") {
            const trimmed = value.trim();
            return trimmed || "Add-ons";
        }
    }
    if (typeof value === "string") return value.trim() || "—";
    if (typeof value === "number") return Number.isFinite(value) ? value : "—";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (Array.isArray(value)) return value.length ? String(value.length) : "—";
    return String(value);
}

function clearBookingImportPreview() {
    const preview = document.getElementById("bookingImportPreview");
    const head = document.getElementById("bookingImportPreviewHead");
    const body = document.getElementById("bookingImportPreviewBody");
    if (head) head.innerHTML = "";
    if (body) body.innerHTML = "";
    if (preview) preview.classList.add("hidden");
}

function renderBookingImportPreview(rows) {
    const preview = document.getElementById("bookingImportPreview");
    const head = document.getElementById("bookingImportPreviewHead");
    const body = document.getElementById("bookingImportPreviewBody");
    if (!preview || !head || !body) return;

    const items = Array.isArray(rows) ? rows.slice(0, 5) : [];
    if (!items.length) {
        clearBookingImportPreview();
        return;
    }

    const keys = [
        "customer_id",
        "customer_email",
        "full_name",
        "contact_number",
        "consent",
        "package_id",
        "total_price",
        "session_date",
        "session_status",
    ];
    const columns = keys.filter((key) => items.some((row) => Object.prototype.hasOwnProperty.call(row, key)));
    const finalColumns = columns.length ? columns : Object.keys(items[0]);

    head.innerHTML = finalColumns
        .map((key) => `<th>${cdEscape(getBookingImportFieldLabel(key))}</th>`)
        .join("");

    body.innerHTML = items
        .map((row) => {
            const cells = finalColumns
                .map((key) => `<td>${cdEscape(formatBookingImportPreviewValue(row[key], key))}</td>`)
                .join("");
            return `<tr>${cells}</tr>`;
        })
        .join("");

    preview.classList.remove("hidden");
}

function buildBookingImportReviewFields(rows) {
    const defaults = [
        "customer_id",
        "customer_email",
        "full_name",
        "contact_number",
        "consent",
        "package_id",
        "addons",
        "total_price",
        "session_date",
        "session_status",
    ];
    const found = new Set();
    rows.forEach((row) => {
        Object.keys(row || {}).forEach((key) => found.add(key));
    });
    const requiredFields = [
        "customer_id",
        "customer_email",
        "full_name",
        "contact_number",
        "consent",
    ];
    const orderedDefaults = defaults.filter((key) => requiredFields.includes(key) || found.has(key) || rows.some((row) => row && Object.prototype.hasOwnProperty.call(row, key)));
    return orderedDefaults.concat(
        Array.from(found).filter((key) => !orderedDefaults.includes(key)),
    );
}

function normalizeBookingImportAddonValue(raw) {
    if (Array.isArray(raw)) {
        return raw
            .map((entry) => {
                if (typeof entry === "object" && entry !== null) {
                    const id = Number(entry.addonId ?? entry.id ?? entry.addon_id ?? entry.addonId);
                    if (!Number.isFinite(id)) return null;
                    const qty = Number(entry.quantity ?? 1);
                    return { addonId: id, quantity: Number.isFinite(qty) && qty > 0 ? qty : 1 };
                }
                const id = Number(entry);
                return Number.isFinite(id) ? { addonId: id, quantity: 1 } : null;
            })
            .filter(Boolean);
    }
    if (typeof raw === "string") {
        return raw
            .split(/[|,]/)
            .map((part) => Number(part.trim()))
            .filter((id) => Number.isFinite(id))
            .map((id) => ({ addonId: id, quantity: 1 }));
    }
    return [];
}

function getBookingImportCustomerIdFromEmail(email, customers) {
    const target = String(email || "").trim().toLowerCase();
    if (!target) return null;
    const matched = (customers || []).find((customer) => {
        const candidate = String(customer?.email || "").trim().toLowerCase();
        return candidate && candidate === target;
    });
    if (!matched) return null;
    const id = Number(matched.id ?? matched.customer_id ?? matched.customerId ?? NaN);
    return Number.isFinite(id) ? id : null;
}

function getBookingImportMaxCustomerId(customers) {
    return (customers || []).reduce((max, customer) => {
        const rawId = Number(customer?.id ?? customer?.customer_id ?? customer?.customerId ?? NaN);
        return Number.isFinite(rawId) ? Math.max(max, rawId) : max;
    }, 0);
}

function getBookingImportPackageById(packages, packageId) {
    if (packageId == null || packageId === "") return null;
    const id = Number(packageId);
    return (packages || []).find((pkg) => Number(pkg.id) === id) || null;
}

function getBookingImportSelectableAddons(packages, addons, packageId) {
    const pkg = getBookingImportPackageById(packages, packageId);
    if (!pkg) return addons || [];
    const pkgName = String(pkg.name || "").trim().toLowerCase();
    const pkgCategory = String(pkg.category || "").trim().toLowerCase();
    return (addons || []).filter((addon) => {
        const applies = addon?.applies_to;
        if (applies == null || applies === "") return true;
        const matchText = (text) => {
            const token = String(text || "").trim().toLowerCase();
            if (!token) return false;
            if (token === pkgName || token === pkgCategory) return true;
            return token.includes(pkgName) || token.includes(pkgCategory);
        };
        if (Array.isArray(applies)) {
            return applies.some((value) => matchText(value));
        }
        const raw = String(applies || "");
        return raw
            .split(/[|,]/)
            .some((chunk) => matchText(chunk));
    });
}

function getEffectivePackagePrice(pkg) {
    if (!pkg) return 0;
    const promoRaw = pkg.promo_price != null && pkg.promo_price !== "" ? Number(pkg.promo_price) : null;
    const effective = promoRaw != null && Number.isFinite(promoRaw) && promoRaw > 0
        ? promoRaw
        : Number(pkg.price ?? 0);
    return Number.isFinite(effective) ? effective : 0;
}

function computeBookingImportRowTotal(row, packages, addons) {
    const packageId = Number(row?.package_id ?? NaN);
    const pkg = getBookingImportPackageById(packages, packageId);
    const base = pkg
        ? getEffectivePackagePrice(pkg)
        : Number(row?.total_price ?? 0);
    const selectedAddonIds = new Set(
        normalizeBookingImportAddonValue(row?.addons || row?.addon_ids || []).map((item) => Number(item.addonId)),
    );
    const addonTotal = (addons || [])
        .filter((addon) => selectedAddonIds.has(Number(addon.id)))
        .reduce((sum, addon) => sum + Number(addon.price ?? 0), 0);
    return Number.isFinite(base) ? base + addonTotal : 0;
}

function hydrateBookingImportRow(row, customers, packages, addons) {
    const next = { ...row };
    const customerId = next.customer_id;
    const hasCustomerId = customerId !== undefined && customerId !== null && String(customerId).trim() !== "";
    if (!hasCustomerId) {
        const generatedCustomerId = getBookingImportCustomerIdFromEmail(next.customer_email || next.email, customers);
        if (generatedCustomerId != null) {
            next.customer_id = generatedCustomerId;
        } else {
            next.customer_id = getBookingImportMaxCustomerId(customers) + 1;
        }
    }
    if (next.package_id == null || next.package_id === "") {
        next.package_id = "";
    }
    if (next.consent == null || next.consent === "") {
        next.consent = "I Disagree";
    } else {
        next.consent = normalizeImportConsentValue(next.consent);
    }
    const selectedPackageId = Number(next.package_id ?? NaN);
    const selectedAddons = normalizeBookingImportAddonValue(next.addons || next.addon_ids || []);
    next.addons = selectedAddons;
    if (next.package_id !== "" && Number.isFinite(selectedPackageId) && !next._manual_total) {
        const autoTotal = computeBookingImportRowTotal(next, packages, addons);
        next.total_price = autoTotal;
    }
    return next;
}

function normalizeBookingImportStatusValue(rawValue) {
    const cleaned = String(rawValue ?? "").trim();
    if (!cleaned) return "BOOKED";
    const upper = cleaned.toUpperCase();
    if (["BOOKED", "CONFIRMED", "CONFIRM"].includes(upper)) return "BOOKED";
    if (["PENDING", "PENDING APPROVAL"].includes(upper)) return "PENDING";
    if (["ONGOING", "IN PROGRESS", "IN-PROGRESS"].includes(upper)) return "ONGOING";
    if (["CANCELLED", "CANCELED"].includes(upper)) return "CANCELLED";
    const known = ["PENDING", "ONGOING", "BOOKED", "CANCELLED"];
    return known.includes(cleaned.toUpperCase()) ? cleaned.toUpperCase() : cleaned.toUpperCase();
}

function getBookingImportStatusOptions(selectedValue) {
    const normalized = normalizeBookingImportStatusValue(selectedValue);
    const options = [
        { value: "PENDING", label: "PENDING" },
        { value: "ONGOING", label: "ONGOING" },
        { value: "BOOKED", label: "BOOKED" },
        { value: "CONFIRMED", label: "CONFIRMED" },
        { value: "CANCELLED", label: "CANCELLED" },
    ];
    return options
        .map((option) => {
            const isSelected = normalized === option.value || (option.value === "BOOKED" && normalized === "BOOKED");
            return `<option value="${option.value}" ${isSelected ? "selected" : ""}>${option.label}</option>`;
        })
        .join("");
}

function renderBookingImportReviewRow(row, rowIndex, fields, customers, packages, addons, modalContext) {
    const packageId = row.package_id == null || row.package_id === "" ? "" : String(row.package_id);
    const packageOptions = (packages || [])
        .map((pkg) => `<option value="${pkg.id}" ${String(pkg.id) === packageId ? "selected" : ""}>${cdEscape(pkg.name)} – ₱${getEffectivePackagePrice(pkg)}</option>`)
        .join("");
    const selectedAddonIds = new Set((row.addons || []).map((item) => Number(item.addonId ?? item.id)));
    const selectedAddonCount = selectedAddonIds.size;
    const addonButtonLabel = selectedAddonCount ? `${selectedAddonCount}` : "Add-ons";
    const fieldList = Array.isArray(fields) && fields.length ? fields : [
        "customer_id",
        "customer_email",
        "full_name",
        "contact_number",
        "consent",
        "package_id",
        "addons",
        "total_price",
        "session_date",
        "session_status",
    ];

    const cells = fieldList.map((field) => {
        const safeValue = String(row[field] ?? "");
        switch (field) {
            case "customer_id":
                return `<td><input type="text" class="booking-import-review-input" name="customer_id" data-field="customer_id" value="${cdEscape(safeValue).replace(/"/g, '&quot;')}" aria-label="Customer ID row ${rowIndex + 1}"></td>`;
            case "customer_email":
                return `<td><input type="text" class="booking-import-review-input" name="customer_email" data-field="customer_email" value="${cdEscape(safeValue).replace(/"/g, '&quot;')}" aria-label="Email row ${rowIndex + 1}"></td>`;
            case "full_name":
                return `<td><input type="text" class="booking-import-review-input" name="full_name" data-field="full_name" value="${cdEscape(safeValue).replace(/"/g, '&quot;')}" aria-label="Full name row ${rowIndex + 1}"></td>`;
            case "contact_number":
                return `<td><input type="text" class="booking-import-review-input" name="contact_number" data-field="contact_number" value="${cdEscape(safeValue).replace(/"/g, '&quot;')}" aria-label="Number row ${rowIndex + 1}"></td>`;
            case "consent":
                return `<td><select class="booking-import-review-select booking-import-review-consent-select" data-row-index="${rowIndex}" data-field="consent" onchange="window.__bookingImportReviewContext.rows[${rowIndex}].consent = this.value;">${getBookingImportConsentOptions(row.consent)}</select></td>`;
            case "package_id":
                return `<td><select class="booking-import-review-select booking-import-review-package-select" data-row-index="${rowIndex}" onchange="handleBookingImportPackageChange(${rowIndex}, this.value)"><option value="">Select package</option>${packageOptions}</select></td>`;
            case "addons":
                return `<td><button type="button" class="booking-import-review-addon-button" data-row-index="${rowIndex}" onclick="openBookingImportAddonPicker(${rowIndex})">${addonButtonLabel}</button></td>`;
            case "total_price":
                return `<td><input type="number" step="0.01" min="0" class="booking-import-review-input booking-import-review-total-input" name="total_price" data-field="total_price" data-row-index="${rowIndex}" value="${Number(row.total_price ?? 0)}" oninput="handleBookingImportTotalInput(${rowIndex}, this.value)"></td>`;
            case "session_date":
                return `<td><input type="text" class="booking-import-review-input" name="session_date" data-field="session_date" value="${cdEscape(safeValue).replace(/"/g, '&quot;')}" aria-label="Session date row ${rowIndex + 1}"></td>`;
            case "session_status":
                return `<td><select class="booking-import-review-select booking-import-review-status-select" data-row-index="${rowIndex}" data-field="session_status" onchange="const current = this.value; const normalized = normalizeBookingImportStatusValue(current); this.value = normalized; window.__bookingImportReviewContext.rows[${rowIndex}].session_status = normalized;">${getBookingImportStatusOptions(row.session_status)}</select></td>`;
            default:
                return `<td><input type="text" class="booking-import-review-input" name="${field}" data-field="${field}" value="${cdEscape(safeValue).replace(/"/g, '&quot;')}" aria-label="${cdEscape(field)} row ${rowIndex + 1}"></td>`;
        }
    }).join("");

    return `
      <tr class="booking-import-review-row" data-row-index="${rowIndex}">
        <td><input type="checkbox" class="booking-import-review-row-selector" data-row-index="${rowIndex}" checked></td>
        ${cells}
      </tr>
    `;
}

function handleBookingImportPackageChange(rowIndex, value) {
    const context = window.__bookingImportReviewContext || {};
    const rows = context.rows || [];
    const row = rows[rowIndex];
    if (!row) return;
    row.package_id = value === "" ? "" : Number(value);
    row._manual_total = false;
    const computed = computeBookingImportRowTotal(row, context.packages || [], context.addons || []);
    row.total_price = computed;
    const totalInput = document.querySelector(`.booking-import-review-total-input[data-row-index="${rowIndex}"]`);
    if (totalInput) totalInput.value = computed;
    if (row.customer_id == null || row.customer_id === "") {
        row.customer_id = getBookingImportCustomerIdFromEmail(row.customer_email || row.email, context.customers || []) || getBookingImportMaxCustomerId(context.customers || []) + 1;
        const customerInput = document.querySelector(`input[name="customer_id"][data-field="customer_id"]`);
        if (customerInput) customerInput.value = row.customer_id;
    }
}

function handleBookingImportAddonToggle(rowIndex, addonId, checked) {
    const context = window.__bookingImportReviewContext || {};
    const rows = context.rows || [];
    const row = rows[rowIndex];
    if (!row) return;
    const current = normalizeBookingImportAddonValue(row.addons || row.addon_ids || []);
    const addonList = current.filter((item) => Number(item.addonId) !== Number(addonId));
    if (checked) {
        addonList.push({ addonId: Number(addonId), quantity: 1 });
    }
    row.addons = addonList;
    row._manual_total = false;
    const total = computeBookingImportRowTotal(row, context.packages || [], context.addons || []);
    row.total_price = total;
    const totalInput = document.querySelector(`.booking-import-review-total-input[data-row-index="${rowIndex}"]`);
    if (totalInput) totalInput.value = total;
}

function handleBookingImportTotalInput(rowIndex, value) {
    const context = window.__bookingImportReviewContext || {};
    const rows = context.rows || [];
    const row = rows[rowIndex];
    if (!row) return;
    const parsed = Number(String(value).replace(/,/g, ""));
    row._manual_total = true;
    row.total_price = Number.isFinite(parsed) ? parsed : 0;
}

function openBookingImportAddonPicker(rowIndex) {
    const context = window.__bookingImportReviewContext || {};
    const rows = context.rows || [];
    const row = rows[rowIndex];
    if (!row) return;
    const packageId = row.package_id == null || row.package_id === "" ? "" : String(row.package_id);
    const availableAddons = getBookingImportSelectableAddons(context.packages || [], context.addons || [], packageId);
    const selected = normalizeBookingImportAddonValue(row.addons || []);
    const selectedIds = new Set(selected.map((item) => Number(item.addonId)));

    const modalMarkup = `
      <div class="booking-import-review-addon-overlay" id="bookingImportAddonOverlay" onclick="if (event.target.id === 'bookingImportAddonOverlay') closeBookingImportAddonPicker()">
        <div class="booking-import-review-addon-modal" role="dialog" aria-modal="true" aria-label="Select add-ons">
          <div class="booking-import-review-addon-header">
            <div>
              <div class="booking-import-review-title">Select add-ons</div>
              <div class="booking-import-review-subtitle">Choose optional add-ons for row ${rowIndex + 1}</div>
            </div>
            <button type="button" class="booking-import-review-close" onclick="closeBookingImportAddonPicker()">Close</button>
          </div>
          <div class="booking-import-review-addon-list">
            ${availableAddons.length
                ? availableAddons.map((addon) => {
                    const id = Number(addon.id);
                    return `
                      <label class="booking-import-review-addon-option">
                        <input type="checkbox" value="${id}" ${selectedIds.has(id) ? "checked" : ""}>
                        <span class="booking-import-review-addon-label">${cdEscape(addon.name)} – ₱${Number(addon.price ?? 0)}</span>
                      </label>`;
                }).join("")
                : '<div class="booking-import-review-empty-state">No add-ons are available for the selected package.</div>'}
          </div>
          <div class="booking-import-review-actions">
            <button type="button" class="customer-toolbar-btn customer-toolbar-btn--outline font-poppins" onclick="closeBookingImportAddonPicker()">Cancel</button>
            <button type="button" class="customer-toolbar-btn customer-toolbar-btn--primary font-poppins" id="bookingImportAddonApplyBtn">Apply add-ons</button>
          </div>
        </div>
      </div>`;

    document.getElementById("modalsContainer").insertAdjacentHTML("beforeend", modalMarkup);
    document.getElementById("bookingImportAddonApplyBtn")?.addEventListener("click", () => {
        const checked = Array.from(document.querySelectorAll("#bookingImportAddonOverlay input[type='checkbox']:checked"));
        row.addons = checked.map((input) => ({ addonId: Number(input.value), quantity: 1 }));
        row._manual_total = false;
        row.total_price = computeBookingImportRowTotal(row, context.packages || [], context.addons || []);

        const button = document.querySelector(`.booking-import-review-addon-button[data-row-index="${rowIndex}"]`);
        if (button) {
            const count = row.addons.length;
            button.textContent = count ? `${count}` : "Add-ons";
        }
        const totalInput = document.querySelector(`.booking-import-review-total-input[data-row-index="${rowIndex}"]`);
        if (totalInput) totalInput.value = row.total_price;
        closeBookingImportAddonPicker();
    });
}

function closeBookingImportAddonPicker() {
    document.getElementById("bookingImportAddonOverlay")?.remove();
}

/**
 * Detect duplicate or existing customer emails and names in import batch.
 * Returns array of warning objects: { type, rowIndices, value, message }
 */
function detectBookingImportDuplicates(rows, existingCustomers) {
    const warnings = [];
    const emailMap = new Map(); // normalized email -> array of row indices
    const nameNumberMap = new Map(); // "name|number" -> array of row indices

    rows.forEach((row, idx) => {
        const email = (row.customer_email || row.email || "").trim().toLowerCase();
        const name = (row.full_name || "").trim().toLowerCase();
        const number = (row.contact_number || row.number || "").trim();

        if (email) {
            if (!emailMap.has(email)) emailMap.set(email, []);
            emailMap.get(email).push(idx);
        }

        if (name && number) {
            const key = `${name}|${number}`;
            if (!nameNumberMap.has(key)) nameNumberMap.set(key, []);
            nameNumberMap.get(key).push(idx);
        }
    });

    // Check for duplicate emails within batch
    emailMap.forEach((indices, email) => {
        if (indices.length > 1) {
            warnings.push({
                type: "duplicate_email",
                rowIndices: indices,
                value: email,
                message: `Email "${email}" appears in ${indices.length} rows (rows ${indices.map(i => i + 1).join(", ")})`,
            });
        }
    });

    // Check for duplicate name+number within batch
    nameNumberMap.forEach((indices, key) => {
        if (indices.length > 1) {
            warnings.push({
                type: "duplicate_name_number",
                rowIndices: indices,
                value: key,
                message: `Customer (name + number) appears in ${indices.length} rows (rows ${indices.map(i => i + 1).join(", ")})`,
            });
        }
    });

    // Check for emails/names that match existing customers
    (existingCustomers || []).forEach((customer) => {
        const existingEmail = (customer.email || "").trim().toLowerCase();
        const existingName = (customer.full_name || "").trim().toLowerCase();
        const existingNumber = (customer.contact_number || "").trim();

        emailMap.forEach((indices, email) => {
            if (email && email === existingEmail) {
                warnings.push({
                    type: "existing_email",
                    rowIndices: indices,
                    value: email,
                    existingCustomerId: customer.customer_id || customer.id,
                    existingCustomerName: customer.full_name,
                    message: `Email "${email}" matches existing customer #${customer.customer_id || customer.id} (${customer.full_name})`,
                });
            }
        });

        nameNumberMap.forEach((indices, key) => {
            if (existingName && existingNumber && key === `${existingName}|${existingNumber}`) {
                warnings.push({
                    type: "existing_name_number",
                    rowIndices: indices,
                    value: key,
                    existingCustomerId: customer.customer_id || customer.id,
                    existingCustomerName: customer.full_name,
                    message: `Customer match "${existingName} / ${existingNumber}" matches existing customer #${customer.customer_id || customer.id}`,
                });
            }
        });
    });

    return warnings;
}

function openBookingImportReviewModal(rows) {
    const items = Array.isArray(rows) ? rows : [];
    if (!items.length) return;

    const loadPromise = Promise.all([
        window.apiClient.customers.listAll().catch(() => []),
        window.apiClient.packages.list().catch(() => []),
        window.apiClient.addons.list().catch(() => []),
    ]).then(([customers, packages, addons]) => {
        const hydrated = items.map((row) => hydrateBookingImportRow(row, customers, packages, addons));
        window.__bookingImportReviewContext = {
            rows: hydrated,
            customers: Array.isArray(customers) ? customers : [],
            packages: Array.isArray(packages) ? packages : [],
            addons: Array.isArray(addons) ? addons : [],
        };

        const fieldLabels = {
            customer_id: "customer_id",
            customer_email: "email",
            full_name: "full_name",
            contact_number: "number",
            consent: "consent",
            package_id: "package_id",
            addons: "add-ons",
            total_price: "total_price",
            session_date: "session_date",
            session_status: "session_status",
        };
        const fields = buildBookingImportReviewFields(hydrated);
        const modalMarkup = `
          <div class="modal-overlay booking-import-review-overlay" id="bookingImportReviewModal"
               onclick="if (event.target.id === 'bookingImportReviewModal') closeBookingImportReviewModal()">
            <div class="booking-import-review-modal" role="dialog" aria-modal="true" aria-labelledby="bookingImportReviewTitle">
              <div class="booking-import-review-header">
                <div>
                  <div id="bookingImportReviewTitle" class="booking-import-review-title">Review import rows</div>
                  <div class="booking-import-review-subtitle">Edit values before uploading to the database.</div>
                </div>
                <button type="button" class="booking-import-review-close" onclick="closeBookingImportReviewModal()">Close</button>
              </div>
              <div class="booking-import-review-toolbar">
                <div class="booking-import-review-toolbar-inner">
                  <label class="booking-import-review-toolbar-label">Bulk edit selected rows</label>
                  <select id="bookingImportBulkPackage" class="booking-import-review-select">
                    <option value="">Select package</option>
                    ${(packages || []).map((pkg) => `<option value="${pkg.id}">${cdEscape(pkg.name)} – ₱${getEffectivePackagePrice(pkg)}</option>`).join("")}
                  </select>
                  <select id="bookingImportBulkConsent" class="booking-import-review-select">
                    <option value="">Consent</option>
                    <option value="I Agree">Agreed</option>
                    <option value="I Disagree">Declined</option>
                  </select>
                  <select id="bookingImportBulkStatus" class="booking-import-review-select">
                    <option value="">Status</option>
                    <option value="PENDING">PENDING</option>
                    <option value="ONGOING">ONGOING</option>
                    <option value="BOOKED">BOOKED</option>
                    <option value="CONFIRMED">CONFIRMED</option>
                    <option value="CANCELLED">CANCELLED</option>
                  </select>
                  <button type="button" class="customer-toolbar-btn customer-toolbar-btn--primary font-poppins" id="bookingImportBulkApplyBtn">Apply to selected</button>
                  <button type="button" class="customer-toolbar-btn customer-toolbar-btn--outline font-poppins" id="bookingImportSelectAllBtn">Select all</button>
                </div>
              </div>
              <div class="booking-import-review-table-wrap">
                <table class="booking-import-review-table">
                  <thead>
                    <tr><th></th>${fields.map((field) => `<th>${cdEscape(fieldLabels[field] || field)}</th>`).join("")}</tr>
                  </thead>
                  <tbody>
                    ${hydrated
                        .map((row, rowIndex) => renderBookingImportReviewRow(row, rowIndex, fields, customers, packages, addons, window.__bookingImportReviewContext)).join("")}
                  </tbody>
                </table>
              </div>
              <div class="booking-import-review-actions">
                <button type="button" class="customer-toolbar-btn customer-toolbar-btn--outline font-poppins" onclick="closeBookingImportReviewModal()">Cancel</button>
                <button type="button" class="customer-toolbar-btn customer-toolbar-btn--primary font-poppins" id="bookingImportReviewConfirmBtn">Upload to database</button>
              </div>
            </div>
          </div>`;

        document.getElementById("modalsContainer").innerHTML = modalMarkup;

        document.getElementById("bookingImportSelectAllBtn")?.addEventListener("click", () => {
            const checked = document.querySelectorAll(".booking-import-review-row-selector");
            checked.forEach((el) => {
                el.checked = true;
            });
        });

        document.getElementById("bookingImportBulkApplyBtn")?.addEventListener("click", () => {
            const bulkPackage = document.getElementById("bookingImportBulkPackage");
            const bulkConsent = document.getElementById("bookingImportBulkConsent");
            const bulkStatus = document.getElementById("bookingImportBulkStatus");
            const selectedIndexes = Array.from(document.querySelectorAll(".booking-import-review-row-selector:checked")).map((el) => Number(el.dataset.rowIndex));
            if (!selectedIndexes.length) {
                setBookingImportStatus("Select at least one row to apply the bulk edit.", "warning");
                return;
            }
            const packageId = bulkPackage?.value || "";
            const consentValue = bulkConsent?.value || "";
            const statusValue = bulkStatus?.value || "";

            selectedIndexes.forEach((rowIndex) => {
                const row = window.__bookingImportReviewContext.rows[rowIndex];
                if (!row) return;
                if (packageId) {
                    row.package_id = Number(packageId);
                }
                if (consentValue) {
                    row.consent = normalizeImportConsentValue(consentValue);
                    const consentSelect = document.querySelector(`.booking-import-review-consent-select[data-row-index="${rowIndex}"]`);
                    if (consentSelect) consentSelect.value = row.consent;
                }
                if (statusValue) {
                    row.session_status = normalizeBookingImportStatusValue(statusValue);
                    const statusSelect = document.querySelector(`.booking-import-review-status-select[data-row-index="${rowIndex}"]`);
                    if (statusSelect) statusSelect.value = row.session_status;
                }
                row._manual_total = false;
                row.total_price = computeBookingImportRowTotal(row, window.__bookingImportReviewContext.packages || [], window.__bookingImportReviewContext.addons || []);
                const totalInput = document.querySelector(`.booking-import-review-total-input[data-row-index="${rowIndex}"]`);
                if (totalInput) totalInput.value = row.total_price;
                const packageSelect = document.querySelector(`.booking-import-review-package-select[data-row-index="${rowIndex}"]`);
                if (packageSelect && packageId) {
                    packageSelect.value = String(packageId);
                }
                const addonButton = document.querySelector(`.booking-import-review-addon-button[data-row-index="${rowIndex}"]`);
                if (addonButton) {
                    const count = (row.addons || []).length;
                    addonButton.textContent = count ? `${count}` : "Add-ons";
                }
            });
        });

        document.getElementById("bookingImportReviewConfirmBtn")?.addEventListener("click", async () => {
            const rows = window.__bookingImportReviewContext.rows || [];
            const editedRows = rows.map((row, index) => {
                const customerId = String(row.customer_id ?? "").trim();
                if (customerId === "") {
                    const generatedId = getBookingImportCustomerIdFromEmail(row.customer_email || row.email, window.__bookingImportReviewContext.customers || []);
                    row.customer_id = generatedId ?? getBookingImportMaxCustomerId(window.__bookingImportReviewContext.customers || []) + 1;
                }
                if (row.package_id === "") delete row.package_id;
                if (row.total_price == null || row.total_price === "") delete row.total_price;
                if (!row.consent || row.consent === "") {
                    row.consent = "I Disagree";
                } else {
                    row.consent = normalizeImportConsentValue(row.consent);
                }
                const prepared = {
                    customer_id: row.customer_id != null && row.customer_id !== "" ? Number(row.customer_id) : undefined,
                    customer_email: row.customer_email || undefined,
                    full_name: row.full_name || undefined,
                    contact_number: row.contact_number || undefined,
                    consent: row.consent || "I Disagree",
                    package_id: row.package_id != null && row.package_id !== "" ? Number(row.package_id) : undefined,
                    addons: Array.isArray(row.addons) ? row.addons : [],
                    total_price: Number(row.total_price ?? 0),
                    session_date: row.session_date || undefined,
                    session_status: normalizeBookingImportStatusValue(row.session_status || "BOOKED"),
                };
                if (prepared.customer_id == null && prepared.customer_email == null && !(prepared.full_name && prepared.contact_number)) {
                    prepared.customer_id = getBookingImportMaxCustomerId(window.__bookingImportReviewContext.customers || []) + 1;
                }
                return prepared;
            }).filter((row) => Object.keys(row).length > 0);

            const { rows: validRows, errors } = window.bookingImport.buildImportPayload(editedRows);
            if (errors.length) {
                const sample = errors
                    .slice(0, 3)
                    .map((e) => `row ${e.row_index + 1}: ${e.error}`)
                    .join("; ");
                setBookingImportStatus(`Fix ${errors.length} row(s). ${sample}`, "error");
                return;
            }

            if (!validRows.length) {
                setBookingImportStatus("No valid rows to import.", "error");
                return;
            }

            const input = document.getElementById("bookingImportFile");
            const previewText = validRows
                .slice(0, 3)
                .map((row, idx) => `#${idx + 1}: ${JSON.stringify(row)}`)
                .join("\n");
            const confirmed = await window.heigenConfirm(
                `Review the import preview before uploading ${validRows.length} booking row(s) to the database.\n\n${previewText}\n\nContinue with the import?`,
                {
                    title: "Confirm booking import",
                    confirmText: "Upload to database",
                    cancelText: "Cancel",
                },
            );
            if (!confirmed) {
                setBookingImportStatus("Import cancelled. Review the preview and try again.", "neutral");
                return;
            }

            closeBookingImportReviewModal();
            setBookingImportStatus("Uploading rows...", "loading");
            try {
                const res = await window.apiClient.bookings.importBatch(validRows);
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
                clearBookingImportPreview();
                if (input) input.value = "";
            } catch (err) {
                console.error("booking import:", err);
                setBookingImportStatus(err.message || "Import failed.", "error");
            }
        });
    });

    return loadPromise;
}

function closeBookingImportReviewModal() {
    document.getElementById("bookingImportReviewModal")?.remove();
}

function normalizeConsent(value) {
    if (value === true) return "I Agree";
    if (value === false || value === null || value === undefined)
        return "I Disagree";
    const v = String(value).trim().toLowerCase();
    if (["i agree", "agree", "agreed", "yes", "approved", "true"].includes(v)) {
        return "I Agree";
    }
    if (["i disagree", "disagree", "declined", "no", "not approved", "false"].includes(v)) {
        return "I Disagree";
    }
    return value;
}

function normalizeImportConsentValue(value) {
    const normalized = normalizeConsent(value);
    return normalized === "I Agree" ? "I Agree" : "I Disagree";
}

function getBookingImportConsentOptions(selectedValue) {
    const normalized = normalizeImportConsentValue(selectedValue);
    return [
        { value: "I Agree", label: "Agreed" },
        { value: "I Disagree", label: "Declined" },
    ].map((option) => `<option value="${option.value}" ${normalized === option.value ? "selected" : ""}>${option.label}</option>`).join("");
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
        const filterState = pageState.filterState || {};
        const data = await window.apiClient.customers.listPage({
            page: pageState.currentPage,
            page_size: getItemsPerPage(),
            search: pageState.searchTerm,
            booking: filterState.bookingActivity === "all" ? "" : filterState.bookingActivity,
            risk: filterState.renewalRisk === "all" ? "" : filterState.renewalRisk,
            consent: filterState.consentAgreedOnly ? "agreed" : "",
            date_from: filterState.dateFrom ? formatDateParam(filterState.dateFrom) : "",
            date_to: filterState.dateTo ? formatDateParam(filterState.dateTo) : "",
            sort: pageState.selectedSort,
        });
        pageState.customers = Array.isArray(data?.results) ? data.results : [];
        pageState.totalCustomers = Number(data?.count) || pageState.customers.length;
        renderTable();
    } catch (err) {
        console.error("loadCustomers:", err);
        const tb = document.getElementById("tableBody");
        if (tb) {
            tb.innerHTML =
                `<tr><td colspan="8" class="px-4 py-10 text-center text-sm text-red-700">
               Could not load customers. Is the Django server running?<br>
               <span class="text-red-600/90">${cdEscape(err.message)}</span>
             </td></tr>`;
        }

        function formatDateParam(value) {
            const date = value instanceof Date ? value : new Date(value);
            if (Number.isNaN(date.getTime())) return "";
            return date.toISOString().slice(0, 10);
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
    loadCustomers(1);
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
            if (customer.renewalRate == null) return -1;
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
    loadCustomers(1);
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

/** Display renewal as percent; API sends 0..1 from the XGBoost model, or null. */
function formatRenewalRateDisplay(c) {
    if (c.renewalRate == null) return "—";
    const p = Number(c.renewalRate);
    if (Number.isNaN(p)) return "—";
    return `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
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
    const sorted = pageState.customers;
    const ipp = getItemsPerPage();
    const totalPages = Math.max(1, Math.ceil(pageState.totalCustomers / ipp));
    if (pageState.currentPage > totalPages) pageState.currentPage = totalPages;

    const visible = sorted;

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
          <td class="customer-td customer-td--actions py-3 align-middle text-right">
            <button type="button" class="customer-action-view" onclick="navigateToCustomerDetails(${c.id})">View</button>
          </td>`;
            return `<tr class="customer-table-row">${cells}</tr>`;
        })
        .join("");

    const countMeta = document.getElementById("customerToolbarCountMeta");
    if (countMeta) {
        const total = pageState.totalCustomers;
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
    loadCustomers(pageState.currentPage);
}

function handleCustomerPageNext() {
    const totalPages = Math.max(1, Math.ceil(pageState.totalCustomers / getItemsPerPage()));
    if (pageState.currentPage >= totalPages) return;
    pageState.currentPage += 1;
    loadCustomers(pageState.currentPage);
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
              onchange="pageState.currentPage = parseInt(this.value, 10); loadCustomers(pageState.currentPage);"
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
    const pageIds = pageState.customers.map((c) => c.id);
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
            if (idx !== -1) pageState.customers[idx] = {
                ...pageState.customers[idx],
                ...updated,
            };
        } else {
            const created = await window.apiClient.customers.create(payload);
            pageState.currentPage = 1;
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
    await loadCustomers(pageState.currentPage);
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
    pageState.selectedRows.clear();
    pageState.viewMode = "default";
    pageState.deleteConfirmation = false;
    document.getElementById("modalsContainer").innerHTML = "";
    await loadCustomers(pageState.currentPage);
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

    document.getElementById("customerRefreshBtn")?.addEventListener("click", () => {
        loadCustomers(pageState.currentPage);
    });

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
        loadCustomers(1);
    });

    // Booking import → POST import-batch → reload list (renewal rates refresh server-side).
    const openBookingImportReviewFromSelectedFile = () => {
        const input = document.getElementById("bookingImportFile");
        const file = input?.files?.[0];
        if (!file) {
            setBookingImportStatus("Choose a file first (.xlsx, .xls, .json, .txt).", "error");
            return;
        }
        setBookingImportStatus("Parsing file...", "loading");
        window.bookingImport.parseBookingFile(file)
            .then(({ rows, parseErrors }) => {
                if (parseErrors.length) {
                    const sample = parseErrors
                        .slice(0, 3)
                        .map((e) => `row ${e.row_index + 1}: ${e.error}`)
                        .join("; ");
                    setBookingImportStatus(`Fix ${parseErrors.length} row(s). ${sample}`, "error");
                    renderBookingImportPreview(rows);
                    return;
                }
                if (!rows.length) {
                    setBookingImportStatus("No valid rows to import.", "error");
                    clearBookingImportPreview();
                    return;
                }

                renderBookingImportPreview(rows);
                setBookingImportStatus("Preview ready. Click Review import to inspect rows before uploading.", "neutral");
            })
            .catch((err) => {
                console.error("booking import:", err);
                setBookingImportStatus(err.message || "Import failed.", "error");
            });
    };

    const openBookingImportReviewModalForSelectedFile = () => {
        const input = document.getElementById("bookingImportFile");
        const file = input?.files?.[0];
        if (!file) {
            setBookingImportStatus("Choose a file first before reviewing the rows.", "error");
            return;
        }
        setBookingImportStatus("Preparing review modal...", "loading");
        window.bookingImport.parseBookingFile(file)
            .then(({ rows, parseErrors }) => {
                if (parseErrors.length) {
                    const sample = parseErrors
                        .slice(0, 3)
                        .map((e) => `row ${e.row_index + 1}: ${e.error}`)
                        .join("; ");
                    setBookingImportStatus(`Fix ${parseErrors.length} row(s). ${sample}`, "error");
                    renderBookingImportPreview(rows);
                    return;
                }
                if (!rows.length) {
                    setBookingImportStatus("No valid rows to import.", "error");
                    clearBookingImportPreview();
                    return;
                }
                renderBookingImportPreview(rows);
                openBookingImportReviewModal(rows);
                setBookingImportStatus("Review the import rows before uploading.", "neutral");
            })
            .catch((err) => {
                console.error("booking import review:", err);
                setBookingImportStatus(err.message || "Could not open review modal.", "error");
            });
    };

    document.getElementById("bookingImportBtn")?.addEventListener("click", async () => {
        if (isStaffRole()) {
            window.heigenAlert("Booking data import is restricted to ADMIN and OWNER.");
            return;
        }
        openBookingImportReviewFromSelectedFile();
    });

    document.getElementById("bookingImportReviewBtnInline")?.addEventListener("click", () => {
        if (isStaffRole()) {
            window.heigenAlert("Booking data import is restricted to ADMIN and OWNER.");
            return;
        }
        openBookingImportReviewModalForSelectedFile();
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

    document.getElementById("bookingImportFile")?.addEventListener("change", async (e) => {
        const file = e?.target?.files?.[0];
        if (!file) {
            clearBookingImportPreview();
            setBookingImportStatus("", "neutral");
            return;
        }

        setBookingImportStatus(`Selected file: ${file.name}. Preview ready. Click Review import to inspect the rows.`, "neutral");
        try {
            const { rows, parseErrors } = await window.bookingImport.parseBookingFile(file);
            if (parseErrors?.length) {
                const sample = parseErrors
                    .slice(0, 3)
                    .map((err) => `row ${err.row_index + 1}: ${err.error}`)
                    .join("; ");
                setBookingImportStatus(`Fix ${parseErrors.length} row(s). ${sample}`, "error");
                renderBookingImportPreview(rows);
                return;
            }
            if (!rows?.length) {
                clearBookingImportPreview();
                setBookingImportStatus("No valid rows to import.", "error");
                return;
            }
            renderBookingImportPreview(rows);
            setBookingImportStatus("Preview ready. Click Review import to inspect rows before uploading.", "neutral");
        } catch (err) {
            clearBookingImportPreview();
            setBookingImportStatus(err.message || "Could not preview this file.", "error");
        }
    });

    document.getElementById("bookingImportClearPreviewBtn")?.addEventListener("click", () => {
        clearBookingImportPreview();
        const input = document.getElementById("bookingImportFile");
        if (input) input.value = "";
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

window.downloadBookingImportSample = downloadBookingImportSample;
window.openBookingImportFormatModal = openBookingImportFormatModal;
window.closeBookingImportFormatModal = closeBookingImportFormatModal;
window.handleCustomerSortHeaderClick = handleCustomerSortHeaderClick;
window.closeCustomerModal = closeCustomerModal;
