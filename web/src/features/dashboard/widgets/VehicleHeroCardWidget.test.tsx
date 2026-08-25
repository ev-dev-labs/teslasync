/**
 * VehicleHeroCardWidget contract + hardening tests.
 *
 * The widget is a dashboard tile whose entire shape is a function of three
 * inputs: the resolved vehicle (`vehicleId` prop → matching fleet vehicle, else
 * the first fleet vehicle, else none), the `useVehicleState` query result, and
 * the widget `size`:
 *
 *   - size.cols <= 1 && rows <= 1 → compact tile: status badge + battery % +
 *     name, no header title.
 *   - otherwise                   → full tile: name + status header, model/trim
 *     subtitle, a battery/range/cabin metric grid, an optional Outside cell when
 *     wide (cols >= 3), an optional tall row (Outside + Ideal) when tall
 *     (rows >= 2) and not wide, and a charging banner when actively charging.
 *   - no vehicle                  → the accessible "No vehicle data" empty state.
 *   - loading / error             → the shell's skeleton / QueryError chrome.
 *
 * The SI-floor is exercised for real: `ideal_range` is metres and the cabin /
 * outside temps are °C, converted at the display boundary through the genuine
 * `@/lib/unitConversion` helpers (km & mi, °C & °F). i18n is stubbed to echo the
 * English fallback so every copy assertion is real; `@/hooks/useUnits` is stubbed
 * so the distance/temperature preferences are injectable; and `@/api/hooks/
 * useVehicles` is partially mocked (real module kept, only the two hooks the
 * widget reads are overridden) so no network is ever touched.
 *
 * `window.matchMedia` is stubbed to report reduced motion so the `AnimatedNumber`
 * battery counter and the `FadeIn` wrapper land on their final state
 * synchronously, making every assertion deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n passthrough: honour the English fallback so every copy assertion is real.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// The distance + temperature preferences are injected per-test through mutable
// holders so the SI → display conversion can be exercised for km/mi and °C/°F.
// The widget only reads `unitPrefs.{distance,temperature}`, so a partial stub
// is sufficient.
let MOCK_DISTANCE_UNIT: 'km' | 'mi';
let MOCK_TEMP_UNIT: '°C' | '°F';
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: MOCK_DISTANCE_UNIT, temperature: MOCK_TEMP_UNIT },
  }),
}));

// The fleet list + vehicle-state result are injected per-test through these
// mutable holders (the `MOCK_`/`mock` prefixes let vitest hoist the factory
// above them safely). Only the two hooks the widget reads are overridden — the
// rest of the real module is preserved so transitive importers keep working.
const mockUseVehicleState = vi.fn((_id: number) => MOCK_STATE);
let MOCK_VEHICLES: VehiclesQuery;
let MOCK_STATE: StateQuery;
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return {
    ...actual,
    useVehicles: () => MOCK_VEHICLES,
    useVehicleState: (id: number) => mockUseVehicleState(id),
  };
});

import VehicleHeroCardWidget from './VehicleHeroCardWidget';
import type { WidgetSize } from './types';
import type { VehicleState } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';

/** Only the fields the widget reads off the `useVehicleState` result. */
interface StateQuery {
  data: { state?: VehicleState } | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

/** Only the fields the widget reads off the `useVehicles` result. */
interface VehiclesQuery {
  data: Vehicle[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

const NOW = Date.parse('2026-07-06T00:00:00.000Z');
const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const FULL: WidgetSize = { cols: 2, rows: 1 };
const WIDE: WidgetSize = { cols: 3, rows: 1 };
const TALL: WidgetSize = { cols: 2, rows: 2 };

// 300 km exactly / 100 mi exactly, so the rounded display value is unambiguous
// regardless of the active distance preference.
const RANGE_300KM_M = 300_000;
const RANGE_100MI_M = 160_934.4;

/** Build a fully-typed VehicleState; every reading defaults to a neutral zero. */
function makeState(overrides: Partial<VehicleState> = {}): VehicleState {
  const base: VehicleState = {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 0,
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
  };
  return { ...base, ...overrides };
}

function makeStateQuery(overrides: Partial<StateQuery> = {}): StateQuery {
  return {
    data: { state: makeState() },
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: NOW,
    refetch: vi.fn(),
    ...overrides,
  };
}

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1,
    vehicle_id: 1,
    vin: 'VIN0001',
    display_name: 'My Tesla',
    model: 'Model 3',
    trim_badging: 'Long Range',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function makeVehiclesQuery(overrides: Partial<VehiclesQuery> = {}): VehiclesQuery {
  return { data: [makeVehicle()], isLoading: false, isError: false, ...overrides };
}

interface RenderOpts {
  vehicles?: VehiclesQuery;
  state?: StateQuery;
  vehicleId?: number;
  distanceUnit?: 'km' | 'mi';
  tempUnit?: '°C' | '°F';
}

function renderWidget(size: WidgetSize, opts: RenderOpts = {}) {
  MOCK_VEHICLES = opts.vehicles ?? makeVehiclesQuery();
  MOCK_STATE = opts.state ?? makeStateQuery();
  MOCK_DISTANCE_UNIT = opts.distanceUnit ?? 'km';
  MOCK_TEMP_UNIT = opts.tempUnit ?? '°C';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <VehicleHeroCardWidget vehicleId={opts.vehicleId} size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Force reduced motion so AnimatedNumber / FadeIn resolve to their final
  // state synchronously (no requestAnimationFrame tween to await).
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  MOCK_VEHICLES = makeVehiclesQuery();
  MOCK_STATE = makeStateQuery();
  MOCK_DISTANCE_UNIT = 'km';
  MOCK_TEMP_UNIT = '°C';
  mockUseVehicleState.mockClear();
});

afterEach(() => {
  cleanup();
});

// ── Full view: content + unit conversion ────────────────────────────────────

describe('VehicleHeroCardWidget — full view', () => {
  it('renders the titled header, subtitle, status and metric grid with converted values', () => {
    renderWidget(FULL, {
      vehicles: makeVehiclesQuery({
        data: [makeVehicle({ display_name: 'My Tesla', model: 'Model 3', trim_badging: 'Long Range' })],
      }),
      state: makeStateQuery({
        data: {
          state: makeState({ state: 'online', battery_level: 80, ideal_range: RANGE_300KM_M, inside_temp: 22 }),
        },
      }),
    });

    // Header title (full tile only), vehicle name and model/trim subtitle.
    expect(screen.getByText('Vehicle')).toBeInTheDocument();
    expect(screen.getByText('My Tesla')).toBeInTheDocument();
    expect(screen.getByText('Model 3 Long Range')).toBeInTheDocument();

    // Status badge echoes the live vehicle state.
    expect(screen.getByText('online')).toBeInTheDocument();

    // Battery / range / cabin, SI-converted for the km + °C preference.
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('300 km')).toBeInTheDocument();
    expect(screen.getByText('22°C')).toBeInTheDocument();
  });

  it('drops the trim from the subtitle when it is absent', () => {
    renderWidget(FULL, {
      vehicles: makeVehiclesQuery({
        data: [makeVehicle({ model: 'Model Y', trim_badging: '' })],
      }),
    });

    expect(screen.getByText('Model Y')).toBeInTheDocument();
  });

  it('falls back to the VIN when the vehicle has no display name', () => {
    renderWidget(FULL, {
      vehicles: makeVehiclesQuery({ data: [makeVehicle({ display_name: '', vin: 'VINFALLBACK' })] }),
    });

    expect(screen.getByText('VINFALLBACK')).toBeInTheDocument();
  });

  it('converts the SI range to miles when that is the distance preference', () => {
    renderWidget(FULL, {
      distanceUnit: 'mi',
      state: makeStateQuery({ data: { state: makeState({ ideal_range: RANGE_100MI_M }) } }),
    });

    expect(screen.getByText('100 mi')).toBeInTheDocument();
    expect(screen.queryByText('100 km')).toBeNull();
  });

  it('converts the SI-Celsius cabin temp to °F when that is the preference', () => {
    renderWidget(FULL, {
      tempUnit: '°F',
      state: makeStateQuery({ data: { state: makeState({ inside_temp: 22 }) } }),
    });

    // 22 °C → 71.6 °F → rounds to 72, tagged with the Fahrenheit unit only.
    expect(screen.getByText('72°F')).toBeInTheDocument();
    expect(screen.queryByText('22°C')).toBeNull();
  });

  it('shows a real finite-zero range as "0 <unit>" rather than an em-dash', () => {
    renderWidget(FULL, {
      state: makeStateQuery({ data: { state: makeState({ ideal_range: 0, battery_level: 10 }) } }),
    });

    expect(screen.getByText('0 km')).toBeInTheDocument();
  });

  it('renders an em-dash placeholder for every metric when the state is absent (null-safety)', () => {
    // Vehicle known, but its state snapshot has not landed → the query resolves
    // with no `state`. Battery, range and cabin each render the em-dash and the
    // status falls back to "offline"; nothing throws on the missing readings.
    renderWidget(FULL, { state: makeStateQuery({ data: undefined }) });

    expect(screen.getByText('offline')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
  });
});

// ── Battery colour bands ─────────────────────────────────────────────────────

describe('VehicleHeroCardWidget — battery colour classifier', () => {
  it.each<[number, string]>([
    [80, 'text-emerald-400'],
    [51, 'text-emerald-400'],
    [50, 'text-amber-400'],
    [21, 'text-amber-400'],
    [20, 'text-red-400'],
    [5, 'text-red-400'],
  ])('tints a %i%% battery with %s', (level, cls) => {
    renderWidget(FULL, {
      state: makeStateQuery({ data: { state: makeState({ battery_level: level }) } }),
    });

    expect(screen.getByText(`${level}%`).className).toContain(cls);
  });
});

// ── Charging banner ──────────────────────────────────────────────────────────

describe('VehicleHeroCardWidget — charging banner', () => {
  it('shows the charging banner with formatted power and hides the bolt from AT', () => {
    renderWidget(FULL, {
      state: makeStateQuery({ data: { state: makeState({ is_charging: true, charger_power: 11 }) } }),
    });

    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.getByText('11.0 kW')).toBeInTheDocument();
    // The decorative bolt glyph must not be announced by screen readers.
    expect(screen.getByText('⚡').getAttribute('aria-hidden')).toBe('true');
  });

  it('omits the power readout when the charger power is zero', () => {
    renderWidget(FULL, {
      state: makeStateQuery({ data: { state: makeState({ is_charging: true, charger_power: 0 }) } }),
    });

    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.queryByText(/kW/)).toBeNull();
  });

  it('hides the charging banner entirely when the vehicle is not charging', () => {
    renderWidget(FULL, {
      state: makeStateQuery({ data: { state: makeState({ is_charging: false }) } }),
    });

    expect(screen.queryByText('Charging')).toBeNull();
    expect(screen.queryByText('⚡')).toBeNull();
  });
});

// ── Responsive size variants ─────────────────────────────────────────────────

describe('VehicleHeroCardWidget — size variants', () => {
  it('adds the Outside metric when the tile is wide (cols >= 3)', () => {
    renderWidget(WIDE, {
      state: makeStateQuery({ data: { state: makeState({ inside_temp: 22, outside_temp: 10 }) } }),
    });

    expect(screen.getByText('Outside')).toBeInTheDocument();
    expect(screen.getByText('10°C')).toBeInTheDocument();
    expect(screen.getByText('22°C')).toBeInTheDocument();
  });

  it('omits the Outside metric on a plain (non-wide, non-tall) full tile', () => {
    renderWidget(FULL, {
      state: makeStateQuery({ data: { state: makeState({ outside_temp: 10 }) } }),
    });

    expect(screen.queryByText('Outside')).toBeNull();
  });

  it('adds an Outside + Ideal row when the tile is tall (rows >= 2) but not wide', () => {
    renderWidget(TALL, {
      state: makeStateQuery({ data: { state: makeState({ ideal_range: RANGE_300KM_M, outside_temp: 10 }) } }),
    });

    expect(screen.getByText('Range')).toBeInTheDocument();
    expect(screen.getByText('Outside')).toBeInTheDocument();
    expect(screen.getByText('Ideal')).toBeInTheDocument();
    // The ideal range echoes the top-grid range value, so it appears twice.
    expect(screen.getAllByText('300 km')).toHaveLength(2);
  });
});

// ── Compact view ─────────────────────────────────────────────────────────────

describe('VehicleHeroCardWidget — compact view', () => {
  it('renders the status badge, battery percentage and name without a header title', () => {
    renderWidget(COMPACT, {
      vehicles: makeVehiclesQuery({ data: [makeVehicle({ display_name: 'Compact Car' })] }),
      state: makeStateQuery({ data: { state: makeState({ state: 'online', battery_level: 80 }) } }),
    });

    expect(screen.getByText('online')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Compact Car')).toBeInTheDocument();
    // A 1×1 tile suppresses the header title entirely.
    expect(screen.queryByText('Vehicle')).toBeNull();
  });

  it('shows an em-dash for the battery when the state is absent', () => {
    renderWidget(COMPACT, { state: makeStateQuery({ data: undefined }) });

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('offline')).toBeInTheDocument();
  });
});

// ── Empty / loading / error lifecycle ────────────────────────────────────────

describe('VehicleHeroCardWidget — lifecycle states', () => {
  it('shows the accessible empty state when the fleet is genuinely empty', () => {
    renderWidget(FULL, {
      vehicles: makeVehiclesQuery({ data: [] }),
      state: makeStateQuery({ data: undefined }),
    });

    expect(screen.getByText('No vehicle data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // The disabled state query is still resolved for the id-0 sentinel.
    expect(mockUseVehicleState).toHaveBeenCalledWith(0);
  });

  it('renders only a skeleton while the selected vehicle state is loading', () => {
    const { container } = renderWidget(FULL, { state: makeStateQuery({ isLoading: true }) });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Vehicle')).toBeNull();
    expect(screen.queryByText('No vehicle data')).toBeNull();
  });

  it('shows a skeleton (not the empty state) while the fleet list is still loading', () => {
    // Regression guard: before any vehicle resolves the state query runs with
    // id 0 (disabled) and reports isLoading:false, which used to flash the
    // "No vehicle data" empty state on first paint. The fleet-loading guard
    // must keep the shell in its skeleton state instead.
    const { container } = renderWidget(FULL, {
      vehicles: makeVehiclesQuery({ data: undefined, isLoading: true }),
      state: makeStateQuery({ isLoading: false, data: undefined }),
    });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('No vehicle data')).toBeNull();
  });

  it('surfaces a state-query error as an alert instead of a stale tile', () => {
    renderWidget(FULL, {
      state: makeStateQuery({ data: undefined, error: new Error('boom'), isError: true }),
    });

    // jsdom reports navigator.onLine === true → QueryError's alert branch.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The error branch replaces the widget body — the title is suppressed.
    expect(screen.queryByText('Vehicle')).toBeNull();
  });

  it('surfaces a fleet-load failure as an alert, never the misleading empty state', () => {
    renderWidget(FULL, {
      vehicles: makeVehiclesQuery({ data: undefined, isError: true }),
      state: makeStateQuery({ data: undefined }),
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No vehicle data')).toBeNull();
  });
});

// ── Vehicle resolution + refresh ─────────────────────────────────────────────

describe('VehicleHeroCardWidget — vehicle resolution + refresh', () => {
  it('queries the explicit vehicleId and renders that vehicle', () => {
    renderWidget(FULL, {
      vehicleId: 7,
      vehicles: makeVehiclesQuery({
        data: [makeVehicle({ id: 3, display_name: 'Three' }), makeVehicle({ id: 7, display_name: 'Seven' })],
      }),
    });

    expect(mockUseVehicleState).toHaveBeenCalledWith(7);
    expect(screen.getByText('Seven')).toBeInTheDocument();
  });

  it('falls back to the first fleet vehicle when the requested id is not present', () => {
    renderWidget(FULL, {
      vehicleId: 99,
      vehicles: makeVehiclesQuery({
        data: [makeVehicle({ id: 3, display_name: 'Three' }), makeVehicle({ id: 7, display_name: 'Seven' })],
      }),
    });

    expect(mockUseVehicleState).toHaveBeenCalledWith(3);
    expect(screen.getByText('Three')).toBeInTheDocument();
  });

  it('resolves to the first fleet vehicle when no vehicleId is supplied', () => {
    renderWidget(FULL, {
      vehicles: makeVehiclesQuery({
        data: [makeVehicle({ id: 5, display_name: 'Five' }), makeVehicle({ id: 9, display_name: 'Nine' })],
      }),
    });

    expect(mockUseVehicleState).toHaveBeenCalledWith(5);
  });

  it('refetches when the accessible "Refresh" freshness control is activated', () => {
    const refetch = vi.fn();
    renderWidget(FULL, { state: makeStateQuery({ refetch, isFetching: false }) });

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
