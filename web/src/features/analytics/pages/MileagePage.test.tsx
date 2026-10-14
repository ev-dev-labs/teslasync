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
 *   - a11y/actions: labelled region landmarks without a duplicate vehicle picker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps, ReactNode } from 'react';
import { ApiError } from '@/lib/resilience';
import type {
  MileageStats,
  DailyMileageBucket,
  MonthlyMileageBucket,
} from '@/types/analytics';
import type { Vehicle } from '@/types/vehicle';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

const chartEvidence = vi.hoisted(() => vi.fn());

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual,
    ...chartTestDoubles,
    EmbeddedChart: (props: ComponentProps<typeof chartTestDoubles.EmbeddedChart>) => {
      chartEvidence(props);
      return <chartTestDoubles.EmbeddedChart {...props} />;
    },
  };
});

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

function makeQuery(over: Record<string, unknown> = {}) {
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
    <MileagePage />,
    { wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    ) },
  );
}

const kpiRegion = () => screen.getByRole('region', { name: 'Mileage summary metrics' });
function panel(title: string): HTMLElement {
  const card = screen.getByRole('heading', { name: title, level: 3 }).closest('[data-card]');
  if (!(card instanceof HTMLElement)) throw new Error(`Missing mileage card: ${title}`);
  return card;
}
const windowsRegion = () => panel('Distance by window');
const odometerRegion = () => panel('Odometer over time');
const dailyRegion = () => panel('Daily distance');
const chartsRegion = () => panel('Monthly distance');

/** Read the real OperationalBrief metric's formatted quantity. */
function cardValue(region: HTMLElement, label: string): string {
  const tile = within(region).getByText(label).closest('[data-operational-metric]');
  if (!(tile instanceof HTMLElement)) throw new Error(`Missing mileage metric: ${label}`);
  return tile.querySelector('[data-operational-value]')?.textContent ?? '';
}

/** Sibling that immediately follows a label span (MetricBar sublabel / KVList dd). */
function siblingText(region: HTMLElement, label: string): string {
  return within(region).getByText(label).nextElementSibling?.textContent ?? '';
}

beforeEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  mockStats.mockReset();
  mockDaily.mockReset();
  mockMonthly.mockReset();
  mockSelected.mockReset();
  mockPalette.mockReset();
  mockUnits.mockReset();
  chartEvidence.mockClear();

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
    expect(screen.queryByText('Total distance')).toBeNull();
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
      screen.getByRole('heading', { name: 'Odometer over time', level: 3 }),
    ).toBeInTheDocument();
    // Skeletons stand in for the real content: no metric values, no chart image.
    expect(within(kpiRegion()).getByText('Total distance')).toBeInTheDocument();
    expect(kpiRegion().querySelector('[data-operational-value]')).toBeNull();
    expect(screen.queryByRole('img', { name: 'Odometer readings over time' })).toBeNull();
    // Loading is not "empty": the empty-state copy must not show yet.
    expect(screen.queryByText('No odometer readings yet')).toBeNull();
  });
});

describe('MileagePage — populated (km)', () => {
  it('derives honest KPI tiles from /mileage/stats', () => {
    renderPage();
    const kpi = kpiRegion();

    expect(cardValue(kpi, 'Total distance')).toBe('12,000 km');
    expect(cardValue(kpi, 'Total drives')).toBe('500');
    // last_30d_km 930 / 30 = 31.00
    expect(cardValue(kpi, 'Daily avg (30d)')).toBe('31.00 km');
    // 31 * 365 = 11,315 (integer projection)
    expect(cardValue(kpi, 'Annual projection')).toBe('11,315 km');
    expect(cardValue(kpi, 'Last 7 days')).toBe('210.00 km');
    expect(cardValue(kpi, 'Last 365 days')).toBe('9,500 km');
  });

  it('renders distance-by-window bars and the activity list', () => {
    renderPage();
    const w = windowsRegion();

    // MetricBar sublabels (fmtNumber → 2 decimals).
    expect(siblingText(w, 'Last 7 days')).toBe('210.00 km');
    expect(siblingText(w, 'Last 30 days')).toBe('930.00 km');
    expect(siblingText(w, 'Last 365 days')).toBe('9,500.00 km');

    // Activity KVList.
    expect(siblingText(w, 'Lifetime drives')).toBe('500');
    expect(siblingText(w, 'Drives (30d)')).toBe('40');
    expect(siblingText(w, 'First drive')).toContain('2020');
    expect(siblingText(w, 'Last drive')).toContain('2024');
  });

  it('mounts the three chart surfaces and the monthly summary table', () => {
    renderPage();

    expect(within(odometerRegion()).getByRole('img', { name: 'Odometer readings over time' })).toBeInTheDocument();
    expect(within(dailyRegion()).getByRole('img', { name: 'Daily distance traveled over time' })).toBeInTheDocument();
    expect(within(chartsRegion()).getByRole('img', { name: 'Monthly distance traveled over time' })).toBeInTheDocument();

    // Monthly summary table: unit-suffixed headers + a data row.
    const table = screen.getByRole('table');
    expect(within(table).getByText('Distance (km)')).toBeInTheDocument();
    expect(within(table).getByText('Distance / drive (km)')).toBeInTheDocument();
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
    expect(cardValue(kpiRegion(), 'Total distance')).toBe('7,456 mi');
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
    expect(cardValue(kpiRegion(), 'Total distance')).toBe('12,000 km');
  });

  it('drops null-odometer days so the odometer panel empties but daily distance still charts', () => {
    const noOdo = DAILY.map((d) => ({ ...d, end_odometer_km: null }));
    mockDaily.mockReturnValue(makeQuery({ data: noOdo }));
    renderPage();

    // Odometer filter removed every point → empty state.
    expect(screen.getByText('No odometer readings yet')).toBeInTheDocument();
    // But total_km is unaffected → the daily-distance chart still renders.
    expect(within(dailyRegion()).getByRole('img', { name: 'Daily distance traveled over time' })).toBeInTheDocument();
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
    expect(within(dailyRegion()).getByRole('img', { name: 'Daily distance traveled over time' })).toBeInTheDocument();

    fireEvent.click(within(kpi).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(q.refetch).toHaveBeenCalled());
  });

  it('surfaces a QueryError for a failed /mileage/daily and retries it', async () => {
    const q = makeQuery({ data: undefined, error: new ApiError('down', 503), isError: true });
    mockDaily.mockReturnValue(q);
    renderPage();

    const w = odometerRegion();
    expect(within(w).getByText('Service unavailable')).toBeInTheDocument();
    // Stats-driven KPIs remain intact.
    expect(cardValue(kpiRegion(), 'Total distance')).toBe('12,000 km');

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
    expect(within(dailyRegion()).getByRole('img', { name: 'Daily distance traveled over time' })).toBeInTheDocument();

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
    expect(siblingText(w, 'First drive')).toBe('—');
    expect(siblingText(w, 'Last drive')).toBe('—');
    // Non-null numeric activity stats are unaffected.
    expect(siblingText(w, 'Lifetime drives')).toBe('500');
  });

  it('exposes labelled regions without duplicating the shared vehicle control', () => {
    renderPage();

    expect(screen.getByRole('region', { name: 'Mileage summary metrics' })).toBeInTheDocument();
    expect(windowsRegion()).toHaveAccessibleName('Distance by window');
    expect(chartsRegion()).toHaveAccessibleName('Monthly distance');
    expect(odometerRegion()).toHaveAccessibleName('Odometer over time');
    expect(dailyRegion()).toHaveAccessibleName('Daily distance');
    expect(panel('Monthly summary')).toHaveAccessibleName('Monthly summary');

    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();
  });
});

describe('MileagePage — scoped modernization', () => {
  it.each(['summary', 'daily', 'monthly'])('keeps shells and neighbors when initial %s loading is paused', (source) => {
    const paused = makeQuery({ isPending: true, fetchStatus: 'paused', dataUpdatedAt: 0 });
    if (source === 'summary') mockStats.mockReturnValue(paused);
    if (source === 'daily') mockDaily.mockReturnValue(paused);
    if (source === 'monthly') mockMonthly.mockReturnValue(paused);
    const { container } = renderPage();
    expect(container.querySelectorAll('[data-card]')).toHaveLength(6);
    expect(screen.getAllByText('Mileage loading is paused. No mileage data has been received yet.')).toHaveLength(2);
    expect(screen.queryByText('Refresh is paused. Showing the last successful mileage data.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    if (source !== 'summary') expect(cardValue(kpiRegion(), 'Total distance')).toBe('12,000 km');
    if (source !== 'daily') expect(within(dailyRegion()).getByRole('img', { name: 'Daily distance traveled over time' })).toBeInTheDocument();
    if (source !== 'monthly') expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it.each(['summary', 'daily', 'monthly'])('recovers retained %s data after an independent retry', (source) => {
    const queries = {
      summary: makeQuery({ data: STATS }),
      daily: makeQuery({ data: DAILY }),
      monthly: makeQuery({ data: MONTHLY }),
    };
    const failed = { ...queries[source], error: new ApiError('refresh failed', 503), isError: true };
    const hook = source === 'summary' ? mockStats : source === 'daily' ? mockDaily : mockMonthly;
    hook.mockReturnValue(failed);
    const view = renderPage();
    const target = source === 'summary' ? kpiRegion() : source === 'daily' ? dailyRegion() : chartsRegion();
    expect(screen.getAllByText('Refresh failed. Showing the last successful mileage data.')).toHaveLength(2);
    fireEvent.click(within(target).getByRole('button', { name: 'Retry' }));
    expect(failed.refetch).toHaveBeenCalledOnce();
    for (const neighbor of ['summary', 'daily', 'monthly'] as const) {
      if (neighbor !== source) expect(queries[neighbor].refetch).not.toHaveBeenCalled();
    }
    hook.mockReturnValue({ ...queries[source], isFetching: true });
    view.rerender(<MileagePage />);
    expect(screen.queryByText('Refresh failed. Showing the last successful mileage data.')).toBeNull();
    expect(screen.getAllByText('Refreshing mileage data. Previously loaded content remains available.')).toHaveLength(2);
    hook.mockReturnValue(queries[source]);
    view.rerender(<MileagePage />);
    expect(screen.queryByText('Refreshing mileage data. Previously loaded content remains available.')).toBeNull();
    expect(cardValue(kpiRegion(), 'Total distance')).toBe('12,000 km');
    expect(screen.getAllByTestId('embedded-chart')).toHaveLength(3);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('preserves calendar bucket dates in both daily charts without shifting them into the prior day', () => {
    renderPage();

    expect(chartEvidence).toHaveBeenCalledWith(expect.objectContaining({
      chartKey: 'mileage-odometer-over-time',
      data: [
        { date: 'May 30, 2024', odometer: 11970 },
        { date: 'May 31, 2024', odometer: 11990 },
        { date: 'Jun 1, 2024', odometer: 12000 },
      ],
    }));
    expect(chartEvidence).toHaveBeenCalledWith(expect.objectContaining({
      chartKey: 'mileage-daily-distance',
      data: [
        { date: 'May 30, 2024', distance: 30 },
        { date: 'May 31, 2024', distance: 20 },
        { date: 'Jun 1, 2024', distance: 40 },
      ],
    }));
  });

  it('keeps every monthly field reachable on mobile within the named shared table scroll', () => {
    renderPage();

    const table = screen.getByRole('table', { name: 'Monthly summary' });
    const ratioHeader = within(table).getByRole('columnheader', { name: /Distance \/ drive \(km\)/ });
    const may = within(table).getByText('2024-05').closest('tr');
    expect(ratioHeader).not.toHaveClass('hidden');
    if (!(may instanceof HTMLElement)) throw new Error('Missing monthly row');
    const cells = within(may).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual(['2024-05', '400.00', '20', '20.00']);
    expect(cells[3]).not.toHaveClass('hidden');
    expect(table.closest('[data-grid-viewport]')).toHaveClass('max-w-full', 'overscroll-x-contain', 'overflow-auto');
  });

  it('uses solid same-quantity window bars while retaining the saved palette and measured values', () => {
    mockPalette.mockReturnValue(['var(--semantic-info)', 'var(--semantic-success)', 'var(--semantic-warning)']);
    renderPage();

    const windows = windowsRegion();
    for (const [label, value] of [['Last 7 days', 210], ['Last 30 days', 930], ['Last 365 days', 9500]] as const) {
      const bar = within(windows).getByRole('progressbar', { name: label });
      expect(bar).toHaveAttribute('aria-valuenow', String(value));
      const fill = bar.querySelector<HTMLElement>('[data-metric-fill]');
      expect(fill).not.toBeNull();
      expect(fill?.style.background).toBe('var(--semantic-info)');
    }
    expect(mockPalette).toHaveBeenCalled();
  });

  it('keeps missing and nonfinite windows unknown without replacing a real zero or neighboring chart', () => {
    mockStats.mockReturnValue(makeQuery({
      data: { ...STATS, last_7d_km: undefined, last_30d_km: Number.NaN, last_365d_km: 0 },
    }));
    renderPage();

    const windows = windowsRegion();
    for (const label of ['Last 7 days', 'Last 30 days']) {
      const bar = within(windows).getByRole('progressbar', { name: label });
      expect(bar).not.toHaveAttribute('aria-valuenow');
      expect(bar).toHaveAttribute('aria-valuetext', 'No reading');
      expect(siblingText(windows, label)).toBe('—');
    }
    expect(within(windows).getByRole('progressbar', { name: 'Last 365 days' })).toHaveAttribute('aria-valuenow', '0');
    expect(siblingText(windows, 'Last 365 days')).toBe('0.00 km');
    expect(within(dailyRegion()).getByRole('img', { name: 'Daily distance traveled over time' })).toBeInTheDocument();
  });

  it('retains missing monthly measurements and daily gaps without manufacturing zero distances', () => {
    mockDaily.mockReturnValue(makeQuery({
      data: [{ date: '2024-06-01', drive_count: 1, total_km: Number.NaN, end_odometer_km: 0 }],
    }));
    mockMonthly.mockReturnValue(makeQuery({
      data: [
        { ...MONTHLY[0], total_km: Number.NaN },
        { ...MONTHLY[1], drive_count: undefined },
        { ...MONTHLY[1], year_month: '2024-07', total_km: 0, drive_count: 0 },
      ],
    }));
    renderPage();

    expect(chartEvidence).toHaveBeenCalledWith(expect.objectContaining({
      chartKey: 'mileage-daily-distance',
      data: [{ date: 'Jun 1, 2024', distance: null }],
    }));
    expect(chartEvidence).toHaveBeenCalledWith(expect.objectContaining({
      chartKey: 'mileage-odometer-over-time',
      data: [{ date: 'Jun 1, 2024', odometer: 0 }],
    }));
    const table = screen.getByRole('table', { name: 'Monthly summary' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
      ['2024-05', '—', '20', '—'],
      ['2024-06', '930.00', '—', '—'],
      ['2024-07', '0.00', '0', '0.00'],
    ]);
  });

  it('keeps all six cards, readings and series through retained errors and paused refreshes with independent retry', () => {
    const stats = makeQuery({ data: STATS, error: new ApiError('refresh failed', 500), isError: true });
    mockStats.mockReturnValue(stats);
    mockDaily.mockReturnValue(makeQuery({ data: DAILY, fetchStatus: 'paused' }));
    mockMonthly.mockReturnValue(makeQuery({ data: MONTHLY, isFetching: true }));
    renderPage();

    expect(screen.getAllByText('Refresh failed. Showing the last successful mileage data.')).toHaveLength(2);
    expect(screen.getAllByText('Refresh is paused. Showing the last successful mileage data.')).toHaveLength(2);
    expect(screen.getAllByText('Refreshing mileage data. Previously loaded content remains available.')).toHaveLength(2);
    expect(cardValue(kpiRegion(), 'Total distance')).toBe('12,000 km');
    for (const title of ['Mileage summary metrics', 'Odometer over time', 'Distance by window', 'Daily distance', 'Monthly distance', 'Monthly summary']) {
      expect(panel(title)).toHaveAccessibleName(title);
    }
    expect(screen.getAllByTestId('embedded-chart')).toHaveLength(3);
    fireEvent.click(within(kpiRegion()).getByRole('button', { name: 'Retry' }));
    expect(stats.refetch).toHaveBeenCalledTimes(1);
  });
});
