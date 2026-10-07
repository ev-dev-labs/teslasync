/**
 * TopSignalsPanel contract tests.
 *
 * TopSignalsPanel is a pure, prop-driven presentational panel: it owns no
 * fetching and decides HOW to render the ranked `signals` slice the page hands
 * it. The behaviour locked in here:
 *
 *   1. Header — the "Most Active Signals" title is always present in a level-3
 *      heading with a decorative (aria-hidden) ListOrdered glyph, so the panel
 *      never collapses to nothing regardless of state.
 *   2. Empty state — an empty (or null/undefined) `signals` prop renders the
 *      shared EmptyState (role="status") with the no-buffer copy and NO list,
 *      never a blank panel.
 *   3. Ranked list — a populated buffer renders one accessible list item per
 *      signal, preserving the caller's ranking order, each with its name in a
 *      <code> carrying a truncation `title`, an arrival-count Badge (with the
 *      "×" suffix + fmtInt locale separators), and a latest-value bar. The list
 *      is exposed as a labelled `list` landmark.
 *   4. Type mapping — each value type drives both the Badge variant and the
 *      MetricBar colour token (number / boolean / string), with a neutral +
 *      series[0] fallback for an unknown type.
 *   5. Scale + latest value — the bar `value` is the signal's count and the
 *      shared `max` is the busiest count (the ranking scale); the bar sublabel
 *      is the latest value, falling back to an em dash for an empty value.
 *   6. Null-safety (the hardened source) — a malformed entry with a missing
 *      count collapses to 0 for both the badge and the bar value (never NaN),
 *      and the derived scale stays a finite, non-zero divisor.
 *   7. className passthrough — the caller's className lands on the panel root.
 *
 * react-i18next is stubbed to echo the English fallback so the copy asserted on
 * is decoupled from the locale bundle. <MetricBar> is doubled with a lightweight
 * stand-in that echoes its bound props (label / value / max / colour / sublabel)
 * as DOM — the real bar animates via framer-motion and hides `value`/`max`
 * inside the motion layer, so the double makes the panel's wiring observable and
 * deterministic. The shared <GlassPanel>/<PanelTitle>/<Badge>/<Code>/<EmptyState>
 * primitives render for real so the true title → row → badge → bar wiring is
 * exercised end-to-end.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// MetricBar double. The real bar drives its fill through framer-motion, so the
// numeric `value`/`max` never reach the DOM as plain text. The stand-in echoes
// every bound prop as data-* attributes (and renders the sublabel) so the
// panel's per-row wiring — scale, colour, count coalescing — is observable.
vi.mock('@/components/data-display', () => ({
  MetricBar: (props: {
    label: string;
    value: number;
    max: number;
    color: string;
    sublabel?: string;
  }) => (
    <div
      data-testid="metric-bar"
      data-label={String(props.label)}
      data-value={String(props.value)}
      data-max={String(props.max)}
      data-color={String(props.color)}
    >
      <span data-testid="metric-sublabel">{props.sublabel}</span>
    </div>
  ),
}));

import { TopSignalsPanel, type TopSignal } from './TopSignalsPanel';
import { chartTokens } from '@/lib/tokens';
import { BADGE_VARIANTS } from '@/components/ui';

// The multiplication sign the badge appends (U+00D7) and the em dash the
// sublabel falls back to (U+2014), declared via escapes so the assertions stay
// independent of this file's encoding.
const TIMES = '\u00D7';
const EM_DASH = '\u2014';

/** A well-formed, already-ranked buffer slice: one signal per value type. */
const SIGNALS: TopSignal[] = [
  { name: 'vehicle_speed', count: 1234, value: '42.5', type: 'number' },
  { name: 'charging_state', count: 87, value: 'Charging', type: 'string' },
  { name: 'sentry_mode', count: 12, value: 'true', type: 'boolean' },
];

/** Scope to the <li> that owns the named signal so per-row assertions don't
 * bleed across rows. */
function rowFor(name: string): HTMLElement {
  const li = screen.getByText(name).closest('li');
  if (!li) throw new Error(`no <li> row for signal "${name}"`);
  return li as HTMLElement;
}

// ── Header (always present) ───────────────────────────────────────────────────

describe('TopSignalsPanel — header', () => {
  it('always renders the title in a level-3 heading with a decorative glyph', () => {
    const { container } = render(<TopSignalsPanel signals={[]} />);

    expect(
      screen.getByRole('heading', { level: 3, name: 'Most Active Signals' }),
    ).toBeInTheDocument();
    // The header glyph is decorative so a screen reader announces the title,
    // not the icon.
    expect(container.querySelector('.lucide-list-ordered')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});

// ── Empty state ───────────────────────────────────────────────────────────────

describe('TopSignalsPanel — empty state', () => {
  it('renders the no-buffer status message and no list for an empty buffer', () => {
    render(<TopSignalsPanel signals={[]} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('No signals buffered yet');
    // The panel never collapses to a bare list — no ranked list is drawn.
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByTestId('metric-bar')).toBeNull();
  });

  it('treats a null/undefined signals prop as empty rather than crashing', () => {
    // The `?? EMPTY_SIGNALS` guard must survive a malformed prop bag.
    render(
      <TopSignalsPanel signals={undefined as unknown as TopSignal[]} />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'No signals buffered yet',
    );
    expect(screen.queryByRole('list')).toBeNull();
  });
});

// ── Ranked list ───────────────────────────────────────────────────────────────

describe('TopSignalsPanel — ranked list', () => {
  it('exposes the ranking as a labelled list with one item per signal', () => {
    render(<TopSignalsPanel signals={SIGNALS} />);

    expect(
      screen.getByRole('list', {
        name: 'Most active signals ranked by arrival frequency',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    // The empty state must NOT appear alongside a populated list.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders each signal name in a <code> carrying a truncation title', () => {
    render(<TopSignalsPanel signals={SIGNALS} />);

    const code = screen.getByText('vehicle_speed');
    expect(code.tagName).toBe('CODE');
    expect(code).toHaveAttribute('title', 'vehicle_speed');
  });

  it('preserves the caller-supplied ranking order in the DOM', () => {
    render(<TopSignalsPanel signals={SIGNALS} />);

    const names = screen
      .getAllByRole('listitem')
      .map((li) => li.querySelector('code')?.textContent);
    expect(names).toEqual(['vehicle_speed', 'charging_state', 'sentry_mode']);
  });

  it('surfaces the arrival count in a badge with the × suffix and locale separators', () => {
    render(<TopSignalsPanel signals={SIGNALS} />);

    // fmtInt(1234) → "1,234" (thousands separator), then the × suffix.
    expect(screen.getByText(`1,234${TIMES}`)).toBeInTheDocument();
    expect(screen.getByText(`87${TIMES}`)).toBeInTheDocument();
    expect(screen.getByText(`12${TIMES}`)).toBeInTheDocument();
  });
});

// ── Type mapping (variant + colour, with fallback) ────────────────────────────

describe('TopSignalsPanel — value-type mapping', () => {
  it('drives the badge variant and bar colour off each value type', () => {
    render(<TopSignalsPanel signals={SIGNALS} />);

    // number → info badge (blue) + series[5] bar.
    expect(screen.getByText(`1,234${TIMES}`)).toHaveClass('bg-blue-100');
    expect(within(rowFor('vehicle_speed')).getByTestId('metric-bar')).toHaveAttribute(
      'data-color',
      chartTokens.series[5],
    );

    // string → success badge (green) + series[1] bar.
    expect(screen.getByText(`87${TIMES}`)).toHaveClass('bg-green-100');
    expect(within(rowFor('charging_state')).getByTestId('metric-bar')).toHaveAttribute(
      'data-color',
      chartTokens.series[1],
    );

    // boolean → warning badge (yellow) + series[2] bar.
    expect(screen.getByText(`12${TIMES}`)).toHaveClass('bg-yellow-100');
    expect(within(rowFor('sentry_mode')).getByTestId('metric-bar')).toHaveAttribute(
      'data-color',
      chartTokens.series[2],
    );
  });

  it('falls back to a neutral badge and series[0] bar for an unknown type', () => {
    const weird: TopSignal[] = [
      { name: 'mystery', count: 5, value: 'x', type: 'enum' as unknown as TopSignal['type'] },
    ];
    render(<TopSignalsPanel signals={weird} />);

    // neutral badge → gray, not the info/success/warning palettes.
    const badge = screen.getByText(`5${TIMES}`);
    expect(badge).toHaveClass(BADGE_VARIANTS.neutral);
    expect(badge).not.toHaveClass('bg-blue-100');
    // colour falls through to the first series entry.
    expect(within(rowFor('mystery')).getByTestId('metric-bar')).toHaveAttribute(
      'data-color',
      chartTokens.series[0],
    );
  });
});

// ── Scale + latest value ──────────────────────────────────────────────────────

describe('TopSignalsPanel — bar scale and latest value', () => {
  it('feeds each count as the bar value and the busiest count as the shared max', () => {
    render(<TopSignalsPanel signals={SIGNALS} />);

    const speedBar = within(rowFor('vehicle_speed')).getByTestId('metric-bar');
    expect(speedBar).toHaveAttribute('data-value', '1234');
    expect(speedBar).toHaveAttribute('data-label', 'Latest');
    // Every bar shares the ranking scale = the busiest count (1234).
    for (const bar of screen.getAllByTestId('metric-bar')) {
      expect(bar).toHaveAttribute('data-max', '1234');
    }
  });

  it('renders the latest value as the bar sublabel', () => {
    render(<TopSignalsPanel signals={SIGNALS} />);

    expect(
      within(rowFor('charging_state')).getByTestId('metric-sublabel'),
    ).toHaveTextContent('Charging');
  });

  it('falls back to an em dash when the latest value is an empty string', () => {
    const signals: TopSignal[] = [
      { name: 'empty_val', count: 3, value: '', type: 'number' },
    ];
    render(<TopSignalsPanel signals={signals} />);

    expect(
      within(rowFor('empty_val')).getByTestId('metric-sublabel'),
    ).toHaveTextContent(EM_DASH);
  });
});

// ── Null-safety (hardened source) ─────────────────────────────────────────────

describe('TopSignalsPanel — null-safety', () => {
  it('collapses a missing count to 0 for the badge and bar value (never NaN)', () => {
    const malformed = [
      { name: 'nocount', value: 'v', type: 'number' },
    ] as unknown as TopSignal[];
    const { container } = render(<TopSignalsPanel signals={malformed} />);

    // Badge shows "0×", not "NaN×".
    expect(screen.getByText(`0${TIMES}`)).toBeInTheDocument();
    // Bar value coalesces to 0 rather than propagating undefined → NaN.
    expect(within(rowFor('nocount')).getByTestId('metric-bar')).toHaveAttribute(
      'data-value',
      '0',
    );
    // No NaN leaks anywhere in the rendered panel.
    expect(container.textContent ?? '').not.toContain('NaN');
  });

  it('keeps a finite, non-zero scale when every count is missing/zero', () => {
    const allZero = [
      { name: 'a', value: 'x', type: 'number' },
      { name: 'b', count: 0, value: 'y', type: 'string' },
    ] as unknown as TopSignal[];
    render(<TopSignalsPanel signals={allZero} />);

    // `|| 1` keeps the divisor at 1 so the bar math can't blow up to Infinity.
    for (const bar of screen.getAllByTestId('metric-bar')) {
      expect(bar).toHaveAttribute('data-max', '1');
    }
  });
});

// ── className passthrough ─────────────────────────────────────────────────────

describe('TopSignalsPanel — className', () => {
  it('forwards the caller className onto the panel root', () => {
    const { container } = render(
      <TopSignalsPanel signals={[]} className="col-span-2 xl:col-span-3" />,
    );

    const root = container.querySelector('[data-print-card]');
    expect(root).not.toBeNull();
    expect(root).toHaveClass('col-span-2');
    expect(root).toHaveClass('xl:col-span-3');
    // The component's own base padding survives the merge.
    expect(root).toHaveClass('p-4');
  });
});
