/**
 * MiniStat — behaviour, branch, hardening + a11y cover.
 *
 * <MiniStat label value icon? className? /> is the compact label-over-value chip
 * used across the Weekly Digest driving / charging / battery sections. It is
 * purely presentational (no hooks, no network): it stacks a secondary label over
 * a primary value inside a GlassPanel, optionally prefixed by a decorative icon.
 * Because it is non-interactive there is no user-event surface to exercise — the
 * cases below instead pin its rendering branches, the value-coercion contract,
 * and its accessibility affordances.
 *
 * Facets covered:
 *   1. RENDER    — the label and a string value both surface as text.
 *   2. NUMERIC   — a numeric value is stringified (42 → "42").
 *   3. ZERO      — the falsy 0 still renders "0" (regression guard against a
 *                  naive `{value && …}` that would blank the headline figure).
 *   4. ICON      — a provided icon renders inside a single aria-hidden wrapper.
 *   5. NO-ICON   — with no icon prop, no decorative wrapper is emitted at all.
 *   6. CLASSNAME — a caller className is merged onto the panel alongside the base
 *                  layout classes (tailwind-merge augments, it does not replace).
 *   7. NULLISH   — an undefined / null value degrades to an em-dash placeholder
 *                  instead of leaking the literal "undefined" / "null".
 *   8. TITLE     — label + value expose full-text `title` tooltips so truncated
 *                  content stays discoverable on hover.
 *
 * No mocks are needed beyond the global test-setup: MiniStat reads no settings
 * and touches no network, so a bare render() suffices.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { MiniStat } from './MiniStat';

afterEach(cleanup);

describe('MiniStat', () => {
  it('renders the label and a string value', () => {
    render(<MiniStat label="Avg Efficiency" value="150 Wh/km" />);

    expect(screen.getByText('Avg Efficiency')).toBeInTheDocument();
    expect(screen.getByText('150 Wh/km')).toBeInTheDocument();
  });

  it('stringifies a numeric value', () => {
    render(<MiniStat label="Drives" value={42} />);

    const value = screen.getByText('42');
    expect(value).toBeInTheDocument();
    expect(value.textContent).toBe('42');
  });

  it('renders a zero value instead of blanking on the falsy 0', () => {
    render(<MiniStat label="Alerts" value={0} />);

    // "0" must actually render as the value, and the label must stay distinct.
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('Alerts')).toBeInTheDocument();
  });

  it('renders a provided icon inside a single decorative aria-hidden wrapper', () => {
    const { container } = render(
      <MiniStat label="Time" value="3h 12m" icon={<svg data-testid="clock" />} />,
    );

    const icon = screen.getByTestId('clock');
    expect(icon).toBeInTheDocument();

    const wrapper = icon.closest('span');
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    // Exactly one decorative wrapper exists for the single icon.
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });

  it('emits no decorative wrapper when no icon is supplied', () => {
    const { container } = render(<MiniStat label="Drives" value={7} />);

    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('merges a caller className onto the panel without dropping the base layout', () => {
    const { container } = render(
      <MiniStat label="Range" value="410 km" className="col-span-2 custom-flag" />,
    );

    const panel = container.querySelector('[data-print-card]');
    expect(panel).not.toBeNull();
    expect(panel).toHaveClass('custom-flag');
    expect(panel).toHaveClass('col-span-2');
    // The component's own layout classes survive the merge.
    expect(panel).toHaveClass('flex', 'items-center', 'gap-3');
  });

  it('degrades a nullish value to an em-dash placeholder, never the word "undefined" or "null"', () => {
    const { container, rerender } = render(
      <MiniStat label="Efficiency" value={undefined as unknown as string} />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.textContent).not.toContain('undefined');

    rerender(<MiniStat label="Efficiency" value={null as unknown as string} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.textContent).not.toContain('null');
  });

  it('exposes full-text title tooltips on the label and value for truncated content', () => {
    render(<MiniStat label="Total Driving Time" value="12h 47m" />);

    expect(screen.getByText('Total Driving Time')).toHaveAttribute('title', 'Total Driving Time');
    expect(screen.getByText('12h 47m')).toHaveAttribute('title', '12h 47m');
  });
});
