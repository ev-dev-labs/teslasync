import { describe, expect, it } from 'vitest'
import { charging, vehicles } from './fixtures'
import { chargingDomain } from './chargingDomain'

function read(path: string) {
  const url = new URL(path, 'https://demo.invalid')
  return chargingDomain(url.pathname, url.searchParams)
}

describe('charging demo reads', () => {
  it('returns no invented telemetry, sharing, or charge-state transitions for known sessions', () => {
    for (const session of charging) {
      expect(read(`/charging/${session.id}/telemetry`)).toEqual({ status: 200, body: [] })
      expect(read(`/charging/${session.id}/shares`)).toEqual({ status: 200, body: [] })
      expect(read(`/physics/charging/${session.id}`)).toMatchObject({
        status: 200,
        body: {
          session_id: session.id, vehicle_id: session.vehicle_id,
          started_at: session.started_at, ended_at: session.ended_at, story: [],
          schedule: { unknown: true }, etiquette: { applicable: false },
        },
      })
    }
    expect(read('/charging/201')).toBeUndefined()
    expect(read('/charging/201/ledger')).toBeUndefined()
  })

  it('rejects malformed session IDs and does not fabricate unknown sessions', () => {
    for (const path of ['/charging/0/telemetry', '/charging/nope/telemetry', '/charging/-1/shares',
      '/physics/charging/0']) {
      expect(read(path)).toMatchObject({ status: 400, body: { code: 'INVALID_FILTER' } })
    }
    for (const path of ['/charging/999/telemetry', '/physics/charging/999', '/charging/999/shares']) {
      expect(read(path)).toMatchObject({ status: 404, body: { code: 'DEMO_NOT_AVAILABLE' } })
    }
  })

  it('groups actual fixture energy and cost by calendar month without predicting insufficient history', () => {
    for (const vehicle of vehicles) {
      const rows = charging.filter(row => row.vehicle_id === vehicle.id)
      const response = read(`/analytics/cost-forecast?vehicle_id=${vehicle.id}&months=6`)
      expect(response?.status).toBe(200)
      const body = response?.body as {
        historical: { month: string; cost: number; kwh: number; sessions: number }[]
        forecast: unknown[]; breakdown: { home: { pct: number }; supercharger: { pct: number } }
      }
      expect(body.historical.reduce((sum, row) => sum + row.sessions, 0)).toBe(rows.length)
      expect(body.historical.reduce((sum, row) => sum + row.cost, 0)).toBeCloseTo(
        rows.reduce((sum, row) => sum + row.cost_decimal, 0), 2)
      expect(body.historical.reduce((sum, row) => sum + row.kwh, 0)).toBeCloseTo(
        rows.reduce((sum, row) => sum + row.total_energy_added_wh, 0) / 1000, 2)
      expect(body.historical.every(row => /^\d{4}-\d{2}$/.test(row.month))).toBe(true)
      expect(body.forecast).toEqual([])
      expect(body.breakdown.home.pct).toBe(100)
      expect(body.breakdown.supercharger.pct).toBe(0)
    }
  })

  it('reports unavailable DC reconciliation instead of misclassifying fictional home AC charges', () => {
    for (const vehicle of vehicles) {
      expect(read(`/charging/bill-variance?vehicle_id=${vehicle.id}`)).toMatchObject({
        status: 200, body: {
          vehicle_id: vehicle.id, verdict: 'missing_data',
          measured_sessions: 0, measured_energy_wh: 0, invoiced_sessions: 0,
        },
      })
    }
  })

  it('shows disabled autopilot defaults, no saved plans or savings, and real planner options', () => {
    for (const vehicle of vehicles) {
      expect(read(`/charge-autopilot/profile?vehicle_id=${vehicle.id}`)).toMatchObject({
        status: 200, body: { vehicle_id: vehicle.id, enabled: false, target_soc: 80 },
      })
      expect(read(`/charge-autopilot/savings?vehicle_id=${vehicle.id}`)).toEqual({
        status: 200, body: { total_savings: 0, runs: 0 },
      })
      expect(read(`/charge-planner/history?vehicle_id=${vehicle.id}`)).toEqual({
        status: 200, body: [],
      })
    }
    expect(read('/charge-planner/rate-plans')).toMatchObject({
      status: 200, body: [{ id: 'pge-ev2a' }, { id: 'sce-tou-d' }, { id: 'sdge-tou-dr1' }],
    })
  })

  it('keeps external Tesla, OCPP and queue data empty rather than laundering home sessions', () => {
    for (const vehicle of vehicles) {
      expect(read(`/tesla/charging/history?vin=${vehicle.vin}`)).toMatchObject({
        status: 200, body: { entries: [], summary: { total_sessions: 0, total_wh: null } },
      })
      expect(read(`/tesla/charging/sessions?vin=${vehicle.vin}`)).toMatchObject({
        status: 200, body: { sessions: [], summary: { total_sessions: 0 } },
      })
    }
    expect(read('/tesla/charging/history/sites')).toEqual({
      status: 200, body: { sites: [], unpriced_count: 0 },
    })
    expect(read('/waitoracle/sites')).toEqual({ status: 200, body: [] })
    expect(read('/ocpp/charge-points')).toEqual({ status: 200, body: [] })
    expect(read('/ocpp/sessions?limit=20')).toEqual({ status: 200, body: [] })
  })

  it('validates vehicle, VIN, forecast horizon and OCPP filters; leaves unrelated paths alone', () => {
    for (const path of [
      '/analytics/cost-forecast', '/analytics/cost-forecast?vehicle_id=0',
      '/analytics/cost-forecast?vehicle_id=999',
      '/analytics/cost-forecast?vehicle_id=7&months=25',
      '/analytics/cost-forecast?vehicle_id=7&months=NaN',
      '/charge-autopilot/profile?vehicle_id=seven',
      '/charge-autopilot/savings?vehicle_id=999',
      '/charge-planner/history',
      '/charging/bill-variance?vehicle_id=999',
      '/tesla/charging/history?vin=UNKNOWN',
      '/tesla/charging/sessions?vin=UNKNOWN',
      '/ocpp/sessions?limit=0',
    ]) {
      expect(read(path)).toMatchObject({ status: 400, body: { code: 'INVALID_FILTER' } })
    }
    expect(read('/drives/101/telemetry')).toBeUndefined()
    expect(read('/physics/charging/201/telemetry')).toBeUndefined()
    expect(read('/charge-planner/optimize')).toBeUndefined()
  })
})
