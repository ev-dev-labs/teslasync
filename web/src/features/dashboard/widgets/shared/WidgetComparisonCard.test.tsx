/**
 * WidgetComparisonCard — behavioural, branch, null-safety and a11y coverage for
 * the dashboard "current vs previous period" card.
 *
 * The card maps each `ComparisonMetric` to the spec `rows` language: a label
 * with a previous-period sub-line ("Last week 162 mi") on the left, and the
 * current value with a plain-text `<Delta>` sub-line on the right. `tone`
 * selects whether the delta may carry status colour (neutral by default per
 * spec rule 4); `formattedPrevious` is omitted — never fabricated — when the
 * previous reading is unknown. `compact` clamps the list to the first two rows
 * and tightens the type scale; an empty (or missing) list renders a shared
 * `<EmptyState>` rather than a blank panel.
 *
 * Strategy: `<Delta>` is the settings/i18n/network boundary, so it is stubbed
 * with a prop-recording element — the card's own direction/display/hideArrow
 * wiring stays observable without mounting useSettings/useUnits. The real
 * `<EmptyState>` is used so the empty branch is verified end-to-end (role +
 * message). `react-i18next` is globally mocked (fallback strings), so the
 * default previous-period label renders deterministically. No network is touched.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WidgetComparisonCard, type ComparisonMetric } from './WidgetComparisonCard';

interface StubDeltaProps {
  metric: { direction: string };
  current: number;
  previous: number;
  display: string;
  hideArrow?: boolean;
}

// Prop-recording stub for <Delta> (the only thing the card pulls from the
// data-display barrel). Mirrors direction/current/previous/display/hideArrow
// into DOM attributes so the card's wiring is assertable, and renders nothing heavy.
vi.mock('@/components/data-display', () => ({
  Delta: ({ metric, current, previous, display, hideArrow }: StubDeltaProps) => (
    <span
      data-testid="delta"
      data-direction={metric.direction}
      data-current={String(current)}
      data-previous={String(previous)}
      data-display={display}
      data-hide-arrow={hideArrow === true ? 'true' : 'false'}
    />
  ),
}));

function makeMetric(overrides: Partial<ComparisonMetric> = {}): ComparisonMetric {
  return {
    label: 'Distance',
    current: 120.5,
    previous: 100,
    formattedCurrent: '120.5',
    formattedPrevious: '100',
    unit: 'mi',
    higherIsBetter: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WidgetComparisonCard — rendering', () => {
  it('renders one row (label + value + Delta) per metric', () => {
    const metrics = [
      makeMetric({ label: 'Distance', formattedCurrent: '120.5' }),
      makeMetric({ label: 'Drives', formattedCurrent: '8', unit: undefined, formattedPrevious: '10' }),
      makeMetric({ label: 'Energy', formattedCurrent: '54.2', unit: 'kWh', formattedPrevious: '41 kWh' }),
    ];
    render(<WidgetComparisonCard metrics={metrics} />);

    expect(screen.getAllByTestId('delta')).toHaveLength(3);
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Drives')).toBeInTheDocument();
    expect(screen.getByText('Energy')).toBeInTheDocument();
    expect(screen.getByText('120.5')).toBeInTheDocument();
  });

  it('renders the trailing unit alongside the value when provided', () => {
    render(<WidgetComparisonCard metrics={[makeMetric({ label: 'Energy', formattedCurrent: '54.2', unit: 'kWh' })]} />);

    const value = screen.getByText('54.2');
    // The unit lives in a nested <span> sibling of the value text node.
    expect(value.querySelector('span')?.textContent).toBe('kWh');
  });

  it('omits the unit span entirely when the metric has no unit', () => {
    render(<WidgetComparisonCard metrics={[makeMetric({ label: 'Drives', formattedCurrent: '8', unit: undefined })]} />);

    const value = screen.getByText('8');
    expect(value.querySelector('span')).toBeNull();
  });

  it('falls back to an em-dash when formattedCurrent is missing (null-safety)', () => {
    render(
      <WidgetComparisonCard
        metrics={[makeMetric({ formattedCurrent: undefined as unknown as string, unit: undefined })]}
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the delta as plain text without an arrow (spec delta language)', () => {
    render(<WidgetComparisonCard metrics={[makeMetric()]} />);

    expect(screen.getByTestId('delta')).toHaveAttribute('data-hide-arrow', 'true');
  });
});

describe('WidgetComparisonCard — previous-period sub-line', () => {
  it('renders "Last week {formattedPrevious}" beneath the label by default', () => {
    render(<WidgetComparisonCard metrics={[makeMetric({ label: 'Distance', formattedPrevious: '162 mi' })]} />);

    expect(screen.getByText('Last week 162 mi')).toBeInTheDocument();
  });

  it('renders a caller-supplied previousLabel prefix instead of the default', () => {
    render(
      <WidgetComparisonCard
        metrics={[makeMetric({ formattedPrevious: '162 mi' })]}
        previousLabel="Yesterday"
      />,
    );

    expect(screen.getByText('Yesterday 162 mi')).toBeInTheDocument();
    expect(screen.queryByText('Last week 162 mi')).toBeNull();
  });

  it('omits the sub-line when formattedPrevious is missing (never fabricates)', () => {
    render(<WidgetComparisonCard metrics={[makeMetric({ formattedPrevious: undefined })]} />);

    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.queryByText(/Last week/)).toBeNull();
    // The row (value + Delta) still renders from the measured operands.
    expect(screen.getByTestId('delta')).toBeInTheDocument();
  });

  it('omits the sub-line when formattedPrevious is an empty string', () => {
    render(<WidgetComparisonCard metrics={[makeMetric({ formattedPrevious: '' })]} />);

    expect(screen.queryByText(/Last week/)).toBeNull();
  });
});

describe('WidgetComparisonCard — Delta wiring, tone & display', () => {
  it('defaults to a neutral direction and percent display (no status colour)', () => {
    render(<WidgetComparisonCard metrics={[makeMetric({ current: 120.5, previous: 100 })]} />);

    const delta = screen.getByTestId('delta');
    expect(delta).toHaveAttribute('data-direction', 'neutral');
    expect(delta).toHaveAttribute('data-current', '120.5');
    expect(delta).toHaveAttribute('data-previous', '100');
    expect(delta).toHaveAttribute('data-display', 'percent');
  });

  it('maps tone=good with higherIsBetter=true to higher_better', () => {
    render(<WidgetComparisonCard metrics={[makeMetric({ tone: 'good', higherIsBetter: true })]} />);

    expect(screen.getByTestId('delta')).toHaveAttribute('data-direction', 'higher_better');
  });

  it('maps tone=good with higherIsBetter=false to lower_better', () => {
    render(<WidgetComparisonCard metrics={[makeMetric({ tone: 'good', higherIsBetter: false })]} />);

    expect(screen.getByTestId('delta')).toHaveAttribute('data-direction', 'lower_better');
  });

  it('maps tone=bad to the directional mapping', () => {
    render(<WidgetComparisonCard metrics={[makeMetric({ tone: 'bad', higherIsBetter: true })]} />);

    expect(screen.getByTestId('delta')).toHaveAttribute('data-direction', 'higher_better');
  });

  it('maps explicit tone=neutral to neutral even when higherIsBetter is set', () => {
    render(<WidgetComparisonCard metrics={[makeMetric({ tone: 'neutral', higherIsBetter: false })]} />);

    expect(screen.getByTestId('delta')).toHaveAttribute('data-direction', 'neutral');
  });

  it('forwards deltaDisplay=absolute for count-style metrics', () => {
    render(
      <WidgetComparisonCard
        metrics={[makeMetric({ label: 'Drives', current: 12, previous: 10, deltaDisplay: 'absolute' })]}
      />,
    );

    expect(screen.getByTestId('delta')).toHaveAttribute('data-display', 'absolute');
  });
});

describe('WidgetComparisonCard — compact mode', () => {
  it('renders all metrics when not compact', () => {
    const metrics = [makeMetric({ label: 'A' }), makeMetric({ label: 'B' }), makeMetric({ label: 'C' })];
    render(<WidgetComparisonCard metrics={metrics} />);

    expect(screen.getAllByTestId('delta')).toHaveLength(3);
  });

  it('clamps to the first two metrics when compact', () => {
    const metrics = [
      makeMetric({ label: 'A' }),
      makeMetric({ label: 'B' }),
      makeMetric({ label: 'C' }),
      makeMetric({ label: 'D' }),
    ];
    render(<WidgetComparisonCard metrics={metrics} compact />);

    expect(screen.getAllByTestId('delta')).toHaveLength(2);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByText('C')).toBeNull();
    expect(screen.queryByText('D')).toBeNull();
  });

  it('applies the tighter text-sm scale only in compact mode', () => {
    const compact = render(<WidgetComparisonCard metrics={[makeMetric()]} compact />);
    expect(compact.container.firstChild).toHaveClass('text-sm');
    compact.unmount();

    const regular = render(<WidgetComparisonCard metrics={[makeMetric()]} />);
    expect(regular.container.firstChild).not.toHaveClass('text-sm');
  });
});

describe('WidgetComparisonCard — empty & null-safety', () => {
  it('shows the shared empty state (role=status) with the default message when there are no metrics', () => {
    render(<WidgetComparisonCard metrics={[]} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No comparison data')).toBeInTheDocument();
    expect(screen.queryByTestId('delta')).toBeNull();
  });

  it('renders a caller-supplied emptyMessage instead of the default', () => {
    render(<WidgetComparisonCard metrics={[]} emptyMessage="No weekly data yet" />);

    expect(screen.getByText('No weekly data yet')).toBeInTheDocument();
    expect(screen.queryByText('No comparison data')).toBeNull();
  });

  it('renders the empty state instead of crashing when metrics is undefined', () => {
    expect(() =>
      render(<WidgetComparisonCard metrics={undefined as unknown as ComparisonMetric[]} />),
    ).not.toThrow();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('WidgetComparisonCard — key robustness', () => {
  it('renders every row when two metrics share a label, with no duplicate-key warning', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<WidgetComparisonCard metrics={[makeMetric({ label: 'Trips' }), makeMetric({ label: 'Trips' })]} />);

    expect(screen.getAllByTestId('delta')).toHaveLength(2);
    const dupKeyWarning = errSpy.mock.calls.some((args) =>
      args.some((a) => typeof a === 'string' && a.includes('same key')),
    );
    expect(dupKeyWarning).toBe(false);
  });
});
