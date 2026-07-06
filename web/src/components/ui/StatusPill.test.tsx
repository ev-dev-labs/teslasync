/**
 * `<StatusPill>` primitive tests.
 *
 * StatusPill is a purely presentational status badge: a rounded pill with a
 * decorative colour dot followed by its children. It has no query/router/i18n
 * dependencies, so a bare render() is sufficient. The contract these tests
 * lock in:
 *   - renders a <span> pill carrying the shared base classes + children,
 *   - the leading dot is decorative (aria-hidden) and takes the `color` class,
 *   - `pulse` toggles the `animate-pulse` animation on the dot only,
 *   - `className` is merged through cn() so Tailwind conflicts collapse,
 *   - the ref is forwarded to the outer pill element,
 *   - arbitrary span attributes / handlers pass through via {...props}.
 *
 * `@testing-library/user-event` is not installed in this repo (see
 * EditableText.test.tsx), so interactions are driven with `fireEvent`.
 */

import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { StatusPill } from './StatusPill';

/** The decorative dot is the first (and only) descendant <span> of the pill. */
function dotOf(pill: HTMLElement): HTMLElement {
  const dot = pill.querySelector('span');
  if (!dot) throw new Error('expected a decorative dot span inside the pill');
  return dot;
}

describe('StatusPill', () => {
  it('renders a <span> pill with the base classes and its children', () => {
    render(<StatusPill data-testid="pill">Active</StatusPill>);
    const pill = screen.getByTestId('pill');

    expect(pill.tagName).toBe('SPAN');
    expect(pill).toHaveTextContent('Active');
    expect(pill.className).toContain('inline-flex');
    expect(pill.className).toContain('rounded-full');
    expect(pill.className).toContain('font-medium');
  });

  it('renders a decorative dot that is hidden from assistive tech', () => {
    render(<StatusPill data-testid="pill">Online</StatusPill>);
    const dot = dotOf(screen.getByTestId('pill'));

    // The dot conveys status via colour only; the text carries the meaning,
    // so the dot must stay out of the accessibility tree.
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    expect(dot.className).toContain('rounded-full');
    expect(dot.textContent).toBe('');
  });

  it('applies the default grey dot colour when no `color` is given', () => {
    render(<StatusPill data-testid="pill">Idle</StatusPill>);
    const dot = dotOf(screen.getByTestId('pill'));

    expect(dot.className).toContain('bg-gray-500');
  });

  it('applies a custom dot colour without leaking it onto the pill', () => {
    render(
      <StatusPill data-testid="pill" color="bg-emerald-500">
        Online
      </StatusPill>,
    );
    const pill = screen.getByTestId('pill');
    const dot = dotOf(pill);

    expect(dot.className).toContain('bg-emerald-500');
    expect(dot.className).not.toContain('bg-gray-500');
    // The colour belongs to the dot, not the pill surface.
    expect(pill.className).not.toContain('bg-emerald-500');
  });

  it('does not animate the dot by default', () => {
    render(<StatusPill data-testid="pill">Steady</StatusPill>);
    expect(dotOf(screen.getByTestId('pill')).className).not.toContain(
      'animate-pulse',
    );
  });

  it('animates only the dot when `pulse` is set', () => {
    render(
      <StatusPill data-testid="pill" pulse>
        Live
      </StatusPill>,
    );
    const pill = screen.getByTestId('pill');

    expect(dotOf(pill).className).toContain('animate-pulse');
    // The animation is scoped to the dot — the pill surface never pulses.
    expect(pill.className).not.toContain('animate-pulse');
  });

  it('merges a caller className and collapses Tailwind conflicts via cn()', () => {
    render(
      <StatusPill data-testid="pill" className="text-sm font-bold">
        Merged
      </StatusPill>,
    );
    const pill = screen.getByTestId('pill');

    expect(pill.className).toContain('font-bold');
    // tailwind-merge keeps the caller's font-size and drops the base text-xs.
    expect(pill.className).toContain('text-sm');
    expect(pill.className).not.toContain('text-xs');
  });

  it('forwards the ref to the outer pill element', () => {
    const ref = createRef<HTMLSpanElement>();
    render(
      <StatusPill ref={ref} data-testid="pill">
        Ref
      </StatusPill>,
    );

    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
    expect(ref.current).toBe(screen.getByTestId('pill'));
    expect(ref.current).toHaveTextContent('Ref');
  });

  it('passes through arbitrary span attributes, including aria-label', () => {
    render(
      <StatusPill
        data-testid="pill"
        id="charge-status"
        title="Charging"
        aria-label="Vehicle status: charging"
      >
        Charging
      </StatusPill>,
    );
    const pill = screen.getByTestId('pill');

    expect(pill.id).toBe('charge-status');
    expect(pill.getAttribute('title')).toBe('Charging');
    expect(screen.getByLabelText('Vehicle status: charging')).toBe(pill);
  });

  it('forwards event handlers such as onClick', () => {
    const onClick = vi.fn();
    render(
      <StatusPill data-testid="pill" onClick={onClick}>
        Clickable
      </StatusPill>,
    );

    fireEvent.click(screen.getByTestId('pill'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders rich ReactNode children, not just strings', () => {
    render(
      <StatusPill>
        <strong>Bold status</strong>
      </StatusPill>,
    );
    expect(screen.getByText('Bold status').tagName).toBe('STRONG');
  });

  it('exposes a stable displayName for devtools/forwardRef', () => {
    expect(StatusPill.displayName).toBe('StatusPill');
  });
});
