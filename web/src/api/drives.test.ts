// Behavioural tests for the drives data-access module (src/api/drives.ts).
//
// This file is a pure data layer — four thin wrappers over the resilient
// `request()` client. There is no rendered DOM, so the user-interaction /
// a11y facets of the elevation brief do not apply here (see the identical
// rationale in useDriving.test.tsx). Instead every export is exercised for
// the facets that DO matter for an API helper:
//
//   • exact request URL — no `/api/v1` double-prefix, snake_case query
//     params (`vehicle_id`, not `vehicleId`), correct path segments;
//   • query-string assembly — defaults, explicit pagination, and the
//     conditional `start`/`end` branches (present, omitted, AND empty-string
//     falsy) so both sides of every `if` are covered;
//   • payload passthrough — the resolved value is returned verbatim, by
//     reference, with the correct static type;
//   • failure propagation — a rejected `request()` surfaces to the caller;
//   • call shape — each helper hits `request()` exactly once with a single
//     argument (no stray options object that could leak headers/verbs).
//
// Network is mocked at the `request` boundary (repo convention). drives.ts
// imports `request` from './client', which resolves to the same module as
// '@/api/client', so mocking the aliased id intercepts it.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

import { request } from '@/api/client'
import type { Drive, Position, DriveTelemetryReading } from '@/api/types'
import { getDrives, getDrive, getDrivePositions, getDriveTelemetry } from './drives'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

/** The URL (first arg) passed to the Nth mocked request call. */
function url(n = 0): string {
  return mockedRequest.mock.calls[n]?.[0] as string
}

function makeDrive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 42,
    vehicle_id: 1,
    start_ts: '2025-01-01T10:00:00Z',
    end_ts: '2025-01-01T10:30:00Z',
    duration_s: 1800,
    distance_m: 25000,
    start_address: 'Home',
    end_address: 'Office',
    start_lat: 37.1,
    start_lon: -122.1,
    end_lat: 37.4,
    end_lon: -122.0,
    start_soc_pct: 82,
    end_soc_pct: 68,
    energy_used_wh: 6200,
    regen_energy_wh: 850,
    avg_speed_mps: 13.9,
    max_speed_mps: 31.3,
    avg_power_w: 12400,
    outside_temp_avg_c: 12.5,
    inside_temp_avg_c: 21,
    score: 94,
    ended_status: 'completed',
    created_at: '2025-01-01T10:30:05Z',
    updated_at: '2025-01-01T10:30:05Z',
    ...overrides,
  }
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    vehicle_id: 1,
    ts: '2025-01-01T10:05:00Z',
    latitude: 37.2,
    longitude: -122.05,
    heading: 180,
    speed_mph: 34,
    elevation_m: 55,
    gps_state: 'good',
    source: 'telemetry',
    ...overrides,
  }
}

function makeTelemetry(overrides: Partial<DriveTelemetryReading> = {}): DriveTelemetryReading {
  return {
    id: 9001,
    drive_id: 9,
    vehicle_id: 1,
    latitude: 37.2,
    longitude: -122.05,
    elevation: 55,
    heading: 180,
    odometer: 123456,
    speed: 34,
    power: 42,
    battery_level: 74,
    soc: 74,
    usable_soc: 73,
    rated_range: 300,
    ideal_range: 320,
    est_range: 280,
    inside_temp: 21,
    outside_temp: 12,
    driver_temp: 21,
    passenger_temp: 21,
    fan_status: 3,
    is_climate_on: true,
    tire_pressure_fl: 2.9,
    tire_pressure_fr: 2.9,
    tire_pressure_rl: 2.8,
    tire_pressure_rr: 2.8,
    battery_heater_on: false,
    created_at: '2025-01-01T10:05:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  mockedRequest.mockReset()
})

// ---------------------------------------------------------------------------
// getDrives — paginated, date-filterable list
// ---------------------------------------------------------------------------

describe('getDrives', () => {
  it('builds the default paginated query with snake_case params', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getDrives(1)
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(url()).toBe('/drives?vehicle_id=1&limit=50&offset=0')
  })

  it('honours explicit limit/offset and appends start + end in order', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getDrives(2, 10, 20, '2025-01-01', '2025-01-31')
    expect(url()).toBe('/drives?vehicle_id=2&limit=10&offset=20&start=2025-01-01&end=2025-01-31')
  })

  it('appends only start when end is omitted', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getDrives(5, 50, 0, '2025-02-01')
    expect(url()).toBe('/drives?vehicle_id=5&limit=50&offset=0&start=2025-02-01')
    expect(url()).not.toContain('end=')
  })

  it('appends only end when start is omitted', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getDrives(6, 50, 0, undefined, '2025-02-28')
    expect(url()).toBe('/drives?vehicle_id=6&limit=50&offset=0&end=2025-02-28')
    expect(url()).not.toContain('start=')
  })

  it('treats empty-string start/end as absent (falsy branch)', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getDrives(4, 50, 0, '', '')
    expect(url()).toBe('/drives?vehicle_id=4&limit=50&offset=0')
  })

  it('never double-prefixes /api/v1 and uses snake_case, not camelCase, params', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getDrives(7)
    expect(url()).not.toContain('/api/v1')
    expect(url().startsWith('/drives?')).toBe(true)
    expect(url()).toContain('vehicle_id=7')
    expect(url()).not.toMatch(/vehicleId=/)
  })

  it('returns the resolved payload verbatim (by reference) with the Drive[] type', async () => {
    const rows: Drive[] = [makeDrive({ id: 9 }), makeDrive({ id: 10 })]
    mockedRequest.mockResolvedValueOnce(rows)
    const result: Drive[] = await getDrives(3)
    expect(result).toBe(rows)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe(9)
  })

  it('propagates a rejected request to the caller', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('drives list failed'))
    await expect(getDrives(1)).rejects.toThrow('drives list failed')
  })
})

// ---------------------------------------------------------------------------
// getDrive — single detail
// ---------------------------------------------------------------------------

describe('getDrive', () => {
  it('requests the id-scoped detail path with a single argument', async () => {
    mockedRequest.mockResolvedValueOnce(makeDrive({ id: 42 }))
    await getDrive(42)
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(mockedRequest).toHaveBeenCalledWith('/drives/42')
    expect(mockedRequest.mock.calls[0]).toHaveLength(1)
  })

  it('resolves to the drive payload', async () => {
    const drive = makeDrive({ id: 77, score: 88 })
    mockedRequest.mockResolvedValueOnce(drive)
    const result: Drive = await getDrive(77)
    expect(result).toEqual(drive)
    expect(result.score).toBe(88)
  })

  it('propagates errors (e.g. 404) from request', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('not found'))
    await expect(getDrive(999)).rejects.toThrow('not found')
  })
})

// ---------------------------------------------------------------------------
// getDrivePositions — GPS track for a drive
// ---------------------------------------------------------------------------

describe('getDrivePositions', () => {
  it('requests the /positions sub-resource for the drive', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getDrivePositions(7)
    expect(mockedRequest).toHaveBeenCalledWith('/drives/7/positions')
    expect(url()).not.toContain('/api/v1')
  })

  it('returns the position array verbatim', async () => {
    const positions: Position[] = [makePosition(), makePosition({ ts: '2025-01-01T10:06:00Z' })]
    mockedRequest.mockResolvedValueOnce(positions)
    const result: Position[] = await getDrivePositions(7)
    expect(result).toBe(positions)
    expect(result).toHaveLength(2)
  })

  it('propagates request failures', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('positions unavailable'))
    await expect(getDrivePositions(7)).rejects.toThrow('positions unavailable')
  })
})

// ---------------------------------------------------------------------------
// getDriveTelemetry — detailed telemetry readings for a drive
// ---------------------------------------------------------------------------

describe('getDriveTelemetry', () => {
  it('requests the /telemetry sub-resource for the drive', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getDriveTelemetry(9)
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(mockedRequest).toHaveBeenCalledWith('/drives/9/telemetry')
  })

  it('returns the telemetry readings verbatim', async () => {
    const readings: DriveTelemetryReading[] = [makeTelemetry(), makeTelemetry({ id: 9002 })]
    mockedRequest.mockResolvedValueOnce(readings)
    const result: DriveTelemetryReading[] = await getDriveTelemetry(9)
    expect(result).toBe(readings)
    expect(result[1]?.id).toBe(9002)
  })

  it('propagates request failures', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('telemetry unavailable'))
    await expect(getDriveTelemetry(9)).rejects.toThrow('telemetry unavailable')
  })
})
