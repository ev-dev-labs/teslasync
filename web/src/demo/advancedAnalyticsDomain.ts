import type { CostBreakdown, TcoLedgerResponse } from '@/types/analytics'
import { batteryHealth, charging, drives, settings, vehicles } from './fixtures'
import { vehicleStates } from './vehicleStates'

type Result = { status: number; body: unknown }
type Drive = (typeof drives)[number]

const ok = (body: unknown): Result => ({ status: 200, body })
const invalid = (): Result => ({
  status: 400, body: { error: 'Invalid demo analytics filters', code: 'INVALID_FILTER' },
})
const round = (value: number, digits = 2) => Number(value.toFixed(digits))
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

function vehicle(params: URLSearchParams, allowed: string[]): number | undefined {
  if ([...params.keys()].some(key => !allowed.includes(key))
    || allowed.some(key => params.getAll(key).length > 1)) return undefined
  const id = params.get('vehicle_id')
  return id && /^[1-9]\d*$/.test(id) && vehicles.some(row => row.id === Number(id))
    ? Number(id) : undefined
}

function parseWindow(params: URLSearchParams, rollingDays?: number) {
  const start = params.get('start')
  const end = params.get('end')
  const days = params.get('days')
  const datePattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/
  const validDate = (value: string) => datePattern.test(value)
    && Number.isFinite(Date.parse(value))
    && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) === value)
  if ((start === null) !== (end === null)
    || (start !== null && (!validDate(start!) || !validDate(end!)))
    || (days !== null && (rollingDays === undefined || !/^[1-9]\d*$/.test(days)
      || Number(days) > 365))) return undefined
  const now = Date.now()
  const from = start === null
    ? rollingDays === undefined ? -Infinity
      : now - (days === null ? rollingDays : Number(days)) * 86_400_000
    : Date.parse(start)
  const to = end === null ? rollingDays === undefined ? Infinity : now
    : Date.parse(end) + (/^\d{4}-\d{2}-\d{2}$/.test(end) ? 86_400_000 : 0)
  if (from >= to) return undefined
  return { from, to, days: start === null
    ? days === null ? rollingDays ?? 0 : Number(days)
    : Math.max(1, Math.round((to - from) / 86_400_000)) }
}

function gasCost(km: number, price: number, mpg: number): number {
  return km / (mpg * 1.60934) * price
}

function tco(vehicleId: number): Omit<CostBreakdown, 'gas_unit'> {
  const rows = drives.filter(row => row.vehicle_id === vehicleId && row.distance_m > 0)
  const sessions = charging.filter(row => row.vehicle_id === vehicleId && row.cost_decimal > 0)
  const totalKm = sum(rows.map(row => row.distance_m)) / 1000
  const totalWh = sum(sessions.map(row => row.total_energy_added_wh))
  const cost = sum(sessions.map(row => row.cost_decimal))
  const gasPrice = settings.gas_price_per_unit > 0 ? settings.gas_price_per_unit : 3.5
  const gasMpg = settings.gas_efficiency_mpg > 0 ? settings.gas_efficiency_mpg : 25
  const first = rows.reduce((date, row) => date < row.start_ts ? date : row.start_ts, rows[0]?.start_ts ?? '')
  const last = rows.reduce((date, row) => date > row.start_ts ? date : row.start_ts, rows[0]?.start_ts ?? '')
  const months = first && last ? Math.max(1, (Date.parse(last) - Date.parse(first)) / 86_400_000 / 30.44) : 1
  const equivalent = gasCost(totalKm, gasPrice, gasMpg)
  const savings = equivalent - cost
  const groups = new Map<string, typeof charging>()
  for (const session of sessions) {
    const month = session.started_at.slice(0, 7)
    groups.set(month, [...(groups.get(month) ?? []), session])
  }
  let cumulative = 0
  const monthly: CostBreakdown['monthly_breakdown'] = [...groups]
    .sort(([a], [b]) => a.localeCompare(b)).map(([month, group]) => {
      const energyWh = sum(group.map(row => row.total_energy_added_wh))
      const evCost = sum(group.map(row => row.cost_decimal))
      const km = energyWh / 1000 * (totalWh && totalKm ? totalKm / (totalWh / 1000) : 5)
      const gas = gasCost(km, gasPrice, gasMpg)
      cumulative += gas - evCost
      return {
        month, ev_cost: round(evCost), equiv_gas_cost: round(gas),
        savings: round(gas - evCost), cumulative_savings: round(cumulative),
        energy_wh: energyWh,
      }
    })
  return {
    vehicle_id: vehicleId, total_charging_cost: round(cost), total_wh: totalWh,
    total_sessions: sessions.length, total_km: round(totalKm),
    first_date: first.slice(0, 10), last_date: last.slice(0, 10),
    months_of_ownership: round(months, 1),
    cost_per_km_ev: totalKm ? round(cost / totalKm, 4) : 0,
    cost_per_km_ice: totalKm ? round(equivalent / totalKm, 4) : 0,
    equivalent_gas_cost: round(equivalent), total_savings: round(savings),
    monthly_savings: round(savings / months),
    maintenance_savings_estimate: round(months * 50),
    gas_price: gasPrice, gas_efficiency_mpg: gasMpg,
    base_cost_per_kwh: settings.base_cost_per_kwh,
    monthly_breakdown: monthly,
  }
}

function regen(vehicleId: number, from: number, to: number) {
  const rows = drives.filter(row => row.vehicle_id === vehicleId
    && row.distance_m > 2 * 1609.344
    && Date.parse(row.start_ts) >= from && Date.parse(row.start_ts) <= to)
  const totalRegenWh = sum(rows.map(row => row.regen_energy_wh))
  const totalDriveWh = sum(rows.map(row => row.energy_used_wh))
  const groups = new Map<string, Drive[]>()
  for (const row of rows) {
    const month = row.start_ts.slice(0, 7)
    groups.set(month, [...(groups.get(month) ?? []), row])
  }
  const monthly_summary = [...groups].sort(([a], [b]) => a.localeCompare(b))
    .map(([month, group]) => ({
      month, drive_count: group.length,
      // Historical wire key says kW, but the handler sends absolute drive power in W.
      avg_regen_power_kw: round(sum(group.map(row => Math.abs(row.avg_power_w))) / group.length, 1),
      avg_speed: round(sum(group.map(row => row.avg_speed_mps)) / group.length / 0.44704, 1),
      avg_efficiency: round(sum(group.map(row =>
        (row.start_soc_pct - row.end_soc_pct) / (row.distance_m / 1609.344) * 100)) / group.length, 1),
    }))
  const capacity = batteryHealth(vehicleId).estimated_capacity_wh
  return {
    vehicle_id: vehicleId, total_regen_wh: round(totalRegenWh),
    total_drive_wh: round(totalDriveWh),
    regen_ratio: totalDriveWh ? round(totalRegenWh / totalDriveWh * 100, 1) : 0,
    monthly_avg_regen: monthly_summary.length
      ? round(sum(monthly_summary.map(row => row.avg_regen_power_kw)) / monthly_summary.length, 1) : 0,
    free_charges: round(totalRegenWh / capacity, 1), monthly_summary,
    // Per-drive "distance" is miles on the existing wire; fixture storage remains metres.
    drives: [...rows].reverse().map(row => ({
      id: row.id, start_date: row.start_ts, distance: row.distance_m / 1609.344,
      duration_s: row.duration_s, avg_speed_mps: row.avg_speed_mps,
      avg_power_w: row.avg_power_w, min_power_w: null,
      start_soc_pct: row.start_soc_pct, end_soc_pct: row.end_soc_pct,
      efficiency: (row.start_soc_pct - row.end_soc_pct) / (row.distance_m / 1609.344) * 100,
      regen_score: 0,
    })),
    battery_capacity_wh: capacity, capacity_source: 'model_estimate',
  }
}

function sleep(vehicleId: number, from: number, to: number, days: number) {
  const timeline = vehicleStates(vehicleId, from, to, days).timeline.transitions
  const counts = new Map<string, number>()
  for (const row of timeline) counts.set(row.to_state, (counts.get(row.to_state) ?? 0) + 1)
  const capacity = batteryHealth(vehicleId).estimated_capacity_wh
  return {
    vehicle_id: vehicleId, period_days: days,
    // Production fsm_transitions currently reports counts but withholds dwell durations.
    state_distribution: [...counts].sort(([a], [b]) => a.localeCompare(b))
      .map(([state, count]) => ({ state, count, total_minutes: 0 })),
    sleep_efficiency_pct: 0, time_to_sleep_avg_min: 0,
    sentry_comparison: [], sentry_on_drain_rate: 0, sentry_off_drain_rate: 0,
    sentry_monthly_kwh: 0, sentry_monthly_cost: 0,
    sentry_extra_drain_rate: 0, sentry_extra_monthly_kwh: 0,
    sentry_extra_monthly_cost: 0, battery_capacity_wh: capacity,
    capacity_source: 'model_estimate', base_cost_per_kwh: settings.base_cost_per_kwh,
    recent_events: [], total_events: 0, avg_sentry_duration_hours: 0,
  }
}

function degradation(vehicleId: number) {
  const source = batteryHealth(vehicleId)
  const latest = source.history[source.history.length - 1]
  const groups = new Map(source.history.map(row => [row.date.slice(0, 7), row]))
  const sessions = charging.filter(row => row.vehicle_id === vehicleId)
  const habits = {
    fast_charge_count: sessions.filter(row => row.peak_power_w > 50_000).length,
    slow_charge_count: sessions.filter(row => row.peak_power_w <= 50_000).length,
    deep_discharge_count: sessions.filter(row => row.start_soc_pct < 10).length,
    charge_to_full_count: sessions.filter(row => row.end_soc_pct > 95).length,
    high_soc_count: sessions.filter(row => row.end_soc_pct > 90).length,
    avg_energy_per_session: sessions.length
      ? round(sum(sessions.map(row => row.total_energy_added_wh)) / sessions.length / 1000, 1) : 0,
    total_count: sessions.length,
  }
  const snapshots = source.history.map((row, index) => ({
    id: index + 1, health_score: row.soh_pct, capacity_wh: row.capacity_wh,
    degradation_pct: round(100 - row.soh_pct), est_range_km: row.range_m / 1000,
    cycle_count: Math.round(source.total_cycles * (index + 1) / source.history.length),
    avg_cell_temp_c: 0, created_at: `${row.date}T12:00:00.000Z`,
  }))
  return {
    vehicle_id: vehicleId, current_health: source.current_soh,
    current_capacity: latest.capacity_wh, current_degradation: round(100 - source.current_soh),
    current_range: latest.range_m / 1000, current_cycles: source.total_cycles,
    current_temp: 0, snapshots,
    monthly_trend: [...groups].map(([month, row]) => ({
      month, avg_health: row.soh_pct, avg_capacity: row.capacity_wh,
      avg_degradation: round(100 - row.soh_pct), avg_range: row.range_m / 1000,
      max_cycles: source.total_cycles, avg_cell_temp: 0,
    })),
    charging_habits: habits, prediction: source.prediction,
    stress_level: source.stress_level, fast_charge_ratio: habits.total_count
      ? round(habits.fast_charge_count / habits.total_count * 100, 1) : 0,
    current_health_pct: source.current_soh,
    degradation_rate_pct_per_month: round(source.degradation_rate_pct_per_year / 12, 3),
    projected_80pct_date: source.prediction.predicted_date,
    projections: source.projections, horizon_outlook: null,
    risk_factors: source.risk_factors, recommendations: source.recommendations,
    battery_capacity_wh: source.original_capacity_wh,
    capacity_source: source.capacity_source,
  }
}

export function advancedAnalyticsDomain(pathname: string, params: URLSearchParams): Result | undefined {
  const paths = ['/analytics/tco', '/analytics/tco/ledger', '/analytics/regen',
    '/analytics/sleep', '/analytics/battery-degradation']
  if (!paths.includes(pathname)) return undefined
  const allowed = pathname === '/analytics/regen' ? ['vehicle_id', 'start', 'end']
    : pathname === '/analytics/sleep' ? ['vehicle_id', 'start', 'end', 'days']
      : ['vehicle_id']
  const id = vehicle(params, allowed)
  if (id === undefined) return invalid()
  if (pathname === '/analytics/tco') return ok(tco(id))
  if (pathname === '/analytics/tco/ledger') {
    const body: TcoLedgerResponse = {
      vehicle_id: id, entries: [], totals: { by_category: {}, grand_total: 0, entries: 0 },
    }
    return ok(body)
  }
  if (pathname === '/analytics/battery-degradation') return ok(degradation(id))
  const window = parseWindow(params, pathname === '/analytics/sleep' ? 30 : undefined)
  if (!window) return invalid()
  return pathname === '/analytics/regen'
    ? ok(regen(id, window.from, window.to))
    : ok(sleep(id, window.from, window.to, window.days))
}
