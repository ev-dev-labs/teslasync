/**
 * VehicleHeroWidget — behaviour + hardening coverage.
 *
 * The widget resolves a vehicle (explicit `vehicleId` prop, else the first
 * linked vehicle), keys the `/vehicles/{id}/state` query on it, and renders the
 * presentational <VehicleHero> inside a <WidgetShell>. Its own responsibilities
 * — the only thing under test here — are:
 *   1. vehicle resolution (explicit match / not-found fallback / first vehicle),
 *   2. the firmware-version fallback chain (live SSE › live update › persisted
 *      snapshot › em-dash),
 *   3. wiring SI→display unit converters + unit labels + the Fahrenheit flag
 *      down to <VehicleHero> without mutating its contract,
 *   4. always rendering the hero once a vehicle exists (even with a null state —
 *      the hero owns its own "asleep" UI), and
 *   5. degrading to an EmptyState (NOT an infinite skeleton) when no vehicle is
 *      linked, while still exposing a refresh control.
 *
 * <VehicleHero> is replaced with a lightweight stub that echoes the props it
 * receives (and invokes the converters with fixed SI inputs) so we assert the
 * widget's wiring without pulling in the real hero's router/chart tree. The
 * real `@/lib/unitConversion` runs so the SI→display math is exercised
 * end-to-end. Every data hook is mocked so the network is never touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';

// ── i18n stub: return the English fallback (2nd arg) or the key. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: string) => (typeof def === 'string' ? def : _key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── Data hooks + the display-boundary unit bridge, driven per test. ──
vi.mock('@/api/hooks/useVehicles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useVehicles')>();
  return {
    ...actual,
    useVehicles: vi.fn(),
    useVehicleState: vi.fn(),
  };
});
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));
vi.mock('@/hooks/useVehicleLive', () => ({ useVehicleLive: vi.fn() }));
// Override the global setup's useSettings stub with a controllable spy while
// preserving the module's other (re-exported) members so transitive callers
// — WidgetShell → DataFreshness → useDateFormat — keep working.
vi.mock('@/hooks/useSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSettings')>();
  return { ...actual, useSettings: vi.fn() };
});

// ── Presentational hero replaced with a prop-echoing stub. ──
vi.mock('../components/VehicleHero', () => ({
  VehicleHero: (props: {
    vehicle?: { display_name?: string; vin?: string };
    state: unknown;
    firmwareVersion: string;
    distanceUnit: string;
    speedUnit: string;
    tempUnit: string;
    observedAt?: number;
    freshness?: string;
    verifiedFields?: readonly string[];
    toDistanceDisplay: (meters: number) => number;
    toSpeedDisplay: (mps: number) => number;
    toTemperatureDisplay: (celsius: number) => number;
  }) => (
    <div data-testid="vehicle-hero">
      <span data-testid="hero-name">{props.vehicle?.display_name || props.vehicle?.vin || ''}</span>
      <span data-testid="hero-firmware">{props.firmwareVersion}</span>
      <span data-testid="hero-distance-unit">{props.distanceUnit}</span>
      <span data-testid="hero-speed-unit">{props.speedUnit}</span>
      <span data-testid="hero-temp-unit">{props.tempUnit}</span>
      <span data-testid="hero-has-state">{props.state ? 'yes' : 'no'}</span>
      <span data-testid="hero-observed-at">{String(props.observedAt)}</span>
      <span data-testid="hero-freshness">{String(props.freshness)}</span>
      {/* SI inputs → the widget's wired display converters. */}
      <span data-testid="hero-conv-distance">{props.toDistanceDisplay(1000)}</span>
      <span data-testid="hero-conv-speed">{props.toSpeedDisplay(10)}</span>
      <span data-testid="hero-conv-temp">{props.toTemperatureDisplay(20)}</span>
    </div>
  ),
}));

import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useSettings } from '@/hooks/useSettings';
import { useVehicleLive } from '@/hooks/useVehicleLive';
import VehicleHeroWidget from './VehicleHeroWidget';

const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockVehicleState = useVehicleState as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;
const mockSettings = useSettings as unknown as ReturnType<typeof vi.fn>;
const mockLive = useVehicleLive as unknown as ReturnType<typeof vi.fn>;

const STANDARD = { cols: 2, rows: 2 };

function makeQuery(over: Record<string, unknown> = {}) {
  return {
    data: undefined as unknown,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeVehicle(over: { id?: number; display_name?: string; vin?: string } = {}) {
  return {
    id: over.id ?? 1,
    vehicle_id: 100,
    vin: over.vin ?? 'VIN0001',
    display_name: over.display_name ?? 'My Tesla',
    model: 'Model 3',
    trim_badging: 'Performance',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function makeStateData(over: {
  software_version?: string;
  hasState?: boolean;
  observedAt?: number | null;
  freshness?: 'fresh' | 'stale' | 'unknown';
} = {}) {
  if (over.hasState === false) {
    return { state: undefined, live: false, observedAt: null, freshness: 'unknown', verifiedFields: [] };
  }
  return {
    state: {
      vehicle_id: 1,
      state: 'online',
      software_version: over.software_version ?? '2024.44.25',
    },
    live: true,
    // Freshness is a property of the OBSERVATION, not of the request; the
    // widget passes this through instead of `dataUpdatedAt`.
    observedAt: over.observedAt === undefined ? Date.now() : over.observedAt,
    freshness: over.freshness ?? 'fresh',
    verifiedFields: ['state', 'software_version'],
  };
}

function makeUnits(prefs: { distance?: string; speed?: string; temperature?: string } = {}) {
  return {
    unitPrefs: {
      distance: prefs.distance ?? 'km',
      speed: prefs.speed ?? 'km/h',
      temperature: prefs.temperature ?? '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: undefined,
    },
  };
}

function makeSettings(over: { isFahrenheit?: boolean } = {}) {
  return {
    settings: {
      unit_of_length: 'km',
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      locale: 'en-US',
      tz_display_default: 'utc',
      decimal_precision: 2,
      preferred_range: 'rated',
    },
    isMiles: false,
    isFahrenheit: over.isFahrenheit ?? false,
    isPSI: false,
    decimals: 2,
    locale: 'en-US',
    density: 'comfortable',
    rangeType: 'rated',
  };
}

function makeLive(over: { version?: string; swUpdateVersion?: string } = {}) {
  return {
    state: { version: over.version ?? '', swUpdateVersion: over.swUpdateVersion ?? '' },
    connected: true,
  };
}

function setup(
  opts: {
    vehicles?: unknown;
    state?: unknown;
    live?: unknown;
    units?: unknown;
    settings?: unknown;
  } = {},
) {
  mockVehicles.mockReturnValue(opts.vehicles ?? makeQuery({ data: [makeVehicle()] }));
  mockVehicleState.mockReturnValue(opts.state ?? makeQuery({ data: makeStateData() }));
  mockLive.mockReturnValue(opts.live ?? makeLive());
  mockUnits.mockReturnValue(opts.units ?? makeUnits());
  mockSettings.mockReturnValue(opts.settings ?? makeSettings());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VehicleHeroWidget — vehicle resolution', () => {
  it('resolves the vehicle matching an explicit vehicleId and keys the state query on it', () => {
    setup({
      vehicles: makeQuery({
        data: [makeVehicle({ id: 3, display_name: 'Three' }), makeVehicle({ id: 7, display_name: 'Seven' })],
      }),
    });
    render(<VehicleHeroWidget vehicleId={7} size={STANDARD} />);

    expect(mockVehicleState).toHaveBeenCalledWith(7, expect.objectContaining({ refetchInterval: expect.anything() }));
    expect(screen.getByTestId('hero-name').textContent).toBe('Seven');
  });

  it('falls back to the first vehicle when the explicit vehicleId is not present', () => {
    setup({ vehicles: makeQuery({ data: [makeVehicle({ id: 3, display_name: 'Three' })] }) });
    render(<VehicleHeroWidget vehicleId={99} size={STANDARD} />);

    expect(mockVehicleState).toHaveBeenCalledWith(3, expect.objectContaining({ refetchInterval: expect.anything() }));
    expect(screen.getByTestId('hero-name').textContent).toBe('Three');
  });

  it('uses the first vehicle when no vehicleId prop is supplied', () => {
    setup({
      vehicles: makeQuery({
        data: [makeVehicle({ id: 5, display_name: 'Five' }), makeVehicle({ id: 6, display_name: 'Six' })],
      }),
    });
    render(<VehicleHeroWidget size={STANDARD} />);

    expect(mockVehicleState).toHaveBeenCalledWith(5, expect.objectContaining({ refetchInterval: expect.anything() }));
    expect(screen.getByTestId('hero-name').textContent).toBe('Five');
  });

  it('falls back to the vin when the vehicle has no display name', () => {
    setup({
      vehicles: makeQuery({ data: [makeVehicle({ id: 1, display_name: '', vin: 'VIN-XYZ' })] }),
    });
    render(<VehicleHeroWidget size={STANDARD} />);

    expect(screen.getByTestId('hero-name').textContent).toBe('VIN-XYZ');
  });
});

describe('VehicleHeroWidget — firmware version fallback chain', () => {
  it('prefers the live SSE firmware version over every fallback', () => {
    setup({
      live: makeLive({ version: '2025.14.live', swUpdateVersion: '2025.20.dl' }),
      state: makeQuery({ data: makeStateData({ software_version: '2024.old' }) }),
    });
    render(<VehicleHeroWidget size={STANDARD} />);

    expect(screen.getByTestId('hero-firmware').textContent).toBe('2025.14.live');
  });

  it('uses the live software-update version when no running version is present', () => {
    setup({
      live: makeLive({ version: '', swUpdateVersion: '2025.20.dl' }),
      state: makeQuery({ data: makeStateData({ software_version: '2024.old' }) }),
    });
    render(<VehicleHeroWidget size={STANDARD} />);

    expect(screen.getByTestId('hero-firmware').textContent).toBe('2025.20.dl');
  });

  it('uses the persisted state snapshot version when the live state has nothing', () => {
    setup({
      live: makeLive({ version: '', swUpdateVersion: '' }),
      state: makeQuery({ data: makeStateData({ software_version: '2024.44.25.1' }) }),
    });
    render(<VehicleHeroWidget size={STANDARD} />);

    expect(screen.getByTestId('hero-firmware').textContent).toBe('2024.44.25.1');
  });

  it('renders an em-dash when no firmware is known from any source', () => {
    setup({
      live: makeLive({ version: '', swUpdateVersion: '' }),
      state: makeQuery({ data: makeStateData({ hasState: false }) }),
    });
    render(<VehicleHeroWidget size={STANDARD} />);

    expect(screen.getByTestId('hero-firmware').textContent).toBe('—');
  });
});

describe('VehicleHeroWidget — unit wiring at the display boundary', () => {
  it('wires metric (km / °C) converters and labels through to the hero', () => {
    setup({
      units: makeUnits({ distance: 'km', speed: 'km/h', temperature: '°C' }),
      settings: makeSettings(),
    });
    render(<VehicleHeroWidget size={STANDARD} />);

    expect(screen.getByTestId('hero-distance-unit').textContent).toBe('km');
    expect(screen.getByTestId('hero-speed-unit').textContent).toBe('km/h');
    expect(screen.getByTestId('hero-temp-unit').textContent).toBe('°C');
    // 1000 m → 1 km, 10 m/s → 36 km/h, 20 °C → 20 °C.
    expect(screen.getByTestId('hero-conv-distance').textContent).toBe('1');
    expect(screen.getByTestId('hero-conv-speed').textContent).toBe('36');
    expect(screen.getByTestId('hero-conv-temp').textContent).toBe('20');
  });

  it('wires imperial (mi / °F) converters and labels through to the hero', () => {
    setup({
      units: makeUnits({ distance: 'mi', speed: 'mph', temperature: '°F' }),
      settings: makeSettings({ isFahrenheit: true }),
    });
    render(<VehicleHeroWidget size={STANDARD} />);

    expect(screen.getByTestId('hero-distance-unit').textContent).toBe('mi');
    expect(screen.getByTestId('hero-speed-unit').textContent).toBe('mph');
    expect(screen.getByTestId('hero-temp-unit').textContent).toBe('°F');
    // The wired converters must carry the imperial preference (mi/mph), not a
    // hard-coded metric unit — assert against the real SI library math.
    expect(screen.getByTestId('hero-conv-distance').textContent).toBe(String(convertDistanceFromSI(1000, 'mi')));
    expect(screen.getByTestId('hero-conv-speed').textContent).toBe(String(convertSpeedFromSI(10, 'mph')));
    // 20 °C → 68 °F.
    expect(screen.getByTestId('hero-conv-temp').textContent).toBe('68');
  });
});

describe('VehicleHeroWidget — state, freshness and degraded states', () => {
  it('renders the hero with a null state (asleep vehicle) instead of hiding it', () => {
    setup({
      live: makeLive({ version: '', swUpdateVersion: '' }),
      state: makeQuery({ data: makeStateData({ hasState: false }) }),
    });
    render(<VehicleHeroWidget size={STANDARD} />);

    // Hero is present (vehicle resolved) but receives a null state.
    expect(screen.getByTestId('vehicle-hero')).toBeInTheDocument();
    expect(screen.getByTestId('hero-has-state').textContent).toBe('no');
  });

  it('passes the backend observation instant to the hero, never the fetch time', () => {
    // The regression: `dataUpdatedAt` is when the REQUEST completed, so a car
    // that has been silent for an hour still rendered "just now" on every
    // poll. The hero must receive the backend's own observation instant.
    setup({
      state: makeQuery({
        data: makeStateData({ observedAt: 1_234_567 }),
        dataUpdatedAt: 9_999_999,
      }),
    });
    render(<VehicleHeroWidget size={STANDARD} />);

    expect(screen.getByTestId('hero-observed-at').textContent).toBe('1234567');
  });

  it('marks the widget stale whenever the observation is not currently fresh', () => {
    setup({
      state: makeQuery({
        // A successful, recent REQUEST carrying a stale OBSERVATION.
        data: makeStateData({ freshness: 'stale', observedAt: 1_000 }),
        isStale: false,
        dataUpdatedAt: Date.now(),
      }),
    });
    render(<VehicleHeroWidget size={STANDARD} />);

    expect(screen.getByTestId('hero-freshness').textContent).toBe('stale');
  });

  it('stands the per-vehicle poll down while the batch keeps the reading fresh', async () => {
    // The fleet batch seeds this exact cache key, so an ambient per-vehicle
    // poll on top of it is the N+1 the batch endpoint exists to remove.
    setup({ state: makeQuery({ data: makeStateData({ freshness: 'fresh' }) }) });
    render(<VehicleHeroWidget size={STANDARD} />);

    await waitFor(() => {
      expect(mockVehicleState).toHaveBeenLastCalledWith(1, { refetchInterval: false });
    });
  });

  it('resumes the per-vehicle poll as bounded recovery once the reading ages out', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-08-27T12:00:00Z');
    vi.setSystemTime(now);
    setup({
      state: makeQuery({
        data: makeStateData({
          freshness: 'fresh',
          observedAt: now - 119_000,
        }),
      }),
    });

    try {
      render(<VehicleHeroWidget size={STANDARD} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mockVehicleState).toHaveBeenLastCalledWith(1, { refetchInterval: false });
      expect(screen.getByTestId('hero-freshness').textContent).toBe('fresh');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_002);
      });

      const last = mockVehicleState.mock.calls.at(-1);
      expect(last?.[1]).toEqual({ refetchInterval: expect.any(Number) });
      expect(screen.getByTestId('hero-freshness').textContent).toBe('stale');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the "No vehicle data" empty state — not an infinite skeleton — for an empty vehicle list', () => {
    // Regression: `loading={!vehicle}` left the shell in a permanent skeleton
    // once the list resolved to [] (vehicle stays undefined forever). It must
    // degrade to a real empty state instead.
    setup({ vehicles: makeQuery({ data: [], isLoading: false }) });
    const { container } = render(<VehicleHeroWidget size={STANDARD} />);

    expect(screen.getByText('No vehicle data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-hero')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('shows a loading skeleton while the vehicle list is still loading', () => {
    setup({ vehicles: makeQuery({ data: undefined, isLoading: true }) });
    const { container } = render(<VehicleHeroWidget size={STANDARD} />);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('vehicle-hero')).not.toBeInTheDocument();
    expect(screen.queryByText('No vehicle data')).not.toBeInTheDocument();
  });

  it('refetches the vehicle state when the freshness control is activated', () => {
    const refetch = vi.fn();
    setup({ state: makeQuery({ data: makeStateData(), refetch, isFetching: false }) });
    render(<VehicleHeroWidget size={STANDARD} />);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still exposes a working refresh control in the empty state', () => {
    const refetch = vi.fn();
    setup({
      vehicles: makeQuery({ data: [], isLoading: false }),
      state: makeQuery({ data: makeStateData({ hasState: false }), refetch, isFetching: false }),
    });
    render(<VehicleHeroWidget size={STANDARD} />);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
