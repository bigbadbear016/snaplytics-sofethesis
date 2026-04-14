// src/hooks/useScale.js
// ─────────────────────────────────────────────────────────────────────────────
// Responsive scaling hook.
// Derives a "scale" multiplier from real window dimensions so every screen
// looks correct on both a Pixel 7 phone (~412dp wide) and a Pixel Tablet
// (~1280dp wide, landscape kiosk orientation).
//
// Usage:
//   const { s, fs, isTablet, isLandscape, W, H } = useScale();
//   s(16)   → scaled spacing/dimension
//   fs(16)  → scaled font size (slightly gentler curve)
// ─────────────────────────────────────────────────────────────────────────────
import { useWindowDimensions } from 'react-native';

const BASE_WIDTH = 412;   // Pixel 7 logical width  (portrait)
const MAX_SCALE  = 1.65;  // cap so fonts/dims don't balloon on huge screens

export function useScale() {
  const { width: W, height: H } = useWindowDimensions();
  const isLandscape = W > H;
  const isTablet    = W >= 768;

  // Use the shorter dimension as reference so landscape doesn't over-scale
  const refDim = isLandscape ? Math.min(W, H) : W;
  const raw    = refDim / BASE_WIDTH;
  const scale  = Math.min(raw, MAX_SCALE);

  /** Scale a spacing / dimension value */
  const s  = (n) => Math.round(n * scale);

  /** Scale a font size — gentler curve so text doesn't get enormous */
  const fs = (n) => Math.round(n * Math.min(scale, 1.35));

  return { s, fs, isTablet, isLandscape, W, H, scale };
}
