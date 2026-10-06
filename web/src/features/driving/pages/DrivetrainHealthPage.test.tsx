/**
 * DrivetrainHealthPage — orchestration, derivation + branch coverage.
 *
 * DrivetrainHealthPage is a thin orchestrator that fans a handful of data
 * hooks out into aggregate sections. The surface actually under test
 * here is the page's OWN behaviour:
 *
 *   1. It mounts every original section — no gutted / hidden panels.
 *   2. Health → the 4-sensor bag + `overallHealth`/`healthScore` wiring, plus
 *      the no-data / loading / error(+retry) postures.
 *   3. The real `chartData` derivation: range filter → ascending sort → 30-cap
 *      → SI rows, and the `peakPower` / `avgPowerMax` / unknown-regen
 *      reductions it feeds downstream.
 *   4. `tempTrendData` null-temp exclusion.
 *   5. `motorChartData` mapping with front→rear torque/rpm fallbacks and
 *      null pass-through.
 *   6. SI-boundary conversions (km/°C identity vs the real mi/°F path).
 *   7. Null-safety (`distanceM: null` must not surface NaN in the chart).
 *   8. Referential stability of the derived SI series across re-renders —
 *      equal inputs must yield the SAME array reference, even when display
 *      preferences change.
 *   9. Live band wiring + header range filtering without duplicate controls.
 *
 * Strategy (mirrors web/src/features/admin/pages/VehicleCostPage.test.tsx):
 *   - Every data hook + the vehicle selector + useUnits / useDateFormat /
 *     range-state are mocked with hoisted vi.fn()s so the network is never
 *     touched and each render is deterministic. The REAL `HEALTH_SCORE`
 *     constant + REAL SI formatters run at the display boundary, so
 *     the conversions are genuinely exercised.
 *   - Aggregate wrappers capture props but render the real sections. Only
 *     chart frames are stubbed, capturing their formatted table/export data.
 *   - react-i18next resolves the developer fallback string.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * page tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ComponentType, ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (<FadeIn>) + PageContainer's freshness
// chip read it at module load for the reduced-motion preference.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// Shared, hoisted test doubles + stable formatter/pref references so the mock
// factories below and the specs can both reach them, and so equal-input
// re-renders keep identical dependency identities.
const {
  healthMock,
  drivesMock,
  statsMock,
  motorLatestMock,
  motorHistoryMock,
  unitsMock,
  dateFormatMock,
  selectedVehicleMock,
  vehicleLiveMock,
  rangeStateMock,
  refetchMock,
  setRangeMock,
  formatDateShort,
  formatTime,
  UNIT_PREFS_KM,
  captured,
} = vi.hoisted(() => ({
  healthMock: vi.fn(),
  drivesMock: vi.fn(),
  statsMock: vi.fn(),
  motorLatestMock: vi.fn(),
  motorHistoryMock: vi.fn(),
  unitsMock: vi.fn(),
  dateFormatMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  vehicleLiveMock: vi.fn(),
  rangeStateMock: vi.fn(),
  refetchMock: vi.fn(),
  setRangeMock: vi.fn(),
  formatDateShort: (v: unknown) => `D:${String(v)}`,
  formatTime: (v: unknown) => `T:${String(v)}`,
  UNIT_PREFS_KM: {
    distance: 'km',
    speed: 'km/h',
    temperature: '°C',
    pressure: 'bar',
    energy: 'kWh',
    duration: 'h',
    power: 'kW',
    locale: 'en-US',
    precision: undefined,
  },
  captured: {} as Record<string, Record<string, unknown>>,
}));

// i18n → return the developer fallback string, interpolating `{{vars}}`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Drive the data hooks deterministically without any network.
vi.mock('@/api/hooks/useDriving', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useDriving')>('@/api/hooks/useDriving');
  return {
    ...actual,
    useDrivetrainHealth: (...args: unknown[]) => healthMock(...args),
    useDrives: (...args: unknown[]) => drivesMock(...args),
    useDrivingStats: (...args: unknown[]) => statsMock(...args),
  };
});

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>('@/api/hooks/useVehicles');
  return {
    ...actual,
    useMotorLatest: (...args: unknown[]) => motorLatestMock(...args),
    useMotorHistory: (...args: unknown[]) => motorHistoryMock(...args),
  };
});

vi.mock('@/hooks/useUnits', () => ({ useUnits: () => unitsMock() }));
vi.mock('@/hooks/useDateFormat', () => ({ useDateFormat: () => dateFormatMock() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => selectedVehicleMock() }));
vi.mock('@/hooks/useVehicleLive', () => ({ useVehicleLive: (...args: unknown[]) => vehicleLiveMock(...args) }));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: () => rangeStateMock() }));

// Capture the new orchestration seam without reimplementing its presenters.
vi.mock('../components/drivetrain-health-modernization', async () => {
  const actual = await vi.importActual<typeof import('../components/drivetrain-health-modernization')>(
    '../components/drivetrain-health-modernization',
  );
  const React = await vi.importActual<typeof import('react')>('react');
  const capture = <P extends object>(name: string, Component: ComponentType<P>) =>
    function Capture(props: P) {
      captured[name] = props as Record<string, unknown>;
      return React.createElement(Component, props);
    };
  return {
    ...actual,
    HealthSummary: capture('summary', actual.HealthSummary),
    ThermalPanels: capture('thermal', actual.ThermalPanels),
    LiveMotorPanel: capture('live', actual.LiveMotorPanel),
    ChartPanels: capture('charts', actual.ChartPanels),
    HistoryRecords: capture('records', actual.HistoryRecords),
    DetailPanels: capture('details', actual.DetailPanels),
    MethodologyPanel: capture('methodology', actual.MethodologyPanel),
  };
});

vi.mock('../components/drivetrain-health-modernization/PreservedChartFrame', () => ({
  PreservedChartFrame: (props: ComponentProps<typeof import('../components/drivetrain-health-modernization/PreservedChartFrame').PreservedChartFrame>) => {
    captured[props.title] = props as Record<string, unknown>;
    return <section aria-label={props.title}>{props.title}</section>;
  },
}));

vi.mock('../components/operationalbrief-a-m/DrivetrainSummary', async () => {
  const actual = await vi.importActual<typeof import('../components/operationalbrief-a-m/DrivetrainSummary')>('../components/operationalbrief-a-m/DrivetrainSummary');
  const React = await import('react');
  return {
    DrivetrainSummary: (props: ComponentProps<typeof actual.DrivetrainSummary>) => {
      captured.summary = { ...props };
      return React.createElement(actual.DrivetrainSummary, props);
    },
  };
});

import DrivetrainHealthPage from './DrivetrainHealthPage';
import { HEALTH_SCORE } from '../components/drivetrain-health/constants';
import {
  healthScore, healthStatus, type DriveChartRow, type MotorChartRow, type Sensor, type PowerSummary,
} from '../components/drivetrain-health-modernization/model';
import {
  formatDistance, formatTemperature, formatPower, formatEnergy, type UnitPref,
} from '@/lib/unitConversion';
import type { DataState } from '@/api/dataState';
import type { Drive, DrivetrainHealthData, DrivingStats } from '@/types/driving';
import type { MotorSnapshot } from '@/api/types';

/* ── Fixtures ─────────────────────────────────────────────────────── */

function makeQuery<T>(overrides: { data?: T; isLoading?: boolean; error?: unknown; refetch?: () => void } = {}) {
  return {
    data: overrides.data,
    isLoading: overrides.isLoading ?? false,
    isFetching: false,
    isStale: false,
    isError: overrides.error != null,
    error: overrides.error ?? null,
    dataUpdatedAt: Date.now(),
    refetch: overrides.refetch ?? vi.fn(),
  };
}

const HEALTH: DrivetrainHealthData = {
  frontMotorTempC: 55,
  rearMotorTempC: 60,
  inverterTempC: 48,
  batteryTempC: 30,
  motorStatus: 'Nominal',
  overallHealth: 'good',
};

const STATS: DrivingStats = {
  totalDrives: 12,
  totalDistanceKm: 500,
  totalDurationS: 3600,
  avgEfficiencyWhKm: 150,
  avgSpeedKmh: 60,
  topSpeedKmh: 120,
  regenRatio: 0.15,
  regenEnergyWh: 2000,
  co2SavedKg: 30,
};

function makeDrive(overrides: Partial<Drive>): Drive {
  return {
    id: 1,
    vehicleId: 42,
    startTs: '2024-01-05T10:00:00Z',
    endTs: '2024-01-05T11:00:00Z',
    durationS: 3600,
    distanceM: 10000,
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
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: 50000,
    outsideTempAvgC: 15,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '2024-01-05T11:00:00Z',
    updatedAt: '2024-01-05T11:00:00Z',
    ...overrides,
  };
}

// Two drives inside the Jan-2024 window, two clearly outside (Dec + Feb).
// Wide margins keep the local-boundary vs UTC-timestamp comparison TZ-stable.
const DRIVE_A = makeDrive({ id: 1, startTs: '2024-01-05T10:00:00Z', avgPowerW: 50000, outsideTempAvgC: 15, distanceM: 10000 });
const DRIVE_B = makeDrive({ id: 2, startTs: '2024-01-20T10:00:00Z', avgPowerW: 100000, outsideTempAvgC: null, distanceM: 20000 });
const DRIVE_BEFORE = makeDrive({ id: 3, startTs: '2023-12-01T10:00:00Z', avgPowerW: 30000, outsideTempAvgC: 5, distanceM: 5000 });
const DRIVE_AFTER = makeDrive({ id: 4, startTs: '2024-02-15T10:00:00Z', avgPowerW: 40000, outsideTempAvgC: 8, distanceM: 8000 });
const DRIVES: Drive[] = [DRIVE_B, DRIVE_AFTER, DRIVE_A, DRIVE_BEFORE];

function makeMotor(overrides: Partial<MotorSnapshot>): MotorSnapshot {
  return {
    ts: 'm',
    created_at: 'm',
    torque_nm_front: null,
    torque_nm_rear: null,
    di_torque: null,
    motor_rpm_front: null,
    motor_rpm_rear: null,
    motor_temp_c_front: null,
    motor_temp_c_rear: null,
    inverter_temp_c: null,
    inverter_temp_rear: null,
    heatsink_temp_front: null,
    heatsink_temp_rear: null,
    motor_current_front: null,
    motor_current_rear: null,
    state_front: null,
    state_rear: null,
    shift_state: null,
    vbat_front: null,
    ...(overrides as MotorSnapshot),
  };
}

const MOTOR_S1 = makeMotor({
  ts: 'm1',
  motor_temp_c_front: 40,
  motor_temp_c_rear: 42,
  inverter_temp_c: 38,
  torque_nm_front: 100,
  torque_nm_rear: 90,
  motor_rpm_front: 5000,
  motor_rpm_rear: null,
});
const MOTOR_S2 = makeMotor({
  ts: 'm2',
  motor_temp_c_front: null,
  motor_temp_c_rear: null,
  inverter_temp_c: null,
  torque_nm_front: null,
  torque_nm_rear: 80,
  motor_rpm_front: null,
  motor_rpm_rear: 6000,
});
const MOTOR_HISTORY: MotorSnapshot[] = [MOTOR_S1, MOTOR_S2];
const MOTOR_LATEST = makeMotor({ ts: 'latest', motor_temp_c_front: 45 });

const LIVE_STATE = { isolationResistance: 987 };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DrivetrainHealthPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function displayUnits(unitPrefs: UnitPref) {
  return {
    unitPrefs,
    formatDistance: (value: number | null | undefined) => formatDistance(value, unitPrefs),
    formatTemperature: (value: number | null | undefined) => formatTemperature(value, unitPrefs),
    formatPower: (value: number | null | undefined) => formatPower(value, unitPrefs),
    formatEnergy: (value: number | null | undefined) => formatEnergy(value, unitPrefs),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(captured)) delete captured[key];

  healthMock.mockReturnValue(makeQuery<DrivetrainHealthData>({ data: HEALTH, refetch: refetchMock }));
  drivesMock.mockReturnValue(makeQuery<Drive[]>({ data: DRIVES }));
  statsMock.mockReturnValue(makeQuery<DrivingStats>({ data: STATS }));
  motorLatestMock.mockReturnValue(makeQuery<MotorSnapshot>({ data: MOTOR_LATEST }));
  motorHistoryMock.mockReturnValue(makeQuery<MotorSnapshot[]>({ data: MOTOR_HISTORY }));
  unitsMock.mockReturnValue(displayUnits(UNIT_PREFS_KM as UnitPref));
  dateFormatMock.mockReturnValue({ formatTime, formatDateShort });
  selectedVehicleMock.mockReturnValue({ vehicleId: 42, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
  vehicleLiveMock.mockReturnValue({ state: LIVE_STATE, connected: true });
  rangeStateMock.mockReturnValue({
    start: '2024-01-01',
    end: '2024-01-31',
    setRange: setRangeMock,
  });
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('DrivetrainHealthPage', () => {
  it('renders the page title and every section without duplicate toolbar controls', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Drivetrain Health' })).toBeInTheDocument();
    for (const label of [
      'Drivetrain healthy',
      'Health Score',
      'Motor Details',
      'Drive Statistics',
      'Temperature Gauges',
      'Temperature Details',
      'Thermal Load Indicators',
      'Live Motor Status',
      'Stator Temperature History',
      'Motor Torque',
      'Temperature Trend',
      'Power Output History',
      'Health Recommendations',
      'Power Summary',
      'History record details',
      'Health methodology and source limits',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('range-picker')).not.toBeInTheDocument();
  });

  it('wires the health-derived sensor bag and score into the KPI/gauge sections', () => {
    renderPage();

    const sensors = captured.summary.sensors as Sensor[];
    expect(sensors.map((s) => s.key)).toEqual(['frontMotor', 'rearMotor', 'inverter', 'battery']);
    expect(sensors.map((s) => s.value)).toEqual([55, 60, 48, 30]);
    expect(sensors[0].maxTemp).toBe(150);

    // 'good' → HEALTH_SCORE.good (real constant, not a magic number).
    expect(healthScore(captured.summary.health as DrivetrainHealthData)).toBe(HEALTH_SCORE.good);
    expect(healthStatus(captured.summary.health as DrivetrainHealthData)).toBe('good');
    expect((captured.summary.healthState as DataState<unknown>).hasData).toBe(true);
    expect(captured.summary.health).toBe(HEALTH);
    expect(screen.getAllByText('Nominal').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^95(?:\.0+)?%$/).length).toBeGreaterThan(0);
    expect(captured.summary.stats).toBe(STATS);
    expect(captured.thermal.sensors).toBe(sensors);
    expect(captured.details.sensors).toBe(sensors);
  });

  it('keeps the empty health sections mounted without inventing a good assessment', () => {
    healthMock.mockReturnValue(makeQuery<DrivetrainHealthData>({ data: undefined, refetch: refetchMock }));
    renderPage();

    expect((captured.summary.healthState as DataState<unknown>).hasData).toBe(false);
    expect(captured.summary.health).toBeUndefined();
    // The new contract keeps all sensor slots, with unknown readings and score.
    expect((captured.summary.sensors as Sensor[]).map(sensor => sensor.value)).toEqual([null, null, null, null]);
    expect(healthStatus(captured.summary.health as undefined)).toBeNull();
    expect(healthScore(captured.summary.health as undefined)).toBeNull();
    expect(screen.queryByText('Drivetrain healthy')).not.toBeInTheDocument();
    expect(screen.getAllByText('No drivetrain health data available yet').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Temperature Details').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Health Score').length).toBeGreaterThan(0);
  });

  it('propagates the loading flag to every health-backed section while fetching', () => {
    healthMock.mockReturnValue(makeQuery<DrivetrainHealthData>({ data: undefined, isLoading: true, refetch: refetchMock }));
    renderPage();

    expect(captured.summary.healthLoading).toBe(true);
    expect(captured.thermal.loading).toBe(true);
    expect(captured.details.loading).toBe(true);
    expect(screen.getAllByText('Health Score').length).toBeGreaterThan(0);
    expect(screen.getByText('Temperature Gauges')).toBeInTheDocument();
    expect(captured.charts.motorLoading).toBe(false);
    expect(captured.charts.drivesLoading).toBe(false);
  });

  it('surfaces the health error and retries on demand', () => {
    const boom = new Error('drivetrain boom');
    healthMock.mockReturnValue(makeQuery<DrivetrainHealthData>({ data: undefined, error: boom, refetch: refetchMock }));
    renderPage();

    expect((captured.summary.healthState as DataState<unknown>).fatalError).toBe(boom);
    // Exercise the real SourceBoundary retry button, not a fabricated callback.
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('filters drives to the selected range, sorts ascending and maps the power series', () => {
    renderPage();

    const power = captured.charts.driveRows as DriveChartRow[];
    // Only DRIVE_A (Jan 5) + DRIVE_B (Jan 20) fall inside the Jan-2024 window.
    expect(power).toHaveLength(2);
    expect(power.map((p) => p.date)).toEqual(['D:2024-01-05T10:00:00Z', 'D:2024-01-20T10:00:00Z']);
    // Aggregates receive SI; real presenters format only at the boundary.
    expect(power.map((p) => p.powerMax)).toEqual([50000, 100000]);
    expect(power.map((p) => p.distance)).toEqual([10000, 20000]);
    expect(power.every((p) => p.powerMin === null)).toBe(true);
    const display = captured['Power Output History'].data as Record<string, unknown>[];
    expect(display.map(row => row.power_max_kw)).toEqual(['50.00 kW', '100.00 kW']);
    expect(display.map(row => row.power_min_kw)).toEqual(['—', '—']);
    expect(screen.getByText('10.0 km')).toBeInTheDocument();
    expect(screen.getByText('20.0 km')).toBeInTheDocument();
  });

  it('derives peak / average power while keeping the unavailable regen floor unknown', () => {
    renderPage();

    const power = captured.thermal.power as PowerSummary;
    expect(power.peakPower).toBe(100000);
    expect(power.avgPowerMax).toBe(75000);
    expect(captured.summary.power).toBe(power);
    expect(captured.details.power).toBe(power);
    expect(power.minRegenPower).toBeNull();
    expect(screen.getAllByText('75.00 kW').length).toBeGreaterThan(0);
  });

  it('excludes null-temperature drives from the temperature-trend series', () => {
    renderPage();

    const trend = captured['Temperature Trend'].data as Record<string, unknown>[];
    // DRIVE_A has 15°C, DRIVE_B has null ⇒ only one point survives.
    expect(trend).toHaveLength(1);
    expect(trend[0].outsideTemp).toBe('15.0°C');
    expect(trend[0].date).toBe('D:2024-01-05T10:00:00Z');
  });

  it('maps motor history into the stator/torque charts with front→rear fallbacks', () => {
    renderPage();

    const stator = captured.charts.motorRows as MotorChartRow[];
    // Charts and complete record details receive the same derived SI series.
    expect(captured.records.motorRows).toBe(stator);
    expect((captured['Stator Temperature History'].data as unknown[])).toHaveLength(2);
    expect((captured['Motor Torque'].data as unknown[])).toHaveLength(2);
    expect(stator).toHaveLength(2);

    expect(stator[0]).toMatchObject({
      time: 'T:m1',
      stator: 40,
      statorRel: 42,
      statorRer: 38,
      torque: 100, // front present
      axle: 5000, // front rpm present
      speed: null,
    });
    expect(stator[1]).toMatchObject({
      time: 'T:m2',
      stator: null, // front temp null → null (not 0)
      torque: 80, // front null → rear fallback
      axle: 6000, // front rpm null → rear fallback
    });
  });

  it('applies the real imperial conversions for distance and temperature', () => {
    unitsMock.mockReturnValue(displayUnits({
      ...UNIT_PREFS_KM, distance: 'mi', speed: 'mph', temperature: '°F', precision: 4,
    } as UnitPref));
    renderPage();

    const power = captured.charts.driveRows as DriveChartRow[];
    expect(power[0].distance).toBe(10000);
    // Real HistoryRecords formatter: SI remains on wire; display uses miles.
    expect(screen.getByText('6.2137 mi')).toBeInTheDocument();

    const stator = captured['Stator Temperature History'].data as Record<string, unknown>[];
    expect(stator[0].stator).toBe('104.0000°F');
    expect((captured.charts.motorRows as MotorChartRow[])[0].stator).toBe(40);
  });

  it('guards a null distance so the chart never shows NaN', () => {
    drivesMock.mockReturnValue(
      makeQuery<Drive[]>({
        data: [makeDrive({ id: 9, startTs: '2024-01-10T10:00:00Z', distanceM: null as unknown as number })],
      }),
    );
    renderPage();

    const power = captured.charts.driveRows as DriveChartRow[];
    expect(power).toHaveLength(1);
    expect(power[0].distance).toBeNull();
    expect(Number.isNaN(power[0].distance)).toBe(false);
    const records = screen.getByRole('table', { name: 'Included drive records' });
    expect(records).not.toHaveTextContent('NaN');
    expect(within(records).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('memoises the derived series across re-renders with stable inputs', () => {
    const { rerender } = renderPage();
    const power1 = captured.charts.driveRows;
    const stator1 = captured.charts.motorRows;
    const sensors1 = captured.summary.sensors;
    const summary1 = captured.summary.power;

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DrivetrainHealthPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Equal source/range inputs must not reallocate the derived SI rows.
    expect(captured.charts.driveRows).toBe(power1);
    expect(captured.charts.motorRows).toBe(stator1);
    expect(captured.summary.sensors).toBe(sensors1);
    expect(captured.summary.power).toBe(summary1);
  });

  it('hands the live isolation resistance + latest snapshot to the live band', () => {
    renderPage();

    expect(captured.live.isolationResistance).toBe(987);
    expect(captured.live.motorLatest).toBe(MOTOR_LATEST);
  });

  it('filters chart series by the header-owned range', () => {
    rangeStateMock.mockReturnValue({ start: '2024-03-01', end: '2024-03-31', setRange: setRangeMock });
    renderPage();

    expect(captured.charts.driveRows).toEqual([]);
    expect(captured['Temperature Trend'].data).toEqual([]);
    expect(captured['Power Output History'].data).toEqual([]);
    expect(setRangeMock).not.toHaveBeenCalled();
  });

  it('keeps the last 30 chronological drives without mutating source order', () => {
    const chronological = Array.from({ length: 35 }, (_, index) => makeDrive({
      id: index + 1,
      startTs: new Date(Date.UTC(2024, 0, 5, index)).toISOString(),
      avgPowerW: index * 1000,
    }));
    const source = [...chronological].reverse();
    drivesMock.mockReturnValue(makeQuery({ data: source }));
    renderPage();

    const rows = captured.charts.driveRows as DriveChartRow[];
    expect(rows).toHaveLength(30);
    expect(rows.map(row => row.date)).toEqual(chronological.slice(-30).map(drive => formatDateShort(drive.startTs)));
    expect(rows.map(row => row.powerMax)).toEqual(chronological.slice(-30).map(drive => drive.avgPowerW));
    expect(source.map(drive => drive.id)).toEqual(chronological.map(drive => drive.id).reverse());
    expect(captured.records.driveRows).toBe(rows);
  });

  it('preserves vehicle scope, polling and history limits independently of the drive chart range', () => {
    renderPage();

    expect(healthMock).toHaveBeenCalledWith('42');
    expect(drivesMock).toHaveBeenCalledWith('42');
    expect(statsMock).toHaveBeenCalledWith('42');
    expect(motorLatestMock).toHaveBeenCalledWith(42, 5000);
    expect(motorHistoryMock).toHaveBeenCalledWith(42, 200);
    expect(vehicleLiveMock).toHaveBeenCalledWith(42);
    expect(captured.summary.stats).toBe(STATS);
    expect((captured.charts.motorRows as MotorChartRow[]).map(row => row.time)).toEqual(['T:m1', 'T:m2']);
  });

  it.each(['warning', 'critical'] as const)('retains the %s score, status and recommendations', overallHealth => {
    const health = { ...HEALTH, overallHealth };
    healthMock.mockReturnValue(makeQuery({ data: health }));
    const { container } = renderPage();

    expect(captured.summary.health).toBe(health);
    expect(captured.details.health).toBe(health);
    expect(healthScore(health)).toBe(HEALTH_SCORE[overallHealth]);
    expect(screen.getAllByText(overallHealth === 'warning' ? 'Drivetrain running warm' : 'Drivetrain overheating').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-recommendation]').length).toBeGreaterThan(0);
  });

  it('keeps retained health and independent neighbors visible on a refresh failure', () => {
    const boom = new Error('health refresh failed');
    healthMock.mockReturnValue(makeQuery({ data: HEALTH, error: boom, refetch: refetchMock }));
    renderPage();

    const state = captured.summary.healthState as DataState<unknown>;
    expect(state.hasData).toBe(true);
    expect(state.fatalError).toBeNull();
    expect(state.refreshError).toBe(boom);
    expect(screen.getByText('Drivetrain healthy')).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning').length).toBeGreaterThan(0);
    expect(captured.charts.driveRows).toHaveLength(2);
    expect(captured.live.motorLatest).toBe(MOTOR_LATEST);
  });

  it('changes display preferences without reconverting or reallocating SI series', () => {
    const { rerender } = renderPage();
    const driveRows = captured.charts.driveRows;
    const motorRows = captured.charts.motorRows;
    expect(screen.getByText('10.0 km')).toBeInTheDocument();

    unitsMock.mockReturnValue(displayUnits({
      ...UNIT_PREFS_KM, distance: 'mi', speed: 'mph', temperature: '°F', precision: 4,
    } as UnitPref));
    rerender(<QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><DrivetrainHealthPage /></MemoryRouter>
    </QueryClientProvider>);

    expect(captured.charts.driveRows).toBe(driveRows);
    expect(captured.charts.motorRows).toBe(motorRows);
    expect(screen.getByText('6.2137 mi')).toBeInTheDocument();
    expect((captured['Stator Temperature History'].data as Record<string, unknown>[])[0].stator).toBe('104.0000°F');
  });

  it('preserves measured zeros instead of treating them as missing readings or rear fallbacks', () => {
    drivesMock.mockReturnValue(makeQuery({ data: [makeDrive({
      distanceM: 0, avgPowerW: 0, outsideTempAvgC: 0,
    })] }));
    motorHistoryMock.mockReturnValue(makeQuery({ data: [makeMotor({
      torque_nm_front: 0, torque_nm_rear: 80, motor_rpm_front: 0, motor_rpm_rear: 6000,
      motor_temp_c_front: 0,
    })] }));
    renderPage();

    expect((captured.charts.driveRows as DriveChartRow[])[0]).toMatchObject({
      distance: 0, powerMax: 0, outsideTemp: 0, powerMin: null,
    });
    expect((captured.charts.motorRows as MotorChartRow[])[0]).toMatchObject({
      torque: 0, axle: 0, stator: 0,
    });
    expect(captured.summary.power).toEqual({ peakPower: 0, avgPowerMax: 0, minRegenPower: null });
    expect((captured['Temperature Trend'].data as Record<string, unknown>[])[0].outsideTemp).toBe('0.0°C');
  });
});
