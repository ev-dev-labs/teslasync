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

export interface ClockReading {
  event_time: string;
  ingest_time: string | null;
  display_time: string;
  gap_s: number | null;
  unknown: boolean;
}

export interface ThreeClocks {
  vehicle_id: number;
  latest: ClockReading | null;
  samples: ClockReading[];
  honesty: string;
}

export interface LifeSegment {
  state: string;
  started_at: string;
  ended_at: string;
  duration_s: number;
}

export interface LifeTape {
  vehicle_id: number;
  from: string;
  to: string;
  segments: LifeSegment[];
  honesty: string;
}

export interface Contradiction {
  at: string;
  kind: string;
  detail: string;
  unknown: boolean;
}

export interface ContradictionCourt {
  vehicle_id: number;
  findings: Contradiction[];
  honesty: string;
}

export interface MeterReset {
  at: string;
  meter: string;
  from_m: number | null;
  to_m: number | null;
  cause: string;
  unknown: boolean;
}

export interface MeterGenealogy {
  vehicle_id: number;
  odometer_m: number | null;
  driving_distance_m: number | null;
  fsd_distance_m: number | null;
  resets: MeterReset[];
  honesty: string;
}

export interface UnknownBudget {
  kind: string;
  hours: number;
  unknown: boolean;
}

export interface UnknownOS {
  vehicle_id: number;
  window_hours: number;
  sample_hours: number | null;
  unknown_hours: number | null;
  budgets: UnknownBudget[];
  honesty: string;
}

export interface CarKeptLiving {
  vehicle_id: number;
  last_telemetry_at: string | null;
  mqtt_connected: boolean | null;
  queued_count: number | null;
  replay_preserves_event_time: boolean;
  never_received_gap_s: number | null;
  notes: string[];
  honesty: string;
}

export interface LogbookEntry {
  word: string;
  at: string;
  ended_at: string | null;
  kind: string;
  id: number;
}

export interface TeslaLogbook {
  vehicle_id: number;
  entries: LogbookEntry[];
  honesty: string;
}

export interface FirmwareEpoch {
  version: string;
  started_at: string;
  ended_at: string | null;
  fsd_meter_start_m: number | null;
  fsd_meter_end_m: number | null;
  complete_to_unplug_s: number | null;
  honesty: string;
}

export interface FirmwareEpochs {
  vehicle_id: number;
  epochs: FirmwareEpoch[];
  honesty: string;
}

export interface PortEvidence {
  at: string;
  latch?: string;
  door_open: boolean | null;
  pack_current_a: number | null;
  charge_state?: string;
  scheduled_mode?: string;
}

export interface ChargePortCourt {
  vehicle_id: number;
  evidence: PortEvidence[];
  honesty: string;
}

export interface BlackBox {
  vehicle_id: number;
  trigger: string;
  from: string | null;
  to: string | null;
  frames: PortEvidence[];
  honesty: string;
}

export interface OwnerDictionary {
  vehicle_id: number;
  typical_complete_unplug_s: number | null;
  park_confirm_dwell_s: number | null;
  complete_without_schedule: number | null;
  honesty: string;
}

export interface PhysicsVault {
  vehicle_id: number;
  certificate: SessionCertificate;
  unknown_hours: number | null;
  firmware_versions: string[];
  etiquette_dwells_s: number[];
  honesty: string;
}

export interface ModeLaws {
  vehicle_id: number;
  valet: boolean | null;
  service: boolean | null;
  transport: boolean | null;
  allowed: string[];
  forbidden: string[];
  honesty: string;
}

export interface Nerve {
  field: string;
  status: string;
  detail: string;
}

export interface NervousSystem {
  vehicle_id: number;
  nerves: Nerve[];
  honesty: string;
}

export interface RangeDisagreement {
  vehicle_id: number;
  rated_range_m: number | null;
  est_range_m: number | null;
  ideal_range_m: number | null;
  energy_remaining_wh: number | null;
  recent_wh_per_km: number | null;
  disagree: boolean;
  true_range_m: number | null;
  honesty: string;
}

export interface ExclusiveReport {
  vehicle_id: number;
  clocks: ThreeClocks;
  life_tape: LifeTape;
  contradictions: ContradictionCourt;
  meters: MeterGenealogy;
  unknown_os: UnknownOS;
  car_kept_living: CarKeptLiving;
  logbook: TeslaLogbook;
  firmware_epochs: FirmwareEpochs;
  charge_port_court: ChargePortCourt;
  black_box: BlackBox;
  dictionary: OwnerDictionary;
  vault: PhysicsVault;
  modes: ModeLaws;
  nervous_system: NervousSystem;
  range: RangeDisagreement;
}

