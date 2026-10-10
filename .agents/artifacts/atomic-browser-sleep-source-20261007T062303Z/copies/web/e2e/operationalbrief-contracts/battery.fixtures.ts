import { expect, type Page } from '@playwright/test';
import type { BatteryCellData, RangeProjection } from '../../src/api/hooks/useAnalytics';
import type { BatteryPassport, BatteryPassportVerifyResponse } from '../../src/api/hooks/useBatteryPassport';
import type {
  BatteryHealthAnalytics, EnergyFlowData, EnergyStats, SleepEfficiencyData, SolarChargeAdvice,
} from '../../src/types/energy';
import type { ParkTruth, VampireSplit } from '../../src/types/teslaPhysics';
import type { ChargingSession } from '../../src/types/charging';
import type { ChargingSession as ApiChargingSession } from '../../src/api/types';
import { installCatalogueBatterySources } from '../dashboardCatalogueBatteryFixtures';
import { catalogueLiveStatus, installDashboardWidgetSources } from '../dashboardWidgetFixtures';
import {
  fulfillApiFixture, mockDrive, resolveApiFixture, type MockApiController,
} from '../mockApi';

// The catalogue cell fixture uses the vehicle endpoint's different cell shape.
// These are the same electrical readings, expressed in the analytics contract.
export const cells: BatteryCellData = {
  total_cells: 4, avg_voltage: 3.8, min_voltage: 3.79, max_voltage: 3.81,
  voltage_spread: 0.02, imbalance_mv: 20, pack_voltage: 15.2,
  avg_temperature: 28, min_temperature: 27, max_temperature: 29, temp_spread: 2,
  cells: [
    { cell_number: 1, voltage: 3.79, delta_from_avg: -10, status: 'slight_deviation' },
    { cell_number: 2, voltage: 3.8, delta_from_avg: 0, status: 'normal' },
    { cell_number: 3, voltage: 3.8, delta_from_avg: 0, status: 'normal' },
    { cell_number: 4, voltage: 3.81, delta_from_avg: 10, status: 'slight_deviation' },
  ],
  history: [],
};

export const equalCells: BatteryCellData = {
  ...cells, min_voltage: 3.8, max_voltage: 3.8, voltage_spread: 0, imbalance_mv: 0,
  temp_spread: 0, min_temperature: 28, max_temperature: 28,
  cells: cells.cells.map(cell => ({
    ...cell, voltage: 3.8, delta_from_avg: 0, status: 'normal',
  })),
};

// no_data withholds brick readings, not independently supplied pack/temperature signals.
export const noBrickCells: BatteryCellData = {
  ...equalCells, status: 'no_data', total_cells: 0, cells: [],
};

export function healthFixture(): BatteryHealthAnalytics {
  const resolution = resolveApiFixture('/analytics/battery-health?vehicle_id=7', 'GET', 'populated');
  expect(resolution.matched, 'existing strict battery-health fixture').toBe(true);
  expect(resolution.body).toMatchObject({
    vehicle_id: 7, current_soh: 94, estimated_capacity_wh: 74_200,
    original_capacity_wh: 79_000, total_cycles: 184,
  });
  // Source is the reviewed harness fixture, not an invented API response.
  return structuredClone(resolution.body as BatteryHealthAnalytics);
}

export const missingHealth: BatteryHealthAnalytics | null = null;

export const range: RangeProjection = {
  current_range_km: 438, projected_range_km: 438, battery_level: 72,
  efficiency_factor: 0.94, factors: [], projection_curve: [],
  current_battery_pct: 72, usable_capacity_wh: 74_200, health_factor: 0.94,
  scenarios: [], efficiency_matrix: [], tesla_estimate_km: 410, your_estimate_km: 438,
  accuracy_note: 'Synthetic model snapshot; no complete-history or accuracy claim.',
};

// Reuses the released page's duration/count counterexample: 4/10 destinations
// are asleep, but 90/120 dwell minutes are asleep. Reported 74% is not the KPI.
export const sleepWithDwell: SleepEfficiencyData = {
  vehicle_id: 7, period_days: 30, sleep_efficiency_pct: 74, time_to_sleep_avg_min: 12,
  state_distribution: [
    { state: 'asleep', count: 4, total_minutes: 90 },
    { state: 'online', count: 6, total_minutes: 30 },
  ],
  recent_events: [], total_events: 0, sentry_comparison: [],
  battery_capacity_wh: 74_200, capacity_source: 'fleet_telemetry',
};

export const sleepTransitionOnly: SleepEfficiencyData = {
  ...sleepWithDwell, sleep_efficiency_pct: 0, time_to_sleep_avg_min: 0,
  state_distribution: [
    { state: 'asleep', count: 8, total_minutes: 0 },
    { state: 'online', count: 2, total_minutes: 0 },
  ],
};

export const sleepZeroAsleep: SleepEfficiencyData = {
  ...sleepTransitionOnly,
  state_distribution: [
    { state: 'asleep', count: 0, total_minutes: 0 },
    { state: 'online', count: 10, total_minutes: 0 },
  ],
};

export const split: VampireSplit = {
  vehicle_id: 7, complete_plugged: [], unplugged: [],
  complete_plugged_drain_pct: 0.4, unplugged_drain_pct: 1.8,
  honesty: 'Split uses confirmed Park windows.',
};

export const park: ParkTruth = {
  confirmed_park: true, park_confirmed_at: '2026-04-01T04:00:00Z',
  neutral_rolling: false, sentry_reported: true, sentry_counted: true,
  cabin_overheat_reported: false, cabin_overheat_counted: false,
  preconditioning_reported: false, preconditioning_counted: false,
  rejected: [], honesty: 'Park confirmed.',
};

export const careSessions: ChargingSession[] = [
  { id: '201', vehicle_id: '7', charger_type: 'AC', start_soc_pct: 24,
    end_soc_pct: 95, total_energy_added_wh: 30_000, peak_power_w: 11_200,
    cost_decimal: 4.8, started_at: '2026-08-24T23:00:00Z', ended_at: '2026-08-25T02:10:00Z',
    start_ts: '2026-08-24T23:00:00Z', startedAt: '2026-08-24T23:00:00Z', duration_min: 190 },
  { id: '202', vehicle_id: '7', charger_type: 'DC', start_soc_pct: 24,
    end_soc_pct: 80, total_energy_added_wh: 10_000, peak_power_w: 100_000,
    cost_decimal: 1.6, started_at: '2026-08-23T23:00:00Z', ended_at: '2026-08-24T00:00:00Z',
    start_ts: '2026-08-23T23:00:00Z', startedAt: '2026-08-23T23:00:00Z', duration_min: 60 },
  { id: '203', vehicle_id: '7', charger_type: null, start_soc_pct: 24,
    end_soc_pct: null, total_energy_added_wh: 20_000, peak_power_w: null,
    cost_decimal: 3.2, started_at: '2026-08-22T23:00:00Z', ended_at: '2026-08-23T00:00:00Z',
    start_ts: '2026-08-22T23:00:00Z', startedAt: '2026-08-22T23:00:00Z', duration_min: 60 },
];

export const careDrives = [
  { ...mockDrive, id: 101, end_battery_pct: 5 },
  { ...mockDrive, id: 102, end_battery_pct: 50 },
  { ...mockDrive, id: 103, end_battery_pct: null },
];

export const capacitySessions: ChargingSession[] = careSessions.map(session => ({
  ...session, start_soc_pct: 20, end_soc_pct: 80, total_energy_added_wh: 45_000,
}));

export const ledgerDrive = {
  ...mockDrive, start_battery_pct: 80, end_battery_pct: 50, energy_used_wh: 22_500,
};

export function selectedEnergySession(): ApiChargingSession {
  const resolution = resolveApiFixture('/charging?vehicle_id=7', 'GET', 'populated');
  expect(resolution.matched).toBe(true);
  expect(resolution.body).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 201, total_energy_added_wh: 42_100, cost_decimal: 6.74 }),
  ]));
  const [session] = resolution.body as ApiChargingSession[];
  if (!session) throw new Error('Missing reviewed charging-session fixture');
  return {
    ...structuredClone(session),
    started_at: '2026-08-25T00:00:00.000Z',
    ended_at: '2026-08-25T03:10:00.000Z',
  };
}

// Preserve the actual passport wire shape and the released analysis test's
// certificate. Its existing capacity fields are kWh, not newly invented Wh keys.
export const passport: BatteryPassport = {
  vehicle_id: 7, vin_masked: '5YJ**********1234',
  issued_at: '2026-08-08T10:00:00Z', first_observed_at: '2024-01-02T03:04:05Z',
  soh_pct: 91.2, capacity_kwh: 68.4, original_capacity_kwh: 75,
  equivalent_full_cycles: 321.4, fast_charge_ratio: 0.125, avg_charge_limit_pct: 81.2,
  thermal_exposure: { cold_pct: 10, nominal_pct: 80, hot_pct: 10 }, health_grade: 'B',
  degradation_trend: [
    { date: '2026-05-01', soh_pct: 92.1 }, { date: '2026-08-01', soh_pct: 91.2 },
  ],
  recommendations: ['Server output'], provenance_hash: 'a'.repeat(64),
};

export const passportVerification: BatteryPassportVerifyResponse = {
  valid: true, expected_hash: passport.provenance_hash, provided_hash: passport.provenance_hash,
};

export const energyStats: EnergyStats = {
  vehicle_id: 7, period_days: 30, total_energy_used_wh: 12_000,
  total_energy_charged_wh: 15_000, total_wh: 15_000, total_cost: 4.5,
  total_distance_m: 100_000, avg_efficiency_wh_per_m: 0.12, co2_saved_kg: 3.2,
  daily_breakdown: [
    { date: '2026-08-25', energy_wh: 5000, cost: 1.5, distance_m: 30_000, efficiency_wh_per_m: 5000 / 30_000 },
    { date: '2026-08-26', energy_wh: 7000, cost: 3, distance_m: 70_000, efficiency_wh_per_m: 0.1 },
  ],
};

export const vehicleFlow: EnergyFlowData = {
  dc_charging_power: 0, ac_charging_power: 7200, energy_remaining: 53_424,
  pack_voltage: 400, pack_current: -18, soc: 72, charge_state: 'Charging',
};

export const solarAdvice: SolarChargeAdvice = {
  verdict: 'charge_now', surplus_w: 700, solar_w: 4200, home_w: 2500,
  battery_charge_w: 1000, recommended_amps: 3, snapshot_age_s: 0,
  explanation: 'Synthetic solar surplus from the returned live snapshot.',
};

export function powerLive() {
  return { ...catalogueLiveStatus(new Date().toISOString()), energy_site_id: 1 };
}

export async function installBatteryEndpoint(
  page: Page,
  mocks: MockApiController,
  pathname: string,
  json: unknown,
  requiredParams: Readonly<Record<string, string>> = { vehicle_id: '7' },
) {
  await page.route(url => url.pathname === `/api/v1${pathname}`, async route => {
    expect(route.request().method(), `${pathname} method`).toBe('GET');
    const url = new URL(route.request().url());
    for (const [key, value] of Object.entries(requiredParams)) {
      expect(url.searchParams.get(key), `${pathname} ${key}`).toBe(value);
    }
    expect(Object.fromEntries(url.searchParams), `${pathname} exact query`).toEqual(requiredParams);
    expect([...url.searchParams.keys()].some(key => /[A-Z]/.test(key)), 'snake_case query names').toBe(false);
    await fulfillApiFixture(route, mocks, { json: typeof json === 'function' ? json() : json });
  });
}

export async function installExistingBatterySources(page: Page, mocks: MockApiController) {
  await installCatalogueBatterySources(page, mocks);
}

export async function installExistingEnergySources(page: Page, mocks: MockApiController) {
  await installDashboardWidgetSources(page, mocks);
}
