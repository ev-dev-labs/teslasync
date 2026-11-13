import { cloneElement, isValidElement, type ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ChartTooltipProps } from '@/components/charts';
import type { BenchmarkRelease } from '@/api/hooks/useBenchmarks';
import { BenchmarkPercentileChart } from './BenchmarkPercentileChart';

vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { inertCartesianParts } = await import('@/test/chartTestDoubles');
  return {
    ...actual, ...inertCartesianParts,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
    BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Bar: () => null,
    Tooltip: ({ content, formatter }: {
      content?: ReactNode; formatter?: ChartTooltipProps['formatter'];
    }) => isValidElement<ChartTooltipProps>(content) ? cloneElement(content, {
      active: true, label: 'Efficiency', payload: [{ name: 'percentile', value: 0 }], formatter,
    }) : null,
  };
});

const release: BenchmarkRelease = {
  release_id: 1, period_start: '2026-09-01', period_end: '2026-10-01', model_family: 'Model 3',
  model_year_bucket: 2020, mechanism_version: 1, minimum_cohort_size: 10, epsilon_spent: 0.1,
  suppressed: false, suppression_reason: null, created_at: '2026-10-02T00:00:00Z',
  metrics: [{
    metric_name: 'efficiency_wh_per_km', unit: 'wh_per_km', lower_bound: 0, upper_bound: 500,
    epsilon_spent: 0.1, noisy_cohort_size: 20, noisy_mean: 150, noisy_p25: 100, noisy_p75: 200,
    noise_scale: 2, suppressed: false, quality: 'moderate', target_value: 250,
    percentile: 0, higher_is_better: false,
  }],
};

describe('benchmark percentile shared tooltip', () => {
  it('preserves the percentile formatter and a released zero without reverting to vendor tooltip chrome', () => {
    render(<MemoryRouter><BenchmarkPercentileChart release={release} optedIn /></MemoryRouter>);
    const tooltip = screen.getAllByRole('tooltip').find(node => node.dataset.appPart === 'chart-tooltip')!;
    expect(tooltip).toHaveAttribute('data-app-part', 'chart-tooltip');
    expect(tooltip.querySelector('[data-chart-tooltip-name]')).toHaveTextContent('Percentile');
    expect(tooltip.querySelector('[data-chart-tooltip-value]')).toHaveTextContent('0.00');
    expect(tooltip).toHaveTextContent('Efficiency');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(table).toHaveTextContent('Efficiency');
    expect(table).toHaveTextContent('0.00');
  });

  it('retains the empty/privacy state without displaying suppressed percentiles in the shared tooltip', () => {
    const { container } = render(<MemoryRouter><BenchmarkPercentileChart
      release={{ ...release, metrics: release.metrics.map(metric => ({ ...metric, suppressed: true })) }} optedIn
    /></MemoryRouter>);
    expect(container.querySelector('[data-app-part="chart-tooltip"]')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Noise-adjusted performance percentiles' })).toBeInTheDocument();
  });
});
