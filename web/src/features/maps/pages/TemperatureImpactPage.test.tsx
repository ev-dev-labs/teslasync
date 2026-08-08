/**
 * TemperatureImpactPage — behaviour + hardening coverage.
 *
 * The page has a single default export: the "how outside temperature affects
 * driving efficiency" analytics page. This suite drives it through every
 * meaningful branch by mocking only its data + environment hooks
 * (`useTemperatureImpact` / `useSelectedVehicle` / `useUnits`), the AI narrator,
 * the forms row, the motion primitives, and the charts barrel. Everything on
 * the render boundary is REAL: the page's SI→display conversion runs through the
 * genuine `formatTemperature` / `formatDistance` (from `@/lib/unitConversion`,
 * wired into the `useUnits` double) plus the real `convertTempFromSI` and
 * `fmtNumber`, so the unit maths + KPI aggregation are actually exercised.
 * Network is never touched.
 *
 * Facets covered:
 *   - no-vehicle guard: "select a vehicle" copy everywhere, AI gets no id, and
 *     the hook is invoked with the empty vehicle scope.
 *   - loading: sections show skeletons; no empty/error copy leaks through.
 *   - error (no data): every data-bound section surfaces a retryable QueryError
 *     and Retry calls refetch.
 *   - error (retained data): a failed background refetch keeps last-good content
 *     on screen instead of collapsing into retry panels (hardening).
 *   - populated (km): honest KPI tiles, the full 5-bucket legend, the optimal
 *     analysis copy + delta, the contextual tips, and the recent-drives table.
 *   - unit boundary (mi/°F): re-labels the efficiency unit + runs the real
 *     Wh/km→Wh/mi and °C→°F converters through to KPI + table cells.
 *   - partial data (monthly-only): point sections empty while the seasonal panel
 *     still renders.
 *   - out-of-range clamping (bug fix): extreme temps land in the nearest EDGE
 *     bucket, not the middle one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import {
  formatTemperature as libFormatTemperature,
  formatDistance as libFormatDistance,
  type UnitPref,
} from '@/lib/unitConversion';
import type { TemperatureImpactResponse, TemperatureImpactPoint } from '@/api/hooks/useAnalytics';

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

// ── charts barrel: recharts primitives are inert. ResponsiveContainer renders
//    nothing so chart internals don't need a layout engine; everything the page
//    draws OUTSIDE the chart (the bucket-colour legend, KPI band, badges, table)
//    still renders and stays assertable. The two data constants the page indexes
//    into (`CHART_COLORS[n]`) / spreads (`AREA_DEFAULTS`) are real-shaped. ──────
vi.mock('@/components/charts', () => {
  const Null = () => null;
  return {
    ChartTooltip: Null,
    CHART_COLORS: ['#06b6d4', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'],
    AREA_DEFAULTS: {},
    ResponsiveContainer: Null,
    ScatterChart: Null,
    Scatter: Null,
    Cell: Null,
    XAxis: Null,
    YAxis: Null,
    CartesianGrid: Null,
    Tooltip: Null,
    LineChart: Null,
    Line: Null,
    Legend: Null,
    ReferenceLine: Null,
    ComposedChart: Null,
    Bar: Null,
  };
});

// ── forms row: VehicleSelect is a bare marker. ──
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

// ── AI narrator: surfaces the vehicleId it was handed so the parent wiring is
//    assertable (production gates its own visibility on ai_mode). ──
vi.mock('@/components/ai/AICabinTemperatureImpactNarrative', () => ({
  AICabinTemperatureImpactNarrative: ({ vehicleId }: { vehicleId?: string | number }) => (
    <div data-testid="ai-narrative" data-vehicle-id={vehicleId ?? ''} />
  ),
}));

// ── side-effect-only hooks + data/environment hooks, driven per test. ──
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/api/hooks/useAnalytics', () => ({ useTemperatureImpact: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));

import { useTemperatureImpact } from '@/api/hooks/useAnalytics';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import TemperatureImpactPage from './TemperatureImpactPage';

const mockTempImpact = useTemperatureImpact as unknown as ReturnType<typeof vi.fn>;
const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;

// Display-label helpers. The page renders bucket ranges with a U+2013 en-dash
// and a °C/°F suffix — mirror that exactly so assertions read on real copy.
const NDASH = '\u2013';
const B_COLD = '< 0°C';
const B0to10 = `0${NDASH}10°C`;
const B10to20 = `10${NDASH}20°C`;
const B20to30 = `20${NDASH}30°C`;
const B_HOT = '> 30°C';

// 1 mile in km — matches the KM_PER_MILE constant the page uses, so the mi
// boundary assertions read on concrete numbers rather than re-deriving maths.
const KM_PER_MILE = 1.609344;

 
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

function point(over: Partial<TemperatureImpactPoint> = {}): TemperatureImpactPoint {
  return { outside_temp: 15, efficiency_wh_km: 150, distance_km: 30, drive_date: '2026-01-15T12:00:00Z', ...over };
}

/**
 * One point in each of the five temperature buckets. Efficiency is deliberately
 * NOT monotonic with temperature — the 10–20°C bucket (150) is the most
 * efficient (best) and the >30°C bucket (220) the least (worst) — so the page's
 * own best/worst selection is observable rather than trivially ordered.
 */
const POINTS: TemperatureImpactPoint[] = [
  point({ outside_temp: -5, efficiency_wh_km: 210, distance_km: 12, drive_date: '2026-01-05T12:00:00Z' }), // < 0°C
  point({ outside_temp: 5, efficiency_wh_km: 200, distance_km: 20, drive_date: '2026-01-10T12:00:00Z' }), // 0–10°C
  point({ outside_temp: 15, efficiency_wh_km: 150, distance_km: 30, drive_date: '2026-01-15T12:00:00Z' }), // 10–20°C best
  point({ outside_temp: 25, efficiency_wh_km: 180, distance_km: 40, drive_date: '2026-01-20T12:00:00Z' }), // 20–30°C
  point({ outside_temp: 35, efficiency_wh_km: 220, distance_km: 50, drive_date: '2026-01-25T12:00:00Z' }), // > 30°C worst
];

const AVG_WH_KM = (210 + 200 + 150 + 180 + 220) / 5; // 192

const MONTHLY = [
  { month: '2026-01', avg_temp: 5, avg_efficiency: 190, drive_count: 5, total_distance: 100 },
];

function fullData(over: Partial<TemperatureImpactResponse> = {}): TemperatureImpactResponse {
  return { points: POINTS, efficiency: [], vampire_drain: [], monthly_trend: MONTHLY, ...over };
}

 
function selected(vehicleId: number | null): any {
  return {
    vehicleId,
    vehicle: null,
    vehicles: vehicleId != null ? [{ id: vehicleId, display_name: 'Model 3', vin: 'VIN7' }] : [],
    setVehicleId: vi.fn(),
  };
}

function makePrefs(distance: 'km' | 'mi', temperature: '°C' | '°F'): UnitPref {
  return {
    distance,
    speed: distance === 'mi' ? 'mph' : 'km/h',
    temperature,
    pressure: 'bar',
    energy: 'kWh',
    duration: 'h',
    power: 'kW',
    locale: 'en-US',
    precision: 2,
  };
}

/**
 * `useUnits` double that keeps the SI→display formatters REAL (delegating to
 * `@/lib/unitConversion`) while letting each test pin the user's unit prefs.
 */
function units(distance: 'km' | 'mi' = 'km', temperature: '°C' | '°F' = '°C') {
  const prefs = makePrefs(distance, temperature);
  const passthrough = (v: number | null | undefined) => (v == null ? '—' : String(v));
  return {
    unitPrefs: prefs,
    formatTemperature: (v: number | null | undefined) => libFormatTemperature(v, prefs),
    formatDistance: (v: number | null | undefined) => libFormatDistance(v, prefs),
    formatSpeed: passthrough,
    formatEnergy: passthrough,
    formatPressure: passthrough,
    formatDuration: passthrough,
    formatPower: passthrough,
  };
}

function renderPage(): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/analytics/temperature-impact']}>
      <QueryClientProvider client={client}>
        <TemperatureImpactPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const kpiRegion = () => screen.getByRole('region', { name: 'Summary metrics' });

/** Read a KPI MetricCard's value <p> given its label, scoped to the KPI band. */
function kpiValue(label: string): string {
  const labelEl = within(kpiRegion()).getByText(label);
  return labelEl.closest('p')?.nextElementSibling?.textContent ?? '';
}

beforeEach(() => {
  mockTempImpact.mockReset();
  mockSelected.mockReset();
  mockUnits.mockReset();

  mockSelected.mockReturnValue(selected(7));
  mockUnits.mockReturnValue(units('km', '°C'));
  mockTempImpact.mockReturnValue(makeQuery({ data: fullData() }));
});

describe('TemperatureImpactPage — no vehicle selected', () => {
  it('shows the select-a-vehicle copy, hands the AI narrator no id, and scopes the hook to empty', () => {
    mockSelected.mockReturnValue(selected(null));
    mockTempImpact.mockReturnValue(makeQuery({ data: undefined }));
    renderPage();

    const empties = screen.getAllByText('Select a vehicle to view temperature impact');
    // Every point-based section plus the seasonal panel prompt for a vehicle.
    expect(empties.length).toBeGreaterThanOrEqual(5);
    // KPIs degrade to placeholders, not stale numbers.
    expect(kpiValue('Avg Efficiency')).toBe('—');
    // The AI narrator is handed no id when the fleet is unselected.
    expect(screen.getByTestId('ai-narrative')).toHaveAttribute('data-vehicle-id', '');
    // The query hook is scoped to the empty vehicle (disabled upstream).
    expect(mockTempImpact).toHaveBeenCalledWith('');
  });
});

describe('TemperatureImpactPage — loading', () => {
  it('shows skeletons and never flashes the empty or error copy', () => {
    mockTempImpact.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    const { container } = renderPage();

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('No drive data available yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    // Aggregates are withheld while the first load is in flight.
    expect(kpiValue('Avg Efficiency')).toBe('—');
  });
});

describe('TemperatureImpactPage — error with no data', () => {
  it('surfaces a retryable error in every data section and wires Retry to refetch', () => {
    const refetch = vi.fn();
    mockTempImpact.mockReturnValue(
      makeQuery({ data: undefined, error: new Error('boom'), isError: true, refetch }),
    );
    renderPage();

    const retries = screen.getAllByRole('button', { name: 'Retry' });
    // Scatter, optimal, bucket-line, seasonal, recommendations, recent-drives.
    expect(retries.length).toBeGreaterThanOrEqual(5);

    fireEvent.click(retries[0]);
    expect(refetch).toHaveBeenCalledTimes(1);

    // The error takes precedence over the empty copy (never both).
    expect(screen.queryByText('No drive data available yet')).not.toBeInTheDocument();
    // KPIs still render as placeholders rather than crashing.
    expect(kpiValue('Total Data Points')).toBe('0');
  });
});

describe('TemperatureImpactPage — error with retained data', () => {
  it('keeps the last good analysis on screen when a background refetch errors', () => {
    // TanStack Query retains `data` from the last success even when a later
    // refetch fails, so a transient error must NOT collapse the page into
    // retry panels — the still-valid content stays and the header freshness
    // chip owns the degraded signal.
    mockTempImpact.mockReturnValue(
      makeQuery({ data: fullData(), error: new Error('refetch failed'), isError: true }),
    );
    renderPage();

    expect(kpiValue('Total Data Points')).toBe('5');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText(/most efficient temperature range/i)).toBeInTheDocument();
    // No section degrades into the retry-only error panel while data exists.
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});

describe('TemperatureImpactPage — populated (km)', () => {
  it('renders honest KPI tiles derived from the point aggregates', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Temperature Impact', level: 1 })).toBeInTheDocument();
    expect(kpiValue('Avg Efficiency')).toBe(`${AVG_WH_KM.toFixed(2)} Wh/km`); // 192.00 Wh/km
    expect(kpiValue('Best Temp Range')).toBe(B10to20);
    expect(kpiValue('Worst Temp Range')).toBe(B_HOT);
    expect(kpiValue('Total Data Points')).toBe('5');
    // The AI narrator receives the selected vehicle id as a string.
    expect(screen.getByTestId('ai-narrative')).toHaveAttribute('data-vehicle-id', '7');
  });

  it('renders the full five-bucket colour legend', () => {
    renderPage();
    // 0–10°C and 20–30°C appear ONLY in the legend (they are neither best nor
    // worst), so finding them proves the whole legend rendered.
    for (const label of [B_COLD, B0to10, B10to20, B20to30, B_HOT]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('explains the optimal range with the best figures and the best-vs-worst delta', () => {
    renderPage();

    const optimal = screen.getByText(/most efficient temperature range/i);
    expect(optimal).toHaveTextContent(B10to20);
    expect(optimal).toHaveTextContent('150.00 Wh/km');
    expect(optimal).toHaveTextContent('across 1 drives');

    const delta = screen.getByText(/Compared to the worst range/i);
    expect(delta).toHaveTextContent(B_HOT);
    expect(delta).toHaveTextContent('70.00 Wh/km'); // 220 - 150
  });

  it('renders the three contextual recommendations', () => {
    renderPage();
    expect(screen.getByText(`Best efficiency observed in the ${B10to20} range`)).toBeInTheDocument();
    expect(screen.getByText(/Precondition your cabin in cold weather/i)).toBeInTheDocument();
    expect(screen.getByText(/Park in shade during hot weather/i)).toBeInTheDocument();
  });

  it('renders the recent-drives table with converted temperature, efficiency, and distance cells', () => {
    renderPage();
    const table = screen.getByRole('table');

    expect(within(table).getByText('Temperature')).toBeInTheDocument();
    expect(within(table).getByText('Efficiency')).toBeInTheDocument();
    expect(within(table).getByText('Distance')).toBeInTheDocument();

    // The 10–20°C drive (temp 15°C, eff 150 Wh/km, dist 30 km).
    expect(within(table).getByText('15.00°C')).toBeInTheDocument();
    expect(within(table).getByText('150.00 Wh/km')).toBeInTheDocument();
    expect(within(table).getByText('30.00 km')).toBeInTheDocument();
  });
});

describe('TemperatureImpactPage — unit boundary (mi/°F)', () => {
  it('re-labels the efficiency unit and runs the real Wh/km→Wh/mi and °C→°F converters', () => {
    mockUnits.mockReturnValue(units('mi', '°F'));
    renderPage();

    // Avg 192 Wh/km → 192 * 1.609344 → 309.09 Wh/mi.
    expect(kpiValue('Avg Efficiency')).toBe(`${(AVG_WH_KM * KM_PER_MILE).toFixed(2)} Wh/mi`);
    // Best bucket 10–20°C → 50–68°F.
    expect(kpiValue('Best Temp Range')).toBe(`50${NDASH}68°F`);
    expect(within(kpiRegion()).queryByText(B10to20)).not.toBeInTheDocument();

    const table = screen.getByRole('table');
    // Temp 15°C → 59°F; eff 150 Wh/km → 241.40 Wh/mi.
    expect(within(table).getByText('59.00°F')).toBeInTheDocument();
    expect(within(table).getByText(`${(150 * KM_PER_MILE).toFixed(2)} Wh/mi`)).toBeInTheDocument();
  });
});

describe('TemperatureImpactPage — partial data (seasonal only)', () => {
  it('renders the seasonal panel while every point-based section shows empty', () => {
    mockTempImpact.mockReturnValue(makeQuery({ data: fullData({ points: [] }) }));
    renderPage();

    // Scatter, optimal, bucket-line, recommendations, recent-drives = 5 empties;
    // the monthly panel keeps its (inert) chart and is NOT one of them.
    const empties = screen.getAllByText('No drive data available yet');
    expect(empties).toHaveLength(5);
    expect(screen.getByText('Monthly Seasonal Trend')).toBeInTheDocument();
    expect(kpiValue('Total Data Points')).toBe('0');
  });
});

describe('TemperatureImpactPage — out-of-range temperature clamping', () => {
  it('clamps extreme readings to the nearest edge bucket instead of the middle one', () => {
    // -80°C is below every bucket and 70°C is above every bucket. A middle
    // fallback (the old bug) would file BOTH into 10–20°C; the fix routes them
    // to the coldest / hottest edge buckets respectively.
    mockTempImpact.mockReturnValue(
      makeQuery({
        data: fullData({
          points: [
            point({ outside_temp: -80, efficiency_wh_km: 250, distance_km: 10, drive_date: '2026-01-01T12:00:00Z' }),
            point({ outside_temp: 70, efficiency_wh_km: 350, distance_km: 12, drive_date: '2026-07-01T12:00:00Z' }),
          ],
        }),
      }),
    );
    renderPage();

    // Best = coldest edge (250 Wh/km), Worst = hottest edge (350 Wh/km).
    expect(kpiValue('Best Temp Range')).toBe(B_COLD);
    expect(kpiValue('Worst Temp Range')).toBe(B_HOT);
    // The middle bucket must NOT capture the extremes.
    expect(within(kpiRegion()).queryByText(B10to20)).not.toBeInTheDocument();
    expect(kpiValue('Avg Efficiency')).toBe('300.00 Wh/km'); // (250 + 350) / 2
  });
});
