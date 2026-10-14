import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChartContainer } from '@/components/charts';
import { analyzeSleepEfficiency } from '../../lib/sleepEfficiencyAnalysis';
import { DwellDurationChart } from './DwellDurationChart';
import type { SleepEfficiencyQueryState } from './types';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(),
    exporting: false,
  }),
}));

vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotations: () => ({ data: [], isLoading: false }),
  useCreateAnnotation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAnnotation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    ChartContainer: vi.fn((props: ComponentProps<typeof actual.ChartContainer>) =>
      <actual.ChartContainer {...props} />),
  };
});

const ready: SleepEfficiencyQueryState = {
  vehicleSelected: true,
  isLoading: false,
  isResolved: true,
  error: null,
  refreshError: null,
  onRetry: vi.fn(),
};
const populated = analyzeSleepEfficiency({
  state_distribution: [
    { state: 'asleep', count: 2, total_minutes: 90 },
    { state: 'online', count: 1, total_minutes: 0 },
  ],
}, Date.parse('2026-10-14T12:00:00Z'));
const missing = analyzeSleepEfficiency(undefined, Date.parse('2026-10-14T12:00:00Z'));

function chartProps(): ComponentProps<typeof ChartContainer> {
  const calls = vi.mocked(ChartContainer).mock.calls;
  return calls[calls.length - 1][0];
}

function frame() {
  return screen.getByTestId('sleep-efficiency-dwell-distribution')
    .querySelector('[data-chart-state]');
}

function tree(
  analysis = populated,
  state = ready,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DwellDurationChart analysis={analysis} state={state} />
        <div>Independent neighboring evidence</div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DwellDurationChart canonical frame state', () => {
  it('marks active initial loading without fabricating chart data', () => {
    render(tree(missing, { ...ready, isLoading: true, isResolved: false }));
    expect(frame()).toHaveAttribute('data-chart-state', 'loading');
    expect(frame()).toHaveAttribute('aria-busy', 'true');
    expect(chartProps().data).toEqual([]);
    expect(chartProps().exportData).toEqual([]);
    expect(screen.getByText('Dwell-duration distribution')).toBeInTheDocument();
    expect(screen.getByText('Independent neighboring evidence')).toBeInTheDocument();
  });

  it('keeps paused-without-data pending, not loading or a fabricated failure', () => {
    render(tree(missing, { ...ready, isResolved: false }));
    expect(frame()).toHaveAttribute('data-chart-state', 'empty');
    expect(frame()).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('Sleep evidence availability has not resolved.')).toBeInTheDocument();
    expect(chartProps().error).toBeNull();
    expect(chartProps().exportData).toEqual([]);
  });

  it('preserves the no-vehicle explanation inside the frame', () => {
    render(tree(missing, { ...ready, vehicleSelected: false, isResolved: false }));
    expect(frame()).toHaveAttribute('data-chart-state', 'empty');
    expect(screen.getByText('Select a vehicle to make sleep evidence available.')).toBeInTheDocument();
  });

  it.each([[], [{ state: 'asleep', count: 0, total_minutes: 0 }]])(
    'explains successful responses without positive dwell evidence: %j',
    (rows) => {
      const analysis = analyzeSleepEfficiency({ state_distribution: rows }, Date.now());
      render(tree(analysis));
      expect(frame()).toHaveAttribute('data-chart-state', 'empty');
      expect(screen.getByText('Dwell reconstruction unavailable')).toBeInTheDocument();
      expect(screen.getByText(/Zero total_minutes rows are retained as valid rows/)).toBeInTheDocument();
      expect(chartProps().exportData).toEqual([]);
      expect(screen.getByText('Independent neighboring evidence')).toBeInTheDocument();
    },
  );

  it('forwards initial failure without blanking neighboring evidence', () => {
    const error = new Error('Sleep request failed');
    render(tree(missing, { ...ready, error }));
    expect(frame()).toHaveAttribute('data-chart-state', 'error');
    expect(chartProps().error).toBe(error);
    expect(chartProps().exportData).toEqual([]);
    expect(screen.getByText('Independent neighboring evidence')).toBeInTheDocument();
  });

  it('retains chart and export rows through refresh failure and recovery', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(tree(populated, ready, client));
    const data = chartProps().data;
    expect(data).toEqual([
      { state: 'Asleep', minutes: 90, share: 100 },
      { state: 'Online', minutes: 0, share: 0 },
    ]);
    expect(frame()).toHaveAttribute('data-chart-state', 'ready');

    view.rerender(tree(populated, {
      ...ready,
      refreshError: new Error('Refresh failed'),
    }, client));
    expect(frame()).toHaveAttribute('data-chart-state', 'ready');
    expect(chartProps().data).toEqual(data);
    expect(chartProps().exportData).toEqual(data);
    expect(chartProps().error).toBeNull();
    expect(screen.getByText('Independent neighboring evidence')).toBeInTheDocument();

    view.rerender(tree(populated, ready, client));
    expect(frame()).toHaveAttribute('data-chart-state', 'ready');
    expect(chartProps().exportData).toEqual(data);
    expect(chartProps().dataColumns?.map((column) => column.key))
      .toEqual(['state', 'minutes', 'share']);
  });
});
