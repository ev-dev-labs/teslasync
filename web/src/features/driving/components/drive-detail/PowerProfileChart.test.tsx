import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ChartTimeRangeProvider } from '@/components/charts';
import { PowerProfileChart } from './PowerProfileChart';
import { pointFixture, statsFixture, driveFixture } from './detailTestFixtures';
import type { ChartDataPoint } from './types';
import type { ReactNode } from 'react';
import { chartTokens } from '@/lib/tokens';
vi.mock('@/components/charts', async () => ({
  ...await vi.importActual<typeof import('@/components/charts')>('@/components/charts'),
  ...(await import('@/test/chartTestDoubles')).inertCartesianParts,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  AreaChart: ({ children, data }: { children: ReactNode; data: ChartDataPoint[] }) =>
    <div data-testid="power-plot" data-values={JSON.stringify(data.map((point) => point.power))}>{children}</div>,
  Area: ({ stroke }: { stroke: string }) => <span data-testid="power-series" data-stroke={stroke} />,
  ReferenceLine: ({ y, stroke }: { y?: number; stroke: string }) =>
    <span data-testid="power-reference" data-y={y} data-stroke={stroke} />,
}));
vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key, i18n: { language: 'en' } }),
}));
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({ chartRef: { current: null }, exportPNG: vi.fn(), exportSVG: vi.fn(), copyToClipboard: vi.fn(), exporting: false }),
}));
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotations: () => ({ data: [], isPending: false, isLoading: false, isFetching: false, isError: false, error: null, fetchStatus: 'idle', dataUpdatedAt: 0, refetch: vi.fn() }),
  useChartAnnotationsAsData: () => ({ annotations: [] }), useCreateAnnotation: () => ({ mutate: vi.fn() }), useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));
function show(points: ChartDataPoint[]) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><ChartTimeRangeProvider syncId="drive-detail">
        <PowerProfileChart chartData={points} stats={statsFixture({ powerMax: 999 })} drive={driveFixture()} />
      </ChartTimeRangeProvider></MemoryRouter>
    </QueryClientProvider>,
  );
}
const value = (label: string) => within(screen.getByRole('rowheader', { name: label }).closest('tr')!).getByRole('cell').textContent;

describe('Observed power evidence', () => {
  it('uses shared power and zero-line paint without losing fractional regenerative signs', () => {
    show([pointFixture({ power: -5.25 }), pointFixture({ power: 12.5 })]);
    expect(screen.getByTestId('power-series')).toHaveAttribute('data-stroke', chartTokens.series[2]);
    expect(screen.getByTestId('power-reference')).toHaveAttribute('data-y', '0');
    expect(screen.getByTestId('power-reference')).toHaveAttribute('data-stroke', chartTokens.axisStroke);
    expect(screen.getByTestId('power-plot')).toHaveAttribute('data-values', '[-5.25,12.5]');
    expect(value('Maximum regen')).toBe('-5 kW');
  });
  it('suppresses image export until two finite power observations are available', () => {
    const { container, unmount } = show([pointFixture({ power: 0 }), pointFixture({ power: NaN })]);
    expect(container.querySelector('[data-chart-state]')).toHaveAttribute('data-chart-state', 'empty');
    expect(screen.queryByRole('button', { name: 'Export chart' })).not.toBeInTheDocument();
    unmount();
    show([pointFixture({ power: 0 }), pointFixture({ power: 0 })]);
    expect(screen.getByRole('button', { name: 'Export chart' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /CSV/i })).not.toBeInTheDocument();
  });

  it('keeps the chart title, signed-zero reference and synchronized context', () => {
    show([pointFixture(), pointFixture({ power: -20 })]);
    expect(screen.getByRole('heading', { name: 'Power profile' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Power profile' })).toBeInTheDocument();
  });

  it('uses actual sample peaks, never an aggregate average or the stats fallback', () => {
    show([pointFixture({ power: 80 }), pointFixture({ power: -20 })]);
    expect(value('Maximum power')).toBe('80 kW');
    expect(value('Maximum regen')).toBe('-20 kW');
    expect(screen.queryByText('999 kW')).toBeNull();
  });

  it('distinguishes arithmetic sample mean from persisted aggregate average', () => {
    show([pointFixture({ power: 80 }), pointFixture({ power: -20 })]);
    expect(value('Mean sampled power')).toBe('30.00 kW');
    expect(value('Average power')).toBe('16.00 kW');
  });

  it('renders chart and summary placeholders when no samples were recorded', () => {
    show([]);
    expect(screen.getByText('No telemetry data available')).toBeInTheDocument();
    expect(value('Maximum power')).toBe('—');
    expect(value('Maximum regen')).toBe('—');
    expect(value('Average power')).toBe('16.00 kW');
  });

  it('retains one observed reading without pretending a line can be plotted', () => {
    show([pointFixture({ power: 42 })]);
    expect(screen.getByText('No telemetry data available')).toBeInTheDocument();
    expect(value('Maximum power')).toBe('42 kW');
  });

  it('rejects null/non-finite samples rather than displaying an invented zero peak', () => {
    show([pointFixture({ power: null }), pointFixture({ power: NaN }), pointFixture({ power: Infinity })]);
    expect(value('Maximum power')).toBe('—');
    expect(value('Mean sampled power')).toBe('—');
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
  });

  it('honors a real zero observation and reports no observed regen for positive-only samples', () => {
    show([pointFixture({ power: 0 }), pointFixture({ power: 20 })]);
    expect(value('Maximum power')).toBe('20 kW');
    expect(value('Maximum regen')).toBe('0 kW');
    expect(value('Mean sampled power')).toBe('10.00 kW');
  });

  it('keeps minimum moving speed distinct from stationary zeroes and shows units', () => {
    show([pointFixture({ speed: 0 }), pointFixture({ speed: 12 })]);
    expect(value('Minimum moving speed')).toBe('12.00 km/h');
  });
});
