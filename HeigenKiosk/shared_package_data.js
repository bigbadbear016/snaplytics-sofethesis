// shared_package_data.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared data layer for the admin web app (package-api.js, package-list-api.js).
// All data is fetched from the Django REST backend.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "http://127.0.0.1:8000/api";

async function apiFetch(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
        ...options,
    });
    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
            const e = await res.json();
            msg = e.detail || JSON.stringify(e);
        } catch (_) {}
        throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
}

// ── Packages ──────────────────────────────────────────────────────────────────

export async function getPackages() {
    return apiFetch("/packages/");
}

export async function getPackagesByCategory(categoryName) {
    const all = await getPackages();
    if (!categoryName) return all;
    const lower = categoryName.toLowerCase();
    return all.filter((p) => p.category?.toLowerCase() === lower);
}

export async function createPackage(data) {
    return apiFetch("/packages/", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function updatePackage(id, data) {
    return apiFetch(`/packages/${id}/`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function deletePackage(id) {
    return apiFetch(`/packages/${id}/`, { method: "DELETE" });
}

// ── Addons ────────────────────────────────────────────────────────────────────

export async function getAddons() {
    return apiFetch("/addons/");
}

export async function getAddonsByCategory(categoryName) {
    const all = await getAddons();
    if (!categoryName) return all;
    const lower = categoryName.toLowerCase();
    return all.filter((a) => {
        if (!a.applies_to) return true;
        const applies = Array.isArray(a.applies_to)
            ? a.applies_to.join(",")
            : String(a.applies_to);
        return applies.toLowerCase().includes(lower) || applies === "*";
    });
}

export async function createAddon(data) {
    return apiFetch("/addons/", { method: "POST", body: JSON.stringify(data) });
}

export async function updateAddon(id, data) {
    return apiFetch(`/addons/${id}/`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function deleteAddon(id) {
    return apiFetch(`/addons/${id}/`, { method: "DELETE" });
}

// ── Categories (derived from packages) ───────────────────────────────────────

export async function getCategories() {
    const packages = await getPackages();
    const seen = new Map();
    packages.forEach((p) => {
        if (p.category && !seen.has(p.category)) {
            seen.set(p.category, {
                id: p.category,
                name: p.category,
                image: null,
            });
        }
    });
    return Array.from(seen.values());
}

// ── Customers ─────────────────────────────────────────────────────────────────

export async function getCustomers() {
    return apiFetch("/customers/all/");
}

export async function getCustomer(id) {
    return apiFetch(`/customers/${id}/`);
}

export async function createCustomer(data) {
    return apiFetch("/customers/", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function updateCustomer(id, data) {
    return apiFetch(`/customers/${id}/`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function deleteCustomers(ids) {
    return apiFetch("/customers/bulk-delete/", {
        method: "POST",
        body: JSON.stringify({ ids }),
    });
}

// ── Bookings ──────────────────────────────────────────────────────────────────

export async function getBookings(statusFilter = null) {
    const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
    return apiFetch(`/bookings/${q}`);
}

export async function getCustomerBookings(customerId) {
    return apiFetch(`/customers/${customerId}/bookings/`);
}

export async function createBooking(customerId, data) {
    return apiFetch(`/customers/${customerId}/bookings/`, {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function updateBookingStatus(bookingId, sessionStatus) {
    return apiFetch(`/bookings/${bookingId}/status/`, {
        method: "PATCH",
        body: JSON.stringify({ session_status: sessionStatus }),
    });
}

// ── Recommendations ───────────────────────────────────────────────────────────

export async function getRecommendations(customerId, targetDate = null, k = 3) {
    const params = new URLSearchParams({ k: String(k) });
    if (targetDate) params.append("date", targetDate);
    return apiFetch(`/recommendations/${customerId}/?${params.toString()}`);
}

/**
 * Refresh popular recommendations by re-querying booking counts.
 * The Django recommender service recomputes on every request, so this
 * effectively "warms" the cache / triggers any server-side recompute.
 *
 * For a dedicated refresh endpoint, update this URL to match yours.
 */
export async function refreshRecommender() {
    // Hit the recommendations endpoint to force recompute.
    // If you add a dedicated Django management command or view like
    // POST /api/recommendations/refresh/, swap this to that.
    try {
        const customers = await getCustomers();
        if (customers.length > 0) {
            await getRecommendations(customers[0].id);
        }
        return {
            success: true,
            message: "Recommender refreshed from latest booking data.",
        };
    } catch (err) {
        return { success: false, message: err.message };
    }
}
