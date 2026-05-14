/**
 * Phase-46 / Prompt 49 — Currency formatting & parsing helpers.
 *
 * Pure helpers for the shared `<CurrencyInput>` primitive. Two directions:
 *
 *   parseCurrencyText    : user-typed text → number (full precision)
 *   formatCurrencyValue  : number → display string for a given currency/locale
 *
 * # Canonical storage = micro-units
 *
 * To avoid floating-point round-trip loss across currencies that have
 * 0/2/3/4 fractional digits (USD/JPY/BHD/CLF), CurrencyInput stores its
 * value in **micro-units** — integer multiples of 1e-6 of the major
 * unit (1.00 USD = 1_000_000 micro USD). This is the same trick used
 * by Stripe's amount-in-cents but extended to micro so we can preserve
 * fractional cents (e.g. tariff rates of 0.12345 USD/kWh).
 *
 *   valueToMicro(1.5)        → 1_500_000
 *   microToValue(1_500_000)  → 1.5
 *
 * # Locale-aware parsing
 *
 * `parseCurrencyText` understands the locale's decimal AND group
 * separators (e.g. en-US "1,234.56" → 1234.56; de-DE "1.234,56" →
 * 1234.56) AND strips the localized currency symbol ("$1.50",
 * "1,50 €") so users in any locale can paste a formatted number back
 * into the field and get the right value. ISO codes ("USD 1.50") are
 * also recognised.
 *
 * # Currency code
 *
 * The `currency` argument is treated as ISO 4217 by `Intl.NumberFormat`.
 * Invalid codes throw `RangeError` — the helpers catch and fall back
 * to a plain decimal format with the literal code as a prefix so the
 * field still renders something readable.
 */

const MICRO_SCALE = 1_000_000

/**
 * Convert a major-unit number to integer micro-units.
 *
 *   valueToMicro(1.5)      → 1_500_000
 *   valueToMicro(0.00001)  → 10
 *   valueToMicro(null)     → null
 *   valueToMicro(NaN)      → null
 */
export function valueToMicro(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  // Round to nearest integer micro to prevent 0.1 + 0.2 style FP drift
  // from leaking into storage. Math.round handles negatives correctly
  // (banker's rounding is overkill for 6-decimal precision).
  return Math.round(value * MICRO_SCALE)
}

/**
 * Convert integer micro-units back to the major unit.
 *
 *   microToValue(1_500_000) → 1.5
 *   microToValue(0)         → 0
 *   microToValue(null)      → null
 */
export function microToValue(micro: number | null | undefined): number | null {
  if (micro == null || !Number.isFinite(micro)) return null
  return micro / MICRO_SCALE
}

/**
 * Format a major-unit value as currency text using `Intl.NumberFormat`.
 *
 * Returns '' for null/non-finite so callers can pass-through to a blank
 * input. Pass `useGrouping: false` for input-field rendering — group
 * separators inside an editable field cause cursor-positioning pain
 * and round-trip ambiguity.
 */
export function formatCurrencyValue(
  value: number | null | undefined,
  currency: string,
  locale: string,
  precision: number,
  options: { useGrouping?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return ''
  const useGrouping = options.useGrouping ?? false
  const digits = clampPrecision(precision)
  const lc = normaliseLocale(locale)
  try {
    return new Intl.NumberFormat(lc, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping,
    }).format(value)
  } catch {
    // Invalid currency code (not ISO 4217) — fall back to a plain decimal
    // and prefix the literal code so the field still renders something.
    const plain = new Intl.NumberFormat(lc, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping,
    }).format(value)
    return `${currency} ${plain}`.trim()
  }
}

/**
 * Format a micro-unit value as currency text. Convenience wrapper
 * around `microToValue` + `formatCurrencyValue`.
 */
export function formatCurrencyMicro(
  micro: number | null | undefined,
  currency: string,
  locale: string,
  precision: number,
  options: { useGrouping?: boolean } = {},
): string {
  return formatCurrencyValue(microToValue(micro), currency, locale, precision, options)
}

/**
 * Returns the localized currency symbol for the given currency/locale,
 * e.g. ('USD','en-US') → '$', ('EUR','de-DE') → '€', ('GBP','en-GB') → '£'.
 *
 * Falls back to the literal currency code when `Intl.NumberFormat`
 * rejects the code (non-ISO 4217).
 */
export function currencySymbol(currency: string, locale: string): string {
  const lc = normaliseLocale(locale)
  try {
    const parts = new Intl.NumberFormat(lc, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
    }).formatToParts(0)
    const sym = parts.find((p) => p.type === 'currency')?.value
    return sym ?? currency
  } catch {
    return currency
  }
}

/**
 * Best-effort reverse lookup: given a currency symbol from settings
 * (e.g. '$', '€', '£', '¥', '₹', 'kr'), guess the most-common ISO 4217
 * code so callers can pass it to `Intl.NumberFormat`. Falls back to
 * `'USD'` for unknown symbols.
 *
 * The settings panel only stores the symbol (`currency_symbol`), not
 * the ISO code. This helper bridges that gap when the caller needs a
 * proper Intl-formatted currency string.
 */
export function currencyCodeFromSymbol(symbol: string | null | undefined): string {
  const s = (symbol ?? '').trim()
  switch (s) {
    case '$': return 'USD'
    case '€': return 'EUR'
    case '£': return 'GBP'
    case '¥': return 'JPY'
    case '₹': return 'INR'
    case '₽': return 'RUB'
    case '₩': return 'KRW'
    case 'A$': return 'AUD'
    case 'C$': return 'CAD'
    case 'CHF': return 'CHF'
    case 'kr': return 'SEK'
    case 'R$': return 'BRL'
    case 'R': return 'ZAR'
    case 'NZ$': return 'NZD'
    case 'HK$': return 'HKD'
    case 'NT$': return 'TWD'
    case 'S$': return 'SGD'
    case '₺': return 'TRY'
    case '฿': return 'THB'
    case 'Mex$': return 'MXN'
    case 'zł': return 'PLN'
    default: return 'USD'
  }
}

/**
 * Parse a user-typed string as a major-unit number for the given
 * currency/locale. Returns `null` for empty / unparseable input.
 *
 * Strips:
 *   - leading/trailing whitespace
 *   - the localized currency symbol ('$', '€', '£', '¥', etc.)
 *   - the literal ISO code ('USD', 'EUR') and code variants like 'US$'
 *   - locale group separators
 *   - accounting parentheses for negative values: "($1.50)" → -1.5
 *
 * Then normalises the decimal separator to '.' before `Number()`.
 */
export function parseCurrencyText(
  text: string,
  currency: string,
  locale: string,
): number | null {
  let raw = (text ?? '').trim()
  if (!raw) return null

  // Accounting parens before symbol stripping so "($1.50)" → "-$1.50".
  let negative = false
  if (raw.startsWith('(') && raw.endsWith(')')) {
    negative = true
    raw = raw.slice(1, -1).trim()
  }

  raw = stripCurrencyAdornments(raw, currency, locale)
  if (!raw) return null

  // A leading sign may sit between the symbol and the digits ("$-1.50")
  // or at the very front ("-$1.50"); collapse to one canonical leading sign.
  if (raw.startsWith('-')) {
    negative = !negative
    raw = raw.slice(1).trim()
  } else if (raw.startsWith('+')) {
    raw = raw.slice(1).trim()
  }

  if (!raw) return null

  const n = parseLocaleNumber(raw, normaliseLocale(locale))
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

/**
 * Parse user-typed text directly into integer micro-units. Convenience
 * wrapper around `parseCurrencyText` + `valueToMicro`.
 */
export function parseCurrencyTextToMicro(
  text: string,
  currency: string,
  locale: string,
): number | null {
  return valueToMicro(parseCurrencyText(text, currency, locale))
}

// ───────────────────────── internals ─────────────────────────

function clampPrecision(precision: number | undefined): number {
  if (precision == null || !Number.isFinite(precision)) return 2
  return Math.max(0, Math.min(20, Math.trunc(precision)))
}

function normaliseLocale(locale: string | undefined): string {
  return locale && locale.trim() ? locale : 'en-US'
}

/**
 * Strip the currency symbol, the literal ISO code, and any plain-letter
 * adornment surrounding the numeric portion. Case-insensitive on the
 * literal code so 'usd 1' parses identically to 'USD 1'.
 */
function stripCurrencyAdornments(
  raw: string,
  currency: string,
  locale: string,
): string {
  const symbol = currencySymbol(currency, locale)
  const code = currency.trim()

  // Symbol stripping — try start AND end since locales like de-DE
  // suffix the symbol ("1,50 €").
  let out = raw
  if (symbol && symbol !== code) {
    out = out.split(symbol).join('')
  }
  if (code) {
    // Match the literal code with optional surrounding whitespace,
    // case-insensitively, anywhere in the string.
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(escaped, 'gi'), '')
  }
  return out.trim()
}

/**
 * Parse `text` as a number using the locale's decimal & group separators.
 * Falls back to plain `Number()` when the locale can't be inspected.
 *
 *   parseLocaleNumber('1,234.56', 'en-US') → 1234.56
 *   parseLocaleNumber('1.234,56', 'de-DE') → 1234.56
 *   parseLocaleNumber('1 234,56', 'fr-FR') → 1234.56
 */
export function parseLocaleNumber(text: string, locale: string): number {
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
    // keep defaults
  }

  let normalized = text
  // fr-FR uses U+00A0 (NBSP) as group separator; users typing in the
  // field will press the regular space bar. Normalise both to nothing.
  if (groupSep === '\u00A0' || groupSep === ' ') {
    normalized = normalized.split('\u00A0').join('').split(' ').join('')
  } else if (groupSep && groupSep !== decimalSep) {
    normalized = normalized.split(groupSep).join('')
  }
  if (decimalSep !== '.') {
    normalized = normalized.split(decimalSep).join('.')
  }
  // Strip any remaining whitespace that may have hitch-hiked from a copy/paste.
  normalized = normalized.replace(/\s+/g, '')
  return Number(normalized)
}
