import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useSpeedProfile} from '../src/web-parity/api/hooks/useDriving';
import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import SpeedProfileWidget from '../src/web-parity/features/dashboard/widgets/SpeedProfileWidget';

jest.mock('../src/web-parity/api/hooks/useDriving', () => ({
  useSpeedProfile: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));

const mockUseSpeedProfile = useSpeedProfile as unknown as jest.Mock;
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

// A speed-profile payload whose distribution yields a clear peak bucket
// ('10-20', 300 readings -> 46.2%) and a sweet spot at the lowest-power bucket
// ('0-10', avg_power_kw 5). optimalSpeedMps 0 forces the findSweetSpot path.
function profileStub() {
  return {
    distribution: [
      {speed_bucket: '0-10', readings: 100, avg_power_kw: 5},
      {speed_bucket: '10-20', readings: 300, avg_power_kw: 8},
      {speed_bucket: '20-30', readings: 200, avg_power_kw: 12},
      {speed_bucket: '30+', readings: 50, avg_power_kw: 20},
    ],
    avgSpeedMps: 15,
    peakSpeedMps: 35,
    optimalSpeedMps: 0,
  };
}

function queryStub(overrides: Record<string, unknown> = {}) {
  return {
    data: profileStub(),
    isLoading: false,
    error: null,
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
  mockUseSpeedProfile.mockReturnValue(queryStub());
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
const STANDARD = {cols: 2, rows: 2};
const COMPACT = {cols: 1, rows: 1};

test('renders a loading skeleton while the speed-profile query is loading', async () => {
  mockUseSpeedProfile.mockReturnValue(
    queryStub({
      data: undefined,
      isLoading: true,
      isFetching: true,
      dataUpdatedAt: 0,
    }),
  );

  const tree = await render(<SpeedProfileWidget size={WIDE} />);
  const raw = rawOf(tree);

  expect(raw).toContain('speed-profile-loading');
  expect(raw).not.toContain('speed-profile-widget');

  await unmount(tree);
});

test('renders the wide layout with summary stats and the composed chart (km/h)', async () => {
  const tree = await render(<SpeedProfileWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('speed-profile-widget');
  expect(text).toContain('Speed Profile');

  // Summary stats: Most Common / Peak Freq / Sweet Spot.
  expect(raw).toContain('speed-profile-stats');
  expect(text).toContain('Most Common');
  expect(text).toContain('Peak Freq');
  expect(text).toContain('Sweet Spot');

  // Peak bucket is '10-20' SI -> '36-72' km/h; peak frequency is 46.2%.
  expect(text).toContain('36-72');
  expect(text).toContain('46.2%');
  // Sweet spot is the lowest-power bucket '0-10' SI -> '0-36' km/h.
  expect(text).toContain('0-36');
  expect(text).toContain('km/h');

  // The chart is rendered in the non-compact layout.
  expect(raw).toContain('speed-profile-plot');
  expect(raw).toContain('speed-profile-chart');

  // Both series labels are present in the chart legend.
  expect(text).toContain('Frequency');
  expect(text).toContain('Wh/mi');

  // Freshness chip is wired.
  expect(raw).toContain('speed-profile-freshness');

  await unmount(tree);
});

test('renders the standard (2x2) layout with stats and chart', async () => {
  const tree = await render(<SpeedProfileWidget size={STANDARD} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('speed-profile-widget');
  expect(raw).toContain('speed-profile-stats');
  expect(raw).toContain('speed-profile-plot');
  expect(text).toContain('Speed Profile');

  await unmount(tree);
});

test('renders mph buckets and unit when the distance preference is miles', async () => {
  mockUseSettings.mockReturnValue({data: {unit_of_length: 'mi'}});

  const tree = await render(<SpeedProfileWidget size={WIDE} />);
  const text = textOf(tree);

  expect(text).toContain('mph');
  expect(text).not.toContain('km/h');
  // '10-20' SI m/s -> '22-45' mph.
  expect(text).toContain('22-45');

  await unmount(tree);
});

test('prefers the API optimal speed for the sweet spot when provided', async () => {
  mockUseSpeedProfile.mockReturnValue(
    queryStub({data: {...profileStub(), optimalSpeedMps: 25}}),
  );

  const tree = await render(<SpeedProfileWidget size={WIDE} />);
  const text = textOf(tree);

  // optimalSpeedMps 25 m/s -> 90 km/h, rendered as the Sweet Spot value.
  expect(text).toContain('Sweet Spot');
  expect(text).toContain('90');

  await unmount(tree);
});

test('renders the compact layout with stats only and no chart or title', async () => {
  const tree = await render(<SpeedProfileWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('speed-profile-widget');
  expect(raw).toContain('speed-profile-stats');
  // Compact never renders the chart plot.
  expect(raw).not.toContain('speed-profile-plot');
  // The compact shell is title-less, so the standard title is absent.
  expect(text).not.toContain('Speed Profile');
  // Compact stats drop Peak Freq but keep Most Common + Sweet Spot.
  expect(text).toContain('Most Common');
  expect(text).toContain('Sweet Spot');
  expect(text).not.toContain('Peak Freq');

  await unmount(tree);
});

test('renders the empty state when no speed data is available', async () => {
  mockUseSpeedProfile.mockReturnValue(
    queryStub({
      data: {distribution: [], avgSpeedMps: 0, peakSpeedMps: 0, optimalSpeedMps: 0},
    }),
  );

  const tree = await render(<SpeedProfileWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('speed-profile-empty');
  expect(raw).not.toContain('speed-profile-plot');
  expect(text).toContain('No speed data');

  await unmount(tree);
});

test('surfaces the query error in the shell error box', async () => {
  mockUseSpeedProfile.mockReturnValue(
    queryStub({
      data: undefined,
      error: new Error('boom'),
      isError: true,
      dataUpdatedAt: 0,
    }),
  );

  const tree = await render(<SpeedProfileWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('speed-profile-error');
  expect(text).toContain('boom');
  expect(raw).not.toContain('speed-profile-stats');

  await unmount(tree);
});

test('queries the speed profile for the first vehicle id as a string', async () => {
  mockUseVehicles.mockReturnValue({data: [{id: 7}, {id: 9}]});

  const tree = await render(<SpeedProfileWidget size={WIDE} />);

  expect(mockUseSpeedProfile.mock.calls.at(-1)?.[0]).toBe('7');

  await unmount(tree);
});

test('passes the explicit vehicleId prop into the speed-profile query', async () => {
  const tree = await render(<SpeedProfileWidget vehicleId={42} size={WIDE} />);

  expect(mockUseSpeedProfile.mock.calls.at(-1)?.[0]).toBe('42');

  await unmount(tree);
});

test('passes undefined to the query when no vehicle id is available', async () => {
  mockUseVehicles.mockReturnValue({data: []});

  const tree = await render(<SpeedProfileWidget size={WIDE} />);

  expect(mockUseSpeedProfile.mock.calls.at(-1)?.[0]).toBeUndefined();

  await unmount(tree);
});
