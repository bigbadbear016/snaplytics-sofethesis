/**
 * Shared SVG data URL for package/category cards when no photo is uploaded.
 * Gradient + soft hills + simple “frame” motif (Heigen teal / cream palette).
 */
const HEIGEN_MEDIA_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 648 405" width="648" height="405">
<defs>
<linearGradient id="hgb" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#C5D9DF"/>
<stop offset="0.45" stop-color="#EBF2F4"/>
<stop offset="1" stop-color="#A8C5CD"/>
</linearGradient>
<linearGradient id="hgs" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#7A9DA8" stop-opacity="0.22"/>
<stop offset="1" stop-color="#4F6E79" stop-opacity="0.32"/>
</linearGradient>
</defs>
<rect width="648" height="405" fill="url(#hgb)"/>
<circle cx="512" cy="68" r="44" fill="#FFE8AD" opacity="0.38"/>
<ellipse cx="324" cy="420" rx="420" ry="200" fill="#9BB5BC" opacity="0.15"/>
<path fill="url(#hgs)" d="M0 268 Q140 228 280 252 T520 236 L648 248 V405 H0Z"/>
<path fill="#4F6E79" opacity="0.08" d="M0 298 Q200 262 400 284 T648 272 V405 H0Z"/>
<rect x="234" y="128" width="180" height="118" rx="14" fill="rgba(255,255,255,0.35)" stroke="#4F6E79" stroke-width="2.2" opacity="0.55"/>
<circle cx="272" cy="166" r="14" fill="#4F6E79" opacity="0.18"/>
<path d="M252 222 L286 188 L318 210 L356 168 L368 222" fill="none" stroke="#4F6E79" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.42"/>
</svg>`;

export const HEIGEN_MEDIA_PLACEHOLDER_DATA_URL =
    "data:image/svg+xml," + encodeURIComponent(HEIGEN_MEDIA_PLACEHOLDER_SVG.trim());
