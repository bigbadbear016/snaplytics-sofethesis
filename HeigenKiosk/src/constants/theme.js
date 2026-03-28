// src/constants/theme.js
export const colors = {
  background:        '#f9fafb',
  foreground:        '#111827',
  card:              '#ffffff',
  primary:           '#111827',
  primaryForeground: '#ffffff',
  muted:             '#ececf0',
  mutedForeground:   '#717182',
  accent:            '#d97706',
  accentForeground:  '#ffffff',
  border:            'rgba(0,0,0,0.1)',
  success:           '#059669',
  error:             '#dc2626',
  warning:           '#fef3c7',
  warningText:       '#92400e',
};

export const spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  xxl: 24,
  xxxl:32,
};

export const radii = {
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  xxl:  24,
  full: 9999,
};

export const typography = {
  h1:    { fontSize: 30, fontWeight: '700' },
  h2:    { fontSize: 24, fontWeight: '700' },
  h3:    { fontSize: 20, fontWeight: '700' },
  h4:    { fontSize: 18, fontWeight: '600' },
  body:  { fontSize: 16, fontWeight: '400' },
  bodyB: { fontSize: 16, fontWeight: '600' },
  sm:    { fontSize: 14, fontWeight: '400' },
  smB:   { fontSize: 14, fontWeight: '600' },
  xs:    { fontSize: 12, fontWeight: '400' },
  price: { fontSize: 28, fontWeight: '700' },
  priceL:{ fontSize: 36, fontWeight: '700' },
};

export const shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  accent: {
    shadowColor: '#d97706',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 6,
  },
};
