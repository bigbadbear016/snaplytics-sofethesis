const API_BASE = "http://127.0.0.1:8000/api";

const CATEGORY_IMG = {
    Regular: "https://api.builder.io/api/v1/image/assets/TEMP/c85bfb6836c45dfd4826c29c28b7e2b3c390cf02?width=648",
    "Christmas Package 2024":
        "https://api.builder.io/api/v1/image/assets/TEMP/fbc99412b71e7c3272ff835edf9e4640168e4fd6?width=648",
    Graduation:
        "https://api.builder.io/api/v1/image/assets/TEMP/87bafc4ede6565c276d9d45cb28b394868d95e41?width=648",
    Yearbook:
        "https://api.builder.io/api/v1/image/assets/TEMP/1408ee2a03b3133a699a0b2578fc189b3c6b8787?width=648",
};
const FALLBACK_IMG =
    "https://api.builder.io/api/v1/image/assets/TEMP/5b9fb9f4dc0f35f1e347009fc13d773271d54b2f?width=648";

let categoryName = "";
let currentTab = "package";
let packages = [];
let addons = [];
let filteredPackages = [];
let filteredAddons = [];
let editingItemId = null;
let editingItemType = "package";
let pendingCreatePackageImage = null;
let pendingEditPackageImage = null;
let pendingCreateAddonImage = null;
let pendingEditAddonImage = null;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

async function apiRequest(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
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

function ensureUploadSize(file) {
    if (!file) return true;
    if (file.size > MAX_UPLOAD_BYTES) {
        alert("Photo must be 2MB or smaller.");
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

function formatPrice(price) {
    return `₱${toAmount(price).toFixed(2)}`;
}

function toAmount(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const cleaned = value.replace(/[^\d.-]/g, "");
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function categoryImage(category) {
    const raw = String(category || "").trim();
    if (!raw) return FALLBACK_IMG;
    if (CATEGORY_IMG[raw]) return CATEGORY_IMG[raw];

    const normalized = raw.toLowerCase();
    if (normalized.includes("christmas")) {
        return CATEGORY_IMG["Christmas Package 2024"];
    }
    if (normalized.includes("graduation")) {
        return CATEGORY_IMG.Graduation;
    }
    if (normalized.includes("yearbook")) {
        return CATEGORY_IMG.Yearbook;
    }
    if (normalized.includes("regular")) {
        return CATEGORY_IMG.Regular;
    }

    return FALLBACK_IMG;
}

function normalizePackage(p) {
    const basePrice = toAmount(p.price);
    const promoPrice = p.promo_price == null ? null : toAmount(p.promo_price);
    const displayPrice =
        promoPrice != null && promoPrice > 0 ? promoPrice : basePrice;

    return {
        id: p.id,
        name: p.name || "",
        category: p.category || "",
        price: displayPrice,
        originalPrice: basePrice,
        promoPrice,
        raw: p,
        details: Array.isArray(p.inclusions) ? p.inclusions : [],
        image: p.image_url || categoryImage(p.category),
    };
}

function normalizeAddon(a) {
    return {
        id: a.id,
        name: a.name || "",
        price: Number(a.price || 0),
        description: a.additional_info || "",
        appliesTo: a.applies_to,
        image: a.image_url || "",
        raw: a,
    };
}

function addonAppliesToCategory(addon, cat) {
    if (!cat) return true;
    const applies = addon.applies_to;
    if (!applies) return true;
    if (Array.isArray(applies)) {
        return applies.map(String).some((x) => x.toLowerCase() === cat.toLowerCase());
    }
    return String(applies).toLowerCase().includes(cat.toLowerCase());
}

async function initializeData() {
    const params = new URLSearchParams(window.location.search);
    categoryName = decodeURIComponent(params.get("category") || "").trim();
    if (!categoryName) categoryName = "All";

    document.getElementById("pageTitle").textContent = `Package List - ${categoryName}`;

    const [pkgRes, addonRes] = await Promise.all([
        apiRequest("/packages/"),
        apiRequest("/addons/"),
    ]);

    const pkgList = Array.isArray(pkgRes) ? pkgRes : pkgRes.results || [];
    const addonList = Array.isArray(addonRes) ? addonRes : addonRes.results || [];

    packages = pkgList
        .filter((p) => categoryName === "All" || String(p.category || "").toLowerCase() === categoryName.toLowerCase())
        .map(normalizePackage);
    addons = addonList
        .filter((a) => categoryName === "All" || addonAppliesToCategory(a, categoryName))
        .map(normalizeAddon);

    filteredPackages = [...packages];
    filteredAddons = [...addons];
}

function renderItems() {
    const grid = document.getElementById("gridContainer");
    if (!grid) return;
    grid.innerHTML = "";

    const items = currentTab === "package" ? filteredPackages : filteredAddons;

    items.forEach((item) => {
        const card = document.createElement("div");
        if (currentTab === "package") {
            card.className = "flex flex-col rounded-2xl overflow-hidden bg-white shadow-sm";
            card.innerHTML = `
                <img src="${item.image}" alt="${item.name}" class="w-full h-[156px] object-cover"
                     onerror="this.src='${FALLBACK_IMG}'">
                <div class="p-4 space-y-2">
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex-1 min-w-0">
                            <h3 class="text-[#4F6E79] font-segoe text-lg font-bold truncate">${item.name}</h3>
                            ${
                                item.promoPrice != null &&
                                item.promoPrice > 0 &&
                                item.originalPrice > item.promoPrice
                                    ? `<p class="flex items-center gap-2">
                                         <span class="text-[#4F6E79] font-segoe text-sm font-bold">${formatPrice(item.promoPrice)}</span>
                                         <span class="text-[#9AA8AF] font-segoe text-xs line-through">${formatPrice(item.originalPrice)}</span>
                                       </p>`
                                    : `<p class="text-[#4F6E79] font-segoe text-sm font-bold">${formatPrice(item.price)}</p>`
                            }
                        </div>
                        <button onclick="openEditModal(${item.id}, 'package')" class="p-1 hover:bg-gray-100 rounded">
                            ✎
                        </button>
                    </div>
                    ${item.details.slice(0, 3).map((d) => `<p class="text-[#777] font-segoe text-sm">${d}</p>`).join("")}
                </div>
            `;
        } else {
            card.className = "flex flex-col p-4 rounded-2xl bg-white shadow-sm space-y-2";
            card.innerHTML = `
                ${
                    item.image
                        ? `<img src="${item.image}" alt="${item.name}" class="w-full h-[120px] object-cover rounded-xl" onerror="this.style.display='none'">`
                        : ""
                }
                <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                        <h3 class="text-[#4F6E79] font-segoe text-base font-bold truncate">${item.name}</h3>
                        <p class="text-[#4F6E79] font-segoe text-xs font-bold">${formatPrice(item.price)}</p>
                    </div>
                    <button onclick="openEditModal(${item.id}, 'addon')" class="p-1 hover:bg-gray-100 rounded">
                        ✎
                    </button>
                </div>
                <p class="text-[#777] font-segoe text-xs">${item.description || ""}</p>
            `;
        }
        grid.appendChild(card);
    });

    const createCard = document.createElement("button");
    createCard.onclick = () => openCreateModal(currentTab);
    createCard.className =
        `flex items-center justify-center rounded-2xl border-4 border-dashed border-[#BDDAE0] h-[${currentTab === "package" ? "291" : "110"}px] hover:border-[#9DBAC0] transition-colors`;
    createCard.innerHTML = `<p class="text-[#BDDAE0] font-segoe text-base font-bold">${currentTab === "package" ? "CREATE PACKAGE" : "NEW ADDON"}</p>`;
    grid.appendChild(createCard);
}

function getInclusionValues(containerId) {
    const inputs = document.querySelectorAll(`#${containerId} input`);
    return Array.from(inputs)
        .map((i) => i.value.trim())
        .filter(Boolean);
}

function renderInclusionFields(containerId, values = [""]) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    values.forEach((v) => {
        const wrapper = document.createElement("div");
        wrapper.className = "flex items-center gap-2";
        wrapper.innerHTML = `
            <input type="text" value="${v}" placeholder="Enter inclusion"
                   class="flex-1 border border-[#A2A2A2] rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#165166]">
            <button type="button" class="p-1 text-[#A2A2A2] hover:text-red-500" data-remove>🗑</button>
        `;
        wrapper.querySelector("[data-remove]").addEventListener("click", () => {
            wrapper.remove();
        });
        container.appendChild(wrapper);
    });
}

function openCreateModal(type) {
    editingItemId = null;
    editingItemType = type;
    document.getElementById("createModalTitle").textContent = type === "package" ? "Create Package" : "Create Addon";
    document.getElementById("createSaveBtn").textContent = type === "package" ? "Save" : "Confirm";
    document.getElementById("packageFormFields").style.display = type === "package" ? "block" : "none";
    document.getElementById("addonFormFields").style.display = type === "addon" ? "block" : "none";
    document.getElementById("createName").value = "";
    document.getElementById("createPrice").value = "";
    document.getElementById("createAddonName").value = "";
    document.getElementById("createAddonPrice").value = "";
    document.getElementById("createAddonComment").value = "";
    document.getElementById("createPhoto").value = "";
    document.getElementById("createPhotoName").textContent = "photo.png";
    document.getElementById("createAddonPhoto").value = "";
    document.getElementById("createAddonPhotoName").textContent = "photo.png";
    pendingCreatePackageImage = null;
    pendingCreateAddonImage = null;
    document.getElementById("commentCount").textContent = "0";
    renderInclusionFields("inclusionsContainer", [""]);
    document.getElementById("createModal").classList.remove("hidden");
}

function closeCreateModal() {
    document.getElementById("createModal").classList.add("hidden");
}

function openEditModal(itemId, type) {
    editingItemId = itemId;
    editingItemType = type;
    document.getElementById("editModalTitle").textContent = type === "package" ? "Edit Package" : "Edit Addon";
    document.getElementById("editSaveBtn").textContent = type === "package" ? "Save" : "Confirm";
    document.getElementById("editPackageFields").style.display = type === "package" ? "block" : "none";
    document.getElementById("editAddonFields").style.display = type === "addon" ? "block" : "none";
    document.getElementById("editPhoto").value = "";
    const editPhotoLabel = document.getElementById("editPhotoName");
    if (editPhotoLabel) editPhotoLabel.textContent = "photo.png";
    document.getElementById("editAddonPhoto").value = "";
    const editAddonPhotoLabel = document.getElementById("editAddonPhotoName");
    if (editAddonPhotoLabel) editAddonPhotoLabel.textContent = "photo.png";
    pendingEditPackageImage = null;
    pendingEditAddonImage = null;

    if (type === "package") {
        const item = packages.find((p) => p.id === itemId);
        if (!item) return;
        document.getElementById("editName").value = item.name;
        document.getElementById("editPrice").value = String(item.originalPrice ?? item.price ?? "");
        renderInclusionFields("editInclusionsContainer", item.details.length ? item.details : [""]);
    } else {
        const item = addons.find((a) => a.id === itemId);
        if (!item) return;
        document.getElementById("editAddonName").value = item.name;
        document.getElementById("editAddonPrice").value = String(item.price || "");
        document.getElementById("editAddonComment").value = item.description || "";
        document.getElementById("editCommentCount").textContent = String((item.description || "").length);
    }
    document.getElementById("editModal").classList.remove("hidden");
}

function closeEditModal() {
    document.getElementById("editModal").classList.add("hidden");
    editingItemId = null;
}

async function saveCreateItem() {
    try {
        if (editingItemType === "package") {
            const name = document.getElementById("createName").value.trim();
            const price = Number(document.getElementById("createPrice").value);
            if (!name || Number.isNaN(price)) throw new Error("Package name and numeric price are required.");
            const inclusions = getInclusionValues("inclusionsContainer");
            const imageUrl = pendingCreatePackageImage
                ? await fileToDataUrl(pendingCreatePackageImage)
                : null;
            await apiRequest("/packages/", {
                method: "POST",
                body: JSON.stringify({
                    name,
                    category: categoryName === "All" ? "General" : categoryName,
                    price,
                    inclusions,
                    image_url: imageUrl,
                }),
            });
        } else {
            const name = document.getElementById("createAddonName").value.trim();
            const price = Number(document.getElementById("createAddonPrice").value);
            const additional_info = document.getElementById("createAddonComment").value.trim();
            if (!name || Number.isNaN(price)) throw new Error("Addon name and numeric price are required.");
            const imageUrl = pendingCreateAddonImage
                ? await fileToDataUrl(pendingCreateAddonImage)
                : null;
            await apiRequest("/addons/", {
                method: "POST",
                body: JSON.stringify({
                    name,
                    price,
                    additional_info,
                    applies_to: categoryName === "All" ? "" : categoryName,
                    image_url: imageUrl,
                }),
            });
        }
        closeCreateModal();
        await initializeData();
        applySearchFilter();
        renderItems();
    } catch (e) {
        alert(`Create failed: ${e.message}`);
    }
}

async function saveEditItem() {
    if (!editingItemId) return;
    try {
        if (editingItemType === "package") {
            const name = document.getElementById("editName").value.trim();
            const price = Number(document.getElementById("editPrice").value);
            if (!name || Number.isNaN(price)) throw new Error("Package name and numeric price are required.");
            const inclusions = getInclusionValues("editInclusionsContainer");
            const imageUrl = pendingEditPackageImage
                ? await fileToDataUrl(pendingEditPackageImage)
                : null;
            await apiRequest(`/packages/${editingItemId}/`, {
                method: "PATCH",
                body: JSON.stringify({
                    name,
                    price,
                    inclusions,
                    ...(imageUrl ? { image_url: imageUrl } : {}),
                }),
            });
        } else {
            const name = document.getElementById("editAddonName").value.trim();
            const price = Number(document.getElementById("editAddonPrice").value);
            const additional_info = document.getElementById("editAddonComment").value.trim();
            if (!name || Number.isNaN(price)) throw new Error("Addon name and numeric price are required.");
            const imageUrl = pendingEditAddonImage
                ? await fileToDataUrl(pendingEditAddonImage)
                : null;
            await apiRequest(`/addons/${editingItemId}/`, {
                method: "PATCH",
                body: JSON.stringify({
                    name,
                    price,
                    additional_info,
                    ...(imageUrl ? { image_url: imageUrl } : {}),
                }),
            });
        }
        closeEditModal();
        await initializeData();
        applySearchFilter();
        renderItems();
    } catch (e) {
        alert(`Update failed: ${e.message}`);
    }
}

async function deleteItem() {
    if (!editingItemId) return;
    if (!confirm(`Delete this ${editingItemType}?`)) return;
    try {
        if (editingItemType === "package") {
            await apiRequest(`/packages/${editingItemId}/`, { method: "DELETE" });
        } else {
            await apiRequest(`/addons/${editingItemId}/`, { method: "DELETE" });
        }
        closeEditModal();
        await initializeData();
        applySearchFilter();
        renderItems();
    } catch (e) {
        alert(`Delete failed: ${e.message}`);
    }
}

function applySearchFilter() {
    const q = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
    filteredPackages = packages.filter((p) => p.name.toLowerCase().includes(q));
    filteredAddons = addons.filter((a) => a.name.toLowerCase().includes(q));
}

function switchTab(tab) {
    currentTab = tab;
    document.getElementById("packageTab").className =
        tab === "package"
            ? "px-6 h-[30px] rounded-l-[17px] bg-[#FFE8AD] text-[#4F6E79] font-segoe text-sm font-semibold transition-colors"
            : "px-6 h-[30px] rounded-l-[17px]  text-[#FFE8AD] border-2 border-[#FFE8AD] font-segoe text-sm font-semibold transition-colors";
    document.getElementById("addonTab").className =
        tab === "addon"
            ? "px-6 h-[30px] rounded-r-[17px] bg-[#FFE8AD] text-[#4F6E79] font-segoe text-sm font-semibold transition-colors"
            : "px-6 h-[30px] rounded-r-[17px] text-[#FFE8AD] border-2 border-[#FFE8AD] font-segoe text-sm font-semibold transition-colors";
    renderItems();
}

function addInclusionField() {
    const vals = getInclusionValues("inclusionsContainer");
    vals.push("");
    renderInclusionFields("inclusionsContainer", vals);
}

function addEditInclusionField() {
    const vals = getInclusionValues("editInclusionsContainer");
    vals.push("");
    renderInclusionFields("editInclusionsContainer", vals);
}

function removeInclusionField(idx) {
    const inputs = document.querySelectorAll("#inclusionsContainer input");
    if (inputs[idx]) inputs[idx].parentElement.remove();
}

function removeEditInclusionField(idx) {
    const inputs = document.querySelectorAll("#editInclusionsContainer input");
    if (inputs[idx]) inputs[idx].parentElement.remove();
}

function toggleMobileSidebar(show) {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("mobileOverlay");
    if (show) {
        sidebar.classList.add("mobile-open");
        overlay.classList.add("show");
    } else {
        sidebar.classList.remove("mobile-open");
        overlay.classList.remove("show");
    }
}

function goBackToPackages() {
    window.location.href = "packages.html";
}

function openLogoutModal(e) {
    e.preventDefault();
    document.getElementById("logoutModal").classList.remove("hidden");
    document.getElementById("logoutModal").classList.add("flex");
}

function closeLogoutModal() {
    document.getElementById("logoutModal").classList.add("hidden");
    document.getElementById("logoutModal").classList.remove("flex");
}

function confirmLogout() {
    window.location.href = "../../index.html";
}

document.getElementById("searchInput")?.addEventListener("input", () => {
    applySearchFilter();
    renderItems();
});
document.getElementById("createAddonComment")?.addEventListener("input", (e) => {
    const c = document.getElementById("commentCount");
    if (c) c.textContent = String(e.target.value.length);
});
document.getElementById("editAddonComment")?.addEventListener("input", (e) => {
    const c = document.getElementById("editCommentCount");
    if (c) c.textContent = String(e.target.value.length);
});
document.getElementById("createPhoto")?.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!ensureUploadSize(file)) {
        e.target.value = "";
        pendingCreatePackageImage = null;
        pendingCreateAddonImage = null;
        document.getElementById("createPhotoName").textContent = "photo.png";
        return;
    }
    document.getElementById("createPhotoName").textContent = file.name;
    pendingCreatePackageImage = file;
});
document.getElementById("createAddonPhoto")?.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!ensureUploadSize(file)) {
        e.target.value = "";
        pendingCreateAddonImage = null;
        document.getElementById("createAddonPhotoName").textContent = "photo.png";
        return;
    }
    document.getElementById("createAddonPhotoName").textContent = file.name;
    pendingCreateAddonImage = file;
});
document.getElementById("editPhoto")?.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!ensureUploadSize(file)) {
        e.target.value = "";
        pendingEditPackageImage = null;
        pendingEditAddonImage = null;
        const label = document.getElementById("editPhotoName");
        if (label) label.textContent = "photo.png";
        return;
    }
    const label = document.getElementById("editPhotoName");
    if (label) label.textContent = file.name;
    pendingEditPackageImage = file;
});
document.getElementById("editAddonPhoto")?.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!ensureUploadSize(file)) {
        e.target.value = "";
        pendingEditAddonImage = null;
        const label = document.getElementById("editAddonPhotoName");
        if (label) label.textContent = "photo.png";
        return;
    }
    const label = document.getElementById("editAddonPhotoName");
    if (label) label.textContent = file.name;
    pendingEditAddonImage = file;
});

Object.assign(window, {
    goBackToPackages,
    toggleMobileSidebar,
    switchTab,
    openCreateModal,
    closeCreateModal,
    openEditModal,
    closeEditModal,
    saveCreateItem,
    saveEditItem,
    deleteItem,
    addInclusionField,
    removeInclusionField,
    addEditInclusionField,
    removeEditInclusionField,
    openLogoutModal,
    closeLogoutModal,
    confirmLogout,
});

async function startListPage() {
    const loading = document.getElementById("listLoading");
    const grid = document.getElementById("gridContainer");
    try {
        await initializeData();
        applySearchFilter();
        renderItems();
    } catch (e) {
        console.error("Failed to initialize package list:", e);
        alert(`Failed to load package list: ${e.message}`);
    } finally {
        if (loading) loading.style.display = "none";
        if (grid) grid.classList.remove("hidden");
    }
}

startListPage();
