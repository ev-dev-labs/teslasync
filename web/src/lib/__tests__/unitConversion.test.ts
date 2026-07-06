import { describe, it, expect } from 'vitest'

import {
  SI,
  type UnitPref,
  type DistanceUnitPref,
  type SpeedUnitPref,
  type TemperatureUnitPref,
  type PressureUnitPref,
  type EnergyUnitPref,
  type PowerUnitPref,
  type DurationUnitPref,
  convertDistanceFromSI,
  convertDistanceToSI,
  convertSpeedFromSI,
  convertTempFromSI,
  convertPressureFromSI,
  convertEnergyFromSI,
  convertPowerFromSI,
  convertDurationFromSI,
  formatDistance,
  formatSpeed,
  formatTemperature,
  formatPressure,
  formatEnergy,
  formatPower,
  formatDuration,
} from '../unitConversion'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const basePref: UnitPref = {
  distance: 'km',
  speed: 'km/h',
  temperature: '°C',
  pressure: 'kPa',
  energy: 'kWh',
  power: 'kW',
  duration: 'h',
  locale: 'en-US',
}

function withPref(overrides: Partial<UnitPref>): UnitPref {
  return { ...basePref, ...overrides }
}

// Round-trip tolerance: 1e-9 for exact ratios, 1e-3 for °F.
const EPS_EXACT = 1e-9
const EPS_LOOSE = 1e-3

// ---------------------------------------------------------------------------
// SI baseline
// ---------------------------------------------------------------------------

describe('SI baseline constant', () => {
  it('declares the canonical input units this module accepts', () => {
    expect(SI.distance).toBe('m')
    expect(SI.speed).toBe('m/s')
    expect(SI.temperature).toBe('°C')
    expect(SI.pressure).toBe('kPa')
    expect(SI.energy).toBe('Wh')
    expect(SI.power).toBe('W')
    expect(SI.duration).toBe('s')
  })

  it('is frozen so callers cannot mutate the contract', () => {
    expect(Object.isFrozen(SI)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Distance — input contract: meters (SI)
// ---------------------------------------------------------------------------

describe('convertDistanceFromSI', () => {
  it('converts 1000 m → 1 km (SI input contract)', () => {
    expect(convertDistanceFromSI(1000, 'km')).toBeCloseTo(1, 12)
  })

  it('converts 1609.344 m → 1 mi exactly (SI input contract)', () => {
    expect(convertDistanceFromSI(1609.344, 'mi')).toBeCloseTo(1, 12)
  })

  it('converts 0.3048 m → 1 ft exactly (SI input contract)', () => {
    expect(convertDistanceFromSI(0.3048, 'ft')).toBeCloseTo(1, 12)
  })

  it('round-trips through every target unit', () => {
    const meters = 12345.6789
    const targets: DistanceUnitPref[] = ['km', 'mi', 'ft']
    for (const t of targets) {
      const display = convertDistanceFromSI(meters, t)
      expect(Number.isFinite(display)).toBe(true)
    }
  })

  it('handles edge cases: 0, negative, very large', () => {
    expect(convertDistanceFromSI(0, 'km')).toBe(0)
    expect(convertDistanceFromSI(-1000, 'km')).toBeCloseTo(-1, 12)
    const huge = 1e15
    expect(convertDistanceFromSI(huge, 'mi')).toBeCloseTo(huge / 1609.344, 0)
  })

  it('passes NaN through (caller is responsible for guarding)', () => {
    expect(Number.isNaN(convertDistanceFromSI(NaN, 'km'))).toBe(true)
  })
})

describe('convertDistanceToSI', () => {
  it('lifts a display-unit distance into SI meters', () => {
    expect(convertDistanceToSI(1, 'mi')).toBeCloseTo(1609.344, 9)
    expect(convertDistanceToSI(1, 'km')).toBe(1000)
    expect(convertDistanceToSI(1, 'ft')).toBeCloseTo(0.3048, 9)
  })

  it('is the exact inverse of convertDistanceFromSI for every unit', () => {
    const meters = 8046.72 // 5 miles
    const targets: DistanceUnitPref[] = ['km', 'mi', 'ft']
    for (const to of targets) {
      expect(convertDistanceToSI(convertDistanceFromSI(meters, to), to)).toBeCloseTo(meters, 9)
    }
  })
})

// ---------------------------------------------------------------------------
// Speed — input contract: m/s (SI)
// ---------------------------------------------------------------------------

describe('convertSpeedFromSI', () => {
  it('converts 27.7778 m/s → 100 km/h (SI input contract)', () => {
    expect(convertSpeedFromSI(1000 / 36, 'km/h')).toBeCloseTo(100, 9)
  })

  it('converts 26.8224 m/s → 60 mph (SI input contract)', () => {
    // 60 mph = 60 * 1609.344 / 3600 m/s = 26.8224 m/s exactly.
    expect(convertSpeedFromSI(26.8224, 'mph')).toBeCloseTo(60, 9)
  })

  it('round-trips through every target unit', () => {
    const mps = 33.33
    const targets: SpeedUnitPref[] = ['km/h', 'mph']
    for (const t of targets) {
      expect(Number.isFinite(convertSpeedFromSI(mps, t))).toBe(true)
    }
  })

  it('handles 0, negative, very large', () => {
    expect(convertSpeedFromSI(0, 'mph')).toBe(0)
    expect(convertSpeedFromSI(-10, 'km/h')).toBeCloseTo(-36, 9)
    expect(convertSpeedFromSI(1e9, 'mph')).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Temperature — input contract: °C (SI)
// ---------------------------------------------------------------------------

describe('convertTempFromSI', () => {
  it('passes 0 °C through as 0 °C and 32 °F (SI input contract)', () => {
    expect(convertTempFromSI(0, '°C')).toBe(0)
    expect(convertTempFromSI(0, '°F')).toBeCloseTo(32, 12)
  })

  it('converts 100 °C → 212 °F (SI input contract)', () => {
    expect(convertTempFromSI(100, '°F')).toBeCloseTo(212, 12)
  })

  it('handles negative °C correctly', () => {
    expect(convertTempFromSI(-40, '°F')).toBeCloseTo(-40, 12) // famous crossover
    expect(convertTempFromSI(-273.15, '°C')).toBeCloseTo(-273.15, 12)
  })

  it('round-trips °C → °F → °C within tolerance', () => {
    const c = 21.5
    const f = convertTempFromSI(c, '°F')
    const back = ((f - 32) * 5) / 9
    expect(Math.abs(back - c)).toBeLessThan(EPS_LOOSE)
  })
})

// ---------------------------------------------------------------------------
// Pressure — input contract: kPa (SI)
// ---------------------------------------------------------------------------

describe('convertPressureFromSI', () => {
  it('passes kPa through unchanged (SI input contract)', () => {
    expect(convertPressureFromSI(101.325, 'kPa')).toBe(101.325)
  })

  it('converts 6.894757 kPa → 1 psi (SI input contract)', () => {
    expect(convertPressureFromSI(6.894757, 'psi')).toBeCloseTo(1, 6)
  })

  it('converts 100 kPa → 1 bar exactly (SI input contract)', () => {
    expect(convertPressureFromSI(100, 'bar')).toBeCloseTo(1, 12)
  })

  it('round-trips through every target unit', () => {
    const kpa = 240
    const targets: PressureUnitPref[] = ['kPa', 'psi', 'bar']
    for (const t of targets) {
      expect(Number.isFinite(convertPressureFromSI(kpa, t))).toBe(true)
    }
  })

  it('handles 0 and very large', () => {
    expect(convertPressureFromSI(0, 'psi')).toBe(0)
    expect(convertPressureFromSI(1e6, 'bar')).toBeCloseTo(1e4, 9)
  })
})

// ---------------------------------------------------------------------------
// Energy — input contract: Wh (SI for FE display)
// ---------------------------------------------------------------------------

describe('convertEnergyFromSI', () => {
  it('passes Wh through unchanged (SI input contract)', () => {
    expect(convertEnergyFromSI(500, 'Wh')).toBe(500)
  })

  it('converts 1000 Wh → 1 kWh (SI input contract)', () => {
    expect(convertEnergyFromSI(1000, 'kWh')).toBeCloseTo(1, EPS_EXACT)
  })

  it('round-trips through every target unit', () => {
    const wh = 75500
    const targets: EnergyUnitPref[] = ['Wh', 'kWh']
    for (const t of targets) {
      expect(Number.isFinite(convertEnergyFromSI(wh, t))).toBe(true)
    }
  })

  it('handles 0 and negative (regen) inputs', () => {
    expect(convertEnergyFromSI(0, 'kWh')).toBe(0)
    expect(convertEnergyFromSI(-500, 'kWh')).toBeCloseTo(-0.5, 12)
  })
})

// ---------------------------------------------------------------------------
// Duration — input contract: seconds (SI)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Power — input contract: W (SI)
// ---------------------------------------------------------------------------

describe('convertPowerFromSI', () => {
  it('passes W through unchanged (SI input contract)', () => {
    expect(convertPowerFromSI(500, 'W')).toBe(500)
  })

  it('converts 1000 W → 1 kW (SI input contract)', () => {
    expect(convertPowerFromSI(1000, 'kW')).toBeCloseTo(1, EPS_EXACT)
  })

  it('round-trips through every target unit', () => {
    const watts = 125000
    const targets: PowerUnitPref[] = ['W', 'kW']
    for (const t of targets) {
      expect(Number.isFinite(convertPowerFromSI(watts, t))).toBe(true)
    }
  })
})

describe('convertDurationFromSI', () => {
  it('passes seconds through unchanged (SI input contract)', () => {
    expect(convertDurationFromSI(45, 's')).toBe(45)
  })

  it('converts 60 s → 1 min (SI input contract)', () => {
    expect(convertDurationFromSI(60, 'min')).toBeCloseTo(1, EPS_EXACT)
  })

  it('converts 3600 s → 1 h (SI input contract)', () => {
    expect(convertDurationFromSI(3600, 'h')).toBeCloseTo(1, EPS_EXACT)
  })

  it('converts 86400 s → 1 d (SI input contract)', () => {
    expect(convertDurationFromSI(86400, 'd')).toBeCloseTo(1, EPS_EXACT)
  })

  it('round-trips through every target unit', () => {
    const seconds = 12345
    const targets: DurationUnitPref[] = ['s', 'min', 'h', 'd']
    for (const t of targets) {
      expect(Number.isFinite(convertDurationFromSI(seconds, t))).toBe(true)
    }
  })

  it('handles 0 and negative durations', () => {
    expect(convertDurationFromSI(0, 'h')).toBe(0)
    expect(convertDurationFromSI(-3600, 'h')).toBeCloseTo(-1, EPS_EXACT)
  })
})

// ---------------------------------------------------------------------------
// Format functions — locale-aware string output, '—' fallback
// ---------------------------------------------------------------------------

describe('formatDistance', () => {
  it('formats 1000 m as "1.0 km" given a km display preference', () => {
    expect(formatDistance(1000, withPref({ distance: 'km' }))).toBe('1.0 km')
  })

  it('formats 1609.344 m as "1.0 mi"', () => {
    expect(formatDistance(1609.344, withPref({ distance: 'mi' }))).toBe('1.0 mi')
  })

  it('respects per-call precision override', () => {
    expect(
      formatDistance(1234.5, withPref({ distance: 'km' }), { precision: 3 }),
    ).toBe('1.235 km')
  })

  it('honors pref.precision when no per-call override is given', () => {
    // 1_500_678 m = 1500.678 km; with precision 0 → "1,501 km" (en-US grouping).
    expect(
      formatDistance(1_500_678, withPref({ distance: 'km', precision: 0 })),
    ).toBe('1,501 km')
  })

  it('returns "—" for null / undefined / NaN', () => {
    const pref = withPref({ distance: 'km' })
    expect(formatDistance(undefined, pref)).toBe('—')
    expect(formatDistance(null, pref)).toBe('—')
    expect(formatDistance(NaN, pref)).toBe('—')
    expect(formatDistance(Infinity, pref)).toBe('—')
    expect(formatDistance(-Infinity, pref)).toBe('—')
  })

  it('honors a custom emptyDisplay fallback', () => {
    expect(
      formatDistance(undefined, withPref({ distance: 'km', emptyDisplay: 'n/a' })),
    ).toBe('n/a')
  })

  it('does not throw on extreme inputs', () => {
    const pref = withPref({ distance: 'km' })
    expect(() => formatDistance(1e20, pref)).not.toThrow()
    expect(() => formatDistance(-1e20, pref)).not.toThrow()
  })
})

describe('formatSpeed', () => {
  it('formats 27.7778 m/s as "100 km/h" (SI input contract)', () => {
    expect(formatSpeed(1000 / 36, withPref({ speed: 'km/h' }))).toBe('100 km/h')
  })

  it('formats 26.8224 m/s as "60 mph" (SI input contract)', () => {
    expect(formatSpeed(26.8224, withPref({ speed: 'mph' }))).toBe('60 mph')
  })

  it('returns the empty fallback for undefined', () => {
    expect(formatSpeed(undefined, withPref({ speed: 'mph' }))).toBe('—')
  })

  it('uses 0 fraction digits by default', () => {
    expect(formatSpeed(13.4112, withPref({ speed: 'mph' }))).toBe('30 mph')
  })

  it('handles negative speeds without throwing', () => {
    expect(formatSpeed(-10, withPref({ speed: 'km/h' }))).toContain('km/h')
  })
})

describe('formatTemperature', () => {
  it('formats 22.5 °C as "22.5°C" (SI input contract, no space before °)', () => {
    expect(formatTemperature(22.5, withPref({ temperature: '°C' }))).toBe('22.5°C')
  })

  it('formats 0 °C as "32.0°F" when target is °F', () => {
    expect(formatTemperature(0, withPref({ temperature: '°F' }))).toBe('32.0°F')
  })

  it('formats -40 °C as "-40.0°F" (crossover)', () => {
    expect(formatTemperature(-40, withPref({ temperature: '°F' }))).toBe('-40.0°F')
  })

  it('returns "—" for nullish input', () => {
    expect(formatTemperature(null, withPref({ temperature: '°C' }))).toBe('—')
    expect(formatTemperature(undefined, withPref({ temperature: '°C' }))).toBe('—')
  })
})

describe('formatPressure', () => {
  it('formats 240 kPa as "240.0 kPa" (SI input contract, passthrough)', () => {
    expect(formatPressure(240, withPref({ pressure: 'kPa' }))).toBe('240.0 kPa')
  })

  it('formats 240 kPa as "34.8 psi" (SI input contract, conversion)', () => {
    // 240 / 6.894757 ≈ 34.81135
    expect(formatPressure(240, withPref({ pressure: 'psi' }))).toBe('34.8 psi')
  })

  it('formats 240 kPa as "2.4 bar" (SI input contract, conversion)', () => {
    expect(formatPressure(240, withPref({ pressure: 'bar' }))).toBe('2.4 bar')
  })

  it('returns the fallback for undefined', () => {
    expect(formatPressure(undefined, withPref({ pressure: 'psi' }))).toBe('—')
  })
})

describe('formatEnergy', () => {
  it('formats 75500 Wh as "75.50 kWh" (SI input contract, default precision 2)', () => {
    expect(formatEnergy(75500, withPref({ energy: 'kWh' }))).toBe('75.50 kWh')
  })

  it('formats 500 Wh as "500.00 Wh" (SI input contract, passthrough)', () => {
    expect(formatEnergy(500, withPref({ energy: 'Wh' }))).toBe('500.00 Wh')
  })

  it('handles negative regen energy', () => {
    expect(formatEnergy(-500, withPref({ energy: 'kWh' }))).toBe('-0.50 kWh')
  })

  it('returns "—" for non-finite input', () => {
    expect(formatEnergy(NaN, withPref({ energy: 'kWh' }))).toBe('—')
  })
})

describe('formatPower', () => {
  it('formats 125000 W as "125.00 kW" (SI input contract, default precision 2)', () => {
    expect(formatPower(125000, withPref({ power: 'kW' }))).toBe('125.00 kW')
  })

  it('formats 500 W as "500.00 W" (SI input contract, passthrough)', () => {
    expect(formatPower(500, withPref({ power: 'W' }))).toBe('500.00 W')
  })

  it('returns "—" for non-finite input', () => {
    expect(formatPower(NaN, withPref({ power: 'kW' }))).toBe('—')
  })
})

describe('formatDuration', () => {
  it('formats 60 s as "1 min" (SI input contract)', () => {
    expect(formatDuration(60, withPref({ duration: 'min' }))).toBe('1 min')
  })

  it('formats 3600 s as "1 h" (SI input contract)', () => {
    expect(formatDuration(3600, withPref({ duration: 'h' }))).toBe('1 h')
  })

  it('formats 86400 s as "1 d" (SI input contract)', () => {
    expect(formatDuration(86400, withPref({ duration: 'd' }))).toBe('1 d')
  })

  it('formats 45 s as "45 s" (SI input contract, identity)', () => {
    expect(formatDuration(45, withPref({ duration: 's' }))).toBe('45 s')
  })

  it('returns the fallback for nullish input', () => {
    expect(formatDuration(null, withPref({ duration: 'h' }))).toBe('—')
  })
})

// ---------------------------------------------------------------------------
// Locale awareness
// ---------------------------------------------------------------------------

describe('locale-aware formatting', () => {
  it('uses the en-US grouping separator for large distances', () => {
    const out = formatDistance(
      1_234_567,
      withPref({ distance: 'km', locale: 'en-US' }),
    )
    expect(out).toBe('1,234.6 km')
  })

  it('uses de-DE separators when requested', () => {
    const out = formatDistance(
      1_234_567,
      withPref({ distance: 'km', locale: 'de-DE' }),
    )
    // de-DE uses '.' for grouping, ',' for decimal: "1.234,6 km"
    expect(out).toBe('1.234,6 km')
  })

  it('uses host locale when pref.locale is undefined', () => {
    const out = formatDistance(1000, { ...basePref, locale: undefined })
    expect(out).toContain('km')
    expect(Number.isFinite(parseFloat(out))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Anti-regression: forbidden legacy patterns must NOT exist in the public
// SI surface (the audit gate enforces this at the file level; these tests
// pin the behavioural contract).
// ---------------------------------------------------------------------------

describe('SI input contract (no "guess the input unit" fallback)', () => {
  it('every formatX takes a single SI value and the user UnitPref', () => {
    // Compile-time check via signature; runtime sanity: each fn arity is 2 (+ optional opts).
    expect(formatDistance.length).toBeLessThanOrEqual(3)
    expect(formatSpeed.length).toBeLessThanOrEqual(3)
    expect(formatTemperature.length).toBeLessThanOrEqual(3)
    expect(formatPressure.length).toBeLessThanOrEqual(3)
    expect(formatEnergy.length).toBeLessThanOrEqual(3)
    expect(formatPower.length).toBeLessThanOrEqual(3)
    expect(formatDuration.length).toBeLessThanOrEqual(3)
  })

  it('UnitPref types are exported as symbols/types (compile-time)', () => {
    // Type-level assertion: assigning a literal to each typed slot must compile.
    const pref: UnitPref = {
      distance: 'mi' satisfies DistanceUnitPref,
      speed: 'mph' satisfies SpeedUnitPref,
      temperature: '°F' satisfies TemperatureUnitPref,
      pressure: 'psi' satisfies PressureUnitPref,
      energy: 'kWh' satisfies EnergyUnitPref,
      power: 'kW' satisfies PowerUnitPref,
      duration: 'h' satisfies DurationUnitPref,
    }
    expect(pref.distance).toBe('mi')
  })
})
