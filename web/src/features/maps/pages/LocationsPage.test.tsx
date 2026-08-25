/**
 * LocationsPage contract + hardening tests.
 *
 * LocationsPage reads a page of visited locations via a raw `useQuery` +
 * `request('/locations?…')` and derives a KPI band, two leaderboards, and a
 * searchable/paginated detail list from them. The network seam (`@/api/client`
 * `request`) and `useSelectedVehicle` are mocked so every branch — loading,
 * error, empty, no-vehicle, and the fully-populated happy path — is exercised
 * deterministically. `useRangeState` is mocked to a fixed wide window so the
 * client-side `last_visited` range filter is clock-independent. The two
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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

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

// Fixed, wide range so the page's client-side `last_visited` filter includes
// every fixture row regardless of the machine clock.
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

// Prop-capturing stub for the two leaderboard panels — records each panel's
// props keyed by its (translated) seriesLabel ('Visits' / 'Hours') and renders
// a state marker so the page's loading/error/empty/data branch selection and
// the derived chart data are both assertable without mounting recharts.
const captured = vi.hoisted(() => ({ panels: {} as Record<string, any> }));

vi.mock('../components/LocationLeaderboardPanel', () => ({
  LocationLeaderboardPanel: (props: any) => {
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
  AIAutoNameUnnamedLocations: (props: any) => (
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

function installVehicles(over: Record<string, unknown> = {}) {
  const setVehicleId = vi.fn();
  mockSelectedVehicle.mockReturnValue({
    vehicleId: 2,
    vehicle: null,
    vehicles: [
      { id: 2, display_name: 'Model 3', vin: 'V3' },
      { id: 5, display_name: '', vin: 'VIN5' },
    ] as any,
    setVehicleId,
    ...over,
  } as any);
  return setVehicleId;
}

function renderPage(entries: string[] = ['/locations']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={entries}>
      <QueryClientProvider client={client}>
        <LocationsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function kpiRegion() {
  return screen.getByRole('region', { name: 'Location summary' });
}

// Read a MetricCard's value by its label so numeric assertions never collide.
function kpiValue(label: string): string {
  const labelEl = within(kpiRegion()).getByText(label);
  const card = labelEl.closest('[data-role="metric-card"]') as HTMLElement;
  return card.querySelector('[data-role="metric-value"]')?.textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  captured.panels = {};
  rangeState.start = '2000-01-01';
  rangeState.end = '2099-12-31';
  installVehicles();
  mockRequest.mockResolvedValue(makeLocations() as any);
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
  it('tones the badge gold for #1, cyan for the podium, muted otherwise', () => {
    expect(rankChipClass(0)).toContain('amber');
    expect(rankChipClass(1)).toContain('cyan');
    expect(rankChipClass(2)).toContain('cyan');
    expect(rankChipClass(3)).toContain('var(--text-muted)');
    expect(rankChipClass(9)).not.toContain('amber');
  });
});

/* ─────────────────────────── Component tests ─────────────────────────── */

describe('LocationsPage — shell & request contract', () => {
  it('renders the title/subtitle and requests SI locations with snake_case params (no /api/v1)', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Visited Locations' })).toBeInTheDocument();
    expect(screen.getByText("Places you've been — ranked by frequency")).toBeInTheDocument();
    await waitFor(() => expect(mockRequest).toHaveBeenCalled());
    expect(mockRequest).toHaveBeenCalledWith('/locations?vehicle_id=2&limit=50&offset=0');
    expect(document.title).toContain('Visited Locations');
  });
});

describe('LocationsPage — KPI band', () => {
  it('derives every KPI from the loaded rows', async () => {
    renderPage();
    await waitFor(() => expect(kpiValue('Total Visits')).toBe('46'));
    expect(kpiValue('Unique Places')).toBe('4');
    // Regression: the coordinate row (#4) is NOT counted as a city.
    expect(kpiValue('Unique Cities')).toBe('3');
    expect(kpiValue('Most Visited')).toBe('Home, Seattle');
    // formatDuration renders SI seconds in the user's (hour) preference.
    expect(kpiValue('Total Time')).toMatch(/\bh\b/);
  });

  it('excludes rows without a last_visited timestamp from the range-filtered aggregates', async () => {
    mockRequest.mockResolvedValue([
      { id: 9, address_name: 'Ghost, Nowhere', visit_count: 99, total_duration_s: 100, last_visited: null },
      { id: 1, address_name: 'Home, Seattle', visit_count: 10, total_duration_s: 500, last_visited: '2025-03-10T08:00:00Z' },
    ] as any);
    renderPage();
    await waitFor(() => expect(kpiValue('Unique Places')).toBe('1'));
    // Ghost's 99 visits must not leak into any aggregate or the list.
    expect(kpiValue('Total Visits')).toBe('10');
    expect(screen.queryByText('Ghost, Nowhere')).not.toBeInTheDocument();
  });

  it('shows a "—" placeholder for Most Visited when there is no data', async () => {
    mockRequest.mockResolvedValue([] as any);
    renderPage();
    await waitFor(() => expect(kpiValue('Total Visits')).toBe('0'));
    expect(kpiValue('Most Visited')).toBe('—');
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
    expect(captured.panels['Hours'].data.map((d: any) => d.name)).toEqual([
      'Office, Bellevue',
      'Home, Seattle',
      'Cafe, Tacoma',
      '47.6062,-122.3321',
    ]);
    expect(captured.panels['Hours'].data[0]).toEqual({ name: 'Office, Bellevue', value: 20 });

    // Panel wiring (titles, colours, empty copy) is passed through intact.
    expect(captured.panels['Visits'].title).toBe('Top Locations by Visits');
    expect(captured.panels['Visits'].color).toBe('#10b981');
    expect(captured.panels['Hours'].emptyMessage).toBe('No time-spent data available');
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
    mockRequest.mockResolvedValue([] as any);
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

describe('LocationsPage — vehicle picker', () => {
  it('lists vehicles (vin fallback for a blank name) and propagates a change', async () => {
    const setVehicleId = installVehicles();
    renderPage();

    const select = await screen.findByRole('combobox', { name: 'Select vehicle' });
    expect(within(select).getByText('Model 3')).toBeInTheDocument();
    // Blank display_name falls back to the VIN.
    expect(within(select).getByText('VIN5')).toBeInTheDocument();

    fireEvent.change(select, { target: { value: '5' } });
    expect(setVehicleId).toHaveBeenCalledWith(5);
  });

  it('hides the picker and skips the request when no vehicle is available', async () => {
    installVehicles({ vehicleId: null, vehicles: [] });
    renderPage();

    expect(await screen.findByText('No visited locations recorded yet')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('LocationsPage — loading & error states', () => {
  it('shows skeletons + leaderboard loaders and no KPI cards while fetching', () => {
    mockRequest.mockReturnValue(new Promise(() => {}) as any); // never resolves
    const { container } = renderPage();

    expect(screen.getByTestId('lb-loading-Visits')).toBeInTheDocument();
    expect(screen.getByTestId('lb-loading-Hours')).toBeInTheDocument();
    // KPI cards are replaced by skeletons — no metric labels yet.
    expect(within(kpiRegion()).queryByText('Unique Places')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
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
