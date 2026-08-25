/**
 * OverviewTab — behaviour + hardening coverage.
 *
 * Single export: <OverviewTab>. It is the bento grid at the top of the
 * Analytics page's Overview tab. It owns three data-bound panels of its own
 * (Distance by Vehicle, Day of Week Pattern, Monthly Cost Comparison),
 * composes the four fleet-comparison panels via <OverviewVehicleComparison>,
 * and renders a static Quick Links band. Every data panel is fed from the one
 * shared `FleetAnalyticsQuery` and must own its loading / error / empty state
 * independently (never a blank panel), converting the backend's SI-km distance
 * aggregate into the user's display unit at the render boundary.
 *
 * Facets covered:
 *   1. LOADING     — every own panel shows a skeleton + is announced busy, the
 *                    charts are withheld, yet the titled chrome + static Quick
 *                    Links band stay visible.
 *   2. ERROR+RETRY — every own panel surfaces a retryable QueryError whose CTA
 *                    is wired to the query's refetch; the charts stay hidden.
 *   3. EMPTY       — each own panel shows its bespoke empty copy (never the
 *                    generic blank) when the payload carries no rows.
 *   4. READY/km    — the Distance chart receives the km-converted series keyed
 *                    by vehicle name; the DOW + Monthly charts receive their
 *                    payloads verbatim with the right series wiring.
 *   5. READY/mi    — the same payload is re-expressed in miles (genuine
 *                    conversion via the real lib) and the bar's unit name flips.
 *   6. NULL-SAFETY — a vehicle missing its name/distance degrades to an em-dash
 *                    label and a safe() 0 rather than `undefined`/`NaN`, and the
 *                    panel still renders (not the empty state).
 *   7. QUICK LINKS — all five links render with the right hrefs + i18n labels,
 *                    and their decorative icons are hidden from assistive tech.
 *   8. COMPOSITION — the same query object is threaded down into
 *                    <OverviewVehicleComparison>.
 *   9. A11Y        — the overview grid is exposed as a labelled region.
 *
 * `react-i18next` is stubbed to the English fallback so copy is deterministic.
 * `@/hooks/useSettings` (what the real `useUnits()` reads) is mocked per-test so
 * metric/imperial can be toggled while the real conversion lib runs underneath,
 * making the asserted numbers genuine. The `@/components/charts` barrel is
 * swapped for lightweight doubles (recharts renders 0×0 under jsdom, so the
 * real charts never paint their series) that surface each chart's `data` and
 * per-series props for inspection — only the pixel-pushing library is stubbed;
 * the component's own data wiring still runs. The sibling
 * <OverviewVehicleComparison> is stubbed to isolate this unit and to assert the
 * query is threaded through. Router context is provided because the panels'
 * QueryError and the Quick Links use react-router. No network is touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/feedback';
import type { ReactNode } from 'react';
import type { FleetAnalytics } from '@/api/types';
import type { FleetAnalyticsQuery } from './constants';

const { mockUseSettings } = vi.hoisted(() => ({ mockUseSettings: vi.fn() }));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, def?: string) => def ?? key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return { ...actual, useSettings: mockUseSettings };
});

// Charts: surface each chart's derived `data` + series props for inspection.
// Keep the real, non-rendering utilities (safe / CHART_COLORS / margins) so the
// component's math + palette stay genuine; replace only the pixel-pushing
// recharts components and the decorative grid element.
const serialize = (v: unknown) => JSON.stringify(v ?? null);
vi.mock('@/components/charts', async () => {
  const actual = await vi.importActual<typeof import('@/components/charts')>('@/components/charts');
  return {
    ...actual,
    chartGrid: null,
    ChartTooltip: () => null,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    BarChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
      <div data-testid="bar-chart" data-series={serialize(data)}>{children}</div>
    ),
    ComposedChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
      <div data-testid="composed-chart" data-series={serialize(data)}>{children}</div>
    ),
    Bar: ({ dataKey, name }: { dataKey?: string; name?: string }) => (
      <div data-testid="bar" data-key={String(dataKey)} data-name={String(name)} />
    ),
    Line: ({ dataKey, name }: { dataKey?: string; name?: string }) => (
      <div data-testid="line" data-key={String(dataKey)} data-name={String(name)} />
    ),
    XAxis: ({ dataKey }: { dataKey?: string }) => (
      <div data-testid="x-axis" data-key={String(dataKey)} />
    ),
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

// Isolate this unit: the sibling four-panel comparison has its own file/tests.
// The stub surfaces the query's flags so we can assert the same query threads
// through untouched.
vi.mock('./OverviewVehicleComparison', () => ({
  OverviewVehicleComparison: ({ query }: { query: FleetAnalyticsQuery }) => (
    <div
      data-testid="vehicle-comparison"
      data-loading={String(query.isLoading)}
      data-error={String(query.isError)}
    />
  ),
}));

import { OverviewTab } from './OverviewTab';

/** Minimal settings bag — the real `useUnits()` only reads these fields. */
function settingsFor(length: 'km' | 'mi') {
  return {
    settings: {
      unit_of_length: length,
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      locale: 'en-US',
      decimal_precision: 2,
    },
  };
}

type VehicleRow = { id: number; name: string; distance: number; energy: number; efficiency: number; drives: number };
type DowRow = { day: string; drives: number; distance: number; avg_distance: number };
type MonthRow = { month: string; energy: number; cost: number; sessions: number; avg_power: number; gas_cost: number; savings: number };

function vehicle(partial: Partial<VehicleRow>): VehicleRow {
  return { id: 1, name: 'Model 3', distance: 0, energy: 0, efficiency: 0, drives: 0, ...partial };
}

/** Build a FleetAnalytics payload carrying only the slices OverviewTab reads. */
function fleetData(over: {
  vehicle_comparison?: Array<Partial<VehicleRow>>;
  day_of_week?: DowRow[];
  monthly_trend?: MonthRow[];
} = {}): FleetAnalytics {
  return {
    // Rows are passed through verbatim so tests can exercise runtime-missing
    // fields (the typed contract says `name`/`distance` are always present,
    // but the untyped API can transiently omit them).
    vehicle_comparison: over.vehicle_comparison ?? [],
    drive_analytics: { day_of_week: over.day_of_week ?? [] },
    charging_analytics: { monthly_trend: over.monthly_trend ?? [] },
  } as unknown as FleetAnalytics;
}

function makeQuery(over: Partial<FleetAnalyticsQuery> = {}): FleetAnalyticsQuery {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  } as unknown as FleetAnalyticsQuery;
}

function renderTab(query: FleetAnalyticsQuery) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <OverviewTab query={query} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Locate a data panel by its heading and return the panel root for scoping. */
function panelByTitle(title: string | RegExp): HTMLElement {
  const heading = screen.getByRole('heading', { level: 3, name: title });
  const panel = heading.closest('[data-print-card]');
  if (!panel) throw new Error(`no panel root for heading "${String(title)}"`);
  return panel as HTMLElement;
}

/** Parse the serialized `data` prop surfaced by a mocked chart inside a panel. */
function seriesOf(panel: HTMLElement, testid: 'bar-chart' | 'composed-chart'): Array<Record<string, unknown>> {
  const chart = within(panel).getByTestId(testid);
  return JSON.parse(chart.getAttribute('data-series') ?? '[]') as Array<Record<string, unknown>>;
}

const DASH = '\u2014';

const FULL = {
  vehicle_comparison: [
    vehicle({ id: 1, name: 'Model 3', distance: 100, energy: 15, efficiency: 150, drives: 20 }),
    vehicle({ id: 2, name: 'Model Y', distance: 50, energy: 9, efficiency: 180, drives: 8 }),
  ],
  day_of_week: [
    { day: 'Mon', drives: 4, distance: 40, avg_distance: 10 },
    { day: 'Tue', drives: 2, distance: 30, avg_distance: 15 },
  ],
  monthly_trend: [
    { month: '2026-05', energy: 200, cost: 24, sessions: 6, avg_power: 40, gas_cost: 60, savings: 36 },
  ],
};

beforeEach(() => {
  mockUseSettings.mockReturnValue(settingsFor('km'));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OverviewTab — loading state', () => {
  it('shows a skeleton + busy panel for every own section while withholding the charts, and keeps the Quick Links band', () => {
    const { container } = renderTab(makeQuery({ isLoading: true }));

    // Each own panel keeps its titled chrome — never a fully blank section.
    expect(panelByTitle(/Distance by Vehicle/i)).toBeInTheDocument();
    expect(panelByTitle(/Day of Week Pattern/i)).toBeInTheDocument();
    expect(panelByTitle(/Monthly Cost Comparison/i)).toBeInTheDocument();

    // Three own panels each render a loading skeleton and are announced busy.
    expect(screen.getAllByRole('status')).toHaveLength(3);
    expect(container.querySelectorAll('[data-print-card][aria-busy="true"]').length).toBe(3);

    // No chart series leak while loading.
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('composed-chart')).not.toBeInTheDocument();

    // The static Quick Links band renders regardless of query state.
    expect(screen.getByRole('heading', { level: 3, name: /Quick Links/i })).toBeInTheDocument();
  });
});

describe('OverviewTab — error state', () => {
  it('surfaces a retryable QueryError in every own panel and wires the CTA to refetch', () => {
    const refetch = vi.fn();
    renderTab(makeQuery({ isError: true, error: new Error('boom'), refetch }));

    // Plain Error → QueryError's offline-network copy, one per own panel.
    expect(screen.getAllByText(/Can't reach server/i)).toHaveLength(3);
    // Charts stay hidden behind the error gate even though data is undefined.
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();

    // Retrying the Distance panel calls the query's refetch exactly once.
    const distancePanel = panelByTitle(/Distance by Vehicle/i);
    fireEvent.click(within(distancePanel).getByRole('button', { name: /^Retry$/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('OverviewTab — empty state', () => {
  it('renders each own panel’s bespoke empty copy (never a blank panel) when the payload has no rows', () => {
    renderTab(makeQuery({ data: fleetData() }));

    expect(within(panelByTitle(/Distance by Vehicle/i)).getByText('No vehicle data')).toBeInTheDocument();
    expect(within(panelByTitle(/Day of Week Pattern/i)).getByText('No day-of-week data')).toBeInTheDocument();
    expect(within(panelByTitle(/Monthly Cost Comparison/i)).getByText('No monthly data')).toBeInTheDocument();

    // No chart is mounted for an empty payload.
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('composed-chart')).not.toBeInTheDocument();
  });
});

describe('OverviewTab — ready state (metric)', () => {
  it('feeds the Distance chart the km-converted series keyed by vehicle name with the unit-named bar', () => {
    renderTab(makeQuery({ data: fleetData(FULL) }));

    const panel = panelByTitle(/Distance by Vehicle/i);
    const data = seriesOf(panel, 'bar-chart');
    // km path: SI-km value passes straight through (× 1000 m ÷ 1000 = km).
    expect(data).toEqual([
      { name: 'Model 3', distance: 100 },
      { name: 'Model Y', distance: 50 },
    ]);

    // Category axis + the single value bar, whose name is the display unit.
    expect(within(panel).getByTestId('x-axis')).toHaveAttribute('data-key', 'name');
    const bar = within(panel).getByTestId('bar');
    expect(bar).toHaveAttribute('data-key', 'distance');
    expect(bar).toHaveAttribute('data-name', 'Distance (km)');
  });

  it('feeds the Day of Week chart its payload verbatim with a drives bar + avg-distance line', () => {
    renderTab(makeQuery({ data: fleetData(FULL) }));

    const panel = panelByTitle(/Day of Week Pattern/i);
    expect(seriesOf(panel, 'composed-chart')).toEqual(FULL.day_of_week);

    expect(within(panel).getByTestId('x-axis')).toHaveAttribute('data-key', 'day');
    expect(within(panel).getByTestId('bar')).toHaveAttribute('data-key', 'drives');
    expect(within(panel).getByTestId('line')).toHaveAttribute('data-key', 'avg_distance');
  });

  it('feeds the Monthly Cost chart its payload with electric + gas cost bars and a savings line', () => {
    renderTab(makeQuery({ data: fleetData(FULL) }));

    const panel = panelByTitle(/Monthly Cost Comparison/i);
    expect(seriesOf(panel, 'composed-chart')).toEqual(FULL.monthly_trend);

    expect(within(panel).getByTestId('x-axis')).toHaveAttribute('data-key', 'month');
    const bars = within(panel).getAllByTestId('bar').map((b) => b.getAttribute('data-key'));
    expect(bars).toEqual(['cost', 'gas_cost']);
    expect(within(panel).getByTestId('line')).toHaveAttribute('data-key', 'savings');
  });
});

describe('OverviewTab — ready state (imperial)', () => {
  it('re-expresses the Distance series in miles and flips the bar unit name when the user prefers imperial', () => {
    mockUseSettings.mockReturnValue(settingsFor('mi'));
    renderTab(makeQuery({ data: fleetData(FULL) }));

    const panel = panelByTitle(/Distance by Vehicle/i);
    const data = seriesOf(panel, 'bar-chart');
    // 100 km → 62.137 mi, 50 km → 31.069 mi (genuine lib conversion).
    expect(data[0].name).toBe('Model 3');
    expect(data[0].distance as number).toBeCloseTo(62.137, 2);
    expect(data[1].distance as number).toBeCloseTo(31.069, 2);

    expect(within(panel).getByTestId('bar')).toHaveAttribute('data-name', 'Distance (mi)');
  });
});

describe('OverviewTab — null safety', () => {
  it('degrades a vehicle missing its name/distance to an em-dash label and a safe 0 (not undefined/NaN), still rendering the chart', () => {
    const query = makeQuery({
      data: fleetData({ vehicle_comparison: [{ id: 9, energy: 1, efficiency: 1, drives: 1 }] }),
    });
    renderTab(query);

    const panel = panelByTitle(/Distance by Vehicle/i);
    const data = seriesOf(panel, 'bar-chart');
    expect(data).toEqual([{ name: DASH, distance: 0 }]);
    // The value is a real 0, never a NaN sentinel.
    expect(Number.isNaN(data[0].distance)).toBe(false);

    // A present-but-empty stat is NOT the empty state — the chart still mounts.
    expect(within(panel).getByTestId('bar-chart')).toBeInTheDocument();
    expect(within(panel).queryByText('No vehicle data')).not.toBeInTheDocument();
  });
});

describe('OverviewTab — quick links', () => {
  it('renders all five links with the right hrefs + i18n labels and hides each link’s decorative icon', () => {
    renderTab(makeQuery({ data: fleetData(FULL) }));

    const expected: Array<[string, string]> = [
      ['statistics', '/statistics'],
      ['compare', '/period-compare'],
      ['weeklyDigest', '/weekly-digest'],
      ['mileage', '/mileage'],
      ['timeline', '/timeline'],
    ];
    for (const [label, href] of expected) {
      const link = screen.getByRole('link', { name: label });
      expect(link).toHaveAttribute('href', href);
      // The leading icon in each link is wrapped as decorative for AT so the
      // accessible name is the label alone.
      expect(link.querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
  });
});

describe('OverviewTab — composition + a11y', () => {
  it('threads the same query into the vehicle-comparison sibling and labels the overview grid as a region', () => {
    renderTab(makeQuery({ data: fleetData(FULL) }));

    // The query flags flow through to the composed sibling untouched.
    const child = screen.getByTestId('vehicle-comparison');
    expect(child).toHaveAttribute('data-loading', 'false');
    expect(child).toHaveAttribute('data-error', 'false');

    // The bento grid is exposed as a labelled landmark region.
    expect(screen.getByRole('region', { name: /Overview/i })).toBeInTheDocument();
  });

  it('reflects a loading query into the composed sibling', () => {
    renderTab(makeQuery({ isLoading: true }));
    expect(screen.getByTestId('vehicle-comparison')).toHaveAttribute('data-loading', 'true');
  });
});
