export interface ChargePhase {
  state: string;
  started_at: string;
  ended_at: string | null;
  duration_s: number;
  at_limit: boolean;
}

export interface SuperchargerEtiquette {
  applicable: boolean;
  charger_type?: string;
  complete_at: string | null;
  unplug_at: string | null;
  dwell_s: number | null;
  honesty: string;
}

export interface ScheduleTruth {
  scheduled_mode: string | null;
  scheduled_start_at: string | null;
  stopped_at: string | null;
  charging_resumed_at: string | null;
  waited_for_schedule: boolean | null;
  charged_anyway: boolean | null;
  unknown: boolean;
  honesty: string;
}

export interface ChargePhysics {
  session_id: number;
  vehicle_id: number;
  started_at: string;
  ended_at: string | null;
  story: ChargePhase[];
  at_limit_still_plugged_s: number | null;
  etiquette: SuperchargerEtiquette;
  schedule: ScheduleTruth;
  honesty: string;
}

export interface VampireWindow {
  kind: 'complete_plugged' | 'unplugged' | string;
  started_at: string;
  ended_at: string;
  duration_s: number;
  start_soc_pct: number | null;
  end_soc_pct: number | null;
  drain_pct: number | null;
  park_confirmed: boolean;
}

export interface VampireSplit {
  vehicle_id: number;
  complete_plugged: VampireWindow[];
  unplugged: VampireWindow[];
  complete_plugged_drain_pct: number | null;
  unplugged_drain_pct: number | null;
  honesty: string;
}

export interface ParkTruth {
  confirmed_park: boolean;
  park_confirmed_at: string | null;
  neutral_rolling: boolean;
  gear?: string;
  sentry_reported: boolean;
  sentry_counted: boolean;
  cabin_overheat_reported: boolean;
  cabin_overheat_counted: boolean;
  preconditioning_reported: boolean;
  preconditioning_counted: boolean;
  rejected: string[];
  honesty: string;
}

export interface TheaterEvent {
  at: string;
  gear?: string;
  charge_port_door_open: boolean | null;
  charge_port_latch?: string;
}

export interface GearTheater {
  drive_id: number;
  vehicle_id: number;
  events: TheaterEvent[];
  honesty: string;
}

export interface SilentInterval {
  started_at: string;
  ended_at: string;
  duration_s: number;
  gear: string;
  fsd_distance_m: number | null;
  label: string;
}

export interface SilentReport {
  drive_id: number;
  vehicle_id: number;
  intervals: SilentInterval[];
  unknown: boolean;
  honesty: string;
}

export interface FsdHeartbeat {
  vehicle_id: number;
  fsd_distance_m: number | null;
  driving_distance_m: number | null;
  last_tick_at: string | null;
  gear?: string;
  speed_mps: number | null;
  valet_mode: boolean | null;
  service_mode: boolean | null;
  firmware_version?: string;
  label: string;
  honesty: string;
}

export interface SessionBoundary {
  kind: string;
  id: number;
  started_at: string;
  ended_at: string | null;
  end_rule: string;
}

export interface SessionCertificate {
  vehicle_id: number;
  issued_at: string;
  from: string;
  to: string;
  rules: string;
  drives: SessionBoundary[];
  charges: SessionBoundary[];
  integrity_sha256: string;
  hmac_sha256: string | null;
  honesty: string;
}

export interface OutageAutobiography {
  vehicle_id: number;
  last_telemetry_at: string | null;
  gap_s: number | null;
  mqtt_connected: boolean | null;
  replay_preserves_event_time: boolean;
  unknown_since: string | null;
  notes: string[];
  honesty: string;
}

export interface PhysicsCockpit {
  vehicle_id: number;
  gear?: string;
  charge_state?: string;
  detailed_charge_state?: string;
  charge_port_latch?: string;
  charge_port_door_open: boolean | null;
  battery_level_pct: number | null;
  energy_remaining_wh: number | null;
  pack_current_a: number | null;
  pack_voltage_v: number | null;
  fsd_distance_m: number | null;
  driving_distance_m: number | null;
  speed_mps: number | null;
  sentry_mode?: string;
  valet_mode: boolean | null;
  service_mode: boolean | null;
  park: ParkTruth;
  honesty: string;
}

