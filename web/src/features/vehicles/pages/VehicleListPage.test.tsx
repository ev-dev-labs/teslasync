/**
 * VehicleListPage — fleet-list contract, hardening & a11y tests.
 *
 * VehicleListPage is the fleet shell. It fans five hooks — `useVehicles`,
 * `useFleetStates`, `useSyncVehicles`, `useDeleteVehicle` (plus `usePinned`
 * for pin-order, `useFleetWorkOrders` for service attention, and
 * `useVehicleLive` to keep the first car's SSE warm) — into
 * a KPI band, an overview bento (per-vehicle battery bars + a status
 * breakdown), and a responsive vehicle-card grid with per-card row actions.
 *
 * Strategy (mirrors the ChargingListPage / ClimateControlPage suites):
 *   - The data + mutation hooks are mocked at the hook boundary so every
 *     branch (loading / error / empty / happy) is deterministic and no
 *     network is touched. `@/api/client`'s `request` seam is neutralised so
 *     any peripheral query (PinButton) stays benignly pending.
 *   - `useUnits` renders for real against a file-level `useSettings` mock with
 *     a flippable distance preference, so the SI→display conversion of the
 *     Total-Range KPI is exercised through the real `convertDistanceFromSI`
 *     boundary for BOTH metric (km) and imperial (mi).
 *   - `useVehicleLive` (the SSE warm-up) is stubbed inert — the page ignores
 *     its return, and mounting real SSE plumbing adds nothing to assert.
 *   - Navigation is asserted through a real `<LocationProbe>` reading
 *     `useLocation()` rather than by mocking the router, so the Compare CTA's
 *     URLSearchParams wiring is verified end-to-end.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options object so assertions can target the rendered English copy. An
// options object carrying `defaultValue` (the delete-confirm message uses it)
// returns that pre-interpolated string. A bare key echoes the key.
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

// File-level useSettings mock (overrides the global test-setup stub) so
// `useUnits` sees a stable shape while `unit_of_length` flips.
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
      settings: { ...defaults, unit_of_length: unitState.length },
      isMiles: unitState.length === 'mi',
      isFahrenheit: false,
      isPSI: false,
      decimals: 2,
      locale: 'en-US',
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  };
});

// Network kill-switch: neutralise the shared fetch seam so PinButton's
// `usePinned`/`useTogglePin` (only their real internals would fire) can never
// reach the backend. `isApiError` etc. stay real.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn(() => new Promise(() => {})) };
});

// The fleet data + mutation hooks become controllable vi.fns.
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return {
    ...actual,
    useVehicles: vi.fn(),
    useFleetStates: vi.fn(),
    useSyncVehicles: vi.fn(),
    useDeleteVehicle: vi.fn(),
  };
});

vi.mock('@/api/hooks/usePinned', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/usePinned')>();
  return { ...actual, usePinned: vi.fn(), useTogglePin: vi.fn() };
});

vi.mock('@/api/hooks/useFleetOps', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useFleetOps')>();
  return { ...actual, useFleetWorkOrders: vi.fn() };
});

// The first-vehicle SSE warm-up is irrelevant to what this page renders.
vi.mock('@/hooks/useVehicleLive', () => ({
  useVehicleLive: () => ({ state: {}, connected: false }),
}));

// jsdom lacks matchMedia; framer-motion (via <FadeIn>/<Stagger*>) reads it.
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

import VehicleListPage from './VehicleListPage';
import {
  useVehicles,
  useFleetStates,
  useSyncVehicles,
  useDeleteVehicle,
} from '@/api/hooks/useVehicles';
import { usePinned, useTogglePin } from '@/api/hooks/usePinned';
import { useFleetWorkOrders, type FleetWorkOrder } from '@/api/hooks/useFleetOps';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { Vehicle } from '@/types/vehicle';
import type { VehicleState } from '@/api/types';

const mockVehicles = vi.mocked(useVehicles);
const mockFleetStates = vi.mocked(useFleetStates);
const mockSync = vi.mocked(useSyncVehicles);
const mockDelete = vi.mocked(useDeleteVehicle);
const mockPinned = vi.mocked(usePinned);
const mockTogglePin = vi.mocked(useTogglePin);
const mockFleetWorkOrders = vi.mocked(useFleetWorkOrders);

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

/** Minimal `UseMutationResult`-shaped stub. */
function mutation(over: Record<string, unknown> = {}): any {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    ...over,
  };
}

function makeVehicle(over: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1,
    vehicle_id: 1,
    vin: 'VIN00000000000001',
    display_name: 'Model 3 Alpha',
    model: 'Model 3',
    trim_badging: 'Performance',
    exterior_color: 'Red',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...over,
  };
}

function makeState(over: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 80,
    rated_range: 400_000,
    ideal_range: 0,
    odometer: 100_000,
    inside_temp: 0,
    outside_temp: 0,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '',
    ...over,
  };
}

// Three vehicles: a charging car (locked, sentry on), a driving car, and an
// offline car whose live state never resolved (null).
const V1 = makeVehicle({ id: 1, vehicle_id: 1, vin: 'VIN00000000000001', display_name: 'Model 3 Alpha', model: 'Model 3', trim_badging: 'Performance' });
const V2 = makeVehicle({ id: 2, vehicle_id: 2, vin: 'VIN00000000000002', display_name: 'Model Y Beta', model: 'Model Y', trim_badging: 'Long Range' });
const V3 = makeVehicle({ id: 3, vehicle_id: 3, vin: 'VIN00000000000003', display_name: 'Model S Gamma', model: 'Model S', trim_badging: 'Plaid' });

const S1 = makeState({ vehicle_id: 1, battery_level: 80, rated_range: 400_000, odometer: 100_000, is_charging: true, charger_power: 11, is_locked: true, sentry_mode: true, state: 'online', software_version: '2026.8.3' });
const S2 = makeState({ vehicle_id: 2, battery_level: 50, rated_range: 250_000, odometer: 200_000, is_charging: false, speed: 30, is_locked: false, sentry_mode: false, state: 'online', software_version: '2026.8.2' });

const OPEN_WORK_ORDER: FleetWorkOrder = {
  id: 91,
  vehicle_id: 2,
  vehicle_display_name: 'Model Y Beta',
  cost_center_id: null,
  cost_center_name: null,
  title: 'Inspect front suspension',
  description: null,
  status: 'open',
  severity: 'high',
  due_odometer_m: null,
  due_at: null,
  scheduled_start_at: null,
  scheduled_end_at: null,
  cost_minor: null,
  currency: null,
  version: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const VEHICLES: Vehicle[] = [V1, V2, V3];
const FLEET_STATES = [
  { vehicle: V1, state: S1 },
  { vehicle: V2, state: S2 },
  { vehicle: V3, state: null },
];

let syncMut: ReturnType<typeof mutation>;
let deleteMut: ReturnType<typeof mutation>;

function installHappyPath() {
  syncMut = mutation();
  deleteMut = mutation();
  mockVehicles.mockReturnValue(qr({ data: VEHICLES }));
  mockFleetStates.mockReturnValue(qr({ data: FLEET_STATES }));
  mockSync.mockReturnValue(syncMut);
  mockDelete.mockReturnValue(deleteMut);
  mockPinned.mockReturnValue(qr({ data: [] }));
  mockTogglePin.mockReturnValue(mutation());
  mockFleetWorkOrders.mockReturnValue(qr({
    data: { items: [OPEN_WORK_ORDER], total: 1, limit: 100, offset: 0 },
  }));
}

/** Renders the live route location so navigation side effects are assertable. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location" data-pathname={loc.pathname} data-search={loc.search} />;
}

function renderPage(entries: string[] = ['/vehicles']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={entries}>
      <QueryClientProvider client={client}>
        <VehicleListPage />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The vehicle-card grid `<section>` — robust scope for per-card assertions. */
function cardGrid(): HTMLElement {
  return document.querySelector('[data-tour="vehicles-list"]') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  unitState.length = 'km';
  installHappyPath();
});

/* ─────────────────────────────── Happy path ─────────────────────────────── */

describe('VehicleListPage — happy path', () => {
  it('renders the shell, the fleet KPI band, and a card per vehicle', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Fleet' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('View, manage, and sync your Tesla vehicles'),
    ).toBeInTheDocument();
    expect(document.title).toContain('Fleet');

    // KPI band — scoped to its labelled landmark to avoid cross-panel collisions.
    const summary = screen.getByRole('region', { name: 'Fleet summary' });
    expect(within(summary).getByText('Total Vehicles')).toBeInTheDocument();
    expect(within(summary).getByText('Avg Battery')).toBeInTheDocument();
    expect(within(summary).getByText('Total Range (km)')).toBeInTheDocument();
    // 1 charging (V1) of 2 vehicles reporting live state (V1, V2).
    expect(within(summary).getByText('1 / 2')).toBeInTheDocument();

    const posture = screen.getByTestId('fleet-operational-brief');
    const readinessMetric = within(posture)
      .getByText('Departure ready')
      .closest('[role="listitem"]');
    expect(readinessMetric).not.toBeNull();
    expect(within(readinessMetric as HTMLElement).getByText('2/3')).toBeInTheDocument();
    expect(within(posture).getByText('Live utilization')).toBeInTheDocument();
    expect(within(posture).getByText('67%')).toBeInTheDocument();
    expect(within(posture).getByText('Software posture')).toBeInTheDocument();
    expect(within(posture).getByText('2 versions')).toBeInTheDocument();
    expect(within(posture).getByText('Service attention')).toBeInTheDocument();
    expect(within(posture).getByText('1 open')).toBeInTheDocument();
    expect(
      within(posture).getByRole('button', { name: /Source: Live vehicle state/ }),
    ).toBeInTheDocument();
    expect(
      within(posture).getByRole('button', { name: /Source: Fleet work orders/ }),
    ).toBeInTheDocument();

    // Every vehicle gets a card, each with its derived status badge.
    const grid = cardGrid();
    expect(within(grid).getByText('Model 3 Alpha')).toBeInTheDocument();
    expect(within(grid).getByText('Model Y Beta')).toBeInTheDocument();
    expect(within(grid).getByText('Model S Gamma')).toBeInTheDocument();
    expect(within(grid).getByText('charging')).toBeInTheDocument();
    expect(within(grid).getByText('driving')).toBeInTheDocument();
    expect(within(grid).getByText('offline')).toBeInTheDocument();
  });

  it('sums the fleet range KPI from SI metres via the km display boundary', async () => {
    renderPage();
    const summary = await screen.findByRole('region', { name: 'Fleet summary' });
    // 400_000 m + 250_000 m = 650_000 m ⇒ 650 km at the display boundary.
    const expected = fmtNumber(convertDistanceFromSI(650_000, 'km'));
    expect(within(summary).getByText(expected)).toBeInTheDocument();
    expect(expected).toBe('650.00');
  });

  it('converts the range KPI to miles when the unit preference is imperial', async () => {
    unitState.length = 'mi';
    renderPage();
    const summary = await screen.findByRole('region', { name: 'Fleet summary' });
    expect(within(summary).getByText('Total Range (mi)')).toBeInTheDocument();
    // 650_000 m / 1609.344 ≈ 403.89 mi — read through the real SI converter.
    const expected = fmtNumber(convertDistanceFromSI(650_000, 'mi'));
    expect(within(summary).getByText(expected)).toBeInTheDocument();
    expect(expected).toBe('403.89');
  });

  it('summarises battery bars and a per-status breakdown in the overview bento', async () => {
    renderPage();
    expect(await screen.findByText('Fleet Battery Status')).toBeInTheDocument();
    expect(screen.getByText('Fleet Status')).toBeInTheDocument();

    // Each loaded vehicle contributes a battery bar labelled with its name; the
    // same name also appears on its card, so a loaded vehicle renders ≥ 2 times.
    expect(screen.getAllByText('Model 3 Alpha').length).toBeGreaterThanOrEqual(2);

    // Status breakdown: exactly one vehicle in each derived status.
    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.getByText('Driving')).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('surfaces software fragmentation and urgent service work in decision details', async () => {
    renderPage();
    const posture = await screen.findByTestId('fleet-operational-brief');
    fireEvent.click(within(posture).getByRole('button', { name: 'Review details' }));

    const drawer = await screen.findByRole('dialog', {
      name: 'Availability and readiness across the fleet details',
    });
    expect(within(drawer).getByText('2 software versions are active')).toBeInTheDocument();
    expect(
      within(drawer).getByText('Urgent service work requires attention (1)'),
    ).toBeInTheDocument();
  });
});

/* ─────────────────────────────── Accessibility ──────────────────────────── */

describe('VehicleListPage — accessibility & derived per-card data', () => {
  it('exposes labelled landmarks and accessible names on icon-only controls', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });

    expect(screen.getByRole('region', { name: 'Fleet summary' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fleet overview' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'All Vehicles' })).toBeInTheDocument();

    const grid = cardGrid();
    // One labelled battery progressbar per card; aria-valuenow tracks the level.
    const bars = within(grid).getAllByRole('progressbar', { name: 'Battery level' });
    expect(bars).toHaveLength(3);
    expect(bars[0]).toHaveAttribute('aria-valuenow', '80');
    expect(bars[1]).toHaveAttribute('aria-valuenow', '50');
    // V3 has no live state ⇒ level defaults to 0 (null-safe), not undefined.
    expect(bars[2]).toHaveAttribute('aria-valuenow', '0');

    // Icon-only row actions + status glyphs carry accessible names.
    expect(within(grid).getByLabelText('Remove Model 3 Alpha')).toBeInTheDocument();
    expect(within(grid).getByLabelText('Locked')).toBeInTheDocument();
    expect(within(grid).getByLabelText('Sentry mode on')).toBeInTheDocument();
    expect(within(grid).getAllByRole('link', { name: /^Open .+ details$/ })).toHaveLength(3);
  });

  it('opens a contextual vehicle preview and continues to full details', async () => {
    renderPage();
    const grid = cardGrid();

    fireEvent.click(await within(grid).findByRole('button', { name: 'Quick view Model 3 Alpha' }));

    const drawer = await screen.findByRole('dialog', { name: 'Model 3 Alpha' });
    expect(within(drawer).getByText('Vehicle preview')).toBeInTheDocument();
    expect(within(drawer).getByText('80.00%')).toBeInTheDocument();
    expect(within(drawer).getByText('400.00 km')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Drive history' }))
      .toHaveAttribute('href', '/drives');
    expect(within(drawer).getByRole('link', { name: 'Charging sessions' }))
      .toHaveAttribute('href', '/charging');
    expect(within(drawer).getByRole('link', { name: 'Visited locations' }))
      .toHaveAttribute('href', '/locations');
    expect(within(drawer).getByRole('link', { name: 'Alerts' }))
      .toHaveAttribute('href', '/notifications/alerts');
    expect(within(drawer).getByRole('link', { name: 'Service history' }))
      .toHaveAttribute('href', '/maintenance');
    expect(within(drawer).getByRole('link', { name: 'Telemetry evidence' }))
      .toHaveAttribute('href', '/signals');

    fireEvent.click(within(drawer).getByRole('button', { name: 'Open vehicle details' }));
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/vehicles/1');
    });
  });

  it('shows the no-live-data placeholder and offline badge for a stateless vehicle', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });
    const grid = cardGrid();
    // Only V3 (null state) shows the placeholder; V1/V2 show live stat chips.
    expect(within(grid).getByText('No live data')).toBeInTheDocument();
    expect(within(grid).getByText('offline')).toBeInTheDocument();
  });

  it('falls back to the VIN and an unknown-model label when naming fields are blank', async () => {
    const bare = makeVehicle({ id: 7, vehicle_id: 7, vin: 'VINBLANK000000007', display_name: '', model: '', trim_badging: '' });
    mockVehicles.mockReturnValue(qr({ data: [bare] }));
    mockFleetStates.mockReturnValue(qr({ data: [{ vehicle: bare, state: null }] }));
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });

    const grid = cardGrid();
    expect(within(grid).getByText(/Unknown model/)).toBeInTheDocument();
    // The VIN backs both the name link and the caption when display_name is blank.
    expect(within(grid).getAllByText('VINBLANK000000007').length).toBeGreaterThanOrEqual(1);
  });
});

/* ─────────────────────────── User interactions ──────────────────────────── */

describe('VehicleListPage — sync & compare actions', () => {
  it('fires the sync mutation when the header Sync button is pressed', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sync from Tesla' }));
    expect(syncMut.mutate).toHaveBeenCalledTimes(1);
  });

  it('renders a dismissible success banner after a completed sync', async () => {
    const m = mutation({ isSuccess: true });
    mockSync.mockReturnValue(m);
    renderPage();
    expect(
      await screen.findByText('Vehicles synced successfully.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Sync failed. Please try again.')).not.toBeInTheDocument();
  });

  it('renders an error banner when a sync fails', async () => {
    mockSync.mockReturnValue(mutation({ isError: true }));
    renderPage();
    expect(
      await screen.findByText('Sync failed. Please try again.'),
    ).toBeInTheDocument();
  });

  it('navigates to the comparison route with the first two vehicle ids', async () => {
    renderPage();
    const probe = screen.getByTestId('location');
    fireEvent.click(await screen.findByRole('button', { name: 'Compare vehicles' }));

    await waitFor(() =>
      expect(probe.getAttribute('data-pathname')).toBe('/vehicle-comparison'),
    );
    expect(probe.getAttribute('data-search')).toContain('leftId=1');
    expect(probe.getAttribute('data-search')).toContain('rightId=2');
  });

  it('opens the dedicated fleet-operations workspace from the posture brief', async () => {
    renderPage();
    const probe = screen.getByTestId('location');
    fireEvent.click(await screen.findByRole('button', { name: 'Fleet operations' }));

    await waitFor(() =>
      expect(probe.getAttribute('data-pathname')).toBe('/fleet-operations'),
    );
  });

  it('hides the Compare action when the fleet has fewer than two vehicles', async () => {
    mockVehicles.mockReturnValue(qr({ data: [V1] }));
    mockFleetStates.mockReturnValue(qr({ data: [{ vehicle: V1, state: S1 }] }));
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });
    expect(screen.queryByRole('button', { name: 'Compare vehicles' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync from Tesla' })).toBeInTheDocument();
  });
});

describe('VehicleListPage — delete flow', () => {
  it('opens a confirm dialog and fires the delete mutation on confirm', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });

    fireEvent.click(screen.getByLabelText('Remove Model 3 Alpha'));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/Are you sure you want to remove "Model 3 Alpha"/),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(deleteMut.mutate).toHaveBeenCalledWith(1, expect.anything());
  });

  it('cancelling the delete dialog leaves the mutation untouched', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });

    fireEvent.click(screen.getByLabelText('Remove Model Y Beta'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(deleteMut.mutate).not.toHaveBeenCalled();
  });
});

/* ──────────────────────────── Pinned ordering ───────────────────────────── */

describe('VehicleListPage — pinned ordering', () => {
  it('floats a pinned vehicle to the head of the grid', async () => {
    mockPinned.mockReturnValue(qr({ data: [{ id: 9, item_type: 'vehicle', item_id: 3, position: 0 }] }));
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });

    const links = within(cardGrid()).getAllByRole('link', { name: /^Open .+ details$/ });
    // V3 (id 3) is pinned to position 0 ⇒ its card now leads the grid.
    expect(links[0]).toHaveAccessibleName('Open Model S Gamma details');
  });

  it('keeps natural fleet order when there are no pins', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });
    const links = within(cardGrid()).getAllByRole('link', { name: /^Open .+ details$/ });
    expect(links[0]).toHaveAccessibleName('Open Model 3 Alpha details');
  });
});

/* ──────────────────── Loading / error / empty branches ───────────────────── */

describe('VehicleListPage — loading, error & empty states', () => {
  it('renders the skeleton while the vehicles query is pending', () => {
    mockVehicles.mockReturnValue(qr({ isLoading: true, data: undefined }));
    renderPage();

    expect(screen.getByTestId('vehicle-list-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Fleet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compare vehicles' })).not.toBeInTheDocument();
  });

  it('renders a retryable error panel when the vehicles query fails', async () => {
    const refetch = vi.fn();
    mockVehicles.mockReturnValue(
      qr({ error: new Error('boom'), isError: true, data: undefined, refetch }),
    );
    renderPage();

    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state and wires its CTA when the fleet is empty', () => {
    mockVehicles.mockReturnValue(qr({ data: [] }));
    mockFleetStates.mockReturnValue(qr({ data: [] }));
    renderPage();

    expect(screen.getByText('No vehicles yet')).toBeInTheDocument();
    expect(screen.getByText(/Connect your Tesla account/)).toBeInTheDocument();
    // No KPI band renders on the empty branch.
    expect(screen.queryByText('1 / 2')).not.toBeInTheDocument();

    const syncButtons = screen.getAllByRole('button', { name: 'Sync from Tesla' });
    fireEvent.click(syncButtons[syncButtons.length - 1]);
    expect(syncMut.mutate).toHaveBeenCalled();
  });

  it('shows fleet-states skeletons while keeping every card visible', () => {
    mockFleetStates.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderPage();

    // Pending live state stays neutral instead of briefly classifying every
    // registered vehicle as offline or reporting zero-valued fleet KPIs.
    expect(screen.getByText('Resolving live state')).toBeInTheDocument();
    expect(screen.queryByText('3 vehicle unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('0 / 0')).not.toBeInTheDocument();
    // Every card still renders, each with the null-safe no-live-data placeholder.
    expect(screen.getAllByText('No live data')).toHaveLength(3);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('surfaces a retryable error in both overview panels when fleet states fail', () => {
    const refetch = vi.fn();
    mockFleetStates.mockReturnValue(
      qr({ isError: true, error: new Error('down'), data: undefined, refetch }),
    );
    renderPage();

    // Battery panel + status panel each render their own error affordance.
    expect(screen.getAllByText("Can't reach server").length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(refetch).toHaveBeenCalled();
  });

  it('keeps live fleet content visible when service attention is unavailable', async () => {
    mockFleetWorkOrders.mockReturnValue(
      qr({ isError: true, error: new Error('work orders unavailable'), data: undefined }),
    );
    renderPage();

    expect(
      await screen.findByText('Service attention is temporarily unavailable'),
    ).toBeInTheDocument();
    expect(screen.getByText('Fleet availability and live state remain visible, but maintenance work orders could not be loaded.')).toBeInTheDocument();
    expect(within(cardGrid()).getByText('Model 3 Alpha')).toBeInTheDocument();
  });
});
