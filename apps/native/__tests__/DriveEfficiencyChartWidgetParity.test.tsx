import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {request} from '../src/web-parity/api/client';
import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import DriveEfficiencyChartWidget from '../src/web-parity/features/dashboard/widgets/DriveEfficiencyChartWidget';
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

// A single drive whose estimated efficiency (Wh/km) is energyWh / (distanceM/1000).
function drive(daysAgo: number, distanceM: number, energyWh: number) {
  return {
    id: daysAgo,
    vehicle_id: 1,
    start_ts: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    end_ts: null,
    duration_s: 1200,
    distance_m: distanceM,
    start_soc_pct: 80,
    end_soc_pct: 60,
    energy_used_wh: energyWh,
  };
}

// 8 distinct recent days: older half ~200 Wh/km, newer half ~150 Wh/km, which
// yields overallAvg 175, bestDay 150 and a -25% trend (km units).
function drivesStub() {
  return [
    drive(8, 10_000, 2000),
    drive(7, 10_000, 2000),
    drive(6, 10_000, 2000),
    drive(5, 10_000, 2000),
    drive(4, 10_000, 1500),
    drive(3, 10_000, 1500),
    drive(2, 10_000, 1500),
    drive(1, 10_000, 1500),
  ];
}

function queryStub(overrides: Record<string, unknown> = {}) {
  return {
    data: drivesStub(),
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

const WIDE = {cols: 4, rows: 3};
const STANDARD = {cols: 2, rows: 2};
const COMPACT = {cols: 1, rows: 1};

test('renders a loading skeleton while the drives query is loading', async () => {
  mockUseQuery.mockReturnValue(
    queryStub({data: undefined, isLoading: true, isFetching: true, dataUpdatedAt: 0}),
  );

  const tree = await render(<DriveEfficiencyChartWidget size={WIDE} />);
  const raw = rawOf(tree);

  expect(raw).toContain('drive-efficiency-chart-loading');
  expect(raw).not.toContain('drive-efficiency-chart-widget');

  await unmount(tree);
});

test('renders the wide layout with summary stats and the area chart', async () => {
  const tree = await render(<DriveEfficiencyChartWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('drive-efficiency-chart-widget');
  expect(text).toContain('Drive Efficiency');

  // Summary stats: Avg 175 / Best day 150 / Trend -25%, unit Wh/km.
  expect(raw).toContain('drive-efficiency-chart-stats');
  expect(text).toContain('Avg');
  expect(text).toContain('Best day');
  expect(text).toContain('Trend');
  expect(text).toContain('175');
  expect(text).toContain('150');
  expect(text).toContain('-25%');
  expect(text).toContain('Wh/km');

  // The chart is rendered in the non-compact layout.
  expect(raw).toContain('drive-efficiency-chart-plot');
  expect(raw).toContain('drive-efficiency-chart-area');

  // Both series labels are present in the chart legend.
  expect(text).toContain('Daily');
  expect(text).toContain('7-day avg');

  // Freshness chip is wired.
  expect(raw).toContain('drive-efficiency-chart-freshness');

  await unmount(tree);
});

test('renders the standard (2x2) layout with stats and chart', async () => {
  const tree = await render(<DriveEfficiencyChartWidget size={STANDARD} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('drive-efficiency-chart-widget');
  expect(raw).toContain('drive-efficiency-chart-stats');
  expect(raw).toContain('drive-efficiency-chart-plot');
  expect(text).toContain('Drive Efficiency');

  await unmount(tree);
});

test('renders Wh/mi units when the distance preference is miles', async () => {
  mockUseSettings.mockReturnValue({data: {unit_of_length: 'mi'}});

  const tree = await render(<DriveEfficiencyChartWidget size={WIDE} />);
  const text = textOf(tree);

  expect(text).toContain('Wh/mi');
  expect(text).not.toContain('Wh/km');

  await unmount(tree);
});

test('renders a positive trend with a + sign when efficiency worsens over time', async () => {
  // Reverse the efficiency progression: newer drives use more energy -> +trend.
  mockUseQuery.mockReturnValue(
    queryStub({
      data: [
        drive(8, 10_000, 1500),
        drive(7, 10_000, 1500),
        drive(6, 10_000, 1500),
        drive(5, 10_000, 1500),
        drive(4, 10_000, 2000),
        drive(3, 10_000, 2000),
        drive(2, 10_000, 2000),
        drive(1, 10_000, 2000),
      ],
    }),
  );

  const tree = await render(<DriveEfficiencyChartWidget size={WIDE} />);
  const text = textOf(tree);

  expect(text).toContain('+33.3%');

  await unmount(tree);
});

test('renders the compact layout with stats only and no chart or title', async () => {
  const tree = await render(<DriveEfficiencyChartWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('drive-efficiency-chart-widget');
  expect(raw).toContain('drive-efficiency-chart-stats');
  // Compact never renders the chart plot.
  expect(raw).not.toContain('drive-efficiency-chart-plot');
  // The compact shell is title-less, so the wide title is absent.
  expect(text).not.toContain('Drive Efficiency');
  // Stats still render.
  expect(text).toContain('Avg');

  await unmount(tree);
});

test('renders the empty state when no efficiency data can be derived', async () => {
  mockUseQuery.mockReturnValue(queryStub({data: []}));

  const tree = await render(<DriveEfficiencyChartWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('drive-efficiency-chart-empty');
  expect(raw).not.toContain('drive-efficiency-chart-plot');
  expect(text).toContain('No efficiency data yet');

  await unmount(tree);
});

test('surfaces the query error in the shell error box', async () => {
  mockUseQuery.mockReturnValue(
    queryStub({
      data: undefined,
      error: new Error('boom'),
      isError: true,
      dataUpdatedAt: 0,
    }),
  );

  const tree = await render(<DriveEfficiencyChartWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('drive-efficiency-chart-error');
  expect(text).toContain('boom');
  expect(raw).not.toContain('drive-efficiency-chart-stats');

  await unmount(tree);
});

test('builds the drives query against the first vehicle id with the limit=60 path', async () => {
  mockUseVehicles.mockReturnValue({data: [{id: 7}, {id: 9}]});

  const tree = await render(<DriveEfficiencyChartWidget size={WIDE} />);

  const cfg = mockUseQuery.mock.calls.at(-1)?.[0] as {
    queryKey: unknown[];
    queryFn: () => unknown;
    enabled: boolean;
    staleTime: number;
  };
  expect(cfg.queryKey).toEqual(['drives', 7, 'efficiency-chart-60']);
  expect(cfg.enabled).toBe(true);
  expect(cfg.staleTime).toBe(120_000);

  cfg.queryFn();
  expect(mockRequest).toHaveBeenCalledWith('/drives?vehicle_id=7&limit=60');

  await unmount(tree);
});

test('passes the explicit vehicleId prop into the drives query', async () => {
  const tree = await render(
    <DriveEfficiencyChartWidget vehicleId={42} size={WIDE} />,
  );

  const cfg = mockUseQuery.mock.calls.at(-1)?.[0] as {
    queryKey: unknown[];
    queryFn: () => unknown;
  };
  expect(cfg.queryKey).toEqual(['drives', 42, 'efficiency-chart-60']);

  cfg.queryFn();
  expect(mockRequest).toHaveBeenCalledWith('/drives?vehicle_id=42&limit=60');

  await unmount(tree);
});

test('disables the query when no vehicle id is available', async () => {
  mockUseVehicles.mockReturnValue({data: []});

  const tree = await render(<DriveEfficiencyChartWidget size={WIDE} />);

  const cfg = mockUseQuery.mock.calls.at(-1)?.[0] as {
    queryKey: unknown[];
    enabled: boolean;
  };
  expect(cfg.queryKey).toEqual(['drives', 0, 'efficiency-chart-60']);
  expect(cfg.enabled).toBe(false);

  await unmount(tree);
});
