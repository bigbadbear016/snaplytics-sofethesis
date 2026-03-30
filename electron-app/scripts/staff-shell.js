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
