/**
 * HighlightCard — behaviour + hardening contract.
 *
 * HighlightCard is the single KPI tile used across the Weekly Digest
 * "Week Summary" bento (see SummaryHeroCards). It composes a decorative
 * leading icon, a label, a prominent metric value, an optional week-over-week
 * `change` badge (up/down arrow + signed percentage), and an optional caption.
 * It is a pure presentational component — no i18n / router / query context — so
 * these tests render it directly without providers.
 *
 * The elevation this file locks in is null-safety for the three text slots so a
 * partial / untyped payload never renders a *blank* prominent tile:
 *   - a nullish or empty `value`        → em-dash placeholder ("—")
 *   - a nullish or empty `label`        → em-dash placeholder ("—")
 *   - a `change` with a nullish `value` → em-dash placeholder ("—")
 *
 * The tests also pin the invariants that must not regress:
 *   - the leading icon is decorative (wrapped in an `aria-hidden` span) and the
 *     trend arrows are `aria-hidden` too — the signed percentage text carries
 *     the accessible meaning;
 *   - the accent colour + `GlassPanel` glow are driven by the `color` prop, with
 *     amber/red intentionally falling back to a "none" glow, and an unknown
 *     colour degrading to the cyan accent rather than crashing;
 *   - `change.positive` selects the up arrow + emerald copy, `!positive` the
 *     down arrow + rose copy, and an absent `change` renders neither arrow;
 *   - a caller `className` composes onto the panel root.
 *
 * lucide-react tags each glyph `<svg class="lucide lucide-trending-up …">`, so
 * the up/down arrows are asserted by that stable class (and their forwarded
 * `aria-hidden`). No network is touched.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { HighlightCard } from './HighlightCard';

type CardProps = Parameters<typeof HighlightCard>[0];

function renderCard(overrides: Partial<CardProps> = {}) {
  const props: CardProps = {
    icon: <svg data-testid="metric-icon" />,
    label: 'Total Distance',
    value: '123 km',
    ...overrides,
  };
  return render(<HighlightCard {...props} />);
}

/** The GlassPanel root is always the single top-level node. */
function root(container: HTMLElement) {
  return container.firstChild as HTMLElement;
}

describe('HighlightCard — base rendering', () => {
  it('renders the label and the prominent value', () => {
    renderCard({ label: 'Energy Used', value: '48.2 kWh' });

    expect(screen.getByText('Energy Used')).toBeInTheDocument();
    expect(screen.getByText('48.2 kWh')).toBeInTheDocument();
  });

  it('wraps the leading icon in a decorative aria-hidden span', () => {
    renderCard();

    const iconSpan = screen.getByTestId('metric-icon').parentElement as HTMLElement;
    expect(iconSpan.tagName).toBe('SPAN');
    expect(iconSpan).toHaveAttribute('aria-hidden', 'true');
  });

  it('composes a caller className onto the GlassPanel root', () => {
    const { container } = renderCard({ className: 'test-custom-class' });

    const panel = root(container);
    expect(panel).toHaveClass('test-custom-class');
    // Base layout classes are preserved alongside the override.
    expect(panel).toHaveClass('flex', 'h-full', 'flex-col');
    expect(panel).toHaveAttribute('data-print-card');
  });
});

describe('HighlightCard — colour accent + glow', () => {
  it('defaults to the cyan accent and enables the cyan panel glow', () => {
    const { container } = renderCard();

    const iconSpan = screen.getByTestId('metric-icon').parentElement as HTMLElement;
    expect(iconSpan).toHaveClass('text-cyan-300');
    // hover + glow="cyan" → the cyan hover-border utility is present.
    expect(root(container).className).toContain('hover:border-cyan-400/30');
  });

  it.each([
    ['green', 'text-emerald-300', 'hover:border-green-400/30'],
    ['purple', 'text-purple-300', 'hover:border-purple-400/30'],
  ] as const)('maps color=%s to its accent + glow', (color, accentClass, glowClass) => {
    const { container } = renderCard({ color });

    const iconSpan = screen.getByTestId('metric-icon').parentElement as HTMLElement;
    expect(iconSpan).toHaveClass(accentClass);
    expect(root(container).className).toContain(glowClass);
  });

  it('uses the amber accent but suppresses the glow (glow="none")', () => {
    const { container } = renderCard({ color: 'amber' });

    const iconSpan = screen.getByTestId('metric-icon').parentElement as HTMLElement;
    expect(iconSpan).toHaveClass('text-amber-300');
    // amber maps to glow="none" — no coloured hover-border glow leaks in.
    const cls = root(container).className;
    expect(cls).not.toContain('hover:border-cyan-400/30');
    expect(cls).not.toContain('hover:border-green-400/30');
    expect(cls).not.toContain('hover:border-purple-400/30');
  });

  it('uses the rose accent for color="red" with no glow', () => {
    const { container } = renderCard({ color: 'red' });

    const iconSpan = screen.getByTestId('metric-icon').parentElement as HTMLElement;
    expect(iconSpan).toHaveClass('text-rose-300');
    expect(root(container).className).not.toContain('hover:border-cyan-400/30');
  });

  it('degrades an unknown colour to the cyan accent instead of crashing', () => {
    // Untyped JS callers can pass a colour outside the union; the neonColorMap
    // lookup must fall back rather than yield `undefined.text`.
    renderCard({ color: 'chartreuse' as unknown as CardProps['color'] });

    const iconSpan = screen.getByTestId('metric-icon').parentElement as HTMLElement;
    expect(iconSpan).toHaveClass('text-cyan-300');
  });
});

describe('HighlightCard — change indicator', () => {
  it('shows the up arrow + emerald copy when the change is positive', () => {
    const { container } = renderCard({
      change: { value: '+20.0%', positive: true },
    });

    const up = container.querySelector('svg.lucide-trending-up');
    expect(up).not.toBeNull();
    expect(container.querySelector('svg.lucide-trending-down')).toBeNull();
    // The arrow is decorative; the signed percentage carries the meaning.
    expect(up).toHaveAttribute('aria-hidden', 'true');

    const changeEl = screen.getByText('+20.0%');
    expect(changeEl.className).toContain('text-emerald-300');
  });

  it('shows the down arrow + rose copy when the change is negative', () => {
    const { container } = renderCard({
      change: { value: '-8.5%', positive: false },
    });

    expect(container.querySelector('svg.lucide-trending-down')).not.toBeNull();
    expect(container.querySelector('svg.lucide-trending-up')).toBeNull();

    const changeEl = screen.getByText('-8.5%');
    expect(changeEl.className).toContain('text-rose-300');
  });

  it('renders neither arrow nor a trend row when change is omitted', () => {
    const { container } = renderCard();

    expect(container.querySelector('svg.lucide-trending-up')).toBeNull();
    expect(container.querySelector('svg.lucide-trending-down')).toBeNull();
  });
});

describe('HighlightCard — subtitle', () => {
  it('renders the caption when a subtitle is provided', () => {
    renderCard({ subtitle: '≈ 3× London → Paris' });
    expect(screen.getByText('≈ 3× London → Paris')).toBeInTheDocument();
  });

  it('omits the caption entirely when no subtitle is provided', () => {
    renderCard();
    expect(screen.queryByText('≈ 3× London → Paris')).not.toBeInTheDocument();
  });
});

describe('HighlightCard — null-safety hardening', () => {
  it('renders an em-dash instead of a blank tile when value is nullish', () => {
    renderCard({
      label: 'Total Drives',
      value: undefined as unknown as string,
    });

    // Label still renders; the missing value degrades to the placeholder.
    expect(screen.getByText('Total Drives')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders an em-dash for an empty-string value', () => {
    renderCard({ label: 'Total Drives', value: '' });
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders an em-dash for a missing label but keeps the value visible', () => {
    renderCard({
      label: undefined as unknown as string,
      value: '5',
    });

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('degrades a change with a nullish value to an em-dash while keeping the arrow', () => {
    const { container } = renderCard({
      value: '100 km',
      change: { value: undefined as unknown as string, positive: true },
    });

    // The arrow still renders (positive), and the empty percentage → "—".
    expect(container.querySelector('svg.lucide-trending-up')).not.toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
