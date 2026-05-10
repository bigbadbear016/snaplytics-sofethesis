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

    /** True only when StaffProfile.dev_mode — matches backend purge / permanent-delete gates. */
    function canPurgeInternalRecords() {
        var user = getSessionUser();
        return !!(user && user.dev_mode);
    }

    window.staffAuth = window.staffAuth || {
        getSessionUser: getSessionUser,
        getRole: getRole,
        isOwner: function () {
            var user = getSessionUser();
            return getRole() === "OWNER" || !!(user && user.dev_mode);
        },
        isAdminOrOwner: isAdminOrOwner,
        canSeeActionLogs: isAdminOrOwner,
        canSeeRecycleBin: isAdminOrOwner,
        canCreateStaff: isAdminOrOwner,
        canManageAccounts: isAdminOrOwner,
        canPurgeInternalRecords: canPurgeInternalRecords,
    };
})();
