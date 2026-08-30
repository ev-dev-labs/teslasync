/**
 * GasPriceTrendChart — behaviour + hardening coverage.
 *
 * The component owns four mutually-exclusive branches driven by a single
 * `UseQueryResult` prop: error → loading → empty → populated chart. This suite
 * drives every branch and asserts the real branch selection, the newest-first →
 * chronological reversal, the null-safe price mapping, the currency-formatted Y
 * axis, the palette-derived series colour, and the accessibility affordances
 * (loading `role="status"`, chart `role="img"`).
 *
 * Only the leaf primitives that can't render in jsdom are doubled: the recharts
 * barrel (`ResponsiveContainer` renders 0×0 in jsdom, so the series/data would
 * be unobservable) and the two display hooks (`useChartPalette` / `useFormatting`,
 * whose real implementations reach TanStack Query for settings). The shared
 * feedback + ui components (`QueryError`, `EmptyState`, `Skeleton`, `GlassPanel`,
 * `PanelTitle`) are the REAL implementations so the rendered roles/copy are
 * genuinely exercised. Network is never touched.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

import type { GasPriceHistory } from '@/api/types';
import { formatDate } from '@/lib/dateFormat';
import { GasPriceTrendChart } from './GasPriceTrendChart';

// ── i18n: resolve the string fallback (2nd arg) so assertions read on copy. ──
vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown): string =>
    typeof fallback === 'string' ? fallback : key;
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── display hooks: deterministic, network-free doubles. palette[3] is the
//    colour the component picks; formatCurrency is the Y-axis tick formatter. ──
vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => ['#111111', '#222222', '#333333', '#33d1c3'],
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number, decimals?: number) => `$${amount.toFixed(decimals ?? 2)}`,
  }),
}));

// ── keep QueryError on its online "Can't reach server" branch (enabled Retry). ──
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

// ── recharts barrel double: ResponsiveContainer renders its children so the
//    AreaChart double can surface the page-computed `data` (as JSON) plus the
//    series binding + the Y-axis tick formatter's output for direct assertion. ──
vi.mock('@/components/charts', async () => {
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  const Inert = () => null;
  return {
    EmbeddedChart: chartTestDoubles.EmbeddedChart,
    AREA_DEFAULTS: {},
    areaGradient: () => null,
    ChartTooltip: Inert,
    CartesianGrid: Inert,
    Tooltip: Inert,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AreaChart: ({
      data,
      children,
    }: {
      data?: ReadonlyArray<Record<string, unknown>>;
      children?: ReactNode;
    }) => (
      <div data-testid="area-chart">
        <span data-testid="area-chart-data">{JSON.stringify(data ?? [])}</span>
        {children}
      </div>
    ),
    Area: ({ dataKey, name, stroke }: { dataKey?: string; name?: string; stroke?: string }) => (
      <span
        data-testid="area-series"
        data-key={String(dataKey ?? '')}
        data-name={String(name ?? '')}
        data-stroke={String(stroke ?? '')}
      />
    ),
    XAxis: ({ dataKey }: { dataKey?: string }) => (
      <span data-testid="x-axis" data-key={String(dataKey ?? '')} />
    ),
    YAxis: ({ tickFormatter }: { tickFormatter?: (v: number) => string }) => (
      <span data-testid="y-tick">
        {typeof tickFormatter === 'function' ? tickFormatter(3) : ''}
      </span>
    ),
  };
});

interface QueryOverride {
  data?: GasPriceHistory[] | undefined;
  error?: Error | null;
  isLoading?: boolean;
  isError?: boolean;
  refetch?: () => void;
}

function makeQuery(over: QueryOverride = {}): UseQueryResult<GasPriceHistory[], Error> {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  } as unknown as UseQueryResult<GasPriceHistory[], Error>;
}

function makeHistory(over: Partial<GasPriceHistory> = {}): GasPriceHistory {
  return {
    id: 1,
    price_per_unit: 3.0,
    unit: 'gallon',
    efficiency_mpg: 25,
    effective_from: '2026-01-01T00:00:00Z',
    effective_to: null,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

// The API returns rows newest-first; the component must reverse to chronological.
const HISTORY: GasPriceHistory[] = [
  makeHistory({ id: 3, price_per_unit: 3.5, effective_from: '2026-03-01T00:00:00Z' }),
  makeHistory({ id: 2, price_per_unit: 3.2, effective_from: '2026-02-01T00:00:00Z' }),
  makeHistory({ id: 1, price_per_unit: 3.0, effective_from: '2026-01-01T00:00:00Z' }),
];

function renderChart(query: UseQueryResult<GasPriceHistory[], Error>) {
  return render(
    <MemoryRouter>
      <GasPriceTrendChart query={query} />
    </MemoryRouter>,
  );
}

/** Parse the JSON the AreaChart double received as its `data` prop. */
function readRows(): Array<{ date: string; price: number }> {
  return JSON.parse(screen.getByTestId('area-chart-data').textContent || '[]');
}

describe('GasPriceTrendChart — panel chrome', () => {
  it('always renders the panel title regardless of state', () => {
    renderChart(makeQuery({ data: HISTORY }));
    expect(screen.getByText('Price Trend')).toBeInTheDocument();
  });
});

describe('GasPriceTrendChart — loading', () => {
  it('shows an accessible loading skeleton and withholds the chart on first load', () => {
    const { container } = renderChart(makeQuery({ isLoading: true, data: undefined }));

    // EmbeddedChart in loading state renders a skeleton (animate-pulse).
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    // The title still frames the panel while loading.
    expect(screen.getByText('Price Trend')).toBeInTheDocument();
  });

  it('does not flash the loading skeleton once rows exist (background refetch)', () => {
    // isLoading true but data already present → the chart stays, no skeleton.
    renderChart(makeQuery({ isLoading: true, data: HISTORY }));
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('GasPriceTrendChart — empty', () => {
  it('shows the no-history empty state when the list is loaded but empty', () => {
    renderChart(makeQuery({ data: [] }));
    expect(screen.getByText(/No price history recorded yet/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('treats undefined data (idle, not loading, not error) as empty', () => {
    renderChart(makeQuery({ data: undefined, isLoading: false }));
    expect(screen.getByText(/No price history recorded yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });
});

describe('GasPriceTrendChart — error', () => {
  it('renders a retryable QueryError and hides the chart on failure', () => {
    const refetch = vi.fn();
    renderChart(makeQuery({ isError: true, error: new Error('boom'), refetch }));

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('prioritises the error banner over stale data', () => {
    // Even with last-good rows retained by TanStack Query, isError wins.
    renderChart(makeQuery({ isError: true, error: new Error('stale'), data: HISTORY }));
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });
});

describe('GasPriceTrendChart — populated', () => {
  it('exposes the chart as an accessible image with a descriptive label', () => {
    renderChart(makeQuery({ data: HISTORY }));
    expect(
      screen.getByRole('img', { name: 'Line chart of historical gas prices over time' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
  });

  it('reverses newest-first history into chronological order and formats the dates', () => {
    renderChart(makeQuery({ data: HISTORY }));
    const rows = readRows();

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.price)).toEqual([3.0, 3.2, 3.5]);
    // Oldest first after the reversal; dates run through the real formatDate.
    expect(rows[0].date).toBe(formatDate('2026-01-01T00:00:00Z'));
    expect(rows[2].date).toBe(formatDate('2026-03-01T00:00:00Z'));
  });

  it('coerces a null price_per_unit to 0 (null-safe mapping)', () => {
    renderChart(
      makeQuery({
        data: [
          makeHistory({
            id: 9,
            price_per_unit: null as unknown as number,
            effective_from: '2026-05-01T00:00:00Z',
          }),
        ],
      }),
    );
    expect(readRows()[0].price).toBe(0);
  });

  it('formats the Y-axis ticks as currency via useFormatting', () => {
    renderChart(makeQuery({ data: HISTORY }));
    // tickFormatter(3) → formatCurrency(3) → "$3.00".
    expect(screen.getByTestId('y-tick')).toHaveTextContent('$3.00');
  });

  it('binds the price series to the palette[3] stroke colour', () => {
    renderChart(makeQuery({ data: HISTORY }));
    const series = screen.getByTestId('area-series');
    expect(series).toHaveAttribute('data-key', 'price');
    expect(series).toHaveAttribute('data-name', 'Price');
    expect(series).toHaveAttribute('data-stroke', '#33d1c3');
  });

  it('does not mutate the source query data array in place', () => {
    const data = HISTORY.slice();
    renderChart(makeQuery({ data }));
    // The component copies before reverse(): the source stays newest-first.
    expect(data.map((h) => h.id)).toEqual([3, 2, 1]);
  });
});
