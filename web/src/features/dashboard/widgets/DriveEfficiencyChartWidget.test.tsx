/**
 * DriveEfficiencyChartWidget — behaviour + hardening coverage.
 *
 * The widget charts a vehicle's daily driving efficiency (Wh/km, converted to
 * the user's distance unit at the render boundary) over the last 30 days,
 * with a 7-day rolling average and an Avg / Best-day / Trend summary. It
 * exposes a default component plus two pure helpers (`estimateEfficiency`,
 * `buildDailyEfficiency`).
 *
 * Everything the widget touches is mocked so the network is never hit:
 *   - `useQuery` (the inline drives query) is driven per test.
 *   - `useVehicles` supplies the vehicle-id fallback.
 *   - `useUnits` supplies the distance preference that flips km↔mi at the
 *     display boundary.
 *   - `useThemeChartPalette` is stubbed (it otherwise needs a ThemeProvider),
 *     while the real recharts primitives are kept.
 *   - `request` is stubbed so the captured `queryFn` can be exercised without
 *     a real fetch.
 *
 * Facets covered:
 *   - estimateEfficiency: energy path, tiny-drive skip, out-of-range guards,
 *     missing/zero-energy exclusion, and independence from SOC readings.
 *   - buildDailyEfficiency: distance-weighted daily intensity + trailing rolling average,
 *     skipping timestamp-less / estimator-rejected drives, 1-decimal rounding,
 *     and the empty-input / all-rejected → [] contract.
 *   - rendering: populated km render (stats + unit + legend + title), the
 *     km→mi conversion of the unit label AND the numbers, the "no data" empty
 *     state (role="status") with stats withheld, the >30-day filter collapsing
 *     to empty, the loading skeleton, and the error branch (role="alert").
 *   - interaction/a11y: the freshness control is an accessible refresh-state
 *     button that refetches; the compact 1×1 layout drops the title + chart
 *     but keeps the stats.
 *   - data plumbing: explicit vehicleId, first-vehicle fallback, the disabled
 *     (id 0) query, and the prefix-free, snake_case drives URL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Drive } from '@/api/types';

// ── i18n stub: return the English fallback (2nd arg) or the key. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: string) => (typeof def === 'string' ? def : _key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── react-query: keep everything real except the inline drives query. ──
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: vi.fn() };
});

// ── charts: keep the real recharts primitives, stub only the theme palette
// hook (it reaches for useTheme() which requires a ThemeProvider). ──
vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual,
    ...chartTestDoubles,
    useThemeChartPalette: () => ({
      primary: '#22d3ee',
      accent: '#f59e0b',
      series: ['#22d3ee', '#38bdf8', '#818cf8', '#a78bfa', '#f472b6', '#fb7185', '#f59e0b', '#34d399'],
      positive: '#34d399',
      negative: '#f87171',
      warning: '#f59e0b',
      neutral: '#94a3b8',
    }),
  };
});

// ── api client: keep isApiError real (QueryError consumes it), stub request. ──
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn().mockResolvedValue([]) };
});

// ── data hooks + the display-boundary unit bridge, driven per test. ──
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));
vi.mock('@/hooks/useDateFormat', () => {
  // Deterministic, timezone-independent formatters mirroring the real "—"
  // fallback. The widget only reads formatDateShort (chart-axis labels); the
  // rest exist because WidgetShell's <DataFreshness> calls formatTime.
  const short = (v: unknown) => (v == null || v === '' ? '—' : String(v).slice(0, 10));
  const asString = (v: unknown) => (v == null || v === '' ? '—' : String(v));
  return {
    useDateFormat: () => ({
      opts: { locale: 'en-US', tz: 'UTC' },
      tz: 'UTC',
      locale: 'en-US',
      formatDate: short,
      formatDateTime: asString,
      formatTime: asString,
      formatDateShort: short,
      formatDateWithDay: short,
      formatRelative: asString,
      formatRelativeTime: asString,
      formatRelativeDays: short,
    }),
  };
});

import { useQuery } from '@tanstack/react-query';
import { request } from '@/api/client';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import DriveEfficiencyChartWidget, {
  estimateEfficiency,
  buildDailyEfficiency,
} from './DriveEfficiencyChartWidget';

const mockUseQuery = useQuery as unknown as ReturnType<typeof vi.fn>;
const mockRequest = request as unknown as ReturnType<typeof vi.fn>;
const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;

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

function makeDrive(over: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicle_id: 42,
    start_ts: '2026-06-01T08:00:00Z',
    end_ts: '2026-06-01T09:00:00Z',
    duration_s: 3600,
    distance_m: 10_000,
    start_address: null,
    end_address: null,
    start_lat: null,
    start_lon: null,
    end_lat: null,
    end_lon: null,
    start_soc_pct: 80,
    end_soc_pct: 70,
    energy_used_wh: 1500,
    regen_energy_wh: null,
    avg_speed_mps: null,
    max_speed_mps: null,
    avg_power_w: null,
    outside_temp_avg_c: null,
    inside_temp_avg_c: null,
    score: null,
    ended_status: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...over,
  };
}

/** ISO timestamp `n` whole days before now — keeps fixtures inside the 30-day window. */
function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

/**
 * Four recent single-drive days at 10 km each with a known energy draw, so the
 * daily efficiencies are exactly 100 / 120 / 140 / 160 Wh/km (oldest→newest):
 *   overall avg = 130, best (min) = 100,
 *   trend = ((150-110)/110) = +36.4%.
 */
function recentDrives(): Drive[] {
  return [
    makeDrive({ id: 1, start_ts: daysAgoIso(5), distance_m: 10_000, energy_used_wh: 1000 }),
    makeDrive({ id: 2, start_ts: daysAgoIso(4), distance_m: 10_000, energy_used_wh: 1200 }),
    makeDrive({ id: 3, start_ts: daysAgoIso(3), distance_m: 10_000, energy_used_wh: 1400 }),
    makeDrive({ id: 4, start_ts: daysAgoIso(2), distance_m: 10_000, energy_used_wh: 1600 }),
  ];
}

const STANDARD = { cols: 2, rows: 4 };
const COMPACT = { cols: 1, rows: 1 };

function setup(
  opts: { drives?: any; vehicles?: any; distancePref?: 'km' | 'mi' } = {},
) {
  mockVehicles.mockReturnValue(opts.vehicles ?? makeQuery({ data: [{ id: 42 }] }));
  mockUseQuery.mockReturnValue(opts.drives ?? makeQuery({ data: [] }));
  mockUnits.mockReturnValue({ unitPrefs: { distance: opts.distancePref ?? 'km' } });
}

function renderWidget(props: { size: { cols: number; rows: number }; vehicleId?: number }) {
  return render(
    <MemoryRouter>
      <DriveEfficiencyChartWidget {...props} />
    </MemoryRouter>,
  );
}

/** Options passed to the mocked drives `useQuery` on the most recent render. */
function lastDrivesQuery(): {
  queryKey: unknown[];
  enabled: boolean;
  staleTime: number;
  queryFn: () => Promise<unknown>;
} {
  const calls = mockUseQuery.mock.calls;
  const last = calls[calls.length - 1];
  if (!last) throw new Error('useQuery was never called');
  return last[0];
}

const shortDate = (iso: string) => iso.slice(0, 10);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('estimateEfficiency', () => {
  it('computes Wh/km from energy + distance for a normal drive', () => {
    expect(estimateEfficiency(makeDrive({ distance_m: 10_000, energy_used_wh: 1500 }))).toBe(150);
    // Scale-invariant: same ratio at a different distance.
    expect(estimateEfficiency(makeDrive({ distance_m: 20_000, energy_used_wh: 3000 }))).toBe(150);
  });

  it('skips drives shorter than 0.8 km', () => {
    expect(estimateEfficiency(makeDrive({ distance_m: 500, energy_used_wh: 100 }))).toBeNull();
  });

  it('rejects implausibly low or high efficiencies from the energy path', () => {
    expect(estimateEfficiency(makeDrive({ distance_m: 10_000, energy_used_wh: 200 }))).toBeNull(); // 20 < 30
    expect(estimateEfficiency(makeDrive({ distance_m: 10_000, energy_used_wh: 6000 }))).toBeNull(); // 600 > 500
  });

  it('returns null when measured energy is missing', () => {
    expect(
      estimateEfficiency(
        makeDrive({ distance_m: 30_000, energy_used_wh: null, start_soc_pct: 80, end_soc_pct: 70 }),
      ),
    ).toBeNull();
  });

  it('returns null when measured energy is zero', () => {
    expect(
      estimateEfficiency(
        makeDrive({ distance_m: 30_000, energy_used_wh: 0, start_soc_pct: 80, end_soc_pct: 70 }),
      ),
    ).toBeNull();
  });

  it('does not derive energy intensity from SOC readings', () => {
    expect(
      estimateEfficiency(
        makeDrive({ distance_m: 30_000, energy_used_wh: null, start_soc_pct: 70, end_soc_pct: 80 }),
      ),
    ).toBeNull();
    expect(
      estimateEfficiency(makeDrive({ distance_m: 30_000, energy_used_wh: null, end_soc_pct: null })),
    ).toBeNull();
  });

  it('uses measured energy even when SOC movement disagrees', () => {
    expect(
      estimateEfficiency(
        makeDrive({ distance_m: 10_000, energy_used_wh: 1500, start_soc_pct: 90, end_soc_pct: 20 }),
      ),
    ).toBe(150);
  });
});

describe('buildDailyEfficiency', () => {
  it('computes daily measured intensity and a trailing rolling average', () => {
    const drives = [
      makeDrive({ id: 1, start_ts: '2026-06-01T08:00:00Z', distance_m: 10_000, energy_used_wh: 1500 }), // 150
      makeDrive({ id: 2, start_ts: '2026-06-01T18:00:00Z', distance_m: 10_000, energy_used_wh: 1700 }), // 170
      makeDrive({ id: 3, start_ts: '2026-06-02T08:00:00Z', distance_m: 10_000, energy_used_wh: 1800 }), // 180
    ];
    const out = buildDailyEfficiency(drives, 7, shortDate);

    expect(out).toHaveLength(2);
    // Day 1 = mean(150,170) = 160, no rolling avg yet (single point).
    expect(out[0]).toEqual({ date: '2026-06-01', label: '2026-06-01', efficiency: 160, rollingAvg: null });
    // Day 2 = 180, rolling = mean(160,180) = 170.
    expect(out[1]).toEqual({ date: '2026-06-02', label: '2026-06-02', efficiency: 180, rollingAvg: 170 });
  });

  it('weights a daily intensity by distance rather than drive count', () => {
    const drives = [
      makeDrive({
        id: 1,
        start_ts: '2026-06-01T08:00:00Z',
        distance_m: 10_000,
        energy_used_wh: 1_000,
      }),
      makeDrive({
        id: 2,
        start_ts: '2026-06-01T18:00:00Z',
        distance_m: 30_000,
        energy_used_wh: 6_000,
      }),
    ];

    expect(buildDailyEfficiency(drives, 7, shortDate)[0].efficiency).toBe(175);
  });

  it('skips drives with no timestamp and drives the estimator rejects', () => {
    const drives = [
      makeDrive({ id: 1, start_ts: '2026-06-03T08:00:00Z', distance_m: 10_000, energy_used_wh: 1000 }), // 100
      makeDrive({ id: 2, start_ts: '', distance_m: 10_000, energy_used_wh: 1000 }), // no timestamp
      makeDrive({ id: 3, start_ts: '2026-06-04T08:00:00Z', distance_m: 500, energy_used_wh: 100 }), // tiny → null
    ];
    const out = buildDailyEfficiency(drives, 7, shortDate);

    expect(out).toHaveLength(1);
    expect(out[0].date).toBe('2026-06-03');
    expect(out[0].efficiency).toBe(100);
  });

  it('rounds the daily average to one decimal place', () => {
    const drives = [
      makeDrive({ id: 1, start_ts: '2026-06-05T01:00:00Z', distance_m: 10_000, energy_used_wh: 1000 }), // 100
      makeDrive({ id: 2, start_ts: '2026-06-05T02:00:00Z', distance_m: 10_000, energy_used_wh: 1010 }), // 101
      makeDrive({ id: 3, start_ts: '2026-06-05T03:00:00Z', distance_m: 10_000, energy_used_wh: 1010 }), // 101
    ];
    const out = buildDailyEfficiency(drives, 7, shortDate);

    // mean(100,101,101) = 100.6667 → 100.7
    expect(out[0].efficiency).toBe(100.7);
  });

  it('returns an empty array when there are no usable drives', () => {
    expect(buildDailyEfficiency([], 7, shortDate)).toEqual([]);
    // A single sub-0.8km drive is rejected by the estimator → still empty.
    expect(
      buildDailyEfficiency(
        [makeDrive({ start_ts: '2026-06-01T00:00:00Z', distance_m: 100, energy_used_wh: 50 })],
        7,
        shortDate,
      ),
    ).toEqual([]);
  });
});

describe('DriveEfficiencyChartWidget — rendering', () => {
  it('renders the title, Avg/Best/Trend stats, unit, and the two-series legend', () => {
    setup({ drives: makeQuery({ data: recentDrives() }) });
    renderWidget({ size: STANDARD });

    expect(screen.getByText('Drive Efficiency')).toBeInTheDocument();
    expect(screen.getByText('Avg')).toBeInTheDocument();
    expect(screen.getByText('130')).toBeInTheDocument();
    expect(screen.getByText('Best day')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('Trend')).toBeInTheDocument();
    expect(screen.getByText('+36.4%')).toBeInTheDocument();
    // The Wh/km unit label rides along the Avg and Best stats.
    expect(screen.getAllByText('Wh/km')).toHaveLength(2);
    // Multi-series charts identify their shared persisted legend state.
    expect(screen.getByTestId('embedded-chart')).toHaveAttribute(
      'data-chart-key',
      'dashboard-drive-efficiency',
    );
  });

  it('converts both the unit label and the numbers to the mi preference', () => {
    setup({ drives: makeQuery({ data: recentDrives() }), distancePref: 'mi' });
    renderWidget({ size: STANDARD });

    // Label follows the preference, never the SI source.
    expect(screen.getAllByText('Wh/mi')).toHaveLength(2);
    expect(screen.queryByText('Wh/km')).not.toBeInTheDocument();
    // Best day: 100 Wh/km × 1.609344 → 160.9 → "161".
    expect(screen.getByText('161')).toBeInTheDocument();
    expect(screen.queryByText('100')).not.toBeInTheDocument();
  });

  it('shows the empty state (role="status") and withholds the stats when there is no data', () => {
    setup({ drives: makeQuery({ data: [] }) });
    renderWidget({ size: STANDARD });

    expect(screen.getByText('No efficiency data yet')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Standard widgets keep their header even when empty…
    expect(screen.getByText('Drive Efficiency')).toBeInTheDocument();
    // …but the summary stats are gated behind having data.
    expect(screen.queryByText('Avg')).not.toBeInTheDocument();
  });

  it('collapses to empty when every drive is older than the 30-day window', () => {
    setup({
      drives: makeQuery({
        data: [makeDrive({ start_ts: daysAgoIso(40), distance_m: 10_000, energy_used_wh: 1500 })],
      }),
    });
    renderWidget({ size: STANDARD });

    expect(screen.getByText('No efficiency data yet')).toBeInTheDocument();
    expect(screen.queryByText('Avg')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton and withholds header + content while loading', () => {
    setup({ drives: makeQuery({ isLoading: true, data: undefined }) });
    const { container } = renderWidget({ size: STANDARD });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Drive Efficiency')).not.toBeInTheDocument();
    expect(screen.queryByText('No efficiency data yet')).not.toBeInTheDocument();
  });

  it('renders the error branch (role="alert") instead of the chart on query failure', () => {
    setup({ drives: makeQuery({ data: undefined, error: new Error('boom'), isError: true }) });
    renderWidget({ size: STANDARD });

    // A non-ApiError falls through QueryError to the network/unknown branch.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Drive Efficiency')).not.toBeInTheDocument();
  });
});

describe('DriveEfficiencyChartWidget — interaction & layout', () => {
  it('refetches the drives query when the accessible Refresh control is clicked', () => {
    const refetch = vi.fn();
    setup({ drives: makeQuery({ data: recentDrives(), refetch }) });
    renderWidget({ size: STANDARD });

    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('drops the title and chart legend but keeps the stats in the compact 1×1 layout', () => {
    setup({ drives: makeQuery({ data: recentDrives() }) });
    renderWidget({ size: COMPACT });

    // Compact widgets are title-less and chart-less…
    expect(screen.queryByText('Drive Efficiency')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart-legend')).not.toBeInTheDocument();
    // …but the summary stats still render.
    expect(screen.getByText('Avg')).toBeInTheDocument();
    expect(screen.getByText('130')).toBeInTheDocument();
  });
});

describe('DriveEfficiencyChartWidget — data plumbing', () => {
  it('keys and enables the query on the explicit vehicleId prop', () => {
    setup({ drives: makeQuery({ data: [] }) });
    renderWidget({ size: STANDARD, vehicleId: 7 });

    const q = lastDrivesQuery();
    expect(q.queryKey).toEqual(['drives', 7, 'efficiency-chart-60']);
    expect(q.enabled).toBe(true);
    expect(q.staleTime).toBe(120_000);
  });

  it('falls back to the first vehicle id when no vehicleId prop is supplied', () => {
    setup({ vehicles: makeQuery({ data: [{ id: 3 }, { id: 9 }] }), drives: makeQuery({ data: [] }) });
    renderWidget({ size: STANDARD });

    const q = lastDrivesQuery();
    expect(q.queryKey).toEqual(['drives', 3, 'efficiency-chart-60']);
    expect(q.enabled).toBe(true);
  });

  it('keys the query on 0 and disables it when there is no vehicle to resolve', () => {
    setup({ vehicles: makeQuery({ data: [] }), drives: makeQuery({ data: [] }) });
    renderWidget({ size: STANDARD });

    const q = lastDrivesQuery();
    expect(q.queryKey).toEqual(['drives', 0, 'efficiency-chart-60']);
    expect(q.enabled).toBe(false);
  });

  it('builds a prefix-free, snake_case drives URL', async () => {
    setup({ drives: makeQuery({ data: [] }) });
    renderWidget({ size: STANDARD, vehicleId: 7 });

    // The request() client auto-prepends /api/v1, so the hook must not; and the
    // query param is snake_case to match the Go router.
    await lastDrivesQuery().queryFn();
    expect(mockRequest).toHaveBeenCalledWith('/drives?vehicle_id=7&limit=60');
  });
});
