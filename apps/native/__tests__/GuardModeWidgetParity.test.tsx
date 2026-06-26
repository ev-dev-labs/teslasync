import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  useGuardConfig,
  useGuardEvents,
} from '../src/web-parity/api/hooks/useGuard';
import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import GuardModeWidget from '../src/web-parity/features/dashboard/widgets/GuardModeWidget';

jest.mock('../src/web-parity/api/hooks/useGuard', () => ({
  useGuardConfig: jest.fn(),
  useGuardEvents: jest.fn(),
  // The real acknowledged-state helper is preserved (acknowledged_at != null).
  isGuardEventAcknowledged: (ev: {acknowledged_at: string | null}) =>
    ev.acknowledged_at != null,
}));

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
}));

const mockUseGuardConfig = useGuardConfig as unknown as jest.Mock;
const mockUseGuardEvents = useGuardEvents as unknown as jest.Mock;
const mockUseVehicles = useVehicles as unknown as jest.Mock;

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

const RECENT = new Date(Date.now() - 5 * 60_000).toISOString();
const OLDER = new Date(Date.now() - 90 * 60_000).toISOString();

function guardEvent(
  id: number,
  eventType: string,
  ts: string,
  acknowledgedAt: string | null,
) {
  return {
    id,
    vehicle_id: 1,
    ts,
    event_type: eventType,
    from_state: null,
    to_state: null,
    details: null,
    acknowledged_at: acknowledgedAt,
    acknowledged_by: acknowledgedAt ? 'tester' : null,
  };
}

function configStub(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      vehicle_id: 1,
      enabled: true,
      home_geofence_id: null,
      sensitivity: 'high',
      auto_panic: true,
      created_at: RECENT,
      updated_at: RECENT,
    },
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
    ...overrides,
  };
}

function eventsStub(overrides: Record<string, unknown> = {}) {
  return {
    data: [
      guardEvent(1, 'vehicle_moved', RECENT, null),
      guardEvent(2, 'unauthorized_unlock', OLDER, OLDER),
    ],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mockUseVehicles.mockReturnValue({data: [{id: 7}]});
  mockUseGuardConfig.mockReturnValue(configStub());
  mockUseGuardEvents.mockReturnValue(eventsStub());
});

afterEach(() => {
  jest.clearAllMocks();
});

async function render(
  element: React.ReactElement,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(element);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

async function unmount(
  tree: ReactTestRenderer.ReactTestRenderer,
): Promise<void> {
  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
}

const WIDE = {cols: 2, rows: 3};
const COMPACT = {cols: 1, rows: 1};

test('renders a loading skeleton while guard data is loading', async () => {
  mockUseGuardConfig.mockReturnValue(
    configStub({data: undefined, isLoading: true, isFetching: true, dataUpdatedAt: 0}),
  );
  mockUseGuardEvents.mockReturnValue(
    eventsStub({data: undefined, isLoading: true, isFetching: true, dataUpdatedAt: 0}),
  );

  const tree = await render(<GuardModeWidget size={WIDE} />);
  const raw = rawOf(tree);

  expect(raw).toContain('guard-mode-loading');
  expect(raw).not.toContain('guard-mode-widget');

  await unmount(tree);
});

test('renders the standard layout with status card and the guard event feed', async () => {
  const tree = await render(<GuardModeWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('guard-mode-widget');
  expect(text).toContain('Guard Mode');

  // Status card: armed shield + Armed label + ON badge + sensitivity subtitle.
  expect(raw).toContain('guard-mode-standard');
  expect(raw).toContain('guard-mode-onoff-badge');
  expect(text).toContain('Armed');
  expect(text).toContain('ON');
  expect(text).toContain('Sensitivity: high \u00b7 Auto-panic');

  // Event feed rows: mapped titles + acknowledged/unacknowledged subtitles.
  expect(raw).toContain('guard-mode-feed');
  expect(text).toContain('Vehicle Moved');
  expect(text).toContain('Unacknowledged');
  expect(text).toContain('Unauthorized Unlock');
  expect(text).toContain('Acknowledged');

  // Freshness chip is wired.
  expect(raw).toContain('guard-mode-freshness');

  await unmount(tree);
});

test('renders the disarmed status card without the auto-panic suffix', async () => {
  mockUseGuardConfig.mockReturnValue(
    configStub({
      data: {
        vehicle_id: 1,
        enabled: false,
        home_geofence_id: null,
        sensitivity: 'low',
        auto_panic: false,
        created_at: RECENT,
        updated_at: RECENT,
      },
    }),
  );

  const tree = await render(<GuardModeWidget size={WIDE} />);
  const text = textOf(tree);

  expect(text).toContain('Disarmed');
  expect(text).toContain('OFF');
  expect(text).toContain('Sensitivity: low');
  expect(text).not.toContain('Auto-panic');

  await unmount(tree);
});

test('renders the standard empty feed state when there are no guard events', async () => {
  mockUseGuardEvents.mockReturnValue(eventsStub({data: []}));

  const tree = await render(<GuardModeWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('guard-mode-feed-empty');
  expect(text).toContain('No guard events');

  await unmount(tree);
});

test('renders the compact layout with the armed badge and event count', async () => {
  const tree = await render(<GuardModeWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('guard-mode-compact');
  expect(raw).toContain('guard-mode-armed-badge');
  expect(raw).toContain('guard-mode-events-badge');
  expect(text).toContain('Armed');
  expect(text).toContain('2 events');
  // Standard-only structures are absent in the compact layout.
  expect(raw).not.toContain('guard-mode-standard');

  await unmount(tree);
});

test('renders the no-guard-data empty state when the config is missing', async () => {
  mockUseGuardConfig.mockReturnValue(configStub({data: undefined}));
  mockUseGuardEvents.mockReturnValue(eventsStub({data: []}));

  const tree = await render(<GuardModeWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('guard-mode-empty');
  expect(raw).not.toContain('guard-mode-standard');
  expect(text).toContain('No guard data');

  await unmount(tree);
});

test('reflects the error freshness state in the header chip', async () => {
  mockUseGuardConfig.mockReturnValue(
    configStub({data: undefined, isError: true, dataUpdatedAt: 0}),
  );
  mockUseGuardEvents.mockReturnValue(
    eventsStub({data: [], isError: true, dataUpdatedAt: 0}),
  );

  const tree = await render(<GuardModeWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('guard-mode-freshness-dot');
  expect(text).toContain('error');

  await unmount(tree);
});

test('falls back to the first vehicle id when no vehicleId prop is supplied', async () => {
  mockUseVehicles.mockReturnValue({data: [{id: 7}, {id: 9}]});

  const tree = await render(<GuardModeWidget size={WIDE} />);

  expect(mockUseGuardConfig).toHaveBeenCalledWith(7);
  expect(mockUseGuardEvents).toHaveBeenCalledWith(7);

  await unmount(tree);
});

test('passes the explicit vehicleId prop through to the guard hooks', async () => {
  const tree = await render(<GuardModeWidget vehicleId={42} size={WIDE} />);

  expect(mockUseGuardConfig).toHaveBeenCalledWith(42);
  expect(mockUseGuardEvents).toHaveBeenCalledWith(42);

  await unmount(tree);
});
