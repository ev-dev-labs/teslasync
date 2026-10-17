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

  it('uses opaque, contrasting checked and mixed indicators in both themes', () => {
    render(<Checkbox aria-label="Pick" checked indeterminate />);
    const input = screen.getByRole('checkbox');
    const indicator = input.nextElementSibling as HTMLElement;
    expect(indicator.className).toContain('peer-checked:bg-[var(--theme-primary)]');
    expect(indicator.className).toContain('peer-checked:text-[var(--theme-on-primary)]');
    expect(indicator.className).toContain('peer-checked:border-[var(--theme-primary)]');
    expect(indicator.className).toContain('peer-indeterminate:text-[var(--theme-on-primary)]');
    expect(indicator.className).toContain('peer-indeterminate:bg-[var(--theme-primary)]');
    expect(indicator.className).toContain('peer-indeterminate:border-[var(--theme-primary)]');
    expect(indicator.querySelector('svg')).toHaveAttribute('stroke-width', '3');
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

  it('keeps unique implicit identities across translated labels and preserves focus', () => {
    const { rerender } = render(<><Checkbox label="Notify me" /><Checkbox label="Notify me" /></>);
    const inputs = screen.getAllByRole('checkbox');
    const firstId = inputs[0].id;
    expect(firstId).not.toBe('');
    expect(inputs[1].id).not.toBe(firstId);
    expect(inputs[0].closest('label')).toHaveAttribute('for', firstId);
    inputs[0].focus();
    rerender(<><Checkbox label="通知を受け取る" /><Checkbox label="通知を受け取る" /></>);
    expect(screen.getAllByRole('checkbox')[0]).toBe(inputs[0]);
    expect(inputs[0]).toHaveAttribute('id', firstId);
    expect(inputs[0]).toHaveFocus();
  });

  it('preserves explicit IDs and external label and description associations', () => {
    render(<><label htmlFor="subscription">External label</label><span id="hint">Weekly updates</span>
      <Checkbox id="subscription" aria-describedby="hint" /></>);
    const input = screen.getByRole('checkbox', { name: 'External label' });
    expect(input).toHaveAttribute('id', 'subscription');
    expect(input).toHaveAccessibleDescription('Weekly updates');
    fireEvent.click(screen.getByText('External label'));
    expect(input).toBeChecked();
  });

  it('retains native form association, submission value and reset behavior', () => {
    render(<><form id="preferences" aria-label="Preferences" />
      <Checkbox label="Updates" form="preferences" name="updates" value="weekly" defaultChecked /></>);
    const form = screen.getByRole('form', { name: 'Preferences' });
    if (!(form instanceof HTMLFormElement)) throw new Error('Expected native form');
    const input = screen.getByRole('checkbox');
    expect(new FormData(form).get('updates')).toBe('weekly');
    fireEvent.click(input);
    expect(input).not.toBeChecked();
    expect(new FormData(form).has('updates')).toBe(false);
    form.reset();
    expect(input).toBeChecked();
  });

  it('reports exactly one boolean change while forwarding native click and input events', () => {
    const onChange = vi.fn();
    const onClick = vi.fn();
    const onInput = vi.fn();
    render(<Checkbox label="Updates" onChange={onChange} onClick={onClick} onInput={onInput} />);
    fireEvent.click(screen.getByText('Updates'));
    expect(onChange.mock.calls).toEqual([[true]]);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Updates'));
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(onInput).toHaveBeenCalledTimes(2);
  });

  it('supports callback refs, focus and cleanup', () => {
    const ref = vi.fn();
    const { unmount } = render(<Checkbox ref={ref} aria-label="Ref" />);
    const input = screen.getByRole('checkbox');
    expect(ref).toHaveBeenLastCalledWith(input);
    input.focus();
    expect(input).toHaveFocus();
    unmount();
    expect(ref).toHaveBeenLastCalledWith(null);
  });

  it.each([
    ['sm', 'h-3.5', 'w-3.5'],
    ['md', 'h-4', 'w-4'],
    ['lg', 'h-5', 'w-5'],
  ] as const)('preserves %s glyph size with separate reachable targets', (size, height, width) => {
    render(<Checkbox size={size} aria-label="Pick" />);
    const input = screen.getByRole('checkbox');
    expect(input.nextElementSibling).toHaveClass(height, width);
    expect(input.closest('label')).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-6', 'md:min-w-6');
  });

  it('keeps long rich labels visible and handles zero or absent labels', () => {
    const longLabel = 'Translated subscription preference '.repeat(20);
    const { rerender } = render(<Checkbox label={<strong>{longLabel}</strong>} />);
    expect(screen.getByRole('checkbox', { name: longLabel.trim() })).toBeInTheDocument();
    expect(screen.getByText(longLabel.trim()).parentElement).toHaveClass('min-w-0', 'break-words');
    rerender(<Checkbox label={0} />);
    expect(screen.getByRole('checkbox', { name: '0' })).toBeInTheDocument();
    rerender(<Checkbox aria-label="No inline label" />);
    expect(screen.getByRole('checkbox', { name: 'No inline label' })).toBeInTheDocument();
  });

  it('uses non-glowing focus, reduced-motion and forced-color affordances', () => {
    render(<Checkbox aria-label="Pick" />);
    const indicator = screen.getByRole('checkbox').nextElementSibling;
    expect(indicator).toHaveClass(
      'peer-focus-visible:outline-2', 'peer-focus-visible:outline-offset-2',
      'peer-focus-visible:outline-[var(--focus-ring)]', 'motion-reduce:transition-none',
      'forced-colors:border-[var(--border-strong)]', 'forced-colors:bg-[var(--surface-2)]',
      'forced-colors:peer-focus-visible:outline-[var(--theme-primary)]',
    );
  });
});
