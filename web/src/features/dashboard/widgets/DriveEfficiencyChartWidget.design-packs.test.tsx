import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Drive } from '@/api/types';
import type { DataStateSource } from '@/api/dataState';
import type { WidgetProps } from './types';
import type { PackId, PackAppearance } from './designPacks/types';
import { PACK_IDS, PACK_APPEARANCES } from './designPacks/types';
import { PackBoundary } from './designPacks/PackBoundary';
import DriveEfficiencyChartWidget from './DriveEfficiencyChartWidget';

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  vehicles: vi.fn(),
  units: vi.fn(),
  refresh: vi.fn(),
}));
const plot = vi.hoisted(() => ({
  chart: {} as Record<string, unknown>,
  axis: {} as Record<string, unknown>,
  xAxis: {} as Record<string, unknown>,
  reference: {} as Record<string, unknown>,
  series: {} as Record<string, Record<string, unknown>>,
}));

vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: mocks.vehicles }));
vi.mock('@/api/hooks/useDriving', () => ({ useDashboardDriveHistory: mocks.history }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: mocks.units }));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    tz: 'UTC',
    locale: 'en-US',
    formatDateShort: (iso: string) => iso.slice(0, 10),
    formatTime: (iso: unknown) => String(iso),
    formatRelative: (iso: unknown) => String(iso),
  }),
}));

// jsdom has no chart layout; keep the real pack, shell, trust and summary owners.
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual,
    ...chartTestDoubles,
    useThemeChartPalette: () => ({ series: ['#2563eb', '#0d9488'] }),
    useMeasuredAxisWidth: () => 52,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
    AreaChart: (props: Record<string, unknown>) => {
      plot.chart = props;
      return <svg>{props.children as ReactNode}</svg>;
    },
    XAxis: (props: Record<string, unknown>) => { plot.xAxis = props; return null; },
    YAxis: (props: Record<string, unknown>) => { plot.axis = props; return null; },
    Area: (props: Record<string, unknown>) => {
      if (typeof props.dataKey === 'string') plot.series[props.dataKey] = props;
      return null;
    },
    Tooltip: () => null,
    ReferenceLine: (props: Record<string, unknown>) => { plot.reference = props; return null; },
  };
});

const appearances = PACK_IDS
  .filter((id): id is Exclude<PackId, 'classic'> => id !== 'classic')
  .map(id => [id, PACK_APPEARANCES[id]] as const);
const standard = { cols: 2, rows: 4 };
const compact = { cols: 1, rows: 1 };
const fixtureNow = Date.now();

function daysAgo(days: number) {
  return new Date(fixtureNow - days * 86_400_000).toISOString();
}

function drive(id: number, days: number, energy: number | null): Drive {
  return {
    id, vehicle_id: 42, start_ts: daysAgo(days), end_ts: daysAgo(days),
    duration_s: 3600, distance_m: 10_000, energy_used_wh: energy,
    start_address: null, end_address: null, start_lat: null, start_lon: null,
    end_lat: null, end_lon: null, start_soc_pct: 80, end_soc_pct: 70,
    regen_energy_wh: null, avg_speed_mps: null, max_speed_mps: null,
    avg_power_w: null, outside_temp_avg_c: null, inside_temp_avg_c: null,
    score: null, ended_status: null, created_at: daysAgo(days), updated_at: daysAgo(days),
  };
}

function samples() {
  // A missing measured day is not an invented zero or a new chart observation.
  return [drive(1, 5, 1000), drive(2, 4, null), drive(3, 2, 1600)];
}

function query(
  data: Drive[] | null | undefined,
  overrides: Partial<DataStateSource<Drive[] | null>> = {},
) {
  return {
    data, error: null, isLoading: false, isFetching: false, isStale: false,
    isError: false, dataUpdatedAt: Date.now(), refetch: mocks.refresh,
    ...overrides,
  };
}

function widget(packId: unknown, props: Partial<WidgetProps> = {}) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <DriveEfficiencyChartWidget vehicleId={42} size={standard} {...props} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function mount(packId: PackId, appearance: PackAppearance, props: Partial<WidgetProps> = {}) {
  const view = render(widget(packId, props));
  await waitFor(() => expect(
    view.container.querySelector(`[data-widget-family="line"][data-widget-appearance="${appearance}"]`),
  ).not.toBeNull());
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  mocks.vehicles.mockReturnValue({ data: [{ id: 42 }] });
  mocks.units.mockReturnValue({ unitPrefs: { distance: 'km' } });
  mocks.history.mockReturnValue(query(samples()));
  plot.chart = {};
  plot.axis = {};
  plot.xAxis = {};
  plot.reference = {};
  plot.series = {};
});
afterEach(() => vi.restoreAllMocks());

describe.each(appearances)('drive efficiency %s (%s)', (packId, appearance) => {
  it('retains the real daily samples, rolling overlay, axes, units and refresh action', async () => {
    const { container } = await mount(packId, appearance);

    expect(screen.getByText('Drive efficiency')).toBeInTheDocument();
    expect(screen.getByText('130')).toBeInTheDocument();
    expect(screen.getByText('Wh/km')).toBeInTheDocument();
    expect(screen.getByText('30-day average')).toBeInTheDocument();
    expect(screen.getByText('160 Wh/km')).toBeInTheDocument();
    expect(screen.getByText(`${daysAgo(5).slice(0, 10)} – ${daysAgo(2).slice(0, 10)}`)).toBeInTheDocument();
    expect(screen.getByText('Lower consumption is generally better.')).toBeInTheDocument();
    expect(screen.getByTestId('embedded-chart')).toHaveAttribute('data-chart-key', 'dashboard-drive-efficiency');
    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(screen.getByText('7-day avg')).toBeInTheDocument();
    expect(plot.chart.data).toEqual([
      { date: daysAgo(5).slice(0, 10), label: daysAgo(5).slice(0, 10), efficiency: 100, rollingAvg: null },
      { date: daysAgo(2).slice(0, 10), label: daysAgo(2).slice(0, 10), efficiency: 160, rollingAvg: 130 },
    ]);
    expect(plot.axis).toMatchObject({ width: 52, domain: ['dataMin - 20', 'dataMax + 20'] });
    expect(plot.xAxis).toMatchObject({ dataKey: 'label', tick: false });
    expect(plot.reference).toMatchObject({ y: 130, label: { value: expect.stringContaining('Wh/km') } });
    expect(plot.series.efficiency).toMatchObject({ dataKey: 'efficiency', connectNulls: false, fillOpacity: 0.08 });
    expect(plot.series.rollingAvg).toMatchObject({
      dataKey: 'rollingAvg', connectNulls: false, strokeDasharray: '4 2', fill: 'none',
    });
    expect(container.querySelector('[data-widget-appearance] svg.lucide-trending-up')).not.toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(mocks.history).toHaveBeenCalledTimes(1);
    expect(mocks.history).toHaveBeenCalledWith(42, { kind: 'efficiency', limit: 60, range: undefined });
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/i }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('preserves the compact measured headline without mounting a plot or invented scale', async () => {
    await mount(packId, appearance, { size: compact });
    expect(screen.getByText('130')).toBeInTheDocument();
    expect(screen.getByText('Wh/km')).toBeInTheDocument();
    expect(screen.queryByText('Latest')).not.toBeInTheDocument();
    expect(screen.queryByText('30-day average')).not.toBeInTheDocument();
    expect(screen.queryByTestId('embedded-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart-legend')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(plot.chart).toEqual({});
  });

  it('keeps the empty source shell and unknown readings instead of claiming zero consumption', async () => {
    mocks.history.mockReturnValue(query([
      drive(1, 2, null), drive(2, 3, Number.NaN), drive(3, 4, 0),
      drive(4, 5, Number.POSITIVE_INFINITY), drive(5, 6, -1000),
    ]));
    const { container } = await mount(packId, appearance);
    expect(screen.getByText('Drive efficiency')).toBeInTheDocument();
    expect(screen.getByText('No efficiency data yet')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByText('Latest')).toBeInTheDocument();
    expect(screen.getByText('Measured window')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('Wh/km')).not.toBeInTheDocument();
    expect(screen.queryByTestId('embedded-chart')).not.toBeInTheDocument();
    expect(container.querySelector('[data-widget-pack]')).toBeInTheDocument();
  });

  it('retains measurements after a failed refresh with source warning and a working retry', async () => {
    mocks.history.mockReturnValue(query(samples(), { error: new Error('offline'), isError: true }));
    const { container } = await mount(packId, appearance);
    expect(screen.getByText('130')).toBeInTheDocument();
    expect(screen.getByTestId('embedded-chart')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'stale');
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/i }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});

it('preserves Classic and unknown-ID recovery without the alternate headline or details', () => {
  const view = render(widget('classic'));
  expect(screen.getByText('130')).toBeInTheDocument();
  expect(screen.getByText('30-day average')).toBeInTheDocument();
  expect(screen.getByTestId('embedded-chart')).toBeInTheDocument();
  expect(screen.queryByText('Latest')).not.toBeInTheDocument();
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  view.rerender(widget('retired-pack'));
  expect(screen.getByText('130')).toBeInTheDocument();
  expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', 'classic');
});

it.each(appearances)('changes presentation to %s (%s) without adding data controllers or triggering a refresh', async (packId, appearance) => {
  const view = await mount('v1', 'studio');
  mocks.history.mockClear();
  view.rerender(widget(packId));
  await waitFor(() => expect(view.container.querySelector(`[data-widget-appearance="${appearance}"]`)).not.toBeNull());
  expect(mocks.history).toHaveBeenCalledTimes(1);
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(screen.getByText('130')).toBeInTheDocument();
  expect(plot.series.rollingAvg.strokeDasharray).toBe('4 2');
});

it.each(appearances)('converts every series and the reference line at the display boundary for miles in %s (%s)', async (packId, appearance) => {
  mocks.units.mockReturnValue({ unitPrefs: { distance: 'mi' } });
  await mount(packId, appearance);
  expect(screen.getByText('209')).toBeInTheDocument();
  expect(screen.getByText('Wh/mi')).toBeInTheDocument();
  expect(screen.getByText('257 Wh/mi')).toBeInTheDocument();
  expect(plot.chart.data).toEqual([
    expect.objectContaining({ efficiency: expect.closeTo(160.9344), rollingAvg: null }),
    expect.objectContaining({ efficiency: expect.closeTo(257.49504), rollingAvg: expect.closeTo(209.21472) }),
  ]);
  expect(plot.reference.y).toBeCloseTo(209.21472);
});

it.each(appearances)('forwards the selected range and keeps its returned measurements in %s (%s)', async (packId, appearance) => {
  mocks.history.mockReturnValue(query([drive(1, 40, 1000)]));
  await mount(packId, appearance, { vehicleId: 7, config: { timeRange: '90d' } });
  expect(mocks.history).toHaveBeenCalledWith(7, { kind: 'efficiency', limit: 60, range: '90d' });
  expect(screen.getByText('Selected-range average')).toBeInTheDocument();
  expect(screen.getByText('100')).toBeInTheDocument();
  expect(plot.series.rollingAvg).toBeUndefined();
  expect(screen.queryByText('7-day avg')).not.toBeInTheDocument();
});

describe.each(appearances)('drive efficiency %s (%s) source states', (packId, appearance) => {
  it.each([
    { label: 'null', data: null },
    { label: 'list', data: [] as Drive[] },
  ])('handles an empty $label API payload without synthesizing a plot', async ({ data }) => {
    mocks.history.mockReturnValue(query(data));
    await mount(packId, appearance);
    expect(screen.getByText('No efficiency data yet')).toBeInTheDocument();
    expect(screen.queryByTestId('embedded-chart')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('keeps initial loading and fatal source failures honest and retryable', async () => {
    mocks.history.mockReturnValue(query(undefined, { isLoading: true, isFetching: true }));
    const view = render(widget(packId));
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('130')).not.toBeInTheDocument();
    expect(screen.queryByText('No efficiency data yet')).not.toBeInTheDocument();

    mocks.history.mockReturnValue(query(undefined, { error: new Error('offline'), isError: true }));
    view.rerender(widget(packId));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText("Can't reach server")).toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'initialFailure');
    expect(screen.queryByTestId('embedded-chart')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/i }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
