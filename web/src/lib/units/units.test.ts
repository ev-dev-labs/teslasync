import { describe, expect, it } from 'vitest'
import {
  DistanceUnit,
  PressureUnit,
  TemperatureUnit,
  metersToMiles,
  metersToKm,
  mpsToMph,
  mpsToKmh,
  pascalsToPsi,
  pascalsToBar,
  toDisplayDistanceFromMeters,
  toDisplaySpeedFromMps,
  toDisplayPressureFromPascals,
  toDisplayTemperatureFromCelsius,
  METERS_PER_MILE,
  METERS_PER_KM,
  PASCALS_PER_PSI,
  PASCALS_PER_BAR,
} from './index'

// All assertions use `toBeCloseTo` so floating-point drift does not turn
// into a flake; the SI conversion factors are exact rationals but JS
// arithmetic still introduces ULP-level noise.

describe('SI distance helpers', () => {
  it('round-trips meters → miles using the international yard factor', () => {
    expect(metersToMiles(METERS_PER_MILE)).toBeCloseTo(1, 6)
    expect(metersToMiles(0)).toBe(0)
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 6)
  })

  it('round-trips meters → kilometers exactly', () => {
    expect(metersToKm(1000)).toBe(1)
    expect(metersToKm(METERS_PER_KM * 5)).toBe(5)
  })

  it('selects miles when the user prefers DistanceUnit.Miles', () => {
    expect(toDisplayDistanceFromMeters(1609.344, DistanceUnit.Miles, 3)).toBeCloseTo(1, 3)
  })

  it('selects km when the user prefers DistanceUnit.Kilometers', () => {
    expect(toDisplayDistanceFromMeters(1000, DistanceUnit.Kilometers, 3)).toBeCloseTo(1, 3)
  })
})

describe('SI speed helpers', () => {
  it('converts m/s → mph at the canonical rate (1 m/s ≈ 2.236936 mph)', () => {
    expect(mpsToMph(1)).toBeCloseTo(2.236936, 5)
    expect(mpsToMph(0)).toBe(0)
  })

  it('converts m/s → km/h exactly (× 3.6)', () => {
    expect(mpsToKmh(1)).toBeCloseTo(3.6, 6)
    expect(mpsToKmh(10)).toBeCloseTo(36, 6)
  })

  it('rounds via the configured precision', () => {
    expect(toDisplaySpeedFromMps(27.7, DistanceUnit.Miles, 0)).toBe(62)
    expect(toDisplaySpeedFromMps(27.7, DistanceUnit.Kilometers, 1)).toBeCloseTo(99.7, 1)
  })
})

describe('SI pressure helpers', () => {
  it('converts Pascals → PSI using the NIST factor', () => {
    expect(pascalsToPsi(PASCALS_PER_PSI)).toBeCloseTo(1, 6)
    expect(pascalsToPsi(0)).toBe(0)
  })

  it('converts Pascals → bar exactly (× 1e-5)', () => {
    expect(pascalsToBar(PASCALS_PER_BAR)).toBe(1)
    expect(pascalsToBar(250_000)).toBe(2.5)
  })

  it('routes via the user preference enum', () => {
    expect(toDisplayPressureFromPascals(220_000, PressureUnit.Bar, 2)).toBeCloseTo(2.2, 2)
    expect(toDisplayPressureFromPascals(220_000, PressureUnit.PSI, 1)).toBeCloseTo(31.9, 1)
  })
})

describe('SI temperature helpers', () => {
  it('passes Celsius through unchanged when the user prefers °C', () => {
    expect(toDisplayTemperatureFromCelsius(22.5, TemperatureUnit.Celsius, 1)).toBeCloseTo(22.5, 1)
  })

  it('converts to Fahrenheit when the user prefers °F', () => {
    expect(toDisplayTemperatureFromCelsius(0, TemperatureUnit.Fahrenheit, 1)).toBeCloseTo(32, 1)
    expect(toDisplayTemperatureFromCelsius(100, TemperatureUnit.Fahrenheit, 1)).toBeCloseTo(212, 1)
  })
})
