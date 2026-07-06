/**
 * PowerFlowDashboardPage — behaviour + hardening coverage.
 *
 * The page exposes a single default export (its `FlowArrow` chip and the
 * `gridStatusVariant` badge mapper are internal and driven through the page).
 * This suite mocks the three Tesla-energy hooks, the range-state hook, and the
 * chart-annotation hooks so no network is ever touched, then drives the page
 * through every meaningful branch.
 *
 * Facets covered:
 *   - loading: the four page sections stay mounted while KPI values, the SOC
 *     gauge and the battery panel body are withheld behind skeletons.
 *   - populated happy path: live status badges (grid/storm/backup/updated),
 *     honest KPI tiles with signed readings + charge/import direction labels,
 *     the SOC gauge + energy KVList, the flow-diagram chips (magnitude display
 *     + arrow direction), the site-details rows, both history charts, and hook
 *     wiring (site id + range window fanned into the two data hooks).
 *   - direction branches: battery charging↔discharging and grid importing↔
 *     exporting flip both the KPI unit label AND the flow-arrow glyph.
 *   - hardening bug #1: the flow chip shows the *magnitude* (e.g. "1.5 kW"),
 *     never a nonsensical signed "-1.5 kW", because the arrow already encodes
 *     the sign.
 *   - hardening bug #2: a missing `grid_status` renders a *neutral* badge in
 *     both the status strip and the site-details panel — not a misleading red
 *     "danger" chip — while a real non-Active status still reads danger.
 *   - edge branches: zero readings drop the direction labels, and a zero
 *     grid-services reading hides that extra flow chip.
 *   - per-source error isolation: a live 5xx surfaces the status caption, drops
 *     every KPI to "—", and shows a retryable QueryError in all three live
 *     panels; a history 5xx swaps only the charts for a retryable QueryError.
 *   - no-data envelope (a response without an `id`): the status caption, the
 *     "—" KPIs, and a refresh-CTA EmptyState in each live panel.
 *   - interaction: the "Refresh from Tesla" action + the EmptyState CTA both
 *     fire the refresh mutation; picking a range preset commits via setRange.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/resilience';
import type { TeslaEnergyLiveStatus } from '@/types/energy';

// ── i18n stub: resolve the fallback (or the key when it IS the template) and
//    interpolate any {{var}} placeholders from the options bag. ──────────────
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
      return interpolate(second, third as Record<string, unknown> | undefined);
    }
    if (second && typeof second === 'object') {
      return interpolate(key, second as Record<string, unknown>);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── framer-motion: strip animation props, keep motion.div + useReducedMotion. ──
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
              k === 'whileInView' ||
              k === 'viewport' ||
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

// ── Data hooks + range state, driven per test. ──
vi.mock('@/api/hooks/useEnergy', () => ({
  useTeslaEnergyLiveStatus: vi.fn(),
  useTeslaEnergyLiveStatusHistory: vi.fn(),
  useRefreshTeslaEnergyLiveStatus: vi.fn(),
}));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: vi.fn() }));

// ChartContainer unconditionally reaches for the annotation hooks (network +
// ToastProvider). Neither is relevant here — stub them to inert no-ops.
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
}));

import {
  useTeslaEnergyLiveStatus,
  useTeslaEnergyLiveStatusHistory,
  useRefreshTeslaEnergyLiveStatus,
} from '@/api/hooks/useEnergy';
import { useRangeState } from '@/hooks/useRangeState';
import PowerFlowDashboardPage from './PowerFlowDashboardPage';

const mockLive = useTeslaEnergyLiveStatus as unknown as ReturnType<typeof vi.fn>;
const mockHistory = useTeslaEnergyLiveStatusHistory as unknown as ReturnType<typeof vi.fn>;
const mockRefresh = useRefreshTeslaEnergyLiveStatus as unknown as ReturnType<typeof vi.fn>;
const mockRange = useRangeState as unknown as ReturnType<typeof vi.fn>;

const SINCE = '2026-06-25';
const UNTIL = '2026-07-01';

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

const BASE_LIVE: TeslaEnergyLiveStatus = {
  id: 42,
  energy_site_id: 1,
  solar_power: 3200, // → "3.2 kW"
  battery_power: -1500, // negative → Charging; flow magnitude "1.5 kW", up arrow
  load_power: 900, // → "900 W"
  grid_power: 2000, // positive → Importing; flow magnitude "2.0 kW", down arrow
  grid_services_power: 500, // non-zero → grid-services chip shows "500 W"
  energy_left: 12500, // Wh → "12.50 kWh"
  total_pack_energy: 27000, // Wh → "27.00 kWh"
  percentage_charged: 46.3, // gauge → "46.3"
  grid_status: 'Active',
  backup_capable: true,
  storm_mode_active: true,
  timestamp: '2026-07-01T10:00:00Z',
  fetched_at: '2026-07-01T10:00:05Z',
};

function makeLive(over: Partial<TeslaEnergyLiveStatus> = {}): TeslaEnergyLiveStatus {
  return { ...BASE_LIVE, ...over };
}

const HISTORY: TeslaEnergyLiveStatus[] = [
  makeLive({ id: 1, timestamp: '2026-06-25T00:00:00Z', percentage_charged: 50 }),
  makeLive({ id: 2, timestamp: '2026-06-26T00:00:00Z', percentage_charged: 62 }),
];

let refreshMutate: ReturnType<typeof vi.fn>;
let setRange: ReturnType<typeof vi.fn>;

function setLive(over: Record<string, unknown>) {
  mockLive.mockReturnValue(makeQuery(over));
}
function setHistory(over: Record<string, unknown>) {
  mockHistory.mockReturnValue(makeQuery(over));
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PowerFlowDashboardPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const statusRegion = () => screen.getByRole('region', { name: 'System status' });
const kpiRegion = () => screen.getByRole('region', { name: 'Current power' });
const overviewRegion = () => screen.getByRole('region', { name: 'Live system overview' });
const historyRegion = () => screen.getByRole('region', { name: 'Power History' });

/** Locate the single flow-arrow chip that renders the given watts string. */
function flowChip(watts: string): HTMLElement {
  const el = within(overviewRegion()).getByText(watts);
  const chip = el.closest('div');
  if (!chip) throw new Error(`no flow chip for ${watts}`);
  return chip as HTMLElement;
}

beforeEach(() => {
  mockLive.mockReset();
  mockHistory.mockReset();
  mockRefresh.mockReset();
  mockRange.mockReset();

  refreshMutate = vi.fn();
  setRange = vi.fn();

  mockRefresh.mockReturnValue({ mutate: refreshMutate, isPending: false });
  mockRange.mockReturnValue({ start: SINCE, end: UNTIL, setRange });

  // Happy-path defaults; individual tests override.
  setLive({ data: makeLive() });
  setHistory({ data: HISTORY });
});

describe('PowerFlowDashboardPage — loading', () => {
  it('keeps all four sections but withholds KPI values, the gauge and badges', () => {
    setLive({ data: undefined, isLoading: true });
    setHistory({ data: undefined, isLoading: true });
    renderPage();

    // The page shell + every section landmark stays mounted.
    expect(screen.getByRole('heading', { level: 1, name: 'Power Flow' })).toBeInTheDocument();
    expect(statusRegion()).toBeInTheDocument();
    expect(overviewRegion()).toBeInTheDocument();

    // Status badges + KPI labels + gauge are all behind skeletons.
    expect(within(statusRegion()).queryByText('Backup Capable')).toBeNull();
    expect(within(kpiRegion()).queryByText('Solar Production')).toBeNull();
    expect(within(kpiRegion()).queryByText('3.2 kW')).toBeNull();
    expect(within(overviewRegion()).queryByText('State of Charge')).toBeNull();

    // Panel titles are structural and remain visible in every state.
    expect(within(overviewRegion()).getByText('Battery State')).toBeInTheDocument();
    expect(within(overviewRegion()).getByText('Site Details')).toBeInTheDocument();
  });
});

describe('PowerFlowDashboardPage — populated (charging / importing)', () => {
  it('renders live status badges with a success grid chip', () => {
    renderPage();
    const status = statusRegion();

    const grid = within(status).getByText('Grid: Active');
    expect(grid).toBeInTheDocument();
    // Active grid → success (green), never danger.
    expect(grid.className).toContain('bg-green-100');
    expect(grid.className).not.toContain('bg-red-100');

    expect(within(status).getByText('Storm Mode Active')).toBeInTheDocument();
    expect(within(status).getByText('Backup Capable')).toBeInTheDocument();
    expect(within(status).getByText(/^Updated:/)).toBeInTheDocument();
  });

  it('derives honest KPI tiles with signed readings and direction labels', () => {
    renderPage();
    const kpi = kpiRegion();

    expect(within(kpi).getByText('3.2 kW')).toBeInTheDocument(); // solar 3200 W
    expect(within(kpi).getByText('900 W')).toBeInTheDocument(); // home 900 W
    // Battery is negative → the KPI shows the signed reading + "Charging".
    expect(within(kpi).getByText('-1.5 kW')).toBeInTheDocument();
    expect(within(kpi).getByText('Charging')).toBeInTheDocument();
    // Grid positive → "Importing".
    expect(within(kpi).getByText('2.0 kW')).toBeInTheDocument();
    expect(within(kpi).getByText('Importing')).toBeInTheDocument();
  });

  it('renders the SOC gauge and the energy KVList (Wh → kWh)', () => {
    renderPage();
    const overview = overviewRegion();

    expect(within(overview).getByText('State of Charge')).toBeInTheDocument();
    expect(within(overview).getByText('46.3')).toBeInTheDocument(); // percentage_charged
    expect(within(overview).getByText('12.50 kWh')).toBeInTheDocument(); // energy_left 12500 Wh
    expect(within(overview).getByText('27.00 kWh')).toBeInTheDocument(); // total_pack_energy 27000 Wh
  });

  it('renders flow chips as magnitudes with direction-encoding arrows', () => {
    renderPage();

    // Bug-fix #1: charging battery shows "1.5 kW" (magnitude), NOT "-1.5 kW",
    // and the negative sign is encoded by an up arrow instead.
    expect(within(overviewRegion()).queryByText('-1.5 kW')).toBeNull();
    const battery = flowChip('1.5 kW');
    expect(battery.querySelector('svg.lucide-arrow-up')).not.toBeNull();
    expect(battery.querySelector('svg.lucide-arrow-down')).toBeNull();

    // Solar (positive) and grid-import (positive) both point down (inbound).
    expect(flowChip('3.2 kW').querySelector('svg.lucide-arrow-down')).not.toBeNull();
    expect(flowChip('2.0 kW').querySelector('svg.lucide-arrow-down')).not.toBeNull();

    // Grid-services chip renders because the reading is non-zero.
    expect(within(overviewRegion()).getByText('Grid Services')).toBeInTheDocument();
    expect(flowChip('500 W')).toBeInTheDocument();
  });

  it('renders the site-details rows and both history charts', () => {
    renderPage();
    const overview = overviewRegion();

    expect(within(overview).getByText('Grid Status')).toBeInTheDocument();
    expect(within(overview).getByText('On')).toBeInTheDocument(); // storm mode
    expect(within(overview).getByText('Yes')).toBeInTheDocument(); // backup capable

    // Charts expose the accessible chart surfaces.
    expect(
      within(historyRegion()).getByRole('img', { name: /stacked area chart/i }),
    ).toBeInTheDocument();
    expect(
      within(historyRegion()).getByRole('img', { name: /line chart/i }),
    ).toBeInTheDocument();
  });

  it('fans the site id and range window into the two data hooks', () => {
    renderPage();
    expect(mockLive).toHaveBeenCalledWith(1);
    expect(mockHistory).toHaveBeenCalledWith(1, SINCE, UNTIL, 1000);
  });
});

describe('PowerFlowDashboardPage — discharging / exporting branch', () => {
  it('flips both the KPI direction labels and the flow-arrow glyphs', () => {
    setLive({
      data: makeLive({
        solar_power: 3200,
        battery_power: 1500, // positive → Discharging; down arrow
        grid_power: -2000, // negative → Exporting; up arrow
        grid_services_power: 0,
      }),
    });
    renderPage();

    // KPI direction labels.
    expect(within(kpiRegion()).getByText('Discharging')).toBeInTheDocument();
    expect(within(kpiRegion()).getByText('Exporting')).toBeInTheDocument();
    expect(within(kpiRegion()).getByText('-2.0 kW')).toBeInTheDocument(); // signed grid reading

    // Flow arrows: discharging battery points down, exporting grid points up.
    expect(flowChip('1.5 kW').querySelector('svg.lucide-arrow-down')).not.toBeNull();
    expect(flowChip('2.0 kW').querySelector('svg.lucide-arrow-up')).not.toBeNull();
  });
});

describe('PowerFlowDashboardPage — edge branches', () => {
  it('drops direction labels for zero flows and hides the grid-services chip', () => {
    setLive({
      data: makeLive({
        solar_power: 0,
        battery_power: 0,
        load_power: 0,
        grid_power: 0,
        grid_services_power: 0,
      }),
    });
    renderPage();

    // No charge/discharge/import/export labels when every flow is zero.
    expect(within(kpiRegion()).queryByText('Charging')).toBeNull();
    expect(within(kpiRegion()).queryByText('Discharging')).toBeNull();
    expect(within(kpiRegion()).queryByText('Importing')).toBeNull();
    expect(within(kpiRegion()).queryByText('Exporting')).toBeNull();
    // All four KPI tiles collapse to "0 W".
    expect(within(kpiRegion()).getAllByText('0 W')).toHaveLength(4);

    // Grid-services flow chip is omitted when its reading is zero.
    expect(within(overviewRegion()).queryByText('Grid Services')).toBeNull();
  });

  it('renders an unknown grid status as neutral (not danger) in both panels', () => {
    setLive({ data: makeLive({ grid_status: null, storm_mode_active: false, backup_capable: false }) });
    renderPage();

    // Bug-fix #2 — status strip: unknown is neutral, never a red danger chip.
    const stripBadge = within(statusRegion()).getByText('Grid: Unknown');
    expect(stripBadge.className).toContain('bg-gray-100');
    expect(stripBadge.className).not.toContain('bg-red-100');

    // Bug-fix #2 — site-details panel: same neutral mapping for the bare value.
    const siteBadge = within(overviewRegion()).getByText('Unknown');
    expect(siteBadge.className).toContain('bg-gray-100');
    expect(siteBadge.className).not.toContain('bg-red-100');

    // Storm/backup off render their negative-state values.
    expect(within(overviewRegion()).getByText('Off')).toBeInTheDocument();
    expect(within(overviewRegion()).getByText('No')).toBeInTheDocument();
  });

  it('keeps a real non-Active grid status as a danger chip', () => {
    setLive({ data: makeLive({ grid_status: 'Islanded' }) });
    renderPage();

    const badge = within(statusRegion()).getByText('Grid: Islanded');
    expect(badge.className).toContain('bg-red-100');
    expect(badge.className).not.toContain('bg-green-100');
  });
});

describe('PowerFlowDashboardPage — live query error', () => {
  it('shows the status caption, dashes every KPI, and offers retry in each panel', () => {
    const err = new ApiError('boom', 500);
    const liveQuery = makeQuery({ data: undefined, isError: true, error: err });
    mockLive.mockReturnValue(liveQuery);
    renderPage();

    // Status strip degrades to the unavailable caption.
    expect(
      within(statusRegion()).getByText('Live status unavailable — refresh to fetch'),
    ).toBeInTheDocument();

    // Every KPI reads "—" on error (4 tiles).
    expect(within(kpiRegion()).getAllByText('—')).toHaveLength(4);

    // Each of the three live panels renders a retryable server-error state.
    const retries = within(overviewRegion()).getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThanOrEqual(3);

    fireEvent.click(retries[0]);
    expect(liveQuery.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('PowerFlowDashboardPage — history query error', () => {
  it('swaps only the charts for a retryable error and keeps live panels intact', () => {
    const err = new ApiError('history boom', 503);
    const historyQuery = makeQuery({ data: undefined, isError: true, error: err });
    mockHistory.mockReturnValue(historyQuery);
    renderPage();

    // Live overview is unaffected — the SOC gauge still renders.
    expect(within(overviewRegion()).getByText('State of Charge')).toBeInTheDocument();

    // Charts lose their image surface and show a retry CTA instead.
    expect(within(historyRegion()).queryByRole('img', { name: /stacked area chart/i })).toBeNull();
    const retries = within(historyRegion()).getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(retries[0]);
    expect(historyQuery.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('PowerFlowDashboardPage — no-data envelope', () => {
  it('shows the caption, "—" KPIs, and a refresh EmptyState per panel', () => {
    // A response with no `id` is a "no data yet" envelope, not a real snapshot.
    setLive({ data: { message: 'no data' } as unknown as TeslaEnergyLiveStatus });
    renderPage();

    expect(
      within(statusRegion()).getByText('Live status unavailable — refresh to fetch'),
    ).toBeInTheDocument();
    expect(within(kpiRegion()).getAllByText('—')).toHaveLength(4);

    const overview = overviewRegion();
    expect(within(overview).getByText('No battery data — refresh to fetch')).toBeInTheDocument();
    expect(within(overview).getByText('No power flow data yet')).toBeInTheDocument();
    expect(within(overview).getByText('No site data — refresh to fetch')).toBeInTheDocument();
  });

  it('fires the refresh mutation from an EmptyState CTA', () => {
    setLive({ data: { message: 'no data' } as unknown as TeslaEnergyLiveStatus });
    renderPage();

    const cta = within(overviewRegion()).getAllByRole('button', { name: 'Refresh from Tesla' });
    fireEvent.click(cta[0]);
    expect(refreshMutate).toHaveBeenCalledWith(1);
  });
});

describe('PowerFlowDashboardPage — interactions', () => {
  it('fires the refresh mutation from the header action', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh from Tesla' }));
    expect(refreshMutate).toHaveBeenCalledWith(1);
  });

  it('commits a range-preset selection through setRange', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('power-flow-range'));
    const dialog = screen.getByRole('dialog');
    const options = within(dialog).getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);

    fireEvent.click(options[0]);
    expect(setRange).toHaveBeenCalledTimes(1);
    const [range] = setRange.mock.calls[0];
    expect(range.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
