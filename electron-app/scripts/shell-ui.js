/* Admin shell extras (loaded by shell.html after staff-shell.js):
 *  - Puts Search / Kiosk / Refresh / Notifications buttons into each page's
 *    header, replacing the three floating circles
 *  - Mirrors the pending-bookings count onto the header bell
 *  - Ctrl+K quick search: jump to any page, search customers, run actions
 */
(function () {
    "use strict";

    var ICONS = {
        search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
        kiosk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/></svg>',
        refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
        bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
        sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
        moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg>',
        logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
        user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    };
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
    var shortcutLabel = isMac ? "⌘K" : "Ctrl K";

    // ------------------------------------------------------ header actions
    function pendingCount() {
        var b = document.getElementById("notificationBadge");
        if (!b || b.style.display === "none") return 0;
        var n = parseInt(b.textContent, 10);
        return isNaN(n) ? 0 : n;
    }

    function syncBadges() {
        var n = pendingCount();
        document.querySelectorAll("iframe.staff-app-iframe").forEach(function (f) {
            try {
                var doc = f.contentDocument;
                if (!doc) return;
                doc.querySelectorAll(".hg-bell-badge").forEach(function (el) {
                    el.hidden = n <= 0;
                    el.textContent = n > 99 ? "99+" : String(n);
                });
                doc.querySelectorAll(".hg-bell-btn").forEach(function (btn) {
                    btn.setAttribute("aria-label", n > 0 ? "Bookings waiting for review: " + n : "Booking notifications");
                    btn.setAttribute("data-tip", n > 0 ? n + " booking" + (n === 1 ? "" : "s") + " to review" : "Notifications");
                });
            } catch (e) {}
        });
    }

    function onFrameShown(frame) {
        var hasActions = false;
        try {
            hasActions = !!(frame && frame.contentDocument && frame.contentDocument.querySelector(".hg-header-actions"));
        } catch (e) {}
        // Fall back to the floating buttons on pages without a header (e.g. onboarding)
        document.documentElement.classList.toggle("hg-header-actions-on", hasActions);
    }
    window.heigenShellOnFrameShown = onFrameShown;

    function decorateFrame(frame) {
        var doc;
        try {
            doc = frame.contentDocument;
        } catch (e) {
            return;
        }
        if (!doc || !doc.body) return;

        // Ctrl+K and Escape work even while focus is inside the page
        if (!doc.__hgKeysBound) {
            doc.__hgKeysBound = true;
            doc.addEventListener("keydown", handleGlobalKeys);
        }

        var header = doc.querySelector(".staff-shell-header");
        if (header && !header.querySelector(".hg-header-actions")) {
            var bar = doc.createElement("div");
            bar.className = "hg-header-actions";
            bar.innerHTML =
                '<button type="button" class="hg-search-trigger" data-act="search" aria-label="Quick search (' + shortcutLabel + ')">' +
                ICONS.search + "<span>Search or jump to…</span>" +
                '<kbd class="hg-kbd">' + shortcutLabel + "</kbd></button>" +
                '<button type="button" class="hg-icon-btn" data-act="kiosk" aria-label="Open kiosk" data-tip="Open kiosk">' + ICONS.kiosk + "</button>" +
                '<button type="button" class="hg-icon-btn" data-act="refresh" aria-label="Refresh this page" data-tip="Refresh data">' + ICONS.refresh + "</button>" +
                '<button type="button" class="hg-icon-btn hg-bell-btn" data-act="bell" aria-label="Booking notifications" data-tip="Notifications">' +
                ICONS.bell + '<span class="hg-dot-badge hg-bell-badge" hidden>0</span></button>' +
                // Theme toggle: the icon shows the mode you switch TO (moon in light, sun in dark)
                '<button type="button" class="hg-icon-btn hg-theme-btn" data-act="theme" data-hg-theme-toggle aria-pressed="false" aria-label="Switch to dark mode" data-tip="Dark mode">' +
                '<span class="hg-theme-icon hg-theme-icon--moon">' + ICONS.moon + '</span>' +
                '<span class="hg-theme-icon hg-theme-icon--sun">' + ICONS.sun + "</span></button>";
            var user = header.querySelector(".staff-header-user");
            if (user) header.insertBefore(bar, user);
            else header.appendChild(bar);
            bar.addEventListener("click", function (e) {
                var btn = e.target.closest("button[data-act]");
                if (!btn) return;
                var act = btn.getAttribute("data-act");
                if (act === "search") openPalette();
                else if (act === "kiosk" && window.openKioskFromShell) window.openKioskFromShell();
                else if (act === "bell" && window.toggleBookingStatusPanel) window.toggleBookingStatusPanel();
                else if (act === "refresh") runRefresh(btn);
                else if (act === "theme" && window.heigenToggleTheme) window.heigenToggleTheme();
            });
            if (window.heigenRefreshThemeToggles) window.heigenRefreshThemeToggles();
            doc.documentElement.classList.add("hg-header-actions-on");
        }
        syncBadges();
        if (frame.id === "staffFrame") onFrameShown(frame);
    }
    window.heigenShellDecorateFrame = decorateFrame;

    function runRefresh(btn) {
        if (btn && btn.classList.contains("is-spinning")) return;
        if (btn) btn.classList.add("is-spinning");
        var done = function () {
            if (btn) btn.classList.remove("is-spinning");
            if (window.heigenToast) window.heigenToast("Up to date", { type: "info", duration: 1800 });
        };
        Promise.resolve(typeof window.refreshPage === "function" ? window.refreshPage() : null)
            .then(done, done);
    }

    // ------------------------------------------------------ command palette
    var paletteEl = null;
    var items = [];
    var activeIdx = 0;

    function navItems() {
        var out = [];
        document.querySelectorAll("#sidebar a.sidebar-nav-item[data-nav]").forEach(function (a) {
            if (a.classList.contains("hidden") || !a.isConnected) return;
            var svg = a.querySelector("svg");
            out.push({
                group: "Go to",
                label: a.textContent.trim(),
                icon: svg ? svg.outerHTML : "",
                run: function () { window.staffShellNav(a.getAttribute("data-nav")); },
            });
        });
        return out;
    }

    function actionItems() {
        var n = pendingCount();
        var list = [
            {
                group: "Actions",
                label: n > 0 ? "Review pending bookings (" + n + ")" : "Booking notifications",
                icon: ICONS.bell,
                run: function () { window.toggleBookingStatusPanel && window.toggleBookingStatusPanel(); },
            },
            { group: "Actions", label: "Open kiosk", icon: ICONS.kiosk, run: function () { window.openKioskFromShell(); } },
            { group: "Actions", label: "Refresh this page", icon: ICONS.refresh, run: function () { runRefresh(currentRefreshBtn()); } },
            {
                group: "Actions",
                label: document.documentElement.getAttribute("data-theme") === "dark" ? "Switch to light mode" : "Switch to dark mode",
                icon: ICONS.moon,
                run: function () { window.heigenToggleTheme && window.heigenToggleTheme(); },
            },
            { group: "Actions", label: "Log out", icon: ICONS.logout, run: function () { window.openShellLogoutModal(); } },
        ];
        return list;
    }

    function currentRefreshBtn() {
        try {
            var f = document.getElementById("staffFrame");
            return f.contentDocument.querySelector('.hg-header-actions [data-act="refresh"]');
        } catch (e) {
            return null;
        }
    }

    function searchCustomers(q) {
        window.staffShellNav("customers.html", {
            onReady: function (frame) {
                var tries = 0;
                (function attempt() {
                    try {
                        var w = frame.contentWindow;
                        var input = frame.contentDocument.getElementById("searchInput");
                        if (input && typeof w.applyCustomerFiltersFromForm === "function") {
                            input.value = q;
                            w.applyCustomerFiltersFromForm();
                            return;
                        }
                    } catch (e) {}
                    if ((tries += 1) < 20) setTimeout(attempt, 150);
                })();
            },
        });
    }

    function buildItems(query) {
        var q = query.trim().toLowerCase();
        var all = navItems().concat(actionItems());
        var matched = q
            ? all.filter(function (it) { return it.label.toLowerCase().indexOf(q) >= 0; })
            : all;
        if (q) {
            var raw = query.trim();
            matched.unshift({
                group: "Search",
                label: "Find customers matching “" + raw + "”",
                hint: "Customer Data",
                icon: ICONS.user,
                run: function () { searchCustomers(raw); },
            });
        }
        return matched;
    }

    function render(query) {
        items = buildItems(query);
        activeIdx = Math.min(activeIdx, Math.max(0, items.length - 1));
        var list = paletteEl.querySelector(".hg-palette-list");
        var html = "";
        var lastGroup = "";
        items.forEach(function (it, i) {
            if (it.group !== lastGroup) {
                html += '<div class="hg-palette-group">' + it.group + "</div>";
                lastGroup = it.group;
            }
            html +=
                '<button type="button" class="hg-palette-item' + (i === activeIdx ? " is-active" : "") +
                '" data-idx="' + i + '" role="option" aria-selected="' + (i === activeIdx) + '">' +
                (it.icon || "") + "<span>" + escapeHtml(it.label) + "</span>" +
                (it.hint ? "<small>" + escapeHtml(it.hint) + "</small>" : "") + "</button>";
        });
        if (!items.length) {
            html = '<div class="hg-palette-group" style="text-transform:none;letter-spacing:0">No matches. Try a page name such as “Coupons”.</div>';
        }
        list.innerHTML = html;
        var act = list.querySelector(".is-active");
        if (act) act.scrollIntoView({ block: "nearest" });
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
    }

    function openPalette() {
        if (paletteEl) return;
        activeIdx = 0;
        paletteEl = document.createElement("div");
        paletteEl.className = "hg-palette-backdrop";
        paletteEl.innerHTML =
            '<div class="hg-palette" role="dialog" aria-modal="true" aria-label="Quick search">' +
            '<label class="hg-palette-input">' + ICONS.search.replace("<svg", '<svg width="20" height="20"') +
            '<input type="text" placeholder="Type a page, an action, or a customer name…" autocomplete="off" spellcheck="false" />' +
            '<kbd class="hg-kbd">Esc</kbd></label>' +
            '<div class="hg-palette-list" role="listbox"></div>' +
            '<div class="hg-palette-foot"><span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span></div>' +
            "</div>";
        document.body.appendChild(paletteEl);
        if (window.HeigenModal) window.HeigenModal.open(paletteEl, closePalette);
        var input = paletteEl.querySelector("input");
        render("");
        input.focus();
        input.addEventListener("input", function () {
            activeIdx = 0;
            render(input.value);
        });
        input.addEventListener("keydown", function (e) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                activeIdx = (activeIdx + 1) % Math.max(1, items.length);
                render(input.value);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                activeIdx = (activeIdx - 1 + items.length) % Math.max(1, items.length);
                render(input.value);
            } else if (e.key === "Enter") {
                e.preventDefault();
                runItem(activeIdx);
            }
        });
        paletteEl.addEventListener("mousedown", function (e) {
            if (e.target === paletteEl) closePalette();
        });
        paletteEl.querySelector(".hg-palette-list").addEventListener("click", function (e) {
            var b = e.target.closest(".hg-palette-item");
            if (b) runItem(parseInt(b.getAttribute("data-idx"), 10));
        });
    }

    function runItem(i) {
        var it = items[i];
        closePalette();
        if (it && typeof it.run === "function") it.run();
    }

    function closePalette() {
        if (!paletteEl) return;
        paletteEl.remove();
        paletteEl = null;
    }

    function handleGlobalKeys(e) {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) {
            e.preventDefault();
            if (paletteEl) closePalette();
            else openPalette();
        } else if (e.key === "Escape" && paletteEl) {
            e.preventDefault();
            closePalette();
        }
    }

    window.heigenOpenPalette = openPalette;

    document.addEventListener("keydown", handleGlobalKeys);
    document.addEventListener("DOMContentLoaded", function () {
        var badge = document.getElementById("notificationBadge");
        if (badge) {
            new MutationObserver(syncBadges).observe(badge, {
                attributes: true,
                childList: true,
                characterData: true,
                subtree: true,
            });
        }
        syncBadges();
    });
})();
