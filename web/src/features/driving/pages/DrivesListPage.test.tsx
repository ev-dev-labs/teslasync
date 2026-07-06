/**
 * DrivesListPage — behaviour + hardening coverage.
 *
 * The page exposes a single default export (the drive-history page). This suite
 * drives it through every meaningful branch by mocking its data hooks
 * (`useDrives` / `useBulkDeleteDrives`), the selected vehicle, and the unit
 * preference. The SI → display converters (`@/lib/unitConversion`), number
 * formatters (`@/lib/numberFormat`), date helpers (`@/lib/dateFormat`), and the
 * pure aggregation library (`@/lib/drivesAggregation`) are the REAL
 * implementations, so all render-boundary maths + collection detection is
 * genuinely exercised. `useTimezone` is stubbed to UTC by the global test setup
 * so day-bucketing is deterministic. Network is never touched.
 *
 * Facets covered:
 *   - no-vehicle guard renders <NoVehicleSelected> instead of data scaffolding.
 *   - loading: the overview + list + trend show skeletons and NEVER flash the
 *     "no drives" empty state (regression guard for the loading branch).
 *   - primary-resource error surfaces the message + withholds the drive list.
 *   - populated (km): honest KPI tiles, the no-prior-period comparison label,
 *     the period-highlights read-outs, grouped drive rows, and hook wiring.
 *   - unit boundary (mi): re-labels headers + runs the real SI converter.
 *   - collections: pill counts (all/anomalies/notable/commutes) + filtering.
 *   - anomaly callout links into the anomalies collection.
 *   - search: free-text, `score:` and `distance:>` structured tokens each
 *     narrow the list to the right drive.
 *   - sort controls toggle aria-pressed + persist to the URL.
 *   - bulk delete: select → confirm → mutateAsync called with numeric ids.
 *   - pagination clamp: an out-of-range `?page=N` still shows results.
 *   - export links carry snake_case `vehicle_id` + the active range.
 *   - empty state offers a reset-filters CTA.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Drive } from '@/types/driving';
import type { Vehicle } from '@/types/vehicle';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';
import { fmtCompact, fmtInt, fmtNumber } from '@/lib/numberFormat';
import { formatDurationMinutes } from '@/lib/dateFormat';
import { ToastProvider } from '@/components/feedback/Toast';

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

// ── MetricSwitcherChart: deterministic double. The real chart renders raw
//    recharts (needs a sized container jsdom can't provide). The double surfaces
//    the active metric + empty message and exposes one switch button per metric
//    so the trend-switch → URL wiring stays assertable. ────────────────────────
vi.mock('@/components/charts', () => ({
  MetricSwitcherChart: ({
    title,
    ariaLabel,
    series,
    metrics,
    activeMetric,
    onMetricChange,
    emptyMessage,
    testId,
  }: {
    title: string;
    ariaLabel: string;
    series: Record<string, Array<{ date: string; value: number }>>;
    metrics: ReadonlyArray<{ key: string; label: string }>;
    activeMetric: string;
    onMetricChange: (key: string) => void;
    emptyMessage: string;
    testId?: string;
  }) => {
    const active = metrics.find((m) => m.key === activeMetric) ?? metrics[0];
    const data = active ? (series[active.key] ?? []) : [];
    return (
      <div data-testid={testId} role="img" aria-label={ariaLabel}>
        <div>{title}</div>
        <div data-testid="active-trend-metric">{active?.key}</div>
        {data.length === 0 ? <div>{emptyMessage}</div> : <div data-testid="trend-point-count">{data.length}</div>}
        {metrics.map((m) => (
          <button key={m.key} type="button" onClick={() => onMetricChange(m.key)}>
            {`Show ${m.label}`}
          </button>
        ))}
      </div>
    );
  },
}));

// ── Peripheral header / mobile / AI components pull their own data or touch
//    device APIs (matchMedia, EventSource, saved-view network). Stub them so the
//    suite stays deterministic and focused on the page's own orchestration. ────
vi.mock('@/components/mobile', () => ({
  PullToRefresh: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ai/AINLDriveSearch', () => ({ AINLDriveSearch: () => null }));
vi.mock('@/components/data-display/SavedViewMenu', () => ({ SavedViewMenu: () => null }));
vi.mock('@/components/layout/PageHeaderSticky', () => ({ PageHeaderSticky: () => null }));

// ── Data + environment hooks, driven per test. ──
vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: vi.fn(),
  useBulkDeleteDrives: vi.fn(),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));

import { useDrives, useBulkDeleteDrives } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import DrivesListPage from './DrivesListPage';

const mockDrives = useDrives as unknown as ReturnType<typeof vi.fn>;
const mockBulkDelete = useBulkDeleteDrives as unknown as ReturnType<typeof vi.fn>;
const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;

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

let mutateAsyncSpy: ReturnType<typeof vi.fn>;

function makeDrive(over: Partial<Drive> & Pick<Drive, 'id' | 'startTs' | 'distanceM'>): Drive {
  return {
    vehicleId: 7,
    endTs: null,
    durationS: 3600,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: null,
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: 'completed',
    createdAt: over.startTs,
    updatedAt: over.startTs,
    ...over,
  };
}

/**
 * Fixture: 4 April-2026 drives. Home↔Office is a 3× commute (d1/d2/d3, each a
 * grade-B 40 km trip); d4 is a 100 km grade-D anomaly (also the longest, so it
 * is the sole "notable"). Raw aggregates are asserted against below.
 */
const DRIVES: Drive[] = [
  makeDrive({
    id: 1, startTs: '2026-04-24T15:00:00Z', endTs: '2026-04-24T16:00:00Z',
    distanceM: 40000, durationS: 3600,
    startAddress: 'Home', endAddress: 'Office',
    startBatteryPct: 80, endBatteryPct: 70, maxSpeedMps: 30, avgSpeedMps: 20,
  }),
  makeDrive({
    id: 2, startTs: '2026-04-23T09:00:00Z', endTs: '2026-04-23T10:00:00Z',
    distanceM: 40000, durationS: 3600,
    startAddress: 'Office', endAddress: 'Home',
    startBatteryPct: 70, endBatteryPct: 60, maxSpeedMps: 25, avgSpeedMps: 18,
  }),
  makeDrive({
    id: 3, startTs: '2026-04-22T09:00:00Z', endTs: '2026-04-22T10:00:00Z',
    distanceM: 40000, durationS: 3600,
    startAddress: 'Home', endAddress: 'Office',
    startBatteryPct: 90, endBatteryPct: 80, maxSpeedMps: 28, avgSpeedMps: 19,
  }),
  makeDrive({
    id: 4, startTs: '2026-04-20T12:00:00Z', endTs: '2026-04-20T14:00:00Z',
    distanceM: 100000, durationS: 7200,
    startAddress: 'Home', endAddress: 'Beach',
    startBatteryPct: 90, endBatteryPct: 55, maxSpeedMps: 60, avgSpeedMps: 25,
  }),
];

// Known raw aggregates (what the page must independently derive from DRIVES).
const TOTAL_M = 40000 * 3 + 100000; // 220000
const TOTAL_S = 3600 * 3 + 7200; // 18000
const AVG_EFF_WH_KM = (187.5 * 3 + 262.5) / 4; // 206.25
const TOTAL_KWH = (10 + 10 + 10 + 35) * 0.75; // 48.75
const COST_PER_KWH = 0.12; // matches the global useSettings stub

const FLEET = [{ id: 7, display_name: 'Model 3', vin: 'VIN7' }] as unknown as Vehicle[];

function selected(vehicleId: number | null) {
  return {
    vehicleId,
    vehicle: vehicleId != null ? FLEET[0] : null,
    vehicles: FLEET,
    setVehicleId: vi.fn(),
  };
}

function makeUnits(distance: 'km' | 'mi') {
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

const DEFAULT_RANGE = '/drives?from=2026-04-01&to=2026-04-30';

function renderPage(initialEntries: string[] = [DEFAULT_RANGE]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <DrivesListPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const kpiRegion = () => screen.getByTestId('drives-overview-kpis');
const listRegion = () => screen.getByRole('region', { name: 'Drive list' });
const analysisRegion = () => screen.getByRole('region', { name: 'Trends and highlights' });
const collectionsBar = () => screen.getByRole('tablist', { name: 'Filter drives by collection' });

/** Value <p> that immediately follows a MetricCard's label span. */
function cardValue(region: HTMLElement, label: string): string {
  const span = within(region).getByText(label);
  return span.closest('p')?.nextElementSibling?.textContent ?? '';
}

beforeEach(() => {
  mockDrives.mockReset();
  mockBulkDelete.mockReset();
  mockSelected.mockReset();
  mockUnits.mockReset();

  mutateAsyncSpy = vi.fn().mockResolvedValue({ deleted: 1 });
  mockBulkDelete.mockReturnValue({ mutateAsync: mutateAsyncSpy, mutate: vi.fn(), isPending: false });
  mockSelected.mockReturnValue(selected(7));
  mockUnits.mockReturnValue(makeUnits('km'));
  mockDrives.mockReturnValue(makeQuery({ data: DRIVES }));
});

describe('DrivesListPage — no vehicle selected', () => {
  it('renders the NoVehicleSelected guard and no data scaffolding', () => {
    mockSelected.mockReturnValue(selected(null));
    renderPage();

    expect(screen.getByText('No vehicle selected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up TeslaSync' })).toBeInTheDocument();
    // None of the drive scaffolding mounts when there is no vehicle.
    expect(screen.queryByRole('heading', { name: 'Overview', level: 3 })).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Filter drives by collection' })).toBeNull();
  });
});

describe('DrivesListPage — loading', () => {
  it('shows skeletons and never flashes the "no drives" empty state', () => {
    mockDrives.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    renderPage();

    // Sibling panels keep their titles + show skeletons.
    expect(screen.getByText('Drives over time')).toBeInTheDocument();
    expect(screen.getByText('Highlights')).toBeInTheDocument();
    // The overview must NOT render the populated card nor the empty message
    // while the query is still in flight (regression guard).
    expect(screen.queryByRole('heading', { name: 'Overview', level: 3 })).toBeNull();
    expect(screen.queryByText('No drives in this range')).toBeNull();
    // No drive rows have rendered yet.
    expect(screen.queryByText('Beach')).toBeNull();
  });
});

describe('DrivesListPage — primary error', () => {
  it('surfaces the error message and withholds the drive list', () => {
    mockDrives.mockReturnValue(makeQuery({ data: undefined, error: new Error('Drives request failed'), isError: true }));
    renderPage();

    expect(screen.getByText('Drives request failed')).toBeInTheDocument();
    // PageContainer replaces its children with the error box.
    expect(screen.queryByRole('region', { name: 'Drive list' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Overview', level: 3 })).toBeNull();
  });
});

describe('DrivesListPage — populated (km)', () => {
  it('derives honest KPI tiles from the drive list', () => {
    renderPage();
    const kpi = kpiRegion();

    expect(cardValue(kpi, 'Drives')).toBe(fmtCompact(4));
    expect(cardValue(kpi, 'Distance (km)')).toBe(fmtCompact(convertDistanceFromSI(TOTAL_M, 'km'), 10000));
    expect(cardValue(kpi, 'Drive time')).toBe(formatDurationMinutes(TOTAL_S / 60));
    expect(cardValue(kpi, 'Avg score')).toBe('B');
    expect(cardValue(kpi, 'Efficiency (Wh/km)')).toBe(fmtInt(AVG_EFF_WH_KM));
    expect(cardValue(kpi, 'Cost')).toBe(`$${fmtNumber(TOTAL_KWH * COST_PER_KWH, 2)}`);
  });

  it('labels the period + the empty prior window, and fills the highlights', () => {
    renderPage();

    // ComparisonHeader current + comparison labels.
    expect(screen.getByRole('heading', { name: 'Overview', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('Apr 1, 2026 – Apr 30, 2026')).toBeInTheDocument();
    expect(
      screen.getByText('No drives in prior period: Mar 2, 2026 – Mar 31, 2026'),
    ).toBeInTheDocument();

    const analysis = analysisRegion();
    // Top speed 60 m/s → 216 km/h; longest 100 km; avg trip 55 km; avg dur 75 min.
    expect(within(analysis).getByText(`${fmtInt(convertSpeedFromSI(60, 'km/h'))} km/h`)).toBeInTheDocument();
    expect(within(analysis).getByText(`${fmtNumber(convertDistanceFromSI(100000, 'km'))} km`)).toBeInTheDocument();
    expect(within(analysis).getByText(`${fmtNumber(convertDistanceFromSI(55000, 'km'))} km`)).toBeInTheDocument();
    expect(within(analysis).getByText(formatDurationMinutes(75))).toBeInTheDocument();
  });

  it('renders grouped drive rows and wires the hook with the vehicle id', () => {
    renderPage();
    const list = listRegion();

    // Three 40 km commute badges + one 100 km anomaly badge.
    expect(within(list).getAllByText('40.00 km')).toHaveLength(3);
    expect(within(list).getByText('100.00 km')).toBeInTheDocument();
    // Route addresses render.
    expect(within(list).getByText(/Beach/)).toBeInTheDocument();
    expect(within(list).getAllByText(/Office/).length).toBeGreaterThanOrEqual(1);
    // Day-group headers (UTC bucketing via the global useTimezone stub).
    expect(screen.getByText('Apr 24, 2026')).toBeInTheDocument();
    expect(screen.getByText('Apr 20, 2026')).toBeInTheDocument();
    // Hook wiring: stringified vehicle id.
    expect(mockDrives).toHaveBeenCalledWith('7');
  });
});

describe('DrivesListPage — unit boundary (miles)', () => {
  it('re-labels headers and converts SI → miles at the render edge', () => {
    mockUnits.mockReturnValue(makeUnits('mi'));
    renderPage();
    const kpi = kpiRegion();

    expect(cardValue(kpi, 'Distance (mi)')).toBe(fmtCompact(convertDistanceFromSI(TOTAL_M, 'mi'), 10000));
    expect(within(kpi).getByText('Efficiency (Wh/mi)')).toBeInTheDocument();
    // Longest highlight now reads in miles, not kilometres.
    expect(
      within(analysisRegion()).getByText(`${fmtNumber(convertDistanceFromSI(100000, 'mi'))} mi`),
    ).toBeInTheDocument();
  });
});

describe('DrivesListPage — collections', () => {
  it('counts each collection and filters the list when one is chosen', async () => {
    renderPage();
    const bar = collectionsBar();

    expect(within(bar).getByRole('tab', { name: /All/ })).toHaveTextContent('(4)');
    expect(within(bar).getByRole('tab', { name: /Anomalies/ })).toHaveTextContent('(1)');
    expect(within(bar).getByRole('tab', { name: /Commutes/ })).toHaveTextContent('(3)');
    // Tagged is not implemented yet → disabled.
    expect(within(bar).getByRole('tab', { name: /Tagged/ })).toBeDisabled();

    fireEvent.click(within(bar).getByRole('tab', { name: /Commutes/ }));

    await waitFor(() => {
      expect(within(listRegion()).queryByText(/Beach/)).toBeNull();
    });
    // Only the three commute drives remain.
    expect(within(listRegion()).getAllByText('40.00 km')).toHaveLength(3);
  });
});

describe('DrivesListPage — anomaly callout', () => {
  it('links from the highlights callout into the anomalies collection', async () => {
    renderPage();

    const callout = within(analysisRegion()).getByRole('button', { name: /anomaly in this range/ });
    expect(callout).toBeInTheDocument();

    fireEvent.click(callout);

    // The anomalies collection shows only the grade-D 100 km drive.
    await waitFor(() => {
      expect(within(listRegion()).getByText('100.00 km')).toBeInTheDocument();
    });
    expect(within(listRegion()).queryByText('40.00 km')).toBeNull();
    // Callout self-hides once the anomalies view is active.
    expect(within(analysisRegion()).queryByRole('button', { name: /anomaly in this range/ })).toBeNull();
  });
});

describe('DrivesListPage — search', () => {
  it('filters by free-text address to a single drive', () => {
    renderPage([`${DEFAULT_RANGE}&q=beach`]);
    const list = listRegion();

    expect(within(list).getByText(/Beach/)).toBeInTheDocument();
    expect(within(list).getByText('100.00 km')).toBeInTheDocument();
    expect(within(list).queryByText('40.00 km')).toBeNull();
  });

  it('honours structured score: and distance: tokens', () => {
    // score:d → only the grade-D anomaly.
    renderPage([`${DEFAULT_RANGE}&q=${encodeURIComponent('score:d')}`]);
    expect(within(listRegion()).getByText('100.00 km')).toBeInTheDocument();
    expect(within(listRegion()).queryByText('40.00 km')).toBeNull();
  });

  it('filters with a numeric distance comparison token', () => {
    // distance:>50 (km) → only the 100 km drive clears the threshold.
    renderPage([`${DEFAULT_RANGE}&q=${encodeURIComponent('distance:>50')}`]);
    expect(within(listRegion()).getByText('100.00 km')).toBeInTheDocument();
    expect(within(listRegion()).queryByText('40.00 km')).toBeNull();
  });
});

describe('DrivesListPage — sort controls', () => {
  it('toggles aria-pressed and moves the active sort off the default', () => {
    renderPage();

    const recent = screen.getByRole('button', { name: 'Sort by Recent' });
    const distance = screen.getByRole('button', { name: 'Sort by Distance' });
    expect(recent).toHaveAttribute('aria-pressed', 'true');
    expect(distance).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(distance);

    expect(screen.getByRole('button', { name: 'Sort by Distance' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sort by Recent' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('DrivesListPage — trend switcher', () => {
  it('switches the active trend metric through the chart control', async () => {
    renderPage();

    expect(screen.getByTestId('active-trend-metric')).toHaveTextContent('drives');
    fireEvent.click(screen.getByRole('button', { name: 'Show Distance' }));

    await waitFor(() => {
      expect(screen.getByTestId('active-trend-metric')).toHaveTextContent('distance');
    });
  });
});

describe('DrivesListPage — bulk delete', () => {
  it('selects a drive, confirms, and calls the mutation with numeric ids', async () => {
    renderPage();

    const checkboxes = within(listRegion()).getAllByRole('checkbox');
    // Rows render newest-first; the last checkbox belongs to the 100 km drive (id 4).
    fireEvent.click(checkboxes[checkboxes.length - 1]);

    // The bulk toolbar appears with the selection count.
    expect(await screen.findByText('1 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // Confirm dialog → confirm.
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mutateAsyncSpy).toHaveBeenCalledWith([4]));
  });
});

describe('DrivesListPage — pagination clamp', () => {
  it('still renders results when the URL page is out of range', () => {
    // Only one page of results exists; a stale ?page=3 must not strand the user
    // on an empty slice (regression guard for the clamp fix).
    renderPage([`${DEFAULT_RANGE}&page=3`]);

    expect(within(listRegion()).getByText('100.00 km')).toBeInTheDocument();
    expect(within(listRegion()).getAllByText('40.00 km')).toHaveLength(3);
    expect(screen.queryByText('No drives recorded yet')).toBeNull();
  });
});

describe('DrivesListPage — export links', () => {
  it('builds CSV/JSON export URLs with snake_case params and the active range', () => {
    renderPage();

    const csv = screen.getByRole('link', { name: 'CSV' });
    const json = screen.getByRole('link', { name: 'JSON' });

    const csvHref = csv.getAttribute('href') ?? '';
    expect(csvHref).toContain('/export/drives?format=csv');
    expect(csvHref).toContain('vehicle_id=7');
    expect(csvHref).toContain('start=2026-04-01');
    expect(csvHref).toContain('end=2026-04-30');
    expect(json.getAttribute('href') ?? '').toContain('format=json');
  });
});

describe('DrivesListPage — empty state', () => {
  it('shows the reset-filters CTA when there are no drives', () => {
    mockDrives.mockReturnValue(makeQuery({ data: [] }));
    renderPage();

    expect(screen.getByText('No drives recorded yet')).toBeInTheDocument();
    const reset = screen.getByRole('button', { name: 'Reset filters' });
    expect(reset).toBeInTheDocument();
    // Clicking the CTA must not throw (clears the URL filter state).
    fireEvent.click(reset);
    expect(screen.getByText('No drives recorded yet')).toBeInTheDocument();
  });
});
