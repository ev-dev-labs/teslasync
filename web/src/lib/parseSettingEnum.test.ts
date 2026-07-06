import { describe, it, expect } from 'vitest'
import {
  parseSettingEnum,
  isSettingMiles,
  isSettingFahrenheit,
  isSettingPSI,
  isSettingBar,
} from './parseSettingEnum'

// ---------------------------------------------------------------------------
// parseSettingEnum.ts hardening + bug pins
//
// These setting fields (setting_distance_unit, setting_temperature_unit, ...)
// come from the same raw signal.SignalValue (`interface{}`) serialization path
// as safetyEnum / parseEnums, so a nominally "string" field can arrive as a
// bool/number at runtime. The helpers must narrow defensively and never crash.
//
// Regression pins:
//   * isSettingMiles / isSettingFahrenheit must accept the codec-stripped short
//     forms ("mi" / "f") — the enumMappings table lists them, and GeneralSettings
//     drives unit sync off these booleans. Missing them mis-synced the app to
//     km / Celsius when the car reported the abbreviation.
//   * No helper may throw on a non-string runtime value.
// ---------------------------------------------------------------------------

describe('parseSettingEnum', () => {
  it('maps the full Tesla distance enum to a clean label', () => {
    expect(parseSettingEnum('DistanceUnitMiles', 'distance')).toBe('Miles')
    expect(parseSettingEnum('DistanceUnitKilometers', 'distance')).toBe('Kilometers')
  })

  it('maps distance short forms and alternate spellings', () => {
    expect(parseSettingEnum('mi', 'distance')).toBe('Miles')
    expect(parseSettingEnum('km', 'distance')).toBe('Kilometers')
    expect(parseSettingEnum('DistanceUnitKm', 'distance')).toBe('Kilometers')
  })

  it('maps the temperature enum for both units', () => {
    expect(parseSettingEnum('TemperatureUnitCelsius', 'temperature')).toBe('Celsius')
    expect(parseSettingEnum('TemperatureUnitFahrenheit', 'temperature')).toBe('Fahrenheit')
    expect(parseSettingEnum('c', 'temperature')).toBe('Celsius')
    expect(parseSettingEnum('f', 'temperature')).toBe('Fahrenheit')
  })

  it('maps the charge enum including percent', () => {
    expect(parseSettingEnum('ChargeUnitPercent', 'charge')).toBe('Percent')
    expect(parseSettingEnum('ChargeUnitMiles', 'charge')).toBe('Miles')
    expect(parseSettingEnum('percent', 'charge')).toBe('Percent')
  })

  it('maps the pressure enum with canonical casing (PSI/Bar/kPa)', () => {
    expect(parseSettingEnum('PressureUnitPsi', 'pressure')).toBe('PSI')
    expect(parseSettingEnum('PressureUnitBar', 'pressure')).toBe('Bar')
    expect(parseSettingEnum('PressureUnitKpa', 'pressure')).toBe('kPa')
  })

  it('is case-insensitive and ignores separators/punctuation', () => {
    expect(parseSettingEnum('distance_unit_miles', 'distance')).toBe('Miles')
    expect(parseSettingEnum('DISTANCE-UNIT-MILES', 'distance')).toBe('Miles')
    expect(parseSettingEnum('  PressureUnitPsi  ', 'pressure')).toBe('PSI')
  })

  it('returns an em-dash for nullish or empty input', () => {
    expect(parseSettingEnum(null, 'distance')).toBe('—')
    expect(parseSettingEnum(undefined, 'temperature')).toBe('—')
    expect(parseSettingEnum('', 'pressure')).toBe('—')
  })

  it('does not throw and returns em-dash for non-string runtime values', () => {
    expect(() => parseSettingEnum(42 as unknown as string, 'distance')).not.toThrow()
    expect(parseSettingEnum(42 as unknown as string, 'distance')).toBe('—')
    expect(parseSettingEnum(true as unknown as string, 'charge')).toBe('—')
    expect(parseSettingEnum({} as unknown as string, 'pressure')).toBe('—')
  })

  it('falls back to the original string for an unknown value in a known category', () => {
    expect(parseSettingEnum('DistanceUnitFurlongs', 'distance')).toBe('DistanceUnitFurlongs')
  })

  it('falls back to the original string when the category has no match', () => {
    // "miles" is a valid distance key but NOT a charge key.
    expect(parseSettingEnum('Miles', 'charge')).toBe('Miles')
  })
})

describe('isSettingMiles', () => {
  it('detects the full Tesla distance + charge enums', () => {
    expect(isSettingMiles('DistanceUnitMiles')).toBe(true)
    expect(isSettingMiles('ChargeUnitMiles')).toBe(true)
    expect(isSettingMiles('Miles')).toBe(true)
  })

  it('detects the codec-stripped "mi" abbreviation (regression pin)', () => {
    expect(isSettingMiles('mi')).toBe(true)
    expect(isSettingMiles('MI')).toBe(true)
  })

  it('returns false for metric / non-miles units', () => {
    expect(isSettingMiles('DistanceUnitKilometers')).toBe(false)
    expect(isSettingMiles('km')).toBe(false)
  })

  it('does not false-positive on unrelated words that merely start with "mi"', () => {
    expect(isSettingMiles('minutes')).toBe(false)
  })

  it('is safe for nullish and non-string input', () => {
    expect(isSettingMiles(null)).toBe(false)
    expect(isSettingMiles(undefined)).toBe(false)
    expect(isSettingMiles('')).toBe(false)
    expect(() => isSettingMiles(1 as unknown as string)).not.toThrow()
    expect(isSettingMiles(1 as unknown as string)).toBe(false)
  })
})

describe('isSettingFahrenheit', () => {
  it('detects the full Fahrenheit enum and word', () => {
    expect(isSettingFahrenheit('TemperatureUnitFahrenheit')).toBe(true)
    expect(isSettingFahrenheit('Fahrenheit')).toBe(true)
  })

  it('detects the "f" abbreviation (regression pin)', () => {
    expect(isSettingFahrenheit('f')).toBe(true)
    expect(isSettingFahrenheit('F')).toBe(true)
  })

  it('returns false for Celsius', () => {
    expect(isSettingFahrenheit('TemperatureUnitCelsius')).toBe(false)
    expect(isSettingFahrenheit('celsius')).toBe(false)
    expect(isSettingFahrenheit('c')).toBe(false)
  })

  it('is safe for nullish and non-string input', () => {
    expect(isSettingFahrenheit(null)).toBe(false)
    expect(isSettingFahrenheit(undefined)).toBe(false)
    expect(() => isSettingFahrenheit(false as unknown as string)).not.toThrow()
    expect(isSettingFahrenheit(false as unknown as string)).toBe(false)
  })
})

describe('isSettingPSI', () => {
  it('detects the full PSI enum and abbreviation, ignoring case', () => {
    expect(isSettingPSI('PressureUnitPsi')).toBe(true)
    expect(isSettingPSI('psi')).toBe(true)
    expect(isSettingPSI('PSI')).toBe(true)
  })

  it('returns false for Bar / kPa', () => {
    expect(isSettingPSI('PressureUnitBar')).toBe(false)
    expect(isSettingPSI('bar')).toBe(false)
    expect(isSettingPSI('kPa')).toBe(false)
  })

  it('is safe for nullish and non-string input', () => {
    expect(isSettingPSI(null)).toBe(false)
    expect(isSettingPSI('')).toBe(false)
    expect(() => isSettingPSI(0 as unknown as string)).not.toThrow()
    expect(isSettingPSI(0 as unknown as string)).toBe(false)
  })
})

describe('isSettingBar', () => {
  it('detects the full Bar enum and abbreviation, ignoring case', () => {
    expect(isSettingBar('PressureUnitBar')).toBe(true)
    expect(isSettingBar('bar')).toBe(true)
    expect(isSettingBar('BAR')).toBe(true)
  })

  it('returns false for PSI / kPa', () => {
    expect(isSettingBar('PressureUnitPsi')).toBe(false)
    expect(isSettingBar('psi')).toBe(false)
    expect(isSettingBar('kPa')).toBe(false)
  })

  it('is safe for nullish and non-string input', () => {
    expect(isSettingBar(null)).toBe(false)
    expect(isSettingBar(undefined)).toBe(false)
    expect(() => isSettingBar(3.5 as unknown as string)).not.toThrow()
    expect(isSettingBar(3.5 as unknown as string)).toBe(false)
  })
})

describe('PSI vs Bar are mutually exclusive for a given input', () => {
  it('classifies each pressure unit into exactly one detector', () => {
    expect(isSettingPSI('PressureUnitPsi') && isSettingBar('PressureUnitPsi')).toBe(false)
    expect(isSettingPSI('PressureUnitBar') && isSettingBar('PressureUnitBar')).toBe(false)
    // kPa is neither (AppSettings only supports psi/bar).
    expect(isSettingPSI('PressureUnitKpa')).toBe(false)
    expect(isSettingBar('PressureUnitKpa')).toBe(false)
  })
})
