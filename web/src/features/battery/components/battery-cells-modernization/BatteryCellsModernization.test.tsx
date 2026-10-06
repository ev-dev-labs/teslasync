/** Authored for the parent's integrated runtime window. NOTRUN by this writer. */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { BatteryCellData } from '@/api/hooks/useAnalytics';
import type { DataStateSource } from '@/api/dataState';
import { formatTemperature, type UnitPref } from '@/lib/unitConversion';
import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback';
import BatteryCellsPage from '../../pages/BatteryCellsPage';

const h = vi.hoisted(() => ({
  query: {} as DataStateSource<BatteryCellData>,
  vehicleId: 7 as number | null,
  temperature: '°C' as '°C' | '°F',
  retry: vi.fn(),
}));
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: vi.fn(),
}));
vi.mock('@/api/hooks/useAnalytics', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useAnalytics')>(),
  useBatteryCells: () => h.query,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId, vehicle: null, vehicles: [], setVehicleId: vi.fn(),
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => {
    const unitPrefs: UnitPref = {
      distance: 'km', speed: 'km/h', temperature: h.temperature, pressure: 'bar',
      energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 2,
    };
    return { unitPrefs, formatTemperature: (value: number | null | undefined) => formatTemperature(value, unitPrefs) };
  },
}));
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> };
});
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  // Real ChartContainer/annotation UI remains; only jsdom chart rendering doubles.
  return { ...actual, ...chartTestDoubles };
});

const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
function resize(width: number) {
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
  )));
}
function payload(overrides: Partial<BatteryCellData> = {}): BatteryCellData {
  return {
    status: 'ok', total_cells: 2, avg_voltage: 3.9, min_voltage: 3.89, max_voltage: 3.91,
    voltage_spread: 0.02, imbalance_mv: 20, pack_voltage: 400,
    avg_temperature: 25, min_temperature: 22, max_temperature: 28, temp_spread: 6,
    cells: [
      { cell_number: 1, voltage: 3.89, delta_from_avg: -10, status: 'slight_deviation' },
      { cell_number: 2, voltage: 3.91, delta_from_avg: 10, status: 'slight_deviation' },
    ],
    history: [
      { timestamp: '2026-10-01T12:00:00Z', min_voltage: 3.89, avg_voltage: 3.9, max_voltage: 3.91, imbalance_mv: 20 },
    ],
    ...overrides,
  };
}
function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  // A real Router remains mounted across EVERY rerender, including settings/query transitions.
  const tree = () => <MemoryRouter initialEntries={['/battery/cells?vehicle_id=7']}>
    <QueryClientProvider client={client}><ToastProvider><BatteryCellsPage /></ToastProvider></QueryClientProvider>
  </MemoryRouter>;
  const result = render(tree());
  return { ...result, rerenderPage: () => result.rerender(tree()) };
}
function stat(container: HTMLElement, id: string, occurrence: number) {
  const strip = container.querySelector(`#${id}`) as HTMLElement;
  const tile = strip.querySelectorAll('[data-stat]')[occurrence] as HTMLElement;
  return within(tile);
}
beforeEach(() => {
  localStorage.clear();
  observers.length = 0;
  h.retry.mockReset();
  vi.mocked(request).mockReset();
  vi.mocked(request).mockImplementation(async <T,>(path: string): Promise<T> =>
    (path.startsWith('/annotations') ? [] : {}) as T);
  h.vehicleId = 7;
  h.temperature = '°C';
  h.query = { data: payload(), isSuccess: true, dataUpdatedAt: 1790899200000, refetch: h.retry };
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Battery cells live modernization preservation', () => {
  it('retains all eight sections, toggled view and measurements through a refresh failure', () => {
    const view = fixture();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to bar view' }));
    const chart = screen.getByRole('img', { name: 'Voltage reading for each battery cell' });
    const table = view.container.querySelector('[data-grid-frame]');
    h.query = { ...h.query, isError: true, error: new Error('Refresh unavailable') };
    view.rerenderPage();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Voltage reading for each battery cell' })).toBe(chart);
    expect(view.container.querySelector('[data-grid-frame]')).toBe(table);
    expect(stat(view.container, 'battery-cells-overview', 5).getByText('400.00 V')).toBeInTheDocument();
    expect(view.container.querySelectorAll('[data-card-grid]')).toHaveLength(3);
    expect(view.container.querySelectorAll('[data-card-title]')).toHaveLength(8);
    expect(screen.getByText('Voltage spread trend')).toBeInTheDocument();
    expect(view.container.querySelector('#battery-cells-summary')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(h.retry).toHaveBeenCalledOnce();
  });

  it('keeps shells through initial loading and fatal failure without presenting zero metrics', () => {
    h.query = { data: undefined, isPending: true, isLoading: true, refetch: h.retry };
    const view = fixture();
    expect(view.container.querySelectorAll('[data-card-title]')).toHaveLength(8);
    expect(view.container.querySelectorAll('[data-stat-strip]')).toHaveLength(3);
    h.query = { data: undefined, isError: true, error: new Error('Initial failure'), refetch: h.retry };
    view.rerenderPage();
    expect(view.container.querySelectorAll('[data-card-title]')).toHaveLength(8);
    expect(stat(view.container, 'battery-cells-overview', 0).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('Cells well balanced')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(h.retry).toHaveBeenCalledOnce();
  });

  it('preserves pack and temperature signals in a no-brick no_data envelope', () => {
    h.query = { ...h.query, data: payload({
      status: 'no_data', total_cells: 0, avg_voltage: 0, min_voltage: 0, max_voltage: 0,
      imbalance_mv: 0, cells: [], history: [],
    }) };
    const view = fixture();
    expect(stat(view.container, 'battery-cells-overview', 0).getByText('—')).toBeInTheDocument();
    expect(stat(view.container, 'battery-cells-overview', 1).getByText('—')).toBeInTheDocument();
    expect(stat(view.container, 'battery-cells-overview', 5).getByText('400.00 V')).toBeInTheDocument();
    expect(stat(view.container, 'battery-cells-temperature', 0).getByText('25.00°C')).toBeInTheDocument();
    expect(screen.queryByText('Cells well balanced')).not.toBeInTheDocument();
    expect(screen.queryByText('Thermal balance good')).not.toBeInTheDocument();
    expect(screen.queryByText('All cells healthy')).not.toBeInTheDocument();
  });

  it('converts absolute temperature and differences on settings rerender without changing SI cache bytes', () => {
    const raw = payload();
    const bytes = JSON.stringify(raw);
    h.query = { ...h.query, data: raw };
    const view = fixture();
    expect(stat(view.container, 'battery-cells-temperature', 3).getByText('6.00°C')).toBeInTheDocument();
    h.temperature = '°F';
    view.rerenderPage();
    expect(stat(view.container, 'battery-cells-temperature', 0).getByText('77.00°F')).toBeInTheDocument();
    expect(stat(view.container, 'battery-cells-temperature', 3).getByText('10.80°F')).toBeInTheDocument();
    expect(JSON.stringify(raw)).toBe(bytes);
  });

  it('does not classify absent readings as zero or healthy, but keeps an actual reported zero', () => {
    const raw = payload({ cells: [], history: [] });
    // HTTP may carry null despite the endpoint's older non-null TS declaration.
    Reflect.set(raw, 'imbalance_mv', null);
    Reflect.set(raw, 'temp_spread', null);
    Reflect.set(raw, 'pack_voltage', null);
    h.query = { ...h.query, data: raw };
    const view = fixture();
    expect(stat(view.container, 'battery-cells-overview', 4).getByText('—')).toBeInTheDocument();
    expect(stat(view.container, 'battery-cells-overview', 5).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('Cells well balanced')).not.toBeInTheDocument();
    expect(screen.queryByText('Thermal balance good')).not.toBeInTheDocument();
    expect(screen.queryByText('All cells healthy')).not.toBeInTheDocument();
    h.query = { ...h.query, data: payload({ pack_voltage: 0 }) };
    view.rerenderPage();
    expect(stat(view.container, 'battery-cells-overview', 5).getByText('0.00 V')).toBeInTheDocument();
  });

  it('uses the actual mobile table pipeline and exposes the full delta detail at allocated phone width', () => {
    const view = fixture();
    resize(390);
    const mobile = view.container.querySelector('[data-mobile-table]') as HTMLElement;
    expect(mobile).not.toBeNull();
    expect(within(mobile).getByText('3.8900 V')).toBeInTheDocument();
    fireEvent.click(within(mobile).getAllByRole('button', { name: 'Quick view' })[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delta (mV)')).toBeInTheDocument();
    expect(within(dialog).getByText('-10.00')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('Close', { exact: true }));
    resize(640);
    expect(view.container.querySelector('[data-mobile-table]')).toBeNull();
    expect(screen.getByRole('table', { name: 'battery:cells' })).toBeInTheDocument();
  });
});
