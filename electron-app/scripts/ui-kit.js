/* Heigen UI kit — loaded on every page (shell, staff pages, login/auth).
 * Works automatically, so page scripts don't need changes:
 *   - Thin progress bar at the top while any request is in flight
 *   - The button you clicked shows a spinner until its request finishes
 *   - "Loading…" panels / table rows become skeleton placeholders
 *   - "No … yet / found" table rows become friendly empty states
 *   - Plain status words in table cells (Pending, Confirmed, …) become badges
 *   - Success messages sent through heigenAlert() become toasts, not modals
 * Public helpers: window.HeigenUI.toast / emptyState / skeletonRows / badge
 */
(function (global) {
    "use strict";
    if (!global || typeof document === "undefined" || global.HeigenUI) return;

    // ---------------------------------------------------------------- utils
    function esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
    function onReady(fn) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", fn, { once: true });
        } else {
            fn();
        }
    }

    // ---------------------------------------------------------------- toasts
    var toastHost = null;
    function toast(message, opts) {
        opts = opts || {};
        var type = opts.type || "success";
        if (!document.body) return;
        if (!toastHost || !toastHost.isConnected) {
            toastHost = document.createElement("div");
            toastHost.className = "hg-toast-host";
            toastHost.setAttribute("role", "status");
            toastHost.setAttribute("aria-live", "polite");
            document.body.appendChild(toastHost);
        }
        var el = document.createElement("div");
        el.className = "hg-toast hg-toast--" + type;
        var icon = type === "error" ? "!" : type === "info" ? "i" : "✓";
        el.innerHTML =
            '<span class="hg-toast-icon" aria-hidden="true">' + icon + "</span>" +
            "<span>" + esc(message) + "</span>";
        toastHost.appendChild(el);
        var ttl = opts.duration || (type === "error" ? 5000 : 3200);
        setTimeout(function () {
            el.classList.add("is-leaving");
            setTimeout(function () { el.remove(); }, 260);
        }, ttl);
        return el;
    }

    var SUCCESS_RE = /\b(success(fully)?|saved|updated|created|added|deleted|removed|restored|archived|sent|copied|imported|exported|approved|confirmed|redeemed|claimed|uploaded|booked)\b/i;
    var PROBLEM_RE = /\b(fail(ed|ure)?|error|unable|could not|couldn't|cannot|can't|invalid|denied|not allowed|required|missing|please|warning|no\s+\w+\s+(found|selected))\b/i;
    function isSuccessMessage(msg, opts) {
        if (opts && opts.title && !/success|done|saved/i.test(String(opts.title))) return false;
        var s = String(msg == null ? "" : msg);
        if (!s || s.length > 160 || s.indexOf("\n") >= 0) return false;
        return SUCCESS_RE.test(s) && !PROBLEM_RE.test(s);
    }

    function patchAlerts() {
        if (typeof global.heigenAlert !== "function" || global.heigenAlert.__hgPatched) return;
        var original = global.heigenAlert;
        var patched = function (message, opts) {
            if (isSuccessMessage(message, opts)) {
                toast(String(message), { type: "success" });
                return;
            }
            return original.apply(this, arguments);
        };
        patched.__hgPatched = true;
        global.heigenAlert = patched;
    }

    // ------------------------------------------- progress bar + busy buttons
    var inflight = 0; // user-visible requests only
    var barEl = null;
    var pageStart = Date.now();
    var lastInteraction = 0;
    ["pointerdown", "keydown"].forEach(function (ev) {
        document.addEventListener(ev, function () { lastInteraction = Date.now(); }, true);
    });
    /* Background polling (e.g. the 30 s booking check) should stay silent. */
    function isUserVisibleRequest() {
        var now = Date.now();
        return now - pageStart < 8000 || now - lastInteraction < 2500;
    }
    var barTimer = null;
    var lastClick = { el: null, at: 0 };
    var busyButtons = new Map(); // button -> { pending, wasDisabled }

    function bar() {
        if (!barEl || !barEl.isConnected) {
            if (!document.body) return null;
            barEl = document.createElement("div");
            barEl.className = "hg-progress";
            barEl.setAttribute("aria-hidden", "true");
            document.body.appendChild(barEl);
        }
        return barEl;
    }
    function requestStarted() {
        if (!isUserVisibleRequest()) return { visible: false, btn: null };
        inflight += 1;
        if (inflight === 1) {
            clearTimeout(barTimer);
            // Only show for requests that aren't instant
            barTimer = setTimeout(function () {
                var b = bar();
                if (b && inflight > 0) b.classList.add("is-active");
            }, 220);
        }
        var btn = lastClick.el;
        if (btn && Date.now() - lastClick.at < 400 && btn.isConnected) {
            var st = busyButtons.get(btn);
            if (!st) {
                st = { pending: 0, wasDisabled: btn.disabled };
                busyButtons.set(btn, st);
                btn.setAttribute("aria-busy", "true");
                btn.disabled = true;
            }
            st.pending += 1;
            return { visible: true, btn: btn };
        }
        return { visible: true, btn: null };
    }
    function requestEnded(token) {
        if (!token || !token.visible) return;
        var btn = token.btn;
        inflight = Math.max(0, inflight - 1);
        if (inflight === 0) {
            clearTimeout(barTimer);
            if (barEl) barEl.classList.remove("is-active");
        }
        if (btn) {
            var st = busyButtons.get(btn);
            if (st) {
                st.pending -= 1;
                if (st.pending <= 0) {
                    busyButtons.delete(btn);
                    btn.removeAttribute("aria-busy");
                    btn.disabled = st.wasDisabled;
                }
            }
        }
    }

    document.addEventListener(
        "click",
        function (e) {
            var btn = e.target && e.target.closest ? e.target.closest("button") : null;
            if (!btn || btn.disabled || btn.hasAttribute("data-no-busy")) return;
            // Icon-only / navigation chrome shouldn't spin
            if (btn.closest("#sidebar, .hg-header-actions, .hg-palette, .heigen-alert-host")) return;
            lastClick = { el: btn, at: Date.now() };
        },
        true,
    );

    if (typeof global.fetch === "function" && !global.fetch.__hgPatched) {
        var nativeFetch = global.fetch;
        var wrapped = function () {
            var btn = requestStarted();
            var p;
            try {
                p = nativeFetch.apply(this, arguments);
            } catch (err) {
                requestEnded(btn);
                throw err;
            }
            return Promise.resolve(p).then(
                function (res) { requestEnded(btn); return res; },
                function (err) { requestEnded(btn); throw err; },
            );
        };
        wrapped.__hgPatched = true;
        global.fetch = wrapped;
    }

    // ------------------------------------------------------------ skeletons
    function skeletonRows(n) {
        n = n || 5;
        var html = '<div class="hg-skel-table" aria-hidden="true">';
        for (var i = 0; i < n; i += 1) {
            html +=
                '<div class="hg-skel-row">' +
                '<span class="hg-skel"></span><span class="hg-skel"></span>' +
                '<span class="hg-skel"></span><span class="hg-skel"></span>' +
                '<span class="hg-skel"></span></div>';
        }
        return html + "</div>";
    }

    // ---------------------------------------------------------- empty state
    var EMPTY_ICONS = {
        default:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg>',
        search:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
        people:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M17 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/></svg>',
        tag:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1"/></svg>',
        calendar:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    };
    function pickIcon(text) {
        var t = String(text || "").toLowerCase();
        if (/match|found|result|search/.test(t)) return EMPTY_ICONS.search;
        if (/customer|account|staff|user/.test(t)) return EMPTY_ICONS.people;
        if (/coupon|redemption|package|add-on/.test(t)) return EMPTY_ICONS.tag;
        if (/booking|history|log|record/.test(t)) return EMPTY_ICONS.calendar;
        return EMPTY_ICONS.default;
    }
    /** emptyState({ title, text, icon: "search"|"people"|…, actionLabel, onAction }) → HTMLElement */
    function emptyState(o) {
        o = o || {};
        var wrap = document.createElement("div");
        wrap.className = "hg-empty";
        wrap.innerHTML =
            '<div class="hg-empty-icon" aria-hidden="true">' +
            (EMPTY_ICONS[o.icon] || pickIcon(o.title)) +
            "</div>" +
            '<div class="hg-empty-title">' + esc(o.title || "Nothing here yet") + "</div>" +
            (o.text ? '<div class="hg-empty-text">' + esc(o.text) + "</div>" : "");
        if (o.actionLabel && typeof o.onAction === "function") {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "staff-btn-primary text-xs px-5 min-h-[36px] hg-empty-action";
            b.textContent = o.actionLabel;
            b.addEventListener("click", o.onAction);
            wrap.appendChild(b);
        }
        return wrap;
    }

    // -------------------------------------------------------------- badges
    var STATUS_TONES = {
        success: ["completed", "complete", "done", "confirmed", "approved", "accepted", "active", "paid", "fully paid", "claimed", "redeemed", "available", "booked", "success", "successful", "renewed", "verified", "enabled", "yes", "published"],
        warning: ["pending", "ongoing", "in progress", "scheduled", "awaiting", "awaiting payment", "partial", "partially paid", "processing", "unpaid", "for approval", "on hold", "draft", "likely"],
        danger: ["cancelled", "canceled", "rejected", "declined", "denied", "failed", "expired", "inactive", "no show", "no-show", "deleted", "overdue", "disabled", "archived", "unlikely", "no"],
        info: ["new", "rescheduled", "upcoming", "reserved", "walk-in", "online"],
    };
    var STATUS_MAP = {};
    Object.keys(STATUS_TONES).forEach(function (tone) {
        STATUS_TONES[tone].forEach(function (w) { STATUS_MAP[w] = tone; });
    });
    // Short yes/no-style words are only badged in columns whose header says "status"
    var STATUS_ONLY_IN_STATUS_COLUMN = { yes: 1, no: 1, likely: 1, unlikely: 1, online: 1, active: 1, inactive: 1 };

    function badge(text, tone) {
        var key = String(text || "").trim().toLowerCase();
        tone = tone || STATUS_MAP[key] || "neutral";
        return '<span class="hg-badge hg-badge--' + tone + '">' + esc(String(text).trim()) + "</span>";
    }

    function columnHeaderText(td) {
        try {
            var table = td.closest("table");
            if (!table || !table.tHead) return "";
            var idx = Array.prototype.indexOf.call(td.parentNode.children, td);
            var row = table.tHead.rows[table.tHead.rows.length - 1];
            var th = row && row.cells[idx];
            return th ? th.textContent.trim().toLowerCase() : "";
        } catch (e) {
            return "";
        }
    }

    function enhanceStatusCell(td) {
        if (td.__hgBadged || td.children.length) return;
        var text = td.textContent.trim();
        if (!text || text.length > 22) return;
        var tone = STATUS_MAP[text.toLowerCase()];
        if (!tone) return;
        var header = columnHeaderText(td);
        if (STATUS_ONLY_IN_STATUS_COLUMN[text.toLowerCase()] && !/status|state|renew|risk|availability/.test(header)) return;
        if (header && /name|email|note|remark|description|package|code|action/.test(header) && !/status/.test(header)) return;
        td.__hgBadged = true;
        td.innerHTML = badge(text, tone);
    }

    // ------------------------------------------------------ auto-enhancement
    var LOADING_RE = /^\s*loading\b/i;
    var EMPTY_RE = /^\s*(no\s.+\s(yet|found|recorded|available|to show)|nothing\s.+)\.?\s*$/i;

    function enhanceSingleCellRow(tr) {
        if (tr.cells.length !== 1) return;
        var td = tr.cells[0];
        if (td.querySelector(".hg-empty, .hg-skel-table, button, input, a, img")) return;
        var text = td.textContent.trim();
        if (LOADING_RE.test(text)) {
            td.classList.add("hg-skel-cell");
            td.innerHTML = '<span class="hg-sr-only">' + esc(text) + "</span>" + skeletonRows(4);
        } else if (EMPTY_RE.test(text) && text.length < 120) {
            td.innerHTML = "";
            td.appendChild(
                emptyState({
                    title: text.replace(/\.$/, ""),
                    text: /found|match/i.test(text)
                        ? "Try a different search or clear the filters."
                        : "New entries will show up here automatically.",
                }),
            );
        }
    }

    function enhanceLoadingPanel(panel) {
        if (panel.__hgSkel) return;
        panel.__hgSkel = true;
        panel.classList.add("hg-skel-host");
        panel.insertAdjacentHTML("beforeend", skeletonRows(6));
    }

    var scheduled = false;
    var pendingRoots = new Set();
    function scan(root) {
        if (!root || root.nodeType !== 1) return;
        if (root.matches && root.matches(".staff-loading-panel")) enhanceLoadingPanel(root);
        root.querySelectorAll(".staff-loading-panel").forEach(enhanceLoadingPanel);
        var rows = root.tagName === "TR" ? [root] : root.querySelectorAll("tbody tr");
        Array.prototype.forEach.call(rows, function (tr) {
            if (tr.cells.length === 1) {
                enhanceSingleCellRow(tr);
            } else {
                Array.prototype.forEach.call(tr.cells, enhanceStatusCell);
            }
        });
    }
    function queue(node) {
        var el = node.nodeType === 1 ? node : node.parentElement;
        if (!el) return;
        // Re-scan the nearest row/table body when its text changes
        var target = el.closest ? el.closest("tr, .staff-loading-panel") || el : el;
        pendingRoots.add(target);
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
            scheduled = false;
            var roots = Array.from(pendingRoots);
            pendingRoots.clear();
            roots.forEach(function (r) {
                if (r.isConnected) {
                    if (r.tagName === "TR" || r.tagName === "TD") {
                        var tr = r.tagName === "TR" ? r : r.parentNode;
                        Array.prototype.forEach.call(tr.cells || [], function (td) {
                            if (td.__hgBadged && td.textContent.trim() && !td.querySelector(".hg-badge")) td.__hgBadged = false;
                        });
                    }
                    scan(r);
                }
            });
        });
    }

    onReady(function () {
        patchAlerts();
        // alert-modal.js may load after us on some pages
        setTimeout(patchAlerts, 0);
        scan(document.body);
        new MutationObserver(function (muts) {
            muts.forEach(function (m) {
                if (m.type === "characterData") {
                    queue(m.target);
                    return;
                }
                m.addedNodes.forEach(function (n) {
                    if (n.nodeType === 1 && !(n.classList && (n.classList.contains("hg-badge") || n.classList.contains("hg-empty") || n.classList.contains("hg-skel-table") || n.classList.contains("hg-toast") || n.classList.contains("hg-progress")))) {
                        queue(n);
                    } else if (n.nodeType === 3) {
                        queue(n);
                    }
                });
            });
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    global.HeigenUI = {
        toast: toast,
        emptyState: emptyState,
        skeletonRows: skeletonRows,
        badge: badge,
    };
    global.heigenToast = toast;
})(typeof window !== "undefined" ? window : this);
