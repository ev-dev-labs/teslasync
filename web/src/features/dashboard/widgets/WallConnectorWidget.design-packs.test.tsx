import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TeslaEnergySite, TeslaWCChargingEntry } from '@/types/energy';
import { chartTokens } from '@/lib/tokens';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackAppearance, type PackId } from './designPacks/types';
import type { WidgetSize } from './types';
import WallConnectorWidget from './WallConnectorWidget';

const { sitesMock, historyMock } = vi.hoisted(() => ({
  sitesMock: vi.fn<() => Query<TeslaEnergySite[]>>(),
  historyMock: vi.fn<(siteId?: number, since?: string) => Query<TeslaWCChargingEntry[]>>(),
}));

vi.mock('@/api/hooks/useEnergy', () => ({
  useTeslaEnergySites: sitesMock,
  useTeslaWCChargingHistory: historyMock,
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { unit_of_length: 'km', locale: 'en-US' },
    locale: 'en-US',
  }),
}));
vi.mock('@/lib/timezone', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/timezone')>(),
  useTimezone: () => 'UTC',
}));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/{{(\w+)}}/g, (match, name: string) => String(options?.[name] ?? match));
    },
    i18n: { language: 'en' },
  }),
}));

// Only the chart's layout-dependent vendor boundary is doubled; pack selection,
// lazy presentation, shells, trust, metrics and connector artwork stay real.
vi.mock('@/components/charts', async () => {
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...chartTestDoubles,
    chartGrid: null,
    chartMargin: {},
    chartAnimation: {},
    axisTick: { size: 'lg' },
    axisTickSm: { size: 'sm' },
    useMeasuredAxisWidth: () => 44,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
    BarChart: ({ data, children }: { data: unknown; children?: ReactNode }) => (
      <div data-testid="wall-bars" data-json={JSON.stringify(data)}>{children}</div>
    ),
    Bar: ({ dataKey, fill, radius, name }: {
      dataKey: string; fill: string; radius: number[]; name: string;
    }) => (
      <div data-testid="wall-series" data-key={dataKey} data-fill={fill}
        data-radius={JSON.stringify(radius)} data-name={name} />
    ),
    XAxis: ({ dataKey, tick }: { dataKey: string; tick: { size: string } }) => (
      <div data-testid="wall-x-axis" data-key={dataKey} data-tick-size={tick.size} />
    ),
    YAxis: ({ width, tickFormatter }: { width: number; tickFormatter: (value: number) => string }) => (
      <div data-testid="wall-y-axis" data-width={width} data-tick={tickFormatter(14)} />
    ),
    Tooltip: ({ formatter }: { formatter: (value: number) => unknown }) => (
      <div data-testid="wall-tooltip" data-value={JSON.stringify(formatter(14))} />
    ),
  };
});

interface Query<T> {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn<() => void>>;
}

function query<T>(data: T | undefined, overrides: Partial<Query<T>> = {}): Query<T> {
  return {
    data, error: null, isLoading: false, isFetching: false, isStale: false,
    isError: false, dataUpdatedAt: Date.now(), refetch: vi.fn<() => void>(),
    ...overrides,
  };
}

const SITE: TeslaEnergySite = {
  id: 1, energy_site_id: 555, resource_type: 'battery', site_name: 'Home',
  gateway_id: null, total_pack_energy: null, percentage_charged: null,
  battery_type: null, backup_capable: false, storm_mode_enabled: false,
  has_solar: false, has_battery: true, has_grid: true, has_load_meter: false,
  tou_capable: false, storm_mode_capable: false, site_info_fetched_at: null,
  fetched_at: '2026-11-06T12:00:00Z', created_at: '2026-11-01T12:00:00Z',
  updated_at: '2026-11-06T12:00:00Z',
};

function dayKey(daysAgo = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function entry(day: string, energy_wh: number | null, hour = '12'): TeslaWCChargingEntry {
  return {
    id: Number(hour), energy_site_id: SITE.energy_site_id, din: null,
    timestamp: `${day}T${hour}:00:00Z`, energy_wh, fetched_at: `${day}T23:00:00Z`,
  };
}

function history(): TeslaWCChargingEntry[] {
  return [
    entry(dayKey(), 6000, '08'),
    entry(dayKey(2), null),
    entry(dayKey(), 8000, '18'),
    entry(dayKey(1), 0),
  ];
}

function shortDate(key: string): string {
  const [, month, day] = key.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function tree(packId: PackId, size: WidgetSize = { cols: 2, rows: 4 }) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <WallConnectorWidget size={size} />
      </PackBoundary>
    </MemoryRouter>
  );
}

function rows(): { date: string; energy_kwh: number | null }[] {
  return JSON.parse(screen.getByTestId('wall-bars').getAttribute('data-json') ?? '[]');
}

const packs = Object.entries(PACK_APPEARANCES) as [Exclude<PackId, 'classic'>, PackAppearance][];

beforeEach(() => {
  sitesMock.mockReset();
  historyMock.mockReset();
  sitesMock.mockReturnValue(query([SITE]));
  historyMock.mockReturnValue(query(history()));
});

describe.each(packs)('Wall Connector %s (%s)', (packId, appearance) => {
  async function expectPack(container: HTMLElement) {
    await waitFor(() => expect(
      container.querySelector(`[data-widget-family="bars"][data-widget-appearance="${appearance}"]`),
    ).toBeInTheDocument());
  }

  it('retains the complete daily plot, SI conversion, source gaps, tooltip and refresh action', async () => {
    const sites = query([SITE]);
    const charging = query(history());
    sitesMock.mockReturnValue(sites);
    historyMock.mockReturnValue(charging);
    const { container } = render(tree(packId));
    await expectPack(container);

    expect(screen.getByRole('heading', { name: 'Wall connector' })).toBeVisible();
    expect(screen.getByText('Energy delivered today')).toBeInTheDocument();
    expect(screen.getByText('14.00')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();
    expect(screen.getByText('Period: Daily')).toBeInTheDocument();
    expect(screen.getByText('Energy delivered is not the same as current power.')).toBeInTheDocument();
    expect(rows()).toEqual([
      { date: shortDate(dayKey(2)), energy_kwh: null },
      { date: shortDate(dayKey(1)), energy_kwh: 0 },
      { date: shortDate(dayKey()), energy_kwh: 14 },
    ]);
    expect(screen.getByRole('img', {
      name: 'Daily wall connector charging energy over the last 14 days',
    })).toContainElement(screen.getByTestId('wall-bars'));
    expect(screen.getByTestId('wall-x-axis')).toHaveAttribute('data-key', 'date');
    expect(screen.getByTestId('wall-x-axis')).toHaveAttribute('data-tick-size', 'sm');
    expect(screen.getByTestId('wall-y-axis')).toHaveAttribute('data-tick', '14.00');
    expect(screen.getByTestId('wall-tooltip')).toHaveAttribute('data-value', '["14.00 kWh","Energy"]');
    expect(screen.getByTestId('wall-series')).toHaveAttribute('data-key', 'energy_kwh');
    expect(screen.getByTestId('wall-series')).toHaveAttribute('data-fill', chartTokens.series[1]);
    // The existing connector artwork survives Pixel too; history is not live activity.
    expect(container.querySelector('svg[viewBox="0 0 114 88"]')).toBeInTheDocument();
    expect(container.querySelector('.widget-activity-active, .widget-state-motion')).toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(historyMock).toHaveBeenLastCalledWith(555, expect.any(String));
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(sites.refetch).toHaveBeenCalledOnce();
    expect(charging.refetch).toHaveBeenCalledOnce();
  });

  it('preserves compact measured zero, connector artwork and the no-chart branch', async () => {
    historyMock.mockReturnValue(query([entry(dayKey(), 0)]));
    const { container } = render(tree(packId, { cols: 1, rows: 2 }));
    await expectPack(container);
    expect(screen.getByText('0.00')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();
    expect(container.querySelector('svg[viewBox="0 0 114 88"]')).toBeInTheDocument();
    expect(screen.queryByTestId('wall-bars')).not.toBeInTheDocument();
    expect(screen.queryByText('No wall connector data')).not.toBeInTheDocument();
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'keeps the daily total unknown when a session energy is missing or invalid (%s)',
    async (energy) => {
      historyMock.mockReturnValue(query([
        entry(dayKey(), 6000, '08'), entry(dayKey(), energy, '18'),
      ]));
      const { container } = render(tree(packId));
      await expectPack(container);
      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.queryByText('0.00')).not.toBeInTheDocument();
      expect(screen.queryByText('6.00')).not.toBeInTheDocument();
      expect(rows()).toEqual([{ date: shortDate(dayKey()), energy_kwh: null }]);
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    },
  );

  it('keeps the no-site explanation and refreshes discovery only', async () => {
    const sites = query<TeslaEnergySite[]>([]);
    const charging = query<TeslaWCChargingEntry[]>([]);
    sitesMock.mockReturnValue(sites);
    historyMock.mockReturnValue(charging);
    const { container } = render(tree(packId));
    await expectPack(container);
    expect(screen.getByText('No Tesla energy site linked')).toBeInTheDocument();
    expect(screen.queryByTestId('wall-bars')).not.toBeInTheDocument();
    expect(screen.queryByText('Energy delivered today')).not.toBeInTheDocument();
    expect(historyMock).toHaveBeenLastCalledWith(undefined, expect.any(String));
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(sites.refetch).toHaveBeenCalledOnce();
    expect(charging.refetch).not.toHaveBeenCalled();
  });

  it('keeps linked-site empty history distinct from no site and measured zero', async () => {
    historyMock.mockReturnValue(query<TeslaWCChargingEntry[]>([]));
    const { container } = render(tree(packId));
    await expectPack(container);
    expect(screen.getByText('No wall connector data')).toBeInTheDocument();
    expect(screen.queryByText('No Tesla energy site linked')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wall-bars')).not.toBeInTheDocument();
  });

  it('retains the historical plot and last-success warning after a failed refresh', async () => {
    const charging = query(history(), {
      error: new Error('refresh failed'), isError: true, isStale: true,
      dataUpdatedAt: Date.now() - 60_000,
    });
    historyMock.mockReturnValue(charging);
    const { container } = render(tree(packId, { cols: 3, rows: 4 }));
    await expectPack(container);
    expect(screen.getByText('14.00')).toBeInTheDocument();
    expect(rows()).toHaveLength(3);
    expect(screen.getByTestId('wall-x-axis')).toHaveAttribute('data-tick-size', 'lg');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(charging.refetch).toHaveBeenCalledOnce();
  });

  it('retains the plot and prevents duplicate refreshes while fetching', async () => {
    const charging = query(history(), { isFetching: true });
    historyMock.mockReturnValue(charging);
    const { container } = render(tree(packId));
    await expectPack(container);
    expect(screen.getByText('14.00')).toBeInTheDocument();
    expect(rows()).toHaveLength(3);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    const refresh = screen.getByRole('button', { name: /Refresh data/ });
    expect(refresh).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(refresh);
    expect(charging.refetch).not.toHaveBeenCalled();
  });

  it('recovers the unchanged Classic body with the same data and refresh controller', async () => {
    const charging = query(history());
    historyMock.mockReturnValue(charging);
    const view = render(tree('classic'));
    expect(screen.getByText('Today')).toBeInTheDocument();
    const classicRows = rows();
    expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
    view.rerender(tree(packId));
    await expectPack(view.container);
    expect(rows()).toEqual(classicRows);
    view.rerender(tree('classic'));
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.queryByText('Energy delivered today')).not.toBeInTheDocument();
    expect(rows()).toEqual(classicRows);
    expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(charging.refetch).toHaveBeenCalledOnce();
  });
});

describe.each(PACK_IDS)('Wall Connector %s initial states', (packId) => {
  it.each(['sites', 'history'] as const)('keeps %s initial failure distinct from empty data', (source) => {
    const failure = { error: new Error('failed'), isError: true, dataUpdatedAt: 0 };
    if (source === 'sites') sitesMock.mockReturnValue(query<TeslaEnergySite[]>(undefined, failure));
    else historyMock.mockReturnValue(query<TeslaWCChargingEntry[]>(undefined, failure));
    const { container } = render(tree(packId));
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
    expect(screen.getByRole('heading', { name: 'Wall connector' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No Tesla energy site linked')).not.toBeInTheDocument();
    expect(screen.queryByText('No wall connector data')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wall-bars')).not.toBeInTheDocument();
  });

  it.each(['sites', 'history'] as const)('preserves the source-shaped skeleton during %s initial loading', (source) => {
    const loading = { isLoading: true, dataUpdatedAt: 0 };
    if (source === 'sites') sitesMock.mockReturnValue(query<TeslaEnergySite[]>(undefined, loading));
    else historyMock.mockReturnValue(query<TeslaWCChargingEntry[]>(undefined, loading));
    const { container } = render(tree(packId));
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
    expect(screen.getByRole('heading', { name: 'Wall connector' })).toBeInTheDocument();
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wall-bars')).not.toBeInTheDocument();
  });
});
