/** Global decimal precision — set by useSettings, read by all formatters */
let _globalPrecision = 2

/** Global locale (BCP-47) — set by useSettings, read by all formatters */
let _globalLocale = 'en-US'

/** Set the global decimal precision (called by useSettings on load) */
export function setGlobalPrecision(decimals: number) {
  // Reject non-finite input (NaN / ±Infinity). Without this guard a bad
  // settings payload could store NaN as the shared precision — which then
  // makes every downstream `toLocaleString` call throw a RangeError.
  if (!Number.isFinite(decimals)) return
  _globalPrecision = Math.max(0, Math.min(20, decimals))
}

/** Get the current global decimal precision */
export function getGlobalPrecision(): number {
  return _globalPrecision
}

/**
 * Set the global locale used by `fmtNumber` and friends. Pass an empty or
 * obviously-invalid string and we fall back to "en-US" so consumers always
 * get a working `Intl.NumberFormat` instance.
 */
export function setGlobalLocale(locale: string) {
  _globalLocale = locale && locale.trim() ? locale : 'en-US'
}

/** Get the current global locale tag (BCP-47). */
export function getGlobalLocale(): string {
  return _globalLocale
}

/** Safe number extraction from unknown values, returns 0 for nullish/NaN */
export function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0
}

/**
 * Returns true when the value is a finite, defined number suitable for
 * arithmetic and formatting. Use this as the first guard in any formatter
 * that produces user-visible output so that NaN, Infinity, -Infinity, null,
 * and undefined never reach downstream `toFixed` / template expressions.
 */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Clamp a requested fraction-digit count to the range `Intl.NumberFormat`
 * accepts (0–100). A non-finite request (NaN / ±Infinity) falls back to the
 * global precision so formatters degrade gracefully to a string instead of
 * throwing a RangeError in the middle of a render.
 */
function toFractionDigits(value: number): number {
  if (!Number.isFinite(value)) return _globalPrecision
  return Math.min(100, Math.max(0, value))
}

/**
 * Format a number with locale-aware separators. Uses the global precision
 * and global locale set by `useSettings` unless overridden per-call.
 */
export function fmtNumber(v: unknown, decimals?: number, locale?: string): string {
  const d = toFractionDigits(decimals ?? _globalPrecision)
  const lc = locale ?? _globalLocale
  try {
    return safeNumber(v).toLocaleString(lc, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
  } catch {
    // Bad locale tag — fall back to en-US so we still produce a string.
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
  }
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

/**
 * Compact human-readable number: 12_345 → "12.3K", 1_234_567 → "1.2M",
 * 1_200_000_000 → "1.2B". Below `threshold` (default 10_000) the value is
 * returned verbatim via `fmtInt` so small numbers stay precise. Used by
 * page hero KPIs that have to gracefully scale from "4 drives" to
 * "10,247 drives" to "1.2M drives" in the same fixed-width tile.
 */
export function fmtCompact(v: unknown, threshold = 10_000): string {
  const n = safeNumber(v)
  if (Math.abs(n) < threshold) return fmtInt(n)
  try {
    return n.toLocaleString(_globalLocale, {
      notation: 'compact',
      compactDisplay: 'short',
      maximumFractionDigits: 1,
    })
  } catch {
    return n.toLocaleString('en-US', {
      notation: 'compact',
      compactDisplay: 'short',
      maximumFractionDigits: 1,
    })
  }
}

interface FormatBytesOptions {
  zeroAsEmpty?: boolean
  empty?: string
  gbDecimals?: number
}

/** Format a byte count with binary units while preserving existing dashboard/file-table output. */
export function formatBytes(bytes: number | null | undefined, options: FormatBytesOptions = {}): string {
  const empty = options.empty ?? '—'
  if (bytes == null || !Number.isFinite(bytes)) return empty
  if (options.zeroAsEmpty && bytes === 0) return empty
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(options.gbDecimals ?? 1)} GB`
}
