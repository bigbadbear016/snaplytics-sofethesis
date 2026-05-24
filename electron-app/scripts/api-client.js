// scripts/api-client.js
// ============================================================================
// CENTRAL HTTP CLIENT  –  all data access goes through Django DRF.
// No Supabase SDK, no DB credentials in the renderer process.
// ============================================================================

const API_BASE = "http://127.0.0.1:8000/api";
const CUSTOMER_LIST_TIMEOUT_MS = 15000;

async function _request(method, path, body = null, options = {}) {
    const token = sessionStorage.getItem("authToken");
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const opts = { method, headers };
    if (body !== null) opts.body = JSON.stringify(body);
    const timeoutMs = Number(options.timeoutMs);
    let timeoutId = null;
    if (
        Number.isFinite(timeoutMs) &&
        timeoutMs > 0 &&
        typeof AbortController !== "undefined"
    ) {
        const controller = new AbortController();
        opts.signal = controller.signal;
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
        const res = await fetch(`${API_BASE}${path}`, opts);

        if (!res.ok) {
            let detail = res.statusText;
            let body = null;
            try {
                body = await res.json();
                if (typeof body?.message === "string" && body.message.trim()) {
                    detail = body.message.trim();
                } else if (typeof body?.detail === "string" && body.detail.trim()) {
                    detail = body.detail.trim();
                } else if (Array.isArray(body?.detail)) {
                    detail = body.detail.map(String).join(" ");
                } else if (body && typeof body === "object") {
                    detail = JSON.stringify(body);
                }
            } catch (_) {
                try {
                    const text = await res.text();
                    if (text && text.trim()) detail = text.trim().slice(0, 600);
                } catch (_) {}
            }
            const err = new Error(detail);
            err.status = res.status;
            err.body = body;
            throw err;
        }
        return res.status === 204 ? null : res.json();
    } catch (err) {
        if (err?.name === "AbortError") {
            throw new Error(
                `Request timed out after ${Math.round(timeoutMs / 1000)}s. ` +
                    "Check that the Django server is running and responsive.",
            );
        }
        throw err;
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }
}

// Unwrap DRF PageNumberPagination responses only (count/next/previous + results).
// Do not unwrap arbitrary objects that happen to include a `results` array.
function _unwrap(data) {
    if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        Array.isArray(data.results) &&
        ("count" in data || "next" in data || "previous" in data)
    ) {
        return data.results;
    }
    return data;
}

const http = {
    get: (path, options) => _request("GET", path, null, options).then(_unwrap),
    post: (path, body) => _request("POST", path, body),
    put: (path, body) => _request("PUT", path, body),
    patch: (path, body) => _request("PATCH", path, body),
    delete: (path) => _request("DELETE", path),
};

window.apiClient = {
    auth: {
        staffAccounts: () => _request("GET", "/auth/staff-accounts/"),
        createStaffAccount: (data) => _request("POST", "/auth/signup/", data),
        updateStaffAccount: (userId, data) =>
            _request("PUT", `/auth/staff-accounts/${userId}/`, data),
        deleteStaffAccount: (userId) =>
            _request("DELETE", `/auth/staff-accounts/${userId}/`),
        restoreStaffAccount: (userId) =>
            _request("POST", `/auth/staff-accounts/${userId}/restore/`, {}),
        /** POST …/purge/ — StaffProfile.dev_mode only (backend enforced). */
        purgeStaffAccount: (userId) =>
            _request("POST", `/auth/staff-accounts/${userId}/purge/`, {}),
    },

    // ── Customers ─────────────────────────────────────────────────────────────
    customers: {
        /** GET /api/customers/all/ → full list for table page */
        listAll: () =>
            http.get("/customers/all/", { timeoutMs: CUSTOMER_LIST_TIMEOUT_MS }),
        /** GET /api/customers/<id>/ → detail with nested bookings */
        get: (id) => http.get(`/customers/${id}/`),
        /** POST /api/customers/ */
        create: (data) => http.post("/customers/", data),
        /** PUT /api/customers/<id>/ */
        update: (id, data) => http.put(`/customers/${id}/`, data),
        /** DELETE /api/customers/<id>/ → soft-delete (Internal Records) */
        remove: (id) => http.delete(`/customers/${id}/`),
        /** POST /api/customers/<id>/restore/ — ADMIN/OWNER */
        restore: (id) => http.post(`/customers/${id}/restore/`),
        /** POST /api/customers/<id>/purge/ — StaffProfile.dev_mode only (backend enforced). */
        purge: (id) => http.post(`/customers/${id}/purge/`),
        /** POST /api/customers/bulk-delete/  { ids:[…] } */
        bulkDelete: (ids) =>
            http.post("/customers/bulk-delete/", { ids: [...ids] }),
        /** POST /api/customers/<id>/claim-package/  { package_id } — redeem points for package */
        claimPackage: (id, data) =>
            http.post(`/customers/${id}/claim-package/`, data),
        /** GET /api/customers/<id>/action-logs/ — staff auth; metadata.customer_id match */
        actionLogs: (id) => http.get(`/customers/${id}/action-logs/`),
    },

    /** GET/PATCH /api/loyalty-settings/ — earn vs redeem pesos-per-point (singleton) */
    loyaltySettings: {
        get: () => http.get("/loyalty-settings/"),
        patch: (data) => http.patch("/loyalty-settings/", data),
    },

    // ── Bookings ──────────────────────────────────────────────────────────────
    bookings: {
        /** GET /api/customers/<cid>/bookings/ */
        listForCustomer: (cid) => http.get(`/customers/${cid}/bookings/`),

        /** GET /api/bookings/?status=Pending,Ongoing  (notification panel) */
        listPendingOngoing: () => http.get("/bookings/?status=Pending,Ongoing"),

        /** GET /api/bookings/<bid>/ */
        get: (bid) => http.get(`/bookings/${bid}/`),

        /** POST /api/customers/<cid>/bookings/ */
        create: (cid, data) => http.post(`/customers/${cid}/bookings/`, data),

        /** PUT /api/customers/<cid>/bookings/<bid>/ */
        update: (cid, bid, data) =>
            http.put(`/customers/${cid}/bookings/${bid}/`, data),

        /** PATCH /api/bookings/<bid>/status/  { session_status } */
        updateStatus: (bid, session_status) =>
            http.patch(`/bookings/${bid}/status/`, { session_status }),

        /** DELETE /api/customers/<cid>/bookings/<bid>/ */
        remove: (cid, bid) => http.delete(`/customers/${cid}/bookings/${bid}/`),

        /** DELETE /api/bookings/<bid>/  (notification panel deny) */
        removeById: (bid) => http.delete(`/bookings/${bid}/`),

        /** PATCH /api/bookings/<bid>/  (partial update, e.g. coupon_id) */
        patch: (bid, data) => http.patch(`/bookings/${bid}/`, data),

        /**
         * POST /api/bookings/import-batch/
         * Body: { rows: [{ customer_id | customer_email, package_id?, session_date?, session_status?, total_price? }] }
         */
        importBatch: (rows) =>
            http.post("/bookings/import-batch/", { rows }),
    },

    // ── Packages / Addons ─────────────────────────────────────────────────────
    /** purge on packages/addons/categories/coupons: StaffProfile.dev_mode only (backend). */
    packages: {
        list: () => http.get("/packages/"),
        create: (data) => http.post("/packages/", data),
        update: (id, data) => http.put(`/packages/${id}/`, data),
        patch: (id, data) => http.patch(`/packages/${id}/`, data),
        remove: (id) => http.delete(`/packages/${id}/`),
        restore: (id) => http.post(`/packages/${id}/restore/`),
        purge: (id) => http.post(`/packages/${id}/purge/`),
    },
    addons: {
        list: () => http.get("/addons/"),
        create: (data) => http.post("/addons/", data),
        update: (id, data) => http.put(`/addons/${id}/`, data),
        patch: (id, data) => http.patch(`/addons/${id}/`, data),
        remove: (id) => http.delete(`/addons/${id}/`),
        restore: (id) => http.post(`/addons/${id}/restore/`),
        purge: (id) => http.post(`/addons/${id}/purge/`),
    },
    categories: {
        list: () => http.get("/categories/"),
        create: (data) => http.post("/categories/", data),
        update: (id, data) => http.put(`/categories/${id}/`, data),
        patch: (id, data) => http.patch(`/categories/${id}/`, data),
        remove: (id) => http.delete(`/categories/${id}/`),
        restore: (id) => http.post(`/categories/${id}/restore/`),
        purge: (id) => http.post(`/categories/${id}/purge/`),
    },

    // ── Analytics (chart data) ────────────────────────────────────────────────
    analytics: {
        /**
         * GET /api/analytics/dashboard/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
         * → { risk_overview, booking_trends, package_popularity, filters }
         */
        dashboard: (params = {}) => {
            const q = new URLSearchParams();
            if (params.date_from) q.set("date_from", params.date_from);
            if (params.date_to) q.set("date_to", params.date_to);
            const qs = q.toString();
            return _request(
                "GET",
                `/analytics/dashboard/${qs ? `?${qs}` : ""}`,
            );
        },
        /** GET /api/analytics/model-metrics/ */
        modelMetrics: () => _request("GET", "/analytics/model-metrics/"),
        /** POST /api/analytics/model-metrics/recompute-recommendation/ */
        recomputeRecommendationMetrics: () =>
            _request(
                "POST",
                "/analytics/model-metrics/recompute-recommendation/",
                {},
            ),
    },

    // ── Recommendations ───────────────────────────────────────────────────────
    recommendations: {
        /**
         * GET /api/recommendations/popular/?k=3
         * Returns top-K globally popular package+addon combos.
         * Shape: { recommendations:[{package, addons, base_price, total_price, score, source}], count, generated_at }
         */
        popular: (k = 3) => _request("GET", `/recommendations/popular/?k=${k}`),

        /**
         * GET /api/recommendations/<customer_id>/?k=3
         * Personalized recommendations for a specific customer.
         */
        forCustomer: (customerId, k = 3) =>
            _request("GET", `/recommendations/${customerId}/?k=${k}`),

        /**
         * POST /api/recommendations/rebuild/
         * Exports DB → CSV and rebuilds popularity artifact CSVs.
         * Busts in-memory caches so the next popular() call is fresh.
         */
        rebuild: () => _request("POST", "/recommendations/rebuild/", {}),
    },

    // ── Renewal prediction ───────────────────────────────────────────────────
    renewal: {
        forCustomer: (customerId) => _request("GET", `/renewal/${customerId}/`),
    },

    // ── Coupons ─────────────────────────────────────────────────────────────
    coupons: {
        list: () => http.get("/coupons/"),
        customerList: (customerId) =>
            _request("GET", `/customers/${customerId}/coupons/`),
        create: (data) => http.post("/coupons/", data),
        get: (id) => http.get(`/coupons/${id}/`),
        update: (id, data) => http.put(`/coupons/${id}/`, data),
        remove: (id) => http.delete(`/coupons/${id}/`),
        restore: (id) => http.post(`/coupons/${id}/restore/`),
        purge: (id) => http.post(`/coupons/${id}/purge/`),
        send: (id, data) => http.post(`/coupons/${id}/send/`, data),
        /** POST /api/coupons/<id>/send-email/  { customer_ids, subject, body } */
        sendEmail: (id, data) => http.post(`/coupons/${id}/send-email/`, data),
        /** GET /api/coupons/<id>/history/ — recipients + redemptions */
        history: (id) => http.get(`/coupons/${id}/history/`),
        /** POST /api/coupons/validate/  { code, customer_id, subtotal } */
        validate: (code, customerId, subtotal) =>
            _request("POST", "/coupons/validate/", {
                code: (code || "").trim(),
                customer_id: customerId,
                subtotal: Number(subtotal) || 0,
            }),
    },
    emailTemplates: {
        list: () => http.get("/email-templates/"),
        create: (data) => http.post("/email-templates/", data),
        update: (id, data) => http.put(`/email-templates/${id}/`, data),
        remove: (id) => http.delete(`/email-templates/${id}/`),
    },
    recycleBin: {
        /** GET /api/recycle-bin/ — ADMIN/OWNER (Internal Records); soft-deleted items only */
        list: () => _request("GET", "/recycle-bin/"),
    },
    actionLogs: {
        list: (filters = {}) => {
            const q = new URLSearchParams();
            q.set("limit", String(filters.limit || 200));
            if (filters.q) q.set("q", String(filters.q));
            if (filters.actor) q.set("actor", String(filters.actor));
            if (filters.action_type) q.set("action_type", String(filters.action_type));
            if (filters.date_from) q.set("date_from", String(filters.date_from));
            if (filters.date_to) q.set("date_to", String(filters.date_to));
            return _request("GET", `/action-logs/?${q.toString()}`);
        },
    },
};
