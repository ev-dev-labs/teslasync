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
}

export interface Geofence {
  id: number
  name: string
  latitude: number
  longitude: number
  radius: number
  cost_per_kwh: number | null
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
  read: boolean
  created_at: string
}

export interface AlertRule {
  id: number
  name: string
  type: string
  enabled: boolean
  threshold: number
  vehicle_id: number | null
  notify_push: boolean
  notify_mqtt: boolean
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
    daily_trend: { date: string; drives: number; distance: number }[]
    temp_vs_efficiency: { temp: number; efficiency: number; distance: number }[]
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

// === Notifications ===
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
  endpoint: string
  protocol: string
  supported_signals: string[]
  mqtt_publishing: boolean
  streaming_vehicles: Record<string, {
    vin: string
    last_received: string
    signal_count: number
    is_streaming: boolean
    last_signals?: Record<string, unknown>
  }>
}

export const getTelemetryStatus = () =>
  request<TelemetryStatus>('/telemetry')
