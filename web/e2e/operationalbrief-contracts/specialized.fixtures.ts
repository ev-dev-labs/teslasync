import type { AnomalyData } from '../../src/api/hooks/useAnomalies';
import type { EfficiencyShift, TemperatureImpactResponse } from '../../src/api/hooks/useAnalytics';
import type { OnboardingStatus } from '../../src/api/hooks/useOnboarding';
import type { ComponentDetailResponse, RULResponse } from '../../src/api/hooks/useRUL';
import type { ChargingTelemetry, LocationSnapshot } from '../../src/api/types';

export const detectorSnapshot: AnomalyData = {
  anomalies: [{
    signal: 'battery_voltage', type: 'z_score', severity: 'info',
    value: 400, baseline: 398, z_score: 2.1,
    detected_at: '2025-03-05T10:00:00Z', message: 'Battery drift',
  }],
  health_summary: { battery: 'normal', tires: 'normal', motors: 'warning' },
  signals_monitored: 42, anomalies_last_7d: 5, anomalies_last_24h: 0,
};

export const zeroDetectorSnapshot: AnomalyData = {
  anomalies: [], health_summary: {},
  signals_monitored: 0, anomalies_last_7d: 0, anomalies_last_24h: 0,
};

export interface VisitedLocationFixture {
  id: number;
  address_name: string;
  visit_count: number;
  total_duration_s: number;
  last_visited: string | null;
}

// The first two rows retain the existing LocationsPage.test.tsx operands.
export const visitedLocations: VisitedLocationFixture[] = [
  { id: 1, address_name: 'Home, Seattle', visit_count: 20, total_duration_s: 3600, last_visited: '2025-03-10T08:00:00Z' },
  { id: 2, address_name: 'Office, Bellevue', visit_count: 15, total_duration_s: 72000, last_visited: '2025-03-11T09:00:00Z' },
];

// These deferred navigation aliases are existing wire fields: distance is
// meters and speed is m/s, whereas the ETA really is minutes.
export const navigationSnapshot: LocationSnapshot = {
  id: 11, vehicle_id: 7, created_at: '2024-05-01T09:00:00Z',
  speed_mph: 10, miles_to_arrival: 9000, minutes_to_arrival: 20,
  route_traffic_delay_s: 0, latitude: 37.1, longitude: -122.1,
  heading: 0, gps_state: 'SNA', destination_name: 'Supercharger LA',
  located_at_home: false, located_at_work: false,
};

export const navigationHistory: LocationSnapshot[] = [
  navigationSnapshot,
  { id: 12, created_at: '2024-05-01T09:30:00Z', speed_mph: 20, miles_to_arrival: 6000, minutes_to_arrival: 12, destination_name: 'Work HQ' },
  { id: 13, created_at: '2024-05-01T10:00:00Z', speed_mph: 30, miles_to_arrival: 3000, minutes_to_arrival: 6 },
];

export const arrivalTelemetry: ChargingTelemetry = {
  vehicle_id: 7, ts: '2024-05-01T09:00:00Z', session_id: null,
  battery_level: null, battery_range_mi: null, charging_state: null,
  charger_voltage: null, charger_actual_current: null, charger_power_w: null,
  charger_phases: null, charge_energy_added_wh: null, range_added_meters: null,
  range_added_meters_per_hour: null, charger_pilot_current: null,
  scheduled_charging_at: null, source: 'fleet_telemetry',
  expected_energy_pct_at_arrival: 0,
};

export const incompleteSetup: OnboardingStatus = {
  tesla_connected: false, vehicle_count: 0, data_flowing: false,
  last_telemetry_at: null, telemetry_health: 'unknown',
  setup_required: true, setup_complete: false, is_complete: false,
};

export const durableSetupDuringOutage: OnboardingStatus = {
  tesla_connected: false, vehicle_count: 1, data_flowing: false,
  last_telemetry_at: '2026-08-19T16:00:00.000Z', telemetry_health: 'stale',
  setup_required: false, setup_complete: true, is_complete: true,
};

export const temperatureHistory: TemperatureImpactResponse = {
  points: [
    { outside_temp: 15, efficiency_wh_km: 150, distance_km: 30, drive_date: '2026-01-15T12:00:00Z' },
    { outside_temp: 35, efficiency_wh_km: 220, distance_km: 50, drive_date: '2026-01-25T12:00:00Z' },
  ],
  efficiency: [], vampire_drain: [], monthly_trend: [],
};

export const efficiencyShift: EfficiencyShift = {
  latest_month: '2025-12', prior_month: '2025-11',
  latest_efficiency: 23, prior_efficiency: 20, efficiency_delta_pct: 15,
  latest_temp_c: 2, prior_temp_c: 10, temp_delta_c: -8,
  temp_sensitivity_per_c: -0.3, temp_attributed_pct: 12, residual_pct: 3,
  verdict: 'colder_weather',
  explanation: 'Efficiency worsened and colder weather explains it.',
};

export const tireForecast: ComponentDetailResponse = {
  component: 'tires', label: 'Tires', health_pct: 75, wear_rate_per_day: 0.1,
  remaining_days: 100, remaining_km: null, projected_eol_date: '2026-08-01',
  confidence: 0.75, status: 'watch', basis: 'Measured tread trend',
  eol_threshold: 20, nominal_life_km: null, nominal_life_days: null,
  notes: 'Observed trend only',
  projection: [{ date: '2026-08-01', projected_health: 20, confidence_low: 15, confidence_high: 25 }],
};

export const componentBoard: RULResponse = {
  vehicle_id: 7, components: [tireForecast],
  next_service: { component: 'tires', date: '2026-08-01' },
};

export interface PositionFixture {
  id: number;
  vehicle_id: number;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  created_at: string;
}

export const stationaryWithoutGps: PositionFixture = {
  id: 11, vehicle_id: 7, latitude: 0, longitude: 0, speed: 0, heading: 0,
  created_at: '2024-05-01T09:00:00Z',
};
