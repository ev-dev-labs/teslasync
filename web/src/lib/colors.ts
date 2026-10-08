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
 *   - `CHART_COLORS_CB_SAFE` retains the Okabe-Ito hue order as the default.
 *   - `CHART_COLORS_NEON` retains the saved palette's hue identities, with
 *     restrained presentation rather than fluorescent chart strokes.
 *   - The reactive `useChartPalette()` (in `@/hooks/useChartPalette`) returns
 *     the user-preferred palette as `readonly string[]` so any chart can opt
 *     in to live re-rendering when the user toggles palettes in Settings.
 *   - Status / battery / semantic colors are intentionally NOT theme- or
 *     pref-derived — "good = green" must stay green even in tesla-red.
 */

import { useMemo } from 'react'
import { useTheme, type ColorTheme, type ModeTheme } from '@/components/ui/ThemeProvider'

/**
 * Resolve map paint in a connected theme context. Null means the caller must
 * defer paint or apply its own declared fallback; this never chooses a palette.
 * Browser probes are transient and no DOM is accessed at module initialization.
 */
export function resolveMapRendererColor(input: string, context: HTMLElement): string | null {
  if (typeof document === 'undefined' || !input.trim() || !context.isConnected) return null
  const doc = context.ownerDocument
  const view = doc.defaultView
  if (!view || typeof view.getComputedStyle !== 'function') return null

  const parent = doc.createElement('span')
  const probe = doc.createElement('span')
  try {
    // Different inherited paints expose invalid-at-computed-value declarations,
    // including missing/cyclic vars, without mistaking browser black for success.
    parent.style.setProperty('all', 'initial', 'important')
    parent.style.setProperty('display', 'none', 'important')
    // Forced text substitution must not collapse the two validation sentinels.
    // System-color inputs still resolve through the browser's active palette.
    parent.style.setProperty('forced-color-adjust', 'none', 'important')
    parent.style.setProperty('color-scheme', view.getComputedStyle(context).colorScheme, 'important')
    probe.style.setProperty('all', 'unset', 'important')
    probe.style.setProperty('color', 'inherit', 'important')
    probe.style.setProperty('color', input, 'important')
    probe.style.setProperty('background-color', input, 'important')
    if (!probe.style.color || probe.style.color === 'inherit') return null
    parent.appendChild(probe)
    context.appendChild(parent)
    parent.style.setProperty('color', 'rgb(1, 2, 3)', 'important')
    const computed = view.getComputedStyle(probe)
    const first = computed.color
    // CSS-wide defaults differ between these properties; a real color does
    // not. This also permits valid vars whose unused fallback is "initial".
    if (first !== computed.backgroundColor) return null
    parent.style.setProperty('color', 'rgb(4, 5, 6)', 'important')
    const second = view.getComputedStyle(probe).color
    if (!first || first !== second || /(?:var|light-dark)\s*\(|\b(?:currentcolor|initial|inherit|unset|revert)\b/i.test(first)) return null
    // A fresh assignment validates the computed serialization, not a retained
    // prior Canvas fillStyle. Unsupported/non-color computed output is unresolved.
    const validation = doc.createElement('span')
    validation.style.color = first
    return validation.style.color ? first : null
  } catch {
    return null
  } finally {
    parent.remove()
  }
}

/**
 * Restrained dark presentation in the saved Okabe-Ito hue order.
 * Labels/markers remain necessary; derived colors require separate CVD QA.
 */
export const CHART_COLORS_CB_SAFE = [
  '#91b4d2', // blue
  '#c0a384', // orange
  '#91b9a5', // bluish green
  '#cfbf81', // yellow
  '#99bfd0', // sky blue
  '#c69b89', // vermillion
  '#c0a1b5', // reddish purple
  '#abb4bf', // neutral grey
] as const

/**
 * Persisted neon choice retains its hue order, not fluorescent intensity.
 */
export const CHART_COLORS_NEON = [
  '#91bbc0', // cyan
  '#91b9a5', // emerald green
  '#b5a8c9', // purple
  '#cfb481', // amber
  '#a5aac9', // indigo
  '#d6a0a5', // red
  '#c3a2b5', // pink
  '#91bcb2', // teal
] as const

/**
 * Default static dark chart palette, preserving the CB-safe preference.
 * Consumers
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
 * starts at the theme's primary hue and ends at its accent hue, with intermediate
 * stops generated by interpolating around the colour wheel along the
 * shorter arc. Optional saved series retain their own hue order. Only chart
 * presentation is derived; saved theme colors and semantic roles stay intact.
 */
export function buildChartPalette(theme: ColorTheme, mode: ModeTheme, sourceSeries?: readonly string[]): ChartPalette {
  const [hPrim, sPrim] = hexToHsl(theme.primary)
  const [hAcc, sAcc] = hexToHsl(theme.accent)

  const isLight = mode.colorScheme === 'light'
  const targetL = isLight ? 0.36 : 0.7
  const present = (h: number, s: number) => hslToHex(h, Math.min(0.3, s), targetL)

  // Walk the shorter arc between primary and accent.
  let delta = hAcc - hPrim
  if (delta > 180) delta -= 360
  else if (delta < -180) delta += 360

  const SERIES_LEN = 8
  const series: string[] = []
  for (let i = 0; i < SERIES_LEN; i++) {
    const t = i / (SERIES_LEN - 1)
    const h = hPrim + delta * t
    const s = sPrim + (sAcc - sPrim) * t
    series.push(present(h, s))
  }

  return {
    primary: present(hPrim, sPrim),
    accent: present(hAcc, sAcc),
    series: sourceSeries?.map(color => {
      const [h, s] = hexToHsl(color)
      return present(h, s)
    }) ?? series,
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
