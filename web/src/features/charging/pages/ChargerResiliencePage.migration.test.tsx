/** Authored, NOTRUN: real page/cards/stats/source recovery; no browser acceptance claim. */
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { ChargingSession } from '@/types/charging';
import { analyzeChargerResilience } from '../lib/chargerResilience';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import ChargerResiliencePage from './ChargerResiliencePage';

const h = vi.hoisted(() => ({
  query: {} as DataStateSource<ChargingSession[]> & { isLoading: boolean },
  refetch: vi.fn(),
}));
vi.mock('@/api/hooks/useCharging', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/hooks/useCharging')>();
  return { ...actual, useChargingHistory: () => h.query };
});
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> };
});
const longSite = 'Home charging location with the complete specialist label longer than twenty characters';
const chartTitle = 'Energy Share by Site';
const chartDescription = 'Bar chart of the percentage of total charging energy delivered at each site';
function session(id: string, location: string, energy: number): ChargingSession {
  const started = '2026-01-01T00:00:00Z';
  return {
    id, vehicle_id: '7', charger_type: 'AC', start_soc_pct: 30, end_soc_pct: 70,
    total_energy_added_wh: energy, peak_power_w: 7000, cost_decimal: null,
    started_at: started, ended_at: '2026-01-01T02:00:00Z',
    start_ts: started, startedAt: started, duration_min: 120,
    start_place: location, start_lat: null, start_lng: null,
  };
}
const sessions = [
  session('one', longSite, 10_000), session('two', longSite, 10_000),
  session('three', 'Backup station', 5000),
];
const clients: QueryClient[] = [];
const preferences = getFormatterPreferences();
function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/charging/resilience']}>
    <ChargerResiliencePage />
  </MemoryRouter></QueryClientProvider>);
}
function tiles(container: HTMLElement) { return container.querySelectorAll('[data-operational-metric]'); }
function assertSections(container: HTMLElement) {
  expect(tiles(container)).toHaveLength(4);
  for (const label of ['Energy Share by Site', 'What If the Top Site Disappeared?', 'Sites'])
    expect(screen.getByText(label)).toBeInTheDocument();
}
beforeEach(() => {
  vi.clearAllMocks();
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

describe('charger resilience canonical migration', () => {
  it('preserves all metrics, full names, original what-if fields, order and complete accessible/export rows', () => {
    const { container } = mountPage();
    assertSections(container);
    const summary = analyzeChargerResilience(sessions);
    const expected = [
      summary.resilienceScore.toFixed(2), summary.effectiveSiteCount.toFixed(2),
      `${summary.topSiteDependencyPct.toFixed(2)}%`, `${summary.fallbackCoveragePct.toFixed(2)}%`,
    ];
    Array.from(tiles(container)).forEach((tile, index) => {
      expect(tile.querySelector('[data-operational-value]')).toHaveTextContent(expected[index]!);
    });
    expect(screen.getAllByText(longSite).length).toBeGreaterThanOrEqual(2);
    for (const label of ['Energy at risk', 'New top site', 'Score before', 'Score after loss'])
      expect(screen.getByText(label)).toBeInTheDocument();
    const chart = screen.getByRole('figure', { name: chartTitle });
    expect(within(chart).getByRole('img', { name: chartDescription })).toBeInTheDocument();
    const table = within(chart).getByRole('table');
    expect(table).toHaveTextContent(longSite);
    expect(table).toHaveTextContent('Backup station');
    fireEvent.click(within(chart).getByRole('button', { name: 'Export chart' }));
    expect(within(chart).getByRole('menuitem', { name: 'Download data as CSV' })).toBeInTheDocument();
  });
  it.each(['refresh-error', 'paused'] as const)('retains all specialist content during %s and provides source retry', mode => {
    h.query = { ...h.query, error: mode === 'refresh-error' ? new Error('Refresh failed') : null,
      isError: mode === 'refresh-error', fetchStatus: mode === 'paused' ? 'paused' : 'idle' };
    const { container } = mountPage();
    assertSections(container);
    expect(container.querySelector('[data-period-kind]')).toHaveAttribute('data-retained', 'true');
    expect(screen.getByRole('figure', { name: chartTitle })).toHaveTextContent(longSite);
    const notice = screen.getByTestId('stale-refresh-warning');
    fireEvent.click(within(notice).getByRole('button', { name: 'Refresh' }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });
  it.each(['loading', 'fatal', 'initial-paused', 'empty'] as const)('retains every source shell without fabricated zeros for %s', mode => {
    h.query = {
      ...h.query, data: mode === 'empty' ? [] : undefined,
      error: mode === 'fatal' ? new Error('Server failed') : null,
      isError: mode === 'fatal', isLoading: mode === 'loading',
      fetchStatus: mode === 'initial-paused' ? 'paused' : mode === 'loading' ? 'fetching' : 'idle',
    };
    const { container } = mountPage();
    assertSections(container);
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(mode === 'loading' ? 0 : 4);
    if (mode === 'loading') expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    for (const tile of tiles(container)) {
      expect(tile).toHaveAttribute('data-value-state', 'missing');
      if (mode !== 'loading') expect(tile.querySelector('[data-operational-value]')).toHaveTextContent(/^—$/);
    }
    if (mode === 'fatal') {
      fireEvent.click(screen.getAllByRole('button', { name: /retry/i })[0]!);
      expect(h.refetch).toHaveBeenCalledTimes(1);
    }
    if (mode === 'initial-paused')
      expect(screen.getAllByText(/Charging history has not loaded/).length).toBeGreaterThan(0);
    if (mode === 'empty')
      expect(screen.getAllByText(/No charging locations recorded yet/).length).toBeGreaterThan(0);
  });
  it('does not confuse a real single-site zero score with unavailable measurements', () => {
    h.query = { ...h.query, data: [sessions[0]!] };
    const { container } = mountPage();
    expect(tiles(container)[0]).toHaveAttribute('data-value-state', 'value');
    expect(tiles(container)[0]?.querySelector('[data-operational-value]')).toHaveTextContent('0.00');
    expect(tiles(container)[3]?.querySelector('[data-operational-value]')).toHaveTextContent('0.00%');
    expect(screen.getByText('None yet')).toBeInTheDocument();
  });
});
