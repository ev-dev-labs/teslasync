import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

// The native analytics/settings/vehicles hooks are mocked so MileagePage
// resolves its queries synchronously without a QueryClientProvider, network, or
// open handles (the TeslaRegionPage / FleetAPIPage mocking precedent). All
// referenced module variables are `mock`-prefixed so the jest.mock factories may
// close over them.
type Query<T> = {
  data?: T;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  error?: unknown;
  refetch?: () => unknown;
};

type MileageStats = {
  lifetime_km: number;
  last_30d_km: number;
  drive_count_lifetime: number;
};

type DailyBucket = {date: string; total_km: number; end_odometer_km: number | null};
type MonthlyBucket = {year_month: string; drive_count: number; total_km: number};
type Vehicle = {id: number; vehicle_id: number; vin: string; display_name: string};

let mockStats: Query<MileageStats> = {
  data: {lifetime_km: 12000, last_30d_km: 900, drive_count_lifetime: 480},
  isLoading: false,
  isFetching: false,
  isStale: false,
  isError: false,
  dataUpdatedAt: Date.now(),
  error: null,
  refetch: jest.fn(),
};
let mockDaily: Query<DailyBucket[]> = {
  data: [
    {date: '2026-06-01T00:00:00Z', total_km: 40, end_odometer_km: 12000},
    {date: '2026-06-02T00:00:00Z', total_km: 22, end_odometer_km: 12022},
    {date: '2026-06-03T00:00:00Z', total_km: 0, end_odometer_km: null},
  ],
  error: null,
};
let mockMonthly: Query<MonthlyBucket[]> = {
  data: [
    {year_month: '2026-05', drive_count: 20, total_km: 600},
    {year_month: '2026-06', drive_count: 18, total_km: 540},
  ],
  error: null,
};
let mockVehicles: Query<Vehicle[]> = {
  data: [{id: 7, vehicle_id: 7, vin: '5YJ3E1EA7KF000007', display_name: 'Bluey'}],
};
let mockSettings: Query<{unit_of_length: string; chart_palette?: 'cb_safe' | 'neon'}> = {
  data: {unit_of_length: 'km', chart_palette: 'cb_safe'},
};

jest.mock('../src/web-parity/api/hooks/useAnalytics', () => ({
  useMileageStats: () => mockStats,
  useDailyMileage: () => mockDaily,
  useMonthlyMileage: () => mockMonthly,
}));

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: () => mockVehicles,
}));

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: () => mockSettings,
}));

import MileagePage from '../src/web-parity/features/analytics/pages/MileagePage';

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
  mockStats = {
    data: {lifetime_km: 12000, last_30d_km: 900, drive_count_lifetime: 480},
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    error: null,
    refetch: jest.fn(),
  };
  mockDaily = {
    data: [
      {date: '2026-06-01T00:00:00Z', total_km: 40, end_odometer_km: 12000},
      {date: '2026-06-02T00:00:00Z', total_km: 22, end_odometer_km: 12022},
      {date: '2026-06-03T00:00:00Z', total_km: 0, end_odometer_km: null},
    ],
    error: null,
  };
  mockMonthly = {
    data: [
      {year_month: '2026-05', drive_count: 20, total_km: 600},
      {year_month: '2026-06', drive_count: 18, total_km: 540},
    ],
    error: null,
  };
  mockVehicles = {
    data: [{id: 7, vehicle_id: 7, vin: '5YJ3E1EA7KF000007', display_name: 'Bluey'}],
  };
  mockSettings = {data: {unit_of_length: 'km', chart_palette: 'cb_safe'}};
  jest.restoreAllMocks();
});

/* ── scaffold + header ── */

test('renders the page scaffold with title, subtitle, and vehicle picker', () => {
  const tree = render(<MileagePage />);
  expect(hasHost(tree, 'mileage-page')).toBe(true);
  expect(hasHost(tree, 'vehicle-select')).toBe(true);
  expect(hasHost(tree, 'data-freshness')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Mileage');
  expect(text).toContain('Daily and monthly distance tracking');
  expect(text).toContain('Bluey');
});

/* ── summary metric cards ── */

test('renders the four summary metric cards with converted values', () => {
  const tree = render(<MileagePage />);
  const text = allText(tree);
  expect(text).toContain('Total Distance');
  expect(text).toContain('Total Drives');
  expect(text).toContain('Daily Avg (30d)');
  expect(text).toContain('Annual Projection');
  // lifetime_km 12000 → "12,000 km"; drive_count_lifetime 480 → "480".
  expect(text).toContain('12,000 km');
  expect(text).toContain('480');
});

/* ── chart panels render (native-safe placeholders, not empty states) ── */

test('renders both chart panels when daily data is present', () => {
  const tree = render(<MileagePage />);
  const text = allText(tree);
  expect(text).toContain('Odometer Over Time');
  expect(text).toContain('Daily Distance');
  expect(hasHost(tree, 'mileage-odometer-empty')).toBe(false);
  expect(hasHost(tree, 'mileage-daily-empty')).toBe(false);
});

/* ── monthly summary table ── */

test('renders the monthly summary table with a row per month', () => {
  const tree = render(<MileagePage />);
  expect(hasHost(tree, 'analytics:mileage-monthly')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Monthly Summary');
  expect(text).toContain('2026-05');
  expect(text).toContain('2026-06');
});

/* ── empty chart states ── */

test('shows the No Entries empty state when daily data is empty', () => {
  mockDaily = {data: [], error: null};
  const tree = render(<MileagePage />);
  expect(hasHost(tree, 'mileage-odometer-empty')).toBe(true);
  expect(hasHost(tree, 'mileage-daily-empty')).toBe(true);
});

/* ── error banner ── */

test('renders the danger alert banner when a query errors', () => {
  mockMonthly = {data: [], error: new Error('boom')};
  const tree = render(<MileagePage />);
  expect(hasHost(tree, 'mileage-alert')).toBe(true);
  expect(allText(tree)).toContain('Failed to load data');
  expect(allText(tree)).toContain('boom');
});

/* ── loading state gates the body behind the spinner ── */

test('shows the loading spinner and hides the body while stats are loading', () => {
  mockStats = {...mockStats, isLoading: true, data: undefined};
  const tree = render(<MileagePage />);
  expect(hasHost(tree, 'mileage-loading')).toBe(true);
  // Body sections are gated behind the spinner, exactly like the web PageContainer.
  expect(allText(tree)).not.toContain('Monthly Summary');
});

/* ── no-vehicle guard ── */

test('renders the NoVehicleSelected guard when the fleet is empty', () => {
  mockVehicles = {data: []};
  const tree = render(<MileagePage />);
  expect(hasHost(tree, 'mileage-no-vehicle')).toBe(true);
  expect(hasHost(tree, 'mileage-no-vehicle-empty')).toBe(true);
  expect(allText(tree)).toContain('No vehicle selected');
});

/* ── imperial unit preference flows through ── */

test('uses miles when the settings unit_of_length is mi', () => {
  mockSettings = {data: {unit_of_length: 'mi', chart_palette: 'cb_safe'}};
  const tree = render(<MileagePage />);
  const text = allText(tree);
  // 12000 km → meters 12,000,000 → miles 7,456 (rounded by fmtInt).
  expect(text).toContain('7,456 mi');
});
