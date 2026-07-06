/**
 * TirePressureSection — behaviour + regression coverage.
 *
 * This suite exercises the component and locks in the hardening applied while
 * elevating it:
 *   - the per-wheel min/max summary now folds the range into a single loop
 *     instead of `Math.min(...vals)` / `Math.max(...vals)`, so a
 *     multi-thousand-sample drive no longer risks a RangeError from spreading
 *     the whole array into a function call;
 *   - a missing (`undefined`) `chartData` degrades to empty '—' tiles instead
 *     of throwing on `.map` / `for…of` (matches the sibling PowerProfileChart's
 *     null-safety);
 *   - non-finite (NaN) and non-positive (0) samples are skipped so a bogus
 *     reading never leaks "NaN" into the tile or drags the range to 0;
 *   - the panel respects `stats.hasTirePressure` — when false it shows the
 *     explicit "no telemetry" state rather than a blank/partial panel.
 *
 * Recharts' <ResponsiveContainer> measures 0×0 in jsdom, so the plotted SVG
 * body never renders — assertions target the always-present <ChartContainer>
 * header (role=heading / role=img), the component's own empty state, and the
 * plain-DOM per-wheel summary tiles that sit above the chart figure.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import { ChartTimeRangeProvider } from '@/components/charts';
import { TirePressureSection } from './TirePressureSection';
import type { ChartDataPoint, DriveStats } from './types';

// U+2013 EN DASH separates min–max; U+2014 EM DASH is the "no reading" marker.
const EN_DASH = '\u2013';
const EM_DASH = '\u2014';

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

/** All four corners populated, distinct min/max per wheel (values in `bar`). */
const fullPressure: ChartDataPoint[] = [
  point({ tireFl: 2.8, tireFr: 2.9, tireRl: 3.0, tireRr: 3.1 }),
  point({ tireFl: 2.9, tireFr: 3.0, tireRl: 3.2, tireRr: 3.4 }),
];

function renderSection(
  chartData: ChartDataPoint[] | undefined,
  stats: DriveStats,
  wrap?: (ui: ReactElement) => ReactElement,
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // The `undefined` case intentionally violates the prop type to prove the
  // runtime guard; the cast keeps the rest of the suite type-safe.
  const ui = <TirePressureSection chartData={chartData as ChartDataPoint[]} stats={stats} />;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{wrap ? wrap(ui) : ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TirePressureSection', () => {
  it('always renders the titled, screen-reader-labelled chart figure', () => {
    renderSection(fullPressure, driveStats({ hasTirePressure: true }));
    expect(
      screen.getByRole('heading', { name: 'Tire Pressure During Drive' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: /front and rear tire pressure lines over the drive timeline/i,
      }),
    ).toBeInTheDocument();
  });

  it('shows the "no telemetry" state and hides the tiles when hasTirePressure is false', () => {
    // Even though chartData carries readings, the stats flag gates the panel —
    // the empty branch must win so we never render a half-populated section.
    renderSection(fullPressure, driveStats({ hasTirePressure: false }));
    expect(screen.getByText('No telemetry data available')).toBeInTheDocument();
    expect(screen.queryByText('Front Left')).not.toBeInTheDocument();
    expect(screen.queryByText('Rear Right')).not.toBeInTheDocument();
    // The figure keeps its accessible name even in the empty state.
    expect(
      screen.getByRole('img', {
        name: /front and rear tire pressure lines over the drive timeline/i,
      }),
    ).toBeInTheDocument();
  });

  it('renders all four per-wheel summary tiles when tire pressure is present', () => {
    renderSection(fullPressure, driveStats({ hasTirePressure: true }));
    expect(screen.getByText('Front Left')).toBeInTheDocument();
    expect(screen.getByText('Front Right')).toBeInTheDocument();
    expect(screen.getByText('Rear Left')).toBeInTheDocument();
    expect(screen.getByText('Rear Right')).toBeInTheDocument();
  });

  it('summarises each wheel as a min–max range in the user pressure unit (bar)', () => {
    renderSection(fullPressure, driveStats({ hasTirePressure: true }));
    // fmtNumber renders 2 decimals; the default settings mock uses `bar`.
    expect(screen.getByText(`2.80${EN_DASH}2.90 bar`)).toBeInTheDocument(); // FL
    expect(screen.getByText(`2.90${EN_DASH}3.00 bar`)).toBeInTheDocument(); // FR
    expect(screen.getByText(`3.00${EN_DASH}3.20 bar`)).toBeInTheDocument(); // RL
    expect(screen.getByText(`3.10${EN_DASH}3.40 bar`)).toBeInTheDocument(); // RR
  });

  it('renders an em-dash placeholder for wheels with no positive readings', () => {
    // FL has real data; FR/RL are entirely null; RR only ever reads 0 (present
    // but non-positive) — all three must collapse to the em-dash marker while
    // still rendering their labelled tile (never a hidden section).
    const partial: ChartDataPoint[] = [
      point({ tireFl: 2.8, tireFr: null, tireRl: null, tireRr: 0 }),
      point({ tireFl: 2.9, tireFr: null, tireRl: null, tireRr: 0 }),
    ];
    renderSection(partial, driveStats({ hasTirePressure: true }));
    expect(screen.getByText(`2.80${EN_DASH}2.90 bar`)).toBeInTheDocument();
    expect(screen.getAllByText(EM_DASH)).toHaveLength(3);
    // The zero-only wheel keeps its label even though it has no numeric range.
    expect(screen.getByText('Rear Right')).toBeInTheDocument();
  });

  it('skips non-finite samples so a NaN never leaks into the range', () => {
    const withNaN: ChartDataPoint[] = [
      point({ tireFl: 2.5 }),
      point({ tireFl: Number.NaN }),
      point({ tireFl: 3.5 }),
    ];
    renderSection(withNaN, driveStats({ hasTirePressure: true }));
    // The NaN row is ignored: min = 2.5, max = 3.5.
    expect(screen.getByText(`2.50${EN_DASH}3.50 bar`)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('summarises a very large drive without overflowing the call stack', () => {
    // Regression: `Math.min(...vals)` spread the whole array as call arguments
    // and could throw a RangeError on long drives. The single-pass reducer must
    // handle 20k samples and still produce the correct range.
    const big = Array.from({ length: 20_000 }, () =>
      point({ tireFl: 2.7, tireFr: 2.8, tireRl: 2.9, tireRr: 3.0 }),
    );
    expect(() =>
      renderSection(big, driveStats({ hasTirePressure: true })),
    ).not.toThrow();
    expect(screen.getByText(`2.70${EN_DASH}2.70 bar`)).toBeInTheDocument();
  });

  it('degrades a missing chartData array to empty tiles without throwing', () => {
    // Regression: the component mapped/iterated `chartData` directly, which
    // threw on `undefined`. The `?? []` guard now yields four em-dash tiles.
    expect(() =>
      renderSection(undefined, driveStats({ hasTirePressure: true })),
    ).not.toThrow();
    expect(screen.getAllByText(EM_DASH)).toHaveLength(4);
    expect(screen.getByText('Front Left')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('renders inside a ChartTimeRangeProvider (synced-cursor context) without crashing', () => {
    renderSection(
      fullPressure,
      driveStats({ hasTirePressure: true }),
      (ui) => <ChartTimeRangeProvider syncId="drive-detail">{ui}</ChartTimeRangeProvider>,
    );
    expect(
      screen.getByRole('heading', { name: 'Tire Pressure During Drive' }),
    ).toBeInTheDocument();
    expect(screen.getByText(`2.80${EN_DASH}2.90 bar`)).toBeInTheDocument();
  });
});
