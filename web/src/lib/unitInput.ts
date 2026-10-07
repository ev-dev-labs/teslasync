/**
 * Unit input parser/formatter/symbol helpers.
 *
 * Pure helpers for the shared <UnitInput> primitive. Two directions:
 *
 *   parseForUnit  : user-typed text → canonical metric value
 *   formatForUnit : canonical metric value → display text in user units
 *
 * # Canonical units
 *
 * Storage is the SAME canonical the rest of TeslaSync uses (see
 * `web/src/hooks/useSettings.ts`):
 *
 *   distance     → miles      (display: 'mi' or 'km')
 *   speed        → mph        (display: 'mph' or 'km/h')
 *   temperature  → Celsius    (display: '°C' or '°F')
 *   energy       → kWh        (no per-user conversion)
 *   percent      → 0..100     (no per-user conversion)
 *   currency     → as-typed   (no FX; symbol from settings.currency_symbol)
 *
 * Returning canonical from `parseForUnit` lets callers store one value
 * and re-render in whatever unit the user later prefers without losing
 * precision.
 *
 * # Locale-aware parsing
 *
 * `parseForUnit` understands the locale's decimal AND group separators
 * (e.g. en-US "1,234.5" → 1234.5; de-DE "1.234,5" → 1234.5). Pass
 * `{ strict: true }` to bypass and use plain `Number()` parsing — the
 * Blocked-Path escape hatch for adopters that hit locale edge cases.
 *
 * # Suffix tolerance
 *
 * Both forms accept (and strip) the unit symbol in the input string,
 * so "60 mph", "60mph", "$1.23", "75 %" all parse cleanly. The longest
 * matching suffix wins ('km/h' before 'km').
 */

import type { AppSettings } from '@/api/types'
import { resolveLocale } from './locale'

const KM_PER_MI = 1.609344

function distanceDisplayToCanonical(displayValue: number): number {
  return displayValue / KM_PER_MI
}

function distanceCanonicalToDisplay(canonicalValue: number): number {
  return canonicalValue * KM_PER_MI
}

function tempDisplayToCanonical(displayValue: number): number {
  return ((displayValue - 32) * 5) / 9
}

function tempCanonicalToDisplay(canonicalValue: number): number {
  return (canonicalValue * 9) / 5 + 32
}

export type UnitKind =
  | 'distance'
  | 'energy'
  | 'temperature'
  | 'speed'
  | 'percent'
  | 'currency'

export interface ParseOptions {
  /**
   * When true, parse with plain `Number()` only (no locale-aware
   * separator handling). Use for adopters that experience ambiguity
   * around locales whose decimal separator collides with the
   * thousands separator of the input data (the Blocked-Path escape).
   */
  strict?: boolean
}

/** Longest-first so 'km/h' is stripped before 'km' / 'kw' before 'kwh' is wrong → 'kwh' first. */
const STRIPPABLE_SUFFIXES = [
  'km/h',
  'kwh',
  'mph',
  '°c',
  '°f',
  'kw',
  'mi',
  'km',
  '°',
] as const

/**
 * Parse a user-entered string into the canonical metric value
 * for the given unit kind. Returns `null` for empty / unparseable input.
 *
 * Handles:
 *   - leading/trailing whitespace
 *   - locale-aware decimal/group separators (unless `strict`)
 *   - trailing unit suffix tokens ('mph', 'km/h', '°C', 'kWh', etc.)
 *   - leading currency symbol (settings.currency_symbol) for `currency`
 *   - trailing '%' for `percent`
 *   - accounting parentheses for negative currency: "($10)" → -10
 */
export function parseForUnit(
  text: string,
  unit: UnitKind,
  settings: AppSettings,
  options: ParseOptions = {},
): number | null {
  let raw = (text ?? '').trim()
  if (!raw) return null

  if (unit === 'currency') {
    const symbol = (settings.currency_symbol ?? '').trim() || '$'
    if (raw.startsWith(symbol)) raw = raw.slice(symbol.length).trim()
    // Accounting parens: "(123.45)" → "-123.45"
    if (raw.startsWith('(') && raw.endsWith(')')) {
      raw = '-' + raw.slice(1, -1).trim()
      // Re-strip currency symbol if it was inside the parens, e.g. "($10)"
      if (raw.startsWith('-' + symbol)) raw = '-' + raw.slice(1 + symbol.length).trim()
    }
  }

  if (unit === 'percent' && raw.endsWith('%')) {
    raw = raw.slice(0, -1).trim()
  }

  // Strip a trailing unit symbol (case-insensitive longest match).
  const lower = raw.toLowerCase()
  for (const sfx of STRIPPABLE_SUFFIXES) {
    if (lower.endsWith(sfx)) {
      raw = raw.slice(0, raw.length - sfx.length).trim()
      break
    }
  }

  if (!raw) return null

  const n = options.strict
    ? Number(raw)
    : parseLocaleNumber(raw, resolveLocale(settings.locale))

  if (!Number.isFinite(n)) return null

  switch (unit) {
    case 'distance':
    case 'speed':
      // Display unit → canonical (miles/mph).
      return settings.unit_of_length === 'km' ? distanceDisplayToCanonical(n) : n
    case 'temperature':
      // Display unit → canonical (°C).
      return settings.unit_of_temp === 'F' ? tempDisplayToCanonical(n) : n
    case 'energy':
    case 'percent':
    case 'currency':
      return n
  }
}

/**
 * Format a canonical metric value as display text for the input field.
 * Uses `Intl.NumberFormat` so the decimal separator matches the user's
 * locale. Group separators are intentionally OFF — input fields render
 * worse with thousands separators (cursor positioning, parse round-trip).
 *
 * Returns '' for null / non-finite values so the field shows blank.
 */
export function formatForUnit(
  value: number | null | undefined,
  unit: UnitKind,
  settings: AppSettings,
): string {
  if (value == null || !Number.isFinite(value)) return ''
  const locale = resolveLocale(settings.locale)
  const decimals = settings.decimal_precision ?? 2

  const display = (() => {
    switch (unit) {
      case 'distance':
      case 'speed':
        return settings.unit_of_length === 'km' ? distanceCanonicalToDisplay(value) : value
      case 'temperature':
        return settings.unit_of_temp === 'F' ? tempCanonicalToDisplay(value) : value
      case 'energy':
      case 'percent':
      case 'currency':
        return value
    }
  })()

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.max(0, decimals),
    useGrouping: false,
  }).format(display)
}

/**
 * Returns the unit symbol shown in the input adornment.
 *
 * 'distance'    → 'mi' | 'km'
 * 'speed'       → 'mph' | 'km/h'
 * 'temperature' → '°C' | '°F'
 * 'energy'      → 'kWh'
 * 'percent'     → '%'
 * 'currency'    → settings.currency_symbol (or '$')
 */
export function unitSymbol(unit: UnitKind, settings: AppSettings): string {
  switch (unit) {
    case 'distance':
      return settings.unit_of_length === 'km' ? 'km' : 'mi'
    case 'speed':
      return settings.unit_of_length === 'km' ? 'km/h' : 'mph'
    case 'temperature':
      return settings.unit_of_temp === 'F' ? '°F' : '°C'
    case 'energy':
      return 'kWh'
    case 'percent':
      return '%'
    case 'currency':
      return (settings.currency_symbol ?? '').trim() || '$'
  }
}

/**
 * Parse `text` as a number using the locale's decimal & group separators.
 * Falls back to plain `Number()` when the locale cannot be inspected.
 *
 * Examples:
 *   parseLocaleNumber('1,234.56', 'en-US') → 1234.56
 *   parseLocaleNumber('1.234,56', 'de-DE') → 1234.56
 *   parseLocaleNumber('-3.14',    'en-US') → -3.14
 */
function parseLocaleNumber(text: string, locale: string): number {
  if (!text) return NaN
  let groupSep = ','
  let decimalSep = '.'
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
    const g = parts.find((p) => p.type === 'group')?.value
    const d = parts.find((p) => p.type === 'decimal')?.value
    if (typeof g === 'string') groupSep = g
    if (typeof d === 'string') decimalSep = d
  } catch {
    // keep en-US defaults
  }

  let normalized = text
  if (groupSep && groupSep !== decimalSep) {
    normalized = normalized.split(groupSep).join('')
  }
  if (decimalSep !== '.') {
    normalized = normalized.split(decimalSep).join('.')
  }
  return Number(normalized)
}
