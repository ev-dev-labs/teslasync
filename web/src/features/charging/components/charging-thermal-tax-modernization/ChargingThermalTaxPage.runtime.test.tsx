/** Authored runtime coverage — NOTRUN; parent owns serialized Vitest acceptance. */
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import type { PageContainer } from '@/components/layout';
import type { ChartLegend } from '@/components/charts';
import type { ComponentProps } from 'react';
import type { DataStateSource } from '@/api/dataState';
import type { ChargingSession } from '@/types/charging';
import type { ThermalTaxSample } from '../../lib/chargingThermalTax';
import ChargingThermalTaxPage from '../../pages/ChargingThermalTaxPage';

const sources = vi.hoisted(() => ({
  history: {} as DataStateSource<ChargingSession[]>,
  telemetry: {} as DataStateSource<ThermalTaxSample[]>,
  vehicleId: 7 as number | null,
  historyHook: vi.fn(),
  telemetryHook: vi.fn(),
  historyRetry: vi.fn(),
  telemetryRetry: vi.fn(),
}));

vi.mock('@/api/hooks/useCharging', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useCharging')>(),
  useChargingHistory: (vehicleId?: string) => {
    sources.historyHook(vehicleId);
    return sources.history;
  },
  useChargeTelemetry: (sessionId: number | null) => {
    sources.telemetryHook(sessionId);
    return sources.telemetry;
  },
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: sources.vehicleId }),
}));
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children }: PropsWithChildren) => <>{children}</> };
});
vi.mock('@/components/layout', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/layout')>();
  return {
    ...actual,
    // Shell integrations are outside this focused page test. PageLayout,
    // CardGrid, LayoutCard, StatStrip, DataTable and ChartContainer stay real.
    PageContainer: ({ title, children }: ComponentProps<typeof PageContainer>) =>
      createElement('main', null, createElement('h1', null, title), children),
  };
});
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const passthrough = ({ children }: PropsWithChildren) => <>{children}</>;
  const series = ({ dataKey, hide }: { dataKey: string; hide?: boolean }) =>
    createElement('span', { 'data-test-series': dataKey, 'data-hidden': String(Boolean(hide)) });
  return {
    ...actual,
    // Only plot geometry is doubled; real ChartContainer owns URL state,
    // toolbar, image export and accessible raw-SI fallback table.
    ResponsiveContainer: passthrough,
    ComposedChart: passthrough,
    Area: series,
    Line: series,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ChartLegend: ({ state }: ComponentProps<typeof ChartLegend>) => (
      <Button onClick={() => state?.toggle('heaterW')}>Toggle heater test series</Button>
    ),
  };
});

const session: ChargingSession = {
  id: '42', vehicle_id: '7', charger_type: 'DC', start_soc_pct: 20, end_soc_pct: 50,
  total_energy_added_wh: 1000, peak_power_w: 5000, cost_decimal: null,
  started_at: '2026-10-01T00:00:00Z', ended_at: '2026-10-01T00:02:00Z',
  start_ts: '2026-10-01T00:00:00Z', startedAt: '2026-10-01T00:00:00Z', duration_min: 2,
};
function reading(ts: string, heater: number | null, energy: number): ThermalTaxSample {
  // A typed structural sample, not a fabricated complete API reading.
  return {
    ts, battery_heater_power_w: heater, ac_charging_power_w: 0, dc_charging_power_w: 5000,
    ac_charging_energy_in_wh: 0, dc_charging_energy_in_wh: energy,
  };
}
const samples = [
  reading('2026-10-01T00:00:00Z', 1000, 0),
  reading('2026-10-01T00:01:00Z', 1000, 500),
  reading('2026-10-01T00:02:00Z', 0, 1000),
];
function LocationProbe() {
  return createElement('output', { 'data-testid': 'current-search' }, useLocation().search);
}
function mountPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/charging/thermal-tax']}>
        {children}<LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>;
  }
  // The wrapper and Router instance persist across every rerender below.
  return render(<ChargingThermalTaxPage />, { wrapper: Harness });
}
function chooseSession() {
  fireEvent.change(screen.getByRole('combobox', { name: 'Inspect session' }), { target: { value: '42' } });
}
function metricTiles(container: HTMLElement) {
  return container.querySelectorAll('[data-operational-metric]');
}
const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
function resizeAllocatedWidth(width: number) {
  act(() => {
    observers.forEach(({ element, callback }) => callback(
      [{ target: element, contentRect: { width } } as ResizeObserverEntry],
      {} as ResizeObserver,
    ));
  });
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
  sources.history = {
    data: [session], fetchStatus: 'idle', isLoading: false, dataUpdatedAt: 1,
    refetch: sources.historyRetry,
  };
  sources.telemetry = {
    data: samples, fetchStatus: 'idle', isLoading: false, dataUpdatedAt: 1,
    refetch: sources.telemetryRetry,
  };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ChargingThermalTaxPage live modernization (execution NOTRUN)', () => {
  it('retries an empty history without requesting a fabricated session or hiding analysis shells', () => {
    sources.history = { ...sources.history, data: [] };
    const { container } = mountPage();
    expect(screen.getByText('No charging sessions are available for this vehicle.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(sources.historyRetry).toHaveBeenCalledOnce();
    expect(sources.telemetryRetry).not.toHaveBeenCalled();
    expect(sources.telemetryHook).toHaveBeenLastCalledWith(null);
    expect(metricTiles(container)).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Thermal Phases' })).toBeInTheDocument();
  });
  it('retries the selected empty telemetry from the phase shell without changing selection or metrics', () => {
    sources.telemetry = { ...sources.telemetry, data: [] };
    const { container } = mountPage();
    chooseSession();
    const title = screen.getByRole('heading', { name: 'Thermal Phases' });
    const panel = title.closest('[data-card]');
    expect(panel).not.toBeNull();
    fireEvent.click(within(panel as HTMLElement).getByRole('button', { name: 'Retry' }));
    expect(sources.telemetryRetry).toHaveBeenCalledOnce();
    expect(sources.historyRetry).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Inspect session' })).toHaveValue('42');
    expect(screen.getByText('No usable telemetry to segment into phases.')).toBeInTheDocument();
    for (const tile of metricTiles(container)) expect(tile).toHaveAttribute('data-value-state', 'missing');
  });
  it('keeps all four shells before selection without inventing zero metrics', () => {
    const { container } = mountPage();
    expect(screen.getByRole('heading', { name: 'Inspect session' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Charging thermal tax metrics' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Heater vs. Charge Power' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Thermal Phases' })).toBeInTheDocument();
    expect(metricTiles(container)).toHaveLength(4);
    for (const tile of metricTiles(container)) expect(tile).toHaveAttribute('data-value-state', 'missing');
    expect(sources.historyHook).toHaveBeenCalledWith('7');
    expect(sources.telemetryHook).toHaveBeenCalledWith(null);
  });

  it('retains exact sample-integral metrics, threshold, source and accessible chart series', () => {
    const { container } = mountPage();
    chooseSession();
    expect(sources.telemetryHook).toHaveBeenLastCalledWith(42);
    const tiles = metricTiles(container);
    expect(tiles).toHaveLength(4);
    expect(tiles[0]?.querySelector('[data-operational-value]')).toHaveTextContent('0.03');
    expect(tiles[1]?.querySelector('[data-operational-value]')).toHaveTextContent('2.50');
    expect(tiles[2]?.querySelector('[data-operational-value]')).toHaveTextContent('2m');
    expect(tiles[3]?.querySelector('[data-operational-value]')).toHaveTextContent('1.00');
    expect(screen.getByText('Metered running total')).toBeInTheDocument();
    expect(screen.getByText(/Heater-on threshold: 50 W/)).toBeInTheDocument();
    const chart = screen.getByRole('figure', { name: 'Heater vs. Charge Power' });
    expect(within(chart).getByRole('table')).toBeInTheDocument();
    expect(container.querySelector('[data-test-series="heaterW"]')).toHaveAttribute('data-hidden', 'false');
    expect(container.querySelector('[data-test-series="chargeW"]')).toHaveAttribute('data-hidden', 'false');
  });

  it('keeps selection, values, phase rows and URL legend state through independent refresh failures', () => {
    const result = mountPage();
    chooseSession();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle heater test series' }));
    expect(screen.getByTestId('current-search')).toHaveTextContent('hidden_charging-thermal-tax-power=heaterW');
    sources.history = { ...sources.history, error: new Error('history refresh failed'), isError: true };
    sources.telemetry = { ...sources.telemetry, error: new Error('telemetry refresh failed'), isError: true };
    result.rerender(<ChargingThermalTaxPage />);
    expect(screen.getByRole('combobox', { name: 'Inspect session' })).toHaveValue('42');
    expect(metricTiles(result.container)[0]?.querySelector('[data-operational-value]')).toHaveTextContent('0.03');
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(result.container.querySelector('[data-test-series="heaterW"]')).toHaveAttribute('data-hidden', 'true');
    expect(screen.getByText('Metered running total')).toBeInTheDocument();
    fireEvent.click(within(screen.getAllByTestId('stale-refresh-warning')[0]!).getByRole('button', { name: 'Refresh' }));
    fireEvent.click(within(screen.getAllByTestId('stale-refresh-warning')[1]!).getByRole('button', { name: 'Refresh' }));
    expect(sources.historyRetry).toHaveBeenCalledOnce();
    expect(sources.telemetryRetry).toHaveBeenCalledOnce();
  });

  it('shows retained offline facts, then initial paused recovery without an empty-success claim', () => {
    const result = mountPage();
    chooseSession();
    sources.telemetry = { ...sources.telemetry, fetchStatus: 'paused' };
    result.rerender(<ChargingThermalTaxPage />);
    expect(screen.getByText(/device is offline/)).toBeInTheDocument();
    expect(metricTiles(result.container)[0]).toHaveAttribute('data-value-state', 'value');
    sources.telemetry = { fetchStatus: 'paused', isLoading: false, refetch: sources.telemetryRetry };
    result.rerender(<ChargingThermalTaxPage />);
    expect(screen.getAllByText('Telemetry loading is paused. Connect to resume or retry.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(sources.telemetryRetry).toHaveBeenCalledOnce();
    expect(metricTiles(result.container)).toHaveLength(4);
  });

  it('does not display unavailable heater inputs as zero or no-tax; retains delivered-energy provenance', () => {
    sources.telemetry = { ...sources.telemetry, data: samples.map(sample => ({ ...sample, battery_heater_power_w: null })) };
    const { container } = mountPage();
    chooseSession();
    for (const tile of metricTiles(container)) expect(tile).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText('Metered running total')).toBeInTheDocument();
    expect(screen.getByText(/missing readings do not mean no heater draw/)).toBeInTheDocument();
    expect(screen.getAllByText('Heater state uncertain').length).toBeGreaterThan(0);
  });

  it('preserves meaningful measured zero and distinguishes power-integral fallback estimates', () => {
    sources.telemetry = { ...sources.telemetry, data: samples.map(sample => ({
      ...sample, battery_heater_power_w: 0, ac_charging_energy_in_wh: null, dc_charging_energy_in_wh: null,
    })) };
    const { container } = mountPage();
    chooseSession();
    for (const tile of metricTiles(container)) expect(tile).toHaveAttribute('data-value-state', 'value');
    expect(metricTiles(container)[0]?.querySelector('[data-operational-value]')).toHaveTextContent('0.00');
    expect(screen.getByText('Estimated from instantaneous power')).toBeInTheDocument();
  });

  it('keeps KPI slots and independent history usable through telemetry initial loading, failure and empty', () => {
    sources.telemetry = { isLoading: true, isPending: true, fetchStatus: 'fetching', refetch: sources.telemetryRetry };
    const result = mountPage();
    chooseSession();
    expect(metricTiles(result.container)).toHaveLength(4);
    expect(result.container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(result.container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    sources.telemetry = { error: new Error('telemetry failed'), isError: true, fetchStatus: 'idle', refetch: sources.telemetryRetry };
    result.rerender(<ChargingThermalTaxPage />);
    expect(screen.getByRole('combobox', { name: 'Inspect session' })).not.toBeDisabled();
    expect(metricTiles(result.container)).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /retry/i }).length).toBeGreaterThan(0);
    sources.telemetry = { data: [], fetchStatus: 'idle', refetch: sources.telemetryRetry };
    result.rerender(<ChargingThermalTaxPage />);
    expect(screen.getByText('No telemetry samples were recorded for this session.')).toBeInTheDocument();
    expect(screen.getByText('No usable telemetry to segment into phases.')).toBeInTheDocument();
  });

  it('retains image export, adds complete CSV, and preserves fullscreen/annotation defaults', () => {
    mountPage();
    chooseSession();
    const chart = screen.getByRole('figure', { name: 'Heater vs. Charge Power' });
    expect(within(chart).getByRole('button', { name: /export/i })).toBeInTheDocument();
    expect(within(chart).queryByRole('button', { name: /fullscreen/i })).not.toBeInTheDocument();
    expect(within(chart).queryByRole('button', { name: /annotation/i })).not.toBeInTheDocument();
    fireEvent.click(within(chart).getByRole('button', { name: 'Export chart' }));
    const menu = within(chart).getByRole('menu', { name: 'Export chart' });
    expect(within(menu).getByRole('menuitem', { name: 'Save as PNG' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Save as SVG' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Copy image to clipboard' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Download data as CSV' })).toBeInTheDocument();
  });

  it.each([320, 375, 390, 430, 639])('uses the real mobile phase surface at %i allocated pixels with all hidden details reachable', width => {
    const result = mountPage();
    chooseSession();
    resizeAllocatedWidth(width);
    const mobile = result.container.querySelector('[data-mobile-table]');
    expect(mobile).not.toBeNull();
    fireEvent.click(within(mobile as HTMLElement).getAllByRole('button', { name: 'Quick view' })[0]!);
    const detail = screen.getByRole('dialog');
    expect(within(detail).getByText('Phase start')).toBeInTheDocument();
    expect(within(detail).getByText('Phase end')).toBeInTheDocument();
    expect(within(detail).getByText('Algorithm phase state (zero-fill analysis)')).toBeInTheDocument();
    expect(within(detail).getByText('Phase boundaries are sampled estimates.')).toBeInTheDocument();
    const closeButtons = within(detail).getAllByRole('button', { name: 'Close', exact: true });
    fireEvent.click(closeButtons[closeButtons.length - 1]!);
    resizeAllocatedWidth(640);
    expect(result.container.querySelector('[data-mobile-table]')).toBeNull();
    expect(screen.getByRole('table', { name: 'Thermal Phases' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Inspect session' })).toHaveValue('42');
    expect(sources.telemetryHook).toHaveBeenLastCalledWith(42);
  });
});
