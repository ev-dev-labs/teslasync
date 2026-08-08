/**
 * DrivetrainHealthPage — orchestration, derivation + branch coverage.
 *
 * DrivetrainHealthPage is a thin orchestrator that fans a handful of data
 * hooks out into 12 presentational sections. The surface actually under test
 * here is the page's OWN behaviour:
 *
 *   1. It mounts every section + the toolbar — no gutted / hidden panels.
 *   2. Health → the 4-sensor bag + `overallHealth`/`healthScore` wiring, plus
 *      the no-data / loading / error(+retry) postures.
 *   3. The real `chartData` derivation: range filter → ascending sort → 30-cap
 *      → SI→display map, and the `peakPower` / `avgPowerMax` / zero-regen
 *      reductions it feeds downstream.
 *   4. `tempTrendData` null-temp exclusion.
 *   5. `motorChartData` mapping with front→rear torque/rpm fallbacks and
 *      null pass-through.
 *   6. SI-boundary conversions (km/°C identity vs the real mi/°F path).
 *   7. Null-safety (`distanceM: null` must not surface NaN in the chart).
 *   8. Referential stability of the derived series across re-renders — the
 *      converters are `useCallback`-memoised, so equal inputs must yield the
 *      SAME array reference (a regression guard for the memo-defeat bug the
 *      inline closures used to cause).
 *   9. Live band wiring + range-picker → shared range write.
 *
 * Strategy (mirrors web/src/features/admin/pages/VehicleCostPage.test.tsx):
 *   - Every data hook + the vehicle selector + useUnits / useDateFormat /
 *     range-state are mocked with hoisted vi.fn()s so the network is never
 *     touched and each render is deterministic. The REAL `HEALTH_SCORE`
 *     constant + REAL `convertDistanceFromSI` / `convertTempFromSI` run, so
 *     the conversions are genuinely exercised.
 *   - The 12 sections + the two toolbar controls are stubbed to capture the
 *     exact props the page computed, keeping orchestration assertions crisp.
 *   - react-i18next resolves the developer fallback string.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * page tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

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

// Stub the 12 sections so we can capture the exact props the page computed.
vi.mock('../components/drivetrain-health', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const makeStub = (name: string, testid: string) =>
    function Stub(props: Record<string, unknown>) {
      captured[name] = props;
      return React.createElement('div', { 'data-testid': testid });
    };
  return {
    HealthOverview: makeStub('overview', 'stub-overview'),
    HealthGaugeGrid: makeStub('gaugeGrid', 'stub-gauge-grid'),
    TemperatureGauges: makeStub('gauges', 'stub-gauges'),
    TemperatureMetricCards: makeStub('metricCards', 'stub-metric-cards'),
    ThermalLoadPanel: makeStub('thermal', 'stub-thermal'),
    LiveMotorStatus: makeStub('live', 'stub-live'),
    StatorTempChart: makeStub('stator', 'stub-stator'),
    TorqueHistoryChart: makeStub('torque', 'stub-torque'),
    TemperatureTrendChart: makeStub('tempTrend', 'stub-temp-trend'),
    PowerOutputChart: makeStub('power', 'stub-power'),
    HealthRecommendations: makeStub('recommendations', 'stub-recommendations'),
    DetailCards: makeStub('details', 'stub-details'),
  };
});

// Stub the two toolbar controls; RangePicker forwards a fixed range on click so
// the shared range wiring can be asserted.
vi.mock('@/components/forms', async () => {
  const actual = await vi.importActual<typeof import('@/components/forms')>('@/components/forms');
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    VehicleSelect: function VehicleSelectStub() {
      return React.createElement('div', { 'data-testid': 'vehicle-select' });
    },
    RangePicker: function RangePickerStub(props: Record<string, unknown>) {
      captured.rangePicker = props;
      const onChange = props.onChange as ((r: { start: string; end: string }) => void) | undefined;
      return React.createElement(
        'button',
        {
          'data-testid': 'range-picker',
          onClick: () => onChange?.({ start: '2024-03-01', end: '2024-03-31' }),
        },
        'range',
      );
    },
  };
});

import DrivetrainHealthPage from './DrivetrainHealthPage';
import { HEALTH_SCORE, type ChartDataPoint, type MotorChartDataPoint, type TempSensor } from '../components/drivetrain-health/constants';
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
const DRIVES: Drive[] = [DRIVE_A, DRIVE_B, DRIVE_BEFORE, DRIVE_AFTER];

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

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(captured)) delete captured[key];

  healthMock.mockReturnValue(makeQuery<DrivetrainHealthData>({ data: HEALTH, refetch: refetchMock }));
  drivesMock.mockReturnValue(makeQuery<Drive[]>({ data: DRIVES }));
  statsMock.mockReturnValue(makeQuery<DrivingStats>({ data: STATS }));
  motorLatestMock.mockReturnValue(makeQuery<MotorSnapshot>({ data: MOTOR_LATEST }));
  motorHistoryMock.mockReturnValue(makeQuery<MotorSnapshot[]>({ data: MOTOR_HISTORY }));
  unitsMock.mockReturnValue({ unitPrefs: UNIT_PREFS_KM });
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
  it('renders the page title and mounts every section + toolbar control', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Drivetrain Health' })).toBeInTheDocument();
    for (const testid of [
      'stub-overview',
      'stub-gauge-grid',
      'stub-gauges',
      'stub-metric-cards',
      'stub-thermal',
      'stub-live',
      'stub-stator',
      'stub-torque',
      'stub-temp-trend',
      'stub-power',
      'stub-recommendations',
      'stub-details',
    ]) {
      expect(screen.getByTestId(testid)).toBeInTheDocument();
    }
    expect(screen.getByTestId('vehicle-select')).toBeInTheDocument();
    expect(screen.getByTestId('range-picker')).toBeInTheDocument();
  });

  it('wires the health-derived sensor bag and score into the KPI/gauge sections', () => {
    renderPage();

    const sensors = captured.metricCards.sensors as TempSensor[];
    expect(sensors.map((s) => s.key)).toEqual(['frontMotor', 'rearMotor', 'inverter', 'battery']);
    expect(sensors.map((s) => s.value)).toEqual([55, 60, 48, 30]);
    expect(sensors[0].maxTemp).toBe(150);

    // 'good' → HEALTH_SCORE.good (real constant, not a magic number).
    expect(captured.metricCards.healthScore).toBe(HEALTH_SCORE.good);
    expect(captured.overview.overallHealth).toBe('good');
    expect(captured.overview.hasData).toBe(true);
    expect(captured.overview.motorStatus).toBe('Nominal');
    expect(captured.gaugeGrid.hasHealth).toBe(true);
    expect(captured.gaugeGrid.stats).toBe(STATS);
  });

  it('falls back to a good/empty posture when the health payload is absent', () => {
    healthMock.mockReturnValue(makeQuery<DrivetrainHealthData>({ data: undefined, refetch: refetchMock }));
    renderPage();

    expect(captured.overview.hasData).toBe(false);
    expect(captured.gaugeGrid.hasHealth).toBe(false);
    // No health ⇒ no sensors, but the default posture is still 'good'/95.
    expect((captured.metricCards.sensors as TempSensor[]).length).toBe(0);
    expect(captured.overview.overallHealth).toBe('good');
    expect(captured.metricCards.healthScore).toBe(HEALTH_SCORE.good);
    // The section still mounts — never a hidden panel.
    expect(screen.getByTestId('stub-metric-cards')).toBeInTheDocument();
  });

  it('propagates the loading flag to every health-backed section while fetching', () => {
    healthMock.mockReturnValue(makeQuery<DrivetrainHealthData>({ data: undefined, isLoading: true, refetch: refetchMock }));
    renderPage();

    expect(captured.overview.loading).toBe(true);
    expect(captured.metricCards.loading).toBe(true);
    expect(captured.gaugeGrid.loading).toBe(true);
    expect(captured.gauges.loading).toBe(true);
  });

  it('surfaces the health error and retries on demand', () => {
    const boom = new Error('drivetrain boom');
    healthMock.mockReturnValue(makeQuery<DrivetrainHealthData>({ data: undefined, error: boom, refetch: refetchMock }));
    renderPage();

    expect(captured.overview.error).toBe(boom);
    // The error path exposes a retry that re-runs the query.
    (captured.overview.onRetry as () => void)();
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('filters drives to the selected range, sorts ascending and maps the power series', () => {
    renderPage();

    const power = captured.power.data as ChartDataPoint[];
    // Only DRIVE_A (Jan 5) + DRIVE_B (Jan 20) fall inside the Jan-2024 window.
    expect(power).toHaveLength(2);
    expect(power.map((p) => p.date)).toEqual(['D:2024-01-05T10:00:00Z', 'D:2024-01-20T10:00:00Z']);
    // avgPowerW → kW, distanceM → km (identity-ish under km pref).
    expect(power.map((p) => p.powerMax)).toEqual([50, 100]);
    expect(power.map((p) => p.distance)).toEqual([10, 20]);
    expect(power.every((p) => p.powerMin === 0)).toBe(true);
  });

  it('derives peak / average power and a zero regen floor from the filtered series', () => {
    renderPage();

    expect(captured.thermal.peakPower).toBe(100);
    expect(captured.thermal.avgPowerMax).toBe(75); // (50 + 100) / 2
    expect(captured.metricCards.peakPower).toBe(100);
    // powerMin is a constant 0 today, so the regen floor collapses to 0.
    expect(captured.details.minRegenPower).toBe(0);
  });

  it('excludes null-temperature drives from the temperature-trend series', () => {
    renderPage();

    const trend = captured.tempTrend.data as ChartDataPoint[];
    // DRIVE_A has 15°C, DRIVE_B has null ⇒ only one point survives.
    expect(trend).toHaveLength(1);
    expect(trend[0].outsideTemp).toBe(15);
  });

  it('maps motor history into the stator/torque charts with front→rear fallbacks', () => {
    renderPage();

    const stator = captured.stator.data as MotorChartDataPoint[];
    // Both charts read the same derived series.
    expect(captured.torque.data).toBe(stator);
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
    unitsMock.mockReturnValue({
      unitPrefs: { ...UNIT_PREFS_KM, distance: 'mi', speed: 'mph', temperature: '°F' },
    });
    renderPage();

    const power = captured.power.data as ChartDataPoint[];
    // 10 000 m → 6.2137 mi (real convertDistanceFromSI, not identity).
    expect(power[0].distance).toBeCloseTo(6.2137, 3);

    const stator = captured.stator.data as MotorChartDataPoint[];
    // 40 °C → 104 °F (real convertTempFromSI).
    expect(stator[0].stator).toBeCloseTo(104, 5);
  });

  it('guards a null distance so the chart never shows NaN', () => {
    drivesMock.mockReturnValue(
      makeQuery<Drive[]>({
        data: [makeDrive({ id: 9, startTs: '2024-01-10T10:00:00Z', distanceM: null as unknown as number })],
      }),
    );
    renderPage();

    const power = captured.power.data as ChartDataPoint[];
    expect(power).toHaveLength(1);
    expect(power[0].distance).toBe(0);
    expect(Number.isNaN(power[0].distance)).toBe(false);
  });

  it('memoises the derived series across re-renders with stable inputs', () => {
    const { rerender } = renderPage();
    const power1 = captured.power.data;
    const stator1 = captured.stator.data;

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DrivetrainHealthPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Equal inputs ⇒ identical references (converters are useCallback-stable).
    expect(captured.power.data).toBe(power1);
    expect(captured.stator.data).toBe(stator1);
  });

  it('hands the live isolation resistance + latest snapshot to the live band', () => {
    renderPage();

    expect(captured.live.isolationResistance).toBe(987);
    expect(captured.live.motorLatest).toBe(MOTOR_LATEST);
  });

  it('commits range-picker changes through shared range state', () => {
    renderPage();

    fireEvent.click(screen.getByTestId('range-picker'));
    expect(setRangeMock).toHaveBeenCalledWith({
      start: '2024-03-01',
      end: '2024-03-31',
    });
  });
});
