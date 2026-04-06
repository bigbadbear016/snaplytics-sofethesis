// src/constants/theme.js
// Palette mirrors electron-app/styles/main.css :root and shared UI tokens.

/** Raw names aligned with CSS variables (for reference / future use) */
export const heigen = {
  teal: "#165166",
  tealDark: "#134152",
  slate: "#5f6e79",
  slateDeep: "#4f6e79",
  cream: "#f6efe3",
  headerBg: "#faf8f3",
  pageBg: "#9db9c2",
};

/** Soft blobs behind content (KioskApp) — low-opacity tints */
export const atmosphere = {
  blobCream: "rgba(250, 248, 243, 0.45)",
  blobTeal: "rgba(22, 81, 102, 0.14)",
  blobHighlight: "rgba(255, 255, 255, 0.2)",
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
  overlay: "rgba(22, 46, 56, 0.48)",
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
    shadowColor: "#134152",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: "#134152",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 5,
  },
  lg: {
    shadowColor: "#0f2f3a",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 10,
  },
  accent: {
    shadowColor: "#165166",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 7,
  },
};
