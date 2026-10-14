/**
 * DrivingDynamicsPage — orchestration contract + hardening tests.
 *
 * DrivingDynamicsPage is a pure orchestration page: it selects a vehicle,
 * scopes two drive-list hooks to the selected workspace, passes the selected
 * ride window into independently subscribed presenters, and threads display
 * converters to retained analytics. Modern stat presenters own useUnits().
 *
 * Strategy:
 *   - The four data hooks + `useSelectedVehicle` are mocked at the hook boundary
 *     so every branch (has-vehicle / no-vehicle, has-data / empty) is
 *     deterministic and no network is touched.
 *   - Both presenter barrels have prop-surfacing doubles for page-owned scope,
 *     vehicle propagation and analytics converters.
 *   - Conversion cases also mount the actual modern SummaryStats and
 *     SpeedGearPanel with measured SI fixtures. Their shared stat formatting,
 *     computeMotorStats and useUnits run for real for metric and imperial
 *     preferences; no StatStrip/StatTile output is fabricated.
 *
 * System time is pinned (Date only — timers stay real so userEvent works) so
 * the shared URL window is fixed at [2025-06-09, 2025-06-15].
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, QueryObserver, type UseQueryResult } from '@tanstack/react-query';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui';
import type { ComponentProps, ReactNode } from 'react';
import type { MotorSnapshot } from '@/api/types';
import type { DataStateSource } from '@/api/dataState';
import type { Drive, DrivingCoachData } from '@/types/driving';
import type { Vehicle } from '@/types/vehicle';
import i18n from 'i18next';

describe('Driving dynamics layout import boundary', () => {
  it.each([
    'components/driving-dynamics-modernization/DrivingTips.tsx',
    'components/driving-dynamics-modernization/DynamicsPlacement.tsx',
    'components/driving-dynamics-modernization/DynamicsTripToolbar.tsx',
    'components/driving-dynamics-modernization/GForcePanel.tsx',
    'components/driving-dynamics-modernization/LiveMotorStatus.tsx',
    'components/driving-dynamics-modernization/MotorHistoryCharts.tsx',
    'components/driving-dynamics-modernization/PedalUsage.tsx',
    'components/driving-dynamics-modernization/PowertrainSummary.tsx',
    'components/driving-dynamics-modernization/RideOverview.tsx',
    'components/driving-dynamics-modernization/SpeedGearPanel.tsx',
    'components/driving-dynamics/DrivingCoachSection.tsx',
    'components/driving-dynamics/GrokDynamicsBriefing.tsx',
    'components/operationalbrief-a-m/MotorSamplesBrief.tsx',
    'pages/DrivingDynamicsPage.tsx',
  ])('%s uses only the public layout category boundary', (file) => {
    const source = readFileSync(`src/features/driving/${file}`, 'utf8');
    expect(source).not.toMatch(/from\s+['"]@\/components\/layout\//);
    if (file.includes('driving-dynamics-modernization') || file.startsWith('pages/')) {
      expect(source).toMatch(/from\s+['"]@\/components\/layout['"]/);
    }
  });
});

// i18n stub: echo the fallback string so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') return fallbackOrOpts;
      if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
        if ('defaultValue' in fallbackOrOpts && typeof fallbackOrOpts.defaultValue === 'string') {
          return fallbackOrOpts.defaultValue;
        }
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
const unitState = vi.hoisted((): { length: 'km' | 'mi'; temp: 'C' | 'F' } => ({
  length: 'km',
  temp: 'C',
}));
const presenterState = vi.hoisted(() => ({ failed: new Set<string>() }));

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

// The SSE→cache bridge opens a real EventSource, which jsdom does not
// implement. Mocked at the boundary so the wiring (which query keys are bound
// to which Tesla signal fields) can be asserted without a live stream.
vi.mock('@/hooks/useSignalQueryInvalidation', () => ({
  useSignalQueryInvalidation: vi.fn(),
}));
vi.mock('@/lib/errorReporter', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/errorReporter')>();
  return { ...actual, reportFrontendError: vi.fn() };
});

vi.mock('@/components/forms', async (importActual) => {
  const actual = await importActual<typeof import('@/components/forms')>();
  return {
    ...actual,
    RangePicker: (p: {
      value: { start: string; end: string };
      onChange: (range: { start: string; end: string }) => void;
    }) => (
      <div>
        <span data-testid="range-start">{p.value.start}</span>
        <span data-testid="range-end">{p.value.end}</span>
        <Button
          type="button"
          data-testid="widen-range"
          onClick={() => p.onChange({ start: '2000-01-01', end: '2999-12-31' })}
        >
          widen
        </Button>
      </div>
    ),
  };
});

type ModernPanels = typeof import('../components/driving-dynamics-modernization');
vi.mock('../components/operationalbrief-a-m/MotorSamplesBrief', async () => ({
  MotorSamplesBrief: (await import('../components/driving-dynamics-modernization')).SummaryStats,
}));

// Orchestration doubles follow the actual split barrels. Unit cases additionally
// mount the real stat presenters below, because they now own useUnits().
vi.mock('../components/driving-dynamics-modernization', () => ({
  DynamicsPlacement: ({ children }: { children: ReactNode }) => <>{children}</>,
  LiveSourceWarnings: () => null,
  RideOverview: (p: ComponentProps<ModernPanels['RideOverview']>) => (
    <div data-testid="ride-overview">{p.drive?.id ?? 'none'}</div>
  ),
  PowertrainSummary: (p: ComponentProps<ModernPanels['PowertrainSummary']>) => {
    if (presenterState.failed.has('powertrain-summary')) throw new Error('Synthetic powertrain render failure');
    return (
      <div data-testid="powertrain-summary">
        <span data-testid="history-window">{JSON.stringify(p.historyQuery)}</span>
      </div>
    );
  },
  SummaryStats: (p: ComponentProps<ModernPanels['SummaryStats']>) => (
    <div data-testid="summary"><span data-testid="summary-vid">{String(p.vehicleId)}</span></div>
  ),
  LiveMotorStatus: (p: ComponentProps<ModernPanels['LiveMotorStatus']>) => (
    <div data-testid="live-motor">
      <span data-testid="live-vid">{String(p.vehicleId)}</span>
      <span data-testid="live-temp">{p.toTemperatureDisplay(100)}</span>
      <span data-testid="live-tunit">{p.tempUnit}</span>
    </div>
  ),
  PedalUsage: (p: ComponentProps<ModernPanels['PedalUsage']>) => {
    if (presenterState.failed.has('pedal')) throw new Error('Synthetic pedal render failure');
    return <div data-testid="pedal">{String(p.vehicleId)}</div>;
  },
  GForcePanel: (p: ComponentProps<ModernPanels['GForcePanel']>) => <div data-testid="gforce">{String(p.vehicleId)}</div>,
  SpeedGearPanel: (p: ComponentProps<ModernPanels['SpeedGearPanel']>) => (
    <div data-testid="speed-gear">
      <span data-testid="sg-vid">{String(p.vehicleId)}</span>
      <span data-testid="sg-count">{p.filteredDrives.length}</span>
    </div>
  ),
  MotorHistoryCharts: (p: ComponentProps<ModernPanels['MotorHistoryCharts']>) => {
    if (presenterState.failed.has('motor-history')) throw new Error('Synthetic history render failure');
    return <div data-testid="motor-history"><span data-testid="mh-vid">{String(p.vehicleId)}</span></div>;
  },
  DrivingTips: (p: ComponentProps<ModernPanels['DrivingTips']>) => (
    <div data-testid="tips"><span data-testid="tips-vid">{String(p.vehicleId)}</span></div>
  ),
  DynamicsTripToolbar: (p: ComponentProps<ModernPanels['DynamicsTripToolbar']>) => (
    <div data-testid="trip-toolbar">
      <span data-testid="tt-count">{p.drives.length}</span>
      <span data-testid="tt-drive">{p.selectedDriveId}</span>
      <span data-testid="tt-start">{p.startDate}</span>
      <span data-testid="tt-end">{p.endDate}</span>
      <Button onClick={() => p.onSelectDrive('2')}>Select second ride</Button>
    </div>
  ),
}));

// Retained complex presenters still import from the original barrel.
type DomainPanels = typeof import('../components/driving-dynamics');
vi.mock('../components/driving-dynamics', () => ({
  AutopilotSection: (p: ComponentProps<DomainPanels['AutopilotSection']>) => <div data-testid="autopilot">{String(p.vehicleId)}</div>,
  MotorEfficiencyInsights: (p: ComponentProps<DomainPanels['MotorEfficiencyInsights']>) => (
    <div data-testid="efficiency">
      <span data-testid="eff-vid">{String(p.vehicleId)}</span>
      <span data-testid="eff-tunit">{p.tempUnit}</span>
    </div>
  ),
  DrivingCoachSection: (p: ComponentProps<DomainPanels['DrivingCoachSection']>) => {
    if (presenterState.failed.has('coach')) throw new Error('Synthetic coach render failure');
    return (
      <div data-testid="coach">
        {String(p.vehicleId)}
        <span data-testid="coach-table-visible">{String(p.showPerDriveScores)}</span>
      </div>
    );
  },
  DriveAnalyticsSection: (p: ComponentProps<DomainPanels['DriveAnalyticsSection']>) => (
    <div data-testid="drive-analytics">
      <span data-testid="da-count">{p.filteredDrives.length}</span>
      <span data-testid="da-dunit">{p.distanceUnit}</span>
      <span data-testid="da-sunit">{p.speedUnit}</span>
      <span data-testid="da-distance">{p.toDistanceDisplay(1000)}</span>
      <span data-testid="da-speed">{p.toSpeedDisplay(10)}</span>
    </div>
  ),
  GrokDynamicsBriefing: (p: ComponentProps<DomainPanels['GrokDynamicsBriefing']>) => (
    <div data-testid="grok-briefing">{String(p.vehicleId)}</div>
  ),
}));

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

import { useMotorLatest, useMotorHistory } from '@/api/hooks/useVehicles';
import { useDrives, useDrivingCoach } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSignalQueryInvalidation } from '@/hooks/useSignalQueryInvalidation';
import DrivingDynamicsPage from './DrivingDynamicsPage';

const mockMotorLatest = vi.mocked(useMotorLatest);
const mockMotorHistory = vi.mocked(useMotorHistory);
const mockDrives = vi.mocked(useDrives);
const mockCoach = vi.mocked(useDrivingCoach);
const mockSelectedVehicle = vi.mocked(useSelectedVehicle);
const mockSignalSync = vi.mocked(useSignalQueryInvalidation);

function qr<T = never>(over: DataStateSource<T> = {}): UseQueryResult<T, Error> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const queryKey = ['dynamics-test-source'];
  const query = client.getQueryCache().build<T, Error>(client, { queryKey });
  query.setState({
    data: over.data,
    error: over.error instanceof Error ? over.error : null,
    status: over.isError ? 'error' : over.data === undefined ? 'pending' : 'success',
    fetchStatus: over.fetchStatus ?? (over.isLoading || over.isFetching ? 'fetching' : 'idle'),
    dataUpdatedAt: over.dataUpdatedAt ?? Date.now(),
  });
  const result = new QueryObserver<T, Error>(client, { queryKey, enabled: false }).getCurrentResult();
  return { ...result, refetch: vi.fn<UseQueryResult<T, Error>['refetch']>().mockResolvedValue(result) };
}

function motorSnap(over: Partial<MotorSnapshot> = {}): MotorSnapshot {
  return {
    ts: '2025-06-15T12:00:00Z',
    created_at: '2025-06-15T12:00:00Z',
    power_kw: 0,
    regen_kw: 0,
    torque_nm_front: null,
    torque_nm_rear: null,
    motor_temp_c_front: null,
    motor_temp_c_rear: null,
    motor_rpm_front: null,
    motor_rpm_rear: null,
    di_torque: null,
    inverter_temp_c: null,
    inverter_temp_rear: null,
    heatsink_temp_front: null,
    heatsink_temp_rear: null,
    motor_current_front: null,
    motor_current_rear: null,
    state_front: null,
    state_rear: null,
    vbat_front: null,
    vbat_rear: null,
    shift_state: 'D',
    ...over,
  };
}

// avg(power_kw) = 100 → getThrottleStyle => 'aggressive'; 2 readings.
const AGGRESSIVE_HISTORY = [
  motorSnap({ power_kw: 90, torque_nm_front: 100, torque_nm_rear: 150, motor_temp_c_front: 40, motor_temp_c_rear: 45, regen_kw: -10 }),
  motorSnap({ power_kw: 110, torque_nm_front: 120, torque_nm_rear: 180, motor_temp_c_front: 60, motor_temp_c_rear: 70, regen_kw: -30 }),
];

function drive(over: Partial<Drive> = {}): Drive {
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
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: null,
    regenEnergyWh: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    endedStatus: null,
    createdAt: '2025-06-01T11:00:00Z',
    updatedAt: '2025-06-01T11:00:00Z',
    score: 80,
    ...over,
  };
}

// One in the default window, one before it, one after it, and one with a
// missing timestamp (exercises the `?? ''` guard — always excluded).
const DRIVES: (Drive | { id: number; startTs: null })[] = [
  drive({ id: 1, startTs: '2025-06-12T10:00:00Z' }), // in window
  drive({ id: 2, startTs: '2025-03-01T10:00:00Z' }), // before window
  drive({ id: 3, startTs: '2025-12-01T10:00:00Z' }), // after window
  { id: 4, startTs: null }, // undated — never in any window
];

function vehicle(id: number, display_name: string): Vehicle {
  return {
    id, vehicle_id: id, display_name, vin: `SYNTHETIC-${id}`, model: '3',
    trim_badging: '', exterior_color: '', wheel_type: '', state: 'unknown', healthy: false,
    created_at: '2025-06-01T00:00:00Z', updated_at: '2025-06-01T00:00:00Z',
  };
}

function installHappyPath() {
  mockSelectedVehicle.mockReturnValue({
    vehicleId: 1,
    vehicle: null,
    vehicles: [
      vehicle(1, 'Car One'),
      vehicle(2, 'Car Two'),
    ],
    setVehicleId: vi.fn(),
  });
  mockMotorLatest.mockReturnValue(
    qr({ data: motorSnap({ shift_state: 'D', power_kw: 42, motor_temp_c_front: 30, motor_temp_c_rear: 35 }) }),
  );
  mockMotorHistory.mockReturnValue(qr({ data: AGGRESSIVE_HISTORY }));
  mockDrives.mockImplementation((_vehicleId, options) => {
    const window = typeof options === 'number' ? undefined : options;
    return qr({
      data: DRIVES.filter((item): item is Drive => item.startTs !== null && (!window?.start ||
        (item.startTs >= window.start && item.startTs < (window.end ?? '9999')))),
    });
  });
  mockCoach.mockReturnValue(qr<DrivingCoachData>({ data: {
    overall_score: 88, efficiency_wh_km: 160, best_efficiency_wh_km: 145,
    total_drives_analyzed: 3, style_breakdown: { efficient: 3 },
    patterns: { hard_accel_pct: 0, hard_brake_pct: 0, highway_pct: 0, short_trip_pct: 0, cold_start_pct: 0 },
    weekly_trend: [], recommendations: [], per_drive_scores: [],
  } }));
}

function HeaderRangeControl() {
  const [, setParams] = useSearchParams();
  return <Button type="button" data-testid="header-widen-range" onClick={() => setParams((params) => {
    const next = new URLSearchParams(params);
    next.set('from', '2000-01-01');
    next.set('to', '2999-12-31');
    return next;
  })}>Widen header range</Button>;
}

function renderPage(route = '/') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <DrivingDynamicsPage />
        <HeaderRangeControl />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const num = (testId: string) => Number(screen.getByTestId(testId).textContent);

async function renderRealUnitPresenters() {
  const { SummaryStats, SpeedGearPanel } = await vi.importActual<ModernPanels>(
    '../components/driving-dynamics-modernization',
  );
  mockMotorHistory.mockReturnValue(qr({ data: [
    motorSnap({ motor_temp_c_front: 100, motor_temp_c_rear: 100 }),
  ] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <section aria-label="Real unit presenters">
          <SummaryStats vehicleId={1} historyQuery={{ enabled: true }} />
          <SpeedGearPanel vehicleId={1} filteredDrives={[
            drive({ avgSpeedMps: 10, maxSpeedMps: 10 }),
          ]} />
        </section>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const region = screen.getByRole('region', { name: 'Real unit presenters' });
  const metric = (label: string) => {
    const tile = within(region).getByText(label).closest('[data-stat], [data-operational-metric]');
    expect(tile).not.toBeNull();
    const value = tile!.querySelector('[data-stat-value], [data-operational-value]');
    const unit = tile!.querySelector('[data-stat-unit]');
    expect(value).not.toBeNull();
    // OperationalBrief renders the real formatted value and unit as one string.
    if (tile!.hasAttribute('data-operational-metric')) {
      const formatted = value!.textContent?.match(/^(-?\d+(?:\.\d+)?)\s*(.+)$/);
      expect(formatted).not.toBeNull();
      return { value: Number(formatted![1]), unit: formatted![2] };
    }
    return { value: Number(value!.textContent), unit: unit?.textContent };
  };
  return metric;
}

beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } }, initAsync: false });
});

beforeEach(() => {
  vi.clearAllMocks();
  presenterState.failed.clear();
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
  it('renders the title, subtitle and all labelled sections without a duplicate picker', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Driving Dynamics' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Understand one ride: energy outcome, powertrain evidence, and the signals behind it.'),
    ).toBeInTheDocument();

    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();

    // Every <section aria-label> becomes an accessible region.
    const regions = screen.getAllByRole('region');
    expect(regions).toHaveLength(4);
    expect(screen.getByRole('region', { name: 'Trip review' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Vehicle now' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Inside this ride' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Beyond this ride' })).toBeInTheDocument();
    expect(screen.getByTestId('coach-table-visible')).toHaveTextContent('false');
    expect(screen.getByTestId('ride-overview')).toBeInTheDocument();
    expect(screen.getByTestId('powertrain-summary')).toBeInTheDocument();
    expect(screen.getByTestId('grok-briefing')).toHaveTextContent('1');
  });

  it('sets the document title via usePageTitle', () => {
    renderPage();
    expect(document.title).toContain('Driving Dynamics');
  });

  it('wires the page-owned data hooks with SI/snake_case-correct arguments', () => {
    renderPage();
    // Only the range and latest drives queries stay at page level. Motor
    // history, current motor state and coaching remain panel-owned.
    expect(mockMotorLatest).not.toHaveBeenCalled();
    expect(mockDrives).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ limit: 1000, refetchInterval: 30000 }),
    );
    expect(mockDrives).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ limit: 5, refetchInterval: 30000 }),
    );
    // History stays in the trip panels (shared drive window), not the page.
    expect(mockMotorHistory).not.toHaveBeenCalled();
    expect(mockCoach).not.toHaveBeenCalled();
  });

  it('hands every panel the vehicle id so each owns its own subscription', () => {
    renderPage();
    for (const id of [
      'summary-vid',
      'live-vid',
      'sg-vid',
      'eff-vid',
      'mh-vid',
      'tips-vid',
    ]) {
      expect(screen.getByTestId(id)).toHaveTextContent('1');
    }
    // DrivingCoachSection takes the string form (its endpoint is a query param).
    expect(screen.getByTestId('coach')).toHaveTextContent('1');
  });
});

describe('DrivingDynamicsPage — live push bridge', () => {
  it('binds the motor / dynamics / cruise signal fields to their query keys', () => {
    renderPage();

    expect(mockSignalSync).toHaveBeenCalled();
    const arg = mockSignalSync.mock.calls.at(-1)?.[0];
    if (!arg) throw new Error('Expected page signal bindings');
    expect(arg.vehicleId).toBe(1);

    const byKey = new Map<string, string[]>(
      arg.bindings.map((b) => [JSON.stringify(b.queryKey), [...b.fields]]),
    );

    // Field names must match the backend projections verbatim — motorMappings
    // in internal/api/motor/handler.go and driveDynamicsMappings in
    // internal/api/drivedyn/handler.go. A typo here silently disables push.
    const motorFields = byKey.get(JSON.stringify(['motor-latest', 1]));
    expect(motorFields).toContain('DiTorqueActualF');
    expect(motorFields).toContain('DiAxleSpeedF');
    expect(motorFields).toContain('DiStatorTempF');
    expect(motorFields).toContain('Gear');

    const dynFields = byKey.get(JSON.stringify(['drive-dynamics-latest', 1]));
    expect(dynFields).toEqual([
      'LateralAcceleration',
      'LongitudinalAcceleration',
      'PedalPosition',
      'BrakePedalPos',
      'BrakePedal',
    ]);
    expect(byKey.get(JSON.stringify(['signal-observations', 1]))).toEqual([
      'CruiseSetSpeed', 'CruiseFollowDistance', 'VehicleSpeed',
    ]);
  });
});

describe('DrivingDynamicsPage — drive date filtering', () => {
  it('uses the explicitly selected ride timestamps and stops completed-trip polling', () => {
    mockDrives.mockReturnValue(qr({ data: [
      drive({ id: 1, startTs: '2025-06-12T10:00:00Z', endTs: '2025-06-12T11:00:00Z' }),
      drive({ id: 2, startTs: '2025-06-13T12:00:00Z', endTs: '2025-06-13T12:30:00Z' }),
    ] }));
    renderPage('/driving/dynamics?drive=1');
    expect(screen.getByTestId('ride-overview')).toHaveTextContent('1');
    expect(JSON.parse(screen.getByTestId('history-window').textContent!)).toEqual({
      start: '2025-06-12T10:00:00Z', end: '2025-06-12T11:00:01.000Z',
      refetchInterval: false, enabled: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Select second ride' }));
    expect(screen.getByTestId('ride-overview')).toHaveTextContent('2');
    expect(JSON.parse(screen.getByTestId('history-window').textContent!).start).toBe('2025-06-13T12:00:00Z');
  });

  it('prefers the in-progress drive only when no explicit trip is requested', () => {
    mockDrives.mockReturnValue(qr({ data: [
      drive({ id: 1 }),
      drive({ id: 2, startTs: '2025-06-15T11:00:00Z', endTs: null }),
    ] }));
    renderPage();
    expect(screen.getByTestId('ride-overview')).toHaveTextContent('2');
    expect(JSON.parse(screen.getByTestId('history-window').textContent!).refetchInterval).toBe(30000);
  });

  it('disables historical motor queries rather than falling back to vehicle-wide history', () => {
    mockDrives.mockReturnValue(qr({ data: [] }));
    renderPage();
    expect(screen.getByTestId('ride-overview')).toHaveTextContent('none');
    expect(JSON.parse(screen.getByTestId('history-window').textContent!)).toEqual({ enabled: false });
    expect(screen.getByRole('region', { name: 'Vehicle now' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Beyond this ride' })).toBeInTheDocument();
  });

  it('does not drop server-scoped trips by comparing UTC dates to local calendar bounds', () => {
    mockDrives.mockReturnValue(qr({ data: [drive({
      id: 1, startTs: '2025-06-16T03:00:00Z', endTs: '2025-06-16T04:00:00Z',
    })] }));
    renderPage('/driving/dynamics?from=2025-06-15&to=2025-06-15');
    expect(screen.getByTestId('tt-drive')).toHaveTextContent('1');
    expect(num('da-count')).toBe(1);
  });
  it('filters drives to the shared URL window', () => {
    renderPage('/driving/dynamics?from=2025-06-09&to=2025-06-15');
    expect(screen.queryByTestId('range-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('range-end')).not.toBeInTheDocument();
    expect(screen.getByTestId('tt-start')).toHaveTextContent('2025-06-09');
    expect(screen.getByTestId('tt-end')).toHaveTextContent('2025-06-15');
    // Only drive #1 (2025-06-12) falls inside; #2 before, #3 after, #4 undated.
    expect(num('da-count')).toBe(1);
    expect(num('sg-count')).toBe(1);
    expect(num('tt-count')).toBe(1);
    expect(screen.getByTestId('tt-drive')).toHaveTextContent('1');
  });

  it('re-filters when the shared header widens the date range', async () => {
    renderPage('/driving/dynamics?from=2025-06-09&to=2025-06-15');
    expect(num('da-count')).toBe(1);

    fireEvent.click(screen.getByTestId('header-widen-range'));

    // Widened to [2000-01-01, 2999-12-31]: the three dated drives now match;
    // the undated drive (#4) is still excluded by the `?? ''` guard.
    await waitFor(() => expect(num('da-count')).toBe(3));
    expect(num('sg-count')).toBe(3);
    expect(num('tt-count')).toBe(3);
    expect(screen.queryByTestId('widen-range')).not.toBeInTheDocument();
  });

  it('passes an empty filtered list when drives have not loaded', () => {
    mockDrives.mockReturnValue(qr({ data: undefined }));
    renderPage();
    expect(num('da-count')).toBe(0);
    expect(num('sg-count')).toBe(0);
  });
});

describe('DrivingDynamicsPage — unit conversion boundary', () => {
  it('threads metric SI→display converters and units to children', async () => {
    renderPage();
    const metric = await renderRealUnitPresenters();
    // km / km/h / °C.
    expect(screen.getByTestId('da-dunit')).toHaveTextContent('km');
    expect(metric('Avg Drive Speed').unit).toBe('km/h');
    expect(metric('Avg Motor Temp').unit).toBe('°C');
    // convertDistanceFromSI(1000, 'km') = 1; convertSpeedFromSI(10, 'km/h') = 36;
    // convertTempFromSI(100, '°C') = 100.
    expect(num('da-distance')).toBe(1);
    expect(metric('Avg Drive Speed').value).toBe(36);
    // Motor history charts carry power/torque/RPM, not a speed converter.
    // Preserve the second speed assertion on the real maximum-speed tile.
    expect(metric('Top Drive Speed').value).toBe(36);
    expect(metric('Avg Motor Temp').value).toBe(100);
    expect(num('live-temp')).toBe(100);
  });

  it('threads imperial converters and units when preferences flip', async () => {
    unitState.length = 'mi';
    unitState.temp = 'F';
    renderPage();
    const metric = await renderRealUnitPresenters();

    expect(screen.getByTestId('da-dunit')).toHaveTextContent('mi');
    expect(metric('Avg Drive Speed').unit).toBe('mph');
    expect(metric('Avg Motor Temp').unit).toBe('°F');
    // convertSpeedFromSI(10, 'mph') ≈ 22.37; convertDistanceFromSI(1000, 'mi') ≈ 0.621;
    // convertTempFromSI(100, '°F') = 212.
    expect(metric('Avg Drive Speed').value).toBeCloseTo(22.37, 2);
    expect(num('da-distance')).toBeCloseTo(0.621, 3);
    expect(metric('Avg Motor Temp').value).toBe(212);
  });
});

describe('DrivingDynamicsPage — no-vehicle state', () => {
  beforeEach(() => {
    mockSelectedVehicle.mockReturnValue({
      vehicleId: null,
      vehicle: null,
      vehicles: [],
      setVehicleId: vi.fn(),
    });
    mockMotorLatest.mockReturnValue(qr({ data: undefined }));
    mockMotorHistory.mockReturnValue(qr({ data: undefined }));
    mockDrives.mockReturnValue(qr({ data: undefined }));
    mockCoach.mockReturnValue(qr({ data: undefined }));
  });

  it('propagates a null vehicleId and disables the data hooks safely', () => {
    renderPage();

    // vehicleId ?? 0 → the live hook receives 0 (its `enabled` gate);
    // the drives list receives undefined.
    expect(mockMotorLatest).not.toHaveBeenCalled();
    expect(mockDrives).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ refetchInterval: 30000 }),
    );

    // The live sub-panels receive the raw null id (they gate internally).
    expect(screen.getByTestId('gforce')).toHaveTextContent('null');
    expect(screen.getByTestId('pedal')).toHaveTextContent('null');
    expect(screen.getByTestId('autopilot')).toHaveTextContent('null');
  });

  it('still renders every section and hides the picker for an empty fleet', () => {
    renderPage();
    // No blank page: all labelled regions remain, filtered list is empty.
    expect(screen.getAllByRole('region')).toHaveLength(4);
    expect(num('da-count')).toBe(0);
    expect(screen.getByTestId('coach')).toHaveTextContent('undefined');
    // The page does not render a local vehicle selector when the fleet is empty.
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).toBeNull();
  });
});

describe('DrivingDynamicsPage — independent source recovery', () => {
  it('keeps all four groups mounted during initial range loading', () => {
    const range = qr<Drive[]>({ isLoading: true, isFetching: true });
    mockDrives.mockImplementation((_vehicleId, options) =>
      typeof options !== 'number' && options?.limit === 1000 ? range : qr({ data: [] }),
    );
    const { container } = renderPage('/driving-dynamics');

    expect(container.querySelector('[data-role="page-container"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByRole('region')).toHaveLength(4);
    expect(screen.getByTestId('ride-overview')).toHaveTextContent('none');
    expect(screen.getByTestId('live-vid')).toHaveTextContent('1');
    expect(screen.getByTestId('coach')).toHaveTextContent('1');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('recovers the failed range source without discarding an independently returned open drive', () => {
    const range = qr<Drive[]>({ error: new Error('Synthetic range failure'), isError: true });
    const latest = qr({ data: [drive({ id: 7, startTs: '2025-06-15T11:00:00Z', endTs: null })] });
    mockDrives.mockImplementation((_vehicleId, options) =>
      typeof options !== 'number' && options?.limit === 1000 ? range : latest,
    );
    renderPage('/driving-dynamics');

    expect(screen.getAllByRole('region')).toHaveLength(4);
    expect(screen.getByTestId('ride-overview')).toHaveTextContent('7');
    expect(screen.getByTestId('tt-count')).toHaveTextContent('1');
    expect(screen.getByTestId('mh-vid')).toHaveTextContent('1');
    expect(screen.getByTestId('live-vid')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(range.refetch).toHaveBeenCalledTimes(1);
    expect(latest.refetch).not.toHaveBeenCalled();
  });

  it('retains the selected completed ride on a failed range refresh and retries only that source', () => {
    const range = qr({
      data: [drive({ id: 1, startTs: '2025-06-12T10:00:00Z', endTs: '2025-06-12T11:00:00Z' })],
      error: new Error('Synthetic retained range failure'), isError: true,
      dataUpdatedAt: Date.parse('2025-06-15T11:00:00Z'),
    });
    const latest = qr({ data: [] });
    mockDrives.mockImplementation((_vehicleId, options) =>
      typeof options !== 'number' && options?.limit === 1000 ? range : latest,
    );
    renderPage('/driving-dynamics?drive=1');

    expect(screen.getByTestId('ride-overview')).toHaveTextContent('1');
    expect(JSON.parse(screen.getByTestId('history-window').textContent!)).toEqual({
      start: '2025-06-12T10:00:00Z', end: '2025-06-12T11:00:01.000Z',
      enabled: true, refetchInterval: false,
    });
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveTextContent('Previously loaded data remains visible while affected sources recover.');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(range.refetch).toHaveBeenCalledTimes(1);
    expect(latest.refetch).not.toHaveBeenCalled();
    expect(screen.getAllByRole('region')).toHaveLength(4);
  });

  it('keeps recorded range evidence and retries only an unavailable current-drive source', () => {
    const range = qr({ data: [drive({ id: 1 })] });
    const latest = qr<Drive[]>({ error: new Error('Synthetic latest failure'), isError: true });
    mockDrives.mockImplementation((_vehicleId, options) =>
      typeof options !== 'number' && options?.limit === 1000 ? range : latest,
    );
    renderPage('/driving-dynamics?drive=1');

    expect(screen.getByTestId('ride-overview')).toHaveTextContent('1');
    expect(screen.getByTestId('da-count')).toHaveTextContent('1');
    expect(screen.getAllByRole('region')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(latest.refetch).toHaveBeenCalledTimes(1);
    expect(range.refetch).not.toHaveBeenCalled();
  });

  it('shows blocked refresh without inventing an offline or fatal source failure', () => {
    const range = qr({ data: [drive()], fetchStatus: 'paused' });
    const latest = qr({ data: [] });
    mockDrives.mockImplementation((_vehicleId, options) =>
      typeof options !== 'number' && options?.limit === 1000 ? range : latest,
    );
    renderPage('/driving-dynamics');

    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.getByTestId('ride-overview')).toHaveTextContent('1');
    expect(screen.getAllByRole('region')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByText(/connection lost|paused offline/i)).not.toBeInTheDocument();
  });

  it.each([
    { case: 'selected powertrain', failed: 'powertrain-summary', region: 'Trip review' },
    { case: 'selected motor history', failed: 'motor-history', region: 'Inside this ride' },
    { case: 'current pedals', failed: 'pedal', region: 'Vehicle now' },
    { case: 'independent coaching', failed: 'coach', region: 'Beyond this ride' },
  ])('isolates and retries $case without removing other sources', ({ failed, region }) => {
    const loggedError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      presenterState.failed.add(failed);
      renderPage('/driving-dynamics?drive=1');

      expect(screen.getAllByRole('region')).toHaveLength(4);
      const affected = screen.getByRole('region', { name: region });
      expect(within(affected).getByText('Component failed to load')).toBeInTheDocument();
      expect(screen.queryByTestId(failed)).not.toBeInTheDocument();
      expect(screen.getByTestId('ride-overview')).toHaveTextContent('1');
      expect(screen.getByTestId('live-vid')).toHaveTextContent('1');
      expect(screen.getByTestId('da-count')).toHaveTextContent('1');
      expect(screen.getByTestId('tips-vid')).toHaveTextContent('1');

      presenterState.failed.delete(failed);
      fireEvent.click(within(affected).getByRole('button', { name: 'Retry' }));
      expect(screen.getByTestId(failed)).toBeInTheDocument();
      expect(within(affected).queryByText('Component failed to load')).not.toBeInTheDocument();
      expect(screen.getByTestId('tt-drive')).toHaveTextContent('1');
    } finally {
      loggedError.mockRestore();
    }
  });
});
