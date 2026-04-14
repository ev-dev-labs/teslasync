/**
 * Centralized application constants.
 * Single source of truth for conversion factors, timeouts, pagination defaults.
 */

/** Unit conversion factors — Tesla API sends miles/mph/PSI/°C */
export const UNITS = {
  MI_TO_KM: 1.60934,
  KM_TO_MI: 0.621371,
  PSI_TO_BAR: 0.06895,
  BAR_TO_PSI: 14.5038,
  KPA_TO_PSI: 0.14504,
  PSI_TO_KPA: 6.89476,
  KPA_TO_BAR: 0.01,
  BAR_TO_KPA: 100,
} as const

/** API and polling timeouts (milliseconds) */
export const TIMEOUTS = {
  API_REQUEST: 15_000,
  SSE_RECONNECT: 3_000,
  POLL_FAST: 3_000,
  POLL_SLOW: 30_000,
  STALE_SIGNAL: 15 * 60 * 1000, // 15 minutes — signal is considered stale
} as const

/** Pagination defaults */
export const PAGINATION = {
  DEFAULT_LIMIT: 50,
  MAX_LIMIT: 1000,
  PAGE_SIZES: [25, 50, 100] as const,
} as const

/** CO2 and fuel constants for cost analysis */
export const FUEL = {
  CO2_PER_GALLON_KG: 8.887,
  KG_CO2_PER_TREE_YEAR: 22,
  DEFAULT_GAS_PRICE_USD: 3.5,
  DEFAULT_MPG: 30,
} as const
