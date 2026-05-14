/**
 * Checkbox primitive contract tests.
 *
 * Locks in the user-facing semantics so feature pages can rely on:
 *   1. Native `<input type="checkbox">` is the source of truth (keyboard,
 *      screen reader, form submission).
 *   2. `onChange` reports the new boolean — feature code never has to
 *      read `event.target.checked`.
 *   3. `indeterminate` is faithfully forwarded to the DOM element so
 *      "select all" headers render the mixed-state indicator.
 *   4. The visible label is associated with the input via the wrapping
 *      `<label>` so clicking the label toggles selection.
 *   5. `disabled` blocks toggling via click and exposes
 *      `aria-disabled` semantics through the native attribute.
 *   6. Forwarded refs land on the `<input>` element so callers can
 *      programmatically focus it.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { Checkbox } from '../Checkbox';

describe('Checkbox', () => {
  it('renders a native checkbox input', () => {
    render(<Checkbox aria-label="Pick me" />);
    const input = screen.getByRole('checkbox', { name: 'Pick me' });
    expect(input.tagName).toBe('INPUT');
    expect((input as HTMLInputElement).type).toBe('checkbox');
  });

  it('reports new boolean value via onChange', () => {
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

  it('reflects the checked prop on the underlying input', () => {
    const { rerender } = render(<Checkbox aria-label="Pick" checked={false} onChange={() => {}} />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.checked).toBe(false);

    rerender(<Checkbox aria-label="Pick" checked={true} onChange={() => {}} />);
    expect(input.checked).toBe(true);
  });

  it('forwards indeterminate state to the DOM', () => {
    render(<Checkbox aria-label="All" indeterminate checked={false} onChange={() => {}} />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.indeterminate).toBe(true);
  });

  it('clears indeterminate when the prop is removed', () => {
    const { rerender } = render(
      <Checkbox aria-label="All" indeterminate checked={false} onChange={() => {}} />,
    );
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.indeterminate).toBe(true);

    rerender(<Checkbox aria-label="All" indeterminate={false} checked={false} onChange={() => {}} />);
    expect(input.indeterminate).toBe(false);
  });

  it('renders the visible label and clicking it toggles the checkbox', () => {
    const onChange = vi.fn();
    render(<Checkbox label="Notify me" onChange={onChange} />);
    // The visible text and the input share an accessible label via the
    // wrapping <label>, so the input is locatable by name.
    const input = screen.getByRole('checkbox', { name: 'Notify me' });
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledWith(true);
    // Clicking the visible label text also toggles the checkbox.
    fireEvent.click(screen.getByText('Notify me'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does not call onChange when disabled', () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="Pick" disabled onChange={onChange} />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    fireEvent.click(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forwards refs to the underlying input', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox ref={ref} aria-label="Ref" />);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('INPUT');
  });

  it('passes through arbitrary input attributes (name, value)', () => {
    render(<Checkbox aria-label="Subscribe" name="newsletter" value="weekly" />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.name).toBe('newsletter');
    expect(input.value).toBe('weekly');
  });

  it('supports defaultChecked for uncontrolled usage', () => {
    render(<Checkbox aria-label="Pick" defaultChecked />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.checked).toBe(true);
  });
});
