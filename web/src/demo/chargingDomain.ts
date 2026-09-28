import type { BillVarianceReport, CostForecastData, AutopilotProfile, RatePlanInfo } from '@/types/charging'
import type { ChargePhysics } from '@/types/teslaPhysics'
import { charging, vehicles } from './fixtures'

type FixtureResult = { status: number; body: unknown }

const found = (body: unknown): FixtureResult => ({ status: 200, body })
const invalid = (): FixtureResult => ({
  status: 400, body: { error: 'Invalid demo charging filters', code: 'INVALID_FILTER' },
})
const missing = (path: string): FixtureResult => ({
  status: 404, body: { error: `No synthetic demo data for ${path}`, code: 'DEMO_NOT_AVAILABLE' },
})
const round = (value: number) => Number(value.toFixed(2))

function vehicleId(params: URLSearchParams): number | null {
  const raw = params.get('vehicle_id')
  return raw != null && /^(?:[1-9]\d*)$/.test(raw) && vehicles.some(vehicle => vehicle.id === Number(raw))
    ? Number(raw) : null
}

function optionalVin(params: URLSearchParams): string | null {
  const vin = params.get('vin')
  return vin == null || vehicles.some(vehicle => vehicle.vin === vin) ? vin : null
}

function costForecast(id: number): CostForecastData {
  const months = new Map<string, { cost: number; wh: number; sessions: number }>()
  for (const session of charging.filter(row => row.vehicle_id === id)) {
    const month = session.started_at.slice(0, 7)
    const entry = months.get(month) ?? { cost: 0, wh: 0, sessions: 0 }
    entry.cost += session.cost_decimal
    entry.wh += session.total_energy_added_wh
    entry.sessions++
    months.set(month, entry)
  }
  const historical = [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, entry]) => ({
    month, cost: round(entry.cost), kwh: round(entry.wh / 1000),
    sessions: entry.sessions, cost_per_kwh: round(entry.cost / (entry.wh / 1000)),
  }))
  const averageCost = historical.length
    ? round(historical.reduce((sum, row) => sum + row.cost, 0) / historical.length) : 0
  const home = { pct: historical.length ? 100 : 0,
    avg_cost_per_kwh: round(charging.filter(row => row.vehicle_id === id)
      .reduce((sum, row) => sum + row.cost_decimal, 0)
      / (charging.filter(row => row.vehicle_id === id)
        .reduce((sum, row) => sum + row.total_energy_added_wh, 0) / 1000 || 1)),
    monthly_avg: averageCost }
  return {
    historical,
    // Fewer than three observed months cannot support the backend's regression forecast.
    forecast: [],
    breakdown: { home, supercharger: { pct: 0, avg_cost_per_kwh: 0, monthly_avg: 0 } },
    gas_comparison: {
      avg_km_per_month: 0, gas_cost_per_month: 0, ev_cost_per_month: averageCost,
      monthly_savings: 0, annual_savings: 0, lifetime_savings: 0,
    },
    insights: [],
  }
}

const ratePlans: RatePlanInfo[] = [
  { id: 'pge-ev2a', name: 'PG&E EV2-A', utility: 'Pacific Gas & Electric' },
  { id: 'sce-tou-d', name: 'SCE TOU-D', utility: 'Southern California Edison' },
  { id: 'sdge-tou-dr1', name: 'SDG&E TOU-DR1', utility: 'San Diego Gas & Electric' },
]

export function chargingDomain(pathname: string, params: URLSearchParams): FixtureResult | undefined {
  if (pathname === '/charging/bill-variance') {
    const id = vehicleId(params)
    if (id == null) return invalid()
    const report: BillVarianceReport = {
      vehicle_id: id, measured_sessions: 0, measured_energy_wh: 0, measured_cost: 0,
      invoiced_sessions: 0, invoiced_energy_wh: 0, invoiced_cost: 0,
      energy_delta_wh: 0, energy_delta_pct: 0, cost_delta: 0, cost_delta_pct: 0,
      cabinet_loss_pct: 0, verdict: 'missing_data',
      explanation: 'No DC charging measurements or Tesla invoices were recorded in this fictional demo.',
    }
    return found(report)
  }
  const sessionMatch = pathname.match(/^\/charging\/([^/]+)(?:\/(telemetry|shares))?$/)
    ?? pathname.match(/^\/physics\/charging\/([^/]+)$/)
  if (sessionMatch) {
    const [, rawId, suffix] = sessionMatch
    if (!/^[1-9]\d*$/.test(rawId)) return invalid()
    const session = charging.find(row => row.id === Number(rawId))
    if (!session) return missing(pathname)
    if (suffix === 'telemetry' || suffix === 'shares') {
      // Session totals are known, but neither signal-log samples nor share links were recorded.
      return found([])
    }
    if (pathname.startsWith('/physics/')) {
      const physics: ChargePhysics = {
        session_id: session.id, vehicle_id: session.vehicle_id,
        started_at: session.started_at, ended_at: session.ended_at,
        story: [], at_limit_still_plugged_s: null,
        etiquette: {
          applicable: false, complete_at: null, unplug_at: null, dwell_s: null,
          honesty: 'No plug or completion signal samples were recorded in this fictional session.',
        },
        schedule: {
          scheduled_mode: null, scheduled_start_at: null, stopped_at: null,
          charging_resumed_at: null, waited_for_schedule: null,
          charged_anyway: null, unknown: true,
          honesty: 'No scheduling signal samples were recorded.',
        },
        honesty: 'Session boundaries are fictional; charge-state transitions were not observed.',
      }
      return found(physics)
    }
    return undefined // Existing /charging/{id} fixture owns session detail.
  }

  if (pathname === '/analytics/cost-forecast') {
    const id = vehicleId(params)
    const rawMonths = params.get('months')
    if (id == null || (rawMonths != null && (!/^[1-9]\d*$/.test(rawMonths)
      || Number(rawMonths) > 24))) return invalid()
    return found(costForecast(id))
  }
  if (pathname === '/charge-autopilot/profile' || pathname === '/charge-autopilot/savings'
    || pathname === '/charge-planner/history') {
    const id = vehicleId(params)
    if (id == null) return invalid()
    if (pathname === '/charge-planner/history') return found([])
    if (pathname === '/charge-autopilot/savings') return found({ total_savings: 0, runs: 0 })
    const profile: AutopilotProfile = {
      vehicle_id: id, enabled: false, target_soc: 80, ready_by: '07:30',
      rate_plan: 'pge-ev2a', daily_cap_soc: 80, trip_override: false,
      precondition: true, max_amps: 32, battery_capacity_kwh: 75,
    }
    return found(profile)
  }
  if (pathname === '/charge-planner/rate-plans') return found(ratePlans)

  if (pathname === '/tesla/charging/history' || pathname === '/tesla/charging/history/sites'
    || pathname === '/tesla/charging/sessions') {
    if (optionalVin(params) == null && params.has('vin')) return invalid()
    // Home AC session fixtures are not Tesla-synced DC bills or business-account records.
    if (pathname.endsWith('/sites')) return found({ sites: [], unpriced_count: 0 })
    if (pathname.endsWith('/sessions')) {
      return found({ sessions: [], summary: {
        total_sessions: 0, total_wh: null, total_cost: null,
        avg_cost_per_kwh: null, peak_power_kw: null,
      } })
    }
    return found({ entries: [], summary: {
      total_sessions: 0, total_wh: null, total_spend: null, avg_cost_per_kwh: null,
    } })
  }
  if (pathname === '/waitoracle/sites') return found([])
  if (pathname === '/ocpp/charge-points') return found([])
  if (pathname === '/ocpp/sessions') {
    const rawLimit = params.get('limit')
    if ((rawLimit != null && (!/^[1-9]\d*$/.test(rawLimit) || Number(rawLimit) > 1000))
      || (params.get('charge_point_id') ?? '').length > 128) return invalid()
    return found([])
  }
  return undefined
}
