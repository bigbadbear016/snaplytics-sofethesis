// scripts/staff-profile.js
// Load staff profile and update common UI elements across pages.

(function staffProfile() {
    if (typeof API === "undefined") return;
    if (typeof MOCK_MODE !== "undefined" && MOCK_MODE) return;

    const nameEls = document.querySelectorAll("[data-user-name]");
    const roleEls = document.querySelectorAll("[data-user-role]");
    const emailEls = document.querySelectorAll("[data-user-email]");
    const avatarEls = document.querySelectorAll("[data-user-avatar]");

    function getInitials(fullName) {
        if (!fullName) return "NE";
        const parts = fullName.trim().split(" ").filter(Boolean);
        const first = parts[0]?.[0] || "N";
        const last = parts.length > 1 ? parts[parts.length - 1][0] : "E";
        return `${first}${last}`.toUpperCase();
    }

    function buildFallbackAvatar(fullName) {
        const initials = getInitials(fullName);
        const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <rect width="100%" height="100%" fill="#E8F0F2"/>
  <text x="50%" y="54%" font-size="72" text-anchor="middle" fill="#165166" font-family="Segoe UI, sans-serif" dy=".1em">${initials}</text>
</svg>`;
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    function resolveRole(user) {
        if (!user || typeof user !== "object") return "STAFF";
        let r = user.role;
        if (!r) {
            try {
                const cached = JSON.parse(sessionStorage.getItem("user") || "{}");
                if (cached && cached.role) r = cached.role;
            } catch (_) {}
        }
        if (r) return String(r).toUpperCase();
        if (user.is_superuser) return "OWNER";
        if (user.is_staff) return "ADMIN";
        return "STAFF";
    }

    function applyProfile(user, profile) {
        const fullName =
            user?.name ||
            `${user?.first_name || ""} ${user?.last_name || ""}`.trim() ||
            user?.email ||
            "New User";
        const role = resolveRole(user);
        const email = user?.email || "";
        const photoUrl =
            profile?.profile_photo_url ||
            sessionStorage.getItem("profilePhotoUrl") ||
            "";

        nameEls.forEach((el) => (el.textContent = fullName));
        roleEls.forEach((el) => (el.textContent = role));
        emailEls.forEach((el) => (el.textContent = email));

        avatarEls.forEach((el) => {
            if (el.tagName.toLowerCase() === "img") {
                el.src = photoUrl || buildFallbackAvatar(fullName);
            }
        });
    }

    document.addEventListener("DOMContentLoaded", async () => {
        const token = sessionStorage.getItem("authToken");
        if (!token) return;

        const result = await API.getProfile();
        if (!result || !result.success) return;

        const user = result.user || {};
        const profile = result.profile || {};
        sessionStorage.setItem("user", JSON.stringify(user));
        if (profile.profile_photo_url) {
            sessionStorage.setItem("profilePhotoUrl", profile.profile_photo_url);
        }

        applyProfile(user, profile);
    });
})();
