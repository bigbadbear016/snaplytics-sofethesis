// Admin shell: sidebar stays mounted; staff pages load in iframe with ?embed=1

function toggleMobileSidebar(show) {
    var sidebar = document.getElementById("sidebar");
    var overlay = document.getElementById("mobileOverlay");
    if (!sidebar || !overlay) return;
    if (show) {
        sidebar.classList.add("mobile-open");
        overlay.classList.add("show");
    } else {
        sidebar.classList.remove("mobile-open");
        overlay.classList.remove("show");
    }
}
window.toggleMobileSidebar = toggleMobileSidebar;

function staffShellNav(page) {
    var f = document.getElementById("staffFrame");
    if (!f) return;
    var clean = (page || "").replace(/^\.\//, "");
    if (!clean) return;
    var url =
        clean.indexOf("?") >= 0 ? clean + "&embed=1" : clean + "?embed=1";
    f.src = url;
    var base = clean.split("?")[0];
    document.querySelectorAll("#sidebar .sidebar-nav-item").forEach(function (el) {
        var nav = el.getAttribute("data-nav");
        el.classList.toggle("is-active", nav === base);
    });
    toggleMobileSidebar(false);
}

window.staffShellNav = staffShellNav;

function enforceIframeEmbedMode() {
    var frame = document.getElementById("staffFrame");
    if (!frame) return;
    try {
        var doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
        if (!doc) return;
        function stripLegacySidebar() {
            ["#sidebar", ".sidebar", "#mobileOverlay", ".mobile-overlay"].forEach(function (sel) {
                doc.querySelectorAll(sel).forEach(function (el) {
                    if (el && el.parentNode) el.parentNode.removeChild(el);
                });
            });
        }
        if (doc.documentElement) {
            doc.documentElement.classList.add("staff-embed");
        }
        if (doc.body) {
            doc.body.classList.add("staff-embed");
        }
        if (!doc.getElementById("staff-shell-embed-force-style")) {
            var style = doc.createElement("style");
            style.id = "staff-shell-embed-force-style";
            style.textContent = `
                .sidebar, #sidebar { display: none !important; }
                .mobile-overlay, #mobileOverlay { display: none !important; }
                .main-content, .main-container, .shell-frame-wrap {
                    margin-left: 0 !important;
                    left: 0 !important;
                    width: 100% !important;
                    max-width: 100% !important;
                }
                .header {
                    left: 0 !important;
                    width: 100% !important;
                }
            `;
            (doc.head || doc.documentElement).appendChild(style);
        }
        stripLegacySidebar();
        if (!doc.__heigenEmbedObserver) {
            doc.__heigenEmbedObserver = new MutationObserver(function () {
                stripLegacySidebar();
            });
            doc.__heigenEmbedObserver.observe(doc.documentElement, {
                childList: true,
                subtree: true,
            });
        }
    } catch (e) {
        // Ignore cross-origin/temporary access errors while frame is navigating.
    }
}

function openKioskFromShell() {
    openShellKioskModal();
}

window.openKioskFromShell = openKioskFromShell;

var KIOSK_URL = localStorage.getItem("kioskWebUrl") || "http://localhost:8081";
var HEALTH_CHECK_TIMEOUT_MS = 3500;

function setShellKioskStatus(online) {
    var dot = document.getElementById("shellKioskStatusDot");
    var text = document.getElementById("shellKioskStatusText");
    var frame = document.getElementById("shellKioskFrame");
    var fallback = document.getElementById("shellKioskFallback");
    if (!dot || !text || !frame || !fallback) return;

    dot.classList.remove("bg-gray-300", "bg-green-500", "bg-red-500");
    dot.classList.add(online ? "bg-green-500" : "bg-red-500");
    text.textContent = online ? "Kiosk online" : "Kiosk offline";
    frame.style.display = online ? "block" : "none";
    fallback.classList.toggle("hidden", online);
}

async function isShellKioskReachable() {
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
        controller.abort();
    }, HEALTH_CHECK_TIMEOUT_MS);
    try {
        await fetch(KIOSK_URL, {
            method: "GET",
            mode: "no-cors",
            cache: "no-store",
            signal: controller.signal,
        });
        return true;
    } catch (e) {
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function loadShellKiosk() {
    var statusText = document.getElementById("shellKioskStatusText");
    var frame = document.getElementById("shellKioskFrame");
    var urlText = document.getElementById("shellKioskUrlText");
    if (urlText) urlText.textContent = KIOSK_URL;
    if (statusText) statusText.textContent = "Checking kiosk server...";
    if (frame) frame.src = "about:blank";

    var online = await isShellKioskReachable();
    if (!online) {
        setShellKioskStatus(false);
        return;
    }
    if (frame) frame.src = KIOSK_URL;
    setShellKioskStatus(true);
}

function openShellKioskModal() {
    var modal = document.getElementById("shellKioskModal");
    if (!modal) return;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    loadShellKiosk();
}

function closeShellKioskModal() {
    var modal = document.getElementById("shellKioskModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function reloadShellKiosk() {
    loadShellKiosk();
}

function openKioskInBrowserFromShell() {
    window.open(KIOSK_URL, "_blank");
}

window.openShellKioskModal = openShellKioskModal;
window.closeShellKioskModal = closeShellKioskModal;
window.reloadShellKiosk = reloadShellKiosk;
window.openKioskInBrowserFromShell = openKioskInBrowserFromShell;

function openShellLogoutModal(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var m = document.getElementById("shellLogoutModal");
    if (!m) return;
    m.classList.remove("hidden");
    m.classList.add("flex");
}

function closeShellLogoutModal() {
    var m = document.getElementById("shellLogoutModal");
    if (!m) return;
    m.classList.add("hidden");
    m.classList.remove("flex");
}

function confirmShellLogout() {
    closeShellLogoutModal();
    if (typeof API !== "undefined" && API.logout) {
        API.logout().catch(function () {});
    }
    sessionStorage.removeItem("authToken");
    sessionStorage.removeItem("user");
    sessionStorage.removeItem("needsProfileSetup");
    sessionStorage.removeItem("profilePhotoUrl");
    window.location.href = new URL("../../index.html", window.location.href).href;
}

window.openShellLogoutModal = openShellLogoutModal;
window.closeShellLogoutModal = closeShellLogoutModal;
window.confirmShellLogout = confirmShellLogout;

window.addEventListener("message", function (ev) {
    if (!ev.data || ev.data.type !== "heigen-staff-nav") return;
    var page = ev.data.page;
    if (!page) return;
    document.querySelectorAll("#sidebar .sidebar-nav-item").forEach(function (el) {
        var nav = el.getAttribute("data-nav");
        if (nav) el.classList.toggle("is-active", nav === page);
    });
});

function getCurrentShellRole() {
    try {
        var user = JSON.parse(sessionStorage.getItem("user") || "{}");
        return String(user.role || "").toUpperCase();
    } catch (e) {
        return "";
    }
}

function canSeeActionLogs(role) {
    var normalized = String(role || "").toUpperCase();
    return normalized === "ADMIN" || normalized === "OWNER";
}

function canCreateStaff(role) {
    var normalized = String(role || "").toUpperCase();
    return normalized === "ADMIN" || normalized === "OWNER";
}

document.addEventListener("DOMContentLoaded", function () {
    var frame = document.getElementById("staffFrame");
    if (frame) {
        frame.addEventListener("load", enforceIframeEmbedMode);
        // Also run once in case iframe is already loaded.
        setTimeout(enforceIframeEmbedMode, 0);
    }

    var overlay = document.getElementById("mobileOverlay");
    if (overlay) {
        overlay.addEventListener("click", function () {
            toggleMobileSidebar(false);
        });
    }

    document.querySelectorAll("#sidebar a[data-nav]").forEach(function (a) {
        a.addEventListener("click", function (e) {
            e.preventDefault();
            staffShellNav(a.getAttribute("data-nav"));
        });
    });

    var actionNav = document.getElementById("nav-action-logs");
    var createStaffNav = document.getElementById("nav-create-staff");
    var currentRole = getCurrentShellRole();
    var allowActionLogs = canSeeActionLogs(currentRole);
    var allowCreateStaff = canCreateStaff(currentRole);
    if (actionNav) {
        if (!allowActionLogs) {
            actionNav.remove();
        }
    }
    if (createStaffNav) {
        if (!allowCreateStaff) {
            createStaffNav.remove();
        }
    }

    var q = new URLSearchParams(window.location.search).get("page");
    if (q === "action-logs.html" && !allowActionLogs) {
        staffShellNav("dashboard.html");
    } else if (q === "signup.html" && !allowCreateStaff) {
        staffShellNav("dashboard.html");
    } else if (q) {
        staffShellNav(q);
    }
});
