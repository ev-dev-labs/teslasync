import type {
  Geofence, GeofenceChargingActivity, GeofenceChargingSummary, GeofenceRate,
  GeofenceRateImpactPreview, VisitedPlaceCandidate,
} from '@/api/types'
import { charging, drives } from './fixtures'

type FixtureResult = { status: number; body: unknown }
const ok = (body: unknown): FixtureResult => ({ status: 200, body })
const invalid = (message: string): FixtureResult => ({
  status: 400, body: { error: message, code: 'INVALID_FILTER' },
})
const notFound = (message: string): FixtureResult => ({
  status: 404, body: { error: message, code: 'DEMO_NOT_AVAILABLE' },
})

const first = drives[0]
const latestCharge = charging[0]
const currentFrom = new Date(Date.parse(latestCharge.started_at) - 60_000).toISOString()
const olderFrom = new Date(Date.parse(charging[charging.length - 1].started_at) - 86_400_000).toISOString()

const geofences: Geofence[] = [
  {
    id: 701, name: latestCharge.start_place, category: 'home',
    polygon_wkt: `POLYGON((${first.start_lon - 0.001} ${first.start_lat - 0.001}, ${first.start_lon + 0.001} ${first.start_lat - 0.001}, ${first.start_lon + 0.001} ${first.start_lat + 0.001}, ${first.start_lon - 0.001} ${first.start_lat + 0.001}, ${first.start_lon - 0.001} ${first.start_lat - 0.001}))`,
    latitude: first.start_lat, longitude: first.start_lon, radius: 145,
    enabled: true, alert_on_entry: true, alert_on_exit: false, origin: 'manual',
    needs_review: false, is_charging_location: true,
    created_at: olderFrom, updated_at: currentFrom,
  },
  {
    id: 702, name: 'Sample North Campus Annex', category: 'custom',
    polygon_wkt: `POLYGON((${first.start_lon + 0.006} ${first.start_lat}, ${first.start_lon + 0.007} ${first.start_lat}, ${first.start_lon + 0.007} ${first.start_lat + 0.001}, ${first.start_lon + 0.006} ${first.start_lat + 0.001}, ${first.start_lon + 0.006} ${first.start_lat}))`,
    latitude: first.start_lat + 0.0005, longitude: first.start_lon + 0.0065, radius: 75,
    enabled: false, alert_on_entry: false, alert_on_exit: false,
    origin: 'charging_discovery', needs_review: true, is_charging_location: true,
    created_at: charging[1].started_at, updated_at: charging[1].started_at,
  },
]

const rates: GeofenceRate[] = [
  {
    id: 801, geofence_id: 701,
    rate_per_wh: charging[charging.length - 1].cost_decimal / charging[charging.length - 1].total_energy_added_wh,
    currency: 'USD', effective_from: olderFrom, effective_to: currentFrom, created_at: olderFrom,
  },
  {
    id: 802, geofence_id: 701,
    rate_per_wh: latestCharge.cost_decimal / latestCharge.total_energy_added_wh,
    currency: 'USD', effective_from: currentFrom, effective_to: null, created_at: currentFrom,
  },
]

const activity: GeofenceChargingActivity[] = charging.map(row => ({
  session_id: row.id, vehicle_id: row.vehicle_id, started_at: row.started_at,
  ended_at: row.ended_at, energy_wh: row.total_energy_added_wh,
  cost_decimal: row.cost_decimal, cost_currency: row.cost_currency,
  cost_source: row.id === latestCharge.id ? 'geofence_tariff' : 'manual',
  rate_id: row.id === latestCharge.id ? 802 : null,
}))

function candidateRows(): VisitedPlaceCandidate[] {
  const visits = drives.filter(row => row.end_ts && row.end_address)
  if (!visits.length) return []
  const firstVisit = visits.reduce((a, b) => a.end_ts < b.end_ts ? a : b)
  return [{
    id: Math.min(...visits.map(row => row.id)), name: firstVisit.end_address,
    latitude: firstVisit.end_lat, longitude: firstVisit.end_lon,
    visit_count: visits.length, charge_count: 0,
    last_visited: visits.reduce((a, b) => a.end_ts > b.end_ts ? a : b).end_ts,
    first_charge_at: null,
  }]
}

function preview(geofenceId: number, rate: GeofenceRate, params: URLSearchParams): FixtureResult {
  const from = params.get('from')
  const to = params.get('to')
  const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
  if ((from != null && (!rfc3339.test(from) || !Number.isFinite(Date.parse(from))))
    || (to != null && (!rfc3339.test(to) || !Number.isFinite(Date.parse(to))))
    || (from != null && to != null && Date.parse(from) >= Date.parse(to))) {
    return invalid('Invalid rate preview window')
  }
  const lower = Math.max(Date.parse(rate.effective_from), from == null ? -Infinity : Date.parse(from))
  const upper = Math.min(rate.effective_to == null ? Infinity : Date.parse(rate.effective_to),
    to == null ? Infinity : Date.parse(to))
  const matched = activity.filter(row => Date.parse(row.started_at) >= lower && Date.parse(row.started_at) < upper)
  const eligible = matched.filter(row => row.cost_source === 'geofence_tariff' || row.cost_source === 'unknown')
  const totalEnergy = eligible.reduce((sum, row) => sum + (row.energy_wh ?? 0), 0)
  const result: GeofenceRateImpactPreview = {
    geofence_id: geofenceId, rate_id: rate.id, currency: rate.currency,
    matched_sessions: matched.length, eligible_sessions: eligible.length,
    protected_sessions: matched.length - eligible.length,
    total_energy_wh: totalEnergy, estimated_cost_decimal: Number((totalEnergy * rate.rate_per_wh).toFixed(2)),
  }
  return ok(result)
}

/** Handles geofence GET fixtures only; other methods and domains remain unhandled. */
export function geofenceFixtures(path: string, params: URLSearchParams): FixtureResult | undefined {
  if (path === '/geofences') {
    const archived = params.get('include_archived')
    if (archived != null && archived !== 'true' && archived !== 'false') return invalid('Invalid include_archived')
    return ok(geofences)
  }
  if (path === '/geofences/needs-review') return ok(geofences.filter(row => row.needs_review))
  if (path === '/geofences/visited-candidates') return ok(candidateRows())
  if (path === '/geofences/rates/current') return ok(rates.filter(rate =>
    Date.parse(rate.effective_from) <= Date.now()
      && (rate.effective_to == null || Date.parse(rate.effective_to) > Date.now())))
  if (path === '/geofences/resolve') {
    const lat = params.get('lat')
    const lon = params.get('lon')
    if (lat == null || lon == null || lat.trim() === '' || lon.trim() === ''
      || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))
      || Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180
      || (Number(lat) === 0 && Number(lon) === 0)) return invalid('Invalid place coordinates')
    const match = geofences.find(row =>
      Math.hypot((row.latitude - Number(lat)) * 111_000,
        (row.longitude - Number(lon)) * 111_000 * Math.cos(row.latitude * Math.PI / 180)) <= row.radius)
    return ok({ name: match?.name ?? null, geofence_id: match?.id ?? null })
  }
  const parts = /^\/geofences\/([^/]+)(?:\/(.*))?$/.exec(path)
  if (!parts) return undefined
  if (!/^[1-9]\d*$/.test(parts[1]) || !Number.isSafeInteger(Number(parts[1])))
    return /^-?\d/.test(parts[1]) ? invalid('Invalid geofence ID') : notFound(`No synthetic demo data for ${path}`)
  const id = Number(parts[1])
  const place = geofences.find(row => row.id === id)
  if (!place) return notFound('Geofence not found')
  const suffix = parts[2] ?? ''
  if (suffix === '') return ok(place)
  if (suffix === 'rates') return ok(rates.filter(row => row.geofence_id === id).reverse())
  if (suffix === 'charging-activity') {
    const rawLimit = params.get('limit') ?? '50'
    const rawOffset = params.get('offset') ?? '0'
    if (!/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset)
      || Number(rawLimit) < 1 || Number(rawLimit) > 200
      || !Number.isSafeInteger(Number(rawOffset))) return invalid('Invalid charging activity pagination')
    return ok((place.is_charging_location && !place.needs_review ? activity : [])
      .slice(Number(rawOffset), Number(rawOffset) + Number(rawLimit)))
  }
  if (suffix === 'charging-summary') {
    const rows = place.is_charging_location && !place.needs_review ? activity : []
    const currencies = [...new Set(rows.filter(row => row.cost_decimal != null && row.cost_currency)
      .map(row => row.cost_currency!))]
    const summary: GeofenceChargingSummary[] = currencies.map(currency => {
      const priced = rows.filter(row => row.cost_currency === currency && row.cost_decimal != null)
      return {
        geofence_id: id, currency, session_count: priced.length,
        total_energy_wh: priced.reduce((sum, row) => sum + (row.energy_wh ?? 0), 0),
        total_cost_decimal: Number(priced.reduce((sum, row) => sum + (row.cost_decimal ?? 0), 0).toFixed(2)),
      }
    })
    return ok(summary)
  }
  if (suffix === 'first-charging-session') {
    const firstSession = place.needs_review ? undefined : charging[charging.length - 1]
    return ok({ started_at: firstSession?.started_at ?? null })
  }
  const rateMatch = /^rates\/([^/]+)\/preview$/.exec(suffix)
  if (rateMatch) {
    if (!/^[1-9]\d*$/.test(rateMatch[1]) || !Number.isSafeInteger(Number(rateMatch[1])))
      return invalid('Invalid rate ID')
    const rate = rates.find(row => row.id === Number(rateMatch[1]) && row.geofence_id === id)
    return rate ? preview(id, rate, params) : notFound('Geofence rate not found')
  }
  return notFound(`No synthetic demo data for ${path}`)
}
