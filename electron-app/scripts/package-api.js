import { HEIGEN_MEDIA_PLACEHOLDER_DATA_URL } from "./package-placeholders.js";
import { setUploadPreviewById } from "./upload-preview-utils.js";

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
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

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
    return "Photo must be 2MB or smaller.";
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

async function loadCategories() {
    const [catRes, pkgRes] = await Promise.all([
        request("/categories/?include_archived=1"),
        request("/packages/?include_archived=1"),
    ]);
    const categoryList = Array.isArray(catRes) ? catRes : catRes.results || [];
    const packages = Array.isArray(pkgRes) ? pkgRes : pkgRes.results || [];
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

    categories.forEach((category) => {
        const card = document.createElement("div");
        card.className =
            "flex flex-col rounded-2xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow";
        const safeName = category.name.replace(/"/g, "&quot;");
        const safeImg = category.image || CATEGORY_PLACEHOLDER_IMG;
        card.innerHTML = `
            <div onclick="navigateToPackagesList(this.dataset.cat)" data-cat="${safeName}" class="cursor-pointer">
                <img src="${safeImg}" alt="${safeName}" class="w-full h-[156px] object-cover rounded-t-2xl"
                     onerror="this.src='${CATEGORY_PLACEHOLDER_IMG}'">
            </div>
            <div class="flex items-center p-3 bg-white">
                <div class="flex-1 text-center">
                    <p class="text-[#4F6E79] font-segoe text-base font-bold">${safeName}</p>
                    <p class="text-[#9AA8AF] font-segoe text-xs">${category.packageCount} package(s)</p>
                </div>
                <button onclick="openEditModal(${category.id == null ? "null" : category.id}, '${safeName.replace(/'/g, "\\'")}')" class="flex-shrink-0 p-2 hover:bg-gray-100 rounded">
                    ✎
                </button>
            </div>
        `;
        grid.appendChild(card);
    });

    const createCard = document.createElement("button");
    createCard.onclick = openCreateModal;
    createCard.className =
        "flex flex-col items-center justify-center rounded-2xl border-4 border-dashed border-[#BDDAE0] h-[224px] hover:border-[#9DBAC0] transition-colors";
    createCard.innerHTML =
        '<p class="text-[#BDDAE0] font-segoe text-base font-bold">CREATE CATEGORY</p>';
    grid.appendChild(createCard);
}

function renderArchivedCategories() {
    const section = document.getElementById("archivedCategoriesSection");
    const grid = document.getElementById("archivedCategoriesGrid");
    if (!section || !grid) return;
    grid.innerHTML = "";
    if (!archivedCategories.length) {
        section.classList.add("hidden");
        return;
    }
    section.classList.remove("hidden");
    archivedCategories.forEach((category) => {
        const card = document.createElement("div");
        card.className = "rounded-2xl overflow-hidden bg-white/95 border border-[#D6E3E6] shadow-sm";
        const safeName = category.name.replace(/"/g, "&quot;");
        const safeImg = category.image || CATEGORY_PLACEHOLDER_IMG;
        card.innerHTML = `
            <img src="${safeImg}" alt="${safeName}" class="w-full h-[156px] object-cover opacity-75"
                 onerror="this.src='${CATEGORY_PLACEHOLDER_IMG}'">
            <div class="p-3 space-y-2">
                <div>
                    <p class="text-[#4F6E79] font-segoe text-base font-bold">${safeName}</p>
                    <p class="text-[#9AA8AF] font-segoe text-xs">Archived</p>
                </div>
                <div class="flex gap-2">
                    <button onclick="toggleCategoryArchive(${category.id}, false)" class="rounded-full bg-[#165167] text-white text-xs h-[28px] px-4 shadow hover:bg-[#134152]">Restore</button>
                    <button onclick="openEditModal(${category.id}, '${safeName.replace(/'/g, "\\'")}', true)" class="rounded-full border border-[#165167] text-[#165166] text-xs h-[28px] px-4 shadow hover:bg-gray-50">Manage</button>
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
            ? await fileToDataUrl(pendingCategoryImage)
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
            ? await fileToDataUrl(pendingEditImage)
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

async function startPackagePage() {
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
