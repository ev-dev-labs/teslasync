/**
 * Centralized color constants for TeslaSync.
 *
 * Single source of truth for chart palettes, charger-type colors,
 * status indicators, and battery-health colors used across the app.
 */

/** Neon theme palette for charts and data visualizations */
export const CHART_COLORS = ['#00f0ff', '#10b981', '#a855f7', '#f59e0b', '#4f46e5', '#ef4444', '#ec4899', '#14b8a6'] as const

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
export function activityColor(activity: string): string {
  switch (activity) {
    case 'active': case 'critical': return COLOR.GOOD
    case 'moderate': return '#3b82f6'
    case 'low': return COLOR.WARN
    case 'idle': return COLOR.MUTED
    case 'sleeping': return '#4b5563'
    default: return COLOR.MUTED
  }
}

/** Color for system status string */
export function statusHexColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'ok': case 'healthy': case 'connected': case 'active': return COLOR.GOOD
    case 'warning': case 'degraded': case 'slow': return COLOR.WARN
    case 'error': case 'critical': case 'down': case 'failed': return COLOR.BAD
    default: return COLOR.MUTED
  }
}
