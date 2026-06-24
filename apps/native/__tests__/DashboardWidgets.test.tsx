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
import type {
  Alert,
  BatteryHealth,
  ChargingSession,
  Drive,
  SystemHealth,
  SystemStatus,
  Vehicle,
  VehicleStateResponse,
} from '../src/api/types';

type QueryState<T> = {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
};

const mockUseVehicles = jest.fn();
const mockUseVehicleState = jest.fn();
const mockUseBatteryHealth = jest.fn();
const mockUseAlerts = jest.fn();
const mockUseDrives = jest.fn();
const mockUseChargingSessions = jest.fn();
const mockUseSystemStatus = jest.fn();
const mockUseSystemHealth = jest.fn();
const mockUseVehicleEnergy = jest.fn();
const mockUseBatteryDegradationAnalytics = jest.fn();
const mockUseFleetTelemetryErrorVINs = jest.fn();
const mockUseFleetTelemetryErrors = jest.fn();

jest.mock('../src/api/hooks', () => ({
  useVehicles: (...args: unknown[]) => mockUseVehicles(...args),
  useVehicleState: (...args: unknown[]) => mockUseVehicleState(...args),
  useBatteryHealth: (...args: unknown[]) => mockUseBatteryHealth(...args),
  useAlerts: (...args: unknown[]) => mockUseAlerts(...args),
  useDrives: (...args: unknown[]) => mockUseDrives(...args),
  useChargingSessions: (...args: unknown[]) => mockUseChargingSessions(...args),
  useSystemStatus: (...args: unknown[]) => mockUseSystemStatus(...args),
  useSystemHealth: (...args: unknown[]) => mockUseSystemHealth(...args),
  useVehicleEnergy: (...args: unknown[]) => mockUseVehicleEnergy(...args),
  useBatteryDegradationAnalytics: (...args: unknown[]) =>
    mockUseBatteryDegradationAnalytics(...args),
  useFleetTelemetryErrorVINs: (...args: unknown[]) =>
    mockUseFleetTelemetryErrorVINs(...args),
  useFleetTelemetryErrors: (...args: unknown[]) =>
    mockUseFleetTelemetryErrors(...args),
}));

const vehicle: Vehicle = {
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
};

const vehicleState: VehicleStateResponse = {
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
};

const batteryHealth: BatteryHealth = {
  health_score: 93,
  degradation_pct: 2.4,
  current_capacity_pct: 97.6,
  total_cycles: 91,
  estimated_range_current_km: 502,
  estimated_range_new_km: 515,
  monthly_trend: [],
};

const alert: Alert = {
  id: 7,
  vehicle_id: 42,
  severity: 'critical',
  title: 'Charge interrupted',
  message: 'Wall connector reported an interrupted charge.',
  is_read: false,
  created_at: '2026-06-23T20:00:00Z',
};

const drive: Drive = {
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
};

const chargingSession: ChargingSession = {
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
};

const systemStatus: SystemStatus = {
  status: 'healthy',
  healthy: true,
  version: 'test-build',
  uptime: '4h',
  database: {status: 'healthy'},
  mqtt: {status: 'healthy'},
  tesla_api: {status: 'healthy'},
  fleet_telemetry: {status: 'healthy'},
};

const systemHealth: SystemHealth = {
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
};

const vehicleEnergy = {
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
};

const batteryDegradation = {
  vehicle_id: 1,
  current_health: 93,
  current_capacity: 97.6,
  current_degradation: 2.4,
  current_temp: 24.5,
  stress_level: 'Low',
};

const telemetryErrorVIN = {
  id: 1,
  vin: '5YJTESLASYNC0001',
  active: false,
  first_seen_at: '2026-06-01T00:00:00Z',
  last_seen_at: '2026-06-02T00:00:00Z',
  resolved_at: '2026-06-02T01:00:00Z',
};

const telemetryError = {
  id: 1,
  vin: '5YJTESLASYNC0001',
  error_code: 'Recovered',
  error_message: 'Telemetry payload recovered after retry.',
  reported_at: '2026-06-02T00:00:00Z',
  tesla_updated_at: null,
  fetched_at: '2026-06-02T00:01:00Z',
};

function query<T>(data: T): QueryState<T> {
  return {data, isLoading: false, isFetching: false, error: null};
}

function loadingQuery<T>(): QueryState<T> {
  return {data: undefined, isLoading: true, isFetching: true, error: null};
}

function failedQuery<T>(message: string): QueryState<T> {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: new Error(message),
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  mockUseVehicles.mockReturnValue(query([vehicle]));
  mockUseVehicleState.mockReturnValue(query(vehicleState));
  mockUseBatteryHealth.mockReturnValue(query(batteryHealth));
  mockUseAlerts.mockReturnValue(query([alert]));
  mockUseDrives.mockReturnValue(query([drive]));
  mockUseChargingSessions.mockReturnValue(query([chargingSession]));
  mockUseSystemStatus.mockReturnValue(query(systemStatus));
  mockUseSystemHealth.mockReturnValue(query(systemHealth));
  mockUseVehicleEnergy.mockReturnValue(query(vehicleEnergy));
  mockUseBatteryDegradationAnalytics.mockReturnValue(query(batteryDegradation));
  mockUseFleetTelemetryErrorVINs.mockReturnValue(query([telemetryErrorVIN]));
  mockUseFleetTelemetryErrors.mockReturnValue(query([telemetryError]));
});

function renderWithQueryClient(element: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });

  return ReactTestRenderer.create(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
}

test('native dashboard widget registry is typed with implemented parity statuses', () => {
  expect(IMPLEMENTED_NATIVE_WIDGETS.map(widget => widget.id)).toEqual([
    'vehicle-hero',
    'battery-health',
    'alert-feed',
    'quick-nav',
    'recent-drives',
    'charging-summary',
    'system-status',
    'battery-cells',
    'live-power-flow',
    'telemetry-errors',
    'vehicle-detail-widgets',
    'range-forecast-widgets',
    'drive-analytics-widgets',
    'charging-planning-widgets',
    'energy-site-widgets',
    'climate-security-media-widgets',
    'maps-location-widgets',
    'automation-admin-widgets',
    'fleet-analytics-widgets',
    'tire-safety-widgets',
  ]);
  expect(PENDING_NATIVE_WIDGETS).toHaveLength(0);
  expect(IMPLEMENTED_NATIVE_WIDGETS.length + PENDING_NATIVE_WIDGETS.length).toBe(
    NATIVE_WIDGET_REGISTRY.length,
  );

  for (const widget of NATIVE_WIDGET_REGISTRY) {
    expect(widget.webWidgetIds.length).toBeGreaterThan(0);
    expect(widget.status).toBe('implemented');
    if (widget.status !== 'implemented') {
      throw new Error(`Unexpected unresolved widget: ${widget.id}`);
    }
    expect(widget.component).toEqual(expect.any(Function));
  }

  expect(getNativeWidgetDefinition('battery-cells')?.status).toBe('implemented');
  expect(getNativeWidgetDefinition('maps-location-widgets')?.status).toBe('implemented');
});

test('renders all implemented native dashboard widgets with API-backed content', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = renderWithQueryClient(<DashboardScreen />);
  });

  const serialized = JSON.stringify(tree?.toJSON());

  expect(serialized).toContain('Native widget registry');
  expect(serialized).toContain('All web widget groups implemented');
  expect(serialized).toContain('Maps and location widgets');
  expect(serialized).toContain('Implemented parity');
  expect(serialized).toContain('Vehicle hero');
  expect(serialized).toContain('Roadrunner');
  expect(serialized).toContain('Battery and health');
  expect(serialized).toContain('Alert feed');
  expect(serialized).toContain('Charge interrupted');
  expect(serialized).toContain('Quick navigation');
  expect(serialized).toContain('Recent drives');
  expect(serialized).toContain('Charging summary');
  expect(serialized).toContain('System status');
  expect(serialized).toContain('Battery cells');
  expect(serialized).toContain('Live power flow');
  expect(serialized).toContain('Telemetry errors');
  expect(serialized).toContain('Cell heatmap');
  expect(serialized).toContain('Animated diagram');
  expect(serialized).toContain('Telemetry payload recovered after retry.');
});

test('keeps implemented widget shells visible while dashboard data is loading', async () => {
  mockUseVehicles.mockReturnValue(loadingQuery<Vehicle[]>());
  mockUseVehicleState.mockReturnValue(loadingQuery<VehicleStateResponse>());
  mockUseBatteryHealth.mockReturnValue(loadingQuery<BatteryHealth>());
  mockUseAlerts.mockReturnValue(loadingQuery<Alert[]>());
  mockUseDrives.mockReturnValue(loadingQuery<Drive[]>());
  mockUseChargingSessions.mockReturnValue(loadingQuery<ChargingSession[]>());
  mockUseSystemStatus.mockReturnValue(loadingQuery<SystemStatus>());
  mockUseSystemHealth.mockReturnValue(loadingQuery<SystemHealth>());
  mockUseVehicleEnergy.mockReturnValue(loadingQuery<typeof vehicleEnergy>());
  mockUseBatteryDegradationAnalytics.mockReturnValue(
    loadingQuery<typeof batteryDegradation>(),
  );
  mockUseFleetTelemetryErrorVINs.mockReturnValue(
    loadingQuery<Array<typeof telemetryErrorVIN>>(),
  );
  mockUseFleetTelemetryErrors.mockReturnValue(
    loadingQuery<Array<typeof telemetryError>>(),
  );

  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = renderWithQueryClient(<DashboardScreen />);
  });

  const serialized = JSON.stringify(tree?.toJSON());

  for (const widget of IMPLEMENTED_NATIVE_WIDGETS) {
    expect(serialized).toContain(widget.title);
  }

  expect(serialized).toContain('Loading vehicle');
  expect(serialized).toContain('Loading battery data');
  expect(serialized).toContain('Loading alerts');
  expect(serialized).toContain('Loading drives');
  expect(serialized).toContain('Loading charging');
  expect(serialized).toContain('Loading system status');
  expect(serialized).toContain('Loading battery cell context');
  expect(serialized).toContain('Loading power-flow context');
  expect(serialized).toContain('Loading telemetry errors');
});

test('renders widget empty and API error states instead of hiding dashboard regions', async () => {
  mockUseVehicles.mockReturnValue(failedQuery<Vehicle[]>('vehicles unavailable'));
  mockUseVehicleState.mockReturnValue(failedQuery<VehicleStateResponse>('state unavailable'));
  mockUseBatteryHealth.mockReturnValue(failedQuery<BatteryHealth>('battery unavailable'));
  mockUseAlerts.mockReturnValue(failedQuery<Alert[]>('alerts unavailable'));
  mockUseDrives.mockReturnValue(failedQuery<Drive[]>('drives unavailable'));
  mockUseChargingSessions.mockReturnValue(
    failedQuery<ChargingSession[]>('charging unavailable'),
  );
  mockUseSystemStatus.mockReturnValue(failedQuery<SystemStatus>('status unavailable'));
  mockUseSystemHealth.mockReturnValue(failedQuery<SystemHealth>('health unavailable'));
  mockUseVehicleEnergy.mockReturnValue(
    failedQuery<typeof vehicleEnergy>('energy unavailable'),
  );
  mockUseBatteryDegradationAnalytics.mockReturnValue(
    failedQuery<typeof batteryDegradation>('degradation unavailable'),
  );
  mockUseFleetTelemetryErrorVINs.mockReturnValue(
    failedQuery<Array<typeof telemetryErrorVIN>>('telemetry VINs unavailable'),
  );
  mockUseFleetTelemetryErrors.mockReturnValue(
    failedQuery<Array<typeof telemetryError>>('telemetry errors unavailable'),
  );

  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = renderWithQueryClient(<DashboardScreen />);
  });

  const serialized = JSON.stringify(tree?.toJSON());

  for (const widget of IMPLEMENTED_NATIVE_WIDGETS) {
    expect(serialized).toContain(widget.title);
  }

  expect(serialized).toContain('Vehicle API unavailable');
  expect(serialized).toContain('No battery vehicle');
  expect(serialized).toContain('Alert API unavailable');
  expect(serialized).toContain('Drive API unavailable');
  expect(serialized).toContain('Charging API unavailable');
  expect(serialized).toContain('System API unavailable');
  expect(serialized).toContain('No battery cell vehicle');
  expect(serialized).toContain('No power-flow vehicle');
  expect(serialized).toContain('Telemetry error APIs unavailable');
});
