/**
 * Export an image file as JPEG using CSS cover-like crop + object-position (posX/posY 0–100).
 */
export async function exportCoverCropFromFile(file, options = {}) {
    if (!file) return "";
    const url = URL.createObjectURL(file);
    try {
        return await exportCoverCropFromUrl(url, options);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * @param {string} src - object URL or data URL
 * @param {{ aspectW?: number, aspectH?: number, posX?: number, posY?: number, zoom?: number, maxWidth?: number }} options
 * zoom: 1 = cover fit; up to 3 = zoom in (tighter crop).
 */
export async function exportCoverCropFromUrl(src, options = {}) {
    const aspectW = options.aspectW ?? 16;
    const aspectH = options.aspectH ?? 10;
    const posX = clampPercent(options.posX ?? 50);
    const posY = clampPercent(options.posY ?? 50);
    const zoom = clampZoom(options.zoom ?? 1);
    const maxWidth = options.maxWidth ?? 1200;

    const img = await loadImage(src);
    const nw = img.naturalWidth || img.width;
    const nh = img.naturalHeight || img.height;
    if (!nw || !nh) {
        throw new Error("Invalid image dimensions.");
    }

    const cw = Math.min(maxWidth, nw);
    const ch = (cw * aspectH) / aspectW;

    const baseScale = Math.max(cw / nw, ch / nh);
    const scale = baseScale * zoom;
    const sw = nw * scale;
    const sh = nh * scale;
    const ox = (cw - sw) * (posX / 100);
    const oy = (ch - sh) * (posY / 100);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cw);
    canvas.height = Math.round(ch);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unsupported.");
    ctx.drawImage(img, 0, 0, nw, nh, ox, oy, sw, sh);

    return canvas.toDataURL("image/jpeg", 0.88);
}

function clampPercent(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 50;
    return Math.min(100, Math.max(0, x));
}

function clampZoom(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 1;
    return Math.min(3, Math.max(1, x));
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("Failed to decode image."));
        im.crossOrigin = "anonymous";
        im.src = src;
    });
}
