import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import ProjectedRangeWidget, {
  type WidgetSize,
} from '../src/web-parity/features/dashboard/widgets/ProjectedRangeWidget';

/**
 * Native parity contract for ProjectedRangeWidget.
 *
 * The web widget reads the battery projected-range summary and renders a compact
 * WidgetBigNumber (cols <= 1), a standard range + Projected-vs-EPA ComparisonBar
 * + health badge (cols 2), or a wide layout that additionally shows a scrollable
 * "Range Factors" list (cols >= 3); it converts SI-floored km to the user's
 * distance unit at the display boundary and shows an EmptyState when there is no
 * data. These tests assert that behaviour against the native port by mocking the
 * projected-range, vehicles, and settings query hooks. Note: the source never
 * passes `error` to WidgetShell, so an errored query (data undefined, retry off)
 * surfaces as the EmptyState plus an "Error" freshness dot — not an inline block.
 */

const mockUseProjectedRange = jest.fn();
const mockUseVehicles = jest.fn();
const mockUseSettings = jest.fn();

jest.mock('../src/web-parity/api/hooks/useEnergy', () => ({
  useProjectedRange: (...args: unknown[]) => mockUseProjectedRange(...args),
}));

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: (...args: unknown[]) => mockUseVehicles(...args),
}));

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: (...args: unknown[]) => mockUseSettings(...args),
}));

type Tree = ReactTestRenderer.ReactTestRenderer;

interface ProjectedRange {
  current_range_km: number;
  new_range_km: number;
  degradation_pct: number;
  total_cycles: number;
  health_score: number;
  current_capacity_pct: number;
  avg_daily_km: number;
}

const refetch = jest.fn();

function rangeQuery(
  data: ProjectedRange | undefined,
  overrides: Record<string, unknown> = {},
) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.UTC(2026, 5, 26, 12, 0, 0),
    refetch,
    ...overrides,
  };
}

const DATA: ProjectedRange = {
  current_range_km: 380,
  new_range_km: 405,
  degradation_pct: 6.2,
  total_cycles: 312,
  health_score: 88,
  current_capacity_pct: 93.8,
  avg_daily_km: 52,
};

function setSettings(overrides: Record<string, unknown> = {}) {
  mockUseSettings.mockReturnValue({
    data: {
      unit_of_length: 'km',
      locale: 'en-US',
      decimal_precision: 2,
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

const COMPACT: WidgetSize = {cols: 1, rows: 2};
const STANDARD: WidgetSize = {cols: 2, rows: 2};
const WIDE: WidgetSize = {cols: 4, rows: 2};

beforeEach(() => {
  jest.clearAllMocks();
  setSettings();
  mockUseVehicles.mockReturnValue({data: [{id: 7}]});
  mockUseProjectedRange.mockReturnValue(rangeQuery(DATA));
});

test('standard layout renders the comparison bar + health badge, no factors', async () => {
  const tree = await render(<ProjectedRangeWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('PROJECTED RANGE');
  expect(hostsWithTestId(tree, 'projected-range-value').length).toBe(1);
  expect(hostsWithTestId(tree, 'projected-range-comparison').length).toBe(1);
  // health_score 88 -> "Good" tier; standard badge appends the score.
  expect(serialized).toContain('Good · 88%');
  // EPA = new_range_km 405 km; ratio 380/405 -> 94% of EPA rated.
  expect(serialized).toContain('EPA: 405 km');
  expect(serialized).toContain('94% of EPA rated');
  // Standard layout has no Range Factors list.
  expect(hostsWithTestId(tree, 'projected-range-factors').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('wide layout additionally renders the Range Factors list', async () => {
  const tree = await render(<ProjectedRangeWidget size={WIDE} />);

  const serialized = json(tree);
  expect(hostsWithTestId(tree, 'projected-range-factors').length).toBe(1);
  expect(hostsWithTestId(tree, 'projected-range-comparison').length).toBe(1);
  expect(serialized).toContain('Range Factors');
  expect(serialized).toContain('Battery Degradation');
  expect(serialized).toContain('6.2%');
  expect(serialized).toContain('Avg Daily Usage');
  expect(serialized).toContain('52 km');
  expect(serialized).toContain('Current Capacity');
  expect(serialized).toContain('93.8%');
  expect(serialized).toContain('Battery Cycles');
  expect(serialized).toContain('312');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('compact layout renders the big number + badge with no title or comparison', async () => {
  const tree = await render(<ProjectedRangeWidget size={COMPACT} />);

  const serialized = json(tree);
  expect(hostsWithTestId(tree, 'projected-range-value').length).toBe(1);
  expect(serialized).toContain('Projected');
  expect(serialized).toContain('km');
  // Compact badge is the tier text only (no score suffix).
  expect(serialized).toContain('Good');
  expect(serialized).not.toContain('Good · 88%');
  // Compact widgets are title-less and have no comparison bar.
  expect(serialized).not.toContain('PROJECTED RANGE');
  expect(hostsWithTestId(tree, 'projected-range-comparison').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows the EmptyState (and no comparison bar) when there is no data', async () => {
  mockUseProjectedRange.mockReturnValue(rangeQuery(undefined));

  const tree = await render(<ProjectedRangeWidget size={STANDARD} />);

  expect(json(tree)).toContain('No projected range data');
  expect(hostsWithTestId(tree, 'projected-range-comparison').length).toBe(0);
  expect(hostsWithTestId(tree, 'projected-range-value').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('keeps the shell visible with a Skeleton while loading', async () => {
  mockUseProjectedRange.mockReturnValue(
    rangeQuery(undefined, {isLoading: true, isFetching: true}),
  );

  const tree = await render(<ProjectedRangeWidget size={STANDARD} />);

  expect(hostsWithTestId(tree, 'skeleton').length).toBeGreaterThan(0);
  expect(hostsWithTestId(tree, 'projected-range-comparison').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('an errored query surfaces the EmptyState and an "Error" freshness dot', async () => {
  mockUseProjectedRange.mockReturnValue(rangeQuery(undefined, {isError: true}));

  const tree = await render(<ProjectedRangeWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('No projected range data');
  // The widget never passes `error` to WidgetShell, so the freshness shows "Error".
  expect(serialized).toContain('Error');
  expect(hostsWithTestId(tree, 'widget-error').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('the freshness affordance triggers refetch on press', async () => {
  const tree = await render(<ProjectedRangeWidget size={STANDARD} />);

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

test('honours the imperial distance preference (mi units + converted values)', async () => {
  setSettings({unit_of_length: 'mi'});

  const tree = await render(<ProjectedRangeWidget size={WIDE} />);

  const serialized = json(tree);
  // 380 km -> 236 mi (EPA 405 km -> 252 mi); avg daily 52 km -> 32 mi.
  expect(serialized).toContain('EPA: 252 mi');
  expect(serialized).toContain('32 mi');
  // The ratio is unit-invariant, so the comparison percentage is unchanged.
  expect(serialized).toContain('94% of EPA rated');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('uses the first vehicle when no vehicleId prop is supplied', async () => {
  const tree = await render(<ProjectedRangeWidget size={STANDARD} />);

  // id = vehicleId ?? vehicles?.[0]?.id ?? null -> '7'.
  expect(mockUseProjectedRange).toHaveBeenCalledWith('7');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('prefers an explicit vehicleId prop over the vehicles list', async () => {
  const tree = await render(<ProjectedRangeWidget size={STANDARD} vehicleId={42} />);

  // id = vehicleId 42 wins over vehicles?.[0]?.id -> '42'.
  expect(mockUseProjectedRange).toHaveBeenCalledWith('42');

  await ReactTestRenderer.act(async () => tree.unmount());
});
