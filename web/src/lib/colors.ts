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
