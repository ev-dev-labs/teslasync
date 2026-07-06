/**
 * Dashboard feature DTOs — a curated, consumer-facing subset of the canonical
 * `@/api/types` shapes (snake_case, matching the Go `json:"…"` tags). Consumed
 * as props by the dashboard's presentational components (VehicleHero,
 * FleetStatsBar, RecentActivity, LiveTelemetry) and widgets.
 *
 * Heads-up — these DTOs MIX unit systems, which is the main footgun here:
 *   - SI base units on the wire: Drive.{distance_m (m), duration_s (s),
 *     energy_used_wh / regen_energy_wh (Wh), *_mps (m/s), avg_power_w (W)},
 *     ChargingSession.total_energy_added_wh (Wh).
 *   - Pre-derived DISPLAY units (already converted server-side): FleetAnalytics.
 *     {total_distance_km, total_energy_kwh, avg_efficiency_wh_km},
 *     ChargingSession.duration_min, LocationData.{miles_to_arrival,
 *     minutes_to_arrival}.
 * Convert SI fields at the render boundary only (useUnits / the injected
 * `to*Display` callbacks); NEVER re-convert the pre-derived fields. Each field's
 * runtime semantics are pinned behaviourally in types.test.tsx.
 */

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
  created_at: string;
  updated_at: string;
}

export interface VehicleState {
  vehicle_id: number;
  state: string;
  latitude: number;
  longitude: number;
  speed: number;
  power: number;
  battery_level: number;
  rated_range: number;
  ideal_range: number;
  odometer: number;
  inside_temp: number;
  outside_temp: number;
  is_climate_on: boolean;
  is_charging: boolean;
  charger_power: number;
  charge_rate: number;
  time_to_full_charge: number;
  is_locked: boolean;
  sentry_mode: boolean;
  software_version: string;
}

export interface FleetAnalytics {
  total_vehicles: number;
  total_drives: number;
  total_charging_sessions: number;
  total_distance_km: number;
  total_energy_kwh: number;
  total_cost: number;
  avg_efficiency_wh_km: number;
  period_days: number;
  most_efficient_vehicle?: { name: string; efficiency: number };
}

export interface Alert {
  id: number;
  type: string;
  severity: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface Drive {
  id: number;
  vehicle_id: number;
  started_at: string;
  ended_at: string | null;
  start_ts: string;
  distance_m: number;
  duration_s: number;
  max_speed_mps: number | null;
  avg_speed_mps: number | null;
  avg_power_w: number | null;
  start_soc_pct: number;
  end_soc_pct: number | null;
  energy_used_wh: number | null;
  regen_energy_wh: number | null;
  start_address?: string;
  end_address?: string;
}

export interface ChargingSession {
  id: number;
  vehicle_id: number;
  started_at: string;
  ended_at: string | null;
  total_energy_added_wh: number;
  start_soc_pct: number;
  end_soc_pct: number | null;
  cost_decimal: number | null;
  cost?: number | null;
  startedAt: string;
  duration_min: number;
}

export interface MotorData {
  di_torque: number | null;
  di_stator_temp: number | null;
  gear: string | null;
  lateral_accel: number | null;
  longitudinal_accel: number | null;
}

export interface ClimateData {
  inside_temp: number | null;
  outside_temp: number | null;
  hvac_power: number | null;
  hvac_fan_speed: number | null;
  defrost_mode: string | null;
  battery_heater_on: boolean;
}

export interface SecurityData {
  locked: boolean;
  sentry_mode: boolean;
  door_state: string;
  fd_window: string | null;
  fp_window: string | null;
  rd_window: string | null;
  rp_window: string | null;
}

export interface TirePressureData {
  front_left: number | null;
  front_right: number | null;
  rear_left: number | null;
  rear_right: number | null;
}

export interface MediaData {
  now_playing_title: string | null;
  now_playing_artist: string | null;
  playback_status: string | null;
  audio_volume: number | null;
  audio_volume_max: number | null;
}

export interface LocationData {
  destination_name: string | null;
  miles_to_arrival: number | null;
  minutes_to_arrival: number | null;
  located_at_home: boolean;
  located_at_work: boolean;
  located_at_favorite: boolean;
}
