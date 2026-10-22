/**
 * WidgetChartSummary — behaviour + hardening coverage.
 *
 * The component is the shared "stat row + chart body" layout used by the
 * dashboard's chart widgets. It has one runtime export (the component) plus
 * type exports (`ChartSummaryStat`, `ChartSummaryLegendItem`). Every branch
 * is exercised through the component:
 *   - `isEmpty` short-circuits to an <EmptyState> (default vs. caller message + icon).
 *   - the stat row renders label / value / optional unit for each stat.
 *   - `compact` hides the chart body (stats-only), otherwise the chart renders.
 *   - `yAxisLabel` / `xAxisLabel` render quiet chart captions (hidden with the chart).
 *   - `legend` renders a dot + word series key defaulting to the
 *     `chartTokens.series` dark/light pairs (hidden with the chart).
 *
 * It also locks in the elevation's hardening:
 *   - a nullish `stats` array no longer throws on `.length` / `.map` (degrades to
 *     a chart-only render).
 *   - a nullish `stat.value` renders an explicit "—" placeholder while a real 0
 *     is preserved (never silently blanked).
 *   - colliding stat labels both render (keys are index-disambiguated).
 *
 * The component uses only the local i18n instance and no network, so a bare
 * render suffices.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@/i18n';
import { chartTokens } from '@/lib/tokens';
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
    expect(status).toHaveTextContent('This widget has no qualifying data yet.');
    expect(status).toHaveTextContent('It will populate after the source records relevant activity.');
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
    expect(screen.queryByText('This widget has no qualifying data yet.')).not.toBeInTheDocument();
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
  it('shows unknown rather than a non-finite value or a misleading unit', () => {
    render(<WidgetChartSummary stats={[{ label: 'Range', value: Infinity, unit: 'km' }]} chart={chartNode} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('Infinity')).not.toBeInTheDocument();
    expect(screen.queryByText('km')).not.toBeInTheDocument();
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });

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

describe('WidgetChartSummary — axis labels', () => {
  it('renders the axis titles around the chart body when provided', () => {
    render(
      <WidgetChartSummary
        stats={sampleStats}
        chart={chartNode}
        yAxisLabel="kW"
        xAxisLabel="Speed range"
      />,
    );

    expect(screen.getByText('kW')).toBeInTheDocument();
    expect(screen.getByText('Speed range')).toBeInTheDocument();
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });

  it('renders no axis captions by default', () => {
    const { container } = render(<WidgetChartSummary stats={sampleStats} chart={chartNode} />);

    expect(container.querySelector('p')).not.toBeInTheDocument();
  });

  it('hides the axis titles in compact mode with the chart', () => {
    render(
      <WidgetChartSummary
        compact
        stats={sampleStats}
        chart={chartNode}
        yAxisLabel="kW"
        xAxisLabel="Speed range"
      />,
    );

    expect(screen.queryByText('kW')).not.toBeInTheDocument();
    expect(screen.queryByText('Speed range')).not.toBeInTheDocument();
  });
});

describe('WidgetChartSummary — legend (dark-mode pairs)', () => {
  it('renders each series as a dot + word key with the chartTokens dark/light pair by default', () => {
    const { container } = render(
      <WidgetChartSummary
        stats={sampleStats}
        chart={chartNode}
        legend={[{ label: 'Solar' }, { label: 'Home' }]}
      />,
    );

    const list = container.querySelector('ul');
    expect(list).toBeInTheDocument();
    const items = within(list as HTMLElement).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Solar')).toBeInTheDocument();
    expect(within(items[1]).getByText('Home')).toBeInTheDocument();
    // Dots are decorative: the adjacent word carries the meaning.
    // (jsdom serializes hex constituents as rgb; the light-dark() pairing
    // itself must survive — that pairing is the dark-mode behavior.)
    const dots = container.querySelectorAll('li > span[aria-hidden="true"]');
    expect(dots).toHaveLength(2);
    const first = dots[0].getAttribute('style') ?? '';
    const second = dots[1].getAttribute('style') ?? '';
    expect(first).toContain('light-dark(');
    expect(first).toContain('56, 94, 126');
    expect(first).toContain('145, 180, 210');
    expect(second).toContain('light-dark(');
    expect(second).not.toBe(first);
    expect(chartTokens.series).toHaveLength(8);
  });

  it('honours an explicit caller color override', () => {
    const { container } = render(
      <WidgetChartSummary
        stats={sampleStats}
        chart={chartNode}
        legend={[{ label: 'Solar', color: '#123456' }]}
      />,
    );

    const dot = container.querySelector('li > span[aria-hidden="true"]');
    // #123456 serialized by the CSSOM as rgb(18, 52, 86).
    expect(dot?.getAttribute('style')).toContain('18, 52, 86');
  });

  it('renders no legend by default and hides it in compact mode with the chart', () => {
    const { container, rerender } = render(
      <WidgetChartSummary stats={sampleStats} chart={chartNode} />,
    );
    expect(container.querySelector('ul')).not.toBeInTheDocument();

    rerender(
      <WidgetChartSummary
        compact
        stats={sampleStats}
        chart={chartNode}
        legend={[{ label: 'Solar' }]}
      />,
    );
    expect(screen.queryByText('Solar')).not.toBeInTheDocument();
  });

  it('renders every legend entry when labels collide (index-disambiguated keys)', () => {
    render(
      <WidgetChartSummary
        stats={sampleStats}
        chart={chartNode}
        legend={[{ label: 'Avg' }, { label: 'Avg' }]}
      />,
    );

    expect(screen.getAllByText('Avg')).toHaveLength(2);
  });
});
