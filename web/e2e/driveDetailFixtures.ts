import type { Page } from '@playwright/test';
import type { PhysicsLedger, PhysicsTerm } from '../src/api/types';
import type { DriveDiagnosticResponse } from '../src/types/admin-diagnostics';
import type { RoadAnomalyResponse } from '../src/types/roadAnomalies';
import type { GearTheater, SilentReport } from '../src/types/teslaPhysics';
import type { DriveFsdInsight, FsdInsights } from '../src/types/fsd';
import { fulfillApiFixture, mockAppSettings, mockDrive, mockVehicle, resolveApiFixture, type MockApiController } from './mockApi';

export const DRIVE_DETAIL_ID = 412;

const telemetry = Array.from({ length: 5 }, (_, index) => {
  const progress = index / 4;
  const timestamp = new Date(
    Date.parse(mockDrive.start_ts) + mockDrive.duration_s * progress * 1000,
  ).toISOString();
  return {
    timestamp,
    created_at: timestamp,
    latitude: mockDrive.start_lat + (mockDrive.end_lat - mockDrive.start_lat) * progress,
    longitude: mockDrive.start_lon + (mockDrive.end_lon - mockDrive.start_lon) * progress,
    speed: [0, 12, 17, 29.1, 0][index],
    // Canonical telemetry power is SI watts; the chart converts at render time.
    power: [0, 9200, -4200, 18700, 0][index],
    battery_level: mockDrive.start_battery_pct - 10 * progress,
    soc: mockDrive.start_battery_pct - 10 * progress,
    usable_soc: mockDrive.start_battery_pct - 10 * progress,
    inside_temp: 22,
    outside_temp: 21,
    driver_temp: 21,
    passenger_temp: 21,
    elevation: 12 + index,
    ideal_range: 420000 - 50000 * progress,
    rated_range: 400000 - 48000 * progress,
    est_range: 380000 - 47000 * progress,
    odometer: 32100000 + mockDrive.distance_m * progress,
    tire_pressure_fl: null,
    tire_pressure_fr: null,
    tire_pressure_rl: null,
    tire_pressure_rr: null,
    is_climate_on: true,
    fan_status: 2,
  };
});

const positions = telemetry.map((point) => ({
  latitude: point.latitude,
  longitude: point.longitude,
  speed: point.speed,
  power: point.power,
  battery_level: point.battery_level,
  timestamp: point.timestamp,
  created_at: point.created_at,
  inside_temp: point.inside_temp,
  outside_temp: point.outside_temp,
  ideal_range: point.ideal_range,
  rated_range: point.rated_range,
  odometer: point.odometer,
  elevation: point.elevation,
  fan_status: point.fan_status,
  is_climate_on: point.is_climate_on,
}));

// Unequal emission intervals: +10 kW for 30 minutes, then -10 kW for two minutes.
// The emitted-row mean is -8 kW; the elapsed-time mean is +8.75 kW.
// The first row is the bounded start-state row returned by both drive endpoints,
// not a fabricated zero or a second exact-start emission.
const presentationTelemetry = [0, 1800, 1801, 1802, 1803, 1804, 1805, 1806, 1807, 1920].map((second, index) => {
  const timestamp = new Date(Date.parse(mockDrive.start_ts) + second * 1000).toISOString();
  return {
    ...telemetry[Math.min(index, telemetry.length - 1)],
    timestamp, created_at: timestamp,
    power: index === 0 ? 10000 : -10000,
    outside_temp: 20.3, inside_temp: 21.7, driver_temp: 22.2, passenger_temp: 22.2,
    fan_status: index === 0 ? 4 : 0,
    elevation: index === 0 ? 30.48 : index === 1 ? 60.96 : 45.72,
    ideal_range: 300000, rated_range: 300000, est_range: 300000,
    // Telemetry endpoints expose pascals; the display bridge accepts kilopascals.
    tire_pressure_fl: 289579.794, tire_pressure_fr: 289579.794,
    tire_pressure_rl: 289579.794, tire_pressure_rr: 289579.794,
  };
});

const nullableLedger = {
  vehicle_id: mockDrive.vehicle_id,
  kind: 'drive',
  start: mockDrive.start_ts,
  end: mockDrive.end_ts,
  dynamics: null,
  drive: null,
  charge: null,
  park: null,
  thermal: null,
  range: null,
  tires: null,
  epochs: null,
  unknown_intervals: null,
  unknown_hours: 0,
  black_box: null,
  truncated: false,
  missing_signals: ['PackPower', 'Mass'],
  honesty: 'Synthetic ledger fixture with unavailable source fields.',
} satisfies PhysicsLedger;

function energyTerm(value: number): PhysicsTerm {
  return { value_wh: value, method: 'synthetic_fixture', unknown: false };
}

const populatedLedger = {
  ...nullableLedger,
  missing_signals: ['Mass'],
  honesty: 'Synthetic populated drive ledger; other domains remain unobserved.',
  drive: {
    measured_wh: energyTerm(4200),
    session_wh: 4200,
    reconcile_wh: 0,
    aero_wh: energyTerm(1000),
    rolling_wh: energyTerm(1500),
    grade_wh: energyTerm(200),
    inertial_wh: energyTerm(100),
    accessory_wh: energyTerm(300),
    drivetrain_loss_wh: energyTerm(500),
    predicted_wh: 3600,
    unexplained_wh: 600,
    unexplained_known: true,
    missing_signals: [],
    honesty: 'Synthetic populated drive ledger; other domains remain unobserved.',
  },
} satisfies PhysicsLedger;

export async function installDriveDetailMocks(
  page: Page,
  theme: 'light' | 'dark',
  controller: MockApiController | null,
  options: { partial?: boolean; imperial?: boolean; populatedLedger?: boolean; presentation?: boolean } = {},
): Promise<void> {
  const detailTelemetry = options.presentation ? presentationTelemetry : telemetry;
  const detailPositions = options.presentation ? presentationTelemetry : positions;
  const detail = {
    ...mockDrive,
    id: DRIVE_DETAIL_ID,
    positions: options.partial ? null : detailPositions,
    telemetry: options.partial ? null : detailTelemetry,
    ...(options.partial ? {
      end_battery_pct: null,
      energy_used_wh: null,
      regen_energy_wh: null,
      outside_temp_avg_c: null,
      avg_speed_mps: null,
      max_speed_mps: null,
      avg_power_w: null,
      score: null,
    } : {}),
  };
  await page.route(`**/api/v1/drives/${DRIVE_DETAIL_ID}`, (route) => fulfillApiFixture(route, controller, { json: detail }));
  await page.route(`**/api/v1/drives/${DRIVE_DETAIL_ID}/positions`, (route) => fulfillApiFixture(route, controller, {
    json: options.partial ? null : detailPositions,
  }));
  await page.route(`**/api/v1/drives/${DRIVE_DETAIL_ID}/telemetry`, (route) => fulfillApiFixture(route, controller, {
    json: options.partial ? null : detailTelemetry,
  }));
  await page.route(`**/api/v1/drives/${DRIVE_DETAIL_ID}/shares`, (route) => fulfillApiFixture(route, controller, { json: [] }));
  await page.route(`**/api/v1/vehicles/${mockDrive.vehicle_id}`, (route) => fulfillApiFixture(route, controller, {
    json: mockVehicle,
  }));
  await page.route('**/api/v1/drives/stats?*', (route) => fulfillApiFixture(route, controller, {
    json: {
      total_drives: 1,
      total_distance_km: mockDrive.distance_m / 1000,
      total_duration_s: mockDrive.duration_s,
      avg_efficiency_wh_km: mockDrive.energy_used_wh / (mockDrive.distance_m / 1000),
      avg_speed_kmh: mockDrive.avg_speed_mps * 3.6,
      top_speed_kmh: mockDrive.max_speed_mps * 3.6,
      regen_ratio: mockDrive.regen_energy_wh / mockDrive.energy_used_wh,
      regen_energy_wh: mockDrive.regen_energy_wh,
      co2_saved_kg: 0,
    },
  }));
  await page.route(`**/api/v1/physics/drives/${DRIVE_DETAIL_ID}/theater`, (route) => fulfillApiFixture(route, controller, {
    json: {
      drive_id: DRIVE_DETAIL_ID,
      vehicle_id: mockDrive.vehicle_id,
      events: options.partial ? [] : [
        { at: mockDrive.start_ts, gear: 'Drive', charge_port_door_open: false },
        { at: mockDrive.end_ts, gear: 'Park', charge_port_door_open: null },
      ],
      honesty: 'Synthetic gear observations; not continuous coverage.',
    } satisfies GearTheater,
  }));
  await page.route(`**/api/v1/physics/drives/${DRIVE_DETAIL_ID}/silent`, (route) => fulfillApiFixture(route, controller, {
    json: {
      drive_id: DRIVE_DETAIL_ID,
      vehicle_id: mockDrive.vehicle_id,
      intervals: [],
      unknown: true,
      honesty: 'Synthetic fixture without counter-interval observations.',
    } satisfies SilentReport,
  }));
  await page.route(`**/api/v1/physics/drives/${DRIVE_DETAIL_ID}/ledger`, (route) => fulfillApiFixture(route, controller, {
    json: options.populatedLedger ? populatedLedger : nullableLedger,
  }));
  await page.route('**/api/v1/annotations?*', (route) => fulfillApiFixture(route, controller, { json: [] }));
  await page.route(`**/api/v1/drives/${DRIVE_DETAIL_ID}/road-anomalies`, (route) => fulfillApiFixture(route, controller, {
    json: {
      drive_id: DRIVE_DETAIL_ID, status: 'insufficient_data', analyzed_samples: 0,
      candidates: [], limitations: ['Synthetic fixture without synchronized acceleration observations.'],
    } satisfies RoadAnomalyResponse,
  }));
  await page.route(`**/api/v1/drives/${DRIVE_DETAIL_ID}/why-ended?*`, (route) => fulfillApiFixture(route, controller, {
    json: {
      drive_id: DRIVE_DETAIL_ID, vehicle_id: mockDrive.vehicle_id,
      start_ts: mockDrive.start_ts, end_ts: mockDrive.end_ts,
      ended_status: 'parked', window: '60s', fsm_transitions: [], signal_window: [],
    } satisfies DriveDiagnosticResponse,
  }));
  if (options.presentation) {
    const baseline = resolveApiFixture('/analytics/fsd', 'GET', 'populated', theme);
    if (!baseline.matched || !baseline.body) throw new Error('Missing shared FSD fixture');
    const insights = structuredClone(baseline.body as FsdInsights);
    insights.drive_analytics.contributing_drives = [{
      drive_id: DRIVE_DETAIL_ID, started_at: mockDrive.start_ts, ended_at: mockDrive.end_ts,
      start_place: 'Home', end_place: 'Office', distance_m: mockDrive.distance_m,
      energy_used_wh: mockDrive.energy_used_wh, fsd_distance_m: mockDrive.distance_m / 2,
      fsd_share_pct: 50, confidence: 'high', reset_affected: false,
      firmware_version: '2026.30.2', evidence_truncated: false,
      evidence: [{
        start_at: mockDrive.start_ts, end_at: mockDrive.end_ts,
        fsd_distance_m: mockDrive.distance_m / 2, confidence: 'high', approximate: true,
      }],
    } satisfies DriveFsdInsight];
    await page.route('**/api/v1/analytics/fsd?*', route => fulfillApiFixture(route, controller, { json: insights }));
  }
  if (options.imperial || options.presentation) {
    await page.route('**/api/v1/settings', (route) => fulfillApiFixture(route, controller, {
      json: {
        ...mockAppSettings, mode: theme,
        ...(options.imperial ? { unit_of_length: 'mi', unit_of_temp: 'F' } : {}),
        ...(options.presentation ? { theme: 'tesla-red', unit_of_pressure: options.imperial ? 'psi' : 'bar' } : {}),
      },
    }));
  }
}
