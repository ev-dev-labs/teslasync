import { describe, it, expect, beforeEach } from 'vitest'

import {
  setGlobalPrecision,
  getGlobalPrecision,
  setGlobalLocale,
  getGlobalLocale,
  safeNumber,
  isFiniteNumber,
  fmtNumber,
  fmtScientificNumber,
  fmtWithUnit,
  fmtPercent,
  fmtInt,
  fmtCompact,
  formatBytes,
  getFormatterPreferences,
  currencyDecimals,
  _resetFormatterPreferences,
} from './numberFormat'

// The module keeps precision + locale as mutable module-level state that
// useSettings mutates at runtime. Reset both to their defaults before every
// test so cases stay order-independent and isolated.
beforeEach(() => {
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
})

describe('numberFormat — global precision', () => {
  it('round-trips a valid precision through the setter/getter', () => {
    setGlobalPrecision(3)
    expect(getGlobalPrecision()).toBe(3)
    setGlobalPrecision(0)
    expect(getGlobalPrecision()).toBe(0)
  })

  it('clamps the precision into the [0, 20] range', () => {
    setGlobalPrecision(50)
    expect(getGlobalPrecision()).toBe(20)
    setGlobalPrecision(-5)
    expect(getGlobalPrecision()).toBe(0)
  })

  it('drives the default decimal count used by fmtNumber', () => {
    setGlobalPrecision(4)
    expect(fmtNumber(5)).toBe('5.0000')
    setGlobalPrecision(0)
    expect(fmtNumber(5)).toBe('5')
  })

  it('ignores NaN so the shared precision can never be corrupted (regression)', () => {
    setGlobalPrecision(4)
    setGlobalPrecision(NaN)
    expect(getGlobalPrecision()).toBe(4)
    // Corrupted precision used to make every formatter throw a RangeError.
    expect(() => fmtNumber(5)).not.toThrow()
    expect(fmtNumber(5)).toBe('5.0000')
  })

  it('ignores ±Infinity, keeping the previous precision', () => {
    setGlobalPrecision(3)
    setGlobalPrecision(Infinity)
    expect(getGlobalPrecision()).toBe(3)
    setGlobalPrecision(-Infinity)
    expect(getGlobalPrecision()).toBe(3)
  })
})

describe('numberFormat — global locale', () => {
  it('round-trips a valid BCP-47 tag', () => {
    setGlobalLocale('de-DE')
    expect(getGlobalLocale()).toBe('de-DE')
  })

  it('falls back to en-US for empty or whitespace-only input', () => {
    setGlobalLocale('')
    expect(getGlobalLocale()).toBe('en-US')
    setGlobalLocale('   ')
    expect(getGlobalLocale()).toBe('en-US')
  })

  it('is applied by fmtNumber for grouping + decimal separators', () => {
    setGlobalLocale('de-DE')
    // de-DE groups with '.' and uses ',' as the decimal separator.
    expect(fmtNumber(1234.5).replace(/\s/g, ' ')).toBe('1.234,50')
  })
})

describe('numberFormat — test reset hook', () => {
  it('restores en-US + precision 2 so a French-locale case cannot leak into later tests', () => {
    setGlobalLocale('fr-FR')
    setGlobalPrecision(4)
    expect(fmtNumber(1234.5).replace(/[\s\u202f]/g, ' ')).toBe('1 234,5000')
    _resetFormatterPreferences()
    expect(getGlobalLocale()).toBe('en-US')
    expect(getGlobalPrecision()).toBe(2)
    expect(getFormatterPreferences()).toEqual({ precision: 2, locale: 'en-US' })
    expect(fmtNumber(1234.5)).toBe('1,234.50')
  })
})

describe('numberFormat — safeNumber', () => {
  it('passes finite numbers through unchanged', () => {
    expect(safeNumber(42)).toBe(42)
    expect(safeNumber(-3.14)).toBe(-3.14)
    expect(safeNumber(0)).toBe(0)
  })

  it('coerces non-finite numbers to 0', () => {
    expect(safeNumber(NaN)).toBe(0)
    expect(safeNumber(Infinity)).toBe(0)
    expect(safeNumber(-Infinity)).toBe(0)
  })

  it('coerces nullish and non-number values to 0', () => {
    expect(safeNumber(null)).toBe(0)
    expect(safeNumber(undefined)).toBe(0)
    expect(safeNumber('42')).toBe(0)
    expect(safeNumber({})).toBe(0)
    expect(safeNumber([])).toBe(0)
    expect(safeNumber(true)).toBe(0)
  })
})

describe('numberFormat — isFiniteNumber', () => {
  it('returns true only for finite numbers', () => {
    expect(isFiniteNumber(42)).toBe(true)
    expect(isFiniteNumber(0)).toBe(true)
    expect(isFiniteNumber(-3.14)).toBe(true)
  })

  it('returns false for non-finite numbers and non-numbers', () => {
    expect(isFiniteNumber(NaN)).toBe(false)
    expect(isFiniteNumber(Infinity)).toBe(false)
    expect(isFiniteNumber(-Infinity)).toBe(false)
    expect(isFiniteNumber(null)).toBe(false)
    expect(isFiniteNumber(undefined)).toBe(false)
    expect(isFiniteNumber('42')).toBe(false)
  })

  it('narrows the static type so numeric methods are callable', () => {
    const v: unknown = 3.14159
    if (isFiniteNumber(v)) {
      // If the predicate did not narrow to `number`, this line would not compile.
      expect(v.toFixed(2)).toBe('3.14')
    } else {
      throw new Error('expected isFiniteNumber to narrow a finite number')
    }
  })
})

describe('numberFormat — fmtNumber', () => {
  it('formats with locale grouping at the global precision', () => {
    expect(fmtNumber(1234.567)).toBe('1,234.57')
    expect(fmtNumber(1000)).toBe('1,000.00')
    expect(fmtNumber(0)).toBe('0.00')
  })

  it('honours a per-call decimal override', () => {
    expect(fmtNumber(1234.4, 0)).toBe('1,234')
    expect(fmtNumber(0.5, 4)).toBe('0.5000')
    expect(fmtNumber(-1234.5, 1)).toBe('-1,234.5')
  })

  it('honours a per-call locale override', () => {
    expect(fmtNumber(1234.5, 2, 'de-DE').replace(/\s/g, ' ')).toBe('1.234,50')
  })

  it('treats non-numeric / nullish input as 0', () => {
    expect(fmtNumber(null)).toBe('0.00')
    expect(fmtNumber(undefined)).toBe('0.00')
    expect(fmtNumber(NaN)).toBe('0.00')
    expect(fmtNumber('not a number')).toBe('0.00')
  })

  it('falls back to en-US formatting for an invalid locale tag', () => {
    // 'xx_BAD_TAG!!' makes Intl throw; the helper must recover, not crash.
    expect(() => fmtNumber(1234.5, 2, 'xx_BAD_TAG!!')).not.toThrow()
    expect(fmtNumber(1234.5, 2, 'xx_BAD_TAG!!')).toBe('1,234.50')
  })

  it('never throws on a non-finite per-call precision, falling back to the global precision (regression)', () => {
    setGlobalPrecision(2)
    expect(() => fmtNumber(5, NaN)).not.toThrow()
    expect(fmtNumber(5, NaN)).toBe('5.00')
    expect(fmtNumber(5, Infinity)).toBe('5.00')
  })

  it('clamps an out-of-range precision instead of throwing (regression)', () => {
    expect(() => fmtNumber(5, 150)).not.toThrow()
    // Clamped to Intl's max of 20 fraction digits.
    expect(fmtNumber(5, 150).split('.')[1]).toHaveLength(20)
    // Negative precision clamps to 0 rather than throwing.
    expect(fmtNumber(5.4, -3)).toBe('5')
  })
})

describe('numberFormat — fmtScientificNumber', () => {
  it.each([1e-12, -1e-12, 1e-100, -1e-100])(
    'keeps nonzero deadband thresholds %s distinct from measured zero',
    value => {
      expect(fmtScientificNumber(value, 4)).not.toBe(fmtScientificNumber(0, 4));
      expect(fmtScientificNumber(value, 4)).not.toBe('—');
      setGlobalPrecision(6);
      expect(fmtScientificNumber(value, 4)).toContain('000000E');
    },
  );

  it.each([null, undefined, NaN, Infinity, -Infinity, '0', '', false, {}, []])(
    'keeps missing or invalid input %j distinct from measured zero',
    value => {
      expect(fmtScientificNumber(value, 3)).toBe('—')
    },
  )

  it('retains fixed formatting for measured zero and valid signed values', () => {
    expect(fmtScientificNumber(0, 3)).toBe('0.000')
    expect(fmtScientificNumber(-0, 3)).toBe('-0.000')
    expect(fmtScientificNumber(1234.5678, 3)).toBe('1,234.568')
    expect(fmtScientificNumber(-1234.5678, 3)).toBe('-1,234.568')
    expect(fmtScientificNumber(0.1256, 3)).toBe('0.126')
    expect(fmtScientificNumber(-0.1256, 3)).toBe('-0.126')
  })

  it('uses scientific notation for signed fractions that would round to zero', () => {
    expect(fmtScientificNumber(0.000012345, 3)).toBe('1.235E-5')
    expect(fmtScientificNumber(-0.000012345, 3)).toBe('-1.235E-5')
    expect(fmtScientificNumber(Number.MIN_VALUE, 3)).toBe('5.000E-324')
    expect(fmtScientificNumber(-Number.MIN_VALUE, 3)).toBe('-5.000E-324')
  })

  it('switches only below the locale formatter rounding boundary', () => {
    expect(fmtScientificNumber(0.0005, 3)).toBe('0.001')
    expect(fmtScientificNumber(-0.0005, 3)).toBe('-0.001')
    expect(fmtScientificNumber(0.0004999, 3)).toBe('4.999E-4')
    expect(fmtScientificNumber(-0.0004999, 3)).toBe('-4.999E-4')
  })

  it('honours global precision in fixed and scientific notation', () => {
    setGlobalPrecision(5)
    expect(fmtScientificNumber(0.000012345, 3)).toBe('0.00001')
    expect(fmtScientificNumber(0.0000001234567, 3)).toBe('1.23457E-7')
    setGlobalPrecision(0)
    expect(fmtScientificNumber(0.125, 0)).toBe('1E-1')
    expect(fmtScientificNumber(0, 0)).toBe('0')
  })

  it('uses the selected locale and honours a per-call locale override', () => {
    setGlobalLocale('de-DE')
    expect(fmtScientificNumber(1234.5, 3)).toBe('1.234,500')
    expect(fmtScientificNumber(-0.000012345, 3)).toBe('-1,235E-5')
    expect(fmtScientificNumber(0.000012345, 3, 'en-US')).toBe('1.235E-5')
  })

  it('falls back to en-US for invalid global and per-call locales', () => {
    setGlobalLocale('xx_BAD_TAG!!')
    expect(fmtScientificNumber(0.000012345, 3)).toBe('1.235E-5')
    expect(fmtScientificNumber(-0.000012345, 3, 'xx_BAD_TAG!!')).toBe('-1.235E-5')
  })

  it('clamps diagnostic precision and handles non-finite requests', () => {
    expect(fmtScientificNumber(0.000012345, NaN)).toBe('1.23E-5')
    expect(fmtScientificNumber(0.000012345, Infinity)).toBe('1.23E-5')
    expect(fmtScientificNumber(0.000012345, -Infinity)).toBe('1.23E-5')
    expect(fmtScientificNumber(0.000012345, -5)).toBe('1.23E-5')
    expect(fmtScientificNumber(1e-30, 150)).toBe('1.00000000000000000000E-30')
  })
})

describe('numberFormat — fmtWithUnit', () => {
  it('appends the unit after a formatted number', () => {
    expect(fmtWithUnit(42.567, 'kWh')).toBe('42.57 kWh')
    expect(fmtWithUnit(1234.5, 'km', 1)).toBe('1,234.5 km')
  })

  it('honours the decimal override and null-safety', () => {
    expect(fmtWithUnit(42.567, 'kWh', 0)).toBe('43 kWh')
    expect(fmtWithUnit(null, 'mi')).toBe('0.00 mi')
  })
})

describe('numberFormat — fmtPercent', () => {
  it('appends a percent sign to the formatted number', () => {
    expect(fmtPercent(85.432)).toBe('85.43%')
    expect(fmtPercent(100, 0)).toBe('100%')
  })

  it('handles negatives and nullish input', () => {
    expect(fmtPercent(-5.5, 1)).toBe('-5.5%')
    expect(fmtPercent(null)).toBe('0.00%')
  })
})

describe('numberFormat — fmtInt', () => {
  it('rounds to a whole number with locale grouping', () => {
    expect(fmtInt(12345.6)).toBe('12,346')
    expect(fmtInt(1000)).toBe('1,000')
    expect(fmtInt(999)).toBe('999')
  })

  it('handles zero, negatives, and non-numeric input', () => {
    expect(fmtInt(0)).toBe('0')
    expect(fmtInt(-5)).toBe('-5')
    expect(fmtInt('abc')).toBe('0')
  })
})

describe('numberFormat — fmtCompact', () => {
  it('returns small numbers verbatim below the threshold', () => {
    expect(fmtCompact(9999)).toBe('9,999')
    expect(fmtCompact(4)).toBe('4')
    expect(fmtCompact(0)).toBe('0')
  })

  it('compacts large magnitudes into K / M / B suffixes', () => {
    expect(fmtCompact(12345)).toBe('12.3K')
    expect(fmtCompact(1234567)).toBe('1.2M')
    expect(fmtCompact(1200000000)).toBe('1.2B')
  })

  it('preserves the sign for negative magnitudes', () => {
    expect(fmtCompact(-5000000)).toBe('-5M')
  })

  it('respects a custom threshold', () => {
    expect(fmtCompact(5000, 1000)).toBe('5K')
    expect(fmtCompact(500, 1000)).toBe('500')
  })

  it('treats nullish / non-numeric input as 0', () => {
    expect(fmtCompact(null)).toBe('0')
    expect(fmtCompact('abc')).toBe('0')
  })
})

describe('numberFormat — formatBytes', () => {
  it('formats bytes into binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.00 KB')
    expect(formatBytes(1536)).toBe('1.50 KB')
    expect(formatBytes(1048576)).toBe('1.00 MB')
    expect(formatBytes(1073741824)).toBe('1.00 GB')
    expect(formatBytes(5 * 1073741824)).toBe('5.00 GB')
  })

  it('uses selected precision and locale for scaled units without changing byte counts', () => {
    setGlobalPrecision(3)
    setGlobalLocale('de-DE')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1,500 KB')
    expect(formatBytes(1572864)).toBe('1,500 MB')
    expect(formatBytes(1610612736)).toBe('1,500 GB')
  })

  it('returns the empty placeholder for null / undefined / non-finite input', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(NaN)).toBe('—')
    expect(formatBytes(Infinity)).toBe('—')
  })

  it('honours the zeroAsEmpty and custom empty options', () => {
    expect(formatBytes(0, { zeroAsEmpty: true })).toBe('—')
    expect(formatBytes(null, { empty: 'N/A' })).toBe('N/A')
    expect(formatBytes(0, { zeroAsEmpty: true, empty: 'none' })).toBe('none')
  })

  it('honours the gbDecimals option', () => {
    expect(formatBytes(1073741824, { gbDecimals: 2 })).toBe('1.00 GB')
    expect(formatBytes(2 * 1073741824, { gbDecimals: 0 })).toBe('2 GB')
  })
})

describe('numberFormat - currencyDecimals', () => {
  it('floors sub-unit amounts at 2 decimals regardless of the requested precision', () => {
    expect(currencyDecimals(0.14, 1)).toBe(2)
    expect(currencyDecimals(0.04, 0)).toBe(2)
    expect(currencyDecimals(-0.5, 1)).toBe(2)
    expect(currencyDecimals(0, 1)).toBe(2)
  })

  it('keeps the requested precision for amounts of 1 unit or more', () => {
    expect(currencyDecimals(12.5, 1)).toBe(1)
    expect(currencyDecimals(1, 0)).toBe(0)
    expect(currencyDecimals(-5, 1)).toBe(1)
    expect(currencyDecimals(0.14, 3)).toBe(3)
  })

  it('passes non-finite inputs through to the caller fallback path', () => {
    expect(currencyDecimals(Number.NaN, 1)).toBe(1)
    expect(currencyDecimals(null, 1)).toBe(1)
    expect(currencyDecimals(undefined, 1)).toBe(1)
  })
})
