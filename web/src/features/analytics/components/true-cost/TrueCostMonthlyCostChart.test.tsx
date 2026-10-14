import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { analyzeTrueCost } from '../../lib/trueCost';
import type { TrueCostSectionProps } from './types';
import type { ChartTooltipProps } from '@/components/charts/ChartTooltip';

const capture = vi.hoisted(() => ({
  chart: vi.fn(),
  container: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => Array(6).fill('var(--chart-1)'),
}));

vi.mock('@/components/charts', async () => {
  const { ChartTooltip } = await vi.importActual<
    typeof import('@/components/charts/ChartTooltip')
  >('@/components/charts/ChartTooltip');
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    ChartTooltip,
    ChartContainer: (props: { children: (context: object) => ReactNode }) => {
      capture.container(props);
      return <>{props.children({})}</>;
    },
    BarChart: (props: { children?: ReactNode; data: unknown }) => {
      capture.chart(props.data);
      return <>{props.children}</>;
    },
    ResponsiveContainer: passthrough,
    Tooltip: ({ content }: { content: ReactElement<ChartTooltipProps> }) =>
      cloneElement(content, {
        active: true,
        label: 'Jan 2025',
        payload: [
          { name: 'Recorded EV cost', value: 1234.567, dataKey: 'evCost' },
          { name: 'Modeled gas equivalent', value: 2345.678, dataKey: 'gasCost' },
        ],
      }),
    Bar: () => null,
    ChartLegend: () => null,
    XAxis: () => null,
    YAxis: () => null,
    axisTick: {},
    chartGrid: null,
  };
});

vi.mock('./TrueCostSectionBody', () => ({
  TrueCostSectionBody: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { TrueCostMonthlyCostChart } from './TrueCostMonthlyCostChart';

function props(currency = 'USD'): TrueCostSectionProps {
  const formatCurrency = (value: number | null | undefined) =>
    value == null ? '—' : new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(value);
  return {
    analysis: analyzeTrueCost({
      monthly_breakdown: [
        { month: '2025-01', ev_cost: 1234.567, equiv_gas_cost: 2345.678 },
        { month: '2025-02', ev_cost: 40.125, equiv_gas_cost: 0 },
        { month: '2025-03', ev_cost: 50, equiv_gas_cost: null },
      ],
    }),
    state: {
      enabled: true, hasData: true, isLoading: false, isResolved: true,
      isFetching: false, isPaused: false, refreshPaused: false,
      error: null, refreshError: null, onRetry: vi.fn(),
    },
    display: {
      distanceUnit: 'km', energyUnit: 'kWh',
      formatNumber: String,
      formatCurrency,
      formatSignedCurrency: formatCurrency,
      formatDistanceKm: String,
      distanceValueKm: (value) => value,
      costPerDistanceValue: (value) => value,
      formatCostPerDistance: String,
      formatEnergy: String,
      energyValue: (value) => value,
      formatMonth: (month) => month === '2025-01' ? 'Jan 2025' : 'Feb 2025',
    },
    gasUnit: 'gallon',
  };
}

beforeEach(() => vi.clearAllMocks());

describe('TrueCostMonthlyCostChart', () => {
  it.each(['USD', 'EUR'])('formats both tooltip series using the supplied %s currency formatter', (currency) => {
    const input = props(currency);
    render(<TrueCostMonthlyCostChart {...input} />);

    const tooltip = within(screen.getByRole('tooltip'));
    expect(tooltip.getByText('Jan 2025')).toBeInTheDocument();
    expect(tooltip.getByText('Recorded EV cost:')).toBeInTheDocument();
    expect(tooltip.getByText('Modeled gas equivalent:')).toBeInTheDocument();
    expect(tooltip.getByText(input.display.formatCurrency(1234.567))).toBeInTheDocument();
    expect(tooltip.getByText(input.display.formatCurrency(2345.678))).toBeInTheDocument();
  });

  it('preserves numeric precision, populated months, zero gas cost, and raw export values', () => {
    render(<TrueCostMonthlyCostChart {...props()} />);

    const rows = [
      { month: '2025-01', monthLabel: 'Jan 2025', evCost: 1234.567, gasCost: 2345.678 },
      { month: '2025-02', monthLabel: 'Feb 2025', evCost: 40.125, gasCost: 0 },
    ];
    expect(capture.chart).toHaveBeenCalledWith(rows);
    expect(capture.container).toHaveBeenCalledWith(expect.objectContaining({
      data: rows,
      exportable: true,
      exportData: [
        { month: '2025-01', ev_cost: 1234.567, equiv_gas_cost: 2345.678 },
        { month: '2025-02', ev_cost: 40.125, equiv_gas_cost: 0 },
      ],
    }));
  });
});
