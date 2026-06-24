import React, { useState, type ReactNode } from 'react';
import ReactTestRenderer from 'react-test-renderer';

import App from '../App';
import { RouteSearchPanel } from '../src/components/navigation/RouteSearchPanel';
import { ShellNavigation } from '../src/components/navigation/ShellNavigation';
import type { RouteId } from '../src/navigation/routes';

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
  useTirePressureLatest: () => ({
    data: {},
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useClimateLatest: () => ({
    data: {},
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useSecurityLatest: () => ({
    data: {},
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useSafetyLatest: () => ({
    data: {},
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useMediaLatest: () => ({
    data: {},
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useVehicleConfigLatest: () => ({
    data: {},
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useSoftwareUpdates: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useMaintenanceItems: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useServiceRecords: () => ({
    data: [],
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
  useAuthStatus: () => ({
    data: { authenticated: false, expires_at: null },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useAuthURL: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
  useSessions: () => ({
    data: { mode: 'unavailable', sessions: [] },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useTOTPStatus: () => ({
    data: { mode: 'unavailable' },
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

function NavigationHarness({ compact = false }: { compact?: boolean }) {
  const [activeRoute, setActiveRoute] = useState<RouteId>('dashboard');

  return (
    <ShellNavigation
      activeRoute={activeRoute}
      compact={compact}
      onNavigate={setActiveRoute}
    />
  );
}

async function render(element: React.ReactElement) {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(element);
  });

  if (!tree) {
    throw new Error('React test renderer did not create a tree.');
  }

  return tree;
}

test('renders the responsive shell navigation with a browser route index', async () => {
  const tree = await render(<NavigationHarness />);
  const serialized = JSON.stringify(tree.toJSON());

  expect(
    tree.root.findByProps({ testID: 'shell-navigation-sidebar' }),
  ).toBeTruthy();
  expect(serialized).toContain('Command route');
  expect(serialized).toContain('Browser route index');
  expect(serialized).toContain('Search native routes or paste a web path');
  expect(serialized).toContain('React Native');
});

test('switches native routes from keyboard-focusable navigation items', async () => {
  const tree = await render(<NavigationHarness />);

  await ReactTestRenderer.act(async () => {
    tree.root.findByProps({ testID: 'nav-item-auth' }).props.onPress();
  });

  expect(
    tree.root.findByProps({ testID: 'nav-item-auth' }).props.accessibilityState,
  ).toEqual({ selected: true });
  expect(
    tree.root.findByProps({ testID: 'nav-item-dashboard' }).props
      .accessibilityState,
  ).toEqual({ selected: false });
});

test('resolves route search commands from web paths to native targets', async () => {
  const onNavigate = jest.fn();
  const tree = await render(
    <RouteSearchPanel
      activeRoute="dashboard"
      compact={false}
      onNavigate={onNavigate}
    />,
  );

  await ReactTestRenderer.act(async () => {
    tree.root
      .findByProps({ testID: 'route-search-input' })
      .props.onChangeText('/battery-cells');
  });

  expect(JSON.stringify(tree.toJSON())).toContain('Energy');

  await ReactTestRenderer.act(async () => {
    tree.root
      .findByProps({ testID: 'route-search-input' })
      .props.onSubmitEditing();
  });

  expect(onNavigate).toHaveBeenCalledWith('energy');
});

test('renders compact navigation for mobile and native desktop narrow widths', async () => {
  const tree = await render(<NavigationHarness compact />);
  const serialized = JSON.stringify(tree.toJSON());

  expect(
    tree.root.findByProps({ testID: 'shell-navigation-compact' }),
  ).toBeTruthy();
  expect(serialized).toContain('Command');
  expect(serialized).toContain('Fleet');
  expect(serialized).toContain('Operations');
  expect(serialized).toContain('Platform');
});

test('renders the browser-width native shell without DOM embedding', async () => {
  const tree = await render(<App />);
  const serialized = JSON.stringify(tree.toJSON());

  expect(serialized).toContain('TeslaSync');
  expect(serialized).toContain('Command route');
  expect(serialized).toContain('Route parity evidence');
  expect(serialized).toContain('without browser or Electron embedding');
  expect(serialized).toContain('No WebView');
});
