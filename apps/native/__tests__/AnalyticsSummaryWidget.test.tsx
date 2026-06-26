import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import AnalyticsSummaryWidget, {
  type WidgetSize,
} from '../src/web-parity/features/dashboard/widgets/AnalyticsSummaryWidget';

/**
 * Native parity contract for AnalyticsSummaryWidget.
 *
 * The web widget reads the fleet analytics summary and renders either a compact
 * AnimatedNumber distance count-up (cols <= 1) or a WidgetStatGrid of four stats
 * plus an optional Sparkline row (cols >= 4), converting SI distance/efficiency
 * to the user's distance unit at the display boundary, and shows an EmptyState
 * when there is no data. These tests assert that behaviour against the native
 * port by mocking the analytics + settings query hooks.
 */

const mockUseAnalyticsSummary = jest.fn();
const mockUseSettings = jest.fn();

jest.mock('../src/web-parity/api/hooks/useAnalytics', () => ({
  useAnalyticsSummary: (...args: unknown[]) => mockUseAnalyticsSummary(...args),
}));

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: (...args: unknown[]) => mockUseSettings(...args),
}));

type Tree = ReactTestRenderer.ReactTestRenderer;

interface AnalyticsSummary {
  totalDistanceKm: number;
  totalEnergyKwh: number;
  totalCost: number;
  avgEfficiencyWhKm: number;
  [key: string]: unknown;
}

const refetch = jest.fn();

function analyticsQuery(
  data: AnalyticsSummary | undefined,
  overrides: Record<string, unknown> = {},
) {
  return {
    data,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.UTC(2026, 5, 26, 12, 0, 0),
    refetch,
    ...overrides,
  };
}

const SUMMARY: AnalyticsSummary = {
  totalDistanceKm: 24.4,
  totalEnergyKwh: 5.1,
  totalCost: 4.72,
  avgEfficiencyWhKm: 209,
};

function setSettings(overrides: Record<string, unknown> = {}) {
  mockUseSettings.mockReturnValue({
    data: {
      unit_of_length: 'km',
      locale: 'en-US',
      decimal_precision: 2,
      currency_symbol: '$',
      ...overrides,
    },
  });
}

async function render(node: React.ReactElement): Promise<Tree> {
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

function json(tree: Tree): string {
  return JSON.stringify(tree.toJSON());
}

function hostsWithTestId(tree: Tree, testID: string) {
  return tree.root.findAll(
    n => n.props?.testID === testID && typeof n.type === 'string',
  );
}

const STANDARD: WidgetSize = {cols: 2, rows: 2};
const WIDE: WidgetSize = {cols: 4, rows: 2};
const COMPACT: WidgetSize = {cols: 1, rows: 2};

beforeEach(() => {
  jest.clearAllMocks();
  setSettings();
  mockUseAnalyticsSummary.mockReturnValue(analyticsQuery(SUMMARY));
});

test('standard layout renders the four-stat grid with the converted km values', async () => {
  const tree = await render(<AnalyticsSummaryWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('ANALYTICS SUMMARY');
  expect(hostsWithTestId(tree, 'widget-stat-grid').length).toBe(1);
  expect(serialized).toContain('Total Distance');
  expect(serialized).toContain('Avg Efficiency');
  expect(serialized).toContain('Energy Consumed');
  // 24.4 km -> '24' (0 decimals), efficiency 209 Wh/km, energy 5.1 kWh.
  expect(serialized).toContain('Wh/km');
  expect(serialized).toContain('kWh');
  // Cost / km = 4.72 / 24.4 -> $0.193 (3 decimals).
  expect(serialized).toContain('Cost / km');
  expect(serialized).toContain('$0.193');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows the EmptyState (and no stat grid) when there is no data', async () => {
  mockUseAnalyticsSummary.mockReturnValue(
    analyticsQuery({
      totalDistanceKm: 0,
      totalEnergyKwh: 0,
      totalCost: 0,
      avgEfficiencyWhKm: 0,
    }),
  );

  const tree = await render(<AnalyticsSummaryWidget size={STANDARD} />);

  expect(json(tree)).toContain('No analytics data');
  expect(hostsWithTestId(tree, 'widget-stat-grid').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('compact layout renders the animated distance number and caption (no title)', async () => {
  const tree = await render(<AnalyticsSummaryWidget size={COMPACT} />);

  const serialized = json(tree);
  expect(hostsWithTestId(tree, 'analytics-summary-distance').length).toBe(1);
  // Suffix is the user's distance unit; the caption repeats the label.
  expect(serialized).toContain(' km');
  expect(serialized).toContain('Total Distance');
  // Compact widgets are title-less.
  expect(serialized).not.toContain('ANALYTICS SUMMARY');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('keeps the shell visible with a Skeleton while loading', async () => {
  mockUseAnalyticsSummary.mockReturnValue(
    analyticsQuery(undefined, {isLoading: true, isFetching: true}),
  );

  const tree = await render(<AnalyticsSummaryWidget size={STANDARD} />);

  expect(hostsWithTestId(tree, 'skeleton').length).toBeGreaterThan(0);
  expect(hostsWithTestId(tree, 'widget-stat-grid').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('renders an inline error block instead of hiding the widget on error', async () => {
  mockUseAnalyticsSummary.mockReturnValue(
    analyticsQuery(undefined, {
      error: new Error('analytics unavailable'),
      isError: true,
    }),
  );

  const tree = await render(<AnalyticsSummaryWidget size={STANDARD} />);

  expect(hostsWithTestId(tree, 'widget-error').length).toBe(1);
  expect(json(tree)).toContain('analytics unavailable');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('wide layout renders the four-up sparkline row when trend arrays are present', async () => {
  mockUseAnalyticsSummary.mockReturnValue(
    analyticsQuery({
      ...SUMMARY,
      distanceTrend: [1, 2, 3, 4],
      efficiencyTrend: [4, 3, 2, 1],
      energyTrend: [2, 2, 3, 3],
      costTrend: [0.1, 0.2, 0.15, 0.18],
    }),
  );

  const tree = await render(<AnalyticsSummaryWidget size={WIDE} />);

  expect(hostsWithTestId(tree, 'analytics-summary-sparklines').length).toBe(1);
  expect(hostsWithTestId(tree, 'widget-stat-grid').length).toBe(1);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('does not render the sparkline row on wide layouts without trend data', async () => {
  const tree = await render(<AnalyticsSummaryWidget size={WIDE} />);

  expect(hostsWithTestId(tree, 'analytics-summary-sparklines').length).toBe(0);
  expect(hostsWithTestId(tree, 'widget-stat-grid').length).toBe(1);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('the freshness affordance triggers refetch on press', async () => {
  const tree = await render(<AnalyticsSummaryWidget size={STANDARD} />);

  const chip = tree.root.find(
    n =>
      n.props?.testID === 'widget-freshness' &&
      typeof n.props?.onPress === 'function',
  );
  await ReactTestRenderer.act(async () => {
    chip.props.onPress();
  });
  expect(refetch).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('honours the imperial distance preference (mi units + Wh/mi + Cost / mi)', async () => {
  setSettings({unit_of_length: 'mi'});

  const tree = await render(<AnalyticsSummaryWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('Wh/mi');
  expect(serialized).toContain('Cost / mi');
  // The Total Distance stat unit switches to 'mi'.
  expect(serialized).toContain('mi');

  await ReactTestRenderer.act(async () => tree.unmount());
});
