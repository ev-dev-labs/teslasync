import { assertDemoModeEnabled } from '@/lib/demoMode'
import type { ClimateSnapshot, SecurityEvent } from '@/api/types'
import { batteryHealth, charging, drives, settings, vehicles } from './fixtures'

type FixtureResult = { status: number; body: unknown }

const found = (body: unknown): FixtureResult => ({ status: 200, body })
const missing = (path: string): FixtureResult => ({
  status: 404,
  body: { error: `No synthetic demo data for ${path}`, code: 'DEMO_NOT_AVAILABLE' },
})

function sampleState(vehicleId: number) {
  const vehicle = vehicles.find(row => row.id === vehicleId)
  if (!vehicle) return null
  return {
    vehicle_id: vehicle.id, state: vehicle.state, battery_level: vehicle.id === 7 ? 72 : 64,
    rated_range: 410_000, ideal_range: 430_000, odometer: 32_100_000,
    speed: 0, power: 0, inside_temp: 21, outside_temp: 18,
    is_charging: false, is_locked: true, updated_at: vehicle.updated_at,
  }
}

function filteredRows<T extends { vehicle_id: number }>(
  rows: T[],
  params: URLSearchParams,
  dateOf: (row: T) => string,
): T[] | FixtureResult {
  const id = params.get('vehicle_id')
  const start = params.get('start')
  const end = params.get('end')
  const limit = Number(params.get('limit') ?? 50)
  const offset = Number(params.get('offset') ?? 0)
  if (
    (id != null && (!/^\d+$/.test(id) || !vehicles.some(vehicle => vehicle.id === Number(id))))
    || (start != null && !Number.isFinite(Date.parse(start)))
    || (end != null && !Number.isFinite(Date.parse(end)))
    || (start != null && end != null && Date.parse(start) > Date.parse(end))
    || !Number.isInteger(limit) || limit < 1 || limit > 1000
    || !Number.isInteger(offset) || offset < 0
  ) {
    return { status: 400, body: { error: 'Invalid demo history filters', code: 'INVALID_FILTER' } }
  }
  return rows
    .filter(row => (id == null || row.vehicle_id === Number(id))
      && (start == null || Date.parse(dateOf(row)) >= Date.parse(start))
      && (end == null || Date.parse(dateOf(row)) < Date.parse(end) + (/^\d{4}-\d{2}-\d{2}$/.test(end) ? 86_400_000 : 0)))
    .slice(offset, offset + limit)
}

function fixture(path: string): FixtureResult {
  const url = new URL(path, 'https://demo.invalid')
  const { pathname, searchParams } = url
  if (pathname === '/vehicles') return found(vehicles)
  if (pathname === '/vehicles/states') {
    const rawIds = searchParams.get('vehicle_ids') ?? ''
    const ids = rawIds.split(',')
    if (ids.length === 0 || ids.some(id => !/^\d+$/.test(id) || !sampleState(Number(id)))) {
      return { status: 400, body: { error: 'Invalid demo vehicle IDs', code: 'INVALID_FILTER' } }
    }
    return found({
      now: new Date().toISOString(), total: ids.length,
      vehicles: ids.map(id => {
        const vehicle = vehicles.find(row => row.id === Number(id))!
        return {
          vehicle_id: vehicle.id, outcome: 'resolved', state: sampleState(vehicle.id),
          live: false, freshness: 'stale', verified_fields: [],
          observed_at: vehicle.updated_at, data_source: 'synthetic',
        }
      }),
    })
  }
  if (pathname === '/settings') return found(settings)
  if (pathname === '/climate/latest' || pathname === '/security/latest') {
    const id = searchParams.get('vehicle_id')
    const vehicle = vehicles.find(row => String(row.id) === id)
    if (!vehicle) {
      return { status: 400, body: { error: 'Invalid demo vehicle ID', code: 'INVALID_FILTER' } }
    }
    if (pathname === '/climate/latest') {
      const snapshot: ClimateSnapshot = {
        vehicle_id: vehicle.id, ts: vehicle.updated_at,
        inside_temp_c: 21, outside_temp_c: 18,
        driver_setpoint_c: 21, passenger_setpoint_c: 21,
        hvac_state: 'Off', hvac_power: false, is_ac_on: false,
        defrost_mode: 'Off', is_climate_on: false,
        is_preconditioning: false, fan_status: 0,
        seat_heater_left: 0, seat_heater_right: 0,
        seat_heater_rear_left: 0, seat_heater_rear_right: 0,
        steering_wheel_heater: false, cabin_overheat_protection: false,
        inside_temp: 21, outside_temp: 18, battery_heater: false,
        source: 'synthetic',
      }
      return found(snapshot)
    }
    const event: SecurityEvent = {
      vehicle_id: vehicle.id, ts: vehicle.updated_at, created_at: vehicle.updated_at,
      event_type: 'state', doors_open: '', windows_open: '',
      locked: true, sentry_mode: false, user_present: false,
      detail: null, source: 'synthetic',
      door_state: 'Closed', fd_window: false, fp_window: false,
      rd_window: false, rp_window: false,
    }
    return found(event)
  }
  if (pathname === '/system/auth-mode') return found({ mode: 'open', forward_auth: false })
  if (pathname === '/auth/status') return found({ authenticated: false, connected: false })
  if (pathname === '/auth/session') {
    return found({ mode: 'open', authenticated: false, expires_at: null, expires_in: null, renewable: false })
  }
  if (pathname === '/onboarding/status') {
    return found({
      setup_required: false, setup_complete: true, is_complete: true,
      tesla_connected: false, vehicle_count: vehicles.length, data_flowing: false,
      last_telemetry_at: null, telemetry_health: 'unknown',
    })
  }
  if (pathname === '/admin/rbac/matrix') return found({ roles: [], permissions: [] })
  if (pathname === '/system/update-check') return found({ update_available: false })
  if (pathname === '/system/map-config') return found({ provider: 'free', api_key: '' })
  const photo = pathname.match(/^\/vehicles\/(\d+)\/photo$/)
  if (photo) return vehicles.some(row => row.id === Number(photo[1]))
    ? found({ has_photo: false, uploaded_at: null })
    : missing(pathname)
  if (pathname === '/export/jobs' || pathname === '/saved-views' || pathname === '/pinned') return found([])
  if (pathname === '/settings/dashboard-layouts') {
    return found({ layouts: [], active_layout_id: null })
  }
  if (pathname === '/push/public-key') return found({ public_key: '' })
  if (pathname === '/admin/impersonate') return found({ mode: 'inactive' })
  if (pathname === '/drives') {
    const rows = filteredRows(drives, searchParams, row => row.start_ts)
    return Array.isArray(rows) ? found(rows) : rows
  }
  if (pathname === '/charging' || pathname === '/charging-sessions') {
    const rows = filteredRows(charging, searchParams, row => row.started_at)
    return Array.isArray(rows) ? found(rows) : rows
  }
  if (pathname === '/dashboard/stats') {
    const recentDrives = drives.filter(row => Date.now() - Date.parse(row.start_ts) < 30 * 86_400_000)
    const totalM = recentDrives.reduce((sum, row) => sum + row.distance_m, 0)
    const totalEnergyWh = recentDrives.reduce((sum, row) => sum + row.energy_used_wh, 0)
    return found({
      totalVehicles: vehicles.length, totalM, totalEnergyWh,
      totalChargingSessions: charging.length, totalTrips: recentDrives.length,
      avgEfficiency: totalM > 0 ? totalEnergyWh / totalM : 0,
      totalCostCents: Math.round(charging.reduce((sum, row) => sum + row.cost_decimal, 0) * 100),
    })
  }
  if (pathname === '/analytics/battery-health') {
    const vehicleId = Number(searchParams.get('vehicle_id'))
    return vehicles.some(row => row.id === vehicleId)
      ? found(batteryHealth(vehicleId))
      : { status: 400, body: { error: 'Invalid demo vehicle ID', code: 'INVALID_FILTER' } }
  }
  const state = pathname.match(/^\/vehicles\/(\d+)\/state$/)
  if (state) {
    const vehicle = vehicles.find(row => row.id === Number(state[1]))
    if (!vehicle) return missing(pathname)
    return found({
      live: false, freshness: 'stale', observed_at: vehicle.updated_at,
      verified_fields: [],
      state: sampleState(vehicle.id),
    })
  }
  const vehicle = pathname.match(/^\/vehicles\/(\d+)$/)
  if (vehicle) return vehicles.some(row => row.id === Number(vehicle[1]))
    ? found(vehicles.find(row => row.id === Number(vehicle[1])))
    : missing(pathname)
  const drive = pathname.match(/^\/drives\/(\d+)$/)
  if (drive) {
    const row = drives.find(item => item.id === Number(drive[1]))
    return row ? found({ ...row, positions: [], telemetry: [] }) : missing(pathname)
  }
  const session = pathname.match(/^\/charging\/(\d+)$/)
  if (session) {
    const row = charging.find(item => item.id === Number(session[1]))
    return row ? found(row) : missing(pathname)
  }
  if (pathname === '/system/health') {
    return found({ status: 'demo', timestamp: new Date().toISOString(), checks: {} })
  }
  if (pathname === '/system/version') {
    return found({ version: 'demo', commit: 'synthetic', build_time: new Date().toISOString() })
  }
  return missing(pathname)
}

export function demoResponse(path: string, method: string): Response {
  assertDemoModeEnabled()
  const result = method.toUpperCase() === 'GET'
    ? fixture(path)
    : { status: 403, body: { error: 'This public demo is read-only', code: 'DEMO_READ_ONLY' } }
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
