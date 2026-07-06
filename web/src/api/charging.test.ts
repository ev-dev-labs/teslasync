// Unit tests for the charging API fetchers (api/charging.ts).
//
// Covers EVERY export of the module:
//   - getChargingSessions: snake_case query-string construction, default
//     vs. explicit pagination, start/end range encoding + branch guards,
//     AbortSignal threading, response passthrough, and error propagation.
//   - getChargingSession:  by-id path shape, signal threading, passthrough,
//     and error propagation.
//   - getChargeTelemetry:  telemetry sub-path shape, signal threading,
//     empty-list passthrough, and error propagation.
//
// Network is stubbed at the request() boundary (never hits real fetch),
// following the same convention as api/hooks/useCharging.test.tsx. The
// test lives beside the source so the Apex gate's path-scoped lookup finds
// it as `api/charging.test.ts`.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ChargingSession, ChargeTelemetryReading } from './types'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return { ...actual, request: vi.fn() }
})

import { request, ApiError } from './client'
import { getChargingSessions, getChargingSession, getChargeTelemetry } from './charging'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

/** Minimal but shape-accurate ChargingSession fixture. */
function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 5,
    started_at: '2024-01-01T00:00:00Z',
    ended_at: '2024-01-01T01:00:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 42000,
    peak_power_w: 11000,
    avg_power_w: 9000,
    cost_decimal: null,
    cost_currency: null,
    charger_type: 'AC',
    cable_type: null,
    startedAt: '2024-01-01T00:00:00Z',
    duration_min: 60,
    ...overrides,
  }
}

/** Minimal but shape-accurate ChargeTelemetryReading fixture. */
function makeReading(overrides: Partial<ChargeTelemetryReading> = {}): ChargeTelemetryReading {
  return {
    session_id: 7,
    vehicle_id: 5,
    ts: '2024-01-01T00:00:30Z',
    ac_charging_power_w: 7000,
    dc_charging_power_w: null,
    ac_charging_energy_in_wh: 120,
    dc_charging_energy_in_wh: null,
    charger_voltage_v: 240,
    charger_actual_current_a: 30,
    charger_pilot_current_a: 32,
    charger_phases: 1,
    battery_heater_on: false,
    battery_heater_power_w: null,
    charge_limit_soc_pct: 80,
    charge_request: null,
    fast_charger_type: null,
    charging_cable_type: null,
    charge_port_door_open: true,
    ...overrides,
  } as ChargeTelemetryReading
}

beforeEach(() => {
  mockedRequest.mockReset()
})

// ---------------------------------------------------------------------------
// getChargingSessions
// ---------------------------------------------------------------------------

describe('getChargingSessions', () => {
  it('builds the default snake_case query string with no signal', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getChargingSessions(5)
    const [url, opts] = mockedRequest.mock.calls[0]
    expect(url).toBe('/charging?vehicle_id=5&limit=50&offset=0')
    // Backend expects snake_case params, and the client auto-adds /api/v1.
    expect(url).not.toContain('vehicleId')
    expect(url).not.toMatch(/^\/api\/v1/)
    expect(opts.signal).toBeUndefined()
  })

  it('honours explicit limit and offset over the defaults', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getChargingSessions(9, 10, 20)
    expect(mockedRequest.mock.calls[0][0]).toBe('/charging?vehicle_id=9&limit=10&offset=20')
  })

  it('falls back to the defaults when limit/offset are passed as undefined', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getChargingSessions(3, undefined, undefined)
    expect(mockedRequest.mock.calls[0][0]).toBe('/charging?vehicle_id=3&limit=50&offset=0')
  })

  it('appends and URL-encodes the start/end range', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getChargingSessions(9, 10, 20, '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z')
    expect(mockedRequest.mock.calls[0][0]).toBe(
      '/charging?vehicle_id=9&limit=10&offset=20&start=2024-01-01T00%3A00%3A00Z&end=2024-02-01T00%3A00%3A00Z',
    )
  })

  it('sets only the bound that is supplied (start omitted)', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getChargingSessions(1, 5, 0, undefined, '2024-02-01')
    const url = mockedRequest.mock.calls[0][0]
    expect(url).toContain('end=2024-02-01')
    expect(url).not.toContain('start=')
  })

  it('omits an empty-string bound instead of sending a blank filter', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getChargingSessions(1, 5, 0, '', '')
    const url = mockedRequest.mock.calls[0][0]
    expect(url).not.toContain('start=')
    expect(url).not.toContain('end=')
  })

  it('threads the AbortSignal through to request()', async () => {
    mockedRequest.mockResolvedValueOnce([])
    const ctrl = new AbortController()
    await getChargingSessions(5, 50, 0, undefined, undefined, { signal: ctrl.signal })
    expect(mockedRequest.mock.calls[0][1]).toEqual({ signal: ctrl.signal })
  })

  it('resolves with the parsed session array from request()', async () => {
    const sessions = [makeSession({ id: 1 }), makeSession({ id: 2 })]
    mockedRequest.mockResolvedValueOnce(sessions)
    await expect(getChargingSessions(5)).resolves.toEqual(sessions)
  })

  it('propagates a request() rejection to the caller', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('boom', 500))
    await expect(getChargingSessions(5)).rejects.toBeInstanceOf(ApiError)
  })
})

// ---------------------------------------------------------------------------
// getChargingSession
// ---------------------------------------------------------------------------

describe('getChargingSession', () => {
  it('requests the by-id detail path', async () => {
    mockedRequest.mockResolvedValueOnce(makeSession({ id: 42 }))
    await getChargingSession(42)
    const [url, opts] = mockedRequest.mock.calls[0]
    expect(url).toBe('/charging/42')
    expect(opts.signal).toBeUndefined()
  })

  it('threads the AbortSignal through to request()', async () => {
    mockedRequest.mockResolvedValueOnce(makeSession())
    const ctrl = new AbortController()
    await getChargingSession(42, { signal: ctrl.signal })
    expect(mockedRequest.mock.calls[0][1]).toEqual({ signal: ctrl.signal })
  })

  it('resolves with the parsed session', async () => {
    const session = makeSession({ id: 42, live: true })
    mockedRequest.mockResolvedValueOnce(session)
    await expect(getChargingSession(42)).resolves.toEqual(session)
  })

  it('propagates a not-found error from request()', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('not found', 404))
    await expect(getChargingSession(999)).rejects.toMatchObject({ status: 404 })
  })
})

// ---------------------------------------------------------------------------
// getChargeTelemetry
// ---------------------------------------------------------------------------

describe('getChargeTelemetry', () => {
  it('requests the telemetry sub-path for the session', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getChargeTelemetry(7)
    const [url, opts] = mockedRequest.mock.calls[0]
    expect(url).toBe('/charging/7/telemetry')
    expect(opts.signal).toBeUndefined()
  })

  it('threads the AbortSignal through to request()', async () => {
    mockedRequest.mockResolvedValueOnce([])
    const ctrl = new AbortController()
    await getChargeTelemetry(7, { signal: ctrl.signal })
    expect(mockedRequest.mock.calls[0][1]).toEqual({ signal: ctrl.signal })
  })

  it('resolves with the parsed telemetry readings', async () => {
    const readings = [makeReading({ ts: '2024-01-01T00:00:30Z' })]
    mockedRequest.mockResolvedValueOnce(readings)
    await expect(getChargeTelemetry(7)).resolves.toEqual(readings)
  })

  it('passes an empty telemetry list straight through', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await expect(getChargeTelemetry(7)).resolves.toEqual([])
  })

  it('propagates a request() rejection to the caller', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('upstream broke', 502))
    await expect(getChargeTelemetry(7)).rejects.toThrow(/upstream broke/i)
  })
})
