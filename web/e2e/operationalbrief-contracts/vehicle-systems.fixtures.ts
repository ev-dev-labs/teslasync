import type { MediaSnapshot, SoftwareUpdate, VehicleState } from '../../src/api/types';
import type { GuardConfig, GuardEventsResponse } from '../../src/api/hooks/useGuard';
import type { MaintenanceItem, ServiceRecord } from '../../src/api/hooks/useMaintenance';
import type { TirePressureReading } from '../../src/api/hooks/usePressurePage';
import type { ClimateState, SafetySnapshot } from '../../src/types/vehicle-systems';

export const rangeQuery = '?vehicle_id=7&from=2026-08-01&to=2026-08-31';
export const observedAt = '2026-08-26T16:00:00.000Z';

// The wire retains snake_case; request() supplies the typed camelCase mirrors.
export interface ClimateWire {
  id?: ClimateState['id'];
  timestamp?: ClimateState['timestamp'];
  created_at?: ClimateState['created_at'];
  inside_temp?: ClimateState['insideTemp'];
  outside_temp?: ClimateState['outsideTemp'];
  driver_temp_setting?: ClimateState['driverTempSetting'];
  passenger_temp_setting?: ClimateState['passengerTempSetting'];
  hvac_power?: ClimateState['hvacPower'];
  is_ac_on?: ClimateState['isAcOn'];
  fan_speed?: ClimateState['fanSpeed'];
  hvac_fan_status?: ClimateState['hvacFanStatus'];
}

const climateRow = (minute: number, overrides: Partial<ClimateWire> = {}): ClimateWire => ({
  timestamp: new Date(Date.UTC(2026, 7, 26, 12, minute)).toISOString(),
  inside_temp: 21, outside_temp: 18,
  driver_temp_setting: 21, passenger_temp_setting: 21,
  hvac_power: true, ...overrides,
});

// Derived from the existing comfort/HVAC row-accounting fixtures, without
// non-JSON NaN/Infinity or invented comparisons. There are 12 returned rows,
// 9 unique valid timestamps, 8 known HVAC states and 5 analyzed comfort rows.
export const accountingClimate: ClimateWire[] = [
  climateRow(0),
  climateRow(0, { inside_temp: 30, hvac_power: false }),
  {},
  { timestamp: 'invalid', inside_temp: 21, hvac_power: true },
  climateRow(5, { hvac_power: null }),
  climateRow(10, { hvac_power: false }),
  climateRow(15, { inside_temp: null }),
  climateRow(20, { driver_temp_setting: null, passenger_temp_setting: null }),
  climateRow(25, { inside_temp: 25 }),
  climateRow(26),
  climateRow(27),
  climateRow(28),
];

export const latestClimate: ClimateWire = {
  ...climateRow(28), fan_speed: 0, hvac_fan_status: 0, is_ac_on: false,
};
export const unknownClimate: ClimateWire = { timestamp: observedAt };

export const pressureLatest: TirePressureReading = {
  id: 601, vehicle_id: 7, front_left: 300_000, front_right: null,
  rear_left: 280_000, rear_right: null,
  tpms_hard_warnings: '{"front_left":true}', tpms_soft_warnings: null,
  created_at: observedAt,
};
export const pressureHistory: TirePressureReading[] = [{
  ...pressureLatest, id: 602, created_at: '2026-08-25T10:00:00.000Z',
}];
export const noPressure: TirePressureReading = {
  ...pressureLatest, front_left: 0, front_right: null, rear_left: null,
  rear_right: null, tpms_hard_warnings: null,
};
// Same deterministic ten-point/30-Pa jitter as the existing drift residual
// preservation test. Identical carry-forward rows would be collapsed.
export const differentialHistory: TirePressureReading[] = Array.from({ length: 10 }, (_, index) => {
  const jitter = index % 2 === 0 ? 30 : -30;
  return {
    id: 610 + index, vehicle_id: 7,
    front_left: 240_000 + jitter, front_right: 240_000 - jitter,
    rear_left: 240_000 + jitter, rear_right: 240_000 - jitter,
    created_at: new Date(Date.UTC(2026, 7, 16 + index)).toISOString(),
  };
});

export const mediaLatest: MediaSnapshot = {
  id: 701, vehicle_id: 7, now_playing_title: 'Synthetic track',
  playback_source: 'Bluetooth', playback_status: 'paused',
  audio_volume: 0, audio_volume_max: 11, audio_volume_increment: 0,
  created_at: observedAt,
};
export const mediaHistory: MediaSnapshot[] = [
  { ...mediaLatest, id: 702, audio_volume: 0, created_at: '2026-08-25T10:00:00.000Z' },
  { ...mediaLatest, id: 703, audio_volume: 8, created_at: '2026-08-25T10:01:00.000Z' },
  { id: 704, vehicle_id: 7, created_at: '2026-08-25T10:02:00.000Z' },
];
export const unknownMedia: MediaSnapshot = {
  id: 705, vehicle_id: 7, created_at: observedAt,
};

export const safetyPartial: SafetySnapshot = {
  vehicle_id: 7, created_at: observedAt,
  automatic_emergency_braking_off: false,
  automatic_blind_spot_camera: false,
  blind_spot_collision_warning: null,
  emergency_lane_departure_avoidance: null,
  pin_to_drive_enabled: null,
  forward_collision_warning: null, lane_departure_avoidance: null,
  speed_limit_warning: null, cruise_follow_distance: null,
  miles_since_reset: 0, self_driving_miles_since_reset: null,
};

export const maintenanceItems: MaintenanceItem[] = [
  {
    id: 801, vehicle_id: 7, category: 'tires', name: 'Synthetic tire inspection',
    description: 'Read-only synthetic schedule', due_date: null,
    due_mileage: 20_000_000, current_mileage: 12_000_000,
    last_service_date: null, last_service_mileage: null,
    interval_months: 12, interval_miles: 10_000_000,
    status: 'good', created_at: observedAt,
  },
  {
    id: 802, vehicle_id: 7, category: 'brakes', name: 'Synthetic brake inspection',
    description: 'Read-only synthetic schedule', due_date: '2026-08-01',
    due_mileage: null, current_mileage: 12_000_000,
    last_service_date: null, last_service_mileage: null,
    interval_months: 12, interval_miles: null,
    status: 'overdue', created_at: observedAt,
  },
];
// The producer currently supplies only []; populated service costs are blocked.
export const serviceRecords: ServiceRecord[] = [];

export const softwareUpdates: SoftwareUpdate[] = [
  {
    id: 901, vehicle_id: 7, version: '2026.26.3', status: 'available',
    scheduled_at: null, installed_at: null, created_at: observedAt,
  },
  {
    id: 902, vehicle_id: 7, version: '2026.20.1', status: 'installed',
    scheduled_at: null, installed_at: '2026-08-20T12:00:00.000Z',
    created_at: '2026-08-20T12:00:00.000Z',
  },
  {
    id: 903, vehicle_id: 7, version: '2026.18.1', status: 'installed',
    scheduled_at: null, installed_at: '2026-08-10T12:00:00.000Z',
    created_at: '2026-08-10T12:00:00.000Z',
  },
];

export const guardConfig: GuardConfig = {
  vehicle_id: 7, enabled: false, home_geofence_id: null,
  sensitivity: 'medium', auto_panic: false,
  created_at: observedAt, updated_at: observedAt,
};
export const guardEvents: GuardEventsResponse = { vehicle_id: 7, events: [] };
export const guardState: Partial<VehicleState> = {
  vehicle_id: 7, state: 'online', is_locked: false, sentry_mode: false,
};

export interface BandContract {
  id: string;
  instances?: number;
}
export interface RootContract {
  root: string;
  route: string;
  fixture: 'climate' | 'preconditioning' | 'pressure' | 'drift' | 'media'
    | 'safety' | 'maintenance' | 'software' | 'guard';
  bands: readonly BandContract[];
}

export const rootContracts: readonly RootContract[] = [
  {
    root: 'CabinThermalPage', route: '/cabin-thermal', fixture: 'climate',
    bands: [
      { id: 'cabin-thermal-evidence' }, { id: 'cabin-thermal-coverage-summary' },
      { id: 'cabin-thermal-segmentation-summary' }, { id: 'cabin-thermal-exclusions-summary' },
    ],
  },
  {
    root: 'ClimateControlPage', route: '/climate-control', fixture: 'climate',
    bands: [
      { id: 'climate-comfort-number', instances: 2 },
      { id: 'climate-systems-stats' }, { id: 'climate-protection-stats' },
      { id: 'climate-efficiency-stats' }, { id: 'climate-efficiency-comfort' },
    ],
  },
  {
    root: 'ComfortConsistencyPage', route: '/comfort-consistency', fixture: 'climate',
    bands: [
      { id: 'comfort-consistency-evidence' }, { id: 'comfort-consistency-source-summary' },
      { id: 'comfort-consistency-coverage-summary' }, { id: 'comfort-consistency-disposition-summary' },
      { id: 'comfort-consistency-interval-summary' }, { id: 'comfort-consistency-setpoint-summary' },
      { id: 'comfort-consistency-stabilization-summary' }, { id: 'comfort-consistency-boundary-summary' },
      { id: 'comfort-consistency-score-summary' }, { id: 'comfort-consistency-availability-summary' },
    ],
  },
  {
    root: 'GuardModePage', route: '/guard-mode', fixture: 'guard',
    bands: [{ id: 'guard-overview' }],
  },
  {
    root: 'HvacCyclingPage', route: '/hvac-cycling', fixture: 'climate',
    bands: [
      { id: 'hvac-cycling-evidence' }, { id: 'hvac-cycling-source-summary' },
      { id: 'hvac-cycling-coverage-summary' }, { id: 'hvac-cycling-interval-summary' },
      { id: 'hvac-cycling-duty-summary' }, { id: 'hvac-cycling-cycle-summary' },
      { id: 'hvac-cycling-outcome-summary' }, { id: 'hvac-cycling-availability-summary' },
    ],
  },
  {
    root: 'MaintenancePage', route: '/maintenance', fixture: 'maintenance',
    bands: [{ id: 'maintenance-summary' }],
  },
  {
    root: 'MediaPlayerPage', route: '/media-player', fixture: 'media',
    bands: [{ id: 'media-listening-stats' }],
  },
  {
    root: 'PreconditioningEffectivenessPage', route: '/preconditioning-effectiveness',
    fixture: 'preconditioning',
    bands: [
      { id: 'preconditioning-evidence' }, { id: 'preconditioning-climate-source-summary' },
      { id: 'preconditioning-drive-source-summary' }, { id: 'preconditioning-climate-disposition-summary' },
      { id: 'preconditioning-departure-disposition-summary' }, { id: 'preconditioning-join-summary' },
      { id: 'preconditioning-availability-summary' }, { id: 'preconditioning-confidence-summary' },
    ],
  },
  {
    root: 'SafetySettingsPage', route: '/safety-settings', fixture: 'safety',
    bands: [{ id: 'safety-configuration-summary' }, { id: 'safety-driving-summary' }],
  },
  {
    root: 'SoftwareUpdatesPage', route: '/software-updates', fixture: 'software',
    bands: [{ id: 'software-update-summary' }],
  },
  {
    root: 'TireDifferentialDriftPage', route: '/tire-differential-drift', fixture: 'drift',
    bands: [{ id: 'tire-differential-drift-summary' }],
  },
  {
    root: 'TirePressurePage', route: '/tire-pressure', fixture: 'pressure',
    bands: [{ id: 'tire-pressure-summary' }],
  },
];

export const sourceBlockers = [
  {
    root: 'MaintenancePage', band: 'maintenance-cost-summary',
    reason: 'useMaintenance ServiceRecord documents that the producer emits only []; no independent populated mileage/cost contract. Empty panel tested, no fabricated cost rows.',
  },
  {
    root: 'PreconditioningEffectivenessPage', band: 'comparison charts',
    reason: 'This fixture deliberately has no drive departures. Readiness/improvement contrasts and classified-departure inferences stay withheld rather than invent matched groups.',
  },
  {
    root: 'ClimateControlPage', band: 'climate-single',
    reason: 'Standalone ClimateMetric renderer is useful in isolation but group rendering collects its props; it is not an additional page summary.',
  },
] as const;
