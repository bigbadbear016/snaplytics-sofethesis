// scripts/heigen-api.js

// ============================================
// API Configuration
// ============================================
const API_URL = "http://localhost:8000/api";

// ============================================
// MOCK MODE TOGGLE
// Set to true to use fake data for testing
// Set to false to connect to real Django API
// ============================================
const MOCK_MODE = false;

// ============================================
// MOCK DATA
// ============================================
const MOCK_USERS = {
    "admin@heigen.com": {
        password: "admin123",
        user: {
            id: 1,
            name: "HANA BABILONIA",
            email: "admin@heigen.com",
            role: "ADMIN",
        },
    },
    "staff@heigen.com": {
        password: "staff123",
        user: {
            id: 2,
            name: "JOHN DOE",
            email: "staff@heigen.com",
            role: "STAFF",
        },
    },
    "test@heigen.com": {
        password: "test123",
        user: {
            id: 3,
            name: "TEST USER",
            email: "test@heigen.com",
            role: "STAFF",
        },
    },
};

const MOCK_CUSTOMERS = [
    {
        id: 1,
        name: "Maria Santos",
        email: "maria@email.com",
        contact: "0917-123-4567",
        consent: true,
        bookings: 3,
    },
    {
        id: 2,
        name: "Juan Dela Cruz",
        email: "juan@email.com",
        contact: "0918-234-5678",
        consent: false,
        bookings: 1,
    },
    {
        id: 3,
        name: "Ana Rodriguez",
        email: "ana@email.com",
        contact: "0919-345-6789",
        consent: true,
        bookings: 5,
    },
    {
        id: 4,
        name: "Pedro Martinez",
        email: "pedro@email.com",
        contact: "0920-456-7890",
        consent: true,
        bookings: 2,
    },
    {
        id: 5,
        name: "Lisa Garcia",
        email: "lisa@email.com",
        contact: "0921-567-8901",
        consent: false,
        bookings: 0,
    },
    {
        id: 6,
        name: "Carlos Reyes",
        email: "carlos@email.com",
        contact: "0922-678-9012",
        consent: true,
        bookings: 4,
    },
    {
        id: 7,
        name: "Sofia Cruz",
        email: "sofia@email.com",
        contact: "0923-789-0123",
        consent: true,
        bookings: 6,
    },
    {
        id: 8,
        name: "Miguel Ramos",
        email: "miguel@email.com",
        contact: "0924-890-1234",
        consent: false,
        bookings: 1,
    },
];

// ===============================
// MOCK CUSTOMERS + BOOKINGS
// ===============================
const CUSTOMERS = [
    {
        id: 1,
        name: "Sarah Johnson",
        email: "sarah.j@email.com",
        contact: "09123456789",
        consent: "Approved",
    },
    {
        id: 2,
        name: "John Carter",
        email: "john.c@email.com",
        contact: "09987654321",
        consent: "Pending",
    },
];

const CUSTOMER_BOOKINGS = {
    1: [
        {
            id: "#B001",
            date: "Nov 15, 2024",
            package: "Regular Self-Portrait",
            status: "Completed",
        },
        {
            id: "#B002",
            date: "Dec 02, 2024",
            package: "Deluxe Package",
            status: "Scheduled",
        },
    ],
    2: [],
};

function getCustomers() {
    return CUSTOMERS;
}

function getCustomerBookings(customerId) {
    return CUSTOMER_BOOKINGS[customerId] || [];
}

window.API = {
    ...window.API,
    getCustomers,
    getCustomerBookings,
};

const MOCK_PACKAGES = [
    {
        id: 1,
        name: "BASIC PACKAGE",
        description: "Perfect for small events and intimate gatherings",
        price: 5000,
        image: "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=400",
        category: "basic",
        inclusions: ["2 hours coverage", "50 edited photos", "1 photographer"],
    },
    {
        id: 2,
        name: "STANDARD PACKAGE",
        description: "Great for medium-sized celebrations",
        price: 10000,
        image: "https://images.unsplash.com/photo-1519741497674-611481863552?w=400",
        category: "standard",
        inclusions: [
            "4 hours coverage",
            "100 edited photos",
            "1 photographer",
            "Online gallery",
        ],
    },
    {
        id: 3,
        name: "PREMIUM PACKAGE",
        description: "Full service package for memorable events",
        price: 15000,
        image: "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=400",
        category: "premium",
        inclusions: [
            "6 hours coverage",
            "200 edited photos",
            "2 photographers",
            "Online gallery",
            "USB drive",
        ],
    },
    {
        id: 4,
        name: "DELUXE PACKAGE",
        description: "Ultimate experience with premium features",
        price: 25000,
        image: "https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=400",
        category: "deluxe",
        inclusions: [
            "8 hours coverage",
            "300 edited photos",
            "2 photographers",
            "Videographer",
            "Online gallery",
            "Premium USB",
            "Photo book",
        ],
    },
    {
        id: 5,
        name: "WEDDING BASIC",
        description: "Essential wedding photography package",
        price: 18000,
        image: "https://images.unsplash.com/photo-1606800052052-a08af7148866?w=400",
        category: "wedding",
        inclusions: [
            "Full day coverage",
            "250 edited photos",
            "2 photographers",
            "Engagement shoot",
        ],
    },
    {
        id: 6,
        name: "WEDDING PREMIUM",
        description: "Complete wedding documentation",
        price: 35000,
        image: "https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=400",
        category: "wedding",
        inclusions: [
            "Full day coverage",
            "500 edited photos",
            "3 photographers",
            "2 videographers",
            "Engagement shoot",
            "Same day edit",
            "Wedding album",
        ],
    },
];

const MOCK_ADDONS = [
    {
        id: 1,
        name: "EXTRA HOUR",
        description: "Additional shooting time",
        price: 2000,
        category: "time",
    },
    {
        id: 2,
        name: "PHOTO ALBUM",
        description: "Premium 12x12 photo album",
        price: 3500,
        category: "product",
    },
    {
        id: 3,
        name: "VIDEO PACKAGE",
        description: "Professional video editing with highlights",
        price: 8000,
        category: "video",
    },
    {
        id: 4,
        name: "DRONE SHOTS",
        description: "Aerial photography and videography",
        price: 5000,
        category: "special",
    },
    {
        id: 5,
        name: "PHOTO BOOTH",
        description: "3 hours unlimited prints",
        price: 6000,
        category: "entertainment",
    },
    {
        id: 6,
        name: "SAME DAY EDIT",
        description: "Video highlights on event day",
        price: 10000,
        category: "video",
    },
    {
        id: 7,
        name: "EXTRA PHOTOGRAPHER",
        description: "Additional photographer for 4 hours",
        price: 4000,
        category: "staff",
    },
    {
        id: 8,
        name: "RUSH EDITING",
        description: "Get photos within 1 week",
        price: 3000,
        category: "service",
    },
    {
        id: 9,
        name: "CANVAS PRINT",
        description: "24x36 canvas wall art",
        price: 2500,
        category: "product",
    },
];

const MOCK_DASHBOARD_STATS = {
    total_customers: 127,
    total_bookings: 45,
    revenue: 567000,
    popular_packages: [
        { package_id: 3, name: "PREMIUM PACKAGE", bookings: 15 },
        { package_id: 2, name: "STANDARD PACKAGE", bookings: 12 },
        { package_id: 6, name: "WEDDING PREMIUM", bookings: 8 },
    ],
};

const MOCK_RECOMMENDATIONS = {
    recommendations: [
        {
            package_id: 3,
            name: "PREMIUM PACKAGE",
            reason: "Most popular this month",
            image: "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=400",
        },
        {
            package_id: 6,
            name: "WEDDING PREMIUM",
            reason: "High customer satisfaction",
            image: "https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=400",
        },
    ],
};

// Mock delay to simulate network latency
const mockDelay = (ms = 500) =>
    new Promise((resolve) => setTimeout(resolve, ms));

const PROFILE_CACHE_KEY = "heigen_staff_profile_get_cache_v1";

function safeStorageRemove(key) {
    try {
        sessionStorage.removeItem(key);
    } catch (_) {}
}

function clearAuthSession() {
    safeStorageRemove("authToken");
    safeStorageRemove("user");
    safeStorageRemove(PROFILE_CACHE_KEY);
}

function getAuthToken() {
    return sessionStorage.getItem("authToken");
}

function buildJsonHeaders(token) {
    const headers = { "Content-Type": "application/json" };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
}

async function requestJson(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, options);
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (_) {
        return response.ok
            ? {}
            : { success: false, error: "Invalid server response." };
    }
}

// ============================================
// API CLIENT
// ============================================
const api = {
    // ========================================
    // AUTHENTICATION
    // ========================================

    /**
     * User Login
     * TODO: API CALL - User Authentication
     * Expected request: { email: string, password: string }
     * Expected response: { success: boolean, token: string, user: { id, name, email, role } }
     */
    async login(email, password) {
        if (MOCK_MODE) {
            // Mock login
            await mockDelay(800);

            const mockUser = MOCK_USERS[email];

            if (mockUser && mockUser.password === password) {
                const token = "mock_token_" + Date.now();
                sessionStorage.setItem("authToken", token);
                sessionStorage.setItem("user", JSON.stringify(mockUser.user));
                safeStorageRemove(PROFILE_CACHE_KEY);

                return {
                    success: true,
                    token: token,
                    user: mockUser.user,
                    needs_profile_setup: false,
                };
            } else {
                return {
                    success: false,
                    error: "Invalid email or password",
                };
            }
        }

        // Real API call
        try {
            const data = await requestJson("/auth/login/", {
                method: "POST",
                headers: buildJsonHeaders(),
                body: JSON.stringify({ email, password }),
            });

            if (data.success) {
                sessionStorage.setItem("authToken", data.token);
                sessionStorage.setItem("user", JSON.stringify(data.user));
                safeStorageRemove(PROFILE_CACHE_KEY);
            }

            return data;
        } catch (error) {
            console.error("Login error:", error);
            return { success: false, error: "Network error" };
        }
    },

    /**
     * User Registration
     * TODO: API CALL - User Registration
     * Expected request: { name: string, email: string, password: string }
     * Expected response: { success: boolean, message: string }
     */
    async signup(name, email, password) {
        if (MOCK_MODE) {
            await mockDelay(800);

            // Check if email already exists
            if (MOCK_USERS[email]) {
                return {
                    success: false,
                    error: "Email already registered",
                };
            }

            // Simulate successful registration
            return {
                success: true,
                message: "Account created successfully",
            };
        }

        // Real API call
        try {
            return await requestJson("/auth/signup/", {
                method: "POST",
                headers: buildJsonHeaders(),
                body: JSON.stringify({ name, email, password }),
            });
        } catch (error) {
            console.error("Signup error:", error);
            return { success: false, error: "Network error" };
        }
    },

    /**
     * Password Reset Request
     * TODO: API CALL - send temporary password via email
     * Expected request: { email: string }
     * Expected response: { success: boolean, message: string }
     */
    async resetPassword(email) {
        if (MOCK_MODE) {
            await mockDelay(800);

            // Check if email exists
            if (!MOCK_USERS[email]) {
                return {
                    success: false,
                    error: "Email not found",
                };
            }

            return {
                success: true,
                message: "Request submitted. A superuser must approve it before a temporary password is emailed.",
            };
        }

        // Real API call
        try {
            return await requestJson("/auth/reset-password/", {
                method: "POST",
                headers: buildJsonHeaders(),
                body: JSON.stringify({ email }),
            });
        } catch (error) {
            console.error("Reset password error:", error);
            return { success: false, error: "Network error" };
        }
    },

    /**
     * Fetch current user profile
     * Expected response: { success: boolean, user: {...}, profile: {...} }
     * @param {{ force?: boolean }} [options] force=true skips session cache (e.g. after profile edit).
     */
    async getProfile(options) {
        if (MOCK_MODE) {
            return {
                success: true,
                user: JSON.parse(sessionStorage.getItem("user") || "{}"),
                profile: {
                    must_change_password: false,
                    profile_completed: true,
                    profile_photo_url: null,
                },
            };
        }

        const force = options && options.force === true;
        if (!force) {
            try {
                const cached = sessionStorage.getItem(PROFILE_CACHE_KEY);
                if (cached) {
                    return JSON.parse(cached);
                }
            } catch (_) {}
        }

        try {
            const token = getAuthToken();
            const data = await requestJson("/auth/profile/", {
                method: "GET",
                headers: buildJsonHeaders(token),
            });
            if (data && data.success) {
                try {
                    sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data));
                } catch (_) {}
            }
            return data;
        } catch (error) {
            console.error("Get profile error:", error);
            return { success: false, error: "Network error" };
        }
    },

    /**
     * Update profile (name, photo, password)
     * Expected request: { first_name, last_name, profile_photo_url, new_password }
     * Expected response: { success: boolean, needs_profile_setup: boolean }
     */
    async updateProfile(payload) {
        if (MOCK_MODE) {
            return { success: true, needs_profile_setup: false };
        }

        try {
            const token = getAuthToken();
            safeStorageRemove(PROFILE_CACHE_KEY);
            const response = await fetch(`${API_URL}/auth/profile/`, {
                method: "PUT",
                headers: buildJsonHeaders(token),
                body: JSON.stringify(payload || {}),
            });
            const text = await response.text();
            try {
                return JSON.parse(text);
            } catch (parseError) {
                if (!response.ok) {
                    return {
                        success: false,
                        error: "Server error while updating profile.",
                    };
                }
                return { success: false, error: "Invalid server response." };
            }
        } catch (error) {
            console.error("Update profile error:", error);
            return { success: false, error: "Network error" };
        }
    },

    /**
     * User Logout
     * TODO: API CALL - User Logout
     */
    async logout() {
        if (MOCK_MODE) {
            await mockDelay(300);
            sessionStorage.removeItem("authToken");
            sessionStorage.removeItem("user");
            return { success: true };
        }

        // Real API call
        try {
            const token = getAuthToken();
            await fetch(`${API_URL}/auth/logout/`, {
                method: "POST",
                headers: buildJsonHeaders(token),
            });
            clearAuthSession();

            return { success: true };
        } catch (error) {
            console.error("Logout error:", error);
            clearAuthSession();
            return { success: true };
        }
    },

    // ========================================
    // CUSTOMERS
    // ========================================

    /**
     * Fetch Customers List
     * TODO: API CALL - Fetch Customers List
     * Expected response: { customers: [{ id, name, email, contact, consent, bookings }] }
     */
    async getCustomers(search = "", page = 1) {
        if (MOCK_MODE) {
            await mockDelay(500);

            let filtered = [...MOCK_CUSTOMERS];

            if (search) {
                filtered = MOCK_CUSTOMERS.filter(
                    (c) =>
                        c.name.toLowerCase().includes(search.toLowerCase()) ||
                        c.email.toLowerCase().includes(search.toLowerCase()) ||
                        c.contact.includes(search),
                );
            }

            return { customers: filtered, total_pages: 1, current_page: page };
        }

        // Real API call
        try {
            const token = sessionStorage.getItem("authToken");
            const response = await fetch(
                `${API_URL}/customers/?search=${search}&page=${page}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                },
            );
            return await response.json();
        } catch (error) {
            console.error("Fetch customers error:", error);
            return { customers: [] };
        }
    },

    /**
     * Fetch Customer Details
     * TODO: API CALL - Fetch Customer Details
     * Expected response: { id, name, email, contact, consent, bookings: [...], history: [...] }
     */
    async getCustomer(customerId) {
        if (MOCK_MODE) {
            await mockDelay(400);

            const customer = MOCK_CUSTOMERS.find((c) => c.id === customerId);

            if (customer) {
                return {
                    ...customer,
                    address: "123 Main St, Manila",
                    history: [
                        {
                            date: "2024-10-15",
                            package: "Premium Package",
                            amount: 15000,
                        },
                        {
                            date: "2024-08-20",
                            package: "Standard Package",
                            amount: 10000,
                        },
                    ],
                };
            }

            return null;
        }

        // Real API call
        try {
            const token = sessionStorage.getItem("authToken");
            const response = await fetch(
                `${API_URL}/customers/${customerId}/`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                },
            );
            return await response.json();
        } catch (error) {
            console.error("Fetch customer error:", error);
            return null;
        }
    },

    /**
     * Add/Update Customer
     * TODO: API CALL - Add/Update Customer
     * Expected request: { name, email, contact, consent }
     * Expected response: { success: boolean, customer: {...} }
     */
    async saveCustomer(customerData, customerId = null) {
        if (MOCK_MODE) {
            await mockDelay(600);

            if (customerId) {
                // Update existing customer
                return {
                    success: true,
                    customer: { id: customerId, ...customerData },
                    message: "Customer updated successfully",
                };
            } else {
                // Create new customer
                return {
                    success: true,
                    customer: { id: Date.now(), ...customerData },
                    message: "Customer created successfully",
                };
            }
        }

        // Real API call
        try {
            const token = sessionStorage.getItem("authToken");
            const url = customerId
                ? `${API_URL}/customers/${customerId}/`
                : `${API_URL}/customers/`;

            const response = await fetch(url, {
                method: customerId ? "PUT" : "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(customerData),
            });
            return await response.json();
        } catch (error) {
            console.error("Save customer error:", error);
            return { success: false, error: "Network error" };
        }
    },

    /**
     * Delete Customer
     * TODO: API CALL - Delete Customer
     * Expected response: { success: boolean, message: string }
     */
    async deleteCustomer(customerId) {
        if (MOCK_MODE) {
            await mockDelay(400);

            return {
                success: true,
                message: "Customer deleted successfully",
            };
        }

        // Real API call
        try {
            const token = sessionStorage.getItem("authToken");
            const response = await fetch(
                `${API_URL}/customers/${customerId}/`,
                {
                    method: "DELETE",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                },
            );
            return await response.json();
        } catch (error) {
            console.error("Delete customer error:", error);
            return { success: false, error: "Network error" };
        }
    },

    // ========================================
    // PACKAGES
    // ========================================

    /**
     * Fetch Packages List
     * TODO: API CALL - Fetch Packages List
     * Expected response: { packages: [{ id, name, description, price, images: [...], category }] }
     */
    async getPackages(search = "", category = "") {
        if (MOCK_MODE) {
            await mockDelay(500);

            let filtered = [...MOCK_PACKAGES];

            if (search) {
                filtered = filtered.filter(
                    (p) =>
                        p.name.toLowerCase().includes(search.toLowerCase()) ||
                        p.description
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                );
            }

            if (category) {
                filtered = filtered.filter((p) => p.category === category);
            }

            return { packages: filtered };
        }

        // Real API call
        try {
            const token = sessionStorage.getItem("authToken");
            const response = await fetch(
                `${API_URL}/packages/?search=${search}&category=${category}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                },
            );
            return await response.json();
        } catch (error) {
            console.error("Fetch packages error:", error);
            return { packages: [] };
        }
    },

    /**
     * Fetch Package Details
     * TODO: API CALL - Fetch Package Details
     * Expected response: { id, name, description, price, images: [...], inclusions: [...], category }
     */
    async getPackage(packageId) {
        if (MOCK_MODE) {
            await mockDelay(400);

            const pkg = MOCK_PACKAGES.find((p) => p.id === packageId);
            return pkg || null;
        }

        // Real API call
        try {
            const token = sessionStorage.getItem("authToken");
            const response = await fetch(`${API_URL}/packages/${packageId}/`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            });
            return await response.json();
        } catch (error) {
            console.error("Fetch package error:", error);
            return null;
        }
    },

    // ========================================
    // ADDONS
    // ========================================

    /**
     * Fetch Addons List
     * TODO: API CALL - Fetch Addons List
     * Expected response: { addons: [{ id, name, description, price, category }] }
     */
    async getAddons(search = "") {
        if (MOCK_MODE) {
            await mockDelay(500);

            let filtered = [...MOCK_ADDONS];

            if (search) {
                filtered = filtered.filter(
                    (a) =>
                        a.name.toLowerCase().includes(search.toLowerCase()) ||
                        a.description
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                );
            }

            return { addons: filtered };
        }

        // Real API call
        try {
            const token = sessionStorage.getItem("authToken");
            const response = await fetch(
                `${API_URL}/addons/?search=${search}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                },
            );
            return await response.json();
        } catch (error) {
            console.error("Fetch addons error:", error);
            return { addons: [] };
        }
    },

    // ========================================
    // DASHBOARD
    // ========================================

    /**
     * Fetch Dashboard Stats
     * TODO: API CALL - Fetch Dashboard Stats
     * Expected response: { total_customers, total_bookings, revenue, popular_packages: [...] }
     */
    async getDashboardStats() {
        if (MOCK_MODE) {
            await mockDelay(600);
            return MOCK_DASHBOARD_STATS;
        }

        // Real API call
        try {
            const token = sessionStorage.getItem("authToken");
            const response = await fetch(`${API_URL}/dashboard/stats/`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            });
            return await response.json();
        } catch (error) {
            console.error("Fetch dashboard stats error:", error);
            return {
                total_customers: 0,
                total_bookings: 0,
                revenue: 0,
                popular_packages: [],
            };
        }
    },

    /**
     * Fetch Package Recommendations
     * TODO: API CALL - Fetch Package Recommendations
     * Expected response: { recommendations: [{ package_id, name, reason, image }] }
     */
    async getRecommendations() {
        if (MOCK_MODE) {
            await mockDelay(500);
            return MOCK_RECOMMENDATIONS;
        }

        // Real API call
        try {
            const token = sessionStorage.getItem("authToken");
            const response = await fetch(
                `${API_URL}/dashboard/recommendations/`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                },
            );
            return await response.json();
        } catch (error) {
            console.error("Fetch recommendations error:", error);
            return { recommendations: [] };
        }
    },
};

// ============================================
// EXPOSE API CLIENT (CONNECTS TO heigen-app.js)
// ============================================
window.API = api;
