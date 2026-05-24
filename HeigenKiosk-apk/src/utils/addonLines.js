/** @param {{ quantity?: number|string }} line */
export function addonQty(line) {
    const q = Number(line?.quantity);
    if (!Number.isFinite(q) || q < 1) return 1;
    return Math.min(999, Math.floor(q));
}

/** Line subtotal for booking / display */
export function addonLineSubtotal(line) {
    return Number(line?.price || 0) * addonQty(line);
}

export function sumAddonLineSubtotals(lines) {
    return (lines || []).reduce((s, l) => s + addonLineSubtotal(l), 0);
}

export function totalAddonUnits(lines) {
    return (lines || []).reduce((s, l) => s + addonQty(l), 0);
}
