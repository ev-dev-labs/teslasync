import { describe, expect, it } from 'vitest'
import { vehicles } from './fixtures'
import { teslaDomain } from './teslaDomain'

function read(path: string) {
  const url = new URL(path, 'https://demo.invalid')
  return teslaDomain(url.pathname, url.searchParams)
}

describe('Tesla read-only fictional fixtures', () => {
  it('returns contract-shaped account envelopes without tokens, orders or connected region', () => {
    expect(read('/tesla/user/feature-config')).toEqual({
      status: 200, body: { data: { synthetic_demo: true }, fetched_at: null },
    })
    expect(read('/tesla/user/region')).toEqual({ status: 200, body: { data: {}, fetched_at: null } })
    expect(read('/tesla/user/orders')).toEqual({ status: 200, body: { orders: [], fetched_at: null } })
    expect(read('/tesla/user/profile')).toEqual({ status: 200, body: { profile: null, fetched_at: null } })
  })

  it('does not claim a live Tesla telemetry subscription or diagnostic errors', () => {
    expect(read('/tesla/fleet-telemetry/coverage')).toEqual({
      status: 200, body: { categories: [], destination_totals: {}, orphan_fields: [] },
    })
    expect(read('/tesla/fleet-telemetry/error-vins')).toEqual({ status: 200, body: [] })
  })

  it('provides a visibly virtual energy site without live home electricity or charging advice', () => {
    const sites = read('/tesla/energy-sites')
    expect(sites).toMatchObject({ status: 200, body: [{
      energy_site_id: 1, resource_type: 'synthetic_demo', has_solar: false, has_battery: false,
      total_pack_energy: null, percentage_charged: null,
    }] })
    expect(read('/tesla/energy-sites/1/live-status')).toEqual({
      status: 200, body: { message: 'No live energy measurements in this fictional demo.' },
    })
    expect(read('/tesla/energy-sites/1/live-status/history?since=2026-01-01&until=2026-02-01&limit=10'))
      .toEqual({ status: 200, body: [] })
    expect(read('/tesla/energy-sites/1/charge-advice')).toMatchObject({
      status: 200, body: { verdict: 'no_data', recommended_amps: 0, surplus_w: 0 },
    })
  })

  it('delegates the three Tesla charging endpoints to existing non-Tesla-billing fixtures', () => {
    for (const path of ['/tesla/charging/history', '/tesla/charging/history/sites',
      '/tesla/charging/sessions']) {
      expect(read(`${path}?vin=${vehicles[0].vin}`)?.status).toBe(200)
      expect(read(`${path}?vin=REALVIN1234567890`)?.status).toBe(400)
    }
    expect(read('/tesla/charging/history')?.body).toMatchObject({ entries: [] })
    expect(read('/tesla/charging/sessions')?.body).toMatchObject({ sessions: [] })
  })

  it('rejects bad or unknown site IDs and invalid history filters', () => {
    for (const id of ['0', '-1', 'nope', '1.5', '9007199254740993']) {
      expect(read(`/tesla/energy-sites/${id}/live-status`)?.status).toBe(400)
    }
    expect(read('/tesla/energy-sites/2/live-status')?.status).toBe(404)
    for (const query of ['since=tomorrow', 'until=2026-02-31', 'limit=-1',
      'limit=2001', 'since=2026-02-01&until=2026-01-01', 'vehicleId=7']) {
      expect(read(`/tesla/energy-sites/1/live-status/history?${query}`)?.status).toBe(400)
    }
  })

  it('leaves unknown paths, refresh actions and commands to the transport', () => {
    for (const path of ['/tesla/energy-sites/1/live-status/refresh',
      '/tesla/user/orders/refresh', '/tesla/energy-sites/1/site-info',
      '/tesla/charging/sessions/123', '/tesla/vehicles/7/command',
      '/other/endpoint']) {
      expect(read(path)).toBeUndefined()
    }
  })
})
