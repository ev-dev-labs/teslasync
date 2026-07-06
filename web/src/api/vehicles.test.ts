// api/vehicles.ts coverage.
//
// This file exercises EVERY runtime export of api/vehicles.ts through its
// public surface. Network is mocked at the `request` boundary (the repo
// convention — see api/hooks/useVehicles.test.tsx), so no real HTTP fires.
//
//   - getVehicleStatus     — the deriveVehicleStatus re-export (offline /
//                            charging-over-driving / driving / known-state /
//                            unknown-state branches).
//   - getVehicleState      — the two-shape decode (pre-assembled `state` vs.
//                            vehicle+position compose), per-field defaults,
//                            the rated→ideal range fallback, the is_locked
//                            default, the neither-vehicle-nor-position path,
//                            and the null/undefined-body null-safety guard
//                            (the regression this harden fixes — a 204 body
//                            must not throw).
//   - the GET read family  — exact URL shape + that the response flows through
//                            untouched + default vs. custom limit/offset.
//   - the mutation family  — syncVehicles / wakeVehicle / deleteVehicle /
//                            sendCommand — method + JSON body shape.
//   - getSoftwareUpdates   — the optional vehicle_id URL branch.
//   - getStateSummary /    — the `start ? start=… : days=…` URL branch.
//     getDailyStateBreakdown

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoisted so the (also-hoisted) mock factory closes over the SAME spy the
// assertions read.
const requestMock = vi.hoisted(() => vi.fn())

vi.mock('./client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

import * as api from './vehicles'
import { getVehicleStatus } from './vehicles'
import type { VehicleState } from './types'

/** A complete, well-formed VehicleState for the pass-through decode path. */
function makeState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 0,
    rated_range: 0,
    ideal_range: 0,
    odometer: 0,
    inside_temp: 0,
    outside_temp: 0,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '',
    ...overrides,
  }
}

beforeEach(() => {
  requestMock.mockReset()
  requestMock.mockResolvedValue(undefined)
})

// ── getVehicleStatus (deriveVehicleStatus re-export) ────────────────────────

describe('getVehicleStatus', () => {
  it('returns offline when no state is provided', () => {
    expect(getVehicleStatus()).toBe('offline')
    expect(getVehicleStatus(null)).toBe('offline')
  })

  it('prioritises charging over a non-zero speed', () => {
    expect(getVehicleStatus(makeState({ is_charging: true, speed: 42 }))).toBe('charging')
  })

  it('returns driving when moving and not charging', () => {
    expect(getVehicleStatus(makeState({ speed: 42 }))).toBe('driving')
  })

  it('passes a known lifecycle state through (case-insensitive)', () => {
    expect(getVehicleStatus(makeState({ state: 'ASLEEP' }))).toBe('asleep')
    expect(getVehicleStatus(makeState({ state: 'parked' }))).toBe('parked')
  })

  it('defaults to online for an unrecognised state string', () => {
    expect(getVehicleStatus(makeState({ state: 'who-knows' }))).toBe('online')
  })
})

// ── getVehicleState normalisation ───────────────────────────────────────────

describe('getVehicleState', () => {
  it('requests the state endpoint for the given id', async () => {
    requestMock.mockResolvedValueOnce({ live: false })
    await api.getVehicleState(7)
    expect(requestMock).toHaveBeenCalledWith('/vehicles/7/state')
  })

  it('passes a pre-assembled state object through with its live flag', async () => {
    const state = makeState({ vehicle_id: 3, state: 'driving', speed: 55 })
    requestMock.mockResolvedValueOnce({ state, live: true })

    const result = await api.getVehicleState(3)

    expect(result.live).toBe(true)
    expect(result.state).toBe(state) // same reference, untouched
  })

  it('composes vehicle + position into a VehicleState with defaults', async () => {
    requestMock.mockResolvedValueOnce({
      vehicle: { id: 5, state: 'asleep', is_locked: false, software_version: '2024.4.1' },
      position: { latitude: 1.5, longitude: -2.5, battery_level: 72, odometer: 12345 },
      is_charging: true,
      charger_power: 11,
      live: false,
    })

    const { state, live } = await api.getVehicleState(5)

    expect(live).toBe(false)
    expect(state).toMatchObject({
      vehicle_id: 5,
      state: 'asleep',
      latitude: 1.5,
      longitude: -2.5,
      battery_level: 72,
      odometer: 12345,
      is_charging: true,
      charger_power: 11,
      is_locked: false, // read from vehicle.is_locked
      software_version: '2024.4.1',
    })
    // Absent fields fall back to safe defaults, never undefined.
    expect(state?.speed).toBe(0)
    expect(state?.power).toBe(0)
    expect(state?.sentry_mode).toBe(false)
  })

  it('falls back to the passed id and locked=true when fields are absent', async () => {
    requestMock.mockResolvedValueOnce({ vehicle: {}, position: null })

    const { state } = await api.getVehicleState(42)

    expect(state?.vehicle_id).toBe(42) // v?.id ?? id
    expect(state?.state).toBe('offline')
    expect(state?.is_locked).toBe(true) // secure-by-default when unknown
    expect(state?.software_version).toBe('')
  })

  it('uses ideal_range when rated_range is missing', async () => {
    requestMock.mockResolvedValueOnce({ position: { ideal_range: 250 } })

    const { state } = await api.getVehicleState(1)

    expect(state?.rated_range).toBe(250)
    expect(state?.ideal_range).toBe(250)
  })

  it('returns an undefined state when neither vehicle nor position is present', async () => {
    requestMock.mockResolvedValueOnce({ live: true })

    const result = await api.getVehicleState(1)

    expect(result).toEqual({ state: undefined, live: true })
  })

  it('does not throw on a null body (204 / empty response) — the regression guard', async () => {
    requestMock.mockResolvedValueOnce(null)

    await expect(api.getVehicleState(1)).resolves.toEqual({ state: undefined, live: false })
  })

  it('does not throw on an undefined body', async () => {
    requestMock.mockResolvedValueOnce(undefined)

    await expect(api.getVehicleState(9)).resolves.toEqual({ state: undefined, live: false })
  })
})

// ── GET read family: exact URL + pass-through + limit/offset defaults ────────

describe('read wrappers', () => {
  const SENTINEL = { marker: 'response' }

  it.each([
    ['getVehicles', () => api.getVehicles(), '/vehicles'],
    ['getVehicle', () => api.getVehicle(7), '/vehicles/7'],
    ['getVehiclePositions (default limit)', () => api.getVehiclePositions(7), '/vehicles/7/positions?limit=100'],
    ['getVehiclePositions (custom limit)', () => api.getVehiclePositions(7, 25), '/vehicles/7/positions?limit=25'],
    ['getTirePressure', () => api.getTirePressure(7), '/tire-pressure?vehicle_id=7&limit=100&offset=0'],
    ['getLatestTirePressure', () => api.getLatestTirePressure(7), '/tire-pressure/latest?vehicle_id=7'],
    ['getMotorData', () => api.getMotorData(7), '/motor?vehicle_id=7&limit=100&offset=0'],
    ['getMotorLatest', () => api.getMotorLatest(7), '/motor/latest?vehicle_id=7'],
    ['getClimateData', () => api.getClimateData(7), '/climate?vehicle_id=7&limit=100&offset=0'],
    ['getClimateLatest', () => api.getClimateLatest(7), '/climate/latest?vehicle_id=7'],
    ['getSecurityEvents', () => api.getSecurityEvents(7), '/security?vehicle_id=7&limit=100&offset=0'],
    ['getSecurityLatest', () => api.getSecurityLatest(7), '/security/latest?vehicle_id=7'],
    ['getChargingTelemetry', () => api.getChargingTelemetry(7), '/charging-telemetry?vehicle_id=7&limit=100&offset=0'],
    ['getChargingTelemetryLatest', () => api.getChargingTelemetryLatest(7), '/charging-telemetry/latest?vehicle_id=7'],
    ['getMediaData', () => api.getMediaData(7), '/media?vehicle_id=7&limit=100&offset=0'],
    ['getMediaLatest', () => api.getMediaLatest(7), '/media/latest?vehicle_id=7'],
    ['getVehicleConfigData', () => api.getVehicleConfigData(7), '/vehicle-config?vehicle_id=7&limit=100&offset=0'],
    ['getVehicleConfigLatest', () => api.getVehicleConfigLatest(7), '/vehicle-config/latest?vehicle_id=7'],
    ['getLocationSnapshots', () => api.getLocationSnapshots(7), '/location-snapshots?vehicle_id=7&limit=100&offset=0'],
    ['getLocationSnapshotLatest', () => api.getLocationSnapshotLatest(7), '/location-snapshots/latest?vehicle_id=7'],
    ['getSafetyData', () => api.getSafetyData(7), '/safety?vehicle_id=7&limit=100&offset=0'],
    ['getSafetyLatest', () => api.getSafetyLatest(7), '/safety/latest?vehicle_id=7'],
    ['getUserPreferences', () => api.getUserPreferences(7), '/user-preferences?vehicle_id=7&limit=100&offset=0'],
    ['getUserPreferenceLatest', () => api.getUserPreferenceLatest(7), '/user-preferences/latest?vehicle_id=7'],
    ['getVehicleTimeline', () => api.getVehicleTimeline(7), '/vehicle-states/timeline?vehicle_id=7&limit=200&offset=0'],
  ])('%s issues GET %s and returns the body untouched', async (_name, call, url) => {
    requestMock.mockResolvedValueOnce(SENTINEL)

    const result = await call()

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(requestMock).toHaveBeenCalledWith(url) // single arg → no stray options/method
    expect(result).toBe(SENTINEL)
  })

  it('honours custom limit + offset on a paginated reader', async () => {
    await api.getMotorData(3, 10, 20)
    expect(requestMock).toHaveBeenCalledWith('/motor?vehicle_id=3&limit=10&offset=20')
  })
})

// ── Mutation family: method + JSON body ─────────────────────────────────────

describe('mutation wrappers', () => {
  it('syncVehicles POSTs to /vehicles/sync', async () => {
    requestMock.mockResolvedValueOnce({ synced: 2, vehicles: [] })

    const result = await api.syncVehicles()

    expect(requestMock).toHaveBeenCalledWith('/vehicles/sync', { method: 'POST' })
    expect(result).toEqual({ synced: 2, vehicles: [] })
  })

  it('wakeVehicle POSTs to the wake endpoint', async () => {
    requestMock.mockResolvedValueOnce({ status: 'waking' })

    const result = await api.wakeVehicle(11)

    expect(requestMock).toHaveBeenCalledWith('/vehicles/11/wake', { method: 'POST' })
    expect(result).toEqual({ status: 'waking' })
  })

  it('deleteVehicle DELETEs the vehicle', async () => {
    await api.deleteVehicle(11)
    expect(requestMock).toHaveBeenCalledWith('/vehicles/11', { method: 'DELETE' })
  })

  it('sendCommand serialises command + params into the JSON body', async () => {
    requestMock.mockResolvedValueOnce({ result: true })

    await api.sendCommand(7, 'set_temps', { driver_temp: 21, passenger_temp: 20 })

    expect(requestMock).toHaveBeenCalledWith('/vehicles/7/command', {
      method: 'POST',
      body: JSON.stringify({ command: 'set_temps', driver_temp: 21, passenger_temp: 20 }),
    })
  })

  it('sendCommand omits params when none are given', async () => {
    await api.sendCommand(7, 'door_lock')

    expect(requestMock).toHaveBeenCalledWith('/vehicles/7/command', {
      method: 'POST',
      body: JSON.stringify({ command: 'door_lock' }),
    })
  })
})

// ── URL branches: software updates + state summary/daily ─────────────────────

describe('query-parameter branches', () => {
  it('getSoftwareUpdates omits vehicle_id when unset', async () => {
    await api.getSoftwareUpdates()
    expect(requestMock).toHaveBeenCalledWith('/software-updates?limit=100&offset=0')
  })

  it('getSoftwareUpdates includes vehicle_id + custom paging when provided', async () => {
    await api.getSoftwareUpdates(9, 10, 5)
    expect(requestMock).toHaveBeenCalledWith('/software-updates?vehicle_id=9&limit=10&offset=5')
  })

  it('getStateSummary uses days when no start date is given', async () => {
    await api.getStateSummary(9)
    expect(requestMock).toHaveBeenCalledWith('/vehicle-states/summary?vehicle_id=9&days=30')
  })

  it('getStateSummary uses the start date when provided (days ignored)', async () => {
    await api.getStateSummary(9, 30, '2026-01-01')
    expect(requestMock).toHaveBeenCalledWith('/vehicle-states/summary?vehicle_id=9&start=2026-01-01')
  })

  it('getDailyStateBreakdown uses days by default and start when supplied', async () => {
    await api.getDailyStateBreakdown(4, 7)
    expect(requestMock).toHaveBeenCalledWith('/vehicle-states/daily?vehicle_id=4&days=7')

    await api.getDailyStateBreakdown(4, 7, '2026-02-02')
    expect(requestMock).toHaveBeenLastCalledWith('/vehicle-states/daily?vehicle_id=4&start=2026-02-02')
  })
})
