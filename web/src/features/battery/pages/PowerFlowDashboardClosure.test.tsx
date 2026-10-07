import type { ComponentProps, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/feedback';
import { ApiError } from '@/lib/resilience';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type { TeslaEnergyLiveStatus } from '@/types/energy';

const h = vi.hoisted(() => ({
  live: vi.fn(), history: vi.fn(), refresh: vi.fn(), advice: vi.fn(), download: vi.fn(),
  liveRetry: vi.fn(), historyRetry: vi.fn(), mutate: vi.fn(),
}));
vi.mock('@/api/hooks/useEnergy', () => ({
  useTeslaEnergyLiveStatus: h.live,
  useTeslaEnergyLiveStatusHistory: h.history,
  useRefreshTeslaEnergyLiveStatus: h.refresh,
  useSolarChargeAdvice: h.advice,
}));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({ start: '2026-06-25', end: '2026-07-01' }),
}));
vi.mock('@/lib/csvExport', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV: h.download,
}));
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children }: ComponentProps<typeof actual.FadeIn>) => <>{children}</> };
});

import PowerFlowDashboardPage from './PowerFlowDashboardPage';

// Supply layout measurements only; real chart, legend, table, trust and export
// controllers stay mounted. Downloads stop at the side-effect boundary.
class MeasuredResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 960, height: 320 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

const live: TeslaEnergyLiveStatus = {
  id: 42, energy_site_id: 1, solar_power: 3200, battery_power: -1500,
  load_power: 900, grid_power: 2000, grid_services_power: 0,
  energy_left: 12500, total_pack_energy: 27000, percentage_charged: 46.3,
  grid_status: 'Active', backup_capable: true, storm_mode_active: true,
  timestamp: '2026-07-01T10:00:00Z', fetched_at: '2026-07-01T10:00:05Z',
};
const history: TeslaEnergyLiveStatus[] = Array.from({ length: 27 }, (_, index) => ({
  ...live, id: index + 1,
  timestamp: new Date(Date.parse('2026-06-25T00:00:00Z') + index * 3600000).toISOString(),
  solar_power: index === 0 ? null : index * 100,
  battery_power: index === 0 ? 0 : index === 1 ? null : -index * 50,
  grid_power: index === 2 ? null : index === 0 ? 0 : -index * 25,
  load_power: index === 3 ? null : index * 75,
  percentage_charged: index === 0 ? null : index === 1 ? 0 : index + 30,
}));
function query<T>(data: T | undefined, refetch: () => void, error: Error | null = null, loading = false) {
  return {
    data, refetch, error, isError: error != null, isLoading: loading, isPending: loading,
    isFetching: loading, isSuccess: data !== undefined && error == null,
    fetchStatus: loading ? 'fetching' as const : 'idle' as const,
    dataUpdatedAt: data === undefined ? 0 : Date.parse(live.fetched_at),
  };
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Tree({ children }: { children?: ReactNode }) {
    return <QueryClientProvider client={client}><MemoryRouter initialEntries={['/power-flow']}>
      <ToastProvider>{children ?? <PowerFlowDashboardPage />}</ToastProvider>
    </MemoryRouter></QueryClientProvider>;
  }
  const view = render(<Tree />);
  return { ...view, update: () => view.rerender(<Tree />) };
}
function card(title: string): HTMLElement {
  const shells = screen.getAllByRole('heading', { name: title, exact: true })
    .map(heading => heading.closest('[data-card]')).filter(node => node != null);
  expect(new Set(shells).size).toBe(1);
  const node = shells[0];
  if (!(node instanceof HTMLElement)) throw new Error(`Missing actual card: ${title}`);
  return node;
}
function tableRows(title: string): string[][] {
  const table = within(card(title)).getByRole('table', { hidden: true });
  return within(table).getAllByRole('row', { hidden: true }).slice(1).map(row =>
    within(row).getAllByRole('cell', { hidden: true }).map(cell => cell.textContent ?? ''));
}
function exportCsv(title: string) {
  fireEvent.click(within(card(title)).getByRole('button', { name: 'Export chart' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
}
function warning(label: string): HTMLElement {
  const node = screen.getAllByTestId('stale-refresh-warning').find(notice => notice.textContent?.includes(label));
  if (!node) throw new Error(`Missing source warning: ${label}`);
  return node;
}

beforeEach(() => {
  vi.clearAllMocks();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  vi.stubGlobal('ResizeObserver', MeasuredResizeObserver);
  h.live.mockReturnValue(query(live, h.liveRetry));
  h.history.mockReturnValue(query(history, h.historyRetry));
  h.refresh.mockReturnValue({ mutate: h.mutate, isPending: false });
  h.advice.mockReturnValue(query(undefined, vi.fn()));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Power Flow bounded closure — actual mounted preservation', () => {
  it('opens the actual power review drawer without losing sign, direction or the measurement timestamp', () => {
    const before = JSON.stringify(live);
    mount();
    const brief = screen.getByRole('region', { name: 'Current power' });
    const battery = within(brief).getByText('Battery').closest('[data-operational-metric]');
    expect(battery).toHaveAttribute('data-value-state', 'value');
    expect(battery?.querySelector('[data-operational-value]')).toHaveTextContent('-1.50 kW');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByText('Charging', { exact: true })).toBeVisible();
    expect(drawer.getByText('Importing', { exact: true })).toBeVisible();
    expect(drawer.getByText('Live energy status', { exact: true })).toBeVisible();
    expect(JSON.stringify(live)).toBe(before);
  });

  it('keeps unknown site flags separate from observed false and true on the same mount', () => {
    h.live.mockReturnValue(query({ ...live, storm_mode_active: null, backup_capable: null }, h.liveRetry));
    const view = mount();
    const details = () => within(card('Site Details'));
    expect(details().getAllByText('Unknown')).toHaveLength(2);
    expect(details().queryByText('Off')).not.toBeInTheDocument();
    expect(details().queryByText('No')).not.toBeInTheDocument();
    h.live.mockReturnValue(query({ ...live, storm_mode_active: false, backup_capable: false }, h.liveRetry));
    view.update();
    expect(details().getByText('Off')).toBeInTheDocument();
    expect(details().getByText('No')).toBeInTheDocument();
    expect(details().queryByText('Unknown')).not.toBeInTheDocument();
    h.live.mockReturnValue(query(live, h.liveRetry));
    view.update();
    expect(details().getByText('On')).toBeInTheDocument();
    expect(details().getByText('Yes')).toBeInTheDocument();
    expect(h.history).toHaveBeenLastCalledWith(1, '2026-06-25', '2026-07-01', 1000);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('retains unknown readings without arrows, then exposes observed zero power, energy and SOC', () => {
    h.live.mockReturnValue(query({
      ...live, solar_power: null, battery_power: null, grid_power: null, load_power: null,
      energy_left: null, total_pack_energy: null, percentage_charged: null,
    }, h.liveRetry));
    const view = mount();
    const kpis = () => within(screen.getByRole('region', { name: 'Current power' }));
    expect(kpis().getAllByText('—')).toHaveLength(4);
    expect(card('Power Flow').querySelector('svg.lucide-arrow-down, svg.lucide-arrow-up')).toBeNull();
    expect(within(card('Battery State')).queryByRole('meter')).not.toBeInTheDocument();
    h.live.mockReturnValue(query({
      ...live, solar_power: 0, battery_power: 0, grid_power: 0, load_power: 0,
      energy_left: 0, total_pack_energy: 0, percentage_charged: 0,
    }, h.liveRetry));
    view.update();
    expect(kpis().getAllByText('0.00 W')).toHaveLength(4);
    expect(kpis().queryByText('Charging')).not.toBeInTheDocument();
    expect(kpis().queryByText('Importing')).not.toBeInTheDocument();
    expect(within(card('Battery State')).getByRole('meter', { name: 'State of Charge' }))
      .toHaveAttribute('aria-valuenow', '0');
    expect(within(card('Battery State')).getAllByText('0.00 Wh')).toHaveLength(2);
  });

  it.each(['loading', 'failure'] as const)('keeps every returned history row exportable when live is initially %s', state => {
    h.live.mockReturnValue(query(undefined, h.liveRetry,
      state === 'failure' ? new ApiError('private technical failure', 503) : null, state === 'loading'));
    mount();
    expect(tableRows('Power Over Time')).toHaveLength(27);
    expect(tableRows('Battery State of Charge')).toHaveLength(27);
    exportCsv('Battery State of Charge');
    const expected = [
      'time,soc',
      ...history.map(sample => `${Date.parse(sample.timestamp)},${sample.percentage_charged ?? ''}`),
    ].join('\r\n');
    expect(h.download).toHaveBeenCalledWith(expect.any(String), expected);
    if (state === 'failure') {
      fireEvent.click(within(card('Site Details')).getByRole('button', { name: 'Retry' }));
      expect(h.liveRetry).toHaveBeenCalledOnce();
      expect(h.historyRetry).not.toHaveBeenCalled();
    }
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('retains complete signed/null tables, all series and CSV while both independent refreshes fail', async () => {
    const view = mount();
    const beforePower = tableRows('Power Over Time');
    const beforeSoc = tableRows('Battery State of Charge');
    expect(beforePower).toHaveLength(27);
    expect(beforePower[0].slice(1)).toEqual(['—', '0.00 W', '0.00 W', '0.00 W']);
    expect(beforePower[1].slice(1)).toEqual(['100.00 W', '—', '-25.00 W', '75.00 W']);
    expect(beforeSoc[0][1]).toBe('—');
    expect(beforeSoc[1][1]).toBe('0%');
    const power = card('Power Over Time');
    await waitFor(() => {
      for (const name of ['Solar', 'Battery', 'Grid', 'Home']) {
        expect(within(power).getByRole('button', { name, exact: true })).toBeInTheDocument();
      }
    });
    fireEvent.click(within(power).getByRole('button', { name: 'Solar', exact: true }));
    expect(within(power).getByRole('button', { name: 'Solar', exact: true })).toHaveAttribute('aria-pressed', 'true');
    h.live.mockReturnValue(query(live, h.liveRetry, new ApiError('live refresh failed', 503)));
    h.history.mockReturnValue(query(history, h.historyRetry, new ApiError('history refresh failed', 503)));
    view.update();
    expect(tableRows('Power Over Time')).toEqual(beforePower);
    expect(tableRows('Battery State of Charge')).toEqual(beforeSoc);
    expect(within(screen.getByRole('region', { name: 'Current power' })).getByText('-1.50 kW')).toBeInTheDocument();
    expect(within(card('Battery State')).getByRole('meter', { name: 'State of Charge' }))
      .toHaveAttribute('aria-valuenow', '46.3');
    exportCsv('Power Over Time');
    const expected = [
      'time,solar,battery,grid,load',
      ...history.map(sample => [
        Date.parse(sample.timestamp), sample.solar_power, sample.battery_power, sample.grid_power, sample.load_power,
      ].map(value => value ?? '').join(',')),
    ].join('\r\n');
    expect(h.download).toHaveBeenLastCalledWith(expect.any(String), expected);
    fireEvent.click(within(warning('Energy status history')).getByRole('button', { name: 'Refresh', exact: true }));
    expect(h.historyRetry).toHaveBeenCalledOnce();
    expect(h.liveRetry).not.toHaveBeenCalled();
    fireEvent.click(within(warning('Live energy status')).getByRole('button', { name: 'Refresh', exact: true }));
    expect(h.liveRetry).toHaveBeenCalledOnce();
    h.history.mockReturnValue(query(history, h.historyRetry));
    view.update();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    expect(tableRows('Power Over Time')).toEqual(beforePower);
    expect(within(card('Power Over Time')).getByRole('button', { name: 'Solar', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(h.mutate).not.toHaveBeenCalled();
  });
});
