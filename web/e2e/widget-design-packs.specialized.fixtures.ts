import type { BatteryCellData, CellReading } from '../src/api/hooks/useAnalytics';
import type { ChatMessage, ChatSessionInfo } from '../src/api/types';
import type { SignalHistoryResponse } from '../src/types/telemetry';

// Owner-reviewed wire fixtures, never production readings. The map clock is
// earlier than the plot handoff's 20:00 clock, but retains its UTC calendar day,
// 24-hour sample window and weekday/hour bins while keeping map evidence fresh.
export const specializedReviewClock = '2026-11-10T18:03:30.000Z';
export const chargingReviewPath = '/charging-heatmap?from=2026-11-10&to=2026-11-10';

export const specializedDrives = [
  {
    id: 1, vehicle_id: 7, start_ts: '2026-11-10T12:00:00Z', end_ts: '2026-11-10T12:10:00Z',
    duration_s: 600, distance_m: 12000, energy_used_wh: 1800, regen_energy_wh: 0,
    avg_speed_mps: 20, max_speed_mps: 25, avg_power_w: 10800, outside_temp_avg_c: 20,
    inside_temp_avg_c: null, start_address: null, end_address: null,
    start_lat: null, start_lon: null, end_lat: null, end_lon: null,
    start_soc_pct: 80, end_soc_pct: 77, score: null, ended_status: 'completed',
    created_at: '2026-11-10T12:00:00Z', updated_at: '2026-11-10T12:10:00Z',
  },
  {
    id: 2, vehicle_id: 7, start_ts: '2026-11-10T13:00:00Z', end_ts: '2026-11-10T13:03:20Z',
    duration_s: 200, distance_m: 2000, energy_used_wh: 600, avg_speed_mps: 10, outside_temp_avg_c: 0,
  },
  { id: 3, vehicle_id: 7, start_ts: '2026-11-10T14:00:00Z', avg_speed_mps: 0 },
  { id: 4, vehicle_id: 7, start_ts: '2026-11-10T15:00:00Z', avg_speed_mps: null },
];

// The existing hook DTO still declares nonnullable cell numbers. Exercise the
// reviewed nullable wire case honestly, without casting null to a number or
// changing the shared API model from this browser-only ownership boundary.
type BatteryWireFixture = Omit<BatteryCellData, 'cells'> & {
  cells: Array<Omit<CellReading, 'voltage' | 'delta_from_avg'> & {
    voltage: number | null;
    delta_from_avg: number | null;
  }>;
  signal_availability: Record<string, boolean>;
};
export const specializedBattery = {
  status: 'ok', total_cells: 4, min_voltage: 3.85, avg_voltage: 3.9, max_voltage: 3.95,
  voltage_spread: 0.1, imbalance_mv: 12.5, pack_voltage: 398.5,
  min_temperature: 22, avg_temperature: 25, max_temperature: 30, temp_spread: 8,
  signal_availability: {
    min_voltage: true, avg_voltage: true, max_voltage: true, voltage_spread: true,
    imbalance_mv: true, pack_voltage: true, min_temperature: true,
    avg_temperature: true, max_temperature: true, temp_spread: true,
  },
  cells: [
    { cell_number: 1, voltage: 3.9, delta_from_avg: 5, status: 'normal' },
    { cell_number: 2, voltage: 3.91, delta_from_avg: 15, status: 'slight_deviation' },
    { cell_number: 3, voltage: 3.85, delta_from_avg: -45, status: 'significant_deviation' },
    { cell_number: 4, voltage: null, delta_from_avg: null, status: 'normal' },
  ],
  history: [
    { timestamp: '2026-11-10T12:00:00Z', min_voltage: 3.85, avg_voltage: 3.9, max_voltage: 3.95, imbalance_mv: 12.5 },
    { timestamp: '2026-11-10T13:00:00Z', min_voltage: 3.86, avg_voltage: 3.9, max_voltage: 3.94, imbalance_mv: 8 },
  ],
} satisfies BatteryWireFixture;

export const specializedCharging = [
  { id: 11, vehicle_id: 7, started_at: '2026-11-10T12:00:00Z', ended_at: '2026-11-10T12:30:00Z', duration_s: 1800, total_energy_added_wh: 0, cost_decimal: 0, start_place: 'Fixture station', charger_type: 'ac', live: false },
  { id: 12, vehicle_id: 7, started_at: '2026-11-10T12:05:00Z', ended_at: '2026-11-10T12:35:00Z', duration_s: 1800, total_energy_added_wh: null, cost_decimal: null, start_place: 'Fixture station', charger_type: 'ac', live: false },
  { id: 13, vehicle_id: 7, started_at: '2026-11-10T13:00:00Z', ended_at: '2026-11-10T13:30:00Z', duration_s: 1800, total_energy_added_wh: -1250.75, cost_decimal: 1, start_place: 'Fixture station', charger_type: 'ac', live: false },
];

export function specializedHistory(signal: string): Omit<SignalHistoryResponse, 'vehicleId'> & { vehicle_id: number } {
  return {
    vehicle_id: 7, signal, from: '2026-11-10T12:00:00Z', to: '2026-11-10T13:04:00Z', count: 64,
    data: Array.from({ length: 64 }, (_, index) => ({
      ts: new Date(Date.parse('2026-11-10T12:00:00Z') + index * 60_000).toISOString(),
      kind: 'ValueKindDouble', value: index % (signal === 'NumericA' ? 8 : 9),
      ingest_origin: null, source_emitted_at: null, received_at: null, normalization_version: null,
    })),
  };
}

export const specializedPositions = [
  { id: '4', vehicle_id: 7, latitude: 47.612, longitude: -122.314, speed: 0, heading: 90, timestamp: '2026-11-10T18:03:00Z', created_at: '2026-11-10T18:03:00Z' },
  { id: '3', vehicle_id: 7, latitude: 47.608, longitude: -122.32, speed: 42, heading: 90, timestamp: '2026-11-10T18:02:00Z', created_at: '2026-11-10T18:02:00Z' },
  { id: '2', vehicle_id: 7, latitude: 47.604, longitude: -122.326, speed: 20, heading: 45, timestamp: '2026-11-10T18:01:00Z', created_at: '2026-11-10T18:01:00Z' },
  { id: '1', vehicle_id: 7, latitude: 47.6, longitude: -122.33, speed: 0, heading: 0, timestamp: '2026-11-10T18:00:00Z', created_at: '2026-11-10T18:00:00Z' },
];

export const syntheticConversation = 'QA first session';
export const alternateConversation = 'QA second session';
export const syntheticReply = 'QA recorded answer.\n\n- First recorded observation\n- Second recorded observation\n\n```text\nQA example only\n```';
export const specializedSessions = [
  { id: 'qa-one', title: syntheticConversation, first_message: 'QA recorded question', message_count: 2, last_message_at: '2026-01-15T12:00:00Z', created_at: '2026-01-15T12:00:00Z' },
  { id: 'qa-two', title: alternateConversation, first_message: 'QA alternate question', message_count: 2, last_message_at: '2026-01-15T12:00:00Z', created_at: '2026-01-15T12:00:00Z' },
] satisfies ChatSessionInfo[];
export const specializedTranscripts: Record<string, ChatMessage[]> = Object.fromEntries(
  specializedSessions.map((session, index) => [session.id, [
    { id: (index + 1) * 100 + 1, session_id: session.id, role: 'user', content: session.first_message, created_at: session.created_at },
    { id: (index + 1) * 100 + 2, session_id: session.id, role: 'assistant', content: syntheticReply, created_at: session.created_at },
  ] satisfies ChatMessage[]]),
);
