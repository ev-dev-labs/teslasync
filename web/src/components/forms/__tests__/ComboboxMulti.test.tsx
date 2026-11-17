import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import '@/i18n';
import { ComboboxMulti } from '../ComboboxMulti';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '../../ui/app-designs/designs';

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
  it('qualifies the original async pending ring for all 27 intrinsic consumers without changing selection or announcements', async () => {
    let resolveOptions!: (items: readonly Item[]) => void;
    const options = vi.fn(() => new Promise<readonly Item[]>(resolve => { resolveOptions = resolve; }));
    const onChange = vi.fn();
    const rules: Rule[] = [];
    postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
      .walkRules(rule => {
        if (rule.selector.includes('[data-app-feedback-kind="inline-spinner"]')) rules.push(rule);
      });
    const { container } = render(
      <section data-app-design-preview="">
        <ComboboxMulti label="Fruits" value={[ITEMS[0]]} onChange={onChange} options={options}
          asyncDebounceMs={0} getOptionLabel={item => item.name} getOptionKey={item => item.id} />
      </section>,
    );
    const host = container.firstElementChild as HTMLElement;
    const input = screen.getByRole('combobox', { name: /fruits/i });
    const hiddenStatus = document.getElementById(input.getAttribute('aria-describedby') ?? '')!;
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
    fireEvent.focus(input);
    const ring = await screen.findByRole('status', { name: 'Loading' });
    const originalClass = 'h-3 w-3 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-transparent';
    expect(ring.tagName).toBe('SPAN');
    expect(ring).toHaveAttribute('data-app-part', 'loading-indicator');
    expect(ring).toHaveAttribute('data-app-feedback-kind', 'inline-spinner');
    expect(ring).toHaveAttribute('class', originalClass);
    expect(ring).not.toHaveAttribute('aria-hidden');
    expect(ring).not.toHaveAttribute('aria-live');
    expect(hiddenStatus).toHaveTextContent('Loading');
    expect(hiddenStatus).not.toBe(ring);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(input).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
    const release = observeAppDesignScopes(host);
    try {
      expect(rules.some(rule => ring.matches(rule.selector))).toBe(false);
      for (const pack of PACK_IDS) {
        for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) host.setAttribute(name, value);
        await waitFor(() => expect(ring).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`)));
        const matching = rules.filter(rule => ring.matches(rule.selector));
        expect(matching.length, pack).toBeGreaterThan(0);
        expect(matching.every(rule => rule.selector.includes(`[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`))).toBe(true);
        for (const rule of matching) {
          expect(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]))
            .toEqual([['pointer-events', 'none'], ['user-select', 'none']]);
        }
        expect(ring).toHaveAttribute('class', originalClass);
        expect(screen.getAllByRole('status')).toHaveLength(1);
      }
      for (const name of Object.keys(getAppDesignAttributes('classic'))) host.removeAttribute(name);
      host.setAttribute('data-widget-design-pack', 'classic');
      await waitFor(() => expect(ring).not.toHaveAttribute('data-app-design-owner'));
      expect(rules.some(rule => ring.matches(rule.selector))).toBe(false);
      await act(async () => { resolveOptions(ITEMS); });
      await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull());
      expect(hiddenStatus).toBeEmptyDOMElement();
      expect(input).not.toHaveAttribute('aria-busy');
      expect(screen.getByRole('listbox')).not.toHaveAttribute('aria-busy');
      expect(screen.queryByRole('option', { name: 'Apple' })).toBeNull();
      fireEvent.keyDown(input, { key: 'Home' });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).toHaveBeenLastCalledWith([ITEMS[0], ITEMS[1]]);
      expect(screen.getByRole('button', { name: /remove apple/i })).toBeInTheDocument();
    } finally {
      release();
    }
  });

  it('removes only the intrinsic ring when controlled loading ends, retaining the existing hidden status node and field', () => {
    const props = {
      label: 'Fruits', value: [ITEMS[0]], onChange: vi.fn(), options: ITEMS,
      getOptionLabel: (item: Item) => item.name, getOptionKey: (item: Item) => item.id,
    };
    const { rerender } = render(<ComboboxMulti {...props} loading />);
    const input = screen.getByRole('combobox', { name: /fruits/i });
    const hiddenStatus = document.getElementById(input.getAttribute('aria-describedby') ?? '')!;
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('data-app-feedback-kind', 'inline-spinner');
    expect(hiddenStatus).toHaveTextContent('Loading');
    expect(screen.queryByRole('listbox')).toBeNull();
    rerender(<ComboboxMulti {...props} loading={false} />);
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
    expect(screen.getByRole('combobox', { name: /fruits/i })).toBe(input);
    expect(document.getElementById(hiddenStatus.id)).toBe(hiddenStatus);
    expect(hiddenStatus).toBeEmptyDOMElement();
    expect(input).not.toHaveAttribute('aria-busy');
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('keeps native focus and selection with semantic rings at the existing geometry', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={[ITEMS[0]]} onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /fruits/i });
    const field = input.parentElement;

    await user.tab();
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(field).toHaveClass(
      'focus-within:ring-2',
      'focus-within:ring-[var(--focus-ring)]',
      'focus-within:ring-offset-1',
      'focus-within:ring-offset-[var(--bg)]',
    );
    expect(field).not.toHaveClass('focus-within:ring-blue-500');
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass(
        'focus:outline-none',
        'focus:ring-2',
        'focus:ring-[var(--focus-ring)]',
      );
      expect(button).not.toHaveClass('focus:ring-blue-500');
      expect(button).toHaveAttribute('tabindex', '-1');
    }

    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith([ITEMS[0], ITEMS[1]]);
    expect(input).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /remove apple/i }));
    expect(onChange).toHaveBeenLastCalledWith([ITEMS[1]]);
    expect(input).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /hide options/i }));
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /show options/i }));
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveFocus();
  });

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

  it('maxItems exposes disabled options and removal restores native keyboard selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness maxItems={2} initial={[ITEMS[0], ITEMS[1]]} onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /fruits/i });
    fireEvent.focus(input);
    // The label shows the count token.
    expect(screen.getByText(/\(2\/2\)/)).toBeInTheDocument();
    // Try to add another.
    const cherry = screen.getByRole('option', { name: 'Cherry' });
    expect(cherry).toHaveAttribute('aria-disabled', 'true');
    expect(input.closest('[data-app-field-surface]')).not.toBeNull();
    expect(screen.getByRole('listbox')).toHaveAttribute('data-app-part', 'popover');
    fireEvent.click(cherry);
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /remove banana/i }));
    expect(input).toHaveFocus();
    expect(screen.getByRole('option', { name: 'Cherry' })).not.toHaveAttribute('aria-disabled');
    await user.keyboard('{Home}');
    const active = document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
    expect(active).toHaveAttribute('data-active', 'true');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith([ITEMS[0], ITEMS[1]]);
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
