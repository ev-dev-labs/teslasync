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
 *   distance     → meters     (display: 'mi' or 'km')
 *   speed        → m/s        (display: 'mph' or 'km/h')
 *   temperature  → Celsius    (display: '°C' or '°F')
 *   pressure     → kPa        (display: 'psi' or 'bar')
 *   energy       → Wh         (display: 'kWh')
 *   percent      → 0..100     (no per-user conversion)
 *   currency     → as-typed   (no FX; symbol from settings.currency_symbol)
 *   power        → W          (display: kW)
 *   efficiency   → Wh/km      (display: Wh/km or Wh/mi)
 *   currencyPerDistance → currency/m (no FX)
 *   hours        → seconds    (display: h)
 *   count        → integer
 *   percentagePoints → percentage points
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
import {
  convertDistanceFromSI, convertDistanceToSI,
  convertSpeedFromSI, convertSpeedToSI,
  convertTempFromSI, convertTempToSI,
  convertPressureFromSI, convertPressureToSI,
  convertEnergyFromSI,
  convertPowerFromSI,
  convertEfficiencyFromSI,
  convertDurationFromSI,
} from './unitConversion'

export type UnitKind =
  | 'distance'
  | 'energy'
  | 'temperature'
  | 'speed'
  | 'pressure'
  | 'percent'
  | 'currency'
  | 'number'
  | 'count'
  | 'power'
  | 'efficiency'
  | 'currencyPerDistance'
  | 'hours'
  | 'percentagePoints'

export type UnitInputSettings = Pick<AppSettings,
  'unit_of_length' | 'unit_of_temp' | 'unit_of_pressure' |
  'currency_symbol' | 'locale' | 'decimal_precision'>

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
  'wh/km',
  'wh/mi',
  '/km',
  '/mi',
  'km/h',
  'kwh',
  'mph',
  '°c',
  '°f',
  'kw',
  'mi',
  'km',
  'kpa',
  'psi',
  'bar',
  '°',
  'pp',
  'h',
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
  settings: UnitInputSettings,
  options: ParseOptions = {},
): number | null {
  let raw = (text ?? '').trim()
  if (!raw) return null

  if (unit === 'currency' || unit === 'currencyPerDistance') {
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
      const symbol = unitSymbol(unit, settings).toLowerCase()
      if (sfx !== symbol && !(unit === 'currencyPerDistance' && symbol.endsWith(sfx))) return null
      raw = raw.slice(0, raw.length - sfx.length).trim()
      break
    }
  }

  if (!raw) return null

  const n = options.strict
    ? Number(raw)
    : parseLocaleNumber(raw, resolveLocale(settings.locale))

  if (!Number.isFinite(n)) return null

  const canonical = (() => { switch (unit) {
    case 'distance':
      return convertDistanceToSI(n, settings.unit_of_length === 'mi' ? 'mi' : 'km')
    case 'speed':
      return convertSpeedToSI(n, settings.unit_of_length === 'mi' ? 'mph' : 'km/h')
    case 'temperature':
      return convertTempToSI(n, settings.unit_of_temp === 'F' ? '°F' : '°C')
    case 'pressure':
      return convertPressureToSI(n, settings.unit_of_pressure === 'psi' ? 'psi' : 'bar')
    case 'energy':
      return n / convertEnergyFromSI(1, 'kWh')
    case 'power':
      return n / convertPowerFromSI(1, 'kW')
    case 'efficiency':
      return n / convertEfficiencyFromSI(1, settings.unit_of_length === 'mi' ? 'mi' : 'km')
    case 'currencyPerDistance':
      return n * convertDistanceFromSI(1, settings.unit_of_length === 'mi' ? 'mi' : 'km')
    case 'hours':
      return n / convertDurationFromSI(1, 'h')
    case 'count':
      return Number.isSafeInteger(n) ? n : null
    case 'percent':
    case 'percentagePoints':
    case 'currency':
    case 'number':
      return n
  } })()
  return canonical !== null && Number.isFinite(canonical) ? canonical : null
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
  settings: UnitInputSettings,
): string {
  if (value == null || !Number.isFinite(value)) return ''
  const locale = resolveLocale(settings.locale)
  const selectedPrecision = settings.decimal_precision
  const decimals = unit === 'count' ? 0 : typeof selectedPrecision === 'number' && Number.isFinite(selectedPrecision) && selectedPrecision >= 0
    ? Math.min(20, Math.floor(selectedPrecision))
    : 2

  const display = (() => {
    switch (unit) {
      case 'distance':
        return convertDistanceFromSI(value, settings.unit_of_length === 'mi' ? 'mi' : 'km')
      case 'speed':
        return convertSpeedFromSI(value, settings.unit_of_length === 'mi' ? 'mph' : 'km/h')
      case 'temperature':
        return convertTempFromSI(value, settings.unit_of_temp === 'F' ? '°F' : '°C')
      case 'pressure':
        return convertPressureFromSI(value, settings.unit_of_pressure === 'psi' ? 'psi' : 'bar')
      case 'energy':
        return convertEnergyFromSI(value, 'kWh')
      case 'power':
        return convertPowerFromSI(value, 'kW')
      case 'efficiency':
        return convertEfficiencyFromSI(value, settings.unit_of_length === 'mi' ? 'mi' : 'km')
      case 'currencyPerDistance':
        return value / convertDistanceFromSI(1, settings.unit_of_length === 'mi' ? 'mi' : 'km')
      case 'hours':
        return convertDurationFromSI(value, 'h')
      case 'count':
      case 'percent':
      case 'percentagePoints':
      case 'currency':
      case 'number':
        return value
    }
  })()

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
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
 * 'pressure'    → 'psi' | 'bar'
 * 'percent'     → '%'
 * 'currency'    → settings.currency_symbol (or '$')
 */
export function unitSymbol(unit: UnitKind, settings: UnitInputSettings): string {
  switch (unit) {
    case 'distance':
      return settings.unit_of_length === 'mi' ? 'mi' : 'km'
    case 'speed':
      return settings.unit_of_length === 'mi' ? 'mph' : 'km/h'
    case 'temperature':
      return settings.unit_of_temp === 'F' ? '°F' : '°C'
    case 'energy':
      return 'kWh'
    case 'pressure':
      return settings.unit_of_pressure === 'psi' ? 'psi' : 'bar'
    case 'percent':
      return '%'
    case 'currency':
      return (settings.currency_symbol ?? '').trim() || '$'
    case 'power':
      return 'kW'
    case 'efficiency':
      return settings.unit_of_length === 'mi' ? 'Wh/mi' : 'Wh/km'
    case 'currencyPerDistance':
      return `${unitSymbol('currency', settings)}/${unitSymbol('distance', settings)}`
    case 'hours':
      return 'h'
    case 'percentagePoints':
      return 'pp'
    case 'count':
    case 'number':
      return ''
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
  const formatter = new Intl.NumberFormat(locale)
  const parts = formatter.formatToParts(12345.6)
  const groupSep = parts.find(p => p.type === 'group')?.value ?? ''
  const decimalSep = parts.find(p => p.type === 'decimal')?.value ?? '.'

  let normalized = text.replace(/[\u061c\u200e\u200f]/g, '')
  for (let digit = 0; digit <= 9; digit++) {
    normalized = normalized.split(formatter.format(digit)).join(String(digit))
  }
  if (groupSep && groupSep !== decimalSep) {
    normalized = normalized.split(groupSep).join('')
  }
  if (decimalSep !== '.') {
    normalized = normalized.split(decimalSep).join('.')
  }
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)
    ? Number(normalized)
    : NaN
}

/** Display list delimiters stay unambiguous even when the locale uses decimal commas. */
export function formatUnitList(values: readonly number[], unit: UnitKind, settings: UnitInputSettings): string {
  return values.map(value => formatForUnit(value, unit, settings)).join('; ')
}

export function parseUnitList(text: string, unit: UnitKind, settings: UnitInputSettings): number[] | null {
  if (!text.trim()) return []
  const values = text.split(';').map(part => parseForUnit(part, unit, settings))
  return values.every((value): value is number => value !== null) ? values : null
}
