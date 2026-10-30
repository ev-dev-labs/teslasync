import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ChartTimeRangeProvider } from '@/components/charts';
import { PowerProfileChart } from './PowerProfileChart';
import { pointFixture, statsFixture, driveFixture } from './detailTestFixtures';
import type { ChartDataPoint } from './types';
import type { ReactNode } from 'react';
import { chartTokens } from '@/lib/tokens';
import type { DriveDetail, DriveTelemetryPoint } from '@/types/driving';
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
function show(points: ChartDataPoint[], drive: DriveDetail = driveFixture()) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><ChartTimeRangeProvider syncId="drive-detail">
        <PowerProfileChart chartData={points} stats={statsFixture({ powerMax: 999 })} drive={drive} />
      </ChartTimeRangeProvider></MemoryRouter>
    </QueryClientProvider>,
  );
}
// Summary values live in the card's key-value group; units sit in the label.
const summaryTerm = (label: string) => screen.getByText((_, el) => el?.tagName === 'DT'
  && (el.textContent === label || (el.textContent ?? '').startsWith(`${label} (`)));
const value = (label: string) => summaryTerm(label).nextElementSibling?.textContent;

describe('Observed power evidence', () => {
  it('BUG3 weights sparse signed observations by elapsed time, not emission frequency', () => {
    const telemetry: DriveTelemetryPoint[] = [
      [0, 10000], [1, -10000], [2, -10000], [3, -10000],
    ].map(([second, power]) => ({
      ...pointFixture(), batteryLevel: null, latitude: null, longitude: null,
      tirePressureFl: null, tirePressureFr: null, tirePressureRl: null, tirePressureRr: null,
      isClimateOn: null, timestamp: `2026-09-01T10:00:0${second}Z`,
      createdAt: `2026-09-01T10:00:0${second}Z`, power,
    }));
    show([pointFixture({ power: 10 }), ...Array.from({ length: 3 }, () => pointFixture({ power: -10 }))],
      driveFixture({ telemetry, endTs: '2026-09-01T10:00:10Z', durationS: 10 }));
    expect(value('Observed power (time-weighted)')).toBe('-8.00');
    expect(value('Average power')).toBe('16.00');
  });

  it('BUG3 does not invent an observed mean from rows without actual interval evidence', () => {
    show([pointFixture({ power: 80 }), pointFixture({ power: -20 })]);
    expect(value('Observed power (time-weighted)')).toBe('—');
  });
  it('uses shared power and zero-line paint without losing fractional regenerative signs', () => {
    show([pointFixture({ power: -5.25 }), pointFixture({ power: 12.5 })]);
    expect(screen.getByTestId('power-series')).toHaveAttribute('data-stroke', chartTokens.series[2]);
    expect(screen.getByTestId('power-reference')).toHaveAttribute('data-y', '0');
    expect(screen.getByTestId('power-reference')).toHaveAttribute('data-stroke', chartTokens.axisStroke);
    expect(screen.getByTestId('power-plot')).toHaveAttribute('data-values', '[-5.25,12.5]');
    expect(value('Maximum regen')).toBe('-5');
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
    expect(screen.getByRole('group', { name: 'Power summary' })).toBeInTheDocument();
  });

  it('uses actual sample peaks, never an aggregate average or the stats fallback', () => {
    show([pointFixture({ power: 80 }), pointFixture({ power: -20 })]);
    expect(value('Maximum power')).toBe('80');
    expect(value('Maximum regen')).toBe('-20');
    expect(screen.queryByText('999')).toBeNull();
  });

  it('does not equate untimed chart rows with a persisted aggregate average', () => {
    show([pointFixture({ power: 80 }), pointFixture({ power: -20 })]);
    expect(value('Observed power (time-weighted)')).toBe('—');
    expect(value('Average power')).toBe('16.00');
  });

  it('renders chart and summary placeholders when no samples were recorded', () => {
    show([]);
    expect(screen.getByText('No telemetry data available')).toBeInTheDocument();
    expect(value('Maximum power')).toBe('—');
    expect(value('Maximum regen')).toBe('—');
    expect(value('Average power')).toBe('16.00');
  });

  it('retains one observed reading without pretending a line can be plotted', () => {
    show([pointFixture({ power: 42 })]);
    expect(screen.getByText('No telemetry data available')).toBeInTheDocument();
    expect(value('Maximum power')).toBe('42');
  });

  it('rejects null/non-finite samples rather than displaying an invented zero peak', () => {
    show([pointFixture({ power: null }), pointFixture({ power: NaN }), pointFixture({ power: Infinity })]);
    expect(value('Maximum power')).toBe('—');
    expect(value('Observed power (time-weighted)')).toBe('—');
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
  });

  it('honors a real zero observation and reports no observed regen for positive-only samples', () => {
    show([pointFixture({ power: 0 }), pointFixture({ power: 20 })]);
    expect(value('Maximum power')).toBe('20');
    expect(value('Maximum regen')).toBe('0');
    expect(value('Observed power (time-weighted)')).toBe('—');
  });

  it('keeps minimum moving speed distinct from stationary zeroes and shows units', () => {
    show([pointFixture({ speed: 0 }), pointFixture({ speed: 12 })]);
    expect(value('Min moving speed')).toBe('12.00');
    expect(summaryTerm('Min moving speed')).toHaveTextContent('Min moving speed (km/h)');
  });
});
