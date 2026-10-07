/**
 * unitInput helper tests.
 *
 * Covers parseForUnit / formatForUnit / unitSymbol across all six
 * UnitKind values, locale-aware separator handling, suffix stripping,
 * and the strict-mode escape hatch.
 */

import { describe, it, expect } from 'vitest'
import {
  parseForUnit,
  formatForUnit,
  unitSymbol,
  type UnitKind,
} from '../unitInput'
import type { AppSettings } from '@/api/types'

const baseSettings: AppSettings = {
  unit_of_length: 'mi',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
  currency_symbol: '$',
  locale: 'en-US',
}

function s(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...baseSettings, ...overrides }
}

describe('parseForUnit', () => {
  it('returns null for empty / whitespace-only input', () => {
    for (const unit of ['distance', 'energy', 'temperature', 'speed', 'percent', 'currency'] as UnitKind[]) {
      expect(parseForUnit('', unit, s())).toBeNull()
      expect(parseForUnit('   ', unit, s())).toBeNull()
    }
  })

  it('returns null for unparseable input', () => {
    expect(parseForUnit('abc', 'energy', s())).toBeNull()
    expect(parseForUnit('--', 'percent', s())).toBeNull()
    // Pure suffix with no number
    expect(parseForUnit('mph', 'speed', s())).toBeNull()
    expect(parseForUnit('%', 'percent', s())).toBeNull()
  })

  describe('distance (canonical = miles)', () => {
    it('passes through when display unit is miles', () => {
      expect(parseForUnit('60', 'distance', s({ unit_of_length: 'mi' }))).toBe(60)
    })

    it('converts km → miles when display unit is km', () => {
      const v = parseForUnit('100', 'distance', s({ unit_of_length: 'km' }))
      expect(v).not.toBeNull()
      expect(v).toBeCloseTo(62.137, 2)
    })

    it('strips trailing "km" suffix before parsing', () => {
      const v = parseForUnit('100 km', 'distance', s({ unit_of_length: 'km' }))
      expect(v).toBeCloseTo(62.137, 2)
    })

    it('strips trailing "mi" suffix before parsing', () => {
      expect(parseForUnit('25 mi', 'distance', s({ unit_of_length: 'mi' }))).toBe(25)
    })
  })

  describe('speed (canonical = mph)', () => {
    it('strips "km/h" suffix and converts to mph', () => {
      const v = parseForUnit('100 km/h', 'speed', s({ unit_of_length: 'km' }))
      expect(v).toBeCloseTo(62.137, 2)
    })

    it('passes through "mph" without conversion when display is mph', () => {
      expect(parseForUnit('70 mph', 'speed', s({ unit_of_length: 'mi' }))).toBe(70)
    })

    it('km/h is stripped before km when both could match', () => {
      const v = parseForUnit('80 km/h', 'speed', s({ unit_of_length: 'km' }))
      expect(v).toBeCloseTo(49.71, 1)
    })
  })

  describe('temperature (canonical = °C)', () => {
    it('passes through Celsius unchanged when display is °C', () => {
      expect(parseForUnit('20', 'temperature', s({ unit_of_temp: 'C' }))).toBe(20)
    })

    it('converts Fahrenheit → Celsius when display is °F', () => {
      const v = parseForUnit('68', 'temperature', s({ unit_of_temp: 'F' }))
      expect(v).toBeCloseTo(20, 5)
    })

    it('strips °F suffix before parsing', () => {
      const v = parseForUnit('212 °F', 'temperature', s({ unit_of_temp: 'F' }))
      expect(v).toBeCloseTo(100, 5)
    })

    it('strips °C suffix before parsing', () => {
      expect(parseForUnit('-10°C', 'temperature', s({ unit_of_temp: 'C' }))).toBe(-10)
    })
  })

  describe('energy / percent / currency (no conversion)', () => {
    it('returns the typed kWh number unchanged', () => {
      expect(parseForUnit('75', 'energy', s())).toBe(75)
      expect(parseForUnit('75 kWh', 'energy', s())).toBe(75)
    })

    it('strips the trailing % sign for percent', () => {
      expect(parseForUnit('80%', 'percent', s())).toBe(80)
      expect(parseForUnit('80 %', 'percent', s())).toBe(80)
    })

    it('strips the leading currency symbol for currency', () => {
      expect(parseForUnit('$1.23', 'currency', s({ currency_symbol: '$' }))).toBe(1.23)
      expect(parseForUnit('€42', 'currency', s({ currency_symbol: '€' }))).toBe(42)
    })

    it('treats accounting parentheses as negative for currency', () => {
      expect(parseForUnit('($10)', 'currency', s({ currency_symbol: '$' }))).toBe(-10)
      expect(parseForUnit('(10)', 'currency', s({ currency_symbol: '$' }))).toBe(-10)
    })

    it('uses "$" as the default currency symbol when settings.currency_symbol is blank', () => {
      expect(parseForUnit('$5', 'currency', s({ currency_symbol: '   ' }))).toBe(5)
      // Pass it without symbol to confirm the parser still works even without prefix
      expect(parseForUnit('5', 'currency', s({ currency_symbol: undefined }))).toBe(5)
    })
  })

  describe('locale-aware decimal & group separators', () => {
    it('en-US accepts "1,234.56" as 1234.56', () => {
      expect(parseForUnit('1,234.56', 'energy', s({ locale: 'en-US' }))).toBeCloseTo(1234.56)
    })

    it('de-DE accepts "1.234,56" as 1234.56', () => {
      expect(parseForUnit('1.234,56', 'energy', s({ locale: 'de-DE' }))).toBeCloseTo(1234.56)
    })

    it('de-DE accepts "0,5" as 0.5', () => {
      expect(parseForUnit('0,5', 'energy', s({ locale: 'de-DE' }))).toBeCloseTo(0.5)
    })

    it('strict mode bypasses locale normalisation', () => {
      // In de-DE non-strict, "0,5" → 0.5. With strict it goes through Number()
      // → NaN. Returning null is the documented contract.
      expect(parseForUnit('0,5', 'energy', s({ locale: 'de-DE' }), { strict: true })).toBeNull()
      expect(parseForUnit('0.5', 'energy', s({ locale: 'de-DE' }), { strict: true })).toBe(0.5)
    })
  })

  it('handles negative values', () => {
    expect(parseForUnit('-5', 'temperature', s({ unit_of_temp: 'C' }))).toBe(-5)
    expect(parseForUnit('-3.14', 'energy', s())).toBeCloseTo(-3.14)
  })
})

describe('formatForUnit', () => {
  it('formats null / non-finite as empty string', () => {
    expect(formatForUnit(null, 'distance', s())).toBe('')
    expect(formatForUnit(undefined, 'distance', s())).toBe('')
    expect(formatForUnit(Number.NaN, 'distance', s())).toBe('')
    expect(formatForUnit(Number.POSITIVE_INFINITY, 'energy', s())).toBe('')
  })

  it('passes through canonical when display unit matches', () => {
    expect(formatForUnit(60, 'distance', s({ unit_of_length: 'mi', decimal_precision: 0 }))).toBe('60')
    expect(formatForUnit(20, 'temperature', s({ unit_of_temp: 'C', decimal_precision: 0 }))).toBe('20')
  })

  it('converts canonical → display for distance/speed/temperature', () => {
    expect(formatForUnit(60, 'distance', s({ unit_of_length: 'km', decimal_precision: 2 }))).toBe('96.56')
    expect(formatForUnit(60, 'speed', s({ unit_of_length: 'km', decimal_precision: 0 }))).toBe('97')
    expect(formatForUnit(0, 'temperature', s({ unit_of_temp: 'F', decimal_precision: 0 }))).toBe('32')
    expect(formatForUnit(100, 'temperature', s({ unit_of_temp: 'F', decimal_precision: 0 }))).toBe('212')
  })

  it('does NOT convert energy / percent / currency', () => {
    expect(formatForUnit(75.5, 'energy', s({ decimal_precision: 1 }))).toBe('75.5')
    expect(formatForUnit(80, 'percent', s({ decimal_precision: 0 }))).toBe('80')
    expect(formatForUnit(1.23, 'currency', s({ decimal_precision: 2 }))).toBe('1.23')
  })

  it('respects locale decimal separator (de-DE uses comma)', () => {
    expect(formatForUnit(1.5, 'energy', s({ locale: 'de-DE', decimal_precision: 1 }))).toBe('1,5')
  })

  it('does NOT add thousands separators (false useGrouping for input fields)', () => {
    expect(formatForUnit(1234.5, 'energy', s({ locale: 'en-US', decimal_precision: 1 }))).toBe('1234.5')
    expect(formatForUnit(1234.5, 'energy', s({ locale: 'de-DE', decimal_precision: 1 }))).toBe('1234,5')
  })

  it('caps fraction digits to settings.decimal_precision', () => {
    expect(formatForUnit(3.14159, 'energy', s({ decimal_precision: 2 }))).toBe('3.14')
    expect(formatForUnit(3.14159, 'energy', s({ decimal_precision: 0 }))).toBe('3')
  })

  it('does NOT throw when settings.locale is empty / whitespace (regression: SmartCharge crash)', () => {
    // The settings API can return locale: '' when the column is unset.
    // `??` does not catch empty strings, so prior to the fix this would
    // call `new Intl.NumberFormat('')` and throw `RangeError: Invalid
    // language tag: `, blowing up the SmartCharge page on mount.
    expect(() => formatForUnit(75, 'energy', s({ locale: '', decimal_precision: 1 }))).not.toThrow()
    expect(formatForUnit(75, 'energy', s({ locale: '', decimal_precision: 1 }))).toBe('75')
    expect(() => formatForUnit(75, 'energy', s({ locale: '   ', decimal_precision: 1 }))).not.toThrow()
    expect(formatForUnit(75, 'energy', s({ locale: '   ', decimal_precision: 1 }))).toBe('75')
  })

  it('parseForUnit also tolerates empty / whitespace locale', () => {
    expect(() => parseForUnit('1234.5', 'energy', s({ locale: '' }))).not.toThrow()
    expect(parseForUnit('1234.5', 'energy', s({ locale: '' }))).toBe(1234.5)
  })

  it('round-trips parse → format for canonical-equivalent values', () => {
    const settings = s({ unit_of_length: 'km', decimal_precision: 2 })
    const parsed = parseForUnit('100', 'speed', settings)
    expect(parsed).not.toBeNull()
    // Format should re-display ~100 km/h
    const display = formatForUnit(parsed, 'speed', settings)
    expect(display).toBe('100')
  })
})

describe('unitSymbol', () => {
  it('returns mi/km for distance based on unit_of_length', () => {
    expect(unitSymbol('distance', s({ unit_of_length: 'mi' }))).toBe('mi')
    expect(unitSymbol('distance', s({ unit_of_length: 'km' }))).toBe('km')
  })

  it('returns mph/km/h for speed based on unit_of_length', () => {
    expect(unitSymbol('speed', s({ unit_of_length: 'mi' }))).toBe('mph')
    expect(unitSymbol('speed', s({ unit_of_length: 'km' }))).toBe('km/h')
  })

  it('returns °C/°F for temperature based on unit_of_temp', () => {
    expect(unitSymbol('temperature', s({ unit_of_temp: 'C' }))).toBe('°C')
    expect(unitSymbol('temperature', s({ unit_of_temp: 'F' }))).toBe('°F')
  })

  it('returns kWh / % literals', () => {
    expect(unitSymbol('energy', s())).toBe('kWh')
    expect(unitSymbol('percent', s())).toBe('%')
  })

  it('returns the configured currency symbol or "$" default', () => {
    expect(unitSymbol('currency', s({ currency_symbol: '€' }))).toBe('€')
    expect(unitSymbol('currency', s({ currency_symbol: '   ' }))).toBe('$')
    expect(unitSymbol('currency', s({ currency_symbol: undefined }))).toBe('$')
  })
})
