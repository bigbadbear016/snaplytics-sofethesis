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

document.addEventListener("DOMContentLoaded", function () {
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

    var q = new URLSearchParams(window.location.search).get("page");
    if (q) {
        staffShellNav(q);
    }
});
