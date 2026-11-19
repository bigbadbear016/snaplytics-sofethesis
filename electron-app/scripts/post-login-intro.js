/* Post-login intro (shell.html only).
 *
 * Plays once, right after a successful sign-in: a blurred full-screen overlay
 * types "Good morning, <name>" with the user's avatar beneath it while the
 * dashboard loads behind it, then both fly into their resting places (the
 * dashboard greeting and the header avatar) as the blur fades away.
 *
 * Trigger: heigen-app.js sets sessionStorage[FLAG] on a successful login. The
 * flag is removed the moment the intro starts, so reloading, switching pages
 * or clicking Dashboard in the sidebar never replays it.
 *
 * Must be included as the first element inside <body> so the overlay is in
 * place before the shell paints. Styles: styles/ui.css (.hg-intro*).
 */
(function () {
    var FLAG = "hgPostLoginIntro";
    var pending = false;
    try {
        pending = sessionStorage.getItem(FLAG) === "1";
        if (pending) sessionStorage.removeItem(FLAG); // one-shot
    } catch (e) {}
    if (!pending || window.self !== window.top || !document.body) return;

    var reduceMotion = false;
    try { reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

    var TYPE_MS = 42;          // per character
    var MIN_SHOW_MS = 1400;    // never flash the intro away
    var MAX_WAIT_MS = 9000;    // give up waiting for data and continue
    var AVATAR_GRACE_MS = 2500; // wait at most this long for the profile photo
    var FLIGHT_MS = 650;
    var EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

    function readUser() {
        try { return JSON.parse(sessionStorage.getItem("user") || "{}") || {}; } catch (e) { return {}; }
    }

    // Same wording as dashboard.html renderGreeting()
    function greetingText() {
        var h = new Date().getHours();
        var part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
        var u = readUser();
        var name = String(u.first_name || u.username || "").trim();
        return name ? part + ", " + name : part;
    }

    function initials() {
        var u = readUser();
        var full = (u.name || ((u.first_name || "") + " " + (u.last_name || ""))).trim() || u.username || "";
        var parts = full.split(/\s+/).filter(Boolean);
        if (!parts.length) return "";
        var a = parts[0][0] || "";
        var b = parts.length > 1 ? parts[parts.length - 1][0] : "";
        return (a + b).toUpperCase();
    }

    function cachedPhoto() {
        try { return sessionStorage.getItem("profilePhotoUrl") || ""; } catch (e) { return ""; }
    }

    // ── Build overlay ──────────────────────────────────────────────────
    var root = document.documentElement;
    root.classList.add("hg-intro-active");

    var overlay = document.createElement("div");
    overlay.className = "hg-intro";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    var fullText = greetingText();
    overlay.setAttribute("aria-label", fullText);
    overlay.innerHTML =
        '<div class="hg-intro-backdrop"></div>' +
        '<div class="hg-intro-stage">' +
        '  <h2 class="hg-intro-title" aria-hidden="true"><span class="hg-intro-text"></span><span class="hg-intro-caret"></span></h2>' +
        '  <div class="hg-intro-avatar" aria-hidden="true"><span class="hg-intro-initials"></span><img alt="" hidden></div>' +
        '  <p class="hg-intro-sub" aria-hidden="true">Getting your dashboard ready…</p>' +
        "</div>";
    document.body.insertBefore(overlay, document.body.firstChild);

    var titleEl = overlay.querySelector(".hg-intro-title");
    var textEl = overlay.querySelector(".hg-intro-text");
    var caretEl = overlay.querySelector(".hg-intro-caret");
    var avatarEl = overlay.querySelector(".hg-intro-avatar");
    var avatarImg = avatarEl.querySelector("img");
    var initialsEl = avatarEl.querySelector(".hg-intro-initials");
    var subEl = overlay.querySelector(".hg-intro-sub");
    var backdrop = overlay.querySelector(".hg-intro-backdrop");

    initialsEl.textContent = initials();
    function setAvatar(src) {
        if (!src || avatarImg.getAttribute("src") === src) return;
        avatarImg.onload = function () { avatarImg.hidden = false; initialsEl.hidden = true; };
        avatarImg.src = src;
    }
    setAvatar(cachedPhoto());

    // ── Typewriter ─────────────────────────────────────────────────────
    var typedDone = false;
    var typedDeferred = Promise.withResolvers();
    var typedResolve = typedDeferred.resolve;
    var typed = typedDeferred.promise;
    (function type(i) {
        if (reduceMotion) { textEl.textContent = fullText; typedDone = true; typedResolve(); return; }
        textEl.textContent = fullText.slice(0, i);
        if (i >= fullText.length) {
            typedDone = true;
            setTimeout(typedResolve, 250);
            return;
        }
        setTimeout(function () { type(i + 1); }, i === 0 ? 220 : TYPE_MS);
    })(0);
    requestAnimationFrame(function () { overlay.classList.add("is-in"); });

    // ── Wait for the dashboard behind the overlay ──────────────────────
    function frameDoc() {
        var f = document.getElementById("staffFrame");
        try { return f && f.contentDocument; } catch (e) { return null; }
    }
    function targets() {
        var f = document.getElementById("staffFrame");
        var d = frameDoc();
        if (!f || !d) return null;
        return {
            frame: f,
            title: d.getElementById("hgGreetingTitle"),
            avatar: d.querySelector(".header [data-user-avatar]"),
            doc: d,
        };
    }
    function dashboardReady() {
        var t = targets();
        if (!t || t.doc.readyState !== "complete") return false;
        var kpi = t.doc.getElementById("kpiBookings");
        if (kpi && kpi.querySelector(".hg-skel")) return false; // KPIs still loading
        // Give the profile photo a moment to arrive, but never block on it
        var av = t.avatar;
        if (av && (!av.getAttribute("src") || !av.complete) && Date.now() - started < AVATAR_GRACE_MS) return false;
        return true;
    }
    var started = Date.now();
    var ready = new Promise(function (resolve) {
        (function poll() {
            var t = targets();
            if (t && t.avatar && t.avatar.getAttribute("src")) setAvatar(t.avatar.getAttribute("src"));
            if (dashboardReady() || Date.now() - started > MAX_WAIT_MS) { resolve(); return; }
            setTimeout(poll, 120);
        })();
    });
    var minShow = new Promise(function (r) { setTimeout(r, MIN_SHOW_MS); });

    var finished = false;
    Promise.all([typed, ready, minShow]).then(finish);
    // Click anywhere to skip
    overlay.addEventListener("click", function () { if (typedDone) finish(); });

    // ── Fly into place ─────────────────────────────────────────────────
    function rectInShell(el, frame) {
        var r = el.getBoundingClientRect();
        var fr = frame.getBoundingClientRect();
        return { left: fr.left + r.left, top: fr.top + r.top, width: r.width, height: r.height };
    }
    function visibleInFrame(el, frame) {
        if (!el) return false;
        var r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        var fr = frame.getBoundingClientRect();
        return r.bottom > 0 && r.top < fr.height;
    }

    function flyTo(el, source, target, scale, extra) {
        var dx = target.left + target.width / 2 - (source.left + source.width / 2);
        var dy = target.top + target.height / 2 - (source.top + source.height / 2);
        var from = { transform: "translate(0px, 0px) scale(1)" };
        var to = { transform: "translate(" + dx + "px, " + dy + "px) scale(" + scale + ")" };
        if (extra) { for (var k in extra.from) from[k] = extra.from[k]; for (var j in extra.to) to[j] = extra.to[j]; }
        return el.animate([from, to], { duration: FLIGHT_MS, easing: EASE, fill: "forwards" }).finished;
    }

    function finish() {
        if (finished) return;
        finished = true;
        textEl.textContent = fullText;
        caretEl.style.display = "none";
        subEl.classList.add("is-out");

        var t = targets();
        var hidden = [];
        function hideTarget(el) { if (el) { el.style.visibility = "hidden"; hidden.push(el); } }
        function restore() { hidden.forEach(function (el) { el.style.visibility = ""; }); }

        var flights = [];
        if (!reduceMotion && t && typeof titleEl.animate === "function") {
            // Use the dashboard's own wording if it differs (e.g. hour rolled over)
            if (t.title && t.title.textContent.trim()) textEl.textContent = t.title.textContent.trim();

            if (visibleInFrame(t.title, t.frame)) {
                var src = titleEl.getBoundingClientRect();
                var dst = rectInShell(t.title, t.frame);
                var cs = t.doc.defaultView.getComputedStyle(t.title);
                var scale = parseFloat(cs.fontSize) / parseFloat(getComputedStyle(titleEl).fontSize) || 1;
                // Target box is block-level; align to its text, not its full width
                var textW = src.width * scale;
                var target = { left: dst.left, top: dst.top, width: textW, height: dst.height };
                hideTarget(t.title);
                flights.push(flyTo(titleEl, src, target, scale, {
                    from: { color: getComputedStyle(titleEl).color },
                    to: { color: cs.color },
                }));
            } else {
                flights.push(titleEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" }).finished);
            }

            if (visibleInFrame(t.avatar, t.frame)) {
                var asrc = avatarEl.getBoundingClientRect();
                var adst = rectInShell(t.avatar, t.frame);
                hideTarget(t.avatar);
                flights.push(flyTo(avatarEl, asrc, adst, adst.width / asrc.width));
            } else {
                flights.push(avatarEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" }).finished);
            }
        }

        // Blur fades away alongside the flight
        overlay.classList.add("is-leaving");
        var fade = backdrop.animate
            ? backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
                  duration: reduceMotion ? 200 : FLIGHT_MS,
                  easing: "ease",
                  fill: "forwards",
              }).finished
            : Promise.resolve();
        if (reduceMotion || !flights.length) {
            flights.push(overlay.animate
                ? overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" }).finished
                : Promise.resolve());
        }

        var cleaned = false;
        function cleanup() {
            if (cleaned) return;
            cleaned = true;
            restore();
            // Swap on the next frame so the real elements take over seamlessly
            requestAnimationFrame(function () {
                overlay.remove();
                root.classList.remove("hg-intro-active");
                try { sessionStorage.setItem("hgPostLoginIntroDone", String(Date.now())); } catch (e) {}
            });
        }
        Promise.all(flights.concat(fade)).then(cleanup, cleanup);
        setTimeout(cleanup, FLIGHT_MS + 600); // safety net
    }
})();
