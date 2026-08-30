/**
 * SolarProductionWidget — behaviour, responsive-branch + hardening coverage.
 *
 * The widget is the dashboard's Tesla-Energy solar-production tile. Its surface
 * under test:
 *
 *   1. Responsive layout branches keyed off `size.cols`:
 *        - compact (cols ≤ 1) → a title-less shell with Today + Daily-Avg
 *          stats and NO chart.
 *        - standard (2 cols)  → a titled shell + a 3-up stat row (Today /
 *          30-Day Total / Daily Avg) + an area chart, using the *small* ticks.
 *        - wide (cols ≥ 3)    → the same, but with the *large* axis ticks.
 *   2. `chartData`: Wh→kWh scaling (`solar_energy_wh / 1000`) and the
 *      timezone-stable `shortDate` label derivation (the hardened source parses
 *      the calendar date straight off the ISO string, so "2024-12-31" stays
 *      "12/31" instead of shifting a day back in negative-offset zones).
 *   3. The Today/Total/Avg maths, including the em-dash-free `0.0` today value
 *      when no bucket matches the current UTC date.
 *   4. The chart-axis/tooltip formatters flow through the shared `fmt` /
 *      `fmtNumber` helpers (Y-axis integer ticks, tooltip "x.x kWh" + "Solar").
 *   5. Loading / error / empty branches (never a blank panel). Crucially, a
 *      *sites* fetch failure must surface the shared error panel rather than the
 *      misleading "no site linked" empty state (the R-A hardening).
 *   6. Vehicle-agnostic site resolution: the first energy site's id is passed to
 *      the history hook; with no site the history hook is called with
 *      `undefined` (disabled) and the "no site linked" empty state shows.
 *   7. Freshness-control refresh → refetch (both hooks when a site exists, only
 *      the sites hook when none does).
 *   8. Null-safety of a malformed payload: a non-array history and a `null`
 *      entry must degrade cleanly instead of throwing at `.map`.
 *   9. a11y: the chart is exposed as a single labelled image.
 *
 * Strategy (mirrors CostForecastWidget.test.tsx / AnalyticsSummaryWidget.test.tsx):
 *   - The two energy hooks are mocked with hoisted vi.fn()s so the network is
 *     never touched and every render is deterministic.
 *   - `@/components/charts` is replaced with prop-echoing DOM doubles so the
 *     chart path renders under jsdom (recharts' ResponsiveContainer measures
 *     0×0 otherwise) and the derived data / formatters are genuinely assertable.
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

const { sitesMock, historyMock } = vi.hoisted(() => ({
  sitesMock: vi.fn(),
  historyMock: vi.fn(),
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

vi.mock('@/api/hooks/useEnergy', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useEnergy')>(
    '@/api/hooks/useEnergy',
  );
  return {
    ...actual,
    useTeslaEnergySites: (...args: unknown[]) => sitesMock(...args),
    useTeslaEnergyHistory: (...args: unknown[]) => historyMock(...args),
  };
});

// Replace the shared charts barrel with prop-echoing doubles. The AreaChart
// echoes its `data` array as JSON so the Wh→kWh + label math is inspectable;
// the axis/tooltip doubles invoke the widget's real formatters so the unit
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
  AreaChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
    <div data-testid="area-chart" data-json={JSON.stringify(data ?? [])}>
      {children}
    </div>
  ),
  Area: ({ dataKey, name, stroke, fill }: Record<string, unknown>) => (
    <div
      data-testid="area"
      data-key={String(dataKey ?? '')}
      data-name={String(name ?? '')}
      data-stroke={String(stroke ?? '')}
      data-fill={String(fill ?? '')}
    />
  ),
  XAxis: ({ dataKey, tick }: { dataKey?: unknown; tick?: { size?: string } }) => (
    <div
      data-testid="x-axis"
      data-key={String(dataKey ?? '')}
      data-ticksize={String(tick?.size ?? '')}
    />
  ),
  YAxis: ({ tickFormatter }: { tickFormatter?: (v: number) => string }) => (
    <div
      data-testid="y-axis"
      data-tick={typeof tickFormatter === 'function' ? String(tickFormatter(1234)) : ''}
    />
  ),
  Tooltip: ({ formatter }: { formatter?: (v: number) => unknown }) => (
    <div
      data-testid="tooltip"
      data-fmt={typeof formatter === 'function' ? JSON.stringify(formatter(2.5)) : ''}
    />
  ),
  };
});

import SolarProductionWidget from './SolarProductionWidget';
import type { WidgetSize } from './types';
import type { TeslaEnergySite, TeslaEnergyHistoryEntry } from '@/types/energy';

/* ── Fixtures ─────────────────────────────────────────────────────── */

function makeSite(overrides: Partial<TeslaEnergySite> = {}): TeslaEnergySite {
  return {
    id: 1,
    energy_site_id: 555,
    resource_type: 'battery',
    site_name: 'Home',
    gateway_id: null,
    total_pack_energy: null,
    percentage_charged: null,
    battery_type: null,
    backup_capable: true,
    storm_mode_enabled: false,
    has_solar: true,
    has_battery: true,
    has_grid: true,
    has_load_meter: true,
    tou_capable: true,
    storm_mode_capable: true,
    fetched_at: '2024-03-04T00:00:00Z',
    created_at: '2024-03-04T00:00:00Z',
    updated_at: '2024-03-04T00:00:00Z',
    site_info_fetched_at: null,
    ...overrides,
  };
}

function makeEntry(
  timestamp: string,
  solar_energy_wh: number | null,
): TeslaEnergyHistoryEntry {
  return {
    id: 1,
    energy_site_id: 555,
    period: 'day',
    timestamp,
    solar_energy_wh,
    battery_energy_in_wh: null,
    battery_energy_out_wh: null,
    grid_energy_in_wh: null,
    grid_energy_out_wh: null,
    consumer_energy_wh: null,
    fetched_at: '2024-03-04T00:00:00Z',
  };
}

// 1 + 3 + 2 = 6 kWh total, avg 2.0, none is "today" (2024-03).
const HISTORY: TeslaEnergyHistoryEntry[] = [
  makeEntry('2024-03-01T00:00:00Z', 1000),
  makeEntry('2024-03-02T00:00:00Z', 3000),
  makeEntry('2024-03-03T00:00:00Z', 2000),
];

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

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }) {
  return render(
    <MemoryRouter>
      <SolarProductionWidget size={size} />
    </MemoryRouter>,
  );
}

interface Row {
  date: string;
  solar_kwh: number;
}

function chartRows(): Row[] {
  return JSON.parse(screen.getByTestId('area-chart').getAttribute('data-json') ?? '[]');
}

beforeEach(() => {
  sitesMock.mockReset();
  historyMock.mockReset();
  sitesMock.mockReturnValue(makeQuery({ data: [makeSite()] }));
  historyMock.mockReturnValue(makeQuery({ data: HISTORY }));
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('SolarProductionWidget', () => {
  it('standard layout renders the titled shell, 3 stats and the solar area chart', () => {
    renderWidget();

    // Titled shell — no gutted panel.
    expect(screen.getByText('Solar Production')).toBeInTheDocument();

    for (const label of ['Today', '30-Day Total', 'Daily Avg']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Real formatter output: today 0.0 (no bucket for today), total 6, avg 2.0.
    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('2.0')).toBeInTheDocument();
    // Every stat carries the kWh unit.
    expect(screen.getAllByText('kWh')).toHaveLength(3);

    // The area is wired to the solar series with the amber stroke.
    const area = screen.getByTestId('area');
    expect(area).toHaveAttribute('data-key', 'solar_kwh');
    expect(area).toHaveAttribute('data-name', 'Solar');
    expect(area).toHaveAttribute('data-stroke', '#facc15');

    // Standard layout uses the small axis ticks.
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-ticksize', 'sm');
  });

  it('scales Wh→kWh and derives the chart series from the history payload', () => {
    renderWidget();

    expect(chartRows()).toEqual([
      { date: '3/1', solar_kwh: 1 },
      { date: '3/2', solar_kwh: 3 },
      { date: '3/3', solar_kwh: 2 },
    ]);
  });

  it('derives timezone-stable date labels straight from the ISO string', () => {
    // A bare date and a late-UTC datetime: the hardened shortDate reads the
    // calendar date off the string, so the labels never drift by a day.
    historyMock.mockReturnValue(
      makeQuery({
        data: [makeEntry('2024-12-31', 1000), makeEntry('2024-01-05T23:30:00Z', 2000)],
      }),
    );
    renderWidget();

    expect(chartRows().map((r) => r.date)).toEqual(['12/31', '1/5']);
  });

  it("surfaces the current day's production in the Today stat", () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    historyMock.mockReturnValue(
      makeQuery({
        data: [
          makeEntry(`${todayIso}T00:00:00Z`, 5000), // 5 kWh today
          makeEntry('2020-01-01T00:00:00Z', 1000), // 1 kWh, long past
        ],
      }),
    );
    renderWidget();

    // Today matches by date prefix → 5.0; total 6, avg 3.0.
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('5.0')).toBeInTheDocument();
    expect(screen.getByText('3.0')).toBeInTheDocument();
  });

  it('labels the Y axis and tooltip through the shared fmt / fmtNumber helpers', () => {
    renderWidget();

    // Y-axis tickFormatter(1234) → fmt(1234, 0) → "1234".
    expect(screen.getByTestId('y-axis')).toHaveAttribute('data-tick', '1234');

    // Tooltip formatter(2.5) → ["2.5 kWh", "Solar"].
    const fmtAttr = screen.getByTestId('tooltip').getAttribute('data-fmt') ?? '';
    expect(fmtAttr).toContain('2.5 kWh');
    expect(fmtAttr).toContain('Solar');
  });

  it('exposes the chart as a single labelled image for assistive tech', () => {
    renderWidget();

    const chart = screen.getByRole('img', {
      name: 'Daily solar production over the last 30 days',
    });
    expect(chart).toBeInTheDocument();
    // The recharts subtree lives inside the labelled image.
    expect(chart.querySelector('[data-testid="area-chart"]')).toBeInTheDocument();
  });

  it('uses the large axis ticks in the wide layout', () => {
    renderWidget({ cols: 4, rows: 2 });
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-ticksize', 'lg');
  });

  it('compact layout shows the Today + Daily-Avg stats, no title or chart', () => {
    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Daily Avg')).toBeInTheDocument();
    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.getByText('2.0')).toBeInTheDocument();
    expect(screen.getAllByText('kWh')).toHaveLength(2);

    // Compact is title-less, never mounts the chart, and drops the 30-day stat.
    expect(screen.queryByText('Solar Production')).not.toBeInTheDocument();
    expect(screen.queryByText('30-Day Total')).not.toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('compact layout shows the empty state when there is no solar data', () => {
    historyMock.mockReturnValue(makeQuery({ data: [] }));
    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('No solar data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Today')).not.toBeInTheDocument();
  });

  it('shows the "no site linked" empty state and disables the history query', () => {
    sitesMock.mockReturnValue(makeQuery({ data: [] }));
    historyMock.mockReturnValue(makeQuery({ data: [] }));
    renderWidget();

    expect(screen.getByText('No Tesla Energy site linked')).toBeInTheDocument();
    // Genuinely-empty, not a fetch failure.
    expect(screen.queryByText('No solar data')).not.toBeInTheDocument();
    // With no site the history hook is called with an undefined id (disabled).
    expect(historyMock).toHaveBeenCalledWith(undefined, 'day', expect.any(String));
  });

  it('surfaces the error panel (not "no site linked") when the sites fetch fails', () => {
    // R-A hardening: previously a sites error fell through to the misleading
    // "no site linked" empty state because that branch passed error={null}.
    sitesMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The misleading empty state / title must NOT appear on error.
    expect(screen.queryByText('No Tesla Energy site linked')).not.toBeInTheDocument();
    expect(screen.queryByText('Solar Production')).not.toBeInTheDocument();
    // The error branch replaces the header, so there is no refresh control.
    expect(screen.queryByRole('button', { name: /^Refresh/i })).not.toBeInTheDocument();
  });

  it('shows the no-data empty state (keeping the titled shell) with a linked site', () => {
    historyMock.mockReturnValue(makeQuery({ data: [] }));
    renderWidget();

    expect(screen.getByText('Solar Production')).toBeInTheDocument();
    expect(screen.getByText('No solar data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Stats + chart are not rendered while empty.
    expect(screen.queryByText('30-Day Total')).not.toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('renders a skeleton placeholder while the sites query is loading', () => {
    sitesMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('Solar Production')).not.toBeInTheDocument();
  });

  it('renders a skeleton while the history query loads for a linked site', () => {
    sitesMock.mockReturnValue(makeQuery({ data: [makeSite()] }));
    historyMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('Solar Production')).not.toBeInTheDocument();
  });

  it('surfaces the error panel (not the empty state) when the history query fails', () => {
    sitesMock.mockReturnValue(makeQuery({ data: [makeSite()] }));
    historyMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No solar data')).not.toBeInTheDocument();
    expect(screen.queryByText('Solar Production')).not.toBeInTheDocument();
  });

  it('refreshes both the sites and history queries when a site is linked', () => {
    const s = makeQuery({ data: [makeSite()] });
    const h = makeQuery({ data: HISTORY });
    sitesMock.mockReturnValue(s);
    historyMock.mockReturnValue(h);
    renderWidget();

    const refresh = screen.getByRole('button', { name: /Refresh data/ });
    expect(s.refetch).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    expect(s.refetch).toHaveBeenCalledTimes(1);
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes only the sites query from the "no site linked" state', () => {
    const s = makeQuery({ data: [] });
    const h = makeQuery({ data: [] });
    sitesMock.mockReturnValue(s);
    historyMock.mockReturnValue(h);
    renderWidget();

    const refresh = screen.getByRole('button', { name: /Refresh data/ });
    fireEvent.click(refresh);
    expect(s.refetch).toHaveBeenCalledTimes(1);
    expect(h.refetch).not.toHaveBeenCalled();
  });

  it('is null-safe: a null entry among valid rows degrades without crashing', () => {
    historyMock.mockReturnValue(
      makeQuery({ data: [null, makeEntry('2024-03-01T00:00:00Z', 1000)] }),
    );

    expect(() => renderWidget()).not.toThrow();

    const rows = chartRows();
    expect(rows).toHaveLength(2);
    // The null entry coerces to an empty label + zero-kWh datum.
    expect(rows[0]).toEqual({ date: '', solar_kwh: 0 });
    expect(rows[1]).toEqual({ date: '3/1', solar_kwh: 1 });
  });

  it('is null-safe: a non-array history payload renders the empty state', () => {
    historyMock.mockReturnValue(makeQuery({ data: 'not-an-array' }));

    expect(() => renderWidget()).not.toThrow();
    expect(screen.getByText('No solar data')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('passes the first energy site id to the history hook', () => {
    sitesMock.mockReturnValue(makeQuery({ data: [makeSite({ energy_site_id: 777 })] }));
    renderWidget();

    expect(historyMock).toHaveBeenCalledWith(777, 'day', expect.any(String));
  });
});
