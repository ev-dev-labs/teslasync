import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { ChartContainerProps } from '@/components/charts';
import type { ChargingSession } from '@/types/charging';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { neonColorMap } from '@/lib/tokens';
import ChargerResiliencePage from './ChargerResiliencePage';

const h = vi.hoisted(() => ({
  query: {} as DataStateSource<ChargingSession[]> & { isLoading: boolean },
  chart: undefined as ChartContainerProps | undefined,
  refetch: vi.fn(),
  formatEnergy: vi.fn((wh: number) => `${wh} Wh`),
}));
vi.mock('@/api/hooks/useCharging', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useCharging')>(),
  useChargingHistory: () => h.query,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatEnergy: h.formatEnergy }),
}));
vi.mock('@/components/motion', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    ChartContainer: (props: ChartContainerProps) => {
      h.chart = props;
      return <actual.ChartContainer {...props} />;
    },
  };
});

const longSite = 'Home charging location with a complete specialist label longer than twenty characters';
function session(id: string, place: string, wh: number): ChargingSession {
  const started = '2026-01-01T00:00:00Z';
  return {
    id, vehicle_id: '7', charger_type: 'AC', start_soc_pct: 30, end_soc_pct: 70,
    total_energy_added_wh: wh, peak_power_w: 7000, cost_decimal: null,
    started_at: started, ended_at: '2026-01-01T02:00:00Z',
    start_ts: started, startedAt: started, duration_min: 120,
    start_place: place, start_lat: null, start_lng: null,
  };
}
const sessions = [
  session('one', longSite, 10_000), session('two', longSite, 10_000),
  session('three', 'Backup station', 5000),
];
const preferences = getFormatterPreferences();
const clients: QueryClient[] = [];
function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/charger-resilience']}>
        <ChargerResiliencePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  h.chart = undefined;
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
  h.query = {
    data: sessions, error: null, isError: false, isLoading: false,
    isFetching: false, fetchStatus: 'idle', dataUpdatedAt: 1, refetch: h.refetch,
  };
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  setGlobalPrecision(preferences.precision);
  setGlobalLocale(preferences.locale);
});

describe('charger resilience page-local modernization', () => {
  it('preserves every scalar row and adds textual top-site identity to the table, export and site detail', () => {
    mountPage();
    const rows = [
      { site: longSite, share: 80, sessions: 2, dependency: 'Top-Site Dependency' },
      { site: 'Backup station', share: 20, sessions: 1, dependency: '—' },
    ];
    expect(h.chart?.data).toEqual(rows);
    expect(h.chart?.exportData).toEqual(rows);
    const chart = screen.getByRole('figure', { name: 'Energy Share by Site' });
    const tableRows = within(chart).getAllByRole('row');
    expect(tableRows).toHaveLength(3);
    expect(within(tableRows[1]!).getAllByRole('cell').map(cell => cell.textContent)).toEqual([
      longSite, '80', '2', 'Top-Site Dependency',
    ]);
    expect(within(tableRows[2]!).getAllByRole('cell').map(cell => cell.textContent)).toEqual([
      'Backup station', '20', '1', '—',
    ]);
    const siteRow = screen.getAllByText(longSite).find(node => node.closest('li'))?.closest('li');
    expect(siteRow).toHaveTextContent('Named place');
    expect(siteRow).toHaveTextContent('2 sessions');
    expect(siteRow).toHaveTextContent('80.00%');
    expect(siteRow).toHaveTextContent('Top-Site Dependency');
    fireEvent.click(within(chart).getByRole('button', { name: 'Export chart' }));
    expect(within(chart).getByRole('menuitem', { name: 'Download data as CSV' })).toBeInTheDocument();
  });

  it.each(['refresh-error', 'paused'] as const)('explains retained empty sections with one source recovery for %s', mode => {
    h.query = {
      ...h.query, data: [], error: mode === 'refresh-error' ? new Error('Refresh failed') : null,
      isError: mode === 'refresh-error', fetchStatus: mode === 'paused' ? 'paused' : 'idle',
    };
    const { container } = mountPage();
    expect(screen.getByText('What If the Top Site Disappeared?')).toBeInTheDocument();
    expect(screen.getByText('Sites')).toBeInTheDocument();
    expect(screen.getByText('Not enough data to model a loss scenario yet.')).toBeInTheDocument();
    expect(screen.getAllByText('No charging locations recorded yet.')).toHaveLength(2);
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(4);
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    expect(screen.queryAllByRole('button', { name: 'Retry' })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('associates all what-if terms with locale-formatted values while passing unchanged Wh to display conversion', () => {
    setGlobalLocale('de-DE');
    const { container } = mountPage();
    const fields = [
      ['Energy at risk', '20000 Wh'], ['New top site', 'Backup station'],
      ['Score before', '22,00'], ['Score after loss', '0,00 (-22,00)'],
    ];
    for (const [term, value] of fields) {
      const label = screen.getByText(term!);
      expect(label.tagName).toBe('DT');
      expect(label.nextElementSibling?.tagName).toBe('DD');
      expect(label.nextElementSibling).toHaveTextContent(value!);
    }
    expect(container.querySelectorAll('dl dt')).toHaveLength(4);
    expect(h.formatEnergy).toHaveBeenCalledWith(20_000);
    expect(screen.getByText('0,00 (-22,00)')).toHaveClass(neonColorMap.red.text);
    expect(sessions.map(item => item.total_energy_added_wh)).toEqual([10_000, 10_000, 5000]);
  });

  it.each([
    { id: 'below', wh: 49, warning: false },
    { id: 'boundary', wh: 50, warning: true },
    { id: 'above', wh: 51, warning: true },
  ])('preserves the concentration warning threshold and quiets ordinary shares for $id', ({ wh, warning }) => {
    h.query = { ...h.query, data: [session('alpha', 'Alpha', wh), session('backup', 'Backup', 100 - wh)] };
    mountPage();
    const siteRow = screen.getAllByText('Alpha').find(node => node.closest('li'))?.closest('li');
    expect(siteRow).not.toBeNull();
    const share = within(siteRow!).getByText(`${wh.toFixed(2)}%`);
    expect(share).toHaveClass(warning ? 'text-[var(--semantic-warning)]' : 'text-[var(--text-secondary)]');
    expect(share).not.toHaveClass('text-[var(--semantic-info)]');
  });

  it('keeps measured zero scores and signed zero distinct from an empty history', () => {
    h.query = { ...h.query, data: [sessions[0]!] };
    const { container } = mountPage();
    expect(container.querySelector('[data-operational-metric]')).toHaveAttribute('data-value-state', 'value');
    expect(screen.getByText('0.00 (+0.00)')).toHaveClass(neonColorMap.green.text);
    expect(screen.getByText('None yet')).toBeInTheDocument();
    expect(screen.getByText('10000 Wh')).toBeInTheDocument();
  });
});
