import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { EnergyScreen } from '../src/screens/EnergyScreen';
import { SystemScreen } from '../src/screens/SystemScreen';

const vehicle = {
  id: 1,
  vehicle_id: 42,
  vin: '5YJTESLASYNC0001',
  display_name: 'Roadrunner',
  model: 'Model Y',
  trim_badging: 'Performance',
  exterior_color: 'Pearl White',
  wheel_type: 'Uberturbine',
  state: 'online',
  healthy: true,
  timezone: 'America/Los_Angeles',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-06-23T20:00:00Z',
};

jest.mock('../src/api/hooks', () => ({
  useVehicles: () => ({
    data: [vehicle],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useVehicleEnergy: () => ({
    data: {
      vehicle_id: 1,
      period_days: 30,
      total_energy_used_wh: 152000,
      total_energy_charged_wh: 165000,
      total_wh: 165000,
      total_cost: 48.25,
      total_distance_m: 820000,
      avg_efficiency_wh_per_m: 0.185,
      co2_saved_kg: 42,
      daily_breakdown: [],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useBatteryHealth: () => ({
    data: {
      health_score: 94,
      degradation_pct: 2.1,
      current_capacity_pct: 97.9,
      total_cycles: 88,
      estimated_range_current_km: 505,
      estimated_range_new_km: 516,
      monthly_trend: [{ month: '2026-06', capacity_pct: 97.9, range_km: 505 }],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useFleetAnalytics: () => ({
    data: {
      period_days: 30,
      total_vehicles: 1,
      total_distance_km: 820,
      total_drives: 24,
      total_charging_sessions: 12,
      total_cost: 48.25,
      avg_efficiency_wh_km: 185,
      most_efficient_vehicle: { id: 1, name: 'Roadrunner', efficiency: 171 },
      vehicle_comparison: [
        {
          id: 1,
          name: 'Roadrunner',
          distance: 820,
          energy: 165,
          efficiency: 185,
          drives: 24,
        },
      ],
      drive_analytics: {
        daily_trend: [
          { date: '2026-06-23', drives: 3, distance: 121, efficiency: 185 },
        ],
      },
      charging_analytics: {},
      battery_trend: [],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useTCOAnalytics: () => ({
    data: {
      vehicle_id: 1,
      total_charging_cost: 48.25,
      total_wh: 165000,
      total_sessions: 12,
      total_km: 820,
      first_date: '2026-06-01',
      last_date: '2026-06-23',
      months_of_ownership: 6,
      cost_per_km_ev: 0.06,
      cost_per_km_ice: 0.19,
      equivalent_gas_cost: 155,
      total_savings: 106.75,
      monthly_savings: 17.79,
      maintenance_savings_estimate: 15,
      gas_price: 4.9,
      monthly_breakdown: [
        {
          month: '2026-06',
          ev_cost: 48.25,
          equiv_gas_cost: 155,
          savings: 106.75,
          cumulative_savings: 106.75,
          energy_wh: 165000,
        },
      ],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useSleepAnalytics: () => ({
    data: {
      vehicle_id: 1,
      period_days: 30,
      state_distribution: [{ state: 'asleep', count: 12, total_minutes: 4200 }],
      sleep_efficiency_pct: 91.2,
      total_events: 12,
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useRegenAnalytics: () => ({
    data: {
      vehicle_id: 1,
      total_regen_wh: 24000,
      total_drive_wh: 152000,
      regen_ratio: 15.8,
      monthly_avg_regen: 24000,
      free_charges: 0.3,
      monthly_summary: [],
      drives: [],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useBatteryDegradationAnalytics: () => ({
    data: {
      vehicle_id: 1,
      current_health: 94,
      current_capacity: 97.9,
      current_degradation: 2.1,
      current_range: 505,
      current_cycles: 88,
      current_temp: 24.5,
      stress_level: 'Low',
      fast_charge_ratio: 8.2,
      battery_capacity_wh: 79000,
      capacity_source: 'model',
      monthly_trend: [{ month: '2026-06', avg_health: 94, avg_capacity: 97.9 }],
      recommendations: ['Keep daily charge limit below 90%.'],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useSpeedProfile: () => ({
    data: {
      distribution: [{ speed_bucket: '15-30', readings: 8, avg_power_w: 9000 }],
      categories: [],
      points: [],
      avg_speed_mps: 14,
      peak_speed_mps: 32,
      optimal_speed_mps: 16,
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useTemperatureImpact: () => ({
    data: {
      efficiency: [
        {
          temp_bucket: '20-30 C',
          drive_count: 8,
          avg_distance_km: 42,
          avg_duration_s: 1800,
          avg_battery_pct_per_100km: 17.4,
          avg_temp: 24,
        },
      ],
      vampire_drain: [],
      monthly_trend: [],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useRouteEfficiency: () => ({
    data: {
      routes: [
        {
          start_location: 'Home',
          end_location: 'Office',
          trip_count: 6,
          avg_distance_km: 42,
          avg_duration_s: 1900,
          avg_efficiency: 17.8,
          best_efficiency: 15.9,
          worst_efficiency: 21.1,
          avg_speed: 48,
          avg_temp: 23,
        },
      ],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useSystemStatus: () => ({
    data: {
      status: 'healthy',
      healthy: true,
      version: '2026.6.0',
      uptime: '2h',
      database: { status: 'healthy' },
      mqtt: { status: 'healthy' },
      tesla_api: { status: 'healthy' },
      fleet_telemetry: { status: 'healthy' },
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useSystemHealth: () => ({
    data: {
      status: 'healthy',
      healthy: true,
      generated_at: '2026-06-23T20:00:00Z',
      service_mode: { mode: 'normal', message: 'All systems go' },
      components: {
        database: { status: 'healthy' },
        mqtt: { status: 'healthy' },
        tesla_api: { status: 'healthy' },
        fleet_telemetry: { status: 'healthy' },
      },
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useVersionInfo: () => ({
    data: {
      app_version: '2026.6.0',
      chart_version: '1.2.3',
      go_version: 'go1.25',
      os: 'linux',
      arch: 'amd64',
      endpoints: {},
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useFleetTelemetryCoverage: () => ({
    data: {
      categories: [
        {
          category: 'Vehicle',
          total_fields: 88,
          destinations: { signal_log: 88 },
          fields: [
            {
              field: 'BatteryLevel',
              destination: 'signal_log',
              subscribed: true,
            },
          ],
        },
      ],
      destination_totals: { signal_log: 88 },
      orphan_fields: [],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useFleetTelemetryErrorVINs: () => ({
    data: [
      {
        id: 1,
        vin: '5YJTESLASYNC0001',
        active: false,
        first_seen_at: '2026-06-01',
        last_seen_at: '2026-06-02',
        resolved_at: '2026-06-02',
      },
    ],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useFleetTelemetryErrors: () => ({
    data: [
      {
        id: 1,
        vin: '5YJTESLASYNC0001',
        error_code: 'ok',
        error_message: 'Recovered',
        reported_at: '2026-06-02T00:00:00Z',
        tesla_updated_at: null,
        fetched_at: '2026-06-02T00:01:00Z',
      },
    ],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useSystemAudit: () => ({
    data: [
      {
        id: 1,
        ts: '2026-06-23T20:00:00Z',
        actor: 'system',
        action: 'fleet.telemetry.coverage',
        entity_type: 'diagnostics',
        entity_id: 7,
        detail: 'Coverage read',
      },
    ],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useAvailableSignals: () => ({
    data: {
      vehicle_id: 1,
      count: 2,
      source: 'protomodel',
      signals: [
        {
          name: 'BatteryLevel',
          category: 'Battery',
          value_kind: 'ValueKindFloat',
          unit_kind: 'UnitKindPercent',
          is_compound: false,
          is_setting_unit: false,
        },
        {
          name: 'Gear',
          category: 'Drive',
          value_kind: 'ValueKindString',
          unit_kind: 'UnitKindNone',
          is_compound: false,
          is_setting_unit: false,
        },
      ],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useLiveSignals: () => ({
    data: {
      vehicle_id: 1,
      count: 1,
      at: '2026-06-23T20:00:00Z',
      signals: {
        BatteryLevel: {
          kind: 'ValueKindFloat',
          value: 82,
          ts: '2026-06-23T19:59:59Z',
          timestamp: '2026-06-23T19:59:59Z',
          source: 'l1',
          age_ms: 1000,
        },
      },
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));

async function render(element: React.ReactElement) {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(element);
  });

  return JSON.stringify(tree?.toJSON());
}

test('renders energy, battery, analytics, and route readiness surfaces', async () => {
  const serialized = await render(<EnergyScreen />);

  expect(serialized).toContain('Energy and battery overview');
  expect(serialized).toContain('Battery health and degradation');
  expect(serialized).toContain('Fleet energy analytics');
  expect(serialized).toContain('Ownership, sleep, and regen');
  expect(serialized).toContain('Driving energy analytics');
  expect(serialized).toContain('Battery degradation analytics');
  expect(serialized).toContain('Speed profile distribution');
  expect(serialized).toContain('Energy products and power flow');
  expect(serialized).toContain('Roadrunner');
});

test('renders system, telemetry, audit, and live signal diagnostics', async () => {
  const serialized = await render(<SystemScreen />);

  expect(serialized).toContain('System operations status');
  expect(serialized).toContain('Version and audit trail');
  expect(serialized).toContain('Fleet Telemetry diagnostics');
  expect(serialized).toContain('Live signal diagnostics');
  expect(serialized).toContain('Fleet Telemetry coverage');
  expect(serialized).toContain('Audit log diagnostics');
  expect(serialized).toContain('BatteryLevel');
  expect(serialized).toContain('signal_log');
});
