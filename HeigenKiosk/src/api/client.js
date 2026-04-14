// src/api/client.js
import { API_BASE_URL } from '../constants/api';
import { resolveCategoryImage } from '../constants/assets';

const API_TIMEOUT_MS = 12000;

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function apiRequest(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const { signal, clear } = createTimeoutSignal(API_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
      signal,
    });
  } catch (err) {
    clear();
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out. Check server/network then retry.');
    }
    throw new Error('Network request failed. Check API URL/server connection.');
  } finally {
    clear();
  }

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
export async function fetchAllPages(path) {
  const first = await apiRequest(path);

  // Flat array — pagination disabled on this viewset (pagination_class = None)
  if (Array.isArray(first)) return first;

  // Paginated envelope — follow all pages
  if (first && Array.isArray(first.results)) {
    let items = [...first.results];
    let nextUrl = first.next;
    const seenNextUrls = new Set();
    let pages = 1;
    const MAX_PAGES = 100;
    while (nextUrl) {
      if (seenNextUrls.has(nextUrl)) break;
      if (pages >= MAX_PAGES) break;
      seenNextUrls.add(nextUrl);
      const page = await apiRequest(nextUrl);
      if (Array.isArray(page)) { items = items.concat(page); break; }
      if (page && Array.isArray(page.results)) items = items.concat(page.results);
      nextUrl = page ? page.next : null;
      pages += 1;
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

// ─── Kiosk bootstrap (session cache; one parallel load at startup) ───────────

const _kioskBootstrapCache = {
  snapshot: null,
  inflight: null,
};

const BOOTSTRAP_TIMEOUT_MS = 90000;

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function bookingPackageId(b) {
  if (!b || typeof b !== 'object') return null;
  if (b.package_id != null) return Number(b.package_id);
  if (b.package?.id != null) return Number(b.package.id);
  return null;
}

async function fetchKioskBootstrapData() {
  const [packages, addons] = await Promise.all([
    fetchAllPages('/packages/'),
    fetchAllPages('/addons/'),
  ]);

  let categories;
  try {
    // Prefer direct categories endpoint to avoid an extra packages round-trip.
    const rawCategories = await withTimeout(
      fetchAllPages('/categories/'),
      4000,
      'Categories endpoint is slow; using package-derived categories.',
    );
    categories = (rawCategories || []).map((category) => ({
      ...category,
      image: resolveCategoryImage(category),
    }));
  } catch (_) {
    // Fallback: derive categories from package category strings.
    const seen = new Map();
    packages.forEach((pkg) => {
      if (!pkg?.category || seen.has(pkg.category)) return;
      const category = { id: pkg.category, name: pkg.category, image: null };
      seen.set(pkg.category, {
        ...category,
        image: resolveCategoryImage(category),
      });
    });
    categories = Array.from(seen.values());
  }

  // Do not prefetch bookings at startup; this significantly delays first render.
  const bookings = [];

  return { categories, packages, addons, bookings };
}

/**
 * Loads categories, packages, addons, and bookings once (parallel).
 * Deduplicates concurrent callers (e.g. React Strict Mode).
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
  const p = withTimeout(
    fetchKioskBootstrapData(),
    BOOTSTRAP_TIMEOUT_MS,
    'Loading studio data timed out. Check API connectivity and retry.',
  )
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

export function invalidateKioskBootstrapCache() {
  _kioskBootstrapCache.snapshot = null;
  _kioskBootstrapCache.inflight = null;
}

export function snapshotPackagesForCategory(snapshot, categoryName) {
  const packages = snapshot?.packages || [];
  if (!categoryName) return packages;
  const lower = String(categoryName).toLowerCase();
  return packages.filter(
    (p) => p.category && String(p.category).toLowerCase() === lower,
  );
}

export function snapshotPopularPackage(snapshot, categoryName) {
  try {
    const bookings = snapshot?.bookings || [];
    const countMap = {};
    bookings.forEach((b) => {
      const pid = bookingPackageId(b);
      if (pid == null) return;
      countMap[pid] = (countMap[pid] || 0) + 1;
    });
    const packages = snapshotPackagesForCategory(snapshot, categoryName);
    const pkgIds = new Set(packages.map((p) => p.id));
    let topId = null;
    let topCount = 0;
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

export function snapshotAddonsForCategory(snapshot, categoryName) {
  const addons = snapshot?.addons || [];
  if (!categoryName) return addons;
  const lower = String(categoryName).toLowerCase();
  return addons.filter((a) => {
    if (!a.applies_to) return true;
    const applies = Array.isArray(a.applies_to)
      ? a.applies_to.join(',')
      : String(a.applies_to);
    return applies.toLowerCase().includes(lower) || applies === '*';
  });
}

export function snapshotPopularAddons(snapshot, categoryName) {
  try {
    const scopedAddons = snapshotAddonsForCategory(snapshot, categoryName);
    const allowedAddonIds = new Set(scopedAddons.map((a) => Number(a.id)));
    const bookings = snapshot?.bookings || [];
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

/**
 * Approximates GET /recommendations/popular/ using cached bookings + catalog
 * (avoids an extra API round-trip for new customers).
 */
export function buildClientPopularRecommendations(snapshot, k = 3) {
  const packages = snapshot?.packages || [];
  const addons = snapshot?.addons || [];
  const bookings = snapshot?.bookings || [];
  const pkgCounts = new Map();
  bookings.forEach((b) => {
    const pid = bookingPackageId(b);
    if (pid == null) return;
    pkgCounts.set(pid, (pkgCounts.get(pid) || 0) + 1);
  });
  const topPkgIds = [...pkgCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => id);

  const recommendations = topPkgIds
    .map((pid) => {
      const pkg = packages.find((p) => Number(p.id) === Number(pid));
      if (!pkg) return null;
      const cat = pkg.category;
      const scopedAddons = addons.filter((a) => {
        if (!a.applies_to) return true;
        const applies = Array.isArray(a.applies_to)
          ? a.applies_to.join(',')
          : String(a.applies_to);
        return (
          applies.toLowerCase().includes(String(cat || '').toLowerCase()) ||
          applies === '*'
        );
      });
      const addonCounts = new Map();
      bookings.forEach((b) => {
        if (bookingPackageId(b) !== Number(pid)) return;
        (b.addons || []).forEach((x) => {
          const aid = Number(x.addonId || x.id);
          if (!scopedAddons.some((s) => Number(s.id) === aid)) return;
          addonCounts.set(
            aid,
            (addonCounts.get(aid) || 0) + Number(x.quantity || 1),
          );
        });
      });
      const topAddonIds = [...addonCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id]) => id);
      const pickAddons =
        topAddonIds.length > 0
          ? topAddonIds
              .map((id) => addons.find((a) => Number(a.id) === id))
              .filter(Boolean)
          : scopedAddons.slice(0, 2);
      const basePrice = Number(pkg.promo_price || pkg.price || 0);
      const addonTotal = pickAddons.reduce(
        (s, a) => s + Number(a.price || 0),
        0,
      );
      return {
        package: pkg,
        addons: pickAddons,
        base_price: basePrice,
        total_price: round2(basePrice + addonTotal),
        score: pkgCounts.get(pid) || 0,
        source: 'popularity',
      };
    })
    .filter(Boolean);

  return {
    recommendations,
    count: recommendations.length,
    total_bookings: bookings.length,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
