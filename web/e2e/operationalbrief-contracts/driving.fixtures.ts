import { expect, type Page } from '@playwright/test';
import type {
  Drive, GeocodeResult, RegenEfficiencyData, RouteEfficiencyData,
  SpeedProfileData, TripPlan, TripPlanRequest,
} from '../../src/types/driving';
import type {
  GhostResponse, LeaderboardResponse, SegmentsResponse,
} from '../../src/api/hooks/useSegments';
import {
  fulfillApiFixture, mockAppSettings, mockDrive, type MockApiController,
} from '../mockApi';

export const DRIVING_WINDOW = 'from=2026-08-01&to=2026-08-31';

export const drivingRecord = {
  id: mockDrive.id,
  vehicleId: mockDrive.vehicle_id,
  startTs: mockDrive.start_ts,
  endTs: mockDrive.end_ts,
  durationS: mockDrive.duration_s,
  distanceM: mockDrive.distance_m,
  startAddress: mockDrive.start_address,
  endAddress: mockDrive.end_address,
  startLat: mockDrive.start_lat,
  startLon: mockDrive.start_lon,
  endLat: mockDrive.end_lat,
  endLon: mockDrive.end_lon,
  startBatteryPct: mockDrive.start_battery_pct,
  endBatteryPct: mockDrive.end_battery_pct,
  energyUsedWh: mockDrive.energy_used_wh,
  regenEnergyWh: mockDrive.regen_energy_wh,
  avgSpeedMps: mockDrive.avg_speed_mps,
  maxSpeedMps: mockDrive.max_speed_mps,
  avgPowerW: mockDrive.avg_power_w,
  outsideTempAvgC: mockDrive.outside_temp_avg_c,
  insideTempAvgC: mockDrive.inside_temp_avg_c,
  score: mockDrive.score,
  endedStatus: mockDrive.ended_status,
  createdAt: mockDrive.created_at,
  updatedAt: mockDrive.updated_at,
} satisfies Drive;

function wireDrive(row: Drive) {
  return {
    id: row.id, vehicle_id: row.vehicleId, start_ts: row.startTs, end_ts: row.endTs,
    duration_s: row.durationS, distance_m: row.distanceM,
    start_address: row.startAddress, end_address: row.endAddress,
    start_lat: row.startLat, start_lon: row.startLon, end_lat: row.endLat, end_lon: row.endLon,
    start_battery_pct: row.startBatteryPct, end_battery_pct: row.endBatteryPct,
    energy_used_wh: row.energyUsedWh, regen_energy_wh: row.regenEnergyWh,
    avg_speed_mps: row.avgSpeedMps, max_speed_mps: row.maxSpeedMps, avg_power_w: row.avgPowerW,
    outside_temp_avg_c: row.outsideTempAvgC, inside_temp_avg_c: row.insideTempAvgC,
    score: row.score, ended_status: row.endedStatus,
    created_at: row.createdAt, updated_at: row.updatedAt,
  };
}

export const recordedRows: Drive[] = [
  { ...drivingRecord, distanceM: 16093.44, energyUsedWh: 4000, regenEnergyWh: 0 },
  { ...drivingRecord, id: 102, distanceM: 32186.88, energyUsedWh: 8000, regenEnergyWh: 2000 },
  { ...drivingRecord, id: 103, distanceM: 5000, energyUsedWh: 1000, regenEnergyWh: null },
  {
    ...drivingRecord, id: 104, startTs: '2026-07-25T08:00:00.000Z',
    endTs: '2026-07-25T08:32:00.000Z', distanceM: 90000,
  },
];

export const recordedProfile = {
  avgSpeedMps: 10, peakSpeedMps: 20, optimalSpeedMps: 15,
  distribution: [
    { speed_bucket: '0-45', readings: 12, avg_power_w: 8000 },
    { speed_bucket: '45-90', readings: 8, avg_power_w: 16000 },
  ],
} satisfies SpeedProfileData;

// Aggregate used energy includes the third row's measured 1,000 Wh. The
// detailed paired-energy analysis excludes that row's unknown recovery;
// neither scope extrapolates a capped sample to a fabricated window total.
export const recordedRecovery = {
  vehicleId: 7, totalRegenWh: 2000, totalDriveWh: 13000,
  regenRatio: 2000 / 13000 * 100, monthlyAvgRegen: 0,
  freeCharges: 2000 / 75000, monthlySummary: [], drives: [],
  batteryCapacityWh: 75000, capacitySource: 'model_estimate',
} satisfies RegenEfficiencyData;

export const recordedRoutes = {
  totalRoutes: 2, totalTrips: 5,
  routes: [
    { startLocation: 'Home', endLocation: 'Office', tripCount: 2, avgDistanceKm: 10,
      avgEfficiency: 200, bestEfficiency: 180, worstEfficiency: 220 },
    { startLocation: 'Office', endLocation: 'Park', tripCount: 3, avgDistanceKm: 20,
      avgEfficiency: 300, bestEfficiency: 280, worstEfficiency: 320 },
  ],
} satisfies RouteEfficiencyData;

export const sweetSpotRows: Drive[] = [
  ...[201, 202, 203].map(id => ({
    ...drivingRecord, id, distanceM: 10000, durationS: 1000,
    avgSpeedMps: 10, energyUsedWh: 2000,
  })),
  ...[204, 205, 206].map(id => ({
    ...drivingRecord, id, distanceM: 10000, durationS: 600,
    avgSpeedMps: 20, energyUsedWh: 3000,
  })),
  { ...drivingRecord, id: 207, energyUsedWh: null },
];

export const simulatedDrive = {
  ...drivingRecord, id: 301, distanceM: 10000, durationS: 1000,
  avgSpeedMps: 10, energyUsedWh: 4000, avgPowerW: 14400,
  startBatteryPct: 80, endBatteryPct: 72,
  endTs: '2026-08-25T08:16:40.000Z',
} satisfies Drive;

const raceSegment = {
  id: 51, name: 'Home → Office', start_address: 'Home', end_address: 'Office',
  distance_m: 10000, attempt_count: 2,
};
export const recordedSegments = {
  segments: [{
    ...raceSegment,
    best_time: { drive_id: 101, duration_s: 600, started_at: drivingRecord.startTs },
    best_efficiency: { drive_id: 101, wh_per_km: 200, started_at: drivingRecord.startTs },
    latest: { drive_id: 102, duration_s: 660, started_at: drivingRecord.startTs },
  }],
} satisfies SegmentsResponse;
const rankedAttempts = [
  {
    rank: 1, drive_id: 101, started_at: drivingRecord.startTs, duration_s: 600,
    distance_m: 10000, wh_per_km: 200, delta_to_best_s: 0, is_pr: true,
  },
  {
    rank: 2, drive_id: 102, started_at: drivingRecord.startTs, duration_s: 660,
    distance_m: 10000, wh_per_km: 220, delta_to_best_s: 60, is_pr: false,
  },
];
export const recordedLeaderboard = {
  segment: raceSegment, by_time: rankedAttempts, by_efficiency: rankedAttempts,
} satisfies LeaderboardResponse;
export const recordedGhost = {
  segment: raceSegment,
  a: {
    drive_id: 101, duration_s: 600,
    series: [
      { fraction_of_distance: 0, elapsed_s: 0, speed_mps: 0 },
      { fraction_of_distance: 1, elapsed_s: 600, speed_mps: 0 },
    ],
  },
  b: {
    drive_id: 102, duration_s: 660,
    series: [
      { fraction_of_distance: 0, elapsed_s: 0, speed_mps: 0 },
      { fraction_of_distance: 1, elapsed_s: 660, speed_mps: 0 },
    ],
  },
  split_deltas: [{ fraction: 0, delta_s: 0 }, { fraction: 1, delta_s: -60 }],
  winner_drive_id: 101, margin_s: 60,
} satisfies GhostResponse;

export const plannedTrip = {
  route: {
    total_distance_m: 16093.44, total_duration_s: 4500,
    driving_duration_s: 3600, charging_duration_s: 900,
    total_energy_wh: 4000, estimated_cost: 1.2,
    arrival_soc: 40, feasible: true, is_estimate: true,
  },
  legs: [{
    from: { lat: 37.4, lng: -122.1, name: 'Home' },
    to: { lat: 37.7, lng: -122.4, name: 'Office' },
    distance_m: 16093.44, duration_s: 3600, energy_wh: 4000,
    start_soc: 80, arrival_soc: 40,
  }],
  charge_stops: [],
  weather_impact: { avg_temp_c: 20, efficiency_factor: 1, note: 'Synthetic route estimate' },
  soc_curve: [{ distance_m: 0, soc: 80 }, { distance_m: 16093.44, soc: 40 }],
  cost_comparison: {
    ev_cost: 1.2, gas_cost: 2, gas_gallons: 0.5,
    savings: 0.8, savings_pct: 40, gas_price_per_gallon: 4, gas_mpg: 20,
  },
} satisfies TripPlan;

export interface DrivingFixtureOptions {
  imperial?: boolean;
  rows?: readonly Drive[];
  profile?: Partial<SpeedProfileData>;
  recovery?: RegenEfficiencyData;
  routes?: RouteEfficiencyData;
  failProfile?: boolean;
  failDrives?: boolean;
  failRecovery?: boolean;
  plan?: TripPlan;
  ghost?: GhostResponse;
  detail?: Drive;
}

export async function installDrivingBriefFixtures(
  page: Page, controller: MockApiController | null, theme: 'light' | 'dark',
  options: DrivingFixtureOptions = {},
) {
  if (!controller) throw new Error('OperationalBrief driving contracts require strict synthetic API fixtures');
  const calls: { method: string; pathname: string; params: URLSearchParams }[] = [];
  const rows = options.rows ?? recordedRows;
  const profile = options.profile ?? recordedProfile;
  const recovery = options.recovery ?? recordedRecovery;
  const routes = options.routes ?? recordedRoutes;
  let planRequests = 0;
  let rejectNextPlan = false;

  async function fixture(pathname: string, json: object | readonly object[], fail = false) {
    await page.route(url => url.pathname === `/api/v1${pathname}`, async route => {
      const url = new URL(route.request().url());
      expect(route.request().method()).toBe('GET');
      calls.push({ method: 'GET', pathname, params: url.searchParams });
      await fulfillApiFixture(route, controller, fail
        ? { status: 503, json: { error: 'Synthetic source unavailable' } }
        : { json });
    });
  }

  await fixture('/settings', {
    ...mockAppSettings, theme,
    unit_of_length: options.imperial ? 'mi' : 'km', decimal_precision: 2,
  });
  await fixture('/drives', rows.map(wireDrive), options.failDrives);
  if (options.detail) {
    await fixture(`/drives/${options.detail.id}`, {
      ...wireDrive(options.detail), positions: [], telemetry: [],
    });
    await fixture(`/drives/${options.detail.id}/telemetry`, []);
  }
  await fixture('/analytics/speed-profile', {
    avg_speed_mps: profile.avgSpeedMps, peak_speed_mps: profile.peakSpeedMps,
    optimal_speed_mps: profile.optimalSpeedMps, distribution: profile.distribution ?? [],
  }, options.failProfile);
  await fixture('/analytics/regen', {
    vehicle_id: recovery.vehicleId, total_regen_wh: recovery.totalRegenWh,
    total_drive_wh: recovery.totalDriveWh, regen_ratio: recovery.regenRatio,
    monthly_avg_regen: recovery.monthlyAvgRegen, free_charges: recovery.freeCharges,
    monthly_summary: recovery.monthlySummary, drives: recovery.drives,
    battery_capacity_wh: recovery.batteryCapacityWh, capacity_source: recovery.capacitySource,
  }, options.failRecovery);
  await fixture('/analytics/route-efficiency', {
    total_routes: routes.totalRoutes, total_trips: routes.totalTrips,
    routes: routes.routes.map(row => ({
      start_location: row.startLocation, end_location: row.endLocation,
      trip_count: row.tripCount, avg_distance_km: row.avgDistanceKm,
      avg_efficiency: row.avgEfficiency, best_efficiency: row.bestEfficiency,
      worst_efficiency: row.worstEfficiency,
    })),
  });
  await fixture('/vehicles/7/segments', recordedSegments);
  await fixture('/segments/51/leaderboard', recordedLeaderboard);
  await page.route(url => url.pathname === '/api/v1/segments/51/ghost', async route => {
    const url = new URL(route.request().url());
    expect(route.request().method()).toBe('GET');
    expect(url.searchParams.get('a')).toBe('101');
    expect(url.searchParams.get('b')).toBe('102');
    calls.push({ method: 'GET', pathname: '/segments/51/ghost', params: url.searchParams });
    await fulfillApiFixture(route, controller, { json: options.ghost ?? recordedGhost });
  });

  await page.route(url => url.pathname === '/api/v1/geocode/search', async route => {
    const url = new URL(route.request().url());
    expect(route.request().method()).toBe('GET');
    const query = url.searchParams.get('q');
    expect(['Home', 'Office']).toContain(query);
    expect(url.searchParams.get('limit')).toBe('5');
    const location = query === 'Home' ? plannedTrip.legs[0].from : plannedTrip.legs[0].to;
    const results = [{ display_name: location.name, lat: location.lat, lng: location.lng }] satisfies GeocodeResult[];
    calls.push({ method: 'GET', pathname: '/geocode/search', params: url.searchParams });
    await fulfillApiFixture(route, controller, { json: results });
  });
  await page.route(url => url.pathname === '/api/v1/trip-planner/plan', async route => {
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON() as TripPlanRequest;
    expect(body).toMatchObject({
      vehicle_id: 7, origin: plannedTrip.legs[0].from, destination: plannedTrip.legs[0].to,
      current_soc: 80, min_arrival_soc: 20, charge_limit_soc: 90,
      preferences: { speed_factor: 1, include_weather: true, prefer_superchargers: true },
    });
    planRequests += 1;
    calls.push({ method: 'POST', pathname: '/trip-planner/plan', params: new URLSearchParams() });
    await fulfillApiFixture(route, controller, rejectNextPlan
      ? { status: 503, json: { error: 'Synthetic recomputation unavailable' } }
      : { json: options.plan ?? plannedTrip });
  });
  return {
    calls,
    get planRequests() { return planRequests; },
    rejectNextPlan() { rejectNextPlan = true; },
  };
}

export async function seedDrivingLogbook(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('teslasync:trip-logbook:v1', JSON.stringify({
      categories: { 101: 'business', 102: 'commute', 103: 'personal', 104: 'business' },
      ratesPerKm: { business: 0.5, commute: 0.25, personal: 0 },
    }));
  });
}
