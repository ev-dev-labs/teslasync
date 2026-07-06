/**
 * SharingTripsPage — behaviour + hardening coverage.
 *
 * SharingTripsPage default-exports a thin orchestrator that composes a KPI
 * band, a selectable recent-trips listbox (the hero), a redacted share
 * preview, the static share-card hint, and the gated Helix AI drafter. The
 * page owns exactly one piece of state — the selected trip id — and fans it
 * out to the preview and the AI card. These tests exercise the page's own
 * orchestration + null-safety end-to-end; the pure sub-components
 * (TripShareRow / SelectedTripPreview / aggregateTripKpis) have their own
 * co-located coverage and are rendered for real here as integration.
 *
 * What is covered:
 *   1. READY   — KPI totals aggregate every trip, each trip renders as a
 *      listbox option, the static hint + AI card mount, and nothing is
 *      pre-selected.
 *   2. LOADING — the KPI band + recent list show skeletons and leak no
 *      resolved values.
 *   3. ERROR   — a hard error (nothing cached) degrades BOTH the KPI band and
 *      the recent list to QueryError, and Retry is wired to refetch.
 *   4. RESILIENT ERROR — a background-refetch error that still has cached data
 *      keeps rendering the totals + list (the regression: the old `error ?`
 *      guard blew the cached list away).
 *   5. EMPTY   — the recent list shows its EmptyState (never a blank panel),
 *      the KPI band shows real zeros (empty, not error), and the AI card gets
 *      no trip.
 *   6. SELECTION — clicking a row selects it (aria-selected), fills the
 *      preview, and feeds the AI card the selected trip id.
 *   7. STALE SELECTION — when the list swaps out from under a selection the
 *      preview + AI card fall back to empty instead of pointing at a trip
 *      that is no longer on screen (the derived-id fix).
 *   8. VEHICLE PICKER — changing the select calls setVehicleId with the numeric
 *      id, the >0 guard rejects the placeholder, the refresh control is
 *      labelled + wired to refetch, and the picker hides with an empty fleet.
 *   9. A11Y — the KPI band + listbox expose labelled landmark roles.
 *
 * Network is never hit: the trips hook, vehicle picker, unit formatters, and
 * the heavyweight AI card are all stubbed. i18n is stubbed so visible copy is
 * the English fallback with {{placeholder}} interpolation applied.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { Trip } from '@/api/types';

// ── Hoisted, per-test controllable state ─────────────────────────────
const h = vi.hoisted(() => ({
  tripsQuery: undefined as unknown,
  vehicleId: 7 as number | null,
  vehicles: [] as Array<{ id: number; display_name: string; vin: string }>,
}));

const refetchMock = vi.fn();
const setVehicleIdMock = vi.fn();

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useTrips', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useTrips')>();
  return { ...actual, useTrips: () => h.tripsQuery };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId,
    vehicle: null,
    vehicles: h.vehicles,
    setVehicleId: setVehicleIdMock,
  }),
}));

// Deterministic formatters — echo the raw SI number with a unit suffix so
// assertions read cleanly and don't depend on the real unit-conversion lib
// (which has its own tests). unitPrefs is included because useFormatting
// (via <Currency> in the preview) reads unitPrefs.distance.
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: undefined,
    },
    formatDistance: (v: number | null | undefined) => `${v ?? 0}m`,
    formatEnergy: (v: number | null | undefined) => `${v ?? 0}Wh`,
    formatSpeed: (v: number | null | undefined) => String(v ?? 0),
    formatTemperature: (v: number | null | undefined) => String(v ?? 0),
    formatPressure: (v: number | null | undefined) => String(v ?? 0),
    formatDuration: (v: number | null | undefined) => String(v ?? 0),
    formatPower: (v: number | null | undefined) => String(v ?? 0),
  }),
}));

// The AI drafter is a gated, network-driven surface with its own dedicated
// suite. Here we stub it to a marker that reflects the tripId prop the page
// feeds it, so we can prove the selection wiring (and the stale-selection
// fix) without pulling in useAiStream / fetch / useSettings gating.
vi.mock('@/components/ai/AITripPostcardShareCardImageGeneration', () => ({
  AITripPostcardShareCardImageGeneration: ({ tripId }: { tripId?: number }) => (
    <div data-testid="ai-card" data-trip-id={tripId ?? ''} />
  ),
}));

import SharingTripsPage from './SharingTripsPage';

// jsdom lacks matchMedia (framer-motion's useReducedMotion via FadeIn +
// DataFreshness). Install a permissive stub before any render.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// ── Fixtures ─────────────────────────────────────────────────────────
function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 1,
    vehicle_id: 7,
    name: 'Trip',
    start_date: '2024-03-01T08:00:00Z',
    end_date: '2024-03-01T09:00:00Z',
    started_at: '2024-03-01T08:00:00Z',
    ended_at: '2024-03-01T09:00:00Z',
    total_distance_m: 1000,
    total_energy_wh: 500,
    total_duration_s: 3600,
    total_cost: 0,
    drive_count: 1,
    charge_count: 0,
    created_at: '2024-03-01T08:00:00Z',
    ...overrides,
  };
}

// Three trips with distinctive, separator-free totals so KPI aggregates are
// unambiguous: distance 12000+50000+8000=70000m, energy 3000+9000+2000=14000Wh,
// drives 2+3+1=6, count 3.
const tripA = makeTrip({
  id: 101,
  name: 'Morning commute',
  total_distance_m: 12000,
  total_energy_wh: 3000,
  total_duration_s: 1800,
  drive_count: 2,
  charge_count: 1,
  total_cost: 5,
});
const tripB = makeTrip({
  id: 102,
  name: 'Weekend trip',
  total_distance_m: 50000,
  total_energy_wh: 9000,
  total_duration_s: 5400,
  drive_count: 3,
});
const tripC = makeTrip({
  id: 103,
  name: null,
  total_distance_m: 8000,
  total_energy_wh: 2000,
  total_duration_s: 600,
  drive_count: 1,
  end_date: null,
});

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeQuery(overrides: Partial<QueryStub> = {}): QueryStub {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: refetchMock,
    ...overrides,
  };
}

function tree(qc: QueryClient) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/sharing/trips']}>
        <SharingTripsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(tree(qc));
  return { ...result, rerenderPage: () => result.rerender(tree(qc)) };
}

/** The page's icon-only refresh <button> (disambiguated from the freshness
 *  chip, which also exposes an accessible name of "Refresh" via role=button). */
function pageRefreshButton(): HTMLElement {
  const candidates = screen.getAllByRole('button', { name: 'Refresh' });
  const real = candidates.find((el) => el.tagName === 'BUTTON');
  if (!real) throw new Error('page refresh button not found');
  return real;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.vehicles = [
    { id: 7, display_name: 'Model 3', vin: 'VIN7' },
    { id: 9, display_name: 'Model Y', vin: 'VIN9' },
  ];
  h.tripsQuery = makeQuery({ data: [tripA, tripB, tripC] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── READY ─────────────────────────────────────────────────────────── */

describe('SharingTripsPage — ready', () => {
  it('aggregates KPI totals across every trip and lists each as a listbox option', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Share a trip' }),
    ).toBeInTheDocument();

    const kpis = screen.getByRole('region', { name: 'Trip totals' });
    for (const label of ['Shareable trips', 'Total distance', 'Total energy', 'Total drives']) {
      expect(within(kpis).getByText(label)).toBeInTheDocument();
    }
    // count=3, distance sum=70000m, energy sum=14000Wh, drives sum=6.
    expect(within(kpis).getByText('3')).toBeInTheDocument();
    expect(within(kpis).getByText('70000m')).toBeInTheDocument();
    expect(within(kpis).getByText('14000Wh')).toBeInTheDocument();
    expect(within(kpis).getByText('6')).toBeInTheDocument();

    const list = screen.getByRole('listbox', { name: 'Recent trips' });
    expect(within(list).getByRole('option', { name: 'Morning commute' })).toBeInTheDocument();
    expect(within(list).getByRole('option', { name: 'Weekend trip' })).toBeInTheDocument();
    // tripC has a null name → falls back to "Trip #103".
    expect(within(list).getByRole('option', { name: 'Trip #103' })).toBeInTheDocument();

    // Static hint + gated AI card both mount; nothing is pre-selected.
    expect(screen.getByText('Static share cards')).toBeInTheDocument();
    expect(screen.getByTestId('ai-card')).toHaveAttribute('data-trip-id', '');
    expect(
      screen.getByText(/Select a trip above to preview what you/i),
    ).toBeInTheDocument();
  });
});

/* ── LOADING ───────────────────────────────────────────────────────── */

describe('SharingTripsPage — loading', () => {
  it('shows skeletons and leaks no resolved KPI values on a cold load', () => {
    h.tripsQuery = makeQuery({
      isLoading: true,
      isFetching: true,
      data: undefined,
      dataUpdatedAt: 0,
    });

    const { container } = renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Share a trip' }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    // No resolved KPI labels or list options leak while loading.
    expect(screen.queryByText('Shareable trips')).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Recent trips' })).not.toBeInTheDocument();
  });
});

/* ── ERROR (hard, nothing cached) ──────────────────────────────────── */

describe('SharingTripsPage — hard error', () => {
  it('degrades the KPI band and recent list to QueryError with a wired Retry', () => {
    h.tripsQuery = makeQuery({
      isError: true,
      error: new Error('network down'),
      data: undefined,
      dataUpdatedAt: 0,
    });

    renderPage();

    // Both the KPI band and the recent-list panel surface the banner (2×).
    const banners = screen.getAllByText(/Can't reach server/i);
    expect(banners.length).toBe(2);
    // The misleading zero totals must NOT render in the error state.
    expect(screen.queryByText('Shareable trips')).not.toBeInTheDocument();

    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBe(2);
    fireEvent.click(retries[0]);
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});

/* ── RESILIENT ERROR (background refetch, data still cached) ────────── */

describe('SharingTripsPage — background error with cached data', () => {
  it('keeps rendering the cached totals + list instead of the destructive error banner', () => {
    h.tripsQuery = makeQuery({
      isError: true,
      error: new Error('transient blip'),
      data: [tripA, tripB, tripC],
    });

    renderPage();

    // Regression guard: the old `error ?` branch blew the cached list away.
    expect(screen.queryByText(/Can't reach server/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Morning commute' }),
    ).toBeInTheDocument();
    const kpis = screen.getByRole('region', { name: 'Trip totals' });
    expect(within(kpis).getByText('70000m')).toBeInTheDocument();
  });
});

/* ── EMPTY ─────────────────────────────────────────────────────────── */

describe('SharingTripsPage — empty', () => {
  it('shows a recent-list EmptyState (never blank), real zero totals, and no selected trip', () => {
    h.tripsQuery = makeQuery({ data: [] });

    renderPage();

    expect(
      screen.getByText(/No recent trips\. Drive your vehicle to populate this list\./i),
    ).toBeInTheDocument();
    // Empty is not an error — the KPI band still renders with honest zeros.
    const kpis = screen.getByRole('region', { name: 'Trip totals' });
    expect(within(kpis).getByText('Shareable trips')).toBeInTheDocument();
    expect(within(kpis).getByText('0m')).toBeInTheDocument();
    expect(screen.getByTestId('ai-card')).toHaveAttribute('data-trip-id', '');
  });
});

/* ── SELECTION ─────────────────────────────────────────────────────── */

describe('SharingTripsPage — selection', () => {
  it('selects a clicked row, fills the preview, and feeds the AI card its id', () => {
    renderPage();

    const option = screen.getByRole('option', { name: 'Morning commute' });
    expect(option).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(option);

    // Row reflects selection via aria-selected (not colour alone).
    expect(
      screen.getByRole('option', { name: 'Morning commute' }),
    ).toHaveAttribute('aria-selected', 'true');

    // The AI card now receives the resolved trip id.
    expect(screen.getByTestId('ai-card')).toHaveAttribute('data-trip-id', '101');

    // The preview swaps from its empty state to the redacted summary.
    expect(
      screen.queryByText(/Select a trip above to preview what you/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
    // The trip name is now on screen twice: the row + the preview.
    expect(screen.getAllByText('Morning commute').length).toBeGreaterThanOrEqual(2);
  });
});

/* ── STALE SELECTION ───────────────────────────────────────────────── */

describe('SharingTripsPage — stale selection', () => {
  it('clears the preview + AI card when the selected trip leaves the list', () => {
    const { rerenderPage } = renderPage();

    fireEvent.click(screen.getByRole('option', { name: 'Morning commute' }));
    expect(screen.getByTestId('ai-card')).toHaveAttribute('data-trip-id', '101');

    // Swap the list out from under the selection (e.g. a vehicle switch).
    const tripD = makeTrip({ id: 201, name: 'City loop' });
    const tripE = makeTrip({ id: 202, name: 'Airport run' });
    h.tripsQuery = makeQuery({ data: [tripD, tripE] });
    rerenderPage();

    // The stale pick (101) is gone; the derived id fix falls back to empty
    // instead of pointing the AI card at an off-screen trip.
    expect(screen.getByTestId('ai-card')).toHaveAttribute('data-trip-id', '');
    expect(
      screen.getByText(/Select a trip above to preview what you/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Morning commute' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'City loop' })).toBeInTheDocument();
  });
});

/* ── VEHICLE PICKER + REFRESH ──────────────────────────────────────── */

describe('SharingTripsPage — vehicle picker + refresh', () => {
  it('commits a valid vehicle change, rejects the empty placeholder, and refreshes', () => {
    renderPage();

    const select = screen.getByRole('combobox', { name: 'Select vehicle' });
    fireEvent.change(select, { target: { value: '9' } });
    expect(setVehicleIdMock).toHaveBeenCalledWith(9);

    // The `Number.isFinite(n) && n > 0` guard rejects the placeholder ('' → 0).
    fireEvent.change(select, { target: { value: '' } });
    expect(setVehicleIdMock).toHaveBeenCalledTimes(1);

    // Icon-only refresh control is labelled and wired to refetch.
    fireEvent.click(pageRefreshButton());
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('hides the vehicle picker when the fleet is empty but keeps the refresh control', () => {
    h.vehicles = [];
    h.vehicleId = null;

    renderPage();

    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();
    expect(pageRefreshButton()).toBeInTheDocument();
    // The deterministic page still renders end-to-end without a vehicle.
    expect(screen.getByRole('listbox', { name: 'Recent trips' })).toBeInTheDocument();
  });
});
