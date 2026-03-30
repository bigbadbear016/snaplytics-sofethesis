// scripts/coupon-api.js – Coupon CRUD and Send
let coupons = [];
let editingId = null;
let sendCouponId = null;
let allCustomers = [];
let selectedCustomerIds = new Set();
let sendFilteredCustomers = [];
let selectedEmailPresetId = null;

const SEND_FILTER_IDS = {
    risk: "sendFilterRenewalRisk",
    booking: "sendFilterBookingActivity",
    dateFrom: "sendFilterDateFrom",
    dateTo: "sendFilterDateTo",
};

/** Applied list filters (updated on Apply filters in Send modal). */
let sendAppliedFilterState = null;
let sendAppliedSearch = "";

const EMAIL_PRESETS_KEY = "heigen_coupon_email_presets_v1";

function showToast(msg, type = "success") {
    const toast = document.getElementById("toast");
    if (toast) {
        toast.textContent = msg;
        toast.className = `toast toast-${type}`;
        toast.style.display = "block";
        setTimeout(() => { toast.style.display = "none"; }, 3000);
    } else {
        alert(msg);
    }
}

async function loadCoupons() {
    const loading = document.getElementById("listLoading");
    const table = document.getElementById("couponsTable");
    const body = document.getElementById("couponsBody");
    loading.classList.remove("hidden");
    table.classList.add("hidden");
    try {
        coupons = await window.apiClient.coupons.list();
        body.innerHTML = coupons.map((c) => {
            const expires = c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "—";
            const maxDisc = c.max_discount_amount != null ? `₱${Number(c.max_discount_amount).toLocaleString()}` : "—";
            const val = c.discount_type === "percent" ? `${c.discount_value}%` : `₱${Number(c.discount_value).toLocaleString()}`;
            return `
                <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="px-4 py-3 font-semibold">${escapeHtml(c.code)}</td>
                    <td class="px-4 py-3">${c.discount_type}</td>
                    <td class="px-4 py-3">${val}</td>
                    <td class="px-4 py-3">${c.use_limit ?? "—"}</td>
                    <td class="px-4 py-3">${maxDisc}</td>
                    <td class="px-4 py-3">${expires}</td>
                    <td class="px-4 py-3">${c.times_used ?? 0}</td>
                    <td class="px-4 py-3 whitespace-nowrap">
                        <button onclick="openEditModal(${c.id})" class="text-[#165166] hover:underline text-xs mr-2">Edit</button>
                        <button onclick="openHistoryModal(${c.id})" class="text-[#165166] hover:underline text-xs mr-2">History</button>
                        <button onclick="openSendModal(${c.id})" class="text-[#165166] hover:underline text-xs mr-2">Send</button>
                        <button onclick="deleteCoupon(${c.id})" class="text-red-600 hover:underline text-xs">Delete</button>
                    </td>
                </tr>`;
        }).join("");
        loading.classList.add("hidden");
        table.classList.remove("hidden");
    } catch (e) {
        loading.classList.add("hidden");
        showToast(e.message || "Failed to load coupons", "error");
    }
}

function escapeHtml(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}

/** Renewal column: API sends 0..1 from Snaplytics. */
function formatSendRenewalDisplay(c) {
    const p = Number(c.renewalRate);
    if (Number.isNaN(p)) return "—";
    return `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
}

function formatSendBookingsCount(c) {
    const n = c.bookings;
    if (n == null || Number.isNaN(Number(n))) return "0";
    return String(Math.max(0, Math.floor(Number(n))));
}

function toggleCodeMode(mode) {
    const input = document.getElementById("couponCode");
    const btn = document.getElementById("generateCodeBtn");
    if (mode === "manual") {
        input.disabled = false;
        input.placeholder = "e.g. WELCOMEBACK20";
        input.value = "";
        btn.classList.add("hidden");
    } else {
        input.disabled = false;
        input.placeholder = "Click Generate to create a code";
        btn.classList.remove("hidden");
        if (!input.value) generateRandomCode();
    }
}

function generateRandomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    document.getElementById("couponCode").value = code;
}

function openCreateModal() {
    editingId = null;
    document.getElementById("couponModalTitle").textContent = "Create Coupon";
    document.getElementById("couponCode").value = "";
    document.getElementById("couponCode").disabled = false;
    document.getElementById("codeModeOptions").style.display = "flex";
    document.querySelector('input[name="codeMode"][value="manual"]').checked = true;
    toggleCodeMode("manual");
    document.getElementById("couponDiscountType").value = "percent";
    document.getElementById("couponDiscountValue").value = "";
    document.getElementById("couponUseLimit").value = "";
    document.getElementById("couponMaxDiscount").value = "";
    document.getElementById("couponExpires").value = "";
    document.getElementById("couponModal").classList.remove("hidden");
    document.getElementById("couponModal").classList.add("flex");
}

function openEditModal(id) {
    const c = coupons.find((x) => x.id === id);
    if (!c) return;
    editingId = id;
    document.getElementById("couponModalTitle").textContent = "Edit Coupon";
    document.getElementById("couponCode").value = c.code;
    document.getElementById("couponCode").disabled = true;
    document.getElementById("codeModeOptions").style.display = "none";
    document.getElementById("generateCodeBtn").classList.add("hidden");
    document.getElementById("couponDiscountType").value = c.discount_type;
    document.getElementById("couponDiscountValue").value = c.discount_value;
    document.getElementById("couponUseLimit").value = c.use_limit ?? "";
    document.getElementById("couponMaxDiscount").value = c.max_discount_amount ?? "";
    document.getElementById("couponExpires").value = c.expires_at ? c.expires_at.slice(0, 16) : "";
    document.getElementById("couponModal").classList.remove("hidden");
    document.getElementById("couponModal").classList.add("flex");
}

function closeCouponModal() {
    document.getElementById("couponModal").classList.add("hidden");
    document.getElementById("couponModal").classList.remove("flex");
}

async function saveCoupon() {
    const code = document.getElementById("couponCode").value.trim();
    const discountType = document.getElementById("couponDiscountType").value;
    const discountValue = parseFloat(document.getElementById("couponDiscountValue").value);
    const useLimit = document.getElementById("couponUseLimit").value.trim();
    const maxDiscount = document.getElementById("couponMaxDiscount").value.trim();
    const expires = document.getElementById("couponExpires").value;

    if (!code) {
        showToast("Code is required", "error");
        return;
    }
    if (isNaN(discountValue) || discountValue <= 0) {
        showToast("Valid discount value is required", "error");
        return;
    }

    const data = {
        code,
        discount_type: discountType,
        discount_value: discountValue,
        use_limit: useLimit ? parseInt(useLimit, 10) : null,
        max_discount_amount: maxDiscount ? parseFloat(maxDiscount) : null,
        expires_at: expires ? new Date(expires).toISOString() : null,
    };

    const btn = document.getElementById("couponSaveBtn");
    btn.disabled = true;
    try {
        if (editingId) {
            await window.apiClient.coupons.update(editingId, data);
            showToast("Coupon updated");
        } else {
            await window.apiClient.coupons.create(data);
            showToast("Coupon created");
        }
        closeCouponModal();
        loadCoupons();
    } catch (e) {
        showToast(e.message || "Failed to save", "error");
    } finally {
        btn.disabled = false;
    }
}

async function deleteCoupon(id) {
    const c = coupons.find((x) => x.id === id);
    const label = c ? c.code : String(id);
    if (!confirm(`Delete coupon "${label}"?`)) return;
    try {
        await window.apiClient.coupons.remove(id);
        showToast("Coupon deleted");
        loadCoupons();
    } catch (e) {
        showToast(e.message || "Failed to delete", "error");
    }
}

function formatCouponDateTime(iso) {
    if (!iso) return "—";
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return "—";
        return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch (_) {
        return "—";
    }
}

async function openHistoryModal(id) {
    const c = coupons.find((x) => x.id === id);
    if (!c) return;
    document.getElementById("historyModalTitle").textContent = `Coupon history — ${c.code}`;
    document.getElementById("historyModal").classList.remove("hidden");
    document.getElementById("historyModal").classList.add("flex");
    document.getElementById("historyLoading").classList.remove("hidden");
    document.getElementById("historyContent").classList.add("hidden");
    try {
        const data = await window.apiClient.coupons.history(id);
        document.getElementById("historyLoading").classList.add("hidden");
        document.getElementById("historyContent").classList.remove("hidden");
        const recBody = document.getElementById("historyRecipientsBody");
        const redBody = document.getElementById("historyRedemptionsBody");
        if (!data.recipients || data.recipients.length === 0) {
            recBody.innerHTML = `<tr><td colspan="6" class="px-3 py-4 text-center text-gray-500">No customers linked to this coupon yet.</td></tr>`;
        } else {
            recBody.innerHTML = data.recipients.map((r) => {
                const name = escapeHtml(r.name || "");
                const email = escapeHtml(r.email || "");
                const cid = r.customer_id;
                const src =
                    r.source === "redeemed_only"
                        ? "Redeem only"
                        : escapeHtml(r.sender_label || "Staff send / register");
                return `<tr class="border-b border-gray-100">
                    <td class="px-3 py-2"><a href="customer-details.html?id=${cid}" class="text-[#165166] hover:underline font-semibold">${name || "—"}</a></td>
                    <td class="px-3 py-2">${email || "—"}</td>
                    <td class="px-3 py-2">${formatCouponDateTime(r.sent_at)}</td>
                    <td class="px-3 py-2">${formatCouponDateTime(r.email_sent_at)}</td>
                    <td class="px-3 py-2 text-gray-600">${src}</td>
                    <td class="px-3 py-2 text-right">${r.times_used ?? 0}</td>
                </tr>`;
            }).join("");
        }
        if (!data.redemptions || data.redemptions.length === 0) {
            redBody.innerHTML = `<tr><td colspan="7" class="px-3 py-4 text-center text-gray-500">No redemptions recorded yet.</td></tr>`;
        } else {
            redBody.innerHTML = data.redemptions.map((r) => {
                const name = escapeHtml(r.name || "");
                const email = escapeHtml(r.email || "");
                const pkg = [r.package_category, r.package_name].filter(Boolean).join(" · ") || "—";
                const cid = r.customer_id;
                const bid = r.booking_id;
                const sessionCell = `${r.session_date ? formatCouponDateTime(r.session_date) : "—"}${
                    r.session_status
                        ? ` <span class="text-gray-500">(${escapeHtml(r.session_status)})</span>`
                        : ""
                }`;
                return `<tr class="border-b border-gray-100">
                    <td class="px-3 py-2"><a href="customer-details.html?id=${cid}" class="text-[#165166] hover:underline font-semibold">${name || "—"}</a></td>
                    <td class="px-3 py-2">${email || "—"}</td>
                    <td class="px-3 py-2">${formatCouponDateTime(r.used_at)}</td>
                    <td class="px-3 py-2 text-right">₱${Number(r.discount_amount).toLocaleString()}</td>
                    <td class="px-3 py-2">${sessionCell}</td>
                    <td class="px-3 py-2">${escapeHtml(pkg)}</td>
                    <td class="px-3 py-2 font-mono">#${bid}</td>
                </tr>`;
            }).join("");
        }
    } catch (e) {
        document.getElementById("historyLoading").classList.add("hidden");
        showToast(e.message || "Failed to load history", "error");
        closeHistoryModal();
    }
}

function closeHistoryModal() {
    document.getElementById("historyModal").classList.add("hidden");
    document.getElementById("historyModal").classList.remove("flex");
}

function loadEmailPresets() {
    try {
        const raw = localStorage.getItem(EMAIL_PRESETS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (_) {
        return [];
    }
}

function saveEmailPresetsToStorage(arr) {
    try {
        localStorage.setItem(EMAIL_PRESETS_KEY, JSON.stringify(arr));
    } catch (_) {}
}

function renderPresetList() {
    const el = document.getElementById("presetList");
    if (!el) return;
    const list = loadEmailPresets();
    if (!list.length) {
        el.innerHTML = `<p class="text-gray-400 text-xs px-1">No saved presets</p>`;
        return;
    }
    el.innerHTML = list
        .map((p) => {
            const active = p.id === selectedEmailPresetId;
            return `<button type="button" data-preset-id="${escapeHtml(p.id)}" class="preset-pick w-full text-left px-2 py-1.5 rounded text-xs font-semibold ${
                active ? "bg-[#165166] text-white" : "hover:bg-gray-100 text-[#424242]"
            }">${escapeHtml(p.name)}</button>`;
        })
        .join("");
    el.querySelectorAll(".preset-pick").forEach((btn) => {
        btn.onclick = () => applyEmailPreset(btn.getAttribute("data-preset-id"));
    });
}

function applyEmailPreset(id) {
    const p = loadEmailPresets().find((x) => x.id === id);
    if (!p) return;
    selectedEmailPresetId = id;
    const sub = document.getElementById("emailSubject");
    const body = document.getElementById("emailBody");
    if (sub) sub.value = p.subject || "";
    if (body) body.value = p.body || "";
    renderPresetList();
}

function saveCurrentPreset() {
    const nameEl = document.getElementById("presetNameInput");
    const name = (nameEl?.value || "").trim();
    if (!name) {
        showToast("Enter a preset name to save", "error");
        return;
    }
    const subject = (document.getElementById("emailSubject")?.value || "").trim();
    const body = (document.getElementById("emailBody")?.value || "").trim();
    const id =
        typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `p_${Date.now()}`;
    const list = loadEmailPresets();
    list.push({ id, name, subject, body });
    saveEmailPresetsToStorage(list);
    if (nameEl) nameEl.value = "";
    selectedEmailPresetId = id;
    renderPresetList();
    showToast("Preset saved");
}

function updateSelectedPreset() {
    if (!selectedEmailPresetId) {
        showToast("Select a preset first, or use Save new", "error");
        return;
    }
    const nameEl = document.getElementById("presetNameInput");
    const newName = (nameEl?.value || "").trim();
    const subject = (document.getElementById("emailSubject")?.value || "").trim();
    const body = (document.getElementById("emailBody")?.value || "").trim();
    const list = loadEmailPresets().map((p) => {
        if (p.id !== selectedEmailPresetId) return p;
        return {
            ...p,
            name: newName || p.name,
            subject,
            body,
        };
    });
    saveEmailPresetsToStorage(list);
    if (nameEl) nameEl.value = "";
    renderPresetList();
    showToast("Preset updated");
}

function deleteSelectedPreset() {
    if (!selectedEmailPresetId) {
        showToast("Select a preset first", "error");
        return;
    }
    if (!confirm("Delete this preset?")) return;
    const list = loadEmailPresets().filter((p) => p.id !== selectedEmailPresetId);
    saveEmailPresetsToStorage(list);
    selectedEmailPresetId = null;
    renderPresetList();
    showToast("Preset deleted");
}

function ensureSendFiltersModule() {
    return typeof window.customerFilters !== "undefined";
}

function resetSendFilterFormWidgets() {
    const riskEl = document.getElementById(SEND_FILTER_IDS.risk);
    if (riskEl) riskEl.value = "all";
    const bookEl = document.getElementById(SEND_FILTER_IDS.booking);
    if (bookEl) bookEl.value = "all";
    const df = document.getElementById(SEND_FILTER_IDS.dateFrom);
    const dt = document.getElementById(SEND_FILTER_IDS.dateTo);
    if (df) df.value = "";
    if (dt) dt.value = "";
    const searchEl = document.getElementById("sendSearchInput");
    if (searchEl) searchEl.value = "";
}

function applySendFiltersFromForm() {
    if (!ensureSendFiltersModule()) return;
    const f = window.customerFilters;
    if (!sendAppliedFilterState) {
        sendAppliedFilterState = f.createDefaultCustomerFilterState();
    }
    f.readStateFromDom(SEND_FILTER_IDS, sendAppliedFilterState);
    sendAppliedSearch =
        document.getElementById("sendSearchInput")?.value.trim() || "";
    renderSendCustomerList();
}

function selectAllFilteredCustomers() {
    sendFilteredCustomers.forEach((c) => {
        const id = c.id ?? c.customer_id;
        selectedCustomerIds.add(id);
    });
    renderSendCustomerList();
}

function clearSendSelection() {
    selectedCustomerIds = new Set();
    renderSendCustomerList();
}

async function openSendModal(id) {
    if (!ensureSendFiltersModule()) {
        showToast("Filter module missing. Reload the page.", "error");
        return;
    }
    sendCouponId = id;
    selectedCustomerIds = new Set();
    selectedEmailPresetId = null;
    sendAppliedFilterState =
        window.customerFilters.createDefaultCustomerFilterState();
    sendAppliedSearch = "";
    resetSendFilterFormWidgets();

    const subEl = document.getElementById("emailSubject");
    const bodyEl = document.getElementById("emailBody");
    const htmlBodyEl = document.getElementById("emailHtmlBody");
    if (subEl) subEl.value = "";
    if (bodyEl) bodyEl.value = "";
    if (htmlBodyEl) htmlBodyEl.value = "";
    const textRadio = document.getElementById("emailModeText");
    if (textRadio) textRadio.checked = true;
    setEmailComposerMode("text");
    const hint = document.getElementById("sendModalHint");
    const couponRow = coupons.find((x) => x.id === id);
    if (hint) {
        hint.textContent = couponRow
            ? `Coupon code: ${couponRow.code} — use {{code}} in the email body to substitute.`
            : "";
    }
    renderPresetList();
    const searchEl = document.getElementById("sendSearchInput");
    try {
        allCustomers = await window.apiClient.customers.listAll();
        renderSendCustomerList();
        document.getElementById("sendModal").classList.remove("hidden");
        document.getElementById("sendModal").classList.add("flex");
    } catch (e) {
        showToast(e.message || "Failed to load customers", "error");
    }

    if (searchEl) {
        searchEl.onkeydown = (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                applySendFiltersFromForm();
            }
        };
    }

    const applyBtn = document.getElementById("sendFilterApplyBtn");
    if (applyBtn) applyBtn.onclick = () => applySendFiltersFromForm();
    const clearBtn = document.getElementById("sendFilterClearBtn");
    if (clearBtn) {
        clearBtn.onclick = () => {
            resetSendFilterFormWidgets();
            sendAppliedFilterState =
                window.customerFilters.createDefaultCustomerFilterState();
            sendAppliedSearch = "";
            renderSendCustomerList();
        };
    }
}

function renderSendCustomerList() {
    if (!ensureSendFiltersModule()) return;
    if (!sendAppliedFilterState) {
        sendAppliedFilterState =
            window.customerFilters.createDefaultCustomerFilterState();
    }
    const filtered = window.customerFilters.filterCustomers(
        allCustomers,
        sendAppliedSearch,
        sendAppliedFilterState,
    );
    sendFilteredCustomers = filtered;
    const list = document.getElementById("sendCustomerList");
    if (!list) return;
    if (!filtered.length) {
        list.innerHTML =
            `<p class="p-4 text-center text-sm text-gray-500">No customers match these filters.</p>`;
        return;
    }
    list.innerHTML = filtered
        .map((c) => {
            const id = c.id ?? c.customer_id;
            const checked = selectedCustomerIds.has(id);
            const name = escapeHtml(c.name || c.email || "—");
            const email = escapeHtml(c.email || "");
            const renewal = escapeHtml(formatSendRenewalDisplay(c));
            const bookings = escapeHtml(formatSendBookingsCount(c));
            return `
                <label class="flex items-start gap-3 p-3 hover:bg-gray-50 cursor-pointer rounded-md border-b border-gray-100 last:border-0">
                    <input type="checkbox" class="mt-1 flex-shrink-0 w-4 h-4 accent-[#165166]" ${checked ? "checked" : ""} onchange="toggleSendCustomer(${id}, this.checked)">
                    <span class="flex-1 min-w-0 text-sm leading-snug">
                        <span class="font-semibold text-[#424242] block">${name}</span>
                        <span class="text-gray-500 text-xs break-all">${email || "—"}</span>
                        <span class="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[#5F6E79]">
                            <span><span class="font-bold text-[#424242]">Renewal</span> ${renewal}</span>
                            <span><span class="font-bold text-[#424242]">Bookings</span> ${bookings}</span>
                        </span>
                    </span>
                </label>`;
        })
        .join("");
}

function toggleSendCustomer(id, checked) {
    if (checked) selectedCustomerIds.add(id);
    else selectedCustomerIds.delete(id);
}

function closeSendModal() {
    document.getElementById("sendModal").classList.add("hidden");
    document.getElementById("sendModal").classList.remove("flex");
}

function getEmailComposerMode() {
    return document.querySelector('input[name="emailBodyMode"]:checked')?.value || "text";
}

function stripHtmlTags(html) {
    const temp = document.createElement("div");
    temp.innerHTML = html || "";
    return (temp.textContent || temp.innerText || "").trim();
}

function refreshHtmlPreview() {
    const preview = document.getElementById("emailHtmlPreview");
    const htmlInput = document.getElementById("emailHtmlBody");
    if (!preview || !htmlInput) return;
    preview.innerHTML = htmlInput.value || "<p style='color:#999'>Preview is empty.</p>";
}

function setEmailComposerMode(mode) {
    const textWrap = document.getElementById("emailTextWrap");
    const htmlWrap = document.getElementById("emailHtmlWrap");
    const previewWrap = document.getElementById("emailPreviewWrap");
    if (!textWrap || !htmlWrap || !previewWrap) return;
    if (mode === "html") {
        textWrap.classList.add("hidden");
        htmlWrap.classList.remove("hidden");
        previewWrap.classList.remove("hidden");
        refreshHtmlPreview();
    } else {
        textWrap.classList.remove("hidden");
        htmlWrap.classList.add("hidden");
        previewWrap.classList.add("hidden");
    }
}

async function importCouponComposerImage(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith("image/")) {
        showToast("Please select an image file", "error");
        return;
    }
    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result || "");
            reader.onerror = () => reject(new Error("Failed to read image file"));
            reader.readAsDataURL(file);
        });
        const htmlInput = document.getElementById("emailHtmlBody");
        if (!htmlInput) return;
        const snippet = `<p><img src="${dataUrl}" alt="Coupon image" style="max-width:100%;height:auto;" /></p>`;
        htmlInput.value = `${htmlInput.value || ""}\n${snippet}`.trim();
        setEmailComposerMode("html");
        const htmlRadio = document.getElementById("emailModeHtml");
        if (htmlRadio) htmlRadio.checked = true;
        refreshHtmlPreview();
    } catch (e) {
        showToast(e.message || "Failed to import image", "error");
    }
}

async function confirmSendCoupon() {
    if (!sendCouponId || selectedCustomerIds.size === 0) {
        showToast("Select at least one customer", "error");
        return;
    }
    const btn = document.getElementById("sendBtn");
    btn.disabled = true;
    try {
        const res = await window.apiClient.coupons.send(sendCouponId, {
            customer_ids: Array.from(selectedCustomerIds),
        });
        showToast(`Registered coupon for ${res.sent_count} customer(s)`);
        closeSendModal();
    } catch (e) {
        showToast(e.message || "Failed to register", "error");
    } finally {
        btn.disabled = false;
    }
}

async function sendCouponEmail() {
    if (!sendCouponId || selectedCustomerIds.size === 0) {
        showToast("Select at least one customer", "error");
        return;
    }
    const subject = (document.getElementById("emailSubject")?.value || "").trim();
    const mode = getEmailComposerMode();
    const bodyRaw = (document.getElementById("emailBody")?.value || "").trim();
    const htmlBodyRaw = (document.getElementById("emailHtmlBody")?.value || "").trim();
    if (!subject) {
        showToast("Email subject is required", "error");
        return;
    }
    if (mode === "text" && !bodyRaw) {
        showToast("Email body is required", "error");
        return;
    }
    if (mode === "html" && !htmlBodyRaw) {
        showToast("HTML body is required", "error");
        return;
    }
    const c = coupons.find((x) => x.id === sendCouponId);
    const code = c ? c.code : "";
    const body = bodyRaw.replace(/\{\{code\}\}/g, code);
    const htmlBody = htmlBodyRaw.replace(/\{\{code\}\}/g, code);
    const textFallback = mode === "html" ? stripHtmlTags(htmlBody) : body;
    const btn = document.getElementById("sendEmailBtn");
    btn.disabled = true;
    try {
        const res = await window.apiClient.coupons.sendEmail(sendCouponId, {
            customer_ids: Array.from(selectedCustomerIds),
            subject,
            body: textFallback,
            html_body: mode === "html" ? htmlBody : "",
        });
        const n = res.sent_count ?? 0;
        const errPart =
            res.errors && res.errors.length
                ? ` Some errors: ${res.errors.slice(0, 2).join("; ")}`
                : "";
        showToast(`Email sent to ${n} recipient(s).${errPart}`);
        if (n > 0) closeSendModal();
    } catch (e) {
        showToast(e.message || "Failed to send email", "error");
    } finally {
        btn.disabled = false;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document
        .querySelectorAll('input[name="emailBodyMode"]')
        .forEach((el) => (el.onchange = () => setEmailComposerMode(el.value)));
    const htmlInput = document.getElementById("emailHtmlBody");
    if (htmlInput) htmlInput.addEventListener("input", refreshHtmlPreview);
    const imageInput = document.getElementById("emailImageUpload");
    if (imageInput) {
        imageInput.addEventListener("change", (e) => {
            const f = e.target.files && e.target.files[0];
            importCouponComposerImage(f);
            e.target.value = "";
        });
    }
    setEmailComposerMode("text");
    loadCoupons();
});
