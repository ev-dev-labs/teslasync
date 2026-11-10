import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { TeslaEnergyHistoryEntry, TeslaEnergySite } from '@/types/energy';
import SolarProductionWidget from './SolarProductionWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

interface QueryFixture<T> {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

const { sitesMock, historyMock } = vi.hoisted(() => ({
  sitesMock: vi.fn<() => QueryFixture<TeslaEnergySite[]>>(),
  historyMock: vi.fn<(siteId?: number, period?: string, since?: string) => QueryFixture<TeslaEnergyHistoryEntry[]>>(),
}));

vi.mock('@/api/hooks/useEnergy', () => ({
  useTeslaEnergySites: sitesMock,
  useTeslaEnergyHistory: historyMock,
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { unit_of_length: 'km', locale: 'en-US', tz_display_default: 'utc' },
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
      const variables = fallback && typeof fallback === 'object'
        ? fallback as Record<string, unknown> : options;
      const template = typeof fallback === 'string' ? fallback
        : typeof variables?.defaultValue === 'string' ? variables.defaultValue : key;
      return template.replace(/{{(\w+)}}/g, (match, name: string) =>
        variables?.[name] == null ? match : String(variables[name]));
    },
    i18n: { language: 'en', resolvedLanguage: 'en', dir: () => 'ltr' },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

// Only replace jsdom's unmeasurable viewport; keep the real chart, axes,
// tooltip, accessible data table, shell and lazy pack presentation.
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { cloneElement, isValidElement } = await import('react');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
      <div>
        {isValidElement<{ width: number; height: number }>(children)
          ? cloneElement(children, { width: 640, height: 220 })
          : children}
      </div>
    ),
  };
});

const SITE: TeslaEnergySite = {
  id: 1,
  energy_site_id: 555,
  resource_type: 'battery',
  site_name: 'Home solar',
  gateway_id: null,
  total_pack_energy: null,
  percentage_charged: null,
  battery_type: null,
  backup_capable: false,
  storm_mode_enabled: false,
  has_solar: true,
  has_battery: true,
  has_grid: true,
  has_load_meter: true,
  tou_capable: false,
  storm_mode_capable: false,
  fetched_at: '2026-11-06T12:00:00Z',
  created_at: '2026-11-01T12:00:00Z',
  updated_at: '2026-11-06T12:00:00Z',
  site_info_fetched_at: null,
};

function entry(timestamp: string, solar_energy_wh: number | null): TeslaEnergyHistoryEntry {
  return {
    id: Number(timestamp.replaceAll('-', '')),
    energy_site_id: SITE.energy_site_id,
    period: 'day',
    timestamp,
    solar_energy_wh,
    battery_energy_in_wh: null,
    battery_energy_out_wh: null,
    grid_energy_in_wh: null,
    grid_energy_out_wh: null,
    consumer_energy_wh: null,
    fetched_at: SITE.fetched_at,
  };
}

const HISTORY = [
  entry('2026-11-04', 10_000),
  entry('2026-11-05', null),
  entry('2026-11-06', 12_000),
];

function query<T>(data?: T, overrides: Partial<QueryFixture<T>> = {}): QueryFixture<T> {
  return {
    data,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderWidget(packId: string = 'classic', size: WidgetSize = { cols: 2, rows: 4 }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  const tree = (pack: string) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={pack}>
          <SolarProductionWidget size={size} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(packId));
  return { ...view, changePack: (pack: string) => view.rerender(tree(pack)) };
}

function dataRows() {
  const table = screen.getByRole('table', { name: 'Solar production — data table' });
  return within(table).getAllByRole('row').slice(1).map(row =>
    within(row).getAllByRole('cell').map(cell => cell.textContent));
}

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
  sitesMock.mockReset().mockReturnValue(query([SITE]));
  historyMock.mockReset().mockReturnValue(query(HISTORY));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe.each(Object.entries(PACK_APPEARANCES))('Solar production %s (%s)', (packId, appearance) => {
  it('keeps every real solar sample, units, source context and refresh action', async () => {
    const sites = query([SITE]);
    const history = query(HISTORY);
    sitesMock.mockReturnValue(sites);
    historyMock.mockReturnValue(history);
    const { container } = renderWidget(packId);

    await waitFor(() => expect(container.querySelector(`[data-widget-appearance="${appearance}"]`))
      .toHaveAttribute('data-widget-family', 'bars'));
    expect(container.querySelector('[data-role="widget-header-title"]')).toHaveTextContent('Solar production');
    expect(screen.getByText('Solar produced today')).toBeInTheDocument();
    expect(screen.getByText('12.0')).toBeInTheDocument();
    expect(screen.getByText('Daily avg')).toBeInTheDocument();
    expect(screen.getByText('11.0')).toBeInTheDocument();
    expect(screen.getByText('Energy site')).toBeInTheDocument();
    expect(screen.getByText('Home solar')).toBeInTheDocument();
    expect(screen.getByText('Energy-site data is separate from vehicle telemetry.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Daily solar production over the last 30 days' })
      .querySelector('.recharts-surface')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Solar (kWh)' })).toBeInTheDocument();
    expect(dataRows()).toEqual([['Nov 4', '10'], ['Nov 5', '—'], ['Nov 6', '12']]);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(sites.refetch).toHaveBeenCalledOnce();
    expect(history.refetch).toHaveBeenCalledOnce();
    expect(historyMock).toHaveBeenLastCalledWith(555, 'day', '2026-10-07');
  });

  it('retains the compact headline, average and semantic sun without mounting a chart', async () => {
    const { container } = renderWidget(packId, { cols: 1, rows: 4 });
    await waitFor(() => expect(container.querySelector(`[data-widget-appearance="${appearance}"]`)).not.toBeNull());

    expect(screen.getByText('12.0')).toBeInTheDocument();
    expect(screen.getByText('11.0')).toBeInTheDocument();
    expect(screen.getByText('Daily avg')).toBeInTheDocument();
    expect(container.querySelector('[data-widget-family="bars"] svg.lucide-sun')).not.toBeNull();
    expect(screen.queryByRole('img', { name: 'Daily solar production over the last 30 days' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it.each([null, 0])('preserves unknown buckets and measured zeros with today = %s', async todayValue => {
    historyMock.mockReturnValue(query([
      entry('2026-11-04', 0),
      entry('2026-11-05', Number.NaN),
      entry('2026-11-06', todayValue),
    ]));
    const { container } = renderWidget(packId);
    await waitFor(() => expect(container.querySelector(`[data-widget-appearance="${appearance}"]`)).not.toBeNull());

    const today = screen.getByText('Solar produced today').closest('.widget-big-number');
    expect(today).not.toBeNull();
    expect(today).toHaveTextContent(todayValue == null ? '—' : '0.0');
    if (todayValue == null) expect(today).not.toHaveTextContent('0.0');
    expect(screen.getByText('Daily avg').closest('.widget-big-number')).toHaveTextContent('0.0');
    expect(dataRows()).toEqual([['Nov 4', '0'], ['Nov 5', '—'], ['Nov 6', todayValue == null ? '—' : '0']]);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'partial');
  });
});

it('preserves Classic recovery and one mounted controller while changing every pack', async () => {
  const { container, changePack } = renderWidget();
  expect(container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getByText('Today')).toBeInTheDocument();
  expect(screen.getByText('Daily avg 11.0 kWh')).toBeInTheDocument();
  expect(dataRows()).toEqual([['Nov 4', '10'], ['Nov 5', '—'], ['Nov 6', '12']]);

  // A remounted controller would recompute its trailing-window start.
  vi.setSystemTime(new Date('2026-11-07T12:00:00Z'));
  for (const [packId, appearance] of Object.entries(PACK_APPEARANCES)) {
    changePack(packId);
    await waitFor(() => expect(container.querySelector(`[data-widget-appearance="${appearance}"]`)).not.toBeNull());
    expect(dataRows()).toHaveLength(3);
    expect(historyMock).toHaveBeenLastCalledWith(555, 'day', '2026-10-07');
  }
  changePack('classic');
  expect(container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getByText('Today')).toBeInTheDocument();
  expect(screen.queryByText('Solar produced today')).not.toBeInTheDocument();
  changePack('unknown-pack');
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', 'classic');
  expect(dataRows()).toHaveLength(3);
  expect(sitesMock.mock.calls).toHaveLength(historyMock.mock.calls.length);
  expect(historyMock.mock.calls.every(([siteId, period, since]) =>
    siteId === 555 && period === 'day' && since === '2026-10-07')).toBe(true);
});

describe.each(Object.entries(PACK_APPEARANCES))('Solar production %s state handling', (packId, appearance) => {
  it.each([1, 2])('keeps the no-solar-data shell honest at %i columns', async cols => {
    historyMock.mockReturnValue(query<TeslaEnergyHistoryEntry[]>([]));
    const { container } = renderWidget(packId, { cols, rows: 4 });
    await waitFor(() => expect(container.querySelector(`[data-widget-appearance="${appearance}"]`))
      .toHaveAttribute('data-widget-family', 'bars'));
    expect(screen.getByText('No solar data')).toBeInTheDocument();
    expect(screen.getByText('Energy-site data is separate from vehicle telemetry.')).toBeInTheDocument();
    expect(screen.queryByText('Solar produced today')).not.toBeInTheDocument();
    expect(screen.queryByText('0.0')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('explains an unlinked site without claiming solar capability and refreshes only discovery', async () => {
    const sites = query<TeslaEnergySite[]>([]);
    const history = query<TeslaEnergyHistoryEntry[]>([]);
    sitesMock.mockReturnValue(sites);
    historyMock.mockReturnValue(history);
    const { container } = renderWidget(packId);
    await waitFor(() => expect(container.querySelector(`[data-widget-appearance="${appearance}"]`))
      .toHaveAttribute('data-widget-family', 'bars'));
    expect(screen.getByText('No Tesla energy site linked')).toBeInTheDocument();
    expect(screen.getByText('Energy-site data is separate from vehicle telemetry.')).toBeInTheDocument();
    expect(screen.queryByText('Home solar')).not.toBeInTheDocument();
    expect(screen.queryByText('Solar produced today')).not.toBeInTheDocument();
    expect(historyMock).toHaveBeenLastCalledWith(undefined, 'day', '2026-10-07');
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(sites.refetch).toHaveBeenCalledOnce();
    expect(history.refetch).not.toHaveBeenCalled();
  });

  it('retains the real chart and source warning after a failed history refresh', async () => {
    historyMock.mockReturnValue(query(HISTORY, {
      error: new Error('Synthetic refresh failure'),
      isError: true,
      dataUpdatedAt: Date.now() - 60_000,
    }));
    const { container } = renderWidget(packId);
    await waitFor(() => expect(container.querySelector(`[data-widget-appearance="${appearance}"]`))
      .toHaveAttribute('data-widget-family', 'bars'));
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('12.0')).toBeInTheDocument();
    expect(screen.getByText('11.0')).toBeInTheDocument();
    expect(dataRows()).toHaveLength(3);
    expect(screen.getByText('Energy-site data is separate from vehicle telemetry.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'stale');
  });

  it.each(['sites', 'history'] as const)('shows a real initial %s failure rather than a false empty state', source => {
    const sites = query<TeslaEnergySite[]>(source === 'sites' ? undefined : [SITE]);
    const history = query<TeslaEnergyHistoryEntry[]>();
    Object.assign(source === 'sites' ? sites : history, {
      error: new Error('Synthetic source failure'), isError: true, dataUpdatedAt: 0,
    });
    sitesMock.mockReturnValue(sites);
    historyMock.mockReturnValue(history);
    const { container } = renderWidget(packId);
    expect(container.querySelector('[data-role="widget-header-title"]')).toHaveTextContent('Solar production');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No Tesla energy site linked')).not.toBeInTheDocument();
    expect(screen.queryByText('No solar data')).not.toBeInTheDocument();
    expect(screen.queryByText('Solar produced today')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(sites.refetch).toHaveBeenCalledOnce();
    expect(history.refetch).toHaveBeenCalledTimes(source === 'history' ? 1 : 0);
  });

  it.each(['sites', 'history'] as const)('shows a source-shaped skeleton while %s loads, not a fabricated reading', source => {
    if (source === 'sites') {
      sitesMock.mockReturnValue(query<TeslaEnergySite[]>(undefined, {
        isLoading: true, isFetching: true, dataUpdatedAt: 0,
      }));
      historyMock.mockReturnValue(query<TeslaEnergyHistoryEntry[]>());
    } else {
      historyMock.mockReturnValue(query<TeslaEnergyHistoryEntry[]>(undefined, {
        isLoading: true, isFetching: true, dataUpdatedAt: 0,
      }));
    }
    const { container } = renderWidget(packId);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByText('Solar produced today')).not.toBeInTheDocument();
    expect(screen.queryByText('0.0')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
