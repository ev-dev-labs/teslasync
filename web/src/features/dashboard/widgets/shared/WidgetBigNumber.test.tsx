/**
 * WidgetBigNumber — the shared "one big centred number + optional unit / label /
 * subtitle / status badge" primitive used across the dashboard widgets
 * (AuditLog, ExportStatus, CostBreakdown, SuperchargerHistory, ProjectedRange…).
 *
 * The behaviour surface under test:
 *   1. The value branch: an animated counter by default (AnimatedNumber), a plain
 *      tabular-nums span when `animated={false}`, and a muted placeholder when
 *      there is no value.
 *   2. The "no value" definition — the hardened bug. A big number is only shown
 *      for a FINITE number. `null`, a runtime `undefined`, `NaN` and ±`Infinity`
 *      all collapse to `nullDisplay` instead of leaking "NaN"/"Infinity" (raw
 *      span) or a misleading "0" (AnimatedNumber coerces non-finite input to 0).
 *   3. The falsy-but-valid `0` still renders as a real value, never the placeholder.
 *   4. The optional adornments (unit, label, subtitle) render only when supplied.
 *   5. The badge variant MAP: success→success, warning→warning, error→danger,
 *      neutral→neutral, always at size "sm".
 *   6. `valueColor` is forwarded to both the animated and non-animated value.
 *
 * AnimatedNumber is stubbed to a synchronous span (no requestAnimationFrame
 * tween) so numeric output is deterministic and the animated-vs-plain branch is
 * observable via a testid. Badge is stubbed to surface the `variant`/`size` props
 * it receives, so the map under test is asserted directly rather than through
 * Badge's own styling. WidgetBigNumber is the sole consumer of either module in
 * this graph, so minimal mocks fully isolate the unit — no network is touched.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WidgetBigNumber } from './WidgetBigNumber';

vi.mock('@/components/data-display', () => ({
  AnimatedNumber: ({ value, className }: { value: number; className?: string }) => (
    <span data-testid="animated-number" className={className}>
      {value}
    </span>
  ),
}));

vi.mock('@/components/ui', () => ({
  Badge: ({
    variant,
    size,
    children,
  }: {
    variant?: string;
    size?: string;
    children?: ReactNode;
  }) => (
    <span data-testid="badge" data-variant={variant} data-size={size}>
      {children}
    </span>
  ),
}));

// The default placeholder glyph (EM DASH, U+2014). Referenced as an escape to
// avoid source-encoding drift between this test and the component.
const DASH = '\u2014';

afterEach(cleanup);

describe('WidgetBigNumber — value rendering', () => {
  it('renders the value through AnimatedNumber by default', () => {
    render(<WidgetBigNumber value={42} />);

    const animated = screen.getByTestId('animated-number');
    expect(animated).toHaveTextContent('42');
    // Default styling: display size + weight + the default theme text colour.
    expect(animated).toHaveClass('text-3xl');
    expect(animated).toHaveClass('font-bold');
    expect(animated).toHaveClass('text-[var(--text-primary)]');
  });

  it('renders a plain tabular-nums span (no tween) when animated is false', () => {
    render(<WidgetBigNumber value={1234} animated={false} />);

    expect(screen.queryByTestId('animated-number')).toBeNull();
    const plain = screen.getByText('1234');
    expect(plain).toBeInTheDocument();
    expect(plain).toHaveClass('tabular-nums');
    expect(plain).toHaveClass('text-3xl');
  });

  it('renders zero as a real value, not the placeholder (0 is falsy but finite)', () => {
    render(<WidgetBigNumber value={0} />);

    expect(screen.getByTestId('animated-number')).toHaveTextContent('0');
    expect(screen.queryByText(DASH)).toBeNull();
  });
});

describe('WidgetBigNumber — absent / non-finite values fall back to the placeholder', () => {
  it('shows the default placeholder for a null value', () => {
    render(<WidgetBigNumber value={null} />);

    expect(screen.getByText(DASH)).toBeInTheDocument();
    expect(screen.queryByTestId('animated-number')).toBeNull();
  });

  it('shows a custom nullDisplay when provided', () => {
    render(<WidgetBigNumber value={null} nullDisplay="N/A" />);

    expect(screen.getByText('N/A')).toBeInTheDocument();
    expect(screen.queryByText(DASH)).toBeNull();
  });

  it('renders the placeholder for NaN instead of the literal "NaN"', () => {
    render(<WidgetBigNumber value={NaN} />);

    expect(screen.getByText(DASH)).toBeInTheDocument();
    expect(screen.queryByText('NaN')).toBeNull();
    expect(screen.queryByTestId('animated-number')).toBeNull();
  });

  it('renders the placeholder for both +Infinity and -Infinity', () => {
    const { unmount } = render(<WidgetBigNumber value={Infinity} />);
    expect(screen.getByText(DASH)).toBeInTheDocument();
    expect(screen.queryByTestId('animated-number')).toBeNull();
    unmount();

    render(<WidgetBigNumber value={-Infinity} />);
    expect(screen.getByText(DASH)).toBeInTheDocument();
  });

  it('renders the placeholder for a runtime-undefined value without crashing', () => {
    // The prop type is `number | null`, but real callers pass `data?.field`,
    // which can be `undefined`. It must degrade to the placeholder, not a blank
    // panel (raw span path) nor a misleading "0" (AnimatedNumber path).
    render(<WidgetBigNumber value={undefined as unknown as number} />);

    expect(screen.getByText(DASH)).toBeInTheDocument();
    expect(screen.queryByTestId('animated-number')).toBeNull();
  });
});

describe('WidgetBigNumber — adornments', () => {
  it('renders the unit next to the value when provided', () => {
    render(<WidgetBigNumber value={5} unit="kWh" />);

    expect(screen.getByText('kWh')).toBeInTheDocument();
    expect(screen.getByTestId('animated-number')).toHaveTextContent('5');
  });

  it('renders label and subtitle text when provided', () => {
    render(<WidgetBigNumber value={5} label="Events" subtitle="last 24h" />);

    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('last 24h')).toBeInTheDocument();
  });

  it('omits the unit, label, subtitle and badge when none are provided', () => {
    render(<WidgetBigNumber value={5} />);

    expect(screen.queryByTestId('badge')).toBeNull();
    // Only the value node is present in the value row.
    expect(screen.getByTestId('animated-number')).toHaveTextContent('5');
  });
});

describe('WidgetBigNumber — badge variant map', () => {
  it.each([
    ['success', 'success'],
    ['warning', 'warning'],
    ['error', 'danger'],
    ['neutral', 'neutral'],
  ] as const)('maps badge variant "%s" to Badge variant "%s" at size sm', (input, expected) => {
    render(<WidgetBigNumber value={1} badge={{ text: 'Status', variant: input }} />);

    const badge = screen.getByTestId('badge');
    expect(badge).toHaveTextContent('Status');
    expect(badge).toHaveAttribute('data-variant', expected);
    expect(badge).toHaveAttribute('data-size', 'sm');
  });
});

describe('WidgetBigNumber — valueColor', () => {
  it('forwards a custom valueColor class to the animated value', () => {
    render(<WidgetBigNumber value={7} valueColor="text-emerald-300" />);

    expect(screen.getByTestId('animated-number')).toHaveClass('text-emerald-300');
  });

  it('forwards a custom valueColor class to the non-animated value', () => {
    render(<WidgetBigNumber value={7} valueColor="text-emerald-300" animated={false} />);

    const plain = screen.getByText('7');
    expect(plain).toHaveClass('text-emerald-300');
    expect(plain).toHaveClass('tabular-nums');
  });
});
