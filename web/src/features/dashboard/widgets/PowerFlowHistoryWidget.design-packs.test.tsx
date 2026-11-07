import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeslaEnergyLiveStatus, TeslaEnergySite } from '@/types/energy';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackId } from './designPacks/types';
import type { WidgetSize } from './types';
import PowerFlowHistoryWidget from './PowerFlowHistoryWidget';

const mocks = vi.hoisted(() => ({ sites: vi.fn(), history: vi.fn() }));
vi.mock('@/api/hooks/useEnergy', () => ({
  useTeslaEnergySites: () => mocks.sites(),
  useTeslaEnergyLiveStatusHistory: (...args: unknown[]) => mocks.history(...args),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en', dir: () => 'ltr' },
  }),
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { unit_of_length: 'km', locale: 'en-US' } }),
}));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    startInstant: '2026-07-04T00:00:00.000Z',
    endInstantExclusive: '2026-07-05T00:00:00.000Z',
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: (value: string | number | Date | null | undefined) => value == null
      ? '—' : new Date(value instanceof Date ? value.getTime() : value).toISOString().slice(11, 16),
    formatDateTime: (value: unknown) => String(value),
    tz: 'UTC',
  }),
}));

// Keep the real embedded frame, accessible data table and legend-toggle state.
// Only the layout-dependent vendor plot surface is replaced under jsdom.
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { LegendSeriesLabel } = await import('@/components/charts/ChartLegend');
  const { useChartHiddenSeries } = await import('@/components/charts/ChartHiddenSeriesContext');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AreaChart: ({ data, children }: { data: unknown[]; children?: ReactNode }) => (
      <svg data-testid="power-plot" data-samples={JSON.stringify(data)}>{children}</svg>
    ),
    Area: (props: {
      dataKey: string; name: string; hide?: boolean; stackId?: string;
      strokeWidth?: number; strokeDasharray?: string; connectNulls?: boolean; fill?: string;
    }) => (
      <path data-testid={`series-${props.dataKey}`} data-name={props.name}
        data-hidden={String(props.hide ?? false)} data-stack={props.stackId}
        data-connect-nulls={String(props.connectNulls ?? false)}
        data-fill={props.fill} strokeWidth={props.strokeWidth} strokeDasharray={props.strokeDasharray} />
    ),
    XAxis: ({ dataKey, tickFormatter }: { dataKey: string; tickFormatter: (value: string) => string }) => (
      <g data-testid="power-time-axis" data-key={dataKey} data-tick={tickFormatter('2026-07-04T03:49:00Z')} />
    ),
    YAxis: ({ tickFormatter }: { tickFormatter: (value: number) => string }) => (
      <g data-testid="power-value-axis" data-tick={tickFormatter(-0.7)} />
    ),
    Tooltip: ({ formatter, labelFormatter }: {
      formatter: (value: number, name: string) => [string, string];
      labelFormatter: (value: string) => string;
    }) => (
      <g data-testid="power-tooltip" data-value={JSON.stringify(formatter(-0.7, 'Grid'))}
        data-time={labelFormatter('2026-07-04T04:49:00Z')} />
    ),
    chartGrid: <g data-testid="power-grid" />,
    ChartLegend: function TestLegend() {
      const resolved = useChartHiddenSeries();
      return (
        <foreignObject>
          <div>
            {['Solar', 'Battery', 'Grid', 'Home'].map(name => (
              <LegendSeriesLabel key={name} resolved={resolved} value={name}
                entry={{ value: name, dataKey: name.toLowerCase() }} />
            ))}
          </div>
        </foreignObject>
      );
    },
  };
});

function query<T>(data: T | undefined, overrides: {
  error?: Error; isError?: boolean; isLoading?: boolean; isFetching?: boolean;
  dataUpdatedAt?: number; refetch?: () => void;
} = {}) {
  return {
    data, error: null, isError: false, isLoading: false, isFetching: false,
    isStale: false, dataUpdatedAt: Date.now(), refetch: vi.fn(), ...overrides,
  };
}

const site: TeslaEnergySite = {
  id: 1, energy_site_id: 12345, resource_type: 'battery', site_name: 'Home',
  gateway_id: null, total_pack_energy: 13500, percentage_charged: 80,
  battery_type: 'ac_powerwall', backup_capable: true, storm_mode_enabled: false,
  has_solar: true, has_battery: true, has_grid: true, has_load_meter: true,
  tou_capable: false, storm_mode_capable: false,
  fetched_at: '2026-07-04T04:49:00Z', created_at: '2026-07-04T00:00:00Z',
  updated_at: '2026-07-04T04:49:00Z', site_info_fetched_at: null,
};

function sample(overrides: Partial<TeslaEnergyLiveStatus> = {}): TeslaEnergyLiveStatus {
  return {
    id: 1, energy_site_id: site.energy_site_id,
    solar_power: 3500, battery_power: -1000, grid_power: -700, load_power: 2100,
    grid_services_power: null, energy_left: null, total_pack_energy: null,
    percentage_charged: null, grid_status: null, backup_capable: null,
    storm_mode_active: null, timestamp: '2026-07-04T03:49:00Z',
    fetched_at: '2026-07-04T04:49:00Z', ...overrides,
  };
}

const gap = sample({
  timestamp: '2026-07-04T04:19:00Z',
  solar_power: null, battery_power: null, grid_power: null, load_power: null,
});
const history = [
  sample({ timestamp: '2026-07-04T04:49:00Z', solar_power: 4200, load_power: 2500 }),
  gap,
  sample(),
];
const plottedSamples = [
  { time: '2026-07-04T03:49:00Z', solar: 3.5, battery: -1, grid: -0.7, home: 2.1 },
  { time: gap.timestamp, solar: null, battery: null, grid: null, home: null },
  { time: '2026-07-04T04:49:00Z', solar: 4.2, battery: -1, grid: -0.7, home: 2.5 },
];

function mount(pack: PackId = 'classic', size: WidgetSize = { cols: 2, rows: 4 }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (requestedPackId: PackId) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <PowerFlowHistoryWidget size={size} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(pack));
  return { ...view, selectPack: (next: PackId) => view.rerender(tree(next)) };
}

beforeEach(() => {
  mocks.sites.mockReset().mockReturnValue(query([site]));
  mocks.history.mockReset().mockReturnValue(query(history));
});

describe.each(Object.entries(PACK_APPEARANCES) as [Exclude<PackId, 'classic'>, string][])(
  'Power flow history — %s / %s',
  (id, appearance) => {
    async function expectAppearance(container: HTMLElement) {
      await waitFor(() => expect(container.querySelector(
        `[data-widget-family="line"][data-widget-appearance="${appearance}"]`,
      )).toBeInTheDocument());
    }

    it('recomposes Classic into a real headline, facts and all independent signed samples; retains refresh and legend actions', async () => {
      const sitesRefetch = vi.fn();
      const historyRefetch = vi.fn();
      mocks.sites.mockReturnValue(query([site], { refetch: sitesRefetch }));
      mocks.history.mockReturnValue(query(history, { refetch: historyRefetch }));
      const view = mount();
      expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
      expect(screen.getByText('3.85')).toBeInTheDocument();
      expect(screen.getByText('2.50')).toBeInTheDocument();
      expect(screen.getByText('-0.70')).toBeInTheDocument();
      expect(screen.getByTestId('series-solar')).toHaveAttribute('stroke-width', '2');

      view.selectPack(id);
      await expectAppearance(view.container);
      expect(screen.getAllByRole('heading', { name: 'Power flow history' }).length).toBeGreaterThan(0);
      expect(screen.getByText('Avg solar')).toBeInTheDocument();
      expect(screen.getByText('3.85')).toBeInTheDocument();
      expect(screen.getByText('Peak home')).toBeInTheDocument();
      expect(screen.getByText('2.50')).toBeInTheDocument();
      expect(screen.getByText('Avg net grid')).toBeInTheDocument();
      expect(screen.getByText('-0.70')).toBeInTheDocument();
      expect(view.container.querySelector('[data-provenance="historical"]')).toBeInTheDocument();
      expect(screen.getByTestId('power-plot')).toHaveAttribute('data-samples', JSON.stringify(plottedSamples));
      expect(screen.getByTestId('power-time-axis')).toHaveAttribute('data-key', 'time');
      expect(screen.getByTestId('power-time-axis')).toHaveAttribute('data-tick', '03:49');
      expect(screen.getByTestId('power-value-axis')).toHaveAttribute('data-tick', '-0.70');
      expect(screen.getByTestId('power-tooltip')).toHaveAttribute('data-value', '["-0.70 kW","Grid"]');
      expect(screen.getByTestId('power-tooltip')).toHaveAttribute('data-time', '04:49');
      for (const key of ['solar', 'battery', 'grid', 'home']) {
        expect(screen.getByTestId(`series-${key}`)).not.toHaveAttribute('data-stack');
        expect(screen.getByTestId(`series-${key}`)).toHaveAttribute('data-connect-nulls', 'false');
        expect(screen.getByTestId(`series-${key}`).getAttribute('data-fill')).toMatch(/^url\(#.+Grad\)$/);
      }
      if (id === 'v5') {
        expect(screen.getByTestId('series-battery')).toHaveAttribute('stroke-dasharray', '2 3');
        expect(screen.getByTestId('series-grid')).toHaveAttribute('stroke-dasharray', '1 3');
        expect(screen.getByTestId('series-home')).toHaveAttribute('stroke-dasharray', '2 5');
      }
      const table = screen.getByRole('table', { hidden: true });
      expect(within(table).getAllByRole('columnheader', { hidden: true }).map(node => node.textContent))
        .toEqual(['Time', 'Solar (kW)', 'Battery (kW)', 'Grid (kW)', 'Home (kW)']);
      expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(4);
      expect(within(table).getAllByText('—')).toHaveLength(4);
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
      expect(sitesRefetch).toHaveBeenCalledOnce();
      expect(historyRefetch).toHaveBeenCalledOnce();
      expect(mocks.history).toHaveBeenLastCalledWith(
        site.energy_site_id, '2026-07-04T00:00:00.000Z', '2026-07-05T00:00:00.000Z', 1000,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
      expect(screen.getByTestId('series-grid')).toHaveAttribute('data-hidden', 'true');
      view.selectPack('classic');
      expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
      expect(screen.getByTestId('power-plot')).toHaveAttribute('data-samples', JSON.stringify(plottedSamples));
      expect(screen.getByTestId('series-grid')).toHaveAttribute('data-hidden', 'true');
      expect(screen.getByTestId('series-solar')).toHaveAttribute('stroke-width', '2');
    });

    it('preserves the compact two-stat branch without adding a chart or grid summary', async () => {
      const { container } = mount(id, { cols: 1, rows: 2 });
      await expectAppearance(container);
      expect(screen.getByText('3.85')).toBeInTheDocument();
      expect(screen.getByText('2.50')).toBeInTheDocument();
      expect(screen.queryByText('Avg net grid')).not.toBeInTheDocument();
      expect(screen.queryByTestId('power-plot')).not.toBeInTheDocument();
    });

    it('retains all-unknown observations as gaps and unknown summaries, not measured zero', async () => {
      mocks.history.mockReturnValue(query([gap]));
      const { container } = mount(id);
      await expectAppearance(container);
      expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'partial');
      expect(within(container.querySelector('.widget-big-number') as HTMLElement).getByText('—')).toBeInTheDocument();
      expect(screen.queryByText('0.00')).not.toBeInTheDocument();
      expect(screen.queryByText('No power flow data')).not.toBeInTheDocument();
      expect(screen.getByTestId('power-plot')).toHaveAttribute('data-samples', JSON.stringify([plottedSamples[1]]));
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    });

    it('shows an honest empty window without a fabricated headline or plot', async () => {
      mocks.history.mockReturnValue(query<TeslaEnergyLiveStatus[]>([]));
      const { container } = mount(id);
      await expectAppearance(container);
      expect(screen.getByText('No power flow data')).toBeInTheDocument();
      expect(screen.queryByTestId('power-plot')).not.toBeInTheDocument();
      expect(container.querySelector('.widget-big-number')).not.toBeInTheDocument();
    });

    it('keeps the no-site explanation and sites-only refresh action', async () => {
      const sitesRefetch = vi.fn();
      const historyRefetch = vi.fn();
      mocks.sites.mockReturnValue(query<TeslaEnergySite[]>([], { refetch: sitesRefetch }));
      mocks.history.mockReturnValue(query<TeslaEnergyLiveStatus[]>([], { refetch: historyRefetch }));
      const { container } = mount(id);
      await expectAppearance(container);
      expect(screen.getByText('No Tesla energy site linked')).toBeInTheDocument();
      expect(screen.queryByTestId('power-plot')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
      expect(sitesRefetch).toHaveBeenCalledOnce();
      expect(historyRefetch).not.toHaveBeenCalled();
    });

    it('retains the real chart, summaries and nonblocking warning after a failed refresh', async () => {
      const retry = vi.fn();
      mocks.history.mockReturnValue(query(history, {
        error: new Error('Refresh failed'), isError: true, refetch: retry,
      }));
      const { container } = mount(id);
      await expectAppearance(container);
      expect(screen.getByText('3.85')).toBeInTheDocument();
      expect(screen.getByTestId('power-plot')).toBeInTheDocument();
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
      expect(retry).toHaveBeenCalledOnce();
    });

    it('keeps the source shell while loading and surfaces fatal failures instead of no-site success', () => {
      mocks.sites.mockReturnValue(query<TeslaEnergySite[]>(undefined, {
        isLoading: true, isFetching: true, dataUpdatedAt: 0,
      }));
      const view = mount(id);
      expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByTestId('power-plot')).not.toBeInTheDocument();
      expect(screen.queryByText('No Tesla energy site linked')).not.toBeInTheDocument();
      mocks.sites.mockReturnValue(query<TeslaEnergySite[]>(undefined, {
        error: new Error('Site source failed'), isError: true, dataUpdatedAt: 0,
      }));
      view.selectPack(id);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.queryByTestId('power-plot')).not.toBeInTheDocument();
      expect(screen.queryByText('No Tesla energy site linked')).not.toBeInTheDocument();
    });
  },
);

it('preserves measured zero samples and the wide branch without an invented meter', async () => {
  mocks.history.mockReturnValue(query([sample({
    solar_power: 0, battery_power: 0, grid_power: 0, load_power: 0,
  })]));
  const { container } = mount('v7', { cols: 3, rows: 4 });
  await waitFor(() => expect(container.querySelector('[data-widget-appearance="pixel"]')).toBeInTheDocument());
  expect(screen.getAllByText('0.00')).toHaveLength(3);
  expect(screen.getByTestId('power-plot')).toBeInTheDocument();
  expect(screen.queryByText('No power flow data')).not.toBeInTheDocument();
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
});
