import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useChargingOptimizer} from '../src/web-parity/api/hooks/useCharging';
import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import ChargingOptimizerWidget from '../src/web-parity/features/dashboard/widgets/ChargingOptimizerWidget';

jest.mock('../src/web-parity/api/hooks/useCharging', () => ({
  useChargingOptimizer: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
}));

const mockUseChargingOptimizer = useChargingOptimizer as unknown as jest.Mock;
const mockUseVehicles = useVehicles as unknown as jest.Mock;

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

function optimizerStub() {
  return {
    data: {
      current_schedule: {
        most_common_start_hour: 23,
        most_common_day: 'Monday',
        avg_sessions_per_week: 5,
        home_charging_pct: 80,
        avg_charge_to_pct: 85,
      },
      cost_analysis: {
        peak_hours: [17, 18, 19, 20],
        offpeak_hours: [0, 1, 2, 3, 23],
        peak_cost_per_kwh: 0.42,
        offpeak_cost_per_kwh: 0.12,
        sessions_during_peak_pct: 12,
        potential_monthly_savings: 35,
      },
      battery_health_score: 90,
      recommendations: [
        {
          type: 'schedule',
          priority: 'high',
          title: 'Shift to off-peak',
          detail: 'Move charging to after 11 PM to save.',
          estimated_savings: 20,
        },
        {
          type: 'soc',
          priority: 'medium',
          title: 'Lower target SOC',
          detail: 'Charge to 80% for daily use.',
          estimated_savings: 10,
        },
        {
          type: 'home',
          priority: 'low',
          title: 'Charge at home',
          detail: 'Home charging is cheaper.',
          estimated_savings: 5,
        },
      ],
      weekly_heatmap: [],
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
  mockUseChargingOptimizer.mockReturnValue(optimizerStub());
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

const WIDE = {cols: 4, rows: 3};
const STANDARD = {cols: 2, rows: 2};
const COMPACT = {cols: 1, rows: 1};

test('renders a loading skeleton while the optimizer query is loading', async () => {
  mockUseChargingOptimizer.mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
    isFetching: true,
    isStale: false,
    isError: false,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  });

  const tree = await render(<ChargingOptimizerWidget size={WIDE} />);
  const raw = rawOf(tree);

  expect(raw).toContain('charging-optimizer-loading');
  expect(raw).not.toContain('charging-optimizer-widget');

  await unmount(tree);
});

test('renders the wide layout with metrics, schedule badge, timeline and tips', async () => {
  const tree = await render(<ChargingOptimizerWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('charging-optimizer-widget');
  expect(text).toContain('Charging Optimizer');

  // Key-metric row: optimal start (11 PM), target SOC (85%), savings ($35).
  expect(raw).toContain('charging-optimizer-metric-start');
  expect(text).toContain('11 PM');
  expect(text).toContain('Optimal start');
  expect(text).toContain('Target SOC');
  expect(text).toContain('85%');
  expect(text).toContain('Savings/mo');
  expect(text).toContain('$35');

  // Schedule match: peak < 30 -> Optimized.
  expect(text).toContain('Peak charging: 12%');
  expect(text).toContain('Optimized');
  expect(text).not.toContain('Can improve');

  // Wide-only 24h rate timeline.
  expect(raw).toContain('charging-optimizer-timeline');
  expect(text).toContain('24h Rate Timeline');
  expect(text).toContain('6 AM');
  expect(text).toContain('6 PM');

  // Recommendations as tip cards (3 recs, impact labels).
  expect(raw).toContain('charging-optimizer-tips');
  expect(text).toContain('Shift to off-peak');
  expect(text).toContain('Lower target SOC');
  expect(text).toContain('Charge at home');
  expect(text).toContain('high');
  expect(text).toContain('medium');
  expect(text).toContain('low');

  // Freshness chip is wired.
  expect(raw).toContain('charging-optimizer-freshness');

  await unmount(tree);
});

test('renders the standard (2x2) layout without the wide-only timeline', async () => {
  const tree = await render(<ChargingOptimizerWidget size={STANDARD} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('charging-optimizer-widget');
  expect(raw).toContain('charging-optimizer-metric-start');
  expect(raw).toContain('charging-optimizer-tips');
  // Timeline only renders for cols >= 4.
  expect(raw).not.toContain('charging-optimizer-timeline');
  expect(text).not.toContain('24h Rate Timeline');

  await unmount(tree);
});

test('renders the can-improve badge when peak usage is at or above 30%', async () => {
  const stub = optimizerStub();
  stub.data.cost_analysis.sessions_during_peak_pct = 45;
  mockUseChargingOptimizer.mockReturnValue(stub);

  const tree = await render(<ChargingOptimizerWidget size={STANDARD} />);
  const text = textOf(tree);

  expect(text).toContain('Peak charging: 45%');
  expect(text).toContain('Can improve');
  expect(text).not.toContain('Optimized');

  await unmount(tree);
});

test('renders the tip-cards empty state when there are no recommendations', async () => {
  const stub = optimizerStub();
  stub.data.recommendations = [];
  mockUseChargingOptimizer.mockReturnValue(stub);

  const tree = await render(<ChargingOptimizerWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('charging-optimizer-tips-empty');
  expect(raw).not.toContain('charging-optimizer-tips"');
  expect(text).toContain('No recommendations');

  await unmount(tree);
});

test('renders the wide empty state when the optimizer query has no data', async () => {
  mockUseChargingOptimizer.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  });

  const tree = await render(<ChargingOptimizerWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('charging-optimizer-empty');
  expect(raw).not.toContain('charging-optimizer-metric-start');
  expect(raw).not.toContain('charging-optimizer-timeline');
  expect(text).toContain('No optimizer data');

  await unmount(tree);
});

test('renders the compact layout with start hour, target SOC and savings badge', async () => {
  const tree = await render(<ChargingOptimizerWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('charging-optimizer-widget');
  expect(raw).toContain('charging-optimizer-compact');
  expect(text).toContain('11 PM');
  expect(text).toContain('SOC 85%');
  expect(raw).toContain('charging-optimizer-compact-savings');
  expect(text).toContain('$35/mo');
  // The compact shell is title-less, so the wide title is absent.
  expect(text).not.toContain('Charging Optimizer');
  // Compact never renders the metric grid labels or the timeline.
  expect(text).not.toContain('Optimal start');
  expect(raw).not.toContain('charging-optimizer-timeline');

  await unmount(tree);
});

test('hides the compact savings badge when monthly savings is zero', async () => {
  const stub = optimizerStub();
  stub.data.cost_analysis.potential_monthly_savings = 0;
  mockUseChargingOptimizer.mockReturnValue(stub);

  const tree = await render(<ChargingOptimizerWidget size={COMPACT} />);
  const raw = rawOf(tree);

  expect(raw).toContain('charging-optimizer-compact');
  expect(raw).not.toContain('charging-optimizer-compact-savings');

  await unmount(tree);
});

test('renders the compact empty state when there is no optimizer data', async () => {
  mockUseChargingOptimizer.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  });

  const tree = await render(<ChargingOptimizerWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('charging-optimizer-empty');
  expect(raw).not.toContain('charging-optimizer-compact"');
  expect(text).toContain('No optimizer data');

  await unmount(tree);
});

test('surfaces the query error in the shell error box', async () => {
  mockUseChargingOptimizer.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: new Error('boom'),
    isFetching: false,
    isStale: false,
    isError: true,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  });

  const tree = await render(<ChargingOptimizerWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('charging-optimizer-error');
  expect(text).toContain('boom');
  expect(raw).not.toContain('charging-optimizer-metric-start');

  await unmount(tree);
});

test('falls back to the first vehicle id when no vehicleId prop is supplied', async () => {
  mockUseVehicles.mockReturnValue({data: [{id: 7}, {id: 9}]});

  const tree = await render(<ChargingOptimizerWidget size={WIDE} />);

  expect(mockUseChargingOptimizer).toHaveBeenCalledWith('7');

  await unmount(tree);
});

test('passes the explicit vehicleId prop to the optimizer hook', async () => {
  const tree = await render(
    <ChargingOptimizerWidget vehicleId={42} size={WIDE} />,
  );

  expect(mockUseChargingOptimizer).toHaveBeenCalledWith('42');

  await unmount(tree);
});
