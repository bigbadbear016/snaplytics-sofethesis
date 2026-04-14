import { resolveCategoryImage } from "../constants/assets";
import {
    parseStringArrayField,
    normalizeIncludedPortraitsField,
} from "../utils/packageFieldParse";
import { usePoolerBackend, poolerRun } from "./poolerTransport";
import { buildSelectSql, buildInsertSql, buildUpdateSql, hydratePoolerRow } from "./poolerSql";

const SUPABASE_URL = normalizeBaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL);
const SUPABASE_ANON_KEY = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const SUPABASE_REST_BASE_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : "";

const TABLES = {
    categories: "backend_category",
    packages: "backend_package",
    addons: "backend_addon",
    customers: "backend_customer",
    bookings: "backend_booking",
    bookingAddons: "backend_bookingaddon",
    coupons: "backend_coupon",
    couponSent: "backend_couponsent",
    couponUsage: "backend_couponusage",
};

function normalizeBaseUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
}

function assertSupabaseConfigured() {
    if (!SUPABASE_REST_BASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error(
            "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
        );
    }
}

function requestHeaders(extraHeaders = {}) {
    assertSupabaseConfigured();
    return {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...extraHeaders,
    };
}

async function restRequest(path, options = {}) {
    assertSupabaseConfigured();
    const url = path.startsWith("http") ? path : `${SUPABASE_REST_BASE_URL}${path}`;
    const response = await fetch(url, {
        ...options,
        headers: requestHeaders(options.headers || {}),
    });

    if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
            const err = await response.json();
            detail = err?.message || err?.details || err?.hint || JSON.stringify(err);
        } catch (_) {}
        throw new Error(detail);
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

async function queryTable(table, { select = "*", filters = [], orderBy = null } = {}) {
    if (usePoolerBackend()) {
        const sql = buildSelectSql(table, { select, filters, orderBy });
        const res = await poolerRun(sql);
        if (!res || res.kind !== "rows") return [];
        const rows = res.rows;
        const list = Array.isArray(rows) ? rows : rows ? Array.from(rows) : [];
        return list.map((r) => hydratePoolerRow(table, r));
    }
    const params = new URLSearchParams({ select });
    filters.forEach(([key, value]) => params.set(key, value));
    if (orderBy) params.set("order", orderBy);
    const data = await restRequest(`/${table}?${params.toString()}`);
    return Array.isArray(data) ? data : data ? [data] : [];
}

async function insertRow(table, payload) {
    if (usePoolerBackend()) {
        const sql = buildInsertSql(table, payload);
        const res = await poolerRun(sql, 50);
        if (res && res.kind === "rows" && res.rows?.length) {
            const row = Array.isArray(res.rows) ? res.rows[0] : res.rows[0];
            return row ? hydratePoolerRow(table, row) : null;
        }
        return null;
    }
    const data = await restRequest(`/${table}`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    return Array.isArray(data) ? data[0] || null : data;
}

async function updateRow(table, idField, idValue, payload) {
    if (usePoolerBackend()) {
        const sql = buildUpdateSql(table, idField, idValue, payload);
        const res = await poolerRun(sql, 50);
        if (res && res.kind === "rows" && res.rows?.length) {
            const row = Array.isArray(res.rows) ? res.rows[0] : res.rows[0];
            return row ? hydratePoolerRow(table, row) : null;
        }
        return null;
    }
    const params = new URLSearchParams();
    params.set(idField, `eq.${encodeURIComponent(String(idValue))}`);
    const data = await restRequest(`/${table}?${params.toString()}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
    });
    return Array.isArray(data) ? data[0] || null : data;
}

function normalizeDateString(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function normalizeCustomer(row) {
    if (!row) return null;
    return {
        id: row.customer_id ?? row.id ?? null,
        customer_id: row.customer_id ?? row.id ?? null,
        full_name: row.full_name ?? row.name ?? null,
        name: row.full_name ?? row.name ?? null,
        email: row.email ?? null,
        contact_number: row.contact_number ?? row.contactNo ?? null,
        contactNo: row.contact_number ?? row.contactNo ?? null,
        consent: row.consent ?? null,
        is_first_time: row.is_first_time ?? null,
        acquisition_source: row.acquisition_source ?? null,
        created_at: row.created_at ?? null,
        last_updated: row.last_updated ?? row.updatedAt ?? null,
    };
}

function normalizePackage(row) {
    if (!row) return null;
    return {
        id: row.id ?? null,
        name: row.name ?? null,
        category: row.category ?? null,
        price: row.price ?? null,
        promo_price: row.promo_price ?? null,
        promo_price_condition: row.promo_price_condition ?? null,
        max_people: row.max_people ?? null,
        inclusions: parseStringArrayField(row.inclusions) ?? [],
        included_portraits: normalizeIncludedPortraitsField(row.included_portraits),
        freebies: parseStringArrayField(row.freebies) ?? [],
        notes: row.notes ?? null,
        image_url: row.image_url ?? null,
        is_archived: Boolean(row.is_archived),
        deleted_at: row.deleted_at ?? null,
        created_at: row.created_at ?? null,
        last_updated: row.last_updated ?? null,
    };
}

function normalizeAddon(row) {
    if (!row) return null;
    return {
        id: row.id ?? null,
        name: row.name ?? null,
        price: row.price ?? null,
        additional_info: row.additional_info ?? null,
        applies_to: row.applies_to ?? null,
        image_url: row.image_url ?? null,
        deleted_at: row.deleted_at ?? null,
        created_at: row.created_at ?? null,
        last_updated: row.last_updated ?? null,
    };
}

function normalizeCategory(row, packageCount = 0) {
    if (!row) return null;
    return {
        id: row.id ?? row.name ?? null,
        name: row.name ?? null,
        image_url: row.image_url ?? null,
        image: resolveCategoryImage(row),
        is_archived: Boolean(row.is_archived),
        package_count: packageCount,
        deleted_at: row.deleted_at ?? null,
    };
}

function normalizeBookingAddon(row, addonRow = null) {
    const addonId = row.addon_id ?? row.addonId ?? row.addon ?? null;
    return {
        id: addonRow?.id ?? addonId,
        addonId,
        name: addonRow?.name ?? row.name ?? null,
        price: addonRow?.price ?? row.addon_price ?? null,
        quantity: row.addon_quantity ?? row.quantity ?? 1,
    };
}

function normalizeBooking(row, relations = {}) {
    if (!row) return null;
    const customer = relations.customer || null;
    const pkg = relations.package || null;
    const coupon = relations.coupon || null;
    const addons = (relations.addons || []).map((addonRow) =>
        normalizeBookingAddon(addonRow.row, addonRow.addon),
    );
    const basePrice = Number(pkg?.promo_price ?? pkg?.price ?? row.total_price ?? 0);
    const addonTotal = addons.reduce(
        (sum, addon) => sum + Number(addon.price || 0) * Number(addon.quantity || 1),
        0,
    );
    return {
        id: row.id ?? row.booking_id ?? null,
        customerId: row.customer ?? row.customer_id ?? customer?.customer_id ?? customer?.id ?? null,
        customer_name: customer?.full_name ?? null,
        customer_email: customer?.email ?? null,
        customer_contact: customer?.contact_number ?? null,
        preferred_date: row.session_date ? normalizeDateString(row.session_date) : null,
        category_name: pkg?.category ?? null,
        packageName: pkg?.name ?? null,
        packagePrice: pkg ? Number(pkg.promo_price ?? pkg.price ?? 0) : null,
        package: pkg ? normalizePackage(pkg) : null,
        addons,
        date: normalizeDateString(row.session_date || row.created_at),
        subtotal: basePrice + addonTotal,
        discount: Number(row.coupon_discount_amount ?? 0),
        total: Number(row.total_price ?? 0),
        type: customer?.acquisition_source && String(customer.acquisition_source).toLowerCase().includes("reserved")
            ? "Reserved"
            : "Walk-In",
        session_status: row.session_status ?? null,
        appliedCouponId: row.coupon ?? row.coupon_id ?? coupon?.id ?? null,
        appliedCouponCode: coupon?.code ?? null,
    };
}

async function fetchPackagesRows() {
    const rows = await queryTable(TABLES.packages, {
        orderBy: "id.asc",
        filters: [["deleted_at", "is.null"]],
    });
    return rows.map(normalizePackage);
}

async function fetchAddonsRows() {
    const rows = await queryTable(TABLES.addons, {
        orderBy: "id.asc",
        filters: [["deleted_at", "is.null"]],
    });
    return rows.map(normalizeAddon);
}

async function fetchCustomersRows() {
    const rows = await queryTable(TABLES.customers, { orderBy: "customer_id.asc" });
    return rows.map(normalizeCustomer);
}

async function fetchCouponsRows() {
    const rows = await queryTable(TABLES.coupons, {
        orderBy: "created_at.desc",
        filters: [["deleted_at", "is.null"]],
    });
    return rows;
}

async function fetchBookingAddonsRows(bookingIds = []) {
    if (!bookingIds.length) return [];
    return queryTable(TABLES.bookingAddons, {
        select: "booking,addon,addon_quantity,addon_price,total_addon_cost",
        filters: [["booking", `in.(${bookingIds.join(",")})`]],
        orderBy: "created_at.asc",
    });
}

async function buildBookingCollection(rows) {
    const bookingRows = rows || [];
    const customerIds = Array.from(new Set(bookingRows.map((row) => row.customer).filter((value) => value != null)));
    const packageIds = Array.from(new Set(bookingRows.map((row) => row.package).filter((value) => value != null)));
    const couponIds = Array.from(new Set(bookingRows.map((row) => row.coupon).filter((value) => value != null)));
    const bookingIds = bookingRows.map((row) => row.id).filter((value) => value != null);

    const [customers, packages, coupons, bookingAddons, addons] = await Promise.all([
        customerIds.length
            ? queryTable(TABLES.customers, { filters: [["customer_id", `in.(${customerIds.join(",")})`]] })
            : Promise.resolve([]),
        packageIds.length
            ? queryTable(TABLES.packages, { filters: [["id", `in.(${packageIds.join(",")})`]] })
            : Promise.resolve([]),
        couponIds.length
            ? queryTable(TABLES.coupons, { filters: [["id", `in.(${couponIds.join(",")})`]] })
            : Promise.resolve([]),
        bookingIds.length ? fetchBookingAddonsRows(bookingIds) : Promise.resolve([]),
        fetchAddonsRows(),
    ]);

    const customerMap = new Map(customers.map((row) => [Number(row.customer_id ?? row.id), row]));
    const packageMap = new Map(packages.map((row) => [Number(row.id), row]));
    const couponMap = new Map(coupons.map((row) => [Number(row.id), row]));
    const addonMap = new Map(addons.map((row) => [Number(row.id), row]));

    const addonsByBooking = new Map();
    bookingAddons.forEach((row) => {
        const bookingKey = Number(row.booking);
        if (!addonsByBooking.has(bookingKey)) addonsByBooking.set(bookingKey, []);
        addonsByBooking.get(bookingKey).push({
            row,
            addon: addonMap.get(Number(row.addon)) || null,
        });
    });

    return bookingRows.map((row) =>
        normalizeBooking(row, {
            customer: customerMap.get(Number(row.customer)) || null,
            package: packageMap.get(Number(row.package)) || null,
            coupon: couponMap.get(Number(row.coupon)) || null,
            addons: addonsByBooking.get(Number(row.id)) || [],
        }),
    );
}

function selectTopPackages(packageRows, counts, categoryName = null, k = 3) {
    const lower = categoryName ? String(categoryName).toLowerCase() : null;
    return [...packageRows]
        .filter((pkg) => !pkg.deleted_at && !pkg.is_archived)
        .filter((pkg) => !lower || String(pkg.category || "").toLowerCase() === lower)
        .sort((a, b) => {
            const diff = (counts.get(Number(b.id)) || 0) - (counts.get(Number(a.id)) || 0);
            if (diff !== 0) return diff;
            return String(a.name || "").localeCompare(String(b.name || ""));
        })
        .slice(0, k);
}

function topAddonsFromCounts(addons, counts, categoryName = null, k = 3) {
    const lower = categoryName ? String(categoryName).toLowerCase() : null;
    return [...addons]
        .filter((addon) => !addon.deleted_at)
        .filter((addon) => {
            if (!lower || !addon.applies_to) return true;
            const applies = Array.isArray(addon.applies_to)
                ? addon.applies_to.join(",")
                : String(addon.applies_to);
            return applies.toLowerCase().includes(lower) || applies === "*";
        })
        .sort((a, b) => {
            const diff = (counts.get(Number(b.id)) || 0) - (counts.get(Number(a.id)) || 0);
            if (diff !== 0) return diff;
            return String(a.name || "").localeCompare(String(b.name || ""));
        })
        .slice(0, k);
}

function buildRecommendationPayload(packageRows, addonRows, packageCounts, addonCounts, source, totalBookings, k = 3, categoryName = null) {
    const packages = selectTopPackages(packageRows, packageCounts, categoryName, k);
    const recommendations = packages.map((pkg) => {
        const relatedAddons = topAddonsFromCounts(addonRows, addonCounts, pkg.category, 3);
        const basePrice = Number(pkg.promo_price ?? pkg.price ?? 0);
        const addonTotal = relatedAddons.reduce((sum, addon) => sum + Number(addon.price || 0), 0);
        return {
            package: normalizePackage(pkg),
            addons: relatedAddons.map(normalizeAddon),
            source,
            base_price: basePrice,
            total_price: basePrice + addonTotal,
        };
    });

    return {
        recommendations,
        total_bookings: totalBookings,
        source,
    };
}

function buildCouponPreview(coupon) {
    if (!coupon) return "";
    if (coupon.discount_type === "percent") {
        return `${Number(coupon.discount_value || 0)}% off`;
    }
    return `₱${Number(coupon.discount_value || 0).toLocaleString()} off`;
}

/** Same rules as manual code entry — used for "My coupons" list and validateCoupon. */
function evaluateCouponEligibility(coupon, customerId, usageRows) {
    if (!coupon) return { ok: false, error: "Invalid coupon" };
    if (coupon.deleted_at != null) return { ok: false, error: "Invalid coupon" };
    if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
        return { ok: false, error: "Coupon has expired" };
    }
    const rows = usageRows || [];
    if (coupon.use_limit != null && rows.length >= Number(coupon.use_limit || 0)) {
        return { ok: false, error: "Coupon limit reached" };
    }
    if (customerId != null) {
        const customerUsage = rows.filter((row) => Number(row.customer) === Number(customerId));
        if (customerUsage.length >= Number(coupon.per_customer_limit || 1)) {
            return { ok: false, error: "You already used this coupon" };
        }
    }
    return { ok: true };
}

function deriveCategoriesFromPackageRows(packages) {
    const seen = new Map();
    packages.forEach((pkg) => {
        if (!pkg.category || seen.has(pkg.category)) return;
        const category = {
            id: pkg.category,
            name: pkg.category,
            image_url: null,
            is_archived: false,
            deleted_at: null,
        };
        seen.set(
            pkg.category,
            normalizeCategory(
                category,
                packages.filter(
                    (row) =>
                        String(row.category || "").toLowerCase() ===
                        String(pkg.category).toLowerCase(),
                ).length,
            ),
        );
    });
    return Array.from(seen.values());
}

export async function fetchCategories() {
    try {
        const categories = await queryTable(TABLES.categories, {
            orderBy: "name.asc",
            filters: [["deleted_at", "is.null"]],
        });
        if (Array.isArray(categories) && categories.length) {
            const packages = await fetchPackagesRows();
            const counts = new Map();
            packages.forEach((pkg) => {
                if (!pkg.category) return;
                const key = String(pkg.category).toLowerCase();
                counts.set(key, (counts.get(key) || 0) + 1);
            });
            return categories.map((category) =>
                normalizeCategory(
                    category,
                    counts.get(String(category.name || "").toLowerCase()) || 0,
                ),
            );
        }
    } catch (_) {
        // Fallback to deriving categories from packages.
    }

    const packages = await fetchPackagesRows();
    return deriveCategoriesFromPackageRows(packages);
}

const _kioskBootstrapCache = {
    snapshot: null,
    inflight: null,
};

function buildKioskSnapshotFromRows(
    categoryRows,
    packages,
    addons,
    customers,
    bookings,
    bookingAddonsAll,
    couponSent,
    coupons,
    couponUsage,
) {
    let categories = [];
    if (Array.isArray(categoryRows) && categoryRows.length) {
        const counts = new Map();
        packages.forEach((pkg) => {
            if (!pkg.category) return;
            const key = String(pkg.category).toLowerCase();
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        categories = categoryRows.map((category) =>
            normalizeCategory(
                category,
                counts.get(String(category.name || "").toLowerCase()) || 0,
            ),
        );
    } else {
        categories = deriveCategoriesFromPackageRows(packages);
    }

    return {
        categories,
        packages,
        addons,
        customers,
        bookings,
        bookingAddons: bookingAddonsAll,
        couponSent,
        coupons,
        couponUsage,
    };
}

async function fetchKioskBootstrapDataRest() {
    const [
        categoryRows,
        packages,
        addons,
        customers,
        bookings,
        bookingAddonsAll,
        couponSent,
        coupons,
        couponUsage,
    ] = await Promise.all([
        queryTable(TABLES.categories, {
            orderBy: "name.asc",
            filters: [["deleted_at", "is.null"]],
        }).catch(() => []),
        fetchPackagesRows(),
        fetchAddonsRows(),
        fetchCustomersRows(),
        queryTable(TABLES.bookings, {
            select: "id,customer,package,coupon,session_date,total_price,session_status,created_at,last_updated",
            orderBy: "created_at.desc",
        }),
        queryTable(TABLES.bookingAddons, {
            select: "booking,addon,addon_quantity",
        }),
        queryTable(TABLES.couponSent, { orderBy: "sent_at.desc" }),
        queryTable(TABLES.coupons, {
            orderBy: "created_at.desc",
            filters: [["deleted_at", "is.null"]],
        }),
        queryTable(TABLES.couponUsage, {}),
    ]);
    return buildKioskSnapshotFromRows(
        categoryRows,
        packages,
        addons,
        customers,
        bookings,
        bookingAddonsAll,
        couponSent,
        coupons,
        couponUsage,
    );
}

/** One JDBC round-trip when the native pooler is enabled (Android + env). */
async function fetchKioskBootstrapDataPoolerOneQuery() {
    const c = TABLES.categories;
    const p = TABLES.packages;
    const a = TABLES.addons;
    const cust = TABLES.customers;
    const b = TABLES.bookings;
    const ba = TABLES.bookingAddons;
    const cs = TABLES.couponSent;
    const cp = TABLES.coupons;
    const cu = TABLES.couponUsage;

    const sql = `
SELECT (json_build_object(
  'category_rows', COALESCE((SELECT json_agg(row_to_json(r) ORDER BY r.name NULLS LAST)
    FROM (SELECT * FROM ${c} WHERE deleted_at IS NULL) r), '[]'::json),
  'package_rows', COALESCE((SELECT json_agg(row_to_json(r) ORDER BY r.id)
    FROM (SELECT * FROM ${p} WHERE deleted_at IS NULL) r), '[]'::json),
  'addon_rows', COALESCE((SELECT json_agg(row_to_json(r) ORDER BY r.id)
    FROM (SELECT * FROM ${a} WHERE deleted_at IS NULL) r), '[]'::json),
  'customer_rows', COALESCE((SELECT json_agg(row_to_json(r) ORDER BY r.customer_id)
    FROM (SELECT * FROM ${cust}) r), '[]'::json),
  'booking_rows', COALESCE((SELECT json_agg(row_to_json(r) ORDER BY r.created_at DESC NULLS LAST)
    FROM (SELECT * FROM ${b}) r), '[]'::json),
  'booking_addon_rows', COALESCE((SELECT json_agg(row_to_json(r))
    FROM (SELECT * FROM ${ba}) r), '[]'::json),
  'coupon_sent_rows', COALESCE((SELECT json_agg(row_to_json(r) ORDER BY r.sent_at DESC NULLS LAST)
    FROM (SELECT * FROM ${cs}) r), '[]'::json),
  'coupon_rows', COALESCE((SELECT json_agg(row_to_json(r) ORDER BY r.created_at DESC NULLS LAST)
    FROM (SELECT * FROM ${cp} WHERE deleted_at IS NULL) r), '[]'::json),
  'coupon_usage_rows', COALESCE((SELECT json_agg(row_to_json(r))
    FROM (SELECT * FROM ${cu}) r), '[]'::json)
))::text AS kiosk_payload`;

    const res = await poolerRun(sql.trim(), 20);
    if (!res || res.kind !== "rows" || !res.rows?.length) {
        throw new Error("Pooler bootstrap returned no rows");
    }
    const row0 = res.rows[0];
    const payloadStr =
        row0.kiosk_payload ??
        row0.KIOSK_PAYLOAD ??
        row0[Object.keys(row0)[0]];
    if (typeof payloadStr !== "string") {
        throw new Error("Pooler bootstrap payload shape unexpected");
    }
    const raw = JSON.parse(payloadStr);

    const categoryRows = (raw.category_rows || []).map((r) =>
        hydratePoolerRow(c, r),
    );
    const packages = (raw.package_rows || []).map((r) =>
        normalizePackage(hydratePoolerRow(p, r)),
    );
    const addons = (raw.addon_rows || []).map((r) =>
        normalizeAddon(hydratePoolerRow(a, r)),
    );
    const customers = (raw.customer_rows || []).map((r) =>
        normalizeCustomer(hydratePoolerRow(cust, r)),
    );
    const bookings = (raw.booking_rows || []).map((r) =>
        hydratePoolerRow(b, r),
    );
    const bookingAddonsAll = (raw.booking_addon_rows || []).map((r) =>
        hydratePoolerRow(ba, r),
    );
    const couponSent = (raw.coupon_sent_rows || []).map((r) =>
        hydratePoolerRow(cs, r),
    );
    const coupons = (raw.coupon_rows || []).map((r) =>
        hydratePoolerRow(cp, r),
    );
    const couponUsage = (raw.coupon_usage_rows || []).map((r) =>
        hydratePoolerRow(cu, r),
    );

    return buildKioskSnapshotFromRows(
        categoryRows,
        packages,
        addons,
        customers,
        bookings,
        bookingAddonsAll,
        couponSent,
        coupons,
        couponUsage,
    );
}

async function fetchKioskBootstrapDataAuto() {
    if (usePoolerBackend()) {
        try {
            return await fetchKioskBootstrapDataPoolerOneQuery();
        } catch (_) {
            /* fall back to PostgREST parallel reads */
        }
    }
    return fetchKioskBootstrapDataRest();
}

/**
 * Loads kiosk catalog + customers + bookings + coupon tables once per session.
 * - Deduplicates concurrent callers and React Strict Mode double effects.
 * - With Android pooler + EXPO_PUBLIC_USE_SUPABASE_POOLER=true: **one** SQL round-trip.
 * - Otherwise: parallel PostgREST reads (single burst at startup).
 *
 * @param {{ force?: boolean }} [options]
 */
export async function loadKioskBootstrap(options = {}) {
    const force = options.force === true;
    if (force) {
        _kioskBootstrapCache.snapshot = null;
        _kioskBootstrapCache.inflight = null;
    }
    if (_kioskBootstrapCache.snapshot && !force) {
        return _kioskBootstrapCache.snapshot;
    }
    if (_kioskBootstrapCache.inflight && !force) {
        return _kioskBootstrapCache.inflight;
    }
    const p = fetchKioskBootstrapDataAuto()
        .then((snapshot) => {
            _kioskBootstrapCache.snapshot = snapshot;
            return snapshot;
        })
        .catch((err) => {
            _kioskBootstrapCache.snapshot = null;
            throw err;
        });
    _kioskBootstrapCache.inflight = p;
    try {
        return await p;
    } finally {
        _kioskBootstrapCache.inflight = null;
    }
}

/** Clear session cache (e.g. after admin data refresh). */
export function invalidateKioskBootstrapCache() {
    _kioskBootstrapCache.snapshot = null;
    _kioskBootstrapCache.inflight = null;
}

export function snapshotFindCustomerByEmail(snapshot, email) {
    if (!snapshot?.customers?.length || !email) return null;
    const trimmed = String(email).trim().toLowerCase();
    if (!trimmed) return null;
    const hit = snapshot.customers.find(
        (c) => String(c.email || "").trim().toLowerCase() === trimmed,
    );
    return hit || null;
}

export function snapshotFetchRecommendations(snapshot, customerId, k = 3) {
    const packages = snapshot.packages;
    const addons = snapshot.addons;
    const bookings = snapshot.bookings || [];
    const bookingAddons = snapshot.bookingAddons || [];

    const customerHistory = customerId
        ? bookings.filter((booking) => Number(booking.customer) === Number(customerId))
        : [];
    const selectedBookings = customerHistory.length ? customerHistory : bookings;

    const packageCounts = new Map();
    const addonCounts = new Map();
    selectedBookings.forEach((booking) => {
        if (booking.package) {
            packageCounts.set(
                Number(booking.package),
                (packageCounts.get(Number(booking.package)) || 0) + 1,
            );
        }
    });
    bookingAddons.forEach((row) => {
        const booking = selectedBookings.find(
            (item) => Number(item.id) === Number(row.booking),
        );
        if (!booking) return;
        const addonId = Number(row.addon);
        addonCounts.set(
            addonId,
            (addonCounts.get(addonId) || 0) + Number(row.addon_quantity || 1),
        );
    });

    return buildRecommendationPayload(
        packages,
        addons,
        packageCounts,
        addonCounts,
        customerHistory.length ? "customer_booking_history" : "popular_fallback",
        bookings.length,
        k,
        null,
    );
}

export function snapshotFetchPopularRecommendations(snapshot, k = 3) {
    return snapshotFetchRecommendations(snapshot, null, k);
}

export function snapshotFetchCustomerCoupons(snapshot, customerId) {
    try {
        const sentRows = (snapshot.couponSent || []).filter(
            (row) => Number(row.customer) === Number(customerId),
        );
        if (!sentRows.length) return [];

        const couponIds = Array.from(
            new Set(sentRows.map((row) => row.coupon).filter((value) => value != null)),
        ).map(Number);
        const couponList = (snapshot.coupons || []).filter(
            (c) => couponIds.includes(Number(c.id)) && c.deleted_at == null,
        );
        const couponMap = new Map(couponList.map((row) => [Number(row.id), row]));

        const usageByCoupon = new Map();
        (snapshot.couponUsage || []).forEach((u) => {
            const cid = Number(u.coupon);
            if (!couponIds.includes(cid)) return;
            if (!usageByCoupon.has(cid)) usageByCoupon.set(cid, []);
            usageByCoupon.get(cid).push(u);
        });

        return sentRows
            .map((row) => {
                const coupon = couponMap.get(Number(row.coupon));
                if (!coupon) return null;
                const usageForCoupon = usageByCoupon.get(Number(coupon.id)) || [];
                const elig = evaluateCouponEligibility(coupon, customerId, usageForCoupon);
                if (!elig.ok) return null;
                return {
                    id: coupon.id,
                    code: coupon.code,
                    discount_preview: buildCouponPreview(coupon),
                    sender_label: row.sender_label ?? null,
                    sent_at: row.sent_at ?? null,
                };
            })
            .filter(Boolean);
    } catch (_) {
        return [];
    }
}

function findCouponRowByCodeInSnapshot(snapshot, normalizedCode) {
    const lower = String(normalizedCode || "").trim().toLowerCase();
    if (!lower) return null;
    return (
        (snapshot.coupons || []).find(
            (c) =>
                c.deleted_at == null &&
                String(c.code || "").trim().toLowerCase() === lower,
        ) || null
    );
}

export function snapshotValidateCoupon(snapshot, code, customerId, subtotal) {
    const normalizedCode = String(code || "").trim();
    if (!normalizedCode) {
        return { valid: false, error: "Enter a coupon code" };
    }

    const coupon = findCouponRowByCodeInSnapshot(snapshot, normalizedCode);
    if (!coupon) {
        return { valid: false, error: "Invalid coupon" };
    }

    const usageRows = (snapshot.couponUsage || []).filter(
        (u) => Number(u.coupon) === Number(coupon.id),
    );
    const elig = evaluateCouponEligibility(coupon, customerId, usageRows);
    if (!elig.ok) {
        return { valid: false, error: elig.error };
    }

    const subtotalValue = Number(subtotal || 0);
    let discountAmount = 0;
    if (coupon.discount_type === "percent") {
        discountAmount = subtotalValue * (Number(coupon.discount_value || 0) / 100);
        if (coupon.max_discount_amount != null) {
            discountAmount = Math.min(discountAmount, Number(coupon.max_discount_amount));
        }
    } else {
        discountAmount = Number(coupon.discount_value || 0);
    }

    discountAmount = Math.max(0, Math.min(discountAmount, subtotalValue));

    return {
        valid: true,
        coupon_id: coupon.id,
        code: coupon.code,
        discount_amount: discountAmount,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
    };
}

export function snapshotPackagesForCategory(snapshot, categoryName) {
    const packages = snapshot?.packages || [];
    if (!categoryName) return packages;
    const lower = String(categoryName).toLowerCase();
    return packages.filter(
        (pkg) => String(pkg.category || "").toLowerCase() === lower,
    );
}

export function snapshotPopularPackage(snapshot, categoryName) {
    const packages = snapshot.packages;
    const counts = new Map();
    (snapshot.bookings || []).forEach((booking) => {
        if (!booking.package) return;
        counts.set(
            Number(booking.package),
            (counts.get(Number(booking.package)) || 0) + 1,
        );
    });
    const top = selectTopPackages(packages, counts, categoryName, 1)[0] || null;
    return { top_package_id: top?.id ?? null };
}

export function snapshotAddonsForCategory(snapshot, categoryName) {
    const addons = snapshot?.addons || [];
    if (!categoryName) return addons;
    const lower = String(categoryName).toLowerCase();
    return addons.filter((addon) => {
        if (!addon.applies_to) return true;
        const applies = Array.isArray(addon.applies_to)
            ? addon.applies_to.join(",")
            : String(addon.applies_to);
        return applies.toLowerCase().includes(lower) || applies === "*";
    });
}

export function snapshotPopularAddons(snapshot, categoryName) {
    const addons = snapshot.addons || [];
    const counts = new Map();
    (snapshot.bookingAddons || []).forEach((row) => {
        const key = Number(row.addon);
        counts.set(key, (counts.get(key) || 0) + Number(row.addon_quantity || 1));
    });
    const top = topAddonsFromCounts(addons, counts, categoryName, 3).map((a) => a.id);
    return { top_addon_ids: top };
}

export async function getCategories() {
    return fetchCategories();
}

export async function fetchPackages(categoryName = null) {
    const packages = await fetchPackagesRows();
    if (!categoryName) return packages;
    const lower = String(categoryName).toLowerCase();
    return packages.filter((pkg) => String(pkg.category || "").toLowerCase() === lower);
}

export async function getPackages() {
    return fetchPackages();
}

export async function getPackagesByCategory(categoryName) {
    return fetchPackages(categoryName);
}

export async function fetchAddons(categoryName = null) {
    const addons = await fetchAddonsRows();
    if (!categoryName) return addons;
    const lower = String(categoryName).toLowerCase();
    return addons.filter((addon) => {
        if (!addon.applies_to) return true;
        const applies = Array.isArray(addon.applies_to)
            ? addon.applies_to.join(",")
            : String(addon.applies_to);
        return applies.toLowerCase().includes(lower) || applies === "*";
    });
}

export async function getAddons() {
    return fetchAddons();
}

export async function getAddonsByCategory(categoryName) {
    return fetchAddons(categoryName);
}

export async function createPackage(data) {
    const row = await insertRow(TABLES.packages, {
        ...data,
        last_updated: new Date().toISOString(),
    });
    return normalizePackage(row);
}

export async function updatePackage(id, data) {
    const row = await updateRow(TABLES.packages, "id", id, {
        ...data,
        last_updated: new Date().toISOString(),
    });
    return normalizePackage(row);
}

export async function deletePackage(id) {
    return updateRow(TABLES.packages, "id", id, {
        deleted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
    });
}

export async function createAddon(data) {
    const row = await insertRow(TABLES.addons, {
        ...data,
        last_updated: new Date().toISOString(),
    });
    return normalizeAddon(row);
}

export async function updateAddon(id, data) {
    const row = await updateRow(TABLES.addons, "id", id, {
        ...data,
        last_updated: new Date().toISOString(),
    });
    return normalizeAddon(row);
}

export async function deleteAddon(id) {
    return updateRow(TABLES.addons, "id", id, {
        deleted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
    });
}

export async function getCustomers() {
    return fetchCustomersRows();
}

export async function getCustomer(id) {
    const row = await queryTable(TABLES.customers, {
        filters: [["customer_id", `eq.${encodeURIComponent(String(id))}`]],
    });
    return normalizeCustomer(row[0] || null);
}

export async function createCustomer(data) {
    const row = await insertRow(TABLES.customers, {
        full_name: data.full_name ?? data.name ?? null,
        email: data.email ?? null,
        contact_number: data.contact_number ?? data.contactNo ?? null,
        consent: data.consent_given ? "I Agree" : data.consent ?? null,
        is_first_time: data.is_first_time ?? null,
        acquisition_source: data.acquisition_source ?? null,
        last_updated: new Date().toISOString(),
    });
    return normalizeCustomer(row);
}

export async function updateCustomer(id, data) {
    const row = await updateRow(TABLES.customers, "customer_id", id, {
        full_name: data.full_name ?? data.name ?? null,
        email: data.email ?? null,
        contact_number: data.contact_number ?? data.contactNo ?? null,
        consent: data.consent_given ? "I Agree" : data.consent ?? null,
        is_first_time: data.is_first_time ?? null,
        acquisition_source: data.acquisition_source ?? null,
        last_updated: new Date().toISOString(),
    });
    return normalizeCustomer(row);
}

export async function deleteCustomers(ids) {
    const results = [];
    for (const id of ids || []) {
        results.push(await updateRow(TABLES.customers, "customer_id", id, {
            last_updated: new Date().toISOString(),
        }));
    }
    return results;
}

export async function findCustomerByEmail(email) {
    if (!email) return null;
    const trimmed = String(email).trim().toLowerCase();
    if (!trimmed) return null;
    try {
        const customers = await queryTable(TABLES.customers, {
            filters: [["email", `ilike.${encodeURIComponent(trimmed)}`]],
        });
        return normalizeCustomer(customers[0] || null);
    } catch (_) {
        return null;
    }
}

async function findCustomerById(customerId) {
    if (customerId == null) return null;
    const customer = await queryTable(TABLES.customers, {
        filters: [["customer_id", `eq.${encodeURIComponent(String(customerId))}`]],
    });
    return normalizeCustomer(customer[0] || null);
}

export async function fetchBookingsByStatus(statuses = "Pending,Ongoing") {
    const statusList = String(statuses || "")
        .split(",")
        .map((status) => status.trim())
        .filter(Boolean);

    const filters = [];
    if (statusList.length) {
        filters.push(["session_status", `in.(${statusList.join(",")})`]);
    }
    const rows = await queryTable(TABLES.bookings, {
        orderBy: "created_at.asc",
        filters,
    });
    return buildBookingCollection(rows);
}

export async function getBookings(statusFilter = null) {
    return fetchBookingsByStatus(statusFilter || "");
}

export async function getCustomerBookings(customerId) {
    const rows = await queryTable(TABLES.bookings, {
        filters: [["customer", `eq.${encodeURIComponent(String(customerId))}`]],
        orderBy: "created_at.asc",
    });
    return buildBookingCollection(rows);
}

export async function createBooking(customerId, data) {
    const row = await insertRow(TABLES.bookings, {
        customer: customerId,
        package: data.package_id ?? data.package ?? null,
        coupon: data.coupon_id ?? data.coupon ?? null,
        session_status: data.session_status || "Pending",
        total_price: Number(data.total_price ?? data.total ?? 0),
        session_date: data.session_date ?? null,
        last_updated: new Date().toISOString(),
    });
    return normalizeBooking(row);
}

export async function updateBookingStatus(bookingId, sessionStatus) {
    return updateRow(TABLES.bookings, "id", bookingId, {
        session_status: sessionStatus,
        last_updated: new Date().toISOString(),
    });
}

export async function submitBooking(payload, catalog = null) {
    let customer = null;
    if (payload.customer_id != null) {
        customer = await findCustomerById(payload.customer_id);
    }
    if (!customer && payload.customer?.email) {
        customer = await findCustomerByEmail(payload.customer.email);
    }
    if (!customer) {
        customer = await createCustomer(payload.customer || {});
    }

    const packages = catalog?.packages ?? (await fetchPackagesRows());
    const addons = catalog?.addons ?? (await fetchAddonsRows());
    const packageRow = packages.find((pkg) => Number(pkg.id) === Number(payload.package_id)) || null;
    const addonMap = new Map(addons.map((addon) => [Number(addon.id), addon]));

    const bookingRow = await insertRow(TABLES.bookings, {
        customer: customer.id,
        package: payload.package_id ?? null,
        coupon: payload.coupon_id ?? null,
        session_status: payload.session_status || "Pending",
        total_price: Number(payload.total_amount || 0),
        session_date: payload.preferred_date ? new Date(payload.preferred_date).toISOString() : null,
        last_updated: new Date().toISOString(),
    });

    const bookingId = bookingRow?.id ?? bookingRow?.booking_id ?? null;
    if (bookingId && Array.isArray(payload.addon_ids) && payload.addon_ids.length) {
        for (const addonId of payload.addon_ids) {
            const addon = addonMap.get(Number(addonId));
            if (!addon) continue;
            await insertRow(TABLES.bookingAddons, {
                booking: bookingId,
                addon: addon.id,
                addon_quantity: 1,
                addon_price: Number(addon.price || 0),
                total_addon_cost: Number(addon.price || 0),
                last_updated: new Date().toISOString(),
            });
        }
    }

    return {
        customer,
        booking: normalizeBooking(bookingRow, {
            customer,
            package: packageRow,
            coupon: null,
            addons: [],
        }),
    };
}

export async function fetchPopularPackage(categoryName) {
    const packages = await fetchPackagesRows();
    const bookings = await queryTable(TABLES.bookings, {
        select: "package,session_status",
    });
    const counts = new Map();
    bookings.forEach((booking) => {
        if (!booking.package) return;
        counts.set(Number(booking.package), (counts.get(Number(booking.package)) || 0) + 1);
    });
    const top = selectTopPackages(packages, counts, categoryName, 1)[0] || null;
    return { top_package_id: top?.id ?? null };
}

export async function fetchPopularAddons(categoryName) {
    const addons = await fetchAddonsRows();
    const bookings = await queryTable(TABLES.bookingAddons, {
        select: "addon,addon_quantity",
    });
    const counts = new Map();
    bookings.forEach((row) => {
        const key = Number(row.addon);
        counts.set(key, (counts.get(key) || 0) + Number(row.addon_quantity || 1));
    });
    const top = topAddonsFromCounts(addons, counts, categoryName, 3).map((addon) => addon.id);
    return { top_addon_ids: top };
}

export async function fetchRecommendations(customerId, targetDate = null, k = 3) {
    const packages = await fetchPackagesRows();
    const addons = await fetchAddonsRows();
    const bookings = await queryTable(TABLES.bookings, {
        select: "id,customer,package,coupon,session_date,total_price,session_status,created_at,last_updated",
        orderBy: "created_at.desc",
    });
    const bookingIds = bookings.map((booking) => booking.id).filter((value) => value != null);
    const bookingAddons = bookingIds.length ? await fetchBookingAddonsRows(bookingIds) : [];

    const customerHistory = customerId
        ? bookings.filter((booking) => Number(booking.customer) === Number(customerId))
        : [];
    const selectedBookings = customerHistory.length ? customerHistory : bookings;

    const packageCounts = new Map();
    const addonCounts = new Map();
    selectedBookings.forEach((booking) => {
        if (booking.package) {
            packageCounts.set(Number(booking.package), (packageCounts.get(Number(booking.package)) || 0) + 1);
        }
    });
    bookingAddons.forEach((row) => {
        const booking = selectedBookings.find((item) => Number(item.id) === Number(row.booking));
        if (!booking) return;
        const addonId = Number(row.addon);
        addonCounts.set(addonId, (addonCounts.get(addonId) || 0) + Number(row.addon_quantity || 1));
    });

    return buildRecommendationPayload(
        packages,
        addons,
        packageCounts,
        addonCounts,
        customerHistory.length ? "customer_booking_history" : "popular_fallback",
        bookings.length,
        k,
        null,
    );
}

export async function fetchPopularRecommendations(k = 3) {
    return fetchRecommendations(null, null, k);
}

export async function fetchCustomerCoupons(customerId) {
    try {
        const sentRows = await queryTable(TABLES.couponSent, {
            filters: [["customer", `eq.${encodeURIComponent(String(customerId))}`]],
            orderBy: "sent_at.desc",
        });
        if (!sentRows.length) return [];

        const couponIds = Array.from(new Set(sentRows.map((row) => row.coupon).filter((value) => value != null)));
        const coupons = couponIds.length
            ? await queryTable(TABLES.coupons, {
                  filters: [
                      ["id", `in.(${couponIds.join(",")})`],
                      ["deleted_at", "is.null"],
                  ],
              })
            : [];
        const couponMap = new Map(coupons.map((row) => [Number(row.id), row]));

        const usageAll = couponIds.length
            ? await queryTable(TABLES.couponUsage, {
                  filters: [["coupon", `in.(${couponIds.join(",")})`]],
              })
            : [];
        const usageByCoupon = new Map();
        usageAll.forEach((u) => {
            const cid = Number(u.coupon);
            if (!usageByCoupon.has(cid)) usageByCoupon.set(cid, []);
            usageByCoupon.get(cid).push(u);
        });

        return sentRows
            .map((row) => {
                const coupon = couponMap.get(Number(row.coupon));
                if (!coupon) return null;
                const usageForCoupon = usageByCoupon.get(Number(coupon.id)) || [];
                const elig = evaluateCouponEligibility(coupon, customerId, usageForCoupon);
                if (!elig.ok) return null;
                return {
                    id: coupon.id,
                    code: coupon.code,
                    discount_preview: buildCouponPreview(coupon),
                    sender_label: row.sender_label ?? null,
                    sent_at: row.sent_at ?? null,
                };
            })
            .filter(Boolean);
    } catch (_) {
        return [];
    }
}

export async function validateCoupon(code, customerId, subtotal) {
    const normalizedCode = String(code || "").trim();
    if (!normalizedCode) {
        return { valid: false, error: "Enter a coupon code" };
    }

    const coupons = await queryTable(TABLES.coupons, {
        filters: [["code", `ilike.${encodeURIComponent(normalizedCode)}`], ["deleted_at", "is.null"]],
    });
    const coupon = coupons[0];
    if (!coupon) {
        return { valid: false, error: "Invalid coupon" };
    }

    const usageRows = await queryTable(TABLES.couponUsage, {
        filters: [["coupon", `eq.${encodeURIComponent(String(coupon.id))}`]],
    });
    const elig = evaluateCouponEligibility(coupon, customerId, usageRows);
    if (!elig.ok) {
        return { valid: false, error: elig.error };
    }

    const subtotalValue = Number(subtotal || 0);
    let discountAmount = 0;
    if (coupon.discount_type === "percent") {
        discountAmount = subtotalValue * (Number(coupon.discount_value || 0) / 100);
        if (coupon.max_discount_amount != null) {
            discountAmount = Math.min(discountAmount, Number(coupon.max_discount_amount));
        }
    } else {
        discountAmount = Number(coupon.discount_value || 0);
    }

    discountAmount = Math.max(0, Math.min(discountAmount, subtotalValue));

    return {
        valid: true,
        coupon_id: coupon.id,
        code: coupon.code,
        discount_amount: discountAmount,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
    };
}

export async function refreshRecommender() {
    const recs = await fetchPopularRecommendations(3);
    return {
        success: true,
        message: recs?.recommendations?.length
            ? "Recommender refreshed from live booking data."
            : "Recommender is using live booking data.",
    };
}

export async function createBookingAndReturn(customerId, data) {
    return createBooking(customerId, data);
}

export { usePoolerBackend, buildJdbcUrlFromEnv } from "./poolerTransport";
export { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_REST_BASE_URL, TABLES };
