import { expect, type Page } from '@playwright/test';
import type { BatteryPassport } from '../../src/api/hooks/useBatteryPassport';
import type {
  BatteryCertificateIssueResponse, BatteryCertificateVerifyResponse,
} from '../../src/api/hooks/useBatteryCertificate';
import type { GuardEventsResponse } from '../../src/api/hooks/useGuard';
import type { Drive, ChargingSession } from '../../src/api/types';
import type { DrivingStats, DriveScore } from '../../src/types/driving';
import type { SoftwareUpdate } from '../../src/types/vehicle-systems';
import { fulfillApiFixture, type MockApiController } from '../mockApi';

export const resalePassport = {
  vehicle_id: 7, vin_masked: '5YJ…0001',
  issued_at: '2026-08-26T13:15:00Z', first_observed_at: '2026-01-12T06:30:00Z',
  soh_pct: 98, capacity_kwh: 73.5, original_capacity_kwh: 75,
  equivalent_full_cycles: 123.5, fast_charge_ratio: 0.25, avg_charge_limit_pct: 80,
  thermal_exposure: { cold_pct: 10, nominal_pct: 85, hot_pct: 5 }, health_grade: 'A',
  degradation_trend: [{ date: '2026-08-25', soh_pct: 98 }],
  recommendations: ['Synthetic recommendation: prefer moderate charge limits.'],
  provenance_hash: 'a'.repeat(64),
} satisfies BatteryPassport;

type SoftwareWire = {
  id: SoftwareUpdate['id']; vehicle_id: number; version: SoftwareUpdate['version'];
  status: SoftwareUpdate['status']; installed_at: SoftwareUpdate['installedAt'];
  scheduled_at: SoftwareUpdate['scheduledAt']; created_at: SoftwareUpdate['createdAt'];
};
export const resaleSoftware: SoftwareWire[] = [
  { id: '501', vehicle_id: 7, version: '2026.20.1', status: 'installed',
    installed_at: '2026-07-02T10:00:00Z', scheduled_at: null, created_at: '2026-07-01T10:00:00Z' },
  { id: '502', vehicle_id: 7, version: '2026.24.2', status: 'installed',
    installed_at: '2026-08-20T11:00:00Z', scheduled_at: null, created_at: '2026-08-19T11:00:00Z' },
];

export const resaleDrives = [
  { id: 601, vehicle_id: 7, start_ts: '2026-08-21T08:00:00Z', end_ts: '2026-08-21T08:30:00Z',
    duration_s: 1800, distance_m: 20000, start_address: null, end_address: null,
    start_lat: null, start_lon: null, end_lat: null, end_lon: null, start_soc_pct: 80,
    end_soc_pct: 75, energy_used_wh: 3000, regen_energy_wh: 600, avg_speed_mps: 11,
    max_speed_mps: 20, avg_power_w: 6000, outside_temp_avg_c: 20, inside_temp_avg_c: null,
    score: 90, ended_status: 'completed', created_at: '2026-08-21T08:30:00Z', updated_at: '2026-08-21T08:30:00Z' },
  { id: 602, vehicle_id: 7, start_ts: '2026-08-23T09:00:00Z', end_ts: '2026-08-23T09:30:00Z',
    duration_s: 1800, distance_m: 30000, start_address: null, end_address: null,
    start_lat: null, start_lon: null, end_lat: null, end_lon: null, start_soc_pct: 75,
    end_soc_pct: 68, energy_used_wh: 4500, regen_energy_wh: 900, avg_speed_mps: 16,
    max_speed_mps: 25, avg_power_w: 9000, outside_temp_avg_c: 21, inside_temp_avg_c: null,
    score: 94, ended_status: 'completed', created_at: '2026-08-23T09:30:00Z', updated_at: '2026-08-23T09:30:00Z' },
] satisfies Drive[];

type StatsWire = {
  total_drives: DrivingStats['totalDrives']; total_distance_km: DrivingStats['totalDistanceKm'];
  total_duration_s: DrivingStats['totalDurationS']; avg_efficiency_wh_km: DrivingStats['avgEfficiencyWhKm'];
  avg_speed_kmh: DrivingStats['avgSpeedKmh']; top_speed_kmh: DrivingStats['topSpeedKmh'];
  regen_ratio: DrivingStats['regenRatio']; regen_energy_wh: DrivingStats['regenEnergyWh'];
  co2_saved_kg: DrivingStats['co2SavedKg'];
};
// Full-history aggregates intentionally differ from the two returned drive rows.
export const resaleStats = {
  total_drives: 12, total_distance_km: 150, total_duration_s: 7200,
  avg_efficiency_wh_km: 150, avg_speed_kmh: 75, top_speed_kmh: 90,
  regen_ratio: 0.2, regen_energy_wh: 4500, co2_saved_kg: 24,
} satisfies StatsWire;
export const resaleScore = {
  overall: 92, efficiency: 93, smoothness: 91, speed_discipline: 92,
  grade: 'A', total_drives: 12, trend: 'up',
} satisfies {
  overall: DriveScore['overall']; efficiency: DriveScore['efficiency'];
  smoothness: DriveScore['smoothness']; speed_discipline: DriveScore['speedDiscipline'];
  grade: DriveScore['grade']; total_drives: DriveScore['totalDrives']; trend: DriveScore['trend'];
};

type ChargeWire = Omit<ChargingSession, 'startedAt' | 'duration_min'>;
export const resaleCharging = [
  { id: 701, vehicle_id: 7, started_at: '2026-08-10T20:00:00Z', ended_at: '2026-08-10T22:00:00Z',
    start_soc_pct: 30, end_soc_pct: 70, delta_soc_pct: 40, start_odometer_m: null,
    end_odometer_m: null, start_lat: null, start_lng: null, start_place: null,
    total_energy_added_wh: 30000, peak_power_w: 10000, avg_power_w: 9000,
    cost_decimal: 4.5, cost_currency: null, charger_type: 'AC', cable_type: 'Type 2' },
  { id: 702, vehicle_id: 7, started_at: '2026-08-14T10:00:00Z', ended_at: '2026-08-14T10:30:00Z',
    start_soc_pct: 20, end_soc_pct: 73, delta_soc_pct: 53, start_odometer_m: null,
    end_odometer_m: null, start_lat: null, start_lng: null, start_place: null,
    total_energy_added_wh: 40000, peak_power_w: 90000, avg_power_w: 80000,
    cost_decimal: 8, cost_currency: null, charger_type: 'DC Supercharger', cable_type: 'CCS' },
] satisfies ChargeWire[];
export const resaleGuard = {
  vehicle_id: 7,
  events: [
    { id: 801, vehicle_id: 7, ts: '2026-06-05T03:00:00Z', event_type: 'sentry_mode',
      from_state: 'off', to_state: 'on', details: { note: 'PRIVATE_DETAILS_SENTINEL' },
      acknowledged_at: '2026-06-05T04:00:00Z', acknowledged_by: 'PRIVATE_ACTOR_SENTINEL' },
    { id: 802, vehicle_id: 7, ts: '2026-07-07T05:00:00Z', event_type: 'locked',
      from_state: 'false', to_state: 'true', details: null, acknowledged_at: null, acknowledged_by: null },
  ],
} satisfies GuardEventsResponse;

export const resaleCertificate = {
  certificate: {
    issuer: 'TeslaSync synthetic browser fixture', version: 1, vehicle_id: 7,
    issued_at: '2026-08-26T14:00:00Z', expires_at: '2026-09-25T14:00:00Z',
    current_soh: 96, estimated_capacity_kwh: 72, original_capacity_kwh: 75,
    degradation_rate_pct_per_year: 2, battery_age_months: 24, total_cycles: 125,
    charge_habits_score: 88, stress_level: 'low', fast_charge_pct: 25,
    temp_exposure_score: null, temp_exposure_reason: 'Insufficient temperature observations',
  },
  signature: 'b'.repeat(64),
} satisfies BatteryCertificateIssueResponse;
export const replacementCertificate = {
  certificate: { ...resaleCertificate.certificate, current_soh: 94,
    estimated_capacity_kwh: 70.5, total_cycles: 126, issued_at: '2026-08-27T14:00:00Z',
    expires_at: '2026-09-26T14:00:00Z' },
  signature: 'c'.repeat(64),
} satisfies BatteryCertificateIssueResponse;

export const resaleEndpoints = [
  { path: '/maintenance', query: {} },
  { path: '/maintenance/records', query: {} },
  { path: '/software-updates', query: { vehicle_id: '7' } },
  { path: '/vehicles/7/battery-passport', query: {} },
  { path: '/vehicles/7/warranty', query: {} },
  { path: '/drives', query: { vehicle_id: '7', limit: '1000' } },
  { path: '/drives/stats', query: { vehicle_id: '7' } },
  { path: '/drives/score', query: { vehicle_id: '7' } },
  { path: '/charging', query: { vehicle_id: '7', limit: '1000' } },
  { path: '/vehicles/7/guard/events', query: {} },
  { path: '/analytics/battery-health/certificate', query: { vehicle_id: '7' } },
] as const;

export interface ResaleFixtureState {
  failStats: boolean;
  issue: BatteryCertificateIssueResponse;
  verifyValid: boolean;
  holdVerification: boolean;
  releaseVerification: (() => void) | null;
  issued: BatteryCertificateIssueResponse[];
  verifyBodies: unknown[];
  reads: Record<string, number>;
}

function expectedVerifyBody(issue: BatteryCertificateIssueResponse | undefined) {
  if (!issue) throw new Error('Verification cannot precede certificate issuance');
  const c = issue.certificate;
  // Explicit transport mirror of client.ts/resilience.ts; do not load browser-only modules in Playwright's Node process.
  return {
    certificate: {
      ...c, vehicleId: c.vehicle_id, issuedAt: c.issued_at, expiresAt: c.expires_at,
      currentSoh: c.current_soh, estimatedCapacityKwh: c.estimated_capacity_kwh,
      originalCapacityKwh: c.original_capacity_kwh,
      degradationRatePctPerYear: c.degradation_rate_pct_per_year,
      batteryAgeMonths: c.battery_age_months, totalCycles: c.total_cycles,
      chargeHabitsScore: c.charge_habits_score, stressLevel: c.stress_level,
      fastChargePct: c.fast_charge_pct, tempExposureScore: c.temp_exposure_score,
      tempExposureReason: c.temp_exposure_reason,
    },
    signature: issue.signature,
  };
}

export async function installResaleFixtures(page: Page, mocks: MockApiController | null) {
  const state: ResaleFixtureState = {
    failStats: false, issue: structuredClone(resaleCertificate), verifyValid: true,
    holdVerification: false, releaseVerification: null, issued: [], verifyBodies: [], reads: {},
  };
  for (const endpoint of resaleEndpoints) {
    await page.route(url => url.pathname === `/api/v1${endpoint.path}`, async route => {
      expect(route.request().method()).toBe('GET');
      const url = new URL(route.request().url());
      expect(Object.fromEntries(url.searchParams)).toEqual(endpoint.query);
      state.reads[endpoint.path] = (state.reads[endpoint.path] ?? 0) + 1;
      let json: unknown;
      switch (endpoint.path) {
        case '/maintenance':
        case '/maintenance/records': json = []; break;
        case '/software-updates': json = resaleSoftware; break;
        case '/vehicles/7/battery-passport': json = resalePassport; break;
        case '/vehicles/7/warranty': json = null; break;
        case '/drives': json = resaleDrives; break;
        case '/drives/stats': json = resaleStats; break;
        case '/drives/score': json = resaleScore; break;
        case '/charging': json = resaleCharging; break;
        case '/vehicles/7/guard/events': json = resaleGuard; break;
        case '/analytics/battery-health/certificate':
          json = structuredClone(state.issue);
          state.issued.push(structuredClone(state.issue));
          break;
      }
      const failed = endpoint.path === '/drives/stats' && state.failStats;
      await fulfillApiFixture(route, mocks, {
        status: failed ? 422 : 200, contentType: 'application/json',
        body: JSON.stringify(failed ? { error: 'Synthetic driving aggregates unavailable' } : json),
      });
    });
  }
  await page.route(url => url.pathname === '/api/v1/public/battery-certificate/verify', async route => {
    expect(route.request().method()).toBe('POST');
    expect(new URL(route.request().url()).search).toBe('');
    const body: unknown = route.request().postDataJSON();
    // request() retains snake_case and adds camelCase aliases before the UI posts it back.
    const issued = state.issued.at(-1);
    expect(issued, 'verification must follow an actual issue response').toBeDefined();
    expect(body, 'exact certificate plus signature, including client aliases').toEqual(expectedVerifyBody(issued));
    state.verifyBodies.push(body);
    const valid = state.verifyValid;
    if (state.holdVerification) {
      await new Promise<void>(resolve => { state.releaseVerification = resolve; });
      state.releaseVerification = null;
    }
    // This is fixture agreement, not execution/proof of backend HMAC cryptography.
    const response: BatteryCertificateVerifyResponse = valid
      ? { valid: true, certificate: issued?.certificate }
      : { valid: false };
    await fulfillApiFixture(route, mocks, {
      status: 200, contentType: 'application/json', body: JSON.stringify(response),
    });
  });
  return state;
}
