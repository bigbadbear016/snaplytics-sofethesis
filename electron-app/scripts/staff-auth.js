// Shared auth/role helpers for staff admin pages.
(function initStaffAuth() {
    function getSessionUser() {
        try {
            return JSON.parse(sessionStorage.getItem("user") || "{}");
        } catch (_) {
            return {};
        }
    }

    function getRole() {
        var user = getSessionUser();
        return String((user && user.role) || "").toUpperCase();
    }

    function isAdminOrOwner(role) {
        var normalized = String(role || getRole()).toUpperCase();
        return normalized === "ADMIN" || normalized === "OWNER";
    }

    window.staffAuth = window.staffAuth || {
        getSessionUser: getSessionUser,
        getRole: getRole,
        isOwner: function () {
            return getRole() === "OWNER";
        },
        isAdminOrOwner: isAdminOrOwner,
        canSeeActionLogs: isAdminOrOwner,
        canSeeRecycleBin: isAdminOrOwner,
        canCreateStaff: isAdminOrOwner,
        canManageAccounts: isAdminOrOwner,
    };
})();
