import { HEIGEN_MEDIA_PLACEHOLDER_DATA_URL } from "./package-placeholders.js";
import { setUploadPreviewById } from "./upload-preview-utils.js";

const API_BASE = "http://127.0.0.1:8000/api";

const PACKAGE_PLACEHOLDER_IMG = HEIGEN_MEDIA_PLACEHOLDER_DATA_URL;

/** When running inside admin shell iframe, route through parent so the shell owns navigation (no ad-hoc frame redirects). */
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

let categoryName = "";
let currentTab = "package";
let packages = [];
let addons = [];
let filteredPackages = [];
let filteredAddons = [];
let archivedPackages = [];
let filteredArchivedPackages = [];
let editingItemId = null;
let editingItemType = "package";
let pendingCreatePackageImage = null;
let pendingEditPackageImage = null;
let pendingCreateAddonImage = null;
let pendingEditAddonImage = null;
let editPackagePreviewBase = "";
let editAddonPreviewBase = "";
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

function setModalVisible(modalId, visible) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.toggle("hidden", !visible);
}

async function apiRequest(path, options = {}) {
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

function ensureUploadSize(file) {
    if (!file) return true;
    if (file.size > MAX_UPLOAD_BYTES) {
        window.heigenAlert("Photo must be 2MB or smaller.");
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

function packageCardImage(p) {
    const url = p.image_url == null ? "" : String(p.image_url).trim();
    return url || PACKAGE_PLACEHOLDER_IMG;
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
        image: packageCardImage(p),
        isArchived: !!p.is_archived,
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

    const tabParam = (params.get("tab") || "").toLowerCase();
    currentTab = tabParam === "addon" ? "addon" : "package";

    document.getElementById("pageTitle").textContent =
        categoryName === "All" ? "All packages" : categoryName;

    const [pkgRes, addonRes] = await Promise.all([
        apiRequest("/packages/?include_archived=1"),
        apiRequest("/addons/"),
    ]);

    const pkgList = Array.isArray(pkgRes) ? pkgRes : pkgRes.results || [];
    const addonList = Array.isArray(addonRes) ? addonRes : addonRes.results || [];

    const scopedPackages = pkgList
        .filter((p) => categoryName === "All" || String(p.category || "").toLowerCase() === categoryName.toLowerCase())
        .map(normalizePackage);
    packages = scopedPackages.filter((p) => !p.isArchived);
    archivedPackages = scopedPackages.filter((p) => p.isArchived);
    addons = addonList
        .filter((a) => categoryName === "All" || addonAppliesToCategory(a, categoryName))
        .map(normalizeAddon);

    filteredPackages = [...packages];
    filteredArchivedPackages = [...archivedPackages];
    filteredAddons = [...addons];
}

const CARD_SHELL =
    "group flex flex-col overflow-hidden rounded-2xl border border-[#E4ECEE] bg-white shadow-sm transition-all hover:border-[#165166]/25 hover:shadow-md";

function renderItems() {
    const grid = document.getElementById("gridContainer");
    if (!grid) return;
    grid.innerHTML = "";

    const items = currentTab === "package" ? filteredPackages : filteredAddons;

    if (items.length === 0) {
        const empty = document.createElement("div");
        empty.className =
            "col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#C5D5DA] bg-white/50 px-6 py-10 text-center";
        empty.innerHTML = `
            <p class="text-[#4F6E79] text-sm font-semibold">${currentTab === "package" ? "No packages yet" : "No add-ons yet"}</p>
            <p class="mt-1 max-w-sm text-xs text-[#9AA8AF]">Add one with the dashed “New” card below, or clear your search.</p>`;
        grid.appendChild(empty);
    }

    items.forEach((item) => {
        const card = document.createElement("div");
        if (currentTab === "package") {
            card.className = CARD_SHELL;
            const incBlock =
                item.details.length > 0
                    ? `<div class="mt-2 space-y-1 border-t border-[#EEF4F5] pt-2 text-left">
                            ${item.details
                                .slice(0, 3)
                                .map(
                                    (d) =>
                                        `<p class="text-[#5c6f75] font-segoe text-xs leading-snug line-clamp-2">${d}</p>`,
                                )
                                .join("")}
                       </div>`
                    : "";
            card.innerHTML = `
                <div class="relative aspect-[16/10] w-full overflow-hidden bg-[#E8EEF0]">
                    <img src="${item.image}" alt="" class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                         onerror="this.src='${PACKAGE_PLACEHOLDER_IMG}'">
                </div>
                <div class="flex flex-1 flex-col p-3">
                    <div class="flex items-start gap-2">
                        <div class="min-w-0 flex-1 text-center">
                            <h3 class="truncate font-segoe text-base font-bold text-[#4F6E79]">${item.name}</h3>
                            ${
                                item.promoPrice != null &&
                                item.promoPrice > 0 &&
                                item.originalPrice > item.promoPrice
                                    ? `<p class="mt-0.5 flex items-center justify-center gap-2">
                                         <span class="font-segoe text-xs font-bold text-[#4F6E79]">${formatPrice(item.promoPrice)}</span>
                                         <span class="font-segoe text-[11px] text-[#9AA8AF] line-through">${formatPrice(item.originalPrice)}</span>
                                       </p>`
                                    : `<p class="mt-0.5 font-segoe text-xs font-bold text-[#4F6E79]">${formatPrice(item.price)}</p>`
                            }
                        </div>
                        <button type="button" onclick="openEditModal(${item.id}, 'package')" title="Edit"
                                class="shrink-0 rounded-lg p-2 text-[#4F6E79] transition hover:bg-[#EEF6F7]">✎</button>
                    </div>
                    ${incBlock}
                </div>
            `;
        } else {
            const addonImg =
                item.image && String(item.image).trim()
                    ? item.image
                    : PACKAGE_PLACEHOLDER_IMG;
            card.className = CARD_SHELL;
            card.innerHTML = `
                <div class="relative aspect-[16/10] w-full overflow-hidden bg-[#E8EEF0]">
                    <img src="${addonImg}" alt="" class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                         onerror="this.src='${PACKAGE_PLACEHOLDER_IMG}'">
                </div>
                <div class="flex flex-1 flex-col p-3">
                    <div class="flex items-start gap-2">
                        <div class="min-w-0 flex-1">
                            <h3 class="truncate font-segoe text-base font-bold text-[#4F6E79]">${item.name}</h3>
                            <p class="mt-0.5 font-segoe text-xs font-bold text-[#4F6E79]">${formatPrice(item.price)}</p>
                        </div>
                        <button type="button" onclick="openEditModal(${item.id}, 'addon')" title="Edit"
                                class="shrink-0 rounded-lg p-2 text-[#4F6E79] transition hover:bg-[#EEF6F7]">✎</button>
                    </div>
                    ${
                        item.description
                            ? `<p class="mt-2 line-clamp-2 font-segoe text-xs leading-relaxed text-[#5c6f75]">${item.description}</p>`
                            : ""
                    }
                </div>
            `;
        }
        grid.appendChild(card);
    });

    const createCard = document.createElement("button");
    createCard.type = "button";
    createCard.onclick = () => openCreateModal(currentTab);
    const createMin =
        currentTab === "package"
            ? "min-h-[200px] sm:min-h-[220px]"
            : "min-h-[140px] sm:min-h-[160px]";
    createCard.className =
        `flex ${createMin} flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#165166]/20 bg-white/50 px-4 py-8 text-center transition hover:border-[#165166]/35 hover:bg-white/80`;
    createCard.innerHTML = `
        <span class="flex h-10 w-10 items-center justify-center rounded-full bg-[#165166]/10 text-lg font-light text-[#165166]">+</span>
        <span class="font-segoe text-sm font-bold tracking-wide text-[#4F6E79]">${currentTab === "package" ? "New package" : "New add-on"}</span>
        <span class="max-w-[200px] text-[11px] text-[#9AA8AF]">${currentTab === "package" ? "Add a package to this category" : "Optional photo and short note"}</span>`;
    grid.appendChild(createCard);
    renderArchivedItems();
}

function renderArchivedItems() {
    const section = document.getElementById("archivedItemsSection");
    const grid = document.getElementById("archivedGridContainer");
    if (!section || !grid) return;
    grid.innerHTML = "";
    if (currentTab !== "package" || !filteredArchivedPackages.length) {
        section.classList.add("hidden");
        return;
    }
    section.classList.remove("hidden");
    filteredArchivedPackages.forEach((item) => {
        const card = document.createElement("div");
        card.className =
            "flex flex-col overflow-hidden rounded-2xl border border-[#D0DEE2] bg-[#F8FAFB]/90 shadow-sm";
        card.innerHTML = `
            <div class="relative aspect-[16/10] w-full overflow-hidden opacity-90">
                <img src="${item.image}" alt="" class="h-full w-full object-cover grayscale-[15%]"
                     onerror="this.src='${PACKAGE_PLACEHOLDER_IMG}'">
                <span class="absolute left-2 top-2 rounded-md bg-[#4F6E79]/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Archived</span>
            </div>
            <div class="space-y-3 p-3">
                <div class="text-center">
                    <h3 class="truncate font-segoe text-base font-bold text-[#4F6E79]">${item.name}</h3>
                </div>
                <div class="flex flex-wrap justify-center gap-2">
                    <button type="button" onclick="togglePackageArchive(${item.id}, false)" class="h-[28px] rounded-full bg-[#165167] px-4 text-xs font-semibold text-white shadow-sm hover:bg-[#134152]">Restore</button>
                    <button type="button" onclick="openEditModal(${item.id}, 'package')" class="h-[28px] rounded-full border border-[#165167] px-4 text-xs font-semibold text-[#165166] hover:bg-white">Manage</button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
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
    document.getElementById("createPhotoName").textContent = "No file chosen";
    document.getElementById("createAddonPhoto").value = "";
    document.getElementById("createAddonPhotoName").textContent = "No file chosen";
    setUploadPreviewById(
        "createPackagePhotoPreview",
        "createPackagePhotoPreviewBox",
        "",
    );
    setUploadPreviewById(
        "createAddonPhotoPreview",
        "createAddonPhotoPreviewBox",
        "",
    );
    pendingCreatePackageImage = null;
    pendingCreateAddonImage = null;
    document.getElementById("commentCount").textContent = "0";
    renderInclusionFields("inclusionsContainer", [""]);
    setModalVisible("createModal", true);
}

function closeCreateModal() {
    setModalVisible("createModal", false);
}

function openEditModal(itemId, type) {
    editingItemId = itemId;
    editingItemType = type;
    document.getElementById("editModalTitle").textContent = type === "package" ? "Edit Package" : "Edit Addon";
    document.getElementById("editSaveBtn").textContent = type === "package" ? "Save" : "Confirm";
    document.getElementById("editPackageFields").style.display = type === "package" ? "block" : "none";
    document.getElementById("editAddonFields").style.display = type === "addon" ? "block" : "none";
    document.getElementById("editPhoto").value = "";
    document.getElementById("editAddonPhoto").value = "";
    editPackagePreviewBase = "";
    editAddonPreviewBase = "";
    pendingEditPackageImage = null;
    pendingEditAddonImage = null;
    const archiveBtn = document.getElementById("archiveItemBtn");

    if (type === "package") {
        const item =
            packages.find((p) => p.id === itemId) ||
            archivedPackages.find((p) => p.id === itemId);
        if (!item) return;
        setUploadPreviewById(
            "editAddonPhotoPreview",
            "editAddonPhotoPreviewBox",
            "",
        );
        const rawUrl =
            item.raw?.image_url == null
                ? ""
                : String(item.raw.image_url).trim();
        editPackagePreviewBase = rawUrl;
        const editPhotoLabel = document.getElementById("editPhotoName");
        if (editPhotoLabel) {
            editPhotoLabel.textContent = rawUrl ? "Current image" : "No file chosen";
        }
        setUploadPreviewById(
            "editPackagePhotoPreview",
            "editPackagePhotoPreviewBox",
            rawUrl,
        );
        if (archiveBtn) {
            archiveBtn.classList.remove("hidden");
            archiveBtn.textContent = item.isArchived ? "Restore" : "Archive";
        }
        document.getElementById("editName").value = item.name;
        document.getElementById("editPrice").value = String(item.originalPrice ?? item.price ?? "");
        renderInclusionFields("editInclusionsContainer", item.details.length ? item.details : [""]);
    } else {
        const item = addons.find((a) => a.id === itemId);
        if (!item) return;
        setUploadPreviewById(
            "editPackagePhotoPreview",
            "editPackagePhotoPreviewBox",
            "",
        );
        const url =
            item.image == null ? "" : String(item.image).trim();
        editAddonPreviewBase = url;
        const editAddonPhotoLabel = document.getElementById("editAddonPhotoName");
        if (editAddonPhotoLabel) {
            editAddonPhotoLabel.textContent = url ? "Current image" : "No file chosen";
        }
        setUploadPreviewById(
            "editAddonPhotoPreview",
            "editAddonPhotoPreviewBox",
            url,
        );
        if (archiveBtn) archiveBtn.classList.add("hidden");
        document.getElementById("editAddonName").value = item.name;
        document.getElementById("editAddonPrice").value = String(item.price || "");
        document.getElementById("editAddonComment").value = item.description || "";
        document.getElementById("editCommentCount").textContent = String((item.description || "").length);
    }
    const dangerGrid = document.getElementById("editDangerGrid");
    const dangerLabel = document.getElementById("editDangerLabel");
    if (dangerGrid && dangerLabel) {
        if (type === "package") {
            dangerLabel.textContent = "Archive or remove";
            dangerGrid.classList.remove("grid-cols-1");
            dangerGrid.classList.add("grid-cols-2");
        } else {
            dangerLabel.textContent = "Remove add-on";
            dangerGrid.classList.remove("grid-cols-2");
            dangerGrid.classList.add("grid-cols-1");
        }
    }
    setModalVisible("editModal", true);
}

function closeEditModal() {
    setModalVisible("editModal", false);
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
        window.heigenAlert(`Create failed: ${e.message}`);
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
        window.heigenAlert(`Update failed: ${e.message}`);
    }
}

async function deleteItem() {
    if (!editingItemId) return;
    const approved = await window.heigenConfirm(
        `Delete this ${editingItemType}?`,
        { title: "Delete Item", confirmText: "Delete", dangerous: true },
    );
    if (!approved) return;
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
        window.heigenAlert(`Delete failed: ${e.message}`);
    }
}

async function togglePackageArchive(itemId, shouldArchive) {
    if (!itemId) return;
    try {
        await apiRequest(`/packages/${itemId}/`, {
            method: "PATCH",
            body: JSON.stringify({ is_archived: !!shouldArchive }),
        });
        if (editingItemId === itemId) closeEditModal();
        await initializeData();
        applySearchFilter();
        renderItems();
    } catch (e) {
        window.heigenAlert(`Archive update failed: ${e.message}`);
    }
}

async function archiveItem() {
    if (!editingItemId || editingItemType !== "package") return;
    const item =
        packages.find((p) => p.id === editingItemId) ||
        archivedPackages.find((p) => p.id === editingItemId);
    if (!item) return;
    const nextArchived = !item.isArchived;
    const approved = await window.heigenConfirm(
        nextArchived ? `Archive package "${item.name}"?` : `Restore package "${item.name}"?`,
        {
            title: nextArchived ? "Archive Package" : "Restore Package",
            confirmText: nextArchived ? "Archive" : "Restore",
            dangerous: nextArchived,
        },
    );
    if (!approved) return;
    await togglePackageArchive(item.id, nextArchived);
}

function applySearchFilter() {
    const q = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
    filteredPackages = packages.filter((p) => p.name.toLowerCase().includes(q));
    filteredArchivedPackages = archivedPackages.filter((p) =>
        p.name.toLowerCase().includes(q),
    );
    filteredAddons = addons.filter((a) => a.name.toLowerCase().includes(q));
}

const CATALOG_TAB_ACTIVE = "catalog-segment__btn is-active";
const CATALOG_TAB_INACTIVE = "catalog-segment__btn";

function syncPackageListUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        params.delete("embed");
        if (categoryName && categoryName !== "All") {
            params.set("category", categoryName);
        } else {
            params.delete("category");
        }
        if (currentTab === "addon") {
            params.set("tab", "addon");
        } else {
            params.delete("tab");
        }
        const qs = params.toString();
        const path = window.location.pathname;
        const next = qs ? `${path}?${qs}` : path;
        window.history.replaceState(null, "", next);
    } catch (_) {}
}

function applyTabChipStyles() {
    const pkgBtn = document.getElementById("packageTab");
    const addonBtn = document.getElementById("addonTab");
    if (!pkgBtn || !addonBtn) return;
    const isPkg = currentTab === "package";
    pkgBtn.className = isPkg ? CATALOG_TAB_ACTIVE : CATALOG_TAB_INACTIVE;
    addonBtn.className = !isPkg ? CATALOG_TAB_ACTIVE : CATALOG_TAB_INACTIVE;
    pkgBtn.setAttribute("aria-selected", isPkg ? "true" : "false");
    addonBtn.setAttribute("aria-selected", !isPkg ? "true" : "false");
}

function switchTab(tab) {
    const next = tab === "addon" ? "addon" : "package";
    if (next === currentTab) return;
    currentTab = next;
    applyTabChipStyles();
    syncPackageListUrl();
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
    staffNavigateTo("packages.html");
}

async function openLogoutModal(e) {
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
}

function closeLogoutModal() {
    const modal = document.getElementById("logoutModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.classList.remove("flex");
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
function bindImageInput({
    inputId,
    labelId,
    onAccepted,
    previewImgId,
    previewBoxId,
    restorePreviewUrl,
}) {
    document.getElementById(inputId)?.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const label = document.getElementById(labelId);
        if (!ensureUploadSize(file)) {
            e.target.value = "";
            onAccepted(null);
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
        onAccepted(file);
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

bindImageInput({
    inputId: "createPhoto",
    labelId: "createPhotoName",
    onAccepted(file) {
        pendingCreatePackageImage = file;
    },
    previewImgId: "createPackagePhotoPreview",
    previewBoxId: "createPackagePhotoPreviewBox",
});
bindImageInput({
    inputId: "createAddonPhoto",
    labelId: "createAddonPhotoName",
    onAccepted(file) {
        pendingCreateAddonImage = file;
    },
    previewImgId: "createAddonPhotoPreview",
    previewBoxId: "createAddonPhotoPreviewBox",
});
bindImageInput({
    inputId: "editPhoto",
    labelId: "editPhotoName",
    onAccepted(file) {
        pendingEditPackageImage = file;
    },
    previewImgId: "editPackagePhotoPreview",
    previewBoxId: "editPackagePhotoPreviewBox",
    restorePreviewUrl: () => editPackagePreviewBase,
});
bindImageInput({
    inputId: "editAddonPhoto",
    labelId: "editAddonPhotoName",
    onAccepted(file) {
        pendingEditAddonImage = file;
    },
    previewImgId: "editAddonPhotoPreview",
    previewBoxId: "editAddonPhotoPreviewBox",
    restorePreviewUrl: () => editAddonPreviewBase,
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
    archiveItem,
    togglePackageArchive,
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
        applyTabChipStyles();
        syncPackageListUrl();
        applySearchFilter();
        renderItems();
    } catch (e) {
        console.error("Failed to initialize package list:", e);
        window.heigenAlert(`Failed to load package list: ${e.message}`);
    } finally {
        if (loading) loading.style.display = "none";
        if (grid) grid.classList.remove("hidden");
    }
}

startListPage();
