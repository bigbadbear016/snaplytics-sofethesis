// Persists light/dark on document.documentElement as data-theme="dark".
(function (global) {
    var KEY = "heigen-theme";

    function getStored() {
        try {
            return localStorage.getItem(KEY);
        } catch (e) {
            return null;
        }
    }

    function setStored(mode) {
        try {
            localStorage.setItem(KEY, mode);
        } catch (e) {}
    }

    function clearStored() {
        try {
            localStorage.removeItem(KEY);
        } catch (e) {}
    }

    /* No stored value = follow the system color scheme. A stored "light"/"dark"
     * is an explicit override and is kept even if the system later matches it. */
    var systemQuery = null;
    try { systemQuery = global.matchMedia("(prefers-color-scheme: dark)"); } catch (e) {}
    function systemMode() {
        return systemQuery && systemQuery.matches ? "dark" : "light";
    }
    function resolvedMode() {
        var stored = getStored();
        return stored === "dark" || stored === "light" ? stored : systemMode();
    }

    function apply(mode) {
        var html = document.documentElement;
        if (mode === "dark") {
            html.setAttribute("data-theme", "dark");
        } else {
            html.removeAttribute("data-theme");
        }
    }

    function currentMode() {
        return document.documentElement.getAttribute("data-theme") === "dark"
            ? "dark"
            : "light";
    }

    /** Header toggles (injected into each page header by shell-ui.js). Icons
     *  swap via CSS on [data-theme]; this keeps labels/tooltips/ARIA in sync. */
    function refreshHeaderToggles() {
        var dark = currentMode() === "dark";
        var docs = [document];
        document.querySelectorAll("iframe.staff-app-iframe").forEach(function (f) {
            try { if (f.contentDocument) docs.push(f.contentDocument); } catch (e) {}
        });
        docs.forEach(function (d) {
            d.querySelectorAll("[data-hg-theme-toggle]").forEach(function (b) {
                b.setAttribute("aria-pressed", dark ? "true" : "false");
                b.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
                b.setAttribute("data-tip", dark ? "Light mode" : "Dark mode");
            });
        });
    }

    function refreshThemeToggleUi() {
        refreshHeaderToggles();
        var btn = document.getElementById("heigenThemeToggle");
        if (!btn) return;
        var dark = currentMode() === "dark";
        btn.setAttribute(
            "aria-pressed",
            dark ? "true" : "false",
        );
        btn.setAttribute(
            "aria-label",
            dark ? "Switch to light mode" : "Switch to dark mode",
        );
        if (dark) {
            btn.title = "Light mode";
        } else {
            btn.title = "Dark mode";
        }
        var label = btn.querySelector(".theme-toggle-label");
        if (label) {
            label.textContent = dark ? "Light mode" : "Dark mode";
        }
        var moon = btn.querySelector(".theme-toggle-icon--moon");
        var sun = btn.querySelector(".theme-toggle-icon--sun");
        if (moon && sun) {
            // Icon shows the theme you switch TO: light mode → moon, dark mode → sun.
            moon.hidden = dark;
            sun.hidden = !dark;
        }
    }

    function syncIframe(mode) {
        // Shell keeps one iframe per visited page — theme all of them
        var frames = document.querySelectorAll("iframe.staff-app-iframe");
        if (!frames.length) {
            var only = document.getElementById("staffFrame");
            frames = only ? [only] : [];
        }
        Array.prototype.forEach.call(frames, function (f) { syncOneIframe(f, mode); });
    }

    function syncOneIframe(f, mode) {
        try {
            if (f && f.contentWindow) {
                f.contentWindow.postMessage(
                    { type: "heigen-theme", theme: mode },
                    "/",
                );
            }
            var doc = f && f.contentDocument;
            if (doc && doc.documentElement) {
                if (mode === "dark") {
                    doc.documentElement.setAttribute("data-theme", "dark");
                } else {
                    doc.documentElement.removeAttribute("data-theme");
                }
            }
        } catch (e) {}
    }

    var themeTransitionBusy = false;

    function canAnimateThemeSwitch() {
        if (typeof document.startViewTransition !== "function") return false;
        if (window.self !== window.top) return false; // the shell animates the whole window
        // Sign-in screens (login, sign-up, forgot password) switch instantly
        if (document.body && document.body.classList.contains("auth-body")) return false;
        try {
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
        } catch (e) {}
        return true;
    }

    function setTheme(mode) {
        if (mode !== "dark" && mode !== "light") return;
        // Choosing what the system already shows undoes the override
        if (mode === systemMode()) clearStored();
        else setStored(mode);
        var update = function () {
            apply(mode);
            syncIframe(mode);
            refreshThemeToggleUi();
        };
        if (mode === currentMode() || !canAnimateThemeSwitch() || themeTransitionBusy) {
            update();
            return;
        }
        // Full-screen fade: the new theme fades in over the old one with the same
        // timing as the login page's .login-bg-dim (opacity, 0.35s ease). CSS: ui.css
        themeTransitionBusy = true;
        document.documentElement.classList.add("hg-theme-switching");
        var done = function () {
            themeTransitionBusy = false;
            document.documentElement.classList.remove("hg-theme-switching");
        };
        try {
            var t = document.startViewTransition(update);
            t.finished.then(done, done);
        } catch (e) {
            update();
            done();
        }
    }

    function toggleTheme() {
        setTheme(currentMode() === "dark" ? "light" : "dark");
    }

    function bindThemeToggle() {
        var btn = document.getElementById("heigenThemeToggle");
        if (!btn || btn.__heigenThemeBound) return;
        btn.__heigenThemeBound = true;
        btn.addEventListener("click", function () {
            toggleTheme();
        });
    }

    function initTheme() {
        bindThemeToggle();
        apply(resolvedMode());
        syncIframe(currentMode());
        refreshThemeToggleUi();
    }

    function reapplyResolved() {
        apply(resolvedMode());
        syncIframe(currentMode());
        refreshThemeToggleUi();
    }
    // Follow live system changes while there is no override
    if (systemQuery && typeof systemQuery.addEventListener === "function") {
        systemQuery.addEventListener("change", function () {
            if (!getStored()) reapplyResolved();
        });
    }
    // Keep other open windows/tabs in sync with a toggle made elsewhere
    global.addEventListener("storage", function (e) {
        if (e.key === KEY || e.key === null) reapplyResolved();
    });

    /** Re-apply stored theme to shell iframe after navigation (same-origin). */
    function syncIframeThemeOnly() {
        syncIframe(currentMode());
    }

    global.heigenSetTheme = setTheme;
    global.heigenToggleTheme = toggleTheme;
    global.heigenInitTheme = initTheme;
    global.heigenThemeMode = currentMode;
    global.heigenSyncIframeTheme = syncIframeThemeOnly;
    global.heigenRefreshThemeToggles = refreshHeaderToggles;

    global.addEventListener("message", function (ev) {
        // Only the embedding shell (same origin; pinned window for file://) may set the theme
        if (ev.source !== global.parent || ev.source === global) return;
        if (ev.origin !== "null" ? ev.origin !== location.origin : location.protocol !== "file:") return;
        if (!ev.data || ev.data.type !== "heigen-theme") return;
        var t = ev.data.theme;
        if (t !== "dark" && t !== "light") return;
        if (window.self !== window.top) {
            apply(t);
        }
    });

    /* Apply persisted theme before first paint when script runs from <head>. */
    try {
        apply(resolvedMode());
    } catch (e2) {}

    if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", initTheme);
        } else {
            initTheme();
        }
    }
})(typeof window !== "undefined" ? window : this);
