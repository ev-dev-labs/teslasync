/**
 * PowerProfileChart — behaviour + regression coverage.
 *
 * Locks in the null-safety fix made while elevating the component: a missing
 * or single-point `chartData` now degrades to the <ChartContainer> empty state
 * instead of throwing on `.length` (it previously read `chartData.length`
 * directly, matching neither the sibling DriveOverviewChart nor the "never a
 * blank/throwing panel" rule).
 *
 * Recharts' <ResponsiveContainer> measures 0×0 in jsdom, so the plotted SVG
 * body never renders — assertions target the always-present <ChartContainer>
 * header (role=heading / role=img), the empty state, and the plain-DOM
 * Max/Regen/Avg stat strip that sits below the chart figure.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import { ChartTimeRangeProvider } from '@/components/charts';
import { PowerProfileChart } from './PowerProfileChart';
import type { ChartDataPoint, DriveStats } from './types';

// Return the English fallback so assertions read naturally. Option objects
// (interpolation) fall through to the key — this component only passes string
// fallbacks for the strings the tests care about.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// <ChartContainer> transitively pulls the annotation query hooks and the chart
// export hook; stub them so the container renders without a live backend.
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
    exporting: false,
  }),
}));
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

function point(partial: Partial<ChartDataPoint> = {}): ChartDataPoint {
  return {
    time: '00:00',
    speed: 0,
    battery: 0,
    elevation: 0,
    power: 0,
    outsideTemp: null,
    insideTemp: null,
    driverTemp: null,
    passengerTemp: null,
    idealRange: null,
    ratedRange: null,
    estRange: null,
    odometer: null,
    soc: null,
    usableSoc: null,
    tireFl: null,
    tireFr: null,
    tireRl: null,
    tireRr: null,
    climateOn: null,
    fanStatus: null,
    ...partial,
  };
}

function driveStats(partial: Partial<DriveStats> = {}): DriveStats {
  return {
    maxSpd: 0,
    avgSpd: 0,
    minSpd: 0,
    powerMax: 0,
    powerMin: 0,
    avgPower: 0,
    energyWh: 0,
    regenWh: 0,
    consumptionWhKm: 0,
    elevGain: 0,
    elevLoss: 0,
    avgOutsideTemp: null,
    avgInsideTemp: null,
    hasAnyTemp: false,
    insideTemps: [],
    outsideTemps: [],
    driverTemps: [],
    passengerTemps: [],
    climateStatus: null,
    avgFanSpeed: null,
    maxFanSpeed: null,
    startRange: null,
    endRange: null,
    odometerStart: 0,
    odometerEnd: 0,
    hasTirePressure: false,
    efficiencyPctPer100: null,
    ...partial,
  };
}

/** Two generic samples — enough for `hasChart` to be true. */
const twoPoints: ChartDataPoint[] = [point(), point()];

function renderChart(
  chartData: ChartDataPoint[] | undefined,
  stats: DriveStats,
  wrap?: (ui: ReactElement) => ReactElement,
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // The `undefined` case intentionally violates the prop type to prove the
  // runtime guard; cast keeps the rest of the suite type-safe.
  const chart = <PowerProfileChart chartData={chartData as ChartDataPoint[]} stats={stats} />;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{wrap ? wrap(chart) : chart}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PowerProfileChart', () => {
  it('always renders the titled, screen-reader-labelled chart figure', () => {
    renderChart(twoPoints, driveStats());
    expect(screen.getByRole('heading', { name: 'Power Profile' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /drive power profile area chart over time/i }),
    ).toBeInTheDocument();
  });

  it('shows the empty state and hides the stat strip when there is no telemetry', () => {
    renderChart([], driveStats({ powerMax: 99, powerMin: -33, avgPower: 40 }));
    expect(screen.getByText('No telemetry data available')).toBeInTheDocument();
    // The Max/Regen/Avg strip is gated behind hasChart, so none of it renders…
    expect(screen.queryByText(/Max Power/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Max Regen/)).not.toBeInTheDocument();
    expect(screen.queryByText('99 kW')).not.toBeInTheDocument();
    // …but the figure keeps its accessible name even in the empty state.
    expect(
      screen.getByRole('img', { name: /drive power profile area chart over time/i }),
    ).toBeInTheDocument();
  });

  it('treats a single sample as not enough to plot', () => {
    renderChart([point({ power: 42 })], driveStats({ powerMax: 42 }));
    expect(screen.getByText('No telemetry data available')).toBeInTheDocument();
    expect(screen.queryByText(/Max Power/)).not.toBeInTheDocument();
  });

  it('degrades a missing chartData array to the empty state without throwing', () => {
    // Regression: the component used to read `chartData.length` directly, which
    // threw on an undefined array instead of showing the empty state.
    expect(() => renderChart(undefined, driveStats({ powerMax: 10 }))).not.toThrow();
    expect(screen.getByText('No telemetry data available')).toBeInTheDocument();
    expect(screen.queryByText(/Max Power/)).not.toBeInTheDocument();
  });

  it('renders max power, max regen and average power with formatted values', () => {
    renderChart(
      twoPoints,
      driveStats({ powerMax: 95.6, powerMin: -45.2, avgPower: 12.34 }),
    );

    // Each label lives in its own <span> (the value is a nested <strong>).
    expect(screen.getByText(/Max Power/)).toBeInTheDocument();
    expect(screen.getByText(/Max Regen/)).toBeInTheDocument();
    expect(screen.getByText(/Avg/)).toBeInTheDocument();

    // Max/Regen are integer-rounded (fmtInt); Avg keeps 2 decimals (fmtNumber).
    expect(screen.getByText('96 kW')).toBeInTheDocument(); // fmtInt(95.6)
    expect(screen.getByText('-45 kW')).toBeInTheDocument(); // fmtInt(-45.2)
    expect(screen.getByText('12.34 kW')).toBeInTheDocument(); // fmtNumber(12.34)
  });

  it('colours max power amber and max regen cyan (charge vs regen semantic)', () => {
    renderChart(
      twoPoints,
      driveStats({ powerMax: 80, powerMin: -20, avgPower: 30 }),
    );
    expect(screen.getByText('80 kW').className).toContain('amber');
    expect(screen.getByText('-20 kW').className).toContain('cyan');
  });

  it('formats non-finite stat values as 0 rather than leaking NaN into the UI', () => {
    renderChart(
      twoPoints,
      driveStats({
        powerMax: Number.NaN,
        powerMin: Number.POSITIVE_INFINITY,
        avgPower: Number.NaN,
      }),
    );
    // safeNumber() collapses NaN / ±Infinity to 0 for both max and regen…
    expect(screen.getAllByText('0 kW')).toHaveLength(2);
    // …and the average keeps its 2-decimal formatting.
    expect(screen.getByText('0.00 kW')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('renders inside a ChartTimeRangeProvider (synced-cursor context) without crashing', () => {
    renderChart(
      twoPoints,
      driveStats({ powerMax: 20, powerMin: 0, avgPower: 15 }),
      (ui) => <ChartTimeRangeProvider syncId="drive-detail">{ui}</ChartTimeRangeProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Power Profile' })).toBeInTheDocument();
    expect(screen.getByText('20 kW')).toBeInTheDocument();
  });
});
