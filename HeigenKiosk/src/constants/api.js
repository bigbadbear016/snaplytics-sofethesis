// src/constants/api.js
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const DEFAULT_API_PORT = '8000';
const DEFAULT_API_PATH = '/api';

function normalizeBaseUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
}

function getExpoHost() {
    const hostUri =
        Constants.expoConfig?.hostUri ||
        Constants.manifest2?.extra?.expoClient?.hostUri ||
        Constants.manifest?.debuggerHost;

    if (!hostUri) return null;
    return hostUri.split(':')[0] || null;
}

function getDefaultHost() {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hostname) {
        return window.location.hostname;
    }

    if (Platform.OS === 'android') {
        // Works for Android emulator; physical devices should use EXPO_PUBLIC_API_HOST.
        return '10.0.2.2';
    }

    return '127.0.0.1';
}

const envBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
const envHost = process.env.EXPO_PUBLIC_API_HOST;
const envPort = process.env.EXPO_PUBLIC_API_PORT || DEFAULT_API_PORT;

const computedBaseUrl = envBaseUrl
    ? normalizeBaseUrl(envBaseUrl)
    : normalizeBaseUrl(`http://${envHost || getExpoHost() || getDefaultHost()}:${envPort}${DEFAULT_API_PATH}`);

export const API_BASE_URL = computedBaseUrl;

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
