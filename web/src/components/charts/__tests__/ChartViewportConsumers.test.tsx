import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnergyFlowChart } from '@/features/home-energy/components/EnergyFlowChart';
import { PowerHistoryChart } from '@/features/battery/components/power-flow/PowerHistoryChart';
import SessionCurveChart from '@/features/charging/components/charging-curve/SessionCurveChart';
import SessionComparisonChart from '@/features/charging/components/charging-curve/SessionComparisonChart';
import ChargerTypeChart from '@/features/charging/components/charging-curve/ChargerTypeChart';
import SpeedTrendChart from '@/features/charging/components/charging-curve/SpeedTrendChart';
import YearlyTrendChart from '@/features/charging/components/charging-curve/YearlyTrendChart';

vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    ChartContainer: ({ children }: ComponentProps<typeof actual.ChartContainer>) => (
      <>{typeof children === 'function'
        ? children({ annotations: [], hidden: false, hiddenSeries: null })
        : children}</>
    ),
    ResponsiveContainer: ({ height, children }: ComponentProps<typeof actual.ResponsiveContainer>) => (
      <div data-testid="responsive-plot" data-height={String(height)}>{children}</div>
    ),
  };
});

vi.mock('@/components/layout', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/layout')>(),
  ChartCard: (await import('@/components/charts')).ChartContainer,
}));

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
afterEach(() => client.clear());

describe('shared chart viewport ownership', () => {
  it.each([
    ['energy schedule', <EnergyFlowChart slots={[]} slotMinutes={15} />],
    ['power history', <PowerHistoryChart data={[]} loading={false} error={null} onRetry={vi.fn()} />],
    ['session power', <SessionCurveChart curveData={[{ soc: 20, power: 50 }]} />],
    ['session comparison', <SessionComparisonChart sessions={[]} />],
    ['charger categories', <ChargerTypeChart sessions={[]} />],
    ['monthly charge speed', <SpeedTrendChart sessions={[]} />],
    ['yearly charge speed', <YearlyTrendChart yearlyTrend={[{ year: '2026', avg10to80: 25, avg20to80: 20, count: 2 }]} />],
  ])('%s consumes its authoritative viewport instead of repeating a desktop height', (_name, chart) => {
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>{chart}</MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('responsive-plot')).toHaveAttribute('data-height', '100%');
  });
});
