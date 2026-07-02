/**
 * Checkbox primitive contract tests.
 *
 * The checkbox is now built on Radix UI's `Checkbox` primitive, so the
 * accessible control is a real `<button role="checkbox">` carrying tri-state
 * `aria-checked` / `data-state` — not the previous visually-hidden
 * `<input type="checkbox">`. A bare `input.checked` / `input.indeterminate`
 * assertion therefore no longer applies (the same reason the Radix `<Slider>`
 * migration swapped `fireEvent.change` for role/aria assertions); state is
 * read from `aria-checked` / `data-state` instead. These tests lock in the
 * user-facing semantics feature pages rely on:
 *   1. A single `role="checkbox"` control is exposed — a focusable <button>,
 *      natively Space-toggleable and Tab-reachable.
 *   2. `onChange` reports the new boolean — feature code never reads
 *      `event.target.checked`.
 *   3. `indeterminate` surfaces as `aria-checked="mixed"` /
 *      `data-state="indeterminate"` so "select all" headers announce and
 *      render the mixed state.
 *   4. A visible `label` names the control (via `aria-labelledby`) and
 *      clicking it toggles selection.
 *   5. `disabled` blocks toggling (click and via the label) and is exposed on
 *      the control.
 *   6. Forwarded refs land on the control `<button>` so callers can focus it.
 *   7. Standard attributes pass through, and `name`/`value` participate in
 *      native <form> submission via Radix's hidden bubble <input>.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { Checkbox } from '../Checkbox';

describe('Checkbox', () => {
  it('renders a single accessible checkbox control (a focusable button)', () => {
    render(<Checkbox aria-label="Pick me" />);
    const control = screen.getByRole('checkbox', { name: 'Pick me' });
    // Radix renders the WAI-ARIA checkbox as a real <button>: natively
    // focusable and Space-toggleable. jsdom + fireEvent can't simulate the
    // native Space activation, so keyboard operability is proven structurally
    // here (real button + focusable) and behaviourally via click below.
    expect(control.tagName).toBe('BUTTON');
    expect(control).toHaveAttribute('aria-checked', 'false');
    control.focus();
    expect(control).toHaveFocus();
  });

  it('reports the new boolean value via onChange', () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="Pick" onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('toggles back to false when re-clicked while controlled', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Checkbox aria-label="Pick" checked={false} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<Checkbox aria-label="Pick" checked={true} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('reflects the checked prop via aria-checked / data-state', () => {
    const { rerender } = render(<Checkbox aria-label="Pick" checked={false} onChange={() => {}} />);
    const control = screen.getByRole('checkbox');
    expect(control).toHaveAttribute('aria-checked', 'false');
    expect(control).toHaveAttribute('data-state', 'unchecked');

    rerender(<Checkbox aria-label="Pick" checked={true} onChange={() => {}} />);
    expect(control).toHaveAttribute('aria-checked', 'true');
    expect(control).toHaveAttribute('data-state', 'checked');
  });

  it('surfaces the indeterminate state as aria-checked="mixed"', () => {
    render(<Checkbox aria-label="All" indeterminate checked={false} onChange={() => {}} />);
    const control = screen.getByRole('checkbox');
    expect(control).toHaveAttribute('aria-checked', 'mixed');
    expect(control).toHaveAttribute('data-state', 'indeterminate');
  });

  it('clears the indeterminate state when the prop is removed', () => {
    const { rerender } = render(
      <Checkbox aria-label="All" indeterminate checked={false} onChange={() => {}} />,
    );
    const control = screen.getByRole('checkbox');
    expect(control).toHaveAttribute('aria-checked', 'mixed');

    rerender(<Checkbox aria-label="All" indeterminate={false} checked={false} onChange={() => {}} />);
    expect(control).toHaveAttribute('aria-checked', 'false');
    expect(control).toHaveAttribute('data-state', 'unchecked');
  });

  it('names the control from the visible label and toggles when the label is clicked', () => {
    const onChange = vi.fn();
    render(<Checkbox label="Notify me" onChange={onChange} />);
    // The visible label names the control via aria-labelledby, so it is
    // locatable by accessible name.
    const control = screen.getByRole('checkbox', { name: 'Notify me' });
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
    // Clicking the visible label text also toggles the control.
    fireEvent.click(screen.getByText('Notify me'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does not call onChange when disabled', () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="Pick" disabled onChange={onChange} />);
    const control = screen.getByRole('checkbox');
    expect(control).toBeDisabled();
    fireEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not toggle via the label when disabled', () => {
    const onChange = vi.fn();
    render(<Checkbox label="Locked" disabled onChange={onChange} />);
    fireEvent.click(screen.getByText('Locked'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forwards refs to the control button', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Checkbox ref={ref} aria-label="Ref" />);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('BUTTON');
    expect(ref.current).toHaveAttribute('role', 'checkbox');
  });

  it('passes arbitrary attributes through to the control', () => {
    render(<Checkbox aria-label="Tagged" id="agree" tabIndex={-1} data-testid="agree-box" />);
    const control = screen.getByRole('checkbox', { name: 'Tagged' });
    expect(control).toHaveAttribute('id', 'agree');
    expect(control).toHaveAttribute('tabindex', '-1');
    expect(control).toHaveAttribute('data-testid', 'agree-box');
  });

  it('participates in native form submission via name/value', () => {
    render(
      <form data-testid="host-form">
        <Checkbox aria-label="Subscribe" name="newsletter" value="weekly" defaultChecked />
      </form>,
    );
    // Inside a <form>, Radix mounts a hidden bubble <input type="checkbox">
    // carrying name/value so the checkbox participates in form submission.
    const form = screen.getByTestId('host-form');
    const hidden = form.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(hidden).not.toBeNull();
    expect(hidden?.name).toBe('newsletter');
    expect(hidden?.value).toBe('weekly');
    expect(hidden?.checked).toBe(true);
  });

  it('supports defaultChecked for uncontrolled usage', () => {
    render(<Checkbox aria-label="Pick" defaultChecked />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles internal state when uncontrolled (no checked prop)', () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="Uncontrolled" onChange={onChange} />);
    const control = screen.getByRole('checkbox');
    expect(control).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(control);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(control).toHaveAttribute('aria-checked', 'true');
  });

  it('mounts the indicator icon only while checked or indeterminate', () => {
    const { rerender, container } = render(
      <Checkbox aria-label="Ind" checked={false} onChange={() => {}} />,
    );
    // Unchecked: Radix does not mount its Indicator, so no icon is rendered.
    expect(container.querySelector('svg')).toBeNull();

    rerender(<Checkbox aria-label="Ind" indeterminate checked={false} onChange={() => {}} />);
    expect(container.querySelector('svg')).not.toBeNull();

    rerender(<Checkbox aria-label="Ind" checked={true} onChange={() => {}} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
