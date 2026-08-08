/**
 * SpeedProfilePage — helper-branch + orchestration coverage.
 *
 * Two surfaces are exercised:
 *
 *   1. The pure, module-private helpers exported for testability:
 *      `bucketAccent` (green/cyan/amber/red bands), `bucketIcon`
 *      (Car/TrendingUp/Gauge), `efficiencyClass` (emerald/amber/rose
 *      thresholds incl. boundaries) and `getEfficiency` (measured-energy
 *      path, battery-delta estimate, zero/null-distance and no-signal
 *      → null). These carry the real branch logic behind the page.
 *
 *   2. The page's OWN behaviour: the KPI band + envelope gauges + the
 *      real `distributionChartData` / `scatterData` / `bucketEfficiency`
 *      derivations (with the genuine `convertSpeedFromSI` SI→display
 *      conversion running for both km/h and mph/mi), plus the
 *      loading / error(+retry) / empty postures for every data source and
 *      the range-picker → `setRange` wiring.
 *
 * Strategy (mirrors ./DrivetrainHealthPage.test.tsx):
 *   - The two data hooks + the vehicle selector + useUnits / useRangeState
 *     are mocked with hoisted vi.fn()s so the network is never touched and
 *     each render is deterministic. The REAL `convertSpeedFromSI` +
 *     `fmtNumber` + `neonColorMap` run, so the conversions/derivations are
 *     genuinely exercised.
 *   - `@/components/charts` is stubbed so the recharts internals (which need
 *     a measured container jsdom can't provide) don't render; the BarChart
 *     and Scatter stubs capture the exact `data` the page computed, and the
 *     LinearGauge stub prints its value+unit for assertions.
 *   - The two toolbar controls are stubbed to plain elements via
 *     React.createElement (keeps jsx-a11y off the mock markup).
 *   - react-i18next resolves the developer fallback string, interpolating
 *     `{{vars}}`.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * page tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { Car, TrendingUp, Gauge } from 'lucide-react';

// jsdom lacks matchMedia; framer-motion (<FadeIn>) + PageContainer read it at
// module load for the reduced-motion preference.
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

// Shared, hoisted test doubles so the mock factories below and the specs can
// both reach them.
const {
  speedProfileMock,
  drivesMock,
  unitsMock,
  selectedVehicleMock,
  rangeStateMock,
  setRangeMock,
  captured,
  UNIT_PREFS_KM,
  UNIT_PREFS_MI,
} = vi.hoisted(() => ({
  speedProfileMock: vi.fn(),
  drivesMock: vi.fn(),
  unitsMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  rangeStateMock: vi.fn(),
  setRangeMock: vi.fn(),
  captured: {} as Record<string, unknown>,
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
  UNIT_PREFS_MI: {
    distance: 'mi',
    speed: 'mph',
    temperature: '°F',
    pressure: 'psi',
    energy: 'kWh',
    duration: 'h',
    power: 'kW',
    locale: 'en-US',
    precision: undefined,
  },
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
  };
});

// Drive the data hooks deterministically without any network.
vi.mock('@/api/hooks/useDriving', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useDriving')>('@/api/hooks/useDriving');
  return {
    ...actual,
    useSpeedProfile: (...args: unknown[]) => speedProfileMock(...args),
    useDrives: (...args: unknown[]) => drivesMock(...args),
  };
});

vi.mock('@/hooks/useUnits', () => ({ useUnits: () => unitsMock() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => selectedVehicleMock() }));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: () => rangeStateMock() }));

// Stub the toolbar controls. RangePicker forwards a fixed range on click so the
// setRange wiring can be asserted. createElement (not JSX) keeps jsx-a11y off.
vi.mock('@/components/forms', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    VehicleSelect: function VehicleSelectStub() {
      return React.createElement('div', { 'data-testid': 'vehicle-select' });
    },
    RangePicker: function RangePickerStub(props: {
      onChange?: (r: { start: string; end: string }) => void;
    }) {
      return React.createElement(
        'button',
        {
          'data-testid': 'range-picker',
          onClick: () => props.onChange?.({ start: '2024-02-01', end: '2024-02-28' }),
        },
        'range',
      );
    },
  };
});

// Stub the chart primitives: recharts needs a measured container jsdom can't
// give it. BarChart + Scatter capture the exact derived `data`; LinearGauge
// prints value+unit; everything else is inert.
vi.mock('@/components/charts', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const Null = () => null;
  const pass = (testid: string) =>
    function Pass({ children }: { children?: ReactNode }) {
      return React.createElement('div', { 'data-testid': testid }, children);
    };
  return {
    ChartTooltip: Null,
    Tooltip: Null,
    XAxis: Null,
    YAxis: Null,
    CartesianGrid: Null,
    Cell: Null,
    ResponsiveContainer: pass('responsive'),
    Bar: pass('bar'),
    ScatterChart: pass('scatter-chart'),
    BarChart: function BarChart({ data, children }: { data?: unknown; children?: ReactNode }) {
      captured.barChartData = data;
      return React.createElement('div', { 'data-testid': 'bar-chart' }, children);
    },
    Scatter: function Scatter({ data, children }: { data?: unknown; children?: ReactNode }) {
      captured.scatterData = data;
      return React.createElement('div', { 'data-testid': 'scatter' }, children);
    },
    LinearGauge: function LinearGauge({
      value,
      label,
      unit,
    }: {
      value: number;
      label: string;
      unit?: string;
    }) {
      return React.createElement('div', { 'data-testid': `gauge-${label}` }, `${value}${unit ?? ''}`);
    },
  };
});

import SpeedProfilePage, {
  bucketAccent,
  bucketIcon,
  efficiencyClass,
  getEfficiency,
} from './SpeedProfilePage';
import type { Drive, SpeedProfileData } from '@/types/driving';

/* ── Fixtures ─────────────────────────────────────────────────────── */

function makeQuery<T>(
  overrides: { data?: T; isLoading?: boolean; error?: unknown; refetch?: () => void } = {},
) {
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

function makeDrive(overrides: Partial<Drive>): Drive {
  return {
    id: 1,
    vehicleId: 42,
    startTs: '2024-06-15T12:00:00Z',
    endTs: '2024-06-15T13:00:00Z',
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
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '2024-06-15T13:00:00Z',
    updatedAt: '2024-06-15T13:00:00Z',
    ...overrides,
  };
}

const PROFILE: SpeedProfileData = {
  distribution: [
    { speedBucket: '0-15', speed_bucket: '0-15', readings: 100 },
    { speedBucket: '30-45', speed_bucket: '30-45', readings: 210 },
    { speedBucket: '60-75', speed_bucket: '60-75', readings: 160 },
    { speedBucket: '90+', speed_bucket: '90+', readings: 30 },
  ],
  avgSpeedMps: 25, // 90 km/h · 56 mph
  peakSpeedMps: 40, // 144 km/h · 89 mph
  optimalSpeedMps: 15, // 54 km/h · 34 mph
};

// D1..D3 produce scatter points; D_NULL (no speed) and D_ZERO (no distance) are
// excluded by the derivation filters.
const D1 = makeDrive({ id: 1, avgSpeedMps: 3, distanceM: 5000, energyUsedWh: 600 }); // 120 Wh/km
const D2 = makeDrive({ id: 2, avgSpeedMps: 10, distanceM: 10000, energyUsedWh: 1500 }); // 150 Wh/km
const D3 = makeDrive({ id: 3, avgSpeedMps: 18, distanceM: 20000, energyUsedWh: 4000 }); // 200 Wh/km
const D_NULL = makeDrive({ id: 4, avgSpeedMps: null, distanceM: 8000, energyUsedWh: 1000 });
const D_ZERO = makeDrive({ id: 5, avgSpeedMps: 5, distanceM: 0, energyUsedWh: 100 });
const DRIVES: Drive[] = [D1, D2, D3, D_NULL, D_ZERO];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SpeedProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(captured)) delete captured[key];

  speedProfileMock.mockReturnValue(makeQuery<SpeedProfileData>({ data: PROFILE }));
  drivesMock.mockReturnValue(makeQuery<Drive[]>({ data: DRIVES }));
  unitsMock.mockReturnValue({ unitPrefs: UNIT_PREFS_KM });
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  rangeStateMock.mockReturnValue({ start: '2015-01-01', end: '2030-12-31', setRange: setRangeMock });
});

/* ── Specs: pure helpers ──────────────────────────────────────────── */

describe('SpeedProfilePage helpers', () => {
  it('bucketAccent maps each speed band to its semantic accent + chart fill', () => {
    expect(bucketAccent('0-15')).toEqual({ neon: 'green', fill: '#10b981' });
    expect(bucketAccent('15-30')).toEqual({ neon: 'green', fill: '#10b981' }); // includes 15
    expect(bucketAccent('30-45')).toEqual({ neon: 'cyan', fill: '#00f0ff' });
    expect(bucketAccent('60-75')).toEqual({ neon: 'amber', fill: '#f59e0b' });
    expect(bucketAccent('90+')).toEqual({ neon: 'red', fill: '#ef4444' });
  });

  it('bucketIcon picks Car / TrendingUp / Gauge per band', () => {
    expect((bucketIcon('0-15') as ReactElement).type).toBe(Car);
    expect((bucketIcon('30-45') as ReactElement).type).toBe(Car); // includes 30
    expect((bucketIcon('60-75') as ReactElement).type).toBe(TrendingUp); // includes 60
    expect((bucketIcon('90+') as ReactElement).type).toBe(TrendingUp); // includes 90
    expect((bucketIcon('45-55') as ReactElement).type).toBe(Gauge); // fallthrough
  });

  it('efficiencyClass applies the Wh-per-km thresholds incl. boundaries', () => {
    expect(efficiencyClass(150)).toBe('text-emerald-300');
    expect(efficiencyClass(159.9)).toBe('text-emerald-300');
    expect(efficiencyClass(160)).toBe('text-amber-300'); // boundary → not < 160
    expect(efficiencyClass(200)).toBe('text-amber-300');
    expect(efficiencyClass(220)).toBe('text-rose-300'); // boundary → not < 220
    expect(efficiencyClass(300)).toBe('text-rose-300');
  });

  it('getEfficiency prefers measured energy, then a battery-delta estimate', () => {
    // Measured-energy path: 1500 Wh / 10 km = 150 Wh/km.
    expect(getEfficiency(makeDrive({ distanceM: 10000, energyUsedWh: 1500 }))).toBe(150);
    // Battery-delta estimate: (10% · 0.75 kWh · 1000) / 10 km = 750 Wh/km.
    expect(
      getEfficiency(
        makeDrive({ distanceM: 10000, energyUsedWh: null, startBatteryPct: 80, endBatteryPct: 70 }),
      ),
    ).toBe(750);
  });

  it('getEfficiency returns null when it cannot compute a value', () => {
    expect(getEfficiency(makeDrive({ distanceM: 0, energyUsedWh: 1500 }))).toBeNull(); // no distance
    expect(
      getEfficiency(makeDrive({ distanceM: null as unknown as number, energyUsedWh: 1500 })),
    ).toBeNull(); // null distance
    expect(
      getEfficiency(
        makeDrive({ distanceM: 10000, energyUsedWh: null, startBatteryPct: 70, endBatteryPct: 70 }),
      ),
    ).toBeNull(); // no energy, no battery drop
  });
});

/* ── Specs: page render / orchestration ───────────────────────────── */

describe('SpeedProfilePage', () => {
  it('renders the header + KPI band with SI→km/h converted values', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Speed Profile' })).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument(); // avg 25 m/s → 90 km/h
    expect(screen.getByText('144')).toBeInTheDocument(); // peak 40 m/s → 144 km/h
    expect(screen.getByText('54')).toBeInTheDocument(); // optimal 15 m/s → 54 km/h
    expect(screen.getByText('500')).toBeInTheDocument(); // total readings
    expect(screen.getByText('5 drives analysed')).toBeInTheDocument();

    // Envelope gauges receive the same converted values.
    expect(screen.getByTestId('gauge-Avg Speed')).toHaveTextContent('90km/h');
    expect(screen.getByTestId('gauge-Peak Speed')).toHaveTextContent('144km/h');
    expect(screen.getByTestId('gauge-Optimal Speed')).toHaveTextContent('54km/h');
  });

  it('feeds the real distribution + scatter derivations to the charts', () => {
    renderPage();

    expect(captured.barChartData).toEqual([
      { range: '0-15', readings: 100 },
      { range: '30-45', readings: 210 },
      { range: '60-75', readings: 160 },
      { range: '90+', readings: 30 },
    ]);

    // D_NULL (no avg speed) + D_ZERO (no distance) are filtered out; the rest
    // carry rounded display speed, display efficiency, and a threshold colour.
    expect(captured.scatterData).toEqual([
      { speed: 11, efficiency: 120, color: '#10b981' },
      { speed: 36, efficiency: 150, color: '#00f0ff' },
      { speed: 65, efficiency: 200, color: '#f59e0b' },
    ]);
  });

  it('renders per-bucket cards with time-share, readings and matched efficiency', () => {
    renderPage();

    for (const range of ['0-15', '30-45', '60-75', '90+']) {
      expect(screen.getByText(range)).toBeInTheDocument();
    }
    expect(screen.getByText('20.0%')).toBeInTheDocument(); // 100 / 500
    expect(screen.getByText('42.0%')).toBeInTheDocument(); // 210 / 500
    expect(screen.getByText('11 km/h')).toBeInTheDocument(); // 0-15 avg drive speed
    expect(screen.getByText('120')).toBeInTheDocument(); // 0-15 efficiency
    expect(screen.getByText('200')).toBeInTheDocument(); // 60-75 efficiency
  });

  it('renders the efficiency insight at the optimal speed', () => {
    renderPage();
    expect(screen.getByText(/Drives around 54 km\/h show the best energy efficiency/)).toBeInTheDocument();
  });

  it('re-converts every figure when unit prefs switch to mph / mi', () => {
    unitsMock.mockReturnValue({ unitPrefs: UNIT_PREFS_MI });
    renderPage();

    expect(screen.getByText('56')).toBeInTheDocument(); // 25 m/s → 56 mph
    expect(screen.getByTestId('gauge-Avg Speed')).toHaveTextContent('56mph');
    // Efficiency unit label flips to Wh/mi (drive→bucket matching is unit-aware,
    // so the exact matched-card count is display-unit dependent — assert ≥1).
    expect(screen.getAllByText('Wh/mi').length).toBeGreaterThanOrEqual(1);
    // Scatter efficiency is Wh/mi (120 · 1.609344 → 193) with its own colour band.
    const scatter = captured.scatterData as { speed: number; efficiency: number; color: string }[];
    expect(scatter[0]).toEqual({ speed: 7, efficiency: 193, color: '#00f0ff' });
  });

  it('surfaces speed-profile query errors with a working retry affordance', () => {
    const refetch = vi.fn();
    speedProfileMock.mockReturnValue(
      makeQuery<SpeedProfileData>({ error: new Error('boom'), refetch }),
    );
    renderPage();

    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(retries[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
    // The chart derivations never ran for the errored profile.
    expect(captured.barChartData).toBeUndefined();
  });

  it('shows empty states for every data source when there is nothing to plot', () => {
    speedProfileMock.mockReturnValue(
      makeQuery<SpeedProfileData>({
        data: { distribution: [], avgSpeedMps: 0, peakSpeedMps: 0, optimalSpeedMps: 0 },
      }),
    );
    drivesMock.mockReturnValue(makeQuery<Drive[]>({ data: [] }));
    renderPage();

    expect(screen.getByText('No speed distribution available yet')).toBeInTheDocument();
    expect(screen.getByText('No speed buckets recorded for this window')).toBeInTheDocument();
    expect(screen.getByText('Not enough drive data for the efficiency scatter yet')).toBeInTheDocument();
    expect(
      screen.getByText('Efficiency insight appears once optimal-speed data is available'),
    ).toBeInTheDocument();
    expect(screen.getByText('0 drives analysed')).toBeInTheDocument();
  });

  it('shows only the page spinner while the initial profile load is in flight', () => {
    speedProfileMock.mockReturnValue(makeQuery<SpeedProfileData>({ isLoading: true }));
    drivesMock.mockReturnValue(makeQuery<Drive[]>({ data: [] }));
    renderPage();

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    // Panels are gated behind the container spinner.
    expect(screen.queryByText('Speed Distribution')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Speed Profile' })).toBeInTheDocument();
  });

  it('wires the range picker onChange straight to setRange', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('range-picker'));
    expect(setRangeMock).toHaveBeenCalledTimes(1);
    expect(setRangeMock).toHaveBeenCalledWith({ start: '2024-02-01', end: '2024-02-28' });
  });
});
