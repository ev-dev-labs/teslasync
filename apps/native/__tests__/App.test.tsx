import React from 'react';
import type { ReactNode } from 'react';
import ReactTestRenderer from 'react-test-renderer';

import App from '../App';

jest.mock('../src/api/hooks', () => ({
  useVehicles: () => ({
    data: [
      {
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
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useAlerts: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useSystemStatus: () => ({
    data: { status: 'healthy', healthy: true },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useSystemHealth: () => ({
    data: {
      status: 'healthy',
      healthy: true,
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
  useVehicleState: () => ({
    data: {
      state: {
        vehicle_id: 42,
        state: 'online',
        battery_level: 78,
        speed_mps: 0,
        power_w: 0,
        is_charging: false,
        is_locked: true,
        software_version: '2026.20.1',
      },
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
      monthly_trend: [],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useDrives: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useChargingSessions: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useVehicleEnergy: () => ({
    data: {},
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useBatteryDegradationAnalytics: () => ({
    data: {},
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useFleetTelemetryErrorVINs: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useFleetTelemetryErrors: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useAuthMode: () => ({
    data: { mode: 'open', subject: null, capabilities: {} },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useSettings: () => ({
    data: { unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar' },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactActual = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  const SafeAreaHost = ({ children }: { children: ReactNode }) =>
    ReactActual.createElement(View, null, children);

  return {
    SafeAreaProvider: SafeAreaHost,
    SafeAreaView: SafeAreaHost,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

test('renders the TeslaSync native shell', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });

  const serialized = JSON.stringify(tree?.toJSON());
  expect(serialized).toContain('TeslaSync');
  expect(serialized).toContain('Dashboard');
  expect(serialized).toContain('Charging');
  expect(serialized).toContain('Driving');
  expect(serialized).toContain('Auth');
  expect(serialized).toContain('Native route parity');
  expect(serialized).toContain('Unresolved by group');
  expect(serialized).toContain('Route implementation status');
  expect(serialized).toContain('Route parity evidence');
});
