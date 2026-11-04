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
 *   7. The spec delta line (`delta.text` + `tone` + optional `trend` glyph):
 *      small semibold tone-colored text under the value; tone is
 *      caller-declared status only (good→success, bad→danger, default
 *      neutral→muted) and never inferred from the sign; the delta is hidden
 *      when there is no value or the text is blank.
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
    expect(animated).toHaveClass('text-2xl');
    expect(animated).toHaveClass('font-medium');
    expect(animated).toHaveClass('text-[var(--text-primary)]');
  });

  it('renders a plain tabular-nums span (no tween) when animated is false', () => {
    render(<WidgetBigNumber value={1234} animated={false} />);

    expect(screen.queryByTestId('animated-number')).toBeNull();
    const plain = screen.getByText('1234');
    expect(plain).toBeInTheDocument();
    expect(plain).toHaveClass('tabular-nums');
    expect(plain).toHaveClass('text-2xl');
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
  it('accepts a caller-formatted measurement unchanged without animating or recasing it', () => {
    render(<WidgetBigNumber value="1,234.5" unit="km" label="Tesla Model Y" />);
    expect(screen.getByText('1,234.5')).toBeInTheDocument();
    expect(screen.getByText('Tesla Model Y')).not.toHaveClass('uppercase');
    expect(screen.queryByTestId('animated-number')).not.toBeInTheDocument();
  });

  it('does not imply a measured unit when the value is unknown', () => {
    render(<WidgetBigNumber value={null} unit="km" />);
    expect(screen.getByText(DASH)).toBeInTheDocument();
    expect(screen.queryByText('km')).not.toBeInTheDocument();
  });

  it('keeps long values wrappable at the widget boundary', () => {
    render(<WidgetBigNumber value="999999999999999999999999999" animated={false} size="secondary" />);
    expect(screen.getByText('999999999999999999999999999')).toHaveClass('break-all', 'text-lg');
  });

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

describe('WidgetBigNumber — delta line', () => {
  it('renders the delta text under the value with the good (success) tone', () => {
    render(<WidgetBigNumber value={86} unit="/100" delta={{ text: '+4 vs last week', tone: 'good' }} />);

    const delta = screen.getByText('+4 vs last week');
    expect(delta).toBeInTheDocument();
    expect(delta).toHaveClass('text-xs', 'font-semibold');
    expect(delta).toHaveClass('text-[var(--semantic-success)]');
  });

  it('renders the bad tone for a negative delta and the neutral default without inferring from the sign', () => {
    const { unmount } = render(<WidgetBigNumber value={5} delta={{ text: '−4%', tone: 'bad' }} />);
    expect(screen.getByText('−4%')).toHaveClass('text-[var(--semantic-danger)]');
    unmount();

    // No tone given and a negative sign: still muted, never red-by-inference.
    render(<WidgetBigNumber value={254} unit="mi" delta={{ text: '−6.6%' }} />);
    const neutral = screen.getByText('−6.6%');
    expect(neutral).toHaveClass('text-[var(--text-muted)]');
    expect(neutral.className).not.toContain('semantic-danger');
  });

  it('renders the caller text verbatim, including a saved-vs phrasing', () => {
    render(<WidgetBigNumber value="$38.20" delta={{ text: 'Saved $96 vs gas', tone: 'good' }} />);

    expect(screen.getByText('Saved $96 vs gas')).toBeInTheDocument();
  });

  it('renders a decorative trend glyph when requested, hidden from assistive tech', () => {
    const { container } = render(
      <WidgetBigNumber value={86} delta={{ text: '+4 vs last week', tone: 'good', trend: 'up' }} />,
    );

    const delta = screen.getByText('+4 vs last week');
    const glyph = delta.querySelector('svg');
    expect(glyph).toBeInTheDocument();
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toBe(glyph);
  });

  it('renders no glyph when trend is omitted', () => {
    const { container } = render(<WidgetBigNumber value={86} delta={{ text: '+4 vs last week' }} />);

    expect(screen.getByText('+4 vs last week')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('hides the delta when there is no value, like the unit', () => {
    render(<WidgetBigNumber value={null} delta={{ text: '+4 vs last week', tone: 'good' }} />);

    expect(screen.getByText(DASH)).toBeInTheDocument();
    expect(screen.queryByText('+4 vs last week')).toBeNull();
  });

  it('hides a blank delta', () => {
    const { container } = render(<WidgetBigNumber value={5} delta={{ text: '   ' }} />);

    expect(container.textContent).not.toContain('+');
  });

  it('omits the delta row when no delta is provided', () => {
    render(<WidgetBigNumber value={5} />);

    expect(screen.getByTestId('animated-number')).toHaveTextContent('5');
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
