import type {
  MediaSnapshot, MotorSnapshot, SoftwareUpdate, TirePressureSnapshot,
  VehicleConfigSnapshot, VehicleInfoEnvelope, VehicleSettingsResponse,
} from '@/api/types'
import type { VehicleSilence } from '@/api/hooks/useVehicles'
import { settings, vehicles } from './fixtures'

type FixtureResult = { status: number; body: unknown }
const found = (body: unknown): FixtureResult => ({ status: 200, body })
const invalid = (): FixtureResult => ({
  status: 400, body: { error: 'Invalid demo vehicle filters', code: 'INVALID_FILTER' },
})
const missing = (path: string): FixtureResult => ({
  status: 404, body: { error: `No synthetic demo data for ${path}`, code: 'DEMO_NOT_AVAILABLE' },
})

const vehicle = (id: number) => vehicles.find(row => row.id === id)
const idFromQuery = (params: URLSearchParams) => {
  const raw = params.get('vehicle_id')
  return raw != null && /^[1-9]\d*$/.test(raw) && vehicle(Number(raw)) ? Number(raw) : null
}

function historyWindow(params: URLSearchParams): { start: number; end: number; limit: number; offset: number } | null {
  const start = params.get('start')
  const end = params.get('end')
  const limit = params.get('limit') ?? '100'
  const offset = params.get('offset') ?? '0'
  const validDate = (value: string | null) => value == null
    || (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
      && Number.isFinite(Date.parse(value)))
  if (!validDate(start) || !validDate(end)
    || !/^[1-9]\d*$/.test(limit) || Number(limit) > 1000
    || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset))) return null
  const from = start == null ? -Infinity : Date.parse(start)
  const to = end == null ? Infinity : Date.parse(end)
    + (/^\d{4}-\d{2}-\d{2}$/.test(end) ? 86_400_000 : 0)
  return from < to ? { start: from, end: to, limit: Number(limit), offset: Number(offset) } : null
}

function history<T extends { created_at: string }>(rows: T[], params: URLSearchParams): FixtureResult {
  const window = historyWindow(params)
  if (!window) return invalid()
  return found(rows.filter(row => {
    const at = Date.parse(row.created_at)
    return at >= window.start && at < window.end
  }).slice(window.offset, window.offset + window.limit))
}

function config(id: number): VehicleConfigSnapshot & { trim_badging: string } {
  const v = vehicle(id)!
  return {
    id: id * 1000 + 1, vehicle_id: id, car_type: v.model,
    trim: v.trim_badging, trim_badging: v.trim_badging,
    exterior_color: v.exterior_color,
    wheel_type: v.wheel_type, vehicle_name: v.display_name,
    version: 'demo-synthetic', software_update_version: '2026.demo',
    created_at: v.updated_at,
  }
}

function tires(id: number): TirePressureSnapshot {
  const ts = vehicle(id)!.updated_at
  return {
    id: id * 1000 + 2, vehicle_id: id, front_left: 290_000,
    front_right: 292_000, rear_left: 288_000, rear_right: 290_000,
    last_seen_time_fl: ts, last_seen_time_fr: ts,
    last_seen_time_rl: ts, last_seen_time_rr: ts, created_at: ts,
  }
}

function motor(id: number): MotorSnapshot {
  const ts = vehicle(id)!.updated_at
  return {
    vehicle_id: id, ts, created_at: ts, source: 'synthetic',
    torque_nm_front: 0, torque_nm_rear: 0, di_torque: 0,
    motor_rpm_front: 0, motor_rpm_rear: 0,
    motor_temp_c_front: 24, motor_temp_c_rear: 25,
    inverter_temp_c: 24, inverter_temp_rear: 25,
    heatsink_temp_front: 23, heatsink_temp_rear: 24,
    motor_current_front: 0, motor_current_rear: 0,
    state_front: 'Off', state_rear: 'Off', shift_state: 'Park',
    vbat_front: 390, vbat_rear: 390, power_kw: 0, regen_kw: 0,
  }
}

function media(id: number): MediaSnapshot {
  return {
    id: id * 1000 + 3, vehicle_id: id,
    playback_status: 'Stopped', playback_source: 'None',
    audio_volume: 0, created_at: vehicle(id)!.updated_at,
  }
}

function vehicleSettings(id: number): VehicleSettingsResponse {
  const v = vehicle(id)!
  return { settings: [
    { key: 'nickname', value: v.display_name, source: 'vehicle' },
    { key: 'mute_until', value: '', source: 'default' },
    { key: 'charge_cost_tariff_id', value: '', source: 'default' },
    { key: 'units_distance', value: settings.unit_of_length, source: 'user' },
    { key: 'units_temperature', value: settings.unit_of_temp, source: 'user' },
    { key: 'units_energy', value: 'kWh', source: 'default' },
  ] }
}

function silence(id: number): VehicleSilence {
  return {
    vehicle_id: id, status: 'never', last_seen_at: null, silent_for_s: null,
    checked_at: new Date().toISOString(),
    explanation: 'Synthetic demo history is not live telemetry; connectivity cannot be verified.',
  }
}

const managementKinds = new Set([
  'options', 'specs', 'subscriptions', 'upgrades', 'warranty', 'enterprise-roles',
])

/** READ fixtures only; transport and write protection belong to the caller. */
export function vehicleDomain(pathname: string, params: URLSearchParams): FixtureResult | undefined {
  const scoped = pathname.match(/^\/vehicles\/([^/]+)\/(settings|silence|drivers|invitations|options|specs|subscriptions|upgrades|warranty|enterprise-roles)$/)
  if (scoped) {
    const [, rawId, resource] = scoped
    if (!/^[1-9]\d*$/.test(rawId)) return invalid()
    const id = Number(rawId)
    if (!vehicle(id)) return missing(pathname)
    if (resource === 'settings') return found(vehicleSettings(id))
    if (resource === 'silence') return found(silence(id))
    // A fictional vehicle does not have Tesla account grants or invitations.
    if (resource === 'drivers' || resource === 'invitations') return found([])
    if (managementKinds.has(resource)) {
      // These opaque account APIs require a real Tesla fetch. Null explicitly means not fetched.
      const response: VehicleInfoEnvelope = { data: null, fetched_at: null }
      return found(response)
    }
  }

  const endpoints = new Set([
    '/vehicle-config', '/tire-pressure', '/motor', '/media', '/software-updates',
  ])
  const base = pathname.endsWith('/latest') ? pathname.slice(0, -7) : pathname
  if (!endpoints.has(base)) return undefined
  const id = idFromQuery(params)
  if (id == null) return invalid()
  if (base === '/software-updates') {
    if (pathname !== base) return undefined
    // The fake software version in config is not evidence of an installed update event.
    return history([] as SoftwareUpdate[], params)
  }
  const snapshot = base === '/vehicle-config' ? config(id)
    : base === '/tire-pressure' ? tires(id)
      : base === '/motor' ? motor(id) : media(id)
  return pathname.endsWith('/latest') ? found(snapshot) : history([snapshot], params)
}
