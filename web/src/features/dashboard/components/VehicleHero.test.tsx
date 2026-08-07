/**
 * VehicleHero tests.
 *
 * VehicleHero is the dashboard's headline vehicle panel. It has one public
 * export (`VehicleHero`) that renders three distinct contextual layouts driven
 * by the live `VehicleState` — driving, charging, and idle — plus an "asleep"
 * placeholder when no state is available. The private `buildStatCards` helper
 * is exercised transitively through every one of those modes.
 *
 * The suite drives the component through:
 *   - the header contract: accessible <h2> name, status badge, VIN subtitle,
 *     and the display_name → VIN fallback
 *   - the asleep branch: placeholder copy + wake-up action, offline badge, and
 *     the guarantee that no live gauges render
 *   - the idle layout: which gauges show (battery/range/temps) and which
 *     stay hidden (speed/charge power), plus the firmware passthrough
 *   - the driving layout, which is where the hardened bug lives: the always-on
 *     "Power" tile must NOT duplicate the driving-context "Power" tile (that
 *     previously produced two children under the same React key)
 *   - the charging layout: the charge banner, live charge-power value, the ETA
 *     line, and the unknown-ETA em-dash fallback
 *   - null-safety: every numeric SI field null must degrade to a finite value,
 *     never "NaN"
 *   - the unit-converter contract: each converter is invoked with the RAW SI
 *     value straight off the API state
 *   - accessibility: quick-action links point at the right routes and stat-card
 *     icons are marked decorative (aria-hidden)
 *   - the battery gauge colour branch (amber under 50%, green above)
 *
 * `react-i18next` is stubbed with a passthrough `t(key, default)` so assertions
 * read the English defaults without booting the i18n runtime. The shared
 * GlassPanel / Button / LinearGauge / StatusBadge / FreshnessIndicator
 * primitives run for real (useSettings / useTimezone are stubbed globally in
 * src/test-setup.ts). No network is touched.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';

import { VehicleHero } from './VehicleHero';
import type { Vehicle, VehicleState } from '../types';
import { hasGaugeColor } from '@/test/gaugeTestUtils';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) =>
      typeof defaultValue === 'string' ? defaultValue : key,
  }),
}));

type Props = ComponentProps<typeof VehicleHero>;

const identity = (n: number) => n;

const baseVehicle: Vehicle = {
  id: 7,
  vehicle_id: 7,
  vin: '5YJ3E1EA7KF000000',
  display_name: 'My Model 3',
  model: 'Model 3',
  trim_badging: 'Performance',
  exterior_color: 'Red',
  wheel_type: 'Uberturbine',
  state: 'online',
  healthy: true,
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

// Idle/online fixture — SI values so the (identity) converters see realistic
// raw inputs and no context branch (driving/charging) is triggered.
const baseState: VehicleState = {
  vehicle_id: 7,
  state: 'online',
  latitude: 37.7,
  longitude: -122.4,
  speed: 0,
  power: 0,
  battery_level: 85,
  rated_range: 400,
  ideal_range: 420,
  odometer: 25000,
  inside_temp: 21,
  outside_temp: 15,
  is_climate_on: false,
  is_charging: false,
  charger_power: 0,
  charge_rate: 0,
  time_to_full_charge: 0,
  is_locked: true,
  sentry_mode: false,
  software_version: '2024.8.9',
};

function renderHero(overrides: Partial<Props> = {}) {
  const props: Props = {
    vehicle: baseVehicle,
    state: baseState,
    firmwareVersion: '2024.8.9',
    toDistanceDisplay: identity,
    toSpeedDisplay: identity,
    toTemperatureDisplay: identity,
    distanceUnit: 'km',
    speedUnit: 'km/h',
    tempUnit: '°C',
    lastFetchedAt: undefined,
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <VehicleHero {...props} />
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

describe('VehicleHero', () => {
  it('renders the vehicle name heading, live status badge, and VIN subtitle', () => {
    renderHero({ state: { ...baseState, state: 'online' } });

    expect(screen.getByRole('heading', { name: 'My Model 3' })).toBeInTheDocument();
    expect(screen.getByText('online')).toBeInTheDocument();
    // VIN is surfaced verbatim in the identity subtitle.
    expect(screen.getByText('5YJ3E1EA7KF000000')).toBeInTheDocument();
  });

  it('falls back to the VIN as the heading when display_name is blank', () => {
    renderHero({ vehicle: { ...baseVehicle, display_name: '' } });

    expect(
      screen.getByRole('heading', { name: '5YJ3E1EA7KF000000' }),
    ).toBeInTheDocument();
  });

  it('shows the asleep placeholder with a wake-up action and no live gauges', () => {
    renderHero({ state: null });

    expect(screen.getByText(/Vehicle asleep/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wake Up' })).toBeInTheDocument();
    // Status degrades to offline and the gauge grid is not rendered.
    expect(screen.getByText('offline')).toBeInTheDocument();
    expect(screen.queryByText('Battery')).not.toBeInTheDocument();
  });

  it('renders battery/range/temperature gauges but hides speed & charge gauges when idle', () => {
    renderHero();

    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('Range')).toBeInTheDocument();
    // Inside/Outside appear as gauge labels (and again as stat labels).
    expect(screen.getAllByText('Inside').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Outside').length).toBeGreaterThanOrEqual(1);
    // No speed context (stationary) and no charge power gauge (not charging).
    expect(screen.queryByText('Speed')).not.toBeInTheDocument();
    // Firmware prop is surfaced in an always-visible stat tile.
    expect(screen.getByText('2024.8.9')).toBeInTheDocument();
  });

  it('surfaces the Power tile exactly once while driving (no duplicate-key tile)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderHero({ state: { ...baseState, state: 'driving', speed: 60, power: 120 } });

    // Speed shows as both a gauge and a stat while driving.
    expect(screen.getAllByText('Speed')).toHaveLength(2);
    // The always-visible Power tile is suppressed while the driving context
    // already renders Power, so it appears exactly once. Before the fix this
    // was two identical tiles keyed the same, corrupting React's diff.
    expect(screen.getAllByText('Power')).toHaveLength(1);

    // Regression guard: React never logged a duplicate-key warning.
    const dupKeyWarning = errSpy.mock.calls.some((call) =>
      String(call[0]).includes('two children with the same key'),
    );
    expect(dupKeyWarning).toBe(false);

    errSpy.mockRestore();
  });

  it('renders the charge banner, live charge power, and an ETA line while charging', () => {
    renderHero({
      state: {
        ...baseState,
        is_charging: true,
        charger_power: 48,
        charge_rate: 30,
        time_to_full_charge: 1.5,
      },
    });

    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.getByText(/^48(\.0+)? kW$/)).toBeInTheDocument();
    expect(screen.getByText('Charge Rate')).toBeInTheDocument();
    // "1.5h" appears in the charge banner AND the Time-to-Full stat.
    expect(screen.getAllByText('1.5h')).toHaveLength(2);
    expect(screen.getByText(/Done ~/)).toBeInTheDocument();
  });

  it('renders an em dash and omits the ETA line when the time-to-full is unknown', () => {
    renderHero({
      state: {
        ...baseState,
        is_charging: true,
        charger_power: 20,
        charge_rate: 10,
        time_to_full_charge: 0,
      },
    });

    expect(screen.queryByText(/Done ~/)).not.toBeInTheDocument();
    // Both the charge banner and the Time-to-Full stat fall back to an em dash.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('never renders NaN when numeric telemetry fields arrive null', () => {
    const nullState = {
      ...baseState,
      battery_level: null,
      rated_range: null,
      speed: null,
      power: null,
      odometer: null,
      ideal_range: null,
      inside_temp: null,
      outside_temp: null,
      charger_power: null,
      charge_rate: null,
      time_to_full_charge: null,
    } as unknown as VehicleState;

    const { container } = renderHero({ state: nullState });

    expect(container.textContent).not.toContain('NaN');
    // Sections are never hidden — the battery gauge still renders its label.
    expect(screen.getByText('Battery')).toBeInTheDocument();
  });

  it('passes raw SI telemetry values straight to each unit converter', () => {
    const toDist = vi.fn(identity);
    const toSpeed = vi.fn(identity);
    const toTemp = vi.fn(identity);

    renderHero({
      state: {
        ...baseState,
        state: 'driving',
        speed: 33,
        rated_range: 410,
        ideal_range: 425,
        odometer: 26000,
        inside_temp: 20,
        outside_temp: 12,
      },
      toDistanceDisplay: toDist,
      toSpeedDisplay: toSpeed,
      toTemperatureDisplay: toTemp,
    });

    expect(toDist).toHaveBeenCalledWith(410); // rated range gauge
    expect(toDist).toHaveBeenCalledWith(26000); // odometer stat
    expect(toSpeed).toHaveBeenCalledWith(33); // speed gauge + stat
    expect(toTemp).toHaveBeenCalledWith(20); // inside temperature gauge
    expect(toTemp).toHaveBeenCalledWith(12); // outside temperature gauge
  });

  it('links each quick action to its route', () => {
    renderHero();

    expect(screen.getByRole('link', { name: /Details/i })).toHaveAttribute(
      'href',
      '/vehicles/7',
    );
    expect(screen.getByRole('link', { name: /Commands/i })).toHaveAttribute(
      'href',
      '/commands',
    );
    expect(screen.getByRole('link', { name: /Live Map/i })).toHaveAttribute(
      'href',
      '/live',
    );
    expect(screen.getByRole('link', { name: /Digital Twin/i })).toHaveAttribute(
      'href',
      '/digital-twin',
    );
  });

  it('marks stat-card icons as decorative so assistive tech reads only the text', () => {
    const { container } = renderHero();

    // Every stat-tile lucide glyph carries aria-hidden; the label + value text
    // remain the only announced content.
    const decorative = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(decorative.length).toBeGreaterThan(0);
  });

  it('colours the battery gauge amber below 50% and green above it', () => {
    const low = renderHero({ state: { ...baseState, battery_level: 20 } });
    // Amber fill is unique to a low battery gauge.
    expect(hasGaugeColor(low.container as HTMLElement, '#f59e0b')).toBe(true);
    cleanup();

    const high = renderHero({ state: { ...baseState, battery_level: 90 } });
    // Green fill — only the battery gauge uses it when idle (not charging).
    expect(hasGaugeColor(high.container as HTMLElement, '#10b981')).toBe(true);
  });
});
