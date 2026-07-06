/**
 * WidgetChartSummary — behaviour + hardening coverage.
 *
 * The component is the shared "stat row + chart body" layout used by the
 * dashboard's chart widgets. It has one runtime export (the component) plus a
 * type export (`ChartSummaryStat`). Every branch is exercised through the
 * component:
 *   - `isEmpty` short-circuits to an <EmptyState> (default vs. caller message + icon).
 *   - the stat row renders label / value / optional unit for each stat.
 *   - `compact` hides the chart body (stats-only), otherwise the chart renders.
 *
 * It also locks in the elevation's hardening:
 *   - a nullish `stats` array no longer throws on `.length` / `.map` (degrades to
 *     a chart-only render).
 *   - a nullish `stat.value` renders an explicit "—" placeholder while a real 0
 *     is preserved (never silently blanked).
 *   - colliding stat labels both render (keys are index-disambiguated).
 *
 * The component uses no hooks or network, so a bare render() suffices — the
 * <EmptyState> path renders shared typography primitives that need no provider.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WidgetChartSummary, type ChartSummaryStat } from './WidgetChartSummary';

const chartNode = <div data-testid="chart">chart-body</div>;

const sampleStats: ChartSummaryStat[] = [
  { label: 'Most Common', value: 45, unit: 'mph' },
  { label: 'Sweet Spot', value: '30-40', unit: 'mph' },
];

describe('WidgetChartSummary — empty state', () => {
  it('renders the default empty message via role=status and hides stats + chart when isEmpty', () => {
    render(<WidgetChartSummary isEmpty stats={sampleStats} chart={chartNode} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('No data available');
    expect(screen.queryByText('Most Common')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  });

  it('renders a caller-supplied empty message and icon when provided', () => {
    render(
      <WidgetChartSummary
        isEmpty
        emptyMessage="No speed data"
        emptyIcon={<svg data-testid="empty-icon" />}
        stats={[]}
        chart={chartNode}
      />,
    );

    expect(screen.getByText('No speed data')).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    // Custom message replaces the default fallback entirely.
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
  });
});

describe('WidgetChartSummary — stats + chart layout', () => {
  it('renders each stat label, value and unit plus the chart in the default (non-compact) layout', () => {
    render(<WidgetChartSummary stats={sampleStats} chart={chartNode} />);

    expect(screen.getByText('Most Common')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('Sweet Spot')).toBeInTheDocument();
    expect(screen.getByText('30-40')).toBeInTheDocument();
    // One unit label per stat.
    expect(screen.getAllByText('mph')).toHaveLength(2);
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });

  it('hides the chart body in compact mode but still shows the stats', () => {
    render(<WidgetChartSummary compact stats={sampleStats} chart={chartNode} />);

    expect(screen.getByText('Most Common')).toBeInTheDocument();
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  });

  it('omits the stat row when there are no stats but still renders the chart', () => {
    render(<WidgetChartSummary stats={[]} chart={chartNode} />);

    expect(screen.queryByText('Most Common')).not.toBeInTheDocument();
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });

  it('renders a stat without a unit (no trailing unit label)', () => {
    render(
      <WidgetChartSummary
        stats={[{ label: 'Trips', value: 12 }]}
        chart={chartNode}
      />,
    );

    expect(screen.getByText('Trips')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('mph')).not.toBeInTheDocument();
  });
});

describe('WidgetChartSummary — null safety (hardening)', () => {
  it('renders an em-dash for a nullish value while preserving a real 0', () => {
    const stats: ChartSummaryStat[] = [
      { label: 'Missing', value: undefined as unknown as number },
      { label: 'Zero', value: 0, unit: 'kWh' },
    ];
    render(<WidgetChartSummary stats={stats} chart={chartNode} />);

    expect(screen.getByText('—')).toBeInTheDocument();
    // A genuine zero is not coalesced away.
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();
  });

  it('does not throw and still renders the chart when stats is nullish', () => {
    expect(() =>
      render(
        <WidgetChartSummary
          stats={undefined as unknown as ChartSummaryStat[]}
          chart={chartNode}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByTestId('chart')).toBeInTheDocument();
    expect(screen.queryByText('Most Common')).not.toBeInTheDocument();
  });

  it('renders every stat when labels collide (index-disambiguated keys)', () => {
    const stats: ChartSummaryStat[] = [
      { label: 'Avg', value: 10, unit: 'kW' },
      { label: 'Avg', value: 20, unit: 'kW' },
    ];
    render(<WidgetChartSummary stats={stats} chart={chartNode} />);

    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getAllByText('Avg')).toHaveLength(2);
  });
});
