/**
 * Mirrors Snaplytics loyalty redemption: ceil(effective_price / pesos_per_point_redeem).
 * Effective price = promo_price when set (matches kiosk package card pricing).
 */

export function defaultLoyaltySettings() {
    return { pesos_per_point_earn: 100, pesos_per_point_redeem: 50 };
}

export function effectivePackagePriceForClaim(pkg) {
    if (!pkg) return 0;
    const promoRaw =
        pkg.promo_price != null && pkg.promo_price !== ""
            ? Number(pkg.promo_price)
            : null;
    const price =
        promoRaw != null && Number.isFinite(promoRaw) && promoRaw > 0
            ? promoRaw
            : Number(pkg.price ?? 0);
    return Number.isFinite(price) ? price : 0;
}

/**
 * @param {object} pkg — package row from API
 * @param {{ pesos_per_point_redeem?: number|string }} [loyaltySettings]
 * @returns {number} whole points required to claim this package at the studio
 */
export function claimPointsCost(pkg, loyaltySettings) {
    const s = loyaltySettings || defaultLoyaltySettings();
    const rate = Number(s.pesos_per_point_redeem) || 50;
    const price = effectivePackagePriceForClaim(pkg);
    if (!(price > 0)) return 0;
    return Math.ceil(price / rate);
}

export function isPackageClaimableWithBalance(balance, pkg, loyaltySettings) {
    const cost = claimPointsCost(pkg, loyaltySettings);
    return cost > 0 && Number(balance) >= cost;
}
