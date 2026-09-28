import { assertDemoModeEnabled } from '@/lib/demoMode'
import type { ClimateSnapshot, SecurityEvent } from '@/api/types'
import { fsdAnalytics } from './fsdAnalytics'
import { fleetAnalytics, periodStats } from './fleetAnalytics'
import { locationHistory } from './locationHistory'
import { drivingStats, mileageDaily, mileageMonthly, mileageStats } from './mileage'
import { driveShares, publicDriveShare, sessionShares } from './shareFixtures'
import { vehicleStates } from './vehicleStates'
import { visitedLocations } from './visitedLocations'
import {
  alerts, annotations, batteryHealth, charging, chargingOptimizer, currentOdometerM, drives,
  energyStats, notificationLogs, repairCaseStats, runtimeStatus, settings,
  vampireEvents, vampireStats, vampireWatch, vehicles, workOrders,
} from './fixtures'

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
    rated_range: 410_000, ideal_range: 430_000, odometer: currentOdometerM,
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
  if (pathname === '/analytics/fsd') {
    const rawVehicle = searchParams.get('vehicle_id')
    const rawDrive = searchParams.get('drive_id')
    const rawDays = searchParams.get('days')
    const rawEvidence = searchParams.get('include_evidence')
    if (rawVehicle == null || !/^\d+$/.test(rawVehicle)
      || !vehicles.some(row => String(row.id) === rawVehicle)
      || (rawDrive != null && !/^\d+$/.test(rawDrive))
      || (rawDays != null && (!/^\d+$/.test(rawDays) || Number(rawDays) < 1 || Number(rawDays) > 366))
      || (rawEvidence != null && rawEvidence !== 'true' && rawEvidence !== 'false')) {
      return { status: 400, body: { error: 'Invalid demo FSD filters', code: 'INVALID_FILTER' } }
    }
    try {
      return found(fsdAnalytics(Number(rawVehicle), {
        days: rawDays == null ? undefined : Number(rawDays),
        start: searchParams.get('start') ?? undefined,
        end: searchParams.get('end') ?? undefined,
        timezone: searchParams.get('timezone') ?? undefined,
        includeEvidence: rawEvidence === 'true',
        driveId: rawDrive == null ? undefined : Number(rawDrive),
      }))
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      return { status: 400, body: { error: error.message, code: 'INVALID_FILTER' } }
    }
  }
  if (pathname === '/analytics/fleet') {
    const start = searchParams.get('start') ?? undefined
    const end = searchParams.get('end') ?? undefined
    const rawDays = searchParams.get('days')
    if ((start && !Number.isFinite(Date.parse(start)))
      || (end && !Number.isFinite(Date.parse(end)))
      || (start && end && Date.parse(start) > Date.parse(end))
      || (rawDays != null && (!/^\d+$/.test(rawDays) || Number(rawDays) < 1 || Number(rawDays) > 3650))) {
      return { status: 400, body: { error: 'Invalid demo fleet analytics filters', code: 'INVALID_FILTER' } }
    }
    return found(fleetAnalytics(start, end, start || end ? undefined : rawDays == null ? undefined : Number(rawDays)))
  }
  if (pathname === '/analytics/period-stats') {
    const rawVehicle = searchParams.get('vehicle_id')
    const rawDays = searchParams.get('days')
    const days = Number(rawDays ?? 0)
    if (rawVehicle == null || !/^\d+$/.test(rawVehicle)
      || !vehicles.some(row => String(row.id) === rawVehicle)
      || (rawDays != null && (!/^\d+$/.test(rawDays) || !Number.isInteger(days) || days > 3650))) {
      return { status: 400, body: { error: 'Invalid demo period stats filters', code: 'INVALID_FILTER' } }
    }
    return found(periodStats(Number(rawVehicle), days))
  }
  if (pathname === '/mileage/stats' || pathname === '/mileage/monthly' || pathname === '/mileage/daily') {
    const rawVehicle = searchParams.get('vehicle_id')
    const vehicleId = Number(rawVehicle)
    const rawWindow = pathname === '/mileage/monthly' ? searchParams.get('months') : searchParams.get('days')
    const maxWindow = pathname === '/mileage/monthly' ? 120 : 730
    const window = rawWindow == null ? (pathname === '/mileage/monthly' ? 24 : 90) : Number(rawWindow)
    if (rawVehicle == null || !/^\d+$/.test(rawVehicle)
      || !vehicles.some(row => row.id === vehicleId)
      || (rawWindow != null && (!/^\d+$/.test(rawWindow) || !Number.isInteger(window)
        || window < 1 || window > maxWindow))) {
      return { status: 400, body: { error: 'Invalid demo mileage filters', code: 'INVALID_FILTER' } }
    }
    if (pathname === '/mileage/stats') return found(mileageStats(vehicleId))
    return found(pathname === '/mileage/monthly'
      ? mileageMonthly(vehicleId, window) : mileageDaily(vehicleId, window))
  }
  if (pathname === '/drives/stats') {
    const rawVehicle = searchParams.get('vehicle_id')
    return rawVehicle != null && vehicles.some(row => String(row.id) === rawVehicle)
      ? found(drivingStats(Number(rawVehicle)))
      : { status: 400, body: { error: 'Invalid demo vehicle ID', code: 'INVALID_FILTER' } }
  }
  if (pathname === '/locations') {
    const rawVehicle = searchParams.get('vehicle_id')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const limit = Number(searchParams.get('limit') ?? 50)
    const offset = Number(searchParams.get('offset') ?? 0)
    if ((rawVehicle != null && (!/^\d+$/.test(rawVehicle)
      || !vehicles.some(row => String(row.id) === rawVehicle)))
      || (from != null && !Number.isFinite(Date.parse(from)))
      || (to != null && !Number.isFinite(Date.parse(to)))
      || (from == null) !== (to == null)
      || (from != null && to != null && Date.parse(from) >= Date.parse(to))
      || !Number.isInteger(limit) || limit < 1 || limit > 1000
      || !Number.isInteger(offset) || offset < 0) {
      return { status: 400, body: { error: 'Invalid demo visited locations filters', code: 'INVALID_FILTER' } }
    }
    const matching = drives.filter(row =>
      (rawVehicle == null || row.vehicle_id === Number(rawVehicle))
      && (from == null || Date.parse(row.end_ts) >= Date.parse(from))
      && (to == null || Date.parse(row.end_ts) < Date.parse(to)))
    return found(visitedLocations(matching).slice(offset, offset + limit))
  }
  if (pathname === '/vehicle-states/timeline' || pathname === '/vehicle-states/summary') {
    const rawVehicle = searchParams.get('vehicle_id')
    const rawDays = searchParams.get('days')
    const rawStart = searchParams.get('start')
    const rawEnd = searchParams.get('end')
    const days = Number(rawDays ?? 7)
    const datePattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/
    const validDate = (value: string | null) =>
      value == null || (datePattern.test(value) && Number.isFinite(Date.parse(value)))
    const end = rawEnd == null ? Date.now() : Date.parse(rawEnd)
      + (/^\d{4}-\d{2}-\d{2}$/.test(rawEnd) ? 86_400_000 : 0)
    const start = rawStart == null
      ? rawEnd == null ? end - days * 86_400_000 : 0
      : Date.parse(rawStart)
    if (rawVehicle == null || !/^\d+$/.test(rawVehicle)
      || !vehicles.some(row => String(row.id) === rawVehicle)
      || (rawDays != null && (!/^\d+$/.test(rawDays) || !Number.isInteger(days)
        || days < 1 || days > 3650))
      || !validDate(rawStart) || !validDate(rawEnd)
      || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      return { status: 400, body: { error: 'Invalid demo state history filters', code: 'INVALID_FILTER' } }
    }
    const response = vehicleStates(Number(rawVehicle), start, end,
      rawStart != null || rawEnd != null ? Math.max(1, Math.floor((end - start) / 86_400_000)) : days)
    return found(pathname === '/vehicle-states/summary' ? response.summary : response.timeline)
  }
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
  if (pathname === '/alerts') {
    const vehicleId = searchParams.get('vehicle_id')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const limit = Number(searchParams.get('limit') ?? 50)
    const offset = Number(searchParams.get('offset') ?? 0)
    if ((vehicleId != null && (!/^\d+$/.test(vehicleId) || !vehicles.some(row => row.id === Number(vehicleId))))
      || (from != null && !Number.isFinite(Date.parse(from)))
      || (to != null && !Number.isFinite(Date.parse(to)))
      || (from != null && to != null && Date.parse(from) > Date.parse(to))
      || !Number.isInteger(limit) || limit < 1 || limit > 1000
      || !Number.isInteger(offset) || offset < 0) {
      return { status: 400, body: { error: 'Invalid demo alert filters', code: 'INVALID_FILTER' } }
    }
    return found(alerts.filter(alert =>
      (vehicleId == null || alert.vehicle_id === Number(vehicleId))
      && (from == null || Date.parse(alert.created_at) >= Date.parse(from))
      && (to == null || Date.parse(alert.created_at) < Date.parse(to)))
      .slice(offset, offset + limit))
  }
  if (pathname === '/notifications/unread-count') {
    return found({ count: notificationLogs.filter(log => !log.read_at && !log.archived_at).length })
  }
  if (pathname === '/notifications/logs' || pathname === '/notifications') {
    const limit = Number(searchParams.get('limit') ?? 50)
    const offset = Number(searchParams.get('offset') ?? 0)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0
      || (from != null && !Number.isFinite(Date.parse(from)))
      || (to != null && !Number.isFinite(Date.parse(to)))
      || (from != null && to != null && Date.parse(from) > Date.parse(to))) {
      return { status: 400, body: { error: 'Invalid demo notification filters', code: 'INVALID_FILTER' } }
    }
    const matching = notificationLogs.filter(log =>
      (searchParams.get('read') !== 'false' || !log.read_at)
      && (searchParams.get('read') !== 'true' || !!log.read_at)
      && (searchParams.get('archived') !== 'false' || !log.archived_at)
      && (searchParams.get('archived') !== 'true' || !!log.archived_at)
      && (from == null || Date.parse(log.created_at) >= Date.parse(from))
      && (to == null || Date.parse(log.created_at) < Date.parse(to)))
    if (searchParams.get('count_only') === 'true') return found({ total: matching.length })
    if (searchParams.get('group_key')) return found([])
    if (searchParams.get('grouped') === 'true') {
      return found(matching.slice(offset, offset + limit).map(log => ({
        group_key: null, latest: log, count: 1,
        unread_count: log.read_at ? 0 : 1, vehicle_ids: [alerts[0].vehicle_id],
      })))
    }
    return found(matching.slice(offset, offset + limit))
  }
  if (pathname === '/status/') return found(runtimeStatus())
  if (pathname === '/data-repair/cases/stats') return found(repairCaseStats)
  if (pathname === '/fleet-ops/work-orders') {
    const limit = Number(searchParams.get('limit') ?? 50)
    const offset = Number(searchParams.get('offset') ?? 0)
    const vehicleId = searchParams.get('vehicle_id')
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000
      || !Number.isInteger(offset) || offset < 0
      || (vehicleId != null && !vehicles.some(row => String(row.id) === vehicleId))) {
      return { status: 400, body: { error: 'Invalid demo work-order filters', code: 'INVALID_FILTER' } }
    }
    const filtered = workOrders.filter(row => vehicleId == null || row.vehicle_id === Number(vehicleId))
    return found({ items: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset })
  }
  if (pathname === '/annotations') {
    const vehicleId = searchParams.get('vehicle_id')
    const scope = searchParams.get('scope')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if ((vehicleId != null && !vehicles.some(row => String(row.id) === vehicleId))
      || (from != null && !Number.isFinite(Date.parse(from)))
      || (to != null && !Number.isFinite(Date.parse(to)))
      || (from != null && to != null && Date.parse(from) > Date.parse(to))) {
      return { status: 400, body: { error: 'Invalid demo annotation filters', code: 'INVALID_FILTER' } }
    }
    return found(annotations.filter(row =>
      (vehicleId == null || row.vehicle_id == null || row.vehicle_id === Number(vehicleId))
      && (scope == null || row.scope.includes(scope))
      && (from == null || Date.parse(row.occurred_at) >= Date.parse(from))
      && (to == null || Date.parse(row.occurred_at) < Date.parse(to))))
  }
  if (pathname === '/analytics/charging-optimizer') {
    const vehicleId = Number(searchParams.get('vehicle_id'))
    return vehicles.some(row => row.id === vehicleId)
      ? found(chargingOptimizer(vehicleId))
      : { status: 400, body: { error: 'Invalid demo vehicle ID', code: 'INVALID_FILTER' } }
  }
  if (pathname === '/location-snapshots/latest' || pathname === '/location-snapshots') {
    const vehicleId = searchParams.get('vehicle_id')
    if (!vehicles.some(row => String(row.id) === vehicleId)) {
      return { status: 400, body: { error: 'Invalid demo vehicle ID', code: 'INVALID_FILTER' } }
    }
    const history = locationHistory(Number(vehicleId))
    if (pathname === '/location-snapshots/latest') return found(history[0] ?? null)
    const limit = Number(searchParams.get('limit') ?? 200)
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      return { status: 400, body: { error: 'Invalid demo location limit', code: 'INVALID_FILTER' } }
    }
    return found(history.slice(0, limit))
  }
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
  if (pathname === '/share/sample-link') return found(publicDriveShare())
  const driveShareList = pathname.match(/^\/drives\/(\d+)\/shares$/)
  if (driveShareList) {
    const id = Number(driveShareList[1])
    return drives.some(row => row.id === id) ? found(driveShares(id)) : missing(pathname)
  }
  const sessionShareList = pathname.match(/^\/charging\/(\d+)\/shares$/)
  if (sessionShareList) {
    const id = Number(sessionShareList[1])
    return charging.some(row => row.id === id) ? found(sessionShares(id)) : missing(pathname)
  }
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
  const energy = pathname.match(/^\/vehicles\/(\d+)\/energy$/)
  if (energy) {
    const vehicleId = Number(energy[1])
    const days = Number(searchParams.get('days') ?? 30)
    const start = searchParams.get('start')
    if (!vehicles.some(row => row.id === vehicleId)
      || !Number.isInteger(days) || days < 1 || days > 3650
      || (start != null && !Number.isFinite(Date.parse(start)))) {
      return { status: 400, body: { error: 'Invalid demo energy filters', code: 'INVALID_FILTER' } }
    }
    const periodDays = start == null ? days : Math.max(1, Math.ceil((Date.now() - Date.parse(start)) / 86_400_000))
    return found(energyStats(vehicleId, periodDays))
  }
  if (pathname === '/charging-telemetry/latest') {
    return vehicles.some(row => String(row.id) === searchParams.get('vehicle_id'))
      ? found(null)
      : { status: 400, body: { error: 'Invalid demo vehicle ID', code: 'INVALID_FILTER' } }
  }
  if (pathname === '/vampire-drain/stats' || pathname === '/vampire-drain'
    || pathname === '/vampire-drain/watch') {
    const vehicleId = Number(searchParams.get('vehicle_id'))
    if (!vehicles.some(row => row.id === vehicleId)) {
      return { status: 400, body: { error: 'Invalid demo vehicle ID', code: 'INVALID_FILTER' } }
    }
    if (pathname === '/vampire-drain/stats') return found(vampireStats)
    if (pathname === '/vampire-drain/watch') return found(vampireWatch)
    return found({ vehicle_id: vehicleId, events: vampireEvents })
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
  const positions = pathname.match(/^\/vehicles\/(\d+)\/positions$/)
  if (positions) {
    const vehicleId = Number(positions[1])
    if (!vehicles.some(row => row.id === vehicleId)) return missing(pathname)
    const limit = Number(searchParams.get('limit') ?? 50)
    const days = Number(searchParams.get('days') ?? 30)
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000
      || !Number.isInteger(days) || days < 1 || days > 365) {
      return { status: 400, body: { error: 'Invalid demo position filters', code: 'INVALID_FILTER' } }
    }
    return found(locationHistory(vehicleId)
      .filter(row => Date.parse(row.created_at) >= Date.now() - days * 86_400_000)
      .slice(0, limit)
      .map(row => ({
        ...row, ts: row.created_at, speed: row.speed_mph,
      })))
  }
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
