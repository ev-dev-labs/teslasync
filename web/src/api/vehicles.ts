import { request } from './client'
import type {
  Vehicle,
  VehicleState,
  Position,
  CommandResult,
  TirePressureSnapshot,
  MotorSnapshot,
  ClimateSnapshot,
  SecurityEvent,
  ChargingTelemetry,
  MediaSnapshot,
  VehicleConfigSnapshot,
  LocationSnapshot,
  SafetySnapshot,
  UserPreferenceSnapshot,
  SoftwareUpdate,
  VehicleStateRecord,
  StateSummary,
  DailyStateBreakdown,
} from './types'
export { deriveVehicleStatus as getVehicleStatus } from './types'

// === Vehicles ===
/** Fetches all tracked vehicles. */
export const getVehicles = () => request<Vehicle[]>('/vehicles')
/** Fetches a single vehicle by ID. */
export const getVehicle = (id: number) => request<Vehicle>(`/vehicles/${id}`)
/** Syncs the vehicle list from Tesla's API into the local database. */
export const syncVehicles = () => request<{ synced: number; vehicles: Vehicle[] }>('/vehicles/sync', { method: 'POST' })
/** Vehicle half of the cached `GET /vehicles/{id}/state` shape. Every field
 *  optional so a snapshot that has not fully landed decodes without throwing. */
interface RawStateVehicle {
  id?: number
  state?: string
  is_locked?: boolean
  software_version?: string
}

/** Position half of the cached `GET /vehicles/{id}/state` shape. */
interface RawStatePosition {
  latitude?: number
  longitude?: number
  speed?: number
  power?: number
  battery_level?: number
  rated_range?: number
  ideal_range?: number
  odometer?: number
  inside_temp?: number
  outside_temp?: number
  is_climate_on?: boolean
}

/** Wire shape of `GET /vehicles/{id}/state`: either a pre-assembled `state`
 *  (identified by a `vehicle_id` key) or a `vehicle` + `position` pair. */
interface RawStateResponse {
  state?: VehicleState
  live?: boolean
  vehicle?: RawStateVehicle | null
  position?: RawStatePosition | null
  is_charging?: boolean
  charger_power?: number
  charge_rate?: number
  time_to_full_charge?: number
  is_locked?: boolean
  sentry_mode?: boolean
  software_version?: string
}

/** Fetches the live state (location, battery, climate, etc.) for a vehicle.
 *  The backend returns two formats:
 *  Live/telemetry: { state: VehicleState, live: true }
 *  Cached (no token): { vehicle: Vehicle, position: Position, live: false }
 *  This function normalises both into { state?: VehicleState; live: boolean }.
 *
 *  Null-safety: a 204 / JSON-null / non-object body resolves to
 *  { state: undefined, live: false } instead of throwing on `res.state`. A
 *  vehicle whose snapshot has not arrived yet must render an empty panel, not
 *  crash the caller.
 */
export const getVehicleState = async (id: number): Promise<{ state?: VehicleState; live: boolean }> => {
  const res = await request<RawStateResponse | null>(`/vehicles/${id}/state`)
  if (res == null || typeof res !== 'object') {
    return { state: undefined, live: false }
  }
  const live = res.live ?? false
  if (res.state && typeof res.state === 'object' && 'vehicle_id' in res.state) {
    return { state: res.state, live }
  }
  const v = res.vehicle
  const p = res.position
  if (!v && !p) return { state: res.state, live }
  const state: VehicleState = {
    vehicle_id: v?.id ?? id,
    state: v?.state ?? 'offline',
    latitude: p?.latitude ?? 0,
    longitude: p?.longitude ?? 0,
    speed: p?.speed ?? 0,
    power: p?.power ?? 0,
    battery_level: p?.battery_level ?? 0,
    rated_range: p?.rated_range ?? p?.ideal_range ?? 0,
    ideal_range: p?.ideal_range ?? 0,
    odometer: p?.odometer ?? 0,
    inside_temp: p?.inside_temp ?? 0,
    outside_temp: p?.outside_temp ?? 0,
    is_climate_on: p?.is_climate_on ?? false,
    is_charging: res.is_charging ?? false,
    charger_power: res.charger_power ?? 0,
    charge_rate: res.charge_rate ?? 0,
    time_to_full_charge: res.time_to_full_charge ?? 0,
    is_locked: res.is_locked ?? v?.is_locked ?? true,
    sentry_mode: res.sentry_mode ?? false,
    software_version: res.software_version ?? v?.software_version ?? '',
  }
  return { state, live }
}
/** Fetches recent GPS positions for a vehicle. */
export const getVehiclePositions = (id: number, limit = 100) => request<Position[]>(`/vehicles/${id}/positions?limit=${limit}`)
/** Sends a wake-up command to a sleeping vehicle. */
export const wakeVehicle = (id: number) => request<{ status: string }>(`/vehicles/${id}/wake`, { method: 'POST' })
/** Removes a vehicle from tracking. */
export const deleteVehicle = (id: number) => request<void>(`/vehicles/${id}`, { method: 'DELETE' })

// === Vehicle Commands ===
/** Sends a command (lock, unlock, climate_on, etc.) to a vehicle. */
export const sendCommand = (vehicleId: number, command: string, params?: Record<string, unknown>) =>
  request<CommandResult>(`/vehicles/${vehicleId}/command`, { method: 'POST', body: JSON.stringify({ command, ...params }) })

// === Tire Pressure ===
/** Fetches paginated tire pressure snapshots for a vehicle. */
export const getTirePressure = (vehicleId: number, limit = 100, offset = 0) =>
  request<TirePressureSnapshot[]>(`/tire-pressure?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent tire pressure reading for a vehicle. */
export const getLatestTirePressure = (vehicleId: number) =>
  request<TirePressureSnapshot | null>(`/tire-pressure/latest?vehicle_id=${vehicleId}`)

// === Motor/Powertrain ===
/** Fetches paginated motor/powertrain snapshots for a vehicle. */
export const getMotorData = (vehicleId: number, limit = 100, offset = 0) =>
  request<MotorSnapshot[]>(`/motor?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent motor/powertrain reading for a vehicle. */
export const getMotorLatest = (vehicleId: number) =>
  request<MotorSnapshot | null>(`/motor/latest?vehicle_id=${vehicleId}`)

// === Climate/HVAC ===
/** Fetches paginated climate/HVAC snapshots for a vehicle. */
export const getClimateData = (vehicleId: number, limit = 100, offset = 0) =>
  request<ClimateSnapshot[]>(`/climate?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent climate/HVAC reading for a vehicle. */
export const getClimateLatest = (vehicleId: number) =>
  request<ClimateSnapshot | null>(`/climate/latest?vehicle_id=${vehicleId}`)

// === Security/Access ===
/** Fetches paginated security events for a vehicle. */
export const getSecurityEvents = (vehicleId: number, limit = 100, offset = 0) =>
  request<SecurityEvent[]>(`/security?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent security event for a vehicle. */
export const getSecurityLatest = (vehicleId: number) =>
  request<SecurityEvent | null>(`/security/latest?vehicle_id=${vehicleId}`)

// === Charging Telemetry ===
/** Fetches paginated charging telemetry records for a vehicle. */
export const getChargingTelemetry = (vehicleId: number, limit = 100, offset = 0) =>
  request<ChargingTelemetry[]>(`/charging-telemetry?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent charging telemetry reading for a vehicle. */
export const getChargingTelemetryLatest = (vehicleId: number) =>
  request<ChargingTelemetry | null>(`/charging-telemetry/latest?vehicle_id=${vehicleId}`)

// === Media ===
/** Fetches paginated media snapshots for a vehicle. */
export const getMediaData = (vehicleId: number, limit = 100, offset = 0) =>
  request<MediaSnapshot[]>(`/media?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent media snapshot for a vehicle. */
export const getMediaLatest = (vehicleId: number) =>
  request<MediaSnapshot | null>(`/media/latest?vehicle_id=${vehicleId}`)

// === Vehicle Config ===
/** Fetches paginated vehicle config snapshots for a vehicle. */
export const getVehicleConfigData = (vehicleId: number, limit = 100, offset = 0) =>
  request<VehicleConfigSnapshot[]>(`/vehicle-config?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent vehicle config snapshot for a vehicle. */
export const getVehicleConfigLatest = (vehicleId: number) =>
  request<VehicleConfigSnapshot | null>(`/vehicle-config/latest?vehicle_id=${vehicleId}`)

// === Location Snapshots ===
/** Fetches paginated location snapshots for a vehicle. */
export const getLocationSnapshots = (vehicleId: number, limit = 100, offset = 0) =>
  request<LocationSnapshot[]>(`/location-snapshots?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent location snapshot for a vehicle. */
export const getLocationSnapshotLatest = (vehicleId: number) =>
  request<LocationSnapshot | null>(`/location-snapshots/latest?vehicle_id=${vehicleId}`)

// === Safety ===
/** Fetches paginated safety snapshots for a vehicle. */
export const getSafetyData = (vehicleId: number, limit = 100, offset = 0) =>
  request<SafetySnapshot[]>(`/safety?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent safety snapshot for a vehicle. */
export const getSafetyLatest = (vehicleId: number) =>
  request<SafetySnapshot | null>(`/safety/latest?vehicle_id=${vehicleId}`)

// === User Preferences ===
/** Fetches paginated user preference snapshots for a vehicle. */
export const getUserPreferences = (vehicleId: number, limit = 100, offset = 0) =>
  request<UserPreferenceSnapshot[]>(`/user-preferences?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent user preference snapshot for a vehicle. */
export const getUserPreferenceLatest = (vehicleId: number) =>
  request<UserPreferenceSnapshot | null>(`/user-preferences/latest?vehicle_id=${vehicleId}`)

// === Software Updates ===
/** Fetches software update history, optionally filtered by vehicle. */
export const getSoftwareUpdates = (vehicleId?: number, limit = 100, offset = 0) =>
  request<SoftwareUpdate[]>(`/software-updates?${vehicleId ? `vehicle_id=${vehicleId}&` : ''}limit=${limit}&offset=${offset}`)

// === Vehicle States / Timeline ===
/** Fetches the vehicle state timeline (asleep, online, driving, charging transitions). */
export const getVehicleTimeline = (vehicleId: number, limit = 200, offset = 0) =>
  request<VehicleStateRecord[]>(`/vehicle-states/timeline?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches a summary of time spent in each state over a period. */
export const getStateSummary = (vehicleId: number, days = 30, start?: string) =>
  request<StateSummary[]>(`/vehicle-states/summary?vehicle_id=${vehicleId}&${start ? `start=${start}` : `days=${days}`}`)
/** Fetches daily state breakdown showing minutes in each state per day. */
export const getDailyStateBreakdown = (vehicleId: number, days = 30, start?: string) =>
  request<DailyStateBreakdown[]>(`/vehicle-states/daily?vehicle_id=${vehicleId}&${start ? `start=${start}` : `days=${days}`}`)
