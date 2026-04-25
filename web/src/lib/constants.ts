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
  GALLONS_TO_LITERS: 3.78541,
} as const

/** Day-of-week labels (Sunday-first) */
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Calendar months for dropdowns */
export const MONTHS: { value: string; label: string }[] = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
]

/** Common timezone options for selects */
export const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: '', label: 'UTC (Default)' },
  { value: 'America/New_York', label: 'Eastern (US)' },
  { value: 'America/Chicago', label: 'Central (US)' },
  { value: 'America/Denver', label: 'Mountain (US)' },
  { value: 'America/Los_Angeles', label: 'Pacific (US)' },
  { value: 'Europe/London', label: 'London (UK)' },
  { value: 'Europe/Berlin', label: 'Berlin (EU)' },
  { value: 'Europe/Paris', label: 'Paris (EU)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JP)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CN)' },
  { value: 'Australia/Sydney', label: 'Sydney (AU)' },
]

/** Numeric comparison operators */
export const NUMERIC_OPERATORS: { value: string; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '≥' },
  { value: 'lte', label: '≤' },
]

/** Boolean comparison operators */
export const BOOL_OPERATORS: { value: string; label: string }[] = [
  { value: 'eq', label: 'Is' },
  { value: 'neq', label: 'Is Not' },
]

/** Time range presets for signal viewers */
export const TIME_RANGE_PRESETS = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
] as const

/** Days-back options for analytics filters */
export const DAYS_OPTIONS: { value: string; label: string }[] = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
]

/** Automation condition type registry */
export const CONDITION_TYPES: { value: string; label: string }[] = [
  { value: 'state_check', label: 'State Check' },
  { value: 'time_window', label: 'Time Window' },
  { value: 'cooldown', label: 'Cooldown' },
  { value: 'day_filter', label: 'Day Filter' },
  { value: 'location', label: 'Location / Geofence' },
  { value: 'seasonal', label: 'Seasonal' },
  { value: 'variable_check', label: 'Variable Check' },
]
