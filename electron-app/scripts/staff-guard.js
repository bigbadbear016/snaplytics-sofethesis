// scripts/staff-guard.js
// Enforce onboarding flow for staff/admin pages.

(function staffGuard() {
    const path = window.location.pathname.toLowerCase();
    const isStaffAdmin = path.includes("/staff_admin/");
    if (!isStaffAdmin) return;

    if (typeof MOCK_MODE !== "undefined" && MOCK_MODE) return;

    const authToken = sessionStorage.getItem("authToken");
    const needsSetup =
        sessionStorage.getItem("needsProfileSetup") === "true";

    const onOnboarding =
        path.endsWith("/onboarding.html") || path.includes("/onboarding.html");

    if (!authToken) {
        return;
    }

    if (needsSetup && !onOnboarding) {
        window.location.href = "./onboarding.html";
        return;
    }

    if (!needsSetup && onOnboarding) {
        window.location.href = "./shell.html";
    }
})();
