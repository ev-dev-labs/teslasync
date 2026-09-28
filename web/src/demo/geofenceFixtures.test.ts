import { describe, expect, it } from 'vitest'
import type {
  Geofence, GeofenceChargingActivity, GeofenceChargingSummary, GeofenceRate,
  GeofenceRateImpactPreview, VisitedPlaceCandidate,
} from '@/api/types'
import { charging, drives } from './fixtures'
import { geofenceFixtures } from './geofenceFixtures'

const read = <T>(path: string, query = ''): T => {
  const response = geofenceFixtures(path, new URLSearchParams(query))
  expect(response?.status).toBe(200)
  return response?.body as T
}

describe('fictional geofence read contracts', () => {
  it('keeps saved places, needs-review, visited evidence and resolve consistent', () => {
    const places = read<Geofence[]>('/geofences')
    expect(places).toHaveLength(2)
    expect(read<Geofence[]>('/geofences', 'include_archived=true')).toEqual(places)
    expect(read<Geofence[]>('/geofences/needs-review')).toEqual(places.filter(row => row.needs_review))
    expect(read<Geofence>(`/geofences/${places[0].id}`)).toEqual(places[0])
    expect(read<{ name: string; geofence_id: number }>('/geofences/resolve',
      `lat=${drives[0].start_lat}&lon=${drives[0].start_lon}`))
      .toEqual({ name: places[0].name, geofence_id: places[0].id })
    expect(read('/geofences/resolve', 'lat=40&lon=-120')).toEqual({ name: null, geofence_id: null })
    const candidates = read<VisitedPlaceCandidate[]>('/geofences/visited-candidates')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      id: Math.min(...drives.map(row => row.id)), name: drives[0].end_address,
      latitude: drives[0].end_lat, longitude: drives[0].end_lon,
      visit_count: drives.length, charge_count: 0, first_charge_at: null,
    })
    expect(places.every(row => row.radius > 0 && row.polygon_wkt.startsWith('POLYGON(('))).toBe(true)
  })

  it('keeps SI tariff history, session costs, currency summary and previews coherent', () => {
    const rates = read<GeofenceRate[]>('/geofences/701/rates')
    const current = read<GeofenceRate[]>('/geofences/rates/current')
    expect(rates.map(row => row.id)).toEqual([802, 801])
    expect(current).toEqual([rates[0]])
    expect(rates[0].rate_per_wh * charging[0].total_energy_added_wh).toBeCloseTo(charging[0].cost_decimal)
    expect(rates[1].effective_to).toBe(rates[0].effective_from)
    const rows = read<GeofenceChargingActivity[]>('/geofences/701/charging-activity')
    expect(rows).toHaveLength(charging.length)
    expect(rows.map(row => row.session_id)).toEqual(charging.map(row => row.id))
    expect(rows[0]).toMatchObject({
      energy_wh: charging[0].total_energy_added_wh, cost_decimal: charging[0].cost_decimal,
      cost_source: 'geofence_tariff', rate_id: rates[0].id,
    })
    expect(rows.slice(1).every(row => row.cost_source === 'manual' && row.rate_id === null)).toBe(true)
    const summary = read<GeofenceChargingSummary[]>('/geofences/701/charging-summary')
    expect(summary).toEqual([{
      geofence_id: 701, currency: 'USD', session_count: charging.length,
      total_energy_wh: charging.reduce((sum, row) => sum + row.total_energy_added_wh, 0),
      total_cost_decimal: charging.reduce((sum, row) => sum + row.cost_decimal, 0),
    }])
    expect(read('/geofences/701/first-charging-session')).toEqual({
      started_at: charging[charging.length - 1].started_at,
    })
    expect(read<GeofenceRateImpactPreview>('/geofences/701/rates/802/preview')).toEqual({
      geofence_id: 701, rate_id: 802, currency: 'USD',
      matched_sessions: 1, eligible_sessions: 1, protected_sessions: 0,
      total_energy_wh: charging[0].total_energy_added_wh,
      estimated_cost_decimal: charging[0].cost_decimal,
    })
    expect(read<GeofenceRateImpactPreview>('/geofences/701/rates/801/preview')).toMatchObject({
      matched_sessions: charging.length - 1, eligible_sessions: 0,
      protected_sessions: charging.length - 1, total_energy_wh: 0,
    })
    expect(read<GeofenceRateImpactPreview>('/geofences/701/rates/802/preview',
      `to=${encodeURIComponent(charging[0].started_at)}`).matched_sessions).toBe(0)
    expect(read('/geofences/701/charging-activity', 'limit=2&offset=1')).toEqual(rows.slice(1, 3))
    expect(read('/geofences/702/charging-activity')).toEqual([])
    expect(read('/geofences/702/charging-summary')).toEqual([])
    expect(read('/geofences/702/first-charging-session')).toEqual({ started_at: null })
  })

  it('rejects bad identifiers, filters and unknown routes without a generic success', () => {
    expect(geofenceFixtures('/drives', new URLSearchParams())).toBeUndefined()
    for (const path of [
      '/geofences/0', '/geofences/-1', '/geofences/999999999999999999999',
      '/geofences/701/rates/0/preview',
    ]) {
      expect(geofenceFixtures(path, new URLSearchParams())?.status).toBe(400)
    }
    for (const path of [
      '/geofences/999', '/geofences/foo', '/geofences/701/other',
      '/geofences/701/rates/999/preview',
    ]) {
      expect(geofenceFixtures(path, new URLSearchParams())?.status).toBe(404)
    }
    for (const [path, query] of [
      ['/geofences', 'include_archived=no'],
      ['/geofences/resolve', 'lat=91&lon=-122'],
      ['/geofences/resolve', 'lat=&lon=-122'],
      ['/geofences/701/charging-activity', 'limit=0'],
      ['/geofences/701/charging-activity', 'offset=-1'],
      ['/geofences/701/rates/802/preview', 'from=tomorrow'],
      ['/geofences/701/rates/802/preview', 'from=2025-04-02T00%3A00%3A00Z&to=2025-04-01T00%3A00%3A00Z'],
    ]) {
      expect(geofenceFixtures(path, new URLSearchParams(query))?.status).toBe(400)
    }
  })
})
