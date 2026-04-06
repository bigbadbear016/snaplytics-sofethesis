// app.js
// ============================================================================
// APP STATE & DATA MANAGEMENT
// ============================================================================

// Load and inject CSS
(function loadCSS() {
    const xhr = new XMLHttpRequest();
    xhr.onload = function () {
        if (xhr.status === 200) {
            const style = document.createElement("style");
            style.textContent = xhr.responseText;
            document.head.appendChild(style);
        }
    };
    xhr.open("GET", "../../styles/styles.css");
    xhr.send();
})();

// ------------------ Utility Functions -----------------------------------------

// scripts/app.js
// Layout and navigation helpers only.
// All data logic has moved to api-client.js and the page-specific scripts.

function toggleMobileSidebar(show) {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("mobileOverlay");
    if (show) {
        sidebar.classList.add("mobile-open");
        overlay.classList.add("show");
    } else {
        sidebar.classList.remove("mobile-open");
        overlay.classList.remove("show");
    }
}

function navigateTo(path) {
    window.location.href = path;
}

async function openLogoutModal(e) {
    if (e && e.preventDefault) e.preventDefault();
    const runLogout = async () => {
        if (typeof window.confirmLogout === "function") {
            await Promise.resolve(window.confirmLogout());
        } else {
            window.location.href = "../../index.html";
        }
    };
    if (typeof window.heigenConfirm === "function") {
        const ok = await window.heigenConfirm("Are you sure you want to log out?", {
            title: "Log out",
            confirmText: "Log out",
            dangerous: false,
        });
        if (ok) await runLogout();
        return;
    }
    const modal = document.getElementById("logoutModal");
    if (!modal) {
        if (typeof window.confirm === "function" && window.confirm("Are you sure you want to log out?")) {
            await runLogout();
        }
        return;
    }
    modal.classList.remove("hidden");
    modal.classList.add("flex");
}

function closeLogoutModal() {
    const modal = document.getElementById("logoutModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function confirmLogout() {
    window.location.href = "../../index.html";
}

// Date filtering utility
function isDateInRange(dateToCheck, filterType) {
    if (!dateToCheck || !filterType) return true;

    const checkDate = new Date(dateToCheck);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    switch (filterType) {
        case "Today":
            const todayEnd = new Date(today);
            todayEnd.setHours(23, 59, 59, 999);
            return checkDate >= today && checkDate <= todayEnd;
        case "Last 7 Days":
            const sevenDaysAgo = new Date(today);
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            return checkDate >= sevenDaysAgo;
        case "Last 30 Days":
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            return checkDate >= thirtyDaysAgo;
        case "This year":
            const thisYearStart = new Date(today.getFullYear(), 0, 1);
            return checkDate >= thisYearStart;
        default:
            return true;
    }
}

// Filtering and sorting utility for customer list
function getFilteredAndSortedCustomers(
    customers,
    searchTerm,
    selectedModified,
    selectedSort,
) {
    // Filter by search term
    let filtered = customers;
    if (searchTerm.trim()) {
        const lowerSearchTerm = searchTerm.toLowerCase();
        filtered = customers.filter(
            (customer) =>
                customer.name.toLowerCase().includes(lowerSearchTerm) ||
                customer.email.toLowerCase().includes(lowerSearchTerm) ||
                customer.contactNo.toLowerCase().includes(lowerSearchTerm),
        );
    }

    // Filter by date range
    if (selectedModified) {
        filtered = filtered.filter((customer) =>
            isDateInRange(customer.updatedAt, selectedModified),
        );
    }

    // Sort
    const sorted = [...filtered];
    switch (selectedSort) {
        case "name-asc":
            sorted.sort((a, b) => a.name.localeCompare(b.name));
            break;
        case "name-desc":
            sorted.sort((a, b) => b.name.localeCompare(a.name));
            break;
        case "bookings-asc":
            sorted.sort((a, b) => a.bookings.length - b.bookings.length);
            break;
        case "bookings-desc":
            sorted.sort((a, b) => b.bookings.length - a.bookings.length);
            break;
        case "id-asc":
            sorted.sort((a, b) => a.id - b.id);
            break;
        case "id-desc":
            sorted.sort((a, b) => b.id - a.id);
            break;
        default:
            sorted.sort((a, b) => a.id - b.id);
    }
    return sorted;
}

// Package options
const PACKAGE_OPTIONS = [
    { name: "Regular - Ecstasy - max 2", price: 249 },
    { name: "Regular - Delight - max 2", price: 299 },
    { name: "Regular - Allure - max 2", price: 499 },
    { name: "Regular - Adore - max 2", price: 699 },
    { name: "Regular - Treasure - max 5", price: 899 },
    { name: "Regular - Priceless - max 10", price: 1799 },
    { name: "Yearbook - A - max 2", price: 449 },
    { name: "Yearbook - B - max 2", price: 699 },
    { name: "Yearbook - C - max 5", price: 1499 },
    { name: "Graduation - Digital - max 1", price: 299 },
    { name: "Graduation - Bronze - max 1", price: 499 },
    { name: "Graduation - Silver - max 1", price: 699 },
    { name: "Graduation - Gold - max 1", price: 899 },
    { name: "Graduation - Platinum - max 1", price: 1999 },
    { name: "Graduation - Diamond - max 1", price: 2499 },
    { name: "Graduation - Diamond Prestige - max 1", price: 2999 },
    {
        name: "Christmas Package 2024 - Christmas Special Package A 2024 - max 3",
        price: 499,
    },
    {
        name: "Christmas Package 2024 - Christmas Special Package B 2024 - max 5",
        price: 799,
    },
    {
        name: "Christmas Package 2024 - Christmas Special Package C 2024 - max 10",
        price: 1299,
    },
    {
        name: "Christmas Package 2024 - Christmas Special Package 2024 - max 5",
        price: 699,
    },
    {
        name: "Valentines Package 2024 - Valentines Special Package - max 2",
        price: 599,
    },
    {
        name: "Valentines Package 2024 - Squad Valentines Special Package - max 4",
        price: 799,
    },
    {
        name: "Valentines Package 2024 - Family Valentines Special Package - max 8",
        price: 1299,
    },
    { name: "Christmas Package 2025 - Holly - max 2", price: 499 },
    { name: "Christmas Package 2025 - Mistie - max 5", price: 899 },
    { name: "Christmas Package 2025 - Evergreen - max 10", price: 1799 },
];

// Addon options
const ADDON_OPTIONS = [
    { name: "Regular - Additional Person", price: 100 },
    { name: "Regular - Additional 10 minutes", price: 100 },
    { name: "Regular - Additional Backdrop", price: 150 },
    { name: "Regular - Whole-Body Backdrop", price: 100 },
    { name: "Regular - Onesie Pajama rent (1 design) - per head", price: 80 },
    { name: "Regular - LARGE Birthday Balloons Number 0 to 9", price: 40 },
    { name: "Regular - All Soft Copies", price: 250 },
    { name: "Regular - Single Soft Copy", price: 10 },
    { name: "Regular - Additional Wallet Size (Hardcopy) - 4pcs", price: 50 },
    {
        name: "Regular - Additional A4 Size (Hardcopy) - No White Border & Logo",
        price: 110,
    },
    { name: "Regular - Additional A6 size (Hardcopy)", price: 35 },
    { name: "Regular - Additional Photo-Strip - 2pcs", price: 80 },
    {
        name: "Regular - Additional Instax-Mini Inspired (Hardcopy) - 10pcs",
        price: 150,
    },
    { name: "Regular - Whole Body Picture", price: 100 },
    { name: "Regular - Additional 4r Size (Hardcopy)", price: 35 },
    { name: "Regular - Spotlight", price: 200 },
    { name: "Regular - Yearbook Props", price: 300 },
    { name: "Regular - Yearbook Uniforms", price: 50 },
    { name: "Regular - RGB", price: 150 },
    { name: "Yearbook - Get all soft copies", price: 300 },
    { name: "Yearbook - 2 Photostrips", price: 100 },
    { name: "Yearbook - Add 10 minutes", price: 200 },
    { name: "Yearbook - Wallet Size - 4pcs", price: 50 },
    { name: "Yearbook - A6 size", price: 35 },
    { name: "Graduation - Additional 1 Edited Photo", price: 70 },
    { name: "Graduation - Barksde/Family Shots - per head", price: 100 },
    { name: "Graduation - Couple Shots", price: 200 },
    { name: "Graduation - 5x7 Print", price: 50 },
    { name: "Graduation - 8x10 Print", price: 100 },
    { name: "Graduation - 4x6 Print", price: 40 },
    { name: "Graduation - Wallet Size - 4pcs", price: 50 },
    {
        name: "Graduation - Glass Frame (Small 8x10 Photo) with Height",
        price: 600,
    },
    { name: "Christmas Package 2024 - A6 Hardcopy", price: 30 },
    { name: "Christmas Package 2024 - Photostrip", price: 60 },
    { name: "Christmas Package 2024 - A4 Hardcopy", price: 100 },
];

// Initialize app on page load
/**
document.addEventListener("DOMContentLoaded", function () {
    console.log(
        "App initialized with",
        window.appState.customers.length,
        "customers",
    );
});
*/
