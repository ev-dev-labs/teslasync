/**
 * PowerFlowHistoryWidget — behaviour, branch, null-safety and a11y coverage for
 * the dashboard's 24-hour solar/battery/grid/home power-flow widget.
 *
 * What this file pins:
 *   - the exported `shortTime` helper: HH:MM zero-padding for a valid ISO
 *     timestamp, and the invalid/empty-date guard that returns the raw input
 *     instead of "NaN:NaN";
 *   - the widget's data-source wiring: the first linked Tesla Energy site's
 *     `energy_site_id` is what the live-status-history query is keyed on, with a
 *     ~24h-ago `since` ISO window; with no site the history query is handed an
 *     undefined id (disabled);
 *   - every render state fanned out by `WidgetShell` — the loading skeleton, the
 *     "No Tesla Energy site linked" empty state (only when the sites query
 *     genuinely returned none), and the "No power flow data" empty state (no
 *     samples, or an all-zero window);
 *   - the REGRESSION FIX at the heart of this elevation: a *sites fetch error*
 *     must surface the shell's error UI, NOT be masked behind a misleading
 *     "no site linked" empty panel (the `!sitesError` guard on the no-site
 *     branch);
 *   - the populated standard body — the Avg Solar / Peak Home / Net Grid stat
 *     row (W→kW /1000 scaling, mean / max / sum reductions, locale formatting),
 *     the stacked AreaChart wiring (data count, four series' keys / names /
 *     stroke colours / stackId / gradient fills), the `time`-keyed X axis, the
 *     `fmt`-routed Y axis, and the "<n> kW" tooltip formatter;
 *   - the compact (1-col) variant — only Avg Solar + Peak Home, no Net Grid,
 *     no chart body;
 *   - the wide (cols≥3) variant — the larger `axisTick` is selected over
 *     `axisTickSm`;
 *   - null-safety — null power fields and a null timestamp degrade to 0 / '—'
 *     rather than throwing or rendering NaN;
 *   - the "Refresh" freshness control wiring back to both sources' `refetch`
 *     (and to sites-only when there is no site);
 *   - a11y — the icon-only refresh control exposes an accessible name and the
 *     decorative TrendingUp icons are hidden from the a11y tree.
 *
 * Strategy: the two data hooks (`useTeslaEnergySites`,
 * `useTeslaEnergyLiveStatusHistory`) live in a mocked module so no network is
 * touched and every query state is controllable per-test. Recharts renders 0×0
 * under jsdom, so — following the repo convention (see PowerHistoryChart /
 * SentryModeChart tests) — the shared `@/components/charts` barrel is swapped for
 * lightweight doubles that surface the `data` prop and each series' / axis' /
 * tooltip's props as inspectable attributes; only the pixel-pushing chart
 * library is stubbed, the widget's own logic still runs. i18n is a passthrough
 * that honours the English default so visible copy is deterministic and real.
 * The widget is rendered inside a MemoryRouter because the shared feedback
 * components it composes (QueryError / EmptyState) may reach for router context.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { TeslaEnergyLiveStatus, TeslaEnergySite } from '@/types/energy';
import type { WidgetSize } from './types';

// ── Mocks ────────────────────────────────────────────────────────────────────

// i18n passthrough: returns the English default so the widget's copy ("Avg
// Solar", "No Tesla Energy site linked", "Power Flow History", "Refresh") is
// asserted verbatim.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// charts: surface the AreaChart's datum count, each series' props, the axis
// dataKey / tick marker / tickFormatter output, and the tooltip formatter output
// for inspection. Only the chart library is stubbed — the widget's own series
// wiring, axis config, and formatters still run.
vi.mock('@/components/charts', async () => {
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
  ...chartTestDoubles,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
    // Wrap in an <svg> so the source's real <defs>/<linearGradient>/<stop>
    // gradient nodes resolve in the SVG namespace (no React casing warnings)
    // exactly as they would inside recharts' real chart surface.
    <svg data-testid="area-chart" data-count={String((data ?? []).length)}>
      {children}
    </svg>
  ),
  Area: ({
    dataKey,
    name,
    stroke,
    fill,
    stackId,
  }: {
    dataKey?: string;
    name?: string;
    stroke?: string;
    fill?: string;
    stackId?: string;
  }) => (
    <div
      data-testid="area"
      data-key={String(dataKey)}
      data-name={String(name)}
      data-stroke={String(stroke)}
      data-fill={String(fill)}
      data-stack={String(stackId)}
    />
  ),
  XAxis: ({
    dataKey,
    tick,
  }: {
    dataKey?: string;
    tick?: { __id?: string };
  }) => (
    <div data-testid="x-axis" data-key={String(dataKey)} data-tick={String(tick?.__id ?? '')} />
  ),
  YAxis: ({ tickFormatter }: { tickFormatter?: (v: number) => string }) => (
    <div data-testid="y-axis" data-sample={tickFormatter ? tickFormatter(1234.5) : ''} />
  ),
  Tooltip: ({
    formatter,
  }: {
    formatter?: (value: number, name: string) => [string, string];
  }) => (
    <div
      data-testid="tooltip"
      data-sample={formatter ? JSON.stringify(formatter(1.5, 'Solar')) : ''}
    />
  ),
  // Non-component barrel values the source renders inline / spreads / passes.
  chartGrid: <div data-testid="chart-grid" />,
  chartMargin: {},
  chartAnimation: {},
  axisTick: { __id: 'tick-lg' },
  axisTickSm: { __id: 'tick-sm' },
  fmt: (v: number, d = 0) => Number(v).toFixed(d),
  };
});

const { useSitesMock, useHistoryMock } = vi.hoisted(() => ({
  useSitesMock: vi.fn(),
  useHistoryMock: vi.fn(),
}));

vi.mock('@/api/hooks/useEnergy', () => ({
  useTeslaEnergySites: () => useSitesMock(),
  useTeslaEnergyLiveStatusHistory: (...args: unknown[]) => useHistoryMock(...args),
}));

import PowerFlowHistoryWidget, { shortTime } from './PowerFlowHistoryWidget';

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface QResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeQ<T>(data: T | undefined, over: Partial<QResult<T>> = {}): QResult<T> {
  return {
    data,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeSite(over: Partial<TeslaEnergySite> = {}): TeslaEnergySite {
  return {
    id: 1,
    energy_site_id: 12345,
    resource_type: 'battery',
    site_name: 'Home',
    gateway_id: 'gw-1',
    total_pack_energy: 13500,
    percentage_charged: 80,
    battery_type: 'ac_powerwall',
    backup_capable: true,
    storm_mode_enabled: false,
    has_solar: true,
    has_battery: true,
    has_grid: true,
    has_load_meter: true,
    tou_capable: true,
    storm_mode_capable: true,
    fetched_at: '2026-07-04T00:00:00Z',
    created_at: '2026-07-04T00:00:00Z',
    ...over,
  };
}

function makeStatus(over: Partial<TeslaEnergyLiveStatus> = {}): TeslaEnergyLiveStatus {
  return {
    id: 1,
    energy_site_id: 12345,
    solar_power: 0,
    battery_power: 0,
    load_power: 0,
    grid_power: 0,
    grid_services_power: 0,
    energy_left: 10000,
    total_pack_energy: 13500,
    percentage_charged: 74,
    grid_status: 'Active',
    backup_capable: true,
    storm_mode_active: false,
    timestamp: '2026-07-04T08:30:00Z',
    fetched_at: '2026-07-04T08:30:05Z',
    ...over,
  };
}

// A two-sample window whose derived stats are all distinct so each stat can be
// asserted unambiguously:
//   solar (W): 4000, 6000 → kW 4, 6      → avg  5.0
//   load  (W): 3000, 7000 → kW 3, 7      → peak 7.0
//   grid  (W): 1000, 2000 → kW 1, 2      → net  3.0
function populatedWindow(): TeslaEnergyLiveStatus[] {
  return [
    makeStatus({
      timestamp: '2026-07-04T08:30:00Z',
      solar_power: 4000,
      battery_power: 1000,
      grid_power: 1000,
      load_power: 3000,
    }),
    makeStatus({
      timestamp: '2026-07-04T09:15:00Z',
      solar_power: 6000,
      battery_power: 2000,
      grid_power: 2000,
      load_power: 7000,
    }),
  ];
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }) {
  return render(
    <MemoryRouter>
      <PowerFlowHistoryWidget size={size} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useSitesMock.mockReset();
  useHistoryMock.mockReset();
  // Default: one linked site + a populated 2-sample window.
  useSitesMock.mockReturnValue(makeQ<TeslaEnergySite[]>([makeSite()]));
  useHistoryMock.mockReturnValue(makeQ<TeslaEnergyLiveStatus[]>(populatedWindow()));
});

// ── Pure helper: shortTime ───────────────────────────────────────────────────

describe('shortTime', () => {
  it('formats a valid ISO timestamp to zero-padded local HH:MM', () => {
    // Build the expectation from the same local Date the helper uses so the
    // assertion is timezone-agnostic.
    const iso = '2026-07-04T08:30:00Z';
    const d = new Date(iso);
    const expected = `${String(d.getHours()).padStart(2, '0')}:${String(
      d.getMinutes(),
    ).padStart(2, '0')}`;
    expect(shortTime(iso)).toBe(expected);
    expect(shortTime(iso)).toMatch(/^\d{2}:\d{2}$/);
  });

  it('zero-pads single-digit hours and minutes', () => {
    const iso = '2026-07-04T03:05:00';
    // Local-time constructor (no Z) → deterministic across zones.
    expect(shortTime(iso)).toBe('03:05');
  });

  it('returns the raw input for an unparseable/empty date instead of NaN:NaN', () => {
    expect(shortTime('not-a-date')).toBe('not-a-date');
    expect(shortTime('')).toBe('');
  });
});

// ── Data-source wiring ───────────────────────────────────────────────────────

describe('PowerFlowHistoryWidget — data-source wiring', () => {
  it('keys the history query on the first site id with a ~24h-ago ISO window', () => {
    useSitesMock.mockReturnValue(makeQ<TeslaEnergySite[]>([makeSite({ energy_site_id: 999 })]));
    renderWidget();
    expect(useHistoryMock).toHaveBeenCalledWith(
      999,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    );
  });

  it('passes an undefined site id (history query disabled) when no site is linked', () => {
    useSitesMock.mockReturnValue(makeQ<TeslaEnergySite[]>([]));
    renderWidget();
    expect(useHistoryMock).toHaveBeenCalledWith(undefined, expect.any(String));
  });

  it('tolerates an undefined sites list without throwing', () => {
    useSitesMock.mockReturnValue(makeQ<TeslaEnergySite[]>(undefined));
    expect(() => renderWidget()).not.toThrow();
    expect(useHistoryMock).toHaveBeenCalledWith(undefined, expect.any(String));
  });
});

// ── Render states ────────────────────────────────────────────────────────────

describe('PowerFlowHistoryWidget — states', () => {
  it('renders a loading skeleton while the sites query is pending', () => {
    useSitesMock.mockReturnValue(makeQ<TeslaEnergySite[]>(undefined, { isLoading: true }));
    const { container } = renderWidget();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('area-chart')).toBeNull();
    expect(screen.queryByText('Avg Solar')).toBeNull();
  });

  it('also shows the skeleton while the history query is pending for a linked site', () => {
    useHistoryMock.mockReturnValue(makeQ<TeslaEnergyLiveStatus[]>(undefined, { isLoading: true }));
    const { container } = renderWidget();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });

  it('shows the "no site linked" empty state when the sites query returns none', () => {
    useSitesMock.mockReturnValue(makeQ<TeslaEnergySite[]>([]));
    renderWidget();
    expect(screen.getByText('No Tesla Energy site linked')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });

  it('shows the "no power flow data" empty state for an empty history window', () => {
    useHistoryMock.mockReturnValue(makeQ<TeslaEnergyLiveStatus[]>([]));
    renderWidget();
    expect(screen.getByText('No power flow data')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });

  it('treats an all-zero window as empty (never a chart of flat zero lines)', () => {
    useHistoryMock.mockReturnValue(
      makeQ<TeslaEnergyLiveStatus[]>([makeStatus(), makeStatus({ timestamp: '2026-07-04T09:00:00Z' })]),
    );
    renderWidget();
    expect(screen.getByText('No power flow data')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).toBeNull();
    expect(screen.queryByText('Avg Solar')).toBeNull();
  });
});

// ── Regression: a sites *error* must not masquerade as "no site linked" ───────

describe('PowerFlowHistoryWidget — sites error is surfaced, not masked', () => {
  it('renders the shell error UI (not the empty "no site" panel) when the sites query fails', () => {
    useSitesMock.mockReturnValue(
      makeQ<TeslaEnergySite[]>(undefined, {
        error: new Error('sites down'),
        isError: true,
        dataUpdatedAt: 0,
      }),
    );
    renderWidget();

    // The bug: the always-false `hasSites` used to route a fetch failure into
    // the "no site linked" empty state, swallowing the error entirely.
    expect(screen.queryByText('No Tesla Energy site linked')).toBeNull();
    // QueryError paints an assertive alert region for a non-HTTP failure.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });

  it('surfaces a history fetch error the same way once a site is linked', () => {
    useHistoryMock.mockReturnValue(
      makeQ<TeslaEnergyLiveStatus[]>(undefined, {
        error: new Error('history down'),
        isError: true,
        dataUpdatedAt: 0,
      }),
    );
    renderWidget();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });
});

// ── Populated standard body (cols = 2) ───────────────────────────────────────

describe('PowerFlowHistoryWidget — populated (standard)', () => {
  it('renders the Avg Solar / Peak Home / Net Grid stats with kW scaling', () => {
    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Avg Solar')).toBeInTheDocument();
    expect(screen.getByText('Peak Home')).toBeInTheDocument();
    expect(screen.getByText('Net Grid')).toBeInTheDocument();
    // mean(4,6)=5.0 · max(3,7)=7.0 · sum(1,2)=3.0
    expect(screen.getByText('5.0')).toBeInTheDocument();
    expect(screen.getByText('7.0')).toBeInTheDocument();
    expect(screen.getByText('3.0')).toBeInTheDocument();
    // Every stat carries the kW unit suffix.
    expect(screen.getAllByText('kW')).toHaveLength(3);
  });

  it('hands every sample to the AreaChart and wires the four stacked series', () => {
    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-count', '2');

    const areas = screen.getAllByTestId('area');
    expect(areas).toHaveLength(4);

    // solar → amber
    expect(areas[0]).toHaveAttribute('data-key', 'solar');
    expect(areas[0]).toHaveAttribute('data-name', 'Solar');
    expect(areas[0]).toHaveAttribute('data-stroke', '#facc15');
    expect(areas[0]).toHaveAttribute('data-fill', 'url(#pfh-solarGrad)');
    // battery → green
    expect(areas[1]).toHaveAttribute('data-key', 'battery');
    expect(areas[1]).toHaveAttribute('data-name', 'Battery');
    expect(areas[1]).toHaveAttribute('data-stroke', '#22c55e');
    expect(areas[1]).toHaveAttribute('data-fill', 'url(#pfh-batteryGrad)');
    // grid → blue
    expect(areas[2]).toHaveAttribute('data-key', 'grid');
    expect(areas[2]).toHaveAttribute('data-name', 'Grid');
    expect(areas[2]).toHaveAttribute('data-stroke', '#3b82f6');
    expect(areas[2]).toHaveAttribute('data-fill', 'url(#pfh-gridGrad)');
    // home → gray
    expect(areas[3]).toHaveAttribute('data-key', 'home');
    expect(areas[3]).toHaveAttribute('data-name', 'Home');
    expect(areas[3]).toHaveAttribute('data-stroke', '#9ca3af');
    expect(areas[3]).toHaveAttribute('data-fill', 'url(#pfh-homeGrad)');

    // All four share a single stack so the areas add up rather than overlap.
    areas.forEach((a) => expect(a).toHaveAttribute('data-stack', '1'));
  });

  it('keys the X axis on time and routes the Y axis through fmt', () => {
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'time');
    // fmt(1234.5, 1) → "1234.5"
    expect(screen.getByTestId('y-axis')).toHaveAttribute('data-sample', '1234.5');
  });

  it('formats tooltip values as "<n> kW" via fmtNumber', () => {
    renderWidget({ cols: 2, rows: 2 });
    // formatter(1.5, 'Solar') → ["1.50 kW", "Solar"]
    expect(screen.getByTestId('tooltip').getAttribute('data-sample')).toContain('1.50 kW');
  });

  it('selects the small axis tick at standard width', () => {
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-tick', 'tick-sm');
  });
});

// ── Compact (1-col) variant ──────────────────────────────────────────────────

describe('PowerFlowHistoryWidget — compact', () => {
  it('renders only Avg Solar + Peak Home and suppresses the chart + Net Grid', () => {
    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('Avg Solar')).toBeInTheDocument();
    expect(screen.getByText('Peak Home')).toBeInTheDocument();
    expect(screen.getByText('5.0')).toBeInTheDocument();
    expect(screen.getByText('7.0')).toBeInTheDocument();
    // Net Grid stat and the chart body only exist on the standard+ layout.
    expect(screen.queryByText('Net Grid')).toBeNull();
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });

  it('shows its own empty state when there is no data', () => {
    useHistoryMock.mockReturnValue(makeQ<TeslaEnergyLiveStatus[]>([]));
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('No power flow data')).toBeInTheDocument();
    expect(screen.queryByText('Avg Solar')).toBeNull();
  });
});

// ── Wide (cols ≥ 3) variant ──────────────────────────────────────────────────

describe('PowerFlowHistoryWidget — wide', () => {
  it('selects the larger axis tick and still renders all three stats + chart', () => {
    renderWidget({ cols: 3, rows: 4 });
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-tick', 'tick-lg');
    expect(screen.getByText('Net Grid')).toBeInTheDocument();
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
  });
});

// ── Null safety ──────────────────────────────────────────────────────────────

describe('PowerFlowHistoryWidget — null safety', () => {
  it('floors null power fields to 0 and a null timestamp to the raw guard without NaN', () => {
    useHistoryMock.mockReturnValue(
      makeQ<TeslaEnergyLiveStatus[]>([
        // Fully-null sample: powers → 0, timestamp guarded to ''.
        makeStatus({
          timestamp: null as unknown as string,
          solar_power: null,
          battery_power: null,
          grid_power: null,
          load_power: null,
        }),
        // One real sample so the window is non-empty:
        //   solar 4kW · load 6kW · grid 2kW
        makeStatus({
          timestamp: '2026-07-04T09:15:00Z',
          solar_power: 4000,
          battery_power: 2000,
          grid_power: 2000,
          load_power: 6000,
        }),
      ]),
    );

    expect(() => renderWidget({ cols: 2, rows: 2 })).not.toThrow();
    // avg solar = (0+4)/2 = 2.0 · peak home = max(0,6) = 6.0
    expect(screen.getByText('6.0')).toBeInTheDocument();
    expect(screen.getAllByText('2.0').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-count', '2');
  });
});

// ── Refresh wiring ───────────────────────────────────────────────────────────

describe('PowerFlowHistoryWidget — refresh', () => {
  it('refetches both sites and history when the freshness control is activated', () => {
    const refetchSites = vi.fn();
    const refetchHistory = vi.fn();
    useSitesMock.mockReturnValue(makeQ<TeslaEnergySite[]>([makeSite()], { refetch: refetchSites }));
    useHistoryMock.mockReturnValue(
      makeQ<TeslaEnergyLiveStatus[]>(populatedWindow(), { refetch: refetchHistory }),
    );

    renderWidget({ cols: 2, rows: 2 });
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetchSites).toHaveBeenCalledTimes(1);
    expect(refetchHistory).toHaveBeenCalledTimes(1);
  });

  it('refetches only sites (never history) from the no-site empty state', () => {
    const refetchSites = vi.fn();
    const refetchHistory = vi.fn();
    useSitesMock.mockReturnValue(makeQ<TeslaEnergySite[]>([], { refetch: refetchSites }));
    useHistoryMock.mockReturnValue(makeQ<TeslaEnergyLiveStatus[]>([], { refetch: refetchHistory }));

    renderWidget({ cols: 2, rows: 2 });
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetchSites).toHaveBeenCalledTimes(1);
    expect(refetchHistory).not.toHaveBeenCalled();
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

describe('PowerFlowHistoryWidget — a11y', () => {
  it('exposes an accessible name on the icon-only refresh control', () => {
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('hides the decorative header icon from the accessibility tree', () => {
    renderWidget({ cols: 2, rows: 2 });
    const titleRow = screen.getByText('Power Flow History').parentElement;
    expect(titleRow?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('hides the decorative empty-state icon from the accessibility tree', () => {
    useSitesMock.mockReturnValue(makeQ<TeslaEnergySite[]>([]));
    renderWidget({ cols: 2, rows: 2 });
    const emptyRegion = screen.getByText('No Tesla Energy site linked').closest('[role="status"]');
    expect(emptyRegion?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});
