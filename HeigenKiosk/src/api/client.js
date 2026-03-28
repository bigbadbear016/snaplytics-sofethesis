// src/api/client.js
import { API_BASE_URL } from '../constants/api';
import { resolveCategoryImage } from '../constants/assets';

async function apiRequest(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err.detail || JSON.stringify(err);
    } catch (_) {}
    throw new Error(detail);
  }

  if (response.status === 204) return null;
  return response.json();
}

/**
 * Unwrap a DRF response that may be either:
 *   - A flat array:           [...]
 *   - A paginated envelope:   { count, next, previous, results: [...] }
 *
 * Follows next-page links automatically so callers always get a complete list.
 */
async function fetchAllPages(path) {
  const first = await apiRequest(path);

  // Flat array — pagination disabled on this viewset (pagination_class = None)
  if (Array.isArray(first)) return first;

  // Paginated envelope — follow all pages
  if (first && Array.isArray(first.results)) {
    let items = [...first.results];
    let nextUrl = first.next;
    while (nextUrl) {
      const page = await apiRequest(nextUrl);
      if (Array.isArray(page)) { items = items.concat(page); break; }
      if (page && Array.isArray(page.results)) items = items.concat(page.results);
      nextUrl = page ? page.next : null;
    }
    return items;
  }

  // Fallback
  return Array.isArray(first) ? first : [];
}

// Packages
export async function fetchPackages(categoryName = null) {
  const data = await fetchAllPages('/packages/');
  if (!categoryName) return data;
  const lower = categoryName.toLowerCase();
  return data.filter((p) => p.category && p.category.toLowerCase() === lower);
}

export async function fetchCategories() {
  try {
    const categories = await fetchAllPages('/categories/');
    if (Array.isArray(categories) && categories.length) {
      return categories.map((category) => ({
        ...category,
        image: resolveCategoryImage(category),
      }));
    }
  } catch (_) {
    // Fallback to deriving categories from packages for older backend deployments.
  }

  const packages = await fetchAllPages('/packages/');
  const seen = new Map();
  packages.forEach((pkg) => {
    if (!pkg.category || seen.has(pkg.category)) return;
    const category = { id: pkg.category, name: pkg.category, image: null };
    seen.set(pkg.category, {
      ...category,
      image: resolveCategoryImage(category),
    });
  });
  return Array.from(seen.values());
}

// Addons
export async function fetchAddons(categoryName = null) {
  const data = await fetchAllPages('/addons/');
  if (!categoryName) return data;
  const lower = categoryName.toLowerCase();
  return data.filter((a) => {
    if (!a.applies_to) return true;
    const applies = Array.isArray(a.applies_to)
      ? a.applies_to.join(',')
      : String(a.applies_to);
    return applies.toLowerCase().includes(lower) || applies === '*';
  });
}

// Popular — uses /bookings/ which IS paginated, fetchAllPages handles it
export async function fetchPopularPackage(categoryName) {
  try {
    const bookings = await fetchAllPages('/bookings/');
    const countMap = {};
    bookings.forEach((b) => {
      if (!b.package_id) return;
      countMap[b.package_id] = (countMap[b.package_id] || 0) + 1;
    });
    const packages = await fetchPackages(categoryName);
    const pkgIds = new Set(packages.map((p) => p.id));
    let topId = null, topCount = 0;
    Object.entries(countMap).forEach(([id, count]) => {
      if (pkgIds.has(Number(id)) && count > topCount) {
        topCount = count;
        topId = Number(id);
      }
    });
    return { top_package_id: topId };
  } catch (_) {
    return { top_package_id: null };
  }
}

export async function fetchPopularAddons(categoryName) {
  try {
    const scopedAddons = await fetchAddons(categoryName);
    const allowedAddonIds = new Set(scopedAddons.map((a) => Number(a.id)));

    const bookings = await fetchAllPages('/bookings/');
    const countMap = {};
    bookings.forEach((b) => {
      (b.addons || []).forEach((a) => {
        const key = Number(a.addonId || a.id);
        if (!allowedAddonIds.has(key)) return;
        countMap[key] = (countMap[key] || 0) + (a.quantity || 1);
      });
    });
    const sorted = Object.entries(countMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => Number(id));
    return { top_addon_ids: sorted };
  } catch (_) {
    return { top_addon_ids: [] };
  }
}

// Customers
export async function findCustomerByEmail(email) {
  try {
    const trimmed = (email || '').trim().toLowerCase();
    if (!trimmed) return null;
    return await apiRequest(`/customers/by-email/?email=${encodeURIComponent(trimmed)}`);
  } catch (_) {
    return null;
  }
}

export async function createCustomer(data) {
  return apiRequest('/customers/', {
    method: 'POST',
    body: JSON.stringify({
      name:      data.full_name,
      email:     data.email,
      contactNo: data.contact_number,
      consent:   data.consent_given ? 'I Agree' : 'I Disagree',
    }),
  });
}

// Bookings
export async function submitBooking(payload) {
  let customer = await findCustomerByEmail(payload.customer.email);
  if (!customer) {
    customer = await createCustomer(payload.customer);
  }
  const customerId = customer.id || customer.customer_id;

  const addonsInput = (payload.addon_ids || []).map((id) => ({
    addonId: id,
    quantity: 1,
  }));

  const bookingData = {
    customer_id:    customerId,
    package_id:     payload.package_id,
    addons_input:   addonsInput,
    session_status: 'Pending',
    total_price:    payload.total_amount,
    session_date:   payload.preferred_date
      ? new Date(payload.preferred_date).toISOString()
      : null,
  };
  if (payload.coupon_id) {
    bookingData.coupon_id = payload.coupon_id;
  }

  const booking = await apiRequest(`/customers/${customerId}/bookings/`, {
    method: 'POST',
    body: JSON.stringify(bookingData),
  });

  return { customer, booking };
}

// Booking queue (admin) — paginated, fetchAllPages handles it
export async function fetchBookingsByStatus(statuses = 'Pending,Ongoing') {
  return fetchAllPages(`/bookings/?status=${encodeURIComponent(statuses)}`);
}

export async function updateBookingStatus(bookingId, sessionStatus) {
  return apiRequest(`/bookings/${bookingId}/status/`, {
    method: 'PATCH',
    body: JSON.stringify({ session_status: sessionStatus }),
  });
}

// Recommendations
export async function fetchRecommendations(customerId, targetDate = null, k = 3) {
  let url = `/recommendations/${customerId}/`;
  const params = new URLSearchParams({ k: String(k) });
  if (targetDate) params.append('date', targetDate);
  url += '?' + params.toString();
  return apiRequest(url);
}

export async function fetchPopularRecommendations(k = 3) {
  return apiRequest(`/recommendations/popular/?k=${encodeURIComponent(String(k))}`);
}

// Coupons
export async function fetchCustomerCoupons(customerId) {
  try {
    return await apiRequest(`/customers/${customerId}/coupons/`);
  } catch (_) {
    return [];
  }
}

export async function validateCoupon(code, customerId, subtotal) {
  const res = await apiRequest('/coupons/validate/', {
    method: 'POST',
    body: JSON.stringify({
      code: (code || '').trim(),
      customer_id: customerId,
      subtotal: Number(subtotal) || 0,
    }),
  });
  return res;
}
