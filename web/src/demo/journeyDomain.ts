import type { Trip, TripDetail } from '@/api/types'
import type { JourneyDetail, JourneySession, JourneyLiveView, JourneyReport } from '@/api/hooks/useJourney'
import { charging, drives, vehicles } from './fixtures'

type FixtureResult = { status: number; body: unknown }
const found = (body: unknown): FixtureResult => ({ status: 200, body })
const invalid = (): FixtureResult => ({
  status: 400, body: { error: 'Invalid demo journey filters', code: 'INVALID_FILTER' },
})
const missing = (path: string): FixtureResult => ({
  status: 404, body: { error: `No synthetic demo data for ${path}`, code: 'DEMO_NOT_AVAILABLE' },
})
const positiveId = (value: string | null): number | null =>
  value != null && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value) : null
const validDate = (value: string | null) => {
  if (value == null) return true
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false
  const day = value.slice(0, 10)
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day
}
const round = (n: number) => Number(n.toFixed(2))

function vehicleFilter(params: URLSearchParams, required: boolean): number | null | false {
  const raw = params.get('vehicle_id')
  if (raw == null && !required) return null
  const id = positiveId(raw)
  return id != null && vehicles.some(vehicle => vehicle.id === id) ? id : false
}

function dateFilter(params: URLSearchParams): boolean {
  const start = params.get('start')
  const end = params.get('end')
  return validDate(start) && validDate(end)
    && (start == null || end == null || Date.parse(start) <= Date.parse(end))
}

function inRange(date: string, params: URLSearchParams): boolean {
  const start = params.get('start')
  const end = params.get('end')
  return (start == null || Date.parse(date) >= Date.parse(start))
    && (end == null || (end.length === 10
      ? Date.parse(date) < Date.parse(end) + 86_400_000
      : Date.parse(date) <= Date.parse(end)))
}

// A single recorded drive is a complete fictional trip; no charging session overlaps
// its boundaries, so trip cost and charge count must not include unrelated charges.
const trips: TripDetail[] = drives.map((drive, index) => {
  const overlapping = charging.filter(session => session.vehicle_id === drive.vehicle_id
    && Date.parse(session.started_at) >= Date.parse(drive.start_ts)
    && Date.parse(session.ended_at) <= Date.parse(drive.end_ts))
  const summary: Trip = {
    id: index + 1, vehicle_id: drive.vehicle_id,
    name: `${drive.start_address} → ${drive.end_address}`,
    start_date: drive.start_ts, started_at: drive.start_ts,
    end_date: drive.end_ts, ended_at: drive.end_ts,
    total_distance_m: drive.distance_m, total_energy_wh: drive.energy_used_wh,
    total_duration_s: drive.duration_s,
    total_cost: round(overlapping.reduce((sum, session) => sum + session.cost_decimal, 0)),
    drive_count: 1, charge_count: overlapping.length,
    created_at: drive.start_ts, created_by_user: null, auto_generated: true, notes: null,
  }
  return {
    ...summary, energy_used_wh: summary.total_energy_wh,
    drives: [{
      id: drive.id, started_at: drive.start_ts, ended_at: drive.end_ts,
      distance_m: drive.distance_m, energy_used_wh: drive.energy_used_wh,
      duration_s: drive.duration_s, start_place: drive.start_address,
      end_place: drive.end_address,
    }],
  }
})

// Planning sessions are illustrative drafts, not purported historical Autopilot activity.
const sessions: JourneySession[] = vehicles.map((vehicle, index) => {
  const drive = drives.find(row => row.vehicle_id === vehicle.id)!
  return {
    id: 701 + index, vehicle_id: vehicle.id,
    name: `Sample ${vehicle.display_name} route`,
    origin_name: drive.start_address, origin_lat: drive.start_lat, origin_lng: drive.start_lon,
    dest_name: drive.end_address, dest_lat: drive.end_lat, dest_lng: drive.end_lon,
    status: 'planned', plan_version: 0, created_at: vehicle.updated_at,
    updated_at: vehicle.updated_at, started_at: null, ended_at: null,
  }
})

function driveScore(id: number): Record<string, number | string> {
  const rows = drives.filter(row => row.vehicle_id === id)
  const whKm = rows.reduce((sum, row) => sum + row.energy_used_wh / (row.distance_m / 1000), 0) / rows.length
  const efficiency = Math.max(0, Math.min(100, Math.round((300 - whKm) / 1.5)))
  const powers = rows.map(row => row.avg_power_w)
  const ratio = Math.max(...powers) / Math.min(...powers)
  const smoothness = Math.max(0, Math.min(100, Math.round((1 - (ratio - 1) / 4) * 100)))
  const speedDiscipline = Math.round(rows.filter(row => row.max_speed_mps < 130 * 0.44704).length / rows.length * 100)
  const overall = Math.round(efficiency * 0.4 + smoothness * 0.3 + speedDiscipline * 0.3)
  const grade = overall > 95 ? 'A+' : overall > 85 ? 'A' : overall > 70 ? 'B'
    : overall > 55 ? 'C' : overall > 40 ? 'D' : 'F'
  return {
    overall, efficiency, smoothness, speed_discipline: speedDiscipline,
    grade, total_drives: rows.length, trend: 'flat',
  } satisfies Record<string, number | string>
}

export function journeyDomain(pathname: string, params: URLSearchParams): FixtureResult | undefined {
  if (pathname === '/trips') {
    const vehicleId = vehicleFilter(params, false)
    const rawLimit = params.get('limit')
    const rawOffset = params.get('offset')
    const limit = rawLimit == null ? 50 : positiveId(rawLimit)
    const offset = rawOffset == null ? 0 : Number(rawOffset)
    if (vehicleId === false || !dateFilter(params) || limit == null || limit > 1000
      || !/^(?:0|[1-9]\d*)$/.test(rawOffset ?? '0') || !Number.isSafeInteger(offset)) return invalid()
    return found(trips.filter(trip => (vehicleId == null || trip.vehicle_id === vehicleId)
      && inRange(trip.started_at, params))
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(offset, offset + limit)
      .map(({ drives: _drives, energy_used_wh: _energy, ...summary }) => summary))
  }

  const tripId = pathname.match(/^\/trips\/([^/]+)$/)
  if (tripId) {
    const id = positiveId(tripId[1])
    if (id == null) return invalid()
    const trip = trips.find(row => row.id === id)
    return trip ? found(trip) : missing(pathname)
  }

  if (pathname === '/journey/sessions') {
    const vehicleId = vehicleFilter(params, true)
    const status = params.get('status')
    const limit = params.has('limit') ? positiveId(params.get('limit')) : 20
    if (vehicleId === false || vehicleId == null || !dateFilter(params)
      || (status && !['planned', 'active', 'paused', 'completed', 'aborted'].includes(status))
      || limit == null || limit > 1000) return invalid()
    return found(sessions.filter(session => session.vehicle_id === vehicleId
      && (!status || session.status === status) && inRange(session.created_at, params))
      .slice(0, limit))
  }

  const journey = pathname.match(/^\/journey\/sessions\/([^/]+)(?:\/(departure|checklist|live|replan|arrival|report|nudge))?$/)
  if (journey) {
    const id = positiveId(journey[1])
    if (id == null) return invalid()
    const session = sessions.find(row => row.id === id)
    if (!session) return missing(pathname)
    const suffix = journey[2]
    if (!suffix) return found({
      session, plans: [], next_statuses: ['active', 'aborted'],
    } satisfies JourneyDetail)
    if (suffix === 'checklist') return missing(pathname)
    if (suffix === 'departure') return found({
      session_id: id, slots: [], recommended_at: null, charge: null, evidence: [],
    })
    if (suffix === 'live') return found({
      session, latest: null, trail: [], progress: null,
      range: { have_wh: null, need_wh: null, eff_wh_km: null, verdict: 'unknown' },
      next: null, evidence: [],
    } satisfies JourneyLiveView)
    if (suffix === 'replan') return found({
      session_id: id, deviation: { deviation_m: null, verdict: 'unknown' }, latest: null, evidence: [],
    })
    if (suffix === 'arrival') return found({
      session_id: id, dest_name: session.dest_name, left_m: null, pace_ms: null,
      eta_at: null, moving: false, verdict: 'unknown', shortfall_wh: null,
      route_factor: null, route_trips: 0, evidence: [],
    })
    if (suffix === 'report') return found({
      session_id: id, status: 'planned', started_at: null, ended_at: null,
      duration_s: null, distance_m: null, fixes: 0, plans: 0, replans: 0,
      detour: null, route_factor: null, route_trips: 0, checklist: null, evidence: [],
    } satisfies JourneyReport)
    return found({ session_id: id, verdict: 'unknown', slot_at: null, blockers: [], evidence: [] })
  }

  if (pathname === '/drives/score') {
    const vehicleId = vehicleFilter(params, true)
    return vehicleId === false || vehicleId == null ? invalid() : found(driveScore(vehicleId))
  }
  if (pathname === '/analytics/route-efficiency') {
    const vehicleId = vehicleFilter(params, true)
    if (vehicleId === false || vehicleId == null || !dateFilter(params)) return invalid()
    const rows = drives.filter(row => row.vehicle_id === vehicleId && inRange(row.start_ts, params))
    const groups = new Map<string, typeof rows>()
    for (const row of rows) {
      const key = `${row.start_address}\0${row.end_address}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    const routes = [...groups.values()].map(group => {
      const efficiency = group.map(row => row.energy_used_wh / (row.distance_m / 1000))
      return {
        start_location: group[0].start_address, end_location: group[0].end_address,
        trip_count: group.length,
        avg_distance_km: round(group.reduce((sum, row) => sum + row.distance_m, 0) / group.length / 1000),
        avg_duration_s: round(group.reduce((sum, row) => sum + row.duration_s, 0) / group.length),
        avg_efficiency: round(efficiency.reduce((sum, value) => sum + value, 0) / group.length),
        best_efficiency: round(Math.min(...efficiency)),
        worst_efficiency: round(Math.max(...efficiency)),
        avg_speed: round(group.reduce((sum, row) => sum + row.avg_speed_mps, 0) / group.length),
        avg_temp: round(group.reduce((sum, row) => sum + row.outside_temp_avg_c, 0) / group.length),
      }
    })
    return found({ routes })
  }
  return undefined
}
