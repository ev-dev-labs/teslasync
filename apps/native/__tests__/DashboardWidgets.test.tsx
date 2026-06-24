import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReactTestRenderer from 'react-test-renderer';

import { DashboardScreen } from '../src/screens/DashboardScreen';
import {
  getNativeWidgetDefinition,
  IMPLEMENTED_NATIVE_WIDGETS,
  NATIVE_WIDGET_REGISTRY,
  PENDING_NATIVE_WIDGETS,
} from '../src/widgets';

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
  useVehicleState: () => ({
    data: {
      state: {
        vehicle_id: 42,
        state: 'online',
        battery_level: 81,
        speed_mps: 12.5,
        power_w: 23000,
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
      health_score: 93,
      degradation_pct: 2.4,
      current_capacity_pct: 97.6,
      total_cycles: 91,
      estimated_range_current_km: 502,
      estimated_range_new_km: 515,
      monthly_trend: [],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useAlerts: () => ({
    data: [
      {
        id: 7,
        vehicle_id: 42,
        severity: 'critical',
        title: 'Charge interrupted',
        message: 'Wall connector reported an interrupted charge.',
        is_read: false,
        created_at: '2026-06-23T20:00:00Z',
      },
    ],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useDrives: () => ({
    data: [
      {
        id: 3,
        vehicle_id: 42,
        start_ts: '2026-06-23T18:00:00Z',
        end_ts: '2026-06-23T18:32:00Z',
        duration_s: 1920,
        distance_m: 24400,
        energy_used_wh: 5100,
        regen_energy_wh: 800,
        avg_speed_mps: 12,
        max_speed_mps: 31,
        start_soc_pct: 82,
        end_soc_pct: 79,
        ended_status: 'complete',
        score: 96,
      },
    ],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useChargingSessions: () => ({
    data: [
      {
        id: 9,
        vehicle_id: 42,
        started_at: '2026-06-23T07:00:00Z',
        ended_at: '2026-06-23T09:00:00Z',
        start_soc_pct: 42,
        end_soc_pct: 80,
        total_energy_added_wh: 28600,
        peak_power_w: 11200,
        avg_power_w: 8500,
        charger_type: 'Wall Connector',
        live: false,
      },
    ],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useSystemStatus: () => ({
    data: {
      status: 'healthy',
      healthy: true,
      version: 'test-build',
      uptime: '4h',
      database: {status: 'healthy'},
      mqtt: {status: 'healthy'},
      tesla_api: {status: 'healthy'},
      fleet_telemetry: {status: 'healthy'},
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useSystemHealth: () => ({
    data: {
      status: 'healthy',
      healthy: true,
      generated_at: '2026-06-23T21:00:00Z',
      service_mode: {mode: 'normal'},
      components: {
        database: {status: 'healthy'},
        mqtt: {status: 'healthy'},
        tesla_api: {status: 'healthy'},
        fleet_telemetry: {status: 'healthy'},
      },
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));

function renderWithQueryClient(element: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });

  return ReactTestRenderer.create(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
}

test('native dashboard widget registry is typed with implemented and pending statuses', () => {
  expect(IMPLEMENTED_NATIVE_WIDGETS.map(widget => widget.id)).toEqual([
    'vehicle-hero',
    'battery-health',
    'alert-feed',
    'quick-nav',
    'recent-drives',
    'charging-summary',
    'system-status',
  ]);
  expect(PENDING_NATIVE_WIDGETS.length).toBeGreaterThan(0);

  for (const widget of NATIVE_WIDGET_REGISTRY) {
    expect(['implemented', 'pending']).toContain(widget.status);
    expect(widget.webWidgetIds.length).toBeGreaterThan(0);
    if (widget.status === 'implemented') {
      expect(widget.component).toEqual(expect.any(Function));
    } else {
      expect(widget.pendingReason.length).toBeGreaterThan(0);
    }
  }

  expect(getNativeWidgetDefinition('battery-cells')?.status).toBe('pending');
});

test('renders all implemented native dashboard widgets with API-backed content', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = renderWithQueryClient(<DashboardScreen />);
  });

  const serialized = JSON.stringify(tree?.toJSON());

  expect(serialized).toContain('Native widget registry');
  expect(serialized).toContain('Vehicle hero');
  expect(serialized).toContain('Roadrunner');
  expect(serialized).toContain('Battery and health');
  expect(serialized).toContain('Alert feed');
  expect(serialized).toContain('Charge interrupted');
  expect(serialized).toContain('Quick navigation');
  expect(serialized).toContain('Recent drives');
  expect(serialized).toContain('Charging summary');
  expect(serialized).toContain('System status');
  expect(serialized).toContain('Requires a native cell heatmap primitive');
});
