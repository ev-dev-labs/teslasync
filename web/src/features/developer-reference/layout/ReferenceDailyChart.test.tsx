import { cloneElement, isValidElement, type ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ChartTooltipProps } from '@/components/charts';
import { formatDate } from '@/lib/dateFormat';
import { ReferenceDailyChart } from './ReferenceDailyChart';
import { dailyFixture } from './fixtures';

vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { inertCartesianParts } = await import('@/test/chartTestDoubles');
  return {
    ...actual, ...inertCartesianParts,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
    LineChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Line: () => null,
    Tooltip: ({ content, formatter, labelFormatter }: {
      content?: ReactNode;
      formatter?: ChartTooltipProps['formatter'];
      labelFormatter?: ChartTooltipProps['labelFormatter'];
    }) => isValidElement<ChartTooltipProps>(content) ? cloneElement(content, {
      active: true, label: 59, payload: [{ name: 'sample', value: dailyFixture[59].sample }],
      formatter, labelFormatter,
    }) : null,
  };
});

describe('reference daily chart shared tooltip', () => {
  it('retains the UTC index-to-date label, synthetic series name and every accessible observation', () => {
    render(<MemoryRouter><ReferenceDailyChart title="Daily fixture" /></MemoryRouter>);
    const tooltip = screen.getAllByRole('tooltip').find(node => node.dataset.appPart === 'chart-tooltip')!;
    expect(tooltip).toHaveAttribute('data-app-part', 'chart-tooltip');
    expect(tooltip).toHaveTextContent(formatDate(dailyFixture[59].date, { tz: 'UTC', locale: 'en' }));
    expect(tooltip.querySelector('[data-chart-tooltip-name]')).toHaveTextContent('Synthetic sample');
    expect(tooltip.querySelector('[data-chart-tooltip-value]')).toHaveTextContent(String(dailyFixture[59].sample));
    const table = screen.getByRole('table', { name: 'Daily fixture — data table' });
    expect(within(table).getAllByRole('row')).toHaveLength(61);
    expect(screen.getByText('Legend: Synthetic sample · August–September 2026 (UTC)')).toBeInTheDocument();
  });

  it('keeps the existing empty chart explanation without drawing a tooltip for absent observations', () => {
    const { container } = render(<MemoryRouter><ReferenceDailyChart title="Daily fixture" empty /></MemoryRouter>);
    expect(screen.getByText('This synthetic chart has no observations.')).toBeInTheDocument();
    expect(container.querySelector('[data-app-part="chart-tooltip"]')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
