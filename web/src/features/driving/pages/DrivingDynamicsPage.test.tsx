/**
 * DrivingDynamicsPage — orchestration contract + hardening tests.
 *
 * DrivingDynamicsPage is a pure orchestration page: it selects a vehicle,
 * fans four data hooks (`useMotorLatest`, `useMotorHistory`, `useDrives`,
 * `useDrivingCoach`) into eleven presentational sections, derives cross-section
 * state (motor stats + throttle style via the real `helpers`), filters drives to
 * a page-scoped date window, and threads SI→display unit converters down to the
 * children.
 *
 * Strategy:
 *   - The four data hooks + `useSelectedVehicle` are mocked at the hook boundary
 *     so every branch (has-vehicle / no-vehicle, has-data / empty) is
 *     deterministic and no network is touched.
 *   - The `driving-dynamics` child barrel is replaced with lightweight test
 *     doubles that surface the props the page computes (filtered-drive counts,
 *     motor stats, throttle style, the converted output of each unit converter,
 *     and the wired date-range callbacks). This lets the test assert the page's
 *     OWN logic — filtering, derivation, unit wiring, vehicle propagation —
 *     rather than the children's internal rendering (already covered by their
 *     own suites).
 *   - `helpers` (computeMotorStats / getThrottleStyle) and `useUnits` (→ the
 *     file-level `useSettings` mock) render for real, so the SI→display
 *     conversion boundary is exercised for BOTH metric (km / km/h / °C) and
 *     imperial (mi / mph / °F) preferences.
 *
 * System time is pinned (Date only — timers stay real so userEvent works) so
 * the default 30-day window resolves to a fixed [2025-05-16, 2025-06-15].
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// i18n stub: echo the fallback string so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') return fallbackOrOpts;
      if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
        const o = fallbackOrOpts as Record<string, unknown>;
        if (typeof o.defaultValue === 'string') return o.defaultValue;
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Mutable unit preference so one file exercises both the metric and imperial
// display-conversion branches. Hoisted so the settings factory can close over it.
const unitState = vi.hoisted(() => ({
  length: 'km' as 'km' | 'mi',
  temp: 'C' as 'C' | 'F',
}));

// File-level useSettings mock (overrides the global test-setup stub) so
// `useUnits()` derives real converters from a flippable preference.
vi.mock('@/hooks/useSettings', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSettings')>();
  const defaults = {
    unit_of_length: 'km' as const,
    unit_of_temp: 'C' as const,
    unit_of_pressure: 'bar' as const,
    preferred_range: 'rated' as const,
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark' as const,
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 0,
    gas_unit: 'gallon' as const,
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant' as const,
    currency_symbol: '$',
    locale: 'en-US',
    tz_display_default: 'vehicle' as const,
    timezone_user: '',
    tab_badge_enabled: true,
    critical_flash_enabled: true,
    ui_density: 'comfortable' as const,
    time_format_default: 'relative' as const,
    chart_palette: 'cb_safe' as const,
    ai_mode: 'off' as const,
    ai_features: {},
    ai_provider_config: {},
    ai_cost_cap_cents: 0,
  };
  return {
    ...actual,
    useSettings: () => ({
      settings: {
        ...defaults,
        unit_of_length: unitState.length,
        unit_of_temp: unitState.temp,
      },
      isMiles: unitState.length === 'mi',
      isFahrenheit: unitState.temp === 'F',
      isPSI: false,
      decimals: 2,
      locale: 'en-US',
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  };
});

// Data hooks + selection are mocked at the boundary. `...actual` keeps every
// non-overridden export intact for any transitive importer.
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useMotorLatest: vi.fn(), useMotorHistory: vi.fn() };
});
vi.mock('@/api/hooks/useDriving', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useDriving')>();
  return { ...actual, useDrives: vi.fn(), useDrivingCoach: vi.fn() };
});
vi.mock('@/hooks/useSelectedVehicle', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});

// Replace the child barrel with prop-surfacing doubles. Each double renders the
// exact page-computed props the assertions care about; DriveAnalyticsSection
// also exposes the wired date-range callbacks as buttons for interaction tests.
vi.mock('../components/driving-dynamics', () => ({
  SummaryStats: (p: any) => (
    <div data-testid="summary">
      <span data-testid="summary-readings">{p.motorStats?.totalReadings ?? -1}</span>
      <span data-testid="summary-temp">{p.toTemperatureDisplay(100)}</span>
      <span data-testid="summary-tunit">{p.tempUnit}</span>
    </div>
  ),
  LiveMotorStatus: (p: any) => (
    <div data-testid="live-motor">
      <span data-testid="live-shift">{p.motorLatest?.shift_state ?? 'none'}</span>
      <span data-testid="live-temp">{p.toTemperatureDisplay(100)}</span>
      <span data-testid="live-tunit">{p.tempUnit}</span>
    </div>
  ),
  PedalUsage: (p: any) => <div data-testid="pedal">{String(p.vehicleId)}</div>,
  GForcePanel: (p: any) => <div data-testid="gforce">{String(p.vehicleId)}</div>,
  AutopilotSection: (p: any) => <div data-testid="autopilot">{String(p.vehicleId)}</div>,
  SpeedGearPanel: (p: any) => (
    <div data-testid="speed-gear">
      <span data-testid="sg-count">{p.filteredDrives.length}</span>
      <span data-testid="sg-speed">{p.toSpeedDisplay(10)}</span>
      <span data-testid="sg-sunit">{p.speedUnit}</span>
    </div>
  ),
  MotorEfficiencyInsights: (p: any) => (
    <div data-testid="efficiency">
      <span data-testid="eff-style">{p.throttleStyle ?? 'none'}</span>
      <span data-testid="eff-power">{p.motorStats?.avgPower ?? -1}</span>
      <span data-testid="eff-tunit">{p.tempUnit}</span>
    </div>
  ),
  MotorHistoryCharts: (p: any) => (
    <div data-testid="motor-history">
      <span data-testid="mh-count">{p.motorHistory?.length ?? -1}</span>
      <span data-testid="mh-speed">{p.toSpeedDisplay(10)}</span>
      <span data-testid="mh-sunit">{p.speedUnit}</span>
    </div>
  ),
  DrivingCoachSection: (p: any) => (
    <div data-testid="coach">{p.coachData ? 'has-coach' : 'no-coach'}</div>
  ),
  DriveAnalyticsSection: (p: any) => (
    <div data-testid="drive-analytics">
      <span data-testid="da-count">{p.filteredDrives.length}</span>
      <span data-testid="da-start">{p.startDate}</span>
      <span data-testid="da-end">{p.endDate}</span>
      <span data-testid="da-dunit">{p.distanceUnit}</span>
      <span data-testid="da-sunit">{p.speedUnit}</span>
      <span data-testid="da-distance">{p.toDistanceDisplay(1000)}</span>
      <span data-testid="da-speed">{p.toSpeedDisplay(10)}</span>
      <button
        type="button"
        data-testid="widen-range"
        onClick={() => {
          p.onStartDateChange('2000-01-01');
          p.onEndDateChange('2999-12-31');
        }}
      >
        widen
      </button>
    </div>
  ),
  DrivingTips: (p: any) => (
    <div data-testid="tips">
      <span data-testid="tips-style">{p.throttleStyle ?? 'none'}</span>
      <span data-testid="tips-has">{p.motorStats ? 'has-stats' : 'no-stats'}</span>
    </div>
  ),
}));

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import { useMotorLatest, useMotorHistory } from '@/api/hooks/useVehicles';
import { useDrives, useDrivingCoach } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import DrivingDynamicsPage from './DrivingDynamicsPage';

const mockMotorLatest = vi.mocked(useMotorLatest);
const mockMotorHistory = vi.mocked(useMotorHistory);
const mockDrives = vi.mocked(useDrives);
const mockCoach = vi.mocked(useDrivingCoach);
const mockSelectedVehicle = vi.mocked(useSelectedVehicle);

/** Minimal `UseQueryResult`-shaped stub (incl. DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isError: false,
    isStale: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function motorSnap(over: Record<string, unknown> = {}): any {
  return {
    ts: '2025-06-15T12:00:00Z',
    power_kw: 0,
    regen_kw: 0,
    torque_nm_front: null,
    torque_nm_rear: null,
    motor_temp_c_front: null,
    motor_temp_c_rear: null,
    motor_rpm_front: null,
    motor_rpm_rear: null,
    shift_state: 'D',
    ...over,
  };
}

// avg(power_kw) = 100 → getThrottleStyle => 'aggressive'; 2 readings.
const AGGRESSIVE_HISTORY = [
  motorSnap({ power_kw: 90, torque_nm_front: 100, torque_nm_rear: 150, motor_temp_c_front: 40, motor_temp_c_rear: 45, regen_kw: -10 }),
  motorSnap({ power_kw: 110, torque_nm_front: 120, torque_nm_rear: 180, motor_temp_c_front: 60, motor_temp_c_rear: 70, regen_kw: -30 }),
];

function drive(over: Record<string, unknown> = {}): any {
  return {
    id: 1,
    vehicleId: 1,
    startTs: '2025-06-01T10:00:00Z',
    endTs: '2025-06-01T11:00:00Z',
    durationS: 3600,
    distanceM: 50_000,
    avgSpeedMps: 14,
    maxSpeedMps: 30,
    avgPowerW: 20_000,
    score: 80,
    ...over,
  };
}

// One in the default window, one before it, one after it, and one with a
// missing timestamp (exercises the `?? ''` guard — always excluded).
const DRIVES = [
  drive({ id: 1, startTs: '2025-06-01T10:00:00Z' }), // in window
  drive({ id: 2, startTs: '2025-03-01T10:00:00Z' }), // before window
  drive({ id: 3, startTs: '2025-12-01T10:00:00Z' }), // after window
  drive({ id: 4, startTs: null }), // undated — never in any window
];

function installHappyPath() {
  mockSelectedVehicle.mockReturnValue({
    vehicleId: 1,
    vehicle: null,
    vehicles: [
      { id: 1, display_name: 'Car One', vin: 'VIN1' },
      { id: 2, display_name: 'Car Two', vin: 'VIN2' },
    ] as any,
    setVehicleId: vi.fn(),
  });
  mockMotorLatest.mockReturnValue(
    qr({ data: motorSnap({ shift_state: 'D', power_kw: 42, motor_temp_c_front: 30, motor_temp_c_rear: 35 }) }),
  );
  mockMotorHistory.mockReturnValue(qr({ data: AGGRESSIVE_HISTORY }));
  mockDrives.mockReturnValue(qr({ data: DRIVES }));
  mockCoach.mockReturnValue(qr({ data: { score: 88, style: 'efficient', trend: [] } }));
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DrivingDynamicsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const num = (testId: string) => Number(screen.getByTestId(testId).textContent);

beforeEach(() => {
  vi.clearAllMocks();
  unitState.length = 'km';
  unitState.temp = 'C';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  installHappyPath();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DrivingDynamicsPage — structure & a11y', () => {
  it('renders the title, subtitle, vehicle picker and all eight labelled sections', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Driving Dynamics' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Live motor telemetry, G-forces & driving analysis'),
    ).toBeInTheDocument();

    // VehicleSelect renders a labelled combobox (fleet has vehicles).
    expect(screen.getByRole('combobox', { name: 'Select vehicle' })).toBeInTheDocument();

    // Every <section aria-label> becomes an accessible region — exactly eight.
    const regions = screen.getAllByRole('region');
    expect(regions).toHaveLength(8);
    expect(screen.getByRole('region', { name: 'Live cockpit' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Motor efficiency' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Drive Analytics' })).toBeInTheDocument();
  });

  it('sets the document title via usePageTitle', () => {
    renderPage();
    expect(document.title).toContain('Driving Dynamics');
  });

  it('wires the data hooks with SI/snake_case-correct arguments', () => {
    renderPage();
    // vehicleId=1: live poll every 5s, 200-row history, string id for list/coach.
    expect(mockMotorLatest).toHaveBeenCalledWith(1, 5000);
    expect(mockMotorHistory).toHaveBeenCalledWith(1, 200);
    expect(mockDrives).toHaveBeenCalledWith('1');
    expect(mockCoach).toHaveBeenCalledWith('1');
  });
});

describe('DrivingDynamicsPage — motor-stats derivation', () => {
  it('computes stats from history and derives an aggressive throttle style', () => {
    renderPage();

    // computeMotorStats over AGGRESSIVE_HISTORY: 2 readings, avgPower 100.
    expect(num('summary-readings')).toBe(2);
    expect(num('eff-power')).toBe(100);
    // getThrottleStyle(100) => 'aggressive' (>= 80) — threaded to both consumers.
    expect(screen.getByTestId('eff-style')).toHaveTextContent('aggressive');
    expect(screen.getByTestId('tips-style')).toHaveTextContent('none');
    expect(screen.getByTestId('tips-has')).toHaveTextContent('has-stats');
    // Live snapshot shift state propagates.
    expect(screen.getByTestId('live-shift')).toHaveTextContent('D');
    // Coach data present.
    expect(screen.getByTestId('coach')).toHaveTextContent('has-coach');
  });

  it('derives a conservative throttle style for low average power', () => {
    mockMotorHistory.mockReturnValue(
      qr({ data: [motorSnap({ power_kw: 5 }), motorSnap({ power_kw: 15 })] }),
    );
    renderPage();
    // avg(5,15)=10 < 20 => 'conservative'.
    expect(screen.getByTestId('eff-style')).toHaveTextContent('conservative');
    expect(screen.getByTestId('tips-style')).toHaveTextContent('none');
    expect(num('eff-power')).toBe(10);
  });

  it('renders empty derivation (null stats, no throttle style) when history is empty', () => {
    mockMotorHistory.mockReturnValue(qr({ data: [] }));
    renderPage();
    // computeMotorStats([]) => null → the page passes null through.
    expect(num('summary-readings')).toBe(-1);
    expect(screen.getByTestId('eff-style')).toHaveTextContent('none');
    expect(screen.getByTestId('tips-has')).toHaveTextContent('no-stats');
    // Sections still render — never a blank panel.
    expect(screen.getAllByRole('region')).toHaveLength(8);
  });
});

describe('DrivingDynamicsPage — drive date filtering', () => {
  it('filters drives to the default 30-day window', () => {
    renderPage();
    // Fixed now = 2025-06-15 → window [2025-05-16, 2025-06-15].
    expect(screen.getByTestId('da-start')).toHaveTextContent('2025-05-16');
    expect(screen.getByTestId('da-end')).toHaveTextContent('2025-06-15');
    // Only drive #1 (2025-06-01) falls inside; #2 before, #3 after, #4 undated.
    expect(num('da-count')).toBe(1);
    expect(num('sg-count')).toBe(1);
  });

  it('re-filters when the user widens the date range', async () => {
    renderPage();
    expect(num('da-count')).toBe(1);

    fireEvent.click(screen.getByTestId('widen-range'));

    // Widened to [2000-01-01, 2999-12-31]: the three dated drives now match;
    // the undated drive (#4) is still excluded by the `?? ''` guard.
    await waitFor(() => expect(num('da-count')).toBe(3));
    expect(num('sg-count')).toBe(3);
    expect(screen.getByTestId('da-start')).toHaveTextContent('2000-01-01');
    expect(screen.getByTestId('da-end')).toHaveTextContent('2999-12-31');
  });

  it('passes an empty filtered list when drives have not loaded', () => {
    mockDrives.mockReturnValue(qr({ data: undefined }));
    renderPage();
    expect(num('da-count')).toBe(0);
    expect(num('sg-count')).toBe(0);
  });
});

describe('DrivingDynamicsPage — unit conversion boundary', () => {
  it('threads metric SI→display converters and units to children', () => {
    renderPage();
    // km / km/h / °C.
    expect(screen.getByTestId('da-dunit')).toHaveTextContent('km');
    expect(screen.getByTestId('sg-sunit')).toHaveTextContent('km/h');
    expect(screen.getByTestId('summary-tunit')).toHaveTextContent('°C');
    // convertDistanceFromSI(1000, 'km') = 1; convertSpeedFromSI(10, 'km/h') = 36;
    // convertTempFromSI(100, '°C') = 100.
    expect(num('da-distance')).toBe(1);
    expect(num('sg-speed')).toBe(36);
    expect(num('mh-speed')).toBe(36);
    expect(num('summary-temp')).toBe(100);
    expect(num('live-temp')).toBe(100);
  });

  it('threads imperial converters and units when preferences flip', () => {
    unitState.length = 'mi';
    unitState.temp = 'F';
    renderPage();

    expect(screen.getByTestId('da-dunit')).toHaveTextContent('mi');
    expect(screen.getByTestId('sg-sunit')).toHaveTextContent('mph');
    expect(screen.getByTestId('summary-tunit')).toHaveTextContent('°F');
    // convertSpeedFromSI(10, 'mph') ≈ 22.37; convertDistanceFromSI(1000, 'mi') ≈ 0.621;
    // convertTempFromSI(100, '°F') = 212.
    expect(num('sg-speed')).toBeCloseTo(22.37, 2);
    expect(num('da-distance')).toBeCloseTo(0.621, 3);
    expect(num('summary-temp')).toBe(212);
  });
});

describe('DrivingDynamicsPage — no-vehicle state', () => {
  beforeEach(() => {
    mockSelectedVehicle.mockReturnValue({
      vehicleId: null,
      vehicle: null,
      vehicles: [] as any,
      setVehicleId: vi.fn(),
    });
    mockMotorLatest.mockReturnValue(qr({ data: undefined }));
    mockMotorHistory.mockReturnValue(qr({ data: undefined }));
    mockDrives.mockReturnValue(qr({ data: undefined }));
    mockCoach.mockReturnValue(qr({ data: undefined }));
  });

  it('propagates a null vehicleId and disables the data hooks safely', () => {
    renderPage();

    // vehicleId ?? 0 → live/history hooks receive 0 (their `enabled` gate);
    // list/coach receive undefined.
    expect(mockMotorLatest).toHaveBeenCalledWith(0, 5000);
    expect(mockMotorHistory).toHaveBeenCalledWith(0, 200);
    expect(mockDrives).toHaveBeenCalledWith(undefined);
    expect(mockCoach).toHaveBeenCalledWith(undefined);

    // The live sub-panels receive the raw null id (they gate internally).
    expect(screen.getByTestId('gforce')).toHaveTextContent('null');
    expect(screen.getByTestId('pedal')).toHaveTextContent('null');
    expect(screen.getByTestId('autopilot')).toHaveTextContent('null');
  });

  it('still renders every section and hides the picker for an empty fleet', () => {
    renderPage();
    // No blank page: all eight regions remain, filtered list is empty.
    expect(screen.getAllByRole('region')).toHaveLength(8);
    expect(num('da-count')).toBe(0);
    expect(screen.getByTestId('coach')).toHaveTextContent('no-coach');
    // VehicleSelect renders nothing when the fleet is empty.
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).toBeNull();
  });
});
