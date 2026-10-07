/**
 * CostForecastWidget — behaviour, responsive-branch + hardening coverage.
 *
 * The widget is the dashboard's charging-cost forecast tile. Its surface under
 * test:
 *
 *   1. Responsive layout branches keyed off `size.cols`:
 *        - compact (cols ≤ 1) → a title-less shell with the next-month cost and
 *          a bare trend arrow (↑ / ↓), no chart.
 *        - standard (2 cols)  → a titled shell + a 3-up stat row (Next Month /
 *          Avg $/kWh / Trend) + a bar chart, using the *small* axis ticks.
 *        - wide (cols ≥ 3)    → the same, but with the *large* axis ticks.
 *   2. `buildChartData`: it folds historical + forecast rows onto one month
 *      axis, tags each row with `isForecast`, and windows to the trailing 6
 *      months (`.slice(-6)`), so a long history + forecast keeps the newest.
 *   3. The trend maths + header icon: `nextCost >= lastCost` flips the icon
 *      between the amber TrendingUp and the emerald TrendingDown glyph, and the
 *      Trend stat shows the signed delta.
 *   4. The currency-aware chart axes/tooltip (real formatter → the Y axis and
 *      the tooltip carry the user currency symbol, not a hardcoded literal).
 *   5. Loading / error / empty branches (never a blank panel). The error branch
 *      surfaces the shared QueryError panel — a fetch failure must be
 *      distinguishable from genuinely-empty data.
 *   6. Freshness-control refresh → refetch.
 *   7. Null-safety of a malformed / partial payload: a non-array `historical`
 *      and a `null` forecast entry must degrade cleanly (em-dash placeholders,
 *      zeroed costs) instead of throwing at `.map`.
 *   8. a11y: the chart is exposed as a single labelled image.
 *   9. Vehicle selection: an explicit `vehicleId` wins, otherwise the first
 *      vehicle from `useVehicles` is used, otherwise the hook is disabled.
 *
 * Strategy (mirrors ChargingOptimizerWidget.test.tsx / BatteryDegradationTrendWidget.test.tsx):
 *   - The data hook + useVehicles are mocked with hoisted vi.fn()s so the
 *     network is never touched and every render is deterministic.
 *   - `@/components/charts` is replaced with prop-echoing DOM doubles so the
 *     chart path renders under jsdom (recharts' ResponsiveContainer measures
 *     0×0 otherwise) and the derived data / formatters are genuinely assertable.
 *   - `useFormatting` is pinned to a deterministic `$`-symbol formatter so the
 *     displayed currency strings are exact.
 *   - react-i18next resolves the developer fallback string.
 *   - matchMedia is shimmed to report reduced motion so framer-motion (read by
 *     the freshness chip) settles deterministically.
 *   - Renders are wrapped in <MemoryRouter> because the error branch mounts
 *     <QueryError>, which calls `useNavigate`.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * dashboard tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (useReducedMotion, read by the
// freshness chip) reads it at module load. Report reduced motion so the
// freshness dot settles deterministically.
vi.hoisted(() => {
  if (typeof window !== 'undefined') {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

const { forecastMock, vehiclesMock } = vi.hoisted(() => ({
  forecastMock: vi.fn(),
  vehiclesMock: vi.fn(),
}));

// i18n → return the developer fallback string, interpolating `{{vars}}`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useCharging', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useCharging')>('@/api/hooks/useCharging');
  return { ...actual, useCostForecast: (...args: unknown[]) => forecastMock(...args) };
});

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>('@/api/hooks/useVehicles');
  return { ...actual, useVehicles: () => vehiclesMock() };
});

// Deterministic currency formatter so the displayed strings are exact and the
// axis/tooltip assertions prove the symbol flows from settings, not a literal.
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    currencySymbol: '$',
    formatCurrency: (amount: number, decimals = 2) =>
      `$${Number(amount ?? 0).toFixed(Math.max(0, Math.min(20, decimals)))}`,
  }),
}));

// Replace the shared charts barrel with prop-echoing doubles. The BarChart
// echoes its `data` array as JSON so the fold + windowing math are inspectable;
// the axis/tooltip doubles invoke the widget's real formatters so the currency
// wiring is exercised.
vi.mock('@/components/charts', async () => {
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
  ...chartTestDoubles,
  chartGrid: null,
  chartMargin: {},
  chartAnimation: {},
  axisTick: { size: 'lg' },
  axisTickSm: { size: 'sm' },
  fmt: (v: unknown, decimals = 1) =>
    Number((v as number) ?? 0).toFixed(Math.max(0, Math.min(20, decimals))),
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
    <div data-testid="bar-chart" data-json={JSON.stringify(data ?? [])}>
      {children}
    </div>
  ),
  Bar: ({ dataKey, fill, name }: Record<string, unknown>) => (
    <div
      data-testid="bar"
      data-key={String(dataKey ?? '')}
      data-fill={String(fill ?? '')}
      data-name={String(name ?? '')}
    />
  ),
  XAxis: ({ dataKey, tick }: Record<string, unknown>) => (
    <div
      data-testid="x-axis"
      data-key={String(dataKey ?? '')}
      data-ticksize={String((tick as { size?: string })?.size ?? '')}
    />
  ),
  YAxis: ({ tickFormatter }: { tickFormatter?: (v: number) => string }) => (
    <div
      data-testid="y-axis"
      data-tick={typeof tickFormatter === 'function' ? String(tickFormatter(100)) : ''}
    />
  ),
  Tooltip: ({ formatter }: { formatter?: (v: number) => unknown }) => (
    <div
      data-testid="tooltip"
      data-fmt={typeof formatter === 'function' ? JSON.stringify(formatter(130)) : ''}
    />
  ),
  };
});

import CostForecastWidget from './CostForecastWidget';
import type { WidgetSize } from './types';
import type { CostForecastData, CostHistoricalMonth, CostForecastMonth } from '@/types/charging';

/* ── Fixtures ─────────────────────────────────────────────────────── */

const HIST: CostHistoricalMonth[] = [
  { month: 'Jan', cost: 100, kwh: 500, sessions: 10, cost_per_kwh: 0.15 },
  { month: 'Feb', cost: 110, kwh: 520, sessions: 11, cost_per_kwh: 0.16 },
  { month: 'Mar', cost: 120, kwh: 540, sessions: 12, cost_per_kwh: 0.18 },
];

const FORE: CostForecastMonth[] = [
  { month: 'Apr', cost: 130, cost_low: 110, cost_high: 150, kwh: 560 },
  { month: 'May', cost: 140, cost_low: 115, cost_high: 170, kwh: 580 },
];

function makeData(overrides: Record<string, unknown> = {}): CostForecastData {
  return {
    historical: HIST,
    forecast: FORE,
    breakdown: {},
    gas_comparison: {},
    insights: [],
    ...overrides,
  } as unknown as CostForecastData;
}

interface FakeQuery {
  data?: unknown;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<FakeQuery> = {}): FakeQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <CostForecastWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

interface Row {
  month: string;
  cost: number;
  isForecast: boolean;
}

function chartRows(): Row[] {
  return JSON.parse(screen.getByTestId('bar-chart').getAttribute('data-json') ?? '[]');
}

beforeEach(() => {
  forecastMock.mockReset();
  vehiclesMock.mockReset();
  forecastMock.mockReturnValue(makeQuery({ data: makeData() }));
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('CostForecastWidget', () => {
  it('standard layout renders the titled shell, 3 stats and the cost bar chart', () => {
    const { container } = renderWidget();

    // Titled shell — no gutted panel.
    expect(screen.getByText('Cost Forecast')).toBeInTheDocument();

    for (const label of ['Next Month', 'Avg $/kWh', 'Trend']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Real formatter output: next month cost (0 decimals) + avg $/kWh (2 dp).
    expect(screen.getByText('$130')).toBeInTheDocument();
    expect(screen.getByText('$0.18')).toBeInTheDocument();

    // Trend up (130 ≥ 120) → signed delta + the amber TrendingUp header glyph.
    expect(screen.getByText('↑ $10')).toBeInTheDocument();
    expect(container.querySelector('.text-amber-400')).toBeInTheDocument();
    expect(container.querySelector('.text-emerald-400')).toBeNull();

    // The bar is wired to the cost series.
    const bar = screen.getByTestId('bar');
    expect(bar).toHaveAttribute('data-key', 'cost');
    expect(bar).toHaveAttribute('data-name', 'Cost');
  });

  it('folds history + forecast onto one month axis and tags forecast rows', () => {
    renderWidget();

    const rows = chartRows();
    expect(rows).toHaveLength(5); // 3 historical + 2 forecast
    expect(rows.map((r) => r.month)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May']);
    // Only the two projected months are flagged as forecast.
    expect(rows.filter((r) => r.period === 'forecast')).toHaveLength(2);
    expect(rows[3]).toEqual({ month: 'Apr', cost: 130, period: 'forecast' });
  });

  it('windows a long history + forecast to the trailing 6 months', () => {
    const bigHist: CostHistoricalMonth[] = Array.from({ length: 5 }, (_v, i) => ({
      month: `H${i}`,
      cost: (i + 1) * 10,
      kwh: 1,
      sessions: 1,
      cost_per_kwh: 0.1,
    }));
    const bigFore: CostForecastMonth[] = Array.from({ length: 3 }, (_v, i) => ({
      month: `F${i}`,
      cost: (i + 1) * 100,
      cost_low: 1,
      cost_high: 1,
      kwh: 1,
    }));
    forecastMock.mockReturnValue(makeQuery({ data: makeData({ historical: bigHist, forecast: bigFore }) }));
    renderWidget();

    const rows = chartRows();
    // 8 combined months clamp to the newest 6 — the two oldest history months drop.
    expect(rows).toHaveLength(6);
    expect(rows[0].month).toBe('H2');
    // All three forecast months survive the trailing window.
    expect(rows.filter((r) => r.period === 'forecast')).toHaveLength(3);
  });

  it('flips to the TrendingDown glyph and a negative delta when cost is falling', () => {
    const fallingFore: CostForecastMonth[] = [
      { month: 'Apr', cost: 110, cost_low: 90, cost_high: 130, kwh: 560 },
    ];
    forecastMock.mockReturnValue(makeQuery({ data: makeData({ forecast: fallingFore }) }));
    const { container } = renderWidget();

    // nextCost 110 < lastCost 120 → "↓ $10" + emerald TrendingDown glyph.
    expect(screen.getByText('↓ $10')).toBeInTheDocument();
    expect(container.querySelector('.text-emerald-400')).toBeInTheDocument();
    expect(container.querySelector('.text-amber-400')).toBeNull();
  });

  it('labels the Y axis and tooltip with the user currency (not a hardcoded literal)', () => {
    renderWidget();

    // Y-axis tickFormatter(100) → "$" + fmt(100, 0) = "$100".
    expect(screen.getByTestId('y-axis')).toHaveAttribute('data-tick', '$100');

    // Tooltip formatter(130) → [formatCurrency(130), 'Cost'].
    const fmt = screen.getByTestId('tooltip').getAttribute('data-fmt') ?? '';
    expect(fmt).toContain('$130.00');
    expect(fmt).toContain('Cost');
  });

  it('exposes the chart as a single labelled image for assistive tech', () => {
    renderWidget();

    const chart = screen.getByRole('img', {
      name: 'Monthly charging cost history and forecast',
    });
    expect(chart).toBeInTheDocument();
    // The recharts subtree lives inside the labelled image.
    expect(chart.querySelector('[data-testid="bar-chart"]')).toBeInTheDocument();
  });

  it('uses the small axis ticks in the standard layout and large ticks when wide', () => {
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-ticksize', 'sm');

    forecastMock.mockReturnValue(makeQuery({ data: makeData() }));
    renderWidget({ cols: 4, rows: 2 });
    // Two renders → two x-axes; the wide one carries the large ticks.
    const axes = screen.getAllByTestId('x-axis');
    expect(axes.some((a) => a.getAttribute('data-ticksize') === 'lg')).toBe(true);
  });

  it('compact layout shows the next-month cost + a bare trend arrow, no title or chart', () => {
    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('Next Month')).toBeInTheDocument();
    expect(screen.getByText('$130')).toBeInTheDocument();
    expect(screen.getByText('↑')).toBeInTheDocument();

    // Compact is title-less and never mounts the chart.
    expect(screen.queryByText('Cost Forecast')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    expect(screen.queryByText('Avg $/kWh')).not.toBeInTheDocument();
  });

  it('shows the empty state (keeping the titled shell) when there is no data', () => {
    forecastMock.mockReturnValue(makeQuery({ data: undefined }));
    renderWidget();

    expect(screen.getByText('Cost Forecast')).toBeInTheDocument();
    expect(screen.getByText('No forecast data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Stats + chart are not rendered while empty.
    expect(screen.queryByText('Next Month')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('compact layout shows the empty state when there is no data', () => {
    forecastMock.mockReturnValue(makeQuery({ data: undefined }));
    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('No forecast data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('$130')).not.toBeInTheDocument();
  });

  it('renders a skeleton placeholder while the query is loading', () => {
    forecastMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    // No content while loading.
    expect(screen.queryByText('Cost Forecast')).not.toBeInTheDocument();
    expect(screen.queryByText('Next Month')).not.toBeInTheDocument();
  });

  it('surfaces the error panel (not the empty state) when the query fails', () => {
    forecastMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The misleading "no data" empty state must NOT appear on error.
    expect(screen.queryByText('No forecast data')).not.toBeInTheDocument();
    expect(screen.queryByText('Cost Forecast')).not.toBeInTheDocument();
    // The error branch replaces the header, so there is no refresh control.
    expect(screen.queryByRole('button', { name: /Refresh data/ })).not.toBeInTheDocument();
  });

  it('refreshes the forecast when the freshness control is activated', () => {
    const q = makeQuery({ data: makeData() });
    forecastMock.mockReturnValue(q);
    renderWidget();

    const refresh = screen.getByRole('button', { name: /Refresh data/ });
    expect(q.refetch).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('is null-safe: a non-array history + a null forecast entry degrade without crashing', () => {
    forecastMock.mockReturnValue(
      makeQuery({
        data: {
          historical: 'not-an-array',
          forecast: [null],
          breakdown: {},
          gas_comparison: {},
          insights: [],
        } as unknown as CostForecastData,
      }),
    );

    expect(() => renderWidget()).not.toThrow();

    // Non-array history → no last month → em-dash Avg; null forecast → $0 next.
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    // The null forecast entry coerces to a single zero-cost em-dash bar.
    const rows = chartRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ month: '—', cost: 0, period: 'forecast' });
  });

  it('falls back to the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget();
    expect(forecastMock).toHaveBeenCalledWith('7');
  });

  it('uses the explicit vehicleId prop over the vehicle list', () => {
    renderWidget({ cols: 2, rows: 2 }, 42);
    expect(forecastMock).toHaveBeenCalledWith('42');
  });

  it('disables the query (null) when no vehicle can be resolved', () => {
    vehiclesMock.mockReturnValue({ data: [] });
    renderWidget();
    expect(forecastMock).toHaveBeenCalledWith(null);
  });
});
