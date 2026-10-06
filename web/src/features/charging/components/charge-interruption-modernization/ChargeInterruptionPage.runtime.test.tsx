/** Authored for the parent's serialized acceptance window; execution NOTRUN. */
import { createElement, type ComponentProps, type PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FadeIn } from '@/components/motion';
import type { DataStateSource } from '@/api/dataState';
import type { ChargingSession } from '@/types/charging';
import { analyzeChargeInterruptions } from '../../lib/chargeInterruption';
import {
  getFormatterPreferences, setGlobalLocale, setGlobalPrecision,
} from '@/lib/numberFormat';
import ChargeInterruptionPage from '../../pages/ChargeInterruptionPage';

const source = vi.hoisted(() => ({
  query: {} as DataStateSource<ChargingSession[]>,
  vehicleId: 7 as number | null,
  historyHook: vi.fn(),
  retry: vi.fn(),
}));
vi.mock('@/api/hooks/useCharging', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useCharging')>(),
  useChargingHistory: (vehicleId?: string) => {
    source.historyHook(vehicleId);
    return source.query;
  },
}));
vi.mock('@/hooks/useSelectedVehicle', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSelectedVehicle')>(),
  useSelectedVehicle: () => ({ vehicleId: source.vehicleId }),
}));
vi.mock('@/components/motion', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
  FadeIn: ({ children, className }: ComponentProps<typeof FadeIn>) =>
    createElement('div', { className }, children),
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const passthrough = ({ children }: PropsWithChildren) => <>{children}</>;
  return {
    ...actual,
    // Keep ChartContainer, exports, accessible table and state surfaces real.
    // Echo identity and visibility; SVG layout remains browser acceptance work.
    ResponsiveContainer: passthrough,
    ComposedChart: passthrough,
    Bar: ({ dataKey, yAxisId, hide }: { dataKey?: string; yAxisId?: string; hide?: boolean }) =>
      <span data-testid="interruption-risk-series" data-key={dataKey} data-axis={yAxisId} data-hidden={String(!!hide)} />,
    Line: ({ dataKey, yAxisId, hide }: { dataKey?: string; yAxisId?: string; hide?: boolean }) =>
      <span data-testid="interruption-evidence-series" data-key={dataKey} data-axis={yAxisId} data-hidden={String(!!hide)} />,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    ChartLegend: () => null,
  };
});

function session(index: number, overrides: Partial<ChargingSession> = {}): ChargingSession {
  const started = new Date(Date.UTC(2026, 8, index + 1)).toISOString();
  return {
    id: String(index), vehicle_id: '7', charger_type: 'AC',
    start_soc_pct: 30, end_soc_pct: 70, total_energy_added_wh: 14_000,
    avg_power_w: 7_000, peak_power_w: 7_000, cost_decimal: null,
    started_at: started, start_ts: started, startedAt: started,
    ended_at: new Date(Date.parse(started) + 7_200_000).toISOString(),
    duration_min: 120, start_place: 'Home',
    ...overrides,
  };
}
const history = [
  session(0, { ended_at: null, end_soc_pct: null }),
  session(1), session(2), session(3), session(4),
  session(5, { start_place: 'A very long workplace charging location name' }),
];
const originalPreferences = getFormatterPreferences();
const clients: QueryClient[] = [];
function LocationProbe() {
  return <output data-testid="charge-interruption-search">{useLocation().search}</output>;
}
function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  function Harness({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/charge-interruption?existing=kept&hidden_charge-interruption-risk-by-site=evidence']}>
          {children}<LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  // Keep Router + QueryClient mounted through all rerenders.
  return render(<ChargeInterruptionPage />, { wrapper: Harness });
}
function tiles(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-operational-metric]'));
}
function sites(container: HTMLElement) {
  const title = Array.from(container.querySelectorAll('h2,h3'))
    .find(element => element.textContent?.includes('Sites'));
  const panel = title?.closest<HTMLElement>('[data-card]');
  if (!panel) throw new Error('Sites panel shell missing');
  return panel;
}
function figure() {
  return screen.getByRole('figure', {
    name: 'Posterior Risk by Site',
  });
}
function assertSeries() {
  expect(figure()).toHaveAttribute('data-chart-key', 'charge-interruption-risk-by-site');
  expect(screen.getByTestId('interruption-risk-series')).toHaveAttribute('data-key', 'risk');
  expect(screen.getByTestId('interruption-risk-series')).toHaveAttribute('data-axis', 'risk');
  expect(screen.getByTestId('interruption-risk-series')).toHaveAttribute('data-hidden', 'false');
  expect(screen.getByTestId('interruption-evidence-series')).toHaveAttribute('data-key', 'evidence');
  expect(screen.getByTestId('interruption-evidence-series')).toHaveAttribute('data-axis', 'evidence');
  expect(screen.getByTestId('interruption-evidence-series')).toHaveAttribute('data-hidden', 'true');
}

beforeEach(() => {
  source.historyHook.mockReset();
  source.retry.mockReset();
  source.vehicleId = 7;
  source.query = {
    data: history, isLoading: false, fetchStatus: 'idle', dataUpdatedAt: 1,
    refetch: source.retry,
  };
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  setGlobalPrecision(originalPreferences.precision);
  setGlobalLocale(originalPreferences.locale);
});

describe('ChargeInterruptionPage preservation and trust (authored, NOTRUN)', () => {
  it('preserves original metrics and site facts while completing the loaded/evaluable summary', () => {
    const result = mountPage();
    const summary = analyzeChargeInterruptions(history);
    expect(source.historyHook).toHaveBeenLastCalledWith('7');
    expect(tiles(result.container)).toHaveLength(6);
    const labels = tiles(result.container).map(tile => tile.querySelector(':scope > div:first-child > div:first-child')?.textContent);
    expect(labels).toEqual([
      'Overall Risk', 'Suspected Sessions', 'Highest-Risk Site',
      'Sites Tracked', 'Loaded sessions', 'Evaluable sessions',
    ]);
    expect(tiles(result.container)[0]?.querySelector('[data-operational-value]'))
      .toHaveTextContent((summary.overallPosteriorMean * 100).toFixed(2));
    expect(tiles(result.container)[1]?.querySelector('[data-operational-value]'))
      .toHaveTextContent(String(summary.suspectedSessions));
    expect(tiles(result.container)[2]?.querySelector(':scope > div:last-child'))
      .toHaveTextContent(summary.highestRiskSite!.label);
    expect(tiles(result.container)[3]?.querySelector('[data-operational-value]')).toHaveTextContent('2');
    expect(tiles(result.container)[4]?.querySelector('[data-operational-value]')).toHaveTextContent('6');
    expect(tiles(result.container)[5]?.querySelector('[data-operational-value]'))
      .toHaveTextContent(String(summary.evaluableSessions));
    assertSeries();
    const details = sites(result.container);
    for (const text of [
      'Home', 'A very long workplace charging location name', 'Posterior risk',
      'Evidence', 'Last suspected', 'Not enough history', 'No end SoC recorded',
      'No end timestamp recorded',
    ]) expect(within(details).getAllByText(text, { exact: true }).length).toBeGreaterThan(0);
    expect(details.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText(/Coverage and time bounds are not reported/)).toBeInTheDocument();
    expect(result.container.querySelector('[data-layout-reference]')).toHaveClass('w-full', 'min-w-0');
    expect(result.container.querySelector('[data-period-kind]')).toHaveAttribute('data-period-kind', 'unknown');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('keeps all source data and URL state after refresh failure, and retries the history source', () => {
    const result = mountPage();
    const values = tiles(result.container).map(tile => tile.querySelector('[data-operational-value]')?.textContent);
    source.query = { ...source.query, error: new Error('private backend failure detail'), isError: true };
    result.rerender(<ChargeInterruptionPage />);
    expect(tiles(result.container).map(tile => tile.querySelector('[data-operational-value]')?.textContent)).toEqual(values);
    expect(sites(result.container).querySelectorAll('li')).toHaveLength(2);
    expect(within(figure()).getByRole('table')).toBeInTheDocument();
    assertSeries();
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveTextContent('Charging history may be out of date');
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh', exact: true }));
    expect(source.retry).toHaveBeenCalledOnce();
    expect(screen.queryByText('private backend failure detail')).not.toBeInTheDocument();
    expect(screen.getByTestId('charge-interruption-search')).toHaveTextContent('existing=kept');
    expect(screen.getByTestId('charge-interruption-search')).toHaveTextContent('hidden_charge-interruption-risk-by-site=evidence');
  });

  it('distinguishes retained offline history from an initial paused query without claiming empty history', () => {
    const result = mountPage();
    source.query = { ...source.query, fetchStatus: 'paused' };
    result.rerender(<ChargeInterruptionPage />);
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('offline');
    expect(tiles(result.container).every(tile => tile.getAttribute('data-value-state') === 'value')).toBe(true);
    assertSeries();
    source.query = { fetchStatus: 'paused', refetch: source.retry };
    result.rerender(<ChargeInterruptionPage />);
    expect(tiles(result.container).every(tile => tile.getAttribute('data-value-state') === 'missing')).toBe(true);
    expect(within(sites(result.container)).getByText('Charging history loading is paused. Connect to resume or retry.')).toBeInTheDocument();
    expect(screen.queryByText('No charging locations recorded yet.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
    expect(source.retry).toHaveBeenCalledOnce();
  });

  it('retains every shell through loading, friendly fatal error and successful empty history', () => {
    source.query = { isLoading: true, isPending: true, fetchStatus: 'fetching', refetch: source.retry };
    const result = mountPage();
    expect(tiles(result.container)).toHaveLength(6);
    expect(result.container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(result.container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(figure()).toHaveAttribute('aria-busy', 'true');
    expect(sites(result.container)).toBeInTheDocument();
    source.query = { isError: true, error: new Error('raw private transport error'), refetch: source.retry };
    result.rerender(<ChargeInterruptionPage />);
    expect(tiles(result.container).every(tile => tile.getAttribute('data-value-state') === 'missing')).toBe(true);
    expect(within(sites(result.container)).getByRole('alert')).toHaveTextContent("Can't reach server");
    expect(screen.queryByText('raw private transport error')).not.toBeInTheDocument();
    fireEvent.click(within(sites(result.container)).getByRole('button', { name: 'Retry', exact: true }));
    expect(source.retry).toHaveBeenCalledOnce();
    source.query = { data: [], refetch: source.retry };
    result.rerender(<ChargeInterruptionPage />);
    expect(tiles(result.container)[0]?.querySelector('[data-operational-value]')).toHaveTextContent('50.00');
    expect(tiles(result.container)[0]?.querySelector(':scope > div:last-child')).toHaveTextContent('model prior');
    expect(tiles(result.container)[1]?.querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(tiles(result.container)[2]).toHaveAttribute('data-value-state', 'missing');
    expect(tiles(result.container)[4]?.querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(within(sites(result.container)).getByText('No charging locations recorded yet.')).toBeInTheDocument();
    expect(within(figure()).getByText(/No charging location has enough history/)).toBeInTheDocument();
  });

  it('preserves current locale and precision reactively without changing the model or requerying', () => {
    const result = mountPage();
    const summary = analyzeChargeInterruptions(history);
    const calls = source.historyHook.mock.calls.length;
    act(() => { setGlobalLocale('de-DE'); setGlobalPrecision(3); });
    const expected = (summary.overallPosteriorMean * 100).toLocaleString('de-DE', {
      minimumFractionDigits: 3, maximumFractionDigits: 3,
    });
    expect(tiles(result.container)[0]?.querySelector('[data-operational-value]')).toHaveTextContent(expected);
    expect(tiles(result.container)[0]?.querySelector('[data-operational-value]')).toHaveTextContent('%');
    expect(tiles(result.container)[4]?.querySelector('[data-operational-value]')).toHaveTextContent('6');
    // Renders may re-invoke a hook; retries/network are never triggered by formatting.
    expect(source.historyHook.mock.calls.length).toBeGreaterThanOrEqual(calls);
    expect(source.retry).not.toHaveBeenCalled();
    expect(analyzeChargeInterruptions(history)).toEqual(summary);
  });

  it('keeps all five chart columns, accessible rows, image exports and supplied CSV data without inventing plot controls', () => {
    mountPage();
    const table = within(figure()).getByRole('table');
    assertSeries();
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(table).toHaveTextContent('Home');
    expect(table).toHaveTextContent('A very long workplace charging location name');
    for (const label of ['Site', 'Risk (%)', 'Low bound (%)', 'High bound (%)', 'Evidence (sessions)']) {
      expect(within(table).getByRole('columnheader', { name: label, exact: true })).toBeInTheDocument();
    }
    fireEvent.click(within(figure()).getByRole('button', { name: 'Export chart', exact: true }));
    const menu = within(figure()).getByRole('menu', { name: 'Export chart', exact: true });
    for (const name of ['Save as PNG', 'Save as SVG', 'Copy image to clipboard']) {
      expect(within(menu).getByRole('menuitem', { name, exact: true })).toBeInTheDocument();
    }
    expect(within(menu).getByRole('menuitem', { name: 'Download data as CSV' })).toBeInTheDocument();
    expect(within(figure()).queryByRole('button', { name: /fullscreen|annotation/i })).not.toBeInTheDocument();
  });

  it('does not truncate sites or suppress null-date details in the responsive card strategy', () => {
    source.query = {
      ...source.query,
      data: Array.from({ length: 25 }, (_, index) => session(index, {
        start_place: `Long charging location ${index} with a full descriptive name`,
      })),
    };
    const result = mountPage();
    const details = sites(result.container);
    expect(details.querySelectorAll('li')).toHaveLength(25);
    expect(within(details).getAllByText('Last suspected', { exact: true })).toHaveLength(25);
    expect(within(details).getAllByText('—', { exact: true })).toHaveLength(25);
    expect(details.querySelector('ul')).toHaveClass('grid-cols-1', '@3xl:grid-cols-2', '@6xl:grid-cols-3');
  });

  it('keeps the no-vehicle onboarding boundary and does not query a fabricated vehicle', () => {
    source.vehicleId = null;
    mountPage();
    expect(source.historyHook).toHaveBeenLastCalledWith(undefined);
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    expect(screen.queryByText('Loaded sessions')).not.toBeInTheDocument();
  });
});
