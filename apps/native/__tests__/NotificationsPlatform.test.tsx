import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { AlertsScreen } from '../src/screens/AlertsScreen';

const mockUseAlerts = jest.fn();
const mockUseAlertRules = jest.fn();
const mockUseNotificationChannels = jest.fn();
const mockUseNotificationLogs = jest.fn();
const mockUseNotificationStats = jest.fn();
const mockUseQuietHours = jest.fn();

jest.mock('../src/api/hooks', () => ({
  useAlerts: () => mockUseAlerts(),
  useAlertRules: () => mockUseAlertRules(),
  useNotificationChannels: () => mockUseNotificationChannels(),
  useNotificationLogs: (filters?: unknown) => mockUseNotificationLogs(filters),
  useNotificationStats: () => mockUseNotificationStats(),
  useQuietHours: () => mockUseQuietHours(),
}));

function query<T>(data: T) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    error: null,
  };
}

function renderAlertsScreen(): string {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<AlertsScreen />);
  });

  return JSON.stringify(tree?.toJSON());
}

beforeEach(() => {
  mockUseAlerts.mockReturnValue(
    query([
      {
        id: 5,
        vehicle_id: 42,
        severity: 'critical',
        title: 'Charge interrupted',
        message: 'Wall connector reported an interrupted charge.',
        is_read: false,
        created_at: '2026-06-23T20:00:00Z',
      },
    ]),
  );
  mockUseNotificationLogs.mockReturnValue(
    query([
      {
        id: 21,
        channel_id: 3,
        alert_id: 5,
        title: 'Charging stopped',
        message: 'Charging session ended unexpectedly.',
        status: 'failed',
        severity: 'critical',
        error: 'webhook returned 500',
        created_at: '2026-06-23T20:01:00Z',
        sent_at: null,
        read_at: null,
        archived_at: null,
      },
    ]),
  );
  mockUseAlertRules.mockReturnValue(
    query([
      {
        id: 9,
        name: 'Battery alert rule',
        description: 'Warn when state of charge is low.',
        enabled: true,
        all_vehicles: true,
        vehicle_ids: [],
        signal_name: 'BatteryLevel',
        op: '<',
        value_num: 20,
        severity: 'warn',
        cooldown_min: 30,
        trigger_mode: 'repeat',
        kind: 'signal',
        include_title: true,
        created_at: '2026-06-20T00:00:00Z',
        updated_at: '2026-06-21T00:00:00Z',
      },
    ]),
  );
  mockUseNotificationChannels.mockReturnValue(
    query([
      {
        id: 3,
        name: 'Ops Webhook',
        type: 'webhook',
        config: { method: 'POST', url: 'configured' },
        enabled: true,
        created_at: '2026-06-19T00:00:00Z',
        updated_at: '2026-06-22T00:00:00Z',
      },
    ]),
  );
  mockUseNotificationStats.mockReturnValue(
    query({
      total_sent: 12,
      sent: 10,
      failed: 1,
      pending: 1,
      total_channels: 1,
      enabled_channels: 1,
    }),
  );
  mockUseQuietHours.mockReturnValue(
    query([
      {
        id: 4,
        user_id: 'native-test',
        enabled: true,
        start_local: '22:00',
        end_local: '06:00',
        timezone: 'America/Los_Angeles',
        weekdays: 127,
        bypass_severities: ['critical'],
        created_at: '2026-06-18T00:00:00Z',
        updated_at: '2026-06-18T00:00:00Z',
      },
    ]),
  );
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders native notification inbox, rules, channels, quiet hours, and unavailable push state', () => {
  const serialized = renderAlertsScreen();

  expect(mockUseNotificationLogs).toHaveBeenCalledWith({
    archived: false,
    limit: 10,
  });
  expect(serialized).toContain('Native notification platform');
  expect(serialized).toContain('Charging stopped');
  expect(serialized).toContain('webhook returned 500');
  expect(serialized).toContain('Battery alert rule');
  expect(serialized).toContain('Ops Webhook');
  expect(serialized).toContain('22:00 - 06:00');
  expect(serialized).toContain('Charge interrupted');
  expect(serialized).toContain('Native rule editing unavailable');
  expect(serialized).toContain('Push token registration unavailable');
});

test('renders explicit unavailable states when notification endpoints fail', () => {
  mockUseNotificationLogs.mockReturnValue({
    ...query([]),
    error: new Error('logs failed'),
  });
  mockUseAlertRules.mockReturnValue({
    ...query([]),
    error: new Error('rules failed'),
  });
  mockUseNotificationChannels.mockReturnValue({
    ...query([]),
    error: new Error('channels failed'),
  });
  mockUseQuietHours.mockReturnValue({
    ...query([]),
    error: new Error('quiet failed'),
  });

  const serialized = renderAlertsScreen();

  expect(serialized).toContain('Notification inbox unavailable');
  expect(serialized).toContain('Alert rules unavailable');
  expect(serialized).toContain('Notification channels unavailable');
  expect(serialized).toContain('Quiet-hours windows unavailable');
  expect(serialized).toContain('no delivery success is assumed');
});
