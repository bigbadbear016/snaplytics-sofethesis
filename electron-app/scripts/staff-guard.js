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
    const page = path.split("/").pop() || "";
    const shellOwnedPages = new Set([
        "dashboard.html",
        "customers.html",
        "customer-details.html",
        "packages.html",
        "packages-list.html",
        "coupons.html",
        "action-logs.html",
        "recycle-bin.html",
        "profile.html",
        "manage-accounts.html",
    ]);
    const inEmbedMode =
        new URLSearchParams(window.location.search).get("embed") === "1" ||
        window.self !== window.top;

    if (!authToken) {
        window.location.href = "../../index.html";
        return;
    }

    if (needsSetup && !onOnboarding) {
        window.location.href = "./onboarding.html";
        return;
    }

    if (!needsSetup && onOnboarding) {
        window.location.href = "./shell.html";
        return;
    }

    // Keep a single consistent entry point: render staff pages via shell sidebar.
    if (!needsSetup && !inEmbedMode && page !== "shell.html" && shellOwnedPages.has(page)) {
        const currentParams = new URLSearchParams(window.location.search);
        currentParams.delete("embed");
        const pageWithQuery = currentParams.toString()
            ? `${page}?${currentParams.toString()}`
            : page;
        window.location.href = `./shell.html?page=${encodeURIComponent(pageWithQuery)}`;
    }
})();

// Sidebar role gating for all staff/admin pages (shell and standalone pages).
(function staffSidebarRoleGate() {
    function getCurrentRole() {
        if (window.staffAuth && typeof window.staffAuth.getRole === "function") {
            return window.staffAuth.getRole();
        }
        try {
            const user = JSON.parse(sessionStorage.getItem("user") || "{}");
            return String(user.role || "").toUpperCase();
        } catch (_) {
            return "";
        }
    }

    function canSeeActionLogs(role) {
        if (window.staffAuth && typeof window.staffAuth.canSeeActionLogs === "function") {
            return window.staffAuth.canSeeActionLogs(role);
        }
        return role === "ADMIN" || role === "OWNER";
    }

    function canCreateStaff(role) {
        if (window.staffAuth && typeof window.staffAuth.canCreateStaff === "function") {
            return window.staffAuth.canCreateStaff(role);
        }
        return role === "ADMIN" || role === "OWNER";
    }

    function canManageAccounts(role) {
        if (window.staffAuth && typeof window.staffAuth.canManageAccounts === "function") {
            return window.staffAuth.canManageAccounts(role);
        }
        return role === "ADMIN" || role === "OWNER";
    }

    function canSeeRecycleBin(role) {
        if (window.staffAuth && typeof window.staffAuth.canSeeRecycleBin === "function") {
            return window.staffAuth.canSeeRecycleBin(role);
        }
        return role === "ADMIN" || role === "OWNER";
    }

    function applySidebarRoleVisibility() {
        const role = getCurrentRole();
        const allowActionLogs = canSeeActionLogs(role);
        const allowRecycleBin = canSeeRecycleBin(role);
        const allowCreateStaff = canCreateStaff(role);
        const allowManageAccounts = canManageAccounts(role);

        const actionNav = document.getElementById("nav-action-logs");
        const recycleNav = document.getElementById("nav-recycle-bin");
        const createStaffNav = document.getElementById("nav-create-staff");
        const manageAccountsNav = document.getElementById("nav-manage-accounts");

        if (actionNav) {
            if (!allowActionLogs) {
                actionNav.remove();
            } else {
                actionNav.classList.remove("hidden");
            }
        }
        if (recycleNav) {
            if (!allowRecycleBin) {
                recycleNav.remove();
            } else {
                recycleNav.classList.remove("hidden");
            }
        }
        if (createStaffNav) {
            if (!allowCreateStaff) {
                createStaffNav.remove();
            } else {
                createStaffNav.classList.remove("hidden");
            }
        }
        if (manageAccountsNav) {
            if (!allowManageAccounts) {
                manageAccountsNav.remove();
            } else {
                manageAccountsNav.classList.remove("hidden");
            }
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", applySidebarRoleVisibility);
    } else {
        applySidebarRoleVisibility();
    }
})();

// Collapsible staff sidebar (desktop): toggle + localStorage; no-op if no #sidebar or embed mode.
(function staffSidebarCollapse() {
    const LS_KEY = "heigen_sidebar_collapsed_v1";
    const mq = window.matchMedia("(min-width: 1026px)");

    function isEmbed() {
        return document.documentElement.classList.contains("staff-embed");
    }

    function apply(collapsed) {
        document.documentElement.classList.toggle("sidebar-collapsed", collapsed);
        const sidebar = document.getElementById("sidebar");
        if (sidebar) sidebar.classList.toggle("sidebar-collapsed", collapsed);
        const btn = document.getElementById("sidebarCollapseToggle");
        if (btn) {
            btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
            btn.setAttribute(
                "aria-label",
                collapsed ? "Expand sidebar" : "Collapse sidebar",
            );
        }
    }

    function syncNavTitles() {
        document.querySelectorAll("#sidebar .sidebar-nav-item").forEach((a) => {
            if (a.getAttribute("title")) return;
            const parts = [];
            a.childNodes.forEach((n) => {
                if (n.nodeType === Node.TEXT_NODE) {
                    const t = (n.textContent || "").trim();
                    if (t) parts.push(t);
                }
            });
            if (parts.length) a.setAttribute("title", parts.join(" "));
        });
    }

    function init() {
        if (isEmbed()) return;
        const sidebar = document.getElementById("sidebar");
        if (!sidebar) return;

        syncNavTitles();

        const COLLAPSE_SVG =
            '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M12.367 20.0667L5.83366 13.5333L12.367 7M22.167 20.0667L15.6337 13.5333L22.167 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        let btn = document.getElementById("sidebarCollapseToggle");
        if (!btn) {
            btn = document.createElement("button");
            btn.id = "sidebarCollapseToggle";
            btn.type = "button";
            btn.className = "sidebar-collapse-toggle";
            btn.innerHTML = COLLAPSE_SVG;
        } else if (!btn.querySelector("svg")) {
            btn.innerHTML = COLLAPSE_SVG;
        }
        sidebar.appendChild(btn);

        let collapsed = false;
        try {
            collapsed = localStorage.getItem(LS_KEY) === "1";
        } catch (_) {}
        apply(collapsed);

        btn.addEventListener("click", () => {
            collapsed = !document.documentElement.classList.contains(
                "sidebar-collapsed",
            );
            apply(collapsed);
            try {
                localStorage.setItem(LS_KEY, collapsed ? "1" : "0");
            } catch (_) {}
        });

        const onMq = () => {
            if (!mq.matches) {
                document.documentElement.classList.remove("sidebar-collapsed");
                sidebar.classList.remove("sidebar-collapsed");
            } else {
                try {
                    collapsed = localStorage.getItem(LS_KEY) === "1";
                } catch (_) {
                    collapsed = false;
                }
                apply(collapsed);
            }
        };
        mq.addEventListener("change", onMq);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
