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
 *   - customer_email or email: string — must match an existing customer (case-insensitive)
 *   - full_name + contact_number or number — used to match an existing customer when email is absent
 *
 * Optional:
 *   - package_id: number — Snaplytics Package id; if omitted, total_price is required
 *   - total_price: number — if omitted and package_id is set, defaults to package price
 *   - session_date: string — date-only value such as "2026-04-03" (time is optional)
 *   - session_status: string — defaults to "BOOKED"
 *
 * Note: addons and consent are NOT processed by the import batch endpoint.
 * Addons can be added post-import via the booking detail edit.
 * Customer consent can be updated separately via the customer detail edit.
 *
 * Excel: first row = headers. Recognized header names (case-insensitive):
 *   customer_id, customer_email, email, full_name, contact_number, number,
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

    const fullName =
        raw.full_name ??
        raw.fullName ??
        raw.name ??
        raw.customer_name ??
        raw["full name"] ??
        raw["customer name"];
    if (fullName != null && String(fullName).trim() !== "") {
        out.full_name = String(fullName).trim();
    }

    const contactNumber =
        raw.contact_number ??
        raw.contactNumber ??
        raw.number ??
        raw.Number ??
        raw.contact_no ??
        raw.contactNo ??
        raw.phone ??
        raw["contact number"] ??
        raw["contact no"] ??
        raw["number"];
    if (contactNumber != null && String(contactNumber).trim() !== "") {
        out.contact_number = String(contactNumber).trim();
    }

    const consentValue =
        raw.consent ??
        raw.customer_consent ??
        raw["consent"] ??
        raw["customer consent"];
    if (consentValue != null && String(consentValue).trim() !== "") {
        out.consent = String(consentValue).trim();
    }

    const pid =
        raw.package_id ?? raw.packageId ?? raw["package id"] ?? raw["Package ID"];
    if (pid !== undefined && pid !== null && String(pid).trim() !== "") {
        const n = parseInt(String(pid).trim(), 10);
        if (!Number.isNaN(n)) out.package_id = n;
    }

    const addonValues =
        raw.addon_ids ??
        raw.addonIds ??
        raw.addons ??
        raw["addons"] ??
        raw["add-ons"] ??
        raw["addon ids"];
    if (addonValues !== undefined && addonValues !== null && addonValues !== "") {
        if (Array.isArray(addonValues)) {
            out.addons = addonValues
                .map((a) => {
                    if (typeof a === "object" && a !== null) {
                        const id = a.id ?? a.addon_id ?? a.addonId;
                        const qty = Number(a.quantity ?? 1);
                        return id == null ? null : { addonId: Number(id), quantity: Number.isFinite(qty) && qty > 0 ? qty : 1 };
                    }
                    const num = Number(a);
                    return Number.isFinite(num) ? { addonId: num, quantity: 1 } : null;
                })
                .filter(Boolean);
        } else if (typeof addonValues === "string") {
            const parsed = addonValues
                .split(/[|,]/)
                .map((part) => part.trim())
                .filter(Boolean)
                .map((part) => {
                    const num = Number(part);
                    return Number.isFinite(num) ? { addonId: num, quantity: 1 } : null;
                })
                .filter(Boolean);
            if (parsed.length) out.addons = parsed;
        }
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
    const hasCustomerRef =
        !!row.customer_id ||
        !!row.customer_email ||
        (!!row.full_name && !!row.contact_number);
    if (!hasCustomerRef) {
        return {
            ok: false,
            error: "Each row needs customer_id, email, or full_name + number.",
        };
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
