/**
 * IconStatCard — behaviour, branch, hardening + a11y cover.
 *
 * <IconStatCard icon color value label /> is the compact icon-over-value-over-label
 * tile used across the Drive Detail stat grid (Distance, Duration, Max Speed, …).
 * It is purely presentational (no hooks, no network): it stacks a decorative
 * lucide icon, a headline value, and a caption label inside a GlassPanel. Because
 * it is non-interactive there is no user-event surface to exercise — the cases
 * below instead pin its rendering branches, the icon/color forwarding contract,
 * the nullish-value hardening, and its accessibility affordances.
 *
 * Facets covered:
 *   1. RENDER      — a string value and its label both surface as text.
 *   2. REACTNODE   — an arbitrary ReactNode value (e.g. an <AnimatedNumber>-style
 *                    element) is rendered verbatim, not stringified.
 *   3. ZERO        — the falsy 0 still renders "0" (regression guard against a
 *                    naive `value ?? '—'` slip that used `||` and blanked 0).
 *   4. NULLISH     — an undefined / null value degrades to an em-dash placeholder
 *                    so the figure is never a blank gap, and never leaks the
 *                    literal "undefined" / "null".
 *   5. ICON A11Y   — the decorative icon is aria-hidden and carries the dynamic
 *                    `color` as an inline style (the one sanctioned inline-style
 *                    exception for a computed value).
 *   6. ICON FWD    — the passed-in icon component is the one rendered, and it
 *                    receives the layout classes + color + aria-hidden.
 *   7. STRUCTURE   — value + label render as distinct centered <p> elements inside
 *                    a single GlassPanel card (never two panels, never blank).
 *
 * No mocks are needed beyond the global test-setup: IconStatCard reads no settings
 * and touches no network, so a bare render() suffices.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Route } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconStatCard } from './IconStatCard';

afterEach(cleanup);

describe('IconStatCard', () => {
  it('renders a string value together with its label', () => {
    render(<IconStatCard icon={Route} color="#00f0ff" value="156.4 km" label="Distance" />);

    expect(screen.getByText('156.4 km')).toBeInTheDocument();
    expect(screen.getByText('Distance')).toBeInTheDocument();
  });

  it('renders an arbitrary ReactNode value verbatim (not stringified)', () => {
    render(
      <IconStatCard
        icon={Route}
        color="#10b981"
        value={<span data-testid="animated">88 kW</span>}
        label="Max Power"
      />,
    );

    const node = screen.getByTestId('animated');
    expect(node).toBeInTheDocument();
    expect(node.textContent).toBe('88 kW');
    expect(screen.getByText('Max Power')).toBeInTheDocument();
  });

  it('preserves a falsy 0 value instead of collapsing it to the em-dash placeholder', () => {
    render(<IconStatCard icon={Route} color="#a855f7" value={0} label="Elev. Gain" />);

    expect(screen.getByText('0')).toBeInTheDocument();
    // The nullish guard must NOT swallow a legitimate zero.
    expect(screen.queryByText('—')).toBeNull();
  });

  it('degrades a nullish value to an em-dash, never leaking "undefined" or "null"', () => {
    const { container, rerender } = render(
      <IconStatCard
        icon={Route}
        color="#f59e0b"
        value={undefined as unknown as ReactNode}
        label="Duration"
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.textContent).not.toContain('undefined');
    // The label is still shown — the card is never blank.
    expect(screen.getByText('Duration')).toBeInTheDocument();

    rerender(
      <IconStatCard
        icon={Route}
        color="#f59e0b"
        value={null as unknown as ReactNode}
        label="Duration"
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.textContent).not.toContain('null');
  });

  it('marks the decorative icon aria-hidden and applies the dynamic color inline', () => {
    const { container } = render(
      <IconStatCard icon={Route} color="#10b981" value="42" label="Speed" />,
    );

    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    // The prop-driven color is the sanctioned inline-style exception (computed value).
    expect(icon).toHaveStyle({ color: '#10b981' });
    // Exactly one decorative element — the value/label are real, readable text.
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });

  it('renders the supplied icon component and forwards the layout classes to it', () => {
    const StubIcon = ((props) => (
      <svg data-testid="stub-icon" {...props} />
    )) as unknown as LucideIcon;

    render(<IconStatCard icon={StubIcon} color="rgb(1, 2, 3)" value="x" label="Custom" />);

    const icon = screen.getByTestId('stub-icon');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('h-4', 'w-4', 'mx-auto', 'mb-1');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveStyle({ color: 'rgb(1, 2, 3)' });
  });

  it('lays out value + label as distinct centered <p> elements inside one GlassPanel', () => {
    const { container } = render(
      <IconStatCard icon={Route} color="#00f0ff" value="410 km" label="Range" />,
    );

    // Single card container (GlassPanel emits data-print-card), centered.
    const panels = container.querySelectorAll('[data-print-card]');
    expect(panels).toHaveLength(1);
    expect(panels[0]).toHaveClass('text-center');

    const value = screen.getByText('410 km');
    const label = screen.getByText('Range');
    expect(value.tagName).toBe('P');
    expect(label.tagName).toBe('P');
    // Value is the bold headline; label is the muted 2xs caption (theme-safe tokens).
    expect(value).toHaveClass('font-bold', 'text-lg');
    expect(label).toHaveClass('text-2xs');
  });
});
