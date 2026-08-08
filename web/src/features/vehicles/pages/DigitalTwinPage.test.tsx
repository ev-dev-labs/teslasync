/**
 * DigitalTwinPage — behaviour + hardening coverage.
 *
 * The page default-exports the Digital Twin dashboard plus two pure helpers
 * (`statusNeon`, `capitalize`) that are unit-tested directly. Its live data is
 * merged from three polled queries (security / vehicle-state / charging) into a
 * single twin view-model; every branch of that merge surfaces through the KPI
 * band, the live-status chips, and the four component-state panels.
 *
 * What is covered:
 *   1. READY   — the KPI band, both section regions, all five panels, the
 *      live-status badge/chips, the doors/windows/security/lights KV rows and
 *      the "last updated" caption render the merged (charging) state.
 *   2. LOADING — every component panel shows a skeleton and leaks no ready
 *      values while the security stream is still pending.
 *   3. ERROR   — each panel surfaces QueryError and the Retry action is wired
 *      to the query's refetch (failure + user-interaction path via userEvent).
 *   4. EMPTY   — each panel shows its own EmptyState (never a blank panel) and
 *      the KPIs degrade to an em dash; the badge falls back to "offline".
 *   5. GUARD   — an empty fleet renders the "no vehicles" EmptyState instead of
 *      the data scaffolding.
 *   6. SPINNER — while the vehicles list is loading the page shows the shell
 *      spinner and none of the data sections.
 *   7. BADGE   — the single-source status resolves charging > driving >
 *      state-endpoint > any-live-stream > offline.
 *   8. HELPERS — statusNeon status→accent mapping (+ fallback) and capitalize
 *      (+ empty-string em-dash fallback).
 *
 * Network is never hit: the three data hooks, the vehicles hook, the selected
 * vehicle, and the date formatter are all stubbed. i18n is stubbed so visible
 * copy is the English fallback with {{placeholder}} interpolation applied.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { SecurityEvent, ChargingTelemetry } from '@/api/types';

type Veh = { id: number; display_name: string; vin: string; exterior_color: string | null };

interface QueryStub<T> {
  data: T | null | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

// ── Hoisted, per-test controllable state ─────────────────────────────
const h = vi.hoisted(() => ({
  vehicle: null as Veh | null,
  vehicles: [] as Veh[],
  vehiclesLoading: false,
   
  security: undefined as any,
   
  state: undefined as any,
   
  charging: undefined as any,
}));

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

// Deterministic, network-free date formatter (also consumed transitively by
// the page-header DataFreshness chip).
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    opts: { locale: 'en-US', tz: 'UTC' },
    tz: 'UTC',
    locale: 'en-US',
    formatDate: () => 'DATE',
    formatDateTime: () => 'DATETIME',
    formatTime: (v: unknown) => (v == null ? '' : 'MOCK_TIME'),
    formatDateShort: () => 'DATE',
    formatDateWithDay: () => 'DATE',
    formatRelative: () => 'REL',
    formatRelativeTime: () => 'REL',
    formatRelativeDays: () => 'REL',
  }),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicle?.id ?? null,
    vehicle: h.vehicle,
    vehicles: h.vehicles,
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/api/hooks/useVehicles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useVehicles')>();
  return {
    ...actual,
    useVehicles: () => ({ data: h.vehicles, isLoading: h.vehiclesLoading }),
    useVehicleState: () => h.state,
    useSecurityLatest: () => h.security,
    useChargingTelemetryLatest: () => h.charging,
  };
});

import DigitalTwinPage, { statusNeon, capitalize } from './DigitalTwinPage';

// framer-motion's useReducedMotion (via FadeIn / Spinner / DataFreshness /
// VehicleTwin) reads matchMedia, which jsdom lacks. Chart/observer polyfills
// already live in test-setup.ts.
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

function makeQuery<T>(overrides: Partial<QueryStub<T>> = {}): QueryStub<T> {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function makeSecurity(o: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    vehicle_id: 7,
    ts: '2024-06-02T12:00:00Z',
    created_at: '2024-06-02T12:00:00Z',
    event_type: 'state',
    doors_open: null,
    windows_open: null,
    locked: true,
    sentry_mode: true,
    user_present: true,
    detail: null,
    source: 'test',
    // Compound door signal serialized as a JSON string (the wire shape).
    door_state:
      '{"DriverFront":true,"PassengerFront":false,"DriverRear":false,"PassengerRear":false,"TrunkFront":false,"TrunkRear":true}',
    fd_window: 'Open',
    fp_window: 'Closed',
    rd_window: 'Closed',
    rp_window: 'Closed',
    driver_seat_occupied: true,
    lights_high_beams: true,
    lights_hazards_active: false,
    lights_turn_signal: 'TurnSignalLeft',
    ...o,
  };
}

function makeCharging(o: Partial<ChargingTelemetry> = {}): ChargingTelemetry {
  return {
    vehicle_id: 7,
    ts: '2024-06-02T12:00:00Z',
    session_id: 1,
    battery_level: 55,
    battery_range_mi: null,
    charging_state: 'Charging',
    charger_voltage: 240,
    charger_actual_current: 40,
    charger_power_w: 11000,
    charger_phases: 1,
    charge_energy_added_wh: 5000,
    range_added_meters: null,
    range_added_meters_per_hour: null,
    charger_pilot_current: 40,
    scheduled_charging_at: null,
    source: 'test',
    charge_port_door_open: true,
    ...o,
  };
}

 
function makeState(stateOverrides: Record<string, any> = {}, live = true) {
  return {
    state: {
      vehicle_id: 7,
      state: 'charging',
      since: '2024-06-02T12:00:00Z',
      latitude: 0,
      longitude: 0,
      heading: 0,
      speed: 0,
      power: 0,
      battery_level: 55,
      rated_range: 0,
      ideal_range: 0,
      odometer: 0,
      inside_temp: 20,
      outside_temp: 15,
      is_climate_on: false,
      is_charging: true,
      charger_power: 11,
      charge_rate: 0,
      time_to_full_charge: 1,
      is_locked: true,
      sentry_mode: true,
      software_version: '2024',
      ...stateOverrides,
    },
    live,
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/digital-twin']}>
        <DigitalTwinPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Assert the KV row identified by its (unique) label contains `value`. */
function expectKv(label: string, value: string) {
  const dt = screen.getByText(label);
  expect(dt.parentElement).toHaveTextContent(value);
}

/** Assert the MetricCard identified by its (unique) subtitle shows `value`. */
function expectKpi(subtitle: string, value: string) {
  const card = screen.getByText(subtitle).closest('div');
  expect(card).not.toBeNull();
  expect(within(card as HTMLElement).getByText(value)).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicle = { id: 7, display_name: 'Model 3', vin: 'VIN7', exterior_color: 'PearlWhite' };
  h.vehicles = [h.vehicle];
  h.vehiclesLoading = false;
  h.security = makeQuery({ data: makeSecurity() });
  h.state = makeQuery({ data: makeState() });
  h.charging = makeQuery({ data: makeCharging() });
});

afterEach(() => {
  localStorage.clear();
});

describe('DigitalTwinPage', () => {
  it('renders the full dashboard, KPIs, badge/chips and every component panel when live data is ready', () => {
    renderPage();

    // Shell + a11y landmarks.
    expect(screen.getByRole('heading', { name: 'Digital Twin', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Real-time vehicle physical state')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Overview' })).toBeInTheDocument();

    // Section titles + panel titles (no hidden sections).
    for (const title of [
      'Live Overview',
      'Component State',
      'Doors & Openings',
      'Windows',
      'Security & Status',
      'Lights & Signals',
      'Live Status',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }

    // KPI band — subtitles are unique; assert the derived open counts.
    expectKpi('of 6 openings', '2'); // driverFront + rear trunk
    expectKpi('of 4 windows', '1'); // FD open

    // Live status — two StatusBadges (Live Status panel + Security footer) show
    // the single-source "charging" status; the sentry chip is on.
    expect(screen.getAllByText('charging').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Sentry On')).toBeInTheDocument();

    // Doors panel KV rows (from the JSON door_state).
    expectKv('Driver Front', 'Open');
    expectKv('Frunk', 'Closed');
    expectKv('Trunk', 'Open');

    // Windows panel.
    expectKv('Front Driver', 'Open');
    expectKv('Front Passenger', 'Closed');

    // Lights panel.
    expectKv('Headlights', 'On');
    expectKv('Hazards', 'Off');
    expectKv('Turn Signal', 'Left');

    // Security panel — occupied seat + not driving while charging.
    expectKv('Driver Seat', 'Occupied');
    expectKv('Driving', 'No');

    // Last-updated caption (deterministic via the stubbed formatter).
    expect(screen.getByText(/Last updated/).textContent).toContain('MOCK_TIME');
  });

  it('shows a skeleton in every component panel while the security stream loads and leaks no values', () => {
    h.security = makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 });
    h.state = makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 });
    h.charging = makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 });

    const { container } = renderPage();

    expect(screen.getByRole('heading', { name: 'Digital Twin', level: 1 })).toBeInTheDocument();
    // Four panels → at least four skeletons; no KV rows leaked.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('Driver Front')).not.toBeInTheDocument();
    expect(screen.queryByText('No door data available')).not.toBeInTheDocument();
  });

  it('surfaces QueryError in each panel and wires the Retry action to the query refetch', () => {
    h.security = makeQuery({ isError: true, error: new Error('boom'), dataUpdatedAt: 0 });
    h.state = makeQuery({ dataUpdatedAt: 0 });
    h.charging = makeQuery({ dataUpdatedAt: 0 });

    renderPage();

    expect(screen.getAllByText(/Can't reach server/i).length).toBeGreaterThan(0);

    const retry = screen.getAllByRole('button', { name: /^Retry$/i });
    expect(retry.length).toBeGreaterThanOrEqual(3);

    fireEvent.click(retry[0]); // doors panel → securityQ.refetch
    expect(h.security.refetch).toHaveBeenCalledTimes(1);
  });

  it('renders a per-section EmptyState (never a blank panel) and an offline badge when no live data has arrived', () => {
    h.security = makeQuery({ data: null });
    h.state = makeQuery({ data: null });
    h.charging = makeQuery({ data: null });

    renderPage();

    expect(screen.getByText('No door data available')).toBeInTheDocument();
    expect(screen.getByText('No window data available')).toBeInTheDocument();
    expect(screen.getByText('No live status available')).toBeInTheDocument();
    expect(screen.getByText('No lights data available')).toBeInTheDocument();

    // KPIs degrade to an em dash rather than crashing.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    // Single-source status falls back to offline. Only the Live Status badge
    // shows (the Security panel footer badge is hidden in its empty branch).
    expect(screen.getAllByText('offline').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the "no vehicles" empty state instead of the data scaffolding for an empty fleet', () => {
    h.vehicle = null;
    h.vehicles = [];

    renderPage();

    expect(
      screen.getByText('No vehicles found. Add a vehicle to see its digital twin.'),
    ).toBeInTheDocument();
    // The data scaffolding must NOT render behind the guard.
    expect(screen.queryByText('Live Overview')).not.toBeInTheDocument();
    expect(screen.queryByText('Doors & Openings')).not.toBeInTheDocument();
  });

  it('renders the shell spinner and no data sections while the vehicles list is loading', () => {
    h.vehicle = null;
    h.vehicles = [];
    h.vehiclesLoading = true;

    const { container } = renderPage();

    expect(screen.getByRole('heading', { name: 'Digital Twin', level: 1 })).toBeInTheDocument();
    expect(container.querySelector('.py-20')).not.toBeNull(); // PageContainer loading branch
    expect(screen.queryByText('Live Overview')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No vehicles found. Add a vehicle to see its digital twin.'),
    ).not.toBeInTheDocument();
  });

  it('resolves the badge to "driving" from the state endpoint when moving and not charging', () => {
    h.security = makeQuery({ data: null });
    h.charging = makeQuery({ data: null });
    h.state = makeQuery({
      data: makeState({ state: 'driving', is_charging: false, charger_power: 0, speed: 42 }),
    });

    renderPage();

    expect(screen.getAllByText('driving').length).toBeGreaterThanOrEqual(1);
    expectKpi('of 6 openings', '—'); // no security data → openings unknown
  });

  it('falls back to "online" when the state endpoint is empty but another live stream is flowing', () => {
    h.state = makeQuery({ data: null });
    h.charging = makeQuery({ data: null });
    // Security present but nothing that implies charging/driving.
    h.security = makeQuery({
      data: makeSecurity({ door_state: 'closed', fd_window: 'Closed' }),
    });

    renderPage();

    expect(screen.getAllByText('online').length).toBeGreaterThanOrEqual(2);
  });
});

describe('statusNeon', () => {
  it('maps known vehicle statuses to their color-blind-safe accent', () => {
    expect(statusNeon('driving')).toBe('green');
    expect(statusNeon('charging')).toBe('cyan');
    expect(statusNeon('online')).toBe('blue');
    expect(statusNeon('offline')).toBe('red');
    expect(statusNeon('asleep')).toBe('purple');
    expect(statusNeon('parked')).toBe('amber');
  });

  it('falls back to cyan for unknown / uncovered statuses', () => {
    expect(statusNeon('updating')).toBe('cyan');
    expect(statusNeon('totally-unknown')).toBe('cyan');
    expect(statusNeon('')).toBe('cyan');
  });
});

describe('capitalize', () => {
  it('upper-cases the first character and preserves the rest', () => {
    expect(capitalize('offline')).toBe('Offline');
    expect(capitalize('a')).toBe('A');
    expect(capitalize('ABC')).toBe('ABC');
  });

  it('returns an em dash for an empty string', () => {
    expect(capitalize('')).toBe('—');
  });
});
