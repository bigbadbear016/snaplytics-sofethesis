const API_BASE = "http://127.0.0.1:8000/api";
const FALLBACK_IMG =
    "https://api.builder.io/api/v1/image/assets/TEMP/c85bfb6836c45dfd4826c29c28b7e2b3c390cf02?width=648";

let categories = [];
let editingCategoryId = null;
let editingCategoryName = null;
let pendingCategoryImage = null;
let pendingEditImage = null;
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
        alert(getFileTooLargeMessage());
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
        request("/categories/"),
        request("/packages/"),
    ]);
    const categoryList = Array.isArray(catRes) ? catRes : catRes.results || [];
    const packages = Array.isArray(pkgRes) ? pkgRes : pkgRes.results || [];
    const packageCountMap = new Map();
    for (const p of packages) {
        const cat = String(p.category || "").trim();
        if (!cat) continue;
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
                packageCount: packageCountMap.get(key) || 0,
            });
        }
    }
    categories = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    renderCategories();
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
        const safeImg = category.image || FALLBACK_IMG;
        card.innerHTML = `
            <div onclick="navigateToPackagesList(this.dataset.cat)" data-cat="${safeName}" class="cursor-pointer">
                <img src="${safeImg}" alt="${safeName}" class="w-full h-[156px] object-cover rounded-t-2xl"
                     onerror="this.src='${FALLBACK_IMG}'">
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

function openCreateModal() {
    pendingCategoryImage = null;
    document.getElementById("createCategoryName").value = "";
    document.getElementById("createCategoryPhoto").value = "";
    document.getElementById("createPhotoName").textContent = "photo.png";
    setModalVisible("createCategoryModal", true);
}

function closeCreateModal() {
    setModalVisible("createCategoryModal", false);
}

function openEditModal(categoryId, categoryName) {
    editingCategoryId = categoryId;
    editingCategoryName = categoryName;
    pendingEditImage = null;
    document.getElementById("editCategoryName").value = categoryName;
    document.getElementById("editCategoryPhoto").value = "";
    const label = document.getElementById("editPhotoName");
    if (label) label.textContent = "photo.png";
    setModalVisible("editCategoryModal", true);
}

function closeEditModal() {
    setModalVisible("editCategoryModal", false);
    editingCategoryId = null;
    editingCategoryName = null;
}

async function saveCreateCategory() {
    const name = document.getElementById("createCategoryName").value.trim();
    if (!name) {
        alert("Please enter a category name.");
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
        alert(`Failed to create category: ${e.message}`);
    }
}

async function saveEditCategory() {
    const newName = document.getElementById("editCategoryName").value.trim();
    if (!editingCategoryName) return;
    if (!editingCategoryId) {
        alert("This category needs to be recreated to support independent category photo.");
        return;
    }
    if (!newName) {
        alert("Please enter a category name.");
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
        alert(`Failed to update category: ${e.message}`);
    }
}

async function deleteCategory() {
    if (!editingCategoryName) return;
    if (!editingCategoryId) {
        alert("This category cannot be deleted until it is recreated in Categories.");
        return;
    }
    if (
        !confirm(
            `Delete category "${editingCategoryName}" and all packages inside it?`,
        )
    ) {
        return;
    }
    try {
        const pkgRes = await request("/packages/");
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
        alert(`Failed to delete category: ${e.message}`);
    }
}

function navigateToPackagesList(categoryName) {
    window.location.href = `packages-list.html?category=${encodeURIComponent(categoryName)}`;
}

window.openLogoutModal = function openLogoutModal(e) {
    e.preventDefault();
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

function bindPhotoInput(inputId, labelId, onFileAccepted) {
    document.getElementById(inputId)?.addEventListener("change", function () {
        const file = this.files && this.files[0];
        if (!file) return;
        if (!ensureUploadSize(file)) {
            this.value = "";
            onFileAccepted(null);
            const label = document.getElementById(labelId);
            if (label) label.textContent = "photo.png";
            return;
        }
        const label = document.getElementById(labelId);
        if (label) label.textContent = file.name;
        onFileAccepted(file);
    });
}

window.confirmLogout = function confirmLogout() {
    window.location.href = "../../index.html";
};

bindPhotoInput("createCategoryPhoto", "createPhotoName", function (file) {
    pendingCategoryImage = file;
});
bindPhotoInput("editCategoryPhoto", "editPhotoName", function (file) {
    pendingEditImage = file;
});

window.openCreateModal = openCreateModal;
window.closeCreateModal = closeCreateModal;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.saveCreateCategory = saveCreateCategory;
window.saveEditCategory = saveEditCategory;
window.deleteCategory = deleteCategory;
window.navigateToPackagesList = navigateToPackagesList;

async function startPackagePage() {
    const loading = document.getElementById("categoriesLoading");
    const grid = document.getElementById("categoriesGrid");
    try {
        await loadCategories();
    } catch (e) {
        console.error("Failed to load categories:", e);
        alert(`Failed to load categories: ${e.message}`);
    } finally {
        if (loading) loading.style.display = "none";
        if (grid) grid.classList.remove("hidden");
    }
}

startPackagePage();
