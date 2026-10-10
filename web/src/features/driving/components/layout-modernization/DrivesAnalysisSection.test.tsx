import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { MetricSwitcherChart } from '@/components/charts';
import { DrivesAnalysisSection, type DrivesAnalysisSectionProps } from './index';
import { installResizeHarness } from './resizeHarness';

type ChartProps = ComponentProps<typeof MetricSwitcherChart<{ date: string; value: number }>>;
vi.mock('@/components/charts', () => ({
  // Only the heavy plot is doubled. The live analysis, section and placement
  // adapters are rendered; assert forwarding at the chart-owner boundary.
  MetricSwitcherChart: vi.fn(({ title, metrics, onMetricChange, activeMetric, emptyMessage, series, testId }: ChartProps) => (
    <GlassPanel data-testid={testId}>
      <PanelTitle>{title}</PanelTitle>
      {metrics.map(metric => <Button key={metric.key} onClick={() => onMetricChange(metric.key)}>{metric.label}</Button>)}
      <Text>{series[activeMetric]?.length ? 'Measured chart evidence' : emptyMessage}</Text>
    </GlassPanel>
  )),
}));
afterEach(() => vi.unstubAllGlobals());

function props(): DrivesAnalysisSectionProps {
  return {
    isLoading: false,
    count: 3,
    series: {
      drives: [{ date: '2026-10-01', value: 3 }],
      distance: [{ date: '2026-10-01', value: 32000 }],
      score: [{ date: '2026-10-01', value: 88 }],
      efficiency: [{ date: '2026-10-01', value: 225 }],
      cost: [{ date: '2026-10-01', value: 0.864 }],
    },
    metrics: [
      { key: 'drives', label: 'Drives', formatValue: value => String(value) },
      { key: 'distance', label: 'Distance', getValue: point => point.value / 1000 },
      { key: 'score', label: 'Efficiency grade' },
      { key: 'efficiency', label: 'Energy intensity' },
      { key: 'cost', label: 'Cost' },
    ],
    activeMetric: 'drives',
    onMetricChange: vi.fn(),
    formatXTick: date => date,
    highlightRows: [
      { key: 'topSpeed', icon: null, label: 'Top speed with full specialist context', value: '112 km/h' },
      { key: 'longest', icon: null, label: 'Longest', value: '32 km' },
      { key: 'avgSpeed', icon: null, label: 'Average speed', value: '72 km/h' },
      { key: 'totalCost', icon: null, label: 'Cost', value: '$0.86' },
    ],
    anomalyFooter: <Button>View anomalies</Button>,
  };
}

describe('drive-history analysis preservation', () => {
  it('forwards all five raw series and specialist formatters unchanged, retaining highlights and actions on phone', () => {
    const harness = installResizeHarness();
    const value = props();
    const { container } = render(<DrivesAnalysisSection {...value} />);
    harness.resize(390);
    const forwarded = vi.mocked(MetricSwitcherChart).mock.calls.at(-1)?.[0];
    expect(forwarded?.series).toBe(value.series);
    expect(forwarded?.metrics).toBe(value.metrics);
    expect(forwarded?.formatXTick).toBe(value.formatXTick);
    expect(screen.getByRole('region', { name: 'Trends and highlights' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Trends and highlights' })).toHaveAttribute('data-container-band', 'phone');
    expect(Array.from(container.querySelectorAll('dt')).map(node => node.textContent))
      .toEqual(value.highlightRows.map(row => row.label));
    expect(Array.from(container.querySelectorAll('dd')).map(node => node.textContent))
      .toEqual(value.highlightRows.map(row => row.value));
    expect(screen.getByRole('button', { name: 'View anomalies' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Distance' }));
    expect(value.onMetricChange).toHaveBeenCalledWith('distance');
    harness.resize(1440);
    expect(Array.from(container.querySelectorAll('[data-preserved-panel]')).map(node => node.getAttribute('data-panel-span')))
      .toEqual(['8', '4']);
    expect(screen.getByRole('button', { name: 'View anomalies' })).toBeVisible();
  });

  it('retains both independent shells through loading and empty evidence without changing chart ownership', () => {
    installResizeHarness();
    const value = props();
    const { container, rerender } = render(<DrivesAnalysisSection {...value} isLoading />);
    expect(container.querySelectorAll('[data-preserved-panel]')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Drives over time' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Highlights' })).toBeVisible();
    expect(screen.queryByText('No highlights in this range')).not.toBeInTheDocument();
    rerender(<DrivesAnalysisSection {...value} count={0} series={{ ...value.series, drives: [] }} />);
    expect(container.querySelectorAll('[data-preserved-panel]')).toHaveLength(2);
    expect(screen.getByText('No highlights in this range')).toBeVisible();
    expect(screen.getByText('No data for this metric in the selected range')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Distance' })).toBeVisible();
    // An empty active series is not a reason to remove the other four metrics.
    expect(vi.mocked(MetricSwitcherChart).mock.calls.at(-1)?.[0].series.distance).toBe(value.series.distance);
  });
});
