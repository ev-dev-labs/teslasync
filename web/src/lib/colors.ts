/**
 * Centralized color constants for TeslaSync.
 *
 * Single source of truth for chart palettes, charger-type colors,
 * status indicators, and battery-health colors used across the app.
 *
 * Theme-aware chart palette:
 *   - `useThemeChartPalette()` derives the series colors from the active theme
 *   - `buildChartPalette(theme, mode)` is the pure builder for non-React contexts
 *
 * Color-blind-safe default palette:
 *   - `CHART_COLORS_CB_SAFE` (Okabe-Ito) is the new default for `CHART_COLORS`.
 *   - `CHART_COLORS_NEON` retains the original neon palette for the stylistic
 *     dashboard surfaces, exposed via the user `chart_palette` Settings pref.
 *   - The reactive `useChartPalette()` (in `@/hooks/useChartPalette`) returns
 *     the user-preferred palette as `readonly string[]` so any chart can opt
 *     in to live re-rendering when the user toggles palettes in Settings.
 *   - Status / battery / semantic colors are intentionally NOT theme- or
 *     pref-derived — "good = green" must stay green even in tesla-red.
 */

import { useMemo } from 'react'
import { useTheme, type ColorTheme, type ModeTheme } from '@/components/ui/ThemeProvider'

/**
 * Color-blind-safe Okabe-Ito palette (Wong, Nature Methods 2011).
 * Adjacent entries are distinguishable by all three common CVD types
 * (deuteranopia, protanopia, tritanopia). The trailing dark grey replaces
 * pure black so the palette reads on dark surfaces.
 */
export const CHART_COLORS_CB_SAFE = [
  '#0072B2', // blue
  '#E69F00', // orange
  '#009E73', // bluish green
  '#F0E442', // yellow
  '#56B4E9', // sky blue
  '#D55E00', // vermillion
  '#CC79A7', // reddish purple
  '#4B4B4B', // neutral grey (replaces pure black for dark-theme legibility)
] as const

/**
 * Original neon palette retained as an opt-in for the stylistic dashboard.
 * Selectable via the `chart_palette` Settings preference. New code should
 * prefer the CB-safe default unless the surface is intentionally stylistic.
 */
export const CHART_COLORS_NEON = [
  '#00f0ff', // neon cyan
  '#10b981', // emerald green
  '#a855f7', // purple
  '#f59e0b', // amber
  '#4f46e5', // indigo
  '#ef4444', // red
  '#ec4899', // pink
  '#14b8a6', // teal
] as const

/**
 * Default static chart palette. This uses the CB-safe Okabe-Ito palette so
 * every consumer that imports the bare `CHART_COLORS` constant gets a
 * CVD-safe default automatically. Consumers
 * that should react to the user's `chart_palette` preference should switch to
 * `useChartPalette()` in `@/hooks/useChartPalette`.
 */
export const CHART_COLORS = CHART_COLORS_CB_SAFE

/** Charger type colors (includes both internal keys and display-name keys) */
export const CHARGER_COLORS: Record<string, string> = {
  // Internal keys (Charging page)
  supercharger: '#ef4444',
  dc: '#f59e0b',
  home: '#10b981',
  // Display-name keys (CostAnalysis page)
  Home: '#10b981',
  Supercharger: '#ef4444',
  'Public DC': '#a855f7',
  'Work / L2': '#f59e0b',
  Other: '#6366f1',
}

/** Traffic-light status indicator colors */
export const STATUS_COLORS = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
} as const

/** Battery health colors */
export const BATTERY_COLORS = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
} as const

/* ── Semantic Color Constants ── */

export const COLOR = {
  GOOD: '#10b981',
  WARN: '#f59e0b',
  BAD: '#ef4444',
  CYAN: '#00f0ff',
  PURPLE: '#a855f7',
  MUTED: '#6b7280',
  DARK: '#374151',
} as const

/* ── Domain Color Functions ── */

/** Color for battery level (0-100) */
export function batteryColor(level: number): string {
  if (level > 60) return COLOR.GOOD
  if (level > 25) return COLOR.WARN
  return COLOR.BAD
}

/** Color for health score (0-100) */
export function healthColor(score: number): string {
  if (score >= 90) return COLOR.GOOD
  if (score >= 70) return COLOR.WARN
  return COLOR.BAD
}

/** Color for efficiency (lower = better) */
export function efficiencyColor(value: number, good = 180, warn = 200): string {
  if (value < good) return COLOR.GOOD
  if (value < warn) return COLOR.WARN
  return COLOR.BAD
}

/** Color for power flow direction */
export function powerColor(power: number): string {
  if (power > 0) return COLOR.WARN
  if (power < 0) return COLOR.GOOD
  return COLOR.DARK
}

/** Color for boolean on/off state */
export function boolColor(active: boolean): string {
  return active ? COLOR.GOOD : COLOR.WARN
}

/** Color for boolean with muted off */
export function boolColorMuted(active: boolean): string {
  return active ? COLOR.GOOD : COLOR.MUTED
}

/** Hex color for vehicle state (for SVG/Recharts) */
export function stateHexColor(state: string | undefined | null): string {
  switch ((state ?? '').toLowerCase()) {
    case 'driving': return COLOR.CYAN
    case 'charging': case 'online': return COLOR.GOOD
    default: return COLOR.MUTED
  }
}

/** Color for monetary savings */
export function savingsColor(value: number): string {
  return value >= 0 ? COLOR.GOOD : COLOR.BAD
}

/** Color for trend direction */
export function trendColor(trend: string | undefined): string {
  if (trend === 'up') return COLOR.BAD
  if (trend === 'down') return COLOR.GOOD
  return COLOR.MUTED
}

/** Color for regen efficiency percentage */
export function regenColor(percent: number): string {
  if (percent >= 25) return COLOR.GOOD
  if (percent >= 15) return COLOR.WARN
  return COLOR.BAD
}

/** Color for degradation percentage */
export function degradationColor(percent: number): string {
  return percent < 10 ? COLOR.GOOD : COLOR.WARN
}

/** Color for vehicle activity level (polling engine) */
export function activityColor(activity: string | undefined | null): string {
  switch (activity ?? '') {
    case 'active': case 'critical': return COLOR.GOOD
    case 'moderate': return '#3b82f6'
    case 'low': return COLOR.WARN
    case 'idle': return COLOR.MUTED
    case 'sleeping': return '#4b5563'
    default: return COLOR.MUTED
  }
}

/**
 * Color for system status string. Accepts null/undefined defensively — status
 * values arrive from API payloads where a field may be absent, and calling
 * `.toLowerCase()` on a missing value would throw. Mirrors `stateHexColor`.
 */
export function statusHexColor(status: string | undefined | null): string {
  switch ((status ?? '').toLowerCase()) {
    case 'ok': case 'healthy': case 'connected': case 'active': return COLOR.GOOD
    case 'warning': case 'degraded': case 'slow': return COLOR.WARN
    case 'error': case 'critical': case 'down': case 'failed': return COLOR.BAD
    default: return COLOR.MUTED
  }
}

/* ── Theme-aware chart palette ─────────────────────────────────────────────── */

/**
 * A complete chart palette. `series` is theme-derived (hue-rotated between the
 * theme's primary and accent colours); the semantic colours (`positive`,
 * `negative`, `warning`, `neutral`) are intentionally constant so that
 * "green = good" remains true regardless of the user's chosen theme.
 */
export interface ChartPalette {
  primary: string
  accent: string
  series: string[]
  positive: string
  negative: string
  warning: string
  neutral: string
}

/* ── HSL helpers (no chroma.js dependency) ─────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h.padEnd(6, '0').slice(0, 6)
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return [r, g, b]
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)); break
    case gn: h = (bn - rn) / d + 2; break
    default: h = (rn - gn) / d + 4
  }
  return [h * 60, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hh = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hh < 1) [r, g, b] = [c, x, 0]
  else if (hh < 2) [r, g, b] = [x, c, 0]
  else if (hh < 3) [r, g, b] = [0, c, x]
  else if (hh < 4) [r, g, b] = [0, x, c]
  else if (hh < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHsl(r, g, b)
}

function hslToHex(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l)
  return rgbToHex(r, g, b)
}

/**
 * Produce the deterministic chart palette for a given theme + mode. Pure
 * function — same inputs always yield the same output. The series array
 * starts at the theme's primary and ends at its accent, with intermediate
 * stops generated by interpolating around the colour wheel along the
 * shorter arc.
 */
export function buildChartPalette(theme: ColorTheme, mode: ModeTheme): ChartPalette {
  const [hPrim, sPrim, lPrim] = hexToHsl(theme.primary)
  const [hAcc, sAcc, lAcc] = hexToHsl(theme.accent)

  const isLight = mode.colorScheme === 'light'
  // Boost saturation slightly + clamp lightness so series stay readable on
  // both light and dark surfaces.
  const targetL = isLight ? 0.42 : 0.58

  // Walk the shorter arc between primary and accent.
  let delta = hAcc - hPrim
  if (delta > 180) delta -= 360
  else if (delta < -180) delta += 360

  const SERIES_LEN = 8
  const series: string[] = []
  for (let i = 0; i < SERIES_LEN; i++) {
    const t = i / (SERIES_LEN - 1)
    const h = hPrim + delta * t
    const s = Math.max(0.5, Math.min(0.95, sPrim + (sAcc - sPrim) * t))
    const l = Math.max(0.35, Math.min(0.7, targetL + (lPrim + (lAcc - lPrim) * t - targetL) * 0.4))
    series.push(hslToHex(h, s, l))
  }

  return {
    primary: theme.primary,
    accent: theme.accent,
    series,
    positive: COLOR.GOOD,
    negative: COLOR.BAD,
    warning: COLOR.WARN,
    neutral: COLOR.MUTED,
  }
}

/**
 * React hook returning the *theme-derived* chart palette object for the active
 * theme. Re-derives the palette whenever the user switches themes, so any
 * chart that consumes this hook re-renders with the new colours automatically.
 *
 * NOTE: renamed from `useChartPalette` to `useThemeChartPalette`
 * to free the simpler `useChartPalette` name for the new user-pref-driven hook
 * at `@/hooks/useChartPalette` that returns `readonly string[]`.
 */
export function useThemeChartPalette(): ChartPalette {
  const { theme, mode } = useTheme()
  // Memoise so consumers (chart widgets) receive a referentially stable
  // palette object across re-renders; buildChartPalette allocates a fresh
  // `series` array on every call, which would otherwise defeat downstream
  // `useMemo`/`React.memo` guards on the charts that consume it.
  return useMemo(() => buildChartPalette(theme, mode), [theme, mode])
}
