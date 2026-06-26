import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import MotorHistoryWidget, {
  type WidgetSize,
} from '../src/web-parity/features/dashboard/widgets/MotorHistoryWidget';

/**
 * Native parity contract for MotorHistoryWidget.
 *
 * The web widget reads the motor telemetry history for the selected (or first)
 * vehicle, builds time-sorted chart data (torque Nm, SI->display stator temp,
 * gear, lateral/longitudinal g) and renders a WidgetChartSummary: two latest
 * summary stats (Torque / Stator) plus — on standard/wide layouts — a dual-axis
 * time-series chart with a 100 °C danger band, and dashed g-force overlays on
 * wide layouts. Compact layouts drop the chart. An EmptyState shows when there
 * is no history. These tests mock the motor-history, vehicles and settings
 * hooks and assert the ported behaviour. (React Native fires no `onLayout` under
 * react-test-renderer, so the projected <View> chart segments/danger band have
 * zero measured width; the assertions target the layout-independent summary
 * stats, axis end-labels, legend and chart container instead.)
 */

const mockUseVehicles = jest.fn();
const mockUseMotorHistory = jest.fn();
const mockUseSettings = jest.fn();

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: (...args: unknown[]) => mockUseVehicles(...args),
  useMotorHistory: (...args: unknown[]) => mockUseMotorHistory(...args),
}));

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: (...args: unknown[]) => mockUseSettings(...args),
}));

type Tree = ReactTestRenderer.ReactTestRenderer;

const refetch = jest.fn();

function motorQuery(
  data: Array<Record<string, unknown>> | undefined,
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

// Three time-sorted samples. Latest non-null torque = 180; latest stator = 60 °C;
// torque axis max = 250; g-forces stay small so 250 stays the left-axis max.
const SAMPLES = [
  {
    ts: '2026-06-26T12:00:00Z',
    created_at: '2026-06-26T12:00:00Z',
    di_torque: 100,
    di_stator_temp: 40,
    gear: 'D',
    lateral_accel: 0.2,
    longitudinal_accel: -0.1,
  },
  {
    ts: '2026-06-26T12:01:00Z',
    created_at: '2026-06-26T12:01:00Z',
    di_torque: 250,
    di_stator_temp: 55,
    gear: 'D',
    lateral_accel: 0.5,
    longitudinal_accel: 0.3,
  },
  {
    ts: '2026-06-26T12:02:00Z',
    created_at: '2026-06-26T12:02:00Z',
    di_torque: 180,
    di_stator_temp: 60,
    gear: 'D',
    lateral_accel: -0.3,
    longitudinal_accel: 0.1,
  },
];

const STANDARD: WidgetSize = {cols: 2, rows: 2};
const WIDE: WidgetSize = {cols: 3, rows: 2};
const COMPACT: WidgetSize = {cols: 1, rows: 2};

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

beforeEach(() => {
  jest.clearAllMocks();
  mockUseVehicles.mockReturnValue({data: [{id: 7}]});
  mockUseMotorHistory.mockReturnValue(motorQuery(SAMPLES));
  mockUseSettings.mockReturnValue({
    data: {unit_of_temp: 'C', locale: 'en-US'},
  });
});

test('renders the title, summary stats, chart and metric-unit axis/legend', async () => {
  const tree = await render(<MotorHistoryWidget size={STANDARD} />);

  const serialized = json(tree);
  // Title (uppercased by the shell).
  expect(serialized).toContain('MOTOR HISTORY');
  // Summary stats: latest torque 180 Nm, latest stator 60 °C.
  expect(serialized).toContain('180');
  expect(serialized).toContain('Nm');
  expect(serialized).toContain('60');
  expect(serialized).toContain('°C');
  // The chart container and its legend render (layout-independent).
  expect(hostsWithTestId(tree, 'motor-history-chart').length).toBe(1);
  expect(serialized).toContain('Torque (Nm)');
  expect(serialized).toContain('Stator (°C)');
  // Axis end-labels: torque max 250 Nm and temp max 120 °C.
  expect(serialized).toContain('250 Nm');
  expect(serialized).toContain('120°C');
  // Standard (cols 2) is not wide — no g-force overlays in the legend.
  expect(serialized).not.toContain('Lateral G');
  expect(serialized).not.toContain('No motor history');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('adds the dashed lateral/longitudinal g overlays to the legend on wide layouts', async () => {
  const tree = await render(<MotorHistoryWidget size={WIDE} />);

  const serialized = json(tree);
  expect(serialized).toContain('Torque (Nm)');
  expect(serialized).toContain('Stator (°C)');
  expect(serialized).toContain('Lateral G (g)');
  expect(serialized).toContain('Long. G (g)');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('compact layout shows the summary stats but drops the title and chart', async () => {
  const tree = await render(<MotorHistoryWidget size={COMPACT} />);

  const serialized = json(tree);
  // Stats still render.
  expect(serialized).toContain('180');
  expect(serialized).toContain('60');
  // No title, no chart in compact mode.
  expect(serialized).not.toContain('MOTOR HISTORY');
  expect(hostsWithTestId(tree, 'motor-history-chart').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows the EmptyState (and no chart) when there is no history', async () => {
  mockUseMotorHistory.mockReturnValue(motorQuery([]));

  const tree = await render(<MotorHistoryWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('No motor history');
  expect(serialized).not.toContain('180');
  expect(hostsWithTestId(tree, 'motor-history-chart').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('converts the stator temp and danger threshold for the °F preference', async () => {
  mockUseSettings.mockReturnValue({
    data: {unit_of_temp: 'F', locale: 'en-US'},
  });

  const tree = await render(<MotorHistoryWidget size={STANDARD} />);

  const serialized = json(tree);
  // 60 °C -> 140 °F (60 * 9/5 + 32).
  expect(serialized).toContain('140');
  expect(serialized).toContain('°F');
  // Danger threshold 100 °C -> 212 °F, so tempMax = ceil(212 + 20) = 232 °F.
  expect(serialized).toContain('232°F');
  // Torque axis is unit-agnostic.
  expect(serialized).toContain('250 Nm');
  expect(serialized).not.toContain('°C');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('renders a loading Skeleton instead of the chart while the query loads', async () => {
  mockUseMotorHistory.mockReturnValue(motorQuery(undefined, {isLoading: true}));

  const tree = await render(<MotorHistoryWidget size={STANDARD} />);

  expect(hostsWithTestId(tree, 'skeleton').length).toBeGreaterThanOrEqual(1);
  expect(json(tree)).not.toContain('180');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('falls back to the first vehicle and refetches on the freshness press', async () => {
  const tree = await render(<MotorHistoryWidget size={STANDARD} />);

  // vehicleId omitted -> useMotorHistory called with the first vehicle id (7).
  expect(mockUseMotorHistory).toHaveBeenCalledWith(7, 200);

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

test('bridges null gaps (connectNulls) and reads the latest non-null stats', async () => {
  // Middle sample has null torque; latest torque should fall back to 180, and
  // the widget should still render its chart without error.
  mockUseMotorHistory.mockReturnValue(
    motorQuery([
      {...SAMPLES[0], di_torque: 100},
      {...SAMPLES[1], di_torque: null},
      {...SAMPLES[2], di_torque: 180},
    ]),
  );

  const tree = await render(<MotorHistoryWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('180');
  expect(hostsWithTestId(tree, 'motor-history-chart').length).toBe(1);

  await ReactTestRenderer.act(async () => tree.unmount());
});
