// scripts/customer-filters.js
// ---------------------------------------------------------------------------
// Shared filter logic for Customer Data and Send Coupon flows.
// Works on objects shaped like GET /api/customers/all/ (renewalRate 0..1, bookings count, updatedAt).
// ---------------------------------------------------------------------------

/**
 * Default UI state: all segments open (no narrowing except search / date when set).
 */
function createDefaultCustomerFilterState() {
    return {
        /** "all" = no renewal filter; otherwise narrow by Snaplytics renewalRate. */
        renewalRisk: "all",
        /** "all" | "one" | "two_three" | "four_plus" */
        bookingActivity: "all",
        /** Inclusive start (Date or null) — compared to customer.updatedAt */
        dateFrom: null,
        /** Inclusive end (Date or null) */
        dateTo: null,
    };
}

/**
 * Parse API datetime string to Date (local calendar day boundaries for range filter).
 */
function parseCustomerDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Start of local day for a Date.
 */
function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

/**
 * End of local day for a Date.
 */
function endOfDay(d) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
}

/**
 * Renewal probability from API (0..1). Missing uses 0.
 */
function getRenewalRate(customer) {
    const v = customer.renewalRate;
    if (v == null || Number.isNaN(Number(v))) return 0;
    return Math.max(0, Math.min(1, Number(v)));
}

/**
 * Booking count used for activity buckets (matches table "Bookings" column).
 */
function getBookingCount(customer) {
    const n = customer.bookings;
    if (n == null || Number.isNaN(Number(n))) return 0;
    return Math.max(0, Math.floor(Number(n)));
}

/**
 * True if customer passes renewal risk segment.
 */
function matchesRenewalRisk(customer, state) {
    if (!state || state.renewalRisk === "all") return true;
    const p = getRenewalRate(customer);
    switch (state.renewalRisk) {
        case "at_risk":
            return p < 0.5;
        case "high_risk":
            return p < 0.3;
        case "likely":
            return p >= 0.5;
        default:
            return true;
    }
}

/**
 * True if customer passes booking activity segment.
 */
function matchesBookingActivity(customer, state) {
    if (!state || state.bookingActivity === "all") return true;
    const b = getBookingCount(customer);
    switch (state.bookingActivity) {
        case "one":
            return b === 1;
        case "two_three":
            return b >= 2 && b <= 3;
        case "four_plus":
            return b >= 4;
        default:
            return true;
    }
}

/**
 * Filter by customer.updatedAt within [dateFrom, dateTo] if those are set.
 */
function matchesDateRange(customer, state) {
    const updated = parseCustomerDate(customer.updatedAt);
    if (!updated) {
        if (state.dateFrom || state.dateTo) return false;
        return true;
    }
    if (state.dateFrom) {
        if (updated < startOfDay(state.dateFrom)) return false;
    }
    if (state.dateTo) {
        if (updated > endOfDay(state.dateTo)) return false;
    }
    return true;
}

/**
 * Text search across id, name, email (and contact if present).
 */
function matchesSearch(customer, searchTerm) {
    if (!searchTerm || !String(searchTerm).trim()) return true;
    const q = String(searchTerm).toLowerCase().trim();
    return (
        String(customer.id ?? "").includes(q) ||
        (customer.name && String(customer.name).toLowerCase().includes(q)) ||
        (customer.email && String(customer.email).toLowerCase().includes(q)) ||
        (customer.contactNo &&
            String(customer.contactNo).toLowerCase().includes(q))
    );
}

/**
 * Apply all active filters (AND). Does not sort.
 * @param {object[]} customers
 * @param {string} searchTerm
 * @param {ReturnType<createDefaultCustomerFilterState>} filterState
 */
function filterCustomers(customers, searchTerm, filterState) {
    const state = filterState || createDefaultCustomerFilterState();
    return customers.filter(
        (c) =>
            matchesSearch(c, searchTerm) &&
            matchesRenewalRisk(c, state) &&
            matchesBookingActivity(c, state) &&
            matchesDateRange(c, state),
    );
}

/**
 * Deep copy filter state (Date objects included).
 */
function cloneFilterState(s) {
    if (!s) return createDefaultCustomerFilterState();
    return {
        renewalRisk: s.renewalRisk || "all",
        bookingActivity: s.bookingActivity || "all",
        dateFrom: s.dateFrom ? new Date(s.dateFrom.getTime()) : null,
        dateTo: s.dateTo ? new Date(s.dateTo.getTime()) : null,
    };
}

/**
 * Read filter controls from the DOM into an existing state object.
 * @param {{ risk: string, booking: string, dateFrom: string, dateTo: string }} ids
 * @param {ReturnType<createDefaultCustomerFilterState>} state
 */
function readStateFromDom(ids, state) {
    const riskEl = document.getElementById(ids.risk);
    const bookEl = document.getElementById(ids.booking);
    const fromEl = document.getElementById(ids.dateFrom);
    const toEl = document.getElementById(ids.dateTo);
    state.renewalRisk = riskEl?.value || "all";
    state.bookingActivity = bookEl?.value || "all";
    state.dateFrom =
        fromEl && fromEl.value ? new Date(fromEl.value + "T00:00:00") : null;
    state.dateTo =
        toEl && toEl.value ? new Date(toEl.value + "T00:00:00") : null;
}

window.customerFilters = {
    createDefaultCustomerFilterState,
    cloneFilterState,
    readStateFromDom,
    filterCustomers,
    getRenewalRate,
    getBookingCount,
    parseCustomerDate,
};
