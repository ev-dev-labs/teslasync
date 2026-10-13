/**
 * TripListPage — behaviour + hardening coverage.
 *
 * The page exposes a single default export (the multi-drive trip report). Its
 * internal building blocks (`TripStatsBand`, `TopTripsChart`, `TripEnergyPanel`,
 * `TripCard`) and the private `formatDuration` helper are NOT exported, so this
 * suite drives every one of them through the rendered page by mocking the data
 * hooks (`useTrips`), the selected vehicle, and the unit / currency formatters.
 *
 * The SI → display converter (`@/lib/unitConversion.convertDistanceFromSI`), the
 * energy formatter (`formatEnergy`), the number formatters (`@/lib/numberFormat`)
 * and the date helper (`@/lib/dateFormat`) are the REAL implementations, so the
 * render-boundary maths is genuinely exercised: every expected value below is
 * derived from the raw SI fixture via those same helpers, never hard-coded, so
 * the assertions verify the page's own independent aggregation + conversion.
 * The chart barrel, framer-motion, the mobile pull-to-refresh, the saved-view
 * menu and the header form controls are jsdom-hostile or pull their own data —
 * they are replaced with faithful inert doubles. Network is never touched.
 *
 * Facets covered:
 *   - loading: all section headings and contextual skeletons remain mounted;
 *     the page is busy without inventing measurements or local scope controls.
 *   - populated (km): honest KPI tiles, hook wiring, per-card distance / energy
 *     / cost / efficiency / badges / duration / date, and the energy ladder that
 *     ranks by energy and drops zero-energy trips.
 *   - unit boundary (mi): distance + efficiency re-label and run the real SI
 *     converter at the display edge.
 *   - empty: every section shows its own placeholder (never a blank panel),
 *     KPIs read zero, the chart flags empty, exports disable, pagination hides.
 *   - error: the list, hero chart, and energy panel each surface QueryError, and
 *     its Retry re-invokes refetch.
 *   - exports: CSV maps each trip to a flat SI row + the v2 filename; JSON hands
 *     the raw trip array to the download helper.
 *   - URL state: the range picker writes from/to (clearing page); pagination
 *     advances the page, wires the page-size, and deep-links translate to the
 *     right SI offset.
 *   - formatDuration: in-progress, invalid/negative, whole-hour, minute-only,
 *     and the "1h 60m" rounding regression are each rendered correctly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useRangeState, type UseRangeStateReturn } from '@/hooks/useRangeState';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Trip } from '@/api/types';
import type { UnitPref } from '@/lib/unitConversion';
import { convertDistanceFromSI, formatEnergy as libFormatEnergy } from '@/lib/unitConversion';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { formatDate } from '@/lib/dateFormat';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { Button } from '@/components/ui';

const rawBridge = vi.hoisted(() => ({ inputs: [] as Array<readonly StatMetric[]> }));
const chartBridge = vi.hoisted(() => ({
  rows: [] as Array<{ name: string; distance: number | null }>,
  columns: [] as Array<{ key: string; label: string }>,
  bars: [] as Array<{ fill: string; isAnimationActive: boolean; animationDuration: number }>,
}));
const rangeBridge = vi.hoisted(() => ({ override: null as Partial<UseRangeStateReturn> | null }));
const motionBridge = vi.hoisted(() => ({ fills: [] as Array<{ initial: unknown; transition: unknown }> }));
vi.mock('@/hooks/useRangeState', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useRangeState')>();
  return { ...actual, useRangeState: (...args: Parameters<typeof actual.useRangeState>) => ({
    ...actual.useRangeState(...args), ...rangeBridge.override,
  }) };
});
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return {
    ...actual,
    useOperationalMetrics: (metrics: readonly StatMetric[]) => {
      rawBridge.inputs.push(metrics);
      return actual.useOperationalMetrics(metrics);
    },
  };
});

// Same conversion factor the page uses for Wh/km → Wh/mi efficiency.
const KM_PER_MILE = 1.609344;

// ── i18n stub: resolve a string fallback (or the options-bag defaultValue) and
//    interpolate {{var}} placeholders so assertions read on human copy. ────────
vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') {
      return interpolate(second, third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined);
    }
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── framer-motion: strip animation props, keep motion.* + AnimatePresence. ──
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          if ('data-metric-fill' in rest) {
            motionBridge.fills.push({ initial: rest.initial, transition: rest.transition });
          }
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              ['animate', 'initial', 'exit', 'transition', 'whileHover', 'whileTap', 'whileInView', 'viewport', 'variants'].includes(k)
            )
              continue;
            safe[k] = v;
          }
          return <div {...(safe as Record<string, unknown>)}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : true,
  };
});

// ── Charts barrel: the real ChartContainer pulls annotation react-query hooks
//    and recharts needs a sized container jsdom can't provide. This double
//    mirrors the props the page relies on — title, ariaLabel (role=img body),
//    the action toolbar, and the loading / empty flags — and renders children
//    only in the populated state, exactly like the real component. ────────────
vi.mock('@/components/layout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/layout')>()),
  ChartCard: (await import('@/components/charts')).ChartContainer,
}));

vi.mock('@/components/charts', async () => ({
  ChartContainer: ({
    title,
    ariaLabel,
    loading,
    empty,
    action,
    children,
    className,
    data,
    dataColumns,
  }: {
    title: string;
    ariaLabel: string;
    loading?: boolean;
    empty?: boolean;
    action?: ReactNode;
    children?: ReactNode;
    className?: string;
    data: Array<{ name: string; distance: number | null }>;
    dataColumns: Array<{ key: string; label: string }>;
  }) => {
    chartBridge.rows = data;
    chartBridge.columns = dataColumns;
    return (
    <section
      role="img"
      aria-label={ariaLabel}
      data-loading={loading ? 'true' : 'false'}
      data-empty={empty ? 'true' : 'false'}
      className={className}
    >
      <div>{title}</div>
      <div>{action}</div>
      {!loading && !empty ? <div data-testid="chart-body">{children}</div> : null}
    </section>
    );
  },
  ChartTooltip: () => null,
  ChartGradient: () => null,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Bar: (props: { fill: string; isAnimationActive: boolean; animationDuration: number }) => {
    chartBridge.bars.push(props);
    return null;
  },
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  axisTickSm: {},
  axisTick: {},
  chartGrid: null,
  chartAnimation: {},
  chartAnimationProps: (await import('@/components/charts/chartDefaults')).chartAnimationProps,
  CHART_COLORS: ['#22d3ee', '#f59e0b', '#a855f7', '#34d399'],
}));

// ── Peripheral header / mobile components pull their own data or touch device
//    APIs; stub them so the suite stays focused on the page's orchestration. ──
vi.mock('@/components/mobile', () => ({
  PullToRefresh: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/data-display/SavedViewMenu', () => ({
  SavedViewMenu: ({ onApply }: { onApply: (query: string) => void }) => (
    <Button onClick={() => onApply('vehicle_id=9&from=2026-03-02&to=2026-03-20&page=3&size=2')}>
      Restore saved view
    </Button>
  ),
}));

// ── Data + environment hooks, driven per test. ──
vi.mock('@/api/hooks/useTrips', () => ({ useTrips: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: vi.fn() }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/export', () => ({ exportAsCSV: vi.fn(), exportAsJSON: vi.fn() }));

import { useTrips } from '@/api/hooks/useTrips';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { exportAsCSV, exportAsJSON } from '@/lib/export';
import TripListPage from './TripListPage';

 
const mockUseTrips = vi.mocked(useTrips);
const mockSelected = vi.mocked(useSelectedVehicle);
const mockUnits = vi.mocked(useUnits);
const mockFormatting = vi.mocked(useFormatting);
const mockExportCSV = vi.mocked(exportAsCSV);
const mockExportJSON = vi.mocked(exportAsJSON);

 
function makeQuery(over: Partial<ReturnType<typeof useTrips>> = {}): ReturnType<typeof useTrips> {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isError: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as ReturnType<typeof useTrips>;
}

function makeTrip(over: Partial<Trip> & Pick<Trip, 'id'>): Trip {
  const start = over.start_date ?? '2026-03-01T00:00:00Z';
  return {
    id: over.id,
    vehicle_id: 7,
    name: null,
    start_date: start,
    end_date: null,
    started_at: start,
    ended_at: over.end_date ?? null,
    total_distance_m: 0,
    total_energy_wh: 0,
    total_duration_s: 0,
    total_cost: 0,
    drive_count: 0,
    charge_count: 0,
    created_at: start,
    ...over,
  };
}

/**
 * Fixture: 3 March-2026 trips.
 *  A — a completed 300 km / 54 kWh coast run (3 drives, 2 charges, 4h30m).
 *  B — a completed, unnamed 80 km / 16 kWh hop (1 drive, 1h15m).
 *  C — an in-progress 45 km airport run with no energy/cost yet.
 * Every aggregate below is re-derived from these raw SI numbers.
 */
const TRIP_A = makeTrip({
  id: 1,
  name: 'Weekend to Coast',
  start_date: '2026-03-01T08:00:00Z',
  end_date: '2026-03-01T12:30:00Z',
  total_distance_m: 300000,
  total_energy_wh: 54000,
  total_duration_s: 16200,
  total_cost: 12.5,
  drive_count: 3,
  charge_count: 2,
});
const TRIP_B = makeTrip({
  id: 2,
  name: null,
  start_date: '2026-03-05T09:00:00Z',
  end_date: '2026-03-05T10:15:00Z',
  total_distance_m: 80000,
  total_energy_wh: 16000,
  total_duration_s: 4500,
  total_cost: 3.2,
  drive_count: 1,
  charge_count: 0,
});
const TRIP_C = makeTrip({
  id: 3,
  name: 'Airport run',
  start_date: '2026-03-10T06:00:00Z',
  end_date: null,
  total_distance_m: 45000,
  total_energy_wh: 0,
  total_duration_s: 0,
  total_cost: 0,
  drive_count: 1,
  charge_count: 0,
});
const TRIPS: Trip[] = [TRIP_A, TRIP_B, TRIP_C];

const TOTAL_DIST_M = 300000 + 80000 + 45000; // 425000
const TOTAL_ENERGY_WH = 54000 + 16000; // 70000
const TOTAL_COST = 12.5 + 3.2; // 15.7

function makePref(distance: 'km' | 'mi'): UnitPref {
  return {
    distance,
    speed: distance === 'mi' ? 'mph' : 'km/h',
    temperature: '°C',
    pressure: 'bar',
    energy: 'kWh',
    duration: 'h',
    power: 'kW',
    locale: 'en-US',
    precision: 2,
  };
}

function unitsValue(distance: 'km' | 'mi') {
  const pref = makePref(distance);
  return {
    unitPrefs: pref,
    formatEnergy: (wh: number | null | undefined) => libFormatEnergy(wh, pref),
  } as ReturnType<typeof useUnits>;
}

function formattingValue() {
  return {
    currencySymbol: '$',
    formatCurrency: (amount: number, decimals?: number) => `$${fmtNumber(amount, decimals ?? 2)}`,
  } as ReturnType<typeof useFormatting>;
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc-search">{loc.search}</div>;
}

function HeaderRangeChange() {
  const { setRange } = useRangeState();
  return (
    <Button onClick={() => setRange({ start: '2026-03-02', end: '2026-03-20' })}>
      Change header range
    </Button>
  );
}

function renderPage(initialEntries: string[] = ['/trips']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <TripListPage />
        <HeaderRangeChange />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const result = render(tree());
  return { ...result, refresh: () => result.rerender(tree()) };
}

const statsRegion = () => screen.getByRole('region', { name: 'Trip summary metrics' });
const listRegion = () => screen.getByRole('region', { name: 'All trips' });
const primaryRegion = () => screen.getByRole('region', { name: 'Trip distance and energy breakdown' });
const locSearch = () => screen.getByTestId('loc-search').textContent ?? '';

/** Real OperationalBrief measurement, independent of typography elements. */
function cardValue(region: HTMLElement, label: string): string {
  const span = within(region).getByText(label);
  return span.closest('[data-operational-metric]')?.querySelector('[data-operational-value]')?.textContent ?? '';
}

/** The nearest trip-card panel that contains the given (unique) trip name. */
function cardByName(name: string): HTMLElement {
  const el = within(listRegion()).getByText(name).closest('div.flex.h-full') as HTMLElement | null;
  if (!el) throw new Error(`card for "${name}" not found`);
  return el;
}

beforeEach(() => {
  rawBridge.inputs = [];
  chartBridge.rows = [];
  chartBridge.columns = [];
  chartBridge.bars = [];
  motionBridge.fills = [];
  rangeBridge.override = null;
  mockUseTrips.mockReset();
  mockSelected.mockReset();
  mockUnits.mockReset();
  mockFormatting.mockReset();
  mockExportCSV.mockReset();
  mockExportJSON.mockReset();

  mockSelected.mockReturnValue({ vehicleId: 7, vehicle: null, vehicles: [], setVehicleId: vi.fn() } as ReturnType<typeof useSelectedVehicle>);
  mockUnits.mockReturnValue(unitsValue('km'));
  mockFormatting.mockReturnValue(formattingValue());
  mockUseTrips.mockReturnValue(makeQuery({ data: TRIPS }));
});

afterEach(() => vi.restoreAllMocks());

describe('TripListPage — loading', () => {
  it('keeps every band and contextual skeleton mounted while loading', () => {
    mockUseTrips.mockReturnValue(makeQuery({ data: undefined, isLoading: true, isFetching: true }));
    renderPage();

    expect(screen.getByRole('heading', { name: 'Trips', level: 1 }).closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
    // The page heading persists during load; the range belongs to the header.
    expect(screen.getByRole('heading', { name: 'Trips', level: 1 })).toBeInTheDocument();
    expect(screen.queryByTestId('range-picker')).not.toBeInTheDocument();
    expect(statsRegion()).toBeInTheDocument();
    expect(primaryRegion()).toBeInTheDocument();
    expect(listRegion().querySelectorAll('[data-card]')).toHaveLength(6);
    expect(screen.getByRole('img', { name: /Top trips ranked by distance/ })).toHaveAttribute('data-loading', 'true');
    expect(screen.getByText('Top Trips by Energy')).toBeInTheDocument();
    expect(rawBridge.inputs.at(-1)?.map(metric => metric.rawValue)).toEqual([null, null, null, null, null, null]);
    expect(screen.queryByText('No trips recorded yet')).toBeNull();
  });
});

describe('TripListPage — populated (km) KPIs + wiring', () => {
  it('preserves the screenshot cohort: six measurements and 60 drives, 2 trips, 32 charging sessions', () => {
    mockUseTrips.mockReturnValue(makeQuery({ data: [
      makeTrip({ id: 41, total_distance_m: 300000, total_energy_wh: 50000, total_cost: 15, drive_count: 30, charge_count: 16 }),
      makeTrip({ id: 42, total_distance_m: 100000, total_energy_wh: 20000, total_cost: 5, drive_count: 30, charge_count: 16 }),
    ] }));
    renderPage();
    const kpi = statsRegion();
    expect(kpi.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(cardValue(kpi, 'Total Distance')).toBe('400 km');
    expect(cardValue(kpi, 'Energy Used')).toBe(libFormatEnergy(70000, makePref('km')));
    expect(cardValue(kpi, 'Total Cost')).toBe('$20.00');
    expect(cardValue(kpi, 'Total Trips')).toBe('2');
    expect(cardValue(kpi, 'Avg / Trip')).toBe('200 km');
    expect(cardValue(kpi, 'Total Charges')).toBe('32');
    const rawMetrics = rawBridge.inputs[rawBridge.inputs.length - 1];
    expect(rawMetrics?.map(metric => metric.rawValue)).toEqual([400000, 70000, 20, 2, 200000, 32]);
    expect(rawMetrics?.map(metric => metric.metricId)).toEqual(['distance', 'energy', 'currency', 'count', 'distance', 'count']);
    expect(within(kpi).getByText('2 trips')).toBeInTheDocument();
    expect(within(kpi).getByText('60 drives')).toBeInTheDocument();
    expect(within(kpi).getByText('60 total drives')).toBeInTheDocument();
    expect(within(kpi).getByText('32 charge sessions')).toBeInTheDocument();
    expect(within(kpi).getByText('$5.00/100km')).toBeInTheDocument();
    expect(within(kpi).getAllByText(/Loaded page only/).length).toBeGreaterThan(0);
    fireEvent.click(within(kpi).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('60 drives')).toBeInTheDocument();
    expect(within(drawer).getByText('32 charge sessions')).toBeInTheDocument();
    expect(within(drawer).getByText('400 km')).toBeInTheDocument();
  });

  it('keeps loaded summaries and export controls through a failed background refresh', () => {
    mockUseTrips.mockReturnValue(makeQuery({ data: TRIPS, isError: true, error: new Error('refresh failed'), isFetching: true }));
    renderPage();
    const kpi = statsRegion();
    expect(cardValue(kpi, 'Total Distance')).toBe(`${fmtInt(convertDistanceFromSI(TOTAL_DIST_M, 'km'))} km`);
    expect(within(kpi).getByText('Retained source')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CSV' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'JSON' })).toBeEnabled();
    fireEvent.click(within(kpi).getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText(`${fmtInt(convertDistanceFromSI(TOTAL_DIST_M, 'km'))} km`)).toBeInTheDocument();
  });
  it('derives honest KPI tiles from the raw SI trip list', () => {
    renderPage();
    const kpi = statsRegion();

    expect(cardValue(kpi, 'Total Distance')).toBe(`${fmtInt(convertDistanceFromSI(TOTAL_DIST_M, 'km'))} km`);
    expect(cardValue(kpi, 'Energy Used')).toBe(libFormatEnergy(TOTAL_ENERGY_WH, makePref('km')));
    expect(cardValue(kpi, 'Total Cost')).toBe(`$${fmtNumber(TOTAL_COST, 2)}`);
    expect(cardValue(kpi, 'Total Trips')).toBe('3');
    expect(cardValue(kpi, 'Avg / Trip')).toBe(`${fmtInt(convertDistanceFromSI(TOTAL_DIST_M, 'km') / 3)} km`);
    expect(cardValue(kpi, 'Total Charges')).toBe('2');
  });

  it('wires useTrips with the selected vehicle and SI pagination window', () => {
    renderPage();
    expect(mockUseTrips).toHaveBeenCalledWith(
      expect.objectContaining({ vehicle_id: 7, limit: 50, offset: 0 }),
    );
  });
});

describe('TripListPage — populated (km) trip cards', () => {
  it('keeps complete distance, energy, efficiency and cost text wrap-safe inside allocated cards', () => {
    renderPage();
    const card = cardByName('Weekend to Coast');
    const values = [
      within(card).getByText(`${fmtInt(convertDistanceFromSI(300000, 'km'))} km`),
      within(card).getByText(libFormatEnergy(54000, makePref('km'))),
      within(card).getByText(`${fmtInt(54000 / 300)} Wh/km`),
      within(card).getByText('$12.50'),
    ];
    for (const value of values) {
      expect(value).toHaveClass('break-words');
      expect(value).not.toHaveClass('truncate');
    }
    expect(screen.getByRole('button', { name: 'CSV' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'JSON' })).toBeEnabled();
  });

  it('renders each card with converted distance, energy, cost, badges and duration', () => {
    renderPage();

    const cardA = cardByName('Weekend to Coast');
    expect(within(cardA).getByText(`${fmtInt(convertDistanceFromSI(300000, 'km'))} km`)).toBeInTheDocument();
    expect(within(cardA).getByText(libFormatEnergy(54000, makePref('km')))).toBeInTheDocument();
    expect(within(cardA).getByText('$12.50')).toBeInTheDocument();
    // 54000 Wh / 300 km = 180 Wh/km efficiency at the display edge.
    expect(within(cardA).getByText(`${fmtInt(54000 / (300000 / 1000))} Wh/km`)).toBeInTheDocument();
    expect(within(cardA).getByText('3 drives')).toBeInTheDocument();
    expect(within(cardA).getByText('2 charges')).toBeInTheDocument();
    expect(within(cardA).getByText('4h 30m')).toBeInTheDocument();
    expect(within(cardA).getByText(formatDate('2026-03-01T08:00:00Z'))).toBeInTheDocument();
  });

  it('keeps synthesized names and zero cost without inventing charges', () => {
    renderPage();

    // Unnamed trip B → "Trip #2"; no charges badge; 1h15m duration.
    const cardB = cardByName('Trip #2');
    expect(within(cardB).getByText('1 drives')).toBeInTheDocument();
    expect(within(cardB).queryByText(/charges/)).toBeNull();
    expect(within(cardB).getByText('1h 15m')).toBeInTheDocument();

    // In-progress trip C still has a measured zero cost.
    const cardC = cardByName('Airport run');
    expect(within(cardC).getByText('In progress')).toBeInTheDocument();
    expect(within(cardC).getByText('$0.00')).toBeInTheDocument();
  });
});

describe('TripListPage — energy ladder', () => {
  it('ranks trips by energy and drops the zero-energy trip', () => {
    renderPage();
    const primary = primaryRegion();

    // A and B rank by energy; the sublabel is the formatted SI energy.
    expect(within(primary).getByText('Weekend to Coast')).toBeInTheDocument();
    expect(within(primary).getByText('Trip #2')).toBeInTheDocument();
    expect(within(primary).getByText(libFormatEnergy(54000, makePref('km')))).toBeInTheDocument();
    expect(within(primary).getByText(libFormatEnergy(16000, makePref('km')))).toBeInTheDocument();
    // The zero-energy airport run is excluded from the ladder.
    expect(within(primary).queryByText('Airport run')).toBeNull();
  });
});

describe('TripListPage — unit boundary (miles)', () => {
  it('re-labels + converts distance and efficiency at the render edge', () => {
    mockUnits.mockReturnValue(unitsValue('mi'));
    renderPage();

    expect(cardValue(statsRegion(), 'Total Distance')).toBe(
      `${fmtInt(convertDistanceFromSI(TOTAL_DIST_M, 'mi'))} mi`,
    );

    const cardA = cardByName('Weekend to Coast');
    expect(within(cardA).getByText(`${fmtInt(convertDistanceFromSI(300000, 'mi'))} mi`)).toBeInTheDocument();
    // Wh/km (180) → Wh/mi via KM_PER_MILE.
    expect(within(cardA).getByText(`${fmtInt((54000 / (300000 / 1000)) * KM_PER_MILE)} Wh/mi`)).toBeInTheDocument();
  });
});

describe('TripListPage — empty', () => {
  it('shows every placeholder, zeroed KPIs, disabled export and no pagination', () => {
    mockUseTrips.mockReturnValue(makeQuery({ data: [] }));
    renderPage();

    // Section placeholders (never a blank panel).
    expect(screen.getByText('No trips recorded yet')).toBeInTheDocument();
    expect(screen.getByText('No energy data to rank yet')).toBeInTheDocument();
    // Hero chart flags itself empty and disables both exports.
    expect(screen.getByRole('img', { name: /Top trips ranked by distance/ })).toHaveAttribute('data-empty', 'true');
    expect(screen.getByRole('button', { name: 'CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'JSON' })).toBeDisabled();
    // KPIs honestly read zero rather than hiding.
    expect(cardValue(statsRegion(), 'Total Distance')).toBe('0 km');
    expect(cardValue(statsRegion(), 'Total Trips')).toBe('0');
    // Pagination footer is gone with no rows.
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });
});

describe('TripListPage — error', () => {
  it('surfaces QueryError in each data section and retries via refetch', () => {
    const refetch = vi.fn();
    mockUseTrips.mockReturnValue(makeQuery({ data: undefined, isError: true, error: new Error('boom'), refetch }));
    renderPage();

    // List, hero chart, and energy panel each render the network error banner.
    expect(screen.getAllByText("Can't reach server")).toHaveLength(3);

    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(retries[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('TripListPage — exports', () => {
  it('keeps complete loaded-set exports and trip cards during a background refresh failure', () => {
    mockUseTrips.mockReturnValue(makeQuery({ data: TRIPS, isError: true, error: new Error('refresh failed') }));
    renderPage();
    expect(cardByName('Weekend to Coast')).toBeInTheDocument();
    expect(cardByName('Trip #2')).toBeInTheDocument();
    expect(cardByName('Airport run')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(mockExportJSON).toHaveBeenCalledWith(TRIPS, 'teslasync-trips.json');
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    expect(mockExportCSV.mock.calls[0]?.[0]).toHaveLength(TRIPS.length);
  });

  it('exports a flat SI CSV row per trip under the v2 filename', () => {
    renderPage();

    fireEvent.click(within(primaryRegion()).getByRole('button', { name: 'CSV' }));

    expect(mockExportCSV).toHaveBeenCalledTimes(1);
    const [rows, filename] = mockExportCSV.mock.calls[0];
    expect(filename).toBe('teslasync-trips-v2.csv');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      id: 1,
      name: 'Weekend to Coast',
      distance_m: 300000,
      energy_wh: 54000,
      cost: 12.5,
      drives: 3,
      charges: 2,
    });
    // Unnamed trip is synthesized in the export too.
    expect(rows[1]).toMatchObject({ id: 2, name: 'Trip 2', distance_m: 80000 });
  });

  it('hands the raw trip array to the JSON download helper', () => {
    renderPage();

    fireEvent.click(within(primaryRegion()).getByRole('button', { name: 'JSON' }));

    expect(mockExportJSON).toHaveBeenCalledTimes(1);
    const [rows, filename] = mockExportJSON.mock.calls[0];
    expect(filename).toBe('teslasync-trips.json');
    expect(rows).toEqual(TRIPS);
  });
});

describe('TripListPage — URL state', () => {
  it('writes the picked range to from/to and clears the page param', () => {
    renderPage(['/trips?page=3']);
    expect(locSearch()).toContain('page=3');

    fireEvent.click(screen.getByRole('button', { name: 'Change header range' }));

    const search = locSearch();
    expect(search).toContain('from=2026-03-02');
    expect(search).toContain('to=2026-03-20');
    expect(search).not.toContain('page=3');
  });

  it('advances the page and updates the page size through the URL', () => {
    renderPage(['/trips?size=2']);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(locSearch()).toContain('page=2');

    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '100' } });
    expect(locSearch()).toContain('size=100');
  });

  it('translates a deep-linked page into the correct SI offset', () => {
    renderPage(['/trips?page=2&size=2']);
    expect(mockUseTrips).toHaveBeenCalledWith(
      expect.objectContaining({ vehicle_id: 7, limit: 2, offset: 2 }),
    );
  });
});

describe('TripListPage modernization regressions', () => {
  it('forwards exclusive timezone instants without duplicating workspace selectors', () => {
    rangeBridge.override = {
      start: '2026-03-08', end: '2026-03-08', timezone: 'America/Los_Angeles',
      startInstant: '2026-03-08T08:00:00.000Z', endInstantExclusive: '2026-03-09T07:00:00.000Z',
    };
    renderPage();
    expect(mockUseTrips).toHaveBeenLastCalledWith({
      vehicle_id: 7, limit: 50, offset: 0,
      start: '2026-03-08T08:00:00.000Z', end: '2026-03-09T07:00:00.000Z',
    });
    expect(within(statsRegion()).getAllByText(/2026-03-08 – 2026-03-08/).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('range-picker')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /vehicle/i })).not.toBeInTheDocument();
  });

  it('resets the requested page when the workspace vehicle changes', () => {
    const { refresh } = renderPage(['/trips?page=3&size=2']);
    mockSelected.mockReturnValue({ vehicleId: 9, vehicle: null, vehicles: [], setVehicleId: vi.fn() } as ReturnType<typeof useSelectedVehicle>);
    refresh();
    expect(locSearch()).not.toContain('page=3');
    expect(mockUseTrips).toHaveBeenLastCalledWith(expect.objectContaining({ vehicle_id: 9, limit: 2, offset: 0 }));
    expect(locSearch()).toContain('size=2');
  });

  it('retains explicitly restored saved-view pagination when its range changes', () => {
    renderPage(['/trips?from=2026-03-01&to=2026-03-10&page=2&size=2']);
    fireEvent.click(screen.getByRole('button', { name: 'Restore saved view' }));
    expect(locSearch()).toContain('from=2026-03-02');
    expect(locSearch()).toContain('to=2026-03-20');
    expect(locSearch()).toContain('vehicle_id=9');
    expect(locSearch()).toContain('page=3');
    expect(mockUseTrips).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 2, offset: 4 }));
  });

  it('refetches rolling instants across midnight without resetting the selected page', () => {
    rangeBridge.override = {
      start: '2026-03-09', end: '2026-03-10', presetId: '24h',
      startInstant: '2026-03-09T23:59:00.000Z', endInstantExclusive: '2026-03-10T23:59:00.000Z',
    };
    const { refresh } = renderPage(['/trips?page=3&size=2']);
    rangeBridge.override = {
      ...rangeBridge.override, start: '2026-03-10', end: '2026-03-11',
      startInstant: '2026-03-10T00:01:00.000Z', endInstantExclusive: '2026-03-11T00:01:00.000Z',
    };
    refresh();
    expect(locSearch()).toContain('page=3');
    expect(mockUseTrips).toHaveBeenLastCalledWith(expect.objectContaining({
      offset: 4, start: '2026-03-10T00:01:00.000Z', end: '2026-03-11T00:01:00.000Z',
    }));
  });

  it.each([
    { caseName: 'zero page', query: 'page=0', limit: 50, offset: 0 },
    { caseName: 'negative page', query: 'page=-2', limit: 50, offset: 0 },
    { caseName: 'fractional page', query: 'page=1.5', limit: 50, offset: 0 },
    { caseName: 'unsafe offset', query: 'page=9007199254740991', limit: 50, offset: 0 },
    { caseName: 'zero size', query: 'size=0', limit: 50, offset: 0 },
    { caseName: 'fractional size', query: 'size=2.5', limit: 50, offset: 0 },
    { caseName: 'oversized window', query: 'size=1001', limit: 50, offset: 0 },
    { caseName: 'valid server maximum', query: 'page=2&size=1000', limit: 1000, offset: 1000 },
  ])('validates the request window for $caseName', ({ query, limit, offset }) => {
    renderPage([`/trips?${query}`]);
    expect(mockUseTrips).toHaveBeenLastCalledWith(expect.objectContaining({ limit, offset }));
  });

  it('announces loaded rows and unknown totals while retaining empty-page recovery', () => {
    mockUseTrips.mockReturnValue(makeQuery({ data: [] }));
    renderPage(['/trips?page=3&size=2']);
    const pagination = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByText('0 matching / 0 loaded rows')).toBeInTheDocument();
    expect(within(pagination).getByText('Page 3 of Unknown')).toBeInTheDocument();
    expect(within(pagination).queryByText(/Showing .* of/)).not.toBeInTheDocument();
    expect(within(pagination).getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(within(pagination).getByRole('textbox', { name: 'Go to page' })).toHaveValue('3');
    fireEvent.click(within(pagination).getByRole('button', { name: 'Previous page' }));
    expect(locSearch()).toContain('page=2');
  });

  it.each([
    { caseName: 'zero', cost: 0, expected: '$0.00' },
    { caseName: 'signed refund', cost: -5.25, expected: '$-5.25' },
  ])('shows $caseName cost and unavailable zero-distance efficiency', ({ cost, expected }) => {
    mockUseTrips.mockReturnValue(makeQuery({ data: [makeTrip({
      ...TRIP_A, name: 'Zero distance', total_distance_m: 0, total_cost: cost,
    })] }));
    renderPage();
    const card = cardByName('Zero distance');
    expect(within(card).getByText(expected)).toBeInTheDocument();
    expect(within(card).getByText('—')).toBeInTheDocument();
    expect(within(card).queryByText('0 Wh/km')).not.toBeInTheDocument();
    expect(within(statsRegion()).getByText('—/100km')).toBeInTheDocument();
    expect(cardValue(statsRegion(), 'Total Cost')).toBe(expected);
  });

  it('keeps malformed measurements unknown instead of inventing aggregate zeros', () => {
    mockUseTrips.mockReturnValue(makeQuery({ data: [makeTrip({
      ...TRIP_A, total_distance_m: Infinity, total_energy_wh: NaN, total_cost: NaN,
    })] }));
    renderPage();
    expect(rawBridge.inputs.at(-1)?.map(metric => metric.rawValue)).toEqual([null, null, null, 1, null, 2]);
    const card = cardByName('Weekend to Coast');
    expect(within(card).getByText(`— ${makePref('km').distance}`)).toBeInTheDocument();
    expect(within(card).queryByText('$0.00')).not.toBeInTheDocument();
    expect(chartBridge.rows).toEqual([{ name: 'Weekend to Coast', distance: null }]);
  });

  it.each(['km', 'mi'] as const)('distinguishes unknown distance from measured zero with %s preferences', distance => {
    mockUnits.mockReturnValue(unitsValue(distance));
    mockUseTrips.mockReturnValue(makeQuery({ data: [
      makeTrip({ ...TRIP_A, id: 71, name: 'Unknown distance', total_distance_m: NaN }),
      makeTrip({ ...TRIP_A, id: 72, name: 'Measured zero', total_distance_m: 0 }),
    ] }));
    renderPage();
    expect(within(cardByName('Unknown distance')).getByText(`— ${distance}`)).toBeInTheDocument();
    expect(within(cardByName('Unknown distance')).queryByText(`0 ${distance}`)).not.toBeInTheDocument();
    expect(within(cardByName('Measured zero')).getByText(`${fmtInt(convertDistanceFromSI(0, distance))} ${distance}`)).toBeInTheDocument();
    expect(chartBridge.rows).toEqual([
      { name: 'Unknown distance', distance: null },
      { name: 'Measured zero', distance: 0 },
    ]);
    expect(rawBridge.inputs.at(-1)?.[0].rawValue).toBeNull();
  });

  it.each([
    { caseName: 'initial pause', data: undefined, expected: null },
    { caseName: 'retained pause', data: TRIPS, expected: TOTAL_DIST_M },
  ])('preserves independent sections through $caseName', ({ data, expected }) => {
    mockUseTrips.mockReturnValue(makeQuery({ data, fetchStatus: 'paused' }));
    renderPage();
    expect(statsRegion()).toBeInTheDocument();
    expect(primaryRegion()).toBeInTheDocument();
    expect(listRegion()).toBeInTheDocument();
    expect(rawBridge.inputs.at(-1)?.[0].rawValue).toBe(expected);
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    if (data) {
      expect(cardByName('Weekend to Coast')).toBeInTheDocument();
      expect(within(statsRegion()).getByText('Retained source')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'JSON' })).toBeEnabled();
    } else {
      expect(listRegion().querySelectorAll('[data-card]')).toHaveLength(6);
      expect(screen.queryByText('No trips recorded yet')).not.toBeInTheDocument();
    }
  });

  it.each([
    { caseName: 'normal motion', reduce: false, active: true, duration: 300 },
    { caseName: 'reduced motion', reduce: true, active: false, duration: 0 },
  ])('uses shared series animation and solid fills with $caseName', ({ reduce, active, duration }) => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true, writable: true,
      value: vi.fn<(query: string) => MediaQueryList>(query => ({
        matches: query.includes('prefers-reduced-motion') && reduce,
        media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
      })),
    });
    try {
      renderPage();
      expect(chartBridge.rows).toEqual(TRIPS.map(trip => ({
        name: trip.name ?? `Trip ${trip.id}`,
        distance: convertDistanceFromSI(trip.total_distance_m, makePref('km').distance),
      })));
      expect(chartBridge.bars.at(-1)).toMatchObject({
        fill: '#22d3ee', isAnimationActive: active, animationDuration: duration,
      });
      const fills = primaryRegion().querySelectorAll('[data-metric-fill]');
      expect(fills).toHaveLength(2);
      for (const fill of fills) {
        expect(fill.getAttribute('style')).not.toContain('linear-gradient');
        expect(fill).toHaveStyle({ background: '#f59e0b' });
      }
      expect(motionBridge.fills.slice(-2)).toEqual([
        { initial: reduce ? false : { width: 0 }, transition: { duration: reduce ? 0 : 0.25, ease: [0.2, 0, 0, 1] } },
        { initial: reduce ? false : { width: 0 }, transition: { duration: reduce ? 0 : 0.25, ease: [0.2, 0, 0, 1] } },
      ]);
      expect(screen.getByRole('button', { name: 'CSV' })).toHaveClass('min-h-11', 'min-w-11');
      expect(within(cardByName('Weekend to Coast')).getByText('$12.50')).toHaveClass('text-[var(--text-primary)]');
    } finally {
      if (descriptor) Object.defineProperty(window, 'matchMedia', descriptor);
      else Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  it('keeps all loaded long-name cards and raw exports beyond the top-ten chart', () => {
    const trips = Array.from({ length: 12 }, (_, index) => makeTrip({
      id: index + 100, name: `${'LongUnbrokenTripName'.repeat(8)}-${index}`,
      total_distance_m: index * 1000, total_energy_wh: index * 200,
    }));
    const sourceOrder = trips.map(trip => trip.id);
    mockUseTrips.mockReturnValue(makeQuery({ data: trips }));
    renderPage();
    expect(chartBridge.rows.map(row => row.distance)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    expect(chartBridge.columns).toEqual([{ key: 'name', label: 'Trip' }, { key: 'distance', label: 'Distance (km)' }]);
    expect(listRegion().querySelectorAll('[data-card]')).toHaveLength(12);
    for (const trip of trips) expect(cardByName(trip.name ?? '')).toBeInTheDocument();
    expect(trips.map(trip => trip.id)).toEqual(sourceOrder);
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(mockExportJSON).toHaveBeenCalledWith(trips, 'teslasync-trips.json');
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    expect(mockExportCSV.mock.calls.at(-1)?.[0]).toHaveLength(12);
    expect(primaryRegion().querySelectorAll('[role="progressbar"]')).toHaveLength(6);
  });
});

describe('TripListPage — duration formatting', () => {
  it('renders whole-hour, minute-only, in-progress and invalid ranges', () => {
    const trips: Trip[] = [
      makeTrip({ id: 11, name: 'Alpha', start_date: '2026-05-01T00:00:00Z', end_date: '2026-05-01T02:00:00Z', total_cost: 1 }),
      makeTrip({ id: 12, name: 'Bravo', start_date: '2026-05-02T00:00:00Z', end_date: '2026-05-02T00:40:00Z', total_cost: 1 }),
      makeTrip({ id: 13, name: 'Charlie', start_date: '2026-05-03T00:00:00Z', end_date: null, total_cost: 1 }),
      // Delta ends BEFORE it starts → invalid range → em-dash.
      makeTrip({ id: 14, name: 'Delta', start_date: '2026-05-04T02:00:00Z', end_date: '2026-05-04T00:00:00Z', total_cost: 1 }),
    ];
    mockUseTrips.mockReturnValue(makeQuery({ data: trips }));
    renderPage();

    expect(within(cardByName('Alpha')).getByText('2h')).toBeInTheDocument();
    expect(within(cardByName('Bravo')).getByText('40m')).toBeInTheDocument();
    expect(within(cardByName('Charlie')).getByText('In progress')).toBeInTheDocument();
    // The timestamp metric remains unavailable, separately from efficiency.
    expect(within(cardByName('Delta')).getByText('—', { selector: '.inline-flex > span' })).toBeInTheDocument();
  });

  it('rolls a rounded-up leftover minute into the hour (no "1h 60m")', () => {
    // 1h 59m 45s rounds to 120 min → must read "2h", never "1h 60m".
    const trips: Trip[] = [
      makeTrip({ id: 21, name: 'Echo', start_date: '2026-06-01T00:00:00Z', end_date: '2026-06-01T01:59:45Z', total_cost: 1 }),
    ];
    mockUseTrips.mockReturnValue(makeQuery({ data: trips }));
    renderPage();

    const card = cardByName('Echo');
    expect(within(card).getByText('2h')).toBeInTheDocument();
    expect(within(card).queryByText('1h 60m')).toBeNull();
  });
});
