/**
 * OverviewVehicleComparison — behaviour + hardening coverage.
 *
 * OverviewVehicleComparison renders the four fleet-comparison panels of the
 * Analytics → Overview tab as a bare fragment of <AnalyticsPanel>s:
 *   1. Fleet Usage        — a distance-share donut (SI km → active unit).
 *   2. Efficiency Leaderboard — ranked bars (lower Wh/km = better = fuller bar).
 *   3. Vehicle Comparison — a normalised radar (needs 2+ vehicles).
 *   4. Energy & Activity  — an energy/drives bar chart.
 * Every panel owns its own loading / error / empty state, so the charts must
 * never all vanish behind a single `{data && …}` gate.
 *
 * This suite drives every branch:
 *   - loading  → every panel renders a skeleton; no chart is drawn.
 *   - empty    → all four panels surface the shared empty state (one per panel).
 *   - error    → all four panels render a retryable QueryError; clicking Retry
 *     is wired to the query's refetch, and the banner wins over stale data.
 *   - populated→ all three charts render, each series binds its dataKey, every
 *     chart is an accessible image, and the leaderboard ranks + fills correctly.
 *   - leaderboard→ the hardening payload. The leader (smallest positive Wh/km)
 *     now fills the bar to 100 % and less-efficient vehicles taper off; the
 *     previous raw ratio inverted this so the *worst* vehicle got the fullest
 *     bar. This is the real bug the tests pin.
 *   - units    → the donut distance-share and the leaderboard efficiency label
 *     project SI km / Wh-km into the user's unit through the REAL
 *     convertDistanceFromSI, and the donut's accessible label relabels.
 *   - radar    → below 2 vehicles the radar shows its empty state while the
 *     other three panels still populate.
 *   - null-safe→ a vehicle full of nulls collapses to safe zeros — never NaN.
 *
 * Only the recharts barrel is doubled (ResponsiveContainer measures 0×0 in
 * jsdom so series data would be unobservable): each chart surfaces its `data`
 * prop as JSON and each series surfaces its dataKey binding. `useOnlineStatus`
 * is pinned online so QueryError stays on its retryable branch, and
 * `useSettings` is a mutable double so the unit branch is testable. Everything
 * else — <AnalyticsPanel>, <EmptyState>, <QueryError>, <Skeleton>, <Text>, the
 * real useUnits + lib/unitConversion + lib/numberFormat — renders for real, so
 * the wiring is exercised end-to-end. Network is never touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/feedback';
import type { ReactNode } from 'react';
import type { FleetAnalytics } from '@/api/types';
import { OverviewVehicleComparison } from './OverviewVehicleComparison';
import type { FleetAnalyticsQuery } from './constants';

// ── i18n: echo the English fallback (2nd arg) so assertions read on copy. ──
vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown): string =>
    typeof fallback === 'string' ? fallback : key;
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── keep QueryError on its online "Can't reach server" branch (enabled Retry). ──
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

// ── Mutable settings double so the unit branch is testable. The real
//    useUnits + lib/unitConversion run on top of this, so conversion is real. ──
const settingsRef = vi.hoisted(() => ({
  unit_of_length: 'km' as 'km' | 'mi',
}));

vi.mock('@/hooks/useSettings', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return {
    ...actual,
    useSettings: () => ({
      settings: {
        unit_of_length: settingsRef.unit_of_length,
        unit_of_temp: 'C',
        unit_of_pressure: 'bar',
        locale: 'en-US',
        decimal_precision: 2,
      },
      isMiles: settingsRef.unit_of_length === 'mi',
      isFahrenheit: false,
      isPSI: false,
      decimals: 2,
      locale: 'en-US',
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  };
});

// ── recharts barrel double: ResponsiveContainer passes children through, each
//    chart surfaces its `data` prop (as JSON), each series surfaces its dataKey
//    binding, and the donut surfaces its projected `data` array + one <Cell>
//    per slice so the page-computed conversions are directly assertable. ──
vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const Inert = () => null;
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const makeChart =
    (testid: string) =>
    ({ data, children }: { data?: unknown; children?: ReactNode }) => (
      <div data-testid={testid}>
        <span data-testid={`${testid}-data`}>{JSON.stringify(data ?? [])}</span>
        {children}
      </div>
    );
  const Series = ({
    dataKey,
    name,
    stroke,
  }: {
    dataKey?: string;
    name?: string;
    stroke?: string;
  }) => (
    <span
      data-testid={`series-${String(dataKey ?? '')}`}
      data-key={String(dataKey ?? '')}
      data-name={String(name ?? '')}
      data-stroke={String(stroke ?? '')}
    />
  );
  const Pie = ({ data, children }: { data?: unknown; children?: ReactNode }) => (
    <div data-testid="pie">
      <span data-testid="pie-data">{JSON.stringify(data ?? [])}</span>
      {children}
    </div>
  );
  const Cell = ({ fill }: { fill?: string }) => (
    <span data-testid="pie-cell" data-fill={String(fill ?? '')} />
  );
  return {
    ...actual,
    ChartTooltip: Inert,
    chartGrid: null,
    axisTick: {},
    axisTickSm: {},
    chartMarginLabeled: {},
    chartAnimation: {},
    safe: (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0),
    CHART_COLORS: ['#c0', '#c1', '#c2', '#c3', '#c4', '#c5'],
    ResponsiveContainer: Passthrough,
    BarChart: makeChart('chart-bar'),
    RadarChart: makeChart('chart-radar'),
    PieChart: makeChart('chart-pie'),
    Bar: Series,
    Radar: Series,
    Pie,
    Cell,
    PolarGrid: Inert,
    PolarAngleAxis: Inert,
    XAxis: Inert,
    YAxis: Inert,
    Tooltip: Inert,
    Legend: Inert,
  };
});

// ── data builders ────────────────────────────────────────────────────────────

type Vehicle = Record<string, unknown>;

/** One vehicle_comparison row. SI: distance km, energy kWh, efficiency Wh/km. */
function veh(over: Vehicle = {}): Vehicle {
  return { id: 1, name: 'Alpha', distance: 100, energy: 50, efficiency: 150, drives: 10, ...over };
}

function analytics(vehicles: Vehicle[]): FleetAnalytics {
  return { vehicle_comparison: vehicles } as unknown as FleetAnalytics;
}

/** Two vehicles: Alpha is more efficient (150 Wh/km) than Bravo (300 Wh/km). */
const TWO: Vehicle[] = [
  veh({ id: 1, name: 'Alpha', distance: 100, energy: 50, efficiency: 150, drives: 10 }),
  veh({ id: 2, name: 'Bravo', distance: 300, energy: 90, efficiency: 300, drives: 4 }),
];

interface QueryOverride {
  data?: FleetAnalytics | undefined;
  error?: Error | null;
  isLoading?: boolean;
  isError?: boolean;
  refetch?: () => void;
}

function makeQuery(over: QueryOverride = {}): FleetAnalyticsQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  } as unknown as FleetAnalyticsQuery;
}

function renderCmp(query: FleetAnalyticsQuery) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <OverviewVehicleComparison query={query} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

type Row = Record<string, number | string>;

/** The donut's projected [{ name, value }] payload. */
function pieRows(): Array<{ name: string; value: number }> {
  return JSON.parse(screen.getByTestId('pie-data').textContent || '[]');
}
/** The radar's normalised rows (one per metric spoke). */
function radarRows(): Row[] {
  return JSON.parse(screen.getByTestId('chart-radar-data').textContent || '[]');
}
/** The energy bar chart's raw vehicle rows. */
function barRows(): Row[] {
  return JSON.parse(screen.getByTestId('chart-bar-data').textContent || '[]');
}
/** Inline widths of every leaderboard fill bar, in render (ranked) order. */
function leaderboardWidths(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="efficiency-leader-fill"]')).map(
    (el) => el.style.width,
  );
}
/** dataKeys bound to the energy bar chart's series. */
function barSeriesKeys(): string[] {
  return within(screen.getByTestId('chart-bar'))
    .getAllByTestId(/^series-/)
    .map((el) => el.getAttribute('data-key') || '');
}
/** names bound to the radar chart's per-vehicle series. */
function radarSeriesNames(): string[] {
  return within(screen.getByTestId('chart-radar'))
    .getAllByTestId(/^series-/)
    .map((el) => el.getAttribute('data-name') || '');
}

beforeEach(() => {
  settingsRef.unit_of_length = 'km';
});

// ── Loading ────────────────────────────────────────────────────────────────

describe('OverviewVehicleComparison — loading', () => {
  it('renders skeletons in every panel and draws no chart', () => {
    const { container } = renderCmp(makeQuery({ isLoading: true }));

    // Panel titles frame all four sections even while loading…
    expect(screen.getByText('Fleet Usage')).toBeInTheDocument();
    expect(screen.getByText('Efficiency Leaderboard')).toBeInTheDocument();
    expect(screen.getByText('Vehicle Comparison')).toBeInTheDocument();
    expect(screen.getByText('Energy & Activity')).toBeInTheDocument();

    // …pulsing skeletons are on screen…
    expect(container.querySelector('.animate-pulse')).not.toBeNull();

    // …and no chart / leaderboard row has been drawn yet.
    expect(screen.queryByTestId('chart-pie')).toBeNull();
    expect(screen.queryByTestId('chart-radar')).toBeNull();
    expect(screen.queryByTestId('chart-bar')).toBeNull();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});

// ── Empty ──────────────────────────────────────────────────────────────────

describe('OverviewVehicleComparison — empty', () => {
  it('shows one empty state per panel and draws no chart', () => {
    renderCmp(makeQuery({ data: analytics([]) }));

    // Four panels → four independent empty states (not one page-level gate).
    expect(screen.getAllByRole('status')).toHaveLength(4);
    // "No vehicle data" backs both the donut and the energy bar chart.
    expect(screen.getAllByText('No vehicle data')).toHaveLength(2);
    expect(screen.getByText('No efficiency data')).toBeInTheDocument();
    expect(screen.getByText('Need 2+ vehicles for comparison')).toBeInTheDocument();

    // No chart on the empty branch.
    expect(screen.queryByTestId('chart-pie')).toBeNull();
    expect(screen.queryByTestId('chart-bar')).toBeNull();
  });
});

// ── Error ──────────────────────────────────────────────────────────────────

describe('OverviewVehicleComparison — error', () => {
  it('renders a retryable error in every panel and wires Retry to refetch', () => {
    const refetch = vi.fn();
    renderCmp(makeQuery({ isError: true, error: new Error('boom'), refetch }));

    // One QueryError per panel, all on the online (retryable) branch.
    expect(screen.getAllByRole('alert')).toHaveLength(4);
    expect(screen.getAllByText("Can't reach server")).toHaveLength(4);

    const retries = screen.getAllByRole('button', { name: /retry/i });
    expect(retries).toHaveLength(4);

    fireEvent.click(retries[0]);
    expect(refetch).toHaveBeenCalledTimes(1);

    // The error banner is shown instead of any chart.
    expect(screen.queryByTestId('chart-pie')).toBeNull();
  });

  it('prioritises the error banner over stale data', () => {
    // Even if TanStack Query retained the last-good payload, isError wins.
    renderCmp(makeQuery({ isError: true, error: new Error('stale'), data: analytics(TWO) }));
    expect(screen.getAllByText("Can't reach server")).toHaveLength(4);
    expect(screen.queryByTestId('chart-radar')).toBeNull();
  });
});

// ── Populated ────────────────────────────────────────────────────────────────

describe('OverviewVehicleComparison — populated', () => {
  it('renders all three charts, their series, and one cell per vehicle', () => {
    renderCmp(makeQuery({ data: analytics(TWO) }));

    expect(screen.getByTestId('chart-pie')).toBeInTheDocument();
    expect(screen.getByTestId('chart-radar')).toBeInTheDocument();
    expect(screen.getByTestId('chart-bar')).toBeInTheDocument();

    // The energy bar chart binds both series; the radar binds one per vehicle.
    expect(barSeriesKeys()).toEqual(['energy', 'drives']);
    expect(radarSeriesNames()).toEqual(['Alpha', 'Bravo']);

    // One donut slice (<Cell>) per vehicle.
    expect(screen.getAllByTestId('pie-cell')).toHaveLength(2);
  });

  it('exposes each chart as an accessible image with a unit-aware donut label', () => {
    renderCmp(makeQuery({ data: analytics(TWO) }));

    // The static donut is an image; charts with interactive legends are groups.
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getAllByRole('group')).toHaveLength(2);
    expect(
      screen.getByRole('img', { name: 'Fleet distance share by vehicle (km)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Normalized vehicle metric comparison' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Energy and drive count by vehicle' }),
    ).toBeInTheDocument();
  });

  it('binds the energy bar chart to the raw SI vehicle rows', () => {
    renderCmp(makeQuery({ data: analytics(TWO) }));

    const rows = barRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Alpha', energy: 50, drives: 10 });
    expect(rows[1]).toMatchObject({ name: 'Bravo', energy: 90, drives: 4 });
  });

  it('normalises every radar spoke into the 0–100 band', () => {
    renderCmp(makeQuery({ data: analytics(TWO) }));

    const rows = radarRows();
    // Four spokes: distance, energy, drives, efficiency.
    expect(rows).toHaveLength(4);
    const distance = rows.find((r) => r.metric === 'Distance')!;
    // Bravo has the larger distance (300 vs 100) → it pins the spoke at 100.
    expect(distance.Bravo).toBe(100);
    expect(distance.Alpha).toBeCloseTo((100 / 300) * 100, 5);
    // Efficiency is inverted: the *more* efficient Alpha (150) scores higher.
    const efficiency = rows.find((r) => r.metric === 'Efficiency')!;
    expect(Number(efficiency.Alpha)).toBeGreaterThan(Number(efficiency.Bravo));
  });
});

// ── Efficiency leaderboard (the hardening payload / bug fix) ──────────────────

describe('OverviewVehicleComparison — efficiency leaderboard', () => {
  it('ranks most-efficient first and fills the leader bar fullest', () => {
    const { container } = renderCmp(makeQuery({ data: analytics(TWO) }));

    // Ranked ascending by Wh/km → Alpha (150) is #1, Bravo (300) is #2.
    expect(screen.getByText('#1 Alpha')).toBeInTheDocument();
    expect(screen.getByText('#2 Bravo')).toBeInTheDocument();

    // The FIX: the leader fills to 100 % and the less-efficient vehicle tapers
    // to bestEff/eff = 150/300 = 50 %. Previously this was inverted (worst =
    // 100 %). Widths are in render (ranked) order.
    const widths = leaderboardWidths(container);
    expect(widths).toEqual(['100%', '50%']);
  });

  it('labels each row with its efficiency in the active unit', () => {
    renderCmp(makeQuery({ data: analytics(TWO) }));

    expect(screen.getByText('150.0 Wh/km')).toBeInTheDocument();
    expect(screen.getByText('300.0 Wh/km')).toBeInTheDocument();
  });
});

// ── Distance-unit branch ─────────────────────────────────────────────────────

describe('OverviewVehicleComparison — miles preference', () => {
  it('projects the donut share + efficiency label into miles and relabels', () => {
    settingsRef.unit_of_length = 'mi';
    renderCmp(makeQuery({ data: analytics(TWO) }));

    // 100 km → ~62.14 mi and 300 km → ~186.41 mi through the REAL converter.
    const rows = pieRows();
    expect(rows[0].value).toBeCloseTo(62.14, 1);
    expect(rows[0].value).not.toBe(100);
    expect(rows[1].value).toBeCloseTo(186.41, 1);

    // Efficiency Wh/km → Wh/mi (× 1.609344): 150 → 241.4.
    expect(screen.getByText('241.4 Wh/mi')).toBeInTheDocument();

    // The donut's accessible label follows the active unit.
    expect(
      screen.getByRole('img', { name: 'Fleet distance share by vehicle (mi)' }),
    ).toBeInTheDocument();
  });
});

// ── Radar 2-vehicle threshold ────────────────────────────────────────────────

describe('OverviewVehicleComparison — radar threshold', () => {
  it('shows the radar empty state with a single vehicle while other panels populate', () => {
    renderCmp(makeQuery({ data: analytics([veh({ id: 7, name: 'Solo' })]) }));

    // The radar needs 2+ vehicles → its own empty state, not a blank panel.
    expect(screen.getByText('Need 2+ vehicles for comparison')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-radar')).toBeNull();

    // …but the donut, leaderboard and energy bar still render for the one car.
    expect(screen.getByTestId('chart-pie')).toBeInTheDocument();
    expect(screen.getByTestId('chart-bar')).toBeInTheDocument();
    expect(screen.getByText('#1 Solo')).toBeInTheDocument();
    // The donut is an image, the interactive energy chart is a group, and
    // the radar is an empty state.
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Energy and drive count by vehicle' })).toBeInTheDocument();
  });
});

// ── Null-safety ──────────────────────────────────────────────────────────────

describe('OverviewVehicleComparison — null-safety', () => {
  it('collapses a null-filled vehicle to safe zeros, never NaN', () => {
    const { container } = renderCmp(
      makeQuery({
        data: analytics([
          veh({ id: 1, name: 'Alpha', distance: 100, energy: 50, efficiency: 150, drives: 10 }),
          { id: 2, name: 'Ghost', distance: null, energy: null, efficiency: null, drives: null },
        ]),
      }),
    );

    // The donut share for the null vehicle is 0, not NaN.
    const ghost = pieRows().find((r) => r.name === 'Ghost')!;
    expect(ghost.value).toBe(0);
    expect(Number.isNaN(ghost.value)).toBe(false);

    // The radar's normalised rows never leak NaN or null into the payload.
    const radarJson = screen.getByTestId('chart-radar-data').textContent || '';
    expect(radarJson).not.toContain('NaN');
    expect(radarJson).not.toContain('null');

    // Every leaderboard bar width is a finite percentage — no "NaN%".
    const widths = leaderboardWidths(container);
    expect(widths.some((w) => w.includes('NaN'))).toBe(false);
    // Alpha (the only positive efficiency) still fills to 100 %.
    expect(widths).toContain('100%');
  });
});
