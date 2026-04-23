/**
 * @module api/types
 *
 * Every exported interface and type alias used across the API layer.
 */

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

export interface VehicleLiveState {
  vehicle_id: number
  updated_at: string
  battery_level: number | null
  usable_battery_level: number | null
  charge_state: string | null
  shift_state: string | null
  speed_kph: number | null
  odometer_km: number | null
  inside_temp_c: number | null
  outside_temp_c: number | null
  latitude: number | null
  longitude: number | null
  heading: number | null
  is_locked: boolean | null
  is_user_present: boolean | null
}

// Position mirrors the post-migration `positions` hypertable (Phase 3,
// migration 000142_baseline_typed). High-frequency GPS + motion sample.
// Typed-only — no raw_json / JSONB carve-outs (ADR-001, ADR-005).
// Matches Go model in internal/models/position.go.
export interface Position {
  vehicle_id: number
  ts: string
  latitude: number
  longitude: number
  heading: number | null
  speed_mph: number | null
  elevation_m: number | null
  gps_state: string | null
  source: string
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
  unit_of_pressure: string
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
  decimal_precision: number
  quiet_hours_enabled: boolean
  quiet_hours_start: string
  quiet_hours_end: string
  alert_digest_mode: string
  google_maps_api_key?: string
  polling_config?: PollingConfig
}

/** Per-endpoint toggle config for Tesla Fleet API calls. */
export interface PollingConfig {
  // Polling endpoints (automatic)
  vehicle_discovery: boolean
  charge_state: boolean
  climate_state: boolean
  drive_state: boolean
  location_data: boolean
  vehicle_state: boolean
  vehicle_config: boolean
  // On-demand counterparts for polling endpoints (user-triggered)
  on_demand_vehicle_discovery: boolean
  on_demand_charge_state: boolean
  on_demand_climate_state: boolean
  on_demand_drive_state: boolean
  on_demand_location_data: boolean
  on_demand_vehicle_state: boolean
  on_demand_vehicle_config: boolean
  // On-demand only endpoints
  nearby_charging_sites: boolean
  release_notes: boolean
  recent_alerts: boolean
  service_data: boolean
  // Commands
  wake_up: boolean
  commands: boolean
  // Telemetry capture (raw signal recording to MongoDB)
  telemetry_capture: boolean
  telemetry_capture_retention_days: number
}

export interface VehicleState {
  vehicle_id: number
  state: string
  latitude: number
  longitude: number
  heading?: number | null
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
  // CEP rule engine fields
  conditions?: RuleConditionTree | null
  expression?: string
  cooldown_min?: number
  for_duration_s?: number | null
  severity?: 'info' | 'warning' | 'critical'
  msg_template?: string
  notify_channels?: number[]
  last_fired_at?: string | null
  fire_count?: number
  tags?: string[]
}

/** Condition tree node — matches backend models.RuleCondition. */
export interface RuleConditionTree {
  op?: 'AND' | 'OR' | 'NOT'
  rules?: RuleConditionTree[]
  signal?: string
  compare?: string
  value?: string | number | boolean
  for_seconds?: number
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
  tpms_hard_warnings?: string
  tpms_soft_warnings?: string
  last_seen_time_fl?: string
  last_seen_time_fr?: string
  last_seen_time_rl?: string
  last_seen_time_rr?: string
  created_at: string
}

// MotorSnapshot mirrors the post-migration `motor_snapshots` hypertable
// (Phase 3, migration 000142_baseline_typed). Typed-only — no raw_json /
// JSONB carve-outs (ADR-001, ADR-005). Matches Go model in
// internal/models/motor.go.
export interface MotorSnapshot {
  vehicle_id: number
  ts: string
  power_kw: number | null
  motor_rpm_front: number | null
  motor_rpm_rear: number | null
  torque_nm_front: number | null
  torque_nm_rear: number | null
  motor_temp_c_front: number | null
  motor_temp_c_rear: number | null
  inverter_temp_c: number | null
  battery_temp_c: number | null
  regen_kw: number | null
  shift_state: string | null
  source: string
}

// ClimateSnapshot mirrors the post-migration `climate_snapshots` hypertable
// (Phase 3, migration 000142_baseline_typed). Typed-only — no raw_json /
// JSONB carve-outs (ADR-001, ADR-005). Matches Go model in
// internal/models/climate.go.
export interface ClimateSnapshot {
  vehicle_id: number
  ts: string
  inside_temp_c: number | null
  outside_temp_c: number | null
  driver_setpoint_c: number | null
  passenger_setpoint_c: number | null
  hvac_state: string | null
  defrost_mode: string | null
  is_climate_on: boolean | null
  is_preconditioning: boolean | null
  fan_status: number | null
  seat_heater_left: number | null
  seat_heater_right: number | null
  seat_heater_rear_left: number | null
  seat_heater_rear_right: number | null
  steering_wheel_heater: boolean | null
  cabin_overheat_protection: boolean | null
  source: string
}

// SecurityEvent mirrors the post-migration `security_events` hypertable
// (Phase 3, migration 000142_baseline_typed). Event-driven door/lock/sentry
// history with 5-year audit retention. Typed-only — no raw_json / JSONB
// carve-outs (ADR-001, ADR-005). Matches Go model in
// internal/models/security.go. PK: (vehicle_id, ts, event_type).
export interface SecurityEvent {
  vehicle_id: number
  ts: string
  event_type: string
  doors_open: string | null
  windows_open: string | null
  locked: boolean | null
  sentry_mode: boolean | null
  user_present: boolean | null
  detail: string | null
  source: string
}

// VehicleMetaSnapshot mirrors the post-migration `vehicle_meta_snapshots`
// consolidated hypertable (Phase 3, migration 000142_baseline_typed). The
// `category` discriminator selects which column group is populated; unused
// groups remain null. Typed-only — no raw_json / JSONB carve-outs
// (ADR-001, ADR-005). Matches Go model in internal/models/vehicle_meta.go.
export type VehicleMetaCategory =
  | 'tire'
  | 'media'
  | 'safety'
  | 'config'
  | 'preference'

export interface VehicleMetaSnapshot {
  vehicle_id: number
  ts: string
  category: VehicleMetaCategory

  // Tire (category='tire')
  tire_pressure_fl_psi?: number | null
  tire_pressure_fr_psi?: number | null
  tire_pressure_rl_psi?: number | null
  tire_pressure_rr_psi?: number | null
  tire_temp_fl_c?: number | null
  tire_temp_fr_c?: number | null
  tire_temp_rl_c?: number | null
  tire_temp_rr_c?: number | null

  // Media (category='media')
  media_source?: string | null
  media_track_title?: string | null
  media_track_artist?: string | null
  media_track_album?: string | null
  media_volume?: number | null
  media_is_playing?: boolean | null
  media_track_duration_sec?: number | null

  // Safety (category='safety')
  autopilot_state?: string | null
  fcw_active?: boolean | null
  blind_spot_active?: boolean | null
  emergency_lane_assist?: boolean | null
  abs_active?: boolean | null
  speed_limit_mode?: string | null

  // Config (category='config')
  software_version?: string | null
  car_type?: string | null
  exterior_color?: string | null
  wheel_type?: string | null
  spoiler_type?: string | null
  has_ludicrous_mode?: boolean | null

  // Preference (category='preference')
  drive_mode?: string | null
  regen_level?: string | null
  steering_mode?: string | null
  acceleration_mode?: string | null
  climate_keeper_mode?: string | null
  pet_mode?: boolean | null

  source: string
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

// === API Keys ===

export interface APIKey {
  id: number
  name: string
  key_prefix: string
  permissions: string
  last_used_at?: string
  created_at: string
  expires_at?: string
}

// === Audit Logs ===

export interface AuditLog {
  id: number
  action: string
  resource: string
  details: string
  ip: string
  created_at: string
}

// === System / Admin ===

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

export interface MapConfig {
  provider: 'free' | 'azure' | 'google'
  api_key: string
}

// === API Call Logs ===

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

// === Version & Update Check ===

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

// === Notification Scheduling ===

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

// === Notification Preferences ===

export interface NotificationPreference {
  id: number
  channel_id: number
  event_type: string
  enabled: boolean
}

// === Notification Analytics ===

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

// === Export Jobs (Async) ===

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

// === Fleet Telemetry ===

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

// === Gas Price Auto-Poll ===

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

// === Data Repair ===

export interface StaleSessionsResponse {
  stale_charging: ChargingSession[]
  stale_drives: Drive[]
}

// === Telemetry Capture ===

export interface CaptureStats {
  mongodb_enabled: boolean
  capture_enabled: boolean
  total_documents: number
  distinct_vins: string[]
}

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

// === Charging Telemetry ===

// ChargingTelemetry mirrors `charging_telemetry` hypertable (Phase 3, migration
// 000142_baseline_typed). One row per 1 Hz sample while charging. Typed-only —
// no raw_json / JSONB carve-outs (ADR-001, ADR-005). Matches Go model in
// internal/models/charging_telemetry.go.
export interface ChargingTelemetry {
  vehicle_id: number
  ts: string
  session_id: number | null
  battery_level: number | null
  battery_range_mi: number | null
  charging_state: string | null
  charger_voltage: number | null
  charger_actual_current: number | null
  charger_power_kw: number | null
  charger_phases: number | null
  charge_energy_added_kwh: number | null
  charge_miles_added: number | null
  charge_rate_mph: number | null
  charger_pilot_current: number | null
  scheduled_charging_at: string | null
  source: string
}

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
  audio_volume_increment?: number
  created_at: string
}

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
  software_update_scheduled_start?: string
  created_at: string
}

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
  gps_state?: string
  created_at: string
}

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

// === Backup & Restore ===

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
  metadata: Record<string, unknown>
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

// === Automation Types ===

export interface AutomationConflict {
  automation_id: number
  automation_name: string
  reason: string
  severity: 'warning' | 'info'
}

export interface Automation {
  id: number
  name: string
  description: string
  vehicle_id: number | null
  enabled: boolean
  trigger_type: string
  trigger_config: Record<string, unknown> | null
  conditions: Record<string, unknown>[] | null
  actions: Record<string, unknown>[] | null
  cooldown_minutes: number
  max_executions_hour: number
  stop_on_failure: boolean
  notify_on_run: boolean
  notify_on_failure: boolean
  notify_channels?: number[] | null
  seasonal_start: number | null
  seasonal_end: number | null
  priority: number
  last_triggered_at: string | null
  last_success_at: string | null
  last_failure_at: string | null
  execution_count: number
  failure_count: number
  consecutive_failures: number
  auto_disabled: boolean
  auto_disabled_reason: string | null
  preset_id: string | null
  tags: string[]
  created_at: string
  updated_at: string
  next_fire_time?: string | null
  conflicts?: AutomationConflict[]
}

// === Automation Preset Types ===

export interface AutomationPresetCategory {
  id: string
  name: string
  description: string
  icon: string
}

export interface AutomationPreset {
  id: string
  name: string
  description: string
  category: string
  icon: string
  trigger_type: string
  trigger_config: Record<string, unknown>
  conditions?: Record<string, unknown>[] | null
  actions: Record<string, unknown>[]
  cooldown_minutes: number
  max_executions_hour: number
  stop_on_failure: boolean
  notify_on_run: boolean
  notify_on_failure: boolean
  priority: number
  tags: string[]
}

export interface AutomationPresetsResponse {
  categories: AutomationPresetCategory[]
  presets: AutomationPreset[]
}

export type AutomationHistoryStatus = 'running' | 'success' | 'partial' | 'failed' | 'skipped' | 'cancelled' | 'test' | 'undo'

export interface AutomationHistory {
  id: number
  automation_id: number
  automation_name: string
  vehicle_id: number | null
  triggered_at: string
  completed_at: string | null
  duration_ms: number | null
  trigger_type: string
  trigger_snapshot: Record<string, unknown> | null
  conditions_met: boolean
  conditions_snapshot: Record<string, unknown>[] | null
  actions_executed: Record<string, unknown>[] | null
  actions_total: number
  actions_succeeded: number
  actions_failed: number
  status: AutomationHistoryStatus
  error: string | null
  fsm_state: string | null
  created_at: string
}

export interface AutomationHistoryStats {
  total_executions: number
  succeeded: number
  failed: number
  partial: number
  success_rate: number
  avg_duration_ms: number
}

export interface AutomationHistoryListResponse {
  items: AutomationHistory[]
  total: number
  limit: number
  offset: number
  summary: AutomationHistoryStats
}

// === Automation SSE Events ===

export type AutomationSSEEventType =
  | 'automation.triggered'
  | 'automation.succeeded'
  | 'automation.failed'
  | 'automation.skipped'
  | 'automation.state_changed'

export interface AutomationTriggeredEvent {
  automation_id: number
  name: string
  vehicle: string
  trigger: string
  at: string
  mode: 'live' | 'test'
}

export interface AutomationSucceededEvent {
  automation_id: number
  name: string
  duration_ms: number
  actions: number
  mode: 'live' | 'test'
}

export interface AutomationFailedEvent {
  automation_id: number
  name: string
  error: string
  action_index: number
  mode: 'live' | 'test'
}

export interface AutomationSkippedEvent {
  automation_id: number
  name: string
  reason: string
  mode: 'live' | 'test'
}

export interface AutomationStateChangedEvent {
  automation_id: number
  name: string
  from: string
  to: string
  trigger: string
  at: string
  retry_count: number
  consecutive_failures: number
  mode: 'live' | 'test'
}

export type AutomationSSEEvent =
  | { type: 'automation.triggered'; data: AutomationTriggeredEvent }
  | { type: 'automation.succeeded'; data: AutomationSucceededEvent }
  | { type: 'automation.failed'; data: AutomationFailedEvent }
  | { type: 'automation.skipped'; data: AutomationSkippedEvent }
  | { type: 'automation.state_changed'; data: AutomationStateChangedEvent }

// === Vehicle Access (Drivers & Invitations) ===

export interface VehicleDriver {
  id: number
  vehicle_id: number
  share_user_id: number | null
  driver_email: string | null
  driver_name: string | null
  role: string | null
  fetched_at: string
}

export interface VehicleInvitation {
  id: number
  vehicle_id: number
  invitation_id: string
  invite_url: string | null
  status: string
  expires_at: string | null
  created_by: string | null
  fetched_at: string
  created_at: string
}

// === Year in Review Types ===

export interface YearReviewDriveHighlight {
  drive_id: number
  date: string
  distance_km: number
  duration_min: number
  start_address: string
  end_address: string
  efficiency_wh_km: number
}

export interface YearReviewMonthStat {
  month: number
  drives: number
  distance_km: number
  energy_kwh: number
  cost: number
}

export interface YearReviewComparison {
  label: string
  value: string
  emoji: string
}

export interface YearReview {
  year: number
  vehicle: {
    id: number
    display_name: string
    model: string
  }

  // Headline stats
  total_drives: number
  total_distance_km: number
  total_energy_kwh: number
  total_charge_sessions: number
  total_driving_minutes: number
  total_charging_cost: number
  gas_savings: number
  co2_offset_kg: number

  // Extremes
  longest_drive: YearReviewDriveHighlight | null
  shortest_drive: YearReviewDriveHighlight | null
  most_efficient_drive: YearReviewDriveHighlight | null
  least_efficient_drive: YearReviewDriveHighlight | null
  fastest_speed_kmh: number
  coldest_drive_temp_c: number
  hottest_drive_temp_c: number

  // Monthly breakdown
  monthly_stats: YearReviewMonthStat[]

  // Patterns
  most_active_day_of_week: string
  most_active_hour: number
  avg_drives_per_week: number
  avg_distance_per_drive_km: number
  avg_efficiency_wh_km: number

  // Charging habits
  supercharger_pct: number
  dc_fast_pct: number
  ac_other_pct: number
  avg_charge_start_soc: number

  // Fun comparisons
  comparisons: YearReviewComparison[]
}

export type {
  SignalObservation,
  SignalSource,
  SignalCatalogEntry,
  SignalValueType,
} from '@/types/signals';
