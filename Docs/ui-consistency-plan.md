# Staff app UI consistency plan (electron-app)

## Context
Ask: improve the staff app UI. Pain named: "looks inconsistent", plus an audit.
Scope: staff app web pages served through the Starter / public link. Kiosk, APK and packaged build are out.
Goal: same fonts, buttons, corners and colors on every page. Not a redesign.

## Audit findings (ranked)
1. **Nine font families.** `styles/styles.css:2-9` `@import`s Inter, Poppins, Encode Sans, Open Sans, Work Sans, IBM Plex Sans, Lato. Base is Montserrat (headings) + Segoe UI (body). Strays used in `customers.css:183,291,369,385,404`, `recommendations_styles.css:168`, `styles.css:448,1423,1431,1664`. Also costs 7 render-blocking requests over the tunnel.
2. **`.btn` defined three ways.** `customers.css:282`, `styles.css:571`, `packages.css:194`. customers.html loads both customers.css and styles.css, so the look depends on load order. Plus ~30 button class names; the shared set `.staff-btn-primary/secondary/muted/ghost` lives in `main.css:1918-2030`, while `customer-toolbar-btn--primary/--outline` (`customers.css:1434`) duplicates it.
3. **Corner radius: 15 different values** (4, 5, 6, 8, 10, 12, 15, 20px, 1rem, 999px, 9999px, 50%). Tokens `--heigen-radius` (12px) and `--heigen-radius-sm` (8px) exist in `main.css:58-59` but are used 7 times.
4. **Hard-coded colors bypass tokens.** 754 hex literals; `packages.css` and `customer-details.css` use zero `var(--…)`. Effect: dark theme needs 93 `!important` patches in `theme-dark.css`, and pages drift in light mode.
5. **Dead file.** `styles/packages.css` is loaded by no page or script.

## Pushback (not in this plan)
- No redesign, no CSS framework, no new design-system file. Tokens already exist in `main.css:47-90`; reuse them.
- Not touching the 87 inline `.style.` writes in `scripts/customer-details.js` unless they set colors/fonts (most are show/hide).
- Font-size scale (35 distinct sizes) and dark-theme `!important` cleanup: wait until steps 1-4 land; many patches become dead on their own.

## Steps (each one is a separate, revertable commit)
1. **Delete `styles/packages.css`.** Re-grep `packages.css` across `pages/`, `scripts/`, `main.js`, `index.html` first.
2. **Fonts.** Delete `styles.css:2-9` imports and the `.font-*` helper classes at `styles.css:56-62` (grep for their use in HTML/JS first; if used, map to Montserrat). Replace stray families with `inherit` (body) or `"Montserrat", sans-serif` (headings/labels). Drop the bogus `family=Segoe+UI` from page `<link>`s; it is a system font, Google doesn't serve it.
3. **One `.btn`.** Keep the `styles.css:571` version only if customers/customer-details pages depend on it; otherwise remove both duplicates and point `.btn` users at `.staff-btn-*`. Fold `customer-toolbar-btn--primary/--outline` into the `.staff-btn-primary/secondary` selector lists in `main.css` and delete their separate color rules. Keep class names in HTML/JS; only CSS changes.
4. **Radius tokens.** Add `--heigen-radius-pill: 999px` next to `main.css:58`. Map literals: 4-6px and 8px to `--heigen-radius-sm`; 10-15px, 20px and 1rem to `--heigen-radius`; 999px and 9999px to `--heigen-radius-pill`. Leave `50%` (circles).
5. **Colors, exact matches only.** Replace hex literals that equal an existing token value (e.g. `#165166` to `var(--heigen-teal)`, `#134152` to `var(--heigen-teal-dark)`, `#e3eaed` to `var(--heigen-border-ui)`). Leave near-misses alone and list them for the user to decide. Start with `customers.css` and `styles.css` (used on most pages).

## Files touched
`styles/main.css`, `styles/customers.css`, `styles/styles.css`, `styles/recommendations_styles.css`, `styles/customer-details.css`, `styles/notif.css`, page `<link>` tags in `pages/staff_admin/*.html`; delete `styles/packages.css`.

## Verification
- No CSS tests exist. Before step 1, screenshot every page in `pages/staff_admin/` in light and dark theme via the Starter link. Repeat after each step and compare.
- Pages to check hardest: `customers.html`, `customer-details.html` (load the most CSS files), `dashboard.html`, `coupons.html`.
- Grep metrics should fall: distinct `font-family` values to 2-3, `border-radius` literals to near zero, hex count down in `customers.css`/`styles.css`.
- DevTools Network: no fonts.googleapis requests for the dropped families.

## Deliverable
After approval, copy this plan to `Docs/ui-consistency-plan.md` in the repo, then execute step by step.
