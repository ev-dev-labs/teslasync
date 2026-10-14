/**
 * ChargingHeatmapPage — behaviour, branch, and a11y coverage.
 *
 * The page is the "Charging Patterns" surface: a 7×24 weekday/hour density
 * heatmap plus a derived insights side panel and two breakdown charts, all
 * scoped to the header-selected vehicle and a persisted date range. Its own
 * responsibilities (what these tests exercise) are:
 *
 *   1. One `useChargingSessionsPaginated` feed keyed on the active vehicle
 *      and both precise shared-range instants, not calendar date labels.
 *   2. A KPI band derived from the sessions — count, SI watt-hours → kWh at the
 *      render boundary, currency cost, and the average of *completed* durations.
 *   3. Section-local loading / error / empty branches for EVERY panel — no panel
 *      is gated away or left blank.
 *   4. Deterministic grid / insight derivations surfaced in the hero + side panel.
 *   5. Shared header vehicle scope + page refresh wiring and a11y
 *      (labelled regions, an icon-only refresh button, the heatmap `img`).
 *
 * Strategy mirrors PeriodComparePage: render the REAL page + REAL shared subtree
 * (PageLayout, StatStrip, MetricBar, HeatmapGrid, QueryError, charts). Only
 * the network `request` helper and i18n are mocked — the vehicle store, range
 * state, and settings-driven unit/format hooks all run for real so the SI →
 * display conversion and active-vehicle fallback are genuinely exercised.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { setGlobalLocale } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

// jsdom lacks matchMedia; framer-motion (via <FadeIn>, <MetricBar>, and the
// PageContainer freshness chip's useReducedMotion) reads it at module load.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

const { mockRequest, translations } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  translations: {} as Record<string, string>,
}));

// Replace only `request`; keep the real isApiError/ApiError so <QueryError>
// classifies an injected ApiError(500) into its "Server error" branch.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: mockRequest };
});

// i18n → developer fallback with {{var}} interpolation so assertions read real
// sentences rather than raw keys.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = translations[key] ?? (typeof fallback === 'string' ? fallback : key);
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import ChargingHeatmapPage from '../ChargingHeatmapPage';
import { SelectedVehicleProvider, useSelectedVehicleStore } from '@/store/selectedVehicle';
import { Button } from '@/components/ui';
import { ApiError } from '@/lib/resilience';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';

// ── Fixtures ────────────────────────────────────────────────────────────────
const TWO_VEHICLES = [
  { id: 10, vehicle_id: 10, vin: 'VIN00010', display_name: 'Model 3', state: 'online' },
  { id: 20, vehicle_id: 20, vin: 'VIN00020', display_name: 'Model Y', state: 'asleep' },
];

// Metric units, en-US, 2-dp so the KPI band formats deterministically.
const SETTINGS = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  decimal_precision: 2,
  currency_symbol: '$',
  locale: 'en-US',
  base_cost_per_kwh: 0.12,
};

// Build an ISO instant from a LOCAL wall-clock so getDay()/getHours() inside
// buildGrid round-trip to the same weekday/hour regardless of the runner's tz.
function localIso(y: number, mo: number, d: number, h: number, mi = 0): string {
  return new Date(y, mo, d, h, mi, 0, 0).toISOString();
}

interface SessionOverrides {
  id: number;
  started_at: string;
  ended_at?: string | null;
  start_place?: string | null;
  total_energy_added_wh?: number;
  cost_decimal?: number | null;
}
function session(o: SessionOverrides) {
  return {
    id: o.id,
    vehicle_id: 10,
    started_at: o.started_at,
    ended_at: o.ended_at ?? null,
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: o.start_place ?? null,
    total_energy_added_wh: o.total_energy_added_wh ?? 0,
    peak_power_w: null,
    avg_power_w: null,
    cost_decimal: o.cost_decimal ?? null,
    cost_currency: 'USD',
    charger_type: 'AC',
    cable_type: null,
    duration_min: 0,
    startedAt: o.started_at,
  };
}

// Jan 2024: 1=Mon(1) 2=Tue(2) 6=Sat(6) 7=Sun(0). Three sessions share the
// Mon-10:00 slot (the busiest); three others are still "live" (no ended_at) so
// they must be counted but must NOT contribute to the average-duration mean.
const SESSIONS = [
  session({ id: 1, started_at: localIso(2024, 0, 1, 10, 0), ended_at: localIso(2024, 0, 1, 12, 0), start_place: 'Home', total_energy_added_wh: 10000, cost_decimal: 4 }),
  session({ id: 2, started_at: localIso(2024, 0, 1, 10, 30), ended_at: localIso(2024, 0, 1, 12, 30), start_place: 'Home', total_energy_added_wh: 10000, cost_decimal: 4 }),
  session({ id: 3, started_at: localIso(2024, 0, 1, 10, 45), ended_at: localIso(2024, 0, 1, 12, 45), start_place: 'Home', total_energy_added_wh: 10000, cost_decimal: 4 }),
  session({ id: 4, started_at: localIso(2024, 0, 2, 14, 0), ended_at: null, start_place: 'Work', total_energy_added_wh: 10000, cost_decimal: 4 }),
  session({ id: 5, started_at: localIso(2024, 0, 6, 9, 0), ended_at: null, start_place: 'Work', total_energy_added_wh: 10000, cost_decimal: 4 }),
  session({ id: 6, started_at: localIso(2024, 0, 7, 20, 0), ended_at: null, start_place: 'Cafe', total_energy_added_wh: 5000, cost_decimal: 5 }),
];

const GRID_ARIA = 'Charging sessions by weekday and hour of day';

type ChargingMode = 'resolve' | 'pending' | 'reject';
interface InstallOpts {
  vehicles?: unknown[];
  sessions?: unknown[];
  chargingMode?: ChargingMode;
  chargingError?: unknown;
  settings?: Record<string, unknown>;
}
function installRequest({
  vehicles = TWO_VEHICLES,
  sessions = SESSIONS,
  chargingMode = 'resolve',
  chargingError,
  settings = SETTINGS,
}: InstallOpts = {}) {
  mockRequest.mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.startsWith('/charging')) {
      if (chargingMode === 'pending') return new Promise(() => {});
      if (chargingMode === 'reject') return Promise.reject(chargingError ?? new Error('boom'));
      return Promise.resolve(sessions);
    }
    if (u.startsWith('/settings')) return Promise.resolve(settings);
    if (u.startsWith('/vehicles')) return Promise.resolve(vehicles);
    return Promise.resolve({});
  });
}

function chargingCalls(): string[] {
  return mockRequest.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith('/charging'));
}

function HeaderVehicleControl() {
  const { setVehicleId } = useSelectedVehicleStore();
  return <Button type="button" data-testid="header-vehicle-20" onClick={() => setVehicleId(20)}>Select vehicle 20 in header</Button>;
}

function renderPage(initialEntry = '/charging-heatmap') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return { client, ...render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <SelectedVehicleProvider>
          <ChargingHeatmapPage />
          <HeaderVehicleControl />
        </SelectedVehicleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ) };
}

// OperationalBrief keeps the complete display value separate from trust details.
function kpiValue(label: string): string {
  const card = within(screen.getByRole('region', { name: 'Charging summary' }))
    .getByText(label).closest('[data-operational-metric]');
  expect(card).not.toBeNull();
  const value = card!.querySelector('[data-operational-value]');
  expect(value).not.toBeNull();
  return value!.textContent ?? '';
}

beforeEach(() => {
  mockRequest.mockReset();
  setGlobalLocale('en-US');
  for (const key of Object.keys(translations)) delete translations[key];
  window.localStorage.clear();
});
afterEach(() => {
  onlineManager.setOnline(true);
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('ChargingHeatmapPage — precise server range contract', () => {
  function bounds(url: string) {
    return new URL(url, 'http://localhost').searchParams;
  }

  it('sends the precise rolling 24-hour instants and keys the cache with both', async () => {
    const now = Date.parse('2026-10-14T17:45:50.694Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    installRequest();
    const { client } = renderPage('/charging-heatmap?time_scope=24h');
    await screen.findByRole('img', { name: GRID_ARIA });

    const start = '2026-10-13T17:45:50.694Z';
    const end = '2026-10-14T17:45:50.694Z';
    expect(bounds(chargingCalls()[0]).get('start')).toBe(start);
    expect(bounds(chargingCalls()[0]).get('end')).toBe(end);
    expect(client.getQueryData(['charging', 10, start, end, 2000, 0])).toEqual(SESSIONS);
    expect(kpiValue('Total Energy')).toMatch(/^55(?:\.0+)?\s*kWh$/);
  });

  it('preserves non-UTC custom midnights across DST and Sunday-first buckets', async () => {
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...resolvedOptions.call(this), timeZone: 'America/Los_Angeles' };
    });
    installRequest();
    renderPage('/charging-heatmap?from=2026-03-08&to=2026-03-09&time_scope=custom');
    await screen.findByRole('img', { name: GRID_ARIA });

    expect(bounds(chargingCalls()[0]).get('start')).toBe('2026-03-08T08:00:00.000Z');
    expect(bounds(chargingCalls()[0]).get('end')).toBe('2026-03-10T07:00:00.000Z');
    const figure = screen.getByRole('figure', { name: GRID_ARIA });
    const rows = within(figure).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Sun');
    expect(rows[25]).toHaveTextContent('Mon');
    // Returned SI rows remain untouched; the server, not loaded-row filtering,
    // owns the range (the fixture dates intentionally precede this window).
    expect(kpiValue('Total Sessions')).toBe('6');
  });

  it('changes the query key for either exact bound and cancels pending requests', async () => {
    const signals: AbortSignal[] = [];
    mockRequest.mockImplementation((_url: string, options: { signal: AbortSignal }) => {
      signals.push(options.signal);
      return new Promise(() => {});
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const start = '2026-10-13T17:45:50.694Z';
    const end = '2026-10-14T17:45:50.694Z';
    const { rerender, unmount } = renderHook(
      (range: { start: string; end: string }) =>
        useChargingSessionsPaginated(10, { limit: 2000, ...range }),
      {
        initialProps: { start, end },
        wrapper: ({ children }: { children: ReactNode }) =>
          <QueryClientProvider client={client}>{children}</QueryClientProvider>,
      },
    );
    await waitFor(() => expect(signals).toHaveLength(1));
    const nextStart = '2026-10-13T17:46:50.694Z';
    rerender({ start: nextStart, end });
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    const nextEnd = '2026-10-14T17:46:50.694Z';
    rerender({ start: nextStart, end: nextEnd });
    await waitFor(() => expect(signals).toHaveLength(3));
    expect(signals[1].aborted).toBe(true);
    expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([
      ['charging', 10, start, end, 2000, 0],
      ['charging', 10, nextStart, end, 2000, 0],
      ['charging', 10, nextStart, nextEnd, 2000, 0],
    ]);
    expect(bounds(chargingCalls()[2]).get('end')).toBe(nextEnd);
    unmount();
    expect(signals[2].aborted).toBe(true);
  });
});

describe('ChargingHeatmapPage — happy path', () => {
  it('renders the page shell, every section/panel heading, and the heatmap image', async () => {
    installRequest();
    renderPage();

    // The heatmap image only mounts once sessions resolve — a reliable "loaded" signal.
    await screen.findByRole('img', { name: GRID_ARIA });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Charging Patterns' }),
    ).toBeInTheDocument();
    expect(screen.getByText('When and where you charge')).toBeInTheDocument();

    // Every labelled section region is mounted (none gated away).
    expect(screen.getByRole('region', { name: 'Charging summary' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'When You Charge' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Charging Breakdowns' })).toBeInTheDocument();

    // All four panel headings render.
    for (const name of [
      'Weekly Charging Heatmap',
      'Charging Insights',
      'Top Charging Locations',
      'Sessions by Day of Week',
    ]) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
  });

  it('derives the KPI band from the sessions (count, SI-Wh→kWh energy, cost)', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    // 6 sessions, 55,000 Wh → 55 kWh, $4×5 + $5 = $25.00.
    expect(kpiValue('Total Sessions')).toBe('6');
    expect(kpiValue('Total Energy')).toMatch(/^55(?:\.0+)?\s*kWh$/);
    expect(kpiValue('Total Cost')).toBe('$25.00');
  });

  it('renders the insights side panel with favorite slot + busiest day/hour', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    // Busiest slot = Monday 10:00 with 3 sessions (DAYS[1] === 'Mon').
    expect(screen.getByText('Monday at 10:00 AM')).toBeInTheDocument();
    expect(screen.getByText('3 sessions')).toBeInTheDocument();
    // MetricBar sublabels are distinctive "<label> · <count>" strings.
    expect(screen.getByText('Mon · 3')).toBeInTheDocument();
    expect(screen.getByText('10:00 AM · 3')).toBeInTheDocument();
  });

  it('preserves populated insight readings with solid function-valued theme colors', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    for (const [label, series, value] of [
      ['Busiest Day', 5, 3],
      ['Busiest Hour', 1, 3],
      ['Weekdays', 0, 4],
      ['Weekends', 4, 2],
    ] as const) {
      const bar = screen.getByRole('progressbar', { name: label });
      expect(bar).toHaveAttribute('aria-valuenow', String(value));
      expect(bar).toHaveAttribute('aria-valuemax', '6');
      expect(bar.querySelector('[data-metric-fill]')).toHaveStyle({
        background: chartTokens.series[series],
      });
    }
  });

  it('translates a complete weekday/time phrase without changing Sunday-first hour buckets', async () => {
    translations['charging.heatmap.favoriteValue'] = 'Um {{hour}} am {{day}}';
    setGlobalLocale('de-DE');
    installRequest({ settings: { ...SETTINGS, locale: 'de-DE' } });
    renderPage();
    await screen.findAllByRole('img', { name: GRID_ARIA });
    await waitFor(() => expect(screen.getByText('Um 10:00 am Montag')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /data table/ }));
    const rows = within(screen.getByRole('region', { name: GRID_ARIA })).getAllByRole('row');
    expect(rows).toHaveLength(169);
    expect(rows[1]).toHaveTextContent('So');
    expect(rows[25]).toHaveTextContent('Mo');
    expect(rows[35]).toHaveTextContent('10:00');
    expect(within(rows[35]).getByRole('cell', { name: '3' })).toBeInTheDocument();
    expect(screen.getByText('Mo · 3')).toBeInTheDocument();
    expect(kpiValue('Total Energy')).toMatch(/^55[.,]00\s*kWh$/);
  });

  it('shows the real breakdown charts (not their empty states) when data exists', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    expect(screen.queryByText('No repeat charging locations yet')).toBeNull();
    expect(screen.queryByText('No charging sessions in this range')).toBeNull();
  });
});

describe('ChargingHeatmapPage — average-duration derivation (regression)', () => {
  it('averages only sessions with a measured duration, not live/open ones', async () => {
    // 3 completed 2h sessions + 3 live (no ended_at). Correct mean = 2.0h.
    // The pre-fix bug divided the 6h total by ALL six sessions → a diluted 1.0h.
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    const avg = parseFloat(kpiValue('Avg Duration'));
    expect(avg).toBe(2);
    expect(avg).not.toBe(1);
  });

  it('shows an honest unknown (never NaN or measured zero) when no session has an end time', async () => {
    const openOnly = [
      session({ id: 1, started_at: localIso(2024, 0, 1, 10, 0), ended_at: null, total_energy_added_wh: 10000, cost_decimal: 4 }),
      session({ id: 2, started_at: localIso(2024, 0, 2, 11, 0), ended_at: null, total_energy_added_wh: 10000, cost_decimal: 4 }),
    ];
    installRequest({ sessions: openOnly });
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    const text = kpiValue('Avg Duration');
    expect(text).not.toContain('NaN');
    expect(text).toBe('—');
    expect(screen.getByText('Avg Duration').closest('[data-operational-metric]')).toHaveAttribute('data-value-state', 'missing');
    expect(kpiValue('Total Sessions')).toBe('2');
  });
});

describe('ChargingHeatmapPage — loading / error / empty branches', () => {
  it('keeps empty-fleet prerequisites distinct from successful empty charging history', async () => {
    installRequest({ vehicles: [] });
    renderPage();
    await screen.findByText('No vehicle selected');
    expect(chargingCalls()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    expect(kpiValue('Total Sessions')).toBe('—');
    expect(screen.queryByText('No charging sessions in this range')).not.toBeInTheDocument();
  });

  it('never requests charging during fleet loading, then enables resolved-vehicle refresh', async () => {
    let resolveFleet!: (vehicles: typeof TWO_VEHICLES) => void;
    const fleet = new Promise<typeof TWO_VEHICLES>((resolve) => { resolveFleet = resolve; });
    installRequest();
    const request = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((url: string) => url === '/vehicles' ? fleet : request(url));
    renderPage();
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('/vehicles', expect.anything()));
    expect(chargingCalls()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    resolveFleet(TWO_VEHICLES);
    await screen.findByRole('img', { name: GRID_ARIA });
    expect(screen.getAllByRole('button', { name: 'Refresh' }).find((el) => el.tagName === 'BUTTON')).toBeEnabled();
    expect(chargingCalls().every((url) => new URL(url, 'http://localhost').searchParams.get('vehicle_id') === '10')).toBe(true);
  });

  it('recovers fleet failure independently without issuing a null-scoped history request', async () => {
    installRequest();
    const request = mockRequest.getMockImplementation()!;
    let fleetFailed = true;
    mockRequest.mockImplementation((url: string) => url === '/vehicles' && fleetFailed
      ? Promise.reject(new ApiError('fleet down', 500)) : request(url));
    renderPage();
    await screen.findByRole('button', { name: 'Retry' });
    expect(chargingCalls()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    fleetFailed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('img', { name: GRID_ARIA });
    expect(chargingCalls().every((url) => /vehicle_id=10\b/.test(url))).toBe(true);
  });

  it('keeps unknowns and all panel shells when initial history loading is paused', async () => {
    installRequest();
    onlineManager.setOnline(false);
    renderPage('/charging-heatmap?vehicle_id=10');
    await screen.findByText('Loading is paused. Charging history will appear when the connection resumes.');
    expect(chargingCalls()).toHaveLength(0);
    expect(kpiValue('Total Sessions')).toBe('—');
    for (const name of ['Weekly Charging Heatmap', 'Charging Insights', 'Top Charging Locations', 'Sessions by Day of Week']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    onlineManager.setOnline(true);
    await screen.findByRole('img', { name: GRID_ARIA });
    expect(kpiValue('Total Sessions')).toBe('6');
  });

  it('retains history through refresh failure and recovers without requiring a healthy fleet refresh', async () => {
    installRequest();
    const { client } = renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });
    installRequest({ chargingMode: 'reject', chargingError: new ApiError('history down', 500) });
    await client.refetchQueries({ queryKey: ['charging'] });
    await waitFor(() => expect(client.getQueryCache().find({ queryKey: ['charging'] })?.state.status).toBe('error'));
    expect(screen.getByRole('img', { name: GRID_ARIA })).toBeInTheDocument();
    expect(kpiValue('Total Energy')).toMatch(/^55(?:\.0+)?\s*kWh$/);

    installRequest({ sessions: [SESSIONS[0]] });
    const request = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((url: string) => url === '/vehicles'
      ? Promise.reject(new ApiError('fleet refresh down', 500)) : request(url));
    await client.refetchQueries({ queryKey: ['vehicles'] });
    const refresh = screen.getAllByRole('button', { name: 'Refresh' }).find((el) => el.tagName === 'BUTTON')!;
    expect(refresh).toBeEnabled();
    fireEvent.click(refresh);
    await waitFor(() => expect(kpiValue('Total Sessions')).toBe('1'));
    expect(screen.getByRole('img', { name: GRID_ARIA })).toBeInTheDocument();
    expect(client.getQueryCache().find({ queryKey: ['charging'] })?.state.status).toBe('success');
  });

  it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])('guards forced typed-query refetch for vehicle %s', async (vehicleId) => {
    installRequest();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useChargingSessionsPaginated(vehicleId), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    const refreshed = await result.current.refetch();
    expect(refreshed.error?.message).toBe('Vehicle scope has not resolved');
    expect(chargingCalls()).toHaveLength(0);
  });

  it('shows skeletons (never blank panels) while the feed is in flight', async () => {
    installRequest({ chargingMode: 'pending' });
    const { container } = renderPage();

    await waitFor(() =>
      expect(container.querySelectorAll('[class*="--skeleton-bg"]').length).toBeGreaterThan(0),
    );
    // Panel chrome stays mounted — only the bodies are skeletons.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Weekly Charging Heatmap' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Charging Insights' }),
    ).toBeInTheDocument();
    // Labels remain visible, but loading must not expose a measured KPI value.
    expect(within(screen.getByRole('region', { name: 'Charging summary' }))
      .getByText('Total Sessions').closest('[data-operational-metric]')
      ?.querySelector('[data-operational-value]')).toBeNull();
    // The heatmap image is not rendered while loading.
    expect(screen.queryByRole('img', { name: GRID_ARIA })).toBeNull();
  });

  it('renders per-section QueryError with a Retry that refetches the feed', async () => {
    installRequest({ chargingMode: 'reject', chargingError: new ApiError('kaboom', 500) });
    renderPage();

    const when = screen.getByRole('region', { name: 'When You Charge' });
    await waitFor(() =>
      expect(within(when).getAllByText('Server error')).toHaveLength(2),
    );
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
    // The error is surfaced in the data panels, not swallowed.
    expect(screen.getAllByText('Server error').length).toBeGreaterThan(0);

    const before = chargingCalls().length;
    const weekly = within(when).getByRole('heading', { level: 3, name: 'Weekly Charging Heatmap' })
      .closest('[data-card]');
    expect(weekly).not.toBeNull();
    fireEvent.click(within(weekly!).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(chargingCalls().length).toBeGreaterThan(before));
  });

  it('shows empty states (not blank) when the vehicle has no sessions in range', async () => {
    installRequest({ sessions: [] });
    renderPage();

    // Wait until the feed has actually fired for the resolved active vehicle.
    await waitFor(() => expect(chargingCalls().length).toBeGreaterThan(0));

    // Both the heatmap and the day-of-week panels share the no-data copy.
    await waitFor(() =>
      expect(
        screen.getAllByText('No charging sessions in this range').length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(kpiValue('Total Sessions')).toBe('0');
    expect(kpiValue('Total Energy')).toBe('—');
    expect(
      screen.getByText('Insights appear once you have charging history'),
    ).toBeInTheDocument();
    expect(screen.getByText('No repeat charging locations yet')).toBeInTheDocument();
    // No heatmap image in the empty branch.
    expect(screen.queryByRole('img', { name: GRID_ARIA })).toBeNull();
  });
});

describe('ChargingHeatmapPage — data contract & toolbar', () => {
  it('requests /charging with snake_case vehicle_id + limit=2000 and no /api/v1 prefix', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    const calls = chargingCalls();
    expect(calls.length).toBeGreaterThan(0);
    // Active vehicle falls back to the first fleet vehicle (id 10).
    expect(calls.some((u) => /[?&]vehicle_id=10\b/.test(u))).toBe(true);
    expect(calls.every((u) => /[?&]limit=2000\b/.test(u))).toBe(true);
    expect(calls.every((u) => !u.includes('/api/v1'))).toBe(true);
    expect(calls.every((u) => !/vehicleId=/.test(u))).toBe(true);
  });

  it('refetches the feed when the refresh control is pressed', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    // PageContainer's freshness chip also exposes a "Refresh" control; the
    // page's own toolbar button renders last.
    const refreshButtons = screen.getAllByRole('button', { name: 'Refresh' });
    const before = chargingCalls().length;
    fireEvent.click(refreshButtons[refreshButtons.length - 1]);
    await waitFor(() => expect(chargingCalls().length).toBeGreaterThan(before));
  });

  it('re-scopes the feed to the newly selected vehicle', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    expect(chargingCalls().some((u) => /vehicle_id=20\b/.test(u))).toBe(false);
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('header-vehicle-20'));
    await waitFor(() =>
      expect(chargingCalls().some((u) => /vehicle_id=20\b/.test(u))).toBe(true),
    );
  });
});

describe('ChargingHeatmapPage — a11y & edge cases', () => {
  it('exposes an icon-only refresh control with an accessible name', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    // The page's toolbar control is a real <button> (the freshness chip is a
    // role="button" span); target the former specifically.
    const refresh = screen
      .getAllByRole('button', { name: 'Refresh' })
      .find((el) => el.tagName === 'BUTTON');
    expect(refresh).toBeDefined();
    expect(refresh).toHaveAttribute('aria-label', 'Refresh');
  });

  it('degrades the favorite slot to an em-dash when sessions carry unparseable dates', async () => {
    const badDates = [
      session({ id: 1, started_at: 'not-a-date', ended_at: null, start_place: 'Home', total_energy_added_wh: 10000, cost_decimal: 4 }),
      session({ id: 2, started_at: 'also-bad', ended_at: null, start_place: 'Home', total_energy_added_wh: 10000, cost_decimal: 4 }),
    ];
    installRequest({ sessions: badDates });
    renderPage();

    // The insights panel still mounts (hasData is true) but the busiest slot is
    // empty → the favorite value degrades to '—' instead of crashing.
    const favorite = await screen.findByText('Favorite Charging Time');
    expect(within(favorite.parentElement!).getByText('—')).toBeInTheDocument();
    expect(screen.getByText('0 sessions')).toBeInTheDocument();
    // KPIs still count the sessions and sum their (date-independent) energy.
    expect(kpiValue('Total Sessions')).toBe('2');
    expect(kpiValue('Total Energy')).toMatch(/^20(?:\.0+)?\s*kWh$/);
  });
});
