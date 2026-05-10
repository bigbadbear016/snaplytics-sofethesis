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
let accountSort = { key: "role", dir: "asc" };
let accountSearchQuery = "";
const SORT_LABELS = {
    "name:asc": "Name (A-Z)",
    "name:desc": "Name (Z-A)",
    "username:asc": "Username (A-Z)",
    "username:desc": "Username (Z-A)",
    "email:asc": "Email (A-Z)",
    "email:desc": "Email (Z-A)",
    "role:asc": "Role (A-Z)",
    "role:desc": "Role (Z-A)",
    "status:asc": "Status (Active first)",
    "status:desc": "Status (Inactive first)",
    "phone:asc": "Phone (A-Z)",
    "phone:desc": "Phone (Z-A)",
    "nickname:asc": "Nickname (A-Z)",
    "nickname:desc": "Nickname (Z-A)",
};

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

function roleWeight(role) {
    const normalized = maNormalizeRole(role);
    if (normalized === "OWNER") return 0;
    if (normalized === "ADMIN") return 1;
    return 2;
}

function accountDisplayName(acc) {
    return `${acc.first_name || ""} ${acc.last_name || ""}`.trim() || acc.username || "—";
}

function accountSortValue(acc, key) {
    if (key === "name") return accountDisplayName(acc);
    if (key === "username") return String(acc.username || "");
    if (key === "email") return String(acc.email || "");
    if (key === "role") return String(acc.role || "");
    if (key === "status") return acc.is_active ? "ACTIVE" : "INACTIVE";
    if (key === "phone") return String((acc.profile && acc.profile.phone_number) || "");
    if (key === "nickname") return String((acc.profile && acc.profile.nickname) || "");
    return "";
}

function filterAccounts(accounts) {
    const q = String(accountSearchQuery || "").trim().toLowerCase();
    if (!q) return (Array.isArray(accounts) ? accounts : []).slice();
    return (Array.isArray(accounts) ? accounts : []).filter((acc) => {
        const hay = [
            accountDisplayName(acc),
            acc.username || "",
            acc.email || "",
            acc.role || "",
            (acc.profile && acc.profile.phone_number) || "",
            (acc.profile && acc.profile.nickname) || "",
        ]
            .join(" ")
            .toLowerCase();
        return hay.includes(q);
    });
}

function sortAccounts(accounts) {
    const list = (Array.isArray(accounts) ? accounts : []).slice();
    const key = accountSort.key || "role";
    const dirMul = accountSort.dir === "desc" ? -1 : 1;
    /** When sorting by any column except Status, inactive rows stay at the bottom. */
    const pinInactiveToBottom = key !== "status";
    return list.sort((a, b) => {
        if (pinInactiveToBottom) {
            const aRank = a.is_active ? 0 : 1;
            const bRank = b.is_active ? 0 : 1;
            if (aRank !== bRank) return aRank - bRank;
        }
        if (key === "role") {
            const rw = roleWeight(a.role) - roleWeight(b.role);
            if (rw !== 0) return rw * dirMul;
            return (
                accountDisplayName(a).localeCompare(accountDisplayName(b), undefined, { sensitivity: "base" }) *
                dirMul
            );
        }
        if (key === "status") {
            const av = a.is_active ? 0 : 1;
            const bv = b.is_active ? 0 : 1;
            if (av !== bv) return (av - bv) * dirMul;
            return (
                accountDisplayName(a).localeCompare(accountDisplayName(b), undefined, { sensitivity: "base" }) *
                dirMul
            );
        }
        const aVal = accountSortValue(a, key);
        const bVal = accountSortValue(b, key);
        const aEmpty = !String(aVal || "").trim();
        const bEmpty = !String(bVal || "").trim();
        if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
        const cmp = String(aVal).localeCompare(String(bVal), undefined, { sensitivity: "base" });
        if (cmp !== 0) return cmp * dirMul;
        return accountDisplayName(a).localeCompare(accountDisplayName(b), undefined, { sensitivity: "base" }) * dirMul;
    });
}

function refreshSortIndicators() {
    const sortBtns = document.querySelectorAll(".accounts-sort-btn");
    sortBtns.forEach((btn) => {
        const key = String(btn.getAttribute("data-sort-key") || "");
        const indicator = btn.querySelector(".accounts-sort-indicator");
        if (!indicator) return;
        if (key === accountSort.key) {
            indicator.textContent = accountSort.dir === "desc" ? "▼" : "▲";
            btn.classList.add("font-extrabold");
            btn.classList.add("text-white");
        } else {
            indicator.textContent = "";
            btn.classList.remove("font-extrabold");
            btn.classList.remove("text-white");
        }
    });
}

function updateSortUiState() {
    const sortBtn = document.getElementById("accountsSortBtn");
    if (sortBtn) {
        const label = SORT_LABELS[`${accountSort.key}:${accountSort.dir}`] || "Role (A-Z)";
        sortBtn.textContent = `Sort: ${label}`;
    }
    const options = document.querySelectorAll(".accounts-sort-option");
    options.forEach((opt) => {
        const key = String(opt.getAttribute("data-sort-key") || "");
        const dir = String(opt.getAttribute("data-sort-dir") || "");
        const isActive = key === accountSort.key && dir === accountSort.dir;
        opt.classList.toggle("accounts-sort-option--active", isActive);
        opt.classList.toggle("font-extrabold", isActive);
    });
}

function updateAccountsCountBadge(visibleCount, totalCount) {
    const badge = document.getElementById("accountsCountBadge");
    if (!badge) return;
    if (visibleCount === totalCount) {
        badge.textContent = `${totalCount} account${totalCount === 1 ? "" : "s"}`;
        return;
    }
    badge.textContent = `${visibleCount}/${totalCount} shown`;
}

function roleBadge(role) {
    const normalized = maNormalizeRole(role);
    if (normalized === "OWNER") {
        return '<span class="account-role-pill account-role-pill--owner">OWNER</span>';
    }
    if (normalized === "ADMIN") {
        return '<span class="account-role-pill account-role-pill--admin">ADMIN</span>';
    }
    return '<span class="account-role-pill account-role-pill--staff">STAFF</span>';
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

function maSrcAttr(s) {
    return String(s ?? "").replace(/"/g, "&quot;");
}

function maAvatarSrc(acc, displayName) {
    const raw = acc.profile?.profile_photo_url;
    const u = (raw || "").trim();
    if (u) return u;
    return maBuildFallbackAvatar(displayName);
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
    const empty = document.getElementById("accountsEmpty");
    if (loading) loading.classList.remove("hidden");
    if (table) table.classList.add("hidden");
    if (empty) empty.classList.add("hidden");
    try {
        const res = await window.apiClient.auth.staffAccounts();
        managedAccounts = Array.isArray(res.accounts) ? res.accounts : [];
        const filteredAccounts = filterAccounts(managedAccounts);
        const sortedAccounts = sortAccounts(filteredAccounts);
        updateAccountsCountBadge(sortedAccounts.length, managedAccounts.length);
        body.innerHTML = sortedAccounts
            .map((acc) => {
                const name = accountDisplayName(acc);
                const currentUserId = maCurrentUserId();
                const canDelete = isOwner() && acc.id !== currentUserId && maNormalizeRole(acc.role) !== "OWNER";
                const activeBadge = acc.is_active
                    ? '<span class="account-status-pill account-status-pill--active">Active</span>'
                    : '<span class="account-status-pill account-status-pill--inactive">Inactive</span>';
                const avatarSrc = maSrcAttr(maAvatarSrc(acc, name));
                return `<tr class="manage-account-row">
                    <td class="ma-td ma-td--name px-4 py-4 align-middle">
                        <div class="manage-account-name-cell">
                            <img class="manage-account-avatar" src="${avatarSrc}" width="40" height="40" alt="" loading="lazy" />
                            <span class="manage-account-name-text">${maEscape(name)}</span>
                        </div>
                    </td>
                    <td class="ma-td ma-td--username px-4 py-4 align-middle tabular-nums" title="@${maEscape(acc.username || "")}">@${maEscape(acc.username || "—")}</td>
                    <td class="ma-td ma-td--email px-4 py-4 align-middle" title="${maEscape(acc.email || "")}">${maEscape(acc.email || "—")}</td>
                    <td class="ma-td ma-td--role px-3 py-4 align-middle text-center">${roleBadge(acc.role)}</td>
                    <td class="ma-td ma-td--status px-3 py-4 align-middle text-center">${activeBadge}</td>
                    <td class="ma-td ma-td--phone px-4 py-4 align-middle">${maEscape(acc.profile?.phone_number || "—")}</td>
                    <td class="ma-td ma-td--nickname px-4 py-4 align-middle">${maEscape(acc.profile?.nickname || "—")}</td>
                    <td class="ma-td ma-td--actions px-4 py-4 align-middle">
                        <div class="manage-account-actions">
                        <button type="button" onclick="openAccountModal(${acc.id})" class="manage-account-action-link">Edit</button>
                        ${canDelete ? `<button type="button" onclick="deleteManagedAccount(${acc.id})" class="manage-account-action-link manage-account-action-link--danger">Delete</button>` : ""}
                        </div>
                    </td>
                </tr>`;
            })
            .join("");
        if (loading) loading.classList.add("hidden");
        if (sortedAccounts.length) {
            if (table) table.classList.remove("hidden");
            if (empty) empty.classList.add("hidden");
        } else {
            if (table) table.classList.add("hidden");
            if (empty) empty.classList.remove("hidden");
        }
        refreshSortIndicators();
        updateSortUiState();
    } catch (e) {
        if (loading) loading.classList.add("hidden");
        if (table) table.classList.add("hidden");
        if (empty) empty.classList.add("hidden");
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
    if (maNormalizeRole(acc.role) === "OWNER") {
        maToast("Owner account cannot be deleted from Manage Accounts.", "error");
        return;
    }
    const roleLabel = maNormalizeRole(acc.role) || "ACCOUNT";
    const label = acc.username || `${acc.first_name || ""} ${acc.last_name || ""}`.trim() || `#${id}`;
    const ok = await window.heigenConfirm(
        `Delete ${roleLabel} account \"${label}\"? The record is moved to Internal Records.`,
        {
            title: "Delete account",
            confirmText: "Delete",
            cancelText: "Cancel",
        },
    );
    if (!ok) return;

    try {
        const res = await window.apiClient.auth.deleteStaffAccount(id);
        maToast(res?.message || "Account moved to Internal Records.", "success");
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
    const sortBtns = document.querySelectorAll(".accounts-sort-btn");
    sortBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = String(btn.getAttribute("data-sort-key") || "role");
            if (accountSort.key === key) {
                accountSort.dir = accountSort.dir === "asc" ? "desc" : "asc";
            } else {
                accountSort.key = key;
                accountSort.dir = "asc";
            }
            loadManagedAccounts();
        });
    });
    const sortBtn = document.getElementById("accountsSortBtn");
    const sortMenu = document.getElementById("accountsSortMenu");
    const sortOptions = document.querySelectorAll(".accounts-sort-option");
    if (sortBtn && sortMenu) {
        sortBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            sortMenu.classList.toggle("hidden");
        });
    }
    sortOptions.forEach((opt) => {
        opt.addEventListener("click", () => {
            accountSort.key = String(opt.getAttribute("data-sort-key") || "role");
            accountSort.dir = String(opt.getAttribute("data-sort-dir") || "asc");
            if (sortMenu) sortMenu.classList.add("hidden");
            loadManagedAccounts();
        });
    });
    document.addEventListener("click", (e) => {
        if (!sortMenu || sortMenu.classList.contains("hidden")) return;
        if (
            e.target instanceof Element &&
            !e.target.closest("#accountsSortMenu") &&
            !e.target.closest("#accountsSortBtn")
        ) {
            sortMenu.classList.add("hidden");
        }
    });
    const searchInput = document.getElementById("accountsSearchInput");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            accountSearchQuery = String(searchInput.value || "");
            loadManagedAccounts();
        });
    }
    const resetBtn = document.getElementById("accountsResetBtn");
    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            accountSearchQuery = "";
            accountSort = { key: "role", dir: "asc" };
            if (searchInput) searchInput.value = "";
            if (sortMenu) sortMenu.classList.add("hidden");
            loadManagedAccounts();
        });
    }
    updateSortUiState();
    loadManagedAccounts();
});
