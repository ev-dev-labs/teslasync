import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import BatteryDegradationTrendWidget from './BatteryDegradationTrendWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

interface TrendFixture {
  month: string;
  avg_range: number | null;
}

interface DegradationFixture {
  current_range: number | null;
  monthly_trend: TrendFixture[] | null;
}

interface QueryFixture extends DataStateSource<DegradationFixture> {
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => Promise<unknown>;
}

const { degradationMock, vehiclesMock, refetch, preferences } = vi.hoisted(() => ({
  degradationMock: vi.fn<(vehicleId: string | null) => QueryFixture>(),
  vehiclesMock: vi.fn<() => { data: { id: number }[] }>(),
  refetch: vi.fn<() => Promise<unknown>>(),
  preferences: { distance: 'km' as 'km' | 'mi' },
}));

vi.mock('@/api/hooks/useEnergy', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useEnergy')>(),
  useBatteryDegradation: degradationMock,
}));
vi.mock('@/api/hooks/useVehicles', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useVehicles')>(),
  useVehicles: vehiclesMock,
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: preferences.distance } }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

// Keep the real chart frame, accessible table, shell and lazy pack presentation.
// Only the canvas-dependent chart primitives are replaced for jsdom.
vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>();
  interface ChartProps {
    children?: ReactNode;
    data?: ReadonlyArray<Record<string, unknown>>;
    margin?: unknown;
  }
  interface AxisProps {
    dataKey?: string;
    domain?: unknown;
    width?: number;
    tickFormatter?: (value: number) => string;
  }
  interface AreaProps {
    dataKey?: string;
    name?: string;
    unit?: string;
    stroke?: string;
    fill?: string;
    connectNulls?: boolean;
    isAnimationActive?: boolean;
  }
  return {
    ...actual,
    ResponsiveContainer: ({ children }: ChartProps) => <div>{children}</div>,
    AreaChart: ({ children, data, margin }: ChartProps) => (
      <div data-testid="range-plot" data-samples={JSON.stringify(data)} data-margin={JSON.stringify(margin)}>
        <svg>{children}</svg>
      </div>
    ),
    Area: (props: AreaProps) => (
      <g data-testid="range-series" data-key={props.dataKey} data-name={props.name} data-unit={props.unit}
        data-stroke={props.stroke} data-fill={props.fill}
        data-connect-nulls={String(props.connectNulls)} data-animation={String(props.isAnimationActive)} />
    ),
    XAxis: ({ dataKey }: AxisProps) => <g data-testid="month-axis" data-key={dataKey} />,
    YAxis: ({ domain, width, tickFormatter }: AxisProps) => (
      <g data-testid="range-axis" data-domain={JSON.stringify(domain)}
        data-width={width} data-tick={tickFormatter?.(385.4)} />
    ),
    CartesianGrid: ({ strokeDasharray }: { strokeDasharray?: string }) => (
      <g data-testid="range-grid" data-dash={strokeDasharray} />
    ),
    Tooltip: ({ content }: { content?: ReactNode }) => (
      <g data-testid="range-tooltip" data-custom-content={String(content != null)} />
    ),
  };
});

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const TREND: TrendFixture[] = [
  { month: '2024-01-01', avg_range: 400 },
  { month: '2024-02-01', avg_range: null },
  { month: '2024-03-01', avg_range: 385 },
];
let query: QueryFixture;

function renderWidget(pack: unknown = 'classic', size: WidgetSize = FULL, vehicleId?: number) {
  const tree = (nextPack: unknown, nextSize: WidgetSize) => (
    <MemoryRouter>
      <PackBoundary requestedPackId={nextPack}>
        <BatteryDegradationTrendWidget vehicleId={vehicleId} size={nextSize} />
      </PackBoundary>
    </MemoryRouter>
  );
  const view = render(tree(pack, size));
  return {
    ...view,
    selectPack: (nextPack: unknown, nextSize = size) => view.rerender(tree(nextPack, nextSize)),
  };
}

async function expectPack(container: HTMLElement, appearance: string) {
  await waitFor(() => {
    expect(container.querySelector(`[data-widget-family="line"][data-widget-appearance="${appearance}"]`))
      .toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  refetch.mockReset().mockResolvedValue(undefined);
  preferences.distance = 'km';
  query = {
    data: { current_range: 385, monthly_trend: TREND },
    isLoading: false, isFetching: false, isStale: false, isError: false,
    error: null, dataUpdatedAt: Date.now(), refetch,
  };
  degradationMock.mockReset().mockImplementation(() => query);
  vehiclesMock.mockReset().mockReturnValue({ data: [{ id: 7 }] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(Object.entries(PACK_APPEARANCES))('battery degradation %s / %s', (packId, appearance) => {
  it('keeps the real range headline, signed change, complete monthly plot and observation period', async () => {
    const { container } = renderWidget(packId, FULL, 42);
    await expectPack(container, appearance);

    expect(screen.getByText('Max range at 100%')).toBeInTheDocument();
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('385');
    expect(screen.getByText('−3.8%')).toBeInTheDocument();
    expect(screen.getByText('since first observation (400 km)')).toBeInTheDocument();
    expect(screen.getByText('First observed')).toBeInTheDocument();
    expect(screen.getByText('Change')).toBeInTheDocument();
    expect(screen.getByText('−15')).toBeInTheDocument();
    expect(screen.getByText('Observed Jan 2024 – Mar 2024')).toBeInTheDocument();
    expect(screen.getByText('Measured range estimates; the first observation is not factory capacity.'))
      .toBeInTheDocument();

    expect(JSON.parse(screen.getByTestId('range-plot').getAttribute('data-samples') ?? '[]')).toEqual([
      { month: 'Jan 2024', range: 400 },
      { month: 'Feb 2024', range: null },
      { month: 'Mar 2024', range: 385 },
    ]);
    expect(screen.getByTestId('range-axis')).toHaveAttribute('data-domain', '["dataMin - 5","dataMax + 5"]');
    expect(Number(screen.getByTestId('range-axis').getAttribute('data-width'))).toBeGreaterThanOrEqual(60);
    expect(screen.getByTestId('range-axis')).toHaveAttribute('data-tick', '385');
    expect(screen.getByTestId('month-axis')).toHaveAttribute('data-key', 'month');
    expect(screen.getByTestId('range-grid')).toHaveAttribute('data-dash', '3 3');
    expect(screen.getByTestId('range-series')).toHaveAttribute('data-key', 'range');
    expect(screen.getByTestId('range-series')).toHaveAttribute('data-unit', 'km');
    expect(screen.getByTestId('range-series')).toHaveAttribute('data-connect-nulls', 'false');
    expect(screen.getByTestId('range-series')).toHaveAttribute('data-animation', 'false');
    expect(screen.getByTestId('range-tooltip')).toHaveAttribute('data-custom-content', 'true');
    expect(screen.getByRole('img', { name: 'Monthly max range trend' })).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('400 km');
    expect(rows[2]).toHaveTextContent('Feb 2024');
    expect(rows[2]).toHaveTextContent('—');
    expect(rows[3]).toHaveTextContent('385 km');
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(container.querySelector('[data-widget-appearance] .lucide-trending-down')).toBeInTheDocument();
    expect(screen.getAllByTestId('range-plot')).toHaveLength(1);
    expect(degradationMock).toHaveBeenCalledWith('42');
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('retains the compact headline branch without manufacturing a tiny replacement plot', async () => {
    const { container } = renderWidget(packId, COMPACT);
    await expectPack(container, appearance);
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('385');
    expect(screen.getByText('−3.8%')).toBeInTheDocument();
    expect(screen.getByText('Observed Jan 2024 – Mar 2024')).toBeInTheDocument();
    expect(screen.queryByTestId('range-plot')).not.toBeInTheDocument();
    expect(screen.queryByText('First observed')).not.toBeInTheDocument();
    expect(degradationMock).toHaveBeenCalledWith('7');
  });

  it('keeps unknown estimates unknown and exposes the empty plot state', async () => {
    query.data = { current_range: Number.NaN, monthly_trend: [
      { month: '2024-01-01', avg_range: null },
      { month: '2024-02-01', avg_range: Number.POSITIVE_INFINITY },
    ] };
    const { container } = renderWidget(packId);
    await expectPack(container, appearance);
    expect(screen.getByText('Max range at 100%')).toBeInTheDocument();
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
    expect(screen.getByText('First observed')).toBeInTheDocument();
    expect(screen.getByText('Change')).toBeInTheDocument();
    expect(screen.getByText('More data needed for trend')).toBeInTheDocument();
    expect(screen.getByText('Observation period unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN|Infinity|−100.0%/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('range-plot')).not.toBeInTheDocument();
  });

  it('preserves a measured zero rather than treating it as missing', async () => {
    query.data = { current_range: 0, monthly_trend: TREND };
    const { container } = renderWidget(packId);
    await expectPack(container, appearance);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('−100.0%')).toBeInTheDocument();
    expect(screen.getByText('−400')).toBeInTheDocument();
    expect(screen.getByTestId('range-plot')).toBeInTheDocument();
  });
});

it('keeps Classic and unknown-ID recovery intact while switching the same controller through every pack', async () => {
  const view = renderWidget();
  expect(screen.getByText('since new (400 km)')).toBeInTheDocument();
  expect(screen.queryByText('First observed')).not.toBeInTheDocument();
  expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  const originalSamples = screen.getByTestId('range-plot').getAttribute('data-samples');
  for (const [packId, appearance] of Object.entries(PACK_APPEARANCES)) {
    view.selectPack(packId);
    await expectPack(view.container, appearance);
    expect(screen.getByTestId('range-plot')).toHaveAttribute('data-samples', originalSamples!);
    expect(refetch).not.toHaveBeenCalled();
  }
  view.selectPack('unrecognized');
  expect(view.container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
  expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expect(screen.getByText('since new (400 km)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
  expect(refetch).toHaveBeenCalledTimes(1);
});

describe.each(Object.entries(PACK_APPEARANCES))('battery degradation state fidelity %s / %s', (packId, appearance) => {
  it('retains the actual samples and last successful source time when a refresh fails', async () => {
    query.dataUpdatedAt = Date.now() - 125_000;
    const view = renderWidget(packId);
    await expectPack(view.container, appearance);
    query = { ...query, isError: true, isStale: true, error: new Error('Refresh failed') };
    view.selectPack(packId);
    expect(view.container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByTestId('range-plot')).toBeInTheDocument();
    expect(view.container.querySelector('.widget-big-number')).toHaveTextContent('385');
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Refresh data.*error.*2m ago/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps loading and fatal-error recovery in the shell instead of announcing empty data', async () => {
    query = { ...query, data: undefined, dataUpdatedAt: 0, isLoading: true, isFetching: true };
    const view = renderWidget(packId);
    expect(view.container.querySelector('[data-data-state="initial"][aria-busy="true"]')).toBeInTheDocument();
    expect(view.container.querySelector('.widget-big-number')).not.toBeInTheDocument();
    query = { ...query, isLoading: false, isFetching: false, isError: true, error: new Error('Unavailable') };
    view.selectPack(packId);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No degradation data')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps empty compact recovery actionable without a fabricated reading', async () => {
    query = { ...query, data: undefined, dataUpdatedAt: 0 };
    const view = renderWidget(packId, COMPACT);
    await expectPack(view.container, appearance);
    expect(screen.getByText('No degradation data')).toBeInTheDocument();
    expect(view.container.querySelector('.widget-big-number')).toHaveTextContent('—');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('applies the selected display preference consistently to the headline, every sample and signed change', async () => {
    preferences.distance = 'mi';
    const view = renderWidget(packId);
    await expectPack(view.container, appearance);
    expect(view.container.querySelector('.widget-big-number')).toHaveTextContent('239');
    expect(view.container.querySelector('.widget-big-number')).toHaveTextContent('mi');
    expect(screen.getByText('−9')).toBeInTheDocument();
    expect(screen.getByTestId('range-series')).toHaveAttribute('data-unit', 'mi');
    const samples = JSON.parse(screen.getByTestId('range-plot').getAttribute('data-samples') ?? '[]') as {
      month: string; range: number | null;
    }[];
    expect(samples).toHaveLength(3);
    expect(samples[0].range).toBeCloseTo(248.548, 2);
    expect(samples[1].range).toBeNull();
    expect(samples[2].range).toBeCloseTo(239.228, 2);
    expect(within(screen.getByRole('table')).getAllByRole('row')[1]).toHaveTextContent('249 mi');
  });
});
