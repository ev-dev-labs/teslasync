import React, { type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { MonthlyCostEntry } from '@/types/analytics';
import CostBreakdownWidget from './CostBreakdownWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import * as packModules from './designPacks/packModules';
import { PACK_APPEARANCES, type PackId } from './designPacks/types';
import type { WidgetProps } from './types';

const api = vi.hoisted(() => ({ cost: vi.fn(), vehicles: vi.fn(), refresh: vi.fn() }));
const palette = vi.hoisted(() => ({
  primary: '#397b9d',
  series: ['#397b9d', '#659582', '#a28c60', '#a57479', '#8e81ab', '#747d89'],
}));
const formatting = vi.hoisted(() => ({
  formatCurrency: (value: number, decimals = 2) => `$${value.toFixed(decimals)}`,
}));
const dates = vi.hoisted(() => ({
  formatMonthName: (value: string) => value,
  locale: 'en-US',
  tz: 'UTC',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      let text = typeof fallback === 'string' ? fallback : key;
      for (const [name, value] of Object.entries(options ?? {})) {
        text = text.replaceAll(`{{${name}}}`, String(value));
      }
      return text;
    },
  }),
}));
vi.mock('@/api/hooks/useAnalytics', () => ({ useCostBreakdown: api.cost }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: api.vehicles }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => formatting }));
vi.mock('@/hooks/useDateLabels', () => ({ useDateLabels: () => dates }));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    useThemeChartPalette: () => palette,
    // Supply deterministic geometry, keeping the real charts and accessible frame.
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      React.cloneElement(children, { width: 480, height: 180 }),
  };
});

interface CostReading {
  total_charging_cost: number | null;
  total_savings: number | null;
  monthly_breakdown: Array<Pick<MonthlyCostEntry, 'month'> & { ev_cost: number | null }> | null;
}

function costData(overrides: Partial<CostReading> = {}): CostReading {
  return {
    total_charging_cost: 110,
    total_savings: 40,
    monthly_breakdown: [
      { month: '2026-10', ev_cost: 70 },
      { month: '2026-11', ev_cost: 40 },
    ],
    ...overrides,
  };
}

function source<T>(data: T | undefined, overrides: Partial<DataStateSource<T>> = {}) {
  return {
    data, error: null, isLoading: false, isPending: false, isError: false,
    isFetching: false, isStale: false, dataUpdatedAt: Date.now(), refetch: api.refresh,
    ...overrides,
  };
}

const clients: QueryClient[] = [];
const packCases = Object.entries(PACK_APPEARANCES) as Array<[Exclude<PackId, 'classic'>, string]>;

function renderWidget(packId?: unknown, props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const content = (requestedPackId: unknown) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <CostBreakdownWidget vehicleId={42} size={{ cols: 2, rows: 4 }} {...props} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(content(packId));
  return { ...view, selectPack: (next: unknown) => view.rerender(content(next)) };
}

async function expectPack(container: HTMLElement, packId: Exclude<PackId, 'classic'>) {
  await waitFor(() => {
    expect(container.querySelector(`[data-widget-family="bars"][data-widget-appearance="${PACK_APPEARANCES[packId]}"]`))
      .not.toBeNull();
  });
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
}

function monthlyRows() {
  return within(screen.getByRole('table', { name: 'Cost breakdown — data table' }))
    .getAllByRole('row').slice(1).map(row =>
      within(row).getAllByRole('cell').map(cell => cell.textContent));
}

beforeEach(() => {
  api.vehicles.mockReturnValue(source([{ id: 42 }]));
  api.cost.mockReturnValue(source(costData()));
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)', media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(),
    removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    font: '',
    measureText: (value: string) => ({ width: value.length * 7 }),
  }) as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe.each(packCases)(
  'Cost breakdown — %s / %s',
  packId => {
    it('composes the real lifetime headline, monthly bars, estimated savings and refresh action', async () => {
      const { container } = renderWidget(packId, { config: { vehicleId: 99 } });
      await expectPack(container, packId);

      expect(screen.getByText('Lifetime charging cost')).toBeInTheDocument();
      expect(screen.getByText('$110.00')).toBeInTheDocument();
      expect(screen.getByText('Estimated gas savings')).toBeInTheDocument();
      expect(screen.getAllByText('$40.00').length).toBeGreaterThan(0);
      expect(screen.getByText('Period')).toBeInTheDocument();
      expect(screen.getAllByText('Lifetime').length).toBeGreaterThan(0);
      expect(screen.getByText('Gas comparison is estimated.')).toBeInTheDocument();
      expect(screen.getByLabelText('Historical')).toHaveAttribute('data-provenance', 'historical');
      expect(screen.getByLabelText('Estimated')).toHaveAttribute('data-provenance', 'inferred');
      expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
      expect(container.querySelector('.recharts-bar')).not.toBeNull();
      expect(container.querySelector('.recharts-pie')).toBeNull();
      expect(container.querySelector('.recharts-xAxis')).not.toBeNull();
      expect(container.querySelector('.recharts-yAxis')).not.toBeNull();
      expect(monthlyRows()).toEqual([['2026-10', '$70.00'], ['2026-11', '$40.00']]);
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
      expect(api.refresh).toHaveBeenCalledOnce();
      expect(api.cost.mock.calls.every(([id]) => id === '42')).toBe(true);

      const originalIcon = container.querySelector('[data-role="widget-header-line"] svg.lucide');
      const packIcon = container.querySelector('[data-instrument-appearance] svg.lucide');
      expect(packIcon).not.toBeNull();
      expect(packIcon?.innerHTML).toBe(originalIcon?.innerHTML);
    });

    it('preserves the compact single headline and signed savings without adding a chart or scale', async () => {
      api.cost.mockReturnValue(source(costData({ total_savings: -15 })));
      const { container } = renderWidget(packId, { size: { cols: 1, rows: 2 } });
      await expectPack(container, packId);

      expect(screen.getByText('$110.00')).toBeInTheDocument();
      expect(screen.getByText('Gas comparison difference $-15.00')).toBeInTheDocument();
      expect(screen.queryByText('Estimated gas savings')).not.toBeInTheDocument();
      expect(container.querySelector('.recharts-wrapper')).toBeNull();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    });

    it('keeps unknown, invalid and signed monthly observations distinct from measured zero', async () => {
      api.cost.mockReturnValue(source(costData({
        total_charging_cost: null,
        total_savings: -15,
        monthly_breakdown: [
          { month: 'Unmeasured', ev_cost: null },
          { month: 'Invalid', ev_cost: Number.NaN },
          { month: 'Overflow', ev_cost: Number.POSITIVE_INFINITY },
          { month: '2026-10', ev_cost: -5 },
          { month: '2026-11', ev_cost: 0 },
        ],
      })));
      const { container } = renderWidget(packId);
      await expectPack(container, packId);

      expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'partial');
      expect(screen.getByText('Lifetime charging cost')).toBeInTheDocument();
      expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
      expect(screen.getByText('$-15.00')).toBeInTheDocument();
      expect(monthlyRows()).toEqual([
        ['Unmeasured', '—'], ['Invalid', '—'], ['Overflow', '—'],
        ['2026-10', '$-5.00'], ['2026-11', '$0.00'],
      ]);
      expect(container.querySelector('.recharts-bar')).not.toBeNull();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    });

    it('keeps every full-size section shell visible when the source has no cost records', async () => {
      api.cost.mockReturnValue(source<CostReading>(undefined));
      const { container } = renderWidget(packId);
      await expectPack(container, packId);

      expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'unavailable');
      expect(screen.getByText('No cost data')).toBeInTheDocument();
      expect(screen.getByText('Lifetime charging cost')).toBeInTheDocument();
      expect(screen.getByText('Estimated gas savings')).toBeInTheDocument();
      expect(screen.getByText('Period')).toBeInTheDocument();
      expect(screen.getByText('Gas comparison is estimated.')).toBeInTheDocument();
      expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
      expect(container.querySelector('.recharts-wrapper')).toBeNull();
    });
  },
);

it('preserves Classic as the default and unknown-pack recovery, including its original donut and savings delta', () => {
  const { container, selectPack } = renderWidget();
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', 'classic');
  expect(container.querySelector('[data-instrument-appearance]')).toBeNull();
  expect(container.querySelector('.recharts-pie')).not.toBeNull();
  expect(screen.getByText('Saved $40.00 vs gas')).toBeInTheDocument();
  expect(screen.queryByText('Estimated gas savings')).not.toBeInTheDocument();
  expect(monthlyRows()).toEqual([['2026-10', '$70.00'], ['2026-11', '$40.00']]);

  selectPack('unrecognized');
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', 'classic');
  expect(container.querySelector('.recharts-pie')).not.toBeNull();
});

it('keeps the original Classic body intact until the requested appearance has loaded', async () => {
  let releaseLoad = () => {};
  const pendingLoad = new Promise<void>(resolve => { releaseLoad = resolve; });
  const resolveModule = packModules.resolvePackModule;
  vi.spyOn(packModules, 'cachedPackModule').mockReturnValue(null);
  vi.spyOn(packModules, 'resolvePackModule').mockImplementation(async load => {
    await pendingLoad;
    return resolveModule(load);
  });
  const { container } = renderWidget('v5');
  expect(container.querySelector('[data-instrument-appearance]')).toBeNull();
  expect(container.querySelector('.recharts-pie')).not.toBeNull();
  expect(screen.getByText('Saved $40.00 vs gas')).toBeInTheDocument();
  expect(screen.getByText('Lifetime')).toBeInTheDocument();
  expect(monthlyRows()).toEqual([['2026-10', '$70.00'], ['2026-11', '$40.00']]);
  releaseLoad();
  await expectPack(container, 'v5');
  expect(container.querySelector('.recharts-bar')).not.toBeNull();
});

it('keeps the configured vehicle, recent-six-month window and source readings across pack changes and Classic recovery', async () => {
  api.cost.mockReturnValue(source(costData({
    monthly_breakdown: Array.from({ length: 8 }, (_, index) => ({
      month: `2026-${String(index + 1).padStart(2, '0')}`,
      ev_cost: index + 1,
    })),
  })));
  const { container, selectPack } = renderWidget('classic', {
    vehicleId: undefined, config: { vehicleId: 77 },
  });
  const expectedRows = monthlyRows();
  expect(expectedRows).toHaveLength(6);
  expect(expectedRows[0]).toEqual(['2026-03', '$3.00']);
  for (const [packId] of packCases) {
    selectPack(packId);
    await expectPack(container, packId);
    expect(monthlyRows()).toEqual(expectedRows);
    expect(screen.getByText('$110.00')).toBeInTheDocument();
  }
  selectPack('classic');
  expect(container.querySelector('.recharts-pie')).not.toBeNull();
  expect(screen.getByText('$110.00')).toBeInTheDocument();
  expect(api.cost.mock.calls.every(([id]) => id === '77')).toBe(true);
});

it.each(packCases)('retains the source plot and amounts after a refresh fails in %s, with a working shared retry', async packId => {
  api.cost.mockReturnValue(source(costData(), {
    isError: true, isStale: true, error: new Error('Refresh failed'),
  }));
  const { container } = renderWidget(packId);
  await expectPack(container, packId);
  expect(screen.getByText('$110.00')).toBeInTheDocument();
  expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'stale');
  expect(screen.getByLabelText('Historical')).toHaveAttribute('data-provenance', 'historical');
  expect(screen.getByLabelText('Estimated')).toHaveAttribute('data-provenance', 'inferred');
  expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  expect(monthlyRows()).toEqual([['2026-10', '$70.00'], ['2026-11', '$40.00']]);
  fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
  expect(api.refresh).toHaveBeenCalledOnce();
});

it.each(packCases)('uses the shell loading and fatal-error paths in %s rather than inventing readings', packId => {
  api.cost.mockReturnValue(source<CostReading>(undefined, { isLoading: true, isPending: true }));
  const { container, selectPack } = renderWidget(packId);
  expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initial');
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  expect(screen.queryByText('No cost data')).not.toBeInTheDocument();

  api.cost.mockReturnValue(source<CostReading>(undefined, {
    isError: true, error: new Error('Cost source unavailable'),
  }));
  selectPack(packId);
  expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initialFailure');
  expect(screen.queryByText('No cost data')).not.toBeInTheDocument();
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
  expect(api.refresh).toHaveBeenCalledOnce();
});
