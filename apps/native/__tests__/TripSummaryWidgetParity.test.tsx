import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useTrips} from '../src/web-parity/api/hooks/useTrips';
import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import {useDateFormat} from '../src/web-parity/hooks/useDateFormat';
import TripSummaryWidget from '../src/web-parity/features/dashboard/widgets/TripSummaryWidget';

jest.mock('../src/web-parity/api/hooks/useTrips', () => ({
  useTrips: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));
jest.mock('../src/web-parity/hooks/useDateFormat', () => ({
  useDateFormat: jest.fn(),
}));

const mockUseTrips = useTrips as unknown as jest.Mock;
const mockUseSettings = useSettings as unknown as jest.Mock;
const mockUseDateFormat = useDateFormat as unknown as jest.Mock;

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

function trip(
  id: number,
  name: string | null,
  distanceM: number,
  driveCount: number,
  chargeCount: number,
  startDate: string,
  endDate: string | null,
) {
  return {
    id,
    vehicle_id: 1,
    name,
    start_date: startDate,
    end_date: endDate,
    started_at: startDate,
    ended_at: endDate,
    total_distance_m: distanceM,
    total_energy_wh: 0,
    total_duration_s: 0,
    total_cost: 0,
    drive_count: driveCount,
    charge_count: chargeCount,
    created_at: startDate,
  };
}

function tripsStub() {
  return [
    // 24.4 km, 32 min, 3 drives, 1 charge stop — the "Last Trip".
    trip(
      101,
      'Morning Commute',
      24_400,
      3,
      1,
      '2026-06-23T18:00:00Z',
      '2026-06-23T18:32:00Z',
    ),
    // 2nd most-recent — first row of the "Recent Trips" list.
    trip(
      102,
      'Coffee Run',
      12_000,
      2,
      0,
      '2026-06-22T09:15:00Z',
      '2026-06-22T09:30:00Z',
    ),
    // 3rd most-recent — second row of the "Recent Trips" list.
    trip(
      103,
      'Grocery Trip',
      8_000,
      1,
      0,
      '2026-06-21T16:00:00Z',
      '2026-06-21T16:18:00Z',
    ),
  ];
}

function queryStub(overrides: Record<string, unknown> = {}) {
  return {
    data: tripsStub(),
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
  mockUseSettings.mockReturnValue({data: {unit_of_length: 'km'}});
  mockUseDateFormat.mockReturnValue({formatDateShort: () => 'Jun 23'});
  mockUseTrips.mockReturnValue(queryStub());
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

const WIDE = {cols: 4, rows: 3};
const COMPACT = {cols: 1, rows: 1};

test('renders a loading skeleton while the trips query is loading', async () => {
  mockUseTrips.mockReturnValue(
    queryStub({
      data: undefined,
      isLoading: true,
      isFetching: true,
      dataUpdatedAt: 0,
    }),
  );

  const tree = await render(<TripSummaryWidget size={WIDE} />);
  const raw = rawOf(tree);

  expect(raw).toContain('trip-summary-loading');
  expect(raw).not.toContain('trip-summary-widget');

  await unmount(tree);
});

test('renders the wide layout with the last-trip card, stats and recent list', async () => {
  const tree = await render(<TripSummaryWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('trip-summary-widget');
  expect(text).toContain('Trip Summary');

  // Last-trip card: badge, name, short date.
  expect(raw).toContain('trip-summary-last-trip');
  expect(text).toContain('Last Trip');
  expect(text).toContain('Morning Commute');
  expect(text).toContain('Jun 23');

  // Stat grid: distance in km, rounded-minute duration, drive + charge counts.
  expect(text).toContain('Distance');
  expect(text).toContain('24.4 km');
  expect(text).toContain('Duration');
  expect(text).toContain('32m');
  expect(text).toContain('Drives');
  expect(text).toContain('Charge Stops');

  // Recent list: heading + the 2nd/3rd trips with a "drv" badge.
  expect(text).toContain('Recent Trips');
  expect(raw).toContain('trip-summary-recent-102');
  expect(raw).toContain('trip-summary-recent-103');
  expect(text).toContain('Coffee Run');
  expect(text).toContain('Grocery Trip');
  expect(text).toContain('drv');

  // Freshness chip is wired.
  expect(raw).toContain('trip-summary-freshness');

  await unmount(tree);
});

test('shows only the distance in the compact (1x1) recent rows', async () => {
  const tree = await render(<TripSummaryWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('trip-summary-widget');
  expect(raw).toContain('trip-summary-recent-102');

  // Compact recent rows render the distance but drop the duration + "drv" badge.
  expect(text).toContain('Coffee Run');
  expect(text).not.toContain('drv');

  await unmount(tree);
});

test('renders distances in miles when the distance preference is miles', async () => {
  mockUseSettings.mockReturnValue({data: {unit_of_length: 'mi'}});

  const tree = await render(<TripSummaryWidget size={WIDE} />);
  const text = textOf(tree);

  // 24_400 m / 1609.344 = 15.2 mi.
  expect(text).toContain('15.2 mi');
  expect(text).not.toContain('24.4 km');

  await unmount(tree);
});

test('renders the empty state when there are no trips', async () => {
  mockUseTrips.mockReturnValue(queryStub({data: []}));

  const tree = await render(<TripSummaryWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('trip-summary-empty');
  expect(text).toContain('No trips recorded yet');
  expect(raw).not.toContain('trip-summary-last-trip');

  await unmount(tree);
});

test('hides the recent-trips list when there is only one trip', async () => {
  mockUseTrips.mockReturnValue(
    queryStub({
      data: [
        trip(
          201,
          'Solo Trip',
          5_000,
          1,
          0,
          '2026-06-20T12:00:00Z',
          '2026-06-20T12:20:00Z',
        ),
      ],
    }),
  );

  const tree = await render(<TripSummaryWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('trip-summary-last-trip');
  expect(text).toContain('Solo Trip');
  expect(text).not.toContain('Recent Trips');

  await unmount(tree);
});

test('reflects the error freshness state in the header chip', async () => {
  mockUseTrips.mockReturnValue(
    queryStub({data: [], isError: true, dataUpdatedAt: 0}),
  );

  const tree = await render(<TripSummaryWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('trip-summary-freshness-dot');
  expect(text).toContain('error');

  await unmount(tree);
});
