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
    if (!document.documentElement.classList.contains("staff-embed")) return;

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
