import { HEIGEN_MEDIA_PLACEHOLDER_DATA_URL } from "./package-placeholders.js";
import {
    readPhotoFramePercents,
    setUploadPreviewById,
} from "./upload-preview-utils.js";
import { exportCoverCropFromFile } from "./image-cover-export.js";

const API_BASE = "http://127.0.0.1:8000/api";

const CATEGORY_PLACEHOLDER_IMG = HEIGEN_MEDIA_PLACEHOLDER_DATA_URL;

function staffNavigateTo(pageWithQuery) {
    const target = String(pageWithQuery || "").replace(/^\.\//, "");
    if (!target) return;
    try {
        if (
            window.parent &&
            window.parent !== window &&
            typeof window.parent.staffShellNav === "function"
        ) {
            window.parent.staffShellNav(target);
            return;
        }
    } catch (_) {}
    window.location.href = target;
}
let categories = [];
let editingCategoryId = null;
let editingCategoryName = null;
let editingCategoryArchived = false;
let pendingCategoryImage = null;
let pendingEditImage = null;
let editCategoryPreviewBase = "";
let archivedCategories = [];
/** Lowercase category name → lowercase package names in that category (for search). */
let packageNamesByCategoryKey = new Map();
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function getCategorySearchQuery() {
    const el = document.getElementById("categorySearchInput");
    return el ? String(el.value || "").trim().toLowerCase() : "";
}

function includePackageNamesInCategorySearch() {
    const el = document.getElementById("categorySearchIncludePackages");
    return !el || el.checked;
}

function rebuildPackageNamesIndex(packages) {
    packageNamesByCategoryKey = new Map();
    for (const p of packages) {
        const cat = String(p.category || "").trim();
        if (!cat) continue;
        const key = cat.toLowerCase();
        const pkgName = String(p.name || "").trim().toLowerCase();
        if (!pkgName) continue;
        let arr = packageNamesByCategoryKey.get(key);
        if (!arr) {
            arr = [];
            packageNamesByCategoryKey.set(key, arr);
        }
        arr.push(pkgName);
    }
}

function categoryMatchesSearchQuery(category, q) {
    if (!q) return true;
    const nameLower = category.name.toLowerCase();
    if (nameLower.includes(q)) return true;
    if (!includePackageNamesInCategorySearch()) return false;
    const names = packageNamesByCategoryKey.get(nameLower);
    if (!names || !names.length) return false;
    return names.some((n) => n.includes(q));
}

function setModalVisible(modalId, visible) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.toggle("hidden", !visible);
}

async function request(path, options = {}) {
    const token = sessionStorage.getItem("authToken");
    const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {}),
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${API_BASE}${path}`, {
        headers,
        ...options,
    });
    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const err = await res.json();
            detail = err.detail || JSON.stringify(err);
        } catch (_) {}
        throw new Error(detail);
    }
    if (res.status === 204) return null;
    return res.json();
}

function getFileTooLargeMessage() {
    return "Photo must be 5MB or smaller.";
}

function ensureUploadSize(file) {
    if (!file) return true;
    if (file.size > MAX_UPLOAD_BYTES) {
        window.heigenAlert(getFileTooLargeMessage());
        return false;
    }
    return true;
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result || "");
        reader.onerror = () => reject(new Error("Failed to read image file."));
        reader.readAsDataURL(file);
    });
}

async function pendingPhotoToDataUrl(file, previewBoxId) {
    if (!file) return null;
    const { posX, posY, zoom } = readPhotoFramePercents(previewBoxId);
    return exportCoverCropFromFile(file, { posX, posY, zoom });
}

async function loadCategories() {
    const [catRes, pkgRes] = await Promise.all([
        request("/categories/?include_archived=1"),
        request("/packages/?include_archived=1"),
    ]);
    const categoryList = Array.isArray(catRes) ? catRes : catRes.results || [];
    const packages = Array.isArray(pkgRes) ? pkgRes : pkgRes.results || [];
    rebuildPackageNamesIndex(packages);
    const packageCountMap = new Map();
    for (const p of packages) {
        const cat = String(p.category || "").trim();
        if (!cat) continue;
        if (p.is_archived) continue;
        packageCountMap.set(cat.toLowerCase(), (packageCountMap.get(cat.toLowerCase()) || 0) + 1);
    }

    const map = new Map();
    for (const c of categoryList) {
        const name = String(c.name || "").trim();
        if (!name) continue;
        map.set(name.toLowerCase(), {
            id: c.id,
            name,
            image: c.image_url || "",
            isArchived: !!c.is_archived,
            packageCount: packageCountMap.get(name.toLowerCase()) || 0,
        });
    }
    // Keep backward compatibility: show package categories that do not have a category row yet.
    for (const p of packages) {
        const name = String(p.category || "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (!map.has(key)) {
            map.set(key, {
                id: null,
                name,
                image: "",
                isArchived: false,
                packageCount: packageCountMap.get(key) || 0,
            });
        }
    }
    const all = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    categories = all.filter((c) => !c.isArchived);
    archivedCategories = all.filter((c) => c.isArchived);
    renderCategories();
    renderArchivedCategories();
}

window.toggleMobileSidebar = function toggleMobileSidebar(show) {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("mobileOverlay");
    if (show) {
        sidebar.classList.add("mobile-open");
        overlay.classList.add("show");
    } else {
        sidebar.classList.remove("mobile-open");
        overlay.classList.remove("show");
    }
};

window.navigateTo = function navigateTo(section) {
    document.querySelectorAll(".section").forEach((s) => {
        s.classList.remove("active");
    });
    document.querySelectorAll(".nav-item").forEach((item) => {
        item.classList.remove("active");
    });
    const selectedSection = document.getElementById(section);
    if (selectedSection) selectedSection.classList.add("active");
};

function renderCategories() {
    const grid = document.getElementById("categoriesGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const q = getCategorySearchQuery();
    const filtered = q
        ? categories.filter((c) => categoryMatchesSearchQuery(c, q))
        : categories;

    if (filtered.length === 0 && q) {
        const empty = document.createElement("div");
        empty.className =
            "col-span-full rounded-2xl border border-dashed border-[color:var(--heigen-field-border)] bg-[color:var(--heigen-toolbar-surface-bg)] px-6 py-10 text-center text-sm font-semibold staff-muted-text";
        empty.textContent = includePackageNamesInCategorySearch()
            ? "No categories match your search (including package names)."
            : "No categories match your search.";
        grid.appendChild(empty);
    }

    filtered.forEach((category) => {
        const card = document.createElement("div");
        card.className =
            "group staff-card flex h-full flex-col overflow-hidden rounded-2xl transition-all hover:shadow-md hover:border-[color:rgba(22,81,102,0.28)]";
        const safeName = category.name.replace(/"/g, "&quot;");
        const safeImg = category.image || CATEGORY_PLACEHOLDER_IMG;
        card.innerHTML = `
            <div onclick="navigateToPackagesList(this.dataset.cat)" data-cat="${safeName}" class="cursor-pointer">
                <div class="relative aspect-[16/10] w-full overflow-hidden bg-[color:var(--heigen-field-muted-well-bg)] rounded-t-2xl">
                    <img src="${safeImg}" alt="${safeName}" class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                         onerror="this.src='${CATEGORY_PLACEHOLDER_IMG}'">
                </div>
            </div>
            <div class="flex flex-1 flex-col justify-center p-3 bg-white border-t border-[color:var(--heigen-border-ui)]">
                <div class="flex items-center gap-2">
                    <div class="flex-1 text-center min-w-0">
                        <p class="text-[color:var(--heigen-slate-deep)] font-segoe text-base font-bold truncate">${safeName}</p>
                        <p class="text-[color:var(--heigen-field-placeholder)] font-segoe text-xs">${category.packageCount} package(s)</p>
                    </div>
                    <button type="button" onclick="openEditModal(${category.id == null ? "null" : category.id}, '${safeName.replace(/'/g, "\\'")}')" class="flex-shrink-0 p-2 rounded-lg text-[color:var(--heigen-teal)] hover:bg-[color:var(--heigen-table-hover)] transition-colors" title="Edit category">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });

    const createCard = document.createElement("button");
    createCard.onclick = openCreateModal;
    createCard.type = "button";
    createCard.className = "staff-create-tile h-full min-h-[260px]";
    createCard.innerHTML =
        '<span class="staff-create-tile__label">+ Create category</span><span class="text-[11px] font-semibold text-[color:var(--heigen-field-placeholder)] mt-1.5">Add a new group for packages</span>';
    grid.appendChild(createCard);
}

function renderArchivedCategories() {
    const section = document.getElementById("archivedCategoriesSection");
    const grid = document.getElementById("archivedCategoriesGrid");
    if (!section || !grid) return;
    grid.innerHTML = "";
    const q = getCategorySearchQuery();
    const filteredArchived = q
        ? archivedCategories.filter((c) => categoryMatchesSearchQuery(c, q))
        : archivedCategories;
    if (!filteredArchived.length) {
        section.classList.add("hidden");
        return;
    }
    section.classList.remove("hidden");
    filteredArchived.forEach((category) => {
        const card = document.createElement("div");
        card.className =
            "staff-card flex h-full flex-col overflow-hidden rounded-2xl bg-[color:var(--heigen-toolbar-surface-bg)] border border-[color:var(--heigen-border-ui)]";
        const safeName = category.name.replace(/"/g, "&quot;");
        const safeImg = category.image || CATEGORY_PLACEHOLDER_IMG;
        card.innerHTML = `
            <div class="relative aspect-[16/10] w-full overflow-hidden bg-[color:var(--heigen-field-muted-well-bg)] opacity-90">
                <img src="${safeImg}" alt="${safeName}" class="h-full w-full object-cover opacity-75"
                     onerror="this.src='${CATEGORY_PLACEHOLDER_IMG}'">
            </div>
            <div class="p-3 space-y-2 flex-1 flex flex-col">
                <div>
                    <p class="text-[color:var(--heigen-slate-deep)] font-segoe text-base font-bold">${safeName}</p>
                    <p class="text-[color:var(--heigen-field-placeholder)] font-segoe text-xs">Archived</p>
                </div>
                <div class="flex gap-2">
                    <button type="button" onclick="toggleCategoryArchive(${category.id}, false)" class="staff-btn-primary min-h-[28px] text-[11px] px-3">Restore</button>
                    <button type="button" onclick="openEditModal(${category.id}, '${safeName.replace(/'/g, "\\'")}', true)" class="staff-btn-secondary min-h-[28px] text-[11px] px-3">Manage</button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function getCategoryImageForEdit(categoryId, categoryName) {
    const all = [...categories, ...archivedCategories];
    let rec = null;
    if (categoryId != null && categoryId !== "") {
        const idNum = Number(categoryId);
        if (Number.isFinite(idNum)) {
            rec = all.find((c) => c.id === idNum);
        }
    }
    if (!rec && categoryName) {
        const key = String(categoryName).trim().toLowerCase();
        rec = all.find((c) => c.name.toLowerCase() === key);
    }
    const img = rec && rec.image ? String(rec.image).trim() : "";
    return img;
}

function openCreateModal() {
    pendingCategoryImage = null;
    document.getElementById("createCategoryName").value = "";
    document.getElementById("createCategoryPhoto").value = "";
    document.getElementById("createPhotoName").textContent = "No file chosen";
    setUploadPreviewById(
        "createCategoryPhotoPreview",
        "createCategoryPhotoPreviewBox",
        "",
    );
    setModalVisible("createCategoryModal", true);
}

function closeCreateModal() {
    setModalVisible("createCategoryModal", false);
}

function openEditModal(categoryId, categoryName, isArchived = false) {
    editingCategoryId = categoryId;
    editingCategoryName = categoryName;
    editingCategoryArchived = !!isArchived;
    pendingEditImage = null;
    document.getElementById("editCategoryName").value = categoryName;
    document.getElementById("editCategoryPhoto").value = "";
    editCategoryPreviewBase = getCategoryImageForEdit(categoryId, categoryName);
    const label = document.getElementById("editPhotoName");
    if (label) {
        label.textContent = editCategoryPreviewBase
            ? "Current image"
            : "No file chosen";
    }
    setUploadPreviewById(
        "editCategoryPhotoPreview",
        "editCategoryPhotoPreviewBox",
        editCategoryPreviewBase,
    );
    const archiveBtn = document.querySelector('#editCategoryModal button[onclick="archiveCategory()"]');
    if (archiveBtn) archiveBtn.textContent = editingCategoryArchived ? "Restore" : "Archive";
    setModalVisible("editCategoryModal", true);
}

function closeEditModal() {
    setModalVisible("editCategoryModal", false);
    editingCategoryId = null;
    editingCategoryName = null;
    editingCategoryArchived = false;
}

async function saveCreateCategory() {
    const name = document.getElementById("createCategoryName").value.trim();
    if (!name) {
        window.heigenAlert("Please enter a category name.");
        return;
    }
    try {
        const imageUrl = pendingCategoryImage
            ? await pendingPhotoToDataUrl(
                  pendingCategoryImage,
                  "createCategoryPhotoPreviewBox",
              )
            : null;
        await request("/categories/", {
            method: "POST",
            body: JSON.stringify({
                name,
                image_url: imageUrl,
            }),
        });
        closeCreateModal();
        await loadCategories();
        navigateToPackagesList(name);
    } catch (e) {
        window.heigenAlert(`Failed to create category: ${e.message}`);
    }
}

async function saveEditCategory() {
    const newName = document.getElementById("editCategoryName").value.trim();
    if (!editingCategoryName) return;
    if (!editingCategoryId) {
        window.heigenAlert("This category needs to be recreated to support independent category photo.");
        return;
    }
    if (!newName) {
        window.heigenAlert("Please enter a category name.");
        return;
    }
    try {
        const imageUrl = pendingEditImage
            ? await pendingPhotoToDataUrl(
                  pendingEditImage,
                  "editCategoryPhotoPreviewBox",
              )
            : null;
        await request(`/categories/${editingCategoryId}/`, {
            method: "PATCH",
            body: JSON.stringify({
                name: newName,
                ...(imageUrl ? { image_url: imageUrl } : {}),
            }),
        });
        closeEditModal();
        await loadCategories();
    } catch (e) {
        window.heigenAlert(`Failed to update category: ${e.message}`);
    }
}

async function deleteCategory() {
    if (!editingCategoryName) return;
    if (!editingCategoryId) {
        window.heigenAlert("This category cannot be deleted until it is recreated in Categories.");
        return;
    }
    const approved = await window.heigenConfirm(
        `Delete category "${editingCategoryName}" and all packages inside it?`,
        { title: "Delete Category", confirmText: "Delete", dangerous: true },
    );
    if (!approved) {
        return;
    }
    try {
        const pkgRes = await request("/packages/?include_archived=1");
        const packages = Array.isArray(pkgRes) ? pkgRes : pkgRes.results || [];
        const matches = packages.filter(
            (p) =>
                String(p.category || "").trim().toLowerCase() ===
                editingCategoryName.toLowerCase(),
        );
        await Promise.all(
            matches.map((p) =>
                request(`/packages/${p.id}/`, { method: "DELETE" }),
            ),
        );
        await request(`/categories/${editingCategoryId}/`, { method: "DELETE" });
        closeEditModal();
        await loadCategories();
    } catch (e) {
        window.heigenAlert(`Failed to delete category: ${e.message}`);
    }
}

async function toggleCategoryArchive(categoryId, shouldArchive) {
    if (!categoryId) return;
    try {
        await request(`/categories/${categoryId}/`, {
            method: "PATCH",
            body: JSON.stringify({ is_archived: !!shouldArchive }),
        });
        if (editingCategoryId === categoryId) closeEditModal();
        await loadCategories();
    } catch (e) {
        window.heigenAlert(`Failed to update category archive: ${e.message}`);
    }
}

async function archiveCategory() {
    if (!editingCategoryId || !editingCategoryName) return;
    const nextArchivedState = !editingCategoryArchived;
    const approved = await window.heigenConfirm(
        nextArchivedState
            ? `Archive category "${editingCategoryName}" and its packages?`
            : `Restore category "${editingCategoryName}" and its packages?`,
        {
            title: nextArchivedState ? "Archive Category" : "Restore Category",
            confirmText: nextArchivedState ? "Archive" : "Restore",
            dangerous: nextArchivedState,
        },
    );
    if (!approved) return;
    await toggleCategoryArchive(editingCategoryId, nextArchivedState);
}

function navigateToPackagesList(categoryName) {
    staffNavigateTo(
        `packages-list.html?category=${encodeURIComponent(categoryName)}`,
    );
}

window.openLogoutModal = async function openLogoutModal(e) {
    e.preventDefault();
    if (typeof window.heigenConfirm === "function") {
        const ok = await window.heigenConfirm("Are you sure you want to log out?", {
            title: "Log out",
            confirmText: "Log out",
            dangerous: false,
        });
        if (!ok) return;
        if (typeof window.confirmLogout === "function") {
            await Promise.resolve(window.confirmLogout());
        } else {
            window.location.href = "../../index.html";
        }
        return;
    }
    const modal = document.getElementById("logoutModal");
    if (!modal) return;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
};

window.closeLogoutModal = function closeLogoutModal() {
    const modal = document.getElementById("logoutModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.classList.remove("flex");
};

function bindPhotoInput({
    inputId,
    labelId,
    onFileAccepted,
    previewImgId,
    previewBoxId,
    restorePreviewUrl,
}) {
    document.getElementById(inputId)?.addEventListener("change", function () {
        const file = this.files && this.files[0];
        if (!file) return;
        const label = document.getElementById(labelId);
        if (!ensureUploadSize(file)) {
            this.value = "";
            onFileAccepted(null);
            const base =
                typeof restorePreviewUrl === "function"
                    ? restorePreviewUrl()
                    : "";
            if (label) {
                label.textContent = base ? "Current image" : "No file chosen";
            }
            setUploadPreviewById(previewImgId, previewBoxId, base);
            return;
        }
        if (label) label.textContent = file.name;
        onFileAccepted(file);
        const reader = new FileReader();
        reader.onload = () => {
            setUploadPreviewById(
                previewImgId,
                previewBoxId,
                reader.result || "",
            );
        };
        reader.readAsDataURL(file);
    });
}

window.confirmLogout = function confirmLogout() {
    window.location.href = "../../index.html";
};

bindPhotoInput({
    inputId: "createCategoryPhoto",
    labelId: "createPhotoName",
    onFileAccepted(file) {
        pendingCategoryImage = file;
    },
    previewImgId: "createCategoryPhotoPreview",
    previewBoxId: "createCategoryPhotoPreviewBox",
});
bindPhotoInput({
    inputId: "editCategoryPhoto",
    labelId: "editPhotoName",
    onFileAccepted(file) {
        pendingEditImage = file;
    },
    previewImgId: "editCategoryPhotoPreview",
    previewBoxId: "editCategoryPhotoPreviewBox",
    restorePreviewUrl: () => editCategoryPreviewBase,
});

window.openCreateModal = openCreateModal;
window.closeCreateModal = closeCreateModal;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.saveCreateCategory = saveCreateCategory;
window.saveEditCategory = saveEditCategory;
window.deleteCategory = deleteCategory;
window.archiveCategory = archiveCategory;
window.toggleCategoryArchive = toggleCategoryArchive;
window.navigateToPackagesList = navigateToPackagesList;

function bindCategorySearchControls() {
    const rerender = () => {
        renderCategories();
        renderArchivedCategories();
    };
    const input = document.getElementById("categorySearchInput");
    if (input && input.dataset.bound !== "1") {
        input.dataset.bound = "1";
        input.addEventListener("input", rerender);
    }
    const includePkgs = document.getElementById("categorySearchIncludePackages");
    if (includePkgs && includePkgs.dataset.bound !== "1") {
        includePkgs.dataset.bound = "1";
        includePkgs.addEventListener("change", rerender);
    }
}

async function startPackagePage() {
    bindCategorySearchControls();
    const loading = document.getElementById("categoriesLoading");
    const grid = document.getElementById("categoriesGrid");
    try {
        await loadCategories();
    } catch (e) {
        console.error("Failed to load categories:", e);
        window.heigenAlert(`Failed to load categories: ${e.message}`);
    } finally {
        if (loading) loading.style.display = "none";
        if (grid) grid.classList.remove("hidden");
    }
}

startPackagePage();
