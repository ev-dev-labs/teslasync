import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { SpeedProfileData } from '@/types/driving';
import SpeedProfileWidget from './SpeedProfileWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import type { WidgetProps } from './types';

const { useSpeedProfileMock, useVehiclesMock, useUnitsMock, refetch } = vi.hoisted(() => ({
  useSpeedProfileMock: vi.fn(),
  useVehiclesMock: vi.fn(),
  useUnitsMock: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useSpeedProfile: (vehicleId?: string, start?: string, end?: string, widgetRange?: string) =>
    useSpeedProfileMock(vehicleId, start, end, widgetRange),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => useVehiclesMock() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => useUnitsMock() }));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({ start: '2026-10-01', end: '2026-10-31' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles, inertCartesianParts } = await import('@/test/chartTestDoubles');
  return {
    ...actual,
    ...chartTestDoubles,
    ...inertCartesianParts,
    chartGrid: <div data-testid="speed-chart-grid" />,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
    ComposedChart: ({ data, children }: { data: readonly Record<string, unknown>[]; children: ReactNode }) => (
      <div data-testid="speed-chart" data-rows={JSON.stringify(data)}>{children}</div>
    ),
    XAxis: ({ dataKey }: { dataKey: string }) => <div data-testid="speed-axis" data-key={dataKey} />,
    YAxis: ({ yAxisId, orientation, tickFormatter }: {
      yAxisId: string; orientation?: string; tickFormatter: (value: number) => string;
    }) => (
      <div data-testid={`${yAxisId}-axis`} data-orientation={orientation} data-tick={tickFormatter(25)} />
    ),
    Bar: ({ dataKey, hide, radius, children }: {
      dataKey: string; hide?: boolean; radius: number[]; children: ReactNode;
    }) => (
      <div data-testid="frequency-series" data-key={dataKey} data-hidden={hide} data-radius={JSON.stringify(radius)}>
        {children}
      </div>
    ),
    Cell: ({ fill }: { fill: string }) => <span data-testid="speed-bucket-cell" data-fill={fill} />,
    Line: ({ dataKey, connectNulls, hide, name }: {
      dataKey: string; connectNulls: boolean; hide?: boolean; name: string;
    }) => (
      <div data-testid="power-series" data-key={dataKey} data-connect-nulls={connectNulls} data-hidden={hide} data-name={name} />
    ),
  };
});

const packs = [
  ['v1', 'studio'],
  ['v2', 'elevated'],
  ['v3', 'precision'],
  ['v4', 'owner'],
  ['v5', 'iconic'],
  ['v6', 'expressive'],
  ['v7', 'pixel'],
] as const;

function profile(overrides: Partial<SpeedProfileData> = {}): SpeedProfileData {
  return {
    distribution: [
      { speed_bucket: '0-5', readings: 2, avg_power_w: -3000 },
      { speed_bucket: '16-22', readings: 8, avg_power_w: 9600 },
      { speed_bucket: '75+', readings: 0 },
    ],
    avgSpeedMps: 10,
    peakSpeedMps: 35,
    optimalSpeedMps: 58 / 3.6,
    ...overrides,
  };
}

function query(overrides: Partial<DataStateSource<SpeedProfileData>> = {}) {
  return {
    data: profile(),
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null,
    dataUpdatedAt: Date.now(),
    refetch,
    ...overrides,
  };
}

function widget(packId: unknown, size: WidgetProps['size'] = { cols: 3, rows: 3 }) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <SpeedProfileWidget vehicleId={42} size={size} config={{ timeRange: '7d' }} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function expectAppearance(container: HTMLElement, appearance: string) {
  await waitFor(() => {
    expect(container.querySelector(`[data-widget-family="bars"][data-widget-appearance="${appearance}"]`))
      .toBeInTheDocument();
  });
}

function chartRows(): unknown {
  return JSON.parse(screen.getByTestId('speed-chart').getAttribute('data-rows') ?? '[]');
}

beforeEach(() => {
  vi.clearAllMocks();
  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useUnitsMock.mockReturnValue({ unitPrefs: { speed: 'km/h', power: 'kW' } });
  useSpeedProfileMock.mockReturnValue(query());
});

afterEach(cleanup);

describe('SpeedProfileWidget production design packs', () => {
  it.each(packs)('%s preserves the real histogram, signed power, gaps, details and refresh in %s', async (pack, appearance) => {
    const view = render(widget(pack));
    await expectAppearance(view.container, appearance);

    expect(screen.getAllByRole('heading', { name: 'Speed profile', level: 3 })).toHaveLength(1);
    expect(screen.getAllByTestId('speed-chart')).toHaveLength(1);
    expect(screen.getByText('Sweet spot')).toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
    expect(chartRows()).toEqual([
      { bucket: '0–8', frequency: 20, power: -3, sourceIndex: 0 },
      { bucket: '26–35', frequency: 80, power: 9.6, sourceIndex: 1 },
      { bucket: '121+', frequency: 0, power: null, sourceIndex: 2 },
    ]);
    expect(screen.getByRole('img', { name: 'Speed frequency and average power by speed range' })).toBeVisible();
    expect(screen.getByTestId('frequency-axis')).toHaveAttribute('data-tick', '25%');
    expect(screen.getByTestId('power-axis')).toHaveAttribute('data-orientation', 'right');
    expect(screen.getByTestId('speed-axis')).toHaveAttribute('data-key', 'bucket');
    expect(screen.getByTestId('power-series')).toHaveAttribute('data-connect-nulls', 'false');
    expect(screen.getByTestId('power-series')).toHaveAttribute('data-name', 'Average power (kW)');
    expect(screen.getAllByTestId('speed-bucket-cell')).toHaveLength(3);
    expect(screen.getByText('Frequency: 80%')).toBeInTheDocument();
    expect(screen.getByText('0–8 km/h')).toBeInTheDocument();
    expect(screen.getByText('Average power: —')).toBeInTheDocument();
    expect(screen.getByText('Observed speed samples · average power is not energy efficiency')).toBeInTheDocument();
    expect(useSpeedProfileMock).toHaveBeenLastCalledWith('42', '2026-10-01', '2026-10-31', '7d');
    if (pack === 'v7') {
      expect(screen.getByTestId('frequency-series')).toHaveAttribute('data-radius', '[2,2,0,0]');
      expect(view.container.querySelector('[data-widget-appearance="pixel"] svg.lucide-activity')).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: /refresh data/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    useSpeedProfileMock.mockReturnValue(query({ isFetching: true }));
    view.rerender(widget(pack));
    const refresh = screen.getByRole('button', { name: /refresh data/i });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each(packs)('%s retains the compact headline branch without mounting a plot in %s', async (pack, appearance) => {
    const view = render(widget(pack, { cols: 1, rows: 1 }));
    await expectAppearance(view.container, appearance);
    expect(screen.getByText('Sweet spot')).toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
    expect(screen.getByText('km/h')).toBeInTheDocument();
    expect(screen.queryByTestId('speed-chart')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh data/i })).toBeEnabled();
  });

  it('keeps Classic and unknown-pack recovery unchanged when switching presentations', async () => {
    const view = render(widget(undefined));
    expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
    expect(screen.queryByText('Average power: —')).not.toBeInTheDocument();

    view.rerender(widget('v2'));
    await expectAppearance(view.container, 'elevated');
    expect(screen.getAllByTestId('speed-chart')).toHaveLength(1);
    view.rerender(widget('unknown-pack'));
    expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
    expect(screen.getAllByTestId('speed-chart')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /refresh data/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not turn incomplete sample counts or invalid power into zero or a claimed sweet spot', async () => {
    useSpeedProfileMock.mockReturnValue(query({
      data: profile({
        distribution: [
          { speed_bucket: '0-5', readings: Number.NaN, avg_power_w: Number.NaN },
          { speed_bucket: '16-22', readings: 8, avg_power_w: 9600 },
        ],
      }),
    }));
    const view = render(widget('v7'));
    await expectAppearance(view.container, 'pixel');
    expect(chartRows()).toEqual([
      { bucket: '0–8', frequency: null, power: null, sourceIndex: 0 },
      { bucket: '26–35', frequency: null, power: 9.6, sourceIndex: 1 },
    ]);
    expect(screen.queryByText('58')).not.toBeInTheDocument();
    expect(screen.getAllByText('Frequency: —')).toHaveLength(2);
    expect(screen.getByText('Average power: —')).toBeInTheDocument();
    expect(screen.queryByText('Frequency: 0%')).not.toBeInTheDocument();
  });

  it('shows an honest empty source in full and compact packs, without a zero-scale instrument', async () => {
    useSpeedProfileMock.mockReturnValue(query({ data: profile({ distribution: [], optimalSpeedMps: 0 }) }));
    const view = render(widget('v3'));
    await expectAppearance(view.container, 'precision');
    expect(screen.getByText('No speed data')).toBeInTheDocument();
    expect(screen.queryByTestId('speed-chart')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByText('Observed speed samples · average power is not energy efficiency')).toBeInTheDocument();
    view.rerender(widget('v3', { cols: 1, rows: 1 }));
    await expectAppearance(view.container, 'precision');
    expect(screen.getByText('No speed data')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Speed profile', level: 3 })).toBeVisible();
  });

  it('keeps retained chart data and a nonblocking trust warning after a failed refresh', async () => {
    useSpeedProfileMock.mockReturnValue(query({
      isStale: true, isError: true, error: new Error('Refresh interrupted'),
    }));
    const view = render(widget('v1'));
    await expectAppearance(view.container, 'studio');
    expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
    expect(screen.getByText('58')).toBeInTheDocument();
    expect(screen.getByTestId('speed-chart')).toBeInTheDocument();
    expect(view.container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
  });

  it('retains the source shell during initial loading and a fatal initial error', () => {
    useSpeedProfileMock.mockReturnValue(query({ data: undefined, isLoading: true }));
    const view = render(widget('v6'));
    expect(screen.getByRole('heading', { name: 'Speed profile', level: 3 })).toBeVisible();
    expect(view.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByTestId('speed-chart')).not.toBeInTheDocument();

    useSpeedProfileMock.mockReturnValue(query({
      data: undefined, isError: true, error: new Error('Speed profile unavailable'),
    }));
    view.rerender(widget('v6'));
    expect(screen.getByRole('heading', { name: 'Speed profile', level: 3 })).toBeVisible();
    expect(within(screen.getByTestId('widget-body')).getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.queryByTestId('speed-chart')).not.toBeInTheDocument();
  });

  it('formats all bucket edges, the headline and signed power in selected display units', async () => {
    useUnitsMock.mockReturnValue({ unitPrefs: { speed: 'mph', power: 'W' } });
    const view = render(widget('v4'));
    await expectAppearance(view.container, 'owner');
    expect(chartRows()).toEqual([
      { bucket: '0–5', frequency: 20, power: -3000, sourceIndex: 0 },
      { bucket: '16–22', frequency: 80, power: 9600, sourceIndex: 1 },
      { bucket: '75+', frequency: 0, power: null, sourceIndex: 2 },
    ]);
    expect(screen.getByText('36')).toBeInTheDocument();
    expect(screen.getByTestId('power-series')).toHaveAttribute('data-name', 'Average power (W)');
    expect(screen.queryByText('km/h')).not.toBeInTheDocument();
  });
});
