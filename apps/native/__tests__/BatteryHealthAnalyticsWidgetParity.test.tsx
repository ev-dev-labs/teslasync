import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useBatteryHealthAnalytics} from '../src/web-parity/api/hooks/useEnergy';
import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import BatteryHealthAnalyticsWidget from '../src/web-parity/features/dashboard/widgets/BatteryHealthAnalyticsWidget';

jest.mock('../src/web-parity/api/hooks/useEnergy', () => ({
  useBatteryHealthAnalytics: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));

const mockUseBatteryHealthAnalytics =
  useBatteryHealthAnalytics as unknown as jest.Mock;
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

function analyticsStub() {
  return {
    data: {
      current_soh: 92,
      estimated_capacity: 70_000,
      original_capacity: 75_000,
      degradation_rate_yr: 1.5,
      battery_age_months: 24,
      total_cycles: 340,
      avg_depth_of_discharge: 62,
      fast_charge_pct: 18,
      full_charge_pct: 9,
      charge_habits_score: 88,
      temp_exposure_score: 74,
      history: [],
    },
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  };
}

beforeEach(() => {
  mockUseVehicles.mockReturnValue({data: [{id: 1}]});
  mockUseSettings.mockReturnValue({data: {unit_of_temp: 'C'}});
  mockUseBatteryHealthAnalytics.mockReturnValue(analyticsStub());
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
const COMPACT = {cols: 1, rows: 1};

test('renders a loading skeleton while the analytics query is loading', async () => {
  mockUseBatteryHealthAnalytics.mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
    isFetching: true,
    isStale: false,
    isError: false,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  });

  const tree = await render(<BatteryHealthAnalyticsWidget size={WIDE} />);
  const raw = rawOf(tree);

  expect(raw).toContain('battery-health-analytics-loading');
  expect(raw).not.toContain('battery-health-analytics-widget');

  await unmount(tree);
});

test('renders the wide layout with the score gauge and the six stats', async () => {
  const tree = await render(<BatteryHealthAnalyticsWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('battery-health-analytics-widget');
  expect(text).toContain('Battery Analytics');

  // Gauge hero is rendered with the SoH score (current_soh = 92).
  expect(raw).toContain('battery-health-analytics-gauge');
  expect(text).toContain('92');
  expect(text).toContain('health');

  // Six-stat grid: labels + formatted values.
  expect(text).toContain('Cycles');
  expect(text).toContain('340');
  expect(text).toContain('Charge Depth');
  expect(text).toContain('Discharge');
  expect(text).toContain('DC Fast');
  expect(text).toContain('Temp Score');
  expect(text).toContain('74');
  expect(text).toContain('Habits');
  expect(text).toContain('88');
  expect(text).toContain('/ 100');

  // Freshness chip is wired.
  expect(raw).toContain('battery-health-analytics-freshness');

  await unmount(tree);
});

test('renders the wide empty state when the analytics query has no data', async () => {
  mockUseBatteryHealthAnalytics.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  });

  const tree = await render(<BatteryHealthAnalyticsWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('battery-health-analytics-empty');
  expect(raw).not.toContain('battery-health-analytics-gauge');
  expect(text).toContain('No battery health data');

  await unmount(tree);
});

test('renders the compact layout with the centred score gauge', async () => {
  const tree = await render(<BatteryHealthAnalyticsWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('battery-health-analytics-widget');
  expect(raw).toContain('battery-health-analytics-gauge');
  expect(text).toContain('92');
  // The compact shell is title-less, so the wide title is absent.
  expect(text).not.toContain('Battery Analytics');
  // Compact never renders the stats grid labels.
  expect(text).not.toContain('Cycles');

  await unmount(tree);
});

test('renders the compact empty state when there is no analytics data', async () => {
  mockUseBatteryHealthAnalytics.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  });

  const tree = await render(<BatteryHealthAnalyticsWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('battery-health-analytics-empty');
  expect(raw).not.toContain('battery-health-analytics-gauge');
  expect(text).toContain('No battery health data');

  await unmount(tree);
});

test('surfaces the query error in the shell error box', async () => {
  mockUseBatteryHealthAnalytics.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: new Error('boom'),
    isFetching: false,
    isStale: false,
    isError: true,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  });

  const tree = await render(<BatteryHealthAnalyticsWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('battery-health-analytics-error');
  expect(text).toContain('boom');
  expect(raw).not.toContain('battery-health-analytics-gauge');

  await unmount(tree);
});

test('falls back to the first vehicle id when no vehicleId prop is supplied', async () => {
  mockUseVehicles.mockReturnValue({data: [{id: 7}, {id: 9}]});

  const tree = await render(<BatteryHealthAnalyticsWidget size={WIDE} />);

  expect(mockUseBatteryHealthAnalytics).toHaveBeenCalledWith('7');

  await unmount(tree);
});
