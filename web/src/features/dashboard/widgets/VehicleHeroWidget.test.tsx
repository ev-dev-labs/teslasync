/**
 * VehicleHeroWidget — After ("Vehicle Card") behaviour + hardening coverage.
 *
 * The widget resolves a vehicle (explicit `vehicleId` prop, else the first
 * linked vehicle), keys the `/vehicles/{id}/state` query on it, and renders
 * the After layout inside a <WidgetShell>: name · model with the trusted
 * status pill, the headline battery % with estimated range, a battery meter
 * against the charge limit, and Locked / Sentry / Inside / Outside chips,
 * plus a footer with the verified-field count and a Details link.
 * Its own responsibilities — the only thing under test here — are:
 *   1. vehicle resolution (explicit match / not-found fallback / first vehicle),
 *   2. wiring SI→display unit converters + unit labels down to the rendered
 *      values without mutating source readings (range in meters, temps in °C),
 *   3. the battery meter: limit marker only from a finite `charge_limit_soc`,
 *      and the "+N% · Done ~time" centre label only while charging,
 *   4. always rendering the hero once a vehicle exists (even with a null state),
 *   5. degrading to an EmptyState (NOT an infinite skeleton) when no vehicle is
 *      linked, while still exposing a refresh control.
 *
 * Every data hook is mocked so the network is never touched. The real
 * `@/lib/unitConversion` runs so the SI→display math is exercised end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';

// ── i18n stub: return the English fallback (2nd arg) or the key, with
// `{{count}}` interpolation for the footer verified-fields line. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: string, opts?: { count?: number }) => {
      const base = typeof def === 'string' ? def : _key;
      return opts?.count != null ? base.replace('{{count}}', String(opts.count)) : base;
    },
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
// Deterministic shared date layer: the Done-at time is asserted verbatim.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    opts: { locale: 'en-US', tz: 'UTC' },
    tz: 'UTC',
    locale: 'en-US',
    formatDate: (v: unknown) => String(v),
    formatDateTime: (v: unknown) => String(v),
    formatTime: () => '9:56 AM',
    formatDateShort: (v: unknown) => String(v),
    formatDateWithDay: (v: unknown) => String(v),
    formatDateRange: () => '',
    formatDayKeyRange: () => '',
    formatDayKey: (v: unknown) => String(v),
    formatRelative: (v: unknown) => String(v),
    formatRelativeTime: (v: unknown) => String(v),
  }),
}));
// Override the global setup's useSettings stub with a controllable spy while
// preserving the module's other (re-exported) members so transitive callers
// keep working.
vi.mock('@/hooks/useSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSettings')>();
  return { ...actual, useSettings: vi.fn() };
});

import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useSettings } from '@/hooks/useSettings';
import VehicleHeroWidget from './VehicleHeroWidget';

function renderWidget(ui: ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

it.each([1, 2, 3])('uses the vehicle name as its sole heading at %i columns', (cols) => {
  setup();
  renderWidget(<VehicleHeroWidget size={{ cols, rows: 2 }} />);
  expect(screen.getByRole('heading', { name: 'My Tesla · Model 3 Performance' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Vehicle overview' })).not.toBeInTheDocument();
});

it.each([1, 2, 3])('identifies an unlinked vehicle hero at %i columns', (cols) => {
  setup({ vehicles: makeQuery({ data: [] }) });
  renderWidget(<VehicleHeroWidget size={{ cols, rows: 2 }} />);
  expect(screen.getByRole('heading', { name: 'Vehicle overview' })).toBeInTheDocument();
  expect(screen.getByText('No vehicle data')).toBeInTheDocument();
});

it.each([1, 2, 3])('identifies a loading vehicle hero at %i columns', (cols) => {
  setup({ vehicles: makeQuery({ isLoading: true }) });
  renderWidget(<VehicleHeroWidget size={{ cols, rows: 2 }} />);
  expect(screen.getByRole('heading', { name: 'Vehicle overview' })).toBeInTheDocument();
});

it.each([1, 2, 3])('identifies a failed vehicle hero load at %i columns', (cols) => {
  setup({ vehicles: makeQuery({ isError: true, error: new Error('vehicles unavailable') }) });
  renderWidget(<VehicleHeroWidget size={{ cols, rows: 2 }} />);
  expect(screen.getByRole('heading', { name: 'Vehicle overview' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeInTheDocument();
});

it.each([1, 2, 3])('retains the vehicle heading after a failed refresh at %i columns', (cols) => {
  setup({ state: makeQuery({ data: makeStateData(), isError: true, error: new Error('refresh failed') }) });
  renderWidget(<VehicleHeroWidget size={{ cols, rows: 2 }} />);
  expect(screen.getByRole('heading', { name: 'My Tesla · Model 3 Performance' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Vehicle overview' })).not.toBeInTheDocument();
  expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
});

const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockVehicleState = useVehicleState as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;
const mockSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

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
  hasState?: boolean;
  observedAt?: number | null;
  freshness?: 'fresh' | 'stale' | 'unknown';
  verifiedFields?: string[];
  batteryLevel?: number | null;
  ratedRangeM?: number | null;
  insideTemp?: number | null;
  outsideTemp?: number | null;
  isCharging?: boolean;
  chargeLimit?: number | null;
  etaHours?: number | null;
  fsmState?: string;
  since?: string;
  isLocked?: boolean | null;
  sentryMode?: boolean | null;
} = {}) {
  if (over.hasState === false) {
    return { state: undefined, live: false, observedAt: null, freshness: 'unknown', verifiedFields: [] };
  }
  const state: Record<string, unknown> = {
    vehicle_id: 1,
    state: over.fsmState ?? 'online',
    since: over.since,
    speed: 0,
    power: 0,
    battery_level: over.batteryLevel === undefined ? 64 : over.batteryLevel,
    // SI: rated range in meters. 276,000 m ≈ 276 km / 171 mi.
    rated_range: over.ratedRangeM === undefined ? 276_000 : over.ratedRangeM,
    ideal_range: 290_000,
    odometer: 50_000_000,
    inside_temp: over.insideTemp === undefined ? 22 : over.insideTemp,
    outside_temp: over.outsideTemp === undefined ? 23 : over.outsideTemp,
    is_climate_on: false,
    is_charging: over.isCharging ?? false,
    charger_power: 7,
    charge_rate: 40_000,
    time_to_full_charge: over.etaHours === undefined ? 0 : over.etaHours,
    is_locked: over.isLocked === undefined ? true : over.isLocked,
    sentry_mode: over.sentryMode === undefined ? true : over.sentryMode,
    software_version: '2024.44.25',
  };
  if (over.chargeLimit !== null) {
    state.charge_limit_soc = over.chargeLimit === undefined ? 80 : over.chargeLimit;
  }
  return {
    state,
    live: true,
    // Freshness is a property of the OBSERVATION, not of the request; the
    // widget passes this through instead of `dataUpdatedAt`.
    observedAt: over.observedAt === undefined ? Date.now() : over.observedAt,
    freshness: over.freshness ?? 'fresh',
    verifiedFields: over.verifiedFields ?? ['state', 'software_version'],
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

function setup(
  opts: {
    vehicles?: unknown;
    state?: unknown;
    units?: unknown;
    settings?: unknown;
  } = {},
) {
  mockVehicles.mockReturnValue(opts.vehicles ?? makeQuery({ data: [makeVehicle()] }));
  mockVehicleState.mockReturnValue(opts.state ?? makeQuery({ data: makeStateData() }));
  mockUnits.mockReturnValue(opts.units ?? makeUnits());
  mockSettings.mockReturnValue(opts.settings ?? makeSettings());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VehicleHeroWidget — vehicle resolution', () => {
  it('preserves the hero during a failed cached refresh', () => {
    setup({ state: makeQuery({ data: makeStateData(), isError: true, error: new Error('refresh failed') }) });
    renderWidget(<VehicleHeroWidget size={STANDARD} />);
    expect(screen.getByRole('heading', { name: 'My Tesla · Model 3 Performance' })).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('resolves the vehicle matching an explicit vehicleId and keys the state query on it', () => {
    setup({
      vehicles: makeQuery({
        data: [makeVehicle({ id: 3, display_name: 'Three' }), makeVehicle({ id: 7, display_name: 'Seven' })],
      }),
    });
    renderWidget(<VehicleHeroWidget vehicleId={7} size={STANDARD} />);

    expect(mockVehicleState).toHaveBeenCalledWith(7, expect.objectContaining({ refetchInterval: expect.anything() }));
    expect(screen.getByRole('heading', { name: 'Seven · Model 3 Performance' })).toBeInTheDocument();
  });

  it('falls back to the first vehicle when the explicit vehicleId is not present', () => {
    setup({ vehicles: makeQuery({ data: [makeVehicle({ id: 3, display_name: 'Three' })] }) });
    renderWidget(<VehicleHeroWidget vehicleId={99} size={STANDARD} />);

    expect(mockVehicleState).toHaveBeenCalledWith(3, expect.objectContaining({ refetchInterval: expect.anything() }));
    expect(screen.getByRole('heading', { name: 'Three · Model 3 Performance' })).toBeInTheDocument();
  });

  it('uses the first vehicle when no vehicleId prop is supplied', () => {
    setup({
      vehicles: makeQuery({
        data: [makeVehicle({ id: 5, display_name: 'Five' }), makeVehicle({ id: 6, display_name: 'Six' })],
      }),
    });
    renderWidget(<VehicleHeroWidget size={STANDARD} />);

    expect(mockVehicleState).toHaveBeenCalledWith(5, expect.objectContaining({ refetchInterval: expect.anything() }));
    expect(screen.getByRole('heading', { name: 'Five · Model 3 Performance' })).toBeInTheDocument();
  });

  it('falls back to the vin when the vehicle has no display name', () => {
    setup({
      vehicles: makeQuery({ data: [makeVehicle({ id: 1, display_name: '', vin: 'VIN-XYZ' })] }),
    });
    renderWidget(<VehicleHeroWidget size={STANDARD} />);

    expect(screen.getByRole('heading', { name: 'VIN-XYZ · Model 3 Performance' })).toBeInTheDocument();
  });
});

describe('VehicleHeroWidget — After layout', () => {
  it('renders the headline battery, estimated range, limit marker and chips', () => {
    setup();
    renderWidget(<VehicleHeroWidget size={STANDARD} />);

    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('64')).toBeInTheDocument();
    expect(screen.getByText('Est. range')).toBeInTheDocument();
    // 276,000 m → 276 km with the metric preference.
    expect(screen.getByText('276')).toBeInTheDocument();
    expect(screen.getByTestId('charge-limit-marker')).toBeInTheDocument();
    expect(screen.getByText('Limit 80%')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText(/Sentry/)).toBeInTheDocument();
    expect(screen.getByText(/Inside/)).toBeInTheDocument();
    expect(screen.getByText(/Outside/)).toBeInTheDocument();
  });

  it('shows the parked duration from the state `since` instant', () => {
    const since = new Date(Date.now() - 3 * 3_600_000).toISOString();
    setup({ state: makeQuery({ data: makeStateData({ fsmState: 'parked', since }) }) });
    renderWidget(<VehicleHeroWidget size={STANDARD} />);
    expect(screen.getByText('Parked 3h')).toBeInTheDocument();
  });

  it('shows the remaining percent and Done-at time only while charging', () => {
    setup({
      state: makeQuery({
        data: makeStateData({
          isCharging: true,
          etaHours: 2.5,
          verifiedFields: ['state', 'is_charging'],
        }),
      }),
    });
    renderWidget(<VehicleHeroWidget size={STANDARD} />);
    expect(screen.getByText(/\+16%/)).toBeInTheDocument();
    expect(screen.getByText(/Done ~9:56 AM/)).toBeInTheDocument();
    expect(screen.getByText('charging')).toBeInTheDocument();
  });

  it('omits the Done-at centre label when not charging', () => {
    setup({ state: makeQuery({ data: makeStateData({ etaHours: 2.5 }) }) });
    renderWidget(<VehicleHeroWidget size={STANDARD} />);
    expect(screen.queryByText(/Done ~/)).not.toBeInTheDocument();
  });

  it('omits the limit marker when no charge limit is present', () => {
    setup({ state: makeQuery({ data: makeStateData({ chargeLimit: null }) }) });
    renderWidget(<VehicleHeroWidget size={STANDARD} />);
    expect(screen.queryByTestId('charge-limit-marker')).not.toBeInTheDocument();
    expect(screen.queryByText(/Limit 80%/)).not.toBeInTheDocument();
  });

  it('ignores a non-numeric charge limit so no NaN leaks into the meter', () => {
    const data = makeStateData();
    (data.state as Record<string, unknown>).charge_limit_soc = 'eighty';
    setup({ state: makeQuery({ data }) });
    renderWidget(<VehicleHeroWidget size={STANDARD} />);
    expect(screen.queryByTestId('charge-limit-marker')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('renders the verified-field count and Details link in the footer', () => {
    setup();
    renderWidget(<VehicleHeroWidget size={STANDARD} />);
    expect(screen.getByText('2 verified fields')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Details/ })).toHaveAttribute('href', '/vehicles/1');
  });

  it('drops the pre-redesign firmware, odometer and quick-action content', () => {
    setup();
    renderWidget(<VehicleHeroWidget size={STANDARD} />);
    expect(screen.queryByText('Firmware')).not.toBeInTheDocument();
    expect(screen.queryByText('Odometer')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Commands/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Live map/ })).not.toBeInTheDocument();
  });
});

describe('VehicleHeroWidget — unit wiring at the display boundary', () => {
  it('wires metric (km / °C) conversions through to the rendered values', () => {
    setup({
      units: makeUnits({ distance: 'km', speed: 'km/h', temperature: '°C' }),
      settings: makeSettings(),
    });
    renderWidget(<VehicleHeroWidget size={STANDARD} />);

    // 276,000 m → 276 km, 22 °C → 22 °C, 23 °C → 23 °C.
    expect(screen.getByText('276')).toBeInTheDocument();
    expect(screen.getByText(/22°C/)).toBeInTheDocument();
    expect(screen.getByText(/23°C/)).toBeInTheDocument();
  });

  it('wires imperial (mi / °F) conversions through to the rendered values', () => {
    setup({
      units: makeUnits({ distance: 'mi', speed: 'mph', temperature: '°F' }),
      settings: makeSettings({ isFahrenheit: true }),
      state: makeQuery({ data: makeStateData({ ratedRangeM: 160_934 }) }),
    });
    renderWidget(<VehicleHeroWidget size={STANDARD} />);

    // Assert against the real SI library math, rounded as displayed.
    expect(screen.getByText(String(Math.round(convertDistanceFromSI(160_934, 'mi'))))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${Math.round(convertTempFromSI(22, '°F'))}°F`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${Math.round(convertTempFromSI(23, '°F'))}°F`))).toBeInTheDocument();
  });
});

describe('VehicleHeroWidget — state, freshness and degraded states', () => {
  it('renders the hero with a null state (asleep vehicle) instead of hiding it', () => {
    setup({
      state: makeQuery({ data: makeStateData({ hasState: false }) }),
    });
    renderWidget(<VehicleHeroWidget size={STANDARD} />);

    expect(screen.getByRole('heading', { name: 'My Tesla · Model 3 Performance' })).toBeInTheDocument();
    expect(screen.getByText('No vehicle readings available')).toBeInTheDocument();
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
    const { container } = renderWidget(<VehicleHeroWidget size={STANDARD} />);

    expect(container.querySelector('[data-content-degraded]')).not.toBeNull();
  });

  it('stands the per-vehicle poll down while the batch keeps the reading fresh', async () => {
    // The fleet batch seeds this exact cache key, so an ambient per-vehicle
    // poll on top of it is the N+1 the batch endpoint exists to remove.
    setup({ state: makeQuery({ data: makeStateData({ freshness: 'fresh' }) }) });
    renderWidget(<VehicleHeroWidget size={STANDARD} />);

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
      renderWidget(<VehicleHeroWidget size={STANDARD} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mockVehicleState).toHaveBeenLastCalledWith(1, { refetchInterval: false });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_002);
      });

      const last = mockVehicleState.mock.calls[mockVehicleState.mock.calls.length - 1];
      expect(last?.[1]).toEqual({ refetchInterval: expect.any(Number) });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the "No vehicle data" empty state — not an infinite skeleton — for an empty vehicle list', () => {
    // Regression: `loading={!vehicle}` left the shell in a permanent skeleton
    // once the list resolved to [] (vehicle stays undefined forever). It must
    // degrade to a real empty state instead.
    setup({ vehicles: makeQuery({ data: [], isLoading: false }) });
    const { container } = renderWidget(<VehicleHeroWidget size={STANDARD} />);

    expect(screen.getByText('No vehicle data')).toBeInTheDocument();
    expect(screen.getByText('No vehicle data').closest('[role="status"]')).toBeInTheDocument();
    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeNull();
  });

  it('shows a loading skeleton while the vehicle list is still loading', () => {
    setup({ vehicles: makeQuery({ data: undefined, isLoading: true }) });
    const { container } = renderWidget(<VehicleHeroWidget size={STANDARD} />);

    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByText('No vehicle data')).not.toBeInTheDocument();
  });

  it('refetches the vehicle state when the freshness control is activated', () => {
    const refetch = vi.fn();
    setup({ state: makeQuery({ data: makeStateData(), refetch, isFetching: false }) });
    renderWidget(<VehicleHeroWidget size={STANDARD} />);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still exposes a working refresh control in the empty state', () => {
    const refetch = vi.fn();
    setup({
      vehicles: makeQuery({ data: [], isLoading: false }),
      state: makeQuery({ data: makeStateData({ hasState: false }), refetch, isFetching: false }),
    });
    renderWidget(<VehicleHeroWidget size={STANDARD} />);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
