import { describe, expect, it } from 'vitest'
import { batteryHealth, charging, drives } from './fixtures'
import { advancedAnalyticsDomain } from './advancedAnalyticsDomain'

const read = (path: string) => {
  const url = new URL(path, 'https://demo.invalid')
  return advancedAnalyticsDomain(url.pathname, url.searchParams)
}

describe('advanced synthetic analytics READ contracts', () => {
  it('only handles its explicit read paths and rejects invalid/unknown filters', () => {
    expect(read('/analytics/range-projection?vehicle_id=7')).toBeUndefined()
    expect(read('/analytics/tco/ledger/1?vehicle_id=7')).toBeUndefined()
    for (const path of ['/analytics/tco', '/analytics/tco/ledger',
      '/analytics/regen', '/analytics/sleep', '/analytics/battery-degradation']) {
      for (const query of ['', '?vehicle_id=0', '?vehicle_id=999', '?vehicle_id=7&vehicle_id=8',
        '?vehicle_id=7&bogus=1']) {
        expect(read(path + query)?.status).toBe(400)
      }
    }
    for (const query of [
      'vehicle_id=7&start=not-a-date&end=2026-01-01',
      'vehicle_id=7&start=2026-02-30&end=2026-03-01',
      'vehicle_id=7&start=2026-04-01&end=2026-03-01',
      'vehicle_id=7&start=2026-01-01',
    ]) expect(read(`/analytics/regen?${query}`)?.status).toBe(400)
    expect(read('/analytics/sleep?vehicle_id=7&days=366')?.status).toBe(400)
    expect(read('/analytics/sleep?vehicle_id=7&days=NaN')?.status).toBe(400)
  })

  it('builds vehicle-specific TCO arithmetic and month rollups from SI fixtures', () => {
    const body = read('/analytics/tco?vehicle_id=7')?.body as Record<string, unknown>
    const rows = drives.filter(row => row.vehicle_id === 7)
    const sessions = charging.filter(row => row.vehicle_id === 7)
    const totalWh = sessions.reduce((sum, row) => sum + row.total_energy_added_wh, 0)
    const totalKm = rows.reduce((sum, row) => sum + row.distance_m, 0) / 1000
    expect(body.total_wh).toBe(totalWh)
    expect(body.total_km).toBe(Number(totalKm.toFixed(2)))
    expect(body.total_sessions).toBe(sessions.length)
    expect(body).not.toHaveProperty('gas_unit') // Canonical handler omits the field.
    const monthly = body.monthly_breakdown as Array<Record<string, number | string>>
    expect(monthly.reduce((sum, row) => sum + Number(row.energy_wh), 0)).toBe(totalWh)
    expect(monthly.at(-1)?.cumulative_savings).toBeCloseTo(
      monthly.reduce((sum, row) => sum + Number(row.savings), 0), 1)
    expect(read('/analytics/tco?vehicle_id=8')?.body).toMatchObject({ vehicle_id: 8 })
  })

  it('returns an empty fixed-cost ledger rather than inventing ownership expenses', () => {
    expect(read('/analytics/tco/ledger?vehicle_id=7')).toEqual({
      status: 200, body: {
        vehicle_id: 7, entries: [], totals: { by_category: {}, grand_total: 0, entries: 0 },
      },
    })
  })

  it('scopes regen energy, months, and embedded drives to the same vehicle and window', () => {
    const start = drives.find(row => row.vehicle_id === 7)!.start_ts
    // Equal timestamps are not a valid interval.
    expect(read(`/analytics/regen?vehicle_id=7&start=${encodeURIComponent(start)}&end=${encodeURIComponent(start)}`)?.status).toBe(400)
    const today = new Date(Date.parse(start) + 86_400_000).toISOString()
    const scoped = read(`/analytics/regen?vehicle_id=7&start=${start}&end=${today}`)?.body as Record<string, unknown>
    const matching = drives.filter(row => row.vehicle_id === 7
      && Date.parse(row.start_ts) >= Date.parse(start)
      && Date.parse(row.start_ts) <= Date.parse(today))
    expect(scoped.total_regen_wh).toBe(matching.reduce((sum, row) => sum + row.regen_energy_wh, 0))
    expect(scoped.total_drive_wh).toBe(matching.reduce((sum, row) => sum + row.energy_used_wh, 0))
    expect(scoped.regen_ratio).toBeCloseTo(
      Number(scoped.total_regen_wh) / Number(scoped.total_drive_wh) * 100, 1)
    expect(scoped.drives).toHaveLength(matching.length)
    expect((scoped.drives as Array<Record<string, number>>)[0].distance)
      .toBeCloseTo(matching[0].distance_m / 1609.344)
    expect((scoped.drives as Array<Record<string, number>>)[0].min_power_w).toBeNull()
    expect((scoped.monthly_summary as Array<Record<string, number>>)[0].avg_regen_power_kw)
      .toBe(matching[0].avg_power_w)
    const empty = read('/analytics/regen?vehicle_id=8&start=2020-01-01&end=2020-01-02')
      ?.body as Record<string, unknown>
    expect(empty).toMatchObject({ total_regen_wh: 0, total_drive_wh: 0, drives: [], monthly_summary: [] })
    expect(read('/analytics/regen?vehicle_id=7')?.status).toBe(200)
  })

  it('reports transition counts but does not fabricate unsupported sleep dwell or drain evidence', () => {
    const body = read('/analytics/sleep?vehicle_id=7&days=30')?.body as Record<string, unknown>
    expect(body.period_days).toBe(30)
    expect(body.state_distribution).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: 'driving', total_minutes: 0, count: expect.any(Number) }),
    ]))
    expect(body).toMatchObject({
      sleep_efficiency_pct: 0, sentry_comparison: [], recent_events: [],
      total_events: 0, sentry_monthly_kwh: 0,
    })
    const empty = read('/analytics/sleep?vehicle_id=7&start=2020-01-01&end=2020-01-03')
      ?.body as Record<string, unknown>
    expect(empty.state_distribution).toEqual([])
    expect(empty.period_days).toBe(3)
  })

  it('keeps battery snapshot capacity in Wh and explicitly converts legacy range/energy fields', () => {
    const source = batteryHealth(8)
    const body = read('/analytics/battery-degradation?vehicle_id=8')?.body as Record<string, unknown>
    expect(body.current_capacity).toBe(source.estimated_capacity_wh)
    expect(body.current_range).toBe(source.history.at(-1)!.range_m / 1000)
    expect(body.battery_capacity_wh).toBe(source.original_capacity_wh)
    expect((body.snapshots as Array<Record<string, number>>).at(-1)?.capacity_wh)
      .toBe(source.estimated_capacity_wh)
    const habits = body.charging_habits as Record<string, number>
    const sessions = charging.filter(row => row.vehicle_id === 8)
    expect(habits.total_count).toBe(sessions.length)
    expect(habits.avg_energy_per_session).toBeCloseTo(
      sessions.reduce((sum, row) => sum + row.total_energy_added_wh, 0) / sessions.length / 1000, 1)
    expect(body.projections).toHaveLength(source.projections.length)
  })
})
