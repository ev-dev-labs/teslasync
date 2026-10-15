/**
 * SpeedProfilePage — helper-branch + orchestration coverage.
 *
 * Two surfaces are exercised:
 *
 *   1. The pure, module-private helpers exported for testability:
 *      `bucketAccent` (green/cyan/amber/red bands), `bucketIcon`
 *      (Car/TrendingUp/Gauge), `efficiencyClass` (emerald/amber/rose
 *      thresholds incl. boundaries) and `getEfficiency` (measured-energy
 *      path, missing-energy exclusion, zero/null-distance and no-signal
 *      → null). These carry the real branch logic behind the page.
 *
 *   2. The page's OWN behaviour: the KPI band + envelope gauges + the
 *      real `distributionChartData` / `scatterData` / `bucketEfficiency`
 *      derivations (with the genuine `convertSpeedFromSI` SI→display
 *      conversion running for both km/h and mph/mi), plus the
 *      loading / error(+retry) / empty postures for every data source and
 *      header-owned range query wiring without a duplicate picker.
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
 *   - react-i18next resolves the developer fallback string, interpolating
 *     `{{vars}}`.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * page tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { cloneElement } from 'react';
import type { ChartTooltipProps } from '@/components/charts/ChartTooltip';
import { convertSpeedFromSI, convertEfficiencyFromSI } from '@/lib/unitConversion';
import { fmtNumber, setGlobalLocale } from '@/lib/numberFormat';
import { calendarRangeToInstants } from '@/lib/dateRange';
import { getChartFontFamily, getChartFontSize } from '@/lib/chartTypography';
import { axisTick } from '@/components/charts/chartUtils';
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
  dateFormatMock,
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
  dateFormatMock: vi.fn(),
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
    useDriveCalendarHistory: (...args: unknown[]) => drivesMock(...args),
  };
});

vi.mock('@/hooks/useUnits', () => ({ useUnits: () => unitsMock() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => selectedVehicleMock() }));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: (...args: unknown[]) => rangeStateMock(...args) }));
vi.mock('@/hooks/useDateFormat', async (importOriginal) => {
  // wrapped-real-hook: keep every real formatter, override only what this file controls.
  const actual = await importOriginal<typeof import('@/hooks/useDateFormat')>();
  const overrides = await (() => ({ useDateFormat: () => dateFormatMock() }))();
  return {
    ...actual,
    ...overrides,
    useDateFormat: (...args: Parameters<typeof actual.useDateFormat>) => ({
      ...actual.useDateFormat(...args),
      ...overrides.useDateFormat(...args),
    }),
  };
});

// Stub the chart primitives: recharts needs a measured container jsdom can't
// give it. BarChart + Scatter capture the exact derived `data`; LinearGauge
// prints value+unit; everything else is inert.
vi.mock('@/components/charts', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  const { ChartTooltip } = await import('@/components/charts/ChartTooltip');
  const { axisTick } = await import('@/components/charts/chartUtils');
  const Null = () => null;
  const pass = (testid: string) =>
    function Pass({ children }: { children?: ReactNode }) {
      return React.createElement('div', { 'data-testid': testid }, children);
    };
  return {
    ...chartTestDoubles,
    axisTick,
    EmbeddedChart: function EmbeddedChart({ title, ariaLabel, data, dataColumns, children }: { title: string; ariaLabel?: string; data?: unknown; dataColumns?: unknown; children?: ReactNode }) {
      captured[title] = { data, dataColumns };
      captured[`${title}-aria`] = ariaLabel;
      return React.createElement('div', { 'data-testid': `embedded-${title}` }, children);
    },
    ChartTooltip,
    Tooltip: function Tooltip({ content }: { content?: ReactElement<ChartTooltipProps> }) {
      captured.tooltip = content;
      return null;
    },
    XAxis: function XAxis(props: { dataKey?: string; tickFormatter?: (value: number) => string; tick?: unknown }) {
      captured[`axis-${props.dataKey}`] = props.tickFormatter;
      captured[`x-tick-${props.dataKey}`] = props.tick;
      return null;
    },
    YAxis: function YAxis(props: { dataKey?: string; tickFormatter?: (value: number) => string; tick?: unknown }) {
      captured[`axis-${props.dataKey}`] = props.tickFormatter;
      captured[`y-tick-${props.dataKey}`] = props.tick;
      return null;
    },
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
      value: number | null;
      label: string;
      unit?: string;
    }) {
      return React.createElement('div', {
        'data-testid': `gauge-${label}`, 'data-reading': value == null ? 'missing' : String(value),
      }, value == null ? '—' : `${value}${unit ?? ''}`);
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
  overrides: {
    data?: T; isLoading?: boolean; isFetching?: boolean;
    fetchStatus?: 'fetching' | 'paused' | 'idle';
    error?: unknown; refetch?: () => void;
  } = {},
) {
  return {
    data: overrides.data,
    isLoading: overrides.isLoading ?? false,
    isFetching: overrides.isFetching ?? overrides.isLoading ?? false,
    fetchStatus: overrides.fetchStatus ?? (overrides.isLoading ? 'fetching' : 'idle'),
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
  const element = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SpeedProfilePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(element());
  return { ...view, rerenderPage: () => view.rerender(element()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(captured)) delete captured[key];

  speedProfileMock.mockReturnValue(makeQuery<SpeedProfileData>({ data: PROFILE }));
  drivesMock.mockReturnValue(makeQuery<Drive[]>({ data: DRIVES }));
  unitsMock.mockReturnValue({ unitPrefs: UNIT_PREFS_KM });
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  setGlobalLocale('en-US');
  dateFormatMock.mockReturnValue({ tz: 'UTC', locale: 'en-US' });
  rangeStateMock.mockReturnValue({
    start: '2015-01-01', end: '2030-12-31',
    startInstant: '2015-01-01T00:00:00.000Z',
    endInstantExclusive: '2031-01-01T00:00:00.000Z',
    timezone: 'UTC', setRange: setRangeMock,
  });
});

/* ── Specs: pure helpers ──────────────────────────────────────────── */

describe('SpeedProfilePage helpers', () => {
  it('bucketAccent maps each speed band to its semantic accent + chart fill', () => {
    expect(bucketAccent('0-15')).toEqual({ neon: 'green', fill: 'var(--semantic-success)' });
    expect(bucketAccent('15-30')).toEqual({ neon: 'green', fill: 'var(--semantic-success)' }); // includes 15
    expect(bucketAccent('30-45')).toEqual({ neon: 'cyan', fill: 'var(--semantic-info)' });
    expect(bucketAccent('60-75')).toEqual({ neon: 'amber', fill: 'var(--semantic-warning)' });
    expect(bucketAccent('90+')).toEqual({ neon: 'red', fill: 'var(--semantic-danger)' });
  });

  it('bucketIcon picks Car / TrendingUp / Gauge per band', () => {
    expect((bucketIcon('0-15') as ReactElement).type).toBe(Car);
    expect((bucketIcon('30-45') as ReactElement).type).toBe(Car); // includes 30
    expect((bucketIcon('60-75') as ReactElement).type).toBe(TrendingUp); // includes 60
    expect((bucketIcon('90+') as ReactElement).type).toBe(TrendingUp); // includes 90
    expect((bucketIcon('45-55') as ReactElement).type).toBe(Gauge); // fallthrough
  });

  it('efficiencyClass applies the Wh-per-km thresholds incl. boundaries', () => {
    expect(efficiencyClass(150)).toBe('text-[var(--semantic-success)]');
    expect(efficiencyClass(159.9)).toBe('text-[var(--semantic-success)]');
    expect(efficiencyClass(160)).toBe('text-[var(--semantic-warning)]'); // boundary → not < 160
    expect(efficiencyClass(200)).toBe('text-[var(--semantic-warning)]');
    expect(efficiencyClass(220)).toBe('text-[var(--semantic-danger)]'); // boundary → not < 220
    expect(efficiencyClass(300)).toBe('text-[var(--semantic-danger)]');
  });

  it('getEfficiency uses measured energy and never fabricates a battery estimate', () => {
    expect(getEfficiency(makeDrive({ distanceM: 10000, energyUsedWh: 1500 }))).toBe(150);
    expect(
      getEfficiency(
        makeDrive({ distanceM: 10000, energyUsedWh: null, startBatteryPct: 80, endBatteryPct: 70 }),
      ),
    ).toBeNull();
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
  it('uses shared scalable typography on every axis without rewriting saved font preferences', () => {
    const root = document.documentElement;
    const originalStyle = root.getAttribute('style');
    const savedScale = localStorage.getItem('teslasync-font-scale');
    const savedFamily = localStorage.getItem('teslasync-font-family');
    try {
      localStorage.setItem('teslasync-font-scale', '1.35');
      localStorage.setItem('teslasync-font-family', 'atkinson');
      root.style.setProperty('--font-scale', '1.35');
      root.style.setProperty('--font-sans', "'Atkinson Hyperlegible', sans-serif");
      const { rerenderPage } = renderPage();
      const assertTicks = () => {
        for (const key of ['x-tick-range', 'y-tick-undefined', 'x-tick-speed', 'y-tick-efficiency']) {
          expect(captured[key]).toEqual({
            ...axisTick,
            fontSize: getChartFontSize(),
            fontFamily: getChartFontFamily(),
          });
        }
      };
      assertTicks();
      expect(getChartFontSize()).toBe(15);
      expect(getChartFontFamily()).toBe("'Atkinson Hyperlegible', sans-serif");

      root.style.setProperty('--font-scale', '0.85');
      root.style.setProperty('--font-sans', "'Source Sans 3', sans-serif");
      rerenderPage();
      assertTicks();
      expect(getChartFontSize()).toBe(9);
      expect(getChartFontFamily()).toBe("'Source Sans 3', sans-serif");
      expect(localStorage.getItem('teslasync-font-scale')).toBe('1.35');
      expect(localStorage.getItem('teslasync-font-family')).toBe('atkinson');
      expect(captured.barChartData).toHaveLength(4);
      expect(captured.scatterData).toHaveLength(3);
      expect(screen.getByTestId('gauge-Avg Speed')).toHaveTextContent('90km/h');
    } finally {
      if (originalStyle == null) root.removeAttribute('style');
      else root.setAttribute('style', originalStyle);
      if (savedScale == null) localStorage.removeItem('teslasync-font-scale');
      else localStorage.setItem('teslasync-font-scale', savedScale);
      if (savedFamily == null) localStorage.removeItem('teslasync-font-family');
      else localStorage.setItem('teslasync-font-family', savedFamily);
    }
  });

  it('renders the header + KPI band with SI→km/h converted values', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Speed Profile' })).toBeInTheDocument();
    expect(screen.getByText('90.00 km/h')).toBeInTheDocument(); // avg 25 m/s → 90 km/h
    expect(screen.getByText('144.00 km/h')).toBeInTheDocument(); // peak 40 m/s → 144 km/h
    expect(screen.getByText('54.00 km/h')).toBeInTheDocument(); // optimal 15 m/s → 54 km/h
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
    // carry unrounded display speed, display efficiency, and a threshold colour.
    expect(captured.scatterData).toEqual([
      { speed: 10.8, efficiency: 120, color: 'var(--semantic-success)' },
      { speed: 36, efficiency: 150, color: 'var(--semantic-info)' },
      { speed: 64.8, efficiency: 200, color: 'var(--semantic-warning)' },
    ]);
  });

  it('renders per-bucket cards with drive count share, counts and matched efficiency', () => {
    renderPage();

    for (const range of ['0-15', '30-45', '60-75', '90+']) {
      expect(screen.getByText(range)).toBeInTheDocument();
    }
    expect(screen.getByText('20.00%')).toBeInTheDocument(); // 100 / 500
    expect(screen.getByText('42.00%')).toBeInTheDocument(); // 210 / 500
    expect(screen.getByText('10.80 km/h')).toBeInTheDocument(); // 0-15 avg drive speed
    expect(screen.getByText('120.00')).toBeInTheDocument(); // 0-15 efficiency
    expect(screen.getByText('200.00')).toBeInTheDocument(); // 60-75 efficiency
  });

  it('uses the endpoint drive-count population rather than durations or the separate drive query', () => {
    drivesMock.mockReturnValue(makeQuery<Drive[]>({
      data: [
        makeDrive({ id: 1, avgSpeedMps: 3, durationS: 60 }),
        makeDrive({ id: 2, avgSpeedMps: 18, durationS: 36000 }),
      ],
    }));
    renderPage();

    expect(screen.getByText('Eligible drives')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getAllByText('Drive count share')).toHaveLength(4);
    expect(screen.getAllByText('Drive count')).toHaveLength(4);
    expect(screen.getByText('20.00%')).toBeInTheDocument();
    expect(screen.getByText('42.00%')).toBeInTheDocument();
    expect(screen.getByText('32.00%')).toBeInTheDocument();
    expect(screen.getByText('6.00%')).toBeInTheDocument();
    expect(screen.getByText('Each count is one drive with a recorded average speed greater than zero in the selected vehicle and date range. Shares divide each bucket count by the total eligible-drive count, not by driving time or telemetry samples.')).toBeInTheDocument();
    expect(screen.queryByText('Time share')).not.toBeInTheDocument();
    expect(screen.queryByText('Readings')).not.toBeInTheDocument();
    expect(captured['Speed Distribution-aria']).toBe('Eligible-drive counts by average-speed bucket bar chart');
    expect(captured.barChartData).toEqual(PROFILE.distribution?.map(bucket => ({
      range: bucket.speedBucket,
      readings: bucket.readings,
    })));
  });

  it('renders the efficiency insight at the optimal speed', () => {
    renderPage();
    expect(screen.getByText(/Drives around 54\.00 km\/h show the best energy efficiency/)).toBeInTheDocument();
  });

  it('re-converts every figure when unit prefs switch to mph / mi', () => {
    unitsMock.mockReturnValue({ unitPrefs: UNIT_PREFS_MI });
    renderPage();

    expect(screen.getByText('55.92 mph')).toBeInTheDocument(); // 25 m/s → 56 mph
    expect(screen.getByTestId('gauge-Avg Speed')).toHaveTextContent('56mph');
    // Display preferences change the units, not fixed source-band membership.
    expect(screen.getAllByText('Wh/mi').length).toBeGreaterThanOrEqual(1);
    // Scatter efficiency retains the full Wh/mi conversion and source colour.
    const scatter = captured.scatterData as { speed: number; efficiency: number; color: string }[];
    expect(scatter[0]).toEqual({
      speed: convertSpeedFromSI(3, 'mph'),
      efficiency: convertEfficiencyFromSI(120, 'mi'),
      color: 'var(--semantic-success)',
    });
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

  it('keeps the complete report outline and independent drive evidence while the profile loads', () => {
    speedProfileMock.mockReturnValue(makeQuery<SpeedProfileData>({ isLoading: true }));
    renderPage();

    expect(screen.getByText('Speed Distribution')).toBeInTheDocument();
    expect(screen.getByText('Speed Envelope')).toBeInTheDocument();
    expect(screen.getByText('Speed Buckets')).toBeInTheDocument();
    expect(screen.getByText('Efficiency Insight')).toBeInTheDocument();
    expect(captured.scatterData).toHaveLength(3);
    expect(screen.getByRole('heading', { level: 1, name: 'Speed Profile' })).toBeInTheDocument();
  });

  it.each(['profile', 'drives'] as const)('keeps unresolved %s evidence initial, then paused, then authoritatively empty and recovered', source => {
    const mock = source === 'profile' ? speedProfileMock : drivesMock;
    const refetch = vi.fn();
    const emptyProfile = { distribution: [], avgSpeedMps: 0, peakSpeedMps: 0, optimalSpeedMps: 0 };
    const emptyMessage = source === 'profile'
      ? 'No speed distribution available yet'
      : 'Not enough drive data for the efficiency scatter yet';
    const expectOutline = () => {
      for (const title of ['Speed Distribution', 'Speed Envelope', 'Speed Buckets', 'Efficiency vs Speed', 'Efficiency Insight']) {
        expect(screen.getByText(title)).toBeInTheDocument();
      }
    };
    mock.mockReturnValue(makeQuery({ refetch }));
    const view = renderPage();
    expectOutline();
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
    expect(screen.getAllByText('Loading source').length).toBeGreaterThan(0);
    expect(screen.getByTestId(source === 'profile' ? 'scatter' : 'bar-chart')).toBeInTheDocument();

    mock.mockReturnValue(makeQuery({ fetchStatus: 'paused', refetch }));
    view.rerenderPage();
    expectOutline();
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
    expect(screen.getAllByText('Refresh paused').length).toBeGreaterThan(0);
    expect(screen.getByText('The initial evidence query is paused; no empty result is inferred.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    mock.mockReturnValue(makeQuery({ data: source === 'profile' ? emptyProfile : [] }));
    view.rerenderPage();
    expectOutline();
    expect(screen.getByText(emptyMessage)).toBeInTheDocument();
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    mock.mockReturnValue(makeQuery({ data: source === 'profile' ? PROFILE : DRIVES }));
    view.rerenderPage();
    expectOutline();
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(screen.getByTestId('scatter')).toBeInTheDocument();
  });

  it('prioritizes missing selection over cached evidence without removing section shells, then recovers', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    const view = renderPage();
    for (const title of ['Speed Distribution', 'Speed Envelope', 'Speed Buckets', 'Efficiency vs Speed', 'Efficiency Insight']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Select a vehicle')).toHaveLength(6);
    expect(screen.queryByText('Loading source')).not.toBeInTheDocument();
    expect(screen.queryByText('0 drives analysed')).not.toBeInTheDocument();
    expect(screen.queryByText('Source available')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scatter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gauge-Avg Speed')).not.toBeInTheDocument();
    selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
    view.rerenderPage();
    expect(screen.queryByText('Select a vehicle')).not.toBeInTheDocument();
    expect(screen.getByText('5 drives analysed')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(screen.getByTestId('scatter')).toBeInTheDocument();
  });

  it('labels active profile loading separately from paused-without-data and successful zero evidence', () => {
    const brief = () => within(screen.getByTestId('speed-profile-brief'));
    speedProfileMock.mockReturnValue(makeQuery<SpeedProfileData>({ isLoading: true }));
    const view = renderPage();
    expect(brief().getByText('Loading source')).toBeInTheDocument();
    expect(captured.scatterData).toHaveLength(3);

    speedProfileMock.mockReturnValue(makeQuery<SpeedProfileData>({
      isLoading: true, isFetching: false, fetchStatus: 'paused',
    }));
    view.rerenderPage();
    expect(brief().getByText('Refresh paused')).toBeInTheDocument();
    expect(brief().queryByText('Loading source')).not.toBeInTheDocument();
    expect(brief().queryByText('Source available')).not.toBeInTheDocument();
    expect(screen.queryByText('No speed distribution available yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();

    speedProfileMock.mockReturnValue(makeQuery<SpeedProfileData>({
      data: { distribution: [], avgSpeedMps: 0, peakSpeedMps: 0, optimalSpeedMps: 0 },
    }));
    view.rerenderPage();
    expect(brief().getByText('Source available')).toBeInTheDocument();
    expect(brief().getAllByText('0.00 km/h')).toHaveLength(3);
    expect(brief().getByText('0')).toBeInTheDocument();
    expect(screen.getByText('No speed distribution available yet')).toBeInTheDocument();
    expect(screen.getByTestId('gauge-Avg Speed')).toHaveAttribute('data-reading', '0');
  });

  it.each(['failure', 'paused'] as const)('keeps profile refresh %s trust independent and clears it on recovery', posture => {
    const brief = () => within(screen.getByTestId('speed-profile-brief'));
    const refetch = vi.fn();
    const view = renderPage();
    speedProfileMock.mockReturnValue(makeQuery<SpeedProfileData>({
      data: PROFILE, refetch,
      ...(posture === 'failure' ? { error: new Error('profile refresh') } : { fetchStatus: 'paused' }),
    }));
    view.rerenderPage();
    expect(brief().getByText(posture === 'failure' ? 'Retained source' : 'Refresh paused')).toBeInTheDocument();
    expect(brief().getByText('90.00 km/h')).toBeInTheDocument();
    expect(captured.barChartData).toHaveLength(4);
    expect(captured.scatterData).toHaveLength(3);
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    speedProfileMock.mockReturnValue(makeQuery<SpeedProfileData>({ data: PROFILE }));
    view.rerenderPage();
    expect(brief().getByText('Source available')).toBeInTheDocument();
    expect(brief().queryByText('Retained source')).not.toBeInTheDocument();
    expect(brief().queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('retains both source derivations during refresh failures', () => {
    const bytes = JSON.stringify(PROFILE);
    speedProfileMock.mockReturnValue(makeQuery<SpeedProfileData>({ data: PROFILE, error: new Error('profile refresh') }));
    drivesMock.mockReturnValue(makeQuery<Drive[]>({ data: DRIVES, error: new Error('drive refresh') }));
    renderPage();
    expect(captured.barChartData).toHaveLength(4);
    expect(captured.scatterData).toHaveLength(3);
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(JSON.stringify(PROFILE)).toBe(bytes);
  });

  it('keeps missing and nonfinite speeds distinct from a measured zero at the display boundary', () => {
    speedProfileMock.mockReturnValue(makeQuery({
      data: { ...PROFILE, avgSpeedMps: null, peakSpeedMps: Number.NaN, optimalSpeedMps: 0 },
    }));
    renderPage();
    expect(screen.getByTestId('gauge-Avg Speed')).toHaveAttribute('data-reading', 'missing');
    expect(screen.getByTestId('gauge-Peak Speed')).toHaveAttribute('data-reading', 'missing');
    expect(screen.getByTestId('gauge-Optimal Speed')).toHaveAttribute('data-reading', '0');
  });

  it('sends the header-owned range to the profile query without a local picker', () => {
    const start = '2024-02-01T15:42:19.125Z';
    const end = '2024-02-28T15:42:19.125Z';
    rangeStateMock.mockReturnValue({
      start: '2024-02-01', end: '2024-02-28',
      startInstant: start, endInstantExclusive: end, setRange: setRangeMock,
    });
    renderPage();
    expect(speedProfileMock).toHaveBeenCalledWith('42', start, end);
    expect(drivesMock).toHaveBeenCalledWith('42', start, end);
    expect(rangeStateMock).toHaveBeenCalledWith({ timezone: 'UTC' });
    expect(screen.queryByTestId('range-picker')).not.toBeInTheDocument();
    expect(setRangeMock).not.toHaveBeenCalled();
    expect(screen.getByText('2024-02-01 — 2024-02-28')).toBeInTheDocument();
  });

  it('uses saved locale and timezone with inclusive lower and exclusive DST day boundaries', () => {
    setGlobalLocale('de-DE');
    dateFormatMock.mockReturnValue({ tz: 'America/Los_Angeles', locale: 'de-DE' });
    const range = calendarRangeToInstants({
      startDate: '2024-03-10', endDate: '2024-03-10', timezone: 'America/Los_Angeles',
    });
    rangeStateMock.mockReturnValue({
      start: '2024-03-10', end: '2024-03-10', ...range, timezone: 'America/Los_Angeles',
    });
    drivesMock.mockReturnValue(makeQuery({
      data: [
        makeDrive({ ...D1, id: 1, startTs: '2024-03-10T07:59:59.999Z' }),
        makeDrive({ ...D1, id: 2, startTs: range.startInstant }),
        makeDrive({ ...D2, id: 3, startTs: '2024-03-11T06:59:59.999Z' }),
        makeDrive({ ...D3, id: 4, startTs: range.endInstantExclusive }),
        makeDrive({ ...D1, id: 5, startTs: 'invalid' }),
        makeDrive({ ...D1, id: 6, startTs: '' }),
      ],
    }));
    renderPage();
    expect(rangeStateMock).toHaveBeenCalledWith({ timezone: 'America/Los_Angeles' });
    expect(speedProfileMock).toHaveBeenCalledWith(
      '42', '2024-03-10T08:00:00.000Z', '2024-03-11T07:00:00.000Z',
    );
    expect(captured.scatterData).toHaveLength(2);
    const format = captured['axis-speed'] as (value: number) => string;
    expect(format(12.5)).toContain('12,5');
    setGlobalLocale('en-US');
  });

  it.each([
    { startInstant: 'invalid', endInstantExclusive: '2024-03-11T07:00:00.000Z' },
    { startInstant: undefined, endInstantExclusive: undefined },
  ])('does not show unscoped drive evidence for invalid or missing instants', (range) => {
    rangeStateMock.mockReturnValue({ ...range, timezone: 'UTC' });
    renderPage();
    expect(captured.scatterData ?? []).toEqual([]);
    expect(speedProfileMock).toHaveBeenCalledWith(
      '42', range.startInstant, range.endInstantExclusive,
    );
  });
  it('supplies complete unit-labelled chart alternatives without color-only data', () => {
    renderPage();
    expect(captured['Speed Distribution']).toEqual({
      data: captured.barChartData,
      dataColumns: [
        { key: 'range', label: 'Speed Buckets' },
        { key: 'readings', label: 'Drive count', kind: 'count' },
      ],
    });
    expect(captured['Efficiency vs Speed']).toEqual({
      data: captured.scatterData,
      dataColumns: [
        { key: 'speed', label: 'Speed (km/h)', format: expect.any(Function) },
        { key: 'efficiency', label: 'Wh/km', format: expect.any(Function) },
      ],
    });
  });

  it('keeps physical efficiency color thresholds stable across distance preferences', () => {
    unitsMock.mockReturnValue({ unitPrefs: UNIT_PREFS_MI });
    renderPage();
    expect(captured.scatterData).toEqual([
      { speed: convertSpeedFromSI(3, 'mph'), efficiency: convertEfficiencyFromSI(120, 'mi'), color: 'var(--semantic-success)' },
      { speed: convertSpeedFromSI(10, 'mph'), efficiency: convertEfficiencyFromSI(150, 'mi'), color: 'var(--semantic-info)' },
      { speed: convertSpeedFromSI(18, 'mph'), efficiency: convertEfficiencyFromSI(200, 'mi'), color: 'var(--semantic-warning)' },
    ]);
  });

  it.each([
    ['km/h', 'km', UNIT_PREFS_KM],
    ['mph', 'mi', UNIT_PREFS_MI],
  ] as const)('preserves close fractional points and raw SI evidence with %s preferences', (speed, distance, prefs) => {
    const source = [
      makeDrive({ id: 10, avgSpeedMps: 3.001, distanceM: 1000, energyUsedWh: 120.123 }),
      makeDrive({ id: 11, avgSpeedMps: 3.002, distanceM: 1000, energyUsedWh: 120.124 }),
    ];
    const bytes = JSON.stringify({ profile: PROFILE, drives: source });
    drivesMock.mockReturnValue(makeQuery<Drive[]>({ data: source }));
    unitsMock.mockReturnValue({ unitPrefs: prefs });
    const view = renderPage();
    const assertPoints = (speed: 'km/h' | 'mph', distance: 'km' | 'mi') => {
      expect(captured.scatterData).toEqual(source.map(drive => ({
        speed: convertSpeedFromSI(drive.avgSpeedMps!, speed),
        efficiency: convertEfficiencyFromSI(drive.energyUsedWh!, distance),
        color: 'var(--semantic-success)',
      })));
      expect(JSON.stringify({ profile: PROFILE, drives: source })).toBe(bytes);
    };
    assertPoints(speed, distance);
    const points = captured.scatterData as { speed: number; efficiency: number }[];
    expect(points[0].speed).not.toBe(points[1].speed);
    expect(points[0].efficiency).not.toBe(points[1].efficiency);
    const alternative = captured['Efficiency vs Speed'] as {
      data: unknown;
      dataColumns: { format: (value: number) => string }[];
    };
    expect(alternative.data).toBe(captured.scatterData);
    for (const [index, key] of ['speed', 'efficiency'].entries()) {
      const value = points[0][key as keyof typeof points[0]];
      const formatted = alternative.dataColumns[index].format(value);
      expect(formatted).toBe(fmtNumber(value));
      expect((captured[`axis-${key}`] as (value: number) => string)(value)).toBe(formatted);
    }
    const tooltip = render(cloneElement(captured.tooltip as ReactElement<ChartTooltipProps>, {
      active: true,
      payload: [
        { name: 'Speed', value: points[0].speed, unit: prefs.speed },
        { name: 'Efficiency', value: points[0].efficiency, unit: prefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km' },
      ],
    }));
    expect(within(screen.getByRole('tooltip')).getByText(alternative.dataColumns[0].format(points[0].speed))).toBeInTheDocument();
    expect(within(screen.getByRole('tooltip')).getByText(alternative.dataColumns[1].format(points[0].efficiency))).toBeInTheDocument();
    tooltip.unmount();
    expect(screen.getByTestId('gauge-Avg Speed')).toHaveAttribute(
      'data-reading', String(Math.round(convertSpeedFromSI(PROFILE.avgSpeedMps!, speed))),
    );
    unitsMock.mockReturnValue({ unitPrefs: UNIT_PREFS_MI });
    view.rerenderPage();
    assertPoints('mph', 'mi');
    unitsMock.mockReturnValue({ unitPrefs: UNIT_PREFS_KM });
    view.rerenderPage();
    assertPoints('km/h', 'km');
  });

});


describe('SpeedProfilePage source-unit and insight regressions', () => {
  it.each([
    ['km/h', UNIT_PREFS_KM, '64.80 km/h', '200.00'],
    ['mph', UNIT_PREFS_MI, '40.26 mph', '321.87'],
  ])('matches fixed mph source bands with %s display preferences', (_unit, prefs, speed, efficiency) => {
    unitsMock.mockReturnValue({ unitPrefs: prefs });
    const sourceBytes = JSON.stringify({ profile: PROFILE, drives: DRIVES });
    renderPage();
    const bucket = screen.getByText('30-45').closest('section')!;
    const card = screen.getByText('30-45').closest('dl')?.parentElement
      ?? screen.getByText('30-45').parentElement!.parentElement!;
    expect(within(card).getByText(speed)).toBeInTheDocument();
    expect(within(card).getByText(efficiency)).toBeInTheDocument();
    expect(within(bucket).getByText('Source speed buckets are in mph; averages use your selected units.')).toBeInTheDocument();
    expect(JSON.stringify({ profile: PROFILE, drives: DRIVES })).toBe(sourceBytes);
  });

  describe('SpeedProfilePage bucket drive evidence', () => {
    const card = (range = '0-15') => within(screen.getByText(range).parentElement!.parentElement!);
    const expectLabels = () => {
      expect(card().getByText('Avg Speed')).toBeInTheDocument();
      expect(card().getByText('Wh/km')).toBeInTheDocument();
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
      expect(screen.getByTestId('gauge-Avg Speed')).toHaveTextContent('90km/h');
      expect(screen.getByText(/Drives around 54\.00 km\/h/)).toBeInTheDocument();
    };

    it('keeps both labels with loading only during an active initial drive request', () => {
      drivesMock.mockReturnValue(makeQuery<Drive[]>({ isLoading: true }));
      renderPage();
      expectLabels();
      expect(card().getAllByText('Loading source')).toHaveLength(2);
      expect(card().queryByText('0.00')).not.toBeInTheDocument();
      expect(screen.queryByTestId('scatter')).not.toBeInTheDocument();
    });

    it.each(['paused', 'idle'] as const)('distinguishes deferred and initial %s drives without data', fetchStatus => {
      drivesMock.mockReturnValue(makeQuery<Drive[]>({ fetchStatus }));
      renderPage();
      expectLabels();
      expect(card().getAllByText(fetchStatus === 'paused' ? 'Refresh paused' : 'Loading source')).toHaveLength(2);
      expect(card().queryByText('Unknown')).not.toBeInTheDocument();
      expect(card().queryByText('0.00')).not.toBeInTheDocument();
      expect(screen.queryByText('Not enough drive data for the efficiency scatter yet')).not.toBeInTheDocument();
    });

    it('distinguishes successful empty drives from a bucket with no usable measurements', () => {
      drivesMock.mockReturnValue(makeQuery<Drive[]>({ data: [] }));
      const view = renderPage();
      expectLabels();
      expect(card().getAllByText('Unavailable')).toHaveLength(2);
      expect(screen.getByText('0 drives analysed')).toBeInTheDocument();
      drivesMock.mockReturnValue(makeQuery<Drive[]>({ data: [D_NULL] }));
      view.rerenderPage();
      expect(card().getAllByText('Unknown')).toHaveLength(2);
      expect(card().queryByText('0.00')).not.toBeInTheDocument();
    });

    it('does not infer authoritative no drives from returned rows that miss the exact window', () => {
      rangeStateMock.mockReturnValue({
        start: '2024-03-10', end: '2024-03-11',
        startInstant: '2024-03-10T15:42:19.125Z',
        endInstantExclusive: '2024-03-11T15:42:19.125Z',
      });
      drivesMock.mockReturnValue(makeQuery<Drive[]>({
        data: [makeDrive({ ...D1, startTs: '2024-03-10T15:42:19.124Z' })],
      }));
      const view = renderPage();
      expectLabels();
      expect(drivesMock).toHaveBeenCalledWith(
        '42', '2024-03-10T15:42:19.125Z', '2024-03-11T15:42:19.125Z',
      );
      expect(card().getAllByText('Unknown')).toHaveLength(2);
      expect(card().queryByText('Unavailable')).not.toBeInTheDocument();
      expect(screen.queryByText('0 drives analysed')).not.toBeInTheDocument();
      expect(screen.getByText('Drive sample coverage is unavailable independently of the speed profile.')).toBeInTheDocument();
      expect(screen.queryByTestId('scatter')).not.toBeInTheDocument();
      expect(screen.queryByText('Not enough drive data for the efficiency scatter yet')).not.toBeInTheDocument();

      drivesMock.mockReturnValue(makeQuery<Drive[]>({ data: [] }));
      view.rerenderPage();
      expect(card().getAllByText('Unavailable')).toHaveLength(2);
      expect(screen.getByText('0 drives analysed')).toBeInTheDocument();
      expect(screen.getByText('Not enough drive data for the efficiency scatter yet')).toBeInTheDocument();
    });

    it('renders measured zero speed and efficiency rather than a missing-value status', () => {
      drivesMock.mockReturnValue(makeQuery<Drive[]>({
        data: [makeDrive({ avgSpeedMps: 0, distanceM: 1000, energyUsedWh: 0 })],
      }));
      renderPage();
      expectLabels();
      expect(card().getByText('0.00 km/h')).toBeInTheDocument();
      expect(card().getByText('0.00')).toBeInTheDocument();
      expect(card().queryByText('Unknown')).not.toBeInTheDocument();
      expect(captured.scatterData).toEqual([{ speed: 0, efficiency: 0, color: 'var(--semantic-success)' }]);
    });

    it('keeps nonfinite drive measurements unknown rather than formatting them or inventing zero', () => {
      drivesMock.mockReturnValue(makeQuery<Drive[]>({
        data: [
          makeDrive({ avgSpeedMps: Number.NaN, distanceM: 1000, energyUsedWh: 100 }),
          makeDrive({ avgSpeedMps: 3, distanceM: 1000, energyUsedWh: Number.POSITIVE_INFINITY }),
        ],
      }));
      renderPage();
      expectLabels();
      expect(card().getAllByText('Unknown')).toHaveLength(2);
      expect(screen.queryByTestId('scatter')).not.toBeInTheDocument();
    });

    it('offers drive-local fatal retry and recovers the bucket without losing profile content', () => {
      const refetch = vi.fn();
      drivesMock.mockReturnValue(makeQuery<Drive[]>({ error: new Error('drive failure'), refetch }));
      const view = renderPage();
      expectLabels();
      expect(card().getAllByText('Unavailable')).toHaveLength(2);
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(refetch).toHaveBeenCalledTimes(1);
      drivesMock.mockReturnValue(makeQuery<Drive[]>({ data: DRIVES }));
      view.rerenderPage();
      expectLabels();
      expect(within(screen.getByTestId('speed-profile-brief')).getByText('Source available')).toBeInTheDocument();
      expect(card().getByText('10.80 km/h')).toBeInTheDocument();
      expect(card().getByText('120.00')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });

    it.each(['failure', 'paused'] as const)('retains drive measurements through refresh %s and clears the warning on recovery', posture => {
      const refetch = vi.fn();
      const view = renderPage();
      drivesMock.mockReturnValue(makeQuery<Drive[]>({
        data: DRIVES, refetch,
        ...(posture === 'failure' ? { error: new Error('drive refresh') } : { fetchStatus: 'paused' }),
      }));
      view.rerenderPage();
      expectLabels();
      expect(card().getByText('10.80 km/h')).toBeInTheDocument();
      expect(card().getByText('120.00')).toBeInTheDocument();
      expect(card().getByText('Retained source')).toBeInTheDocument();
      expect(card('90+').getAllByText('Unknown')).toHaveLength(2);
      expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
      fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
      expect(refetch).toHaveBeenCalledTimes(1);
      drivesMock.mockReturnValue(makeQuery<Drive[]>({ data: DRIVES }));
      view.rerenderPage();
      expectLabels();
      expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
      expect(card().queryByText('Retained source')).not.toBeInTheDocument();
      expect(card().getByText('120.00')).toBeInTheDocument();
    });
  });

  it('keeps source-band membership when speed preferences change without changing distance preferences', () => {
    const view = renderPage();
    const card = () => screen.getByText('30-45').parentElement!.parentElement!;
    expect(within(card()).getByText('64.80 km/h')).toBeInTheDocument();
    unitsMock.mockReturnValue({ unitPrefs: { ...UNIT_PREFS_KM, speed: 'mph' } });
    view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><SpeedProfilePage /></MemoryRouter></QueryClientProvider>);
    expect(within(card()).getByText('40.26 mph')).toBeInTheDocument();
    expect(within(card()).getByText('200.00')).toBeInTheDocument();
    expect(captured.barChartData).toEqual(PROFILE.distribution.map(b => ({ range: b.speedBucket, readings: b.readings })));
  });

  it('retains the optimal-speed insight but makes no unmeasured percentage claim', () => {
    renderPage();
    expect(screen.getByText(/Drives around 54\.00 km\/h show the best energy efficiency/)).toBeInTheDocument();
    expect(screen.getByText(/This profile does not quantify efficiency gains from reducing highway speed/)).toBeInTheDocument();
    expect(screen.queryByText(/~15%/)).not.toBeInTheDocument();
  });
});
