/** Global decimal precision — set by useSettings, read by all formatters */
let _globalPrecision = 2

/** Set the global decimal precision (called by useSettings on load) */
export function setGlobalPrecision(decimals: number) {
  _globalPrecision = Math.max(0, Math.min(20, decimals))
}

/** Get the current global decimal precision */
export function getGlobalPrecision(): number {
  return _globalPrecision
}

/** Safe number extraction from unknown values, returns 0 for nullish/NaN */
export function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0
}

/** Format a number with locale-aware separators. Uses global precision unless overridden. */
export function fmtNumber(v: unknown, decimals?: number): string {
  const d = decimals ?? _globalPrecision
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })
}

/** Format with unit suffix: fmtWithUnit(42.567, 'kWh') → "42.57 kWh" (at precision 2) */
export function fmtWithUnit(v: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(v, decimals)} ${unit}`
}

/** Format percentage: fmtPercent(85.432) → "85.43%" (at precision 2) */
export function fmtPercent(v: unknown, decimals?: number): string {
  return `${fmtNumber(v, decimals)}%`
}

/** Format as integer with locale separators: fmtInt(12345.6) → "12,346" */
export function fmtInt(v: unknown): string {
  return fmtNumber(v, 0)
}
