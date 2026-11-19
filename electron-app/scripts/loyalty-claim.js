// scripts/loyalty-claim.js
// Shared "claim a package with loyalty points" UI for Customer Data and the
// customer profile. Needs alert-modal.js (modal styles, heigenAlert) and
// api-client.js. Cost rule mirrors backend/loyalty_utils.claim_points_for_package.

(function installLoyaltyClaim(global) {
    const DEFAULT_SETTINGS = { pesos_per_point_earn: 100, pesos_per_point_redeem: 50 };

    function esc(s) {
        return String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    /** Whole points to claim a package: ceil(promo price if > 0, else price / redeem rate). */
    function claimCost(pkg, settings) {
        const rate = Number((settings || DEFAULT_SETTINGS).pesos_per_point_redeem) || 50;
        const promo = Number(pkg?.promo_price);
        const price = Number.isFinite(promo) && promo > 0 ? promo : Number(pkg?.price ?? 0);
        if (!Number.isFinite(price) || price <= 0) return 0;
        return Math.ceil(price / rate);
    }

    /** Fewest points that claim any package, or null if none is claimable. */
    function cheapestCost(packages, settings) {
        const costs = (packages || []).map((p) => claimCost(p, settings)).filter((c) => c > 0);
        return costs.length ? Math.min(...costs) : null;
    }

    function canClaim(customer, packages, settings) {
        const min = cheapestCost(packages, settings);
        return min != null && Number(customer?.loyaltyPoints || 0) >= min;
    }

    /**
     * Modal: pick a package and spend points on it.
     * Resolves to the updated customer from the API, or null if cancelled/failed.
     */
    function openClaimModal(customer, packages, settings) {
        const balance = Number(customer?.loyaltyPoints || 0);
        const options = (packages || [])
            .map((p) => ({ p, cost: claimCost(p, settings) }))
            .filter((o) => o.cost > 0)
            .sort((a, b) => a.cost - b.cost)
            .map(
                ({ p, cost }) =>
                    `<option value="${esc(p.id)}" ${cost > balance ? "disabled" : ""}>` +
                    `${esc(p.name)} — ${cost} pts</option>`,
            )
            .join("");

        const host = document.createElement("div");
        host.className = "heigen-alert-host";
        host.style.display = "flex";
        host.innerHTML = `
            <div class="heigen-alert-card heigen-confirm-card" role="dialog" aria-modal="true" aria-labelledby="loyaltyClaimTitle">
                <div id="loyaltyClaimTitle" class="heigen-alert-title">Claim package with points</div>
                <div class="heigen-confirm-msg">${esc(customer?.name || `Customer #${customer?.id}`)} has <strong>${balance.toFixed(1)}</strong> points.</div>
                <label class="loyalty-claim-label" for="loyaltyClaimSelect">Package</label>
                <select id="loyaltyClaimSelect" class="loyalty-claim-select">
                    <option value="">Select a package…</option>${options}
                </select>
                <div class="loyalty-claim-error" role="alert"></div>
                <div class="heigen-confirm-actions">
                    <button type="button" class="heigen-confirm-btn heigen-confirm-cancel" data-act="cancel">Cancel</button>
                    <button type="button" class="heigen-confirm-btn heigen-confirm-ok heigen-confirm-safe" data-act="ok">Claim</button>
                </div>
            </div>`;
        document.body.appendChild(host);
        const select = host.querySelector("select");
        global.HeigenModal?.open(host, () => close(null));
        const errorEl = host.querySelector(".loyalty-claim-error");
        select.focus();

        return new Promise((resolve) => {
            function close(value) {
                host.remove();
                resolve(value);
            }
            host.addEventListener("click", async (e) => {
                if (e.target === host || e.target.dataset.act === "cancel") return close(null);
                if (e.target.dataset.act !== "ok") return;
                if (!select.value) {
                    errorEl.textContent = "Select a package to claim.";
                    return;
                }
                e.target.disabled = true;
                try {
                    const updated = await global.apiClient.customers.claimPackage(customer.id, {
                        package_id: parseInt(select.value, 10),
                    });
                    close(updated);
                    global.heigenAlert("Package claimed.");
                } catch (err) {
                    e.target.disabled = false;
                    errorEl.textContent = err.message || "Failed to claim package.";
                }
            });
        });
    }

    global.loyaltyClaim = { DEFAULT_SETTINGS, claimCost, cheapestCost, canClaim, openClaimModal };
})(window);
