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
/**
 * Calm categorical chart palette. These are the canonical light-mode marks;
 * dark-mode variants live in CHART_COLORS_DARK. Hue order prioritizes
 * distinguishability for common CVD, while text/axes still use text tokens.
 */
export const CHART_COLORS_CB_SAFE = [
  '#398ad6', // blue
  '#009e98', // teal
  '#459f5d', // green
  '#b8790e', // amber
  '#e57255', // orange
  '#cd6199', // rose
  '#876cca', // violet
  '#748192', // slate
] as const

/** Persisted legacy "neon" choice is now the same calm second order, never neon. */
export const CHART_COLORS_NEON = [
  '#876cca', // violet
  '#398ad6', // blue
  '#009e98', // teal
  '#459f5d', // green
  '#b8790e', // amber
  '#e57255', // orange
  '#cd6199', // rose
  '#748192', // slate
] as const

export const CHART_COLORS_DARK = [
  '#67aaed',
  '#52bfb9',
  '#73bb83',
  '#e7b369',
  '#ee8f63',
  '#e98092',
  '#a48fe1',
  '#8c9aab',
] as const

export const CHART_COLORS_NEON_DARK = [
  '#a48fe1',
  '#67aaed',
  '#52bfb9',
  '#73bb83',
  '#e7b369',
  '#ee8f63',
  '#e98092',
  '#8c9aab',
] as const

export const CHART_SEQUENTIAL = [
  '#d4e7fc',
  '#a2c8f0',
  '#73a9e1',
  '#398ad6',
  '#006ac0',
  '#004c9f',
] as const

export const CHART_SEQUENTIAL_DARK = [
  '#1e3a5f',
  '#26527b',
  '#326d9e',
  '#398ad6',
  '#67aaed',
  '#a2c8f0',
] as const

export const CHART_DIVERGING = [
  '#398ad6',
  '#73a9e1',
  '#d4e7fc',
  '#edf0f3',
  '#f2cf8f',
  '#df6850',
  '#bd4e67',
] as const

export const CHART_DIVERGING_DARK = [
  '#67aaed',
  '#398ad6',
  '#26527b',
  '#8c9aab',
  '#b8790e',
  '#ee8f63',
  '#e98092',
] as const

export const CHART_NEUTRAL = '#748192'
export const CHART_NEUTRAL_DARK = '#8c9aab'

export const CHART_SEMANTIC = {
  vehicle: {
    driving: CHART_COLORS_CB_SAFE[0],
    charging: CHART_COLORS_CB_SAFE[3],
    parked: CHART_COLORS_CB_SAFE[1],
    online: CHART_COLORS_CB_SAFE[2],
    asleep: CHART_COLORS_CB_SAFE[6],
    offline: CHART_COLORS_CB_SAFE[7],
    unknown: CHART_NEUTRAL,
  },
  energy: {
    solar: CHART_COLORS_CB_SAFE[3],
    battery: CHART_COLORS_CB_SAFE[6],
    grid: CHART_COLORS_CB_SAFE[5],
    home: CHART_COLORS_CB_SAFE[1],
    charging: CHART_COLORS_CB_SAFE[4],
  },
  charger: {
    home: CHART_COLORS_CB_SAFE[2],
    supercharger: CHART_COLORS_CB_SAFE[5],
    dc: CHART_COLORS_CB_SAFE[4],
    work: CHART_COLORS_CB_SAFE[3],
    other: CHART_COLORS_CB_SAFE[7],
  },
} as const

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
  supercharger: CHART_SEMANTIC.charger.supercharger,
  dc: CHART_SEMANTIC.charger.dc,
  home: CHART_SEMANTIC.charger.home,
  // Display-name keys (CostAnalysis page)
  Home: CHART_SEMANTIC.charger.home,
  Supercharger: CHART_SEMANTIC.charger.supercharger,
  'Public DC': CHART_SEMANTIC.charger.dc,
  'Work / L2': CHART_SEMANTIC.charger.work,
  Other: CHART_SEMANTIC.charger.other,
}

/* ── Semantic Color Constants ── */

export const COLOR = {
  GOOD: '#459f5d',
  WARN: '#b8790e',
  BAD: '#cd6199',
  CYAN: '#398ad6',
  PURPLE: '#876cca',
  MUTED: '#748192',
  DARK: '#748192',
} as const

/** Traffic-light status indicator colors */
export const STATUS_COLORS = {
  good: COLOR.GOOD,
  warning: COLOR.WARN,
  critical: COLOR.BAD,
} as const

/** Battery health colors */
export const BATTERY_COLORS = STATUS_COLORS

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
    case 'driving': return CHART_SEMANTIC.vehicle.driving
    case 'charging': return CHART_SEMANTIC.vehicle.charging
    case 'online': return CHART_SEMANTIC.vehicle.online
    case 'parked': return CHART_SEMANTIC.vehicle.parked
    case 'asleep': return CHART_SEMANTIC.vehicle.asleep
    case 'offline': return CHART_SEMANTIC.vehicle.offline
    default: return CHART_SEMANTIC.vehicle.unknown
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

/**
 * Produce the deterministic chart palette for a given theme + mode. Pure
 * function — same inputs always yield the same output. The series array
 * starts at the theme's primary hue and ends at its accent hue, with intermediate
 * stops generated by interpolating around the colour wheel along the
 * shorter arc. Optional saved series retain their own hue order. Only chart
 * presentation is derived; saved theme colors and semantic roles stay intact.
 */
export function buildChartPalette(_theme: ColorTheme, mode: ModeTheme, sourceSeries?: readonly string[]): ChartPalette {
  const isLight = mode.colorScheme === 'light'
  const canonical = isLight ? CHART_COLORS_CB_SAFE : CHART_COLORS_DARK
  const neon = isLight ? CHART_COLORS_NEON : CHART_COLORS_NEON_DARK
  let series: string[]
  if (sourceSeries === CHART_COLORS_CB_SAFE || sourceSeries === CHART_COLORS_DARK) {
    series = [...canonical]
  } else if (sourceSeries === CHART_COLORS_NEON || sourceSeries === CHART_COLORS_NEON_DARK) {
    series = [...neon]
  } else {
    series = sourceSeries ? [...sourceSeries] : [...canonical]
  }

  return {
    primary: series[0],
    accent: series[7],
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
