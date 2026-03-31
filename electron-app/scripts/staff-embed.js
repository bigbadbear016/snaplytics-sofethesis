// When ?embed=1 (loaded inside admin shell iframe), hide duplicate sidebar and
// ensure logout exits the whole app, not only the frame.
(function () {
    try {
        var p = new URLSearchParams(window.location.search);
        if (p.get("embed") === "1" || window.self !== window.top) {
            document.documentElement.classList.add("staff-embed");
        }
    } catch (e) {}
})();

function removeEmbeddedLegacySidebar() {
    [
        "#sidebar",
        ".sidebar",
        "#mobileOverlay",
        ".mobile-overlay",
    ].forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        });
    });
}

function normalizeEmbeddedLayout() {
    [".main-content", ".main-container", ".app-container"].forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) {
            el.style.marginLeft = "0";
            el.style.left = "0";
            el.style.width = "100%";
            el.style.maxWidth = "100%";
        });
    });
}

function notifyShellSidebarActive() {
    if (window.self === window.top) return;
    var path = location.pathname || "";
    var page = path.split("/").pop() || "";
    if (!page) return;
    try {
        window.parent.postMessage(
            { type: "heigen-staff-nav", page: page },
            "*",
        );
    } catch (e) {}
}

window.addEventListener("load", notifyShellSidebarActive);

document.addEventListener("DOMContentLoaded", function () {
    // This script is only included by staff content pages (not shell.html).
    // Always remove local page sidebars so shell.html is the single sidebar source.
    if (!document.getElementById("staff-embed-hard-hide")) {
        var style = document.createElement("style");
        style.id = "staff-embed-hard-hide";
        style.textContent = `
            #sidebar, .sidebar, #mobileOverlay, .mobile-overlay {
                display: none !important;
                visibility: hidden !important;
                pointer-events: none !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    removeEmbeddedLegacySidebar();
    normalizeEmbeddedLayout();

    // Keep enforcing in case page scripts inject legacy sidebar after initial load.
    var observer = new MutationObserver(function () {
        removeEmbeddedLegacySidebar();
        normalizeEmbeddedLayout();
    });
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

    window.confirmLogout = async function confirmLogout() {
        if (typeof API !== "undefined" && API.logout) {
            try {
                await API.logout();
            } catch (e) {}
        }
        sessionStorage.removeItem("authToken");
        sessionStorage.removeItem("user");
        sessionStorage.removeItem("needsProfileSetup");
        sessionStorage.removeItem("profilePhotoUrl");
        var loginHref = new URL("../../index.html", window.location.href).href;
        try {
            if (window.top && window.top !== window.self) {
                window.top.location.href = loginHref;
                return;
            }
        } catch (err) {}
        window.location.href = loginHref;
    };
});
