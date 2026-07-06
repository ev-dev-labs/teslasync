/**
 * `<SelectableCard>` contract tests.
 *
 * SelectableCard is the shared, full-width clickable surface behind every
 * single-select list / choice grid (e.g. the Sharing → Trips listbox). Feature
 * code relies on a small but load-bearing contract, so these tests lock it in:
 *
 *   1. It renders a REAL native `<button>` — keyboard operability, focus, and
 *      form semantics come for free; features never hand-roll a raw control.
 *   2. `type` defaults to `"button"` (so a card inside a `<form>` never submits
 *      it by accident) but an explicit `type` override wins.
 *   3. Selection is conveyed by BOTH styling AND `aria-selected` — but
 *      `aria-selected` is only emitted when the caller supplies a `role` that
 *      supports it, so a bare `role="button"` never carries an invalid ARIA
 *      prop.
 *   4. The disabled state is a real, dimmed, non-interactive affordance:
 *      `disabled` blocks clicks, dims the card, and drops the hover affordance.
 *   5. Caller `className` merges via tailwind-merge (caller wins on conflict),
 *      arbitrary button attributes pass through, and the ref lands on the
 *      `<button>`.
 *
 * `@testing-library/user-event` is not installed in this repo, so interactions
 * are driven via `fireEvent` from `@testing-library/react` — matching every
 * other component test here (Checkbox, PinButton, FullscreenButton, ...).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { SelectableCard, type SelectableCardProps } from './SelectableCard';

/** Tokenise a className string for order-independent membership assertions. */
function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

describe('SelectableCard — element & type contract', () => {
  it('renders a real native <button>', () => {
    render(<SelectableCard>Pick me</SelectableCard>);
    const btn = screen.getByRole('button', { name: 'Pick me' });
    expect(btn.tagName).toBe('BUTTON');
  });

  it('defaults type to "button" so it never submits an enclosing form', () => {
    render(<SelectableCard>Choice</SelectableCard>);
    expect((screen.getByRole('button') as HTMLButtonElement).type).toBe('button');
  });

  it('honours an explicit type override', () => {
    render(<SelectableCard type="submit">Save</SelectableCard>);
    expect((screen.getByRole('button') as HTMLButtonElement).type).toBe('submit');
  });

  it('renders its children', () => {
    render(
      <SelectableCard>
        <span data-testid="inner">Model 3</span>
      </SelectableCard>,
    );
    expect(screen.getByTestId('inner')).toHaveTextContent('Model 3');
  });
});

describe('SelectableCard — role & aria-selected contract', () => {
  it('omits aria-selected entirely for a role-less (bare button) card', () => {
    render(<SelectableCard selected>Bare</SelectableCard>);
    const btn = screen.getByRole('button');
    // A bare `button` role does not support aria-selected — it must be absent,
    // not merely "false", so no invalid ARIA prop is ever emitted.
    expect(btn.hasAttribute('aria-selected')).toBe(false);
  });

  it('exposes the caller-supplied role on the element', () => {
    render(
      <SelectableCard role="option" aria-label="Option A">
        A
      </SelectableCard>,
    );
    // Locatable by the option role — not the default button role.
    expect(screen.getByRole('option', { name: 'Option A' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('defaults aria-selected to "false" when a role is given but selected is omitted', () => {
    render(
      <SelectableCard role="option" aria-label="Unpicked">
        A
      </SelectableCard>,
    );
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'false');
  });

  it('reflects selected=true as aria-selected="true" on a supporting role', () => {
    render(
      <SelectableCard role="option" selected aria-label="Picked">
        A
      </SelectableCard>,
    );
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  });

  it('flips aria-selected from true to false when the prop changes', () => {
    const { rerender } = render(
      <SelectableCard role="option" selected aria-label="Row">
        A
      </SelectableCard>,
    );
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');

    rerender(
      <SelectableCard role="option" selected={false} aria-label="Row">
        A
      </SelectableCard>,
    );
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'false');
  });
});

describe('SelectableCard — styling contract', () => {
  it('always applies the full-width ≥44px touch target + focus-visible ring base', () => {
    render(<SelectableCard>Base</SelectableCard>);
    const cls = classesOf(screen.getByRole('button'));
    expect(cls).toContain('w-full');
    expect(cls).toContain('min-h-11');
    expect(cls).toContain('focus-visible:ring-2');
  });

  it('applies the selected accent and drops the unselected/hover classes when selected', () => {
    render(<SelectableCard selected>Sel</SelectableCard>);
    const cls = classesOf(screen.getByRole('button'));
    expect(cls).toContain('border-cyan-400/60');
    expect(cls).toContain('bg-cyan-500/5');
    // The unselected surface + its hover affordance must NOT be present.
    expect(cls).not.toContain('border-[var(--border-subtle)]');
    expect(cls).not.toContain('enabled:hover:border-[var(--border-strong)]');
  });

  it('applies the unselected surface with an enabled-only hover affordance by default', () => {
    render(<SelectableCard>Unsel</SelectableCard>);
    const cls = classesOf(screen.getByRole('button'));
    expect(cls).toContain('border-[var(--border-subtle)]');
    expect(cls).toContain('enabled:hover:border-[var(--border-strong)]');
    // Hover is gated behind `enabled:` so a disabled card is never a live
    // hover target — the bare `hover:` variant must not leak in.
    expect(cls).not.toContain('hover:border-[var(--border-strong)]');
  });

  it('applies a dimmed, not-allowed affordance when disabled', () => {
    render(<SelectableCard disabled>Off</SelectableCard>);
    const cls = classesOf(screen.getByRole('button'));
    expect(cls).toContain('disabled:opacity-50');
    expect(cls).toContain('disabled:cursor-not-allowed');
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('merges caller className and lets it win on conflict via tailwind-merge', () => {
    render(<SelectableCard className="p-6 border-red-500">Custom</SelectableCard>);
    const cls = classesOf(screen.getByRole('button'));
    // Caller padding wins — the base `p-3` is dropped, but the responsive
    // `sm:p-4` variant (a different key) is preserved.
    expect(cls).toContain('p-6');
    expect(cls).not.toContain('p-3');
    expect(cls).toContain('sm:p-4');
    expect(cls).toContain('border-red-500');
  });
});

describe('SelectableCard — interaction', () => {
  it('invokes onClick when clicked', () => {
    const onClick = vi.fn();
    render(<SelectableCard onClick={onClick}>Go</SelectableCard>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onClick while disabled', () => {
    const onClick = vi.fn();
    render(
      <SelectableCard disabled onClick={onClick}>
        Go
      </SelectableCard>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('reports the selected id to a handler (real listbox usage)', () => {
    const onSelect = vi.fn();
    render(
      <SelectableCard role="option" aria-label="Trip 7" onClick={() => onSelect(7)}>
        Trip 7
      </SelectableCard>,
    );
    fireEvent.click(screen.getByRole('option', { name: 'Trip 7' }));
    expect(onSelect).toHaveBeenCalledWith(7);
  });
});

describe('SelectableCard — passthrough, ref & metadata', () => {
  it('passes through arbitrary button attributes', () => {
    render(
      <SelectableCard id="card-1" data-testid="card" name="plan" aria-label="Plan A">
        A
      </SelectableCard>,
    );
    const btn = screen.getByTestId('card') as HTMLButtonElement;
    expect(btn.id).toBe('card-1');
    expect(btn.name).toBe('plan');
    expect(btn).toHaveAttribute('aria-label', 'Plan A');
  });

  it('forwards the ref to the underlying <button>', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<SelectableCard ref={ref}>Ref</SelectableCard>);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('accepts a fully-typed SelectableCardProps object', () => {
    // Exercises the exported prop type at compile time and confirms the
    // spread reaches the DOM element unchanged.
    const props: SelectableCardProps = {
      selected: true,
      role: 'option',
      'aria-label': 'Typed',
      className: 'gap-2',
    };
    render(<SelectableCard {...props}>Typed</SelectableCard>);
    const option = screen.getByRole('option', { name: 'Typed' });
    expect(option).toHaveAttribute('aria-selected', 'true');
    expect(classesOf(option)).toContain('gap-2');
  });

  it('exposes a stable displayName for devtools/error output', () => {
    expect(SelectableCard.displayName).toBe('SelectableCard');
  });
});
