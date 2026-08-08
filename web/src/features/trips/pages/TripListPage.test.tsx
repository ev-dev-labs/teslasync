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
 *   - loading: PageContainer shows the brand spinner, withholds all trip
 *     scaffolding, but keeps the header + range control mounted.
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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Trip } from '@/api/types';
import type { UnitPref } from '@/lib/unitConversion';
import { convertDistanceFromSI, formatEnergy as libFormatEnergy } from '@/lib/unitConversion';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { formatDate } from '@/lib/dateFormat';

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
    useReducedMotion: () => true,
  };
});

// ── Charts barrel: the real ChartContainer pulls annotation react-query hooks
//    and recharts needs a sized container jsdom can't provide. This double
//    mirrors the props the page relies on — title, ariaLabel (role=img body),
//    the action toolbar, and the loading / empty flags — and renders children
//    only in the populated state, exactly like the real component. ────────────
vi.mock('@/components/charts', () => ({
  ChartContainer: ({
    title,
    ariaLabel,
    loading,
    empty,
    action,
    children,
    className,
  }: {
    title: string;
    ariaLabel: string;
    loading?: boolean;
    empty?: boolean;
    action?: ReactNode;
    children?: ReactNode;
    className?: string;
  }) => (
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
  ),
  ChartTooltip: () => null,
  ChartGradient: () => null,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  BarChart: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  axisTickSm: {},
  chartGrid: null,
  chartAnimation: {},
  CHART_COLORS: ['#22d3ee', '#f59e0b', '#a855f7', '#34d399'],
}));

// ── Peripheral header / mobile components pull their own data or touch device
//    APIs; stub them so the suite stays focused on the page's orchestration. ──
vi.mock('@/components/mobile', () => ({
  PullToRefresh: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/data-display/SavedViewMenu', () => ({ SavedViewMenu: () => null }));
vi.mock('@/components/forms/VehicleSelect', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));
vi.mock('@/components/forms/RangePicker', () => ({
  RangePicker: ({
    value,
    onChange,
  }: {
    value: { start: string; end: string };
    onChange: (v: { start: string; end: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="range-picker"
      onClick={() => onChange({ start: '2026-03-02', end: '2026-03-20' })}
    >
      {`range:${value.start}..${value.end}`}
    </button>
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

 
type AnyFn = ReturnType<typeof vi.fn> & any;
const mockUseTrips = useTrips as unknown as AnyFn;
const mockSelected = useSelectedVehicle as unknown as AnyFn;
const mockUnits = useUnits as unknown as AnyFn;
const mockFormatting = useFormatting as unknown as AnyFn;
const mockExportCSV = exportAsCSV as unknown as AnyFn;
const mockExportJSON = exportAsJSON as unknown as AnyFn;

 
function makeQuery(over: Record<string, unknown> = {}): any {
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
  };
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
  };
}

function formattingValue() {
  return {
    formatCurrency: (amount: number, decimals?: number) => `$${fmtNumber(amount, decimals ?? 2)}`,
  };
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc-search">{loc.search}</div>;
}

function renderPage(initialEntries: string[] = ['/trips']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <TripListPage />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const statsRegion = () => screen.getByRole('region', { name: 'Trip summary metrics' });
const listRegion = () => screen.getByRole('region', { name: 'All trips' });
const primaryRegion = () => screen.getByRole('region', { name: 'Trip distance and energy breakdown' });
const locSearch = () => screen.getByTestId('loc-search').textContent ?? '';

/** Value <p> that immediately follows a MetricCard's label span. */
function cardValue(region: HTMLElement, label: string): string {
  const span = within(region).getByText(label);
  return span.closest('p')?.nextElementSibling?.textContent ?? '';
}

/** The nearest trip-card panel that contains the given (unique) trip name. */
function cardByName(name: string): HTMLElement {
  const el = within(listRegion()).getByText(name).closest('div.flex.h-full') as HTMLElement | null;
  if (!el) throw new Error(`card for "${name}" not found`);
  return el;
}

beforeEach(() => {
  mockUseTrips.mockReset();
  mockSelected.mockReset();
  mockUnits.mockReset();
  mockFormatting.mockReset();
  mockExportCSV.mockReset();
  mockExportJSON.mockReset();

  mockSelected.mockReturnValue({ vehicleId: 7, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
  mockUnits.mockReturnValue(unitsValue('km'));
  mockFormatting.mockReturnValue(formattingValue());
  mockUseTrips.mockReturnValue(makeQuery({ data: TRIPS }));
});

describe('TripListPage — loading', () => {
  it('shows the spinner and withholds trip content while keeping the header', () => {
    mockUseTrips.mockReturnValue(makeQuery({ data: undefined, isLoading: true, isFetching: true }));
    renderPage();

    // Brand spinner is the sole body content.
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    // Header title + the range control persist during load.
    expect(screen.getByRole('heading', { name: 'Trips', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('range-picker')).toBeInTheDocument();
    // None of the data scaffolding mounts (PageContainer replaces children).
    expect(screen.queryByRole('region', { name: 'All trips' })).toBeNull();
    expect(screen.queryByText('No trips recorded yet')).toBeNull();
  });
});

describe('TripListPage — populated (km) KPIs + wiring', () => {
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

  it('falls back to a synthesized name and omits the charges badge / cost when zero', () => {
    renderPage();

    // Unnamed trip B → "Trip #2"; no charges badge; 1h15m duration.
    const cardB = cardByName('Trip #2');
    expect(within(cardB).getByText('1 drives')).toBeInTheDocument();
    expect(within(cardB).queryByText(/charges/)).toBeNull();
    expect(within(cardB).getByText('1h 15m')).toBeInTheDocument();

    // In-progress trip C → duration label + em-dash cost.
    const cardC = cardByName('Airport run');
    expect(within(cardC).getByText('In progress')).toBeInTheDocument();
    expect(within(cardC).getByText('—')).toBeInTheDocument();
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

    fireEvent.click(screen.getByTestId('range-picker'));

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
    // Only the invalid-range card shows the em-dash (all costs are > 0).
    expect(within(cardByName('Delta')).getByText('—')).toBeInTheDocument();
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
