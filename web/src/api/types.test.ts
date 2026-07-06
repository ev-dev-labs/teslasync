/**
 * Runtime-contract tests for the API type module.
 *
 * `web/src/api/types.ts` is overwhelmingly a declaration file, but it also
 * exports four pieces of live behaviour that the whole SPA leans on to paint
 * vehicle status chips, dots, and badge variants:
 *
 *   - `VEHICLE_STATUSES`   — the canonical status list (mirrors the FSM).
 *   - `deriveVehicleStatus`— collapses a noisy live-state object into one of
 *                            the seven canonical statuses.
 *   - `statusVariant`      — status → BadgeVariant (semantic colour bucket).
 *   - `statusDotColor`     — status → concrete Tailwind dot class.
 *
 * These tests lock in every branch (priority ordering, case-insensitivity,
 * unknown-value fallbacks, and null-safety against malformed API payloads),
 * and pin the colour/variant maps to their single source of truth in
 * `@/types/fsm` so a drift in either file is caught immediately. A lean
 * type-contract block additionally exercises a representative slice of the
 * exported interfaces so an incompatible shape change fails `tsc`.
 */

import { describe, it, expect } from 'vitest'

import {
  VEHICLE_STATUSES,
  deriveVehicleStatus,
  statusVariant,
  statusDotColor,
} from './types'
import type {
  VehicleState,
  VehicleStatus,
  Vehicle,
  SignalEnvelope,
  SignalKind,
  AlertRuleSeverity,
  BadgeVariant,
} from './types'
import { VEHICLE_STATES, VEHICLE_STATE_ENTRIES, resolveStyle } from '@/types/fsm'

/**
 * The local `VehicleState` interface requires ~22 fields. Real callers pass a
 * fully-hydrated `/vehicles/{id}/state` payload; tests only care about the
 * three fields the deriver reads, so this factory supplies sane defaults and
 * lets each case override just what it exercises.
 */
function vehicleState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 80,
    rated_range: 300,
    ideal_range: 320,
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
    software_version: '2024.0.0',
    ...overrides,
  }
}

describe('VEHICLE_STATUSES', () => {
  it('mirrors the FSM VEHICLE_STATES source of truth exactly', () => {
    expect(VEHICLE_STATUSES).toEqual([...VEHICLE_STATES])
    expect(VEHICLE_STATUSES).toHaveLength(VEHICLE_STATES.length)
  })

  it('contains the operational statuses the UI switches on', () => {
    expect(VEHICLE_STATUSES).toContain('charging')
    expect(VEHICLE_STATUSES).toContain('driving')
    expect(VEHICLE_STATUSES).toContain('offline')
  })
})

describe('deriveVehicleStatus', () => {
  it('returns "offline" when no live state is available', () => {
    expect(deriveVehicleStatus(null)).toBe('offline')
    expect(deriveVehicleStatus(undefined)).toBe('offline')
    expect(deriveVehicleStatus()).toBe('offline')
  })

  it('prioritises charging over movement and any reported state string', () => {
    expect(deriveVehicleStatus(vehicleState({ is_charging: true }))).toBe('charging')
    // charging wins even if the car also reports non-zero speed…
    expect(
      deriveVehicleStatus(vehicleState({ is_charging: true, speed: 55 })),
    ).toBe('charging')
    // …and even if the API state string still says something else.
    expect(
      deriveVehicleStatus(vehicleState({ is_charging: true, state: 'asleep' })),
    ).toBe('charging')
  })

  it('reports "driving" for positive speed when not charging', () => {
    expect(deriveVehicleStatus(vehicleState({ speed: 42 }))).toBe('driving')
    // movement outranks a stale/idle state string.
    expect(
      deriveVehicleStatus(vehicleState({ speed: 42, state: 'asleep' })),
    ).toBe('driving')
  })

  it('does not report "driving" for zero or negative speed', () => {
    expect(deriveVehicleStatus(vehicleState({ speed: 0, state: 'parked' }))).toBe('parked')
    // guards against a spurious regen/rollback sample flipping the chip.
    expect(deriveVehicleStatus(vehicleState({ speed: -3, state: 'parked' }))).toBe('parked')
  })

  it.each([...VEHICLE_STATES])('echoes the known state "%s" case-insensitively', (state) => {
    expect(deriveVehicleStatus(vehicleState({ state }))).toBe(state)
    expect(deriveVehicleStatus(vehicleState({ state: state.toUpperCase() }))).toBe(state)
  })

  it('falls back to "online" for an unrecognised state string', () => {
    // Tesla emits transient states ("waking"/"suspended") that are not part
    // of our canonical set — they should register as generically online.
    expect(deriveVehicleStatus(vehicleState({ state: 'waking' }))).toBe('online')
    expect(deriveVehicleStatus(vehicleState({ state: 'suspended' }))).toBe('online')
    expect(deriveVehicleStatus(vehicleState({ state: '' }))).toBe('online')
  })

  it('tolerates malformed live-state payloads without throwing', () => {
    // Simulate an API response where numeric/string fields arrive as null.
    const nulled = { speed: null, state: null, is_charging: null } as unknown as VehicleState
    expect(deriveVehicleStatus(nulled)).toBe('online')
    // A near-empty object must not crash on the `.toLowerCase()`/`> 0` paths.
    expect(deriveVehicleStatus({} as VehicleState)).toBe('online')
  })

  it('resolves the documented priority chain (charging > driving > state > online)', () => {
    const cases: Array<[Partial<VehicleState>, VehicleStatus]> = [
      [{ is_charging: true, speed: 30, state: 'driving' }, 'charging'],
      [{ speed: 30, state: 'asleep' }, 'driving'],
      [{ speed: 0, state: 'asleep' }, 'asleep'],
      [{ speed: 0, state: 'mystery' }, 'online'],
    ]
    for (const [input, expected] of cases) {
      expect(deriveVehicleStatus(vehicleState(input))).toBe(expected)
    }
  })
})

describe('statusVariant', () => {
  it.each(VEHICLE_STATUSES)('maps "%s" to its source-of-truth variant', (status) => {
    expect(statusVariant(status)).toBe(VEHICLE_STATE_ENTRIES[status].variant)
  })

  it('returns the specific semantic buckets the design system expects', () => {
    expect(statusVariant('charging')).toBe('warning')
    expect(statusVariant('offline')).toBe('danger')
    expect(statusVariant('parked')).toBe('info')
    const online: BadgeVariant = statusVariant('online')
    expect(online).toBe('success')
  })

  it('falls back to "danger" for an unknown status', () => {
    expect(statusVariant('bogus')).toBe('danger')
    expect(statusVariant('')).toBe('danger')
  })
})

describe('statusDotColor', () => {
  it.each(VEHICLE_STATUSES)('returns the resolved badge-dot class for "%s"', (status) => {
    const expected = resolveStyle(VEHICLE_STATE_ENTRIES[status]).badgeDot
    expect(statusDotColor(status)).toBe(expected)
  })

  it('applies per-state overrides rather than the bare variant colour', () => {
    // driving is a "success" variant but overrides its dot to blue.
    expect(statusDotColor('driving')).toBe('bg-blue-500')
    expect(statusDotColor('charging')).toBe('bg-yellow-400')
    // online has no override, so it inherits the success theme dot.
    expect(statusDotColor('online')).toBe('bg-green-400')
    expect(statusDotColor('offline')).toBe('bg-red-400')
  })

  it('returns a neutral gray dot for an unknown status', () => {
    expect(statusDotColor('bogus')).toBe('bg-gray-400')
  })

  it('never emits the unknown-fallback colour for a known status', () => {
    for (const status of VEHICLE_STATUSES) {
      expect(statusDotColor(status)).not.toBe('bg-gray-400')
    }
  })
})

describe('exported type contracts', () => {
  it('accepts a representative Vehicle row', () => {
    const vehicle = {
      id: 1,
      vehicle_id: 1234567890,
      vin: '5YJ3E1EA7KF000000',
      display_name: 'Test Model 3',
      model: 'model3',
      trim_badging: 'p74d',
      exterior_color: 'MidnightSilver',
      wheel_type: 'Stiletto20',
      state: 'online',
      healthy: true,
      timezone: 'America/Los_Angeles',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
    } satisfies Vehicle
    expect(vehicle.vin).toBe('5YJ3E1EA7KF000000')
    expect(vehicle.healthy).toBe(true)
  })

  it('carries a typed scalar in SignalEnvelope keyed by kind', () => {
    const floatSignal = { kind: 'float', value: 3.14, ts: '2024-01-01T00:00:00Z' } satisfies SignalEnvelope
    expect(floatSignal.value).toBe(3.14)

    // A null value models an empty typed column and must remain assignable.
    const emptySignal = { kind: 'unknown', value: null, ts: '2024-01-01T00:00:00Z' } satisfies SignalEnvelope
    expect(emptySignal.value).toBeNull()
  })

  it('enumerates the documented union members', () => {
    const kinds: SignalKind[] = ['string', 'bool', 'int', 'float', 'time', 'unknown']
    expect(kinds).toHaveLength(6)

    const severities: AlertRuleSeverity[] = ['info', 'warn', 'critical']
    expect(severities).toContain('critical')
  })
})
