/**
 * Show or hide an upload preview (img inside a wrapper).
 * @param {string | null | undefined} imgId
 * @param {string | null | undefined} boxId
 * @param {string} [url]
 */
export function setUploadPreviewById(imgId, boxId, url) {
    const img = imgId ? document.getElementById(imgId) : null;
    const box = boxId ? document.getElementById(boxId) : null;
    if (!img || !box) return;
    const u = typeof url === "string" ? url.trim() : "";
    if (u) {
        img.src = u;
        box.classList.remove("hidden");
    } else {
        img.removeAttribute("src");
        box.classList.add("hidden");
    }
}
