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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
