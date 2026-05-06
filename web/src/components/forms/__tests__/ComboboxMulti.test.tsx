/**
 * Phase-46 / Prompt 14 — ComboboxMulti unit tests.
 */

import {
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import '@/i18n';
import { ComboboxMulti } from '../ComboboxMulti';

interface Item {
  id: string;
  name: string;
}

const ITEMS: Item[] = [
  { id: '1', name: 'Apple' },
  { id: '2', name: 'Banana' },
  { id: '3', name: 'Cherry' },
  { id: '4', name: 'Date' },
];

interface HarnessProps {
  initial?: Item[];
  maxItems?: number;
  onChange?: (next: Item[]) => void;
  disabled?: boolean;
}

function Harness({ initial = [], maxItems, onChange, disabled }: HarnessProps) {
  const [value, setValue] = useState<Item[]>(initial);
  return (
    <ComboboxMulti<Item>
      label="Fruits"
      placeholder="Add a fruit"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      options={ITEMS}
      getOptionLabel={(o) => o.name}
      getOptionKey={(o) => o.id}
      maxItems={maxItems}
      disabled={disabled}
    />
  );
}

describe('ComboboxMulti', () => {
  it('renders combobox role with aria-multiselectable on listbox', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /fruits/i });
    fireEvent.focus(input);
    const listbox = screen.getByRole('listbox', { name: /fruits/i });
    expect(listbox).toHaveAttribute('aria-multiselectable', 'true');
  });

  it('clicking an option adds a chip and removes it from the dropdown', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /fruits/i });
    fireEvent.focus(input);
    const banana = screen.getByRole('option', { name: 'Banana' });
    fireEvent.click(banana);
    expect(onChange).toHaveBeenCalledWith([ITEMS[1]]);
    // Banana is now a chip.
    expect(
      screen.getByRole('button', { name: /remove banana/i }),
    ).toBeInTheDocument();
    // Dropdown no longer shows Banana.
    const remaining = screen.getAllByRole('option').map((o) => o.textContent);
    expect(remaining).not.toContain('Banana');
  });

  it('Enter on an active option adds it as a chip', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /fruits/i });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // active = idx 1 (Banana)
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith([ITEMS[1]]);
  });

  it('chip remove button removes the chip', () => {
    const onChange = vi.fn();
    render(<Harness initial={[ITEMS[0], ITEMS[1]]} onChange={onChange} />);
    const removeBtn = screen.getByRole('button', { name: /remove apple/i });
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith([ITEMS[1]]);
  });

  it('Backspace at empty input removes the trailing chip', () => {
    const onChange = vi.fn();
    render(<Harness initial={[ITEMS[0], ITEMS[1]]} onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /fruits/i });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith([ITEMS[0]]);
  });

  it('Backspace with text in the input does NOT remove a chip', () => {
    const onChange = vi.fn();
    render(<Harness initial={[ITEMS[0]]} onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /fruits/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'b' } });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('maxItems caps the number of selections', () => {
    const onChange = vi.fn();
    render(<Harness maxItems={2} initial={[ITEMS[0], ITEMS[1]]} onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /fruits/i });
    fireEvent.focus(input);
    // The label shows the count token.
    expect(screen.getByText(/\(2\/2\)/)).toBeInTheDocument();
    // Try to add another.
    const cherry = screen.getByRole('option', { name: 'Cherry' });
    fireEvent.click(cherry);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Escape closes the dropdown without removing chips', () => {
    render(<Harness initial={[ITEMS[0]]} />);
    const input = screen.getByRole('combobox', { name: /fruits/i });
    fireEvent.focus(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getByRole('button', { name: /remove apple/i }),
    ).toBeInTheDocument();
  });

  it('disabled state prevents focus opening the dropdown', () => {
    render(<Harness disabled />);
    const input = screen.getByRole('combobox', { name: /fruits/i });
    expect(input).toBeDisabled();
    fireEvent.focus(input);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('typing filters dropdown options (case-insensitive)', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /fruits/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'AN' } });
    const labels = screen.getAllByRole('option').map((o) => o.textContent);
    expect(labels).toContain('Banana');
    expect(labels).not.toContain('Apple');
  });

  it('aria-activedescendant updates as the user navigates', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /fruits/i });
    fireEvent.focus(input);
    expect(input.getAttribute('aria-activedescendant')).toMatch(/-opt-1$/);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toMatch(/-opt-2$/);
    fireEvent.keyDown(input, { key: 'End' });
    expect(input.getAttribute('aria-activedescendant')).toMatch(/-opt-4$/);
  });

  it('clicking outside the wrapper closes the dropdown', () => {
    render(
      <div>
        <button type="button">outside</button>
        <Harness />
      </div>,
    );
    const input = screen.getByRole('combobox', { name: /fruits/i });
    fireEvent.focus(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    fireEvent.mouseDown(document.body);
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });
});
