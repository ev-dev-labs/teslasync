import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Contract tests for the analytics API surface (src/api/analytics.ts).
 *
 * Every exported helper is a thin, typed wrapper around the resilient
 * `request()` client. The behaviour that matters — and that silently
 * breaks in production when a query param drifts — is the exact path
 * string each helper builds. These tests pin, for all 19 exports:
 *
 *   • the endpoint path matches `internal/api/router.go` (no dead routes),
 *   • query params are snake_case (`vehicle_id`, never `vehicleId`),
 *   • no helper double-prefixes `/api/v1` (the client adds it),
 *   • default vs. explicit argument branches (days/start/limit/offset,
 *     optional vehicle filters, date ranges),
 *   • the resolved payload is passed through untouched.
 *
 * `request()` is mocked so nothing hits the network. We assert on the
 * path handed to it, matching the mock convention used by the sibling
 * hook tests (e.g. useAuthMode.test.tsx).
 */

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

import { request } from '@/api/client'
import {
  getBatteryDegradation,
  getBatteryReport,
  getChargingHeatmap,
  getDailyMileage,
  getEnergyStats,
  getFleetAnalytics,
  getMileageStats,
  getMonthlyMileage,
  getRegenStats,
  getRouteEfficiency,
  getRouteEfficiencyDetail,
  getSleepAnalytics,
  getSpeedProfile,
  getTCOAnalytics,
  getTemperatureImpact,
  getTrips,
  getVampireDrainEvents,
  getVampireDrainStats,
  getVisitedLocations,
} from './analytics'

const requestMock = vi.mocked(request)

/** Distinct, stable payload so pass-through can be asserted by identity. */
const RESPONSE = { ok: true }

/** The single path argument handed to `request()` on call `n` (default 0). */
function pathArg(n = 0): string {
  return requestMock.mock.calls[n]?.[0] ?? ''
}

beforeEach(() => {
  requestMock.mockReset()
  requestMock.mockResolvedValue(RESPONSE)
})

describe('vehicle-scoped analytics helpers', () => {
  it('getEnergyStats defaults to a trailing 30-day window', async () => {
    await getEnergyStats(7)
    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(requestMock).toHaveBeenCalledWith('/vehicles/7/energy?days=30')
  })

  it('getEnergyStats honours an explicit day count', async () => {
    await getEnergyStats(7, 90)
    expect(requestMock).toHaveBeenCalledWith('/vehicles/7/energy?days=90')
  })

  it('getEnergyStats prefers an explicit start over days', async () => {
    await getEnergyStats(7, 90, '2024-01-01')
    expect(requestMock).toHaveBeenCalledWith('/vehicles/7/energy?start=2024-01-01')
    expect(pathArg()).not.toContain('days=')
  })

  it('getBatteryReport targets the per-vehicle battery route and passes the payload through', async () => {
    await expect(getBatteryReport(7)).resolves.toBe(RESPONSE)
    expect(requestMock).toHaveBeenCalledWith('/vehicles/7/battery')
  })
})

describe('getFleetAnalytics', () => {
  it('defaults to a 30-day window with no explicit bounds', async () => {
    await getFleetAnalytics()
    expect(requestMock).toHaveBeenCalledWith('/analytics/fleet?days=30')
  })

  it('accepts a custom trailing window', async () => {
    await getFleetAnalytics(7)
    expect(requestMock).toHaveBeenCalledWith('/analytics/fleet?days=7')
  })

  it('prefers an explicit start bound over the day window', async () => {
    await getFleetAnalytics(30, '2024-02-15')
    expect(requestMock).toHaveBeenCalledWith('/analytics/fleet?start=2024-02-15')
    expect(pathArg()).not.toContain('days=')
  })
})

describe('single-vehicle analytics (snake_case vehicle_id query)', () => {
  const endpoints: Array<[string, (id: number) => Promise<unknown>, string]> = [
    ['getChargingHeatmap', getChargingHeatmap, '/analytics/charging-heatmap?vehicle_id=42'],
    ['getSpeedProfile', getSpeedProfile, '/analytics/speed-profile?vehicle_id=42'],
    ['getTemperatureImpact', getTemperatureImpact, '/analytics/temperature-impact?vehicle_id=42'],
    ['getRouteEfficiency', getRouteEfficiency, '/analytics/route-efficiency?vehicle_id=42'],
    ['getTCOAnalytics', getTCOAnalytics, '/analytics/tco?vehicle_id=42'],
    ['getRegenStats', getRegenStats, '/analytics/regen?vehicle_id=42'],
    ['getBatteryDegradation', getBatteryDegradation, '/analytics/battery-degradation?vehicle_id=42'],
    ['getMonthlyMileage', getMonthlyMileage, '/mileage/monthly?vehicle_id=42'],
    ['getMileageStats', getMileageStats, '/mileage/stats?vehicle_id=42'],
    ['getVampireDrainStats', getVampireDrainStats, '/vampire-drain/stats?vehicle_id=42'],
  ]

  it.each(endpoints)('%s issues exactly one GET to its route', async (_name, fn, url) => {
    await fn(42)
    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(requestMock).toHaveBeenCalledWith(url)
  })
})

describe('getRouteEfficiencyDetail', () => {
  it('URL-encodes vehicle_id, start and end in order', async () => {
    await getRouteEfficiencyDetail(3, '2024-01-01', '2024-02-01')
    expect(requestMock).toHaveBeenCalledWith(
      '/analytics/route-efficiency/detail?vehicle_id=3&start=2024-01-01&end=2024-02-01',
    )
  })

  it('escapes reserved characters in date bounds', async () => {
    await getRouteEfficiencyDetail(3, '2024-01-01T00:00:00Z', '2024-02-01T12:30:00Z')
    const path = pathArg()
    expect(path).toContain('start=2024-01-01T00%3A00%3A00Z')
    expect(path).toContain('end=2024-02-01T12%3A30%3A00Z')
  })
})

describe('getSleepAnalytics', () => {
  it('defaults to a 30-day sleep window', async () => {
    await getSleepAnalytics(5)
    expect(requestMock).toHaveBeenCalledWith('/analytics/sleep?vehicle_id=5&days=30')
  })

  it('honours a custom day count', async () => {
    await getSleepAnalytics(5, 14)
    expect(requestMock).toHaveBeenCalledWith('/analytics/sleep?vehicle_id=5&days=14')
  })
})

describe('mileage pagination', () => {
  it('getDailyMileage defaults to a full-year page', async () => {
    await getDailyMileage(9)
    expect(requestMock).toHaveBeenCalledWith('/mileage/daily?vehicle_id=9&limit=365&offset=0')
  })

  it('getDailyMileage threads explicit limit and offset', async () => {
    await getDailyMileage(9, 30, 60)
    expect(requestMock).toHaveBeenCalledWith('/mileage/daily?vehicle_id=9&limit=30&offset=60')
  })
})

describe('getVampireDrainEvents', () => {
  it('uses the backend-supported vehicle and limit parameters', async () => {
    await getVampireDrainEvents(11)
    const path = pathArg()
    expect(path).toBe('/vampire-drain?vehicle_id=11&limit=100')
    expect(path).not.toContain('offset=')
  })

  it('unwraps the canonical response envelope', async () => {
    const event = { started_at: '2024-01-01T00:00:00Z', drain_pct_per_day: 1 }
    requestMock.mockResolvedValueOnce({ vehicle_id: 11, events: [event] })
    await expect(getVampireDrainEvents(11, 25)).resolves.toEqual([event])
    expect(requestMock).toHaveBeenCalledWith('/vampire-drain?vehicle_id=11&limit=25')
  })
})

describe('getVisitedLocations', () => {
  it('omits the vehicle filter when no vehicle is given', async () => {
    await getVisitedLocations()
    const path = pathArg()
    expect(path).toBe('/locations?limit=100&offset=0')
    expect(path).not.toContain('vehicle_id')
  })

  it('includes the vehicle filter and custom paging when provided', async () => {
    await getVisitedLocations(4, 20, 5)
    expect(requestMock).toHaveBeenCalledWith('/locations?vehicle_id=4&limit=20&offset=5')
  })
})

describe('getTrips', () => {
  it('requests the trips route with default paging and no filters', async () => {
    await getTrips()
    const path = pathArg()
    expect(path).toBe('/trips?limit=50&offset=0')
    expect(path).not.toContain('vehicle_id')
    expect(path).not.toContain('start=')
  })

  it('adds vehicle_id and the date range when all filters are supplied', async () => {
    await getTrips(9, 5, 10, '2024-03-01', '2024-03-31')
    expect(requestMock).toHaveBeenCalledWith(
      '/trips?limit=5&offset=10&vehicle_id=9&start=2024-03-01&end=2024-03-31',
    )
  })

  it('includes only the vehicle filter when the range is omitted', async () => {
    await getTrips(9)
    const path = pathArg()
    expect(path).toContain('vehicle_id=9')
    expect(path).not.toContain('start=')
    expect(path).not.toContain('end=')
  })
})

describe('cross-cutting URL invariants', () => {
  const invocations: Array<[string, () => Promise<unknown>]> = [
    ['getEnergyStats', () => getEnergyStats(1, 30, '2024-01-01')],
    ['getBatteryReport', () => getBatteryReport(1)],
    ['getFleetAnalytics', () => getFleetAnalytics(1)],
    ['getChargingHeatmap', () => getChargingHeatmap(1)],
    ['getSpeedProfile', () => getSpeedProfile(1)],
    ['getTemperatureImpact', () => getTemperatureImpact(1)],
    ['getRouteEfficiency', () => getRouteEfficiency(1)],
    ['getRouteEfficiencyDetail', () => getRouteEfficiencyDetail(1, 'a', 'b')],
    ['getTCOAnalytics', () => getTCOAnalytics(1)],
    ['getSleepAnalytics', () => getSleepAnalytics(1)],
    ['getRegenStats', () => getRegenStats(1)],
    ['getBatteryDegradation', () => getBatteryDegradation(1)],
    ['getDailyMileage', () => getDailyMileage(1)],
    ['getMonthlyMileage', () => getMonthlyMileage(1)],
    ['getMileageStats', () => getMileageStats(1)],
    ['getVampireDrainEvents', () => getVampireDrainEvents(1)],
    ['getVampireDrainStats', () => getVampireDrainStats(1)],
    ['getVisitedLocations', () => getVisitedLocations(1)],
    ['getTrips', () => getTrips(1)],
  ]

  it('covers every exported helper in this suite', () => {
    expect(invocations).toHaveLength(19)
  })

  it.each(invocations)('%s builds a relative path without an /api/v1 prefix', async (_name, call) => {
    await call()
    const path = pathArg()
    expect(path.startsWith('/')).toBe(true)
    expect(path).not.toContain('/api/v1')
  })

  it.each(invocations)('%s never emits a camelCase vehicleId query param', async (_name, call) => {
    await call()
    expect(pathArg()).not.toMatch(/vehicleId=/)
  })
})
