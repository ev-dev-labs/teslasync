import React from 'react';
import type { ReactNode } from 'react';
import { Linking } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import App from '../App';
import { routes } from '../src/navigation/routes';

type QueryState<T = unknown> = {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
};

type AuthUrlMutationOptions = {
  onSuccess?: (result: { auth_url: string }) => void;
  onError?: (error: Error) => void;
};

const mockUseVehicles = jest.fn();
const mockUseVehicle = jest.fn();
const mockUseVehicleState = jest.fn();
const mockUseTirePressureLatest = jest.fn();
const mockUseClimateLatest = jest.fn();
const mockUseSecurityLatest = jest.fn();
const mockUseSafetyLatest = jest.fn();
const mockUseMediaLatest = jest.fn();
const mockUseVehicleConfigLatest = jest.fn();
const mockUseSoftwareUpdates = jest.fn();
const mockUseMaintenanceItems = jest.fn();
const mockUseServiceRecords = jest.fn();
const mockUseAlerts = jest.fn();
const mockUseAlertRules = jest.fn();
const mockUseSystemStatus = jest.fn();
const mockUseSystemHealth = jest.fn();
const mockUseVersionInfo = jest.fn();
const mockUseDrives = jest.fn();
const mockUseDrive = jest.fn();
const mockUseDriveTelemetry = jest.fn();
const mockUseChargingSessions = jest.fn();
const mockUseChargingSession = jest.fn();
const mockUseChargeTelemetry = jest.fn();
const mockUseVehicleEnergy = jest.fn();
const mockUseBatteryHealth = jest.fn();
const mockUseFleetAnalytics = jest.fn();
const mockUseTCOAnalytics = jest.fn();
const mockUseSleepAnalytics = jest.fn();
const mockUseRegenAnalytics = jest.fn();
const mockUseBatteryDegradationAnalytics = jest.fn();
const mockUseSpeedProfile = jest.fn();
const mockUseTemperatureImpact = jest.fn();
const mockUseRouteEfficiency = jest.fn();
const mockUseFleetTelemetryCoverage = jest.fn();
const mockUseFleetTelemetryErrorVINs = jest.fn();
const mockUseFleetTelemetryErrors = jest.fn();
const mockUseSystemAudit = jest.fn();
const mockUseAvailableSignals = jest.fn();
const mockUseLiveSignals = jest.fn();
const mockUseAuthMode = jest.fn();
const mockUseAuthStatus = jest.fn();
const mockUseAuthURL = jest.fn();
const mockUseSessions = jest.fn();
const mockUseTOTPStatus = jest.fn();
const mockUseSettings = jest.fn();
const mockUseNotificationChannels = jest.fn();
const mockUseNotificationLogs = jest.fn();
const mockUseNotificationStats = jest.fn();
const mockUseQuietHours = jest.fn();
const mockAuthURLMutate = jest.fn(
  (_variables?: void, options?: AuthUrlMutationOptions) => {
    options?.onSuccess?.({
      auth_url: 'https://teslasync.example.test/auth/tesla',
    });
  },
);

const mockPlatformStatus = {
  os: 'windows',
  appState: 'active',
  lifecycleObservedAt: '2026-06-23T05:00:00.000Z',
  initialDeepLink: null,
  lastDeepLink: null,
  capabilities: [
    {
      id: 'deep-links',
      label: 'Deep links',
      state: 'configured',
      detail: 'teslasync:// URLs are parsed by the native route manifest.',
      evidence: 'Package.appxmanifest registers protocol activation.',
    },
    {
      id: 'push-registration',
      label: 'Push registration',
      state: 'unavailable',
      detail: 'Native push tokens are not wired in this parity slice.',
      evidence: 'No native registration module is claimed.',
    },
  ],
  launchActions: [
    {
      id: 'notifications-inbox',
      label: 'Notification inbox action',
      routeId: 'alerts',
      sourcePath: 'notifications/inbox',
      deepLinkURL: 'teslasync://notifications/inbox',
      state: 'unavailable',
      detail:
        'Notification inbox action is mapped to alerts but is not installed.',
      evidence: 'No jump-list bridge is claimed.',
    },
  ],
};

jest.mock('../src/api/hooks', () => ({
  useVehicles: (...args: unknown[]) => mockUseVehicles(...args),
  useVehicle: (...args: unknown[]) => mockUseVehicle(...args),
  useVehicleState: (...args: unknown[]) => mockUseVehicleState(...args),
  useTirePressureLatest: (...args: unknown[]) =>
    mockUseTirePressureLatest(...args),
  useClimateLatest: (...args: unknown[]) => mockUseClimateLatest(...args),
  useSecurityLatest: (...args: unknown[]) => mockUseSecurityLatest(...args),
  useSafetyLatest: (...args: unknown[]) => mockUseSafetyLatest(...args),
  useMediaLatest: (...args: unknown[]) => mockUseMediaLatest(...args),
  useVehicleConfigLatest: (...args: unknown[]) =>
    mockUseVehicleConfigLatest(...args),
  useSoftwareUpdates: (...args: unknown[]) => mockUseSoftwareUpdates(...args),
  useMaintenanceItems: (...args: unknown[]) => mockUseMaintenanceItems(...args),
  useServiceRecords: (...args: unknown[]) => mockUseServiceRecords(...args),
  useAlerts: (...args: unknown[]) => mockUseAlerts(...args),
  useAlertRules: (...args: unknown[]) => mockUseAlertRules(...args),
  useSystemStatus: (...args: unknown[]) => mockUseSystemStatus(...args),
  useSystemHealth: (...args: unknown[]) => mockUseSystemHealth(...args),
  useVersionInfo: (...args: unknown[]) => mockUseVersionInfo(...args),
  useDrives: (...args: unknown[]) => mockUseDrives(...args),
  useDrive: (...args: unknown[]) => mockUseDrive(...args),
  useDriveTelemetry: (...args: unknown[]) => mockUseDriveTelemetry(...args),
  useChargingSessions: (...args: unknown[]) => mockUseChargingSessions(...args),
  useChargingSession: (...args: unknown[]) => mockUseChargingSession(...args),
  useChargeTelemetry: (...args: unknown[]) => mockUseChargeTelemetry(...args),
  useVehicleEnergy: (...args: unknown[]) => mockUseVehicleEnergy(...args),
  useBatteryHealth: (...args: unknown[]) => mockUseBatteryHealth(...args),
  useFleetAnalytics: (...args: unknown[]) => mockUseFleetAnalytics(...args),
  useTCOAnalytics: (...args: unknown[]) => mockUseTCOAnalytics(...args),
  useSleepAnalytics: (...args: unknown[]) => mockUseSleepAnalytics(...args),
  useRegenAnalytics: (...args: unknown[]) => mockUseRegenAnalytics(...args),
  useBatteryDegradationAnalytics: (...args: unknown[]) =>
    mockUseBatteryDegradationAnalytics(...args),
  useSpeedProfile: (...args: unknown[]) => mockUseSpeedProfile(...args),
  useTemperatureImpact: (...args: unknown[]) =>
    mockUseTemperatureImpact(...args),
  useRouteEfficiency: (...args: unknown[]) => mockUseRouteEfficiency(...args),
  useFleetTelemetryCoverage: (...args: unknown[]) =>
    mockUseFleetTelemetryCoverage(...args),
  useFleetTelemetryErrorVINs: (...args: unknown[]) =>
    mockUseFleetTelemetryErrorVINs(...args),
  useFleetTelemetryErrors: (...args: unknown[]) =>
    mockUseFleetTelemetryErrors(...args),
  useSystemAudit: (...args: unknown[]) => mockUseSystemAudit(...args),
  useAvailableSignals: (...args: unknown[]) => mockUseAvailableSignals(...args),
  useLiveSignals: (...args: unknown[]) => mockUseLiveSignals(...args),
  useAuthMode: (...args: unknown[]) => mockUseAuthMode(...args),
  useAuthStatus: (...args: unknown[]) => mockUseAuthStatus(...args),
  useAuthURL: (...args: unknown[]) => mockUseAuthURL(...args),
  useSessions: (...args: unknown[]) => mockUseSessions(...args),
  useTOTPStatus: (...args: unknown[]) => mockUseTOTPStatus(...args),
  useSettings: (...args: unknown[]) => mockUseSettings(...args),
  useNotificationChannels: (...args: unknown[]) =>
    mockUseNotificationChannels(...args),
  useNotificationLogs: (...args: unknown[]) => mockUseNotificationLogs(...args),
  useNotificationStats: (...args: unknown[]) =>
    mockUseNotificationStats(...args),
  useQuietHours: (...args: unknown[]) => mockUseQuietHours(...args),
}));

jest.mock('../src/platform/status', () => {
  const actual = jest.requireActual('../src/platform/status');
  return {
    ...actual,
    usePlatformIntegrationStatus: () => mockPlatformStatus,
  };
});

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

function query<T>(data: T): QueryState<T> {
  return { data, isLoading: false, isFetching: false, error: null };
}

function failedQuery(message: string): QueryState {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: new Error(message),
  };
}

function emptyQuery(): QueryState {
  return query(undefined);
}

function serialize(tree: ReactTestRenderer.ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

function buttonByLabel(
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
): ReactTestRenderer.ReactTestInstance {
  const matches = tree.root.findAll(node => {
    const props = node.props as {
      accessibilityLabel?: string;
      accessibilityRole?: string;
      onPress?: () => void;
    };
    return (
      props.accessibilityRole === 'button' &&
      props.accessibilityLabel === label &&
      typeof props.onPress === 'function'
    );
  });

  expect(matches.length).toBeGreaterThan(0);
  return matches[0];
}

function pressButton(
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
): void {
  const button = buttonByLabel(tree, label);
  const { onPress } = button.props as { onPress: () => void };

  ReactTestRenderer.act(() => {
    onPress();
  });
}

async function renderApp(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });

  if (!tree) {
    throw new Error('Unable to render native app');
  }

  return tree;
}

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
  updated_at: '2026-06-23T05:00:00Z',
};

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

  mockUseVehicles.mockReturnValue(query([vehicle]));
  mockUseVehicle.mockReturnValue(query(vehicle));
  mockUseVehicleState.mockReturnValue(
    query({
      state: {
        vehicle_id: 42,
        state: 'online',
        battery_level: 78,
        speed_mps: 0,
        power_w: 0,
        is_charging: false,
        is_locked: true,
        latitude: 37.42,
        longitude: -122.08,
        software_version: '2026.20.1',
      },
    }),
  );
  mockUseTirePressureLatest.mockReturnValue(
    query({
      front_left: 295000,
      front_right: 296000,
      rear_left: 301000,
      rear_right: 300000,
    }),
  );
  mockUseClimateLatest.mockReturnValue(
    query({
      inside_temp: 21.5,
      outside_temp: 18.2,
      hvac_power: 'on',
      fan_speed: 3,
    }),
  );
  mockUseSecurityLatest.mockReturnValue(
    query({
      locked: true,
      sentry_mode: true,
      door_state: 'closed',
      fd_window: 'closed',
      fp_window: 'closed',
      rd_window: 'closed',
      rp_window: 'closed',
    }),
  );
  mockUseSafetyLatest.mockReturnValue(
    query({
      automatic_emergency_braking_off: false,
      automatic_blind_spot_camera: true,
      pin_to_drive_enabled: true,
    }),
  );
  mockUseMediaLatest.mockReturnValue(
    query({
      playback_status: 'playing',
      now_playing_title: 'Electric Feel',
      now_playing_artist: 'MGMT',
      playback_source: 'Bluetooth',
    }),
  );
  mockUseVehicleConfigLatest.mockReturnValue(
    query({
      car_type: 'Model Y',
      trim_badging: 'Performance',
      exterior_color: 'Pearl White',
      wheel_type: 'Uberturbine',
      software_version: '2026.20.1',
    }),
  );
  mockUseSoftwareUpdates.mockReturnValue(
    query([
      {
        id: 1,
        vehicle_id: 42,
        version: '2026.20.1',
        status: 'installed',
        installed_at: '2026-06-20T08:00:00Z',
        scheduled_at: null,
        created_at: '2026-06-20T08:00:00Z',
      },
    ]),
  );
  mockUseMaintenanceItems.mockReturnValue(
    query([
      {
        id: 1,
        vehicle_id: 42,
        category: 'tires',
        name: 'Tire Rotation',
        description: 'Rotate tires for even wear',
        due_date: null,
        due_mileage: 20000,
        current_mileage: 12500,
        last_service_date: null,
        last_service_mileage: null,
        interval_months: null,
        interval_miles: 10000,
        status: 'good',
        created_at: '2026-06-01T00:00:00Z',
      },
    ]),
  );
  mockUseServiceRecords.mockReturnValue(query([]));
  mockUseAlerts.mockReturnValue(query([]));
  mockUseAlertRules.mockReturnValue(query([]));
  mockUseSystemStatus.mockReturnValue(
    query({
      overall: 'healthy',
      status: 'healthy',
      healthy: true,
      database: { status: 'healthy' },
      mqtt: { status: 'healthy' },
      tesla_api: { status: 'healthy' },
      fleet_telemetry: { status: 'healthy' },
    }),
  );
  mockUseSystemHealth.mockReturnValue(
    query({
      status: 'healthy',
      healthy: true,
      components: {
        database: { status: 'healthy' },
        mqtt: { status: 'healthy' },
        tesla_api: { status: 'healthy' },
        fleet_telemetry: { status: 'healthy' },
      },
    }),
  );
  mockUseVersionInfo.mockReturnValue(
    query({
      version: '0.0.1',
      chart_version: '0.0.1',
      go_version: 'go1.25',
      os: 'windows',
      arch: 'amd64',
    }),
  );
  mockUseDrives.mockReturnValue(query([]));
  mockUseDrive.mockReturnValue(emptyQuery());
  mockUseDriveTelemetry.mockReturnValue(query([]));
  mockUseChargingSessions.mockReturnValue(query([]));
  mockUseChargingSession.mockReturnValue(emptyQuery());
  mockUseChargeTelemetry.mockReturnValue(query([]));
  mockUseVehicleEnergy.mockReturnValue(emptyQuery());
  mockUseBatteryHealth.mockReturnValue(
    query({
      health_score: 94,
      degradation_pct: 2.1,
      current_capacity_pct: 97.9,
      total_cycles: 88,
      estimated_range_current_km: 505,
      estimated_range_new_km: 516,
      monthly_trend: [],
    }),
  );
  mockUseFleetAnalytics.mockReturnValue(emptyQuery());
  mockUseTCOAnalytics.mockReturnValue(emptyQuery());
  mockUseSleepAnalytics.mockReturnValue(emptyQuery());
  mockUseRegenAnalytics.mockReturnValue(emptyQuery());
  mockUseBatteryDegradationAnalytics.mockReturnValue(emptyQuery());
  mockUseSpeedProfile.mockReturnValue(emptyQuery());
  mockUseTemperatureImpact.mockReturnValue(emptyQuery());
  mockUseRouteEfficiency.mockReturnValue(emptyQuery());
  mockUseFleetTelemetryCoverage.mockReturnValue(
    query({
      categories: [],
      destination_totals: {},
      orphan_fields: [],
    }),
  );
  mockUseFleetTelemetryErrorVINs.mockReturnValue(query([]));
  mockUseFleetTelemetryErrors.mockReturnValue(query([]));
  mockUseSystemAudit.mockReturnValue(query([]));
  mockUseAvailableSignals.mockReturnValue(
    query({ vehicle_id: 1, signals: [], count: 0 }),
  );
  mockUseLiveSignals.mockReturnValue(
    query({ vehicle_id: 1, signals: [], count: 0 }),
  );
  mockUseAuthMode.mockReturnValue(
    query({
      mode: 'forward_auth',
      subject_header: 'X-Forwarded-User',
      subject: 'alice@example.com',
      provider_hint: 'Authentik',
      capabilities: {
        step_up_reauth: true,
        totp_enrollment: true,
        session_list: true,
        impersonation: true,
        rbac: true,
      },
    }),
  );
  mockUseAuthStatus.mockReturnValue(
    query({ authenticated: true, expires_at: '2026-06-24T05:00:00Z' }),
  );
  mockUseAuthURL.mockReturnValue({
    isPending: false,
    mutate: mockAuthURLMutate,
  });
  mockUseSessions.mockReturnValue(
    query({
      mode: 'session',
      sessions: [
        {
          id: 'session-1',
          user_agent: 'TeslaSync Native',
          ip: '192.0.2.10',
          created_at: '2026-06-23T01:00:00Z',
          last_seen_at: '2026-06-23T02:00:00Z',
          current: true,
        },
      ],
    }),
  );
  mockUseTOTPStatus.mockReturnValue(
    query({
      mode: 'session',
      activated: true,
      backup_codes_remaining: 8,
      last_used_at: '2026-06-23T02:00:00Z',
    }),
  );
  mockUseSettings.mockReturnValue(
    query({
      unit_of_length: 'km',
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      theme: 'dark',
      language: 'en',
      locale: 'en-US',
      tz_display_default: 'vehicle',
      decimal_precision: 1,
      api_suspended: false,
      tab_badge_enabled: true,
    }),
  );
  mockUseNotificationChannels.mockReturnValue(
    query([{ id: 1, name: 'Email', type: 'email', enabled: true }]),
  );
  mockUseNotificationLogs.mockReturnValue(query([]));
  mockUseNotificationStats.mockReturnValue(
    query({ enabled_channels: 1, sent: 12, failed: 0, pending: 0 }),
  );
  mockUseQuietHours.mockReturnValue(query([]));
});

test('drives shell navigation through every native route button', async () => {
  const tree = await renderApp();

  for (const route of routes) {
    pressButton(tree, route.label);

    const rendered = serialize(tree);
    expect(rendered).toContain(route.label);
    expect(rendered).toContain(route.description);
    expect(rendered).toContain('Route parity evidence');
  }
});

test('renders auth state and opens the system auth handoff without embedding login UI', async () => {
  const tree = await renderApp();

  pressButton(tree, 'Auth');

  expect(serialize(tree)).toContain('ForwardAuth active');
  expect(serialize(tree)).toContain('alice@example.com');
  expect(serialize(tree)).toContain('Open Tesla auth');

  pressButton(tree, 'Open Tesla auth');

  expect(mockAuthURLMutate).toHaveBeenCalledTimes(1);
  expect(Linking.openURL).toHaveBeenCalledWith(
    'https://teslasync.example.test/auth/tesla',
  );
  expect(serialize(tree)).not.toContain('WebView');
});

test('keeps settings and API error states visible when native hooks fail', async () => {
  mockUseSettings.mockReturnValue(failedQuery('settings unavailable'));
  mockUseAuthStatus.mockReturnValue(failedQuery('auth unavailable'));
  mockUseNotificationStats.mockReturnValue(
    failedQuery('notifications unavailable'),
  );
  mockUseSystemStatus.mockReturnValue(failedQuery('system unavailable'));
  mockUseVersionInfo.mockReturnValue(failedQuery('version unavailable'));

  const tree = await renderApp();

  pressButton(tree, 'Settings');

  const rendered = serialize(tree);
  expect(rendered).toContain('Platform launch actions');
  expect(rendered).toContain('Notification inbox action');
  expect(rendered).toContain('teslasync://notifications/inbox');
  expect(rendered).toContain('Settings unavailable');
  expect(rendered).toContain('Native settings editing unavailable');
  expect(rendered).toContain('Auth state partially unavailable');
  expect(rendered).toContain('Notification settings unavailable');
  expect(rendered).toContain('System metadata unavailable');
  expect(rendered).toContain('http://localhost:8080/api/v1/vehicles');
});
