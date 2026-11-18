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

/* ---------------------------------------------------------------------------
 * Page frames
 * Each visited page keeps its own <iframe>, so switching back is instant.
 * The visible frame always carries id="staffFrame" (other scripts rely on it).
 * A new page loads in a hidden frame while the current page stays on screen,
 * then fades in once ready: no white flash between pages.
 * ------------------------------------------------------------------------- */
var FRAME_CACHE_MAX = 6;
var FRAME_STALE_MS = 30 * 1000;
var shellFrames = {}; // key (e.g. "customers.html") -> { el, shownAt }
var shellNavToken = 0;

/* Page-level functions that reload a page's data without reloading the page.
 * Pages not listed fall back to a full reload when stale (read-only lists)
 * or are left alone (forms such as Profile). */
var FRAME_SOFT_REFRESH = {
    "dashboard.html": ["initCharts"],
    "customers.html": ["loadCustomers"],
    "coupons.html": ["loadCoupons"],
    "manage-accounts.html": ["loadManagedAccounts"],
    "packages.html": ["loadCategories"],
    "packages-list.html": ["initializeData"],
};
var FRAME_RELOAD_WHEN_STALE = {
    "action-logs.html": true,
    "recycle-bin.html": true,
};

function framePageOf(frame) {
    try {
        var p = frame.contentWindow && frame.contentWindow.location.pathname;
        if (p) return p.split("/").pop();
    } catch (e) {}
    try {
        return new URL(frame.getAttribute("src") || "", window.location.href).pathname.split("/").pop();
    } catch (e2) {
        return "";
    }
}

function activeStaffFrame() {
    return document.getElementById("staffFrame");
}

function setShellNavActive(base) {
    document.querySelectorAll("#sidebar .sidebar-nav-item").forEach(function (el) {
        var nav = el.getAttribute("data-nav");
        el.classList.toggle("is-active", nav === base);
    });
}

function setShellBusy(on) {
    var bar = document.querySelector(".hg-progress[data-shell-nav]");
    if (!bar) {
        bar = document.createElement("div");
        bar.className = "hg-progress";
        bar.setAttribute("data-shell-nav", "");
        bar.setAttribute("aria-hidden", "true");
        document.body.appendChild(bar);
    }
    bar.classList.toggle("is-active", !!on);
}

function showStaffFrame(frame) {
    var current = activeStaffFrame();
    if (current === frame) {
        frame.classList.remove("is-hidden");
        return;
    }
    if (current) {
        current.removeAttribute("id");
        current.classList.add("is-hidden");
    }
    frame.id = "staffFrame";
    frame.classList.add("is-entering");
    frame.classList.remove("is-hidden");
    // next frame: animate in (timer fallback: rAF pauses while the window is hidden/minimised)
    var settle = function () { frame.classList.remove("is-entering"); };
    requestAnimationFrame(function () { requestAnimationFrame(settle); });
    setTimeout(settle, 120);
    var key = frame.getAttribute("data-page-key");
    if (key && shellFrames[key]) shellFrames[key].shownAt = Date.now();
    if (typeof window.heigenSyncIframeTheme === "function") window.heigenSyncIframeTheme();
    if (typeof window.heigenShellOnFrameShown === "function") window.heigenShellOnFrameShown(frame);
    requestAnimationFrame(focusStaffIframeForScroll);
}

function evictOldFrames() {
    var keys = Object.keys(shellFrames);
    if (keys.length <= FRAME_CACHE_MAX) return;
    var active = activeStaffFrame();
    keys
        .filter(function (k) { return shellFrames[k].el !== active; })
        .sort(function (a, b) { return shellFrames[a].shownAt - shellFrames[b].shownAt; })
        .slice(0, keys.length - FRAME_CACHE_MAX)
        .forEach(function (k) {
            shellFrames[k].el.remove();
            delete shellFrames[k];
        });
}

function softRefreshFrame(frame, opts) {
    opts = opts || {};
    var page = framePageOf(frame);
    var win = frame.contentWindow;
    var fns = FRAME_SOFT_REFRESH[page] || [];
    for (var i = 0; i < fns.length; i += 1) {
        try {
            if (win && typeof win[fns[i]] === "function") {
                return Promise.resolve(win[fns[i]]());
            }
        } catch (e) {}
    }
    if (opts.force || FRAME_RELOAD_WHEN_STALE[page]) {
        return new Promise(function (resolve) {
            frame.addEventListener("load", function () { resolve(); }, { once: true });
            try {
                win.location.reload();
            } catch (e) {
                frame.src = frame.getAttribute("src");
            }
        });
    }
    return Promise.resolve();
}

/** Refresh the data on the visible page (used by the Refresh button). */
function staffShellRefreshActive() {
    var frame = activeStaffFrame();
    if (!frame) return Promise.resolve();
    return softRefreshFrame(frame, { force: true });
}
window.staffShellRefreshActive = staffShellRefreshActive;

function createStaffFrame(key) {
    var wrap = document.querySelector(".shell-frame-wrap");
    var f = document.createElement("iframe");
    f.className = "staff-app-iframe is-hidden";
    f.title = "Admin content";
    f.tabIndex = -1;
    if (key) f.setAttribute("data-page-key", key);
    wrap.appendChild(f);
    wireStaffFrame(f);
    return f;
}

function staffShellNav(page, opts) {
    opts = opts || {};
    var clean = (page || "").replace(/^\.\//, "");
    if (!clean || !document.querySelector(".shell-frame-wrap")) return;
    var url = clean.indexOf("?") >= 0 ? clean + "&embed=1" : clean + "?embed=1";
    var base = clean.split("?")[0];
    // Pages opened with parameters (e.g. a specific customer) are not cached
    var key = clean.indexOf("?") >= 0 ? "__transient" : base;
    var token = (shellNavToken += 1);

    setShellNavActive(base);
    toggleMobileSidebar(false);

    var cached = shellFrames[key];
    if (cached && key !== "__transient" && framePageOf(cached.el) === base) {
        var wasStale = Date.now() - (cached.shownAt || 0) > FRAME_STALE_MS;
        showStaffFrame(cached.el);
        if (wasStale) softRefreshFrame(cached.el);
        if (typeof opts.onReady === "function") opts.onReady(cached.el);
        return;
    }

    var frame = cached ? cached.el : createStaffFrame(key);
    shellFrames[key] = { el: frame, shownAt: Date.now() };
    setShellBusy(true);
    frame.addEventListener(
        "load",
        function () {
            if (token !== shellNavToken) return; // user already clicked elsewhere
            setShellBusy(false);
            showStaffFrame(frame);
            evictOldFrames();
            if (typeof opts.onReady === "function") opts.onReady(frame);
        },
        { once: true },
    );
    frame.setAttribute("src", url);
}

window.staffShellNav = staffShellNav;

function wireStaffFrame(frame) {
    if (frame.__hgWired) return;
    frame.__hgWired = true;
    frame.addEventListener("load", function () {
        enforceIframeEmbedMode(frame);
        if (typeof window.heigenSyncIframeTheme === "function") {
            window.heigenSyncIframeTheme();
        }
        // A page may navigate itself (e.g. list → details): re-key its cache entry
        var key = frame.getAttribute("data-page-key");
        var actual = framePageOf(frame);
        if (key && key !== "__transient" && actual && actual !== key && shellFrames[key] && shellFrames[key].el === frame) {
            delete shellFrames[key];
            if (shellFrames.__transient && shellFrames.__transient.el !== frame) {
                if (shellFrames.__transient.el !== activeStaffFrame()) shellFrames.__transient.el.remove();
            }
            shellFrames.__transient = { el: frame, shownAt: Date.now() };
            frame.setAttribute("data-page-key", "__transient");
        }
        if (typeof window.heigenShellDecorateFrame === "function") {
            window.heigenShellDecorateFrame(frame);
        }
        if (frame === activeStaffFrame()) {
            requestAnimationFrame(focusStaffIframeForScroll);
        }
    });
}

function enforceIframeEmbedMode(frameArg) {
    var frame = frameArg || document.getElementById("staffFrame");
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

var DEFAULT_KIOSK_URL = "http://localhost:8090";
var KIOSK_URL = (localStorage.getItem("kioskWebUrl") || "").trim() || DEFAULT_KIOSK_URL;
var HEALTH_CHECK_TIMEOUT_MS = 1200;
var KIOSK_AUTODETECT_PORTS = [8090, 19006, 8081, 8082, 19000];
var KIOSK_SCAN_RANGES = [
    { start: 8090, end: 8110 },
    { start: 19000, end: 19010 },
    { start: 8080, end: 8089 },
];
var KIOSK_LAST_GOOD_URL_KEY = "kioskLastDetectedUrl";
var KIOSK_MAX_PARALLEL_PROBES = 6;

function withNgrokBrowserWarningBypass(url) {
    if (!/^https:\/\/[^/]*ngrok/i.test(url)) return url;
    try {
        var parsed = new URL(url);
        parsed.searchParams.set("ngrok-skip-browser-warning", "true");
        return parsed.href;
    } catch (e) {
        return url;
    }
}

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

function pushUniqueUrl(list, seen, rawUrl) {
    if (!rawUrl) return;
    var url = withNgrokBrowserWarningBypass(String(rawUrl).trim());
    if (!url) return;
    if (seen.has(url)) return;
    seen.add(url);
    list.push(url);
}

async function buildShellKioskCandidates() {
    var candidates = [];
    var seen = new Set();
    var isPublicWeb = window.location.protocol !== "file:" &&
        !["localhost", "127.0.0.1"].includes(window.location.hostname);
    var overrideUrl = (localStorage.getItem("kioskWebUrl") || "").trim();
    var lastGoodUrl = (localStorage.getItem(KIOSK_LAST_GOOD_URL_KEY) || "").trim();
    var localhostPorts = [];

    function pushPort(port) {
        var n = Number(port);
        if (!Number.isFinite(n) || n <= 0) return;
        if (localhostPorts.indexOf(n) >= 0) return;
        localhostPorts.push(n);
    }

    function pushRange(range) {
        if (!range) return;
        var start = Number(range.start);
        var end = Number(range.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        if (end < start) return;
        for (var p = start; p <= end; p += 1) {
            pushPort(p);
        }
    }

    // User override is always checked first.
    pushUniqueUrl(candidates, seen, overrideUrl);
    pushUniqueUrl(candidates, seen, lastGoodUrl);
    if (isPublicWeb) {
        pushUniqueUrl(candidates, seen, window.location.origin + "/kiosk/");
    }
    if (window.heigenElectron && typeof window.heigenElectron.getNgrokUrl === "function") {
        var ngrokUrl = await window.heigenElectron.getNgrokUrl();
        if (ngrokUrl) {
            pushUniqueUrl(
                candidates,
                seen,
                withNgrokBrowserWarningBypass(ngrokUrl + "/kiosk/"),
            );
        }
    }

    KIOSK_AUTODETECT_PORTS.forEach(pushPort);
    KIOSK_SCAN_RANGES.forEach(pushRange);

    localhostPorts.forEach(function (port) {
        pushUniqueUrl(candidates, seen, "http://localhost:" + port);
    });
    localhostPorts.forEach(function (port) {
        pushUniqueUrl(candidates, seen, "http://127.0.0.1:" + port);
    });

    // Keep current + default as last-resort fallback entries.
    pushUniqueUrl(candidates, seen, KIOSK_URL);
    pushUniqueUrl(candidates, seen, DEFAULT_KIOSK_URL);
    return candidates;
}

async function isShellKioskReachable(url, timeoutMs) {
    var targetUrl = url || KIOSK_URL;
    var checkTimeout =
        typeof timeoutMs === "number" && timeoutMs > 0
            ? timeoutMs
            : HEALTH_CHECK_TIMEOUT_MS;
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
        controller.abort();
    }, checkTimeout);
    try {
        await fetch(targetUrl, {
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

async function detectShellKioskUrl() {
    var candidates = await buildShellKioskCandidates();
    for (var i = 0; i < candidates.length; i += KIOSK_MAX_PARALLEL_PROBES) {
        var batch = candidates.slice(i, i + KIOSK_MAX_PARALLEL_PROBES);
        var results = await Promise.all(
            batch.map(function (candidate) {
                return isShellKioskReachable(candidate, 850).then(function (online) {
                    return { url: candidate, online: online };
                });
            })
        );
        for (var j = 0; j < results.length; j += 1) {
            if (results[j].online) {
                return { url: results[j].url, online: true };
            }
        }
    }
    var publicFallback =
        window.location.protocol !== "file:" &&
        !["localhost", "127.0.0.1"].includes(window.location.hostname)
            ? withNgrokBrowserWarningBypass(window.location.origin + "/kiosk/")
            : DEFAULT_KIOSK_URL;
    return { url: publicFallback, online: false };
}

async function loadShellKiosk() {
    var statusText = document.getElementById("shellKioskStatusText");
    var frame = document.getElementById("shellKioskFrame");
    var urlText = document.getElementById("shellKioskUrlText");
    if (statusText) statusText.textContent = "Checking kiosk server...";
    if (frame) frame.src = "about:blank";

    var detection = await detectShellKioskUrl();
    KIOSK_URL = detection.url;
    if (urlText) urlText.textContent = KIOSK_URL;

    var online = detection.online;
    if (!online) {
        setShellKioskStatus(false);
        return;
    }
    try {
        localStorage.setItem(KIOSK_LAST_GOOD_URL_KEY, KIOSK_URL);
    } catch (e) {
        // Ignore storage write failures.
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

async function openShellLogoutModal(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    if (typeof window.heigenConfirm === "function") {
        var ok = await window.heigenConfirm("Are you sure you want to log out?", {
            title: "Log out",
            confirmText: "Log out",
            dangerous: false,
        });
        if (!ok) return;
        confirmShellLogout();
        return;
    }
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
    // Farewell overlay: clears the session and replaces this page with the
    // sign-in page while the animation plays (scripts/logout-outro.js)
    if (typeof window.heigenStartLogoutOutro === "function") {
        window.heigenStartLogoutOutro({
            loginUrl: new URL("../../index.html", window.location.href).href,
        });
        return;
    }
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
    if (window.staffAuth && typeof window.staffAuth.getRole === "function") {
        return window.staffAuth.getRole();
    }
    try {
        var user = JSON.parse(sessionStorage.getItem("user") || "{}");
        return String(user.role || "").toUpperCase();
    } catch (e) {
        return "";
    }
}

function canSeeActionLogs(role) {
    if (window.staffAuth && typeof window.staffAuth.canSeeActionLogs === "function") {
        return window.staffAuth.canSeeActionLogs(role);
    }
    var normalized = String(role || "").toUpperCase();
    return normalized === "ADMIN" || normalized === "OWNER";
}

function canCreateStaff(role) {
    if (window.staffAuth && typeof window.staffAuth.canCreateStaff === "function") {
        return window.staffAuth.canCreateStaff(role);
    }
    var normalized = String(role || "").toUpperCase();
    return normalized === "ADMIN" || normalized === "OWNER";
}

function canManageAccounts(role) {
    if (window.staffAuth && typeof window.staffAuth.canManageAccounts === "function") {
        return window.staffAuth.canManageAccounts(role);
    }
    var normalized = String(role || "").toUpperCase();
    return normalized === "ADMIN" || normalized === "OWNER";
}

function canSeeRecycleBin(role) {
    if (window.staffAuth && typeof window.staffAuth.canSeeRecycleBin === "function") {
        return window.staffAuth.canSeeRecycleBin(role);
    }
    var normalized = String(role || "").toUpperCase();
    return normalized === "ADMIN" || normalized === "OWNER";
}

function focusStaffIframeForScroll() {
    var frame = document.getElementById("staffFrame");
    if (!frame) return;
    try {
        frame.focus();
        if (frame.contentWindow) {
            frame.contentWindow.focus();
        }
    } catch (e) {
        /* file:// / sandbox timing */
    }
}

document.addEventListener("DOMContentLoaded", function () {
    var frame = document.getElementById("staffFrame");
    if (frame) {
        frame.setAttribute("data-page-key", "dashboard.html");
        shellFrames["dashboard.html"] = { el: frame, shownAt: Date.now() };
        wireStaffFrame(frame);
        document.querySelector(".shell-frame-wrap").addEventListener("mouseenter", focusStaffIframeForScroll);
        // Also run once in case iframe is already loaded.
        setTimeout(function () {
            enforceIframeEmbedMode(frame);
            if (typeof window.heigenSyncIframeTheme === "function") {
                window.heigenSyncIframeTheme();
            }
            try {
                if (frame.contentDocument && frame.contentDocument.readyState === "complete" &&
                    typeof window.heigenShellDecorateFrame === "function") {
                    window.heigenShellDecorateFrame(frame);
                }
            } catch (e) {}
        }, 0);
        setTimeout(focusStaffIframeForScroll, 0);
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
    var recycleNav = document.getElementById("nav-recycle-bin");
    var createStaffNav = document.getElementById("nav-create-staff");
    var manageAccountsNav = document.getElementById("nav-manage-accounts");
    var currentRole = getCurrentShellRole();
    var allowActionLogs = canSeeActionLogs(currentRole);
    var allowRecycleBin = canSeeRecycleBin(currentRole);
    var allowCreateStaff = canCreateStaff(currentRole);
    var allowManageAccounts = canManageAccounts(currentRole);
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

    var q = new URLSearchParams(window.location.search).get("page");
    if (q === "action-logs.html" && !allowActionLogs) {
        staffShellNav("dashboard.html");
    } else if (q === "recycle-bin.html" && !allowRecycleBin) {
        staffShellNav("dashboard.html");
    // Removed signup.html navigation guard (no longer a standalone page)
    } else if (q === "manage-accounts.html" && !allowManageAccounts) {
        staffShellNav("dashboard.html");
    } else if (q) {
        staffShellNav(q);
    }
});
