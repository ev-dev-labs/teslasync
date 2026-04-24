/* Dashboard feature types — aligned with API responses */

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
  start_ts: string;
  end_ts: string | null;
  distance_mi: number;
  duration_min: number;
  max_speed_mph: number | null;
  avg_speed_mph: number | null;
  avg_power_kw: number | null;
  start_battery_pct: number | null;
  end_battery_pct: number | null;
  energy_used_kwh: number | null;
  regen_kwh: number | null;
  start_address?: string;
  end_address?: string;
}

export interface ChargingSession {
  id: number;
  vehicle_id: number;
  start_date: string;
  end_date: string | null;
  charge_energy_added: number;
  start_battery_level: number;
  end_battery_level: number | null;
  cost: number | null;
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
