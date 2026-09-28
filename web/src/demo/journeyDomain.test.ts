import { describe, expect, it } from 'vitest'
import type { Trip, TripDetail } from '@/api/types'
import type { JourneySession } from '@/api/hooks/useJourney'
import { charging, drives, vehicles } from './fixtures'
import { journeyDomain } from './journeyDomain'

function read(path: string) {
  const url = new URL(path, 'https://demo.invalid')
  return journeyDomain(url.pathname, url.searchParams)
}

describe('fictional journey history reads', () => {
  it('preserves each fixture drive as a dated SI trip with truthful charging totals', () => {
    const result = read('/trips')
    expect(result?.status).toBe(200)
    const trips = result?.body as Trip[]
    expect(trips).toHaveLength(drives.length)
    for (const trip of trips) {
      const detail = read(`/trips/${trip.id}`)
      expect(detail?.status).toBe(200)
      const body = detail?.body as TripDetail
      const drive = drives.find(row => row.id === body.drives[0]?.id)!
      const overlapping = charging.filter(row => row.vehicle_id === drive.vehicle_id
        && row.started_at >= drive.start_ts && row.ended_at <= drive.end_ts)
      expect(body).toMatchObject({
        ...trip, energy_used_wh: drive.energy_used_wh, drive_count: 1,
        total_distance_m: drive.distance_m, total_energy_wh: drive.energy_used_wh,
        total_duration_s: drive.duration_s, charge_count: overlapping.length,
        total_cost: overlapping.reduce((sum, row) => sum + row.cost_decimal, 0),
        drives: [{ id: drive.id, distance_m: drive.distance_m,
          energy_used_wh: drive.energy_used_wh, duration_s: drive.duration_s }],
      })
      expect(trip).not.toHaveProperty('drives')
      expect(trip).not.toHaveProperty('energy_used_wh')
    }
  })

  it('filters and paginates the trip list before the detail read', () => {
    for (const vehicle of vehicles) {
      const rows = drives.filter(row => row.vehicle_id === vehicle.id)
      const response = read(`/trips?vehicle_id=${vehicle.id}&limit=2&offset=1`)
      expect((response?.body as Trip[]).map(row => row.total_distance_m))
        .toEqual(rows.slice(1, 3).map(row => row.distance_m))
      expect(read(`/trips?vehicle_id=${vehicle.id}&start=${rows[0].start_ts}&end=${rows[0].start_ts}`)?.body)
        .toMatchObject([{ vehicle_id: vehicle.id, total_distance_m: rows[0].distance_m }])
      expect(read(`/trips?vehicle_id=${vehicle.id}&start=2000-01-01&end=2000-01-02`))
        .toEqual({ status: 200, body: [] })
    }
    expect(read('/trips/7')).toMatchObject({ status: 200, body: { id: 7 } })
  })

  it('does not claim recorded Autopilot check-ins for fictional planned sessions', () => {
    for (const vehicle of vehicles) {
      const list = read(`/journey/sessions?vehicle_id=${vehicle.id}`)
      expect(list?.status).toBe(200)
      const [session] = list?.body as JourneySession[]
      expect(session).toMatchObject({
        vehicle_id: vehicle.id, status: 'planned', plan_version: 0,
        started_at: null, ended_at: null,
      })
      const base = `/journey/sessions/${session.id}`
      expect(read(base)).toMatchObject({
        status: 200, body: { session, plans: [], next_statuses: ['active', 'aborted'] },
      })
      expect(read(`${base}/live`)).toMatchObject({
        status: 200, body: {
          session, latest: null, trail: [], progress: null,
          range: { verdict: 'unknown', need_wh: null },
        },
      })
      expect(read(`${base}/report`)).toMatchObject({
        status: 200, body: { session_id: session.id, distance_m: null, duration_s: null, plans: 0 },
      })
      expect(read(`${base}/replan`)).toMatchObject({
        status: 200, body: { deviation: { verdict: 'unknown', deviation_m: null } },
      })
      expect(read(`${base}/departure`)).toMatchObject({ status: 200, body: { slots: [], charge: null } })
      expect(read(`${base}/arrival`)).toMatchObject({ status: 200, body: { eta_at: null, moving: false } })
      expect(read(`${base}/nudge`)).toMatchObject({ status: 200, body: { verdict: 'unknown', blockers: [] } })
      expect(read(`${base}/checklist`)).toMatchObject({ status: 404 })
      expect(read(`/journey/sessions?vehicle_id=${vehicle.id}&status=active`))
        .toEqual({ status: 200, body: [] })
    }
  })

  it('computes scoped vehicle score and grouped route metrics from SI drives', () => {
    for (const vehicle of vehicles) {
      const rows = drives.filter(row => row.vehicle_id === vehicle.id)
      expect(read(`/drives/score?vehicle_id=${vehicle.id}`)).toMatchObject({
        status: 200, body: { total_drives: rows.length, trend: 'flat', speed_discipline: 100 },
      })
      const routes = (read(`/analytics/route-efficiency?vehicle_id=${vehicle.id}`)?.body as {
        routes: { trip_count: number; avg_efficiency: number; avg_distance_km: number }[]
      }).routes
      expect(routes.reduce((sum, row) => sum + row.trip_count, 0)).toBe(rows.length)
      expect(routes[0].avg_efficiency).toBeGreaterThan(0)
      expect(routes[0].avg_distance_km).toBeGreaterThan(0)
      expect((read(`/analytics/route-efficiency?vehicle_id=${vehicle.id}&start=2000-01-01&end=2000-01-02`)
        ?.body as { routes: unknown[] }).routes).toEqual([])
    }
  })

  it('rejects invalid IDs, dates and pagination without intercepting writes or other domains', () => {
    for (const path of [
      '/trips/0', '/trips/nope', '/trips/1.1', '/trips?vehicle_id=999',
      '/trips?vehicle_id=7&start=2026-02-30', '/trips?start=2026-02-30T12:00:00Z',
      '/trips?start=yesterday',
      '/trips?start=2026-09-28&end=2026-09-01', '/trips?offset=-1',
      '/trips?limit=0', '/journey/sessions', '/journey/sessions?vehicle_id=0',
      '/journey/sessions?vehicle_id=7&status=unknown',
      '/journey/sessions/0/live', '/drives/score?vehicle_id=999',
      '/analytics/route-efficiency?vehicle_id=NaN',
    ]) {
      expect(read(path)).toMatchObject({ status: 400, body: { code: 'INVALID_FILTER' } })
    }
    for (const path of ['/trips/999', '/journey/sessions/999', '/journey/sessions/999/report']) {
      expect(read(path)).toMatchObject({ status: 404, body: { code: 'DEMO_NOT_AVAILABLE' } })
    }
    for (const path of ['/drives/101', '/charging/201', '/journey/sessions/701/start',
      '/journey/sessions/701/plans', '/analytics/route-efficiency/detail', '/vehicles/7']) {
      expect(read(path)).toBeUndefined()
    }
  })
})
