import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  useAcknowledgeAlert,
  useAlertDetail,
  useAlertRules,
  useAlerts,
  useMarkAlertRead,
  useReopenAlert,
} from '../src/web-parity/api/hooks/useNotifications';
import {usePinned, useTogglePin} from '../src/web-parity/api/hooks/usePinned';
import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import AlertsListPage from '../src/web-parity/features/notifications/pages/AlertsListPage';

jest.mock('../src/web-parity/api/hooks/useNotifications', () => ({
  useAlerts: jest.fn(),
  useMarkAlertRead: jest.fn(),
  useAlertRules: jest.fn(),
  useAcknowledgeAlert: jest.fn(),
  useReopenAlert: jest.fn(),
  useAlertDetail: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/usePinned', () => ({
  usePinned: jest.fn(),
  useTogglePin: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));

const mockUseAlerts = useAlerts as unknown as jest.Mock;
const mockUseMarkAlertRead = useMarkAlertRead as unknown as jest.Mock;
const mockUseAlertRules = useAlertRules as unknown as jest.Mock;
const mockUseAcknowledgeAlert = useAcknowledgeAlert as unknown as jest.Mock;
const mockUseReopenAlert = useReopenAlert as unknown as jest.Mock;
const mockUseAlertDetail = useAlertDetail as unknown as jest.Mock;
const mockUsePinned = usePinned as unknown as jest.Mock;
const mockUseTogglePin = useTogglePin as unknown as jest.Mock;
const mockUseSettings = useSettings as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

function flattenText(node: JsonNode): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join('');
  }
  return flattenText(node.children);
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function rawOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return JSON.stringify(tree?.toJSON());
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function alertStub(
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    vehicle_id: 1,
    type: 'low_battery',
    severity: 'info',
    title: `Alert ${id}`,
    message: `Message ${id}`,
    is_read: false,
    created_at: daysAgoIso(1),
    ...overrides,
  };
}

const ALERTS = [
  alertStub(1, {
    severity: 'critical',
    type: 'low_battery',
    title: 'Battery critically low',
    message: 'Charge the vehicle soon',
    is_read: false,
    created_at: daysAgoIso(0),
  }),
  alertStub(2, {
    severity: 'warning',
    type: 'tire_pressure_low',
    title: 'Tire pressure low',
    message: 'Front-left tire is low',
    is_read: false,
    created_at: daysAgoIso(1),
  }),
  alertStub(3, {
    severity: 'info',
    type: 'software_update',
    title: 'Software update available',
    message: 'New firmware is ready',
    is_read: true,
    created_at: daysAgoIso(2),
    acknowledged_at: daysAgoIso(1),
    acknowledged_by: 'atul',
  }),
];

beforeEach(() => {
  mockUseMarkAlertRead.mockReturnValue({mutate: jest.fn(), isPending: false});
  mockUseAcknowledgeAlert.mockReturnValue({mutate: jest.fn(), isPending: false});
  mockUseReopenAlert.mockReturnValue({mutate: jest.fn(), isPending: false});
  mockUseAlertDetail.mockReturnValue({data: undefined, isLoading: false});
  mockUseAlertRules.mockReturnValue({data: []});
  mockUsePinned.mockReturnValue({data: []});
  mockUseTogglePin.mockReturnValue({mutate: jest.fn()});
  mockUseSettings.mockReturnValue({data: undefined});
});

afterEach(() => {
  jest.clearAllMocks();
});

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<AlertsListPage />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

test('shows the loading skeleton while alerts are loading', async () => {
  mockUseAlerts.mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
  });

  const tree = await render();
  const raw = rawOf(tree);

  expect(textOf(tree)).toContain('Alerts');
  expect(raw).toContain('alerts-list-page');
  expect(raw).toContain('alerts-loading');
  expect(raw).not.toContain('alerts-list"');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the empty overview + list states when there are no alerts', async () => {
  mockUseAlerts.mockReturnValue({data: [], isLoading: false, error: null});

  const tree = await render();
  const text = textOf(tree);
  const raw = rawOf(tree);

  // No overview KPI card when there is neither current nor prior data.
  expect(raw).not.toContain('alerts-overview');
  expect(text).toContain('No alerts in this range. Your fleet is running smoothly.');
  expect(text).toContain('Your fleet is running smoothly. Alerts will appear here.');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders overview KPIs, charts, filters and the alert list for populated data', async () => {
  mockUseAlerts.mockReturnValue({
    data: ALERTS,
    isLoading: false,
    error: null,
  });

  const tree = await render();
  const text = textOf(tree);
  const raw = rawOf(tree);

  // Overview KPI tiles.
  expect(raw).toContain('alerts-overview');
  expect(text).toContain('Overview');
  expect(text).toContain('Total');
  expect(text).toContain('Critical');
  expect(text).toContain('Warnings');
  expect(text).toContain('Read rate');

  // Critical callout (one unread critical alert).
  expect(text).toContain('1 critical alert needs attention');

  // Charts.
  expect(text).toContain('Alert Trend (7 Days)');
  expect(text).toContain('Alerts by Type');

  // Filter tabs with counts + the list.
  expect(raw).toContain('alerts-tab-all');
  expect(raw).toContain('alerts-tab-unread');
  expect(raw).toContain('alerts-tab-critical');
  expect(raw).toContain('alerts-list');

  // Alert card content + acknowledged badge.
  expect(text).toContain('Battery critically low');
  expect(text).toContain('Tire pressure low');
  expect(text).toContain('Acknowledged by atul');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the Watching section when a rule is pinned', async () => {
  mockUseAlerts.mockReturnValue({
    data: ALERTS,
    isLoading: false,
    error: null,
  });
  mockUseAlertRules.mockReturnValue({
    data: [
      {
        id: 5,
        name: 'Low battery rule',
        enabled: true,
        signal_name: 'BatteryLevel',
        op: '<',
        severity: 'warn',
        cooldown_min: 10,
        trigger_mode: 'once',
        created_at: daysAgoIso(30),
        updated_at: daysAgoIso(1),
      },
    ],
  });
  mockUsePinned.mockReturnValue({
    data: [
      {
        id: 99,
        item_type: 'alert_rule',
        item_id: '5',
        position: 0,
        pinned_at: daysAgoIso(1),
      },
    ],
  });

  const tree = await render();
  const text = textOf(tree);

  expect(text).toContain('Watching');
  expect(text).toContain('Low battery rule');
  expect(text).toContain('Enabled');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
