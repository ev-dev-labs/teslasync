import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

// The native driving/vehicles/settings hooks (and the chart-annotation hooks
// that ChartContainer consumes) are mocked so EfficiencyPage resolves its
// queries synchronously without a QueryClientProvider, network, or open handles
// (the MileagePage / SmartChargePage mocking precedent). All referenced module
// variables are `mock`-prefixed so the jest.mock factories may close over them.
type Query<T> = {data?: T; isLoading?: boolean; error?: unknown};

type DrivingStats = {
  totalDrives: number;
  totalDistanceKm: number;
  totalDurationS: number;
  avgEfficiencyWhKm: number;
  avgSpeedKmh: number;
  topSpeedKmh: number;
  regenRatio: number;
  regenEnergyWh: number;
  co2SavedKg: number;
};

type Drive = {
  id: number;
  startTs: string;
  distanceM: number;
  startBatteryPct: number | null;
  endBatteryPct: number | null;
  avgSpeedMps: number | null;
  outsideTempAvgC: number | null;
};

type Vehicle = {id: number; vehicle_id: number; vin: string; display_name: string};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function makeDrives(): Drive[] {
  // Six drives, all inside the default 30-day window, each producing a real
  // efficiency value (startBatteryPct > endBatteryPct, distanceM > 0) so the
  // daily-trend (> 2), speed-scatter (> 3) and temp-scatter (> 3) gates all open.
  return [0, 1, 2, 3, 4, 5].map(i => ({
    id: i + 1,
    startTs: isoDaysAgo(i + 1),
    distanceM: 50000,
    startBatteryPct: 80,
    endBatteryPct: 70 - i, // varied so each drive differs
    avgSpeedMps: 12 + i, // ~43–61 km/h, spreads the speed buckets
    outsideTempAvgC: 18 + i, // 18–23 °C, spreads the temp buckets
  }));
}

function freshStats(): DrivingStats {
  return {
    totalDrives: 37,
    totalDistanceKm: 8000,
    totalDurationS: 36000,
    avgEfficiencyWhKm: 160,
    avgSpeedKmh: 50,
    topSpeedKmh: 120,
    regenRatio: 0.18,
    regenEnergyWh: 5400,
    co2SavedKg: 96,
  };
}

let mockStats: Query<DrivingStats> = {data: freshStats(), isLoading: false, error: null};
let mockDrives: Query<Drive[]> = {data: makeDrives(), isLoading: false, error: null};
let mockVehicles: Query<Vehicle[]> = {
  data: [{id: 7, vehicle_id: 7, vin: '5YJ3E1EA7KF000007', display_name: 'Bluey'}],
};
let mockSettings: Query<{unit_of_length?: string; unit_of_temp?: string}> = {
  data: {unit_of_length: 'km', unit_of_temp: 'C'},
};

jest.mock('../src/web-parity/api/hooks/useDriving', () => ({
  useDrivingStats: () => mockStats,
  useDrives: () => mockDrives,
}));

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: () => mockVehicles,
}));

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: () => mockSettings,
}));

// ChartContainer unconditionally calls the annotation query hooks; stub them so
// the chart panels render their native placeholders without a QueryClient.
jest.mock('../src/web-parity/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({annotations: []}),
  useCreateAnnotation: () => ({mutate: jest.fn(), isPending: false, isError: false}),
  useDeleteAnnotation: () => ({mutate: jest.fn(), isPending: false, isError: false}),
}));

import EfficiencyPage from '../src/web-parity/features/driving/pages/EfficiencyPage';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
}

function hasHost(tree: Renderer, testID: string): boolean {
  return (
    tree.root.findAll(
      (node: ReactTestInstance) =>
        typeof node.type === 'string' && node.props.testID === testID,
    ).length > 0
  );
}

function allText(tree: Renderer): string {
  return JSON.stringify(tree.toJSON());
}

afterEach(() => {
  mockStats = {data: freshStats(), isLoading: false, error: null};
  mockDrives = {data: makeDrives(), isLoading: false, error: null};
  mockVehicles = {
    data: [{id: 7, vehicle_id: 7, vin: '5YJ3E1EA7KF000007', display_name: 'Bluey'}],
  };
  mockSettings = {data: {unit_of_length: 'km', unit_of_temp: 'C'}};
  jest.restoreAllMocks();
});

/* ── scaffold + header ── */

test('renders the page scaffold with title, subtitle, and vehicle picker', () => {
  const tree = render(<EfficiencyPage />);
  expect(hasHost(tree, 'efficiency-page')).toBe(true);
  expect(hasHost(tree, 'vehicle-select')).toBe(true);
  expect(hasHost(tree, 'efficiency-range')).toBe(true);
  expect(hasHost(tree, 'saved-view-menu')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Efficiency');
  expect(text).toContain('Energy consumption and driving efficiency analysis');
  expect(text).toContain('Bluey');
});

/* ── hero gauges + stat cards ── */

test('renders the hero stats and the four stat cards with converted values', () => {
  const tree = render(<EfficiencyPage />);
  const text = allText(tree);
  // Hero RadialGauge label + AnimatedNumber stat labels.
  expect(text).toContain('Avg Wh/km');
  expect(text).toContain('km/kWh');
  expect(text).toContain('CO\u2082 Saved (kg)');
  // Stat cards.
  expect(text).toContain('Avg Speed');
  expect(text).toContain('Est. Cost/km');
  expect(text).toContain('Drives Analyzed');
  // costPerKm = fmtNumber((160/1000)*0.12, 3) = "0.019" (the "$" prefix is a
  // sibling text node, so assert the contiguous numeric portion).
  expect(text).toContain('0.019');
  // totalDrives renders verbatim.
  expect(text).toContain('37');
});

/* ── chart panels render (native-safe placeholders, not empty states) ── */

test('renders the trend, speed-distribution, and scatter chart panels', () => {
  const tree = render(<EfficiencyPage />);
  const text = allText(tree);
  expect(text).toContain('Daily Efficiency (Wh/km)');
  expect(text).toContain('Efficiency by Speed Range');
  expect(text).toContain('Speed vs Efficiency');
  expect(text).toContain('Temperature vs Efficiency');
});

/* ── temperature-bucket table + summary + insights ── */

test('renders the temperature bucket table, summary bars, and energy insights', () => {
  const tree = render(<EfficiencyPage />);
  expect(hasHost(tree, 'driving:efficiency-temp-buckets')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Efficiency by Temperature Range');
  expect(text).toContain('Efficiency Summary');
  expect(text).toContain('Energy Insights');
  expect(text).toContain('Total Regen');
  expect(text).toContain('Top Speed');
});

/* ── imperial unit preference flows through ── */

test('uses miles + Wh/mi when settings select imperial units', () => {
  mockSettings = {data: {unit_of_length: 'mi', unit_of_temp: 'F'}};
  const tree = render(<EfficiencyPage />);
  const text = allText(tree);
  expect(text).toContain('Wh/mi');
  expect(text).toContain('mi/kWh');
});

/* ── empty states when stats are missing ── */

test('shows the no-data empty states when stats are unavailable', () => {
  mockStats = {data: undefined, isLoading: false, error: null};
  mockDrives = {data: [], isLoading: false, error: null};
  const tree = render(<EfficiencyPage />);
  expect(hasHost(tree, 'efficiency-no-stats')).toBe(true);
  expect(hasHost(tree, 'efficiency-no-statcards')).toBe(true);
  expect(hasHost(tree, 'efficiency-no-summary')).toBe(true);
  expect(hasHost(tree, 'efficiency-no-insights')).toBe(true);
  expect(hasHost(tree, 'efficiency-no-temp')).toBe(true);
});
