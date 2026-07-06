/**
 * WallConnectorWidget — behaviour, responsive-branch + hardening coverage.
 *
 * The widget is the dashboard's Tesla Wall Connector charging-energy tile. Its
 * surface under test:
 *
 *   1. Responsive layout branches keyed off `size.cols`:
 *        - compact (cols ≤ 1) → a title-less shell with This-Month + Sessions
 *          stats and NO chart (the per-session average is dropped).
 *        - standard (2 cols)  → a titled shell + a 3-up stat row (This Month /
 *          Sessions / Avg-per-Session) + a bar chart, using the *small* ticks.
 *        - wide (cols ≥ 3)    → the same, but with the *large* axis ticks.
 *   2. `chartData`: the daily aggregation unique to this widget — multiple
 *      individual charging entries on the same calendar day are *summed* into a
 *      single Wh→kWh bar (`energy_wh / 1000`), sorted ascending by day, with the
 *      timezone-stable `shortDate` label derived straight off the ISO string.
 *   3. The month maths: This-Month total / Sessions count / Avg-per-Session,
 *      with prior-month entries excluded by the hardened `isSameMonth`.
 *   4. The chart-axis/tooltip formatters flow through the shared `fmt` /
 *      `fmtNumber` helpers (Y-axis integer ticks, tooltip "x.x kWh" + "Energy").
 *   5. Loading / error / empty branches (never a blank panel). Crucially, a
 *      *sites* fetch failure surfaces the shared error panel rather than the
 *      misleading "no site linked" empty state (the R-A hardening).
 *   6. Vehicle-agnostic site resolution: the first energy site's id is passed to
 *      the history hook; with no site the history hook is called with
 *      `undefined` (disabled) and the "no site linked" empty state shows.
 *   7. Freshness-control refresh → refetch (both hooks when a site exists, only
 *      the sites hook when none does).
 *   8. Null-safety of a malformed payload: a non-array history and a `null`
 *      entry must degrade cleanly instead of throwing at `.filter` / `.slice`.
 *   9. a11y: the chart is exposed as a single labelled image.
 *
 * Strategy (mirrors SolarProductionWidget.test.tsx):
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
    useTeslaWCChargingHistory: (...args: unknown[]) => historyMock(...args),
  };
});

// Replace the shared charts barrel with prop-echoing doubles. The BarChart
// echoes its `data` array as JSON so the daily-aggregation + label math is
// inspectable; the axis/tooltip doubles invoke the widget's real formatters so
// the unit wiring is exercised.
vi.mock('@/components/charts', () => ({
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
  Bar: ({ dataKey, name, fill }: Record<string, unknown>) => (
    <div
      data-testid="bar"
      data-key={String(dataKey ?? '')}
      data-name={String(name ?? '')}
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
}));

import WallConnectorWidget from './WallConnectorWidget';
import type { WidgetSize } from './types';
import type { TeslaEnergySite, TeslaWCChargingEntry } from '@/types/energy';

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

function makeEntry(timestamp: string, energy_wh: number | null): TeslaWCChargingEntry {
  return {
    id: 1,
    energy_site_id: 555,
    din: null,
    timestamp,
    energy_wh,
    fetched_at: '2024-03-04T00:00:00Z',
  };
}

// Two entries share 2024-03-01 (1 + 2 = 3 kWh) and one is 2024-03-02 (4 kWh).
// None is in the current month, so the month stats stay at zero here.
const HISTORY: TeslaWCChargingEntry[] = [
  makeEntry('2024-03-01T08:00:00Z', 1000),
  makeEntry('2024-03-01T18:00:00Z', 2000),
  makeEntry('2024-03-02T10:00:00Z', 4000),
];

// A pair of current-month entries (+ one long-past) used by the month-maths and
// compact specs. Built from `now` so it is timezone- and calendar-stable.
function currentMonthPrefix(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }) {
  return render(
    <MemoryRouter>
      <WallConnectorWidget size={size} />
    </MemoryRouter>,
  );
}

interface Row {
  date: string;
  energy_kwh: number;
}

function chartRows(): Row[] {
  return JSON.parse(screen.getByTestId('bar-chart').getAttribute('data-json') ?? '[]');
}

beforeEach(() => {
  sitesMock.mockReset();
  historyMock.mockReset();
  sitesMock.mockReturnValue(makeQuery({ data: [makeSite()] }));
  historyMock.mockReturnValue(makeQuery({ data: HISTORY }));
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('WallConnectorWidget', () => {
  it('standard layout renders the titled shell, 3 stats and the energy bar chart', () => {
    renderWidget();

    // Titled shell — no gutted panel.
    expect(screen.getByText('Wall Connector')).toBeInTheDocument();

    for (const label of ['This Month', 'Sessions', 'Avg / Session']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Two of the three stats carry the kWh unit (Sessions is a bare count).
    expect(screen.getAllByText('kWh')).toHaveLength(2);

    // The bar is wired to the energy series with the emerald fill.
    const bar = screen.getByTestId('bar');
    expect(bar).toHaveAttribute('data-key', 'energy_kwh');
    expect(bar).toHaveAttribute('data-name', 'Energy');
    expect(bar).toHaveAttribute('data-fill', '#10b981');

    // Standard layout uses the small axis ticks.
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-ticksize', 'sm');
  });

  it('sums multiple same-day entries into one Wh→kWh bar, sorted ascending', () => {
    renderWidget();

    // 2024-03-01 aggregates 1000 + 2000 Wh → 3 kWh; 2024-03-02 → 4 kWh.
    expect(chartRows()).toEqual([
      { date: '3/1', energy_kwh: 3 },
      { date: '3/2', energy_kwh: 4 },
    ]);
  });

  it('derives timezone-stable date labels straight from the ISO string', () => {
    // Late-UTC datetimes: the hardened shortDate reads the calendar date off the
    // string prefix, so the labels never drift by a day in negative-offset zones.
    historyMock.mockReturnValue(
      makeQuery({
        data: [makeEntry('2024-12-31T23:30:00Z', 1000), makeEntry('2024-01-05T23:30:00Z', 2000)],
      }),
    );
    renderWidget();

    // Sorted ascending by day key → 2024-01-05 before 2024-12-31.
    expect(chartRows().map((r) => r.date)).toEqual(['1/5', '12/31']);
  });

  it('computes This-Month total / Sessions / Avg, excluding prior-month entries', () => {
    const ym = currentMonthPrefix();
    historyMock.mockReturnValue(
      makeQuery({
        data: [
          makeEntry(`${ym}-10T12:00:00Z`, 2000), // 2 kWh this month
          makeEntry(`${ym}-20T12:00:00Z`, 4000), // 4 kWh this month
          makeEntry('2020-01-01T12:00:00Z', 9000), // long past — must be excluded
        ],
      }),
    );
    renderWidget();

    // Total 2 + 4 = 6.0 kWh (the 9 kWh past entry is excluded), 2 sessions,
    // average 3.0 kWh/session.
    expect(screen.getByText('This Month')).toBeInTheDocument();
    expect(screen.getByText('6.0')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3.0')).toBeInTheDocument();
  });

  it('labels the Y axis and tooltip through the shared fmt / fmtNumber helpers', () => {
    renderWidget();

    // Y-axis tickFormatter(1234) → fmt(1234, 0) → "1234".
    expect(screen.getByTestId('y-axis')).toHaveAttribute('data-tick', '1234');

    // Tooltip formatter(2.5) → ["2.5 kWh", "Energy"].
    const fmtAttr = screen.getByTestId('tooltip').getAttribute('data-fmt') ?? '';
    expect(fmtAttr).toContain('2.5 kWh');
    expect(fmtAttr).toContain('Energy');
  });

  it('exposes the chart as a single labelled image for assistive tech', () => {
    renderWidget();

    const chart = screen.getByRole('img', {
      name: 'Daily Wall Connector charging energy over the last 14 days',
    });
    expect(chart).toBeInTheDocument();
    // The recharts subtree lives inside the labelled image.
    expect(chart.querySelector('[data-testid="bar-chart"]')).toBeInTheDocument();
  });

  it('uses the large axis ticks in the wide layout', () => {
    renderWidget({ cols: 4, rows: 2 });
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-ticksize', 'lg');
  });

  it('compact layout shows This-Month + Sessions, no title, no chart, no average', () => {
    const ym = currentMonthPrefix();
    historyMock.mockReturnValue(
      makeQuery({ data: [makeEntry(`${ym}-10T12:00:00Z`, 3000)] }), // 3 kWh, 1 session
    );
    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('This Month')).toBeInTheDocument();
    expect(screen.getByText('3.0')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    // Only the This-Month stat carries a unit in compact.
    expect(screen.getAllByText('kWh')).toHaveLength(1);

    // Compact is title-less, drops the per-session average, and never mounts
    // the chart.
    expect(screen.queryByText('Wall Connector')).not.toBeInTheDocument();
    expect(screen.queryByText('Avg / Session')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('compact layout shows the empty state when there is no Wall Connector data', () => {
    historyMock.mockReturnValue(makeQuery({ data: [] }));
    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('No Wall Connector data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('This Month')).not.toBeInTheDocument();
  });

  it('shows the "no site linked" empty state and disables the history query', () => {
    sitesMock.mockReturnValue(makeQuery({ data: [] }));
    historyMock.mockReturnValue(makeQuery({ data: [] }));
    renderWidget();

    expect(screen.getByText('No Tesla Energy site linked')).toBeInTheDocument();
    // Genuinely-empty, not a fetch failure.
    expect(screen.queryByText('No Wall Connector data')).not.toBeInTheDocument();
    // With no site the history hook is called with an undefined id (disabled).
    expect(historyMock).toHaveBeenCalledWith(undefined, expect.any(String));
  });

  it('surfaces the error panel (not "no site linked") when the sites fetch fails', () => {
    // R-A hardening: previously a sites error fell through to the misleading
    // "no site linked" empty state because that branch ignored `sitesError`.
    sitesMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The misleading empty state / title must NOT appear on error.
    expect(screen.queryByText('No Tesla Energy site linked')).not.toBeInTheDocument();
    expect(screen.queryByText('Wall Connector')).not.toBeInTheDocument();
    // The error branch replaces the header, so there is no refresh control.
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('shows the no-data empty state (keeping the titled shell) with a linked site', () => {
    historyMock.mockReturnValue(makeQuery({ data: [] }));
    renderWidget();

    expect(screen.getByText('Wall Connector')).toBeInTheDocument();
    expect(screen.getByText('No Wall Connector data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Stats + chart are not rendered while empty.
    expect(screen.queryByText('Avg / Session')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('renders a skeleton placeholder while the sites query is loading', () => {
    sitesMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('Wall Connector')).not.toBeInTheDocument();
  });

  it('renders a skeleton while the history query loads for a linked site', () => {
    sitesMock.mockReturnValue(makeQuery({ data: [makeSite()] }));
    historyMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('Wall Connector')).not.toBeInTheDocument();
  });

  it('surfaces the error panel (not the empty state) when the history query fails', () => {
    sitesMock.mockReturnValue(makeQuery({ data: [makeSite()] }));
    historyMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No Wall Connector data')).not.toBeInTheDocument();
    expect(screen.queryByText('Wall Connector')).not.toBeInTheDocument();
  });

  it('refreshes both the sites and history queries when a site is linked', () => {
    const s = makeQuery({ data: [makeSite()] });
    const h = makeQuery({ data: HISTORY });
    sitesMock.mockReturnValue(s);
    historyMock.mockReturnValue(h);
    renderWidget();

    const refresh = screen.getByRole('button', { name: 'Refresh' });
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

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refresh);
    expect(s.refetch).toHaveBeenCalledTimes(1);
    expect(h.refetch).not.toHaveBeenCalled();
  });

  it('is null-safe: a null entry among valid rows degrades without crashing', () => {
    historyMock.mockReturnValue(
      makeQuery({ data: [null, makeEntry('2024-03-01T08:00:00Z', 1000)] }),
    );

    expect(() => renderWidget()).not.toThrow();

    const rows = chartRows();
    // The null entry is skipped; only the valid 2024-03-01 bucket survives.
    expect(rows).toEqual([{ date: '3/1', energy_kwh: 1 }]);
  });

  it('is null-safe: a non-array history payload renders the empty state', () => {
    historyMock.mockReturnValue(makeQuery({ data: 'not-an-array' }));

    expect(() => renderWidget()).not.toThrow();
    expect(screen.getByText('No Wall Connector data')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('passes the first energy site id to the history hook', () => {
    sitesMock.mockReturnValue(makeQuery({ data: [makeSite({ energy_site_id: 777 })] }));
    renderWidget();

    expect(historyMock).toHaveBeenCalledWith(777, expect.any(String));
  });
});
