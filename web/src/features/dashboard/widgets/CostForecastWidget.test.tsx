import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const { forecastMock, vehiclesMock } = vi.hoisted(() => ({
  forecastMock: vi.fn(),
  vehiclesMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name) =>
        opts && opts[name] != null ? String(opts[name]) : '',
      );
    },
  }),
}));

vi.mock('@/api/hooks/useCharging', () => ({
  useCostForecast: (...args: unknown[]) => forecastMock(...args),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    currencySymbol: '$',
    formatCurrency: (value: number) => `$${value.toFixed(2)}`,
  }),
}));
vi.mock('@/lib/timezone', () => ({
  useTimezone: () => 'America/New_York',
}));
vi.mock('@/hooks/useDateLabels', () => ({
  useDateLabels: () => ({
    formatMonthName: (value: string) => value.slice(0, 3),
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: (value: number) => value.toFixed(2) }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatRelative: () => '1h ago',
    formatTime: (value: unknown) => String(value),
    formatDateTime: (value: unknown) => String(value),
    formatDate: (value: unknown) => String(value),
    formatRelativeTime: (value: unknown) => String(value),
    formatMonthYear: (value: unknown) => String(value),
    tz: 'America/New_York',
    locale: 'en-US',
  }),
}));
vi.mock('@/components/charts', async () => {
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...chartTestDoubles,
    BarChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
      <div data-testid="bar-chart" data-json={JSON.stringify(data ?? [])}>{children}</div>
    ),
    Bar: ({ children }: { children?: ReactNode }) => <div data-testid="bar">{children}</div>,
    XAxis: () => <div />,
    YAxis: () => <div />,
    Tooltip: () => <div />,
    Legend: () => <div />,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Cell: () => <div />,
    chartGrid: null,
    chartMargin: {},
    chartAnimation: {},
    axisTick: {},
    axisTickSm: {},
    useThemeChartPalette: () => ({ primary: '#2563eb', neutral: '#64748b' }),
    useMeasuredAxisWidth: () => 40,
  };
});

import CostForecastWidget from './CostForecastWidget';

const forecastData = {
  historical: [
    { month: 'January', cost: 100, kwh: 500, sessions: 10, cost_per_kwh: 0.20 },
    { month: 'February', cost: 120, kwh: 520, sessions: 11, cost_per_kwh: 0.22 },
  ],
  forecast: [
    { month: 'March', cost: 130, cost_low: 110, cost_high: 150, kwh: 560 },
    { month: 'April', cost: 140, cost_low: 120, cost_high: 160, kwh: 580 },
  ],
  breakdown: {},
  gas_comparison: {},
  insights: [],
};

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: forecastData,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: 1_700_000_000_000,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderWidget(cols = 2, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <CostForecastWidget size={{ cols, rows: 2 }} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
  forecastMock.mockReturnValue(query());
});

describe('CostForecastWidget redesign', () => {
  it('renders the six-period forecast total as the one headline and the chart', () => {
    renderWidget();
    expect(screen.getByRole('heading', { name: 'Cost forecast' })).toBeInTheDocument();
    expect(screen.getByText('$270.00')).toBeInTheDocument();
    expect(screen.getByText('Next 2 months')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('uses the actual and forecast series without labels that imply measured precision', () => {
    renderWidget();
    const rows = JSON.parse(screen.getByTestId('bar-chart').getAttribute('data-json') ?? '[]');
    expect(rows.map((row: { period: string }) => row.period)).toEqual(['actual', 'actual', 'forecast', 'forecast']);
    expect(screen.queryByText('Avg $/kWh')).not.toBeInTheDocument();
  });

  it('passes shared timezone and resolved vehicle scope to the forecast hook', () => {
    renderWidget(2, 42);
    expect(forecastMock).toHaveBeenCalledWith('42', 6, 'America/New_York');
  });

  it('keeps the compact layout to a single headline without a chart', () => {
    renderWidget(1);
    expect(screen.getByText('$270.00')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('does not fabricate a zero total for absent forecast rows', () => {
    forecastMock.mockReturnValue(query({ data: { ...forecastData, forecast: [] } }));
    renderWidget();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('keeps a cached headline visible during a background refresh', () => {
    forecastMock.mockReturnValue(query({ isFetching: true, isStale: true }));
    renderWidget();
    expect(screen.getByText('$270.00')).toBeInTheDocument();
  });

  it('shows the shared error state rather than a false empty state', () => {
    forecastMock.mockReturnValue(query({ data: undefined, isError: true, error: new Error('boom') }));
    renderWidget();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No forecast data')).not.toBeInTheDocument();
  });

  it('uses one refresh action for freshness and empty-state recovery', () => {
    const refetch = vi.fn();
    forecastMock.mockReturnValue(query({ data: undefined, refetch }));
    renderWidget(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('degrades malformed arrays without throwing or inventing totals', () => {
    forecastMock.mockReturnValue(query({
      data: { historical: 'bad', forecast: [null], breakdown: {}, gas_comparison: {}, insights: [] },
    }));
    expect(() => renderWidget()).not.toThrow();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });
});
