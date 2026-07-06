/**
 * RouteEfficiencyPage — behaviour + hardening coverage.
 *
 * The page has a single default export (the route-efficiency analytics page).
 * This suite drives it through every meaningful branch by mocking its data +
 * environment hooks (`useRouteEfficiency` / `useSelectedVehicle` / `useUnits`),
 * the AI panel, the forms row, and the charts barrel. The render-boundary
 * unit maths is the REAL implementation: the page calls the genuine
 * `makeUnitDisplay` (from ../components/route-efficiency, backed by
 * `@/lib/unitConversion`) plus the real `fmtInt` formatter, so the SI → display
 * conversion + KPI aggregation are actually exercised. Network is never touched.
 *
 * Facets covered:
 *   - no-vehicle guard renders the "select a vehicle" empty copy, no route cards.
 *   - loading: chart shows its loading state and the "no data" empty copy never
 *     flashes; the KPI cards are withheld (skeletons instead).
 *   - error: every data-bound section surfaces <QueryError> + a working Retry
 *     that calls refetch, and the comparison chart is replaced by an error panel.
 *   - populated (km): honest KPI tiles, the comparison chart rows sorted
 *     lowest-consumption-first, the metric bars, and per-route cards.
 *   - unit boundary (mi): re-labels the efficiency unit + runs the real
 *     Wh/km → Wh/mi converter through to the KPI value and chart headers.
 *   - chart cap: >10 routes collapse to MAX_COMPARISON_ROUTES rows, still sorted.
 *   - single route: comparison chart shows empty (needs ≥2) while KPIs + the
 *     lone route card still render.
 *   - range picker: committing a new range writes snake_case from/to to the URL
 *     and re-queries with the new dates.
 *   - AI panel receives the selected vehicle id (or none when unselected).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { RouteSummary } from '@/types/driving';

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

// ── motion primitives: render children verbatim (strip animation). ──
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  StaggerContainer: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  StaggerItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

// ── charts barrel: a deterministic <ChartContainer> double that surfaces the
//    page-computed `data`/`dataColumns` as a plain table (so row order +
//    capping + unit conversion are directly assertable) plus explicit
//    loading/empty markers. Recharts primitives are inert — the double never
//    renders its children, so they only have to exist as valid imports. ───────
vi.mock('@/components/charts', () => {
  const inert = () => null;
  return {
    ChartContainer: ({
      title,
      ariaLabel,
      data,
      dataColumns,
      loading,
      empty,
      className,
    }: {
      title: string;
      ariaLabel: string;
      data?: ReadonlyArray<Record<string, unknown>>;
      dataColumns?: ReadonlyArray<{ key: string; label: string }>;
      loading?: boolean;
      empty?: boolean;
      className?: string;
    }) => (
      <figure aria-label={ariaLabel} data-testid="chart-container" className={className}>
        <figcaption>{title}</figcaption>
        {loading ? (
          <div data-testid="chart-loading">loading</div>
        ) : empty ? (
          <div data-testid="chart-empty">empty</div>
        ) : (
          <table>
            <thead>
              <tr>
                {(dataColumns ?? []).map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((row, i) => (
                <tr key={i} data-testid="chart-row">
                  {(dataColumns ?? []).map((c) => (
                    <td key={c.key} data-testid={`chart-cell-${c.key}`}>
                      {String(row[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </figure>
    ),
    ChartTooltip: inert,
    BarChart: inert,
    Bar: inert,
    XAxis: inert,
    YAxis: inert,
    CartesianGrid: inert,
    Tooltip: inert,
    ResponsiveContainer: inert,
  };
});

// ── forms row: VehicleSelect is a bare marker; RangePicker exposes the current
//    value + a single trigger that commits a fixed new range so the
//    onChange → URL-batch wiring is assertable without the real popover. ───────
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
  RangePicker: ({
    value,
    onChange,
    triggerTestId,
  }: {
    value: { start: string; end: string };
    onChange: (v: { start: string; end: string }) => void;
    triggerTestId?: string;
  }) => (
    <div>
      <span data-testid="range-display">{`${value.start}..${value.end}`}</span>
      <button
        type="button"
        data-testid={triggerTestId}
        onClick={() => onChange({ start: '2026-05-01', end: '2026-05-31' })}
      >
        change range
      </button>
    </div>
  ),
}));

// ── AI suggestions: surfaces the vehicleId it was handed so the parent wiring
//    is assertable (production gates its own visibility on ai_mode). ──
vi.mock('@/components/ai/AIRouteEfficiencySuggestions', () => ({
  AIRouteEfficiencySuggestions: ({ vehicleId }: { vehicleId?: string }) => (
    <div data-testid="ai-suggestions" data-vehicle-id={vehicleId ?? ''} />
  ),
}));

// ── Data + environment hooks, driven per test. ──
vi.mock('@/api/hooks/useDriving', () => ({ useRouteEfficiency: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));

import { useRouteEfficiency } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import RouteEfficiencyPage from './RouteEfficiencyPage';

const mockRouteEff = useRouteEfficiency as unknown as ReturnType<typeof vi.fn>;
const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;

// 1 mile in km — mirrors the KM_PER_MILE constant the real converter uses, so
// the mi-boundary assertions read on a concrete number rather than re-deriving
// the page's own maths.
const KM_PER_MILE = 1.609344;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    isPending: false,
    status: 'success',
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeRoute(over: Partial<RouteSummary> = {}): RouteSummary {
  return {
    startLocation: 'Home',
    endLocation: 'Office',
    tripCount: 1,
    avgDistanceKm: 10,
    avgEfficiency: 160,
    bestEfficiency: 140,
    worstEfficiency: 190,
    ...over,
  };
}

/**
 * Three-route fixture. Home→Office is the most-driven (12 trips), so the API's
 * `ORDER BY COUNT(*) DESC` contract puts it first. avgEfficiency is deliberately
 * NOT in the same order as trip count (Gym 150 < Office 160 < Beach 210) so the
 * comparison chart's own lowest-consumption-first sort is observable.
 */
const ROUTES: RouteSummary[] = [
  makeRoute({ startLocation: 'Home', endLocation: 'Office', tripCount: 12, avgDistanceKm: 40, avgEfficiency: 160, bestEfficiency: 140, worstEfficiency: 190 }),
  makeRoute({ startLocation: 'Home', endLocation: 'Gym', tripCount: 8, avgDistanceKm: 10, avgEfficiency: 150, bestEfficiency: 130, worstEfficiency: 200 }),
  makeRoute({ startLocation: 'Home', endLocation: 'Beach', tripCount: 3, avgDistanceKm: 100, avgEfficiency: 210, bestEfficiency: 180, worstEfficiency: 260 }),
];

// Known raw aggregates the page must independently derive from ROUTES.
const TOTAL_TRIPS = 12 + 8 + 3; // 23
const BEST_WH_KM = 130; // min of bestEfficiency
const WORST_WH_KM = 260; // max of worstEfficiency
const AVG_WH_KM = Math.round((160 + 150 + 210) / 3); // 173

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function selected(vehicleId: number | null): any {
  return {
    vehicleId,
    vehicle: null,
    vehicles: vehicleId != null ? [{ id: vehicleId, display_name: 'Model 3', vin: 'VIN7' }] : [],
    setVehicleId: vi.fn(),
  };
}

function units(distance: 'km' | 'mi') {
  return {
    unitPrefs: {
      distance,
      speed: distance === 'mi' ? 'mph' : 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: 2,
    },
  };
}

function renderPage(initialEntries: string[] = ['/route-efficiency?from=2026-01-01&to=2026-01-31']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <RouteEfficiencyPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const kpiRegion = () => screen.getByRole('region', { name: 'Route efficiency summary metrics' });
const cardsRegion = () => screen.getByRole('region', { name: 'Most-driven routes' });

/** Read a KPI MetricCard's value <p> given its label, scoped to the KPI band. */
function kpiValue(label: string): string {
  const labelEl = within(kpiRegion()).getByText(label);
  return labelEl.closest('p')?.nextElementSibling?.textContent ?? '';
}

beforeEach(() => {
  mockRouteEff.mockReset();
  mockSelected.mockReset();
  mockUnits.mockReset();

  mockSelected.mockReturnValue(selected(7));
  mockUnits.mockReturnValue(units('km'));
  mockRouteEff.mockReturnValue(makeQuery({ data: { routes: ROUTES } }));
});

describe('RouteEfficiencyPage — no vehicle selected', () => {
  it('shows the select-a-vehicle empty copy and no route cards', () => {
    mockSelected.mockReturnValue(selected(null));
    mockRouteEff.mockReturnValue(makeQuery({ data: undefined }));
    renderPage();

    const empties = screen.getAllByText('Select a vehicle to see route efficiency');
    // One in the Route Metrics panel, one in the route-cards section.
    expect(empties.length).toBeGreaterThanOrEqual(2);
    // No route endpoints are rendered when there is nothing to show.
    expect(screen.queryByText('Beach')).not.toBeInTheDocument();
    // The AI panel is handed no id when the fleet is unselected.
    expect(screen.getByTestId('ai-suggestions')).toHaveAttribute('data-vehicle-id', '');
  });
});

describe('RouteEfficiencyPage — loading', () => {
  it('shows the chart loading state and never flashes the empty copy or KPI cards', () => {
    mockRouteEff.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    renderPage();

    expect(screen.getByTestId('chart-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-empty')).not.toBeInTheDocument();
    // While loading, the KPI band shows skeletons — the "Routes" tile is withheld.
    expect(within(kpiRegion()).queryByText('Routes')).not.toBeInTheDocument();
    // The no-data empty copy must not appear during loading.
    expect(screen.queryByText('No route data')).not.toBeInTheDocument();
  });
});

describe('RouteEfficiencyPage — error', () => {
  it('surfaces a retryable error in every section and replaces the chart with an error panel', () => {
    const refetch = vi.fn();
    mockRouteEff.mockReturnValue(
      makeQuery({ data: undefined, error: new Error('boom'), isError: true, refetch }),
    );
    renderPage();

    // The chart is swapped for an error panel that keeps its title.
    expect(screen.queryByTestId('chart-container')).not.toBeInTheDocument();
    expect(screen.getByText('Route Efficiency Comparison')).toBeInTheDocument();

    // Every data-bound section renders its own retry affordance.
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThanOrEqual(3);

    fireEvent.click(retries[0]);
    expect(refetch).toHaveBeenCalledTimes(1);

    // The KPI band shows the error, not the metric tiles.
    expect(within(kpiRegion()).queryByText('Total Trips')).not.toBeInTheDocument();
  });

  it('keeps rendering the last good routes when a background refetch errors', () => {
    // TanStack Query retains `data` from the last success even when a later
    // refetch fails, so a transient error must NOT collapse the whole page —
    // the still-valid routes stay on screen and the header freshness chip owns
    // the degraded signal.
    mockRouteEff.mockReturnValue(
      makeQuery({ data: { routes: ROUTES }, error: new Error('refetch failed'), isError: true }),
    );
    renderPage();

    expect(kpiValue('Routes')).toBe('3');
    expect(screen.getByTestId('chart-container')).toBeInTheDocument();
    expect(within(cardsRegion()).getByText('Beach')).toBeInTheDocument();
    // No section degrades into the retry-only error panel while data exists.
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});

describe('RouteEfficiencyPage — populated (km)', () => {
  it('renders honest KPI tiles derived from the route aggregates', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Route Efficiency', level: 1 })).toBeInTheDocument();
    expect(kpiValue('Routes')).toBe('3');
    expect(kpiValue('Total Trips')).toBe(String(TOTAL_TRIPS));
    expect(kpiValue('Best')).toBe(String(BEST_WH_KM));
    expect(kpiValue('Avg')).toBe(String(AVG_WH_KM));
    expect(kpiValue('Worst')).toBe(String(WORST_WH_KM));
    // routes[0] is the most-driven under the API's trip-count-desc ordering.
    expect(kpiValue('Most-driven')).toBe('12');
    // The efficiency tiles carry the km unit subtitle.
    expect(within(kpiRegion()).getAllByText('Wh/km').length).toBeGreaterThanOrEqual(3);
  });

  it('renders the comparison chart lowest-consumption-first with km headers', () => {
    renderPage();

    expect(screen.getByText('Best Wh/km')).toBeInTheDocument();
    expect(screen.getByText('Avg Wh/km')).toBeInTheDocument();

    const names = screen.getAllByTestId('chart-cell-name').map((c) => c.textContent);
    // Sorted by avgEfficiency ascending: Gym(150) → Office(160) → Beach(210).
    expect(names).toEqual(['Home\u2192Gym', 'Home\u2192Office', 'Home\u2192Beach']);

    // The first (lowest-consumption) row carries Gym's converted figures.
    const firstAvg = screen.getAllByTestId('chart-cell-avg')[0];
    expect(firstAvg).toHaveTextContent('150');
  });

  it('renders one card per route with its endpoints and the AI panel with the vehicle id', () => {
    renderPage();

    const cards = cardsRegion();
    expect(within(cards).getByText('Office')).toBeInTheDocument();
    expect(within(cards).getByText('Gym')).toBeInTheDocument();
    expect(within(cards).getByText('Beach')).toBeInTheDocument();

    expect(screen.getByTestId('ai-suggestions')).toHaveAttribute('data-vehicle-id', '7');
  });
});

describe('RouteEfficiencyPage — unit boundary (mi)', () => {
  it('re-labels the efficiency unit and runs the real Wh/km → Wh/mi converter', () => {
    mockUnits.mockReturnValue(units('mi'));
    renderPage();

    expect(within(kpiRegion()).getAllByText('Wh/mi').length).toBeGreaterThanOrEqual(3);
    expect(within(kpiRegion()).queryByText('Wh/km')).not.toBeInTheDocument();
    // Best 130 Wh/km → 130 * 1.609344 → 209 Wh/mi.
    expect(kpiValue('Best')).toBe(String(Math.round(BEST_WH_KM * KM_PER_MILE)));
    // The chart headers follow the same preference.
    expect(screen.getByText('Avg Wh/mi')).toBeInTheDocument();
  });
});

describe('RouteEfficiencyPage — comparison chart bounds', () => {
  it('caps the chart at MAX_COMPARISON_ROUTES rows, still sorted ascending', () => {
    const many: RouteSummary[] = Array.from({ length: 12 }).map((_, i) =>
      makeRoute({
        startLocation: `R${String(i).padStart(2, '0')}`,
        endLocation: 'End',
        tripCount: 20 - i,
        avgEfficiency: 100 + i * 10, // 100..210, already ascending
      }),
    );
    mockRouteEff.mockReturnValue(makeQuery({ data: { routes: many } }));
    renderPage();

    const rows = screen.getAllByTestId('chart-row');
    expect(rows).toHaveLength(10);
    // Lowest avgEfficiency first; the two highest are dropped by the cap.
    const names = screen.getAllByTestId('chart-cell-name').map((c) => c.textContent);
    expect(names[0]).toBe('R00\u2192End');
    expect(names).not.toContain('R11\u2192End');
  });

  it('shows the chart empty state for a single route while KPIs and the card still render', () => {
    mockRouteEff.mockReturnValue(
      makeQuery({ data: { routes: [makeRoute({ startLocation: 'Home', endLocation: 'Depot', tripCount: 4 })] } }),
    );
    renderPage();

    // A comparison needs ≥2 routes, so the chart reports empty…
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument();
    // …but the rest of the page still shows real content.
    expect(kpiValue('Routes')).toBe('1');
    expect(within(cardsRegion()).getByText('Depot')).toBeInTheDocument();
  });
});

describe('RouteEfficiencyPage — range picker URL wiring', () => {
  it('reflects the URL range and commits a new range as snake_case from/to', async () => {
    renderPage();

    // Initial range is read from the URL query params.
    expect(screen.getByTestId('range-display')).toHaveTextContent('2026-01-01..2026-01-31');
    expect(mockRouteEff).toHaveBeenCalledWith('7', '2026-01-01', '2026-01-31');

    fireEvent.click(screen.getByTestId('route-efficiency-range-picker'));

    // The committed range round-trips through the URL and re-drives the hook.
    await waitFor(() =>
      expect(screen.getByTestId('range-display')).toHaveTextContent('2026-05-01..2026-05-31'),
    );
    expect(mockRouteEff).toHaveBeenLastCalledWith('7', '2026-05-01', '2026-05-31');
  });
});
