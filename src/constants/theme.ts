import { Platform } from 'react-native';

/** BallOut design system — modern dark theme with orange accent */
export const Colors = {
  background: '#000000',
  surface: '#141414',
  surfaceElevated: '#1C1C1E',
  surfaceHover: '#2A2A2C',
  border: '#2C2C2E',
  text: '#FFFFFF',
  textSecondary: '#A1A1A6',
  textMuted: '#6C6C70',
  accent: '#FF6B00',
  accentPressed: '#E55F00',
  accentSoft: 'rgba(255, 107, 0, 0.15)',
  success: '#30D158',
  danger: '#FF453A',
  overlay: 'rgba(0, 0, 0, 0.55)',
  white: '#FFFFFF',
  black: '#000000',
  mapMarker: '#FF6B00',
  inputBackground: '#1C1C1E',
  tabInactive: '#8E8E93',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

export const FontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  '2xl': 28,
  '3xl': 34,
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    rounded: 'system-ui, sans-serif',
    mono: 'ui-monospace, monospace',
  },
})!;

export const BottomTabInset = Platform.select({ ios: 88, android: 80, default: 80 }) ?? 80;
