/** Authored runtime coverage — NOTRUN. Parent owns heavy/browser acceptance. */
import { createElement, type ComponentProps, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PageContainer } from '@/components/layout';
import type { FadeIn } from '@/components/motion';
import type { DataStateSource } from '@/api/dataState';
import type { ChargingSession } from '@/types/charging';
import ChargerHealthPage from '../../pages/ChargerHealthPage';

const sources = vi.hoisted(() => ({
  sessions: {} as DataStateSource<ChargingSession[]>,
  vehicleId: 7 as number | null,
  sessionsHook: vi.fn(),
  retry: vi.fn(),
}));
vi.mock('@/api/hooks/useCharging', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useCharging')>(),
  useChargingSessions: (vehicleId?: string) => {
    sources.sessionsHook(vehicleId);
    return sources.sessions;
  },
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: sources.vehicleId }),
}));
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return {
    ...actual,
    FadeIn: ({ children, className }: ComponentProps<typeof FadeIn>) =>
      createElement('div', { className }, children),
  };
});
vi.mock('@/components/layout', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/layout')>();
  return {
    ...actual,
    // Only external shell composition is doubled, not the production adapters.
    PageContainer: ({ title, children }: ComponentProps<typeof PageContainer>) =>
      createElement('main', null, createElement('h1', null, title), children),
  };
});
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const passthrough = ({ children }: PropsWithChildren) => <>{children}</>;
  return {
    ...actual,
    // Keep ChartContainer/export/accessibility real; replace SVG geometry only.
    ResponsiveContainer: passthrough,
    BarChart: passthrough,
    Bar: passthrough,
    Cell: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ReferenceLine: () => null,
  };
});

function session(index: number, powerW: number): ChargingSession {
  const started = new Date(Date.UTC(2026, 8, index + 1));
  const ended = new Date(started.getTime() + 3600_000);
  return {
    id: String(index + 1), vehicle_id: '7', start_place: 'Home',
    charger_type: 'AC', start_soc_pct: 20, end_soc_pct: 60,
    total_energy_added_wh: powerW, peak_power_w: powerW, cost_decimal: null,
    started_at: started.toISOString(), ended_at: ended.toISOString(),
    start_ts: started.toISOString(), startedAt: started.toISOString(), duration_min: 60,
  };
}
const sessions = Array.from({ length: 10 }, (_, index) => session(index, index < 5 ? 10_000 : 7_000));
const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
function resizeAllocatedWidth(width: number) {
  act(() => {
    observers.forEach(({ element, callback }) => callback(
      [{ target: element, contentRect: { width } } as ResizeObserverEntry],
      {} as ResizeObserver,
    ));
  });
}
function LocationProbe() {
  return createElement('output', { 'data-testid': 'current-search' }, useLocation().search);
}
function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/charging/charger-health?existing=kept']}>
        {children}<LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>;
  }
  // A stable wrapper and real Router persist through every rerender.
  return render(<ChargerHealthPage />, { wrapper: Harness });
}
function metricTiles(container: HTMLElement) {
  return container.querySelectorAll('[data-stat]');
}
function chart() {
  return screen.getByRole('figure', { name: 'Recent Power vs. Own Baseline' });
}
function locations(container: HTMLElement) {
  const card = Array.from(container.querySelectorAll('[data-card-title]'))
    .find(heading => heading.textContent === 'Locations')?.closest('[data-card]');
  if (!card) throw new Error('Locations shell missing');
  return card as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
  sources.vehicleId = 7;
  sources.sessions = {
    data: sessions, fetchStatus: 'idle', isLoading: false, dataUpdatedAt: 1, refetch: sources.retry,
  };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ChargerHealthPage live modernization (execution NOTRUN)', () => {
  it('retains all three sections, four metrics, comparison and original site fields', () => {
    const result = mountPage();
    resizeAllocatedWidth(1280);
    expect(sources.sessionsHook).toHaveBeenLastCalledWith('7');
    expect(metricTiles(result.container)).toHaveLength(4);
    expect(metricTiles(result.container)[0]?.querySelector('[data-stat-value]')).toHaveTextContent('1');
    expect(metricTiles(result.container)[1]?.querySelector('[data-stat-value]')).toHaveTextContent('1');
    expect(metricTiles(result.container)[2]?.querySelector('[data-stat-value]')).toHaveTextContent('10.00');
    expect(metricTiles(result.container)[3]?.querySelector('[data-stat-value]')).toHaveTextContent('148');
    const context = metricTiles(result.container)[0]?.querySelector('[data-stat-context]');
    expect(context).toHaveTextContent('10 scorable sessions');
    const fallback = within(chart()).getByRole('table');
    expect(fallback).toHaveTextContent('70');
    expect(fallback).toHaveTextContent('10');
    expect(fallback).toHaveTextContent('7');
    const table = within(locations(result.container)).getByRole('table', { name: 'Locations' });
    for (const value of ['Home', 'Degraded', 'AC', '10.00 kW', '7.00 kW', '85.00 kWh', '10 (10 scored)', '148 h/year']) {
      expect(table).toHaveTextContent(value);
    }
    expect(screen.getByText(/not directly measured charger condition/)).toBeInTheDocument();
    expect(screen.getByTestId('current-search')).toHaveTextContent('?existing=kept');
  });

  it('retains data, URL and all shells after a failed refresh and retries only the existing source', () => {
    const result = mountPage();
    sources.sessions = { ...sources.sessions, error: new Error('background failure'), isError: true };
    result.rerender(<ChargerHealthPage />);
    expect(metricTiles(result.container)).toHaveLength(4);
    expect(metricTiles(result.container)[2]?.querySelector('[data-stat-value]')).toHaveTextContent('10.00');
    expect(within(chart()).getByRole('table')).toHaveTextContent('70');
    const warnings = screen.getAllByTestId('stale-refresh-warning');
    expect(warnings).toHaveLength(3);
    fireEvent.click(within(warnings[0]!).getByRole('button', { name: 'Refresh' }));
    expect(sources.retry).toHaveBeenCalledOnce();
    expect(screen.getByTestId('current-search')).toHaveTextContent('?existing=kept');
  });

  it('distinguishes retained offline history from initial paused recovery', () => {
    const result = mountPage();
    sources.sessions = { ...sources.sessions, fetchStatus: 'paused' };
    result.rerender(<ChargerHealthPage />);
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(3);
    expect(metricTiles(result.container)[2]).toHaveAttribute('data-state', 'value');
    sources.sessions = { fetchStatus: 'paused', isLoading: false, refetch: sources.retry };
    result.rerender(<ChargerHealthPage />);
    expect(metricTiles(result.container)).toHaveLength(4);
    for (const tile of metricTiles(result.container)) expect(tile).toHaveAttribute('data-state', 'missing');
    expect(screen.getAllByText('Charging sessions loading is paused. Connect to resume or retry.').length).toBeGreaterThan(0);
    fireEvent.click(within(locations(result.container)).getByRole('button', { name: 'Retry' }));
    expect(sources.retry).toHaveBeenCalledOnce();
    expect(within(locations(result.container)).queryByText('No charging locations recorded yet.')).not.toBeInTheDocument();
  });

  it('keeps all metric and panel shells through initial loading, fatal failure and successful empty', () => {
    sources.sessions = { isLoading: true, isPending: true, fetchStatus: 'fetching', refetch: sources.retry };
    const result = mountPage();
    expect(result.container.querySelectorAll('[data-stat][data-state="loading"]')).toHaveLength(4);
    expect(chart()).toHaveAttribute('aria-busy', 'true');
    expect(locations(result.container)).toBeInTheDocument();
    sources.sessions = { error: new Error('initial failure'), isError: true, fetchStatus: 'idle', refetch: sources.retry };
    result.rerender(<ChargerHealthPage />);
    expect(metricTiles(result.container)).toHaveLength(4);
    // Shared friendly classifier text, not raw Error.message.
    expect(within(locations(result.container)).getByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(within(locations(result.container)).getByRole('button', { name: 'Retry' }));
    expect(sources.retry).toHaveBeenCalledOnce();
    sources.sessions = { data: [], fetchStatus: 'idle', refetch: sources.retry };
    result.rerender(<ChargerHealthPage />);
    expect(metricTiles(result.container)[0]?.querySelector('[data-stat-value]')).toHaveTextContent('0');
    for (const tile of Array.from(metricTiles(result.container)).slice(1)) expect(tile).toHaveAttribute('data-state', 'missing');
    expect(within(locations(result.container)).getByText('No charging locations recorded yet.')).toBeInTheDocument();
    expect(within(chart()).getByText(/No charging location has enough clean sessions/)).toBeInTheDocument();
  });

  it('does not turn an unrated baseline sentinel into zero power or healthy status', () => {
    sources.sessions = { ...sources.sessions, data: [sessions[0]!] };
    const result = mountPage();
    resizeAllocatedWidth(1280);
    expect(metricTiles(result.container)[0]).toHaveAttribute('data-state', 'value');
    for (const tile of Array.from(metricTiles(result.container)).slice(1)) expect(tile).toHaveAttribute('data-state', 'missing');
    const table = within(locations(result.container)).getByRole('table', { name: 'Locations' });
    expect(table).toHaveTextContent('Not enough data');
    expect(within(table).queryByRole('cell', { name: '0.00 kW', exact: true })).not.toBeInTheDocument();
    const cells = within(within(table).getByRole('row', { name: /^Home/ })).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent(/^—$/);
    expect(cells[4]).toHaveTextContent(/^10.00 kW$/);
    expect(table).not.toHaveTextContent('Healthy');
  });

  it('retains image export and accessible table, adds complete CSV, and leaves fullscreen/annotation defaults unchanged', () => {
    mountPage();
    const figure = chart();
    expect(within(figure).getByRole('table')).toBeInTheDocument();
    expect(within(figure).queryByRole('button', { name: /fullscreen/i })).not.toBeInTheDocument();
    expect(within(figure).queryByRole('button', { name: /annotation/i })).not.toBeInTheDocument();
    fireEvent.click(within(figure).getByRole('button', { name: 'Export chart' }));
    const menu = within(figure).getByRole('menu', { name: 'Export chart' });
    for (const name of ['Save as PNG', 'Save as SVG', 'Copy image to clipboard']) {
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument();
    }
    expect(within(menu).getByRole('menuitem', { name: 'Download data as CSV' })).toBeInTheDocument();
  });

  it.each([320, 375, 390, 430, 639])('preserves all site facts at %i allocated mobile pixels and returns to desktop', width => {
    const result = mountPage();
    resizeAllocatedWidth(width);
    const mobile = locations(result.container).querySelector('[data-mobile-table]');
    expect(mobile).not.toBeNull();
    expect(within(mobile as HTMLElement).getByText('7.00 kW')).toBeInTheDocument();
    fireEvent.click(within(mobile as HTMLElement).getByRole('button', { name: 'Quick view' }));
    const dialog = screen.getByRole('dialog', { name: 'Home' });
    for (const label of ['Baseline', 'Recent', 'Energy taken', 'Visits', 'Last visit', 'Costs you', 'Inferred AC / DC class']) {
      expect(within(dialog).getByText(label, { exact: true })).toBeInTheDocument();
    }
    expect(within(dialog).getByText('85.00 kWh')).toBeInTheDocument();
    expect(within(dialog).getByText('148 h/year')).toBeInTheDocument();
    const footer = dialog.querySelector('[data-modal-footer]');
    if (!footer) throw new Error('Persistent modal footer missing');
    fireEvent.click(within(footer as HTMLElement).getByRole('button', { name: 'Close', exact: true }));
    resizeAllocatedWidth(640);
    expect(locations(result.container).querySelector('[data-mobile-table]')).toBeNull();
    expect(within(locations(result.container)).getByRole('table', { name: 'Locations' })).toBeInTheDocument();
    expect(screen.getByTestId('current-search')).toHaveTextContent('?existing=kept');
  });
});
