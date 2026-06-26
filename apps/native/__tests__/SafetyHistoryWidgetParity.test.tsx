import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import {useSafetyHistory} from '../src/web-parity/api/hooks/useVehicleSystems';
import SafetyHistoryWidget from '../src/web-parity/features/dashboard/widgets/SafetyHistoryWidget';

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
}));

jest.mock('../src/web-parity/api/hooks/useVehicleSystems', () => ({
  useSafetyHistory: jest.fn(),
}));

const mockUseVehicles = useVehicles as unknown as jest.Mock;
const mockUseSafetyHistory = useSafetyHistory as unknown as jest.Mock;

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

function snap(overrides: Record<string, unknown>) {
  return {
    id: 1,
    vehicle_id: 1,
    created_at: RECENT,
    ...overrides,
  };
}

const RECENT = new Date(Date.now() - 5 * 60_000).toISOString();
const OLDER = new Date(Date.now() - 90 * 60_000).toISOString();
const ANCIENT = new Date(Date.now() - 40 * 24 * 60 * 60_000).toISOString();

// snap1 -> AEB critical event; snap2 -> FCW warning with a full subtitle.
function historyStub() {
  return {
    data: [
      snap({id: 1, automatic_emergency_braking_off: true, created_at: RECENT}),
      snap({
        id: 2,
        forward_collision_warning: 'ForwardCollisionSensitivityMedium',
        speed_limit_warning: 'Chime',
        cruise_follow_distance: '3',
        pin_to_drive_enabled: true,
        created_at: OLDER,
      }),
    ],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  };
}

beforeEach(() => {
  mockUseVehicles.mockReturnValue({data: [{id: 1}]});
  mockUseSafetyHistory.mockReturnValue(historyStub());
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

async function unmount(tree: ReactTestRenderer.ReactTestRenderer): Promise<void> {
  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
}

const WIDE = {cols: 2, rows: 3};
const COMPACT = {cols: 1, rows: 2};

test('renders a loading skeleton while safety history is loading', async () => {
  mockUseSafetyHistory.mockReturnValue({
    data: undefined,
    isLoading: true,
    isFetching: true,
    isStale: false,
    isError: false,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  });

  const tree = await render(<SafetyHistoryWidget size={WIDE} />);
  const raw = rawOf(tree);

  expect(raw).toContain('safety-history-loading');
  expect(raw).not.toContain('safety-history-widget');

  await unmount(tree);
});

test('renders the wide layout with stat cards and the classified event feed', async () => {
  const tree = await render(<SafetyHistoryWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('safety-history-widget');
  expect(text).toContain('Safety History');

  // Stat cards.
  expect(raw).toContain('safety-history-stats');
  expect(text).toContain('Events (30d)');
  expect(text).toContain('Most Common');
  expect(text).toContain('Trend');
  // No prior-window events -> Stable trend sublabel.
  expect(text).toContain('Stable');

  // Event feed rows: classifySnapshot titles + cleanSafetyEnum prefix strip.
  expect(raw).toContain('safety-history-feed');
  expect(raw).toContain('safety-event-1');
  expect(raw).toContain('safety-event-2');
  expect(text).toContain('AEB Activation');
  expect(text).toContain('FCW: Medium');

  // buildSubtitle joins the present flags with " · ".
  expect(text).toContain('Speed Limit: Chime');
  expect(text).toContain('Follow: 3');
  expect(text).toContain('PIN to Drive');

  // Freshness chip is wired.
  expect(raw).toContain('safety-history-freshness');

  await unmount(tree);
});

test('renders the wide empty feed state when there is no history', async () => {
  mockUseSafetyHistory.mockReturnValue({
    data: [],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  });

  const tree = await render(<SafetyHistoryWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  // Stat row still renders (totals fall back to 0 / em-dash).
  expect(raw).toContain('safety-history-stats');
  expect(raw).toContain('safety-history-feed-empty');
  expect(text).toContain('No safety events recorded');

  await unmount(tree);
});

test('renders the compact layout with the 30-day total and most-common type', async () => {
  const tree = await render(<SafetyHistoryWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('safety-history-compact');
  expect(text).toContain('2 events (30d)');
  // Secondary line: most-common label.
  expect(text).toContain('AEB');

  await unmount(tree);
});

test('renders "No safety events" in compact view when all events are older than 30 days', async () => {
  mockUseSafetyHistory.mockReturnValue({
    data: [snap({id: 9, automatic_emergency_braking_off: true, created_at: ANCIENT})],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  });

  const tree = await render(<SafetyHistoryWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('safety-history-compact');
  expect(text).toContain('No safety events');

  await unmount(tree);
});

test('renders the compact empty state when there is no safety history', async () => {
  mockUseSafetyHistory.mockReturnValue({
    data: [],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  });

  const tree = await render(<SafetyHistoryWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('safety-history-empty');
  expect(raw).not.toContain('safety-history-compact');
  expect(text).toContain('No safety events recorded');

  await unmount(tree);
});

test('falls back to the first vehicle id when no vehicleId prop is supplied', async () => {
  const tree = await render(<SafetyHistoryWidget size={WIDE} />);

  expect(mockUseSafetyHistory).toHaveBeenCalledWith('1');

  await unmount(tree);
});

test('reflects the error freshness state in the header chip', async () => {
  mockUseSafetyHistory.mockReturnValue({
    data: [],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: true,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  });

  const tree = await render(<SafetyHistoryWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('safety-history-freshness-dot');
  expect(text).toContain('error');

  await unmount(tree);
});
