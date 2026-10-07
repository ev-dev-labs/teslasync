/**
 * MetricSwitcherChart unit tests.
 *
 * The chart wraps `<ChartContainer>` (which depends on i18next, the
 * useChartExport hook, and the annotations API) — we mock those the
 * same way `ChartContainer.test.tsx` does so the chart renders in
 * isolation.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MetricSwitcherChart, type MetricSwitcherMetric } from '../MetricSwitcherChart';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
    exporting: false,
  }),
}));

vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

interface Pt { date: string; value: number }

const series: Record<string, Pt[]> = {
  drives: [
    { date: 'Apr 13', value: 1 },
    { date: 'Apr 20', value: 2 },
  ],
  distance: [
    { date: 'Apr 13', value: 5 },
    { date: 'Apr 20', value: 10 },
  ],
};

const metrics: MetricSwitcherMetric<Pt>[] = [
  { key: 'drives', label: 'Drives', chart: 'bar' },
  { key: 'distance', label: 'Distance', chart: 'area', formatValue: (v) => `${v} mi` },
];

function renderWithProviders(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><div style={{ width: 640, height: 240 }}>{ui}</div></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MetricSwitcherChart', () => {
  it('renders the title and pill buttons for every metric', () => {
    renderWithProviders(
      <MetricSwitcherChart
        title="Drives over time"
        ariaLabel="Drives over time"
        series={series}
        metrics={metrics}
        activeMetric="drives"
        onMetricChange={() => undefined}
        emptyMessage="No data"
        testId="msc"
      />,
    );

    expect(screen.getByText('Drives over time')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Drives' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Distance' })).toBeInTheDocument();
  });

  it('marks the active pill via aria-selected', () => {
    renderWithProviders(
      <MetricSwitcherChart
        title="x"
        ariaLabel="x"
        series={series}
        metrics={metrics}
        activeMetric="distance"
        onMetricChange={() => undefined}
        emptyMessage="No data"
      />,
    );
    expect(screen.getByRole('tab', { name: 'Distance' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Drives' })).toHaveAttribute('aria-selected', 'false');
  });

  it('invokes onMetricChange when a pill is clicked', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MetricSwitcherChart
        title="x"
        ariaLabel="x"
        series={series}
        metrics={metrics}
        activeMetric="drives"
        onMetricChange={onChange}
        emptyMessage="No data"
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Distance' }));
    expect(onChange).toHaveBeenCalledWith('distance');
  });

  it('renders the empty-state message when the active series is empty', () => {
    renderWithProviders(
      <MetricSwitcherChart
        title="x"
        ariaLabel="x"
        series={{ drives: [], distance: [] }}
        metrics={metrics}
        activeMetric="drives"
        onMetricChange={() => undefined}
        emptyMessage="Nothing to show"
      />,
    );
    expect(screen.getByText('Nothing to show')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export chart' })).toBeNull();
  });

  it('falls back to the first metric when active is unknown', () => {
    renderWithProviders(
      <MetricSwitcherChart
        title="x"
        ariaLabel="x"
        series={series}
        metrics={metrics}
        activeMetric="unknown"
        onMetricChange={() => undefined}
        emptyMessage="No data"
      />,
    );
    // Tablist still renders both options regardless of active.
    expect(screen.getByRole('tab', { name: 'Drives' })).toBeInTheDocument();
  });

  it('uses the compact chart preset and exposes the active metric as a fallback table', () => {
    renderWithProviders(
      <MetricSwitcherChart
        title="x"
        ariaLabel="x"
        series={series}
        metrics={metrics}
        activeMetric="distance"
        onMetricChange={() => undefined}
        emptyMessage="No data"
      />,
    );

    expect(screen.getByRole('figure')).toHaveAttribute('data-chart-size', 'compact');
    expect(screen.getByRole('table')).toHaveTextContent('Date');
    expect(screen.getByRole('table')).toHaveTextContent('Distance');
    expect(screen.getByRole('table')).toHaveTextContent('5 mi');
  });
});
