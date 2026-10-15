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
const unitState = vi.hoisted(() => ({
  length: 'km' as 'km' | 'mi',
  precision: 2,
  locale: 'en-US',
}));

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
      settings: { ...defaults, unit_of_length: unitState.length, decimal_precision: unitState.precision, locale: unitState.locale },
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
  FleetStatesBatchError,
} from '@/api/hooks/useVehicles';
import { usePinned, useTogglePin } from '@/api/hooks/usePinned';
import { useFleetWorkOrders, type FleetWorkOrder } from '@/api/hooks/useFleetOps';
import { fmtNumber } from '@/lib/numberFormat';
import { maskFor } from '@/lib/maskValue';
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
  const view = render(
    <MemoryRouter initialEntries={entries}>
      <QueryClientProvider client={client}>
        <VehicleListPage />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...view, client };
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  unitState.length = 'km';
  unitState.precision = 2;
  unitState.locale = 'en-US';
  installHappyPath();
});

/* ─────────────────────────────── Happy path ─────────────────────────────── */

describe('VehicleListPage — happy path', () => {
  it('uses real raw bridges for both fleet summaries and reviews verified charge-state coverage', () => {
    renderPage();
    const summary = screen.getByTestId('fleet-current-summary');
    expect(summary).toHaveAttribute('data-operational-brief');
    expect(summary.querySelector('[data-operational-metric="fleet-average-battery"]')).toHaveAttribute('data-value-state', 'value');
    expect(briefMetric('Live utilization')).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Charging / live state')).toBeInTheDocument();
    expect(within(drawer).getByText('1/2')).toBeInTheDocument();
    expect(drawer).toHaveAccessibleName('Current verified fleet readings details');
    const fleetEvidence = within(drawer).getByText('Total vehicles').parentElement?.parentElement;
    if (!(fleetEvidence instanceof HTMLElement)) throw new Error('Missing fleet source evidence metric');
    expect(within(fleetEvidence).getByText(
      'Current field coverage differs by measurement; no common observation timestamp is supplied',
    )).toBeInTheDocument();
  });

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
    expect(within(summary).getByText('Total vehicles')).toBeInTheDocument();
    expect(within(summary).getByText('Avg battery')).toBeInTheDocument();
    expect(within(summary).getByText('Total range (km)')).toBeInTheDocument();
    // 1 charging (V1) of 2 vehicles reporting live state (V1, V2).
    expect(within(summary).getByText('1/2')).toBeInTheDocument();

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
    expect(within(posture).getByText('100.00%')).toBeInTheDocument();
    expect(within(posture).getByText('Software posture')).toBeInTheDocument();
    expect(within(posture).getByText('2 versions')).toBeInTheDocument();
    expect(within(posture).getByText(
      'Based on 2 of 3 vehicles with a current software reading.',
    )).toBeInTheDocument();
    expect(within(posture).getByText('Service attention')).toBeInTheDocument();
    expect(within(posture).getByText('1 open')).toBeInTheDocument();
    // Freshness lives in the page header (single surface); the brief keeps
    // provenance badges only, so per-source freshness chips must be absent here.
    const header = document.querySelector('header') as HTMLElement;
    expect(within(header).getByText('just now')).toBeInTheDocument();
    expect(within(posture).queryByRole('button', { name: /Source: / })).toBeNull();
    expect(within(posture).getByText('Historical')).toBeInTheDocument();

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
    expect(within(summary).getByText('Total range (mi)')).toBeInTheDocument();
    // 650_000 m / 1609.344 ≈ 403.89 mi — read through the real SI converter.
    const expected = fmtNumber(convertDistanceFromSI(650_000, 'mi'));
    expect(within(summary).getByText(expected)).toBeInTheDocument();
    expect(expected).toBe('403.89');
  });

  it('summarises battery bars and a per-status breakdown in the overview bento', async () => {
    renderPage();
    expect(await screen.findByText('Fleet battery status')).toBeInTheDocument();
    expect(screen.getByText('Fleet status')).toBeInTheDocument();

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
  it('keeps the selected preview open while fresh evidence becomes retained and recovers', async () => {
    const { rerender, client } = renderPage();
    fireEvent.click(within(cardGrid()).getByRole('button', { name: 'Actions for Model 3 Alpha' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view Model 3 Alpha' }));
    const drawer = await screen.findByRole('dialog', { name: 'Model 3 Alpha' });
    expect(within(drawer).getByText('Live')).toBeInTheDocument();
    expect(within(drawer).getByText('80.00%')).toBeInTheDocument();

    const rerenderPage = () => rerender(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <VehicleListPage />
          <LocationProbe />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    mockFleetStates.mockReturnValue(qr({ data: [
      retainedEntry(V1, S1, Date.now() - 600_000),
      resolvedEntry(V2, S2),
      missingEntry(V3),
    ] }));
    rerenderPage();

    expect(screen.getByRole('dialog', { name: 'Model 3 Alpha' })).toBe(drawer);
    expect(within(drawer).getByText('Unknown')).toBeInTheDocument();
    expect(within(drawer).getByText('Last known')).toBeInTheDocument();
    expect(within(drawer).queryByText('Live')).not.toBeInTheDocument();
    expect(within(drawer).queryByText('80.00%')).not.toBeInTheDocument();
    expect(within(drawer).getByText(/Last known: 80\.00% .* not currently verified/)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Open vehicle details' })).toBeEnabled();
    expect(within(drawer).getByRole('link', { name: 'Telemetry evidence' })).toHaveAttribute('href', '/signals');

    const recovered = makeState({ ...S1, battery_level: 63, rated_range: 315_000 });
    mockFleetStates.mockReturnValue(qr({ data: [
      resolvedEntry(V2, S2),
      missingEntry(V3),
      resolvedEntry(V1, recovered),
    ] }));
    rerenderPage();
    expect(screen.getByRole('dialog', { name: 'Model 3 Alpha' })).toBe(drawer);
    expect(within(drawer).getByText('Live')).toBeInTheDocument();
    expect(within(drawer).getByText('63.00%')).toBeInTheDocument();
    expect(within(drawer).getByText('315.00 km')).toBeInTheDocument();
    expect(within(drawer).queryByText(/Last known: .*%/)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(/Last known: (400|315)\.00 km/)).not.toBeInTheDocument();
    // Recovery verifies battery/range, not the unchanged sparse-feed fields.
    expect(within(drawer).getAllByText(/Last known:/)).toHaveLength(2);
    expect(within(drawer).getByText(/Last known: 100\.00 km .* not currently verified/)).toBeInTheDocument();
    expect(within(drawer).getByText(/Last known: Locked .* not currently verified/)).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Open vehicle details' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/vehicles/1');
  });

  it('exposes labelled landmarks and accessible names on icon-only controls', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });

    expect(screen.getByRole('region', { name: 'Fleet summary' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fleet overview' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'All vehicles' })).toBeInTheDocument();

    const grid = cardGrid();
    // One labelled battery progressbar per card; aria-valuenow tracks the level.
    const bars = within(grid).getAllByRole('progressbar', { name: 'Battery level' });
    expect(bars).toHaveLength(3);
    expect(bars[0]).toHaveAttribute('aria-valuenow', '80');
    expect(bars[1]).toHaveAttribute('aria-valuenow', '50');
    // V3 has no live state ⇒ the level is UNKNOWN. `aria-valuenow="0"` would
    // announce "0 percent", a reading the vehicle never produced.
    expect(bars[2]).not.toHaveAttribute('aria-valuenow');
    expect(bars[2]).toHaveAttribute('aria-valuetext', 'No reading');
    // Battery is missing for V3; odometer is retained but unverified for V1/V2.
    expect(within(grid).getAllByText('—')).toHaveLength(6);

    // Icon-only row actions + status glyphs carry accessible names. Destructive
    // actions sit behind the per-card menu instead of adjacent icon buttons.
    expect(within(grid).getAllByRole('button', { name: /^Actions for / })).toHaveLength(3);
    expect(within(grid).queryByLabelText('Remove Model 3 Alpha')).toBeNull();
    expect(within(grid).getByText(/Last known: Locked .* not currently verified/)).toBeInTheDocument();
    expect(within(grid).getByText(/Last known: Sentry mode on .* not currently verified/)).toBeInTheDocument();
    expect(within(grid).getAllByRole('link', { name: /^Open .+ details$/ })).toHaveLength(3);
  });

  it('opens a contextual vehicle preview and continues to full details', async () => {
    renderPage();
    const grid = cardGrid();

    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for Model 3 Alpha' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view Model 3 Alpha' }));

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
      .toHaveAttribute('href', '/notifications/inbox');
    expect(within(drawer).getByRole('link', { name: 'Service history' }))
      .toHaveAttribute('href', '/maintenance');
    expect(within(drawer).getByRole('link', { name: 'Telemetry evidence' }))
      .toHaveAttribute('href', '/signals');

    fireEvent.click(within(drawer).getByRole('button', { name: 'Open vehicle details' }));
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/vehicles/1');
    });
  });

  it('labels a verified preview as Live and shows its per-field values', async () => {
    renderPage();
    const grid = cardGrid();
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for Model 3 Alpha' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view Model 3 Alpha' }));

    const drawer = await screen.findByRole('dialog', { name: 'Model 3 Alpha' });
    expect(within(drawer).getByText('Telemetry')).toBeInTheDocument();
    expect(within(drawer).getByText('Live')).toBeInTheDocument();
    expect(within(drawer).getByText('80.00%')).toBeInTheDocument();
  });

  it('never renders a RETAINED reading as if it were current', async () => {
    // The defect: the drawer stored the raw `state` and called
    // `deriveVehicleStatus`, so a reading kept alive through a failed refresh
    // was rendered exactly like a live one — the numbers looked current and
    // the badge claimed an operational status we had no evidence for.
    const stale = retainedEntry(V1, S1, OBSERVED_AT - 3 * 60 * 60_000);
    mockFleetStates.mockReturnValue(qr({ data: [stale, resolvedEntry(V2, S2), missingEntry(V3)] }));
    renderPage();
    const grid = cardGrid();
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for Model 3 Alpha' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view Model 3 Alpha' }));

    const drawer = await screen.findByRole('dialog', { name: 'Model 3 Alpha' });
    // Status is Unknown, never the state embedded in the retained reading.
    expect(within(drawer).getByText('Unknown')).toBeInTheDocument();
    // The trust line names the condition rather than implying freshness.
    expect(within(drawer).getByText('Last known')).toBeInTheDocument();
    // Per-field values are em dashes; the retained value is disclosed in the
    // explanatory detail line instead of being presented as current.
    expect(within(drawer).queryByText('80.00%')).toBeNull();
    expect(
      within(drawer).getByText(/Last known: 80\.00% .* not currently verified/),
    ).toBeInTheDocument();
  });

  it('explains a failed preview as a pipeline fact, not a vehicle state', async () => {
    mockFleetStates.mockReturnValue(qr({ data: [failedEntry(V1), resolvedEntry(V2, S2), missingEntry(V3)] }));
    renderPage();
    const grid = cardGrid();
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for Model 3 Alpha' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view Model 3 Alpha' }));

    const drawer = await screen.findByRole('dialog', { name: 'Model 3 Alpha' });
    expect(within(drawer).getByText('Unreachable')).toBeInTheDocument();
    expect(within(drawer).queryByText('offline')).toBeNull();
    expect(
      within(drawer).getAllByText('No reading available for this vehicle').length,
    ).toBeGreaterThan(0);
  });

  it('shows the no-live-data placeholder and an UNKNOWN badge for a stateless vehicle', async () => {    renderPage();
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
    // The masked VIN backs both the name link and the caption when
    // display_name is blank; raw VINs never render by default.
    expect(within(grid).queryByText('VINBLANK000000007')).toBeNull();
    expect(within(grid).getAllByText('VIN••••••••••0007')).toHaveLength(2);
    expect(within(grid).getByRole('button', { name: 'Actions for VIN••••••••••0007' }))
      .toHaveAttribute('title', 'Actions for VIN••••••••••0007');
    expect(within(grid).getByRole('link', { name: 'Open VIN••••••••••0007 details' }))
      .toBeInTheDocument();
    expect(within(grid).queryByTitle(/VINBLANK000000007/)).toBeNull();
    // …but the caption reveals + copies on demand.
    fireEvent.click(within(grid).getByRole('button', { name: 'Reveal value' }));
    expect(within(grid).getByText('VINBLANK000000007')).toBeInTheDocument();
  });

  it.each(['VINBLANK000000007', 'short', ''])(
    'uses the existing masked fallback in an unnamed vehicle preview (%s)',
    async (vin) => {
      const vehicle = makeVehicle({ id: 7, vehicle_id: 7, vin, display_name: '' });
      const masked = maskFor(vin, 'vin');
      mockVehicles.mockReturnValue(qr({ data: [vehicle] }));
      mockFleetStates.mockReturnValue(qr({ data: [missingEntry(vehicle)] }));
      renderPage();

      fireEvent.click(within(cardGrid()).getByRole('button', { name: `Actions for ${masked}`.trim() }));
      fireEvent.click(await screen.findByRole('button', { name: `Quick view ${masked}`.trim() }));
      const drawer = await screen.findByRole('dialog', { name: masked || 'Vehicle details' });
      if (vin) {
        expect(drawer).not.toHaveTextContent(vin);
        expect(drawer.outerHTML).not.toContain(vin);
      }
      expect(mockFleetStates).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 7, vin })]),
      );
      fireEvent.click(within(drawer).getByRole('button', { name: 'Open vehicle details' }));
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/vehicles/7'),
      );
      expect(vehicle.vin).toBe(vin);
    },
  );
});

/* ─────────────────────────── User interactions ──────────────────────────── */

describe('VehicleListPage — sync & compare actions', () => {
  it('compares the first two retained roster members, not pinned display order or current-state coverage', async () => {
    mockVehicles.mockReturnValue(qr({ data: [V2, V3, V1], isError: true, error: new Error('Roster refresh failed') }));
    mockPinned.mockReturnValue(qr({ data: [{ id: 9, item_type: 'vehicle', item_id: 1, position: 0 }] }));
    mockFleetStates.mockReturnValue(qr({ data: [
      resolvedEntry(V1, S1), failedEntry(V2), missingEntry(V3),
    ] }));
    renderPage();
    expect(within(cardGrid()).getAllByRole('link', { name: /^Open .+ details$/ })[0])
      .toHaveAccessibleName('Open Model 3 Alpha details');
    fireEvent.click(await screen.findByRole('button', { name: 'Compare vehicles' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/vehicle-comparison');
    const params = new URLSearchParams(screen.getByTestId('location').getAttribute('data-search') ?? '');
    expect([...params.entries()]).toEqual([['leftId', '2'], ['rightId', '3']]);
  });

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
  it.each(['VINBLANK000000007', 'short', ''])(
    'masks the unnamed vehicle removal message without changing its numeric ID (%s)',
    async (vin) => {
      const vehicle = makeVehicle({ id: 7, vehicle_id: 7, vin, display_name: '' });
      const masked = maskFor(vin, 'vin');
      mockVehicles.mockReturnValue(qr({ data: [vehicle] }));
      mockFleetStates.mockReturnValue(qr({ data: [missingEntry(vehicle)] }));
      renderPage();

      fireEvent.click(within(cardGrid()).getByRole('button', { name: `Actions for ${masked}`.trim() }));
      fireEvent.click(await screen.findByRole('button', { name: `Remove ${masked}`.trim() }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(
        `Are you sure you want to remove "${masked}"? This will delete all associated data including drives, charges, and state history.`,
      )).toBeInTheDocument();
      if (vin) expect(dialog.outerHTML).not.toContain(vin);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
      expect(deleteMut.mutate).toHaveBeenCalledWith(7, expect.anything());
      expect(vehicle.vin).toBe(vin);
    },
  );

  it('opens a confirm dialog and fires the delete mutation on confirm', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Model 3 Alpha' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Model 3 Alpha' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Model Y Beta' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Model Y Beta' }));
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
  function expectUnknownRosterShells() {
    for (const title of ['Fleet summary', 'Fleet overview', 'All vehicles']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('group', { name: 'Availability and readiness across the fleet' })).toBeInTheDocument();
    expect(screen.queryByText('No vehicles yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/No fleet records for/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('fleet-operational-brief')).not.toBeInTheDocument();
    expect(screen.queryByText('Fleet ready')).not.toBeInTheDocument();
  }

  it('renders the skeleton while the vehicles query is pending', () => {
    mockVehicles.mockReturnValue(qr({ isLoading: true, data: undefined }));
    renderPage();

    expect(screen.getByTestId('vehicle-list-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Fleet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compare vehicles' })).not.toBeInTheDocument();
    expectUnknownRosterShells();
  });

  it('uses initial data state for an unresolved idle read, not isLoading or an empty roster', () => {
    mockVehicles.mockReturnValue(qr({ isPending: true, fetchStatus: 'idle', isLoading: false }));
    renderPage();

    expect(screen.getByTestId('vehicle-list-skeleton')).toBeInTheDocument();
    expectUnknownRosterShells();
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
  });

  it('keeps paused initial reads distinct and independently retryable without asserting registration', () => {
    const refetch = vi.fn();
    const serviceRefetch = vi.fn();
    mockVehicles.mockReturnValue(qr({ isPending: true, fetchStatus: 'paused', refetch }));
    mockFleetWorkOrders.mockReturnValue(qr({
      isError: true, error: new Error('service unavailable'), refetch: serviceRefetch,
    }));
    renderPage();

    expectUnknownRosterShells();
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-list-skeleton')).not.toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Fleet' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(serviceRefetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(serviceRefetch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Sync from Tesla' }));
    expect(syncMut.mutate).toHaveBeenCalledOnce();
  });

  it('preserves populated fleet cards when the roster refresh is paused', () => {
    const refetch = vi.fn();
    mockVehicles.mockReturnValue(qr({ data: VEHICLES, fetchStatus: 'paused', refetch }));
    renderPage();

    expect(within(cardGrid()).getAllByRole('link', { name: /^Open .+ details$/ })).toHaveLength(3);
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.getByTestId('fleet-operational-brief')).toBeInTheDocument();
    const compare = screen.getByRole('button', { name: 'Compare vehicles' });
    expect(within(compare).queryByRole('button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Fleet' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/vehicles');
    expect(syncMut.mutate).not.toHaveBeenCalled();
    expect(deleteMut.mutate).not.toHaveBeenCalled();
  });

  it('retries only the failed roster read on reconnect without triggering sync or deletion', () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const refetch = vi.fn();
    mockVehicles.mockReturnValue(qr({
      isError: true, error: new TypeError('Failed to fetch'), refetch,
    }));
    try {
      // Connection state comes from the resilience module's offline/online events.
      fireEvent(window, new Event('offline'));
      renderPage();
      expectUnknownRosterShells();
      fireEvent(window, new Event('online'));
      expect(refetch).toHaveBeenCalledOnce();
      expect(syncMut.mutate).not.toHaveBeenCalled();
      expect(deleteMut.mutate).not.toHaveBeenCalled();
    } finally {
      online.mockRestore();
    }
  });

  it('renders a retryable error panel when the vehicles query fails', async () => {
    const refetch = vi.fn();
    mockVehicles.mockReturnValue(
      qr({ error: new Error('boom'), isError: true, data: undefined, refetch }),
    );
    renderPage();

    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    expectUnknownRosterShells();
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

  it('keeps every empty fleet section with the existing shared sync recovery rather than duplicating mutations', () => {
    mockVehicles.mockReturnValue(qr({ data: [] }));
    mockFleetStates.mockReturnValue(qr({ data: [] }));
    renderPage();

    for (const section of ['Fleet posture', 'Fleet summary', 'Fleet overview', 'All vehicles']) {
      expect(screen.getByText(`No fleet records for ${section}.`)).toBeInTheDocument();
    }
    for (const section of ['Fleet summary', 'Fleet overview', 'All vehicles']) {
      expect(screen.getByRole('region', { name: section })).toBeInTheDocument();
    }
    expect(screen.queryByTestId('fleet-operational-brief')).not.toBeInTheDocument();
    expect(screen.queryByText('Total range (km)')).not.toBeInTheDocument();
    const syncButtons = screen.getAllByRole('button', { name: 'Sync from Tesla' });
    expect(syncButtons).toHaveLength(2);
    fireEvent.click(syncButtons[1]!);
    expect(syncMut.mutate).toHaveBeenCalledTimes(1);
    expect(syncMut.mutate).toHaveBeenCalledWith(undefined, expect.objectContaining({
      onSuccess: expect.any(Function),
    }));
  });

  it('shows fleet-states skeletons while keeping every card visible', () => {
    mockFleetStates.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    renderPage();

    // Pending live state stays neutral instead of briefly classifying every
    // registered vehicle as offline or reporting zero-valued fleet KPIs.
    expect(screen.getByText('Resolving live state')).toBeInTheDocument();
    expect(screen.queryByText('3 vehicle unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('0 / 0')).not.toBeInTheDocument();
    // Every card still renders, each with the null-safe no-live-data placeholder.
    expect(screen.getAllByText('No live data')).toHaveLength(3);
    const skeletons = screen.getByTestId('fleet-status-skeleton').querySelectorAll(
      '[aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"]',
    );
    expect(skeletons.length).toBeGreaterThan(0);
    expect(skeletons).toHaveLength(3);
    for (const skeleton of skeletons) {
      expect(skeleton).toHaveClass('h-8', 'w-full', 'rounded-lg');
      expect(skeleton).not.toHaveClass('animate-pulse');
    }
    const summary = screen.getByRole('region', { name: 'Fleet summary' });
    const pending = within(summary).getByRole('status', { name: 'Loading stat cards' });
    expect(pending).toHaveAttribute('aria-busy', 'true');
    const summarySkeletons = pending.querySelectorAll(
      '[aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"]',
    );
    expect(summarySkeletons).toHaveLength(4);
    for (const skeleton of summarySkeletons) {
      expect(skeleton).toHaveClass('h-24', 'w-full', 'rounded-xl');
      expect(skeleton).not.toHaveClass('animate-pulse');
    }
    expect(summary.querySelector('[data-operational-value]')).toBeNull();
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
    expect(screen.getByText('Fleet status')).toBeInTheDocument();
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
    expect(within(briefMetric('Live utilization')).getByText('100.00%')).toBeInTheDocument();
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
    expect(within(briefMetric('Live utilization')).getByText('0.00%')).toBeInTheDocument();
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

  it('retains qualified battery rows from a failed batch envelope and recovers fresh aggregates on retry', () => {
    const observedAt = Date.now() - 600_000;
    const entries = [retainedEntry(V1, S1, observedAt), retainedEntry(V2, S2, observedAt), failedEntry(V3)];
    const error = new FleetStatesBatchError(entries, new Error('502 Bad Gateway'));
    const refetch = vi.fn();
    mockFleetStates.mockReturnValue(qr({
      data: error.entries, isError: true, error, refetch, dataUpdatedAt: Date.now(),
    }));
    const view = renderPage();
    const batteryPanel = screen.getByText('Fleet battery status').parentElement?.parentElement;
    if (!batteryPanel) throw new Error('Missing battery panel');
    expect(within(batteryPanel).getByRole('progressbar', { name: 'Model 3 Alpha' }))
      .toHaveAttribute('aria-valuenow', '80');
    expect(within(batteryPanel).getByText(/Last known: 80\.00% \(10m ago\) — not currently verified/))
      .toBeInTheDocument();
    expect(within(batteryPanel).queryByText(/Live battery readings have not arrived/)).toBeNull();
    expect(within(briefMetric('Departure ready')).getByText('—')).toBeInTheDocument();
    const summary = screen.getByTestId('fleet-current-summary');
    expect(summary.querySelector('[data-operational-metric="fleet-average-battery"]'))
      .toHaveAttribute('data-value-state', 'missing');
    expect(screen.queryByRole('progressbar', { name: 'Charging' })).toBeNull();
    const warning = screen.getAllByTestId('stale-refresh-warning')
      .find(node => node.textContent?.includes('Live vehicle state'));
    if (!warning) throw new Error('Missing live-state refresh warning');
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledOnce();

    mockFleetStates.mockReturnValue(qr({
      data: [resolvedEntry(V1, makeState({ ...S1, battery_level: 0 }), Date.now()), missingEntry(V2), missingEntry(V3)],
      refetch,
    }));
    view.rerender(
      <MemoryRouter initialEntries={['/vehicles']}>
        <QueryClientProvider client={view.client}><VehicleListPage /><LocationProbe /></QueryClientProvider>
      </MemoryRouter>,
    );
    const recoveredBar = screen.getByRole('progressbar', { name: 'Model 3 Alpha' });
    expect(recoveredBar).toHaveAttribute('aria-valuenow', '0');
    expect(recoveredBar).toHaveTextContent('0.00%');
    expect(recoveredBar).not.toHaveTextContent('Last known');
    expect(screen.getByTestId('fleet-current-summary')
      .querySelector('[data-operational-metric="fleet-average-battery"]'))
      .toHaveAttribute('data-value-state', 'value');
    expect(within(briefMetric('Departure ready')).getByText('0/1')).toBeInTheDocument();
    expect(screen.queryByText('502 Bad Gateway')).toBeNull();
  });

  it('shows retained battery rows beside fresh rows without including them in the fleet average', () => {
    mockFleetStates.mockReturnValue(qr({
      data: [retainedEntry(V1, S1, Date.now() - 600_000), resolvedEntry(V2, S2), missingEntry(V3)],
    }));
    renderPage();
    const panel = screen.getByText('Fleet battery status').parentElement?.parentElement;
    if (!panel) throw new Error('Missing battery panel');
    expect(within(panel).getByRole('progressbar', { name: 'Model 3 Alpha' })).toHaveTextContent('Last known: 80.00%');
    expect(within(panel).getByRole('progressbar', { name: 'Model Y Beta' })).not.toHaveTextContent('Last known: 50.00%');
    expect(within(screen.getByTestId('fleet-current-summary')).getByText(`${fmtNumber(50)}%`)).toBeInTheDocument();
    expect(within(briefMetric('Departure ready')).getByText('1/1')).toBeInTheDocument();
  });

  it('keeps active battery loading distinct from a successful empty batch', () => {
    mockFleetStates.mockReturnValue(qr({
      isLoading: true, isPending: true, isFetching: true, fetchStatus: 'fetching',
    }));
    renderPage();
    expect(screen.getByTestId('fleet-battery-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Live battery readings have not arrived for the registered fleet.')).toBeNull();
    expect(screen.queryByRole('progressbar', { name: 'Model 3 Alpha' })).toBeNull();
  });

  it('explains paused battery reads without data and retries only the live-state source', () => {
    const refetch = vi.fn();
    mockFleetStates.mockReturnValue(qr({ isPending: true, fetchStatus: 'paused', refetch }));
    renderPage();
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.queryByTestId('fleet-battery-skeleton')).toBeNull();
    expect(screen.queryByText('Live battery readings have not arrived for the registered fleet.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Live vehicle state' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockVehicles.mock.results[0]?.value.refetch).not.toHaveBeenCalled();
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
    expect(screen.getByText('Available sections remain visible. Source status is tracked independently below.')).toBeInTheDocument();
    expect(within(cardGrid()).getByText('Model 3 Alpha')).toBeInTheDocument();
  });

  it('reports the OLDEST observation in the header chip, so one fresh car cannot mask a stale fleet', () => {
    // A summary is only as fresh as its stalest member. Reporting the newest
    // reading would let a single chatty vehicle certify a fleet whose other
    // members have not been heard from in ten minutes. The brief-level chip
    // this originally guarded was removed (freshness lives in the page
    // header now), so the mixed fresh/stale case is asserted on the header.
    const tenMinutesAgo = Date.now() - 10 * 60_000;
    mockFleetStates.mockReturnValue(qr({
      data: [resolvedEntry(V1, S1, Date.now()), retainedEntry(V2, S2, tenMinutesAgo)],
      dataUpdatedAt: Date.now(),
    }));
    renderPage();

    const header = document.querySelector('header') as HTMLElement;
    expect(within(header).getByText(/10m ago/)).toBeInTheDocument();
    expect(within(header).queryByText('just now')).toBeNull();
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

describe('VehicleListPage — field and independent source qualification', () => {
  it.each([
    ['missing', undefined],
    ['null', null],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])('does not manufacture measured zero from %s readings', (_label, input) => {
    mockVehicles.mockReturnValue(qr({ data: [V1] }));
    mockFleetStates.mockReturnValue(qr({ data: [{
      ...resolvedEntry(V1, S1),
      state: { ...S1, battery_level: input, rated_range: input, odometer: input, charger_power: input },
      verifiedFields: [...VERIFIED_FIELDS, 'odometer', 'charger_power'],
    }] }));
    renderPage();
    const summary = screen.getByTestId('fleet-current-summary');
    expect(summary.querySelector('[data-operational-metric="fleet-average-battery"]'))
      .toHaveAttribute('data-value-state', 'missing');
    expect(summary.querySelector('[data-operational-metric="fleet-total-range"]'))
      .toHaveAttribute('data-value-state', 'missing');
    const grid = cardGrid();
    // Battery, range, odometer and charger power stay unknown (other fields may also show placeholders).
    expect(within(grid).getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(within(grid).queryByText('0.00 kW')).toBeNull();
    expect(screen.getByTestId('fleet-battery-unknown')).toHaveTextContent('Not reported');
  });

  it('parses numeric strings as reported measurements instead of treating them as missing', () => {
    mockVehicles.mockReturnValue(qr({ data: [V1] }));
    mockFleetStates.mockReturnValue(qr({ data: [resolvedEntry(V1, {
      ...S1,
      battery_level: '0',
      rated_range: '0',
      odometer: '0',
      charger_power: '0',
    })] }));
    renderPage();

    expect(screen.getByTestId('fleet-current-summary').querySelector(
      '[data-operational-metric="fleet-average-battery"]',
    )).toHaveAttribute('data-value-state', 'value');
    expect(cardGrid()).toHaveTextContent('0.00 kW');
  });

  it.each([0, -12.375, 12.375])('retains raw signed and fractional readings (%s) independently of display precision', (input) => {
    const state = Object.freeze(makeState({
      battery_level: input,
      rated_range: input * 1_000,
      odometer: input * 1_000,
      charger_power: input,
      is_charging: true,
    }));
    mockVehicles.mockReturnValue(qr({ data: [V1] }));
    mockFleetStates.mockReturnValue(qr({ data: [{
      ...resolvedEntry(V1, state),
      verifiedFields: [...VERIFIED_FIELDS, 'odometer', 'charger_power'],
    }] }));
    renderPage();
    const summary = screen.getByTestId('fleet-current-summary');
    expect(summary.querySelector('[data-operational-metric="fleet-average-battery"]'))
      .toHaveAttribute('data-value-state', 'value');
    expect(within(summary).getByText(`${fmtNumber(input)}%`)).toBeInTheDocument();
    expect(within(cardGrid()).getByText(`${fmtNumber(input)} kW`)).toBeInTheDocument();
    expect(screen.getByRole(input < 0 ? 'group' : 'progressbar', { name: 'Model 3 Alpha' }))
      .toHaveTextContent(`${fmtNumber(input)}%`);
    expect(state.battery_level).toBe(input);
    expect(state.rated_range).toBe(input * 1_000);
    expect(state.charger_power).toBe(input);
  });

  it('uses effective metric preferences rather than the formatter bridge defaults', () => {
    unitState.length = 'mi';
    unitState.precision = 3;
    unitState.locale = 'de-DE';
    mockVehicles.mockReturnValue(qr({ data: [V1] }));
    mockFleetStates.mockReturnValue(qr({ data: [resolvedEntry(V1, makeState({
      battery_level: 12.375,
      rated_range: 1_234_567,
      is_charging: false,
      speed: 0,
    }))] }));
    renderPage();
    const summary = screen.getByTestId('fleet-current-summary');
    expect(within(summary).getByText('12,375%')).toBeInTheDocument();
    expect(within(summary).getByText(fmtNumber(convertDistanceFromSI(1_234_567, 'mi'), 3, 'de-DE')))
      .toBeInTheDocument();
    expect(within(briefMetric('Live utilization')).getByText('0,000%')).toBeInTheDocument();
    expect(within(briefMetric('Live state available')).getByText('1/1')).toBeInTheDocument();
    expect(within(briefMetric('Departure ready')).getByText('0/1')).toBeInTheDocument();
  });

  it('formats fractional utilization without rounding the raw ratio to a whole percent', () => {
    mockFleetStates.mockReturnValue(qr({ data: [
      resolvedEntry(V1, makeState({ is_charging: true })),
      resolvedEntry(V2, makeState({ is_charging: false, speed: 0 })),
      resolvedEntry(V3, makeState({ is_charging: false, speed: 0 })),
    ] }));
    renderPage();
    expect(within(briefMetric('Live utilization')).getByText('33.33%')).toBeInTheDocument();
    expect(within(briefMetric('Live state available')).getByText('3/3')).toBeInTheDocument();
    expect(within(briefMetric('Departure ready')).getByText('3/3')).toBeInTheDocument();
  });

  it('keeps sparse card readings retained without claiming current battery range power or security', () => {
    mockVehicles.mockReturnValue(qr({ data: [V1] }));
    mockFleetStates.mockReturnValue(qr({ data: [{
      ...resolvedEntry(V1, S1, Date.now() - 10_000),
      verifiedFields: ['state'],
    }] }));
    renderPage();
    const grid = cardGrid();
    const battery = within(grid).getByRole('progressbar', { name: 'Battery level' });
    expect(battery).not.toHaveAttribute('aria-valuenow');
    expect(battery).toHaveAttribute('aria-valuetext', 'No reading');
    expect(battery.querySelector('[data-metric-fill]')).toBeNull();
    expect(within(grid).getByText(/Last known: 80\.00% .* not currently verified/)).toBeInTheDocument();
    expect(within(grid).getByText(/Last known: 400\.00 km .* not currently verified/)).toBeInTheDocument();
    expect(within(grid).getByText(/Last known: 100\.00 km .* not currently verified/)).toBeInTheDocument();
    expect(within(grid).getByText(/Last known: 11\.00 kW .* not currently verified/)).toBeInTheDocument();
    expect(within(grid).getByText(/Last known: Locked .* not currently verified/)).toBeInTheDocument();
    expect(within(grid).getByText(/Last known: Sentry mode on .* not currently verified/)).toBeInTheDocument();
    expect(within(grid).queryByLabelText('Locked')).toBeNull();
    expect(within(grid).getByRole('link', { name: 'Open Model 3 Alpha details' })).toHaveAttribute('href', '/vehicles/1');
  });

  it('distinguishes missing card readings from verified measured zero and preserves the kW boundary', () => {
    mockVehicles.mockReturnValue(qr({ data: [V1, V2] }));
    const fields = [...VERIFIED_FIELDS, 'odometer', 'charger_power', 'is_locked', 'sentry_mode'];
    mockFleetStates.mockReturnValue(qr({ data: [
      { ...resolvedEntry(V1, S1), verifiedFields: fields,
        state: { ...S1, battery_level: null, rated_range: null, odometer: null, charger_power: null } },
      { ...resolvedEntry(V2, makeState({ ...S2, battery_level: 0, rated_range: 0, odometer: 0, is_charging: true, charger_power: 0 })),
        verifiedFields: fields },
    ] }));
    renderPage();
    const grid = cardGrid();
    const bars = within(grid).getAllByRole('progressbar', { name: 'Battery level' });
    expect(bars[0]).not.toHaveAttribute('aria-valuenow');
    expect(bars[0]).toHaveAttribute('aria-valuetext', 'No reading');
    expect(bars[1]).toHaveAttribute('aria-valuenow', '0');
    expect(bars[1]).not.toHaveAttribute('aria-valuetext');
    expect(within(grid).getAllByText('0.00 km')).toHaveLength(2);
    expect(within(grid).getByText('0.00 kW')).toBeInTheDocument();
    expect(within(grid).getAllByText('—')).toHaveLength(4);
  });

  it('preserves imperial card distance formatting without modifying raw readings', () => {
    unitState.length = 'mi';
    mockVehicles.mockReturnValue(qr({ data: [V1] }));
    mockFleetStates.mockReturnValue(qr({ data: [{
      ...resolvedEntry(V1, S1),
      verifiedFields: [...VERIFIED_FIELDS, 'odometer', 'charger_power', 'is_locked', 'sentry_mode'],
    }] }));
    renderPage();
    expect(within(cardGrid()).getByText('248.55 mi')).toBeInTheDocument();
    expect(within(cardGrid()).getByText('62.14 mi')).toBeInTheDocument();
    expect(within(cardGrid()).getByText('11.00 kW')).toBeInTheDocument();
    expect(S1.rated_range).toBe(400_000);
    expect(S1.odometer).toBe(100_000);
    expect(S1.charger_power).toBe(11);
  });

  it('does not claim zero service work or fleet-ready status while work orders are pending', () => {
    mockFleetWorkOrders.mockReturnValue(qr({ isPending: true, isLoading: true }));
    renderPage();
    expect(briefMetric('Service attention')).toHaveAttribute('data-value-state', 'missing');
    expect(within(briefMetric('Service attention')).queryByText('0 open')).toBeNull();
    expect(screen.getByText('Review recommended')).toBeInTheDocument();
    expect(screen.queryByText('Fleet ready')).toBeNull();
    fireEvent.click(within(screen.getByTestId('fleet-operational-brief')).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText(/Unknown urgent work orders remain open/)).toBeInTheDocument();
    expect(within(drawer).queryByText(/0 open work orders were evaluated/)).toBeNull();
  });

  it('retains service counts and bounded coverage through work-order refresh failure with independent retry', () => {
    const refetch = vi.fn();
    mockFleetWorkOrders.mockReturnValue(qr({
      data: { items: [OPEN_WORK_ORDER], total: 101, limit: 100, offset: 0 },
      isError: true, error: new Error('work-order refresh failed'), refetch,
    }));
    renderPage();
    expect(within(briefMetric('Service attention')).getByText('1 open')).toBeInTheDocument();
    expect(within(briefMetric('Service attention')).getByText(/1 loaded of 101 source records; offset 0, limit 100/)).toBeInTheDocument();
    const warning = screen.getAllByTestId('stale-refresh-warning')
      .find((element) => element.textContent?.includes('Fleet work orders may be out of date'));
    if (!warning) throw new Error('Missing retained work-order warning');
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(within(cardGrid()).getByText('Model 3 Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Fleet ready')).toBeNull();
    fireEvent.click(within(screen.getByTestId('fleet-operational-brief')).getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getAllByText(/1 loaded of 101 source records/).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('dialog')).getAllByText(/Previously loaded data remains visible/).length).toBeGreaterThan(0);
  });

  it('keeps pin-read uncertainty distinct from unpinned and retries without toggling or hiding cards', () => {
    const refetch = vi.fn();
    mockPinned.mockReturnValue(qr({ isError: true, error: new Error('pins failed'), refetch }));
    renderPage();
    const notice = screen.getByText('Pinned').closest('[role="alert"]');
    expect(notice).not.toBeNull();
    expect(notice).toBe(screen.getByRole('alert', { name: 'Pinned' }));
    expect(notice).toHaveAttribute('aria-live', 'assertive');
    expect(notice).toHaveTextContent('Unavailable');
    expect(notice).not.toHaveTextContent('Unpinned');
    fireEvent.click(within(notice as HTMLElement).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(within(cardGrid()).getAllByTestId('pin-button')).toHaveLength(3);
    within(cardGrid()).getAllByTestId('pin-button').forEach((button) => {
      expect(button).not.toHaveAttribute('aria-pressed');
      expect(button).toHaveClass('min-h-11', 'min-w-11');
    });
    expect(mockTogglePin().mutate).not.toHaveBeenCalled();
    expect(within(cardGrid()).getAllByRole('link', { name: /^Open .* details$/ })).toHaveLength(3);
  });

  it('uses restrained solid overview bars and wrapping reachable overflow actions', async () => {
    renderPage();
    const charging = screen.getByRole('progressbar', { name: 'Charging' });
    const fill = charging.querySelector<HTMLElement>('[data-metric-fill]');
    expect(fill?.style.background).toBe('var(--semantic-warning)');
    const grid = cardGrid();
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for Model 3 Alpha' }));
    const quickView = await screen.findByRole('button', { name: 'Quick view Model 3 Alpha' });
    const remove = screen.getByRole('button', { name: 'Remove Model 3 Alpha' });
    expect(quickView).toHaveClass('min-h-11', 'whitespace-normal');
    expect(remove).toHaveClass('min-h-11', 'whitespace-normal');
    expect(remove).toHaveClass('text-[var(--semantic-danger)]');
    expect(deleteMut.mutate).not.toHaveBeenCalled();
    expect(syncMut.mutate).not.toHaveBeenCalled();
  });
});
