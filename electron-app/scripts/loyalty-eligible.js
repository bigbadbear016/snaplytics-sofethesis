// scripts/loyalty-eligible.js
// Coupons page → Loyalty points modal: eligible-customer badge + list, bulk
// selection, and the personalised email composer (visual / HTML + live preview).
// API: GET /api/loyalty/eligible/, POST /api/loyalty/eligible/email/
// Placeholders are filled per customer on the server; the preview below uses
// the same rules so what staff see is what customers get.

(function () {
    "use strict";

    var TEMPLATE_KEY = "heigen-loyalty-email-template-v1";
    var MAX_CHIPS = 3;
    var DEFAULT_SUBJECT = "{customer_name}, your points can claim a package at Heigen Studio";
    var DEFAULT_HTML =
        '<div style="font-family:Arial,Helvetica,sans-serif;color:#1f3b47;line-height:1.6;max-width:560px;">' +
        '<h2 style="color:#165166;margin:0 0 12px;">Good news, {customer_name}!</h2>' +
        "<p>You've collected <strong>{current_points} loyalty points</strong> at Heigen Studio — enough to claim a package with your points.</p>" +
        "<p>Here's what you can claim right now:</p>" +
        "{claimable_packages}" +
        "<p>Just let us know when you book your next session and we'll apply your points.</p>" +
        '<p style="margin-top:20px;">See you soon,<br><strong>Heigen Studio</strong></p>' +
        "</div>";

    var state = {
        rows: [],
        selected: new Set(),
        loaded: false,
        loading: false,
        mode: "visual",
        html: DEFAULT_HTML,
        lastRange: null,
        query: "",
    };

    function $(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
    }

    // 112.5 → "112.5", 120 → "120" (same as the server's _format_points)
    function fmtPts(n) {
        var v = Number(n) || 0;
        var t = v.toLocaleString("en-PH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        return t.slice(-2) === ".0" ? t.slice(0, -2) : t;
    }

    function initials(name) {
        var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return "?";
        return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
    }

    function canEmail(r) { return !!r.email; }
    function blockReason(r) {
        if (!r.email) return "No email";
        return "";
    }

    function toast(msg, type) {
        if (window.HeigenUI && window.HeigenUI.toast) window.HeigenUI.toast(msg, { type: type || "success" });
        else if (typeof window.showToast === "function") window.showToast(msg, type);
    }

    // ── Badge on the "Configure loyalty points" card ──────────────────
    function setBadge(count) {
        var b = $("loyaltyEligibleBadge");
        if (!b) return;
        b.hidden = !(count > 0);
        b.textContent = count > 99 ? "99+" : String(count);
        var label = count + " customer" + (count === 1 ? "" : "s") + " can claim a package";
        b.setAttribute("aria-label", label);
        b.title = label;
        var btn = $("loyaltySettingsOpenBtn");
        if (btn) btn.setAttribute("aria-label", count > 0 ? "Loyalty settings — " + label : "Loyalty settings");
    }

    // ── Data ──────────────────────────────────────────────────────────
    async function load() {
        if (!window.apiClient || !window.apiClient.loyalty) return;
        state.loading = true;
        if (!state.loaded) renderLoading();
        try {
            var data = await window.apiClient.loyalty.eligible();
            // http.get unwraps {count, results} into the bare array
            state.rows = Array.isArray(data) ? data : (data && data.results) || [];
            state.loaded = true;
            // Keep selections that are still eligible and emailable
            var keep = new Set();
            state.rows.forEach(function (r) { if (state.selected.has(r.id) && canEmail(r)) keep.add(r.id); });
            state.selected = keep;
            setBadge(state.rows.length);
            renderList();
        } catch (e) {
            console.warn("loyalty eligible:", e);
            renderError();
        } finally {
            state.loading = false;
        }
    }

    // ── List ──────────────────────────────────────────────────────────
    function renderLoading() {
        var list = $("lpEligibleList");
        if (!list) return;
        var row = '<div class="lp-row lp-row--skel" aria-hidden="true"><span class="hg-skel" style="width:16px;height:16px"></span>' +
            '<span class="hg-skel" style="width:36px;height:36px;border-radius:999px"></span>' +
            '<span class="hg-skel" style="width:40%;height:14px"></span><span class="hg-skel" style="width:15%;height:14px"></span></div>';
        list.innerHTML = row + row + row;
        list.setAttribute("aria-busy", "true");
    }

    function renderError() {
        var list = $("lpEligibleList");
        if (!list) return;
        list.removeAttribute("aria-busy");
        list.innerHTML = '<div class="lp-empty">Couldn\'t load eligible customers. ' +
            '<button type="button" class="hg-greeting-link" id="lpRetry">Try again</button></div>';
        var r = $("lpRetry");
        if (r) r.addEventListener("click", load);
    }

    function renderList() {
        var list = $("lpEligibleList");
        if (!list) return;
        list.removeAttribute("aria-busy");
        var countEl = $("lpEligibleCount");
        if (countEl) {
            var nShown = visibleRows().length;
            countEl.textContent = state.query.trim() && nShown !== state.rows.length
                ? nShown + " of " + state.rows.length
                : String(state.rows.length);
        }

        if (!state.rows.length) {
            list.innerHTML = '<div class="lp-empty">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3 6.5 7 .9-5.1 4.8 1.3 7-6.2-3.5-6.2 3.5 1.3-7L2 9.4l7-.9z"/></svg>' +
                "<strong>No one can claim a package yet</strong><span>Customers appear here once their points cover the cheapest package.</span></div>";
            updateSelectionUi();
            return;
        }

        var shown = visibleRows();
        if (!shown.length) {
            list.innerHTML = '<div class="lp-empty"><strong>No matches</strong><span>No eligible customer matches “' +
                esc(state.query.trim()) + '”.</span></div>';
            updateSelectionUi();
            return;
        }
        list.innerHTML = shown.map(function (r) {
            var ok = canEmail(r);
            var chips = r.packages.slice(0, MAX_CHIPS).map(function (p) {
                return '<span class="lp-chip">' + esc(p.name) + ' <em>' + fmtPts(p.points_cost) + " pts</em></span>";
            }).join("");
            var more = r.packages.length - MAX_CHIPS;
            if (more > 0) {
                var rest = r.packages.slice(MAX_CHIPS).map(function (p) { return p.name + " (" + fmtPts(p.points_cost) + " pts)"; }).join(", ");
                chips += '<span class="lp-chip lp-chip--more" title="' + esc(rest) + '">+' + more + " more</span>";
            }
            var reason = blockReason(r);
            return '<label class="lp-row' + (ok ? "" : " is-blocked") + '" role="listitem">' +
                '<input type="checkbox" class="lp-row-check" data-id="' + r.id + '"' +
                (state.selected.has(r.id) ? " checked" : "") + (ok ? "" : " disabled") +
                ' aria-label="Select ' + esc(r.name || "customer") + '">' +
                '<span class="lp-avatar" aria-hidden="true">' + esc(initials(r.name)) + "</span>" +
                '<span class="lp-who"><span class="lp-name">' + esc(r.name || "Unnamed customer") + "</span>" +
                '<span class="lp-email">' + (r.email ? esc(r.email) : "No email on file") + "</span></span>" +
                '<span class="lp-pts"><strong>' + fmtPts(r.points) + "</strong> pts</span>" +
                '<span class="lp-pkgs">' + chips + "</span>" +
                (reason ? '<span class="lp-tag">' + esc(reason) + "</span>" : "") +
                "</label>";
        }).join("");
        updateSelectionUi();
    }

    function matches(r, q) {
        if (!q) return true;
        var hay = [r.name, r.email].concat(r.packages.map(function (p) { return p.name; })).join(" ").toLowerCase();
        return q.split(/\s+/).every(function (part) { return hay.indexOf(part) >= 0; });
    }

    function visibleRows() {
        var q = state.query.trim().toLowerCase();
        return state.rows.filter(function (r) { return matches(r, q); });
    }

    // "Select all" works on the customers currently shown by the search
    function emailable() { return visibleRows().filter(canEmail); }

    function updateSelectionUi() {
        var all = $("lpSelectAll");
        var btn = $("lpSendEmailBtn");
        var label = $("lpSendEmailLabel");
        var n = state.selected.size;
        var max = emailable().length;
        if (all) {
            var shownSelected = emailable().filter(function (r) { return state.selected.has(r.id); }).length;
            all.disabled = max === 0;
            all.checked = max > 0 && shownSelected === max;
            all.indeterminate = shownSelected > 0 && shownSelected < max;
        }
        if (btn) btn.disabled = n === 0;
        if (label) label.textContent = n > 0 ? "Send email (" + n + ")" : "Send email";
    }

    function bindList() {
        var list = $("lpEligibleList");
        if (list) {
            list.addEventListener("change", function (e) {
                var cb = e.target.closest(".lp-row-check");
                if (!cb) return;
                var id = Number(cb.getAttribute("data-id"));
                if (cb.checked) state.selected.add(id); else state.selected.delete(id);
                updateSelectionUi();
            });
        }
        var all = $("lpSelectAll");
        if (all) {
            all.addEventListener("change", function () {
                // Add/remove only the customers currently shown; other selections stay
                emailable().forEach(function (r) {
                    if (all.checked) state.selected.add(r.id); else state.selected.delete(r.id);
                });
                renderList();
            });
        }
        var send = $("lpSendEmailBtn");
        if (send) send.addEventListener("click", openComposer);
        var search = $("lpSearch");
        if (search) {
            var t = null;
            search.addEventListener("input", function () {
                clearTimeout(t);
                t = setTimeout(function () {
                    state.query = search.value || "";
                    renderList();
                }, 120);
            });
        }
    }

    // ── Composer ──────────────────────────────────────────────────────
    function selectedRows() {
        return state.rows.filter(function (r) { return state.selected.has(r.id); });
    }

    function loadTemplate() {
        try {
            var saved = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || "null");
            if (saved && saved.html) return saved;
        } catch (e) {}
        return { subject: DEFAULT_SUBJECT, html: DEFAULT_HTML };
    }

    function saveTemplate() {
        try {
            localStorage.setItem(TEMPLATE_KEY, JSON.stringify({ subject: $("lpSubject").value, html: currentHtml() }));
        } catch (e) {}
    }

    // Strip scripts / event handlers before HTML is shown in the visual editor
    function sanitize(html) {
        var doc = new DOMParser().parseFromString("<body>" + html + "</body>", "text/html");
        doc.querySelectorAll("script,iframe,object,embed,style[data-unsafe]").forEach(function (n) { n.remove(); });
        doc.body.querySelectorAll("*").forEach(function (el) {
            Array.prototype.slice.call(el.attributes).forEach(function (a) {
                var name = a.name.toLowerCase();
                if (name.indexOf("on") === 0) el.removeAttribute(a.name);
                else if ((name === "href" || name === "src") && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
            });
        });
        return doc.body.innerHTML;
    }

    function currentHtml() {
        return state.mode === "html" ? $("lpHtmlEditor").value : $("lpVisualEditor").innerHTML;
    }

    function setMode(mode) {
        if (mode === state.mode) return;
        var visual = $("lpVisualEditor");
        var html = $("lpHtmlEditor");
        if (mode === "html") {
            html.value = visual.innerHTML;
        } else {
            visual.innerHTML = sanitize(html.value);
        }
        state.mode = mode;
        visual.hidden = mode !== "visual";
        html.hidden = mode !== "html";
        document.querySelectorAll(".lp-tab").forEach(function (t) {
            var on = t.getAttribute("data-lp-mode") === mode;
            t.classList.toggle("is-active", on);
            t.setAttribute("aria-selected", on ? "true" : "false");
        });
        var bar = $("lpFormatBar");
        if (bar) bar.classList.toggle("is-disabled", mode !== "visual");
        hideLinkRow();
        updatePreview();
    }

    // Same substitution as the server (_render_loyalty_template)
    function renderFor(template, row, asHtml) {
        if (!template) return "";
        var name = (row.name || "").trim() || "there";
        var pts = fmtPts(row.points);
        var pkgs;
        if (asHtml) {
            pkgs = '<ul style="margin:8px 0;padding-left:20px;">' + row.packages.map(function (p) {
                return "<li>" + esc(p.name) + " &mdash; " + esc(fmtPts(p.points_cost)) + " points</li>";
            }).join("") + "</ul>";
            name = esc(name);
        } else {
            pkgs = row.packages.map(function (p) { return p.name + " (" + fmtPts(p.points_cost) + " points)"; }).join(", ");
        }
        return template.split("{customer_name}").join(name)
            .split("{current_points}").join(pts)
            .split("{claimable_packages}").join(pkgs);
    }

    var previewTimer = null;
    function updatePreview() {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(function () {
            var rows = selectedRows();
            var pick = $("lpPreviewAs");
            var row = rows.find(function (r) { return String(r.id) === (pick && pick.value); }) || rows[0];
            if (!row) return;
            $("lpPreviewSubject").textContent = renderFor($("lpSubject").value, row, false);
            var body = renderFor(sanitize(currentHtml()), row, true);
            $("lpPreviewFrame").srcdoc =
                '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:16px;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#1f3b47}</style></head><body>' +
                body + "</body></html>";
        }, 120);
    }

    function openComposer() {
        var rows = selectedRows();
        if (!rows.length) return;
        var tpl = loadTemplate();
        $("lpSubject").value = tpl.subject || DEFAULT_SUBJECT;
        state.mode = "visual";
        $("lpVisualEditor").innerHTML = sanitize(tpl.html || DEFAULT_HTML);
        $("lpVisualEditor").hidden = false;
        $("lpHtmlEditor").hidden = true;
        document.querySelectorAll(".lp-tab").forEach(function (t) {
            var on = t.getAttribute("data-lp-mode") === "visual";
            t.classList.toggle("is-active", on);
            t.setAttribute("aria-selected", on ? "true" : "false");
        });
        $("lpFormatBar").classList.remove("is-disabled");
        var names = rows.slice(0, 3).map(function (r) { return r.name || r.email; }).join(", ");
        $("lpComposerRecipients").textContent = "To " + rows.length + " customer" + (rows.length === 1 ? "" : "s") +
            ": " + names + (rows.length > 3 ? " and " + (rows.length - 3) + " more" : "");
        $("lpPreviewAs").innerHTML = rows.map(function (r) {
            return '<option value="' + r.id + '">' + esc(r.name || r.email) + "</option>";
        }).join("");
        var m = $("lpComposerModal");
        m.classList.remove("hidden");
        m.classList.add("flex");
        updatePreview();
        $("lpSubject").focus();
    }

    function closeComposer() {
        saveTemplate();
        hideLinkRow();
        var m = $("lpComposerModal");
        m.classList.add("hidden");
        m.classList.remove("flex");
        var b = $("lpSendEmailBtn");
        if (b) b.focus();
    }

    function isComposerOpen() {
        var m = $("lpComposerModal");
        return !!(m && !m.classList.contains("hidden"));
    }

    // Keep the caret position in the visual editor so toolbar/variable buttons insert there
    document.addEventListener("selectionchange", function () {
        var ed = $("lpVisualEditor");
        var sel = window.getSelection();
        if (!ed || !sel || !sel.rangeCount) return;
        var r = sel.getRangeAt(0);
        if (ed.contains(r.commonAncestorContainer)) state.lastRange = r.cloneRange();
    });

    function restoreCaret() {
        var ed = $("lpVisualEditor");
        ed.focus();
        var sel = window.getSelection();
        sel.removeAllRanges();
        if (state.lastRange && ed.contains(state.lastRange.commonAncestorContainer)) {
            sel.addRange(state.lastRange);
        } else {
            var r = document.createRange();
            r.selectNodeContents(ed);
            r.collapse(false);
            sel.addRange(r);
        }
    }

    function insertVariable(token) {
        if (state.mode === "html") {
            var ta = $("lpHtmlEditor");
            var s = ta.selectionStart, e = ta.selectionEnd;
            ta.setRangeText(token, s, e, "end");
            ta.focus();
        } else {
            restoreCaret();
            document.execCommand("insertText", false, token);
        }
        updatePreview();
    }

    function hideLinkRow() {
        var row = $("lpLinkRow");
        if (row) row.hidden = true;
    }

    function bindComposer() {
        document.querySelectorAll("[data-lp-var]").forEach(function (b) {
            b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // keep caret
            b.addEventListener("click", function () { insertVariable(b.getAttribute("data-lp-var")); });
        });
        document.querySelectorAll(".lp-tab").forEach(function (t) {
            t.addEventListener("click", function () { setMode(t.getAttribute("data-lp-mode")); });
        });
        document.querySelectorAll(".lp-fmt[data-cmd]").forEach(function (b) {
            b.addEventListener("mousedown", function (e) { e.preventDefault(); });
            b.addEventListener("click", function () {
                if (state.mode !== "visual") return;
                var cmd = b.getAttribute("data-cmd");
                if (cmd === "createLink") {
                    var row = $("lpLinkRow");
                    row.hidden = false;
                    $("lpLinkInput").value = "https://";
                    $("lpLinkInput").focus();
                    return;
                }
                restoreCaret();
                document.execCommand(cmd, false, b.getAttribute("data-arg") || null);
                updatePreview();
            });
        });
        $("lpLinkApply").addEventListener("click", function () {
            var url = $("lpLinkInput").value.trim();
            if (/^https?:\/\/\S+/i.test(url)) {
                restoreCaret();
                document.execCommand("createLink", false, url);
                updatePreview();
            }
            hideLinkRow();
        });
        $("lpLinkCancel").addEventListener("click", hideLinkRow);
        $("lpLinkInput").addEventListener("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); $("lpLinkApply").click(); }
        });
        $("lpResetTemplate").addEventListener("click", function () {
            $("lpSubject").value = DEFAULT_SUBJECT;
            if (state.mode === "html") $("lpHtmlEditor").value = DEFAULT_HTML;
            else $("lpVisualEditor").innerHTML = DEFAULT_HTML;
            updatePreview();
        });
        ["lpSubject", "lpHtmlEditor", "lpVisualEditor"].forEach(function (id) {
            $(id).addEventListener("input", updatePreview);
        });
        $("lpPreviewAs").addEventListener("change", updatePreview);
        $("lpComposerSendBtn").addEventListener("click", send);
        $("lpComposerModal").addEventListener("click", function (e) {
            if (e.target.id === "lpComposerModal") closeComposer();
        });
    }

    async function send() {
        var rows = selectedRows();
        var subject = $("lpSubject").value.trim();
        var html = sanitize(currentHtml()).trim();
        if (!rows.length) return;
        if (!subject) { toast("Add a subject first.", "error"); $("lpSubject").focus(); return; }
        if (!html.replace(/<[^>]*>/g, "").trim()) { toast("The email body is empty.", "error"); return; }
        var n = rows.length;
        var ok = typeof window.heigenConfirm === "function"
            ? await window.heigenConfirm("Send this email to " + n + " customer" + (n === 1 ? "" : "s") + "? Each one gets their own points and packages.", {
                title: "Send loyalty email", confirmText: "Send", dangerous: false,
            })
            : true;
        if (!ok) return;
        var btn = $("lpComposerSendBtn");
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        try {
            saveTemplate();
            var res = await window.apiClient.loyalty.sendEmail({
                customer_ids: rows.map(function (r) { return r.id; }),
                subject: subject,
                html_body: html,
            });
            var sent = (res && res.sent_count) || 0;
            var skipped = (res && res.skipped) || [];
            var errors = (res && res.errors) || [];
            closeComposer();
            state.selected.clear();
            await load();
            if (sent) toast("Email sent to " + sent + " customer" + (sent === 1 ? "" : "s") + ".");
            if (skipped.length || errors.length) {
                var lines = skipped.map(function (s) { return "• " + (s.name || "Customer #" + s.id) + ": " + s.reason; })
                    .concat(errors.map(function (e) { return "• " + e; }));
                window.heigenAlert && window.heigenAlert(
                    (sent ? sent + " sent. " : "Nothing was sent. ") + "Not sent to:\n" + lines.slice(0, 12).join("\n") +
                    (lines.length > 12 ? "\n…and " + (lines.length - 12) + " more" : "")
                );
            }
        } catch (e) {
            toast((e && e.message) || "Couldn't send the email.", "error");
        } finally {
            btn.disabled = false;
            btn.removeAttribute("aria-busy");
        }
    }

    window.lpEligible = { load: load, isComposerOpen: isComposerOpen, closeComposer: closeComposer };
    window.closeLoyaltyComposer = closeComposer;

    function init() {
        bindList();
        bindComposer();
        load(); // fills the badge on page load
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
