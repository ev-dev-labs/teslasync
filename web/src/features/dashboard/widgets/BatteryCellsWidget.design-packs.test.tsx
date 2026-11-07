import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { DataStateSource } from '@/api/dataState';
import type { BatteryCellSummary } from '@/types/energy';
import type { WidgetSize } from './types';
import BatteryCellsWidget from './BatteryCellsWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import type { PackId } from './designPacks/types';

const mocks = vi.hoisted(() => ({
  cells: vi.fn(),
  vehicles: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/api/hooks/useEnergy', () => ({ useBatteryCells: mocks.cells }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: mocks.vehicles }));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { cloneElement } = await import('react');
  return {
    ...actual,
    // Supply jsdom dimensions only; keep the chart, frame and presentation real.
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 640, height: 200 }),
  };
});

const full: WidgetSize = { cols: 4, rows: 3 };
const compact: WidgetSize = { cols: 1, rows: 1 };
const packs = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
] as const;
const fixture: BatteryCellSummary = {
  total_cells: 96, avg_voltage: 3.8, min_voltage: 3.79, max_voltage: 3.81,
  voltage_spread: 0.02, avg_temperature: 28, min_temperature: 27,
  max_temperature: 29, temp_spread: 2,
  cells: [
    { cell_id: 12, module: 2, voltage: 3.79, temperature: 27 },
    { cell_id: 18, module: 2, voltage: 3.8, temperature: 28 },
    { cell_id: 44, module: 5, voltage: 3.8, temperature: 29 },
    { cell_id: 92, module: 5, voltage: 3.81, temperature: 27 },
  ],
};

function query(
  data: BatteryCellSummary | undefined = fixture,
  overrides: Partial<DataStateSource<BatteryCellSummary>> = {},
): DataStateSource<BatteryCellSummary> {
  return {
    data, error: null, isLoading: false, isFetching: false, isStale: false,
    isError: false, dataUpdatedAt: data ? Date.now() : 0, refetch: mocks.refetch,
    ...overrides,
  };
}

function widget(pack: unknown, size: WidgetSize = full) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={pack}>
        <BatteryCellsWidget vehicleId={77} size={size} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function appearance(container: HTMLElement, value: string) {
  await waitFor(() => expect(container.querySelector(
    `[data-widget-family="bars"][data-widget-appearance="${value}"]`,
  )).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.vehicles.mockReturnValue({ data: [{ id: 42 }] });
  mocks.cells.mockReturnValue(query());
});
afterEach(cleanup);

describe.each(packs)('battery-cells %s (%s)', (pack, name) => {
  it.each([['full', full], ['compact', compact]] as const)(
    'preserves source cells, units, statuses, summaries and refresh at %s size',
    async (_layout, size) => {
      const { container } = render(widget(pack, size));
      await appearance(container, name);

      expect(screen.getByRole('heading', { name: 'Battery cells', level: 3 })).toBeVisible();
      expect(screen.getByText('Cell-voltage spread')).toBeInTheDocument();
      expect(screen.getByText('Source-reported cells: 4')).toBeInTheDocument();
      expect(screen.getByText('Only cells supplied by the source are plotted; availability varies.')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Cell voltage' })).toBeInTheDocument();
      expect(screen.getByText('Truncated voltage scale (V).')).toBeInTheDocument();
      expect(screen.getByText('Average 3.800 V')).toBeInTheDocument();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(mocks.cells).toHaveBeenCalledWith('77');

      const grid = screen.getByRole('list');
      expect(within(grid).getAllByRole('listitem')).toHaveLength(4);
      fixture.cells.forEach(cell => {
        expect(within(grid).getByText(size.cols === 1 ? `C${cell.cell_id}` : `Cell ${cell.cell_id} · M${cell.module}`)).toBeInTheDocument();
      });
      expect(within(grid).getAllByText('Healthy')).toHaveLength(2);
      expect(within(grid).getAllByText('Warning')).toHaveLength(2);
      expect(grid).toHaveTextContent(size.cols === 1 ? '3.790 V' : /3\.790 V \/ 27\.0+°C/);
      expect(screen.getByText('Min V')).toBeInTheDocument();
      expect(screen.getByText('Max V')).toBeInTheDocument();
      expect(screen.getByText('Spread')).toBeInTheDocument();
      expect(screen.getByText('Temp')).toBeInTheDocument();
      expect(screen.getByText(/27\.0+°C–29\.0+°C/)).toBeInTheDocument();

      const table = screen.getByRole('table', { name: 'Cell voltage — data table' });
      expect(within(table).getAllByRole('row')).toHaveLength(5);
      expect(within(table).getAllByRole('cell', { name: '3.800 V' })).toHaveLength(2);
      await waitFor(() => expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(4));
      fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
      expect(mocks.refetch).toHaveBeenCalledTimes(1);
    },
  );
});

it('retains the untouched Classic grid, summaries and recovery when switching packs', async () => {
  const view = render(widget('classic'));
  expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Cell voltage' })).not.toBeInTheDocument();
  expect(screen.getByText(/3\.790 V \/ 27\.0+°C/)).toBeInTheDocument();
  expect(screen.getByText('20.00')).toBeInTheDocument();
  expect(screen.getByText('Healthy < 30 mV')).toBeInTheDocument();

  view.rerender(widget('v7'));
  await appearance(view.container, 'pixel');
  expect(view.container.querySelector('[data-instrument-appearance="pixel"] .lucide-cpu')).toBeInTheDocument();
  view.rerender(widget('classic'));
  expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expect(screen.getByRole('list')).toHaveTextContent('Cell 92 · M5');
  expect(screen.getByText('20.00')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
  expect(mocks.refetch).toHaveBeenCalledTimes(1);
});

it('keeps invalid cell readings as gaps and unknown statuses while retaining measured zero and signed temperature', async () => {
  mocks.cells.mockReturnValue(query({
    ...fixture, avg_voltage: Number.NaN, min_voltage: 0, voltage_spread: Number.NaN,
    min_temperature: -5,
    cells: [
      { cell_id: 12, module: 2, voltage: Number.NaN, temperature: Number.NaN },
      { cell_id: 92, module: 5, voltage: 0, temperature: -5 },
    ],
  }));
  const { container } = render(widget('v7'));
  await appearance(container, 'pixel');
  const grid = screen.getByRole('list');
  expect(within(grid).getAllByText('Unknown')).toHaveLength(2);
  expect(within(grid).getByText('— / —')).toBeInTheDocument();
  expect(grid).toHaveTextContent(/0\.000 V \/ -5\.0+°C/);
  expect(screen.getByText(/-5\.0+°C–29\.0+°C/)).toBeInTheDocument();
  const table = screen.getByRole('table', { name: 'Cell voltage — data table' });
  const rows = within(table).getAllByRole('row');
  expect(within(rows[1]).getByRole('cell', { name: '—' })).toBeInTheDocument();
  expect(within(rows[2]).getByRole('cell', { name: '0.000 V' })).toBeInTheDocument();
  expect(screen.queryByText('Healthy < 30 mV')).not.toBeInTheDocument();
  expect(screen.queryByText(/Average|NaN|Infinity/)).not.toBeInTheDocument();
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
});

it('keeps both empty cell sections and source summary readings visible without inventing cells', async () => {
  mocks.cells.mockReturnValue(query({ ...fixture, cells: [] }));
  const { container } = render(widget('v4', compact));
  await appearance(container, 'owner');
  expect(screen.getAllByText('No cell data')).toHaveLength(2);
  expect(screen.getByText('Source-reported cells: 0')).toBeInTheDocument();
  expect(screen.getByText('Min V')).toBeInTheDocument();
  expect(screen.getByText('Max V')).toBeInTheDocument();
  expect(screen.getByText(/27\.0+°C–29\.0+°C/)).toBeInTheDocument();
  expect(container.querySelector('figure[data-chart-state="empty"]')).toBeInTheDocument();
  expect(container.querySelector('.recharts-bar')).not.toBeInTheDocument();
});

it('keeps absent observations unknown instead of reporting a successful zero spread', async () => {
  mocks.cells.mockReturnValue(query(undefined, { data: undefined }));
  const { container } = render(widget('v1'));
  await appearance(container, 'studio');
  expect(screen.getAllByText('No battery cell data')).toHaveLength(2);
  expect(screen.getByText('Spread')).toBeInTheDocument();
  expect(screen.getAllByText('—')).toHaveLength(5);
  expect(screen.queryByText('0.00')).not.toBeInTheDocument();
  expect(screen.queryByText('Healthy < 30 mV')).not.toBeInTheDocument();
});

it('retains the plot and details on refresh failure, without replacing them with a fatal error', async () => {
  mocks.cells.mockReturnValue(query(fixture, { error: new Error('Refresh failed'), isError: true, isStale: true }));
  const { container } = render(widget('v3'));
  await appearance(container, 'precision');
  expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Cell voltage' })).toBeInTheDocument();
  expect(screen.getByRole('list')).toHaveTextContent('Cell 92 · M5');
  expect(screen.getByText('Min V')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
  expect(mocks.refetch).toHaveBeenCalledTimes(1);
});

it.each(['v2', 'v6'] satisfies PackId[])('preserves initial-loading and fatal-error recovery in %s', pack => {
  mocks.cells.mockReturnValue(query(undefined, { data: undefined, isLoading: true }));
  const view = render(widget(pack));
  expect(view.container.querySelector('[aria-busy="true"][data-data-state="initial"]')).toBeInTheDocument();
  expect(screen.queryByText('Min V')).not.toBeInTheDocument();
  mocks.cells.mockReturnValue(query(undefined, { data: undefined, isError: true, error: new Error('Source failed') }));
  view.rerender(widget(pack));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(view.container.querySelector('.widget-status-tile')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Battery cells' })).toBeInTheDocument();
});

it('keeps an in-flight refresh from invoking a second request', async () => {
  mocks.cells.mockReturnValue(query(fixture, { isFetching: true }));
  const { container } = render(widget('v5'));
  await appearance(container, 'iconic');
  fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
  expect(mocks.refetch).not.toHaveBeenCalled();
  expect(screen.getByRole('list')).toHaveTextContent('Cell 12 · M2');
});
