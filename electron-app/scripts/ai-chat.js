// Floating "Ask AI" assistant (ADMIN/OWNER only). Needs api-client.js and staff-auth.js.
// Topic tabs pick which data the AI gets (any topic works from any page); each topic keeps
// its own conversation until "New chat".
// All AI text is rendered with textContent (never innerHTML).
(function initAiChat() {
    if (!window.staffAuth?.isAdminOrOwner() || !window.apiClient?.ai) return;

    // Per-topic tab label, title, greeting and starter questions; the key picks the server data.
    const PAGES = {
        dashboard: {
            tab: "Business",
            title: "Business assistant",
            greeting: "Hi! Ask me about bookings, revenue trends, best and worst sellers, or what to focus on next.",
            chips: [
                "How did bookings and revenue trend this year?",
                "Which packages sell best and worst?",
                "What should I focus on next month?",
            ],
        },
        packages: {
            tab: "Packages",
            title: "Package advisor",
            greeting: "Hi! Ask me about your packages and add-ons, or ask me to design a new package.",
            chips: [
                "Which add-ons pair best with our top package?",
                "Which packages are underperforming?",
                "Generate a barkada package for 5-6 friends",
            ],
        },
        // Server sends customer IDs and stats only: no names, emails, or contact details.
        customers: {
            tab: "Customers",
            title: "Customer insights",
            greeting: "Hi! Ask me about retention, repeat customers, who to win back, or where customers come from. I only see customer IDs, not names or contact details.",
            chips: [
                "What is our repeat customer rate?",
                "Which high-value customers should we win back?",
                "Which acquisition source brings the best customers?",
            ],
        },
        coupons: {
            tab: "Coupons",
            title: "Coupon assistant",
            greeting: "Hi! Ask me which coupons work, which to retire, or for a new promo idea.",
            chips: [
                "Which coupons are actually being used?",
                "Which coupons should I retire or extend?",
                "Suggest a coupon for our slowest month",
            ],
        },
    };
    let topic = document.currentScript?.dataset.page in PAGES ? document.currentScript.dataset.page : "packages";
    // topic -> { history: [{role, content}], log: element }; created on first visit
    const chats = {};
    const css = document.createElement("style");
    css.textContent = `
      #aiChatFab { position: fixed; right: 20px; bottom: 20px; z-index: 50; border-radius: 999px;
        padding: 12px 18px; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
      #aiChatPanel { position: fixed; inset: auto 20px 76px auto; margin: 0; width: min(400px, calc(100vw - 40px));
        height: min(600px, calc(100vh - 120px)); padding: 0; border: 1px solid #d9e2e6; border-radius: 16px;
        box-shadow: 0 16px 40px rgba(0,0,0,.2); overflow: hidden; }
      #aiChatPanel:popover-open { display: flex; flex-direction: column; }
      .ai-chat-log { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
      .ai-chat-log[hidden], .ai-chips[hidden] { display: none; }
      .ai-msg { max-width: 88%; padding: 9px 12px; border-radius: 12px; font-size: 14px; line-height: 1.5;
        white-space: pre-wrap; overflow-wrap: anywhere; }
      .ai-msg.user { align-self: flex-end; background: #244855; color: #fff; }
      .ai-msg.assistant { align-self: flex-start; background: rgba(36,72,85,.08); }
      .ai-draft { align-self: stretch; border: 1px dashed #244855; border-radius: 12px; padding: 12px; font-size: 13px; }
      .ai-draft h4 { margin: 0 0 4px; font-size: 15px; font-weight: 700; }
      .ai-draft ul { margin: 6px 0; padding-left: 18px; list-style: disc; }
      .ai-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 10px; }
      .ai-chips button { font-size: 12px; padding: 5px 10px; border-radius: 999px; }
      .ai-tabs { display: flex; gap: 4px; padding: 8px 10px; border-bottom: 1px solid var(--heigen-border-ui, #d9e2e6); }
      .ai-tabs button { flex: 1; padding: 6px 4px; border-radius: 8px; font-size: 12px; font-weight: 600;
        color: var(--heigen-text-muted, #5f6e79); transition: background-color .15s, color .15s; }
      .ai-tabs button:hover { background: color-mix(in srgb, var(--heigen-teal, #165166) 7%, transparent); }
      .ai-tabs button[aria-pressed="true"] { color: var(--heigen-teal, #165166);
        background: color-mix(in srgb, var(--heigen-teal, #165166) 13%, transparent); }
      .ai-tabs button:focus-visible, .ai-head-btn:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
      .ai-head-btn { color: #fff; font-size: 12px; font-weight: 600; padding: 4px 8px; border-radius: 8px; }
      .ai-head-btn:hover { background: rgba(255,255,255,.14); }
      .ai-head-btn:disabled { opacity: .5; cursor: not-allowed; background: none; }
    `;
    document.head.append(css);

    const fab = document.createElement("button");
    fab.id = "aiChatFab";
    fab.type = "button";
    fab.className = "staff-btn-primary";
    fab.textContent = "✨ Ask AI";
    fab.setAttribute("popovertarget", "aiChatPanel");

    const panel = document.createElement("div");
    panel.id = "aiChatPanel";
    panel.popover = "manual";
    panel.className = "heigen-surface";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "AI assistant");

    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:6px;padding:10px 10px 10px 14px;background:#244855;color:#fff;";
    const title = document.createElement("strong");
    title.style.flex = "1";
    const newChat = document.createElement("button");
    newChat.type = "button";
    newChat.className = "ai-head-btn";
    newChat.textContent = "+ New chat";
    newChat.title = "Clear this conversation and start over";
    newChat.addEventListener("click", () => {
        chats[topic].log.remove();
        delete chats[topic];
        showTopic(topic);
    });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ai-head-btn";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Close");
    close.style.fontSize = "15px";
    close.setAttribute("popovertarget", "aiChatPanel");
    close.setAttribute("popovertargetaction", "hide");
    head.append(title, newChat, close);

    // Topic switcher: which assistant (and which studio data) the next question goes to.
    const tabs = document.createElement("div");
    tabs.className = "ai-tabs";
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Assistant topic");
    for (const key of Object.keys(PAGES)) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.topic = key;
        b.textContent = PAGES[key].tab;
        b.addEventListener("click", () => showTopic(key));
        tabs.append(b);
    }

    // One log per topic lives in this slot; only the active topic's log is shown.
    const logSlot = document.createElement("div");
    logSlot.style.cssText = "flex:1;min-height:0;display:flex;flex-direction:column;";

    const chips = document.createElement("div");
    chips.className = "ai-chips";

    const form = document.createElement("form");
    form.style.cssText = "display:flex;gap:8px;padding:10px 14px;border-top:1px solid #d9e2e6;";
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 1500;
    input.required = true;
    input.placeholder = "Ask anything about the studio…";
    input.className = "staff-input heigen-field";
    input.style.cssText = "flex:1;height:38px;border-radius:8px;padding:0 10px;font-size:14px;";
    const sendBtn = document.createElement("button");
    sendBtn.type = "submit";
    sendBtn.className = "staff-btn-primary";
    sendBtn.style.cssText = "padding:0 14px;border-radius:8px;";
    sendBtn.textContent = "Send";
    form.append(input, sendBtn);
    form.addEventListener("submit", (e) => {
        e.preventDefault();
        send(input.value);
    });

    const disclaimer = document.createElement("p");
    disclaimer.className = "ai-disclaimer";
    disclaimer.style.cssText = "padding:0 14px 10px;";
    disclaimer.textContent = "AI-generated. It can make mistakes, so check it before you use it.";

    panel.append(head, tabs, logSlot, chips, form, disclaimer);
    document.body.append(fab, panel);
    showTopic(topic);

    function showTopic(key) {
        topic = key;
        const page = PAGES[key];
        title.textContent = page.title;
        for (const b of tabs.children) b.setAttribute("aria-pressed", String(b.dataset.topic === key));
        if (!chats[key]) {
            const log = document.createElement("div");
            log.className = "ai-chat-log";
            log.setAttribute("aria-live", "polite");
            chats[key] = { history: [], log };
            logSlot.append(log);
            addMessage(log, "assistant", page.greeting);
        }
        for (const t of Object.keys(chats)) chats[t].log.hidden = t !== key;
        // Starter questions only until the first question in this topic.
        chips.replaceChildren();
        chips.hidden = chats[key].history.length > 0;
        for (const q of page.chips) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "staff-btn-secondary";
            b.textContent = q;
            b.addEventListener("click", () => send(q));
            chips.append(b);
        }
        input.placeholder = `Ask the ${page.title.toLowerCase()}…`;
    }

    function addMessage(log, role, text) {
        const div = document.createElement("div");
        div.className = `ai-msg ${role}`;
        div.textContent = text;
        log.append(div);
        log.scrollTop = log.scrollHeight;
        return div;
    }

    function addDraft(log, draft) {
        const card = document.createElement("div");
        card.className = "ai-draft";
        const h = document.createElement("h4");
        h.textContent = `Package idea · ₱${Number(draft.price).toLocaleString("en-PH")}`;
        card.append(h);

        // Owner can rename before creating (e.g. when the name or category is taken).
        const field = (label, value) => {
            const wrap = document.createElement("label");
            wrap.style.cssText = "display:block;margin-top:6px;font-size:12px;";
            wrap.textContent = label;
            const input = document.createElement("input");
            input.type = "text";
            input.value = value;
            input.maxLength = label === "Name" ? 120 : 60;
            input.className = "staff-input heigen-field";
            input.style.cssText = "display:block;width:100%;height:32px;border-radius:6px;padding:0 8px;font-size:13px;margin-top:2px;";
            wrap.append(input);
            card.append(wrap);
            return input;
        };
        const nameInput = field("Name", draft.name);
        const categoryInput = field(draft.new_category ? "Category (new)" : "Category", draft.category);
        if (draft.max_people) {
            const meta = document.createElement("div");
            meta.style.marginTop = "6px";
            meta.textContent = `Up to ${draft.max_people} people`;
            card.append(meta);
        }

        const list = (label, items) => {
            if (!items?.length) return;
            const p = document.createElement("div");
            p.style.marginTop = "6px";
            p.textContent = label;
            const ul = document.createElement("ul");
            for (const it of items) {
                const li = document.createElement("li");
                li.textContent = it;
                ul.append(li);
            }
            card.append(p, ul);
        };
        list("Inclusions", draft.inclusions);
        list("Freebies", draft.freebies);
        list("Suggested add-ons", draft.suggested_addons);

        const warn = document.createElement("div");
        warn.setAttribute("role", "alert");
        warn.style.cssText = "margin-top:8px;color:#b42318;font-size:12px;font-weight:600;";
        warn.textContent = draft.conflict || "";
        warn.hidden = !draft.conflict;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "staff-btn-primary";
        btn.style.cssText = "margin-top:8px;padding:8px 14px;border-radius:8px;font-size:13px;";
        btn.textContent = "Create as hidden package";
        // Editing the name/category clears the old warning; the server re-checks on create.
        for (const input of [nameInput, categoryInput]) {
            input.addEventListener("input", () => {
                warn.hidden = true;
            });
        }
        btn.addEventListener("click", async () => {
            btn.disabled = true;
            warn.hidden = true;
            try {
                const res = await window.apiClient.ai.packageCreate({
                    ...draft,
                    name: nameInput.value.trim(),
                    category: categoryInput.value.trim(),
                });
                nameInput.disabled = categoryInput.disabled = true;
                btn.textContent = res.category_created
                    ? `Saved (archived): Packages → Archived categories → ${res.category}`
                    : `Saved as archived: Packages → ${res.category} → Archived packages`;
            } catch (err) {
                btn.disabled = false;
                warn.textContent = err.message || "Could not create the package.";
                warn.hidden = false;
            }
        });
        card.append(warn, btn);
        log.append(card);
        log.scrollTop = log.scrollHeight;
    }

    async function send(text) {
        const content = String(text || "").trim();
        if (!content || sendBtn.disabled) return;
        // Capture this topic's chat: the reply lands here even if the owner switches tabs meanwhile.
        const key = topic;
        const { history, log } = chats[key];
        input.value = "";
        chips.hidden = true;
        addMessage(log, "user", content);
        history.push({ role: "user", content });
        sendBtn.disabled = newChat.disabled = true;
        const thinking = addMessage(log, "assistant", "Thinking…");
        try {
            const { reply, package_draft } = await window.apiClient.ai.packageChat(history.slice(-8), key);
            thinking.textContent = reply;
            history.push({ role: "assistant", content: reply.slice(0, 1500) });
            if (package_draft) addDraft(log, package_draft);
        } catch (_) {
            history.pop(); // let the owner retry the same question
            thinking.textContent = window.apiClient.ai.unavailableLine();
        } finally {
            sendBtn.disabled = newChat.disabled = false;
            input.focus();
        }
    }
})();
