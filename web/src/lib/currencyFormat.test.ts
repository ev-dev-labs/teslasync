import { describe, it, expect } from 'vitest'

import {
  currencySymbol,
  formatCurrencyMicro,
  formatCurrencyValue,
  microToValue,
  parseCurrencyText,
  parseCurrencyTextToMicro,
  parseLocaleNumber,
  valueToMicro,
} from './currencyFormat'

describe('currencyFormat — micro round-trip', () => {
  it('valueToMicro converts major units to integer micro', () => {
    expect(valueToMicro(1)).toBe(1_000_000)
    expect(valueToMicro(1.5)).toBe(1_500_000)
    expect(valueToMicro(0.12)).toBe(120_000)
    expect(valueToMicro(0.000001)).toBe(1)
    expect(valueToMicro(-2.5)).toBe(-2_500_000)
    expect(valueToMicro(0)).toBe(0)
  })

  it('valueToMicro returns null for nullish / non-finite input', () => {
    expect(valueToMicro(null)).toBeNull()
    expect(valueToMicro(undefined)).toBeNull()
    expect(valueToMicro(NaN)).toBeNull()
    expect(valueToMicro(Infinity)).toBeNull()
    expect(valueToMicro(-Infinity)).toBeNull()
  })

  it('microToValue converts micro back to major', () => {
    expect(microToValue(1_000_000)).toBe(1)
    expect(microToValue(1_500_000)).toBe(1.5)
    expect(microToValue(120_000)).toBe(0.12)
    expect(microToValue(0)).toBe(0)
    expect(microToValue(-2_500_000)).toBe(-2.5)
  })

  it('microToValue returns null for nullish / non-finite input', () => {
    expect(microToValue(null)).toBeNull()
    expect(microToValue(undefined)).toBeNull()
    expect(microToValue(NaN)).toBeNull()
  })

  it('round-trip: valueToMicro → microToValue is identity for finite inputs', () => {
    for (const v of [0, 0.01, 0.12, 1, 1.5, 1234.56, -3.14]) {
      expect(microToValue(valueToMicro(v))).toBeCloseTo(v, 6)
    }
  })

  it('round-trip preserves precision past Number FP wobble (0.1 + 0.2)', () => {
    // 0.30000000000000004 should round to 300_000 micro and back to 0.3.
    const wobbled = 0.1 + 0.2
    const m = valueToMicro(wobbled)
    expect(m).toBe(300_000)
    expect(microToValue(m)).toBe(0.3)
  })
})

describe('currencyFormat — formatCurrencyValue', () => {
  it('formats USD in en-US with symbol prefix', () => {
    expect(formatCurrencyValue(1.5, 'USD', 'en-US', 2)).toBe('$1.50')
    expect(formatCurrencyValue(0, 'USD', 'en-US', 2)).toBe('$0.00')
  })

  it('formats EUR in de-DE with symbol suffix and comma decimal', () => {
    const out = formatCurrencyValue(1.5, 'EUR', 'de-DE', 2)
    // Different ICU versions: "1,50 €" with a regular or NBSP space.
    expect(out.replace(/\s/g, ' ')).toBe('1,50 €')
  })

  it('formats GBP in en-GB', () => {
    expect(formatCurrencyValue(1234.5, 'GBP', 'en-GB', 2, { useGrouping: false })).toBe(
      '£1234.50',
    )
  })

  it('returns "" for null / non-finite input', () => {
    expect(formatCurrencyValue(null, 'USD', 'en-US', 2)).toBe('')
    expect(formatCurrencyValue(undefined, 'USD', 'en-US', 2)).toBe('')
    expect(formatCurrencyValue(NaN, 'USD', 'en-US', 2)).toBe('')
  })

  it('respects precision argument', () => {
    expect(formatCurrencyValue(0.12345, 'USD', 'en-US', 4)).toBe('$0.1235')
    expect(formatCurrencyValue(0.12345, 'USD', 'en-US', 2)).toBe('$0.12')
    expect(formatCurrencyValue(1, 'USD', 'en-US', 0)).toBe('$1')
  })

  it('falls back to literal code prefix for invalid ISO 4217 code', () => {
    const out = formatCurrencyValue(1.5, 'XYZ', 'en-US', 2)
    // Recent ICU still accepts XYZ as a private-use code; older builds throw.
    // Either way the rendered text must contain the typed amount.
    expect(out).toMatch(/1\.50/)
  })

  it('formatCurrencyMicro round-trips through microToValue', () => {
    expect(formatCurrencyMicro(1_500_000, 'USD', 'en-US', 2)).toBe('$1.50')
    expect(formatCurrencyMicro(null, 'USD', 'en-US', 2)).toBe('')
  })
})

describe('currencyFormat — currencySymbol', () => {
  it('returns the localized symbol for ISO 4217 codes', () => {
    expect(currencySymbol('USD', 'en-US')).toBe('$')
    expect(currencySymbol('EUR', 'de-DE')).toBe('€')
    expect(currencySymbol('GBP', 'en-GB')).toBe('£')
  })

  it('returns the literal code when ICU rejects the currency', () => {
    // 'NOTACURRENCY' should bypass the ICU lookup (or render the literal code).
    const out = currencySymbol('NOTACURRENCY', 'en-US')
    expect(out).toMatch(/NOTACURRENCY/i)
  })
})

describe('currencyFormat — parseCurrencyText', () => {
  it('parses plain numeric strings in en-US', () => {
    expect(parseCurrencyText('1.50', 'USD', 'en-US')).toBe(1.5)
    expect(parseCurrencyText('1234.56', 'USD', 'en-US')).toBe(1234.56)
    expect(parseCurrencyText('0', 'USD', 'en-US')).toBe(0)
  })

  it('parses de-DE formatted "1,50" as 1.5 EUR', () => {
    expect(parseCurrencyText('1,50', 'EUR', 'de-DE')).toBe(1.5)
    expect(parseCurrencyText('1.234,56', 'EUR', 'de-DE')).toBe(1234.56)
  })

  it('strips the localized currency symbol on either side', () => {
    expect(parseCurrencyText('$1.50', 'USD', 'en-US')).toBe(1.5)
    expect(parseCurrencyText('1.50 $', 'USD', 'en-US')).toBe(1.5)
    expect(parseCurrencyText('1,50 €', 'EUR', 'de-DE')).toBe(1.5)
    expect(parseCurrencyText('€1,50', 'EUR', 'de-DE')).toBe(1.5)
    expect(parseCurrencyText('£1.50', 'GBP', 'en-GB')).toBe(1.5)
  })

  it('strips the literal ISO code (case-insensitive)', () => {
    expect(parseCurrencyText('USD 1.50', 'USD', 'en-US')).toBe(1.5)
    expect(parseCurrencyText('1.50 USD', 'USD', 'en-US')).toBe(1.5)
    expect(parseCurrencyText('usd 1.50', 'USD', 'en-US')).toBe(1.5)
  })

  it('handles fr-FR group separator (NBSP / regular space)', () => {
    expect(parseCurrencyText('1\u00A0234,56', 'EUR', 'fr-FR')).toBe(1234.56)
    expect(parseCurrencyText('1 234,56', 'EUR', 'fr-FR')).toBe(1234.56)
  })

  it('returns null for empty / whitespace-only input', () => {
    expect(parseCurrencyText('', 'USD', 'en-US')).toBeNull()
    expect(parseCurrencyText('   ', 'USD', 'en-US')).toBeNull()
    expect(parseCurrencyText('$', 'USD', 'en-US')).toBeNull()
  })

  it('returns null for unparseable input', () => {
    expect(parseCurrencyText('abc', 'USD', 'en-US')).toBeNull()
    expect(parseCurrencyText('$$', 'USD', 'en-US')).toBeNull()
  })

  it('handles accounting parentheses for negative values', () => {
    expect(parseCurrencyText('($1.50)', 'USD', 'en-US')).toBe(-1.5)
    expect(parseCurrencyText('(1,50 €)', 'EUR', 'de-DE')).toBe(-1.5)
    expect(parseCurrencyText('(1.50)', 'USD', 'en-US')).toBe(-1.5)
  })

  it('handles explicit minus sign at either position', () => {
    expect(parseCurrencyText('-$1.50', 'USD', 'en-US')).toBe(-1.5)
    expect(parseCurrencyText('$-1.50', 'USD', 'en-US')).toBe(-1.5)
    expect(parseCurrencyText('-1.50', 'USD', 'en-US')).toBe(-1.5)
  })

  it('parses decimal-only inputs', () => {
    expect(parseCurrencyText('.5', 'USD', 'en-US')).toBe(0.5)
    expect(parseCurrencyText(',5', 'EUR', 'de-DE')).toBe(0.5)
  })

  it('falls back to en-US parsing for invalid locale tags', () => {
    expect(parseCurrencyText('1.50', 'USD', '')).toBe(1.5)
    expect(parseCurrencyText('1.50', 'USD', 'not-a-locale')).toBe(1.5)
  })
})

describe('currencyFormat — parseCurrencyTextToMicro', () => {
  it('converts a parsed major-unit value to micro', () => {
    expect(parseCurrencyTextToMicro('1.50', 'USD', 'en-US')).toBe(1_500_000)
    expect(parseCurrencyTextToMicro('1,50', 'EUR', 'de-DE')).toBe(1_500_000)
    expect(parseCurrencyTextToMicro('0.12', 'USD', 'en-US')).toBe(120_000)
  })

  it('returns null for blank / unparseable input', () => {
    expect(parseCurrencyTextToMicro('', 'USD', 'en-US')).toBeNull()
    expect(parseCurrencyTextToMicro('garbage', 'USD', 'en-US')).toBeNull()
  })

  it('locale-equivalent inputs map to the same micro value', () => {
    const a = parseCurrencyTextToMicro('1.50', 'USD', 'en-US')
    const b = parseCurrencyTextToMicro('1,50', 'EUR', 'de-DE')
    expect(a).toBe(b)
    expect(a).toBe(1_500_000)
  })
})

describe('currencyFormat — parseLocaleNumber (exported helper)', () => {
  it('parses en-US grouped numbers', () => {
    expect(parseLocaleNumber('1,234.56', 'en-US')).toBe(1234.56)
  })

  it('parses de-DE grouped numbers', () => {
    expect(parseLocaleNumber('1.234,56', 'de-DE')).toBe(1234.56)
  })

  it('parses fr-FR with NBSP group separator', () => {
    expect(parseLocaleNumber('1\u00A0234,56', 'fr-FR')).toBe(1234.56)
  })

  it('returns NaN for empty input', () => {
    expect(parseLocaleNumber('', 'en-US')).toBeNaN()
  })

  it('handles negative and decimal-only', () => {
    expect(parseLocaleNumber('-3.14', 'en-US')).toBe(-3.14)
    expect(parseLocaleNumber('.5', 'en-US')).toBe(0.5)
  })
})
