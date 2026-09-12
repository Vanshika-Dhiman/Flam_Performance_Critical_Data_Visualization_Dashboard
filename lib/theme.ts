/**
 * Chart colour tokens. Canvas cannot read CSS variables cheaply every frame, so the
 * same values as globals.css live here as plain data and are swapped when the theme
 * changes.
 *
 * Categorical slots 1-5 of the reference palette, validated (adjacent pairs) in both
 * modes: worst CVD ΔE 9.1 light / 8.4 dark, normal-vision ΔE >= 19.3. Three light-mode
 * slots sit below 3:1 on the surface, so every chart ships a legend and the data table
 * is the text alternative.
 */

export type ThemeMode = 'light' | 'dark';

export interface ChartTheme {
  mode: ThemeMode;
  surface: string;
  grid: string;
  baseline: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  series: readonly string[];
  /** Sequential ramp ordered low -> high magnitude (already flipped for dark). */
  heatRamp: readonly string[];
  /** Sequential ramp for single-sample dots: starts at a step that stays visible. */
  densityRamp: readonly string[];
  overlay: string;
}

// Blue sequential ramp, steps 100..700.
const BLUE = [
  '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
  '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b',
] as const;

export const CHART_THEMES: Record<ThemeMode, ChartTheme> = {
  light: {
    mode: 'light',
    surface: '#fcfcfb',
    grid: '#e1e0d9',
    baseline: '#c3c2b7',
    textPrimary: '#0b0b0b',
    textSecondary: '#52514e',
    textMuted: '#898781',
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'],
    heatRamp: BLUE,
    densityRamp: BLUE.slice(3),
    overlay: 'rgba(11, 11, 11, 0.06)',
  },
  dark: {
    mode: 'dark',
    surface: '#1a1a19',
    grid: '#2c2c2a',
    baseline: '#383835',
    textPrimary: '#ffffff',
    textSecondary: '#c3c2b7',
    textMuted: '#898781',
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
    heatRamp: BLUE.slice(0, 11).reverse(),
    densityRamp: BLUE.slice(0, 11).reverse(),
    overlay: 'rgba(255, 255, 255, 0.08)',
  },
};

export const STATUS_COLORS = {
  ok: '#0ca30c',
  warning: '#fab219',
  critical: '#d03b3b',
} as const;
