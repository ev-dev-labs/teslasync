import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import BatteryCellsWidget, {
  type WidgetSize,
} from '../src/web-parity/features/dashboard/widgets/BatteryCellsWidget';

/**
 * Native parity contract for BatteryCellsWidget.
 *
 * The web widget reads the per-cell battery summary for the selected (or first)
 * vehicle and renders a voltage "heatmap" status grid, a Min/Max/Avg/Spread
 * voltage StatCard grid, and (on wide layouts) a Min/Avg/Max temperature row;
 * it shows an EmptyState when the query has no data. Cell density and the
 * per-cell label/value verbosity scale with size.cols. These tests assert that
 * behaviour against the native port by mocking the battery-cells + vehicles
 * query hooks.
 */

const mockUseBatteryCells = jest.fn();
const mockUseVehicles = jest.fn();

jest.mock('../src/web-parity/api/hooks/useEnergy', () => ({
  useBatteryCells: (...args: unknown[]) => mockUseBatteryCells(...args),
}));

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: (...args: unknown[]) => mockUseVehicles(...args),
}));

type Tree = ReactTestRenderer.ReactTestRenderer;

interface BatteryCell {
  cell_id: number;
  module: number;
  voltage: number;
  temperature: number;
}

interface BatteryCellSummary {
  total_cells: number;
  avg_voltage: number;
  min_voltage: number;
  max_voltage: number;
  voltage_spread: number;
  avg_temperature: number;
  min_temperature: number;
  max_temperature: number;
  temp_spread: number;
  cells: BatteryCell[];
}

const refetch = jest.fn();

function cellsQuery(
  data: BatteryCellSummary | undefined,
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

// avg_voltage 3.857 -> cell 1 (1mV) ok, cell 2 (6mV) warning, cell 4 (43mV) error.
const SUMMARY: BatteryCellSummary = {
  total_cells: 4,
  avg_voltage: 3.857,
  min_voltage: 3.85,
  max_voltage: 3.87,
  voltage_spread: 0.02,
  avg_temperature: 24.5,
  min_temperature: 23.1,
  max_temperature: 26.0,
  temp_spread: 2.9,
  cells: [
    {cell_id: 1, module: 1, voltage: 3.858, temperature: 24.0},
    {cell_id: 2, module: 1, voltage: 3.851, temperature: 24.2},
    {cell_id: 3, module: 2, voltage: 3.87, temperature: 25.5},
    {cell_id: 4, module: 2, voltage: 3.9, temperature: 26.0},
  ],
};

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
  mockUseVehicles.mockReturnValue({data: [{id: 7}]});
  mockUseBatteryCells.mockReturnValue(cellsQuery(SUMMARY));
});

test('standard layout renders the title, status grid and voltage stats', async () => {
  const tree = await render(<BatteryCellsWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('BATTERY CELLS');
  expect(hostsWithTestId(tree, 'widget-status-grid').length).toBe(1);
  // Compact-ish (non-wide) per-cell labels are `C{id}`.
  expect(serialized).toContain('C1');
  expect(serialized).toContain('C4');
  // Voltage StatCards.
  expect(hostsWithTestId(tree, 'battery-cells-voltage-stats').length).toBe(1);
  expect(serialized).toContain('Min V');
  expect(serialized).toContain('Max V');
  expect(serialized).toContain('Avg V');
  expect(serialized).toContain('Spread');
  expect(serialized).toContain('3.850 V');
  expect(serialized).toContain('3.857 V');
  // spread 0.02 * 1000 -> '20.0 mV'.
  expect(serialized).toContain('20.0 mV');
  // No temperature row on the non-wide layout.
  expect(hostsWithTestId(tree, 'battery-cells-temp-stats').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('wide layout adds the temperature row and verbose per-cell labels/values', async () => {
  const tree = await render(<BatteryCellsWidget size={WIDE} />);

  const serialized = json(tree);
  // Wide labels: `Cell {id} \u00b7 M{module}` and `{v} V / {t}\u00b0` values.
  expect(serialized).toContain('Cell 1 \u00b7 M1');
  expect(serialized).toContain('3.858 V / 24.0\u00b0');
  // Temperature stat row.
  expect(hostsWithTestId(tree, 'battery-cells-temp-stats').length).toBe(1);
  expect(serialized).toContain('Min Temp');
  expect(serialized).toContain('Avg Temp');
  expect(serialized).toContain('Max Temp');
  expect(serialized).toContain('23.1\u00b0');
  expect(serialized).toContain('26.0\u00b0');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('compact layout is title-less and hides per-cell values', async () => {
  const tree = await render(<BatteryCellsWidget size={COMPACT} />);

  const serialized = json(tree);
  expect(serialized).not.toContain('BATTERY CELLS');
  expect(hostsWithTestId(tree, 'widget-status-grid').length).toBe(1);
  expect(serialized).toContain('C1');
  // Compact cells render the label only — no `3.858 V` value strings.
  expect(serialized).not.toContain('3.858 V');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows the grid empty state but keeps the voltage stats when cells are empty', async () => {
  mockUseBatteryCells.mockReturnValue(
    cellsQuery({
      ...SUMMARY,
      total_cells: 0,
      cells: [],
    }),
  );

  const tree = await render(<BatteryCellsWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('No cell data');
  expect(hostsWithTestId(tree, 'widget-status-grid').length).toBe(0);
  // Summary stats are still rendered alongside the empty grid.
  expect(hostsWithTestId(tree, 'battery-cells-voltage-stats').length).toBe(1);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows the EmptyState (and no status grid) when there is no data', async () => {
  mockUseBatteryCells.mockReturnValue(cellsQuery(undefined));

  const tree = await render(<BatteryCellsWidget size={STANDARD} />);

  expect(json(tree)).toContain('No battery cell data');
  expect(hostsWithTestId(tree, 'widget-status-grid').length).toBe(0);
  expect(hostsWithTestId(tree, 'battery-cells-voltage-stats').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('keeps the shell visible with a Skeleton while loading', async () => {
  mockUseBatteryCells.mockReturnValue(
    cellsQuery(undefined, {isLoading: true, isFetching: true}),
  );

  const tree = await render(<BatteryCellsWidget size={STANDARD} />);

  expect(hostsWithTestId(tree, 'skeleton').length).toBeGreaterThan(0);
  expect(hostsWithTestId(tree, 'widget-status-grid').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('renders an inline error block instead of hiding the widget on error', async () => {
  mockUseBatteryCells.mockReturnValue(
    cellsQuery(undefined, {
      error: new Error('cells unavailable'),
      isError: true,
    }),
  );

  const tree = await render(<BatteryCellsWidget size={STANDARD} />);

  expect(hostsWithTestId(tree, 'widget-error').length).toBe(1);
  expect(json(tree)).toContain('cells unavailable');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('the freshness affordance triggers refetch on press', async () => {
  const tree = await render(<BatteryCellsWidget size={STANDARD} />);

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
