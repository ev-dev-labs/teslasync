/**
 * LocationsPage contract + hardening tests.
 *
 * LocationsPage reads a page through the real canonical useVisitedLocations
 * hook and derives a KPI band, two leaderboards, and a
 * searchable/paginated detail list from them. The network seam (`@/api/client`
 * `request`) and `useSelectedVehicle` are mocked so every branch — loading,
 * error, empty, no-vehicle, and the fully-populated happy path — is exercised
 * deterministically. `useRangeState` is mocked to a fixed wide window so the
 * server-side request bounds are clock-independent. The two
 * leaderboard panels (recharts) and the AI auto-name affordance are stubbed with
 * prop-capturing markers so the assertions target THE PAGE'S own orchestration
 * (branch selection, derived chart data, ordering, gating) rather than chart or
 * stream internals, which render nothing meaningful in jsdom.
 *
 * The display hook (`useUnits` → `useSettings`) renders for real, so the SI
 * duration formatting at the render boundary is exercised.
 *
 * Two derivations carry explicit regression guards for bugs fixed alongside
 * these tests:
 *   - `timeChartData` is now sorted by time-spent DESC (the "Top Locations by
 *     Time Spent" chart previously inherited the backend's visit-count order,
 *     so it showed the most-VISITED places' durations, not the highest-time).
 *   - `uniqueCities` now skips coordinate-fallback rows (a raw "lat,long" is not
 *     a city and used to inflate the unique-city count).
 */

import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { LocationLeaderboardPanelProps } from '../components/LocationLeaderboardPanel';
import type { AIAutoNameUnnamedLocationsProps } from '@/components/ai/AIAutoNameUnnamedLocations';
import type { SelectedVehicleResult } from '@/hooks/useSelectedVehicle';
import type { AppSettings } from '@/api/types';
import { deriveDataState } from '@/api/dataState';
import { chartTokens, typography } from '@/lib/tokens';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options object so assertions can target the rendered English copy. A bare key
// with no fallback echoes the key.
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

// Network kill-switch: neutralise the shared fetch seam. `request` becomes a
// controllable vi.fn; `isApiError` etc. stay real so <QueryError> branches
// correctly on the (absent) status.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

vi.mock('@/hooks/useSelectedVehicle', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});

// Fixed, wide server-side range independent of the machine clock.
const rangeState = vi.hoisted(() => ({ start: '2000-01-01', end: '2099-12-31' }));
vi.mock('@/hooks/useRangeState', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useRangeState')>();
  return {
    ...actual,
    useRangeState: () => ({
      start: rangeState.start,
      end: rangeState.end,
      startInstant: `${rangeState.start}T00:00:00Z`,
      endInstantExclusive: `${rangeState.end}T00:00:00Z`,
      timezone: 'UTC',
      presetId: 'all' as string | undefined,
      compare: false,
      comparePrev: undefined,
      setRange: vi.fn(),
      setPreset: vi.fn(),
      setCompare: vi.fn(),
      reset: vi.fn(),
    }),
  };
});

// Cache-backed settings: the global setup mock pins useSettings to fixed
// defaults, but the saved locale/timezone test drives formatting through
// the ['settings'] query cache. This file-level mock binds the real
// normalization to that cache — seeded with identical defaults, reactive
// to setQueryData, and never fetching (so no '/settings' request can
// disturb the request-contract assertions or the machine timezone).
vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  const { useMemo, useSyncExternalStore } = await import('react');
  const { useQueryClient } = await import('@tanstack/react-query');
  const { deriveDataState } = await import('@/api/dataState');
  const { resolveLocale } = await import('@/lib/locale');
  const cacheDefaults: AppSettings = {
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    preferred_range: 'rated',
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark',
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 0,
    gas_unit: 'gallon',
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant',
    currency_symbol: '$',
    locale: 'en-US',
    tz_display_default: 'vehicle',
    timezone_user: '',
    tab_badge_enabled: true,
    critical_flash_enabled: true,
    ui_density: 'comfortable',
    time_format_default: 'relative',
    chart_palette: 'cb_safe',
    ai_mode: 'off',
    ai_features: {},
    ai_provider_config: {},
    ai_cost_cap_cents: 0,
  };
  return {
    ...actual,
    useSettings: () => {
      // Direct cache subscription (no useQuery observer): the ['settings']
      // entry is seeded by tests via setQueryData and intentionally never
      // fetched, so read it straight from the client and re-render only
      // when its reference changes.
      const client = useQueryClient();
      const cached = useSyncExternalStore(
        (onStoreChange) => client.getQueryCache().subscribe(onStoreChange),
        () => client.getQueryData(['settings']) ?? cacheDefaults,
        () => client.getQueryData(['settings']) ?? cacheDefaults,
      );
      const s: AppSettings = useMemo(() => {
        const raw = cached as AppSettings;
        return raw.locale && raw.locale.trim().length > 0
          ? raw
          : { ...raw, locale: cacheDefaults.locale };
      }, [cached]);
      const decimals = typeof s.decimal_precision === 'number' && Number.isFinite(s.decimal_precision)
        ? Math.max(0, Math.min(20, Math.trunc(s.decimal_precision)))
        : 2;
      const locale = resolveLocale(s.locale);
      return useMemo(() => {
        const density: 'compact' | 'comfortable' | 'spacious' =
          s.ui_density === 'compact' || s.ui_density === 'spacious' ? s.ui_density : 'comfortable';
        const rangeType: 'rated' | 'ideal' = s.preferred_range === 'ideal' ? 'ideal' : 'rated';
        return {
          settings: s,
          settingsState: deriveDataState({ data: s, isSuccess: true }),
          settingsUnavailable: false,
          refetch: () => client.refetchQueries({ queryKey: ['settings'] }),
          isMiles: s.unit_of_length === 'mi',
          isFahrenheit: s.unit_of_temp === 'F',
          isPSI: (s.unit_of_pressure ?? 'bar') === 'psi',
          decimals,
          locale,
          density,
          rangeType,
        };
      }, [s, decimals, locale, client]);
    },
  };
});

// Prop-capturing stub for the two leaderboard panels — records each panel's
// props keyed by its (translated) seriesLabel ('Visits' / 'Hours') and renders
// a state marker so the page's loading/error/empty/data branch selection and
// the derived chart data are both assertable without mounting recharts.
const captured = vi.hoisted(() => ({
  panels: {} as Record<string, LocationLeaderboardPanelProps>,
}));

vi.mock('../components/LocationLeaderboardPanel', () => ({
  LocationLeaderboardPanel: (props: LocationLeaderboardPanelProps) => {
    captured.panels[props.seriesLabel] = props;
    const rows = props.data ?? [];
    return (
      <div data-testid={`lb-${props.seriesLabel}`}>
        {props.loading ? (
          <div data-testid={`lb-loading-${props.seriesLabel}`} />
        ) : props.error ? (
          <div data-testid={`lb-error-${props.seriesLabel}`} />
        ) : rows.length === 0 ? (
          <div data-testid={`lb-empty-${props.seriesLabel}`}>{props.emptyMessage}</div>
        ) : (
          <div data-testid={`lb-data-${props.seriesLabel}`}>{rows.length}</div>
        )}
      </div>
    );
  },
}));

// Stub the propose-only AI auto-name affordance: a marker keyed by locationId
// (proving the gating branch) plus a button that fires `onApplyName` (proving
// the applied-name hand-off back into the page).
vi.mock('@/components/ai/AIAutoNameUnnamedLocations', () => ({
  AIAutoNameUnnamedLocations: (props: AIAutoNameUnnamedLocationsProps) => (
    <div data-testid={`ai-autoname-${props.locationId}`} data-current={props.currentName}>
      <button type="button" onClick={() => props.onApplyName(`AI: ${props.locationId}`)}>
        {`apply-${props.locationId}`}
      </button>
    </div>
  ),
}));

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

import LocationsPage, {
  isUnnamedLocation,
  truncateLabel,
  rankChipClass,
} from './LocationsPage';
import { request } from '@/api/client';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

const mockRequest = vi.mocked(request);
const mockSelectedVehicle = vi.mocked(useSelectedVehicle);

interface VisitedLocation {
  id: number;
  address_name: string;
  visit_count: number;
  total_duration_s: number;
  last_visited: string | null;
}

// Backend contract: /locations rows arrive ordered by visit_count DESC.
// Times are deliberately NOT monotonic with visits so the time-sort fix is
// observable: Office has the fewest-but-one visits yet by far the most time.
function makeLocations(): VisitedLocation[] {
  return [
    { id: 1, address_name: 'Home, Seattle', visit_count: 20, total_duration_s: 3600, last_visited: '2025-03-10T08:00:00Z' },
    { id: 2, address_name: 'Office, Bellevue', visit_count: 15, total_duration_s: 72000, last_visited: '2025-03-11T09:00:00Z' },
    { id: 3, address_name: 'Cafe, Tacoma', visit_count: 8, total_duration_s: 1800, last_visited: '2025-03-12T10:00:00Z' },
    { id: 4, address_name: '47.6062,-122.3321', visit_count: 3, total_duration_s: 600, last_visited: '2025-03-13T11:00:00Z' },
  ];
}

function installVehicles(over: Partial<SelectedVehicleResult> = {}) {
  const setVehicleId = vi.fn();
  const vehicleDefaults = {
    vehicle_id: 0, model: '', trim_badging: '', exterior_color: '', wheel_type: '',
    state: 'unknown', healthy: false, created_at: '', updated_at: '',
  };
  const vehicles = over.vehicles ?? [
    { ...vehicleDefaults, id: 2, display_name: 'Model 3', vin: 'V3' },
    { ...vehicleDefaults, id: 5, display_name: '', vin: 'VIN5' },
  ];
  mockSelectedVehicle.mockReturnValue({
    vehicleId: 2,
    vehicle: null,
    vehicles,
    vehiclesState: deriveDataState({ data: vehicles, isSuccess: true }, {
      provenance: 'cached',
      unavailable: vehicles.length === 0,
    }),
    setVehicleId,
    ...over,
  });
  return setVehicleId;
}

function renderPage(entries: string[] = ['/locations']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const page = (
    <MemoryRouter initialEntries={entries}>
      <QueryClientProvider client={client}>
        <LocationsPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(page);
  return { ...view, client };
}

function kpiRegion() {
  return screen.getByRole('region', { name: 'Location summary' });
}

// Read a MetricCard's value by its label so numeric assertions never collide.
function kpiValue(label: string): string {
  const labelEl = within(kpiRegion()).getByText(label);
  const card = labelEl.closest('[data-operational-metric]');
  return card?.querySelector('[data-operational-value]')?.textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  captured.panels = {};
  rangeState.start = '2000-01-01';
  rangeState.end = '2099-12-31';
  installVehicles();
  mockRequest.mockResolvedValue(makeLocations());
});

afterEach(() => {
  onlineManager.setOnline(true);
});

/* ───────────────────────── Pure helper unit tests ───────────────────────── */

describe('isUnnamedLocation', () => {
  it('flags empty, whitespace, the "Unknown" sentinel, and coordinate fallbacks', () => {
    expect(isUnnamedLocation('')).toBe(true);
    expect(isUnnamedLocation('   ')).toBe(true);
    expect(isUnnamedLocation('Unknown')).toBe(true);
    expect(isUnnamedLocation('UNKNOWN')).toBe(true);
    expect(isUnnamedLocation('47.6062,-122.3321')).toBe(true);
    expect(isUnnamedLocation('47.6062, -122.3321')).toBe(true);
    // Null address (runtime-possible despite the string type) is treated as unnamed.
    expect(isUnnamedLocation(null as unknown as string)).toBe(true);
  });

  it('does NOT flag genuine human-readable names', () => {
    expect(isUnnamedLocation('Home, Seattle')).toBe(false);
    expect(isUnnamedLocation('123 Main St')).toBe(false);
    expect(isUnnamedLocation('Supercharger Alpha')).toBe(false);
    // A comma-joined name is not a bare coordinate pair.
    expect(isUnnamedLocation('Unknown Brewing Co, Portland')).toBe(false);
  });
});

describe('truncateLabel', () => {
  it('leaves short labels intact and clips long ones with an ellipsis', () => {
    expect(truncateLabel('Home')).toBe('Home');
    expect(truncateLabel('a'.repeat(25))).toBe('a'.repeat(25)); // 25 == max+3, unchanged
    const long = truncateLabel('a'.repeat(26));
    expect(long).toBe(`${'a'.repeat(22)}…`);
    expect(long.endsWith('…')).toBe(true);
  });

  it('honours a custom max and null-safes a missing name', () => {
    expect(truncateLabel('abcdef', 2)).toBe('ab…');
    expect(truncateLabel(null as unknown as string)).toBe('');
  });
});

describe('rankChipClass', () => {
  it('keeps the first rank distinct without decorative podium colors', () => {
    expect(rankChipClass(0)).toContain(typography.color.primary);
    expect(rankChipClass(1)).toContain(typography.color.secondary);
    expect(rankChipClass(2)).toContain(typography.color.secondary);
    expect(rankChipClass(3)).toContain(typography.color.secondary);
    expect(rankChipClass(9)).not.toMatch(/amber|cyan|glow/);
  });
});

/* ─────────────────────────── Component tests ─────────────────────────── */

describe('LocationsPage — shell & request contract', () => {
  it('retains loaded-page scope and opens the original-duration evidence in the real summary drawer', async () => {
    renderPage();
    await waitFor(() => expect(kpiValue('Total visits')).toBe('46'));
    // Face-value disclosure: the loaded-page scope moved to the summary drawer.
    fireEvent.click(within(kpiRegion()).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Location summary details' });
    expect(within(drawer).getAllByText(/not server-wide totals/).length).toBeGreaterThan(0);
    expect(within(drawer).getByText('Home, Seattle')).toBeInTheDocument();
    expect(within(drawer).getByText('Loaded-page total duration divided by loaded-page visits; zero when the successful page contains no visits.')).toBeInTheDocument();
  });
  it('renders the title/subtitle and requests SI locations with snake_case params (no /api/v1)', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Visited locations' })).toBeInTheDocument();
    expect(screen.getByText("Places you've been — ranked by frequency")).toBeInTheDocument();
    await waitFor(() => expect(mockRequest).toHaveBeenCalled());
    const requestPath = String(mockRequest.mock.calls[0]?.[0]);
    const params = new URL(requestPath, 'http://teslasync.local').searchParams;
    expect(requestPath).toMatch(/^\/locations\?/);
    expect(params.get('vehicle_id')).toBe('2');
    expect(params.get('limit')).toBe('50');
    expect(params.get('offset')).toBe('0');
    expect(params.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(params.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(document.title).toContain('Visited locations');
  });
});

describe('LocationsPage — KPI band', () => {
  it('derives every KPI from the loaded rows', async () => {
    renderPage();
    await waitFor(() => expect(kpiValue('Total visits')).toBe('46'));
    expect(kpiValue('Unique places')).toBe('4');
    // Regression: the coordinate row (#4) is NOT counted as a city.
    expect(kpiValue('Unique cities')).toBe('3');
    expect(kpiValue('Most visited')).toBe('Home, Seattle');
    // formatDuration renders SI seconds in the user's (hour) preference.
    expect(kpiValue('Total time')).toMatch(/\bh\b/);
  });

  it('renders only the server-side range-filtered aggregates', async () => {
    mockRequest.mockResolvedValue([
      { id: 1, address_name: 'Home, Seattle', visit_count: 10, total_duration_s: 500, last_visited: '2025-03-10T08:00:00Z' },
    ]);
    renderPage();
    await waitFor(() => expect(kpiValue('Unique places')).toBe('1'));
    expect(kpiValue('Total visits')).toBe('10');
  });

  it('shows a "—" placeholder for Most Visited when there is no data', async () => {
    mockRequest.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(kpiValue('Total visits')).toBe('0'));
    assertOperationalMetricUnavailable(kpiRegion(), 'Most visited');
  });
});

describe('LocationsPage — leaderboards', () => {
  it('feeds the visits chart in visit order and the time chart sorted by time (regression)', async () => {
    renderPage();
    await waitFor(() => expect(captured.panels['Hours']?.data?.length).toBe(4));

    // "By visits" mirrors the backend's visit_count DESC ordering.
    expect(captured.panels['Visits'].data).toEqual([
      { name: 'Home, Seattle', value: 20 },
      { name: 'Office, Bellevue', value: 15 },
      { name: 'Cafe, Tacoma', value: 8 },
      { name: '47.6062,-122.3321', value: 3 },
    ]);

    // "By time" is re-sorted by hours DESC — Office (few visits, most time)
    // must lead, NOT Home (most visits, little time). Without the fix the
    // first bar would be Home @ 1h.
    expect(captured.panels['Hours'].data?.map((d) => d.name)).toEqual([
      'Office, Bellevue',
      'Home, Seattle',
      'Cafe, Tacoma',
      '47.6062,-122.3321',
    ]);
    expect(captured.panels['Hours'].data?.[0]).toEqual({ name: 'Office, Bellevue', value: 20 });

    // Panel wiring (titles, colours, empty copy) is passed through intact.
    expect(captured.panels['Visits'].title).toBe('Top locations by visits');
    expect(captured.panels['Visits'].color).toBe(chartTokens.series[0]);
    expect(captured.panels['Hours'].color).toBe(chartTokens.series[4]);
    expect(captured.panels['Hours'].emptyMessage).toBe('No time-spent data available');
  });

  it('preserves full source addresses and unrounded numeric hours independently of locale formatting', async () => {
    const address = 'Synthetic place with a shared long prefix, Detailed district';
    mockRequest.mockResolvedValue([
      { id: 71, address_name: address, visit_count: 1, total_duration_s: 1000, last_visited: null },
      { id: 72, address_name: 'Synthetic large duration', visit_count: 1, total_duration_s: 7200000, last_visited: null },
    ]);
    renderPage();
    await waitFor(() => expect(captured.panels['Hours'].data).toHaveLength(2));
    expect(captured.panels['Visits'].data?.[0]).toEqual({ name: address, value: 1 });
    expect(captured.panels['Hours'].data).toEqual([
      { name: 'Synthetic large duration', value: 2000 },
      { name: address, value: 1000 / 3600 },
    ]);
    expect(screen.getByRole('button', { name: `Inspect ${address}` })).toBeInTheDocument();
  });
});

describe('LocationsPage — detail list', () => {
  it('renders a ranked card per location with #1 assigned to the most-visited', async () => {
    renderPage();
    expect(await screen.findByText('Cafe, Tacoma')).toBeInTheDocument();
    expect(screen.getByText('Office, Bellevue')).toBeInTheDocument();

    const rank1 = screen.getByText('#1');
    const card = rank1.closest('li') as HTMLElement;
    expect(within(card).getByText('Home, Seattle')).toBeInTheDocument();
    // All four ranks render, in order.
    ['#1', '#2', '#3', '#4'].forEach((r) => expect(screen.getByText(r)).toBeInTheDocument());
  });

  it('retains every row field while giving inspect a mobile target and a wrapping layout', async () => {
    renderPage();
    const inspect = await screen.findByRole('button', { name: 'Inspect Home, Seattle' });
    expect(inspect).toHaveClass('h-11', 'w-11', 'min-h-11', 'min-w-11', 'md:h-9', 'md:w-9');
    const row = inspect.closest('li');
    expect(row).not.toBeNull();
    expect(inspect.parentElement).toHaveClass('flex-wrap');
    expect(within(row as HTMLElement).getByText('Home, Seattle').parentElement)
      .toHaveClass('order-last', 'w-full', 'sm:order-none');
    expect(within(row as HTMLElement).getByText(/20 visits/)).toHaveTextContent(/total.*avg.*Last/);
  });

  it('does not mix an inspected location or applied draft with a different vehicle scope', async () => {
    const view = renderPage();
    fireEvent.click(await screen.findByText('apply-4'));
    expect(screen.getByText('AI: 4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Home, Seattle' }));
    expect(screen.getByRole('dialog', { name: 'Home, Seattle' })).toBeInTheDocument();
    installVehicles({ vehicleId: 5 });
    // Rerender the same mounted providers so the original local state is retained.
    view.rerender(
      <MemoryRouter initialEntries={['/locations']}>
        <QueryClientProvider client={view.client}>
          <LocationsPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith(
      expect.stringContaining('vehicle_id=5'), { signal: expect.any(AbortSignal) },
    ));
    expect(screen.queryByRole('dialog', { name: 'Home, Seattle' })).not.toBeInTheDocument();
    expect(screen.queryByText('AI: 4')).not.toBeInTheDocument();
  });

  it('opens location evidence with vehicle, activity, service, and telemetry links', async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Inspect Home, Seattle' }),
    );

    const drawer = await screen.findByRole('dialog', { name: 'Home, Seattle' });
    expect(within(drawer).getByText('Location evidence')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Vehicle' }))
      .toHaveAttribute('href', '/vehicles/2');
    expect(within(drawer).getByRole('link', { name: 'Drive history' }))
      .toHaveAttribute(
        'href',
        '/drives?q=Home%2C+Seattle&from=2000-01-01&to=2099-12-31',
      );
    expect(within(drawer).getByRole('link', { name: 'Charging sessions' }))
      .toHaveAttribute(
        'href',
        '/charging?q=Home%2C+Seattle&from=2000-01-01&to=2099-12-31',
      );
    expect(within(drawer).getByRole('link', { name: 'Service history' }))
      .toHaveAttribute('href', '/maintenance');
    expect(within(drawer).getByRole('link', { name: 'Telemetry evidence' }))
      .toHaveAttribute(
        'href',
        '/signals?from=2000-01-01&to=2099-12-31',
      );
  });

  it('filters the list by the search box and shows a no-match empty state', async () => {
    renderPage();
    const search = await screen.findByPlaceholderText(/Search by address/);

    fireEvent.change(search, { target: { value: 'Office' } });
    await waitFor(
      () => expect(screen.queryByText('Cafe, Tacoma')).not.toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(screen.getByText('Office, Bellevue')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'zzzzzz' } });
    await waitFor(
      () => expect(screen.getByText('No locations match your search')).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it('shows the empty state (with a drives CTA) when there are no locations', async () => {
    mockRequest.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No visited locations recorded yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View drives' })).toHaveAttribute('href', '/drives');
  });
});

describe('LocationsPage — AI auto-name affordance', () => {
  it('offers the affordance only for unnamed rows and applies the suggested name', async () => {
    renderPage();
    // Only the coordinate-shaped row (#4) is "unnamed".
    expect(await screen.findByTestId('ai-autoname-4')).toBeInTheDocument();
    expect(screen.getByTestId('ai-autoname-4')).toHaveAttribute('data-current', '47.6062,-122.3321');
    expect(screen.queryByTestId('ai-autoname-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-autoname-2')).not.toBeInTheDocument();

    // Applying the proposal parks the name against the row for the user to save.
    fireEvent.click(screen.getByText('apply-4'));
    expect(await screen.findByText('AI: 4')).toBeInTheDocument();
  });
});

describe('LocationsPage — header vehicle scope', () => {
  it('uses the header-selected vehicle without rendering a duplicate selector', async () => {
    installVehicles({ vehicleId: 5 });
    renderPage();

    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith(
      expect.stringContaining('vehicle_id=5'), { signal: expect.any(AbortSignal) },
    ));
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();
  });

  it('hides the picker and skips the request when no vehicle is available', async () => {
    installVehicles({ vehicleId: null, vehicles: [] });
    renderPage();

    expect(screen.getByRole('heading', { name: 'No vehicle selected' })).toBeInTheDocument();
    expect(screen.getByText('Add a vehicle to your fleet to see data on this page.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up TeslaSync' })).toHaveAttribute('href', '/onboarding');
    expect(screen.getByTestId('lb-empty-Visits')).toHaveTextContent('No vehicle selected');
    expect(screen.getByTestId('lb-empty-Hours')).toHaveTextContent('No vehicle selected');
    expect(screen.queryByText('No visited locations recorded yet')).not.toBeInTheDocument();
    assertOperationalMetricUnavailable(kpiRegion(), 'Total visits');
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('LocationsPage — loading & error states', () => {
  it('shows skeletons + leaderboard loaders and no KPI cards while fetching', () => {
    mockRequest.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderPage();

    expect(screen.getByTestId('lb-loading-Visits')).toBeInTheDocument();
    expect(screen.getByTestId('lb-loading-Hours')).toBeInTheDocument();
    expect(within(kpiRegion()).getByText('Unique places')).toBeInTheDocument();
    expect(kpiRegion()).toHaveAttribute('aria-busy', 'true');
    expect(kpiRegion().querySelector('[data-operational-value]')).toBeNull();
    expect(container.querySelectorAll('[class*="--skeleton-bg"]').length).toBeGreaterThan(0);
  });

  it('keeps loaded locations and both leaderboards visible after a background refresh failure', async () => {
    const { client } = renderPage();
    expect(await screen.findByRole('button', { name: 'Inspect Home, Seattle' })).toBeInTheDocument();
    mockRequest.mockRejectedValue(new Error('synthetic refresh failure'));
    await client.invalidateQueries({ queryKey: ['visited-locations'] });
    await waitFor(() => expect(
      client.getQueryState(['visited-locations', 2, 1, 50, '2000-01-01T00:00:00Z', '2099-12-31T00:00:00Z'])?.status,
    ).toBe('error'));
    expect(screen.getByRole('button', { name: 'Inspect Home, Seattle' })).toBeInTheDocument();
    expect(screen.getByTestId('lb-data-Visits')).toHaveTextContent('4');
    expect(screen.getByTestId('lb-data-Hours')).toHaveTextContent('4');
    expect(screen.queryByTestId('lb-error-Visits')).not.toBeInTheDocument();
    expect(kpiValue('Total visits')).toBe('46');
  });

  it('surfaces a retry-able error and re-fetches when Retry is clicked', async () => {
    mockRequest.mockRejectedValue(new Error('locations down'));
    renderPage();

    expect(await screen.findByTestId('lb-error-Visits')).toBeInTheDocument();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThanOrEqual(1);

    const callsBefore = mockRequest.mock.calls.length;
    fireEvent.click(retries[0]);
    await waitFor(() => expect(mockRequest.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});

const locationsKey = [
  'visited-locations', 2, 1, 50, '2000-01-01T00:00:00Z', '2099-12-31T00:00:00Z',
] as const;

function makeFullPage(): VisitedLocation[] {
  return Array.from({ length: 50 }, (_, index) => ({
    id: index + 100,
    address_name: `Synthetic place ${index + 1}`,
    visit_count: 50 - index,
    total_duration_s: (index + 1) * 60,
    last_visited: null,
  }));
}

function rerenderPage(view: ReturnType<typeof renderPage>) {
  view.rerender(
    <MemoryRouter initialEntries={['/locations']}>
      <QueryClientProvider client={view.client}>
        <LocationsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('LocationsPage — unresolved trust and honest paging', () => {
  it('keeps a first paused request unknown, not resolved-empty or zero, and resumes normally', async () => {
    onlineManager.setOnline(false);
    renderPage();
    expect(screen.getByRole('heading', { name: 'Location loading paused' })).toBeInTheDocument();
    expect(screen.getByTestId('lb-empty-Visits')).toHaveTextContent('Location counts and remaining pages are unknown');
    expect(screen.getByTestId('lb-empty-Hours')).toHaveTextContent('The request is paused');
    expect(captured.panels['Visits'].emptyActionLabel).toBeUndefined();
    expect(captured.panels['Hours'].onResetFilters).toBeUndefined();
    assertOperationalMetricUnavailable(kpiRegion(), 'Total visits');
    expect(screen.queryByText('No visited locations recorded yet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByText('Page 1 of Unknown')).toBeInTheDocument();
    expect(mockRequest).not.toHaveBeenCalled();
    act(() => onlineManager.setOnline(true));
    expect(await screen.findByRole('button', { name: 'Inspect Home, Seattle' })).toBeInTheDocument();
    expect(kpiValue('Total visits')).toBe('46');
  });

  it('uses loaded-page counts and exploratory Next without asserting an exact total or Last page', async () => {
    mockRequest.mockResolvedValue(makeFullPage());
    renderPage();
    await screen.findByRole('button', { name: 'Inspect Synthetic place 1' });
    const pager = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pager).getByText('50 matching / 50 loaded rows')).toBeInTheDocument();
    expect(within(pager).getByText('Page 1 of Unknown')).toBeInTheDocument();
    expect(within(pager).queryByText(/Showing/)).not.toBeInTheDocument();
    expect(within(pager).queryByRole('button', { name: 'Last page' })).not.toBeInTheDocument();
    expect(within(pager).getByRole('button', { name: 'Next page' })).toBeEnabled();
    expect(screen.getByText(/Next checks another page/)).toBeInTheDocument();
  });

  it('retains Previous and First page recovery after an exploratory next page is empty', async () => {
    mockRequest.mockResolvedValue(makeFullPage());
    renderPage();
    await screen.findByRole('button', { name: 'Inspect Synthetic place 1' });
    mockRequest.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText(/No locations returned on this page/)).toBeInTheDocument();
    expect(screen.getByText('Page 2 of Unknown')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'First page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(mockRequest).toHaveBeenCalledWith(expect.stringContaining('offset=50'), { signal: expect.any(AbortSignal) });
    mockRequest.mockResolvedValue(makeFullPage());
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await screen.findByRole('button', { name: 'Inspect Synthetic place 1' });
    mockRequest.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText(/No locations returned on this page/);
    mockRequest.mockResolvedValue(makeFullPage());
    fireEvent.click(screen.getByRole('button', { name: 'First page' }));
    expect(await screen.findByRole('button', { name: 'Inspect Synthetic place 1' })).toBeInTheDocument();
    expect(screen.getByText('Page 1 of Unknown')).toBeInTheDocument();
  });

  it('keeps page recovery available when search matches nothing on a loaded later page', async () => {
    mockRequest.mockResolvedValue(makeFullPage());
    renderPage(['/locations?page=2']);
    await screen.findByRole('button', { name: 'Inspect Synthetic place 1' });
    fireEvent.change(screen.getByPlaceholderText(/Search by address/), { target: { value: 'absent place' } });
    await screen.findByText('No locations match your search');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'First page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    expect(screen.getByText('Page 2 of Unknown')).toBeInTheDocument();
    expect(screen.queryByText('50 matching / 50 loaded rows')).not.toBeInTheDocument();
  });

  it('retains recovery for a later page that has never loaded and is paused', () => {
    onlineManager.setOnline(false);
    renderPage(['/locations?page=3']);
    expect(screen.getByRole('heading', { name: 'Location loading paused' })).toBeInTheDocument();
    expect(screen.getByText('Page 3 of Unknown')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'First page' })).toBeEnabled();
    assertOperationalMetricUnavailable(kpiRegion(), 'Unique places');
  });
});

describe('LocationsPage — current preview identity and saved dates', () => {
  it('updates an open preview from the same-key current rows and receipt, closing if its identity disappears', async () => {
    const view = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Home, Seattle' }));
    const updated = makeLocations().map((location) => location.id === 1
      ? { ...location, address_name: 'Updated home', visit_count: 99, total_duration_s: 7200 }
      : location);
    act(() => view.client.setQueryData(locationsKey, updated, { updatedAt: Date.parse('2026-01-01T00:30:00Z') }));
    const drawer = await screen.findByRole('dialog', { name: 'Updated home' });
    expect(within(drawer).getByText('99')).toBeInTheDocument();
    expect(within(drawer).getByText('Page loaded at')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Drive history' })).toHaveAttribute(
      'href', '/drives?q=Updated+home&from=2000-01-01&to=2099-12-31',
    );
    act(() => view.client.setQueryData(locationsKey, updated.filter((location) => location.id !== 1)));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Updated home' })).not.toBeInTheDocument());
    act(() => view.client.setQueryData(locationsKey, updated));
    expect(screen.queryByRole('dialog', { name: 'Updated home' })).not.toBeInTheDocument();
  });

  it('does not resurrect a preview or naming receipt after vehicle scope changes away and back', async () => {
    const view = renderPage();
    fireEvent.click(await screen.findByText('apply-4'));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Home, Seattle' }));
    installVehicles({ vehicleId: 5 });
    rerenderPage(view);
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith(
      expect.stringContaining('vehicle_id=5'), { signal: expect.any(AbortSignal) },
    ));
    installVehicles({ vehicleId: 2 });
    rerenderPage(view);
    await screen.findByRole('button', { name: 'Inspect Home, Seattle' });
    expect(screen.queryByRole('dialog', { name: 'Home, Seattle' })).not.toBeInTheDocument();
    expect(screen.queryByText('AI: 4')).not.toBeInTheDocument();
  });

  it('resets paging and invalidates preview identity when the shared range changes', async () => {
    const view = renderPage(['/locations?page=2']);
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Home, Seattle' }));
    rangeState.start = '2026-01-01';
    rangeState.end = '2026-01-31';
    rerenderPage(view);
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith(
      expect.stringMatching(/offset=0&from=2026-01-01T00%3A00%3A00Z&to=2026-01-31T00%3A00%3A00Z/),
      { signal: expect.any(AbortSignal) },
    ));
    expect(screen.queryByRole('dialog', { name: 'Home, Seattle' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /vehicle/i })).not.toBeInTheDocument();
  });

  it('formats requested instant bounds through the selected zone without changing request bounds', async () => {
    rangeState.start = '2026-01-01';
    rangeState.end = '2026-01-02';
    const view = renderPage();
    await waitFor(() => expect(kpiValue('Total visits')).toBe('46'));
    act(() => view.client.setQueryData(['settings'], {
      locale: 'en-US', tz_display_default: 'user', timezone_user: 'America/Los_Angeles',
      decimal_precision: 2, unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
    }));
    fireEvent.click(within(kpiRegion()).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Location summary details' });
    for (const instant of ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z']) {
      const label = new Date(instant).toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
      expect(drawer).toHaveTextContent(label);
      expect(drawer).not.toHaveTextContent(instant);
    }
    const requestPath = String(mockRequest.mock.calls[0]?.[0]);
    const params = new URL(requestPath, 'http://teslasync.local').searchParams;
    expect(params.get('from')).toBe('2026-01-01T00:00:00Z');
    expect(params.get('to')).toBe('2026-01-02T00:00:00Z');
    expect(drawer).toHaveTextContent('(exclusive)');
  });

  it('formats last visits and the current page receipt through saved locale and timezone preferences', async () => {
    const timestamp = '2026-01-01T00:30:00Z';
    mockRequest.mockResolvedValue([{ ...makeLocations()[0], last_visited: timestamp }]);
    const view = renderPage();
    await screen.findByRole('button', { name: 'Inspect Home, Seattle' });
    act(() => {
      view.client.setQueryData(['settings'], {
        locale: 'de-DE', tz_display_default: 'utc', timezone_user: 'America/Los_Angeles',
        decimal_precision: 2, unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
      });
      view.client.setQueryData(locationsKey, [{ ...makeLocations()[0], last_visited: timestamp }], { updatedAt: Date.parse(timestamp) });
    });
    const utcDate = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
    }).format(new Date(timestamp));
    expect(screen.getByText(/20 visits/)).toHaveTextContent(`Last: ${utcDate}`);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Home, Seattle' }));
    const drawer = screen.getByRole('dialog', { name: 'Home, Seattle' });
    expect(within(drawer).getByText(`Last visited ${utcDate}`)).toBeInTheDocument();
    const utcReceipt = new Date(timestamp).toLocaleString('de-DE', {
      timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    expect(within(drawer).getByText(utcReceipt)).toBeInTheDocument();
    act(() => view.client.setQueryData(['settings'], {
      locale: 'de-DE', tz_display_default: 'user', timezone_user: 'America/Los_Angeles',
      decimal_precision: 2, unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
    }));
    const localDate = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric',
    }).format(new Date(timestamp));
    expect(localDate).not.toBe(utcDate);
    expect(screen.getByText(/20 visits/)).toHaveTextContent(`Last: ${localDate}`);
    expect(within(drawer).getByText(`Last visited ${localDate}`)).toBeInTheDocument();
    expect(view.client.getQueryData<VisitedLocation[]>(locationsKey)?.[0].last_visited).toBe(timestamp);
    expect(view.client.getQueryData<VisitedLocation[]>(locationsKey)?.[0].total_duration_s).toBe(3600);
  });
});
