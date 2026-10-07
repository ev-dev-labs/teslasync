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
  parseUnitList,
} from '../unitInput'
import type { AppSettings } from '@/api/types'
import { computedMetricInputUnit } from '../computedMetricUnits'

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

describe('computed metric input units', () => {
  it('parses native digits and locale decimal commas without confusing list delimiters', () => {
    const arabic = new Intl.NumberFormat('ar-EG', { useGrouping: false }).format(12.5)
    expect(parseForUnit(arabic, 'percent', s({ locale: 'ar-EG' }))).toBe(12.5)
    expect(parseUnitList('68,5; 77,25', 'temperature', s({ locale: 'de-DE', unit_of_temp: 'F' })))
      .toEqual([(68.5 - 32) * 5 / 9, (77.25 - 32) * 5 / 9])
    expect(parseUnitList('68,5;', 'temperature', s({ locale: 'de-DE' }))).toBeNull()
    expect(parseForUnit('0x10', 'percent', s())).toBeNull()
  })
  it.each([
    ['mi', 60, 'distance', 96560.64, '60.00'],
    ['km', 100, 'distance', 100000, '62.14'],
    ['mph', 70, 'speed', 31.2928, '70.00'],
    ['kwh', 42.1, 'energy', 42100, '42.10'],
    ['kw', 7.4, 'power', 7400, '7.40'],
    ['wh_per_mi', 250, 'efficiency', 155.3427980593335, '250.00'],
    ['h', 1.5, 'hours', 5400, '1.50'],
    ['count', 123, 'count', 123, '123'],
    ['pp', 20.25, 'percentagePoints', 20.25, '20.25'],
    ['currency', 1.25, 'currency', 1.25, '1.25'],
  ] as const)('bridges %s to canonical input and back without rounding', (unit, wire, kind, canonical, display) => {
    const bridge = computedMetricInputUnit(unit)
    expect(bridge.kind).toBe(kind)
    expect(wire * bridge.canonicalFactor).toBeCloseTo(canonical, 8)
    expect(formatForUnit(wire * bridge.canonicalFactor, bridge.kind, s())).toBe(display)
    const parsed = parseForUnit(display, bridge.kind, s())
    expect(parsed).not.toBeNull()
    if (unit !== 'km') expect(parsed! / bridge.canonicalFactor).toBeCloseTo(wire, 8)
  })

  it('converts cost-per-distance magnitudes as well as their labels without FX conversion', () => {
    const bridge = computedMetricInputUnit('currency_per_mi')
    const settings = s({ unit_of_length: 'km', currency_symbol: '€', locale: 'de-DE' })
    expect(unitSymbol(bridge.kind, settings)).toBe('€/km')
    expect(formatForUnit(0.5 * bridge.canonicalFactor, bridge.kind, settings)).toBe('0,31')
    expect(parseForUnit('€0,312345/km', bridge.kind, settings)! / bridge.canonicalFactor)
      .toBeCloseTo(0.312345 * 1.609344, 10)
  })

  it('preserves integer counts and rejects fractional or overflowing canonical input', () => {
    expect(formatForUnit(12, 'count', s({ decimal_precision: 4 }))).toBe('12')
    expect(parseForUnit('12.5', 'count', s())).toBeNull()
    expect(parseForUnit('6e307', 'distance', s())).toBeNull()
  })
})

describe('parseForUnit', () => {
  it.each(['0x10', '0b10', '0o10'])('rejects non-decimal input in strict mode: %s', text => {
    expect(parseForUnit(text, 'number', s(), { strict: true })).toBeNull()
  })

  it.each(['sv-SE', 'fi-FI', 'ar-EG', 'fa-IR'])(
    'round-trips a native negative temperature in %s without losing its sign',
    locale => {
      const text = new Intl.NumberFormat(locale).format(-1234.5)
      expect(parseForUnit(text, 'temperature', s({ locale }))).toBe(-1234.5)
    },
  )

  it.each([
    ['en-US', '1,2'],
    ['en-US', '1,,234'],
    ['en-US', '1.2,34'],
    ['de-DE', '1.23,45'],
    ['fr-FR', '1 23,45'],
  ])('rejects malformed grouping in a quantity for %s: %s', (locale, text) => {
    expect(parseForUnit(text, 'energy', s({ locale }))).toBeNull()
  })

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

  describe('distance (canonical = meters)', () => {
    it('converts preferred miles to meters', () => {
      expect(parseForUnit('60', 'distance', s({ unit_of_length: 'mi' }))).toBe(96560.64)
    })

    it('converts kilometers to meters', () => {
      const v = parseForUnit('100', 'distance', s({ unit_of_length: 'km' }))
      expect(v).not.toBeNull()
      expect(v).toBe(100000)
    })

    it('strips trailing "km" suffix before parsing', () => {
      const v = parseForUnit('100 km', 'distance', s({ unit_of_length: 'km' }))
      expect(v).toBe(100000)
    })

    it('strips trailing "mi" suffix before parsing', () => {
      expect(parseForUnit('25 mi', 'distance', s({ unit_of_length: 'mi' }))).toBe(40233.6)
    })
  })

  describe('speed (canonical = m/s)', () => {
    it('strips "km/h" suffix and converts to m/s', () => {
      const v = parseForUnit('100 km/h', 'speed', s({ unit_of_length: 'km' }))
      expect(v).toBeCloseTo(27.77777778, 7)
    })

    it('converts preferred mph to m/s', () => {
      expect(parseForUnit('70 mph', 'speed', s({ unit_of_length: 'mi' }))).toBeCloseTo(31.2928, 7)
    })

    it('km/h is stripped before km when both could match', () => {
      const v = parseForUnit('80 km/h', 'speed', s({ unit_of_length: 'km' }))
      expect(v).toBeCloseTo(22.22222222, 7)
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

  describe('energy, percent and currency', () => {
    it('converts preferred kWh to canonical Wh', () => {
      expect(parseForUnit('75', 'energy', s())).toBe(75000)
      expect(parseForUnit('75 kWh', 'energy', s())).toBe(75000)
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
      expect(parseForUnit('1,234.56', 'energy', s({ locale: 'en-US' }))).toBeCloseTo(1234560)
    })

    it('de-DE accepts "1.234,56" as 1234.56', () => {
      expect(parseForUnit('1.234,56', 'energy', s({ locale: 'de-DE' }))).toBeCloseTo(1234560)
    })

    it('de-DE accepts "0,5" as 0.5', () => {
      expect(parseForUnit('0,5', 'energy', s({ locale: 'de-DE' }))).toBeCloseTo(500)
    })

    it('strict mode bypasses locale normalisation', () => {
      // In de-DE non-strict, "0,5" → 0.5. With strict it goes through Number()
      // → NaN. Returning null is the documented contract.
      expect(parseForUnit('0,5', 'energy', s({ locale: 'de-DE' }), { strict: true })).toBeNull()
      expect(parseForUnit('0.5', 'energy', s({ locale: 'de-DE' }), { strict: true })).toBe(500)
    })
  })

  it('handles negative values', () => {
    expect(parseForUnit('-5', 'temperature', s({ unit_of_temp: 'C' }))).toBe(-5)
    expect(parseForUnit('-3.14', 'energy', s())).toBeCloseTo(-3140)
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
    expect(formatForUnit(96560.64, 'distance', s({ unit_of_length: 'mi', decimal_precision: 0 }))).toBe('60')
    expect(formatForUnit(20, 'temperature', s({ unit_of_temp: 'C', decimal_precision: 0 }))).toBe('20')
  })

  it('converts canonical → display for distance/speed/temperature', () => {
    expect(formatForUnit(96560.64, 'distance', s({ unit_of_length: 'km', decimal_precision: 2 }))).toBe('96.56')
    expect(formatForUnit(26.8224, 'speed', s({ unit_of_length: 'km', decimal_precision: 0 }))).toBe('97')
    expect(formatForUnit(0, 'temperature', s({ unit_of_temp: 'F', decimal_precision: 0 }))).toBe('32')
    expect(formatForUnit(100, 'temperature', s({ unit_of_temp: 'F', decimal_precision: 0 }))).toBe('212')
  })

  it('converts Wh to kWh and preserves percent and currency magnitudes', () => {
    expect(formatForUnit(75500, 'energy', s({ decimal_precision: 1 }))).toBe('75.5')
    expect(formatForUnit(80, 'percent', s({ decimal_precision: 0 }))).toBe('80')
    expect(formatForUnit(1.23, 'currency', s({ decimal_precision: 2 }))).toBe('1.23')
  })

  it('respects locale decimal separator (de-DE uses comma)', () => {
    expect(formatForUnit(1500, 'energy', s({ locale: 'de-DE', decimal_precision: 1 }))).toBe('1,5')
  })

  it('does NOT add thousands separators (false useGrouping for input fields)', () => {
    expect(formatForUnit(1234500, 'energy', s({ locale: 'en-US', decimal_precision: 1 }))).toBe('1234.5')
    expect(formatForUnit(1234500, 'energy', s({ locale: 'de-DE', decimal_precision: 1 }))).toBe('1234,5')
  })

  it('caps fraction digits to settings.decimal_precision', () => {
    expect(formatForUnit(3141.59, 'energy', s({ decimal_precision: 2 }))).toBe('3.14')
    expect(formatForUnit(3141.59, 'energy', s({ decimal_precision: 0 }))).toBe('3')
  })

  it('does NOT throw when settings.locale is empty / whitespace (regression: SmartCharge crash)', () => {
    // The settings API can return locale: '' when the column is unset.
    // `??` does not catch empty strings, so prior to the fix this would
    // call `new Intl.NumberFormat('')` and throw `RangeError: Invalid
    // language tag: `, blowing up the SmartCharge page on mount.
    expect(() => formatForUnit(75, 'energy', s({ locale: '', decimal_precision: 1 }))).not.toThrow()
    expect(formatForUnit(75000, 'energy', s({ locale: '', decimal_precision: 1 }))).toBe('75.0')
    expect(() => formatForUnit(75, 'energy', s({ locale: '   ', decimal_precision: 1 }))).not.toThrow()
    expect(formatForUnit(75000, 'energy', s({ locale: '   ', decimal_precision: 1 }))).toBe('75.0')
  })

  it('parseForUnit also tolerates empty / whitespace locale', () => {
    expect(() => parseForUnit('1234.5', 'energy', s({ locale: '' }))).not.toThrow()
    expect(parseForUnit('1234.5', 'energy', s({ locale: '' }))).toBe(1234500)
  })

  it('round-trips parse → format for canonical-equivalent values', () => {
    const settings = s({ unit_of_length: 'km', decimal_precision: 2 })
    const parsed = parseForUnit('100', 'speed', settings)
    expect(parsed).not.toBeNull()
    // Format should re-display ~100 km/h
    const display = formatForUnit(parsed, 'speed', settings)
    expect(display).toBe('100.00')
  })
})

describe('unitSymbol', () => {
  it('converts pressure using selected units, locale and precision', () => {
    expect(parseForUnit('3.5 bar', 'pressure', s())).toBe(350)
    expect(formatForUnit(350, 'pressure', s())).toBe('3.50')
    expect(unitSymbol('pressure', s())).toBe('bar')
    const preferences = s({ unit_of_pressure: 'psi', locale: 'de-DE', decimal_precision: 3 })
    expect(parseForUnit('35,0 psi', 'pressure', preferences)).toBeCloseTo(241.316495, 7)
    expect(formatForUnit(241.316495, 'pressure', preferences)).toBe('35,000')
    expect(unitSymbol('pressure', preferences)).toBe('psi')
  })

  it('rejects conflicting or unrelated unit suffixes instead of reinterpreting the threshold', () => {
    expect(parseForUnit('100 km', 'distance', s({ unit_of_length: 'mi' }))).toBeNull()
    expect(parseForUnit('60 mph', 'temperature', s())).toBeNull()
    expect(parseForUnit('35 psi', 'pressure', s())).toBeNull()
  })

  it('handles dimensionless measurements without inventing a unit label', () => {
    expect(parseForUnit('1,25', 'number', s({ locale: 'de-DE' }))).toBe(1.25)
    expect(formatForUnit(1.25, 'number', s({ locale: 'de-DE', decimal_precision: 3 }))).toBe('1,250')
    expect(unitSymbol('number', s())).toBe('')
  })
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
