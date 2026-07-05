/**
 * LiveTelemetry tests.
 *
 * LiveTelemetry is the dashboard's live-signal grid: six independent panels
 * (Drivetrain / Climate / Security / Tire Pressure / Media / Navigation) that
 * each accept an optional data object and a set of unit converters. The panels
 * must NEVER hide themselves — when their data is `undefined` they render a
 * skeleton, and every value degrades to an em dash rather than crashing on a
 * `null`. These tests drive the single public export through every panel and
 * every meaningful branch:
 *
 *   - section chrome + all six panel headings render (accessible headings)
 *   - the loading contract: every panel shows a skeleton and NO section is
 *     dropped when all data is undefined (and progressbars only exist with data)
 *   - Drivetrain: torque/temp/g-force formatting, gear→badge-variant mapping,
 *     and the all-null em-dash fallbacks
 *   - Climate: the temperature converter is applied, the fan progressbar exposes
 *     accessible value semantics, its fill clamps to 100% for out-of-range
 *     sensor values (the hardened bug), and the mode chips / empty-hint branch
 *   - Security: locked/sentry state text + open-door / open-window counting
 *   - Tire Pressure: converter application, threshold colouring, the all-normal
 *     vs. warning badge, and null-tire dashes
 *   - Media: now-playing metadata, `<nil>` sentinel cleaning, playback-status →
 *     badge-variant mapping, the volume progressbar, and the divide-by-zero guard
 *   - Navigation: distance/eta formatting, saved-location chips + empty hint
 *   - every unit converter is invoked with the raw SI value from the API data
 *
 * `react-i18next` is stubbed with a passthrough `t(key, default)` so assertions
 * read the English defaults without booting the i18n runtime. The shared
 * GlassPanel / Badge / Skeleton primitives run for real. No network is touched.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ComponentProps } from 'react';

import { LiveTelemetry } from './LiveTelemetry';
import type {
  MotorData,
  ClimateData,
  SecurityData,
  TirePressureData,
  MediaData,
  LocationData,
} from '../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) =>
      typeof defaultValue === 'string' ? defaultValue : key,
  }),
}));

type Props = ComponentProps<typeof LiveTelemetry>;

const identity = (n: number) => n;

function renderLive(overrides: Partial<Props> = {}) {
  const props: Props = {
    motorData: undefined,
    climateData: undefined,
    securityData: undefined,
    tireData: undefined,
    mediaData: undefined,
    locationData: undefined,
    toTemperatureDisplay: identity,
    toDistanceDisplay: identity,
    toPressureDisplay: identity,
    tempUnit: '°C',
    distanceUnit: 'km',
    pressureUnit: 'bar',
    ...overrides,
  };
  return render(<LiveTelemetry {...props} />);
}

// ── Fixtures — deliberately in-range/SI so converters and thresholds are
//    exercised with realistic Tesla signal values. ──
const motor: MotorData = {
  di_torque: 320,
  di_stator_temp: 45,
  gear: 'D',
  lateral_accel: 0.3,
  longitudinal_accel: 0.5,
};

const climate: ClimateData = {
  inside_temp: 21,
  outside_temp: 15,
  hvac_power: 2.5,
  hvac_fan_speed: 3,
  defrost_mode: 'Off',
  battery_heater_on: false,
};

const security: SecurityData = {
  locked: true,
  sentry_mode: true,
  door_state: 'closed,closed,closed,closed',
  fd_window: 'closed',
  fp_window: 'closed',
  rd_window: 'closed',
  rp_window: 'closed',
};

const tires: TirePressureData = {
  front_left: 2.3,
  front_right: 2.6,
  rear_left: 2.5,
  rear_right: 2.8,
};

const media: MediaData = {
  now_playing_title: 'Bohemian Rhapsody',
  now_playing_artist: 'Queen',
  playback_status: 'Playing',
  audio_volume: 5,
  audio_volume_max: 10,
};

const location: LocationData = {
  destination_name: 'Supercharger',
  miles_to_arrival: 12,
  minutes_to_arrival: 18,
  located_at_home: true,
  located_at_work: false,
  located_at_favorite: false,
};

afterEach(() => cleanup());

describe('LiveTelemetry', () => {
  it('renders the section title and all six telemetry panel headings', () => {
    renderLive();

    expect(screen.getByRole('heading', { name: /Live Telemetry/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Drivetrain' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Climate' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Security' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tire Pressure' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Media' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Navigation' })).toBeInTheDocument();
  });

  it('renders skeletons and drops no section when every data source is undefined', () => {
    const { container } = renderLive();

    // Sections stay visible even with no data.
    expect(screen.getByRole('heading', { name: 'Drivetrain' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Security' })).toBeInTheDocument();

    // Skeleton placeholders are present, and no concrete value / progressbar
    // leaks through the loading state.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('320 Nm')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  // ── Drivetrain ──────────────────────────────────────────────────────────
  it('renders drivetrain metrics with units and a gear badge', () => {
    renderLive({ motorData: motor });

    expect(screen.getByText('320 Nm')).toBeInTheDocument();
    expect(screen.getByText('45°C')).toBeInTheDocument();
    expect(screen.getByText('0.50g')).toBeInTheDocument();

    const gear = screen.getByText('D');
    expect(gear.className).toContain('green'); // success variant
  });

  it('maps gear values to badge variants (D→success, R→danger, P→neutral)', () => {
    renderLive({ motorData: { ...motor, gear: 'D' } });
    expect(screen.getByText('D').className).toContain('green');
    cleanup();

    renderLive({ motorData: { ...motor, gear: 'R' } });
    expect(screen.getByText('R').className).toContain('red');
    cleanup();

    renderLive({ motorData: { ...motor, gear: 'P' } });
    expect(screen.getByText('P').className).toContain('gray');
  });

  it('falls back to an em dash for every missing drivetrain value', () => {
    renderLive({
      motorData: {
        di_torque: null,
        di_stator_temp: null,
        gear: null,
        lateral_accel: null,
        longitudinal_accel: null,
      },
    });

    // torque, motor temp, gear, g-force → four dashes.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('320 Nm')).toBeNull();
    // No gear badge is rendered when the gear is null.
    expect(screen.queryByText('D')).toBeNull();
  });

  it('derives g-force from the larger absolute axis reading', () => {
    renderLive({
      motorData: { ...motor, lateral_accel: -0.82, longitudinal_accel: 0.11 },
    });
    // max(|−0.82|, |0.11|) → 0.82.
    expect(screen.getByText('0.82g')).toBeInTheDocument();
  });

  // ── Climate ─────────────────────────────────────────────────────────────
  it('applies the temperature converter to climate readings', () => {
    const toF = vi.fn((c: number) => c * (9 / 5) + 32);
    renderLive({ climateData: climate, toTemperatureDisplay: toF, tempUnit: '°F' });

    expect(screen.getByText('70°F')).toBeInTheDocument(); // 21°C
    expect(screen.getByText('59°F')).toBeInTheDocument(); // 15°C
    expect(screen.getByText('2.5 kW')).toBeInTheDocument();
    expect(toF).toHaveBeenCalledWith(21);
    expect(toF).toHaveBeenCalledWith(15);
  });

  it('exposes the fan level through an accessible progressbar', () => {
    renderLive({ climateData: { ...climate, hvac_fan_speed: 3 } });

    const fan = screen.getByRole('progressbar', { name: 'Fan' });
    expect(fan).toHaveAttribute('aria-valuenow', '3');
    expect(fan).toHaveAttribute('aria-valuemin', '0');
    expect(fan).toHaveAttribute('aria-valuemax', '6');
    expect((fan.firstElementChild as HTMLElement).style.width).toBe('50%');
    expect(screen.getByText('3/6')).toBeInTheDocument();
  });

  it('clamps the fan fill to 100% when the sensor exceeds the scale max', () => {
    renderLive({ climateData: { ...climate, hvac_fan_speed: 12 } });

    const fan = screen.getByRole('progressbar', { name: 'Fan' });
    // Without the clamp this would compute width: 200%.
    expect((fan.firstElementChild as HTMLElement).style.width).toBe('100%');
    expect(fan).toHaveAttribute('aria-valuemax', '6');
  });

  it('shows active climate mode chips and an empty-modes hint', () => {
    renderLive({
      climateData: { ...climate, defrost_mode: 'Front', battery_heater_on: true },
    });
    expect(screen.getByText('Defrost')).toBeInTheDocument();
    expect(screen.getByText('Bat Heater')).toBeInTheDocument();
    cleanup();

    renderLive({
      climateData: { ...climate, defrost_mode: 'Off', battery_heater_on: false },
    });
    expect(screen.getByText('No active modes')).toBeInTheDocument();
  });

  // ── Security ────────────────────────────────────────────────────────────
  it('summarises a fully-secured, closed-up vehicle', () => {
    renderLive({ securityData: security });

    expect(screen.getByText(/Locked$/)).toBeInTheDocument();
    expect(screen.getByText(/Active$/)).toBeInTheDocument(); // sentry on
    // Doors + windows both report "All Closed".
    expect(screen.getAllByText('All Closed')).toHaveLength(2);
  });

  it('counts open doors and windows and reflects unlocked / sentry-off state', () => {
    renderLive({
      securityData: {
        locked: false,
        sentry_mode: false,
        door_state: 'DriverFront:Open,PassengerRear:Open,Trunk:Closed',
        fd_window: 'Open',
        fp_window: 'closed',
        rd_window: 'closed',
        rp_window: 'closed',
      },
    });

    expect(screen.getByText(/Unlocked$/)).toBeInTheDocument();
    expect(screen.getByText(/Off$/)).toBeInTheDocument(); // sentry off
    expect(screen.getByText('2 Open')).toBeInTheDocument(); // doors
    expect(screen.getByText('1 Open')).toBeInTheDocument(); // windows
  });

  // ── Tire Pressure ───────────────────────────────────────────────────────
  it('renders four in-range tires with an all-normal badge', () => {
    renderLive({ tireData: tires });

    expect(screen.getByText('2.3')).toBeInTheDocument();
    expect(screen.getByText('2.8')).toBeInTheDocument();
    expect(screen.getAllByText('bar')).toHaveLength(4); // unit under each tile
    expect(screen.getByText('All Normal')).toBeInTheDocument();
  });

  it('colours low pressure, flags a warning, and dashes a missing tire', () => {
    renderLive({
      tireData: { front_left: 1.9, front_right: 2.5, rear_left: null, rear_right: 2.5 },
    });

    const low = screen.getByText('1.9');
    expect(low.className).toContain('rose'); // danger threshold colour
    expect(screen.getByText('—')).toBeInTheDocument(); // null tire
    expect(screen.getByText('Warning')).toBeInTheDocument();
  });

  it('applies the pressure converter to each tire reading', () => {
    const toPsi = vi.fn((bar: number) => bar * 14.5038);
    renderLive({ tireData: tires, toPressureDisplay: toPsi, pressureUnit: 'psi' });

    expect(toPsi).toHaveBeenCalledWith(2.3);
    expect(toPsi).toHaveBeenCalledWith(2.8);
    expect(screen.getAllByText('psi')).toHaveLength(4);
  });

  // ── Media ───────────────────────────────────────────────────────────────
  it('renders now-playing metadata, a playing badge, and the volume bar', () => {
    renderLive({ mediaData: media });

    expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
    expect(screen.getByText('Queen')).toBeInTheDocument();
    expect(screen.getByText('Playing').className).toContain('green');
    expect(screen.getByText('5/10')).toBeInTheDocument();

    const volume = screen.getByRole('progressbar', { name: 'Volume' });
    expect(volume).toHaveAttribute('aria-valuenow', '5');
    expect(volume).toHaveAttribute('aria-valuemax', '10');
    expect((volume.firstElementChild as HTMLElement).style.width).toBe('50%');
  });

  it('cleans Go <nil> sentinels in media metadata', () => {
    renderLive({
      mediaData: {
        now_playing_title: '<nil>',
        now_playing_artist: '<nil>',
        playback_status: null,
        audio_volume: null,
        audio_volume_max: null,
      },
    });

    // title, status, and volume all degrade to an em dash…
    expect(screen.getAllByText('—')).toHaveLength(3);
    // …while the artist gets a friendly fallback.
    expect(screen.getByText('Unknown artist')).toBeInTheDocument();
  });

  it('maps playback status to badge variants and guards divide-by-zero on volume', () => {
    renderLive({ mediaData: { ...media, playback_status: 'Paused' } });
    expect(screen.getByText('Paused').className).toContain('yellow'); // warning
    cleanup();

    renderLive({ mediaData: { ...media, playback_status: 'Stopped' } });
    expect(screen.getByText('Stopped').className).toContain('gray'); // neutral
    cleanup();

    renderLive({ mediaData: { ...media, audio_volume: 5, audio_volume_max: 0 } });
    const volume = screen.getByRole('progressbar', { name: 'Volume' });
    // 5 / 0 must not produce NaN% — the guard yields 0%.
    expect((volume.firstElementChild as HTMLElement).style.width).toBe('0%');
  });

  // ── Navigation ──────────────────────────────────────────────────────────
  it('renders navigation details with the distance converter and a saved-location chip', () => {
    const toDist = vi.fn((km: number) => km);
    renderLive({ locationData: location, toDistanceDisplay: toDist });

    expect(screen.getByText('Supercharger')).toBeInTheDocument();
    expect(screen.getByText('12.0 km')).toBeInTheDocument();
    expect(screen.getByText('18 min')).toBeInTheDocument();
    expect(screen.getByText(/Home$/)).toBeInTheDocument(); // "🏠 Home" chip
    expect(toDist).toHaveBeenCalledWith(12);
  });

  it('shows the no-saved-location hint and dashes when nothing is known', () => {
    renderLive({
      locationData: {
        destination_name: null,
        miles_to_arrival: null,
        minutes_to_arrival: null,
        located_at_home: false,
        located_at_work: false,
        located_at_favorite: false,
      },
    });

    expect(screen.getByText('No saved location')).toBeInTheDocument();
    // destination, distance, and eta all fall back to an em dash.
    expect(screen.getAllByText('—')).toHaveLength(3);
  });

  // ── Cross-panel integration ─────────────────────────────────────────────
  it('invokes each unit converter with the raw SI value from the API data', () => {
    const toTemp = vi.fn(identity);
    const toDist = vi.fn(identity);
    const toPres = vi.fn(identity);

    renderLive({
      motorData: motor,
      climateData: climate,
      tireData: tires,
      locationData: location,
      toTemperatureDisplay: toTemp,
      toDistanceDisplay: toDist,
      toPressureDisplay: toPres,
    });

    expect(toTemp).toHaveBeenCalledWith(45); // motor stator temp
    expect(toTemp).toHaveBeenCalledWith(21); // cabin
    expect(toTemp).toHaveBeenCalledWith(15); // outside
    expect(toPres).toHaveBeenCalledWith(2.6); // a tire
    expect(toDist).toHaveBeenCalledWith(12); // distance to arrival
  });
});
