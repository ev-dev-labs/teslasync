/**
 * VehicleHeroCard — behaviour, hardening & a11y coverage.
 *
 * VehicleHeroCard renders one fleet hero card: an optional user photo, the
 * vehicle identity (name / VIN / model badge) with a live status pill, four
 * gauges (battery / range / inside / outside), a detail-card grid, and
 * three navigation links (details / commands / live map). SI base units
 * (meters, °C) are converted to the user's display preference via the real
 * `convertDistanceFromSI` / `convertTempFromSI`, with the unit suffix supplied
 * by `useUnits`.
 *
 * Strategy (mirrors the sibling VehicleCard / HeroGauges suites):
 *   - `react-i18next` echoes the English fallback and interpolates `{{name}}`
 *     so alt text / labels read naturally in assertions.
 *   - `useUnits` is mocked with a mutable km/°C ↔ mi/°F switch so both display
 *     branches are exercised while the pure SI converters run for REAL.
 *   - `LinearGauge` is a thin prop-surfacing stub (value / max / unit / colour
 *     as data-attributes) so the converted numbers, gauge scaling and battery
 *     colour threshold are asserted precisely and without text collisions with
 *     the detail cards.
 *   - `StatCard`, `StatusBadge`, `Badge`, `Grid`, `GlassPanel` and `EmptyState`
 *     stay REAL, so the display-unit conversions, `toStatus` derivation and the
 *     empty-state placeholder are exercised end-to-end. `<Link>` is wrapped in a
 *     MemoryRouter.
 *
 * It also locks in the hardening applied while elevating the file:
 *   - `toStatus` uses an own-property check, so an inherited object key such as
 *     `constructor` fails closed to `offline` instead of leaking through the
 *     old `in`-operator branch;
 *   - null-safe battery (`?? 0`) → a null `battery_level` renders a zeroed,
 *     red gauge instead of a NaN arc;
 *   - null-safe power (`?? 0`) → "0.00" instead of "NaN";
 *   - blank firmware falls back to an em dash;
 *   - a role="status" placeholder replaces the previously-hidden gauges/stats
 *     when there is no live vehicle state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { VehicleHeroCard, type VehicleHeroCardProps } from './VehicleHeroCard';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';

type Vehicle = VehicleHeroCardProps['vehicle'];
type State = NonNullable<VehicleHeroCardProps['vehicleState']>;

// Mutable display-unit switch shared with the `useUnits` mock. `vi.mock`
// factories are hoisted above the imports, so the handle must be created via
// `vi.hoisted` to be referenceable inside the factory.
const h = vi.hoisted(() => ({
  units: { distance: 'km' as 'km' | 'mi', temperature: '°C' as '°C' | '°F' },
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: h.units.distance, temperature: h.units.temperature },
  }),
}));

// Echo the English fallback; interpolate `{{name}}` so the photo alt text reads
// naturally. A bare key (no string fallback) echoes the key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: unknown) => {
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallback.replace(/{{(\w+)}}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          );
        }
        return fallback;
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Surface the gauge props as data-attributes so the SI→display conversion,
// gauge scaling and battery colour threshold are directly assertable.
vi.mock('@/components/charts/LinearGauge', () => ({
  LinearGauge: (p: {
    value: number;
    max: number;
    label: string;
    unit?: string;
    color?: string;
  }) => (
    <div
      data-testid="gauge"
      data-label={p.label}
      data-value={String(p.value)}
      data-max={String(p.max)}
      data-unit={String(p.unit)}
      data-color={String(p.color)}
    />
  ),
}));

function makeVehicle(over: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 7,
    display_name: 'Garage Queen',
    model: 'Model 3',
    vin: '5YJ3E1EA7KF000123',
    state: 'online',
    ...over,
  };
}

function makeState(over: Partial<State> = {}): State {
  return {
    battery_level: 72,
    rated_range: 400_000, // 400 km
    inside_temp: 21,
    outside_temp: 14,
    odometer: 12_345_678, // 12,345.678 km → 12,346
    is_charging: false,
    is_locked: true,
    sentry_mode: false,
    software_version: '2024.44.25',
    power: 42,
    state: 'online',
    ...over,
  };
}

function renderCard(
  over: {
    vehicle?: Partial<Vehicle>;
    vehicleState?: State | null;
    photoUrl?: string | null;
  } = {},
) {
  const vehicle = makeVehicle(over.vehicle);
  const vehicleState = 'vehicleState' in over ? over.vehicleState : makeState();
  const utils = render(
    <MemoryRouter>
      <VehicleHeroCard vehicle={vehicle} vehicleState={vehicleState} photoUrl={over.photoUrl} />
    </MemoryRouter>,
  );
  return { ...utils, vehicle };
}

/** Resolve one gauge stub by its (i18n-echoed) label. */
function gauge(label: string): HTMLElement {
  const el = screen.getAllByTestId('gauge').find((g) => g.getAttribute('data-label') === label);
  if (!el) throw new Error(`gauge "${label}" not rendered`);
  return el;
}

beforeEach(() => {
  h.units.distance = 'km';
  h.units.temperature = '°C';
});

describe('VehicleHeroCard — identity & header', () => {
  it('renders the display name heading, VIN and model badge', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'Garage Queen' })).toBeInTheDocument();
    expect(screen.getByText('5YJ3E1EA7KF000123')).toBeInTheDocument();
    expect(screen.getByText('Model 3')).toBeInTheDocument();
  });

  it('derives the status pill from the live vehicleState.state', () => {
    renderCard({ vehicleState: makeState({ state: 'driving' }) });
    expect(screen.getByText('driving')).toBeInTheDocument();
  });
});

describe('VehicleHeroCard — status derivation (toStatus)', () => {
  it('falls back to vehicle.state when the live state has no state field', () => {
    renderCard({
      vehicle: { state: 'charging' },
      vehicleState: makeState({ state: undefined }),
    });
    expect(screen.getByText('charging')).toBeInTheDocument();
  });

  it('maps an unrecognised state to offline', () => {
    renderCard({ vehicle: { state: 'wat' }, vehicleState: null });
    expect(screen.getByText('offline')).toBeInTheDocument();
  });

  it('fails closed to offline for an inherited object key (regression guard for the `in` bug)', () => {
    // `'constructor' in states` is TRUE via the prototype chain — the old code
    // leaked it through as a "valid" status. The own-property check rejects it.
    renderCard({ vehicle: { state: 'constructor' }, vehicleState: null });
    expect(screen.getByText('offline')).toBeInTheDocument();
    expect(screen.queryByText('constructor')).not.toBeInTheDocument();
  });
});

describe('VehicleHeroCard — gauges (SI→display conversion, scaling & colour)', () => {
  it('renders four gauges with km/°C values, unit suffixes and scaled maxima', () => {
    renderCard({
      vehicleState: makeState({
        battery_level: 72,
        rated_range: 400_000,
        inside_temp: 21,
        outside_temp: 14,
      }),
    });

    expect(screen.getAllByTestId('gauge')).toHaveLength(4);

    const battery = gauge('Battery');
    expect(battery).toHaveAttribute('data-value', '72');
    expect(battery).toHaveAttribute('data-max', '100');
    expect(battery).toHaveAttribute('data-unit', '%');
    expect(battery).toHaveAttribute('data-color', '#22d3ee'); // >20 → cyan

    const range = gauge('Range');
    expect(range).toHaveAttribute('data-value', '400'); // 400,000 m → 400 km
    expect(range).toHaveAttribute('data-max', '644');
    expect(range).toHaveAttribute('data-unit', 'km');

    expect(gauge('Inside')).toHaveAttribute('data-value', '21');
    expect(gauge('Inside')).toHaveAttribute('data-max', '50');
    expect(gauge('Outside')).toHaveAttribute('data-value', '14');
  });

  it('colours the battery gauge red at or below the 20% threshold', () => {
    renderCard({ vehicleState: makeState({ battery_level: 20 }) });
    expect(gauge('Battery')).toHaveAttribute('data-color', '#ef4444');
    expect(gauge('Battery')).toHaveAttribute('data-value', '20');
  });

  it('converts to miles / °F and rescales the maxima when the display unit changes', () => {
    h.units.distance = 'mi';
    h.units.temperature = '°F';
    renderCard({ vehicleState: makeState({ rated_range: 400_000, inside_temp: 21 }) });

    const expectedMi = String(Math.round(convertDistanceFromSI(400_000, 'mi')));
    const range = gauge('Range');
    expect(range).toHaveAttribute('data-value', expectedMi);
    expect(range).toHaveAttribute('data-max', '400');
    expect(range).toHaveAttribute('data-unit', 'mi');

    const expectedF = String(Math.round(convertTempFromSI(21, '°F'))); // 70
    const inside = gauge('Inside');
    expect(inside).toHaveAttribute('data-value', expectedF);
    expect(inside).toHaveAttribute('data-max', '122');
    expect(inside).toHaveAttribute('data-unit', '°F');
  });
});

describe('VehicleHeroCard — detail stat cards', () => {
  it('converts the SI odometer through the real convertDistanceFromSI + fmtInt', () => {
    renderCard({ vehicleState: makeState({ odometer: 12_345_678 }) });
    // 12,345,678 m ÷ 1000 = 12,345.678 km → round → fmtInt → "12,346".
    expect(screen.getByText('12,346')).toBeInTheDocument();
    // km appears on both the range and odometer cards.
    expect(screen.getAllByText('km').length).toBeGreaterThanOrEqual(2);
  });

  it('shows Locked / Unlocked from the lock flag', () => {
    renderCard({ vehicleState: makeState({ is_locked: true }) });
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.queryByText('Unlocked')).not.toBeInTheDocument();
  });

  it('shows Unlocked when the vehicle is unlocked', () => {
    renderCard({ vehicleState: makeState({ is_locked: false }) });
    expect(screen.getByText('Unlocked')).toBeInTheDocument();
  });

  it('shows sentry On / Off from the sentry flag', () => {
    renderCard({ vehicleState: makeState({ sentry_mode: true }) });
    expect(screen.getByText('On')).toBeInTheDocument();
  });

  it('renders the firmware and power values through fmtNumber', () => {
    renderCard({ vehicleState: makeState({ software_version: '2024.44.25', power: 42 }) });
    expect(screen.getByText('2024.44.25')).toBeInTheDocument();
    expect(screen.getByText('42.00')).toBeInTheDocument(); // precision 2
    expect(screen.getByText('kW')).toBeInTheDocument();
  });
});

describe('VehicleHeroCard — hero photo', () => {
  it('renders the photo with an interpolated alt when a photoUrl is supplied', () => {
    renderCard({ photoUrl: 'https://cdn.example/car.jpg' });
    const img = screen.getByRole('img', { name: 'Garage Queen photo' });
    expect(img).toHaveAttribute('src', 'https://cdn.example/car.jpg');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('renders no image when photoUrl is absent', () => {
    renderCard({ photoUrl: null });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('VehicleHeroCard — empty-state hardening', () => {
  it('shows a role=status placeholder (no gauges/cards) when there is no live state', () => {
    renderCard({ vehicleState: null });
    expect(screen.getByRole('status')).toHaveTextContent('Live telemetry unavailable');
    expect(screen.queryAllByTestId('gauge')).toHaveLength(0);
    expect(screen.queryByText('Firmware')).not.toBeInTheDocument();
  });

  it('renders the gauges (and no placeholder) when live state is present', () => {
    renderCard({ vehicleState: makeState() });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('gauge')).toHaveLength(4);
  });
});

describe('VehicleHeroCard — navigation actions', () => {
  it('exposes details / commands / live-map links with the correct hrefs', () => {
    renderCard();
    expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute('href', '/vehicles/7');
    expect(screen.getByRole('link', { name: 'Commands' })).toHaveAttribute(
      'href',
      '/vehicles/7/commands',
    );
    expect(screen.getByRole('link', { name: 'Live Map' })).toHaveAttribute(
      'href',
      '/vehicles/7/map',
    );
  });
});

describe('VehicleHeroCard — null safety (regression guards)', () => {
  it('renders a zeroed, red battery gauge (no NaN) when battery_level is null', () => {
    renderCard({ vehicleState: makeState({ battery_level: null as unknown as number }) });
    const battery = gauge('Battery');
    expect(battery).toHaveAttribute('data-value', '0');
    expect(battery).toHaveAttribute('data-color', '#ef4444');
    expect(battery.getAttribute('data-value')).not.toContain('NaN');
  });

  it('renders "0.00" kW when power is null', () => {
    renderCard({ vehicleState: makeState({ power: null as unknown as number }) });
    expect(screen.getByText('0.00')).toBeInTheDocument();
  });

  it('falls back to an em dash when the firmware string is blank', () => {
    renderCard({ vehicleState: makeState({ software_version: '' }) });
    expect(screen.getByText('Firmware')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
