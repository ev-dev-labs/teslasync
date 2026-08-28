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
/**
 * Fleet-state entries in the shape `useFleetStates` really produces: each
 * carries its outcome AND the instant its reading was observed, so the page
 * can tell a resolved reading apart from an absent snapshot, from a transport
 * failure, and from a reading retained through an outage. V3 has no
 * snapshot — that is `missing`, NOT offline.
 */
const OBSERVED_AT = Date.now() - 1_000;
const VERIFIED_FIELDS = [
  'state',
  'battery_level',
  'rated_range',
  'speed',
  'is_charging',
  'software_version',
] as const;

function resolvedEntry(vehicle: Vehicle, state: VehicleState, observedAt = OBSERVED_AT) {
  return {
    vehicle,
    state,
    outcome: 'resolved' as const,
    freshness: 'fresh' as const,
    verifiedFields: VERIFIED_FIELDS,
    stale: false,
    observedAt,
    receivedAt: observedAt,
  };
}
function missingEntry(vehicle: Vehicle) {
  return {
    vehicle,
    state: null,
    outcome: 'missing' as const,
    freshness: 'unknown' as const,
    verifiedFields: [],
    stale: false,
    observedAt: null,
    receivedAt: OBSERVED_AT,
  };
}
function failedEntry(vehicle: Vehicle) {
  return {
    vehicle,
    state: null,
    outcome: 'failed' as const,
    freshness: 'unknown' as const,
    verifiedFields: [],
    stale: false,
    observedAt: null,
    receivedAt: OBSERVED_AT,
    error: new Error('ECONNREFUSED'),
  };
}
function retainedEntry(vehicle: Vehicle, state: VehicleState, observedAt = OBSERVED_AT) {
  return {
    vehicle,
    state,
    outcome: 'failed' as const,
    freshness: 'stale' as const,
    verifiedFields: VERIFIED_FIELDS,
    stale: true,
    // Deliberately OLD: a retained reading keeps the age it was captured at.
    observedAt,
    receivedAt: OBSERVED_AT + 600_000,
    error: new Error('gateway timeout'),
  };
}

const FLEET_STATES = [
  resolvedEntry(V1, S1),
  resolvedEntry(V2, S2),
  missingEntry(V3),
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

/** The `<OperationalBrief>` metric tile whose label matches, for scoped reads. */
function briefMetric(label: string): HTMLElement {
  const posture = screen.getByTestId('fleet-operational-brief');
  const tile = within(posture).getByText(label).closest('[role="listitem"]');
  if (tile == null) throw new Error(`no brief metric tile for "${label}"`);
  return tile as HTMLElement;
}

/**
 * The brief's LIVE VEHICLE STATE freshness chip.
 *
 * The brief renders two chips side by side (live state + work orders), so an
 * unscoped "just now" assertion would match the wrong one. `DataFreshnessAuto`
 * names its source in the accessible label, which is the stable seam.
 */
function liveStateFreshnessChip(): HTMLElement {
  const posture = screen.getByTestId('fleet-operational-brief');
  return within(posture).getByLabelText(/Source: Live vehicle state/);
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
    // Denominator is the COVERED fleet (V1 + V2 have fresh readings), not the
    // 3 registered vehicles: V3 has no snapshot and cannot be judged ready or
    // not ready.
    expect(within(readinessMetric as HTMLElement).getByText('2/2')).toBeInTheDocument();
    expect(within(readinessMetric as HTMLElement).getByText(
      /Based on 2 of 3 vehicles with a current battery reading/,
    )).toBeInTheDocument();
    expect(within(posture).getByText('Live utilization')).toBeInTheDocument();
    // V1 charging + V2 driving out of 2 covered = 100 %, not 67 % of 3.
    expect(within(posture).getByText('100%')).toBeInTheDocument();
    expect(within(posture).getByText('Software posture')).toBeInTheDocument();
    expect(within(posture).getByText('2 versions')).toBeInTheDocument();
    expect(within(posture).getByText(
      'Based on 2 of 3 vehicles with a current software reading.',
    )).toBeInTheDocument();
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
    // V3 has NO snapshot. Absence is unknown, never a confident "offline".
    expect(within(grid).getByText('Unknown')).toBeInTheDocument();
    expect(within(grid).queryByText('offline')).toBeNull();
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

    // Status breakdown counts ONLY vehicles with an actual reading. V3 has no
    // snapshot, so it is excluded and disclosed as partial coverage rather
    // than counted as offline.
    expect(screen.getByRole('progressbar', { name: 'Charging' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Driving' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Offline' })).toBeNull();
    expect(screen.getByTestId('fleet-status-partial')).toBeInTheDocument();
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
    // V3 has no live state ⇒ the level is UNKNOWN. `aria-valuenow="0"` would
    // announce "0 percent", a reading the vehicle never produced; an indefinite
    // progressbar (no aria-valuenow) is the honest representation.
    expect(bars[2]).not.toHaveAttribute('aria-valuenow');
    expect(within(grid).getByText('—')).toBeInTheDocument();

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

  it('shows the no-live-data placeholder and an UNKNOWN badge for a stateless vehicle', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });
    const grid = cardGrid();
    // Only V3 (no snapshot) shows the placeholder; V1/V2 show live stat chips.
    expect(within(grid).getByText('No live data')).toBeInTheDocument();
    // "We could not resolve this car" must never be rendered as "this car is
    // offline" — that is an operational claim we have no evidence for.
    expect(within(grid).getByText('Unknown')).toBeInTheDocument();
    expect(within(grid).queryByText('offline')).toBeNull();
  });

  it('falls back to the VIN and an unknown-model label when naming fields are blank', async () => {
    const bare = makeVehicle({ id: 7, vehicle_id: 7, vin: 'VINBLANK000000007', display_name: '', model: '', trim_badging: '' });
    mockVehicles.mockReturnValue(qr({ data: [bare] }));
    mockFleetStates.mockReturnValue(qr({ data: [missingEntry(bare)] }));
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

  it('does NOT paint the whole fleet as offline while live state is still loading', () => {
    // Regression guard: the status counts are derived from the VEHICLE list,
    // and deriveVehicleStatus(null) === 'offline', so before any live state
    // arrives every vehicle counted as offline and the old
    // `counts.length === 0` skeleton guard was dead code. The panel showed a
    // confident "3 Offline" breakdown built from nothing.
    mockFleetStates.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    renderPage();

    expect(screen.getByTestId('fleet-status-skeleton')).toBeInTheDocument();
    // The breakdown bar is a progressbar labelled with the status name.
    expect(screen.queryByRole('progressbar', { name: 'Offline' })).toBeNull();
    // The panel header still anchors the section — nothing is hidden.
    expect(screen.getByText('Fleet Status')).toBeInTheDocument();
  });

  it('keeps the retained status breakdown during a BACKGROUND fleet-state refresh', () => {
    mockFleetStates.mockReturnValue(
      qr({ data: FLEET_STATES, isFetching: true, isLoading: false }),
    );
    renderPage();

    // Retained state means real counts — no skeleton, no error surface.
    expect(screen.queryByTestId('fleet-status-skeleton')).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Charging' })).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).toBeNull();
  });

  it('keeps the retained status breakdown when a background refresh FAILS', () => {
    mockFleetStates.mockReturnValue(
      qr({ data: FLEET_STATES, isError: true, error: new Error('502 Bad Gateway') }),
    );
    renderPage();

    expect(screen.queryByTestId('fleet-status-skeleton')).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Charging' })).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).toBeNull();
  });

  it('shows the error surface — never a fabricated breakdown — on total fleet-state failure', () => {
    mockFleetStates.mockReturnValue(
      qr({ data: [failedEntry(V1), failedEntry(V2), failedEntry(V3)], isLoading: false }),
    );
    renderPage();

    expect(screen.getAllByText("Can't reach server").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('fleet-status-skeleton')).toBeNull();
    expect(screen.queryByRole('progressbar', { name: 'Offline' })).toBeNull();
  });

  it('surfaces a retryable error in both overview panels when every fleet-state request fails', () => {
    // Production path: useFleetStates resolves per vehicle, so a total outage
    // arrives as a SUCCESSFUL array of `outcome: 'failed'` entries and
    // `isError` stays false. The panels must read the outcomes, not isError.
    const refetch = vi.fn();
    mockFleetStates.mockReturnValue(
      qr({ data: [failedEntry(V1), failedEntry(V2), failedEntry(V3)], isError: false, refetch }),
    );
    renderPage();

    // Battery panel + status panel each render their own error affordance.
    expect(screen.getAllByText("Can't reach server").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('progressbar', { name: 'Offline' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]!);
    expect(refetch).toHaveBeenCalled();
  });

  it('shows an honest empty state — not an outage — when every vehicle merely lacks a snapshot', () => {
    // All 204/null: the backend answered, there is simply nothing to report.
    // This must NOT look like the outage case above.
    mockFleetStates.mockReturnValue(
      qr({ data: [missingEntry(V1), missingEntry(V2), missingEntry(V3)] }),
    );
    renderPage();

    expect(screen.queryByText("Can't reach server")).toBeNull();
    expect(screen.queryByRole('progressbar', { name: 'Offline' })).toBeNull();
    expect(screen.getByText('No fleet status data yet')).toBeInTheDocument();
  });

  it('counts only resolved vehicles and discloses the rest as partial coverage', () => {
    mockFleetStates.mockReturnValue(
      qr({ data: [resolvedEntry(V1, S1), missingEntry(V2), failedEntry(V3)] }),
    );
    renderPage();

    expect(screen.getByRole('progressbar', { name: 'Charging' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Offline' })).toBeNull();
    const notice = screen.getByTestId('fleet-status-partial');
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent(/rather than counted as offline/i);
  });

  it('keeps retained state visible but excludes it from current status counts', () => {
    mockFleetStates.mockReturnValue(
      qr({ data: [retainedEntry(V1, S1), resolvedEntry(V2, S2), missingEntry(V3)] }),
    );
    renderPage();

    // The retained reading remains on its vehicle card, but it cannot assert
    // that the vehicle is still charging after the refresh failed.
    expect(screen.queryByRole('progressbar', { name: 'Charging' })).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Driving' })).toBeInTheDocument();
    expect(screen.getByText('Last known')).toBeInTheDocument();
    expect(screen.getByTestId('fleet-status-partial')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).toBeNull();
  });

  it('reports —, not 0%/0-of-N, when every fleet-state request failed', () => {
    // The batch resolves successfully with three failures, so nothing here can
    // be gated on `isError`. "0% utilization" and "0/3 ready" would be
    // assertions manufactured from the absence of evidence.
    mockFleetStates.mockReturnValue(
      qr({ data: [failedEntry(V1), failedEntry(V2), failedEntry(V3)] }),
    );
    renderPage();

    const posture = screen.getByTestId('fleet-operational-brief');
    expect(within(briefMetric('Live utilization')).getByText('—')).toBeInTheDocument();
    expect(within(briefMetric('Departure ready')).getByText('—')).toBeInTheDocument();
    expect(within(briefMetric('Live state available')).getByText('—')).toBeInTheDocument();
    expect(within(posture).queryByText('0%')).toBeNull();
    expect(within(posture).queryByText('0/3')).toBeNull();
  });

  it('reports —, not 0%/0-of-N, when every vehicle merely lacks a snapshot', () => {
    mockFleetStates.mockReturnValue(
      qr({ data: [missingEntry(V1), missingEntry(V2), missingEntry(V3)] }),
    );
    renderPage();

    const posture = screen.getByTestId('fleet-operational-brief');
    expect(within(briefMetric('Live utilization')).getByText('—')).toBeInTheDocument();
    expect(within(briefMetric('Departure ready')).getByText('—')).toBeInTheDocument();
    expect(within(posture).queryByText('0%')).toBeNull();
  });

  it('narrows the KPI denominator to covered vehicles and discloses the coverage', () => {
    mockFleetStates.mockReturnValue(
      qr({ data: [resolvedEntry(V1, S1), failedEntry(V2), missingEntry(V3)] }),
    );
    renderPage();

    // Only V1 has a fresh reading; it is charging ⇒ 1/1 covered = 100 %.
    expect(within(briefMetric('Live utilization')).getByText('100%')).toBeInTheDocument();
    expect(within(briefMetric('Departure ready')).getByText('1/1')).toBeInTheDocument();
    expect(within(briefMetric('Departure ready')).getByText(
      /Based on 1 of 3 vehicles with a current battery reading/,
    )).toBeInTheDocument();
  });

  it('never counts a retained stale reading as live state available', () => {
    // S1 is `state: 'online', is_charging: true` — but the reading is retained
    // from before the outage. It proves what the car WAS doing.
    mockFleetStates.mockReturnValue(
      qr({ data: [retainedEntry(V1, S1), retainedEntry(V2, S2), missingEntry(V3)] }),
    );
    renderPage();

    expect(within(briefMetric('Live state available')).getByText('—')).toBeInTheDocument();
    expect(within(briefMetric('Live utilization')).getByText('—')).toBeInTheDocument();
  });

  it('uses the same fresh-only population for software numerator and denominator', () => {
    mockFleetStates.mockReturnValue(
      qr({ data: [retainedEntry(V1, S1), retainedEntry(V2, S2), missingEntry(V3)] }),
    );
    renderPage();

    const software = within(briefMetric('Software posture'));
    expect(software.getByText('—')).toBeInTheDocument();
    expect(software.queryByText('2 versions')).toBeNull();
    expect(software.getByText(
      'Based on 0 of 3 vehicles with a current software reading.',
    )).toBeInTheDocument();
  });

  it('does not raise a current low-battery alert from retained state', async () => {
    const retainedLowBattery = { ...S1, battery_level: 10 };
    mockFleetStates.mockReturnValue(
      qr({
        data: [
          retainedEntry(V1, retainedLowBattery),
          retainedEntry(V2, S2),
          missingEntry(V3),
        ],
      }),
    );
    renderPage();

    const posture = screen.getByTestId('fleet-operational-brief');
    fireEvent.click(within(posture).getByRole('button', { name: 'Review details' }));
    const drawer = await screen.findByRole('dialog', {
      name: 'Availability and readiness across the fleet details',
    });
    expect(within(drawer).queryByText(/vehicle below 20%/i)).toBeNull();
    expect(within(drawer).queryByText(/Review charging readiness/i)).toBeNull();
  });

  it('uses API observation time, never FSM state-since, in narrative evidence', async () => {
    const observedAt = Date.now() - 1_000;
    const stateWithOldTransition = {
      ...S1,
      since: '2020-01-02T03:04:05Z',
    };
    mockFleetStates.mockReturnValue(
      qr({ data: [resolvedEntry(V1, stateWithOldTransition, observedAt)] }),
    );
    renderPage();

    const posture = screen.getByTestId('fleet-operational-brief');
    fireEvent.click(within(posture).getByRole('button', { name: 'Review details' }));
    const drawer = await screen.findByRole('dialog', {
      name: 'Availability and readiness across the fleet details',
    });
    const summary = within(drawer).getByText(/Model 3 Alpha: online, battery/);
    const evidence = summary.closest('div');
    expect(evidence).not.toBeNull();
    expect(evidence).toHaveTextContent(String(new Date(observedAt).getFullYear()));
    expect(evidence).not.toHaveTextContent('2020');
  });

  it('ages the freshness chip from the OBSERVATION, not from the successful wrapper batch', () => {
    // The trap: `useFleetStates` resolves successfully on every 30 s poll even
    // when every request failed, so the query's own `dataUpdatedAt` is "now".
    // Reading freshness from it painted a green "just now" over readings that
    // had not moved in ten minutes.
    const tenMinutesAgo = Date.now() - 10 * 60_000;
    mockFleetStates.mockReturnValue(qr({
      data: [retainedEntry(V1, S1, tenMinutesAgo), retainedEntry(V2, S2, tenMinutesAgo)],
      dataUpdatedAt: Date.now(),
      isError: false,
    }));
    renderPage();

    const header = document.querySelector('header') as HTMLElement;
    expect(header).not.toBeNull();
    expect(within(header).getByText(/10m ago/)).toBeInTheDocument();
    expect(within(header).queryByText('just now')).toBeNull();
  });

  it('surfaces a refresh error even though the wrapper batch resolved successfully', () => {
    const tenMinutesAgo = Date.now() - 10 * 60_000;
    mockFleetStates.mockReturnValue(qr({
      data: [retainedEntry(V1, S1, tenMinutesAgo), resolvedEntry(V2, S2)],
      dataUpdatedAt: Date.now(),
      isError: false,
    }));
    renderPage();

    // `isError` is false on the query; the failure lives in the entries. The
    // trust contract must still degrade.
    expect(screen.getAllByTestId('stale-refresh-warning').length).toBeGreaterThan(0);
  });

  it('holds the displayed age steady across repeated failed 30s polls', () => {
    // Each poll restamps `dataUpdatedAt` but not `observedAt`, so the rendered
    // age must track the observation and never reset to "just now".
    const observedAt = Date.now() - 10 * 60_000;

    for (let poll = 0; poll <= 3; poll += 1) {
      mockFleetStates.mockReturnValue(qr({
        // Wrapper timestamp marches on with every poll…
        data: [retainedEntry(V1, S1, observedAt)],
        dataUpdatedAt: Date.now() + poll * 30_000,
      }));
      const view = renderPage();
      const header = document.querySelector('header') as HTMLElement;
      // …the observation age does not.
      expect(within(header).queryByText('just now')).toBeNull();
      expect(within(header).getByText(/10m ago/)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('does not count an explicit offline / asleep snapshot as live utilization', () => {
    const offline = makeState({ vehicle_id: 1, state: 'offline', battery_level: 70, is_charging: false });
    const asleep = makeState({ vehicle_id: 2, state: 'asleep', battery_level: 60, is_charging: false });
    mockFleetStates.mockReturnValue(
      qr({ data: [resolvedEntry(V1, offline), resolvedEntry(V2, asleep), missingEntry(V3)] }),
    );
    renderPage();

    // Both ARE live-state responses — that is what the card measures.
    expect(within(briefMetric('Live state available')).getByText('2/3')).toBeInTheDocument();
    // Neither is driving or charging, so utilization is a real 0 % of 2.
    expect(within(briefMetric('Live utilization')).getByText('0%')).toBeInTheDocument();
    // Backend explicitly said offline/asleep, so the breakdown may say so.
    expect(screen.getByRole('progressbar', { name: 'Offline' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Asleep' })).toBeInTheDocument();
  });

  it('keeps the fleet on screen when a BACKGROUND vehicles refetch fails', () => {
    // Data-trust regression guard: `error` set + cached rows present is a
    // stale refresh, not a dead page. Losing the fleet here is the exact
    // failure the shared DataState contract exists to prevent.
    mockVehicles.mockReturnValue(
      qr({ data: VEHICLES, isError: true, error: new Error('502 Bad Gateway') }),
    );
    renderPage();

    // Cards survive…
    expect(screen.getAllByText('Model 3 Alpha').length).toBeGreaterThan(0);
    // …the page-level error surface never replaces them…
    expect(screen.queryByText("Can't reach server")).toBeNull();
    // …and a non-blocking warning explains the staleness instead.
    expect(screen.getAllByTestId('stale-refresh-warning').length).toBeGreaterThan(0);
  });

  it('keeps retained live state when a BACKGROUND fleet-state refetch fails', () => {
    mockFleetStates.mockReturnValue(
      qr({ data: FLEET_STATES, isError: true, error: new Error('502 Bad Gateway') }),
    );
    renderPage();

    // Neither overview panel falls back to the error surface while the
    // previous batch is still renderable.
    expect(screen.queryByText("Can't reach server")).toBeNull();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });

  it('explains a successful battery-state gap and refreshes without presenting an error retry', () => {
    const refetch = vi.fn();
    mockFleetStates.mockReturnValue(qr({ data: [], refetch }));
    renderPage();

    expect(
      screen.getByText('Live battery readings have not arrived for the registered fleet.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Readings appear after vehicles reconnect/)).toBeInTheDocument();
    // No entries at all means we know nothing — the breakdown must say so
    // rather than classify three unseen vehicles as offline.
    expect(screen.queryByRole('progressbar', { name: 'Offline' })).toBeNull();
    expect(screen.getByText('No fleet status data yet')).toBeInTheDocument();

    const refreshButtons = screen.getAllByRole('button', { name: 'Refresh live state' });
    expect(refreshButtons).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    fireEvent.click(refreshButtons[0]!);
    expect(refetch).toHaveBeenCalledTimes(1);
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

  it('ages the OPERATIONAL BRIEF freshness chip from the observation too', () => {
    // The header chip has its own guard above. The brief is a second, separate
    // freshness surface, and it was the one an operator actually reads before
    // dispatching — both must be fed the synthetic observation timestamp, not
    // the wrapper batch's `dataUpdatedAt`, which advances on every 30 s poll
    // even when every per-vehicle request failed.
    const tenMinutesAgo = Date.now() - 10 * 60_000;
    mockFleetStates.mockReturnValue(qr({
      data: [retainedEntry(V1, S1, tenMinutesAgo), retainedEntry(V2, S2, tenMinutesAgo)],
      dataUpdatedAt: Date.now(),
      isError: false,
    }));
    renderPage();

    // Scoped to the LIVE VEHICLE STATE chip: the brief also carries a work
    // orders chip, which is legitimately "just now".
    const chip = liveStateFreshnessChip();
    expect(chip).toHaveTextContent(/10m ago/);
    expect(chip).not.toHaveTextContent(/just now/);
  });

  it('reports the OLDEST observation, so one fresh car cannot mask a stale fleet', () => {
    // A summary is only as fresh as its stalest member. Reporting the newest
    // reading would let a single chatty vehicle certify a fleet whose other
    // members have not been heard from in ten minutes.
    const tenMinutesAgo = Date.now() - 10 * 60_000;
    mockFleetStates.mockReturnValue(qr({
      data: [resolvedEntry(V1, S1, Date.now()), retainedEntry(V2, S2, tenMinutesAgo)],
      dataUpdatedAt: Date.now(),
    }));
    renderPage();

    const chip = liveStateFreshnessChip();
    expect(chip).toHaveTextContent(/10m ago/);
    expect(chip).not.toHaveTextContent(/just now/);
  });

  it('describes a total outage as unresolved, never as a fleet of offline vehicles', () => {
    // The headline failure this page family exists to prevent: a dead API
    // rendering as a confident, fully-populated "every vehicle is Offline".
    mockFleetStates.mockReturnValue(
      qr({ data: [failedEntry(V1), failedEntry(V2), failedEntry(V3)], isError: false }),
    );
    renderPage();

    const posture = screen.getByTestId('fleet-operational-brief');
    // "unavailable" (we could not resolve it) — NOT "offline" (the car said so).
    expect(within(posture).getByText('3 vehicle unavailable')).toBeInTheDocument();
    expect(within(posture).getByText(
      'Live state could not be resolved. Verify connectivity before issuing commands.',
    )).toBeInTheDocument();
    // Nothing anywhere classifies the fleet's operational status.
    expect(screen.queryByRole('progressbar', { name: 'Offline' })).toBeNull();
    expect(screen.queryByRole('progressbar', { name: 'Online' })).toBeNull();
    // …and no derived KPI reports a zero as if it were a measurement.
    expect(within(briefMetric('Live state available')).getByText('—')).toBeInTheDocument();
    expect(within(briefMetric('Live utilization')).getByText('—')).toBeInTheDocument();
  });

  it('keeps missing, failed and resolved distinct in one batch', () => {
    // `state === null` used to mean three operationally different things at
    // once. V1 resolved, V2 answered with no snapshot, V3's request failed:
    // the page must classify only V1 and disclose the other two as coverage
    // loss, with the notice naming the TRANSPORT failure (the actionable one).
    mockFleetStates.mockReturnValue(
      qr({ data: [resolvedEntry(V1, S1), missingEntry(V2), failedEntry(V3)] }),
    );
    renderPage();

    expect(screen.getByRole('progressbar', { name: 'Charging' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Offline' })).toBeNull();

    const notice = screen.getByTestId('fleet-status-partial');
    expect(notice).toHaveTextContent('Breakdown covers 1 of 3 vehicles');
    expect(notice).toHaveTextContent('1 vehicle state request(s) failed');

    // Coverage is disclosed on the derived KPI rather than diluted into it.
    expect(within(briefMetric('Departure ready')).getByText('1/1')).toBeInTheDocument();
    expect(within(briefMetric('Departure ready')).getByText(
      /Based on 1 of 3 vehicles with a current battery reading/,
    )).toBeInTheDocument();
  });

  it('names an authoritative absence as missing, not as a failed request', () => {
    // Same shape as the case above but with NO transport failure: the notice
    // must say "has not reported a snapshot yet", because telling an operator
    // a request failed when it did not sends them debugging the wrong system.
    mockFleetStates.mockReturnValue(
      qr({ data: [resolvedEntry(V1, S1), missingEntry(V2), missingEntry(V3)] }),
    );
    renderPage();

    const notice = screen.getByTestId('fleet-status-partial');
    expect(notice).toHaveTextContent('Breakdown covers 1 of 3 vehicles');
    expect(notice).toHaveTextContent('2 vehicle(s) have not reported a snapshot yet');
    expect(notice).not.toHaveTextContent(/request\(s\) failed/);
    expect(screen.queryByText("Can't reach server")).toBeNull();
  });
});
