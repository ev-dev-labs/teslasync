import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

// The native charging/settings/vehicles hooks + the AI suggestion card are
// mocked so SmartChargePage resolves synchronously without a QueryClientProvider,
// network, or open handles (the MileagePage / FleetAPIPage mocking precedent).
// All referenced module variables are `mock`-prefixed so the jest.mock factories
// may close over them.
type Mutation = {
  mutate: (vars: unknown, opts?: {onSuccess?: (data?: unknown) => void}) => void;
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

type Query<T> = {data?: T};

type ChargeWindow = {
  start_time: string;
  end_time: string;
  rate_cents_kwh: number;
  estimated_cost: number;
  rate_tier: string;
};

type OptimizeResult = {
  plan_id: number;
  current_soc: number;
  target_soc: number;
  kwh_needed: number;
  estimated_duration_hours: number;
  schedule: ChargeWindow;
  comparison: {
    charge_now_cost: number;
    optimized_cost: number;
    savings: number;
    savings_percent: number;
  };
  alternative_windows: ChargeWindow[];
  hourly_rates: {hour: number; rate_cents: number; tier: string}[];
};

type ChargePlan = {
  id: number;
  scheduled_start: string;
  scheduled_end: string;
  rate_plan: string;
  estimated_cost: number | null;
  savings: number | null;
  status: string;
  created_at: string;
};

const mockResult: OptimizeResult = {
  plan_id: 101,
  current_soc: 55,
  target_soc: 80,
  kwh_needed: 18.4,
  estimated_duration_hours: 3.2,
  schedule: {
    start_time: '2026-06-26T01:00:00Z',
    end_time: '2026-06-26T04:00:00Z',
    rate_cents_kwh: 12.5,
    estimated_cost: 2.3,
    rate_tier: 'OFF_PEAK',
  },
  comparison: {
    charge_now_cost: 5,
    optimized_cost: 2.3,
    savings: 2.7,
    savings_percent: 54,
  },
  alternative_windows: [
    {
      start_time: '2026-06-26T05:00:00Z',
      end_time: '2026-06-26T07:00:00Z',
      rate_cents_kwh: 14,
      estimated_cost: 2.8,
      rate_tier: 'MID_PEAK',
    },
  ],
  hourly_rates: [
    {hour: 0, rate_cents: 12, tier: 'OFF_PEAK'},
    {hour: 1, rate_cents: 12, tier: 'OFF_PEAK'},
    {hour: 18, rate_cents: 40, tier: 'ON_PEAK'},
  ],
};

let mockOptimize: Mutation = {
  mutate: (_vars, opts) => opts?.onSuccess?.(mockResult),
  isPending: false,
  isError: false,
  error: null,
};
let mockApply: Mutation = {
  mutate: (_vars, opts) => opts?.onSuccess?.(),
  isPending: false,
  isError: false,
  error: null,
};
let mockPlans: Query<ChargePlan[]> = {data: []};
let mockRatePlans: Query<{id: string; name: string; utility: string}[]> = {
  data: [{id: 'pge-ev2a', name: 'PG&E EV2-A', utility: 'PG&E'}],
};
let mockVehicles: Query<{id: number; vehicle_id: number; vin: string; display_name: string}[]> = {
  data: [{id: 7, vehicle_id: 7, vin: '5YJ3E1EA7KF000007', display_name: 'Bluey'}],
};
let mockSettings: Query<{currency_symbol?: string; decimal_precision?: number; locale?: string}> = {
  data: {currency_symbol: '$', decimal_precision: 2, locale: 'en-US'},
};

jest.mock('../src/web-parity/api/hooks/useCharging', () => ({
  useOptimizeCharge: () => mockOptimize,
  useApplySchedule: () => mockApply,
  useChargePlans: () => mockPlans,
  useRatePlans: () => mockRatePlans,
}));

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: () => mockVehicles,
}));

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: () => mockSettings,
}));

jest.mock('../src/web-parity/components/ai/AISmartChargeScheduleSuggestion', () => ({
  AISmartChargeScheduleSuggestion: () => null,
}));

import SmartChargePage from '../src/web-parity/features/charging/pages/SmartChargePage';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(): Renderer {
  let tree!: Renderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<SmartChargePage />);
  });
  return tree;
}

function hasHost(tree: Renderer, testID: string): boolean {
  return (
    tree.root.findAll(
      (node: ReactTestInstance) =>
        typeof node.type === 'string' && node.props.testID === testID,
    ).length > 0
  );
}

function press(tree: Renderer, testID: string): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID && typeof node.props.onPress === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onPress();
  });
}

function allText(tree: Renderer): string {
  return JSON.stringify(tree.toJSON());
}

afterEach(() => {
  mockOptimize = {
    mutate: (_vars, opts) => opts?.onSuccess?.(mockResult),
    isPending: false,
    isError: false,
    error: null,
  };
  mockApply = {
    mutate: (_vars, opts) => opts?.onSuccess?.(),
    isPending: false,
    isError: false,
    error: null,
  };
  mockPlans = {data: []};
  mockRatePlans = {data: [{id: 'pge-ev2a', name: 'PG&E EV2-A', utility: 'PG&E'}]};
  mockVehicles = {
    data: [{id: 7, vehicle_id: 7, vin: '5YJ3E1EA7KF000007', display_name: 'Bluey'}],
  };
  mockSettings = {data: {currency_symbol: '$', decimal_precision: 2, locale: 'en-US'}};
  jest.restoreAllMocks();
});

/* ── scaffold + settings + AI + empty history ── */

test('renders the scaffold, header, settings form, and optimize action', () => {
  const tree = render();
  expect(hasHost(tree, 'smart-charge-page')).toBe(true);
  expect(hasHost(tree, 'vehicle-select')).toBe(true);
  expect(hasHost(tree, 'smart-charge-optimize')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Smart Charge');
  expect(text).toContain('Optimize charging schedule for the cheapest TOU rates');
  expect(text).toContain('Charge Settings');
  expect(text).toContain('Rate Plan');
  expect(text).toContain('Target SOC');
  expect(text).toContain('Find Cheapest Window');
  expect(text).toContain('Bluey');
});

test('shows the empty history state when there are no plans', () => {
  const tree = render();
  expect(hasHost(tree, 'smart-charge-history-empty')).toBe(true);
  expect(allText(tree)).toContain(
    'No charge plans yet. Optimize a schedule above to get started.',
  );
});

/* ── history table ── */

test('renders the plan history table when plans are present', () => {
  mockPlans = {
    data: [
      {
        id: 1,
        scheduled_start: '2026-06-20T01:00:00Z',
        scheduled_end: '2026-06-20T04:00:00Z',
        rate_plan: 'PG&E EV2-A',
        estimated_cost: 3.5,
        savings: 2.5,
        status: 'completed',
        created_at: '2026-06-20T00:00:00Z',
      },
    ],
  };
  const tree = render();
  expect(hasHost(tree, 'smart-charge-history')).toBe(true);
  expect(hasHost(tree, 'smart-charge-history-empty')).toBe(false);
  const text = allText(tree);
  expect(text).toContain('Plan History');
  expect(text).toContain('PG&E EV2-A');
  expect(text).toContain('completed');
  expect(text).toContain('$3.50');
});

/* ── optimize populates the result sections ── */

test('optimizing reveals the timeline, cost comparison, and schedule sections', () => {
  const tree = render();
  // Before optimizing, the result-gated sections are absent.
  expect(allText(tree)).not.toContain('24-Hour Rate Timeline');

  press(tree, 'smart-charge-optimize');

  const text = allText(tree);
  expect(text).toContain('24-Hour Rate Timeline');
  expect(hasHost(tree, 'rate-timeline-empty')).toBe(false);
  expect(text).toContain('Off-Peak');
  expect(text).toContain('Charge Now');
  expect(text).toContain('Optimized Cost');
  expect(text).toContain('Savings');
  // charge_now_cost 5 → "$5.00"; savings_percent 54 → "54%".
  expect(text).toContain('$5.00');
  expect(text).toContain('54%');
  expect(text).toContain('Recommended Schedule');
  expect(text).toContain('Alternative Windows');
  expect(hasHost(tree, 'smart-charge-apply')).toBe(true);
});

/* ── apply marks the schedule applied ── */

test('applying a schedule shows the applied confirmation', () => {
  const tree = render();
  press(tree, 'smart-charge-optimize');
  expect(hasHost(tree, 'smart-charge-applied')).toBe(false);

  press(tree, 'smart-charge-apply');

  expect(hasHost(tree, 'smart-charge-applied')).toBe(true);
  expect(allText(tree)).toContain('Schedule Applied!');
});

/* ── target SOC stepper drives the slider value ── */

test('the target SOC stepper increments by the step', () => {
  const tree = render();
  // Default 80% rendered.
  expect(allText(tree)).toContain('80%');
  press(tree, 'smart-charge-target-soc-inc');
  // 80 + step(5) → 85%.
  expect(allText(tree)).toContain('85%');
});
