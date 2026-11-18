/* Logout farewell — the reverse of post-login-intro.js.
 *
 * Phase 1 (shell.html, window.heigenStartLogoutOutro):
 *   blur comes up → header avatar flies to the centre → "See you soon, <name>."
 *   starts typing → session is cleared → the page is replaced by the login page
 *   while the typing is still running.
 * Phase 2 (index.html, runs automatically when the hand-off key is present):
 *   the identical overlay is drawn on the first frame, typing continues from the
 *   same character, then the blur fades away to reveal the sign-in page.
 *
 * The hand-off lives in sessionStorage[HANDOFF] and is removed as soon as the
 * login page reads it, so it can never replay. Navigation uses
 * location.replace(), so Back cannot return to the dashboard; staff-guard.js
 * also bounces any staff page without a token.
 *
 * Include this script as the first element inside <body> on index.html (so the
 * overlay paints before the form) and anywhere in shell.html.
 * Styles: styles/ui.css (.hg-intro* shared with the login intro, .hg-outro*).
 */
(function () {
    var HANDOFF = "hgLogoutOutro";
    var TYPE_MS = 55;            // per character (~1.1 s for a short name)
    var FLIGHT_MS = 600;
    var HOLD_MS = 450;           // pause on the finished line before revealing
    var REVEAL_MS = 550;
    var EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
    var SESSION_KEYS = [
        "authToken", "user", "needsProfileSetup", "profilePhotoUrl",
        "heigen_staff_profile_get_cache_v1", "hgPostLoginIntro",
    ];

    var reduceMotion = false;
    try { reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

    function buildOverlay(text, sub) {
        var overlay = document.createElement("div");
        overlay.className = "hg-intro hg-outro";
        overlay.setAttribute("role", "status");
        overlay.setAttribute("aria-live", "polite");
        overlay.setAttribute("aria-label", text + " " + sub);
        overlay.innerHTML =
            '<div class="hg-intro-backdrop"></div>' +
            '<div class="hg-intro-stage">' +
            '  <h2 class="hg-intro-title" aria-hidden="true"><span class="hg-intro-text"></span><span class="hg-intro-caret"></span></h2>' +
            '  <p class="hg-intro-sub" aria-hidden="true"></p>' +
            '  <div class="hg-intro-avatar" aria-hidden="true"><span class="hg-intro-initials"></span><img alt="" hidden></div>' +
            "</div>";
        overlay.querySelector(".hg-intro-sub").textContent = sub;
        return {
            root: overlay,
            backdrop: overlay.querySelector(".hg-intro-backdrop"),
            stage: overlay.querySelector(".hg-intro-stage"),
            text: overlay.querySelector(".hg-intro-text"),
            caret: overlay.querySelector(".hg-intro-caret"),
            avatar: overlay.querySelector(".hg-intro-avatar"),
            img: overlay.querySelector(".hg-intro-avatar img"),
            initials: overlay.querySelector(".hg-intro-initials"),
        };
    }

    function setAvatar(ui, src, initials) {
        ui.initials.textContent = initials || "";
        if (!src) return;
        ui.img.onload = function () { ui.img.hidden = false; ui.initials.hidden = true; };
        ui.img.onerror = function () { ui.img.hidden = true; ui.initials.hidden = false; };
        ui.img.src = src;
    }

    /** Types text[from..] into el; resolves when done. Returns {promise, count()} */
    function typeFrom(el, text, from, startDelay) {
        var i = from;
        var timer = null;
        var promise = new Promise(function (resolve) {
            function step() {
                el.textContent = text.slice(0, i);
                if (i >= text.length) { resolve(); return; }
                i += 1;
                timer = setTimeout(step, TYPE_MS);
            }
            if (reduceMotion) { i = text.length; el.textContent = text; resolve(); return; }
            el.textContent = text.slice(0, i);
            timer = setTimeout(step, startDelay || 0);
        });
        return {
            promise: promise,
            count: function () { return i; },
            stop: function () { clearTimeout(timer); },
        };
    }

    function readUser() {
        try { return JSON.parse(sessionStorage.getItem("user") || "{}") || {}; } catch (e) { return {}; }
    }

    function initialsOf(u) {
        var full = (u.name || ((u.first_name || "") + " " + (u.last_name || ""))).trim() || u.username || "";
        var parts = full.split(/\s+/).filter(Boolean);
        if (!parts.length) return "";
        return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
    }

    // ── Phase 1: shell ─────────────────────────────────────────────────
    var started = false;

    function startLogoutOutro(opts) {
        if (started) return;
        started = true;
        opts = opts || {};
        var loginUrl = opts.loginUrl || new URL("../../index.html", window.location.href).href;

        // Capture everything we need BEFORE the session is cleared
        var u = readUser();
        var name = String(u.first_name || u.username || "").trim();
        var text = name ? "See you soon, " + name + "." : "See you soon.";
        var sub = "Signing you out safely... :D";
        var initials = initialsOf(u);

        var frame = document.getElementById("staffFrame");
        var headerAvatar = null;
        try { headerAvatar = frame && frame.contentDocument.querySelector(".header [data-user-avatar]"); } catch (e) {}
        var avatarSrc = (headerAvatar && headerAvatar.complete && headerAvatar.naturalWidth > 0 && headerAvatar.currentSrc) || "";

        var ui = buildOverlay(text, sub);
        setAvatar(ui, avatarSrc, initials);
        document.body.appendChild(ui.root);
        document.documentElement.classList.add("hg-intro-active");

        // Sign out now: the API call reads the token synchronously, then we clear it
        var apiDone = Promise.resolve();
        try {
            if (typeof API !== "undefined" && API.logout) apiDone = API.logout().catch(function () {});
        } catch (e) {}
        SESSION_KEYS.forEach(function (k) { try { sessionStorage.removeItem(k); } catch (e) {} });

        // Blur in + avatar flight from the header into the centre (FLIP)
        var flight = Promise.resolve();
        var flew = false;
        if (!reduceMotion && ui.root.animate) {
            ui.backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "ease", fill: "both" });
            ui.stage.style.transition = "none";
            ui.stage.style.opacity = "1";
            ui.stage.style.transform = "none";
            ui.title = ui.root.querySelector(".hg-intro-title");
            ui.title.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, delay: 120, fill: "both" });
            ui.root.querySelector(".hg-intro-sub").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, delay: 260, fill: "both" });

            var end = ui.avatar.getBoundingClientRect();
            if (headerAvatar && frame) {
                var fr = frame.getBoundingClientRect();
                var r = headerAvatar.getBoundingClientRect();
                if (r.width > 0) {
                    var sx = fr.left + r.left + r.width / 2, sy = fr.top + r.top + r.height / 2;
                    var ex = end.left + end.width / 2, ey = end.top + end.height / 2;
                    var s = r.width / end.width;
                    headerAvatar.style.visibility = "hidden";
                    flew = true;
                    flight = ui.avatar.animate([
                        { transform: "translate(" + (sx - ex) + "px," + (sy - ey) + "px) scale(" + s + ")" },
                        { transform: "translate(0,0) scale(1)" },
                    ], { duration: FLIGHT_MS, easing: EASE, fill: "both" }).finished;
                }
            }
            if (!flew) { // no header avatar on screen: just scale it in
                flight = ui.avatar.animate([{ opacity: 0, transform: "scale(0.85)" }, { opacity: 1, transform: "none" }],
                    { duration: 400, easing: EASE, fill: "both" }).finished;
            }
        } else {
            ui.root.classList.add("is-in");
        }

        var typing = typeFrom(ui.text, text, 0, reduceMotion ? 0 : 260);

        // Hand off to the login page while the line is still typing
        var apiCap = new Promise(function (r) { setTimeout(r, 900); });
        Promise.all([flight.catch(function () {}), Promise.race([apiDone, apiCap])]).then(function () {
            typing.stop();
            try {
                sessionStorage.setItem(HANDOFF, JSON.stringify({
                    text: text,
                    sub: sub,
                    typed: typing.count(),
                    avatar: avatarSrc.length < 1500000 ? avatarSrc : "",
                    initials: initials,
                    at: Date.now(),
                }));
            } catch (e) {}
            window.location.replace(loginUrl);
        });
    }
    window.heigenStartLogoutOutro = startLogoutOutro;

    // ── Phase 2: login page ────────────────────────────────────────────
    function resumeOnLoginPage() {
        if (window.self !== window.top || !document.body) return;
        var data = null;
        try {
            var raw = sessionStorage.getItem(HANDOFF);
            if (raw) { sessionStorage.removeItem(HANDOFF); data = JSON.parse(raw); }
        } catch (e) {}
        if (!data || !data.text || Date.now() - (data.at || 0) > 15000) return;

        var ui = buildOverlay(data.text, data.sub || "");
        ui.root.classList.add("is-in", "hg-outro--resume");
        setAvatar(ui, data.avatar, data.initials);
        document.body.insertBefore(ui.root, document.body.firstChild);
        document.documentElement.classList.add("hg-intro-active");

        var typing = typeFrom(ui.text, data.text, Math.min(data.typed || 0, data.text.length), TYPE_MS);
        var revealed = false;
        function reveal() {
            if (revealed) return;
            revealed = true;
            typing.stop();
            ui.text.textContent = data.text;
            ui.caret.style.display = "none";
            var done = function () {
                ui.root.remove();
                document.documentElement.classList.remove("hg-intro-active");
                var field = document.getElementById("login-email");
                if (field) try { field.focus({ preventScroll: true }); } catch (e) {}
            };
            if (reduceMotion || !ui.root.animate) {
                ui.root.style.transition = "opacity 0.2s ease";
                ui.root.style.opacity = "0";
                setTimeout(done, 220);
                return;
            }
            ui.stage.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-6px) scale(0.98)" }],
                { duration: REVEAL_MS * 0.7, easing: "ease", fill: "forwards" });
            ui.backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REVEAL_MS, easing: "ease", fill: "forwards" })
                .finished.then(done, done);
            setTimeout(done, REVEAL_MS + 300); // safety net
        }
        typing.promise.then(function () { setTimeout(reveal, HOLD_MS); });
        ui.root.addEventListener("click", reveal);
    }

    resumeOnLoginPage();
})();
