// src/constants/assets.js
// Replace these URLs with your production CDN assets when ready.

export const DEFAULT_CATEGORY_IMAGE_URL =
    "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80";

export const DEFAULT_PACKAGE_IMAGE_URL =
    "https://images.unsplash.com/photo-1554941426-5eb1f0fbc37d?auto=format&fit=crop&w=1200&q=80";

export const CATEGORY_IMAGE_OVERRIDES = {
    graduation:
        "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=800&q=80",
    wedding:
        "https://images.unsplash.com/photo-1522673607200-164d1b6ce486?auto=format&fit=crop&w=800&q=80",
    family:
        "https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=800&q=80",
    corporate:
        "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=800&q=80",
    portrait:
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80",
    event:
        "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=800&q=80",
    maternity:
        "https://images.unsplash.com/photo-1506003094589-53954a26283f?auto=format&fit=crop&w=800&q=80",
    birthday:
        "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&w=800&q=80",
};

export const PACKAGE_IMAGE_OVERRIDES = {
    // "package name": "https://your-cdn.com/path/to/package-image.jpg",
};

function normalizeKey(value = "") {
    return String(value || "").toLowerCase().trim();
}

export function resolveCategoryImage(category) {
    const explicit = category?.image_url || category?.image;
    if (explicit) return explicit;

    const key = normalizeKey(category?.name).split(" ")[0];
    return CATEGORY_IMAGE_OVERRIDES[key] || DEFAULT_CATEGORY_IMAGE_URL;
}

export function resolvePackageImage(pkg) {
    const explicit = pkg?.image_url || pkg?.image;
    if (explicit) return explicit;

    const key = normalizeKey(pkg?.name);
    return PACKAGE_IMAGE_OVERRIDES[key] || DEFAULT_PACKAGE_IMAGE_URL;
}
