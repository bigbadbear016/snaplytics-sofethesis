// scripts/api-client.js
// ============================================================================
// CENTRAL HTTP CLIENT  –  all data access goes through Django DRF.
// No Supabase SDK, no DB credentials in the renderer process.
// ============================================================================

const API_BASE = "http://127.0.0.1:8000/api";

async function _request(method, path, body = null) {
    const token = sessionStorage.getItem("authToken");
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const opts = { method, headers };
    if (body !== null) opts.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, opts);

    if (!res.ok) {
        let detail = res.statusText;
        try {
            const err = await res.json();
            detail = err.detail || err.message || JSON.stringify(err);
        } catch (_) {
            try {
                const text = await res.text();
                if (text && text.trim()) detail = text.trim().slice(0, 600);
            } catch (_) {}
        }
        throw new Error(`[${method} ${path}] ${res.status}: ${detail}`);
    }
    return res.status === 204 ? null : res.json();
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
    get: (path) => _request("GET", path).then(_unwrap),
    post: (path, body) => _request("POST", path, body),
    put: (path, body) => _request("PUT", path, body),
    patch: (path, body) => _request("PATCH", path, body),
    delete: (path) => _request("DELETE", path),
};

window.apiClient = {
    // ── Customers ─────────────────────────────────────────────────────────────
    customers: {
        /** GET /api/customers/all/ → full list for table page */
        listAll: () => http.get("/customers/all/"),
        /** GET /api/customers/<id>/ → detail with nested bookings */
        get: (id) => http.get(`/customers/${id}/`),
        /** POST /api/customers/ */
        create: (data) => http.post("/customers/", data),
        /** PUT /api/customers/<id>/ */
        update: (id, data) => http.put(`/customers/${id}/`, data),
        /** DELETE /api/customers/<id>/ */
        remove: (id) => http.delete(`/customers/${id}/`),
        /** POST /api/customers/bulk-delete/  { ids:[…] } */
        bulkDelete: (ids) =>
            http.post("/customers/bulk-delete/", { ids: [...ids] }),
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
    packages: {
        list: () => http.get("/packages/"),
        create: (data) => http.post("/packages/", data),
        update: (id, data) => http.put(`/packages/${id}/`, data),
        patch: (id, data) => http.patch(`/packages/${id}/`, data),
        remove: (id) => http.delete(`/packages/${id}/`),
    },
    addons: {
        list: () => http.get("/addons/"),
        create: (data) => http.post("/addons/", data),
        update: (id, data) => http.put(`/addons/${id}/`, data),
        patch: (id, data) => http.patch(`/addons/${id}/`, data),
        remove: (id) => http.delete(`/addons/${id}/`),
    },
    categories: {
        list: () => http.get("/categories/"),
        create: (data) => http.post("/categories/", data),
        update: (id, data) => http.put(`/categories/${id}/`, data),
        patch: (id, data) => http.patch(`/categories/${id}/`, data),
        remove: (id) => http.delete(`/categories/${id}/`),
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
};
