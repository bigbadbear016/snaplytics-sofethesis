// scripts/booking-import-format.js
// ---------------------------------------------------------------------------
// DOCUMENTATION: expected shapes for booking imports (JSON / TXT / Excel rows).
// The Django endpoint POST /api/bookings/import-batch/ accepts the same logical fields.
// ---------------------------------------------------------------------------

/**
 * One booking row after normalization (sent in `rows` array to the API).
 *
 * Required (one of):
 *   - customer_id: number — Snaplytics Customer primary key (same as table "ID")
 *   - customer_email: string — must match an existing customer (case-insensitive)
 *
 * Optional:
 *   - package_id: number — Snaplytics Package id; if omitted, total_price is required
 *   - total_price: number — if omitted and package_id is set, defaults to package price
 *   - session_date: string — ISO 8601 datetime (e.g. 2025-03-15T14:30:00)
 *   - session_status: string — defaults to "BOOKED"
 *
 * Excel: first row = headers. Recognized header names (case-insensitive):
 *   customer_id, customer email, customer_email, email,
 *   package_id, total_price, session_date, session_status
 *
 * TXT: one JSON object per line (NDJSON), UTF-8. Each line must parse as one row object.
 *
 * JSON file: either { "rows": [ {...}, ... ] } or a top-level array [ {...}, ... ].
 */

const BOOKING_IMPORT_ROW_KEYS = {
    customerId: "customer_id",
    customerEmail: "customer_email",
    packageId: "package_id",
    totalPrice: "total_price",
    sessionDate: "session_date",
    sessionStatus: "session_status",
};

/** @param {string} name */
function normalizeHeader(name) {
    return String(name || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
}

/**
 * Map a loose object (e.g. Excel row keyed by header) to API payload fields.
 * @param {Record<string, unknown>} raw
 */
function normalizeImportRow(raw) {
    if (!raw || typeof raw !== "object") return null;
    const out = {};

    const cid =
        raw.customer_id ??
        raw.customerId ??
        raw["customer id"] ??
        raw["Customer ID"];
    if (cid !== undefined && cid !== null && String(cid).trim() !== "") {
        const n = parseInt(String(cid).trim(), 10);
        if (!Number.isNaN(n)) out.customer_id = n;
    }

    const em =
        raw.customer_email ??
        raw.customerEmail ??
        raw.email ??
        raw.Email ??
        raw["customer email"];
    if (em != null && String(em).trim() !== "") {
        out.customer_email = String(em).trim();
    }

    const pid =
        raw.package_id ?? raw.packageId ?? raw["package id"] ?? raw["Package ID"];
    if (pid !== undefined && pid !== null && String(pid).trim() !== "") {
        const n = parseInt(String(pid).trim(), 10);
        if (!Number.isNaN(n)) out.package_id = n;
    }

    const tp = raw.total_price ?? raw.totalPrice ?? raw["total price"];
    if (tp !== undefined && tp !== null && String(tp).trim() !== "") {
        const f = parseFloat(String(tp).replace(/,/g, ""));
        if (!Number.isNaN(f)) out.total_price = f;
    }

    const sd =
        raw.session_date ?? raw.sessionDate ?? raw["session date"] ?? raw.date;
    if (sd != null && String(sd).trim() !== "") {
        out.session_date = String(sd).trim();
    }

    const ss =
        raw.session_status ?? raw.sessionStatus ?? raw["session status"];
    if (ss != null && String(ss).trim() !== "") {
        out.session_status = String(ss).trim();
    }

    return out;
}

/**
 * Validate a normalized row before API call. Returns { ok, error? }.
 * @param {Record<string, unknown>} row
 */
function validateNormalizedRow(row) {
    if (!row.customer_id && !row.customer_email) {
        return { ok: false, error: "Each row needs customer_id or customer_email." };
    }
    if (row.package_id == null && row.total_price == null) {
        return {
            ok: false,
            error: "Each row needs package_id (for default price) or total_price.",
        };
    }
    return { ok: true };
}

window.bookingImportFormat = {
    BOOKING_IMPORT_ROW_KEYS,
    normalizeHeader,
    normalizeImportRow,
    validateNormalizedRow,
};
