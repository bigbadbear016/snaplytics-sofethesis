// src/constants/api.js
// ─── Change this to your Django server IP/hostname ────────────────────────────
// For Android emulator: use 10.0.2.2 instead of localhost
// For physical device: use your machine's local IP e.g. 192.168.1.x:8000
export const API_BASE_URL = "http://10.0.2.2:8000/api"; // Expo Go Android emulator
// export const API_BASE_URL = "http://192.168.1.53:8000/api";
// export const API_BASE_URL = "http://10.0.2.2:8000/api";

export const ENDPOINTS = {
    // Catalog
    PACKAGES: `${API_BASE_URL}/packages/`,
    ADDONS: `${API_BASE_URL}/addons/`,
    CATEGORIES: `${API_BASE_URL}/packages/`, // filtered by ?category=

    // Booking & Customers
    BOOKINGS: `${API_BASE_URL}/bookings/`,
    CUSTOMERS: `${API_BASE_URL}/customers/`,

    // Recommendations
    RECOMMENDATIONS: (customerId) =>
        `${API_BASE_URL}/recommendations/${customerId}/`,
};

// Booking status values that mirror the Django model
export const BOOKING_STATUS = {
    PENDING: "Pending",
    ONGOING: "Ongoing",
    DONE: "BOOKED",
    CANCELLED: "Cancelled",
};
