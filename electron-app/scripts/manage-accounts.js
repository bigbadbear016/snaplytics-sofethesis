// --- Create Staff Modal Logic ---
document.addEventListener('DOMContentLoaded', function () {
    const openBtn = document.getElementById('openCreateStaffModalBtn');
    const modal = document.getElementById('createStaffModal');
    const modalContent = document.getElementById('createStaffModalContent');
    if (openBtn && modal && modalContent) {
        openBtn.addEventListener('click', function () {
            modal.classList.remove('hidden');
            // Load signup.html content into modalContent
            fetch('./signup.html')
                .then(r => r.text())
                .then(html => {
                    // Extract only the form part from signup.html
                    const temp = document.createElement('div');
                    temp.innerHTML = html;
                    const form = temp.querySelector('#signup-form');
                    const title = temp.querySelector('h1');
                    modalContent.innerHTML = '';
                    if (title) {
                        modalContent.appendChild(title.cloneNode(true));
                    }
                    if (form) {
                        const clonedForm = form.cloneNode(true);
                        modalContent.appendChild(clonedForm);
                        // Attach submit handler
                        clonedForm.addEventListener('submit', async function (e) {
                            e.preventDefault();
                            const submitBtn = clonedForm.querySelector('button[type="submit"]');
                            if (submitBtn) submitBtn.disabled = true;
                            // Collect form data
                            const data = {
                                first_name: clonedForm.querySelector('#signup-first-name')?.value.trim() || '',
                                last_name: clonedForm.querySelector('#signup-last-name')?.value.trim() || '',
                                phone_number: clonedForm.querySelector('#signup-phone-number')?.value.trim() || '',
                                nickname: clonedForm.querySelector('#signup-nickname')?.value.trim() || '',
                                username: clonedForm.querySelector('#signup-username')?.value.trim() || '',
                                email: clonedForm.querySelector('#signup-email')?.value.trim() || '',
                                role: clonedForm.querySelector('#signup-role')?.value || 'STAFF',
                                password: clonedForm.querySelector('#signup-password')?.value.trim() || '',
                            };
                            try {
                                // Use the correct API endpoint for creating staff
                                await window.apiClient.auth.createStaffAccount(data);
                                maToast('Staff account created!', 'success');
                                window.closeCreateStaffModal();
                                await loadManagedAccounts();
                            } catch (err) {
                                maToast(err.message || 'Failed to create staff account', 'error');
                            } finally {
                                if (submitBtn) submitBtn.disabled = false;
                            }
                        });
                    } else {
                        modalContent.innerHTML = '<div class="p-6">Failed to load form.</div>';
                    }
                });
        });
        window.closeCreateStaffModal = function () {
            modal.classList.add('hidden');
            modalContent.innerHTML = '';
        };
        // Close modal on outside click
        modal.addEventListener('click', function (e) {
            if (e.target === modal) {
                window.closeCreateStaffModal();
            }
        });
    }
});
let managedAccounts = [];
let editingAccountId = null;

function maToast(msg, type = "success") {
    if (typeof showToast === "function") {
        showToast(msg, type);
        return;
    }
    window.heigenAlert(msg);
}

function maRole() {
    if (window.staffAuth && typeof window.staffAuth.getRole === "function") {
        return window.staffAuth.getRole();
    }
    try {
        const user = JSON.parse(sessionStorage.getItem("user") || "{}");
        return String(user.role || "").toUpperCase();
    } catch (_) {
        return "";
    }
}

function maEscape(v) {
    const div = document.createElement("div");
    div.textContent = v == null ? "" : String(v);
    return div.innerHTML;
}

function requireManagerOrRedirect() {
    const role = maRole();
    if (
        (window.staffAuth &&
            typeof window.staffAuth.isAdminOrOwner === "function" &&
            window.staffAuth.isAdminOrOwner(role)) ||
        role === "OWNER" ||
        role === "ADMIN"
    ) {
        return true;
    }
    maToast("Only ADMIN/OWNER can manage staff accounts.", "error");
    if (window.self !== window.top) {
        window.parent.postMessage(
            { type: "heigen-staff-nav", page: "dashboard.html" },
            "*",
        );
    } else {
        window.location.href = "./shell.html?page=dashboard.html";
    }
    return false;
}

function isOwner() {
    if (window.staffAuth && typeof window.staffAuth.isOwner === "function") {
        return window.staffAuth.isOwner();
    }
    return maRole() === "OWNER";
}

function maNormalizeRole(role) {
    return String(role || "").trim().toUpperCase();
}

function maCurrentUserId() {
    try {
        const user = JSON.parse(sessionStorage.getItem("user") || "{}");
        const raw = user.id ?? user.user_id;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
    } catch (_) {
        return null;
    }
}

function maBuildFallbackAvatar(seedText) {
    const initials = (seedText || "NA")
        .split(" ")
        .filter(Boolean)
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="100%" height="100%" fill="#E8F0F2"/><text x="50%" y="54%" font-size="42" text-anchor="middle" fill="#165166" font-family="Segoe UI, sans-serif" dy=".1em">${initials}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function setAccountPhotoPreview(value, fallbackSeed) {
    const preview = document.getElementById("accPhotoPreview");
    if (!preview) return;
    const src = (value || "").trim();
    preview.src = src || maBuildFallbackAvatar(fallbackSeed || "User");
}

async function loadManagedAccounts() {
    const loading = document.getElementById("accountsLoading");
    const table = document.getElementById("accountsTableWrap");
    const body = document.getElementById("accountsBody");
    if (loading) loading.classList.remove("hidden");
    if (table) table.classList.add("hidden");
    try {
        const res = await window.apiClient.auth.staffAccounts();
        managedAccounts = Array.isArray(res.accounts) ? res.accounts : [];
        body.innerHTML = managedAccounts
            .map((acc) => {
                const name = `${acc.first_name || ""} ${acc.last_name || ""}`.trim() || "—";
                const currentUserId = maCurrentUserId();
                const canDelete = isOwner() && acc.id !== currentUserId;
                const activeBadge = acc.is_active
                    ? '<span class="px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold">Active</span>'
                    : '<span class="px-2 py-1 rounded-full bg-gray-200 text-gray-700 text-xs font-semibold">Inactive</span>';
                return `<tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="px-4 py-3 font-semibold">${maEscape(name)}</td>
                    <td class="px-4 py-3">${maEscape(acc.username || "—")}</td>
                    <td class="px-4 py-3">${maEscape(acc.email || "—")}</td>
                    <td class="px-4 py-3">${maEscape(acc.role || "—")}</td>
                    <td class="px-4 py-3">${activeBadge}</td>
                    <td class="px-4 py-3">${maEscape(acc.profile?.phone_number || "—")}</td>
                    <td class="px-4 py-3">${maEscape(acc.profile?.nickname || "—")}</td>
                    <td class="px-4 py-3">
                        <button onclick="openAccountModal(${acc.id})" class="text-[#165166] hover:underline text-xs">Edit</button>
                        ${canDelete ? `<button onclick="deleteManagedAccount(${acc.id})" class="ml-3 text-red-600 hover:underline text-xs">Delete</button>` : ""}
                    </td>
                </tr>`;
            })
            .join("");
        if (loading) loading.classList.add("hidden");
        if (table) table.classList.remove("hidden");
    } catch (e) {
        if (loading) loading.classList.add("hidden");
        maToast(e.message || "Failed to load accounts", "error");
    }
}

function openAccountModal(id) {
    const acc = managedAccounts.find((x) => x.id === id);
    if (!acc) return;
    const displayName =
        `${acc.first_name || ""} ${acc.last_name || ""}`.trim() ||
        acc.username ||
        "User";
    editingAccountId = id;
    document.getElementById("accountModalTitle").textContent = `Edit account: ${acc.username}`;
    document.getElementById("accFirstName").value = acc.first_name || "";
    document.getElementById("accLastName").value = acc.last_name || "";
    document.getElementById("accUsername").value = acc.username || "";
    document.getElementById("accEmail").value = acc.email || "";
    document.getElementById("accRole").value = acc.role || "STAFF";
    document.getElementById("accPhone").value = acc.profile?.phone_number || "";
    document.getElementById("accNickname").value = acc.profile?.nickname || "";
    document.getElementById("accPhotoUrl").value = acc.profile?.profile_photo_url || "";
    setAccountPhotoPreview(acc.profile?.profile_photo_url || "", displayName);
    document.getElementById("accPassword").value = "";
    document.getElementById("accMustChangePassword").checked = !!acc.profile?.must_change_password;
    document.getElementById("accIsActive").checked = !!acc.is_active;
    const roleSelect = document.getElementById("accRole");
    if (roleSelect) {
        if (isOwner()) {
            roleSelect.disabled = false;
        } else {
            // ADMIN can edit staff details only, no role promotion option.
            roleSelect.value = "STAFF";
            roleSelect.disabled = true;
        }
    }
    document.getElementById("accountModal").classList.remove("hidden");
    document.getElementById("accountModal").classList.add("flex");
}

function closeAccountModal() {
    document.getElementById("accountModal").classList.add("hidden");
    document.getElementById("accountModal").classList.remove("flex");
    editingAccountId = null;
}

async function saveAccount() {
    if (!editingAccountId) return;
    const payload = {
        first_name: document.getElementById("accFirstName").value.trim(),
        last_name: document.getElementById("accLastName").value.trim(),
        username: document.getElementById("accUsername").value.trim(),
        email: document.getElementById("accEmail").value.trim(),
        role: isOwner() ? document.getElementById("accRole").value : "STAFF",
        phone_number: document.getElementById("accPhone").value.trim(),
        nickname: document.getElementById("accNickname").value.trim(),
        profile_photo_url: document.getElementById("accPhotoUrl").value.trim(),
        is_active: document.getElementById("accIsActive").checked,
        must_change_password: document.getElementById("accMustChangePassword").checked,
    };
    const newPassword = document.getElementById("accPassword").value.trim();
    if (newPassword) payload.new_password = newPassword;

    const saveBtn = document.getElementById("accountSaveBtn");
    saveBtn.disabled = true;
    try {
        const res = await window.apiClient.auth.updateStaffAccount(
            editingAccountId,
            payload,
        );
        maToast(res.message || "Account updated", "success");
        closeAccountModal();
        await loadManagedAccounts();
    } catch (e) {
        maToast(e.message || "Failed to update account", "error");
    } finally {
        saveBtn.disabled = false;
    }
}

async function deleteManagedAccount(id) {
    if (!isOwner()) {
        maToast("Only OWNER can delete accounts.", "error");
        return;
    }
    const acc = managedAccounts.find((x) => x.id === id);
    if (!acc) {
        maToast("Account not found.", "error");
        return;
    }
    if (acc.id === maCurrentUserId()) {
        maToast("You cannot delete your own account.", "error");
        return;
    }
    const roleLabel = maNormalizeRole(acc.role) || "ACCOUNT";
    const label = acc.username || `${acc.first_name || ""} ${acc.last_name || ""}`.trim() || `#${id}`;
    const ok = await window.heigenConfirm(`Delete ${roleLabel} account \"${label}\"? This cannot be undone.`, {
        title: "Delete account",
        confirmText: "Delete",
        cancelText: "Cancel",
    });
    if (!ok) return;

    try {
        const res = await window.apiClient.auth.deleteStaffAccount(id);
        maToast(res?.message || "Account deleted.", "success");
        await loadManagedAccounts();
    } catch (e) {
        maToast(e.message || "Failed to delete account", "error");
    }
}

window.openAccountModal = openAccountModal;
window.closeAccountModal = closeAccountModal;
window.saveAccount = saveAccount;
window.deleteManagedAccount = deleteManagedAccount;

document.addEventListener("DOMContentLoaded", () => {
    if (!requireManagerOrRedirect()) return;
    const fileInput = document.getElementById("accPhotoFile");
    const replaceBtn = document.getElementById("accPhotoReplaceBtn");
    const hiddenPhotoValue = document.getElementById("accPhotoUrl");
    if (replaceBtn && fileInput) {
        replaceBtn.addEventListener("click", () => {
            fileInput.click();
        });
    }
    if (fileInput && hiddenPhotoValue) {
        fileInput.addEventListener("change", (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            if (!file.type || !file.type.startsWith("image/")) {
                maToast("Please select an image file.", "error");
                e.target.value = "";
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = String(reader.result || "");
                hiddenPhotoValue.value = dataUrl;
                setAccountPhotoPreview(
                    dataUrl,
                    document.getElementById("accUsername")?.value || "User",
                );
            };
            reader.onerror = () => {
                maToast("Failed to read selected image.", "error");
            };
            reader.readAsDataURL(file);
            e.target.value = "";
        });
    }
    loadManagedAccounts();
});
