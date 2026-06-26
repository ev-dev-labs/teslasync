import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {request} from '../src/web-parity/api/client';
import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import RecentDrivesListWidget from '../src/web-parity/features/dashboard/widgets/RecentDrivesListWidget';
import {useQuery} from '@tanstack/react-query';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
}));
jest.mock('../src/web-parity/api/client', () => ({
  request: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));

const mockUseQuery = useQuery as unknown as jest.Mock;
const mockRequest = request as unknown as jest.Mock;
const mockUseVehicles = useVehicles as unknown as jest.Mock;
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

function drive(
  id: number,
  distanceM: number,
  durationS: number,
  startSoc: number,
  endSoc: number | null,
  startAddress: string | null,
  endAddress: string | null,
  startTs: string,
) {
  return {
    id,
    vehicle_id: 1,
    start_ts: startTs,
    end_ts: null,
    duration_s: durationS,
    distance_m: distanceM,
    start_address: startAddress,
    end_address: endAddress,
    start_lat: null,
    start_lon: null,
    end_lat: null,
    end_lon: null,
    start_soc_pct: startSoc,
    end_soc_pct: endSoc,
    energy_used_wh: null,
    regen_energy_wh: null,
    avg_speed_mps: null,
    max_speed_mps: null,
    avg_power_w: null,
    outside_temp_avg_c: null,
    inside_temp_avg_c: null,
    score: null,
    ended_status: null,
    created_at: startTs,
    updated_at: startTs,
  };
}

function drivesStub() {
  return [
    // 24.4 km, 32 min, 82 -> 79 (3% used), distinctive addresses.
    drive(
      11,
      24_400,
      1920,
      82,
      79,
      '123 Test Origin Street',
      '456 Sample Destination Avenue',
      '2026-06-23T18:00:00Z',
    ),
    // 1.2 km, sub-minute (30s) drive -> '<1m'.
    drive(
      12,
      1200,
      30,
      55,
      54,
      'Pico Boulevard Garage',
      'Ocean Park Terminus',
      '2026-06-22T09:15:00Z',
    ),
  ];
}

function queryStub(overrides: Record<string, unknown> = {}) {
  return {
    data: drivesStub(),
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
  mockUseVehicles.mockReturnValue({data: [{id: 1}]});
  mockUseSettings.mockReturnValue({data: {unit_of_length: 'km'}});
  mockRequest.mockResolvedValue([]);
  mockUseQuery.mockReturnValue(queryStub());
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

function lastQueryKey(): unknown[] {
  const call = mockUseQuery.mock.calls[mockUseQuery.mock.calls.length - 1];
  return (call[0] as {queryKey: unknown[]}).queryKey;
}

const WIDE = {cols: 4, rows: 3};
const STANDARD = {cols: 2, rows: 2};
const COMPACT = {cols: 1, rows: 1};

test('renders a loading skeleton while the drives query is loading', async () => {
  mockUseQuery.mockReturnValue(
    queryStub({
      data: undefined,
      isLoading: true,
      isFetching: true,
      dataUpdatedAt: 0,
    }),
  );

  const tree = await render(<RecentDrivesListWidget size={WIDE} />);
  const raw = rawOf(tree);

  expect(raw).toContain('recent-drives-list-loading');
  expect(raw).not.toContain('recent-drives-list-widget');

  await unmount(tree);
});

test('renders the wide layout with drive rows, addresses and the view-all link', async () => {
  const tree = await render(<RecentDrivesListWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('recent-drives-list-widget');
  expect(text).toContain('Recent Drives');

  // Drive rows with their link destinations preserved.
  expect(raw).toContain('recent-drives-list-row-11');
  expect(raw).toContain('recent-drives-list-row-12');
  expect(raw).toContain('/drives/11');

  // Left column: distance in km + clock-cued duration ("32m").
  expect(text).toContain('24.4 km');
  expect(text).toContain('32m');

  // Centre column addresses appear only in the wide layout.
  expect(text).toContain('123 Test Origin Street');
  expect(text).toContain('456 Sample Destination Avenue');

  // Right column: start->end SoC, battery-used %, and the short date.
  expect(text).toContain('82% \u2192 79%');
  expect(text).toContain('3%');
  expect(text).toContain('Jun');

  // View-all link (destination preserved) + freshness chip are wired.
  expect(raw).toContain('recent-drives-list-view-all');
  expect(text).toContain('View all');
  expect(raw).toContain('/drives"'); // accessibilityValue.text === '/drives'
  expect(raw).toContain('recent-drives-list-freshness');

  // Wide footprint -> 10 recent drives.
  expect(lastQueryKey()).toEqual(['drives', 1, 'recent-list-10']);

  await unmount(tree);
});

test('renders a sub-minute drive duration as "<1m"', async () => {
  const tree = await render(<RecentDrivesListWidget size={WIDE} />);
  const text = textOf(tree);

  expect(text).toContain('<1m');

  await unmount(tree);
});

test('hides the address column in the standard (2x2) layout and limits to 7', async () => {
  const tree = await render(<RecentDrivesListWidget size={STANDARD} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('recent-drives-list-widget');
  expect(raw).toContain('recent-drives-list-row-11');

  // Addresses are wide-only.
  expect(text).not.toContain('123 Test Origin Street');
  expect(text).not.toContain('456 Sample Destination Avenue');

  // Battery + distance still render outside the wide layout.
  expect(text).toContain('24.4 km');
  expect(text).toContain('82% \u2192 79%');

  // Tall (>=2 rows) but not wide -> 7 recent drives.
  expect(lastQueryKey()).toEqual(['drives', 1, 'recent-list-7']);

  await unmount(tree);
});

test('limits to 5 recent drives in the compact (1x1) layout', async () => {
  const tree = await render(<RecentDrivesListWidget size={COMPACT} />);

  expect(lastQueryKey()).toEqual(['drives', 1, 'recent-list-5']);

  await unmount(tree);
});

test('renders distances in miles when the distance preference is miles', async () => {
  mockUseSettings.mockReturnValue({data: {unit_of_length: 'mi'}});

  const tree = await render(<RecentDrivesListWidget size={WIDE} />);
  const text = textOf(tree);

  // 24_400 m / 1609.344 = 15.2 mi.
  expect(text).toContain('15.2 mi');
  expect(text).not.toContain('24.4 km');

  await unmount(tree);
});

test('renders the empty state when there are no drives', async () => {
  mockUseQuery.mockReturnValue(queryStub({data: []}));

  const tree = await render(<RecentDrivesListWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('recent-drives-list-empty');
  expect(text).toContain('No recent drives recorded');
  expect(raw).not.toContain('recent-drives-list-row-11');

  await unmount(tree);
});

test('uses the explicit vehicleId prop in the query key over the vehicle fallback', async () => {
  const tree = await render(
    <RecentDrivesListWidget vehicleId={42} size={WIDE} />,
  );

  expect(lastQueryKey()).toEqual(['drives', 42, 'recent-list-10']);

  await unmount(tree);
});

test('reflects the error freshness state in the header chip', async () => {
  mockUseQuery.mockReturnValue(
    queryStub({data: [], isError: true, dataUpdatedAt: 0}),
  );

  const tree = await render(<RecentDrivesListWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('recent-drives-list-freshness-dot');
  expect(text).toContain('error');

  await unmount(tree);
});
