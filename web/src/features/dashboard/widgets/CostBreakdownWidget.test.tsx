/**
 * CostBreakdownWidget — After-card behavior, data trust, and shared shell tests.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: unknown) => {
      let text = typeof fallback === 'string' ? fallback : key;
      if (opts && typeof opts === 'object') {
        for (const [name, value] of Object.entries(opts as Record<string, unknown>)) {
          text = text.replace(`{{${name}}}`, String(value));
        }
      }
      return text;
    },
  }),
}));

const analytics = vi.hoisted(() => ({ cost: vi.fn() }));
const vehicles = vi.hoisted(() => ({ list: vi.fn() }));
const formatting = vi.hoisted(() => ({
  formatCurrency: vi.fn((value: number, decimals = 2) => `$${Number(value).toFixed(decimals)}`),
}));

vi.mock('@/api/hooks/useAnalytics', () => ({ useCostBreakdown: analytics.cost }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vehicles.list }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => formatting }));
vi.mock('@/hooks/useDateLabels', () => ({
  useDateLabels: () => ({
    formatMonthName: (value: string | number) => String(value),
    locale: 'en-US',
    tz: 'UTC',
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: 'km' } }),
}));
vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    useThemeChartPalette: () => ({
      primary: '#00b4d8',
      series: ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#3b82f6'],
    }),
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    PieChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Pie: ({ data, children }: { data?: unknown[]; children?: React.ReactNode }) => (
      <div data-testid="cost-pie" data-json={JSON.stringify(data)}>{children}</div>
    ),
    BarChart: ({ children }: { children?: React.ReactNode }) => <div data-testid="cost-bars">{children}</div>,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
  };
});

import CostBreakdownWidget from './CostBreakdownWidget';
import type { CostBreakdown } from '@/types/analytics';

function query(over: Record<string, unknown> = {}) {
  return {
    data: undefined, isLoading: false, isError: false, error: null,
    isFetching: false, isStale: false, dataUpdatedAt: Date.now(), refetch: vi.fn(),
    ...over,
  } as never;
}

function makeData(over: Partial<CostBreakdown> = {}): CostBreakdown {
  return {
    vehicle_id: 42,
    total_charging_cost: 238,
    total_wh: 0,
    total_sessions: 0,
    total_km: 0,
    first_date: '2025-01-01',
    last_date: '2025-03-31',
    equivalent_gas_cost: 850,
    total_savings: 612,
    monthly_savings: 204,
    cost_per_km_ev: 0.05,
    cost_per_km_ice: 0.08,
    maintenance_savings_estimate: 0,
    months_of_ownership: 3,
    gas_price: 0,
    gas_unit: 'gallon',
    gas_efficiency_mpg: 30,
    base_cost_per_kwh: 0,
    monthly_breakdown: [
      { month: '2025-01', ev_cost: 142, equiv_gas_cost: 400, savings: 258, cumulative_savings: 258, energy_wh: 10000 },
      { month: '2025-02', ev_cost: 84, equiv_gas_cost: 300, savings: 216, cumulative_savings: 474, energy_wh: 9000 },
      { month: '2025-03', ev_cost: 12, equiv_gas_cost: 150, savings: 138, cumulative_savings: 612, energy_wh: 8000 },
    ],
    ...over,
  };
}

function renderWidget(cols = 2) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CostBreakdownWidget vehicleId={42} size={{ cols, rows: 4 }} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vehicles.list.mockReturnValue(query({ data: [{ id: 42 }] }));
  analytics.cost.mockReturnValue(query({ data: makeData() }));
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: true, media: '', onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as never;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CostBreakdownWidget — After card', () => {
  it('renders one lifetime headline and the measured savings delta', () => {
    renderWidget(2);
    expect(screen.getAllByText('Cost breakdown').length).toBeGreaterThan(0);
    expect(screen.getByText('Lifetime charging cost')).toBeInTheDocument();
    expect(screen.getByText('$238.00')).toBeInTheDocument();
    expect(screen.getByText('Saved $612.00 vs gas')).toBeInTheDocument();
  });

  it('renders only source-backed monthly readings in the chart', () => {
    renderWidget(2);
    const pie = screen.getByTestId('cost-pie');
    expect(JSON.parse(pie.getAttribute('data-json') ?? '[]')).toEqual([
      expect.objectContaining({ name: '2025-01', value: 142 }),
      expect.objectContaining({ name: '2025-02', value: 84 }),
      expect.objectContaining({ name: '2025-03', value: 12 }),
    ]);
  });

  it('sizes the headline independently of the remaining chart space', () => {
    renderWidget(2);
    const headline = screen.getByText('$238.00').closest('.h-full');
    expect(headline?.parentElement).toHaveClass('shrink-0');
    expect(headline?.parentElement?.parentElement).toHaveClass('flex-col', 'min-h-0');
    expect(screen.getByTestId('cost-pie')).toBeInTheDocument();
  });

  it('uses a bar fallback without fabricating allocations for unknown or negative readings', () => {
    analytics.cost.mockReturnValue(query({
      data: makeData({
        total_savings: -25,
        monthly_breakdown: [
          { month: 'Unmeasured', ev_cost: null, equiv_gas_cost: 0, savings: 0, cumulative_savings: 0, energy_wh: 0 },
          { month: '2025-03', ev_cost: -5, equiv_gas_cost: 0, savings: -5, cumulative_savings: -5, energy_wh: 0 },
        ],
      }),
    }));
    renderWidget(2);
    expect(screen.getByText('$238.00')).toBeInTheDocument();
    expect(screen.getByText('Gas comparison difference $-25.00')).toBeInTheDocument();
    expect(screen.queryByTestId('cost-pie')).not.toBeInTheDocument();
    expect(screen.getByTestId('cost-bars')).toBeInTheDocument();
  });

  it('keeps compact to one headline without repeating monthly detail', () => {
    renderWidget(1);
    expect(screen.getByText('$238.00')).toBeInTheDocument();
    expect(screen.queryByTestId('cost-pie')).not.toBeInTheDocument();
    expect(screen.queryByText('Total cost')).not.toBeInTheDocument();
  });

  it('renders honest loading and empty states', () => {
    analytics.cost.mockReturnValue(query({ isLoading: true }));
    const loading = renderWidget(2);
    expect(loading.container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    loading.unmount();

    analytics.cost.mockReturnValue(query({ data: undefined }));
    renderWidget(2);
    expect(screen.getByText('No cost data')).toBeInTheDocument();
  });

  it('retains known values over a refresh error', () => {
    analytics.cost.mockReturnValue(query({
      data: makeData(), isError: true, error: new Error('refresh failed'), isStale: true,
    }));
    renderWidget(2);
    expect(screen.getByText('$238.00')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });

  it('wires the shared FreshnessDot refresh action', () => {
    const refetch = vi.fn();
    analytics.cost.mockReturnValue(query({ data: makeData(), refetch }));
    renderWidget(2);
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('uses the configured currency formatter and preserves zero and null readings', () => {
    analytics.cost.mockReturnValue(query({
      data: makeData({
        total_charging_cost: 0,
        total_savings: null,
        monthly_breakdown: [
          { month: '2025-01', ev_cost: 0, equiv_gas_cost: 0, savings: 0, cumulative_savings: 0, energy_wh: 0 },
        ],
      } as Partial<CostBreakdown>),
    }));
    renderWidget(2);
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
    expect(formatting.formatCurrency).toHaveBeenCalledWith(0, undefined);
    expect(screen.queryByText(/Saved .* vs gas/)).not.toBeInTheDocument();
  });
});
