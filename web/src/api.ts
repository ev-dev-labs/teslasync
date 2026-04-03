/**
 * @module api
 *
 * TeslaSync API client — typed wrappers around every REST endpoint
 * exposed by the Go backend under `/api/v1`. All requests flow through
 * {@link resilientFetch} for automatic retry, circuit-breaker protection,
 * request deduplication, and offline detection.
 */
import { resilientFetch, ApiError, getApiBase } from './lib/resilience'

export { ApiError }

/**
 * Makes a resilient API request to the given path, with automatic retry
 * and circuit breaker protection.
 * @template T - Expected JSON response type
 * @param path - API endpoint path (without /api/v1 prefix)
 * @param options - Standard fetch RequestInit options
 * @returns Parsed JSON response of type T
 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  return resilientFetch<T>(path, options)
}

// === Core Types ===

export interface Vehicle {
  id: number
  vehicle_id: number
  vin: string
  display_name: string
  model: string
  trim_badging: string
  exterior_color: string
  wheel_type: string
  state: string
  healthy: boolean
  created_at: string
  updated_at: string
}

export interface Position {
  id: number
  vehicle_id: number
  latitude: number
  longitude: number
  speed: number | null
  power: number | null
  heading: number | null
  elevation: number | null
  odometer: number
  ideal_range: number | null
  rated_range: number | null
  battery_level: number
  inside_temp: number | null
  outside_temp: number | null
  is_climate_on: boolean | null
  created_at: string
  fan_status?: number
}

export interface Drive {
  id: number
  vehicle_id: number
  start_date: string
  end_date: string | null
  start_position_id: number | null
  end_position_id: number | null
  start_address_id: number | null
  end_address_id: number | null
  distance: number
  duration_min: number
  start_range_km: number | null
  end_range_km: number | null
  speed_max: number | null
  power_max: number | null
  power_min: number | null
  start_battery_level: number | null
  end_battery_level: number | null
  inside_temp_avg: number | null
  outside_temp_avg: number | null
  // Enhanced tracking (migration 21)
  start_odometer: number | null
  end_odometer: number | null
  speed_avg: number | null
  speed_min: number | null
  start_rated_range_km: number | null
  end_rated_range_km: number | null
  rated_range_avg: number | null
  rated_range_max: number | null
  rated_range_min: number | null
  start_ideal_range_km: number | null
  end_ideal_range_km: number | null
  ideal_range_avg: number | null
  ideal_range_max: number | null
  ideal_range_min: number | null
  start_est_range_km: number | null
  end_est_range_km: number | null
  est_range_avg: number | null
  est_range_max: number | null
  est_range_min: number | null
  soc_start: number | null
  soc_end: number | null
  soc_avg: number | null
  soc_max: number | null
  soc_min: number | null
  usable_soc_start: number | null
  usable_soc_end: number | null
  usable_soc_avg: number | null
  usable_soc_max: number | null
  usable_soc_min: number | null
  elevation_start: number | null
  elevation_end: number | null
  elevation_gain: number | null
  elevation_loss: number | null
  driver_temp_avg: number | null
  passenger_temp_avg: number | null
  battery_heater_on: boolean | null
  start_address: string | null
  end_address: string | null
  start_latitude: number | null
  start_longitude: number | null
  end_latitude: number | null
  end_longitude: number | null
}

export interface ChargingSession {
  id: number
  vehicle_id: number
  start_date: string
  end_date: string | null
  address_id: number | null
  charge_energy_added: number
  charge_energy_used: number | null
  start_battery_level: number
  end_battery_level: number | null
  start_range_km: number | null
  end_range_km: number | null
  charger_phases: number | null
  charger_voltage: number | null
  charger_actual_current: number | null
  charger_power: number | null
  fast_charger_type: string | null
  fast_charger_brand: string | null
  conn_charge_cable: string | null
  cost: number | null
  duration_min: number
  // Enhanced tracking (migration 21)
  latitude: number | null
  longitude: number | null
  location_name: string | null
  inside_temp_avg: number | null
  outside_temp_avg: number | null
  // Joined address details (detail view only)
  address?: {
    id: number
    display_name: string
    latitude: number
    longitude: number
    name: string | null
    house_number: string | null
    road: string | null
    city: string | null
    county: string | null
    state: string | null
    country: string | null
    postcode: string | null
  }
}

export interface DriveTelemetryReading {
  id: number
  drive_id: number
  vehicle_id: number
  latitude: number | null
  longitude: number | null
  elevation: number | null
  heading: number | null
  odometer: number | null
  speed: number | null
  power: number | null
  battery_level: number | null
  soc: number | null
  usable_soc: number | null
  rated_range: number | null
  ideal_range: number | null
  est_range: number | null
  inside_temp: number | null
  outside_temp: number | null
  driver_temp: number | null
  passenger_temp: number | null
  fan_status: number | null
  is_climate_on: boolean | null
  tire_pressure_fl: number | null
  tire_pressure_fr: number | null
  tire_pressure_rl: number | null
  tire_pressure_rr: number | null
  battery_heater_on: boolean | null
  created_at: string
}

export interface ChargeTelemetryReading {
  id: number
  session_id: number
  vehicle_id: number
  battery_level: number | null
  soc: number | null
  power_kw: number | null
  voltage: number | null
  current_amps: number | null
  phases: number | null
  energy_added: number | null
  rated_range: number | null
  ideal_range: number | null
  est_range: number | null
  inside_temp: number | null
  outside_temp: number | null
  battery_temp: number | null
  latitude: number | null
  longitude: number | null
  charge_rate: number | null
  created_at: string
}

export interface Geofence {
  id: number
  name: string
  latitude: number
  longitude: number
  radius: number
  cost_per_kwh: number | null
  created_at?: string
  updated_at?: string
}

export interface AppSettings {
  unit_of_length: string
  unit_of_temp: string
  preferred_range: string
  language: string
  base_cost_per_kwh: number
  api_suspended: boolean
  theme: string
  mode: string
  custom_primary: string
  custom_accent: string
  gas_price_per_unit: number
  gas_unit: string
  gas_efficiency_mpg: number
  google_maps_api_key?: string
  polling_config?: PollingConfig
}

/** Per-endpoint toggle config for Tesla Fleet API calls. */
export interface PollingConfig {
  // Polling endpoints
  vehicle_discovery: boolean
  charge_state: boolean
  climate_state: boolean
  drive_state: boolean
  location_data: boolean
  vehicle_state: boolean
  vehicle_config: boolean
  // On-demand endpoints
  nearby_charging_sites: boolean
  release_notes: boolean
  recent_alerts: boolean
  service_data: boolean
  // Commands
  wake_up: boolean
  commands: boolean
}

export interface VehicleState {
  vehicle_id: number
  state: string
  latitude: number
  longitude: number
  speed: number
  power: number
  battery_level: number
  rated_range: number
  ideal_range: number
  odometer: number
  inside_temp: number
  outside_temp: number
  is_climate_on: boolean
  is_charging: boolean
  charger_power: number
  charge_rate: number
  time_to_full_charge: number
  is_locked: boolean
  sentry_mode: boolean
  software_version: string
}

export interface AuthStatus {
  authenticated: boolean
  expires_at?: string
  expired?: boolean
}

// === New Feature Types ===

export interface EnergyStats {
  total_energy_used_kwh: number
  total_energy_charged_kwh: number
  avg_efficiency_wh_km: number
  total_distance_km: number
  total_cost: number
  co2_saved_kg: number
  daily_breakdown: { date: string; energy_kwh: number; distance_km: number; efficiency: number }[]
}

export interface BatteryReport {
  vehicle_id: number
  current_capacity_pct: number
  degradation_pct: number
  estimated_range_new_km: number
  estimated_range_current_km: number
  total_cycles: number
  health_score: number
  monthly_trend: { month: string; capacity_pct: number; range_km: number }[]
}

export interface Alert {
  id: number
  vehicle_id: number
  type: 'geofence_exit' | 'geofence_enter' | 'low_battery' | 'charging_complete' | 'sentry_event' | 'speed_limit' | 'temperature' | 'software_update'
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  is_read: boolean
  created_at: string
}

export interface AlertRule {
  id: number
  name: string
  type: string
  enabled: boolean
  threshold: number
  vehicle_id: number | null
  created_at: string
  updated_at: string
}

export interface StatsSummary {
  min: number; max: number; avg: number; median: number; p95: number; count: number
}

export interface FleetAnalytics {
  period_days: number
  total_vehicles: number
  total_distance_km: number
  total_drives: number
  total_charging_sessions: number
  total_energy_kwh: number
  total_cost: number
  avg_efficiency_wh_km: number
  most_efficient_vehicle: { id: number; name: string; efficiency: number } | null
  vehicle_comparison: { id: number; name: string; distance: number; energy: number; efficiency: number; drives: number }[]

  drive_analytics: {
    hourly_pattern: { hour: number; drives: number; distance: number }[]
    day_of_week: { day: string; drives: number; distance: number; avg_distance: number }[]
    speed_distribution: { range: string; count: number }[]
    distance_distribution: { range: string; count: number }[]
    speed_stats: StatsSummary
    power_stats: StatsSummary
    regen_stats: StatsSummary
    duration_stats: StatsSummary
    distance_stats: StatsSummary
    efficiency_stats: StatsSummary
    daily_trend: { date: string; drives: number; distance: number; efficiency?: number }[]
    temp_vs_efficiency: { temp: number; efficiency: number; distance: number }[]
    duration_distribution?: { range: string; count: number }[]
    temperature: { inside: StatsSummary; outside: StatsSummary }
  }

  charging_analytics: {
    hourly_pattern: { hour: number; charges: number; energy: number }[]
    charger_types: { type: string; count: number }[]
    charger_brands: { brand: string; count: number }[]
    monthly_trend: { month: string; energy: number; cost: number; sessions: number; avg_power: number; gas_cost: number; savings: number }[]
    power_stats: StatsSummary
    duration_stats: StatsSummary
    energy_stats: StatsSummary
    cost_stats: StatsSummary
    start_battery_dist: { range: string; count: number }[]
    efficiency_stats: StatsSummary
  }

  battery_trend: { date: string; health_score: number; capacity_kwh: number; degradation_pct: number; range_km: number; cycle_count: number }[]
}

export interface CommandResult {
  success: boolean
  message: string
}

// === Notification Types ===

export interface NotificationChannel {
  id: number
  name: string
  type: 'discord' | 'email' | 'slack' | 'telegram' | 'webhook' | 'ntfy' | 'pushover'
  config: Record<string, string>
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface NotificationLog {
  id: number
  channel_id: number
  alert_id: number | null
  title: string
  message: string
  status: 'pending' | 'sent' | 'failed'
  error: string
  created_at: string
  sent_at: string | null
  scheduled_at?: string
  latency_ms?: number
}

export interface NotificationStats {
  total_sent: number
  sent: number
  failed: number
  pending: number
  total_channels: number
  enabled_channels: number
}

// === Worker Health Types ===

export interface WorkerStatus {
  name: string
  host: string
  status: 'healthy' | 'unhealthy' | 'down'
  latency_ms: number
  error?: string
}

export interface WorkersHealth {
  workers: WorkerStatus[]
  total: number
  healthy_count: number
}

// === Chatbot Types ===

export interface ChatMessage {
  id: number
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface ChatResponse {
  response: string
  session_id: string
}

export type VehicleStatus = 'online' | 'offline' | 'asleep' | 'driving' | 'charging' | 'updating'

// === New Data Types ===

export interface TirePressureSnapshot {
  id: number
  vehicle_id: number
  front_left: number | null
  front_right: number | null
  rear_left: number | null
  rear_right: number | null
  created_at: string
}

export interface MotorSnapshot {
  id: number
  vehicle_id: number
  di_state?: string
  di_torque?: number
  di_axle_speed?: number
  di_stator_temp?: number
  pedal_position?: number
  brake_pedal?: boolean
  lateral_accel?: number
  longitudinal_accel?: number
  vehicle_speed?: number
  gear?: string
  di_torque_actual_f?: number
  di_torque_actual_r?: number
  di_torque_actual_rel?: number
  di_torque_actual_rer?: number
  di_axle_speed_f?: number
  di_axle_speed_rel?: number
  di_axle_speed_rer?: number
  di_state_f?: string
  di_state_rel?: string
  di_state_rer?: string
  di_stator_temp_f?: number
  di_stator_temp_rel?: number
  di_stator_temp_rer?: number
  di_heatsink_t_f?: number
  di_heatsink_t_r?: number
  di_heatsink_t_rel?: number
  di_heatsink_t_rer?: number
  di_inverter_t_f?: number
  di_inverter_t_r?: number
  di_inverter_t_rel?: number
  di_inverter_t_rer?: number
  di_motor_current_f?: number
  di_motor_current_r?: number
  di_motor_current_rel?: number
  di_motor_current_rer?: number
  di_v_bat_f?: number
  di_v_bat_r?: number
  di_v_bat_rel?: number
  di_v_bat_rer?: number
  di_slave_torque_cmd?: number
  hvil?: string
  brake_pedal_pos?: number
  cruise_set_speed?: number
  drive_rail?: boolean
  created_at: string
}

export interface ClimateSnapshot {
  id: number
  vehicle_id: number
  inside_temp?: number
  outside_temp?: number
  hvac_power?: number
  hvac_fan_speed?: number
  hvac_left_temp_request?: number
  hvac_right_temp_request?: number
  cabin_overheat_mode?: string
  defrost_mode?: boolean
  battery_heater_on?: boolean
  hvac_ac_enabled?: boolean
  hvac_auto_mode?: string
  hvac_fan_status?: number
  hvac_steering_wheel_heat_auto?: boolean
  hvac_steering_wheel_heat_level?: number
  climate_keeper_mode?: string
  cabin_overheat_protection_temp_limit?: string
  defrost_for_preconditioning?: boolean
  seat_heater_left?: number
  seat_heater_right?: number
  seat_heater_rear_left?: number
  seat_heater_rear_center?: number
  seat_heater_rear_right?: number
  seat_vent_enabled?: boolean
  climate_seat_cooling_front_left?: number
  climate_seat_cooling_front_right?: number
  auto_seat_climate_left?: boolean
  auto_seat_climate_right?: boolean
  rear_defrost_enabled?: boolean
  rear_display_hvac_enabled?: boolean
  wiper_heat_enabled?: boolean
  created_at: string
}

export interface SecurityEvent {
  id: number
  vehicle_id: number
  locked?: boolean
  sentry_mode?: boolean
  door_state?: string
  fd_window?: string
  fp_window?: string
  rd_window?: string
  rp_window?: string
  homelink_nearby?: boolean
  guest_mode?: boolean
  homelink_device_count?: number
  guest_mode_mobile_access_state?: string
  driver_seat_occupied?: boolean
  center_display?: string
  speed_limit_mode?: boolean
  valet_mode_enabled?: boolean
  service_mode?: boolean
  current_limit_mph?: number
  paired_phone_key_count?: number
  lights_hazards_active?: boolean
  lights_high_beams?: boolean
  lights_turn_signal?: string
  tonneau_position?: string
  tonneau_open_percent?: number
  tonneau_tent_mode?: string
  driver_seat_belt?: boolean
  passenger_seat_belt?: boolean
  created_at: string
}

export interface SoftwareUpdate {
  id: number
  vehicle_id: number
  version: string
  status: string
  scheduled_at: string | null
  installed_at: string | null
  created_at: string
}

export interface VampireDrainEvent {
  id: number
  vehicle_id: number
  start_date: string
  end_date: string | null
  start_battery: number
  end_battery: number | null
  battery_lost: number
  range_lost_km: number
  duration_hours: number
  drain_rate_pct_per_hour: number
  outside_temp_avg: number | null
  sentry_mode: boolean
  created_at: string
}

export interface VampireDrainStats {
  avg_drain_rate: number
  max_drain_rate: number
  total_range_lost: number
  total_hours: number
  event_count: number
  avg_sentry_drain: number
  avg_nosentry_drain: number
}

export interface DailyMileage {
  id: number
  vehicle_id: number
  date: string
  distance_km: number
  odometer_start: number
  odometer_end: number
  drive_count: number
  energy_used_kwh: number
}

export interface MonthlyMileage {
  month: string
  distance: number
  drives: number
  energy: number
  odometer: number
}

export interface MileageStats {
  total_distance: number
  avg_daily: number
  max_daily: number
  total_energy: number
  total_drives: number
  days_tracked: number
}

export interface VisitedLocation {
  id: number
  vehicle_id: number
  address_id: number | null
  address_name: string
  visit_count: number
  total_duration_min: number
  last_visited: string | null
  created_at: string
}

export interface Trip {
  id: number
  vehicle_id: number
  name: string | null
  start_date: string
  end_date: string | null
  total_distance_km: number
  total_energy_kwh: number
  total_cost: number
  drive_count: number
  charge_count: number
  created_at: string
}

export interface VehicleStateRecord {
  id: number
  vehicle_id: number
  state: string
  start_date: string
  end_date: string | null
  duration_min: number
  created_at: string
}

export interface StateSummary {
  state: string
  count: number
  total_min: number
}

export interface DailyStateBreakdown {
  day: string
  state: string
  total_min: number
}

/** Derives a display-friendly vehicle status from the vehicle record and optional live state. */
export function getVehicleStatus(v: Vehicle, state?: VehicleState | null): VehicleStatus {
  if (state?.is_charging) return 'charging'
  if (state?.speed && state.speed > 0) return 'driving'
  if (v.state === 'online') return 'online'
  if (v.state === 'asleep') return 'asleep'
  return 'offline'
}

// === Auth ===
/** Returns the current Tesla OAuth authentication status. */
export const getAuthStatus = () => request<AuthStatus>('/auth/status')
/** Fetches the Tesla OAuth authorization URL and CSRF state token. */
export const getAuthURL = () => request<{ auth_url: string; state: string }>('/auth/login')
/** Refreshes the Tesla OAuth access token using the stored refresh token. */
export const refreshAuth = () => request<{ status: string }>('/auth/refresh', { method: 'POST' })

export const disconnectAuth = () => request<{ status: string }>('/auth/disconnect', { method: 'POST' })

// === Vehicles ===
/** Fetches all tracked vehicles. */
export const getVehicles = () => request<Vehicle[]>('/vehicles')
/** Fetches a single vehicle by ID. */
export const getVehicle = (id: number) => request<Vehicle>(`/vehicles/${id}`)
/** Syncs the vehicle list from Tesla's API into the local database. */
export const syncVehicles = () => request<{ synced: number; vehicles: Vehicle[] }>('/vehicles/sync', { method: 'POST' })
/** Fetches the live state (location, battery, climate, etc.) for a vehicle. */
export const getVehicleState = (id: number) => request<{ state?: VehicleState; live: boolean }>(`/vehicles/${id}/state`)
/** Fetches recent GPS positions for a vehicle. */
export const getVehiclePositions = (id: number, limit = 100) => request<Position[]>(`/vehicles/${id}/positions?limit=${limit}`)
/** Sends a wake-up command to a sleeping vehicle. */
export const wakeVehicle = (id: number) => request<{ status: string }>(`/vehicles/${id}/wake`, { method: 'POST' })
/** Removes a vehicle from tracking. */
export const deleteVehicle = (id: number) => request<void>(`/vehicles/${id}`, { method: 'DELETE' })

// === Drives ===
/** Fetches paginated driving sessions for a vehicle, optionally filtered by date range. */
export const getDrives = (vehicleId: number, limit = 50, offset = 0, start?: string, end?: string) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), limit: String(limit), offset: String(offset) })
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  return request<Drive[]>(`/drives?${params}`)
}
/** Fetches a single drive session by ID. */
export const getDrive = (id: number) => request<Drive>(`/drives/${id}`)
/** Fetches positions within a drive's time window. */
export const getDrivePositions = (driveId: number) => request<Position[]>(`/drives/${driveId}/positions`)
/** Fetches detailed telemetry readings for a drive session. */
export const getDriveTelemetry = (driveId: number) =>
  request<DriveTelemetryReading[]>(`/drives/${driveId}/telemetry`)

// === Charging ===
/** Fetches paginated charging sessions for a vehicle, optionally filtered by date range. */
export const getChargingSessions = (vehicleId: number, limit = 50, offset = 0, start?: string, end?: string) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), limit: String(limit), offset: String(offset) })
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  return request<ChargingSession[]>(`/charging?${params}`)
}
/** Fetches a single charging session by ID. */
export const getChargingSession = (id: number) => request<ChargingSession>(`/charging/${id}`)
/** Fetches detailed telemetry readings for a charging session. */
export const getChargeTelemetry = (sessionId: number) =>
  request<ChargeTelemetryReading[]>(`/charging/${sessionId}/telemetry`)

// === Geofences ===
/** Fetches all geofences. */
export const getGeofences = () => request<Geofence[]>('/geofences')
/** Creates a new geofence with the given location and radius. */
export const createGeofence = (g: Omit<Geofence, 'id'>) => request<Geofence>('/geofences', { method: 'POST', body: JSON.stringify(g) })
/** Updates an existing geofence by ID. */
export const updateGeofence = (id: number, g: Omit<Geofence, 'id'>) => request<Geofence>(`/geofences/${id}`, { method: 'PUT', body: JSON.stringify(g) })
/** Deletes a geofence by ID. */
export const deleteGeofence = (id: number) => request<void>(`/geofences/${id}`, { method: 'DELETE' })

// === Settings ===
/** Fetches current application settings (units, language, cost). */
export const getSettings = () => request<AppSettings>('/settings')
/** Persists updated application settings. */
export const updateSettings = (s: AppSettings) => request<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(s) })
/** Toggles the Tesla API suspension flag (blocks all Tesla Fleet API calls). */
export const toggleAPISuspend = (suspended: boolean) =>
  request<{ api_suspended: boolean }>('/settings/suspend-api', { method: 'POST', body: JSON.stringify({ suspended }) })
/** Fetches the current polling endpoint configuration. */
export const getPollingConfig = () => request<PollingConfig>('/settings/polling-config')
/** Updates the polling endpoint configuration. */
export const updatePollingConfig = (pc: PollingConfig) =>
  request<PollingConfig>('/settings/polling-config', { method: 'PUT', body: JSON.stringify(pc) })

// === Vehicle Commands ===
/** Sends a command (lock, unlock, climate_on, etc.) to a vehicle. */
export const sendCommand = (vehicleId: number, command: string, params?: Record<string, unknown>) =>
  request<CommandResult>(`/vehicles/${vehicleId}/command`, { method: 'POST', body: JSON.stringify({ command, ...params }) })

// === Energy ===
/** Fetches energy consumption and efficiency stats for a vehicle. */
export const getEnergyStats = (vehicleId: number, days = 30, start?: string) =>
  request<EnergyStats>(`/vehicles/${vehicleId}/energy?${start ? `start=${start}` : `days=${days}`}`)

// === Battery Health ===
/** Fetches the battery health report including degradation and capacity trends. */
export const getBatteryReport = (vehicleId: number) =>
  request<BatteryReport>(`/vehicles/${vehicleId}/battery`)

// === Alerts ===
/** Fetches paginated alerts (most recent first). */
export const getAlerts = (limit = 50, offset = 0) => request<Alert[]>(`/alerts?limit=${limit}&offset=${offset}`)
/** Marks an alert as read. */
export const markAlertRead = (id: number) => request<void>(`/alerts/${id}/read`, { method: 'POST' })
/** Fetches all configured alert rules. */
export const getAlertRules = () => request<AlertRule[]>('/alerts/rules')
/** Updates an alert rule (e.g. threshold, enabled state). */
export const updateAlertRule = (id: number, r: Partial<AlertRule>) => request<AlertRule>(`/alerts/rules/${id}`, { method: 'PUT', body: JSON.stringify(r) })
/** Creates a new alert rule. */
export const createAlertRule = (r: Omit<AlertRule, 'id' | 'created_at' | 'updated_at'>) => request<AlertRule>('/alerts/rules', { method: 'POST', body: JSON.stringify(r) })
/** Deletes an alert rule by ID. */
export const deleteAlertRule = (id: number) => request<void>(`/alerts/rules/${id}`, { method: 'DELETE' })

// === Fleet Analytics ===
/** Fetches aggregated fleet-wide analytics (drives, charging, efficiency, trends). */
export const getFleetAnalytics = (days = 30, start?: string) => request<FleetAnalytics>(`/analytics/fleet?${start ? `start=${start}` : `days=${days}`}`)

// === Charging Heatmap ===

export interface ChargingHeatmapCell {
  day_of_week: number
  hour_of_day: number
  session_count: number
  avg_energy: number
  avg_cost: number
}

export interface ChargingLocationBreakdown {
  location: string
  count: number
  total_kwh: number
  total_cost: number
  avg_power: number
}

export interface ChargingHeatmapSummary {
  total_sessions: number
  total_kwh: number
  total_cost: number
  avg_duration: number
}

export interface ChargingHeatmapData {
  heatmap: ChargingHeatmapCell[]
  locations: ChargingLocationBreakdown[]
  summary: ChargingHeatmapSummary
}

export const getChargingHeatmap = (vehicleId: number) =>
  request<ChargingHeatmapData>(`/analytics/charging-heatmap?vehicle_id=${vehicleId}`)

// === Speed Profile ===

export interface SpeedBucket {
  speed_bucket: string
  readings: number
  avg_power_kw: number
}

export interface EfficiencyCategory {
  category: string
  drive_count: number
  avg_speed: number
  battery_pct_per_100km: number
}

export interface EfficiencyPoint {
  speed_avg: number
  distance: number
  efficiency: number
}

export interface SpeedProfileData {
  distribution: SpeedBucket[]
  categories: EfficiencyCategory[]
  points: EfficiencyPoint[]
}

export const getSpeedProfile = (vehicleId: number) =>
  request<SpeedProfileData>(`/analytics/speed-profile?vehicle_id=${vehicleId}`)

// === Temperature Impact ===

export interface TempEfficiencyBucket {
  temp_bucket: string
  drive_count: number
  avg_distance_km: number
  avg_duration_min: number
  avg_battery_pct_per_100km: number
  avg_temp: number
}

export interface VampireDrainBucket {
  temp_bucket: string
  avg_drain_rate: number
  event_count: number
}

export interface MonthlyTempTrend {
  month: string
  avg_temp: number
  avg_efficiency: number
  drive_count: number
  total_distance: number
}

export interface TemperatureImpactData {
  efficiency: TempEfficiencyBucket[]
  vampire_drain: VampireDrainBucket[]
  monthly_trend: MonthlyTempTrend[]
}

export const getTemperatureImpact = (vehicleId: number) =>
  request<TemperatureImpactData>(`/analytics/temperature-impact?vehicle_id=${vehicleId}`)

// === Route Efficiency ===

export interface RouteSummary {
  start_location: string
  end_location: string
  trip_count: number
  avg_distance_km: number
  avg_duration_min: number
  avg_efficiency: number
  best_efficiency: number
  worst_efficiency: number
  avg_speed: number
  avg_temp: number
}

export interface RouteDriveDetail {
  id: number
  start_date: string
  distance: number
  duration_min: number
  speed_avg: number
  start_battery_level: number
  end_battery_level: number
  outside_temp_avg: number
  efficiency: number
}

export interface RouteEfficiencyData {
  routes: RouteSummary[]
}

export interface RouteDetailData {
  drives: RouteDriveDetail[]
}

export const getRouteEfficiency = (vehicleId: number) =>
  request<RouteEfficiencyData>(`/analytics/route-efficiency?vehicle_id=${vehicleId}`)

export const getRouteEfficiencyDetail = (vehicleId: number, start: string, end: string) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), start, end })
  return request<RouteDetailData>(`/analytics/route-efficiency/detail?${params}`)
}
/** Fetches all notification channels (discord, email, slack, etc.). */
export const getNotificationChannels = () => request<NotificationChannel[]>('/notifications')
/** Fetches a single notification channel by ID. */
export const getNotificationChannel = (id: number) => request<NotificationChannel>(`/notifications/${id}`)
/** Creates a new notification channel with the given type and config. */
export const createNotificationChannel = (ch: Omit<NotificationChannel, 'id' | 'created_at' | 'updated_at'>) =>
  request<NotificationChannel>('/notifications', { method: 'POST', body: JSON.stringify(ch) })
/** Updates an existing notification channel by ID. */
export const updateNotificationChannel = (id: number, ch: Omit<NotificationChannel, 'id' | 'created_at' | 'updated_at'>) =>
  request<NotificationChannel>(`/notifications/${id}`, { method: 'PUT', body: JSON.stringify(ch) })
/** Deletes a notification channel by ID. */
export const deleteNotificationChannel = (id: number) => request<void>(`/notifications/${id}`, { method: 'DELETE' })
/** Toggles a notification channel on or off. */
export const toggleNotificationChannel = (id: number, enabled: boolean) =>
  request<void>(`/notifications/${id}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) })
/** Sends a test message through a notification channel to verify its config. */
export const testNotificationChannel = (id: number) =>
  request<{ success: boolean; error?: string; message?: string }>(`/notifications/${id}/test`, { method: 'POST' })
/** Fetches paginated notification delivery logs. */
export const getNotificationLogs = (limit = 50, offset = 0) =>
  request<NotificationLog[]>(`/notifications/logs?limit=${limit}&offset=${offset}`)
/** Fetches aggregate notification statistics (sent, failed, pending counts). */
export const getNotificationStats = () => request<NotificationStats>('/notifications/stats')

// === Workers Health ===
/** Fetches health status of background worker services. */
export const getWorkersHealth = () => request<WorkersHealth>('/system/workers')

// === Chatbot ===
/** Sends a user message and receives an AI assistant response. */
export const sendChatMessage = (message: string, sessionId?: string) =>
  request<ChatResponse>('/chatbot', { method: 'POST', body: JSON.stringify({ message, session_id: sessionId }) })
/** Fetches the full chat history for a given session. */
export const getChatHistory = (sessionId: string) =>
  request<ChatMessage[]>(`/chatbot/history?session_id=${sessionId}`)
/** Lists all available chat session IDs. */
export const getChatSessions = () => request<string[]>('/chatbot/sessions')

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
export interface ChargingTelemetry {
  id: number
  vehicle_id: number
  battery_level?: number
  soc?: number
  charge_state?: string
  detailed_charge_state?: string
  charge_limit_soc?: number
  charge_amps?: number
  charge_current_request?: number
  charge_current_request_max?: number
  charge_enable_request?: boolean
  charger_voltage?: number
  charger_phases?: number
  charge_rate_mph?: number
  dc_charging_power?: number
  dc_charging_energy_in?: number
  ac_charging_power?: number
  ac_charging_energy_in?: number
  energy_remaining?: number
  est_battery_range?: number
  ideal_battery_range?: number
  rated_range?: number
  pack_voltage?: number
  pack_current?: number
  charge_port_door_open?: boolean
  charge_port_latch?: string
  charge_port_cold_weather_mode?: boolean
  charging_cable_type?: string
  fast_charger_present?: boolean
  fast_charger_type?: string
  time_to_full_charge?: number
  estimated_hours_to_charge?: number
  scheduled_charging_mode?: string
  scheduled_charging_pending?: boolean
  preconditioning_enabled?: boolean
  brick_voltage_max?: number
  brick_voltage_min?: number
  num_brick_voltage_max?: number
  num_brick_voltage_min?: number
  module_temp_max?: number
  module_temp_min?: number
  num_module_temp_max?: number
  num_module_temp_min?: number
  battery_heater_on?: boolean
  not_enough_power_to_heat?: boolean
  bms_state?: string
  bms_fullcharge_complete?: boolean
  dcdc_enable?: boolean
  isolation_resistance?: number
  lifetime_energy_used?: number
  supercharger_session_trip_planner?: boolean
  powershare_status?: string
  powershare_type?: string
  powershare_stop_reason?: string
  powershare_hours_left?: number
  powershare_power_kw?: number
  created_at: string
}

/** Fetches paginated charging telemetry records for a vehicle. */
export const getChargingTelemetry = (vehicleId: number, limit = 100, offset = 0) =>
  request<ChargingTelemetry[]>(`/charging-telemetry?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent charging telemetry reading for a vehicle. */
export const getChargingTelemetryLatest = (vehicleId: number) =>
  request<ChargingTelemetry | null>(`/charging-telemetry/latest?vehicle_id=${vehicleId}`)

// === Media ===
export interface MediaSnapshot {
  id: number
  vehicle_id: number
  now_playing_title?: string
  now_playing_artist?: string
  now_playing_album?: string
  now_playing_station?: string
  now_playing_duration?: number
  now_playing_elapsed?: number
  playback_status?: string
  playback_source?: string
  audio_volume?: number
  audio_volume_max?: number
  created_at: string
}

/** Fetches paginated media snapshots for a vehicle. */
export const getMediaData = (vehicleId: number, limit = 100, offset = 0) =>
  request<MediaSnapshot[]>(`/media?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent media snapshot for a vehicle. */
export const getMediaLatest = (vehicleId: number) =>
  request<MediaSnapshot | null>(`/media/latest?vehicle_id=${vehicleId}`)

// === Vehicle Config ===
export interface VehicleConfigSnapshot {
  id: number
  vehicle_id: number
  car_type?: string
  trim?: string
  exterior_color?: string
  roof_color?: string
  wheel_type?: string
  rear_seat_heaters?: string
  sunroof_installed?: string
  efficiency_package?: string
  europe_vehicle?: boolean
  right_hand_drive?: boolean
  remote_start_enabled?: boolean
  charge_port?: string
  offroad_lightbar_present?: boolean
  version?: string
  vehicle_name?: string
  software_update_version?: string
  software_update_download_pct?: number
  software_update_install_pct?: number
  software_update_expected_duration?: number
  created_at: string
}

/** Fetches paginated vehicle config snapshots for a vehicle. */
export const getVehicleConfigData = (vehicleId: number, limit = 100, offset = 0) =>
  request<VehicleConfigSnapshot[]>(`/vehicle-config?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent vehicle config snapshot for a vehicle. */
export const getVehicleConfigLatest = (vehicleId: number) =>
  request<VehicleConfigSnapshot | null>(`/vehicle-config/latest?vehicle_id=${vehicleId}`)

// === Location Snapshots ===
export interface LocationSnapshot {
  id: number
  vehicle_id: number
  destination_name?: string
  destination_lat?: number
  destination_lon?: number
  origin_lat?: number
  origin_lon?: number
  miles_to_arrival?: number
  minutes_to_arrival?: number
  route_line?: string
  route_traffic_delay_min?: number
  located_at_home?: boolean
  located_at_work?: boolean
  located_at_favorite?: boolean
  gps_state?: boolean
  created_at: string
}

/** Fetches paginated location snapshots for a vehicle. */
export const getLocationSnapshots = (vehicleId: number, limit = 100, offset = 0) =>
  request<LocationSnapshot[]>(`/location-snapshots?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent location snapshot for a vehicle. */
export const getLocationSnapshotLatest = (vehicleId: number) =>
  request<LocationSnapshot | null>(`/location-snapshots/latest?vehicle_id=${vehicleId}`)

// === Safety ===
export interface SafetySnapshot {
  id: number
  vehicle_id: number
  automatic_blind_spot_camera?: boolean
  automatic_emergency_braking_off?: boolean
  blind_spot_collision_warning?: boolean
  cruise_follow_distance?: string
  emergency_lane_departure_avoidance?: boolean
  forward_collision_warning?: string
  lane_departure_avoidance?: string
  speed_limit_warning?: string
  pin_to_drive_enabled?: boolean
  miles_since_reset?: number
  self_driving_miles_since_reset?: number
  created_at: string
}

/** Fetches paginated safety snapshots for a vehicle. */
export const getSafetyData = (vehicleId: number, limit = 100, offset = 0) =>
  request<SafetySnapshot[]>(`/safety?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches the most recent safety snapshot for a vehicle. */
export const getSafetyLatest = (vehicleId: number) =>
  request<SafetySnapshot | null>(`/safety/latest?vehicle_id=${vehicleId}`)

// === User Preferences ===
export interface UserPreferenceSnapshot {
  id: number
  vehicle_id: number
  setting_24hr_time?: boolean
  setting_charge_unit?: string
  setting_distance_unit?: string
  setting_temperature_unit?: string
  setting_tire_pressure_unit?: string
  created_at: string
}

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

// === Vampire Drain ===
/** Fetches vampire drain events for a vehicle, optionally filtered by date range. */
export const getVampireDrainEvents = (vehicleId: number, limit = 100, offset = 0, start?: string, end?: string) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), limit: String(limit), offset: String(offset) })
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  return request<VampireDrainEvent[]>(`/vampire-drain?${params}`)
}
/** Fetches aggregate vampire drain statistics (avg/max rate, total range lost). */
export const getVampireDrainStats = (vehicleId: number) =>
  request<VampireDrainStats>(`/vampire-drain/stats?vehicle_id=${vehicleId}`)

// === Visited Locations ===
/** Fetches frequently visited locations, optionally filtered by vehicle. */
export const getVisitedLocations = (vehicleId?: number, limit = 100, offset = 0) =>
  request<VisitedLocation[]>(`/locations?${vehicleId ? `vehicle_id=${vehicleId}&` : ''}limit=${limit}&offset=${offset}`)

// === Mileage ===
/** Fetches daily mileage records for a vehicle (up to 365 days). */
export const getDailyMileage = (vehicleId: number, limit = 365, offset = 0) =>
  request<DailyMileage[]>(`/mileage/daily?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches monthly mileage aggregates for a vehicle. */
export const getMonthlyMileage = (vehicleId: number) =>
  request<MonthlyMileage[]>(`/mileage/monthly?vehicle_id=${vehicleId}`)
/** Fetches lifetime mileage statistics for a vehicle. */
export const getMileageStats = (vehicleId: number) =>
  request<MileageStats>(`/mileage/stats?vehicle_id=${vehicleId}`)

// === Trips ===
/** Fetches multi-drive trips, optionally filtered by vehicle and date range. */
export const getTrips = (vehicleId?: number, limit = 50, offset = 0, start?: string, end?: string) => {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (vehicleId) params.set('vehicle_id', String(vehicleId))
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  return request<Trip[]>(`/trips?${params}`)
}

// === Vehicle States / Timeline ===
/** Fetches the vehicle state timeline (asleep, online, driving, charging transitions). */
export const getVehicleTimeline = (vehicleId: number, limit = 200, offset = 0) =>
  request<VehicleStateRecord[]>(`/states/timeline?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches a summary of time spent in each state over a period. */
export const getStateSummary = (vehicleId: number, days = 30, start?: string) =>
  request<StateSummary[]>(`/states/summary?vehicle_id=${vehicleId}&${start ? `start=${start}` : `days=${days}`}`)
/** Fetches daily state breakdown showing minutes in each state per day. */
export const getDailyStateBreakdown = (vehicleId: number, days = 30, start?: string) =>
  request<DailyStateBreakdown[]>(`/states/daily?vehicle_id=${vehicleId}&${start ? `start=${start}` : `days=${days}`}`)

// --- API Keys ---

export interface APIKey {
  id: number
  name: string
  key_prefix: string
  permissions: string
  last_used_at?: string
  created_at: string
  expires_at?: string
}

export const getAPIKeys = () => request<APIKey[]>('/api-keys')

export const createAPIKey = (data: { name: string; permissions: string }) =>
  request<APIKey & { key: string }>('/api-keys', { method: 'POST', body: JSON.stringify(data) })

export const deleteAPIKey = (id: number) =>
  request<void>(`/api-keys/${id}`, { method: 'DELETE' })

export const revokeAPIKey = (id: number) =>
  request<void>(`/api-keys/${id}/revoke`, { method: 'POST' })

// --- Audit Logs ---

export interface AuditLog {
  id: number
  action: string
  resource: string
  details: string
  ip: string
  created_at: string
}

export const getAuditLogs = (limit = 50) =>
  request<AuditLog[]>(`/system/audit?limit=${limit}`)

// --- System / Admin ---

export interface APIUsage {
  total_requests: number
  skipped_polls: number
  estimated_cost: number
  cost_per_request: number
  monthly_credit: number
  estimated_remaining: number
}

export interface CompressionStats {
  total: number
  compressed: number
  savings_percent: number
  total_positions: number
  compressed_positions: number
  estimated_saved_rows: number
  estimated_saved_bytes: number
}

export interface ExtendedHealthResponse {
  status: string
  components: Record<string, { status: string; latency_ms?: number; last_check?: string; consecutive_failures?: number }>
  database: { status: string; latency_ms: number }
  database_pool: { total_conns: number; idle_conns: number; acquired_conns: number }
  system: { goroutines: number; go_version: string; uptime_seconds: number }
}

export interface BackupStats {
  database_size: string
  table_count: number
  row_counts: Record<string, number>
}

export async function getAPIUsage(): Promise<APIUsage> {
  const res = await fetch(`${getApiBase()}/api/v1/system/api-usage`)
  if (!res.ok) throw new Error('Failed to fetch API usage')
  return res.json()
}

export async function getCompressionStats(): Promise<CompressionStats> {
  const res = await fetch(`${getApiBase()}/api/v1/system/compression-stats`)
  if (!res.ok) throw new Error('Failed to fetch compression stats')
  return res.json()
}

export async function getExtendedHealth(): Promise<ExtendedHealthResponse> {
  const res = await fetch(`${getApiBase()}/api/v1/system/health`)
  if (!res.ok) throw new Error('Failed to fetch health')
  return res.json()
}

export async function getBackupStats(): Promise<BackupStats> {
  const res = await fetch(`${getApiBase()}/api/v1/system/backup/stats`)
  if (!res.ok) throw new Error('Failed to fetch backup stats')
  return res.json()
}

export interface MapConfig {
  provider: 'free' | 'azure' | 'google'
  api_key: string
}

export async function getMapConfig(): Promise<MapConfig> {
  const res = await fetch(`${getApiBase()}/api/v1/system/map-config`)
  if (!res.ok) return { provider: 'free', api_key: '' }
  return res.json()
}

// --- API Call Logs ---
export interface APICallLog {
  id: number
  method: string
  url: string
  status_code: number | null
  request_body: string | null
  response_body: string | null
  duration_ms: number
  error: string | null
  created_at: string
}

export interface APICallLogResponse {
  data: APICallLog[]
  total: number
  limit: number
  offset: number
}

export interface APICallLogStats {
  total_calls: number
  by_method: Record<string, number>
  error_rate: number
  error_count: number
  avg_duration_ms: number
  last_24h: number
}

export const getAPICallLogs = (params: {
  limit?: number
  offset?: number
  method?: string
  status?: string
  endpoint?: string
  start?: string
  end?: string
} = {}) => {
  const query = new URLSearchParams()
  if (params.limit) query.set('limit', String(params.limit))
  if (params.offset) query.set('offset', String(params.offset))
  if (params.method) query.set('method', params.method)
  if (params.status) query.set('status', params.status)
  if (params.endpoint) query.set('endpoint', params.endpoint)
  if (params.start) query.set('start', params.start)
  if (params.end) query.set('end', params.end)
  return request<APICallLogResponse>(`/api-logs?${query.toString()}`)
}

export const getAPICallLogStats = () => request<APICallLogStats>('/api-logs/stats')

// --- Version & Update Check ---
export interface VersionInfo {
  app_version: string
  chart_version: string
  go_version: string
  os: string
  arch: string
  uptime_seconds: number
  goroutines: number
  endpoints?: {
    api?: string
    web?: string
    oauth_callback?: string
    tesla_api?: string
  }
}

export interface UpdateCheckResult {
  current: string
  latest: string
  update_available: boolean
  checked_at?: string
  message?: string
}

export const getVersionInfo = () => request<VersionInfo>('/system/version')
export const checkForUpdates = () => request<UpdateCheckResult>('/system/update-check')

// --- Notification Scheduling ---
export interface NotificationSchedule {
  id: number
  channel_id: number
  title: string
  message: string
  cron_expr: string | null
  scheduled_at: string | null
  last_run_at: string | null
  next_run_at: string | null
  enabled: boolean
  created_at: string
}

export const getNotificationSchedules = () => request<NotificationSchedule[]>('/notifications/schedules')
export const createNotificationSchedule = (data: Partial<NotificationSchedule>) =>
  request<NotificationSchedule>('/notifications/schedules', { method: 'POST', body: JSON.stringify(data) })
export const deleteNotificationSchedule = (id: number) =>
  request<void>(`/notifications/schedules/${id}`, { method: 'DELETE' })

// --- Notification Preferences ---
export interface NotificationPreference {
  id: number
  channel_id: number
  event_type: string
  enabled: boolean
}

export const getNotificationPreferences = (channelId: number) =>
  request<NotificationPreference[]>(`/notifications/${channelId}/preferences`)
export const updateNotificationPreference = (channelId: number, eventType: string, enabled: boolean) =>
  request<void>(`/notifications/${channelId}/preferences`, {
    method: 'PUT',
    body: JSON.stringify({ event_type: eventType, enabled }),
  })

// --- Notification Analytics ---
export interface NotificationAnalytics {
  total_sent: number
  total_failed: number
  delivery_rate: number
  avg_latency_ms: number
  active_channels: number
  period_days: number
}

export interface NotificationMetric {
  id: number
  channel_id: number
  date: string
  total_sent: number
  total_failed: number
  avg_latency_ms: number
}

export const getNotificationAnalytics = (days?: number) =>
  request<NotificationAnalytics>(`/notifications/analytics${days ? `?days=${days}` : ''}`)
export const getChannelMetrics = (channelId: number, days?: number) =>
  request<NotificationMetric[]>(`/notifications/${channelId}/metrics${days ? `?days=${days}` : ''}`)

// --- Export Jobs (Async) ---
export interface ExportJobSummary {
  id: string
  type: string
  format: string
  status: 'queued' | 'processing' | 'ready' | 'failed'
  file_name: string
  file_size: number
  record_count: number
  error_message: string
  created_at: string
  completed_at: string | null
}

export interface ExportJobSubmitRequest {
  type: 'drives' | 'charging' | 'backup' | 'analytics' | 'import_drives' | 'import_charging'
  format?: 'csv' | 'json'
  vehicle_id?: number
  start?: string
  end?: string
}

export interface ExportJobSubmitResponse {
  id: string
  type: string
  format: string
  status: string
  message: string
}

export const submitExportJob = (data: ExportJobSubmitRequest) =>
  request<ExportJobSubmitResponse>('/export/jobs', { method: 'POST', body: JSON.stringify(data) })
export const getExportJobs = (limit?: number, offset?: number) =>
  request<ExportJobSummary[]>(`/export/jobs?limit=${limit || 50}&offset=${offset || 0}`)
export const getExportJob = (jobId: string) =>
  request<ExportJobSummary>(`/export/jobs/${jobId}`)
export const getExportJobDownloadUrl = (jobId: string) =>
  `${getApiBase()}/export/jobs/${jobId}/download`
export const submitImportJob = (type: 'import_drives' | 'import_charging', file: File) => {
  const formData = new FormData()
  formData.append('type', type)
  formData.append('file', file)
  // Override Content-Type to let browser set multipart/form-data with boundary
  return request<ExportJobSubmitResponse>('/export/jobs/import', {
    method: 'POST',
    body: formData,
    headers: {},
  })
}

// --- Fleet Telemetry ---
export interface TelemetryStatus {
  enabled: boolean
  mode: string
  endpoint: string
  protocol: string
  supported_signals: string[]
  mqtt_publishing: boolean
  speed_comparison?: {
    fleet_telemetry_latency: string
    fleet_api_polling: string
    speedup: string
  }
  aggregate_stats?: {
    streaming_vehicles: number
    total_vehicles_seen: number
    total_signals_received: number
    total_batches_processed: number
    avg_signals_per_second: string
    stale_timeout: string
  }
  streaming_vehicles: Record<string, {
    vin: string
    last_received: string
    first_received: string
    signal_count: number
    batch_count: number
    is_streaming: boolean
    data_source: string
    signals_per_second: number
    latency_ms: number
    uptime_seconds: number
    last_signals?: Record<string, unknown>
  }>
}

export const getTelemetryStatus = () =>
  request<TelemetryStatus>('/telemetry')

// --- Gas Price Auto-Poll ---
export interface GasPriceStatus {
  enabled: boolean
  poll_interval: string
  last_poll_time: string
  current_price: number
}

export interface GasPriceHistory {
  id: number
  price_per_unit: number
  unit: string
  efficiency_mpg: number
  effective_from: string
  effective_to: string | null
  created_at: string
}

/** Fetches current gas price poll status. */
export const getGasPriceStatus = () =>
  request<GasPriceStatus>('/gas-price/status')
/** Triggers an immediate gas price poll from the EIA API. */
export const pollGasPrice = () =>
  request<{ status: string }>('/gas-price/poll', { method: 'POST' })
/** Toggles gas price auto-polling on or off. */
export const toggleGasPrice = (enabled: boolean) =>
  request<{ enabled: boolean }>('/gas-price/toggle', { method: 'POST', body: JSON.stringify({ enabled }) })
/** Updates the gas price poll interval. */
export const updateGasPriceConfig = (pollInterval: string) =>
  request<{ poll_interval: string }>('/gas-price/config', { method: 'PUT', body: JSON.stringify({ poll_interval: pollInterval }) })
/** Fetches gas price history records. */
export const getGasPriceHistory = (limit = 50, offset = 0) =>
  request<GasPriceHistory[]>(`/gas-price/history?limit=${limit}&offset=${offset}`)

// --- Data Repair ---

export interface StaleSessionsResponse {
  stale_charging: ChargingSession[]
  stale_drives: Drive[]
}

export const getStaleSessions = () =>
  request<StaleSessionsResponse>('/data-repair/stale-sessions')
export const updateChargingSession = (id: number, data: Partial<ChargingSession>) =>
  request<ChargingSession>(`/data-repair/charging/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const updateDrive = (id: number, data: Partial<Drive>) =>
  request<Drive>(`/data-repair/drive/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const closeChargingSession = (id: number) =>
  request<void>(`/data-repair/charging/${id}/close`, { method: 'POST' })
export const closeDrive = (id: number) =>
  request<void>(`/data-repair/drive/${id}/close`, { method: 'POST' })
export const deleteChargingSession = (id: number) =>
  request<void>(`/data-repair/charging/${id}`, { method: 'DELETE' })
export const deleteDrive = (id: number) =>
  request<void>(`/data-repair/drive/${id}`, { method: 'DELETE' })

// ── Backup & Restore ────────────────────────────────────

export interface BackupConfig {
  id: number
  name: string
  enabled: boolean
  backup_type: string
  frequency_days: number
  max_retention: number
  provider: string
  provider_config: Record<string, string>
  include_tables: string[] | null
  compress: boolean
  encrypt: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

export interface BackupRun {
  id: number
  config_id: number | null
  run_type: string
  backup_type: string
  status: string
  provider: string
  file_name: string | null
  file_path: string | null
  file_size: number
  record_count: number
  table_count: number
  checksum: string | null
  duration_ms: number
  error_message: string | null
  metadata: Record<string, any>
  started_at: string | null
  completed_at: string | null
  created_at: string
}

// === True Cost of Ownership (TCO) ===
export interface TCOAnalytics {
  vehicle_id: number
  total_charging_cost: number
  total_kwh: number
  total_sessions: number
  total_km: number
  first_date: string
  last_date: string
  months_of_ownership: number
  cost_per_km_ev: number
  cost_per_km_ice: number
  equivalent_gas_cost: number
  total_savings: number
  monthly_savings: number
  maintenance_savings_estimate: number
  gas_price: number
  gas_efficiency_mpg: number
  base_cost_per_kwh: number
  monthly_breakdown: {
    month: string
    ev_cost: number
    equiv_gas_cost: number
    savings: number
    cumulative_savings: number
    energy_kwh: number
  }[]
}

export const getTCOAnalytics = (vehicleId: number) =>
  request<TCOAnalytics>(`/analytics/tco?vehicle_id=${vehicleId}`)

// === Sleep Efficiency ===
export interface SleepAnalytics {
  vehicle_id: number
  period_days: number
  state_distribution: { state: string; count: number; total_minutes: number }[]
  sleep_efficiency_pct: number
  time_to_sleep_avg_min: number
  sentry_comparison: {
    sentry_mode: boolean
    count: number
    avg_drain_rate: number
    avg_duration_hours: number
    avg_battery_lost: number
    avg_temp: number
  }[]
  sentry_on_drain_rate: number
  sentry_off_drain_rate: number
  sentry_monthly_kwh: number
  sentry_monthly_cost: number
  sentry_extra_drain_rate: number
  sentry_extra_monthly_kwh: number
  sentry_extra_monthly_cost: number
  battery_capacity_kwh: number
  base_cost_per_kwh: number
  recent_events: {
    id: number
    start_date: string
    end_date: string
    duration_hours: number
    battery_lost: number
    drain_rate: number
    sentry_mode: boolean
    outside_temp: number | null
    start_battery: number
    end_battery: number
  }[]
  total_events: number
  avg_sentry_duration_hours: number
}

export const getSleepAnalytics = (vehicleId: number, days = 30) =>
  request<SleepAnalytics>(`/analytics/sleep?vehicle_id=${vehicleId}&days=${days}`)

export const getBackupConfigs = () => request<BackupConfig[]>('/backup/configs')
export const getBackupConfig = (id: number) => request<BackupConfig>(`/backup/configs/${id}`)
export const createBackupConfig = (cfg: Partial<BackupConfig>) => request<BackupConfig>('/backup/configs', { method: 'POST', body: JSON.stringify(cfg), headers: { 'Content-Type': 'application/json' } })
export const updateBackupConfig = (id: number, cfg: Partial<BackupConfig>) => request<BackupConfig>(`/backup/configs/${id}`, { method: 'PUT', body: JSON.stringify(cfg), headers: { 'Content-Type': 'application/json' } })
export const deleteBackupConfig = (id: number) => request<void>(`/backup/configs/${id}`, { method: 'DELETE' })
export const triggerBackup = (configId: number) => request<BackupRun>(`/backup/configs/${configId}/trigger`, { method: 'POST' })
export const triggerQuickBackup = () => request<BackupRun>('/backup/quick', { method: 'POST' })
export const getBackupRuns = (limit = 50, offset = 0) => request<BackupRun[]>(`/backup/runs?limit=${limit}&offset=${offset}`)
export const getBackupRun = (id: number) => request<BackupRun>(`/backup/runs/${id}`)
export const downloadBackup = (runId: number) => window.open(`${getApiBase()}/api/v1/backup/runs/${runId}/download`, '_blank')
export const verifyBackup = (runId: number) => request<{ verified: boolean; error?: string; checksum?: string }>(`/backup/runs/${runId}/verify`, { method: 'POST' })
export const previewRestore = (runId: number) => request<{ tables: { name: string; rows: number }[]; metadata: Record<string, unknown>; checksum_verified: boolean }>(`/backup/runs/${runId}/preview`)

// === Regen Braking ===
export interface RegenData {
  vehicle_id: number
  total_regen_kwh: number
  total_drive_kwh: number
  regen_ratio: number
  monthly_avg_regen: number
  free_charges: number
  monthly_summary: {
    month: string
    drive_count: number
    avg_regen_power_kw: number
    avg_speed: number
    avg_efficiency: number
  }[]
  drives: {
    id: number
    start_date: string
    distance: number
    duration_min: number
    speed_avg: number | null
    power_max: number | null
    power_min: number | null
    start_battery_level: number | null
    end_battery_level: number | null
    efficiency: number
    regen_score: number
  }[]
}
export const getRegenStats = (vehicleId: number) =>
  request<RegenData>(`/analytics/regen?vehicle_id=${vehicleId}`)

// === Battery Degradation ===
export interface BatteryDegradationData {
  vehicle_id: number
  current_health: number
  current_capacity: number
  current_degradation: number
  current_range: number
  current_cycles: number
  current_temp: number
  monthly_trend: {
    month: string
    avg_health: number
    avg_capacity: number
    avg_degradation: number
    avg_range: number
    max_cycles: number
    avg_cell_temp: number
  }[]
  snapshots: {
    id: number
    health_score: number
    capacity_kwh: number
    degradation_pct: number
    est_range_km: number
    cycle_count: number
    avg_cell_temp_c: number
    created_at: string
  }[]
  charging_habits: {
    fast_charge_count: number
    slow_charge_count: number
    deep_discharge_count: number
    charge_to_full_count: number
    avg_energy_per_session: number
  }
  prediction: {
    slope_per_year: number
    years_to_80_pct: number
    predicted_date: string
    has_enough_data: boolean
    projection_points: { month: string; health: number }[]
  }
  stress_level: string
  fast_charge_ratio: number
}
export const getBatteryDegradation = (vehicleId: number) =>
  request<BatteryDegradationData>(`/analytics/battery-degradation?vehicle_id=${vehicleId}`)
