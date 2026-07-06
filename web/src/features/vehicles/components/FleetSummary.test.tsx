/**
 * FleetSummary — behaviour, branch, null-safety, a11y and unit-conversion
 * coverage for the fleet-wide four-tile summary strip.
 *
 * The component fans one react-query out to N `fetchVehicleState` calls (one per
 * vehicle), tolerates per-vehicle failures (a single offline car resolves to a
 * null state instead of rejecting the whole batch), and renders four aggregate
 * tiles: fleet size, average battery, total rated range (SI metres → the user's
 * display unit), and a charging / online count.
 *
 * What this file pins:
 *   - the AGGREGATION math (avg battery, summed range, charging/online counts);
 *   - the RESILIENCE branch — offline (null state) and throwing vehicles are
 *     excluded from the averages but never blank the strip or crash it;
 *   - the NULL-SAFETY hardening — an `undefined` `vehicles` prop (a hook that has
 *     not resolved yet) renders zeros instead of throwing on `.map`/`.length`;
 *   - the `enabled` gate — an empty fleet issues zero network calls;
 *   - the SI → display conversion at the render boundary honours the user's unit;
 *   - a11y — the four decorative lucide icons are hidden from the a11y tree.
 *
 * Strategy: `fetchVehicleState` (the network boundary) and `useUnits` (the unit
 * preference) are mocked so no real request is issued and the display unit is
 * controllable per test. `AnimatedNumber` is stubbed to render its final value
 * synchronously (the real component eases from 0 over 1s via requestAnimationFrame,
 * which would make exact-value assertions timing-dependent). Only `react-i18next`
 * is mocked so `t(key, fallback)` renders the deterministic English fallback.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { Vehicle, VehicleState } from '@/api/types';
import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion';

// ── Mocks ────────────────────────────────────────────────────────────────────

const { fetchStateMock, useUnitsMock } = vi.hoisted(() => ({
  fetchStateMock: vi.fn(),
  useUnitsMock: vi.fn(),
}));

// The network boundary. FleetSummary only imports `fetchVehicleState`.
vi.mock('@/api/hooks/useVehicles', () => ({
  fetchVehicleState: (id: number) => fetchStateMock(id),
}));

// Unit preference bridge — controllable per test so we can prove the SI → display
// conversion honours both metric and imperial without touching global settings.
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => useUnitsMock() }));

// i18n → return the developer fallback string so tile captions read as English.
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

// AnimatedNumber eases from 0 → value over 1s via rAF; stub it to render the final
// value synchronously so aggregate assertions are deterministic.
vi.mock('@/components/data-display/AnimatedNumber', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    AnimatedNumber: ({
      value,
      prefix,
      suffix,
    }: {
      value: number;
      prefix?: string;
      suffix?: string;
    }) =>
      React.createElement(
        'span',
        { 'data-testid': 'animated-number' },
        `${prefix ?? ''}${value}${suffix ?? ''}`,
      ),
  };
});

import { FleetSummary } from './FleetSummary';

// ── Fixtures ───────────────────────────────────────────────────────────────—

function makeVehicle(id: number): Vehicle {
  return {
    id,
    vehicle_id: id,
    vin: `VIN${id}`,
    display_name: `Car ${id}`,
    model: 'Model 3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };
}

function makeState(over: Partial<VehicleState>): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    heading: null,
    speed: 0,
    power: 0,
    battery_level: 50,
    rated_range: 100_000,
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
    software_version: '2024.1',
    ...over,
  };
}

function setUnit(distance: DistanceUnitPref) {
  useUnitsMock.mockReturnValue({ unitPrefs: { distance } });
}

function renderSummary(vehicles: Vehicle[] | undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FleetSummary vehicles={vehicles as Vehicle[]} />
    </QueryClientProvider>,
  );
}

/** The `[data-print-card]` GlassPanel whose caption matches `labelRe`. */
function tile(labelRe: RegExp): HTMLElement {
  const label = screen.getByText(labelRe);
  const panel = label.closest('[data-print-card]');
  if (!panel) throw new Error(`no tile for ${labelRe}`);
  return panel as HTMLElement;
}

beforeEach(() => {
  fetchStateMock.mockReset();
  useUnitsMock.mockReset();
  setUnit('km');
});

// ── Aggregation (happy path) ─────────────────────────────────────────────────

describe('FleetSummary — aggregate tiles', () => {
  it('averages battery, sums SI range, and counts charging / online across the fleet', async () => {
    fetchStateMock.mockImplementation((id: number) => {
      const byId: Record<number, VehicleState> = {
        1: makeState({ vehicle_id: 1, battery_level: 80, rated_range: 400_000, is_charging: true }),
        2: makeState({ vehicle_id: 2, battery_level: 60, rated_range: 300_000, is_charging: false }),
        3: makeState({ vehicle_id: 3, battery_level: 40, rated_range: 200_000, is_charging: false }),
      };
      return Promise.resolve({ state: byId[id], live: true });
    });

    renderSummary([makeVehicle(1), makeVehicle(2), makeVehicle(3)]);

    // Fleet size renders immediately (independent of the async batch).
    expect(within(tile(/Vehicles/)).getByText('3')).toBeInTheDocument();

    // Avg battery = (80 + 60 + 40) / 3 = 60% — awaits the resolved batch.
    expect(await screen.findByText('60%')).toBeInTheDocument();

    // Total range = 900_000 m → 900 km, converted at the display boundary.
    const expectedKm = Math.round(convertDistanceFromSI(900_000, 'km'));
    expect(expectedKm).toBe(900);
    expect(within(tile(/Total Range/)).getByText(String(expectedKm))).toBeInTheDocument();
    expect(tile(/Total Range/)).toHaveTextContent(/km/);

    // 1 of 3 vehicles charging.
    expect(within(tile(/Charging/)).getByText('1')).toBeInTheDocument();
    expect(within(tile(/Charging/)).getByText('/ 3')).toBeInTheDocument();

    // One request fanned out per vehicle, keyed by id.
    expect(fetchStateMock).toHaveBeenCalledTimes(3);
    expect(fetchStateMock).toHaveBeenCalledWith(1);
    expect(fetchStateMock).toHaveBeenCalledWith(3);
  });

  it('renders every tile caption from the i18n fallback', () => {
    fetchStateMock.mockResolvedValue({ state: makeState({}), live: true });
    renderSummary([makeVehicle(1)]);

    expect(screen.getByText('Vehicles')).toBeInTheDocument();
    expect(screen.getByText('Avg Battery')).toBeInTheDocument();
    expect(screen.getByText(/Total Range/)).toBeInTheDocument();
    expect(screen.getByText('Charging / Online')).toBeInTheDocument();
  });
});

// ── Resilience / branch coverage ─────────────────────────────────────────────

describe('FleetSummary — resilience', () => {
  it('excludes offline (null state) and throwing vehicles from the averages without blanking or crashing', async () => {
    fetchStateMock.mockImplementation((id: number) => {
      if (id === 1) {
        return Promise.resolve({
          state: makeState({ vehicle_id: 1, battery_level: 80, rated_range: 400_000, is_charging: true }),
          live: true,
        });
      }
      if (id === 2) return Promise.resolve({ state: undefined, live: false }); // offline
      return Promise.reject(new Error('vehicle 3 asleep')); // throws → caught → null
    });

    renderSummary([makeVehicle(1), makeVehicle(2), makeVehicle(3)]);

    // Fleet size still reflects all three vehicles.
    expect(within(tile(/Vehicles/)).getByText('3')).toBeInTheDocument();

    // Only the single online vehicle contributes to the averages.
    expect(await screen.findByText('80%')).toBeInTheDocument();
    const expectedKm = Math.round(convertDistanceFromSI(400_000, 'km'));
    expect(within(tile(/Total Range/)).getByText(String(expectedKm))).toBeInTheDocument();

    // 1 charging out of 1 online (the two failed vehicles are not "online").
    await waitFor(() => {
      expect(within(tile(/Charging/)).getByText('/ 1')).toBeInTheDocument();
    });
    expect(within(tile(/Charging/)).getByText('1')).toBeInTheDocument();
  });

  it('renders zeros for an empty fleet and issues no network calls (enabled gate)', () => {
    renderSummary([]);

    expect(within(tile(/Vehicles/)).getByText('0')).toBeInTheDocument();
    expect(within(tile(/Avg Battery/)).getByText('0%')).toBeInTheDocument();
    expect(within(tile(/Charging/)).getByText('/ 0')).toBeInTheDocument();
    expect(fetchStateMock).not.toHaveBeenCalled();
  });

  it('null-safety: an undefined vehicles prop renders zeros instead of throwing', () => {
    // Regression: the prop is typed `Vehicle[]` but a not-yet-resolved hook can
    // pass `undefined`; the component must not crash on `.map`/`.length`.
    expect(() => renderSummary(undefined)).not.toThrow();

    expect(within(tile(/Vehicles/)).getByText('0')).toBeInTheDocument();
    expect(fetchStateMock).not.toHaveBeenCalled();
  });
});

// ── Unit conversion + accessibility ──────────────────────────────────────────

describe('FleetSummary — units + a11y', () => {
  it('converts summed SI range into the user-selected imperial unit at the display edge', async () => {
    setUnit('mi');
    fetchStateMock.mockImplementation((id: number) =>
      Promise.resolve({
        state: makeState({ vehicle_id: id, battery_level: 50, rated_range: 450_000 }),
        live: true,
      }),
    );

    renderSummary([makeVehicle(1), makeVehicle(2)]); // 900_000 m total

    await screen.findByText('50%');

    const expectedMi = Math.round(convertDistanceFromSI(900_000, 'mi'));
    expect(expectedMi).not.toBe(900); // proves the unit actually changed the value
    expect(within(tile(/Total Range/)).getByText(String(expectedMi))).toBeInTheDocument();
    expect(tile(/Total Range/)).toHaveTextContent(/mi/);
  });

  it('hides the four decorative metric icons from the accessibility tree', () => {
    fetchStateMock.mockResolvedValue({ state: makeState({}), live: true });
    const { container } = renderSummary([makeVehicle(1)]);

    const hiddenIcons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(hiddenIcons).toHaveLength(4);
  });
});
