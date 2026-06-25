import { request as apiRequest } from './client';
import type {
  Alert,
  AlertRule,
  AlertRuleOp,
  AlertRuleSeverity,
  AppSettings,
  Geofence,
  NotificationChannel,
  NotificationLog,
  NotificationStats,
  SoftwareUpdate,
  Vehicle,
  VehicleState,
} from '../../api/types';

export { ApiError, getApiBase, request } from './client';

export type {
  Alert,
  AlertRule,
  AlertRuleOp,
  AlertRuleSeverity,
  AppSettings,
  AuthStatus,
  ChargeTelemetryReading,
  ChargingSession,
  Drive,
  DriveTelemetryReading,
  Geofence,
  NotificationChannel,
  NotificationLog,
  NotificationStats,
  SoftwareUpdate,
  Vehicle,
  VehicleState,
} from '../../api/types';

export type {
  BatteryDegradationData,
  BatteryReport,
  ChargingHeatmapCell,
  ChargingHeatmapData,
  ChargingHeatmapSummary,
  ChargingLocationBreakdown,
  DailyMileage,
  EfficiencyCategory,
  EfficiencyPoint,
  EnergyStats,
  FleetAnalytics,
  MileageStats,
  MonthlyMileage,
  MonthlyTempTrend,
  RegenData,
  RouteDetailData,
  RouteDriveDetail,
  RouteEfficiencyData,
  RouteSummary,
  SleepAnalytics,
  SpeedBucket,
  SpeedProfileData,
  StatsSummary,
  TCOAnalytics,
  TempEfficiencyBucket,
  TemperatureImpactData,
  Trip,
  VampireDrainBucket,
  VampireDrainEvent,
  VampireDrainStats,
  VisitedLocation,
} from './analytics';

export type {
  APICallLog,
  APICallLogResponse,
  APICallLogStats,
  APIKey,
  APIUsage,
  AuditLog,
  BackupConfig,
  BackupRun,
  BackupStats,
  CaptureStats,
  ChatMessage,
  ChatResponse,
  ChatSessionInfo,
  CompressionStats,
  ExportJobSubmitRequest,
  ExportJobSubmitResponse,
  ExportJobSummary,
  ExtendedHealthResponse,
  StaleSessionsResponse,
  TelemetryStatus,
  UpdateCheckResult,
  VersionInfo,
  WorkerStatus,
  WorkersHealth,
} from './devtools';

type UnknownRecord = Record<string, unknown>;

export interface Position {
  vehicle_id: number;
  ts: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed_mph: number | null;
  elevation_m: number | null;
  gps_state: string | null;
  source: string;
}

export interface PollingConfig {
  vehicle_discovery: boolean;
  charge_state: boolean;
  climate_state: boolean;
  drive_state: boolean;
  location_data: boolean;
  vehicle_state: boolean;
  vehicle_config: boolean;
  on_demand_vehicle_discovery: boolean;
  on_demand_charge_state: boolean;
  on_demand_climate_state: boolean;
  on_demand_drive_state: boolean;
  on_demand_location_data: boolean;
  on_demand_vehicle_state: boolean;
  on_demand_vehicle_config: boolean;
  nearby_charging_sites: boolean;
  release_notes: boolean;
  recent_alerts: boolean;
  service_data: boolean;
  wake_up: boolean;
  commands: boolean;
  telemetry_capture: boolean;
  telemetry_capture_retention_days: number;
}

export interface AlertRuleInput {
  name: string;
  description?: string | null;
  enabled?: boolean;
  vehicle_id?: number | null;
  all_vehicles?: boolean;
  vehicle_ids?: number[];
  signal_name?: string;
  op?: AlertRuleOp;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
  value_min?: number | null;
  value_max?: number | null;
  severity?: AlertRuleSeverity;
  cooldown_min?: number;
  trigger_mode?: 'once' | 'repeat';
  snoozed_until?: string | null;
  kind?: 'signal' | 'computed_metric';
  metric_id?: string | null;
  metric_window?: string | null;
  metric_threshold?: number | null;
  metric_op?: string | null;
  max_fires_per_resolution?: number | null;
  escalation_after_min?: number | null;
  escalation_severity?: AlertRuleSeverity | null;
  msg_template?: string | null;
  include_title?: boolean;
}

export type AlertRuleUpdate = Partial<AlertRuleInput>;

export interface AlertTestTarget {
  all_channels?: boolean;
  channel_ids?: number[];
}

export interface AlertTestRequest {
  message?: string;
  target?: AlertTestTarget | null;
  msg_template?: string | null;
  include_title?: boolean;
}

export interface CommandResult {
  success: boolean;
  message: string;
}

export const VEHICLE_STATUSES = [
  'offline',
  'online',
  'asleep',
  'driving',
  'charging',
  'sentry',
  'service',
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

type VehicleStateStatusInput = {
  state?: string | null;
  is_charging?: boolean | null;
  speed?: number | null;
  speed_mps?: number | null;
};

export function deriveVehicleStatus(
  state?: VehicleStateStatusInput | null,
): VehicleStatus {
  if (!state) {
    return 'offline';
  }
  if (state.is_charging) {
    return 'charging';
  }

  const speed = typeof state.speed === 'number' ? state.speed : state.speed_mps;
  if (speed != null && speed > 0) {
    return 'driving';
  }

  const normalized = (state.state ?? '').toLowerCase();
  if ((VEHICLE_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as VehicleStatus;
  }

  return 'online';
}

export const getVehicleStatus = deriveVehicleStatus;

export function statusVariant(status: VehicleStatus | string): string {
  switch (status) {
    case 'online':
      return 'success';
    case 'driving':
    case 'charging':
      return 'info';
    case 'asleep':
      return 'warning';
    case 'sentry':
    case 'service':
      return 'secondary';
    case 'offline':
    default:
      return 'danger';
  }
}

export function statusDotColor(status: VehicleStatus | string): string {
  switch (status) {
    case 'online':
      return 'bg-emerald-400';
    case 'driving':
      return 'bg-cyan-400';
    case 'charging':
      return 'bg-amber-400';
    case 'asleep':
      return 'bg-indigo-400';
    case 'sentry':
    case 'service':
      return 'bg-purple-400';
    case 'offline':
    default:
      return 'bg-gray-400';
  }
}

export interface TirePressureSnapshot {
  id?: number;
  vehicle_id?: number;
  front_left: number | null;
  front_right: number | null;
  rear_left: number | null;
  rear_right: number | null;
  tpms_hard_warnings?: string;
  tpms_soft_warnings?: string;
  last_seen_time_fl?: string;
  last_seen_time_fr?: string;
  last_seen_time_rl?: string;
  last_seen_time_rr?: string;
  created_at?: string;
}

export interface MotorSnapshot {
  id?: number;
  ts: string;
  created_at: string;
  vehicle_id?: number;
  torque_nm_front: number | null;
  torque_nm_rear: number | null;
  di_torque: number | null;
  motor_rpm_front: number | null;
  motor_rpm_rear: number | null;
  motor_temp_c_front: number | null;
  motor_temp_c_rear: number | null;
  inverter_temp_c: number | null;
  inverter_temp_rear: number | null;
  heatsink_temp_front: number | null;
  heatsink_temp_rear: number | null;
  motor_current_front: number | null;
  motor_current_rear: number | null;
  state_front: string | null;
  state_rear: string | null;
  shift_state: string | null;
  vbat_front: number | null;
  vbat_rear: number | null;
  power_kw?: number | null;
  regen_kw?: number | null;
  battery_temp_c?: number | null;
  source?: string | null;
  di_stator_temp?: number | null;
  gear?: string | null;
}

export interface ClimateSnapshot {
  vehicle_id: number;
  ts: string;
  inside_temp_c: number | null;
  outside_temp_c: number | null;
  driver_setpoint_c: number | null;
  passenger_setpoint_c: number | null;
  hvac_state: string | null;
  defrost_mode: string | null;
  is_climate_on: boolean | null;
  is_preconditioning: boolean | null;
  fan_status: number | null;
  seat_heater_left: number | null;
  seat_heater_right: number | null;
  seat_heater_rear_left: number | null;
  seat_heater_rear_right: number | null;
  steering_wheel_heater: boolean | null;
  cabin_overheat_protection: boolean | null;
  source: string;
  inside_temp?: number | null;
  outside_temp?: number | null;
  driver_temp_setting?: number | null;
  passenger_temp_setting?: number | null;
  hvac_power?: number | null;
  is_ac_on?: boolean | null;
  hvac_ac_enabled?: boolean | null;
  hvac_fan_status?: number | null;
  hvac_fan_speed?: number | null;
  hvac_steering_wheel_heat_level?: number | null;
  battery_heater?: boolean | null;
  battery_heater_on?: boolean | null;
  seat_heater_rear_center?: number | null;
}

export interface SecurityEvent {
  vehicle_id: number;
  ts: string;
  event_type: string;
  doors_open: string | null;
  windows_open: string | null;
  locked: boolean | null;
  sentry_mode: boolean | null;
  user_present: boolean | null;
  detail: string | null;
  source: string;
  id?: number;
  created_at: string;
  door_state?: string | boolean | null;
  fd_window?: string | boolean | null;
  fp_window?: string | boolean | null;
  rd_window?: string | boolean | null;
  rp_window?: string | boolean | null;
  driver_seat_belt?: boolean | null;
  passenger_seat_belt?: boolean | null;
  driver_seat_occupied?: boolean | null;
  lights_high_beams?: boolean | null;
  lights_hazards_active?: boolean | null;
  lights_turn_signal?: string | null;
}

export interface VehicleStateRecord {
  id: number;
  vehicle_id: number;
  state: string;
  start_date: string;
  end_date: string | null;
  duration_min: number;
  created_at: string;
}

export interface StateSummary {
  state: string;
  count: number;
  total_min: number;
}

export interface DailyStateBreakdown {
  day: string;
  state: string;
  total_min: number;
}

export interface NotificationSchedule {
  id: number;
  channel_id: number;
  title: string;
  message: string;
  cron_expr: string | null;
  scheduled_at: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  enabled: boolean;
  created_at: string;
}

export interface NotificationPreference {
  id: number;
  channel_id: number;
  event_type: string;
  enabled: boolean;
}

export interface NotificationAnalytics {
  total_sent: number;
  total_failed: number;
  delivery_rate: number;
  avg_latency_ms: number;
  active_channels: number;
  period_days: number;
}

export interface NotificationMetric {
  id: number;
  channel_id: number;
  date: string;
  total_sent: number;
  total_failed: number;
  avg_latency_ms: number;
}

export interface GasPriceStatus {
  enabled: boolean;
  poll_interval: string;
  last_poll_time: string;
  current_price: number;
  current_price_kwh_eq: number;
}

export interface GasPriceHistory {
  id: number;
  price_per_unit: number;
  unit: string;
  efficiency_mpg: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

export interface MapConfig {
  provider: 'free' | 'azure' | 'google';
  api_key: string;
}

export interface ChargingTelemetry {
  vehicle_id: number;
  ts: string;
  session_id: number | null;
  battery_level: number | null;
  battery_range_mi: number | null;
  charging_state: string | null;
  charger_voltage: number | null;
  charger_actual_current: number | null;
  charger_power_w: number | null;
  charger_phases: number | null;
  charge_energy_added_wh: number | null;
  range_added_meters: number | null;
  range_added_meters_per_hour: number | null;
  charger_pilot_current: number | null;
  scheduled_charging_at: string | null;
  source: string;
  bms_fullcharge_complete?: boolean | null;
  module_temp_max?: number | null;
  module_temp_min?: number | null;
  num_module_temp_max?: number | null;
  num_module_temp_min?: number | null;
  battery_heater_on?: boolean | null;
  lifetime_energy_used?: number | null;
  expected_energy_pct_at_arrival?: number | null;
  not_enough_power_to_heat?: boolean | null;
  charge_port_door_open?: boolean | null;
}

export interface MediaSnapshot {
  id: number;
  vehicle_id: number;
  now_playing_title?: string;
  now_playing_artist?: string;
  now_playing_album?: string;
  now_playing_station?: string;
  now_playing_duration?: number;
  now_playing_elapsed?: number;
  playback_status?: string;
  playback_source?: string;
  audio_volume?: number;
  audio_volume_max?: number;
  audio_volume_increment?: number;
  created_at: string;
}

export interface VehicleConfigSnapshot {
  id: number;
  vehicle_id: number;
  car_type?: string;
  trim?: string;
  exterior_color?: string;
  roof_color?: string;
  wheel_type?: string;
  rear_seat_heaters?: string;
  sunroof_installed?: string;
  efficiency_package?: string;
  europe_vehicle?: boolean;
  right_hand_drive?: boolean;
  remote_start_enabled?: boolean;
  charge_port?: string;
  offroad_lightbar_present?: boolean;
  version?: string;
  vehicle_name?: string;
  software_update_version?: string;
  software_update_download_pct?: number;
  software_update_install_pct?: number;
  software_update_expected_duration?: number;
  software_update_scheduled_start?: string;
  created_at: string;
}

export interface LocationSnapshot {
  id: number;
  vehicle_id?: number;
  latitude?: number;
  longitude?: number;
  heading?: number;
  gps_state?: string;
  elevation_m?: number;
  speed_mph?: number;
  destination_name?: string;
  miles_to_arrival?: number;
  minutes_to_arrival?: number;
  route_traffic_delay_s?: number;
  route_last_updated?: string;
  destination_lat?: number;
  destination_lon?: number;
  origin_lat?: number;
  origin_lon?: number;
  located_at_home?: boolean;
  located_at_work?: boolean;
  located_at_favorite?: boolean;
  homelink_nearby?: boolean;
  created_at: string;
}

export interface SafetySnapshot {
  id: number;
  vehicle_id: number;
  automatic_blind_spot_camera?: boolean;
  automatic_emergency_braking_off?: boolean;
  blind_spot_collision_warning?: boolean;
  cruise_follow_distance?: string;
  emergency_lane_departure_avoidance?: boolean;
  forward_collision_warning?: string;
  lane_departure_avoidance?: string;
  speed_limit_warning?: string;
  pin_to_drive_enabled?: boolean;
  miles_since_reset?: number;
  self_driving_miles_since_reset?: number;
  created_at: string;
}

export interface UserPreferenceSnapshot {
  id: number;
  vehicle_id: number;
  setting_24hr_time?: boolean;
  setting_charge_unit?: string;
  setting_distance_unit?: string;
  setting_temperature_unit?: string;
  setting_tire_pressure_unit?: string;
  created_at: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function optionalRecord(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null;
}

function isVehicleState(value: unknown): value is VehicleState {
  const record = optionalRecord(value);
  return (
    record !== null &&
    typeof record.vehicle_id === 'number' &&
    typeof record.state === 'string'
  );
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function buildVehicleQuery(
  vehicleId: number,
  limit = 100,
  offset = 0,
): URLSearchParams {
  return new URLSearchParams({
    vehicle_id: String(vehicleId),
    limit: String(limit),
    offset: String(offset),
  });
}

// === Vehicles ===
export const getVehicles = () => apiRequest<Vehicle[]>('/vehicles');

export const getVehicle = (id: number) => apiRequest<Vehicle>(`/vehicles/${id}`);

export const syncVehicles = () =>
  apiRequest<{ synced: number; vehicles: Vehicle[] }>('/vehicles/sync', {
    method: 'POST',
  });

type VehicleStateCompat = VehicleState & {
  speed?: number;
  power?: number;
  rated_range?: number;
  ideal_range?: number;
  odometer?: number;
  inside_temp?: number;
  outside_temp?: number;
  is_climate_on?: boolean;
  charger_power?: number;
  charge_rate?: number;
  time_to_full_charge?: number;
  sentry_mode?: boolean;
};

export const getVehicleState = async (
  id: number,
): Promise<{ state?: VehicleState; live: boolean }> => {
  const res = await apiRequest<UnknownRecord>(`/vehicles/${id}/state`);
  const rawState = res.state;
  if (isVehicleState(rawState)) {
    return {
      state: rawState,
      live: asBoolean(res.live),
    };
  }

  const vehicle = optionalRecord(res.vehicle);
  const position = optionalRecord(res.position);
  if (!vehicle && !position) {
    return {
      state: isVehicleState(rawState) ? rawState : undefined,
      live: asBoolean(res.live),
    };
  }

  const state: VehicleStateCompat = {
    vehicle_id: asNumber(vehicle?.id, id),
    state: asString(vehicle?.state, 'offline'),
    latitude: asNumber(position?.latitude),
    longitude: asNumber(position?.longitude),
    speed_mps: asNumber(position?.speed_mps ?? position?.speed),
    power_w: asNumber(position?.power_w ?? position?.power),
    battery_level: asNumber(position?.battery_level),
    is_charging: asBoolean(res.is_charging),
    is_locked: asBoolean(res.is_locked ?? vehicle?.is_locked, true),
    software_version: asString(res.software_version ?? vehicle?.software_version),
    speed: asNumber(position?.speed),
    power: asNumber(position?.power),
    rated_range: asNumber(position?.rated_range),
    ideal_range: asNumber(position?.ideal_range),
    odometer: asNumber(position?.odometer),
    inside_temp: asNumber(position?.inside_temp),
    outside_temp: asNumber(position?.outside_temp),
    is_climate_on: asBoolean(position?.is_climate_on),
    charger_power: asNumber(res.charger_power),
    charge_rate: asNumber(res.charge_rate),
    time_to_full_charge: asNumber(res.time_to_full_charge),
    sentry_mode: asBoolean(res.sentry_mode),
  };

  return { state, live: asBoolean(res.live) };
};

export const getVehiclePositions = (id: number, limit = 100) =>
  apiRequest<Position[]>(`/vehicles/${id}/positions?limit=${limit}`);

export const wakeVehicle = (id: number) =>
  apiRequest<{ status: string }>(`/vehicles/${id}/wake`, { method: 'POST' });

export const deleteVehicle = (id: number) =>
  apiRequest<void>(`/vehicles/${id}`, { method: 'DELETE' });

export const sendCommand = (
  vehicleId: number,
  command: string,
  params?: Record<string, unknown>,
) =>
  apiRequest<CommandResult>(`/vehicles/${vehicleId}/command`, {
    method: 'POST',
    body: JSON.stringify({ command, ...params }),
  });

export const getTirePressure = (vehicleId: number, limit = 100, offset = 0) =>
  apiRequest<TirePressureSnapshot[]>(
    `/tire-pressure?${buildVehicleQuery(vehicleId, limit, offset)}`,
  );

export const getLatestTirePressure = (vehicleId: number) =>
  apiRequest<TirePressureSnapshot | null>(
    `/tire-pressure/latest?vehicle_id=${vehicleId}`,
  );

export const getMotorData = (vehicleId: number, limit = 100, offset = 0) =>
  apiRequest<MotorSnapshot[]>(`/motor?${buildVehicleQuery(vehicleId, limit, offset)}`);

export const getMotorLatest = (vehicleId: number) =>
  apiRequest<MotorSnapshot | null>(`/motor/latest?vehicle_id=${vehicleId}`);

export const getClimateData = (vehicleId: number, limit = 100, offset = 0) =>
  apiRequest<ClimateSnapshot[]>(
    `/climate?${buildVehicleQuery(vehicleId, limit, offset)}`,
  );

export const getClimateLatest = (vehicleId: number) =>
  apiRequest<ClimateSnapshot | null>(`/climate/latest?vehicle_id=${vehicleId}`);

export const getSecurityEvents = (vehicleId: number, limit = 100, offset = 0) =>
  apiRequest<SecurityEvent[]>(
    `/security?${buildVehicleQuery(vehicleId, limit, offset)}`,
  );

export const getSecurityLatest = (vehicleId: number) =>
  apiRequest<SecurityEvent | null>(`/security/latest?vehicle_id=${vehicleId}`);

export const getChargingTelemetry = (
  vehicleId: number,
  limit = 100,
  offset = 0,
) =>
  apiRequest<ChargingTelemetry[]>(
    `/charging-telemetry?${buildVehicleQuery(vehicleId, limit, offset)}`,
  );

export const getChargingTelemetryLatest = (vehicleId: number) =>
  apiRequest<ChargingTelemetry | null>(
    `/charging-telemetry/latest?vehicle_id=${vehicleId}`,
  );

export const getMediaData = (vehicleId: number, limit = 100, offset = 0) =>
  apiRequest<MediaSnapshot[]>(`/media?${buildVehicleQuery(vehicleId, limit, offset)}`);

export const getMediaLatest = (vehicleId: number) =>
  apiRequest<MediaSnapshot | null>(`/media/latest?vehicle_id=${vehicleId}`);

export const getVehicleConfigData = (
  vehicleId: number,
  limit = 100,
  offset = 0,
) =>
  apiRequest<VehicleConfigSnapshot[]>(
    `/vehicle-config?${buildVehicleQuery(vehicleId, limit, offset)}`,
  );

export const getVehicleConfigLatest = (vehicleId: number) =>
  apiRequest<VehicleConfigSnapshot | null>(
    `/vehicle-config/latest?vehicle_id=${vehicleId}`,
  );

export const getLocationSnapshots = (
  vehicleId: number,
  limit = 100,
  offset = 0,
) =>
  apiRequest<LocationSnapshot[]>(
    `/location-snapshots?${buildVehicleQuery(vehicleId, limit, offset)}`,
  );

export const getLocationSnapshotLatest = (vehicleId: number) =>
  apiRequest<LocationSnapshot | null>(
    `/location-snapshots/latest?vehicle_id=${vehicleId}`,
  );

export const getSafetyData = (vehicleId: number, limit = 100, offset = 0) =>
  apiRequest<SafetySnapshot[]>(
    `/safety?${buildVehicleQuery(vehicleId, limit, offset)}`,
  );

export const getSafetyLatest = (vehicleId: number) =>
  apiRequest<SafetySnapshot | null>(`/safety/latest?vehicle_id=${vehicleId}`);

export const getUserPreferences = (vehicleId: number, limit = 100, offset = 0) =>
  apiRequest<UserPreferenceSnapshot[]>(
    `/user-preferences?${buildVehicleQuery(vehicleId, limit, offset)}`,
  );

export const getUserPreferenceLatest = (vehicleId: number) =>
  apiRequest<UserPreferenceSnapshot | null>(
    `/user-preferences/latest?vehicle_id=${vehicleId}`,
  );

export const getSoftwareUpdates = (vehicleId?: number, limit = 100, offset = 0) =>
  apiRequest<SoftwareUpdate[]>(
    `/software-updates?${vehicleId ? `vehicle_id=${vehicleId}&` : ''}limit=${limit}&offset=${offset}`,
  );

export const getVehicleTimeline = (vehicleId: number, limit = 200, offset = 0) =>
  apiRequest<VehicleStateRecord[]>(
    `/vehicle-states/timeline?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`,
  );

export const getStateSummary = (vehicleId: number, days = 30, start?: string) =>
  apiRequest<StateSummary[]>(
    `/vehicle-states/summary?vehicle_id=${vehicleId}&${
      start ? `start=${start}` : `days=${days}`
    }`,
  );

export const getDailyStateBreakdown = (
  vehicleId: number,
  days = 30,
  start?: string,
) =>
  apiRequest<DailyStateBreakdown[]>(
    `/vehicle-states/daily?vehicle_id=${vehicleId}&${
      start ? `start=${start}` : `days=${days}`
    }`,
  );

export { getAuthStatus, getAuthURL, disconnectAuth } from './auth';
export { getDrives, getDrive, getDrivePositions, getDriveTelemetry } from './drives';
export {
  getChargingSessions,
  getChargingSession,
  getChargeTelemetry,
} from './charging';

// === Settings ===
export const getSettings = () => apiRequest<AppSettings>('/settings');

export const updateSettings = (settings: AppSettings) =>
  apiRequest<AppSettings>('/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });

export const toggleAPISuspend = (suspended: boolean) =>
  apiRequest<{ api_suspended: boolean }>('/settings/suspend-api', {
    method: 'POST',
    body: JSON.stringify({ suspended }),
  });

export const getPollingConfig = () =>
  apiRequest<PollingConfig>('/settings/polling-config');

export const updatePollingConfig = (pollingConfig: PollingConfig) =>
  apiRequest<PollingConfig>('/settings/polling-config', {
    method: 'PUT',
    body: JSON.stringify(pollingConfig),
  });

export const getGeofences = () => apiRequest<Geofence[]>('/geofences');

export const createGeofence = (geofence: Omit<Geofence, 'id'>) =>
  apiRequest<Geofence>('/geofences', {
    method: 'POST',
    body: JSON.stringify(geofence),
  });

export const updateGeofence = (id: number, geofence: Omit<Geofence, 'id'>) =>
  apiRequest<Geofence>(`/geofences/${id}`, {
    method: 'PUT',
    body: JSON.stringify(geofence),
  });

export const deleteGeofence = (id: number) =>
  apiRequest<void>(`/geofences/${id}`, { method: 'DELETE' });

export const getAlerts = (limit = 50, offset = 0) =>
  apiRequest<Alert[]>(`/alerts?limit=${limit}&offset=${offset}`);

export const markAlertRead = (id: number) =>
  apiRequest<void>(`/alerts/${id}/read`, { method: 'POST' });

export const getAlertRules = () => apiRequest<AlertRule[]>('/alerts/rules');

export const updateAlertRule = (id: number, rule: AlertRuleUpdate) =>
  apiRequest<AlertRule>(`/alerts/rules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(rule),
  });

export const createAlertRule = (rule: AlertRuleInput) =>
  apiRequest<AlertRule>('/alerts/rules', {
    method: 'POST',
    body: JSON.stringify(rule),
  });

export const deleteAlertRule = (id: number) =>
  apiRequest<void>(`/alerts/rules/${id}`, { method: 'DELETE' });

export const getNotificationChannels = () =>
  apiRequest<NotificationChannel[]>('/notifications');

export const getNotificationChannel = (id: number) =>
  apiRequest<NotificationChannel>(`/notifications/${id}`);

type NotificationChannelInput = Omit<
  NotificationChannel,
  'id' | 'created_at' | 'updated_at'
>;

export const createNotificationChannel = (channel: NotificationChannelInput) =>
  apiRequest<NotificationChannel>('/notifications', {
    method: 'POST',
    body: JSON.stringify(channel),
  });

export const updateNotificationChannel = (
  id: number,
  channel: NotificationChannelInput,
) =>
  apiRequest<NotificationChannel>(`/notifications/${id}`, {
    method: 'PUT',
    body: JSON.stringify(channel),
  });

export const deleteNotificationChannel = (id: number) =>
  apiRequest<void>(`/notifications/${id}`, { method: 'DELETE' });

export const toggleNotificationChannel = (id: number, enabled: boolean) =>
  apiRequest<void>(`/notifications/${id}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });

export const testNotificationChannel = (id: number) =>
  apiRequest<{ success: boolean; error?: string; message?: string }>(
    `/notifications/${id}/test`,
    { method: 'POST' },
  );

export const getNotificationLogs = (limit = 50, offset = 0) =>
  apiRequest<NotificationLog[]>(`/notifications/logs?limit=${limit}&offset=${offset}`);

export const getNotificationStats = () =>
  apiRequest<NotificationStats>('/notifications/stats');

export const getNotificationSchedules = () =>
  apiRequest<NotificationSchedule[]>('/notifications/schedules');

export const createNotificationSchedule = (
  data: Partial<NotificationSchedule>,
) =>
  apiRequest<NotificationSchedule>('/notifications/schedules', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const deleteNotificationSchedule = (id: number) =>
  apiRequest<void>(`/notifications/schedules/${id}`, { method: 'DELETE' });

export const getNotificationPreferences = (channelId: number) =>
  apiRequest<NotificationPreference[]>(
    `/notifications/${channelId}/preferences`,
  );

export const updateNotificationPreference = (
  channelId: number,
  eventType: string,
  enabled: boolean,
) =>
  apiRequest<void>(`/notifications/${channelId}/preferences`, {
    method: 'PUT',
    body: JSON.stringify({ event_type: eventType, enabled }),
  });

export const getNotificationAnalytics = (days?: number) =>
  apiRequest<NotificationAnalytics>(
    `/notifications/analytics${days ? `?days=${days}` : ''}`,
  );

export const getChannelMetrics = (channelId: number, days?: number) =>
  apiRequest<NotificationMetric[]>(
    `/notifications/${channelId}/metrics${days ? `?days=${days}` : ''}`,
  );

export const getGasPriceStatus = () =>
  apiRequest<GasPriceStatus>('/gas-price/status');

export const pollGasPrice = () =>
  apiRequest<{ status: string }>('/gas-price/poll', { method: 'POST' });

export const toggleGasPrice = (enabled: boolean) =>
  apiRequest<{ enabled: boolean }>('/gas-price/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });

export const updateGasPriceConfig = (pollInterval: string) =>
  apiRequest<{ poll_interval: string }>('/gas-price/config', {
    method: 'PUT',
    body: JSON.stringify({ poll_interval: pollInterval }),
  });

export const getGasPriceHistory = (limit = 50, offset = 0) =>
  apiRequest<GasPriceHistory[]>(`/gas-price/history?limit=${limit}&offset=${offset}`);

export const getMapConfig = () => apiRequest<MapConfig>('/system/map-config');

export {
  getBatteryDegradation,
  getBatteryReport,
  getChargingHeatmap,
  getDailyMileage,
  getEnergyStats,
  getFleetAnalytics,
  getMileageStats,
  getMonthlyMileage,
  getRegenStats,
  getRouteEfficiency,
  getRouteEfficiencyDetail,
  getSleepAnalytics,
  getSpeedProfile,
  getTCOAnalytics,
  getTemperatureImpact,
  getTrips,
  getVampireDrainEvents,
  getVampireDrainStats,
  getVisitedLocations,
} from './analytics';

export {
  checkForUpdates,
  closeChargingSession,
  closeDrive,
  createAPIKey,
  createBackupConfig,
  deleteAPIKey,
  deleteBackupConfig,
  deleteChargingSession,
  deleteChatSession,
  deleteDrive,
  downloadBackup,
  getAPICallLogStats,
  getAPICallLogs,
  getAPIKeys,
  getAPIUsage,
  getAuditLogs,
  getBackupConfig,
  getBackupConfigs,
  getBackupRun,
  getBackupRuns,
  getBackupStats,
  getCaptureStats,
  getChatHistory,
  getChatSessions,
  getCompressionStats,
  getExportJob,
  getExportJobDownloadUrl,
  getExportJobs,
  getExtendedHealth,
  getStaleSessions,
  getTelemetryStatus,
  getVersionInfo,
  getWorkersHealth,
  previewRestore,
  renameChatSession,
  revokeAPIKey,
  sendChatMessage,
  submitExportJob,
  submitImportJob,
  triggerBackup,
  triggerQuickBackup,
  updateBackupConfig,
  updateChargingSession,
  updateDrive,
  verifyBackup,
} from './devtools';
