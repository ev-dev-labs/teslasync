/**
 * WidgetComparisonCard — behavioural, branch, null-safety and a11y coverage for
 * the dashboard "current vs previous period" card.
 *
 * The card maps each `ComparisonMetric` to a label + formatted value (with an
 * optional unit) and a `<Delta>` change indicator whose `direction` is derived
 * from `higherIsBetter` (defaulting to `higher_better`). `compact` clamps the
 * list to the first two rows and tightens the type scale; an empty (or missing)
 * list renders a shared `<EmptyState>` rather than a blank panel.
 *
 * Strategy: `<Delta>` is the settings/i18n/network boundary, so it is stubbed
 * with a prop-recording element — the card's own direction mapping and value
 * pass-through stay observable without mounting useSettings/useUnits. The real
 * `<EmptyState>` is used so the empty branch is verified end-to-end (role +
 * message). No network is touched.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WidgetComparisonCard, type ComparisonMetric } from './WidgetComparisonCard';

interface StubDeltaProps {
  metric: { direction: string };
  current: number;
  previous: number;
  display: string;
}

// Prop-recording stub for <Delta> (the only thing the card pulls from the
// data-display barrel). Mirrors direction/current/previous/display into DOM
// attributes so the card's wiring is assertable, and renders nothing heavy.
vi.mock('@/components/data-display', () => ({
  Delta: ({ metric, current, previous, display }: StubDeltaProps) => (
    <span
      data-testid="delta"
      data-direction={metric.direction}
      data-current={String(current)}
      data-previous={String(previous)}
      data-display={display}
    />
  ),
}));

function makeMetric(overrides: Partial<ComparisonMetric> = {}): ComparisonMetric {
  return {
    label: 'Distance',
    current: 120.5,
    previous: 100,
    formattedCurrent: '120.5',
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
      makeMetric({ label: 'Drives', formattedCurrent: '8', unit: undefined }),
      makeMetric({ label: 'Energy', formattedCurrent: '54.2', unit: 'kWh' }),
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
});

describe('WidgetComparisonCard — Delta wiring & direction', () => {
  it('maps higherIsBetter=true to higher_better and forwards current/previous/percent', () => {
    render(<WidgetComparisonCard metrics={[makeMetric({ current: 120.5, previous: 100, higherIsBetter: true })]} />);

    const delta = screen.getByTestId('delta');
    expect(delta).toHaveAttribute('data-direction', 'higher_better');
    expect(delta).toHaveAttribute('data-current', '120.5');
    expect(delta).toHaveAttribute('data-previous', '100');
    expect(delta).toHaveAttribute('data-display', 'percent');
  });

  it('maps higherIsBetter=false to lower_better', () => {
    render(<WidgetComparisonCard metrics={[makeMetric({ higherIsBetter: false })]} />);

    expect(screen.getByTestId('delta')).toHaveAttribute('data-direction', 'lower_better');
  });

  it('defaults to higher_better when higherIsBetter is omitted', () => {
    render(<WidgetComparisonCard metrics={[makeMetric({ higherIsBetter: undefined })]} />);

    expect(screen.getByTestId('delta')).toHaveAttribute('data-direction', 'higher_better');
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
