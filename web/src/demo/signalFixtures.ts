import { charging, drives, vehicles } from './fixtures'

type FixtureResult = { status: number; body: unknown }
type SignalPoint = {
  ts: string
  kind: string
  value: number | string
  ingest_origin: 'unknown'
  source_emitted_at: null
  received_at: null
  normalization_version: null
}
type SignalDefinition = {
  category: string
  value_kind: string
  unit_kind: string
}

const definitions: Record<string, SignalDefinition> = {
  BatteryLevel: { category: 'charging', value_kind: 'ValueKindFloat', unit_kind: 'UnitKindCharge' },
  ChargeState: { category: 'charging', value_kind: 'ValueKindEnum', unit_kind: 'UnitKindNone' },
  InsideTemp: { category: 'climate', value_kind: 'ValueKindFloat', unit_kind: 'UnitKindTemperature' },
  Odometer: { category: 'vehicle_state', value_kind: 'ValueKindFloat', unit_kind: 'UnitKindDistance' },
  OutsideTemp: { category: 'climate', value_kind: 'ValueKindFloat', unit_kind: 'UnitKindTemperature' },
  Soc: { category: 'charging', value_kind: 'ValueKindFloat', unit_kind: 'UnitKindCharge' },
  VehicleSpeed: { category: 'driving', value_kind: 'ValueKindFloat', unit_kind: 'UnitKindNone' },
}

const found = (body: unknown): FixtureResult => ({ status: 200, body })
const invalid = (error: string): FixtureResult => ({
  status: 400, body: { error, code: 'INVALID_FILTER' },
})
const missing = (): FixtureResult => ({
  status: 404, body: { error: 'Signal not present in the synthetic demo', code: 'DEMO_NOT_AVAILABLE' },
})

function points(vehicleId: number, name: string): SignalPoint[] {
  const rows: SignalPoint[] = []
  const add = (ts: string, value: number | string) => {
    rows.push({
      ts, kind: definitions[name].value_kind, value,
      ingest_origin: 'unknown', source_emitted_at: null,
      received_at: null, normalization_version: null,
    })
  }
  for (const drive of drives.filter(row => row.vehicle_id === vehicleId)) {
    if (name === 'VehicleSpeed') {
      // The drive summary has an average, not a speed trace; locate this
      // representative value halfway through the completed drive.
      add(new Date((Date.parse(drive.start_ts) + Date.parse(drive.end_ts)) / 2).toISOString(), drive.avg_speed_mps)
    }
    if (name === 'Odometer') {
      add(drive.start_ts, drive.start_odometer_m)
      add(drive.end_ts, drive.end_odometer_m)
    }
    if (name === 'BatteryLevel' || name === 'Soc') {
      add(drive.start_ts, drive.start_soc_pct)
      add(drive.end_ts, drive.end_soc_pct)
    }
    if (name === 'InsideTemp') add(drive.start_ts, drive.inside_temp_avg_c)
    if (name === 'OutsideTemp') add(drive.start_ts, drive.outside_temp_avg_c)
  }
  for (const session of charging.filter(row => row.vehicle_id === vehicleId)) {
    if (name === 'BatteryLevel' || name === 'Soc') {
      add(session.started_at, session.start_soc_pct)
      add(session.ended_at, session.end_soc_pct)
    }
    if (name === 'Odometer') add(session.started_at, session.start_odometer_m)
    if (name === 'ChargeState') {
      add(session.started_at, 4)
      add(session.ended_at, 6)
    }
  }
  return rows.sort((a, b) => a.ts.localeCompare(b.ts))
}

const integer = (value: string | null, min: number, max: number) =>
  value !== null && /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max

export function signalFixtures(path: string, params: URLSearchParams): FixtureResult | undefined {
  const match = /^\/signals\/([^/]+)\/(?:(available|live|stats)|([^/]+)\/history)$/.exec(path)
  if (!match) return undefined
  const [, rawId, endpoint, rawName] = match
  if (!integer(rawId, 1, Number.MAX_SAFE_INTEGER)
    || !vehicles.some(vehicle => vehicle.id === Number(rawId))) {
    return invalid('Invalid demo vehicle ID')
  }
  const vehicleId = Number(rawId)
  if (endpoint === 'available') {
    if ([...params.keys()].length) return invalid('Unexpected signal catalog filters')
    const signals = Object.entries(definitions).map(([name, meta]) => ({
      name, ...meta, is_compound: false, is_setting_unit: false,
    }))
    return found({ vehicle_id: vehicleId, count: signals.length, source: 'synthetic_fixture', signals })
  }
  if (endpoint === 'live') {
    if ([...params.keys()].length) return invalid('Unexpected live signal filters')
    const at = new Date().toISOString()
    const now = Date.parse(at)
    const signals: Record<string, unknown> = {}
    for (const name of Object.keys(definitions)) {
      const history = points(vehicleId, name)
      const last = history[history.length - 1]
      if (!last) continue
      const ageMs = Math.max(0, now - Date.parse(last.ts))
      // Demo aggregates are historical observations, never a live L1/L2 feed.
      if (ageMs <= 120_000) continue
      signals[name] = {
        kind: last.kind, value: last.value, ts: last.ts,
        timestamp: last.ts, source: 'stale', age_ms: ageMs,
      }
    }
    return found({ vehicle_id: vehicleId, count: Object.keys(signals).length, at, signals })
  }
  if (endpoint === 'stats') {
    if ([...params.keys()].length) return invalid('Unexpected signal stats filters')
    const all = Object.keys(definitions).flatMap(name => points(vehicleId, name))
      .sort((a, b) => a.ts.localeCompare(b.ts))
    return found({
      vehicle_id: vehicleId, count: all.length,
      oldest: all[0]?.ts ?? null, newest: all[all.length - 1]?.ts ?? null,
    })
  }

  let name: string
  try {
    name = decodeURIComponent(rawName)
  } catch {
    return invalid('Invalid signal name encoding')
  }
  if (!Object.prototype.hasOwnProperty.call(definitions, name)) return missing()
  const allowed = new Set(['hours', 'from', 'to', 'limit', 'page', 'page_size'])
  if ([...params.keys()].some(key => !allowed.has(key))
    || [...allowed].some(key => params.getAll(key).length > 1)) {
    return invalid('Invalid signal history filters')
  }
  const hours = params.get('hours')
  const limit = params.get('limit')
  const page = params.get('page')
  const pageSize = params.get('page_size')
  const from = params.get('from')
  const to = params.get('to')
  if ((hours !== null && !integer(hours, 1, 24 * 365))
    || (limit !== null && !integer(limit, 1, 10_000))
    || (page !== null && !integer(page, 1, 10_000))
    || (pageSize !== null && !integer(pageSize, 1, 10_000))
    || (from !== null && !/^\d{4}-\d{2}-\d{2}T/.test(from))
    || (to !== null && !/^\d{4}-\d{2}-\d{2}T/.test(to))
    || (from !== null && !Number.isFinite(Date.parse(from)))
    || (to !== null && !Number.isFinite(Date.parse(to)))
    || (from !== null && to !== null && Date.parse(from) > Date.parse(to))) {
    return invalid('Invalid signal history filters')
  }
  const end = to === null ? new Date() : new Date(to)
  const start = from === null
    ? new Date(end.getTime() - Number(hours ?? 24) * 3_600_000)
    : new Date(from)
  if (start > end) return invalid('Invalid signal history range')
  const filtered = points(vehicleId, name).filter(point =>
    Date.parse(point.ts) >= start.getTime() && Date.parse(point.ts) <= end.getTime())
  const pageLimit = Math.min(Number(limit ?? 1000), Number(pageSize ?? 10_000))
  const data = filtered.slice((Number(page ?? 1) - 1) * pageLimit, Number(page ?? 1) * pageLimit)
  return found({
    vehicle_id: vehicleId, signal: name, expected_kind: definitions[name].value_kind,
    from: start.toISOString(), to: end.toISOString(), count: data.length, data,
  })
}
