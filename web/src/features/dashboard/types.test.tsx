/**
 * dashboard `types.ts` — DTO contract harness.
 *
 * `types.ts` is a pure type-declaration module: its twelve exports carry no
 * runtime code, so a bare `import` proves nothing. What actually matters is that
 * objects shaped by each interface flow correctly through the REAL consumers
 * that read them — the same "pin the contract at its boundary" strategy the
 * `drive-detail/types.test.ts` and `weekly-digest/types.test.ts` precedents use.
 * These interfaces are consumer-facing API DTOs (a curated mirror of
 * `@/api/types`), so every assertion below feeds a strongly-typed fixture into
 * the component that owns it and checks the DERIVED render output — never the
 * fixture asserted back against itself:
 *
 *   Vehicle / VehicleState              → <VehicleHero>       (header + gauges + asleep)
 *   FleetAnalytics / Drive / Charging…  → <FleetStatsBar>     (KPI tiles + raw-value converters)
 *   Drive / ChargingSession / Fleet…    → <RecentActivity>    (SI→display timeline + perf)
 *   Motor/Climate/Security/Tire/Media/  → <LiveTelemetry>     (six panels, null-safety)
 *     Location
 *   Alert                               → inbox reducer       (no component consumes it)
 *
 * Every consumer is exercised across multiple facets: full data, empty/undefined
 * (no hidden panels), null-heavy frames (em-dash / 0 fallbacks), and the
 * unit-converter contract (each converter must receive the RAW SI/base value off
 * the DTO, so a double-conversion or wrong-field bug is caught). `react-i18next`
 * is stubbed with a passthrough `t(key, default)` (repo convention) and
 * `@/hooks/useFormatting` is mocked for <RecentActivity>'s currency boundary;
 * the shared UI primitives run for real (useSettings / useTimezone are stubbed
 * globally in src/test-setup.ts). Router-rendering consumers are wrapped in
 * <MemoryRouter>. No network is touched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | object) =>
      typeof defaultValue === 'string' ? defaultValue : key,
  }),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number, decimals = 2) => `$${amount.toFixed(decimals)}`,
    currencySymbol: '$',
    costPerKwh: 0.12,
    formatEnergyCost: (kwh: number) => `$${(kwh * 0.12).toFixed(2)}`,
    costPerDistanceUnit: () => null,
    estimateGasCost: () => null,
  }),
}));

import { FleetStatsBar } from './components/FleetStatsBar';
import { RecentActivity } from './components/RecentActivity';
import { LiveTelemetry } from './components/LiveTelemetry';
import { VehicleHero } from './components/VehicleHero';
import type {
  Vehicle,
  VehicleState,
  FleetAnalytics,
  Alert,
  Drive,
  ChargingSession,
  MotorData,
  ClimateData,
  SecurityData,
  TirePressureData,
  MediaData,
  LocationData,
} from './types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** ISO string `offsetMs` in the past from now — keeps relative-time deterministic. */
function isoAgo(offsetMs: number): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

afterEach(() => cleanup());

/* ── Vehicle + VehicleState → <VehicleHero> ─────────────────────────────────── */
const vehicle: Vehicle = {
  id: 7,
  vehicle_id: 7,
  vin: '5YJ3E1EA7KF000000',
  display_name: 'My Model 3',
  model: 'Model 3',
  trim_badging: 'Long Range',
  exterior_color: 'Pearl White',
  wheel_type: 'Aero 18',
  state: 'online',
  healthy: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
};

const drivingState: VehicleState = {
  vehicle_id: 7,
  state: 'driving',
  latitude: 47.6,
  longitude: -122.3,
  speed: 30,
  power: 45,
  battery_level: 72,
  rated_range: 400,
  ideal_range: 420,
  odometer: 15_000,
  inside_temp: 21,
  outside_temp: 12,
  is_climate_on: true,
  is_charging: false,
  charger_power: 0,
  charge_rate: 0,
  time_to_full_charge: 0,
  is_locked: true,
  sentry_mode: false,
  software_version: '2024.44.25',
};

function renderHero(state: VehicleState | null) {
  const toDistanceDisplay = vi.fn((km: number) => km * 0.621371);
  const toSpeedDisplay = vi.fn((kmh: number) => kmh * 0.621371);
  const toTemperatureDisplay = vi.fn((c: number) => c);
  const utils = render(
    <MemoryRouter>
      <VehicleHero
        vehicle={vehicle}
        state={state}
        firmwareVersion="2024.44.25"
        toDistanceDisplay={toDistanceDisplay}
        toSpeedDisplay={toSpeedDisplay}
        toTemperatureDisplay={toTemperatureDisplay}
        isFahrenheit={false}
        distanceUnit="mi"
        speedUnit="mph"
        tempUnit="°C"
      />
    </MemoryRouter>,
  );
  return { ...utils, toDistanceDisplay, toSpeedDisplay };
}

describe('Vehicle + VehicleState (via <VehicleHero>)', () => {
  it('renders the identity header and feeds the live driving state through the converters', () => {
    const { toDistanceDisplay, toSpeedDisplay } = renderHero(drivingState);

    // Vehicle string fields land in the DOM verbatim.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('My Model 3');
    expect(screen.getByText('5YJ3E1EA7KF000000')).toBeInTheDocument();
    expect(screen.getByText(/Long Range/)).toBeInTheDocument();

    // The driving branch surfaces a speed gauge, and every converter receives the
    // RAW VehicleState value (not a pre-converted one) — the unit contract.
    expect(toSpeedDisplay).toHaveBeenCalledWith(30);
    expect(toDistanceDisplay).toHaveBeenCalledWith(400);
  });

  it('shows the asleep placeholder (no gauges) when VehicleState is null', () => {
    const { toSpeedDisplay } = renderHero(null);

    expect(screen.getByText('Vehicle asleep — wake to see live data')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wake Up' })).toBeInTheDocument();
    // Gauges + their converters must not run without a live state.
    expect(screen.queryByText('Battery')).toBeNull();
    expect(toSpeedDisplay).not.toHaveBeenCalled();
  });
});

/* ── FleetAnalytics + Drive + ChargingSession → <FleetStatsBar> ─────────────── */
const analytics: FleetAnalytics = {
  total_vehicles: 3,
  total_drives: 42,
  total_charging_sessions: 7,
  total_distance_km: 1000,
  total_energy_kwh: 200,
  total_cost: 123.45,
  avg_efficiency_wh_km: 160,
  period_days: 30,
  most_efficient_vehicle: { name: 'Model 3', efficiency: 148 },
};

function makeDrive(over: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicle_id: 7,
    started_at: isoAgo(2 * HOUR),
    ended_at: isoAgo(HOUR),
    start_ts: isoAgo(2 * HOUR),
    distance_m: 12_000,
    duration_s: 3720,
    max_speed_mps: 30,
    avg_speed_mps: 20,
    avg_power_w: 15_000,
    start_soc_pct: 80,
    end_soc_pct: 60,
    energy_used_wh: 4000,
    regen_energy_wh: 500,
    ...over,
  };
}

function makeCharge(over: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 7,
    started_at: isoAgo(HOUR),
    ended_at: isoAgo(30 * MINUTE),
    total_energy_added_wh: 25_000,
    start_soc_pct: 30,
    end_soc_pct: 80,
    cost_decimal: 5,
    cost: 5,
    startedAt: isoAgo(HOUR),
    duration_min: 30,
    ...over,
  };
}

// ≥2 rows each so the drive-distance / charge-energy sparklines (MiniChart needs
// two points) actually render a polyline — the DTO→chart contract.
const drives: Drive[] = [
  makeDrive({ id: 1, distance_m: 12_000 }),
  makeDrive({ id: 2, distance_m: 8_000, started_at: isoAgo(4 * HOUR) }),
  makeDrive({ id: 3, distance_m: 5_000, started_at: isoAgo(6 * HOUR) }),
];

const charges: ChargingSession[] = [
  makeCharge({ id: 1, total_energy_added_wh: 25_000 }),
  makeCharge({ id: 2, total_energy_added_wh: 18_000, started_at: isoAgo(3 * HOUR) }),
  makeCharge({ id: 3, total_energy_added_wh: 30_000, started_at: isoAgo(5 * HOUR) }),
];

describe('FleetAnalytics + Drive + ChargingSession (via <FleetStatsBar>)', () => {
  function renderBar(over: {
    analytics?: FleetAnalytics | undefined;
    recentDrives?: Drive[] | undefined;
    recentCharges?: ChargingSession[] | undefined;
    unreadAlerts?: number;
  } = {}) {
    const toDistanceDisplay = vi.fn((km: number) => km * 0.621371);
    const toEfficiencyDisplay = vi.fn((whKm: number) => whKm);
    const utils = render(
      <FleetStatsBar
        analytics={'analytics' in over ? over.analytics : analytics}
        vehicleCount={3}
        onlineCount={2}
        unreadAlerts={over.unreadAlerts ?? 4}
        recentDrives={'recentDrives' in over ? over.recentDrives : drives}
        recentCharges={'recentCharges' in over ? over.recentCharges : charges}
        toDistanceDisplay={toDistanceDisplay}
        toEfficiencyDisplay={toEfficiencyDisplay}
        distanceUnit="mi"
        efficiencyUnit="Wh/mi"
      />,
    );
    return { ...utils, toDistanceDisplay, toEfficiencyDisplay };
  }

  it('maps the analytics fields into the five KPI tiles and passes RAW base values to converters', () => {
    const { container, toDistanceDisplay, toEfficiencyDisplay } = renderBar();

    // Five labelled groups, none hidden.
    expect(screen.getAllByRole('group')).toHaveLength(5);
    // total_distance_km / avg_efficiency_wh_km reach the converters unconverted.
    expect(toDistanceDisplay).toHaveBeenCalledWith(1000);
    expect(toEfficiencyDisplay).toHaveBeenCalledWith(160);
    // The energy tile keeps the kWh (derived) unit; the distance tile the display unit.
    expect(screen.getByRole('group', { name: 'Energy (30d)' })).toHaveTextContent('kWh');
    expect(screen.getByRole('group', { name: 'Distance (30d)' })).toHaveTextContent('mi');
    // Two sparklines: one from Drive.distance_m, one from ChargingSession.total_energy_added_wh.
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
  });

  it('renders every tile with a nil dataset and coalesces converter inputs to 0', () => {
    const { container, toDistanceDisplay, toEfficiencyDisplay } = renderBar({
      analytics: undefined,
      recentDrives: undefined,
      recentCharges: undefined,
    });

    expect(screen.getAllByRole('group')).toHaveLength(5);
    expect(toDistanceDisplay).toHaveBeenCalledWith(0);
    expect(toEfficiencyDisplay).toHaveBeenCalledWith(0);
    // No data → no sparkline polyline, but no crash and no dropped panel.
    expect(container.querySelectorAll('polyline')).toHaveLength(0);
  });

  it('colours the unread-alert count red when > 0 and emerald when 0', () => {
    const withAlerts = renderBar({ unreadAlerts: 4 });
    const groupWith = screen.getByRole('group', { name: 'Alerts' });
    expect(groupWith.querySelector('.text-red-500')).not.toBeNull();
    withAlerts.unmount();

    renderBar({ unreadAlerts: 0 });
    const groupNone = screen.getByRole('group', { name: 'Alerts' });
    expect(groupNone.querySelector('.text-emerald-500')).not.toBeNull();
  });
});

/* ── Drive + ChargingSession + FleetAnalytics → <RecentActivity> ────────────── */
describe('Drive + ChargingSession + FleetAnalytics (via <RecentActivity>)', () => {
  function renderActivity(recentDrives: Drive[] | undefined, recentCharges: ChargingSession[] | undefined) {
    return render(
      <MemoryRouter>
        <RecentActivity
          recentDrives={recentDrives}
          recentCharges={recentCharges}
          analytics={analytics}
          toEfficiencyDisplay={(whKm: number) => whKm}
          distanceUnit="km"
          efficiencyUnit="Wh/km"
        />
      </MemoryRouter>,
    );
  }

  it('builds a merged timeline that converts distance_m→km and total_energy_added_wh→kWh', () => {
    renderActivity(drives, charges);

    const timeline = screen.getByTestId('activity-timeline');
    // 12 000 m → 12 km ; 25 000 Wh → 25 kWh — the SI→display contract for these DTOs.
    expect(timeline.textContent).toMatch(/12(\.\d)?\s*km/);
    expect(timeline.textContent).toMatch(/25(\.\d)?\s*kWh/);
    // FleetAnalytics scalars land in the performance panel.
    expect(screen.getByText('Total Drives (30d)').parentElement).toHaveTextContent('42');
    expect(screen.getByText('Charge Sessions').parentElement).toHaveTextContent('7');
  });

  it('shows the empty state (not a blank panel) when there is no drive or charge activity', () => {
    renderActivity([], []);

    expect(screen.getByTestId('activity-empty')).toBeInTheDocument();
    expect(screen.getByText('No activity yet. Start driving!')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-timeline')).toBeNull();
  });
});

/* ── Motor/Climate/Security/Tire/Media/Location → <LiveTelemetry> ──────────── */
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

describe('Motor/Climate/Security/Tire/Media/Location (via <LiveTelemetry>)', () => {
  function renderLive(withData: boolean) {
    const toTemperatureDisplay = vi.fn((c: number) => c);
    const toDistanceDisplay = vi.fn((km: number) => km);
    const toPressureDisplay = vi.fn((bar: number) => bar);
    const utils = render(
      <LiveTelemetry
        motorData={withData ? motor : undefined}
        climateData={withData ? climate : undefined}
        securityData={withData ? security : undefined}
        tireData={withData ? tires : undefined}
        mediaData={withData ? media : undefined}
        locationData={withData ? location : undefined}
        toTemperatureDisplay={toTemperatureDisplay}
        toDistanceDisplay={toDistanceDisplay}
        toPressureDisplay={toPressureDisplay}
        tempUnit="°C"
        distanceUnit="km"
        pressureUnit="bar"
      />,
    );
    return { ...utils, toTemperatureDisplay, toDistanceDisplay, toPressureDisplay };
  }

  it('renders each of the six telemetry DTOs and feeds converters the raw SI values', () => {
    const { container, toTemperatureDisplay, toDistanceDisplay, toPressureDisplay } = renderLive(true);

    // Motor
    expect(screen.getByText('320 Nm')).toBeInTheDocument();
    expect(screen.getByText('45°C')).toBeInTheDocument();
    expect(screen.getByText('D').className).toContain('green'); // gear → success badge
    // Media
    expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
    expect(screen.getByText('Playing')).toBeInTheDocument();
    // Security + Location + Tire
    expect(container.textContent).toContain('Locked');
    expect(screen.getByText('Supercharger')).toBeInTheDocument();
    expect(screen.getByText('2.3')).toBeInTheDocument(); // front_left

    // Converters receive raw SI: inside_temp °C, front_left bar, miles_to_arrival.
    expect(toTemperatureDisplay).toHaveBeenCalledWith(21);
    expect(toPressureDisplay).toHaveBeenCalledWith(2.3);
    expect(toDistanceDisplay).toHaveBeenCalledWith(12);
  });

  it('keeps all six panels visible with skeletons (no crash) when every DTO is undefined', () => {
    const { container } = renderLive(false);

    // Headings still render — no section is dropped when data is absent.
    expect(screen.getByRole('heading', { name: 'Drivetrain' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Navigation' })).toBeInTheDocument();
    // Loading state: skeletons present, no concrete value or progressbar leaks.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('320 Nm')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

/* ── Alert (no component consumes it) → inbox reducer contract ───────────────── */
describe('Alert (inbox reducer contract)', () => {
  const alerts: Alert[] = [
    { id: 1, type: 'low_battery', severity: 'warning', title: 'Battery low', message: 'Battery at 15%', is_read: false, created_at: isoAgo(HOUR) },
    { id: 2, type: 'charging_complete', severity: 'info', title: 'Charge complete', message: 'Fully charged', is_read: true, created_at: isoAgo(2 * HOUR) },
    { id: 3, type: 'geofence_exit', severity: 'critical', title: 'Left geofence', message: 'Vehicle left home', is_read: false, created_at: isoAgo(30 * MINUTE) },
  ];

  it('counts unread alerts and detects the highest severity in the backlog', () => {
    const unread = alerts.filter((a) => !a.is_read);
    expect(unread).toHaveLength(2);
    expect(unread.map((a) => a.id)).toEqual([1, 3]);
    expect(unread.some((a) => a.severity === 'critical')).toBe(true);
  });

  it('buckets unread alerts by type and excludes the read ones', () => {
    const byType = alerts
      .filter((a) => !a.is_read)
      .reduce<Record<string, number>>((acc, a) => {
        acc[a.type] = (acc[a.type] ?? 0) + 1;
        return acc;
      }, {});

    expect(byType).toEqual({ low_battery: 1, geofence_exit: 1 });
    expect(byType.charging_complete).toBeUndefined();
  });
});
