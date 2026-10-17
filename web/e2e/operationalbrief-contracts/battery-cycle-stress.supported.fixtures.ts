import type { ChargingSession as ApiChargingSession, Drive as ApiDrive } from '../../src/api/types';
import type { ChargingSession } from '../../src/types/charging';
import type { Drive } from '../../src/types/driving';
import { mockDrive } from '../mockApi';

export const cycleStressNow = '2026-08-08T12:00:00.000Z';
export const cycleStressHistoryQuery = { vehicle_id: '7', limit: '1000' } as const;

// GET /charging returns the model, not the activity view's display aliases.
type ChargingWire = Omit<ApiChargingSession, 'startedAt' | 'duration_min'>;
// The current Go drive model emits battery endpoints; ApiDrive's SoC keys
// are not the keys consumed by useDriveHistory after camelCaseKeys.
type DriveWire = Omit<ApiDrive, 'start_soc_pct' | 'end_soc_pct'> & {
  start_battery_pct: number;
  end_battery_pct: number | null;
};

// cycleStress.test.ts mixedHistory, lines 318–349: two accepted sources in
// each month, separated by a >7-day break. Keep the original numeric units.
export const cycleStressChargingWire: ChargingWire[] = [
  {
    id: 201, vehicle_id: 7, charger_type: 'AC',
    started_at: '2026-07-01T10:00:00.000Z', ended_at: '2026-07-01T11:00:00.000Z',
    start_soc_pct: 20, end_soc_pct: 90, delta_soc_pct: 70,
    total_energy_added_wh: 40_000, peak_power_w: null, avg_power_w: null,
    cost_decimal: null, cost_currency: null, cable_type: null,
    start_odometer_m: null, end_odometer_m: null,
    start_lat: null, start_lng: null, start_place: null,
  },
  {
    id: 202, vehicle_id: 7, charger_type: 'AC',
    started_at: '2026-08-01T10:00:00.000Z', ended_at: '2026-08-01T11:00:00.000Z',
    start_soc_pct: 30, end_soc_pct: 80, delta_soc_pct: 50,
    total_energy_added_wh: 40_000, peak_power_w: null, avg_power_w: null,
    cost_decimal: null, cost_currency: null, cable_type: null,
    start_odometer_m: null, end_odometer_m: null,
    start_lat: null, start_lng: null, start_place: null,
  },
];

export const cycleStressDrivesWire: DriveWire[] = [
  {
    ...mockDrive, id: 101,
    start_ts: '2026-07-01T12:00:00.000Z', end_ts: '2026-07-01T13:00:00.000Z',
    start_battery_pct: 89, end_battery_pct: 31,
    duration_s: 3_600, distance_m: 20_000, energy_used_wh: 4_000, regen_energy_wh: 300,
    avg_speed_mps: 15, max_speed_mps: 30, avg_power_w: 5_000,
    start_lat: 37.1, start_lon: -122.1, end_lat: 37.2, end_lon: -122.2,
    outside_temp_avg_c: 20, inside_temp_avg_c: 21, score: null,
    created_at: '2026-08-01T08:00:00.000Z', updated_at: '2026-08-01T09:00:00.000Z',
  },
  {
    ...mockDrive, id: 102,
    start_ts: '2026-08-01T12:00:00.000Z', end_ts: '2026-08-01T13:00:00.000Z',
    start_battery_pct: 79, end_battery_pct: 25,
    duration_s: 3_600, distance_m: 20_000, energy_used_wh: 4_000, regen_energy_wh: 300,
    avg_speed_mps: 15, max_speed_mps: 30, avg_power_w: 5_000,
    start_lat: 37.1, start_lon: -122.1, end_lat: 37.2, end_lon: -122.2,
    outside_temp_avg_c: 20, inside_temp_avg_c: 21, score: null,
    created_at: '2026-08-01T08:00:00.000Z', updated_at: '2026-08-01T09:00:00.000Z',
  },
];

// Explicit type-boundary projection of the same wire operands for assertions.
// No nonexported unit helper or analysis-result API is involved.
export function cycleStressModelOperands(): { sessions: ChargingSession[]; drives: Drive[] } {
  return {
    sessions: cycleStressChargingWire.map(row => ({
      ...row, id: String(row.id), vehicle_id: String(row.vehicle_id),
      start_ts: row.started_at, startedAt: row.started_at, duration_min: 60,
    })),
    drives: cycleStressDrivesWire.map(row => ({
      id: row.id, vehicleId: row.vehicle_id, startTs: row.start_ts, endTs: row.end_ts,
      durationS: row.duration_s, distanceM: row.distance_m,
      startAddress: row.start_address, endAddress: row.end_address,
      startLat: row.start_lat, startLon: row.start_lon, endLat: row.end_lat, endLon: row.end_lon,
      startBatteryPct: row.start_battery_pct, endBatteryPct: row.end_battery_pct,
      energyUsedWh: row.energy_used_wh, regenEnergyWh: row.regen_energy_wh,
      avgSpeedMps: row.avg_speed_mps, maxSpeedMps: row.max_speed_mps, avgPowerW: row.avg_power_w,
      outsideTempAvgC: row.outside_temp_avg_c, insideTempAvgC: row.inside_temp_avg_c,
      score: row.score, endedStatus: row.ended_status, createdAt: row.created_at, updatedAt: row.updated_at,
    })),
  };
}

// compactTurningPoints gives [20,90,31] and [30,80,25]. Rainflow leaves
// half-ranges 70/59 and 50/55: weight 2, EFC 1.17, nearest-rank median 55.
// At 60% only 70 qualifies (1/4); at 40% all four qualify. This is not SoH.
export const cycleStressExpected = {
  depthsPct: [70, 59, 50, 55],
  counts: [0.5, 0.5, 0.5, 0.5],
  durationS: [3_600, 7_200, 3_600, 7_200],
  acceptedIntervals: 4,
  returnedRows: 4,
  excludedRows: 0,
  sourceTypes: 2,
  weightedCycleCount: 2,
  equivalentFullCycles: 1.17,
  medianDepthPct: 55,
  deepCycleShare60: 0.25,
  deepCycleShare40: 1,
  // round6(0.5 * (0.70^1.7 + 0.59^1.7 + 0.50^1.7 + 0.55^1.7)).
  depthWeightedIndex17: 0.811425,
  depthWeightedIndex2: 0.6953,
  continuity: {
    acceptedIntervals: 4, rawBoundaryPoints: 8, retainedObservations: 8,
    turningPoints: 6, compactedPoints: 2, segmentCount: 2,
    timeGapBoundaries: 1, socJumpBoundaries: 0, coincidentBoundaryCollapses: 0,
    overlappingIntervals: 0,
  },
} as const;
