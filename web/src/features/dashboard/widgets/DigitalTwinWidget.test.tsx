/**
 * DigitalTwinWidget — behavioural, branch, null-safety and a11y coverage for
 * the dashboard "Digital Twin" widget.
 *
 * The widget resolves a vehicle (from the `vehicleId` prop, else the first
 * vehicle, else id `0`), subscribes to three live sources on a 5s poll
 * (`useVehicleState`, `useSecurityLatest`, `useChargingTelemetryLatest`), folds
 * them into a `VehicleTwinState` via `buildTwinState`, and renders:
 *   • a `<VehicleTwin>` scene (its `size` derived from the widget's grid span);
 *   • a wrap of status chips — lock, windows, driving/charging, sentry, lights,
 *     hazards, open-door count, frunk/trunk;
 *   • the vehicle's display name (VIN fallback);
 *   • the `WidgetShell` freshness/refresh control + an "Open" details link.
 *
 * What this file pins:
 *   - the VEHICLE-ID RESOLUTION ladder (prop → find → first → 0) and the exact
 *     HOOK CONTRACT each source is subscribed with (`(id, { refetchInterval })`
 *     / `(id, 5000)`), so a regression to the wrong id or poll cadence is caught;
 *   - the LOADING gate — a fix hardened here so the widget shows a skeleton
 *     while the *vehicle list itself* loads (previously it flashed the empty
 *     state before any vehicle resolved);
 *   - the EMPTY state when no vehicle exists (never a blank panel);
 *   - the LOCK / WINDOW badge branches (locked/unlocked/unknown,
 *     closed/open/unknown) computed from the security snapshot;
 *   - each OPTIONAL status chip (driving, charging, sentry, lights, hazards,
 *     open-door count, frunk, trunk) — shown when active, hidden when idle;
 *   - the TWIN SIZE derivation (`md` for wide/tall spans, else `sm`) and the
 *     paint plumbing (`vehicleId` + `exterior_color`) handed to `<VehicleTwin>`;
 *   - the DISPLAY-NAME → VIN → "Unknown vehicle" fallback chain;
 *   - the REFRESH wiring (chip → `refetch`) and the details LINK / title a11y.
 *
 * Strategy: the four `@/api/hooks/useVehicles` exports are the network boundary
 * and are fully controllable via hoisted mocks. `<VehicleTwin>` is stubbed with
 * a prop-recording spy so the widget's own derivation (twin state + size + paint)
 * is observable without rendering the heavy animated SVG. `buildTwinState` runs
 * for real so the security→badge mapping is exercised end to end. `react-i18next`
 * echoes each `t(key, fallback)` fallback so assertions read against English copy.
 * `DataFreshness`'s display hooks are stubbed so the freshness/refresh chip
 * renders without a Settings provider. A `<MemoryRouter>` wraps every render
 * because the widget renders `<Link>` and `EmptyState` renders a `<Link>`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { SecurityEvent, ChargingTelemetry, Vehicle, VehicleState } from '@/api/types';
import type { WidgetSize } from './types';

// ── Hoisted mocks (referenced inside vi.mock factories) ─────────────────────────

const { vehiclesMock, stateMock, securityMock, chargingMock, twinPropsSpy } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  stateMock: vi.fn(),
  securityMock: vi.fn(),
  chargingMock: vi.fn(),
  twinPropsSpy: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
  useVehicleState: (...args: unknown[]) => stateMock(...args),
  useSecurityLatest: (...args: unknown[]) => securityMock(...args),
  useChargingTelemetryLatest: (...args: unknown[]) => chargingMock(...args),
}));

// VehicleTwin — a prop-recording stub so we can assert size/paint derivation
// without rendering the animated SVG scene (which pulls in framer-motion).
vi.mock('@/components/vehicles', () => ({
  VehicleTwin: (props: Record<string, unknown>) => {
    twinPropsSpy(props);
    return <div data-testid="vehicle-twin" />;
  },
}));

// i18n → return the developer fallback so copy reads as English.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback ?? _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// DataFreshness display hooks — stubbed so the freshness chip renders without a
// Settings/QueryClient provider.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (v: unknown) => String(v) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));

import DigitalTwinWidget from './DigitalTwinWidget';

// ── Fixtures ────────────────────────────────────────────────────────────────────

const NOW = '2026-07-05T12:00:00.000Z';

function makeVehicle(over: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 7,
    vehicle_id: 7,
    vin: '5YJ3E1EA7KF000007',
    display_name: 'Model Y',
    model: 'model3',
    trim_badging: 'p74d',
    exterior_color: 'DeepBlue',
    wheel_type: 'Stiletto20',
    state: 'online',
    healthy: true,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

/** A `/security/latest` snapshot with every widget-touched field defaulted to
 *  null so each test opts into exactly the facet it exercises. */
function makeSecurity(over: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    vehicle_id: 7,
    ts: NOW,
    event_type: 'state',
    doors_open: null,
    windows_open: null,
    locked: null,
    sentry_mode: null,
    user_present: null,
    detail: null,
    source: 'signal',
    created_at: NOW,
    door_state: null,
    fd_window: null,
    fp_window: null,
    rd_window: null,
    rp_window: null,
    driver_seat_belt: null,
    passenger_seat_belt: null,
    driver_seat_occupied: null,
    lights_high_beams: null,
    lights_hazards_active: null,
    lights_turn_signal: null,
    ...over,
  };
}

function makeVehicleState(over: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 7,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 60,
    rated_range: 0,
    ideal_range: 0,
    odometer: 0,
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
  } as VehicleState;
}

function makeCharging(over: Partial<ChargingTelemetry> = {}): ChargingTelemetry {
  return {
    vehicle_id: 7,
    ts: NOW,
    session_id: null,
    battery_level: null,
    battery_range_mi: null,
    charging_state: null,
    charger_voltage: null,
    charger_actual_current: null,
    charger_power_w: null,
    charger_phases: null,
    charge_energy_added_wh: null,
    range_added_meters: null,
    range_added_meters_per_hour: null,
    charger_pilot_current: null,
    scheduled_charging_at: null,
    source: 'signal',
    ...over,
  };
}

interface StateOverrides {
  state?: VehicleState;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function setVehicles(list: Vehicle[] | undefined, isLoading = false) {
  vehiclesMock.mockReturnValue({ data: list, isLoading });
}

function setState(over: StateOverrides = {}) {
  const q = {
    data: over.state !== undefined ? { state: over.state, live: false } : undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.parse(NOW),
    refetch: vi.fn(),
    ...over,
  };
  stateMock.mockReturnValue(q);
  return q;
}

function setSecurity(data?: SecurityEvent, isLoading = false) {
  securityMock.mockReturnValue({ data, isLoading });
}

function setCharging(data?: ChargingTelemetry) {
  chargingMock.mockReturnValue({ data });
}

const SMALL: WidgetSize = { cols: 2, rows: 2 };
const WIDE: WidgetSize = { cols: 3, rows: 2 };
const TALL: WidgetSize = { cols: 1, rows: 5 };

function renderWidget(size: WidgetSize = SMALL, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <DigitalTwinWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setVehicles([makeVehicle()]);
  setState({ state: makeVehicleState() });
  setSecurity(makeSecurity({ locked: true }));
  setCharging(makeCharging());
});

// ── Loading & empty states ──────────────────────────────────────────────────────

describe('DigitalTwinWidget — loading & empty states', () => {
  it('renders only a skeleton (no twin, no chips) while the vehicle list loads', () => {
    setVehicles(undefined, true);
    const { container } = renderWidget(SMALL);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('vehicle-twin')).toBeNull();
    expect(screen.queryByText('Locked')).toBeNull();
  });

  it('renders a skeleton while the vehicle state is loading', () => {
    setState({ isLoading: true });
    const { container } = renderWidget(SMALL);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('vehicle-twin')).toBeNull();
  });

  it('shows the "No vehicle data" empty state (not a twin) when no vehicle exists', () => {
    setVehicles([]);
    renderWidget(SMALL);

    expect(screen.getByRole('status')).toHaveTextContent('No vehicle data');
    expect(screen.queryByTestId('vehicle-twin')).toBeNull();
  });

  it('renders the twin (not the empty state) once a vehicle resolves', () => {
    renderWidget(SMALL);

    expect(screen.getByTestId('vehicle-twin')).toBeInTheDocument();
    expect(screen.queryByText('No vehicle data')).toBeNull();
  });
});

// ── Vehicle-id resolution & hook contract ────────────────────────────────────────

describe('DigitalTwinWidget — vehicle resolution & hook contract', () => {
  it('resolves the vehicleId prop and subscribes every source with a 5s poll', () => {
    setVehicles([makeVehicle({ id: 7 }), makeVehicle({ id: 9, vehicle_id: 9 })]);
    renderWidget(SMALL, 9);

    expect(stateMock).toHaveBeenCalledWith(9, { refetchInterval: 5000 });
    expect(securityMock).toHaveBeenCalledWith(9, 5000);
    expect(chargingMock).toHaveBeenCalledWith(9, 5000);
  });

  it('falls back to the first vehicle when the prop id is not found', () => {
    setVehicles([makeVehicle({ id: 7 })]);
    renderWidget(SMALL, 999);

    expect(stateMock).toHaveBeenCalledWith(7, { refetchInterval: 5000 });
  });

  it('falls back to the first vehicle id when no vehicleId prop is provided', () => {
    setVehicles([makeVehicle({ id: 42, vehicle_id: 42 })]);
    renderWidget(SMALL, undefined);

    expect(stateMock).toHaveBeenCalledWith(42, { refetchInterval: 5000 });
    expect(securityMock).toHaveBeenCalledWith(42, 5000);
  });

  it('subscribes with id 0 (queries disabled) when no vehicles are available', () => {
    setVehicles([]);
    renderWidget(SMALL, undefined);

    expect(stateMock).toHaveBeenCalledWith(0, { refetchInterval: 5000 });
    expect(securityMock).toHaveBeenCalledWith(0, 5000);
    expect(chargingMock).toHaveBeenCalledWith(0, 5000);
  });
});

// ── Twin scene: size + paint plumbing ────────────────────────────────────────────

describe('DigitalTwinWidget — twin scene', () => {
  it('hands the resolved paint (vehicleId + exterior_color) to VehicleTwin', () => {
    setVehicles([makeVehicle({ id: 7, exterior_color: 'DeepBlue' })]);
    renderWidget(SMALL);

    expect(twinPropsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ vehicleId: 7, exteriorColor: 'DeepBlue', driveIn: true }),
    );
  });

  it('computes the compact "sm" twin size for a small grid span', () => {
    renderWidget(SMALL); // cols 2, rows 2

    expect(twinPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ size: 'sm' }));
  });

  it('computes the larger "md" twin size for a wide (cols>=3) or tall (rows>=5) span', () => {
    renderWidget(WIDE); // cols 3
    expect(twinPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ size: 'md' }));

    twinPropsSpy.mockClear();
    renderWidget(TALL); // rows 5
    expect(twinPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ size: 'md' }));
  });
});

// ── Lock badge ───────────────────────────────────────────────────────────────────

describe('DigitalTwinWidget — lock badge', () => {
  it('shows "Locked" when the security snapshot reports a locked vehicle', () => {
    setSecurity(makeSecurity({ locked: true }));
    renderWidget(SMALL);

    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.queryByText('Unlocked')).toBeNull();
  });

  it('shows "Unlocked" when the vehicle is reported unlocked', () => {
    setSecurity(makeSecurity({ locked: false }));
    renderWidget(SMALL);

    expect(screen.getByText('Unlocked')).toBeInTheDocument();
  });

  it('shows "Lock Unknown" when neither security nor state knows the lock state', () => {
    setSecurity(undefined);
    setState({ state: makeVehicleState({ is_locked: undefined }) });
    renderWidget(SMALL);

    expect(screen.getByText('Lock Unknown')).toBeInTheDocument();
  });
});

// ── Window badge ─────────────────────────────────────────────────────────────────

describe('DigitalTwinWidget — window badge', () => {
  it('shows "Windows Closed" when the windows summary reports all closed', () => {
    setSecurity(makeSecurity({ locked: true, windows_open: 'closed' }));
    renderWidget(SMALL);

    expect(screen.getByText('Windows Closed')).toBeInTheDocument();
  });

  it('shows the open-window count when a window is open', () => {
    setSecurity(makeSecurity({ locked: true, windows_open: 'fd' }));
    renderWidget(SMALL);

    expect(screen.getByText('1 Open')).toBeInTheDocument();
    expect(screen.queryByText('Windows Closed')).toBeNull();
  });

  it('shows "Windows Unknown" when the window state is absent', () => {
    setSecurity(makeSecurity({ locked: true, windows_open: null }));
    renderWidget(SMALL);

    expect(screen.getByText('Windows Unknown')).toBeInTheDocument();
  });
});

// ── Optional status chips ────────────────────────────────────────────────────────

describe('DigitalTwinWidget — status chips', () => {
  it('surfaces the Driving chip when the vehicle is in motion', () => {
    setState({ state: makeVehicleState({ speed: 24 }) });
    renderWidget(SMALL);

    expect(screen.getByText('Driving')).toBeInTheDocument();
  });

  it('surfaces the Charging chip from the charging telemetry state', () => {
    setCharging(makeCharging({ charging_state: 'Charging' }));
    renderWidget(SMALL);

    expect(screen.getByText('Charging')).toBeInTheDocument();
  });

  it('surfaces Sentry, Lights On and Hazards chips from the security snapshot', () => {
    setSecurity(
      makeSecurity({
        locked: true,
        sentry_mode: true,
        lights_high_beams: true,
        lights_hazards_active: true,
      }),
    );
    renderWidget(SMALL);

    expect(screen.getByText('Sentry')).toBeInTheDocument();
    expect(screen.getByText('Lights On')).toBeInTheDocument();
    expect(screen.getByText('Hazards')).toBeInTheDocument();
  });

  it('counts open side doors and surfaces frunk + trunk chips from door_state', () => {
    setSecurity(
      makeSecurity({
        locked: false,
        door_state: JSON.stringify({
          DriverFront: true,
          PassengerRear: true,
          TrunkFront: true,
          TrunkRear: true,
        }),
      }),
    );
    renderWidget(SMALL);

    expect(screen.getByText('2 Doors Open')).toBeInTheDocument();
    expect(screen.getByText('Frunk Open')).toBeInTheDocument();
    expect(screen.getByText('Trunk Open')).toBeInTheDocument();
  });

  it('hides every optional chip when the vehicle is idle and buttoned up', () => {
    setState({ state: makeVehicleState({ speed: 0, state: 'online' }) });
    setSecurity(makeSecurity({ locked: true, windows_open: 'closed', sentry_mode: false }));
    setCharging(makeCharging({ charging_state: null }));
    renderWidget(SMALL);

    expect(screen.queryByText('Driving')).toBeNull();
    expect(screen.queryByText('Charging')).toBeNull();
    expect(screen.queryByText('Sentry')).toBeNull();
    expect(screen.queryByText('Lights On')).toBeNull();
    expect(screen.queryByText('Hazards')).toBeNull();
    expect(screen.queryByText(/Doors Open$/)).toBeNull();
    expect(screen.queryByText('Frunk Open')).toBeNull();
    expect(screen.queryByText('Trunk Open')).toBeNull();
  });
});

// ── Vehicle label fallback chain ─────────────────────────────────────────────────

describe('DigitalTwinWidget — vehicle label', () => {
  it('renders the display name when present', () => {
    setVehicles([makeVehicle({ display_name: 'Bluey' })]);
    renderWidget(SMALL);

    expect(screen.getByText('Bluey')).toBeInTheDocument();
  });

  it('falls back to the VIN when the display name is empty', () => {
    setVehicles([makeVehicle({ display_name: '', vin: '5YJXCAE44JF000123' })]);
    renderWidget(SMALL);

    expect(screen.getByText('5YJXCAE44JF000123')).toBeInTheDocument();
  });

  it('falls back to "Unknown vehicle" when both display name and VIN are empty', () => {
    setVehicles([makeVehicle({ display_name: '', vin: '' })]);
    renderWidget(SMALL);

    expect(screen.getByText('Unknown vehicle')).toBeInTheDocument();
  });
});

// ── Interactions & accessibility ─────────────────────────────────────────────────

describe('DigitalTwinWidget — interactions & a11y', () => {
  it('invokes refetch when the accessible refresh control is activated', () => {
    const q = setState({ state: makeVehicleState() });
    renderWidget(SMALL);

    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    fireEvent.click(refresh);

    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('exposes the "Open" link to the full digital-twin route', () => {
    renderWidget(SMALL);

    const link = screen.getByRole('link', { name: /Open/i });
    expect(link).toHaveAttribute('href', '/digital-twin');
  });

  it('exposes the widget title as a heading', () => {
    renderWidget(SMALL);

    expect(screen.getByRole('heading', { name: /Digital Twin/i })).toBeInTheDocument();
  });
});
