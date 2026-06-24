export interface Vehicle {
  id: number;
  vehicle_id: number;
  vin: string;
  display_name: string;
  model: string;
  trim_badging: string;
  exterior_color: string;
  wheel_type: string;
  state: string;
  healthy: boolean;
  timezone?: string;
  created_at: string;
  updated_at: string;
}

export interface VehicleState {
  vehicle_id: number;
  state: string;
  latitude?: number | null;
  longitude?: number | null;
  speed_mps?: number | null;
  power_w?: number | null;
  battery_level?: number | null;
  is_charging?: boolean | null;
  is_locked?: boolean | null;
  software_version?: string | null;
}

export interface VehicleStateResponse {
  state: VehicleState;
  live?: boolean;
}

export interface TirePressureLatest {
  front_left?: number | null;
  front_right?: number | null;
  rear_left?: number | null;
  rear_right?: number | null;
  last_seen_fl?: string | number | null;
  last_seen_fr?: string | number | null;
  last_seen_rl?: string | number | null;
  last_seen_rr?: string | number | null;
}

export type VehicleSystemValue = string | number | boolean | null;

export interface ClimateLatest {
  inside_temp?: number | null;
  outside_temp?: number | null;
  driver_temp_setting?: number | null;
  passenger_temp_setting?: number | null;
  hvac_power?: VehicleSystemValue;
  is_ac_on?: boolean | null;
  hvac_auto_mode?: VehicleSystemValue;
  fan_speed?: number | null;
  hvac_fan_status?: VehicleSystemValue;
  climate_keeper_mode?: VehicleSystemValue;
  defrost_mode?: VehicleSystemValue;
  defrost_for_preconditioning?: boolean | null;
  rear_defrost_enabled?: boolean | null;
  wiper_heat_enabled?: boolean | null;
  rear_display_hvac_enabled?: boolean | null;
  battery_heater?: boolean | null;
  overheat_protection?: VehicleSystemValue;
  cabin_overheat_protection_temp_limit?: VehicleSystemValue;
  hvac_steering_wheel_heat_auto?: boolean | null;
  hvac_steering_wheel_heat_level?: number | null;
  seat_heater_left?: number | null;
  seat_heater_right?: number | null;
  seat_heater_rear_left?: number | null;
  seat_heater_rear_center?: number | null;
  seat_heater_rear_right?: number | null;
  auto_seat_climate_left?: boolean | null;
  auto_seat_climate_right?: boolean | null;
  climate_seat_cooling_front_left?: number | null;
  climate_seat_cooling_front_right?: number | null;
  seat_vent_enabled?: boolean | null;
}

export interface SecurityLatest {
  locked?: boolean | null;
  sentry_mode?: VehicleSystemValue;
  door_state?: VehicleSystemValue;
  fd_window?: VehicleSystemValue;
  fp_window?: VehicleSystemValue;
  rd_window?: VehicleSystemValue;
  rp_window?: VehicleSystemValue;
  homelink_nearby?: boolean | null;
  guest_mode?: boolean | null;
  homelink_device_count?: number | null;
  guest_mode_mobile_access_state?: VehicleSystemValue;
  driver_seat_occupied?: boolean | null;
  center_display?: VehicleSystemValue;
  speed_limit_mode?: VehicleSystemValue;
  valet_mode_enabled?: boolean | null;
  service_mode?: VehicleSystemValue;
  paired_phone_key_count?: number | null;
  lights_hazards_active?: boolean | null;
  lights_high_beams?: boolean | null;
  lights_turn_signal?: VehicleSystemValue;
  driver_seat_belt?: VehicleSystemValue;
  passenger_seat_belt?: VehicleSystemValue;
}

export interface SafetyLatest {
  automatic_emergency_braking_off?: boolean | null;
  automatic_blind_spot_camera?: boolean | null;
  blind_spot_collision_warning?: VehicleSystemValue;
  cruise_follow_distance?: VehicleSystemValue;
  emergency_lane_departure_avoidance?: boolean | null;
  forward_collision_warning?: VehicleSystemValue;
  lane_departure_avoidance?: VehicleSystemValue;
  speed_limit_warning?: VehicleSystemValue;
  pin_to_drive_enabled?: boolean | null;
  miles_since_reset?: number | null;
  self_driving_miles_since_reset?: number | null;
}

export interface MediaLatest {
  playback_status?: string | null;
  now_playing_title?: string | null;
  now_playing_artist?: string | null;
  now_playing_album?: string | null;
  playback_source?: string | null;
  audio_volume?: number | null;
  audio_volume_max?: number | null;
  audio_volume_increment?: number | null;
  now_playing_station?: string | null;
  now_playing_duration?: number | null;
  now_playing_elapsed?: number | null;
}

export interface VehicleConfigLatest {
  car_type?: string | null;
  trim_badging?: string | null;
  exterior_color?: string | null;
  wheel_type?: string | null;
  software_version?: string | null;
  config?: unknown;
}

export interface SoftwareUpdate {
  id: number;
  vehicle_id: number;
  version: string;
  status: string;
  scheduled_at?: string | null;
  installed_at?: string | null;
  created_at: string;
}

export type MaintenanceStatus = 'good' | 'soon' | 'overdue' | 'completed';

export interface MaintenanceItem {
  id: number;
  vehicle_id: number;
  category: string;
  name: string;
  description: string;
  due_date: string | null;
  due_mileage: number | null;
  current_mileage: number;
  last_service_date: string | null;
  last_service_mileage: number | null;
  interval_months: number | null;
  interval_miles: number | null;
  status: MaintenanceStatus;
  created_at: string;
}

export interface ServiceRecord {
  id: number;
  vehicle_id: number;
  date: string;
  description: string;
  mileage: number;
  cost: number;
  provider: string;
  notes: string;
  created_at: string;
}

export interface Alert {
  id: number;
  vehicle_id?: number | null;
  type?: string | null;
  severity: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export type AlertRuleSeverity = 'info' | 'warn' | 'critical';
export type AlertRuleOp =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'changed'
  | 'between'
  | 'outside';
export type AlertRuleTriggerMode = 'once' | 'repeat';
export type AlertRuleKind = 'signal' | 'computed_metric';
export type ComputedMetricOp =
  | '>'
  | '>='
  | '<'
  | '<='
  | '='
  | '!='
  | '%_change_>'
  | '%_change_<';

export interface AlertRule {
  id: number;
  name: string;
  description?: string | null;
  enabled: boolean;
  vehicle_id?: number | null;
  all_vehicles?: boolean;
  vehicle_ids?: number[];
  signal_name: string;
  op: AlertRuleOp;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
  value_min?: number | null;
  value_max?: number | null;
  severity: AlertRuleSeverity;
  cooldown_min: number;
  trigger_mode: AlertRuleTriggerMode;
  snoozed_until?: string | null;
  kind?: AlertRuleKind;
  metric_id?: string | null;
  metric_window?: string | null;
  metric_threshold?: number | null;
  metric_op?: ComputedMetricOp | null;
  max_fires_per_resolution?: number | null;
  escalation_after_min?: number | null;
  escalation_severity?: AlertRuleSeverity | null;
  msg_template?: string | null;
  include_title?: boolean;
  created_at: string;
  updated_at: string;
}

export type NotificationChannelKind =
  | 'discord'
  | 'slack'
  | 'telegram'
  | 'email'
  | 'webhook'
  | 'ntfy'
  | 'pushover';

export interface NotificationChannel {
  id: number;
  name: string;
  type?: NotificationChannelKind;
  kind?: NotificationChannelKind;
  config?: Record<string, string>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  webhook_url?: string | null;
  url?: string | null;
  channel?: string | null;
  username?: string | null;
  topic?: string | null;
}

export interface NotificationLog {
  id: number;
  channel_id: number;
  alert_id: number | null;
  title: string;
  message: string;
  status: 'pending' | 'sent' | 'failed' | 'deferred_dnd' | string;
  severity?: string | null;
  error?: string | null;
  created_at: string;
  sent_at: string | null;
  scheduled_at?: string | null;
  latency_ms?: number | null;
  read_at?: string | null;
  archived_at?: string | null;
}

export interface NotificationStats {
  total_sent: number;
  sent: number;
  failed: number;
  pending: number;
  total_channels: number;
  enabled_channels: number;
}

export interface QuietHoursWindow {
  id: number;
  user_id: string;
  enabled: boolean;
  start_local: string;
  end_local: string;
  timezone: string;
  weekdays: number;
  bypass_severities: string[];
  created_at: string;
  updated_at: string;
}

export interface SystemStatus {
  overall?: string;
  status?: string;
  healthy?: boolean;
  version?: string;
  uptime?: string;
  database?: SystemComponentStatus;
  mqtt?: SystemComponentStatus;
  tesla_api?: TeslaApiStatus;
  fleet_telemetry?: FleetTelemetryStatus;
  services?: Record<string, string | boolean | number | null>;
}

export interface SystemComponentStatus {
  status: string;
  consecutive_failures?: number;
  last_error?: string;
}

export interface TeslaApiStatus {
  status: string;
  breaker?: string;
  breaker_reset_at?: string;
}

export interface FleetTelemetryStatus {
  status: string;
  details?: Record<string, unknown>;
}

export interface SystemHealth {
  status?: string;
  healthy?: boolean;
  generated_at?: string;
  service_mode?: {
    mode?: string;
    message?: string | null;
    until?: string | null;
  };
  components?: Record<string, SystemComponentStatus>;
}

export interface VersionInfo {
  app_version?: string;
  chart_version: string;
  go_version: string;
  os: string;
  arch: string;
  endpoints: Record<string, string>;
  require_cookie_consent?: boolean;
}

export type RateLimitSeverity = 'ok' | 'warn' | 'critical';

export interface ScopeBudget {
  id: string;
  name: string;
  current: number;
  limit: number;
  window_seconds: number;
  reset_at?: string | null;
  severity: RateLimitSeverity;
  detail?: string;
}

export interface RateLimitStatusResponse {
  generated_at: string;
  scopes: ScopeBudget[];
}

export interface Drive {
  id: number;
  vehicle_id: number;
  start_ts: string;
  end_ts: string | null;
  duration_s: number | null;
  distance_m: number | null;
  energy_used_wh: number | null;
  regen_energy_wh: number | null;
  avg_speed_mps: number | null;
  max_speed_mps: number | null;
  avg_power_w?: number | null;
  start_address?: string | null;
  end_address?: string | null;
  start_soc_pct?: number | null;
  end_soc_pct?: number | null;
  ended_status: string | null;
  score: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface DriveTelemetryReading {
  id: number;
  drive_id: number;
  vehicle_id: number;
  ts?: string;
  latitude: number | null;
  longitude: number | null;
  elevation_m?: number | null;
  heading: number | null;
  speed_mps?: number | null;
  power_w?: number | null;
  battery_level: number | null;
  created_at: string;
}

export interface Trip {
  id: number;
  vehicle_id: number;
  name: string | null;
  start_date: string;
  end_date: string | null;
  started_at: string;
  ended_at: string | null;
  total_distance_m: number;
  total_energy_wh: number;
  total_duration_s: number;
  total_cost: number;
  drive_count: number;
  charge_count: number;
  created_at: string;
  created_by_user?: number | null;
  auto_generated?: boolean;
  notes?: string | null;
}

export interface DailyMileage {
  id: number;
  vehicle_id: number;
  date: string;
  distance_km: number;
  odometer_start: number;
  odometer_end: number;
  drive_count: number;
  energy_used_kwh: number;
}

export interface MonthlyMileage {
  month: string;
  distance: number;
  drives: number;
  energy: number;
  odometer: number;
}

export interface MileageStats {
  total_distance: number;
  avg_daily: number;
  max_daily: number;
  total_energy: number;
  total_drives: number;
  days_tracked: number;
}

export interface VisitedLocation {
  id: number;
  vehicle_id: number;
  address_id?: number | null;
  address_name: string;
  visit_count: number;
  total_duration_s: number;
  last_visited: string | null;
  created_at: string;
}

export interface Geofence {
  id: number;
  name: string;
  polygon_wkt?: string;
  category?: string | null;
  enabled: boolean;
  alert_on_entry: boolean;
  alert_on_exit: boolean;
  latitude: number;
  longitude: number;
  radius: number;
  created_at: string;
  updated_at?: string;
}

export interface ChargingSession {
  id: number;
  vehicle_id: number;
  started_at: string;
  ended_at: string | null;
  start_soc_pct: number | null;
  end_soc_pct: number | null;
  total_energy_added_wh: number | null;
  peak_power_w: number | null;
  avg_power_w: number | null;
  charger_type: string | null;
  cable_type?: string | null;
  cost_decimal?: number | null;
  cost_currency?: string | null;
  live?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ChargeTelemetryReading {
  session_id: number | null;
  vehicle_id: number;
  ts: string;
  ac_charging_power_w: number | null;
  dc_charging_power_w: number | null;
  ac_charging_energy_in_wh: number | null;
  dc_charging_energy_in_wh: number | null;
  charger_voltage_v: number | null;
  charger_actual_current_a: number | null;
  charger_pilot_current_a: number | null;
  battery_heater_on: boolean | null;
  created_at: string;
}

export interface DailyEnergy {
  date: string;
  energy_wh: number;
  cost: number;
  distance_m: number;
  efficiency_wh_per_m: number;
}

export interface EnergyStats {
  vehicle_id: number;
  period_days: number;
  total_energy_used_wh: number;
  total_energy_charged_wh: number;
  total_wh: number;
  total_cost: number;
  total_distance_m: number;
  avg_efficiency_wh_per_m: number;
  co2_saved_kg: number;
  daily_breakdown: DailyEnergy[];
}

export interface MonthlyTrend {
  month: string;
  capacity_pct: number;
  range_km: number;
}

export interface BatteryHealth {
  health_score: number;
  degradation_pct: number;
  current_capacity_pct: number;
  total_cycles: number;
  estimated_range_current_km: number;
  estimated_range_new_km: number;
  monthly_trend: MonthlyTrend[];
}

export interface StatsSummary {
  min?: number | null;
  max?: number | null;
  avg?: number | null;
  median?: number | null;
  p95?: number | null;
  count?: number | null;
}

export interface FleetAnalyticsVehicleComparison {
  id: number;
  name: string;
  distance: number;
  energy: number;
  efficiency: number;
  drives: number;
}

export interface FleetAnalytics {
  period_days?: number;
  total_vehicles?: number;
  total_distance_km?: number;
  total_drives?: number;
  total_charging_sessions?: number;
  total_cost?: number;
  avg_efficiency_wh_km?: number;
  most_efficient_vehicle?: {
    id: number;
    name: string;
    efficiency: number;
  } | null;
  vehicle_comparison?: FleetAnalyticsVehicleComparison[];
  drive_analytics?: {
    hourly_pattern?: { hour: number; drives: number; distance: number }[];
    day_of_week?: {
      day: string;
      drives: number;
      distance: number;
      avg_distance: number;
    }[];
    speed_distribution?: { range: string; count: number }[];
    distance_distribution?: { range: string; count: number }[];
    speed_stats?: StatsSummary;
    power_stats?: StatsSummary;
    regen_stats?: StatsSummary;
    duration_stats?: StatsSummary;
    distance_stats?: StatsSummary;
    efficiency_stats?: StatsSummary;
    daily_trend?: {
      date: string;
      drives: number;
      distance: number;
      efficiency?: number | null;
    }[];
    temp_vs_efficiency?: {
      temp: number;
      efficiency: number;
      distance: number;
    }[];
    duration_distribution?: { range: string; count: number }[];
    temperature?: { inside?: StatsSummary; outside?: StatsSummary };
  };
  charging_analytics?: {
    hourly_pattern?: { hour: number; charges: number; energy: number }[];
    charger_types?: { type: string; count: number }[];
    charger_brands?: { brand: string; count: number }[];
    monthly_trend?: {
      month: string;
      energy: number;
      cost: number;
      sessions: number;
      avg_power: number;
      gas_cost: number;
      savings: number;
    }[];
    power_stats?: StatsSummary;
    duration_stats?: StatsSummary;
    energy_stats?: StatsSummary;
    cost_stats?: StatsSummary;
    start_battery_dist?: { range: string; count: number }[];
    efficiency_stats?: StatsSummary;
  };
  battery_trend?: {
    date: string;
    health_score: number;
    capacity_wh: number;
    degradation_pct: number;
    range_km: number;
    cycle_count: number;
  }[];
}

export interface TCOAnalytics {
  vehicle_id: number;
  total_charging_cost?: number;
  total_wh?: number;
  total_sessions?: number;
  total_km?: number;
  first_date?: string | null;
  last_date?: string | null;
  months_of_ownership?: number;
  cost_per_km_ev?: number;
  cost_per_km_ice?: number;
  equivalent_gas_cost?: number;
  total_savings?: number;
  monthly_savings?: number;
  maintenance_savings_estimate?: number;
  gas_price?: number;
  monthly_breakdown?: {
    month: string;
    ev_cost: number;
    equiv_gas_cost: number;
    savings: number;
    cumulative_savings: number;
    energy_wh: number;
  }[];
}

export interface SleepAnalytics {
  vehicle_id: number;
  period_days?: number;
  state_distribution?: {
    state: string;
    count: number;
    total_minutes: number;
  }[];
  sleep_efficiency_pct?: number;
  sentry_comparison?: {
    sentry_mode: boolean;
    count: number;
    avg_drain_rate: number;
    avg_duration_hours: number;
    avg_battery_lost: number;
    avg_temp: number;
  }[];
  sentry_on_drain_rate?: number;
  sentry_off_drain_rate?: number;
  sentry_monthly_cost?: number;
  sentry_extra_drain_rate?: number;
  sentry_extra_monthly_cost?: number;
  battery_capacity_wh?: number;
  capacity_source?: string;
  recent_events?: {
    id: number;
    start_date: string;
    end_date: string;
    duration_hours: number;
    battery_lost: number;
    drain_rate: number;
    sentry_mode: boolean;
    outside_temp: number | null;
    start_battery: number;
    end_battery: number;
  }[];
  total_events?: number;
  avg_sentry_duration_hours?: number;
}

export interface RegenAnalytics {
  vehicle_id: number;
  total_regen_wh?: number;
  total_drive_wh?: number;
  regen_ratio?: number;
  monthly_avg_regen?: number;
  free_charges?: number;
  battery_capacity_wh?: number;
  capacity_source?: string;
}

export interface BatteryDegradationAnalytics {
  vehicle_id: number;
  current_health?: number;
  current_capacity?: number;
  current_degradation?: number;
  current_range?: number;
  current_cycles?: number;
  current_temp?: number;
  current_health_pct?: number;
  degradation_rate_pct_per_month?: number;
  projected_80pct_date?: string;
  stress_level?: string;
  fast_charge_ratio?: number;
  battery_capacity_wh?: number;
  capacity_source?: string;
  monthly_trend?: {
    month: string;
    avg_health: number;
    avg_capacity: number;
    avg_degradation: number;
    avg_range: number;
    max_cycles: number;
    avg_cell_temp: number;
  }[];
  snapshots?: {
    id: number;
    health_score: number;
    capacity_wh: number;
    degradation_pct: number;
    est_range_km: number;
    cycle_count: number;
    avg_cell_temp_c: number;
    created_at: string;
  }[];
  charging_habits?: {
    fast_charge_count: number;
    slow_charge_count: number;
    deep_discharge_count: number;
    charge_to_full_count: number;
    avg_energy_per_session: number;
  };
  prediction?: {
    slope_per_year: number;
    years_to_80_pct: number;
    predicted_date: string;
    has_enough_data: boolean;
    projection_points: { month: string; health: number }[];
  };
  projections?: { month: string; health: number }[];
  risk_factors?: {
    factor: string;
    severity: string;
    value: number | string;
    threshold?: number | string;
  }[];
  recommendations?: string[];
}

export interface SpeedBucket {
  speed_bucket: string;
  readings: number;
  avg_power_w?: number | null;
}

export interface EfficiencyCategory {
  category: string;
  drive_count: number;
  avg_speed: number;
  battery_pct_per_100km: number;
}

export interface EfficiencyPoint {
  avg_speed_mps: number;
  distance: number;
  efficiency: number;
}

export interface SpeedProfileData {
  distribution?: SpeedBucket[];
  categories?: EfficiencyCategory[];
  points?: EfficiencyPoint[];
  avg_speed_mps?: number;
  peak_speed_mps?: number;
  optimal_speed_mps?: number;
}

export interface TemperatureImpactData {
  efficiency?: {
    temp_bucket: string;
    drive_count: number;
    avg_distance_km: number;
    avg_duration_s: number;
    avg_battery_pct_per_100km: number;
    avg_temp: number;
  }[];
  vampire_drain?: {
    temp_bucket: string;
    avg_drain_rate: number;
    event_count: number;
  }[];
  monthly_trend?: {
    month: string;
    avg_temp: number;
    avg_efficiency: number;
    drive_count: number;
    total_distance: number;
  }[];
}

export interface RouteEfficiencyData {
  routes?: {
    start_location: string;
    end_location: string;
    trip_count: number;
    avg_distance_km: number;
    avg_duration_s: number;
    avg_efficiency: number;
    best_efficiency: number;
    worst_efficiency: number;
    avg_speed: number;
    avg_temp: number;
  }[];
}

export interface FleetTelemetryFieldCoverage {
  field: string;
  destination: string;
  column?: string;
  also_signal_log?: boolean;
  subscribed: boolean;
}

export interface FleetTelemetryCategoryCoverage {
  category: string;
  total_fields: number;
  destinations: Record<string, number>;
  fields: FleetTelemetryFieldCoverage[];
}

export interface FleetTelemetryCoverageResponse {
  categories: FleetTelemetryCategoryCoverage[];
  destination_totals: Record<string, number>;
  orphan_fields?: string[];
}

export interface FleetTelemetryErrorVIN {
  id: number;
  vin: string;
  active: boolean;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export interface FleetTelemetryError {
  id: number;
  vin: string;
  error_code: string | null;
  error_message: string | null;
  reported_at: string | null;
  tesla_updated_at: string | null;
  fetched_at: string;
}

export interface AuditLogEntry {
  id: number;
  ts: string;
  actor?: string;
  action: string;
  entity_type: string;
  entity_id?: number | null;
  detail?: string | null;
}

export interface AvailableSignal {
  name: string;
  category: string;
  value_kind: string;
  unit_kind: string;
  is_compound: boolean;
  is_setting_unit: boolean;
}

export interface AvailableSignalsResponse {
  vehicle_id: number;
  count: number;
  signals: AvailableSignal[];
  source: string;
}

export type LiveSignalValue = string | number | boolean | null;

export interface LiveSignalEntry {
  kind: string;
  value: LiveSignalValue;
  ts?: string;
  timestamp?: string;
  source?: 'l1' | 'l2' | 'stale' | 'unknown' | string;
  age_ms?: number;
}

export interface LiveSignalsResponse {
  vehicle_id: number;
  count: number;
  signals: Record<string, LiveSignalEntry>;
  at: string;
}

export type AuthMode = 'open' | 'forward_auth';

export interface AuthModeCapabilities {
  step_up_reauth: boolean;
  totp_enrollment: boolean;
  session_list: boolean;
  impersonation: boolean;
  rbac: boolean;
}

export interface AuthModeResponse {
  mode: AuthMode;
  subject_header?: string;
  subject?: string | null;
  provider_hint?: string;
  capabilities: AuthModeCapabilities;
}

export interface AuthStatus {
  authenticated: boolean;
  expires_at?: string | null;
}

export interface AuthUrlResponse {
  auth_url: string;
}

export type TOTPStatus =
  | { mode: 'open' }
  | {
      mode: 'session';
      activated: boolean;
      last_used_at?: string | null;
      backup_codes_remaining: number;
    };

export interface TOTPEnrollment {
  secret: string;
  otpauth_uri: string;
  qr_data_uri: string;
  backup_codes: string[];
  expires_at: string;
}

export interface TOTPSudoToken {
  mode: 'session';
  sudo_token: string;
  expires_at: string;
}

export interface TOTPBackupCodesResponse {
  backup_codes: string[];
}

export interface ActiveSession {
  id: string;
  user_agent: string;
  ip: string;
  created_at: string;
  last_seen_at: string;
  revoked_at?: string | null;
  current: boolean;
}

export type ActiveSessionsResponse =
  | { mode: 'open' }
  | { mode: 'session'; sessions: ActiveSession[] };

export interface RevokeAllOthersResponse {
  mode: 'session';
  revoked: number;
}

export interface AppSettings {
  unit_of_length?: string;
  unit_of_temp?: string;
  unit_of_pressure?: string;
  preferred_range?: string;
  language?: string;
  base_cost_per_kwh?: number;
  api_suspended?: boolean;
  decimal_precision?: number;
  theme?: string;
  mode?: string;
  custom_primary?: string;
  custom_accent?: string;
  quiet_hours_enabled?: boolean;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
  alert_digest_mode?: string;
  currency_symbol?: string;
  locale?: string;
  tz_display_default?: 'vehicle' | 'user' | 'utc';
  timezone_user?: string;
  tab_badge_enabled?: boolean;
  critical_flash_enabled?: boolean;
  ui_density?: 'compact' | 'comfortable' | 'spacious';
  time_format_default?: 'relative' | 'absolute';
  chart_palette?: 'cb_safe' | 'neon';
  ai_mode?: 'off' | 'local' | 'cloud';
}

export type UnknownApiObject = Record<string, unknown>;
