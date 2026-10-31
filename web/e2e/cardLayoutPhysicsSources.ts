import type { ExclusiveReport, OutageAutobiography, SessionCertificate } from '../src/types/teslaPhysics';
import { park } from './operationalbrief-contracts/battery.fixtures';

const now = '2026-08-26T16:00:00.000Z';
const earlier = '2026-08-26T15:00:00.000Z';
const honesty = 'Synthetic bounded observations; missing measurements remain unknown.';
const certificate = {
  vehicle_id: 7, issued_at: now, from: earlier, to: now,
  rules: 'Synthetic recorded session boundaries.',
  drives: [{ kind: 'drive', id: 101, started_at: earlier, ended_at: now, end_rule: 'Park' }],
  charges: [], integrity_sha256: 'synthetic-boundary-digest', hmac_sha256: null, honesty,
} satisfies SessionCertificate;
const outage = {
  vehicle_id: 7, last_telemetry_at: now, gap_s: 0, mqtt_connected: true,
  replay_preserves_event_time: true, unknown_since: null,
  notes: ['Synthetic observation at the review instant.'], honesty,
} satisfies OutageAutobiography;
const exclusive = {
  vehicle_id: 7,
  evidence: {
    requested_from: earlier, requested_to: now, first_recorded_at: earlier,
    last_recorded_at: now, history_rows: 2, black_box_rows: 0,
    history_truncated: false, black_box_truncated: false,
    drive_sessions_truncated: false, charge_sessions_truncated: false,
    history_available: true, black_box_available: false,
  },
  clocks: {
    vehicle_id: 7,
    latest: { event_time: now, ingest_time: now, display_time: now, gap_s: 0, unknown: false },
    samples: [earlier, now].map(event_time => ({ event_time, ingest_time: event_time, display_time: now, gap_s: 0, unknown: false })),
    honesty,
  },
  life_tape: {
    vehicle_id: 7, from: earlier, to: now,
    segments: [{ state: 'driving', started_at: earlier, ended_at: now, duration_s: 3600 }], honesty,
  },
  contradictions: { vehicle_id: 7, findings: [], honesty },
  meters: { vehicle_id: 7, odometer_m: 10000000, driving_distance_m: 12000, fsd_distance_m: 0, resets: [], honesty },
  unknown_os: { vehicle_id: 7, window_hours: 1, sample_hours: null, unknown_hours: null, budgets: [], honesty },
  car_kept_living: {
    vehicle_id: 7, last_telemetry_at: now, mqtt_connected: true, queued_count: null,
    replay_preserves_event_time: true, never_received_gap_s: null, notes: [], honesty,
  },
  logbook: { vehicle_id: 7, entries: [{ word: 'Drive', at: earlier, ended_at: now, kind: 'drive', id: 101 }], honesty },
  firmware_epochs: {
    vehicle_id: 7,
    epochs: [{
      version: '2026.26.3', started_at: earlier, ended_at: now,
      fsd_meter_start_m: null, fsd_meter_end_m: null, complete_to_unplug_s: null, honesty,
    }],
    honesty,
  },
  charge_port_court: { vehicle_id: 7, evidence: [], honesty },
  black_box: { vehicle_id: 7, trigger: 'synthetic', from: earlier, to: now, frames: [], honesty },
  dictionary: { vehicle_id: 7, typical_complete_unplug_s: null, park_confirm_dwell_s: 30, complete_without_schedule: null, honesty },
  vault: { vehicle_id: 7, certificate, unknown_hours: null, firmware_versions: ['2026.26.3'], etiquette_dwells_s: [], honesty },
  modes: { vehicle_id: 7, valet: false, service: false, transport: null, allowed: ['Observed Park'], forbidden: [], honesty },
  nervous_system: { vehicle_id: 7, nerves: [{ field: 'BatteryLevel', status: 'observed', detail: 'Synthetic bounded observation.' }], honesty },
  range: {
    vehicle_id: 7, rated_range_m: 400000, est_range_m: 380000, ideal_range_m: 420000,
    energy_remaining_wh: 60000, recent_wh_per_km: null, disagree: true, true_range_m: null, honesty,
  },
} satisfies ExclusiveReport;

export const cardLayoutPhysicsSources: Record<string, unknown> = {
  '/physics/exclusive': exclusive,
  '/physics/outage': outage,
  '/physics/certificate': certificate,
  '/physics/park-truth': park,
};
