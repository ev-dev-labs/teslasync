/**
 * DriveOverviewChart — behaviour + regression coverage.
 *
 * This file both exercises the component and locks in the fixes made while
 * elevating it:
 *   - the rich Mean/Max/Min legend renders per-series stats in the user's
 *     display unit (chartData is already SI-converted upstream);
 *   - speed `min` now uses `fmtNumber` (decimals) like `mean`/`max` — it used
 *     to fall back to `fmtInt` and dropped the decimals (a copy-paste bug);
 *   - the per-series summariser skips non-finite samples and no longer spreads
 *     the (potentially thousands-of-points) array into `Math.max(...)`, which
 *     could throw a RangeError on long drives;
 *   - the "Mean/Max/Min" labels are i18n-wrapped;
 *   - 0/1 samples degrade to an explicit empty state with no legend.
 *
 * Recharts' <ResponsiveContainer> measures 0×0 in jsdom, so the SVG body never
 * renders — assertions target the always-present <ChartContainer> header, the
 * empty state, and the plain-DOM legend (a sibling of the chart figure).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import { ChartTimeRangeProvider } from '@/components/charts';
import { DriveOverviewChart } from './DriveOverviewChart';
import type { ChartDataPoint } from './types';
import type { DriveDetail } from '@/types/driving';

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

// The component ignores `drive`; a bare cast keeps the props type-safe.
const drive = {} as DriveDetail;

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

function renderChart(
  chartData: ChartDataPoint[],
  wrap?: (ui: ReactElement) => ReactElement,
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const chart = <DriveOverviewChart drive={drive} chartData={chartData} />;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{wrap ? wrap(chart) : chart}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DriveOverviewChart', () => {
  it('always renders the titled, screen-reader-labelled chart figure', () => {
    renderChart([point({ speed: 10 }), point({ speed: 20 })]);
    expect(screen.getByRole('heading', { name: 'Drive overview' })).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: /drive overview composed chart/i }),
    ).toBeInTheDocument();
  });

  it('shows the empty state and hides the legend when there is no telemetry', () => {
    renderChart([]);
    expect(screen.getAllByText('No telemetry data available')).toHaveLength(2);
    // No legend series were computed.
    expect(screen.queryByText('Speed')).not.toBeInTheDocument();
    expect(screen.queryByText(/Mean:/)).not.toBeInTheDocument();
  });

  it('treats a single sample as not enough to plot', () => {
    renderChart([point({ speed: 42, battery: 80 })]);
    expect(screen.getByText('No telemetry data available')).toBeInTheDocument();
    expect(screen.getByText('Speed')).toBeInTheDocument();
  });

  it('renders mean/max/min legend stats in the user unit, with decimals on speed min', () => {
    renderChart([
      point({ speed: 10, battery: 50, power: 5 }),
      point({ speed: 20, battery: 60, power: 15 }),
      point({ speed: 30, battery: 70, power: 25 }),
    ]);

    expect(screen.getByText('Speed')).toBeInTheDocument();
    // mean = (10+20+30)/3 = 20, max = 30, min = 10 — all with 2 decimals + km/h.
    expect(screen.getByText('20.00 km/h')).toBeInTheDocument();
    expect(screen.getByText('30.00 km/h')).toBeInTheDocument();
    // Regression: `min` previously rendered "10 km/h" (fmtInt). It must keep
    // the decimals so it is consistent with mean/max.
    expect(screen.getByText('10.00 km/h')).toBeInTheDocument();

    // SOC (from battery > 0) and Power series are summarised too.
    expect(screen.getByText('SOC')).toBeInTheDocument();
    expect(screen.getByText('50.00%')).toBeInTheDocument();
    expect(screen.queryByText('Power')).not.toBeInTheDocument();
  });

  it('omits optional series that have no samples', () => {
    renderChart([point({ speed: 10 }), point({ speed: 20 })]);
    expect(screen.getByText('Speed')).toBeInTheDocument();
    expect(screen.queryByText('Range (ideal)')).not.toBeInTheDocument();
    expect(screen.queryByText('Range (est.)')).not.toBeInTheDocument();
    expect(screen.queryByText('Usable SOC')).not.toBeInTheDocument();
    // battery is 0 (unknown) → excluded, so SOC is not summarised.
    expect(screen.getByText('SOC')).toBeInTheDocument();
  });

  it('keeps rated range distinct from missing estimated range and reports usable SOC', () => {
    renderChart([
      point({ speed: 10, idealRange: 300, ratedRange: 250, usableSoc: 48, battery: 50 }),
      point({ speed: 20, idealRange: 290, ratedRange: 240, usableSoc: 58, battery: 60 }),
      point({ speed: 30, idealRange: 280, ratedRange: 230, usableSoc: 68, battery: 70 }),
    ]);

    expect(screen.getByText('Range (ideal)')).toBeInTheDocument();
    expect(screen.getByText('Range (rated)')).toBeInTheDocument();
    expect(screen.queryByText('Range (est.)')).toBeNull();
    expect(screen.getByText('Usable SOC')).toBeInTheDocument();

    // Distance stats use integer formatting + the user's distance unit (km).
    expect(screen.getByText('290 km')).toBeInTheDocument(); // ideal
    expect(screen.getByText('240 km')).toBeInTheDocument();
    expect(screen.getByText('58.00%')).toBeInTheDocument(); // usable soc
  });

  it('never fills estimated-range gaps with differently sourced rated samples', () => {
    renderChart([
      point({ estRange: 100, ratedRange: 900 }),
      point({ estRange: null, ratedRange: 800 }),
      point({ estRange: 400, ratedRange: null }),
    ]);
    const estimated = screen.getByRole('rowheader', { name: 'Range (est.)' }).closest('tr')!;
    const rated = screen.getByRole('rowheader', { name: 'Range (rated)' }).closest('tr')!;
    expect(within(estimated).getByText('250 km')).toBeInTheDocument();
    expect(within(rated).getByText('850 km')).toBeInTheDocument();
    expect(within(estimated).queryByText('433 km')).toBeNull();
    expect(within(rated).queryByText('0 km')).toBeNull();
  });

  it('ignores non-finite samples when summarising (no NaN leak)', () => {
    renderChart([
      point({ speed: 10 }),
      point({ speed: Number.NaN }),
      point({ speed: 30 }),
    ]);
    // The NaN row is skipped: mean = (10 + 30) / 2 = 20, not NaN.
    expect(screen.getByText('20.00 km/h')).toBeInTheDocument();
    expect(screen.getByText('30.00 km/h')).toBeInTheDocument();
    expect(screen.getByText('10.00 km/h')).toBeInTheDocument();
  });

  it('summarises a very large drive without overflowing the call stack', () => {
    const big = Array.from({ length: 20_000 }, () => point({ speed: 42, battery: 55 }));
    expect(() => renderChart(big)).not.toThrow();
    expect(screen.getAllByText('42.00 km/h')).toHaveLength(3);
  });

  it('renders inside a ChartTimeRangeProvider (synced-cursor context) without crashing', () => {
    renderChart(
      [point({ speed: 10 }), point({ speed: 20 })],
      (ui) => <ChartTimeRangeProvider syncId="drive-detail">{ui}</ChartTimeRangeProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Drive overview' })).toBeInTheDocument();
    expect(screen.getByText('Speed')).toBeInTheDocument();
  });
});
