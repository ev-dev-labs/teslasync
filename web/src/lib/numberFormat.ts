/** Safe number extraction from unknown values, returns 0 for nullish/NaN */
export function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0
}

/** Format a number with locale-aware separators: 1234.5 → "1,234.5" */
export function fmtNumber(v: unknown, decimals = 1): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Format with unit suffix: fmtWithUnit(42.567, 'kWh', 1) → "42.6 kWh" */
export function fmtWithUnit(v: unknown, unit: string, decimals = 1): string {
  return `${fmtNumber(v, decimals)} ${unit}`
}

/** Format percentage: fmtPercent(85.432, 0) → "85%" */
export function fmtPercent(v: unknown, decimals = 0): string {
  return `${fmtNumber(v, decimals)}%`
}

/** Format as integer with locale separators: fmtInt(12345.6) → "12,346" */
export function fmtInt(v: unknown): string {
  return fmtNumber(v, 0)
}
