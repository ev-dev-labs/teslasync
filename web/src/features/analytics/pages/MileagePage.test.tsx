/**
 * MileagePage — behaviour + hardening coverage.
 *
 * MileagePage exposes a single default export (the page). This suite drives it
 * through every meaningful branch by mocking its three data hooks
 * (`useMileageStats` / `useDailyMileage` / `useMonthlyMileage`), the selected
 * vehicle, the chart palette, and the unit preference. Network is never
 * touched.
 *
 * Facets covered:
 *   - no-vehicle guard renders <NoVehicleSelected> instead of data scaffolding.
 *   - loading: panel titles always render; KPI values + charts do NOT (skeletons).
 *   - populated happy path: honest KPI values, distance-by-window bars,
 *     activity KVList, three chart surfaces (role="img"), monthly summary table
 *     with unit-suffixed headers, and hook-wiring (stringified vehicle id + the
 *     90-day daily window).
 *   - unit boundary: switching the display unit to miles re-labels headers/cards
 *     and runs the real SI converter (km → mi) at the render edge.
 *   - empty states: odometer / daily / monthly each show their own placeholder.
 *   - odometer null-filter branch: rows with a null end odometer are dropped so
 *     the odometer panel goes empty while the daily-distance chart still renders.
 *   - per-query error + retry: stats, daily, and monthly failures each surface a
 *     QueryError and re-invoke that query's refetch, without cross-contaminating
 *     the healthy panels.
 *   - null-safety: null first/last drive timestamps fall back to the "—" glyph.
 *   - a11y/actions: labelled region landmarks + the VehicleSelect combobox.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/resilience';
import type {
  MileageStats,
  DailyMileageBucket,
  MonthlyMileageBucket,
} from '@/types/analytics';
import type { Vehicle } from '@/types/vehicle';

// ── i18n stub: return the fallback string, interpolating {{var}} options ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
          return s;
        }
        return fallbackOrOpts;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── framer-motion: strip animation props (keep motion.div + useReducedMotion) ──
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
              k === 'animate' ||
              k === 'initial' ||
              k === 'exit' ||
              k === 'transition' ||
              k === 'whileHover' ||
              k === 'whileTap' ||
              k === 'variants'
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

// ── Data + environment hooks, driven per test ──
vi.mock('@/api/hooks/useAnalytics', () => ({
  useMileageStats: vi.fn(),
  useDailyMileage: vi.fn(),
  useMonthlyMileage: vi.fn(),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/hooks/useChartPalette', () => ({ useChartPalette: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));

import { useMileageStats, useDailyMileage, useMonthlyMileage } from '@/api/hooks/useAnalytics';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useChartPalette } from '@/hooks/useChartPalette';
import { useUnits } from '@/hooks/useUnits';
import MileagePage from './MileagePage';

const mockStats = useMileageStats as unknown as ReturnType<typeof vi.fn>;
const mockDaily = useDailyMileage as unknown as ReturnType<typeof vi.fn>;
const mockMonthly = useMonthlyMileage as unknown as ReturnType<typeof vi.fn>;
const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockPalette = useChartPalette as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;

const PALETTE = ['#0a', '#0b', '#0c', '#0d', '#0e', '#0f', '#1a', '#1b'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

const STATS: MileageStats = {
  vehicle_id: 7,
  lifetime_km: 12000,
  last_7d_km: 210,
  last_30d_km: 930,
  last_365d_km: 9500,
  drive_count_lifetime: 500,
  drive_count_30d: 40,
  first_drive_at: '2020-01-15T08:00:00Z',
  last_drive_at: '2024-06-01T18:30:00Z',
};

const DAILY: DailyMileageBucket[] = [
  { date: '2024-05-30', drive_count: 2, total_km: 30, end_odometer_km: 11970 },
  { date: '2024-05-31', drive_count: 1, total_km: 20, end_odometer_km: 11990 },
  { date: '2024-06-01', drive_count: 3, total_km: 40, end_odometer_km: 12000 },
];

const MONTHLY: MonthlyMileageBucket[] = [
  { year_month: '2024-05', drive_count: 20, total_km: 400, total_wh_consumed: null, avg_efficiency_wh_per_km: null },
  { year_month: '2024-06', drive_count: 40, total_km: 930, total_wh_consumed: null, avg_efficiency_wh_per_km: null },
];

const FLEET = [
  { id: 7, display_name: 'My Model 3', vin: 'VIN00007' },
] as unknown as Vehicle[];

function selected(vehicleId: number | null) {
  return {
    vehicleId,
    vehicle: vehicleId != null ? FLEET[0] : null,
    vehicles: FLEET,
    setVehicleId: vi.fn(),
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MileagePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const kpiRegion = () => screen.getByRole('region', { name: 'Mileage summary metrics' });
const windowsRegion = () => screen.getByRole('region', { name: 'Odometer and distance windows' });
const chartsRegion = () => screen.getByRole('region', { name: 'Daily and monthly distance' });

/** Value <p> that immediately follows a MetricCard's label span. */
function cardValue(region: HTMLElement, label: string): string {
  const span = within(region).getByText(label);
  return span.closest('p')?.nextElementSibling?.textContent ?? '';
}

/** Sibling that immediately follows a label span (MetricBar sublabel / KVList dd). */
function siblingText(region: HTMLElement, label: string): string {
  return within(region).getByText(label).nextElementSibling?.textContent ?? '';
}

beforeEach(() => {
  mockStats.mockReset();
  mockDaily.mockReset();
  mockMonthly.mockReset();
  mockSelected.mockReset();
  mockPalette.mockReset();
  mockUnits.mockReset();

  mockPalette.mockReturnValue(PALETTE);
  mockUnits.mockReturnValue({ unitPrefs: { distance: 'km' } });
  mockSelected.mockReturnValue(selected(7));
  mockStats.mockReturnValue(makeQuery({ data: STATS }));
  mockDaily.mockReturnValue(makeQuery({ data: DAILY }));
  mockMonthly.mockReturnValue(makeQuery({ data: MONTHLY }));
});

describe('MileagePage — no vehicle selected', () => {
  it('renders the NoVehicleSelected empty state and no data scaffolding', () => {
    mockSelected.mockReturnValue(selected(null));
    renderPage();

    expect(screen.getByText('No vehicle selected')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Set up TeslaSync' }),
    ).toBeInTheDocument();
    // The KPI region and its metrics must not mount when there is no vehicle.
    expect(screen.queryByRole('region', { name: 'Mileage summary metrics' })).toBeNull();
    expect(screen.queryByText('Total Distance')).toBeNull();
  });
});

describe('MileagePage — loading', () => {
  it('keeps panel titles but withholds KPI values and charts while loading', () => {
    mockStats.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    mockDaily.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    mockMonthly.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    renderPage();

    // Page + panel scaffolding always renders.
    expect(screen.getByRole('heading', { name: 'Mileage', level: 1 })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Odometer Over Time', level: 3 }),
    ).toBeInTheDocument();
    // Skeletons stand in for the real content: no metric values, no chart image.
    expect(within(kpiRegion()).queryByText('Total Distance')).toBeNull();
    expect(screen.queryByRole('img', { name: 'Odometer Over Time' })).toBeNull();
    // Loading is not "empty": the empty-state copy must not show yet.
    expect(screen.queryByText('No odometer readings yet')).toBeNull();
  });
});

describe('MileagePage — populated (km)', () => {
  it('derives honest KPI tiles from /mileage/stats', () => {
    renderPage();
    const kpi = kpiRegion();

    expect(cardValue(kpi, 'Total Distance')).toBe('12,000 km');
    expect(cardValue(kpi, 'Total Drives')).toBe('500');
    // last_30d_km 930 / 30 = 31.00
    expect(cardValue(kpi, 'Daily Avg (30d)')).toBe('31.00 km');
    // 31 * 365 = 11,315 (integer projection)
    expect(cardValue(kpi, 'Annual Projection')).toBe('11,315 km');
    expect(cardValue(kpi, 'Last 7 Days')).toBe('210.00 km');
    expect(cardValue(kpi, 'Last 365 Days')).toBe('9,500 km');
  });

  it('renders distance-by-window bars and the activity list', () => {
    renderPage();
    const w = windowsRegion();

    // MetricBar sublabels (fmtNumber → 2 decimals).
    expect(siblingText(w, 'Last 7 Days')).toBe('210.00 km');
    expect(siblingText(w, 'Last 30 Days')).toBe('930.00 km');
    expect(siblingText(w, 'Last 365 Days')).toBe('9,500.00 km');

    // Activity KVList.
    expect(siblingText(w, 'Lifetime Drives')).toBe('500');
    expect(siblingText(w, 'Drives (30d)')).toBe('40');
    expect(siblingText(w, 'First Drive')).toContain('2020');
    expect(siblingText(w, 'Last Drive')).toContain('2024');
  });

  it('mounts the three chart surfaces and the monthly summary table', () => {
    renderPage();

    expect(within(windowsRegion()).getByRole('img', { name: 'Odometer Over Time' })).toBeInTheDocument();
    expect(within(chartsRegion()).getByRole('img', { name: 'Daily Distance' })).toBeInTheDocument();
    expect(within(chartsRegion()).getByRole('img', { name: 'Monthly Distance' })).toBeInTheDocument();

    // Monthly summary table: unit-suffixed headers + a data row.
    const table = screen.getByRole('table');
    expect(within(table).getByText('Distance (km)')).toBeInTheDocument();
    expect(within(table).getByText('Distance / Drive (km)')).toBeInTheDocument();
    expect(within(table).getByText('2024-06')).toBeInTheDocument();
    // 400 km / 20 drives = 20.00 distance-per-drive for the May row.
    expect(within(table).getByText('20.00')).toBeInTheDocument();
  });

  it('wires the hooks with the stringified vehicle id and the 90-day daily window', () => {
    renderPage();
    expect(mockStats).toHaveBeenCalledWith('7');
    expect(mockMonthly).toHaveBeenCalledWith('7');
    expect(mockDaily).toHaveBeenCalledWith('7', 90);
  });
});

describe('MileagePage — unit boundary (miles)', () => {
  it('re-labels headers/cards and converts SI km → mi at the render edge', () => {
    mockUnits.mockReturnValue({ unitPrefs: { distance: 'mi' } });
    renderPage();

    // 12000 km → 12000000 m ÷ 1609.344 ≈ 7456 mi (fmtInt).
    expect(cardValue(kpiRegion(), 'Total Distance')).toBe('7,456 mi');
    // Header + card unit suffix follow the preference.
    expect(within(screen.getByRole('table')).getByText('Distance (mi)')).toBeInTheDocument();
  });
});

describe('MileagePage — empty states', () => {
  it('shows a dedicated placeholder for each empty data source (stats still populated)', () => {
    mockDaily.mockReturnValue(makeQuery({ data: [] }));
    mockMonthly.mockReturnValue(makeQuery({ data: [] }));
    renderPage();

    expect(screen.getByText('No odometer readings yet')).toBeInTheDocument();
    expect(screen.getByText('No daily distance yet')).toBeInTheDocument();
    // Monthly bar chart empty-state + monthly table empty message.
    expect(screen.getAllByText('No monthly distance yet').length).toBeGreaterThanOrEqual(1);
    // KPIs still render because /mileage/stats resolved.
    expect(cardValue(kpiRegion(), 'Total Distance')).toBe('12,000 km');
  });

  it('drops null-odometer days so the odometer panel empties but daily distance still charts', () => {
    const noOdo = DAILY.map((d) => ({ ...d, end_odometer_km: null }));
    mockDaily.mockReturnValue(makeQuery({ data: noOdo }));
    renderPage();

    // Odometer filter removed every point → empty state.
    expect(screen.getByText('No odometer readings yet')).toBeInTheDocument();
    // But total_km is unaffected → the daily-distance chart still renders.
    expect(within(chartsRegion()).getByRole('img', { name: 'Daily Distance' })).toBeInTheDocument();
    expect(screen.queryByText('No daily distance yet')).toBeNull();
  });
});

describe('MileagePage — per-query error + retry', () => {
  it('surfaces a QueryError for a failed /mileage/stats and retries it', async () => {
    const q = makeQuery({ data: undefined, error: new ApiError('boom', 500), isError: true });
    mockStats.mockReturnValue(q);
    renderPage();

    const kpi = kpiRegion();
    expect(within(kpi).getByText('Server error')).toBeInTheDocument();
    // Healthy panels are unaffected — the daily chart still renders.
    expect(within(chartsRegion()).getByRole('img', { name: 'Daily Distance' })).toBeInTheDocument();

    fireEvent.click(within(kpi).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(q.refetch).toHaveBeenCalled());
  });

  it('surfaces a QueryError for a failed /mileage/daily and retries it', async () => {
    const q = makeQuery({ data: undefined, error: new ApiError('down', 503), isError: true });
    mockDaily.mockReturnValue(q);
    renderPage();

    const w = windowsRegion();
    expect(within(w).getByText('Server error')).toBeInTheDocument();
    // Stats-driven KPIs remain intact.
    expect(cardValue(kpiRegion(), 'Total Distance')).toBe('12,000 km');

    fireEvent.click(within(w).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(q.refetch).toHaveBeenCalled());
  });

  it('surfaces a QueryError for a failed /mileage/monthly and retries it', async () => {
    const q = makeQuery({ data: undefined, error: new ApiError('nope', 500), isError: true });
    mockMonthly.mockReturnValue(q);
    renderPage();

    const charts = chartsRegion();
    // Only the monthly chart errors; the daily chart still renders alongside it.
    expect(within(charts).getByText('Server error')).toBeInTheDocument();
    expect(within(charts).getByRole('img', { name: 'Daily Distance' })).toBeInTheDocument();

    fireEvent.click(within(charts).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(q.refetch).toHaveBeenCalled());
  });
});

describe('MileagePage — null safety + a11y', () => {
  it('falls back to the "—" glyph when first/last drive timestamps are null', () => {
    mockStats.mockReturnValue(
      makeQuery({ data: { ...STATS, first_drive_at: null, last_drive_at: null } }),
    );
    renderPage();

    const w = windowsRegion();
    expect(siblingText(w, 'First Drive')).toBe('—');
    expect(siblingText(w, 'Last Drive')).toBe('—');
    // Non-null numeric activity stats are unaffected.
    expect(siblingText(w, 'Lifetime Drives')).toBe('500');
  });

  it('exposes labelled region landmarks and the vehicle-scope combobox', () => {
    renderPage();

    expect(screen.getByRole('region', { name: 'Mileage summary metrics' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Odometer and distance windows' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Daily and monthly distance' })).toBeInTheDocument();

    const picker = screen.getByRole('combobox', { name: 'Select vehicle' });
    expect(picker).toHaveValue('7');
  });
});
