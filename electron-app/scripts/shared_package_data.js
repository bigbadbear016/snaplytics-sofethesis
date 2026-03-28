let cache = null;
let addonCache = null;


/* CATEGORY → IMAGE MAP (YOU CONTROL THIS) */
const CATEGORY_IMAGES = {
    "Regular": "https://api.builder.io/api/v1/image/assets/TEMP/c85bfb6836c45dfd4826c29c28b7e2b3c390cf02?width=648",
    "Christmas Package 2024": "https://api.builder.io/api/v1/image/assets/TEMP/fbc99412b71e7c3272ff835edf9e4640168e4fd6?width=648",
    "Graduation": "https://api.builder.io/api/v1/image/assets/TEMP/87bafc4ede6565c276d9d45cb28b394868d95e41?width=648",
    "Yearbook": "https://api.builder.io/api/v1/image/assets/TEMP/1408ee2a03b3133a699a0b2578fc189b3c6b8787?width=648"
};

async function fetchPackages() {
    if (cache) return cache;

    let all = [];
    let url = "http://localhost:8000/api/packages/";

    while (url) {
        const res = await fetch(url);
        const data = await res.json();

        const results = Array.isArray(data)
            ? data
            : data.results || [];

        all = all.concat(results);
        url = data.next;
    }

    cache = all;
    return cache;
}

async function fetchAddons() {
    if (addonCache) return addonCache;

    let all = [];
    let url = "http://localhost:8000/api/addons/";

    while (url) {
        const res = await fetch(url);
        const data = await res.json();

        const results = Array.isArray(data)
            ? data
            : data.results || [];

        all = all.concat(results);
        url = data.next; // DRF pagination link
    }

    addonCache = all;
    return addonCache;
}


/* ===== CATEGORIES ===== */
export async function getCategories() {
    const packages = await fetchPackages();

    const uniqueNames = [...new Set(packages.map(p => p.category))];

    return uniqueNames.map((name, idx) => ({
        id: idx + 1,
        name,
        image: CATEGORY_IMAGES[name] || CATEGORY_IMAGES["Regular"]
    }));
}

/* ===== PACKAGES ===== */
export async function getPackagesByCategory(categoryName) {
    const packages = await fetchPackages();
    return packages.filter(p => p.category === categoryName);
}

/* ===== ADDONS ===== */
export async function getAddonsByCategory(categoryName) {
    const addons = await fetchAddons();

    const list = Array.isArray(addons)
        ? addons
        : addons.results || addons.addons || [];

    const normalizedCategory = categoryName.trim().toLowerCase();
    console.log("CATEGORY:", categoryName);
    list.forEach(a => console.log("APPLIES_TO:", a.applies_to));

    return list.filter(a => {
        if (Array.isArray(a.applies_to)) {
            return a.applies_to
                .map(v => v.trim().toLowerCase())
                .includes(normalizedCategory);
        }

        if (typeof a.applies_to === 'string') {
            return a.applies_to.trim().toLowerCase() === normalizedCategory;
        }

        return false;
    });
}



