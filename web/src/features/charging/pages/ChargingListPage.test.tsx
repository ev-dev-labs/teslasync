/**
 * ChargingListPage contract + hardening tests.
 *
 * ChargingListPage is a data-dense list shell: it reads a wide window of
 * charging sessions (`useChargingSessionsPaginated`) plus an optimizer feed
 * (`useChargingOptimizer`), then derives period stats, anomaly flags, notable
 * sessions, collection counts, a daily trend, and a paginated + date-grouped
 * list from them. The four data hooks and `useSelectedVehicle` are mocked at
 * the hook boundary so every branch — no-vehicle, loading, error, empty, and
 * the fully-populated happy path — is exercised deterministically. The heavy
 * chart/panel children and each `ChargingSessionCard` render for real. The
 * assertions target the shared stats, semantic chart/grid surfaces, threshold
 * gating, bulk-selection wiring, and the SI→display distance conversion.
 *
 * The display hooks (`useUnits`/`useFormatting` → `useSettings`) render for real
 * with a mutable unit preference so the SI→display distance conversion at the
 * render boundary is exercised for BOTH metric (km) and imperial (mi). The
 * `toDistanceDisplay` callback captured off a card carries a regression guard
 * for the SI boundary: it accepts canonical metres directly, so a 50 km charge
 * reads "50 km" / "31 mi" without a compensating unit round trip.
 *
 * Network never touches the real backend — the charging hooks are stubbed and
 * `@/api/client`'s `request` seam is neutralised so no stray query (VehicleSelect,
 * SavedViewMenu) can fire.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options object so assertions can target the rendered English copy. A bare
// key with no fallback echoes the key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallbackOrOpts.replace(/{{(\w+)}}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          );
        }
        return fallbackOrOpts;
      }
      if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
        const o = fallbackOrOpts as Record<string, unknown>;
        if (typeof o.defaultValue === 'string') return o.defaultValue;
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Mutable unit preference so one file exercises both the metric (km) and
// imperial (mi) display-conversion branches. Hoisted so the settings mock
// factory can close over it.
const unitState = vi.hoisted(() => ({ length: 'km' as 'km' | 'mi' }));
const timeDisplayState = vi.hoisted(() => ({ locale: 'en-US', timezone: '' }));
const mediaState = vi.hoisted(() => ({ desktop: false }));
const chartPreference = vi.hoisted(() => ({ palette: 'cb_safe' as 'cb_safe' | 'neon' }));

vi.mock('@/hooks/useChartPalette', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useChartPalette')>();
  return { ...actual, useChartPalette: () => actual.resolveChartPalette(chartPreference.palette) };
});

vi.mock('@/hooks/useMediaQuery', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useMediaQuery')>();
  return {
    ...actual,
    useMediaQuery: (query: string) => query === '(min-width: 1024px)'
      ? mediaState.desktop : actual.useMediaQuery(query),
  };
});

// File-level useSettings mock (overrides the global test-setup stub) so
// `useUnits`/`useFormatting` see a stable shape while `unit_of_length` flips.
vi.mock('@/hooks/useSettings', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSettings')>();
  const defaults = {
    unit_of_length: 'km' as const,
    unit_of_temp: 'C' as const,
    unit_of_pressure: 'bar' as const,
    preferred_range: 'rated' as const,
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark' as const,
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 0,
    gas_unit: 'gallon' as const,
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant' as const,
    currency_symbol: '$',
    locale: 'en-US',
    tz_display_default: 'vehicle' as const,
    timezone_user: '',
    tab_badge_enabled: true,
    critical_flash_enabled: true,
    ui_density: 'comfortable' as const,
    time_format_default: 'relative' as const,
    chart_palette: 'cb_safe' as const,
    ai_mode: 'off' as const,
    ai_features: {},
    ai_provider_config: {},
    ai_cost_cap_cents: 0,
  };
  return {
    ...actual,
    useSettings: () => ({
      settings: {
        ...defaults, unit_of_length: unitState.length,
        locale: timeDisplayState.locale, timezone_user: timeDisplayState.timezone,
      },
      isMiles: unitState.length === 'mi',
      isFahrenheit: false,
      isPSI: false,
      decimals: 2,
      locale: timeDisplayState.locale,
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  };
});

// Network kill-switch: neutralise the shared fetch seam so any peripheral query
// (VehicleSelect's fleet list, SavedViewMenu's saved views) stays benignly
// pending instead of hitting the real backend. `isApiError` etc. stay real.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn(() => new Promise(() => {})) };
});

// The three charging data hooks are replaced with controllable vi.fns.
vi.mock('@/api/hooks/useCharging', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useCharging')>();
  return {
    ...actual,
    useChargingSessionsPaginated: vi.fn(),
    useChargingOptimizer: vi.fn(),
    useBulkDeleteCharging: vi.fn(),
  };
});

vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicleState: vi.fn() };
});

vi.mock('@/hooks/useSelectedVehicle', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});

// Observe the page-owned conversion callback while rendering the real card.
const captured = vi.hoisted(() => ({
  toDistanceDisplay: null as null | ((meters: number) => number),
  distanceUnit: '' as string,
  trendMetrics: [] as Array<{ key: string; color?: string }>,
}));

vi.mock('@/components/charts', async (importActual) => {
  const actual = await importActual<typeof import('@/components/charts')>();
  return {
    ...actual,
    MetricSwitcherChart: (props: ComponentProps<typeof actual.MetricSwitcherChart>) => {
      captured.trendMetrics = props.metrics.map(({ key, color }) => ({ key, color }));
      return <actual.MetricSwitcherChart {...props} />;
    },
  };
});

vi.mock('../components/ChargingSessionCard', async (importActual) => {
  const actual = await importActual<typeof import('../components/ChargingSessionCard')>();
  return {
    ...actual,
    ChargingSessionCard: (props: ComponentProps<typeof actual.ChargingSessionCard>) => {
      captured.toDistanceDisplay = props.toDistanceDisplay;
      captured.distanceUnit = props.distanceUnit;
      return <actual.ChargingSessionCard {...props} />;
    },
  };
});

// Exercise the real sticky summary after its overview anchor scrolls above view.
class ChargingIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds = [0];
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    const scrolled = target.id === 'charging-overview';
    const rect = target.getBoundingClientRect();
    this.callback([{
      target, time: 0, rootBounds: null,
      isIntersecting: !scrolled, intersectionRatio: scrolled ? 0 : 1,
      boundingClientRect: scrolled ? new DOMRect(0, -100, 100, 92) : rect,
      intersectionRect: rect,
    }], this);
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import { ToastProvider } from '@/components/feedback/Toast';
import ChargingListPage, { formatHour } from './ChargingListPage';
import { useChargingSessionsPaginated, useChargingOptimizer, useBulkDeleteCharging } from '@/api/hooks/useCharging';
import { useVehicleState } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import type { ChargingSession, VehicleState } from '@/api/types';
import type { ChargingOptimizerData } from '@/types/charging';

const mockSessions = vi.mocked(useChargingSessionsPaginated);
const mockOptimizer = vi.mocked(useChargingOptimizer);
const mockBulkDelete = vi.mocked(useBulkDeleteCharging);
const mockVehicleState = vi.mocked(useVehicleState);
const mockSelectedVehicle = vi.mocked(useSelectedVehicle);

const OPTIMIZER: ChargingOptimizerData = {
  current_schedule: {
    most_common_start_hour: 0,
    most_common_day: '',
    avg_sessions_per_week: 0,
    home_charging_pct: 0,
    avg_charge_to_pct: 0,
  },
  cost_analysis: {
    peak_hours: [],
    offpeak_hours: [],
    peak_cost_per_kwh: 0,
    offpeak_cost_per_kwh: 0,
    sessions_during_peak_pct: 0,
    potential_monthly_savings: 0,
  },
  battery_health_score: 0,
  recommendations: [],
  weekly_heatmap: [],
};

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isError: false,
    isStale: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeSession(over: Partial<ChargingSession> = {}): ChargingSession {
  const started = over.started_at ?? '2024-06-15T10:00:00Z';
  return {
    id: 1,
    vehicle_id: 1,
    started_at: started,
    ended_at: '2024-06-15T11:00:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: 100_000,
    end_odometer_m: 150_000,
    start_lat: 37.5,
    start_lng: -122.4,
    start_place: 'Home',
    total_energy_added_wh: 30_000,
    peak_power_w: 11_000,
    avg_power_w: 6_000,
    cost_decimal: 4.5,
    cost_currency: 'USD',
    charger_type: 'Home',
    cable_type: 'Type2',
    startedAt: started,
    duration_min: 60,
    ...over,
  };
}

// Six hand-crafted sessions with known categories (home×2, supercharger×2,
// dc×2), one free-to-charge home session, and one telemetry-gap anomaly (0 kWh
// over an hour). Wide date span so any "now" passes the date filter with the
// 2000→2100 URL window.
const SESSIONS: ChargingSession[] = [
  makeSession({ id: 1, charger_type: 'Home', total_energy_added_wh: 30_000, cost_decimal: 4.5, start_soc_pct: 20, end_soc_pct: 80, peak_power_w: 11_000, avg_power_w: 6_000, started_at: '2024-06-15T06:00:00Z', ended_at: '2024-06-15T11:00:00Z', start_place: 'Home Garage', cable_type: 'Type2' }),
  makeSession({ id: 2, charger_type: 'Supercharger', total_energy_added_wh: 40_000, cost_decimal: 15, start_soc_pct: 10, end_soc_pct: 70, peak_power_w: 150_000, avg_power_w: 80_000, started_at: '2024-06-14T12:00:00Z', ended_at: '2024-06-14T12:30:00Z', start_place: 'SC Downtown', cable_type: 'Tesla' }),
  makeSession({ id: 3, charger_type: 'CCS', total_energy_added_wh: 25_000, cost_decimal: 8, start_soc_pct: 30, end_soc_pct: 75, peak_power_w: 50_000, avg_power_w: 33_000, started_at: '2024-06-13T09:00:00Z', ended_at: '2024-06-13T09:45:00Z', start_place: 'EVgo', cable_type: 'CCS' }),
  makeSession({ id: 4, charger_type: 'Home', total_energy_added_wh: 20_000, cost_decimal: 0, start_soc_pct: 40, end_soc_pct: 85, peak_power_w: 7_000, avg_power_w: 6_500, started_at: '2024-06-12T22:00:00Z', ended_at: '2024-06-13T02:00:00Z', start_place: 'Home Garage', cable_type: 'Type2' }),
  makeSession({ id: 5, charger_type: 'Supercharger', total_energy_added_wh: 35_000, cost_decimal: 12, start_soc_pct: 15, end_soc_pct: 65, peak_power_w: 120_000, avg_power_w: 70_000, started_at: '2024-06-11T13:00:00Z', ended_at: '2024-06-11T13:40:00Z', start_place: 'SC Mall', cable_type: 'Tesla' }),
  makeSession({ id: 6, charger_type: 'CCS', total_energy_added_wh: 0, cost_decimal: 0, start_soc_pct: 50, end_soc_pct: 50, peak_power_w: null, avg_power_w: null, started_at: '2024-06-10T10:00:00Z', ended_at: '2024-06-10T11:00:00Z', start_place: 'Broken Charger', cable_type: null, end_odometer_m: 100_000 }),
];

const LIVE_STATE: VehicleState = {
  vehicle_id: 1,
  state: 'online',
  latitude: 0,
  longitude: 0,
  heading: null,
  speed: 0,
  power: 0,
  battery_level: 64,
  rated_range: 320_000,
  ideal_range: 0,
  odometer: 100_000,
  inside_temp: 21,
  outside_temp: 18,
  is_climate_on: false,
  is_charging: true,
  charger_power: 11,
  charge_rate: 0,
  time_to_full_charge: 1.5,
  is_locked: true,
  sentry_mode: false,
  software_version: '2026.8.3',
};

function installHappyPath() {
  mockSelectedVehicle.mockReturnValue({
    vehicleId: 1,
    vehicle: null,
    vehicles: [{ id: 1, display_name: 'Model 3', vin: 'VIN1' }] as any,
    setVehicleId: vi.fn(),
  });
  mockSessions.mockReturnValue(qr({ data: SESSIONS }));
  mockVehicleState.mockReturnValue(qr({ data: {
    state: LIVE_STATE, live: true, freshness: 'fresh', observedAt: Date.now(),
    verifiedFields: ['is_charging', 'battery_level', 'time_to_full_charge'],
  } }));
  // No optimizer response is available in this list fixture. An empty object
  // is not a ChargingOptimizerData payload and crashes once count reaches 10.
  mockOptimizer.mockReturnValue(qr());
  mockBulkDelete.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  } as any);
}

let navigatePage: ReturnType<typeof useNavigate>;

function PaginationLocationProbe() {
  navigatePage = useNavigate();
  return <output data-testid="pagination-location">{useLocation().search}</output>;
}

function renderPage(entries: string[] = ['/charging?from=2000-01-01&to=2100-01-01']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const content = () => (
    <MemoryRouter initialEntries={entries}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ChargingListPage />
          <PaginationLocationProbe />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const result = render(content());
  return { ...result, refresh: () => result.rerender(content()) };
}

function paginationForLoadedTotal(total: number) {
  const nav = screen.getAllByRole('navigation', { name: 'Pagination' })
    .find(candidate => candidate.textContent?.includes(`of ${total}`));
  if (!nav) throw new Error(`Missing pagination for ${total} loaded sessions`);
  return within(nav);
}

function briefMetric(label: string): HTMLElement {
  const metric = within(screen.getByTestId('charging-operational-brief'))
    .getByText(label)
    .closest('[role="listitem"]');
  if (!metric) throw new Error(`No operational metric found for "${label}"`);
  return metric as HTMLElement;
}

function sessionCard(id: number) {
  const link = Array.from(document.querySelectorAll<HTMLAnchorElement>(`a[href="/charging/${id}"]`))
    .find((candidate) => candidate.closest('table') == null);
  return link?.parentElement ?? null;
}

async function findSessionCard(id: number) {
  return waitFor(() => {
    const card = sessionCard(id);
    if (!card) throw new Error(`No charging session row for ${id}`);
    return card;
  });
}

function sessionCheckbox(id: number) {
  const card = sessionCard(id);
  if (!card) throw new Error(`No charging session row for ${id}`);
  return within(card).getByRole('checkbox', { name: 'Select charging session' });
}

function trendChart() {
  return screen.queryByRole('region', { name: 'Charging over time' })?.querySelector('figure') ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IntersectionObserver', ChargingIntersectionObserver);
  localStorage.clear();
  mediaState.desktop = false;
  unitState.length = 'km';
  timeDisplayState.locale = 'en-US';
  timeDisplayState.timezone = '';
  chartPreference.palette = 'cb_safe';
  captured.toDistanceDisplay = null;
  captured.distanceUnit = '';
  installHappyPath();
});

afterEach(() => vi.unstubAllGlobals());

/* ─────────────────────────── Pure helper unit tests ─────────────────────── */

describe('formatHour', () => {
  it('formats the midnight and noon boundaries with the shared clock formatter', () => {
    expect(formatHour(0)).toBe('12:00 AM');
    expect(formatHour(12)).toBe('12:00 PM');
  });

  it('formats morning hours as AM and afternoon/evening hours as 12-hour PM', () => {
    expect(formatHour(1)).toBe('01:00 AM');
    expect(formatHour(9)).toBe('09:00 AM');
    expect(formatHour(13)).toBe('01:00 PM');
    expect(formatHour(15)).toBe('03:00 PM');
    expect(formatHour(23)).toBe('11:00 PM');
  });

  it('preserves all source hour identities across locale and hour-cycle preferences', () => {
    for (let hour = 0; hour < 24; hour++) {
      const expected = `${String(hour).padStart(2, '0')}:00`;
      expect(formatHour(hour, 'en-GB')).toBe(expected);
      expect(formatHour(hour, 'en-US-u-hc-h23')).toBe(expected);
    }
    expect(formatHour(13, 'en-GB-u-hc-h12')).toBe('01:00 pm');
    expect(formatHour(13, 'ar-EG')).toBe('٠١:٠٠ م');
  });

  it.each([NaN, Infinity, -1, 24, 1.5])('does not invent an hour for invalid bucket %s', hour => {
    expect(formatHour(hour)).toBe('—');
  });
});

/* ─────────────────────────────── Component tests ─────────────────────────── */

describe('ChargingListPage — prior-period evidence', () => {
  it.each([false, true])(
    'keeps comparison unavailable for the current-range query (out-of-range rows: %s)',
    async (includePriorRows) => {
      const current = makeSession({
        id: 101,
        started_at: '2024-06-15T10:00:00Z',
        ended_at: '2024-06-15T11:00:00Z',
      });
      const prior = makeSession({
        id: 102,
        started_at: '2024-06-14T10:00:00Z',
        ended_at: '2024-06-14T11:00:00Z',
      });
      mockSessions.mockReturnValue(qr({ data: includePriorRows ? [current, prior] : [current] }));

      renderPage(['/charging?from=2024-06-15&to=2024-06-15']);

      const overview = await screen.findByTestId('charging-overview');
      expect(within(overview).getByText(/^Prior-period comparison unavailable:/)).toHaveTextContent(
        '2024',
      );
      expect(within(overview).queryByText(/^prior period:/)).not.toBeInTheDocument();
      expect(await findSessionCard(101)).toBeInTheDocument();
      expect(sessionCard(102)).toBeNull();
      expect(mockSessions).toHaveBeenCalledWith(1, expect.objectContaining({
        limit: 500,
        offset: 0,
        start: expect.any(String),
        end: expect.any(String),
      }));
    },
  );
});

describe('ChargingListPage — preferred clock labels', () => {
  it('updates the populated overview label without changing the source sessions', async () => {
    timeDisplayState.timezone = 'Pacific/Honolulu';
    mockSessions.mockReturnValue(qr({ data: [
      makeSession({ started_at: '2024-06-15T13:00:00Z', ended_at: '2024-06-15T14:00:00Z' }),
    ] }));
    const page = renderPage();
    const originalLabel = await screen.findByText(/^Most common start:/);
    expect(originalLabel).toHaveTextContent('Most common start: 03:00 AM');
    timeDisplayState.locale = 'en-US-u-hc-h23';
    page.refresh();
    expect(screen.getByText(/^Most common start:/)).toHaveTextContent('Most common start: 03:00');
    expect(await findSessionCard(1)).toBeInTheDocument();
    expect(mockSessions.mock.calls.at(-1)?.[0]).toBe(1);
  });
});

describe('ChargingListPage — responsive evidence adoption', () => {
  it('renders the real desktop evidence table before charging insights without duplicating session cards', async () => {
    mediaState.desktop = true;
    renderPage();
    const table = await screen.findByRole('table', { name: 'All charging sessions' });
    const insights = screen.getByRole('region', { name: 'Charging insights' });
    expect(table.compareDocumentPosition(insights) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(table.compareDocumentPosition(screen.getByTestId('charging-operational-brief')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sessionCard(1)).not.toBeInTheDocument();
    expect(table.querySelector('a[href="/charging/1"]')).toBeInTheDocument();
    expect(captured.toDistanceDisplay).toBeNull();
    expect(table.querySelector('th[data-column-key="energy"]')).toBeInTheDocument();
    expect(table.querySelector('th[data-column-key="batteryEnd"]')).toBeInTheDocument();
    expect(screen.getByTestId('charging-export')).toBeInTheDocument();

    // This overview derives from the capped session query, not a full-range aggregate.
    const overview = screen.getByTestId('charging-overview');
    fireEvent.click(within(overview).getByRole('button', { name: 'Review details' }));
    const details = await screen.findByRole('dialog', { name: 'Overview details' });
    const narrative = within(details).getByRole('region', { name: 'Decision narrative' });
    const limitations = within(narrative).getByText('Limitations').parentElement;
    if (!limitations) throw new Error('Overview limitations disclosure is missing');
    const scope = 'Search, collections, and exports cover up to 500 loaded sessions in this range.';
    expect(within(limitations).getAllByText(scope)).toHaveLength(1);
    const calculation = within(narrative).getByRole('region', { name: 'How this was calculated' });
    const source = within(calculation).getByText('Data sources').closest('div');
    if (!source) throw new Error('Overview calculation source is missing');
    expect(within(source).getAllByText(scope)).toHaveLength(1);
  });

  it('keeps the grid and reset action available when desktop search matches no sessions', async () => {
    mediaState.desktop = true;
    renderPage(['/charging?from=2000-01-01&to=2100-01-01&q=nonexistent-charge-location']);
    expect(await screen.findByRole('table', { name: 'All charging sessions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();
  });

  it.each([false, true])('distinguishes filtered no-match and clears the search on reset (desktop=%s)', async (desktop) => {
    mediaState.desktop = desktop;
    renderPage(['/charging?from=2000-01-01&to=2100-01-01&q=nonexistent-charge-location']);
    const list = screen.getByRole('region', { name: 'All charging sessions' });
    expect((await within(list).findAllByText('No charging sessions in this view')).length).toBeGreaterThan(0);
    expect(within(list).getByText('Try switching to a different collection or clearing your filters.')).toBeInTheDocument();
    expect(within(list).queryByText('No charging sessions yet')).not.toBeInTheDocument();
    expect(within(list).queryByText('Charging data will appear here once your vehicle records sessions.')).not.toBeInTheDocument();

    fireEvent.click(within(list).getByRole('button', { name: 'Reset filters' }));
    await waitFor(() => {
      expect(new URLSearchParams(screen.getByTestId('pagination-location').textContent ?? '').get('q')).toBeNull();
    });
  });

  it.each([
    'coll=tagged',
    `grid_values=${encodeURIComponent(JSON.stringify({ cost: ['999'] }))}`,
  ])('uses filtered no-match copy for %s', async (filter) => {
    renderPage([`/charging?from=2000-01-01&to=2100-01-01&${filter}`]);
    const list = screen.getByRole('region', { name: 'All charging sessions' });
    expect((await within(list).findAllByText('No charging sessions in this view')).length).toBeGreaterThan(0);
    expect(within(list).queryByText('No charging sessions yet')).not.toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();
  });

  it('does not describe unknown battery state as zero-percent departure readiness', () => {
    mockVehicleState.mockReturnValue(qr({ data: { state: { ...LIVE_STATE, battery_level: null } } }));
    renderPage();
    const readiness = briefMetric('Departure readiness');
    expect(within(readiness).getByText('—')).toBeInTheDocument();
    expect(within(readiness).queryByText('0%')).not.toBeInTheDocument();
  });

  it('excludes unknown-cost sessions from the free collection', async () => {
    mockSessions.mockReturnValue(qr({
      data: [
        makeSession({ id: 10, cost_decimal: null }),
        makeSession({ id: 11, cost_decimal: 0 }),
      ],
    }));
    renderPage(['/charging?from=2000-01-01&to=2100-01-01&coll=free']);
    expect(await findSessionCard(11)).toBeInTheDocument();
    expect(sessionCard(10)).not.toBeInTheDocument();
  });

  it('does not describe unknown charging posture as not charging', () => {
    mockVehicleState.mockReturnValue(qr({ data: { state: { ...LIVE_STATE, is_charging: null } } }));
    renderPage();
    const posture = briefMetric('Current posture');
    expect(within(posture).getByText('Unavailable')).toBeInTheDocument();
    expect(within(posture).queryByText('Not charging')).not.toBeInTheDocument();
  });

  it('filters the entire loaded window from column headers before pagination', async () => {
    mediaState.desktop = true;
    mockSessions.mockReturnValue(qr({
      data: Array.from({ length: 63 }, (_, index) => makeSession({
        id: index + 1, start_place: index === 0 ? 'Remote charger' : 'Home',
        started_at: new Date(Date.UTC(2024, 5, 15, 8, index)).toISOString(),
      })),
    }));
    renderPage();
    const table = await screen.findByRole('table', { name: 'All charging sessions' });
    const frame = table.closest<HTMLElement>('[data-grid-frame]');
    const footer = frame?.querySelector<HTMLElement>('[data-grid-footer]');
    if (!frame || !footer) throw new Error('Charging session evidence grid frame or footer is missing');
    expect(footer).toBeInTheDocument();
    expect(frame?.querySelector('[data-grid-viewport]')?.contains(footer ?? null)).toBe(false);
    expect(within(frame).getByRole('button', { name: 'Next page' }))
      .toBe(within(footer).getByRole('button', { name: 'Next page' }));
    expect(table.querySelector('a[href="/charging/1"]')).not.toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'Charge location filter' }));
    const filter = await screen.findByRole('dialog', { name: 'Charge location filter' });
    expect(within(filter).getByRole('checkbox', { name: 'Remote charger' })).toBeInTheDocument();
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Home' }));
    fireEvent.click(within(filter).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(table.querySelector('a[href="/charging/1"]')).toBeInTheDocument());
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(within(table).getByRole('button', { name: 'Charge location filter' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps unknown-cost filters distinct from free and offers recovery on mobile', async () => {
    mockSessions.mockReturnValue(qr({ data: [
      makeSession({ id: 10, cost_decimal: null }),
      makeSession({ id: 11, cost_decimal: 0 }),
    ] }));
    const values = encodeURIComponent(JSON.stringify({ cost: ['null'] }));
    renderPage([`/charging?from=2000-01-01&to=2100-01-01&grid_values=${values}`]);
    expect(await findSessionCard(10)).toBeInTheDocument();
    expect(sessionCard(11)).not.toBeInTheDocument();
    expect(screen.getByText(/Column value filters are active/)).toBeInTheDocument();
  });

  it('reports invalid saved value filters explicitly and resets them', async () => {
    mediaState.desktop = true;
    renderPage(['/charging?from=2000-01-01&to=2100-01-01&grid_values=broken']);
    expect(await screen.findByText('This saved value filter is invalid. Clear it to reset.')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'All charging sessions' }).querySelector('a[href^="/charging/"]')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /This saved value filter is invalid/ }));
    await waitFor(() => expect(screen.queryByText('This saved value filter is invalid. Clear it to reset.')).not.toBeInTheDocument());
    expect(screen.getByRole('table', { name: 'All charging sessions' }).querySelectorAll('tbody tr')).toHaveLength(SESSIONS.length);
  });
});

describe('ChargingListPage — numeric search measurements', () => {
  it.each(['cost:unknown', 'power:unknown', 'dur:unknown'])('preserves literal fallback for %s', async (query) => {
    mockSessions.mockReturnValue(qr({ data: [
      makeSession({ id: 1, start_place: query, cost_decimal: null, peak_power_w: null, ended_at: null }),
      makeSession({ id: 2 }),
    ] }));
    renderPage([`/charging?from=2000-01-01&to=2100-01-01&q=${encodeURIComponent(query)}`]);
    expect(await findSessionCard(1)).toBeInTheDocument();
    expect(sessionCard(2)).not.toBeInTheDocument();
  });

  it.each([
    ['cost:=0', [6]],
    ['cost:<1', [6, 7, 8]],
    ['cost:=-1.25', [7]],
    ['cost:>=0.5', [8]],
    ['power:=0', [6]],
    ['power:<1', [6, 7, 8]],
    ['power:=-1.25', [7]],
    ['power:>=0.5', [8]],
    ['free', [6]],
    ['charger:home at:home kwh:>=30', [1, 2, 3, 4, 5, 6, 7, 8]],
  ] as const)('filters %s using only known finite measurements', async (query, expectedIds) => {
    mediaState.desktop = true;
    mockSessions.mockReturnValue(qr({ data: [
      makeSession({ id: 1, cost_decimal: null, peak_power_w: null }),
      makeSession({ id: 2, cost_decimal: undefined, peak_power_w: undefined }),
      makeSession({ id: 3, cost_decimal: Number.NaN, peak_power_w: Number.NaN }),
      makeSession({ id: 4, cost_decimal: Infinity, peak_power_w: Infinity }),
      makeSession({ id: 5, cost_decimal: -Infinity, peak_power_w: -Infinity }),
      makeSession({ id: 6, cost_decimal: 0, peak_power_w: 0 }),
      makeSession({ id: 7, cost_decimal: -1.25, peak_power_w: -1_250 }),
      makeSession({ id: 8, cost_decimal: 0.5, peak_power_w: 500 }),
    ] }));
    renderPage([`/charging?from=2000-01-01&to=2100-01-01&q=${encodeURIComponent(query)}`]);
    const table = await screen.findByRole('table', { name: 'All charging sessions' });
    await waitFor(() => {
      const links = table.querySelectorAll<HTMLAnchorElement>('a[href^="/charging/"]');
      expect(Array.from(links, (link) => Number(link.getAttribute('href')?.split('/').at(-1))).sort((a, b) => a - b))
        .toEqual(expectedIds);
    });
  });

  it.each([
    ['dur:=0', []],
    ['dur:<1m', [8]],
    ['dur:=30s', [8]],
    ['dur:>=1m', [9]],
    ['dur:<0', []],
  ] as const)('filters %s only with usable completed timestamps', async (query, expectedIds) => {
    mediaState.desktop = true;
    mockSessions.mockReturnValue(qr({ data: [
      makeSession({ id: 1, ended_at: null }),
      makeSession({ id: 2, ended_at: undefined }),
      makeSession({ id: 3, started_at: '' }),
      makeSession({ id: 4, started_at: 'invalid' }),
      makeSession({ id: 5, ended_at: 'invalid' }),
      makeSession({ id: 6, ended_at: '2024-06-15T10:00:00Z' }),
      makeSession({ id: 7, ended_at: '2024-06-15T09:59:00Z' }),
      makeSession({ id: 8, ended_at: '2024-06-15T10:00:30Z' }),
      makeSession({ id: 9, ended_at: '2024-06-15T10:01:00Z' }),
    ] }));
    renderPage([`/charging?from=2000-01-01&to=2100-01-01&q=${encodeURIComponent(query)}`]);
    const table = await screen.findByRole('table', { name: 'All charging sessions' });
    await waitFor(() => {
      const links = table.querySelectorAll<HTMLAnchorElement>('a[href^="/charging/"]');
      expect(Array.from(links, (link) => Number(link.getAttribute('href')?.split('/').at(-1))).sort((a, b) => a - b))
        .toEqual(expectedIds);
    });
  });
});

describe('ChargingListPage — date window', () => {
  it('fetches sessions with vehicle-timezone RFC3339 instants, not UTC date-only days', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Charging sessions' });
    expect(mockSessions).toHaveBeenCalled();
    const opts = mockSessions.mock.calls.at(-1)?.[1] as {
      start?: string;
      end?: string;
    };
    expect(opts.start).toMatch(/T/);
    expect(opts.end).toMatch(/T/);
    expect(opts.start).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(opts.end).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('ChargingListPage — pagination', () => {
  const baseUrl = '/charging?from=2000-01-01&to=2100-01-01';
  const urlParams = () => new URLSearchParams(screen.getByTestId('pagination-location').textContent ?? '');

  it.each([false, true])('keeps a valid populated deep link in sync with pagination (desktop=%s)', async (desktop) => {
    mediaState.desktop = desktop;
    renderPage([`${baseUrl}&size=2&page=2`]);
    await screen.findAllByRole('navigation', { name: 'Pagination' });
    const pagination = paginationForLoadedTotal(6);
    expect(pagination.getByText(/Showing 3.4 of 6/)).toBeInTheDocument();
    expect(pagination.getByRole('button', { name: 'Page 2 of 3' })).toHaveAttribute('aria-current', 'page');
    expect(document.querySelector('a[href="/charging/3"]')).toBeInTheDocument();
    expect(document.querySelector('a[href="/charging/4"]')).toBeInTheDocument();
    expect(document.querySelector('a[href="/charging/1"]')).not.toBeInTheDocument();
    expect(urlParams().get('page')).toBe('2');
  });

  it.each([
    ['0', '0', 1, 50],
    ['-2', '-3', 1, 50],
    ['1.9', '2.5', 1, 50],
    ['999', '2', 3, 2],
    ['2.9', '2', 2, 2],
  ])('normalizes page=%s and size=%s before slicing', async (requestedPage, size, page, pageSize) => {
    renderPage([`${baseUrl}&page=${requestedPage}&size=${size}`]);
    await screen.findAllByRole('navigation', { name: 'Pagination' });
    const pagination = paginationForLoadedTotal(6);
    expect(pagination.getByRole('button', { name: `Page ${page} of ${Math.ceil(6 / pageSize)}` }))
      .toHaveAttribute('aria-current', 'page');
    expect(document.querySelector(`a[href="/charging/${(page - 1) * pageSize + 1}"]`)).toBeInTheDocument();
    await waitFor(() => {
      expect(urlParams().get('page')).toBe(page === 1 ? null : String(page));
      expect(urlParams().get('size')).toBe(pageSize === 50 ? null : String(pageSize));
    });
    expect(screen.queryByText('No charging sessions yet')).not.toBeInTheDocument();
    expect(screen.queryByText('No charging sessions in this view')).not.toBeInTheDocument();
  });

  it('preserves a requested page while loading and clamps only after results arrive', async () => {
    mockSessions.mockReturnValue(qr({ isLoading: true }));
    const view = renderPage([`${baseUrl}&page=3&size=2`]);
    expect(urlParams().get('page')).toBe('3');
    mockSessions.mockReturnValue(qr({ data: SESSIONS.slice(0, 3) }));
    view.refresh();
    expect(await findSessionCard(3)).toBeInTheDocument();
    await waitFor(() => expect(urlParams().get('page')).toBe('2'));
  });

  it.each(['vehicle', 'range', 'search', 'collection', 'values', 'size'])('resets pagination when %s scope changes', async (scope) => {
    const view = renderPage([`${baseUrl}&page=3&size=2`]);
    expect(await findSessionCard(5)).toBeInTheDocument();
    if (scope === 'vehicle') {
      mockSelectedVehicle.mockReturnValue({ ...mockSelectedVehicle(), vehicleId: 2 });
      view.refresh();
    } else {
      const params = new URLSearchParams(urlParams());
      if (scope === 'range') params.set('from', '2024-06-11');
      if (scope === 'search') params.set('q', 'charger:home');
      if (scope === 'collection') params.set('coll', 'home');
      if (scope === 'values') params.set('grid_values', JSON.stringify({ cost: ['null'] }));
      if (scope === 'size') params.set('size', '3');
      // Change the URL without the page's filter handlers to cover restored/external scope changes.
      act(() => navigatePage(`/charging?${params}`));
    }
    await waitFor(() => expect(urlParams().get('page')).toBeNull());
    if (scope !== 'values') {
      expect(document.querySelector('a[href="/charging/1"]')).toBeInTheDocument();
    }
  });

  it('clamps shrinking membership but preserves the page on same-membership refreshes', async () => {
    const view = renderPage([`${baseUrl}&page=3&size=2`]);
    expect(await findSessionCard(5)).toBeInTheDocument();
    mockSessions.mockReturnValue(qr({ data: SESSIONS.map((session) => ({ ...session, cost_decimal: 7 })) }));
    view.refresh();
    expect(sessionCard(5)).toBeInTheDocument();
    expect(urlParams().get('page')).toBe('3');
    mockSessions.mockReturnValue(qr({ data: SESSIONS.slice(0, 3) }));
    view.refresh();
    expect(await findSessionCard(3)).toBeInTheDocument();
    await waitFor(() => expect(urlParams().get('page')).toBe('2'));
    mockSessions.mockReturnValue(qr({ data: [] }));
    view.refresh();
    await waitFor(() => expect(urlParams().get('page')).toBeNull());
    expect(screen.getByText('No charging sessions yet')).toBeInTheDocument();
  });
});

describe('ChargingListPage — independent optimizer state', () => {
  const region = () => screen.getByRole('region', { name: 'Cost optimizer & heatmap' });

  it('shows active loading without claiming a successful empty result', () => {
    mockOptimizer.mockReturnValue(qr({
      isPending: true, isLoading: true, isFetching: true, fetchStatus: 'fetching',
    }));
    renderPage();
    expect(within(region()).getByRole('status', { name: 'Cost optimizer & heatmap' })).toHaveAttribute('aria-busy', 'true');
    expect(within(region()).queryByText('Recommendations will appear after more charging sessions.')).toBeNull();
    expect(within(region()).getByText(/Independent optimizer source/)).toBeInTheDocument();
  });

  it('shows paused-without-data as unavailable with an optimizer-only retry', () => {
    const retry = vi.fn();
    mockOptimizer.mockReturnValue(qr({
      isPending: true, fetchStatus: 'paused', refetch: retry,
    }));
    renderPage();
    expect(within(region()).queryByRole('status', { name: 'Cost optimizer & heatmap' })).toBeNull();
    expect(within(region()).getByText('Service unavailable')).toBeInTheDocument();
    fireEvent.click(within(region()).getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(mockSessions.mock.results[0].value.refetch).not.toHaveBeenCalled();
  });

  it('renders successful empty arrays and zero metrics independently of empty list history', () => {
    mockSessions.mockReturnValue(qr({ data: [] }));
    mockOptimizer.mockReturnValue(qr({ data: OPTIMIZER }));
    renderPage();
    expect(within(region()).getByRole('heading', { name: 'Charging Habits' })).toBeInTheDocument();
    expect(within(region()).getByText('Recommendations will appear after more charging sessions.')).toBeInTheDocument();
    expect(within(region()).getByRole('meter', { name: 'Battery-Friendly Score' })).toHaveAttribute('aria-valuenow', '0');
    expect(within(region()).queryByText('Service unavailable')).toBeNull();
    expect(mockOptimizer).toHaveBeenCalledWith('1');
    expect(OPTIMIZER.weekly_heatmap).toEqual([]);
  });

  it('retains payload on failed refresh, retries only the optimizer, and recovers', () => {
    const retry = vi.fn();
    mockOptimizer.mockReturnValue(qr({
      data: OPTIMIZER, error: new Error('Optimizer refresh failed'), isError: true, refetch: retry,
    }));
    const page = renderPage();
    expect(within(region()).getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(within(region()).getByRole('heading', { name: 'Charging Habits' })).toBeInTheDocument();
    fireEvent.click(within(region()).getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(mockSessions.mock.results[0].value.refetch).not.toHaveBeenCalled();

    mockOptimizer.mockReturnValue(qr({ data: OPTIMIZER, isFetching: true, refetch: retry }));
    page.refresh();
    expect(within(region()).getByRole('heading', { name: 'Charging Habits' })).toBeInTheDocument();
    mockOptimizer.mockReturnValue(qr({ data: OPTIMIZER, refetch: retry }));
    page.refresh();
    expect(within(region()).queryByTestId('stale-refresh-warning')).toBeNull();
    expect(within(region()).getByRole('meter', { name: 'Battery-Friendly Score' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('keeps optimizer success visible when list history fails', () => {
    mockSessions.mockReturnValue(qr({ error: new Error('History failed'), isError: true }));
    mockOptimizer.mockReturnValue(qr({ data: OPTIMIZER }));
    renderPage();
    expect(within(region()).getByRole('heading', { name: 'Charging Habits' })).toBeInTheDocument();
  });

  it('retries an initial optimizer failure without replacing the list', () => {
    const retry = vi.fn();
    mockOptimizer.mockReturnValue(qr({ error: new Error('Optimizer failed'), isError: true, refetch: retry }));
    renderPage();
    expect(sessionCard(1)).toBeInTheDocument();
    fireEvent.click(within(region()).getByRole('button', { name: /Retry/ }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('ChargingListPage — happy path', () => {
  it('renders the shell, overview KPIs, trend chart, gated insight panels and every session card', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Charging sessions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Live readiness, cost exposure, charger behavior, and charging history'),
    ).toBeInTheDocument();
    expect(document.title).toContain('Charging sessions');

    // Real shared overview metric labels.
    expect(screen.getByText('Energy (kWh)')).toBeInTheDocument();
    expect(screen.getByText('Avg rate (kW)')).toBeInTheDocument();
    expect(screen.getByTestId('charging-overview').querySelectorAll('[data-operational-metric]')).toHaveLength(6);

    // Trend chart branch fired (currentStats.count > 0).
    expect(trendChart()).toBeInTheDocument();
    expect(within(trendChart() as HTMLElement).getByRole('img', {
      name: 'Charging over time chart with metric switcher',
    })).toBeInTheDocument();

    // Threshold-gated insight panels: 6 sessions clears AC/DC(1), battery(5),
    // delivery rate, and specs(5) — but NOT the optimizer(10).
    const insights = within(screen.getByRole('region', { name: 'Charging insights' }));
    expect(insights.getByRole('table', { name: 'Charging stats by type' })).toBeInTheDocument();
    expect(insights.getByRole('img', { name: 'Charging sessions by starting battery level' })).toBeInTheDocument();
    expect(insights.getByRole('heading', { name: 'Charging delivery rate' })).toBeInTheDocument();
    expect(insights.getByRole('heading', { name: 'Charger Specs Breakdown' })).toBeInTheDocument();
    expect(insights.queryByRole('heading', { name: 'Charging Habits' })).not.toBeInTheDocument();

    // Every session card in the window renders.
    expect(sessionCard(1)).toBeInTheDocument();
    expect(sessionCard(6)).toBeInTheDocument();
  });

  it('presents live posture, departure, cost, honest efficiency coverage, interruptions, and reliability', async () => {
    renderPage();
    await screen.findByTestId('charging-operational-brief');

    expect(within(briefMetric('Current posture')).getByText('Charging')).toBeInTheDocument();
    expect(within(briefMetric('Departure readiness')).getByText('64%')).toBeInTheDocument();
    expect(within(briefMetric('Cost exposure')).getByText('$39.50')).toBeInTheDocument();
    expect(
      within(briefMetric('Charging efficiency')).getByText('Not measured'),
    ).toBeInTheDocument();
    expect(within(briefMetric('Potential interruptions')).getByText('1')).toBeInTheDocument();
    expect(within(briefMetric('Charger reliability')).getByText('83% clear')).toBeInTheDocument();
    // Freshness lives in the page header; the brief keeps provenance only.
    const header = document.querySelector('header') as HTMLElement;
    expect(within(header).getByText('just now')).toBeInTheDocument();
    const brief = screen.getByTestId('charging-operational-brief');
    expect(within(brief).queryByRole('button', { name: /Source: / })).toBeNull();
    expect(mockVehicleState).toHaveBeenCalledWith(1);
  });

  it('escalates low departure charge when the vehicle is not charging', async () => {
    mockVehicleState.mockReturnValue(
      qr({
        data: {
          state: { ...LIVE_STATE, is_charging: false, battery_level: 12 },
          live: true,
          freshness: 'fresh',
          observedAt: Date.now(),
          verifiedFields: ['is_charging', 'battery_level'],
        },
      }),
    );
    renderPage();

    expect(await screen.findByText('Departure charge is below 20%')).toBeInTheDocument();
    expect(within(briefMetric('Departure readiness')).getByText('12%')).toBeInTheDocument();
  });

  describe('ChargingListPage phase5 source trust and preservation', () => {
    it('keeps never-resolved paused history pending rather than asserting an empty window', () => {
      mockSessions.mockReturnValue(qr({ fetchStatus: 'paused', isLoading: false, isFetching: false }));
      renderPage();
      expect(screen.getByTestId('charging-overview')).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByText('No charging sessions yet')).not.toBeInTheDocument();
      expect(screen.queryByText('No charging activity in this window')).not.toBeInTheDocument();
      expect(within(briefMetric('Departure readiness')).getByText('64%')).toBeInTheDocument();
    });

    it('keeps independent live readings without claiming empty history while history is pending', async () => {
      mockSessions.mockReturnValue(qr({ isLoading: true, isFetching: true }));
      renderPage();
      const brief = screen.getByTestId('charging-operational-brief');
      expect(within(briefMetric('Current posture')).getByText('Charging')).toBeInTheDocument();
      expect(within(briefMetric('Departure readiness')).getByText('64%')).toBeInTheDocument();
      expect(within(brief).queryByText('No charging activity in this window')).not.toBeInTheDocument();
      expect(within(briefMetric('Potential interruptions')).queryByText('0')).not.toBeInTheDocument();
      fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
      const details = await screen.findByRole('dialog', { name: 'Cost, reliability, and battery-friendly behavior details' });
      expect(within(details).queryByText(/0 sessions delivered/)).not.toBeInTheDocument();
      expect(within(details).queryByText('0 sessions were evaluated in the active period.')).not.toBeInTheDocument();
    });

    it('keeps failed history distinct from an empty list and preserves every source section', () => {
      mockSessions.mockReturnValue(qr({ isError: true, error: new Error('History failed') }));
      renderPage();
      for (const [name, count] of [['Overview', 2], ['Charging over time', 1], ['All charging sessions', 1], ['Charging insights', 1]] as const) {
        expect(screen.getAllByRole('region', { name })).toHaveLength(count);
      }
      expect(screen.queryByText('No charging sessions yet')).not.toBeInTheDocument();
      expect(screen.queryByText('No charging activity in this window')).not.toBeInTheDocument();
      expect(screen.queryByText('Charging insights need completed sessions in the selected range.')).not.toBeInTheDocument();
      expect(within(briefMetric('Departure readiness')).getByText('64%')).toBeInTheDocument();
      expect(within(briefMetric('Potential interruptions')).getByText('—')).toBeInTheDocument();
    });

    it.each([
      { caseId: 'stale-stream', freshness: 'stale' as const, observedAt: Date.now() - 600_000, verifiedFields: ['is_charging', 'battery_level'] },
      { caseId: 'missing-field-trust', freshness: 'fresh' as const, observedAt: Date.now(), verifiedFields: [] },
      { caseId: 'missing-observation', freshness: 'fresh' as const, observedAt: null, verifiedFields: ['is_charging', 'battery_level'] },
    ])('retains readings without a current readiness claim for $caseId', ({ freshness, observedAt, verifiedFields }) => {
      mockVehicleState.mockReturnValue(qr({ data: { state: LIVE_STATE, live: true, freshness, observedAt, verifiedFields } }));
      renderPage();
      const brief = screen.getByTestId('charging-operational-brief');
      expect(within(briefMetric('Departure readiness')).getByText('64%')).toBeInTheDocument();
      expect(within(briefMetric('Current posture')).getByText('Charging')).toBeInTheDocument();
      expect(within(brief).queryByText('Charging now')).not.toBeInTheDocument();
      expect(within(briefMetric('Departure readiness')).queryByText(/supports near-term departure/)).not.toBeInTheDocument();
      expect(within(briefMetric('Current posture')).queryByText(/with 1h 30m to target/)).not.toBeInTheDocument();
    });

    it('does not treat a time-machine snapshot as current even with otherwise fresh metadata', () => {
      renderPage(['/charging?from=2000-01-01&to=2100-01-01&as_of=2024-06-15T10:00:00Z']);
      const brief = screen.getByTestId('charging-operational-brief');
      expect(within(briefMetric('Departure readiness')).getByText('64%')).toBeInTheDocument();
      expect(within(brief).queryByText('Charging now')).not.toBeInTheDocument();
      expect(within(briefMetric('Departure readiness')).queryByText(/supports near-term departure/)).not.toBeInTheDocument();
    });

    it('preserves the global non-date sort on mobile across interleaved dates', async () => {
      mockSessions.mockReturnValue(qr({ data: [
        makeSession({ id: 31, started_at: '2024-06-15T08:00:00Z', total_energy_added_wh: 10_000 }),
        makeSession({ id: 32, started_at: '2024-06-14T08:00:00Z', total_energy_added_wh: 30_000 }),
        makeSession({ id: 33, started_at: '2024-06-15T09:00:00Z', total_energy_added_wh: 20_000 }),
      ] }));
      renderPage(['/charging?from=2000-01-01&to=2100-01-01&sort=energy&sort_desc=true']);
      await findSessionCard(32);
      const sessionRegion = screen.getByRole('region', { name: 'All charging sessions' });
      expect(Array.from(sessionRegion.querySelectorAll<HTMLAnchorElement>('a[href^="/charging/"]'))
        .map((link) => link.getAttribute('href'))).toEqual(['/charging/32', '/charging/33', '/charging/31']);
      expect(within(sessionRegion).getByText('Search, collections, and exports cover up to 500 loaded sessions in this range.')).toBeInTheDocument();
    });

    it.each(['cb_safe', 'neon'] as const)('uses the saved %s chart palette while preserving all four metric identities', async (palette) => {
      chartPreference.palette = palette;
      renderPage();
      await findSessionCard(1);
      const { CHART_COLORS_CB_SAFE, CHART_COLORS_NEON } = await import('@/lib/colors');
      const colors = palette === 'neon' ? CHART_COLORS_NEON : CHART_COLORS_CB_SAFE;
      expect(captured.trendMetrics).toEqual([
        { key: 'sessions', color: colors[0] },
        { key: 'energy', color: colors[1] },
        { key: 'cost', color: colors[2] },
        { key: 'power', color: colors[4] },
      ]);
    });

    it('retains failed bulk selections and clears only confirmed deleted sessions', async () => {
      const mutateAsync = vi.fn().mockResolvedValue({ deleted: 1, failed: [{ id: 2, reason: 'conflict' }] });
      mockBulkDelete.mockReturnValue({ mutateAsync, isPending: false } as ReturnType<typeof useBulkDeleteCharging>);
      renderPage();
      await findSessionCard(1);
      fireEvent.click(sessionCheckbox(1));
      fireEvent.click(sessionCheckbox(2));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith([1, 2]));
      await waitFor(() => expect(sessionCheckbox(1)).not.toBeChecked());
      expect(sessionCheckbox(2)).toBeChecked();
    });
  });

  it('preserves the session vehicle, place, and time window in related links', async () => {
    renderPage();
    fireEvent.click(within(await findSessionCard(1)).getByRole('button', { name: 'Quick view charging session' }));

    expect(await screen.findByRole('dialog', { name: 'Home Garage' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vehicle' }))
      .toHaveAttribute('href', '/vehicles/1');
    expect(screen.getByRole('link', { name: 'Drive history' }))
      .toHaveAttribute('href', '/drives?from=2024-06-15&to=2024-06-15');
    expect(screen.getByRole('link', { name: 'Charge location' }))
      .toHaveAttribute(
        'href',
        '/locations?q=Home+Garage&from=2024-06-15&to=2024-06-15',
      );
    expect(screen.getByRole('link', { name: 'Telemetry evidence' }))
      .toHaveAttribute(
        'href',
        '/signals?from=2024-06-15&to=2024-06-15&signals=ACChargingPower%2CDCChargingPower%2CBatteryLevel',
      );
  });

  it('omits redundant collection tabs while retaining the by-type secondary summary', async () => {
    renderPage();
    expect(await screen.findByText('2 home · 2 SC · 2 DC')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Filter charging sessions by collection' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('charging-collections')).not.toBeInTheDocument();
    // 2 home (s1,s4) · 2 supercharger (s2,s5) · 2 dc / CCS (s3,s6).
    expect(screen.getByText('2 home · 2 SC · 2 DC')).toBeInTheDocument();
  });

  it('surfaces the anomaly callout and flags the anomalous session card', async () => {
    renderPage();
    // s6 = 0 kWh over an hour ⇒ one telemetry-gap anomaly.
    expect(await screen.findByText('1 anomaly in this range')).toBeInTheDocument();
    expect(within(await findSessionCard(6)).getByText('0 kWh added in 1h — telemetry gap?')).toBeInTheDocument();
    expect(within(await findSessionCard(1)).queryByText('0 kWh added in 1h — telemetry gap?')).not.toBeInTheDocument();
  });

  it('exposes labelled landmark regions and an accessible name on the icon-only card toggle', async () => {
    renderPage();
    expect(await screen.findByRole('region', { name: 'Charging summary' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'All charging sessions' })).toBeInTheDocument();
    expect(sessionCheckbox(1)).toHaveAccessibleName('Select charging session');
  });
});

describe('ChargingListPage — bulk selection', () => {
  it('toggles a session into and out of the bulk selection when its checkbox is clicked', async () => {
    renderPage();
    await findSessionCard(1);
    const toggle = sessionCheckbox(1);
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(sessionCheckbox(1)).toBeChecked(),
    );

    fireEvent.click(sessionCheckbox(1));
    await waitFor(() =>
      expect(sessionCheckbox(1)).not.toBeChecked(),
    );
  });
});

describe('ChargingListPage — distance conversion (SI regression guard)', () => {
  it('converts canonical metres directly at the display boundary', async () => {
    renderPage();
    await findSessionCard(1);
    expect(captured.toDistanceDisplay).toBeTypeOf('function');
    expect(captured.toDistanceDisplay!(50_000)).toBe(50);
    expect(captured.toDistanceDisplay!(0)).toBe(0);
    expect(captured.distanceUnit).toBe('km');
    expect(within(await findSessionCard(1)).getByText('+50 km')).toBeInTheDocument();
  });

  it('converts canonical metres to miles when the unit preference is imperial', async () => {
    unitState.length = 'mi';
    renderPage();
    await findSessionCard(1);
    // 50 km ⇒ 50_000 m / 1609.344 ≈ 31.07 mi.
    expect(captured.toDistanceDisplay!(50_000)).toBeCloseTo(31.07, 1);
    expect(captured.distanceUnit).toBe('mi');
    expect(within(await findSessionCard(1)).getByText('+31 mi')).toBeInTheDocument();
  });
});

describe('ChargingListPage — non-happy states', () => {
  it.each(['pending', 'failed'])('does not claim a filtered no-match while history is %s', (state) => {
    mockSessions.mockReturnValue(state === 'pending'
      ? qr({ fetchStatus: 'paused' })
      : qr({ isError: true, error: new Error('History failed') }));
    renderPage(['/charging?from=2000-01-01&to=2100-01-01&q=nonexistent-charge-location&page=3&size=2']);
    const list = screen.getByRole('region', { name: 'All charging sessions' });
    expect(within(list).queryByText('No charging sessions in this view')).not.toBeInTheDocument();
    expect(within(list).queryByText('No charging sessions yet')).not.toBeInTheDocument();
    expect(new URLSearchParams(screen.getByTestId('pagination-location').textContent ?? '').get('page')).toBe('3');
    if (state === 'failed') {
      expect(within(list).getByRole('button', { name: /retry/i })).toBeInTheDocument();
    }
  });

  it('renders both the range and list empty states when there are no sessions', async () => {
    mockSessions.mockReturnValue(qr({ data: [] }));
    renderPage();

    expect(
      await screen.findByText('No charging sessions in this range'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Charging insights need completed sessions in the selected range.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Battery-start patterns, charger comparisons/)).toBeInTheDocument();
    expect(screen.getByText('No charging sessions yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();
    // Keep the trend shell available so the empty chart explains its missing data.
    expect(trendChart()).toBeInTheDocument();
    expect(sessionCard(1)).not.toBeInTheDocument();
  });

  it('renders loading skeletons and no session cards while the query is pending', () => {
    mockSessions.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderPage();

    const skeleton = '[aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"]';
    expect(container.querySelectorAll(skeleton).length).toBeGreaterThan(0);
    expect(container.querySelectorAll(skeleton).length).toBeGreaterThanOrEqual(7);
    expect(screen.getByRole('region', { name: 'Charging over time' })
      .querySelectorAll(`${skeleton}[class~="h-52"]`)).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'All charging sessions' })
      .querySelectorAll(`${skeleton}[class~="h-20"]`)).toHaveLength(5);
    expect(screen.getByRole('region', { name: 'Charging insights' })
      .querySelectorAll(`${skeleton}[class~="h-40"]`)).toHaveLength(4);
    const overview = screen.getByTestId('charging-overview');
    expect(overview).toHaveAttribute('aria-busy', 'true');
    expect(overview.querySelectorAll(
      '[data-operational-metric] [aria-hidden="true"][class~="bg-[var(--surface-3)]"]',
    )).toHaveLength(6);
    expect(overview.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(sessionCard(1)).not.toBeInTheDocument();
    expect(trendChart()).not.toBeInTheDocument();
  });

  it('surfaces a retryable error banner and refetches when Retry is pressed', async () => {
    const refetch = vi.fn();
    mockSessions.mockReturnValue(
      qr({ error: new Error('boom'), isError: true, refetch }),
    );
    renderPage();

    const overview = screen.getByTestId('charging-overview');
    const source = overview.parentElement?.closest('section');
    if (!source) throw new Error('Overview source section is missing');
    expect(source).toHaveAccessibleName('Overview');
    const summary = within(source);
    expect(summary.getAllByRole('region', { name: 'Overview' })).toHaveLength(1);
    expect(summary.getByRole('region', { name: 'Overview' })).toBe(overview);
    expect(overview.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(await summary.findByText("Can't reach server")).toBeInTheDocument();
    expect(summary.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    fireEvent.click(summary.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });

  it('keeps the retained session list when a BACKGROUND refetch fails', async () => {
    // Data-trust contract: the full-bleed <QueryError> is reserved for an
    // initial failure with nothing cached. A refetch that fails on top of a
    // rendered list degrades to a non-blocking staleness notice instead.
    mockSessions.mockReturnValue(
      qr({ data: SESSIONS, error: new Error('boom'), isError: true }),
    );
    renderPage();

    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(sessionCard(1)).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).toBeNull();
  });

  it('keeps charging history visible when live departure state fails', async () => {    mockVehicleState.mockReturnValue(
      qr({ isError: true, error: new Error('live state unavailable'), data: undefined }),
    );
    renderPage();

    expect(
      await screen.findByText('Live charging and departure state are unavailable'),
    ).toBeInTheDocument();
    expect(sessionCard(1)).toBeInTheDocument();
    expect(within(briefMetric('Current posture')).getByText('Unavailable')).toBeInTheDocument();
  });

  it('retains charging posture, departure battery, history and retry on a failed live-state refresh', async () => {
    const refetch = vi.fn();
    mockVehicleState.mockReturnValue(qr({
      data: { state: LIVE_STATE, live: true },
      error: new Error('Live refresh failed'),
      isError: true,
      refetch,
    }));
    renderPage();

    const warning = await screen.findByTestId('stale-refresh-warning');
    expect(within(warning).getByText('Live vehicle state may be out of date')).toBeInTheDocument();
    expect(within(briefMetric('Current posture')).getByText('Charging')).toBeInTheDocument();
    expect(within(briefMetric('Departure readiness')).getByText('64%')).toBeInTheDocument();
    expect(sessionCard(1)).toBeInTheDocument();
    expect(screen.queryByText('Live charging and departure state are unavailable')).not.toBeInTheDocument();
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the no-vehicle prompt and hides all data sections when no vehicle is selected', async () => {
    mockSelectedVehicle.mockReturnValue({
      vehicleId: null,
      vehicle: null,
      vehicles: [] as any,
      setVehicleId: vi.fn(),
    });
    renderPage();

    expect(await screen.findByText('No vehicle selected')).toBeInTheDocument();
    expect(
      screen.getByText('Add a vehicle to your fleet to see data on this page.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Charging sessions' }),
    ).toBeInTheDocument();
    // The data scaffolding must not render on the null-vehicle guard path.
    expect(screen.queryByText('Energy (kWh)')).not.toBeInTheDocument();
    expect(sessionCard(1)).not.toBeInTheDocument();
  });
});
