import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from '@/api/client'
import { resilientFetch } from '@/lib/resilience'
import { demoResponse } from './fixtureApi'
import type { FleetAnalytics, LocationSnapshot } from '@/api/types'
import type { DailyMileageResponse, MileageStats, MonthlyMileageResponse } from '@/types/analytics'
import type { DrivingStats } from '@/types/driving'
import type { FsdInsights } from '@/types/fsd'
import type { SharedDriveData, ShareToken } from '@/types/sharing'
import { charging, drives, vehicles } from './fixtures'

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.stubEnv('VITE_DEMO_API_BASE', '/demo-api/v1')
  vi.stubEnv('VITE_DEMO_STATIC_FIXTURES', 'true')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('static public demo', () => {
  it('keeps fictional share lists and the public report consistent with the drive', async () => {
    const shares = await request<ShareToken[]>(`/drives/${drives[0].id}/shares`)
    expect(shares).toHaveLength(1)
    const report = await request<SharedDriveData>(`/share/${shares[0].token}`)
    expect(report.payload_version).toBe('v2')
    expect(report.drive.distance_m).toBe(drives[0].distance_m)
    expect(report.drive.duration_s).toBe(drives[0].duration_s)
    expect(report.map_points).toHaveLength(2)
    expect(report.speed_profile).toHaveLength(3)
    expect(report.telemetry?.[1].battery_level).toBe(drives[0].end_soc_pct)
    expect((await request<ShareToken[]>(`/charging/${charging[0].id}/shares`)))
      .toHaveLength(1)
    expect(demoResponse('/share/unknown', 'GET').status).toBe(404)
    expect(demoResponse('/drives/999/shares', 'GET').status).toBe(404)
  })

  it('uses each vehicle last fictional drive for its last-known parked position', async () => {
    for (const vehicle of vehicles) {
      const lastDrive = drives.find(row => row.vehicle_id === vehicle.id)!
      const snapshot = await request<LocationSnapshot>(
        `/location-snapshots/latest?vehicle_id=${vehicle.id}`,
      )
      expect(snapshot.latitude).toBe(lastDrive.end_lat)
      expect(snapshot.longitude).toBe(lastDrive.end_lon)
      expect(snapshot.created_at).toBe(lastDrive.end_ts)
      expect(snapshot.destination_name).toBeUndefined()
      expect(snapshot.minutes_to_arrival).toBeUndefined()
    }
    expect(demoResponse('/location-snapshots/latest?vehicle_id=999', 'GET').status).toBe(400)
  })

  it('derives the navigation timeline and map trail from the same fictional drives', async () => {
    const snapshots = await request<LocationSnapshot[]>('/location-snapshots?vehicle_id=7&limit=200')
    const positions = await request<(LocationSnapshot & { ts: string; speed: number })[]>(
      '/vehicles/7/positions?limit=50',
    )
    const source = drives.filter(row => row.vehicle_id === 7)
    expect(snapshots).toHaveLength(source.length * 2)
    expect(positions).toHaveLength(source.length * 2)
    expect(snapshots[0].created_at).toBe(source[0].end_ts)
    expect(snapshots.map(row => row.created_at))
      .toEqual(positions.map(row => row.ts))
    expect(positions[0].speed).toBe(0)
    expect((await request<LocationSnapshot[]>('/vehicles/7/positions?limit=1')))
      .toHaveLength(1)
    expect(demoResponse('/location-snapshots?vehicle_id=7&limit=0', 'GET').status).toBe(400)
    expect(demoResponse('/vehicles/7/positions?days=0', 'GET').status).toBe(400)
    expect(demoResponse('/vehicles/999/positions', 'GET').status).toBe(404)
  })

  it('aggregates visited locations from finished synthetic drives before paginating', async () => {
    const all = await request<{
      vehicle_id: number; address_name: string; visit_count: number;
      total_duration_s: number; last_visited: string;
    }[]>('/locations')
    expect(all.reduce((count, place) => count + place.visit_count, 0)).toBe(drives.length)
    expect(all.every(place => place.address_name === 'Sample City Center')).toBe(true)
    for (const vehicle of vehicles) {
      const places = await request<typeof all>(`/locations?vehicle_id=${vehicle.id}`)
      expect(places.reduce((count, place) => count + place.visit_count, 0))
        .toBe(drives.filter(row => row.vehicle_id === vehicle.id).length)
    }
    const page = await request<typeof all>('/locations?limit=1&offset=1')
    expect(page).toEqual(all.slice(1, 2))
    const future = await request<typeof all>(
      '/locations?from=2030-01-01T00%3A00%3A00Z&to=2030-01-02T00%3A00%3A00Z',
    )
    expect(future).toHaveLength(0)
    expect(demoResponse('/locations?vehicle_id=999', 'GET').status).toBe(400)
    expect(demoResponse('/locations?from=bad&to=2030-01-02', 'GET').status).toBe(400)
  })

  it('serves measured fictional FSD counter evidence without inventing absent measurements', async () => {
    const fsd = await request<FsdInsights>('/analytics/fsd?vehicle_id=7&days=30&timezone=UTC')
    expect(fsd.totals.fsd_distance_m).toBeGreaterThan(0)
    expect(fsd.quality.fsd_distance_derivable).toBe(true)
    expect(fsd.quality.fsd_sample_count).toBeGreaterThan(0)
    expect(fsd.daily).toHaveLength(30)
    expect(fsd.daily.some(day => day.fsd_distance_m === null)).toBe(true)
    expect(fsd.drive_analytics.contributing_drives.some(row =>
      row.fsd_distance_m == null)).toBe(true)
    const focused = await request<FsdInsights>(
      '/analytics/fsd?vehicle_id=7&drive_id=102&include_evidence=true',
    )
    expect(focused.drive_analytics.contributing_drives).toHaveLength(1)
    expect(focused.drive_analytics.contributing_drives[0].drive_id).toBe(102)
    expect(focused.drive_analytics.contributing_drives[0].evidence[0]?.approximate).toBe(true)
    expect(demoResponse('/analytics/fsd?vehicle_id=7&drive_id=999', 'GET').status).toBe(400)
    expect(demoResponse('/analytics/fsd?vehicle_id=7&timezone=Bad%2FZone', 'GET').status).toBe(400)
  })

  it('uses the same drives for mileage lifetime, monthly and daily series', async () => {
    const stats = await request<MileageStats>('/mileage/stats?vehicle_id=7')
    const months = await request<MonthlyMileageResponse>('/mileage/monthly?vehicle_id=7')
    const days = await request<DailyMileageResponse>('/mileage/daily?vehicle_id=7&days=90')
    const source = drives.filter(row => row.vehicle_id === 7)
    expect(stats.drive_count_lifetime).toBe(source.length)
    expect(stats.lifetime_km).toBeCloseTo(
      source.reduce((sum, row) => sum + row.distance_m, 0) / 1000,
    )
    expect(months.months.reduce((sum, row) => sum + row.drive_count, 0)).toBe(source.length)
    expect(days.days.reduce((sum, row) => sum + row.drive_count, 0)).toBe(source.length)
    expect(months.months[0].total_wh_consumed).toBe(
      source.reduce((sum, row) => sum + row.energy_used_wh, 0),
    )
    expect(days.days.every(row => row.end_odometer_km != null)).toBe(true)
    expect(days.days.at(-1)?.end_odometer_km).toBeCloseTo(32_100)
    expect(source.every(row =>
      row.end_odometer_m - row.start_odometer_m === row.distance_m)).toBe(true)
    expect(charging.every(row => row.start_odometer_m === row.end_odometer_m)).toBe(true)
    expect(source.every(row => Math.abs(row.avg_speed_mps * row.duration_s - row.distance_m) < 1))
      .toBe(true)
    expect(charging.every(row =>
      row.avg_power_w <= row.peak_power_w
      && row.avg_power_w * (Date.parse(row.ended_at) - Date.parse(row.started_at)) / 3_600_000
        === row.total_energy_added_wh)).toBe(true)
    expect(demoResponse('/mileage/stats?vehicle_id=999', 'GET').status).toBe(400)
    expect(demoResponse('/mileage/daily?vehicle_id=7&days=0', 'GET').status).toBe(400)
    expect(demoResponse('/mileage/monthly?vehicle_id=7&months=121', 'GET').status).toBe(400)
  })

  it('summarizes driving stats from actual synthetic distance, energy and regen', async () => {
    const stats = await request<DrivingStats>('/drives/stats?vehicle_id=7')
    const mileage = await request<MileageStats>('/mileage/stats?vehicle_id=7')
    const rows = drives.filter(row => row.vehicle_id === 7)
    expect(stats.totalDrives).toBe(mileage.drive_count_lifetime)
    expect(stats.totalDistanceKm).toBeCloseTo(mileage.lifetime_km)
    expect(stats.regenEnergyWh).toBe(
      rows.reduce((sum, row) => sum + row.regen_energy_wh, 0),
    )
    expect(stats.avgEfficiencyWhKm * stats.totalDistanceKm).toBeCloseTo(
      rows.reduce((sum, row) => sum + row.energy_used_wh, 0),
    )
    expect(demoResponse('/drives/stats?vehicle_id=999', 'GET').status).toBe(400)
  })

  it('builds state dwell and transition history from fictional drive and charge events', async () => {
    const timeline = await request<{
      vehicle_id: number; transitions: { ts: string; from_state: string; to_state: string }[];
    }>('/vehicle-states/timeline?vehicle_id=7&days=30')
    const summary = await request<{
      total_seconds: number; by_state: {
        state: string; total_seconds: number; percentage: number; transition_count: number;
      }[];
    }>('/vehicle-states/summary?vehicle_id=7&days=30')
    expect(timeline.transitions).toHaveLength(
      2 * (drives.filter(row => row.vehicle_id === 7).length
        + charging.filter(row => row.vehicle_id === 7).length),
    )
    expect(timeline.transitions.map(row => row.ts))
      .toEqual([...timeline.transitions.map(row => row.ts)].sort())
    expect(timeline.transitions.filter(row => row.to_state === 'driving')).toHaveLength(
      drives.filter(row => row.vehicle_id === 7).length,
    )
    expect(summary.by_state.map(row => row.state)).toContain('driving')
    expect(summary.by_state.map(row => row.state)).toContain('charging')
    expect(summary.by_state.reduce((sum, row) => sum + row.total_seconds, 0))
      .toBeCloseTo(summary.total_seconds)
    expect(summary.by_state.reduce((sum, row) => sum + row.percentage, 0)).toBeCloseTo(100)
    expect(demoResponse('/vehicle-states/summary?vehicle_id=999', 'GET').status).toBe(400)
    expect(demoResponse('/vehicle-states/summary?vehicle_id=7&days=0', 'GET').status).toBe(400)
  })

  it('builds fleet analytics charts and quick stats from the same synthetic history', async () => {
    const fleet = await request<FleetAnalytics>('/analytics/fleet?days=30')
    expect(fleet.total_vehicles).toBe(vehicles.length)
    expect(fleet.total_drives).toBe(drives.length)
    expect(fleet.total_charging_sessions).toBe(charging.length)
    expect(fleet.total_distance_km).toBeCloseTo(
      Math.round(drives.reduce((sum, row) => sum + row.distance_m, 0) / 100) / 10,
    )
    expect(fleet.total_energy_kwh).toBeCloseTo(
      charging.reduce((sum, row) => sum + row.total_energy_added_wh, 0) / 1000,
    )
    expect(fleet.vehicle_comparison.map(row => row.drives).reduce((a, b) => a + b, 0))
      .toBe(fleet.total_drives)
    expect(fleet.drive_analytics.hourly_pattern.reduce((sum, row) => sum + row.drives, 0))
      .toBe(fleet.total_drives)
    expect(fleet.drive_analytics.daily_trend.reduce((sum, row) => sum + row.drives, 0))
      .toBe(fleet.total_drives)
    expect(fleet.charging_analytics.monthly_trend.reduce((sum, row) => sum + row.sessions, 0))
      .toBe(fleet.total_charging_sessions)
    expect(fleet.battery_trend.length).toBeGreaterThan(0)
    expect(fleet.most_efficient_vehicle?.id).toBeOneOf(vehicles.map(row => row.id))

    const date = drives[0].start_ts
    const scoped = await request<FleetAnalytics>(`/analytics/fleet?start=${encodeURIComponent(date)}&end=${encodeURIComponent(date)}`)
    expect(scoped.total_drives).toBe(1)
    expect(scoped.total_distance_km).toBeCloseTo(drives[0].distance_m / 1000)
    expect(scoped.total_charging_sessions).toBe(0)
    expect(scoped.charging_analytics.monthly_trend).toHaveLength(0)
    const outsideHistory = await request<FleetAnalytics>(
      '/analytics/fleet?start=2020-01-01T00%3A00%3A00Z&end=2020-01-02T00%3A00%3A00Z',
    )
    expect(outsideHistory.total_drives).toBe(0)
    expect(outsideHistory.total_energy_kwh).toBe(0)
    expect(outsideHistory.drive_analytics.daily_trend).toHaveLength(0)
    expect(outsideHistory.drive_analytics.distance_stats.count).toBe(0)
    expect(outsideHistory.battery_trend).toHaveLength(0)
    expect(demoResponse('/analytics/fleet?days=0', 'GET').status).toBe(400)
    expect(demoResponse('/analytics/fleet?start=bad', 'GET').status).toBe(400)
    expect(demoResponse('/analytics/fleet?start=2030-01-02&end=2030-01-01', 'GET').status).toBe(400)
  })

  it('derives scoped period comparisons from observed demo drives and charging', async () => {
    const stats = await request<{
      total_distance: number; total_drives: number; energy_used: number;
      avg_efficiency: number; total_cost: number; co2_saved: number;
    }>('/analytics/period-stats?vehicle_id=7&days=30')
    const sourceDrives = drives.filter(row => row.vehicle_id === 7)
    const sourceCharges = charging.filter(row => row.vehicle_id === 7)
    expect(stats.total_drives).toBe(sourceDrives.length)
    expect(stats.total_distance).toBeCloseTo(
      sourceDrives.reduce((sum, row) => sum + row.distance_m, 0) / 1000,
    )
    expect(stats.energy_used).toBeCloseTo(
      sourceCharges.reduce((sum, row) => sum + row.total_energy_added_wh, 0) / 1000,
    )
    expect(stats.co2_saved).toBeCloseTo(stats.total_distance * 0.120, 1)
    expect(demoResponse('/analytics/period-stats?vehicle_id=99', 'GET').status).toBe(400)
  })

  it('loads filtered synthetic history without a network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const vehicles = await request<{ id: number }[]>('/vehicles')
    expect(vehicles).toHaveLength(2)
    const drives = await request<{ vehicle_id: number; distance_m: number }[]>(
      '/drives?vehicle_id=7&limit=2&offset=1',
    )
    expect(drives).toHaveLength(2)
    expect(drives.every(drive => drive.vehicle_id === 7 && drive.distance_m > 0)).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps setup bypass separate from Tesla connectivity', async () => {
    const setup = await request<{
      setup_complete: boolean; tesla_connected: boolean; vehicle_count: number;
    }>('/onboarding/status')
    expect(setup.setup_complete).toBe(true)
    expect(setup.tesla_connected).toBe(false)
    expect(setup.vehicle_count).toBe(2)
  })

  it('serves a consistent synthetic alert, notification, and demo-only runtime status', async () => {
    const alerts = await request<{ id: number; vehicle_id: number; title: string }[]>('/alerts?vehicle_id=7')
    const logs = await request<{ alert_id: number; title: string }[]>('/notifications/logs?read=false&archived=false')
    const unread = await request<{ count: number }>('/notifications/unread-count')
    const status = await request<{ components: { name: string }[] }>('/status/')
    const repair = await request<{ total: number; open: number }>('/data-repair/cases/stats')
    expect(alerts).toHaveLength(1)
    expect(logs).toMatchObject([{ alert_id: alerts[0].id, title: alerts[0].title }])
    expect(unread.count).toBe(logs.length)
    expect(await request('/notifications/logs?count_only=true')).toEqual({ total: logs.length })
    expect(await request('/notifications/logs?grouped=true')).toMatchObject([{
      group_key: null, latest: { id: 401 }, count: 1, unread_count: 1,
    }])
    expect(status.components.map(component => component.name)).toEqual(['Synthetic fixture viewer'])
    expect(repair).toMatchObject({ total: 0, open: 0 })
    expect(demoResponse('/alerts?vehicle_id=999', 'GET').status).toBe(400)
  })

  it('keeps each supported dashboard widget scoped to a fictional vehicle', async () => {
    const climate = await request<{ vehicle_id: number; inside_temp_c: number }>(
      '/climate/latest?vehicle_id=7',
    )
    const security = await request<{ vehicle_id: number; locked: boolean }>(
      '/security/latest?vehicle_id=8',
    )
    expect(climate).toMatchObject({ vehicle_id: 7, inside_temp_c: 21 })
    expect(security).toMatchObject({ vehicle_id: 8, locked: true })
    expect(demoResponse('/climate/latest?vehicle_id=99', 'GET').status).toBe(400)
  })

  it('supplies a coherent battery history and projection for each sample vehicle', async () => {
    const battery = await request<{
      current_soh: number; history: { soh_pct: number; capacity_wh: number }[];
      prediction: { has_enough_data: boolean };
      charging_analysis: { total_sessions: number };
    }>('/analytics/battery-health?vehicle_id=7')
    expect(battery.history).toHaveLength(12)
    expect(battery.history.at(-1)?.soh_pct).toBe(battery.current_soh)
    expect(battery.history.at(-1)?.capacity_wh).toBeGreaterThan(0)
    expect(battery.prediction.has_enough_data).toBe(true)
    expect(battery.charging_analysis.total_sessions).toBeGreaterThan(0)
    expect(demoResponse('/analytics/battery-health?vehicle_id=99', 'GET').status).toBe(400)
  })

  it('derives energy from the same fictional drives and charges, including parked drain', async () => {
    const energy = await request<{
      total_energy_used_wh: number; total_distance_m: number;
      avg_efficiency_wh_per_m: number; daily_breakdown: { energy_wh: number }[];
    }>('/vehicles/7/energy?days=30')
    const drain = await request<{ event_count: number }>('/vampire-drain/stats?vehicle_id=7')
    const events = await request<{ events: unknown[] }>('/vampire-drain?vehicle_id=7')
    expect(energy.total_energy_used_wh).toBeGreaterThan(0)
    expect(energy.total_energy_used_wh / energy.total_distance_m)
      .toBeCloseTo(energy.avg_efficiency_wh_per_m)
    expect(energy.daily_breakdown.reduce((sum, day) => sum + day.energy_wh, 0))
      .toBe(energy.total_energy_used_wh)
    expect(drain.event_count).toBe(events.events.length)
    expect(await request('/charging-telemetry/latest?vehicle_id=7')).toBeNull()
    expect(demoResponse('/vehicles/999/energy', 'GET').status).toBe(400)
  })

  it('scopes supporting work orders, chart annotations, and charging optimizer to sample vehicles', async () => {
    const orders = await request<{ items: { vehicle_id: number }[]; total: number }>(
      '/fleet-ops/work-orders?vehicle_id=8&limit=10',
    )
    const markers = await request<{ scope: string[] }[]>(
      '/annotations?vehicle_id=7&scope=energy',
    )
    const optimizer = await request<{
      current_schedule: { home_charging_pct: number };
      cost_analysis: { sessions_during_peak_pct: number };
    }>('/analytics/charging-optimizer?vehicle_id=7')
    expect(orders.items).toHaveLength(orders.total)
    expect(orders.items[0]?.vehicle_id).toBe(8)
    expect(markers).toHaveLength(1)
    expect(markers[0].scope).toContain('energy')
    expect(optimizer.current_schedule.home_charging_pct).toBe(100)
    expect(optimizer.cost_analysis.sessions_during_peak_pct).toBe(0)
    expect(demoResponse('/fleet-ops/work-orders?limit=0', 'GET').status).toBe(400)
  })

  it('respects instant bounds, inclusive calendar days, and pagination', async () => {
    const all = await demoResponse('/drives?vehicle_id=7', 'GET').json() as { start_ts: string }[]
    const date = all[0].start_ts.slice(0, 10)
    const day = await demoResponse(`/drives?vehicle_id=7&start=${date}&end=${date}`, 'GET').json() as { start_ts: string }[]
    expect(day).toHaveLength(1)
    expect(day[0].start_ts).toBe(all[0].start_ts)

    const atStart = all[1].start_ts
    const atEnd = all[0].start_ts
    const bounded = await demoResponse(`/drives?vehicle_id=7&start=${atStart}&end=${atEnd}`, 'GET').json() as { start_ts: string }[]
    expect(bounded.map(drive => drive.start_ts)).toContain(atStart)
    expect(bounded.map(drive => drive.start_ts)).not.toContain(atEnd)
    expect(demoResponse('/drives?limit=0', 'GET').status).toBe(400)
    expect(demoResponse('/charging?vehicle_id=999', 'GET').status).toBe(400)
  })

  it('rejects unknown data and all mutations without falling back to the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(request('/unsupported')).rejects.toMatchObject({
      status: 404, code: 'DEMO_NOT_AVAILABLE',
    })
    await expect(request('/vehicles/7/commands/flash', { method: 'POST' }))
      .rejects.toMatchObject({ status: 403, code: 'DEMO_READ_ONLY' })
    await expect(resilientFetch('/unsupported', { retries: 0 }))
      .rejects.toMatchObject({ status: 404, code: 'DEMO_NOT_AVAILABLE' })
    expect(demoResponse('/vehicles', 'DELETE').status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails closed on a misconfigured static build', async () => {
    vi.stubEnv('VITE_DEMO_API_BASE', '/api/v1')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(request('/vehicles')).rejects.toThrow(/Static demo requires/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps the ordinary production request path when the static flag is absent', async () => {
    vi.stubEnv('VITE_DEMO_STATIC_FIXTURES', undefined)
    vi.stubEnv('VITE_DEMO_MODE', undefined)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('[]', { headers: { 'Content-Type': 'application/json' } }),
    )
    expect(await request('/vehicles')).toEqual([])
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/vehicles', expect.any(Object))
  })
})
