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

export interface SystemStatus {
  status?: string;
  healthy?: boolean;
  version?: string;
  uptime?: string;
  services?: Record<string, string | boolean | number | null>;
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
  ended_status: string | null;
  score: number | null;
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
  live?: boolean;
}

export interface AuthModeResponse {
  mode: 'open' | 'forward_auth' | string;
  subject?: string | null;
  capabilities?: Record<string, boolean>;
}

export interface AppSettings {
  unit_of_length?: string;
  unit_of_temp?: string;
  unit_of_pressure?: string;
  decimal_precision?: number;
  theme?: string;
}

export type UnknownApiObject = Record<string, unknown>;
