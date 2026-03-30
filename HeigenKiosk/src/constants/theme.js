// src/constants/theme.js
// Palette mirrors electron-app/styles/main.css :root and shared UI tokens.

/** Raw names aligned with CSS variables (for reference / future use) */
export const heigen = {
  teal: "#165166",
  tealDark: "#134152",
  slate: "#5f6e79",
  slateDeep: "#4f6e79",
  cream: "#f6efe3",
  headerBg: "#f4f0e4",
  pageBg: "#9bb5bc",
};

export const colors = {
  // Surfaces (electron body / header / cards)
  background: heigen.pageBg, // --heigen-page-bg
  backgroundElevated: heigen.headerBg, // --heigen-header-bg (headers, strips)
  foreground: "#2a2a2a", // body text in main.css
  card: "#ffffff",
  // Brand
  primary: heigen.teal, // --heigen-teal
  primaryDark: heigen.tealDark, // --heigen-teal-dark
  primaryForeground: "#ffffff",
  accent: heigen.teal,
  accentForeground: "#ffffff",
  slate: heigen.slate,
  slateDeep: heigen.slateDeep,
  cream: heigen.cream, // --heigen-cream
  // Muted fills (inputs, chips) — teal-tinted neutrals from main.css patterns
  muted: "#eef5f7", // info / subtle panel bg
  mutedForeground: heigen.slate, // --heigen-slate (secondary labels)
  border: "rgba(22, 81, 102, 0.1)", // header / card borders
  borderStrong: "rgba(22, 81, 102, 0.25)",
  accentLight: "rgba(22, 81, 102, 0.08)",
  accentLightStrong: "rgba(22, 81, 102, 0.12)",
  // Status (toast-style tokens from main.css)
  success: "#0d4a38",
  successBg: "#e8f5f0",
  error: "#8b1c1c",
  errorBg: "#fff0f0",
  warning: "#fef3c7",
  warningText: "#92400e",
  overlay: "rgba(0, 0, 0, 0.5)",
  headerBar: heigen.teal,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 9999,
};

export const typography = {
  h1: { fontSize: 30, fontWeight: "700" },
  h2: { fontSize: 24, fontWeight: "700" },
  h3: { fontSize: 20, fontWeight: "700" },
  h4: { fontSize: 18, fontWeight: "600" },
  body: { fontSize: 16, fontWeight: "400" },
  bodyB: { fontSize: 16, fontWeight: "600" },
  sm: { fontSize: 14, fontWeight: "400" },
  smB: { fontSize: 14, fontWeight: "600" },
  xs: { fontSize: 12, fontWeight: "400" },
  price: { fontSize: 28, fontWeight: "700" },
  priceL: { fontSize: 36, fontWeight: "700" },
};

// Mirrors --heigen-shadow-sm / md where possible (RN uses shadowColor + opacity)
export const shadow = {
  sm: {
    shadowColor: "#165166",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  lg: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
  },
  accent: {
    shadowColor: "#165166",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
};
