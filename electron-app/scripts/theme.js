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

    function refreshThemeToggleUi() {
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
            moon.hidden = dark;
            sun.hidden = !dark;
        }
    }

    function syncIframe(mode) {
        try {
            var f = document.getElementById("staffFrame");
            if (f && f.contentWindow) {
                f.contentWindow.postMessage(
                    { type: "heigen-theme", theme: mode },
                    "*",
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

    function setTheme(mode) {
        if (mode !== "dark" && mode !== "light") return;
        setStored(mode);
        apply(mode);
        syncIframe(mode);
        refreshThemeToggleUi();
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
        var stored = getStored();
        if (stored === "dark" || stored === "light") {
            apply(stored);
        } else {
            apply("light");
        }
        syncIframe(currentMode());
        refreshThemeToggleUi();
    }

    /** Re-apply stored theme to shell iframe after navigation (same-origin). */
    function syncIframeThemeOnly() {
        syncIframe(currentMode());
    }

    global.heigenSetTheme = setTheme;
    global.heigenToggleTheme = toggleTheme;
    global.heigenInitTheme = initTheme;
    global.heigenThemeMode = currentMode;
    global.heigenSyncIframeTheme = syncIframeThemeOnly;

    global.addEventListener("message", function (ev) {
        if (!ev.data || ev.data.type !== "heigen-theme") return;
        var t = ev.data.theme;
        if (t !== "dark" && t !== "light") return;
        if (window.self !== window.top) {
            apply(t);
        }
    });

    /* Apply persisted theme before first paint when script runs from <head>. */
    try {
        var boot = getStored();
        if (boot === "dark" || boot === "light") {
            apply(boot);
        }
    } catch (e2) {}

    if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", initTheme);
        } else {
            initTheme();
        }
    }
})(typeof window !== "undefined" ? window : this);
