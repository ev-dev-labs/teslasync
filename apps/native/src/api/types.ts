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
  kind: NotificationChannelKind;
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
  | {mode: 'open'}
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
  | {mode: 'open'}
  | {mode: 'session'; sessions: ActiveSession[]};

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
