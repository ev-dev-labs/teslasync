/**
 * vehicle-detail/helpers — behaviour, branch, boundary, null-safety and
 * regression coverage for every export of the Vehicle Detail helper module.
 *
 * These are pure functions plus two re-exports and two constants — no
 * network, router, DOM, or settings dependency — so direct calls are the
 * right tool (matching the repo convention in
 * features/system/components/status/helpers.test.tsx). The suite pins the
 * two bugs the hardening pass fixed:
 *   - CARRY: durationStr rounded fractional minutes with `fmtInt(minutes % 60)`,
 *     so 59.6 rendered as the invalid "60m" and 1439.6 as "23h 60m". Real
 *     input: RecentDrivesSection passes `(duration_s ?? 0) / 60`.
 *   - UNKNOWN-AS-CRITICAL: batteryColor fell through to red for a NaN /
 *     missing state-of-charge, painting a dead-battery gauge on partial
 *     telemetry instead of the muted "no data" grey.
 */
import { describe, it, expect } from 'vitest'
import type { VehicleState } from '@/api/types'
import {
  deriveStatus,
  statusVariant,
  batteryColor,
  paToKpa,
  tirePressureVariant,
  durationStr,
  TIRE_PRESSURE_PA,
  type StateResponse,
} from './helpers'

// A full, valid VehicleState so deriveStatus sees the exact shape production
// hands it; each test overrides only the field(s) under examination.
function mkState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 80,
    rated_range: 400,
    ideal_range: 420,
    odometer: 10_000,
    inside_temp: 21,
    outside_temp: 15,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '2024.0',
    ...overrides,
  }
}

describe('deriveStatus (re-exported deriveVehicleStatus)', () => {
  it('returns "offline" for a null or undefined state', () => {
    expect(deriveStatus(null)).toBe('offline')
    expect(deriveStatus(undefined)).toBe('offline')
  })

  it('prioritises charging over both driving and the raw state field', () => {
    // is_charging must win even when speed > 0 and state says "driving".
    expect(
      deriveStatus(mkState({ is_charging: true, speed: 55, state: 'driving' })),
    ).toBe('charging')
  })

  it('derives "driving" from a non-zero speed when not charging', () => {
    expect(deriveStatus(mkState({ speed: 42 }))).toBe('driving')
  })

  it('passes a recognised raw FSM state through (case-insensitive)', () => {
    expect(deriveStatus(mkState({ state: 'ASLEEP' }))).toBe('asleep')
    expect(deriveStatus(mkState({ state: 'parked' }))).toBe('parked')
  })

  it('falls back to "online" for an unrecognised raw state', () => {
    expect(deriveStatus(mkState({ state: 'wobble' }))).toBe('online')
  })
})

describe('statusVariant (re-exported)', () => {
  it('maps every known vehicle state to its badge variant', () => {
    expect(statusVariant('online')).toBe('success')
    expect(statusVariant('driving')).toBe('success')
    expect(statusVariant('charging')).toBe('warning')
    expect(statusVariant('parked')).toBe('info')
    expect(statusVariant('asleep')).toBe('neutral')
    expect(statusVariant('offline')).toBe('danger')
  })

  it('falls back to "danger" for an unknown or empty status', () => {
    expect(statusVariant('gremlin')).toBe('danger')
    expect(statusVariant('')).toBe('danger')
  })
})

describe('batteryColor', () => {
  it('returns green above 60 %', () => {
    expect(batteryColor(100)).toBe('#10b981')
    expect(batteryColor(61)).toBe('#10b981')
  })

  it('returns amber across the 25–60 % band (60 boundary is amber)', () => {
    expect(batteryColor(60)).toBe('#f59e0b')
    expect(batteryColor(26)).toBe('#f59e0b')
  })

  it('returns red at or below 25 %', () => {
    expect(batteryColor(25)).toBe('#ef4444')
    expect(batteryColor(0)).toBe('#ef4444')
  })

  it('returns muted grey for a non-finite / missing level instead of red', () => {
    // Regression: an unknown SoC used to hit the red "critical" branch and
    // paint a dead-looking gauge on partial telemetry.
    expect(batteryColor(Number.NaN)).toBe('#6b7280')
    expect(batteryColor(Number.POSITIVE_INFINITY)).toBe('#6b7280')
    expect(batteryColor(undefined as unknown as number)).toBe('#6b7280')
  })
})

describe('TIRE_PRESSURE_PA thresholds', () => {
  it('exposes the four SI (Pascal) breakpoints', () => {
    expect(TIRE_PRESSURE_PA.LOW_CRITICAL).toBe(206_800)
    expect(TIRE_PRESSURE_PA.LOW_WARNING).toBe(241_300)
    expect(TIRE_PRESSURE_PA.HIGH_WARNING).toBe(310_300)
    expect(TIRE_PRESSURE_PA.HIGH_CRITICAL).toBe(344_700)
  })

  it('is strictly ordered low → high', () => {
    expect(TIRE_PRESSURE_PA.LOW_CRITICAL).toBeLessThan(TIRE_PRESSURE_PA.LOW_WARNING)
    expect(TIRE_PRESSURE_PA.LOW_WARNING).toBeLessThan(TIRE_PRESSURE_PA.HIGH_WARNING)
    expect(TIRE_PRESSURE_PA.HIGH_WARNING).toBeLessThan(TIRE_PRESSURE_PA.HIGH_CRITICAL)
  })

  it('is frozen so consumers cannot mutate the shared source of truth', () => {
    expect(Object.isFrozen(TIRE_PRESSURE_PA)).toBe(true)
    const mutate = () => {
      (TIRE_PRESSURE_PA as unknown as Record<string, number>).LOW_WARNING = 0
    }
    expect(mutate).toThrow()
    expect(TIRE_PRESSURE_PA.LOW_WARNING).toBe(241_300)
  })
})

describe('paToKpa', () => {
  it('converts Pascals to kilopascals (÷ 1000)', () => {
    expect(paToKpa(241_300)).toBe(241.3)
    expect(paToKpa(0)).toBe(0)
  })

  it('returns null for nullish or non-finite input', () => {
    expect(paToKpa(null)).toBeNull()
    expect(paToKpa(undefined)).toBeNull()
    expect(paToKpa(Number.NaN)).toBeNull()
    expect(paToKpa(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('tirePressureVariant', () => {
  it('returns "neutral" for an unknown pressure', () => {
    expect(tirePressureVariant(null)).toBe('neutral')
    expect(tirePressureVariant(undefined)).toBe('neutral')
    expect(tirePressureVariant(Number.NaN)).toBe('neutral')
  })

  it('returns "success" inside the safe band, including the warning boundaries', () => {
    expect(tirePressureVariant(276_000)).toBe('success') // ≈ 40 psi, mid-band
    expect(tirePressureVariant(TIRE_PRESSURE_PA.LOW_WARNING)).toBe('success')
    expect(tirePressureVariant(TIRE_PRESSURE_PA.HIGH_WARNING)).toBe('success')
  })

  it('returns "warning" just inside the soft-low and soft-high bands', () => {
    expect(tirePressureVariant(TIRE_PRESSURE_PA.LOW_WARNING - 1)).toBe('warning')
    expect(tirePressureVariant(TIRE_PRESSURE_PA.HIGH_WARNING + 1)).toBe('warning')
  })

  it('returns "danger" past the critical breakpoints', () => {
    expect(tirePressureVariant(TIRE_PRESSURE_PA.LOW_CRITICAL - 1)).toBe('danger')
    expect(tirePressureVariant(TIRE_PRESSURE_PA.HIGH_CRITICAL + 1)).toBe('danger')
  })
})

describe('durationStr', () => {
  it('formats sub-hour durations as "Mm"', () => {
    expect(durationStr(45)).toBe('45m')
    expect(durationStr(1)).toBe('1m')
  })

  it('formats multi-hour durations as "Hh Mm"', () => {
    expect(durationStr(90)).toBe('1h 30m')
    expect(durationStr(125)).toBe('2h 5m')
    expect(durationStr(60)).toBe('1h 0m')
  })

  it('rounds fractional minutes and carries into the hour correctly', () => {
    // Regression: 59.6 % 60 rounded up to a bare "60m" and 1439.6 to "23h 60m".
    expect(durationStr(59.6)).toBe('1h 0m')
    expect(durationStr(1439.6)).toBe('24h 0m')
    expect(durationStr(30.4)).toBe('30m')
    expect(durationStr(30.6)).toBe('31m')
  })

  it('collapses zero, negative, and non-finite input to "0m"', () => {
    expect(durationStr(0)).toBe('0m')
    expect(durationStr(-5)).toBe('0m')
    expect(durationStr(Number.NaN)).toBe('0m')
    expect(durationStr(Number.POSITIVE_INFINITY)).toBe('0m')
  })
})

describe('StateResponse contract', () => {
  it('carries a vehicle state plus a live flag that deriveStatus consumes', () => {
    const resp: StateResponse = { state: mkState({ state: 'charging' }), live: true }
    expect(resp.live).toBe(true)
    expect(resp.state.state).toBe('charging')
    expect(deriveStatus(resp.state)).toBe('charging')
  })
})
