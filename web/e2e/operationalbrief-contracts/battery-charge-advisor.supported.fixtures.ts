import type { Page } from '@playwright/test';
import type { ChargingSession, Drive } from '../../src/api/types';
import type {
  VehicleLiveSignal,
  VehicleLiveSignalsResponse,
} from '../../src/api/hooks/useTelemetry';
import { mockAppSettings, type MockApiController } from '../mockApi';
import { installBatteryEndpoint, installExistingEnergySources } from './battery.fixtures';

export const ADVISOR_NOW = '2026-06-02T12:00:00.000Z';
export const ADVISOR_PATH = '/charge-advisor?vehicle_id=7';
export const LAST_DRIVE_END = '2026-05-29T09:30:00.000Z';

// Same eight completed, nonoverlapping days and five-point drops as qualifiedHistory().
export const qualifiedAdvisorDrives: Drive[] = [
  '2026-05-01', '2026-05-05', '2026-05-09', '2026-05-13',
  '2026-05-17', '2026-05-21', '2026-05-25', '2026-05-29',
].map((date, index) => ({
  id: 7_100 + index,
  vehicle_id: 7,
  start_ts: `${date}T09:00:00.000Z`,
  end_ts: `${date}T09:30:00.000Z`,
  duration_s: 1_800,
  distance_m: 10_000,
  start_address: null,
  end_address: null,
  start_lat: null,
  start_lon: null,
  end_lat: null,
  end_lon: null,
  start_soc_pct: 70,
  end_soc_pct: 65,
  energy_used_wh: 2_000,
  regen_energy_wh: null,
  avg_speed_mps: 15,
  max_speed_mps: 30,
  avg_power_w: null,
  outside_temp_avg_c: null,
  inside_temp_avg_c: null,
  score: null,
  ended_status: 'completed',
  created_at: `${date}T09:00:00.000Z`,
  updated_at: `${date}T09:30:00.000Z`,
}));

// qualifiedHistory's charging input is deliberately empty, not missing or failed.
export const qualifiedAdvisorCharging: ChargingSession[] = [];

function observedSignal(value: number | string, kind: string): VehicleLiveSignal {
  return {
    value,
    kind,
    timestamp: ADVISOR_NOW,
    ts: ADVISOR_NOW,
    source: 'l1',
    age_ms: 0,
  };
}

export function freshAdvisorLive(batteryPct: number): VehicleLiveSignalsResponse {
  const signals: Record<string, VehicleLiveSignal> = {
    BatteryLevel: observedSignal(batteryPct, 'ValueKindFloat'),
    ChargeLimitSoc: observedSignal(80, 'ValueKindFloat'),
    DetailedChargeState: observedSignal('Disconnected', 'ValueKindEnum'),
  };
  return { vehicle_id: 7, count: 3, at: ADVISOR_NOW, signals };
}

export const absentAdvisorLive: VehicleLiveSignalsResponse = {
  vehicle_id: 7,
  count: 0,
  at: ADVISOR_NOW,
  signals: {},
};

export async function installSupportedAdvisorSources(
  page: Page,
  mocks: MockApiController,
  theme: 'light' | 'dark',
  getLive: () => VehicleLiveSignalsResponse,
) {
  await installExistingEnergySources(page, mocks);
  await installBatteryEndpoint(page, mocks, '/settings', {
    ...mockAppSettings,
    mode: theme,
    decimal_precision: 2,
    locale: 'en-US',
    language: 'en',
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    timezone_user: 'UTC',
    tz_display_default: 'vehicle',
  }, {});
  await installBatteryEndpoint(page, mocks, '/drives', qualifiedAdvisorDrives, {
    vehicle_id: '7', limit: '1000',
  });
  await installBatteryEndpoint(page, mocks, '/charging', qualifiedAdvisorCharging, {
    vehicle_id: '7', limit: '1000',
  });
  await installBatteryEndpoint(page, mocks, '/signals/7/live', getLive, {});
}

// Source calculation: weekday means are 0.20,0.20,0.38,0.19,0.19,0.19,0.19;
// calendar-day p75 is zero for every weekday (zero-driving days stay in denominators).
export const advisorReserveExpectations = [
  { floor: 10, meanDays: null, p75Days: null, guidance: 'No immediate need' },
  { floor: 20, meanDays: 5, p75Days: null, guidance: 'Monitor the threshold' },
  { floor: 30, meanDays: 0, p75Days: 0, guidance: 'Charge before next use' },
] as const;

export const advisorMeanEndSoc = [
  '20.80%', '20.60%', '20.22%', '20.03%', '19.84%', '19.65%', '19.46%',
] as const;
