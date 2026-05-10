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
        img.classList.add("h-full", "w-full", "object-cover");
        img.classList.remove("max-h-44", "object-contain");
        img.style.objectPosition = "50% 50%";
        box.classList.remove("hidden");
        resetPhotoFramingSliders(boxId);
        ensurePhotoFramingBound(boxId, imgId);
    } else {
        img.removeAttribute("src");
        img.style.objectPosition = "";
        img.style.transform = "";
        img.style.transformOrigin = "";
        box.classList.add("hidden");
        resetPhotoFramingSliders(boxId);
    }
}

function clampPct(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 50;
    return Math.min(100, Math.max(0, x));
}

/** Reset framing state under a preview box ([data-photo-pos-x|y], zoom). */
export function resetPhotoFramingSliders(boxId) {
    const box = typeof boxId === "string" ? document.getElementById(boxId) : boxId;
    if (!box) return;
    const sx = box.querySelector("[data-photo-pos-x]");
    const sy = box.querySelector("[data-photo-pos-y]");
    const sz = box.querySelector("[data-photo-zoom]");
    if (sx) sx.value = "50";
    if (sy) sy.value = "50";
    if (sz) sz.value = "100";
    const zlab = box.querySelector("[data-photo-zoom-label]");
    if (zlab) zlab.textContent = "100%";
    const img = box.querySelector("img");
    if (img) {
        img.style.objectPosition = "50% 50%";
        img.style.transform = "";
        img.style.transformOrigin = "";
    }
}

/** Wire drag pan + zoom slider → img (once per box). */
export function ensurePhotoFramingBound(boxId, imgId) {
    const box = typeof boxId === "string" ? document.getElementById(boxId) : boxId;
    const img = typeof imgId === "string" ? document.getElementById(imgId) : imgId;
    if (!box || !img || box.dataset.framingBound === "1") return;
    const sx = box.querySelector("[data-photo-pos-x]");
    const sy = box.querySelector("[data-photo-pos-y]");
    const dragArea = box.querySelector("[data-photo-drag-area]");
    if (!sx || !sy || !dragArea) return;
    box.dataset.framingBound = "1";
    const sz = box.querySelector("[data-photo-zoom]");
    const zoomLabel = box.querySelector("[data-photo-zoom-label]");
    const sync = () => {
        const px = sx.value;
        const py = sy.value;
        img.style.objectPosition = `${px}% ${py}%`;
        img.style.transformOrigin = `${px}% ${py}%`;
        if (sz) {
            const z = Math.min(3, Math.max(1, Number(sz.value) / 100));
            img.style.transform = `scale(${z})`;
            if (zoomLabel) zoomLabel.textContent = `${Math.round(Number(sz.value))}%`;
        }
    };

    let dragActive = false;
    let startClientX = 0;
    let startClientY = 0;
    let originPx = 50;
    let originPy = 50;

    const onDown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragActive = true;
        startClientX = e.clientX;
        startClientY = e.clientY;
        originPx = Number(sx.value);
        originPy = Number(sy.value);
        try {
            dragArea.setPointerCapture(e.pointerId);
        } catch {
            /* noop */
        }
        dragArea.classList.remove("cursor-grab");
        dragArea.classList.add("cursor-grabbing");
    };

    const onMove = (e) => {
        if (!dragActive) return;
        e.preventDefault();
        const rect = dragArea.getBoundingClientRect();
        const w = rect.width || 1;
        const h = rect.height || 1;
        const dx = e.clientX - startClientX;
        const dy = e.clientY - startClientY;
        sx.value = String(clampPct(originPx - (dx / w) * 100));
        sy.value = String(clampPct(originPy - (dy / h) * 100));
        sync();
    };

    const endDrag = (e) => {
        if (!dragActive) return;
        dragActive = false;
        try {
            if (e.pointerId != null) dragArea.releasePointerCapture(e.pointerId);
        } catch {
            /* noop */
        }
        dragArea.classList.add("cursor-grab");
        dragArea.classList.remove("cursor-grabbing");
    };

    dragArea.addEventListener("pointerdown", onDown);
    dragArea.addEventListener("pointermove", onMove);
    dragArea.addEventListener("pointerup", endDrag);
    dragArea.addEventListener("pointercancel", endDrag);
    dragArea.addEventListener("lostpointercapture", endDrag);

    if (sz) sz.addEventListener("input", sync);
    sync();
}

/** Read framing for canvas export (zoom 1–3). */
export function readPhotoFramePercents(boxId) {
    const box = typeof boxId === "string" ? document.getElementById(boxId) : boxId;
    if (!box) return { posX: 50, posY: 50, zoom: 1 };
    const sx = box.querySelector("[data-photo-pos-x]");
    const sy = box.querySelector("[data-photo-pos-y]");
    const sz = box.querySelector("[data-photo-zoom]");
    const zoomPct = Number(sz?.value ?? 100);
    const zoom = Math.min(3, Math.max(1, zoomPct / 100));
    return {
        posX: Number(sx?.value ?? 50),
        posY: Number(sy?.value ?? 50),
        zoom,
    };
}
