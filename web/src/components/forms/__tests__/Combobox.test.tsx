/**
 * Combobox unit tests.
 *
 * Covers the WAI-ARIA contract, keyboard navigation, async-fetch
 * abort-on-keystroke, free-text commit, disabled / loading states.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { useState } from 'react';
import '@/i18n';
import { Combobox } from '../Combobox';

interface Item {
  id: string;
  name: string;
}

const ITEMS: Item[] = [
  { id: '1', name: 'Apple' },
  { id: '2', name: 'Banana' },
  { id: '3', name: 'Cherry' },
  { id: '4', name: 'Date' },
  { id: '5', name: 'Elderberry' },
];

interface HarnessProps {
  initial?: Item | null;
  options?: Item[];
  asyncOptions?: (q: string, signal: AbortSignal) => Promise<Item[]>;
  allowFreeText?: boolean;
  onFreeTextCommit?: (text: string) => void;
  onChange?: (v: Item | null) => void;
  disabled?: boolean;
  loading?: boolean;
  inputValue?: string;
  onInputChange?: (text: string) => void;
}

function Harness({
  initial = null,
  options,
  asyncOptions,
  allowFreeText,
  onFreeTextCommit,
  onChange,
  disabled,
  loading,
  inputValue,
  onInputChange,
}: HarnessProps) {
  const [value, setValue] = useState<Item | null>(initial);
  return (
    <Combobox<Item>
      label="Fruit"
      placeholder="Pick a fruit"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      options={asyncOptions ?? options ?? ITEMS}
      getOptionLabel={(o) => o.name}
      getOptionKey={(o) => o.id}
      allowFreeText={allowFreeText}
      onFreeTextCommit={onFreeTextCommit}
      disabled={disabled}
      loading={loading}
      inputValue={inputValue}
      onInputChange={onInputChange}
    />
  );
}

describe('Combobox', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the input with combobox role and aria-expanded=false', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-haspopup', 'listbox');
  });

  it('opens the listbox on focus and exposes role=option rows', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox', { name: /fruit/i });
    expect(listbox).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options.length).toBe(ITEMS.length);
  });

  it('filters options by typed text (case-insensitive substring)', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'er' } });
    const options = screen.getAllByRole('option');
    // "Cherry" and "Elderberry" both contain "er".
    const labels = options.map((o) => o.textContent?.trim());
    expect(labels).toContain('Cherry');
    expect(labels).toContain('Elderberry');
    expect(labels).not.toContain('Apple');
  });

  it('shows "No results" when filter matches nothing', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it('ArrowDown / ArrowUp navigate active descendant; Enter selects', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    // Initial active = 0 (Apple) once options render.
    expect(input.getAttribute('aria-activedescendant')).toMatch(/-opt-1$/);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toMatch(/-opt-2$/);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toMatch(/-opt-3$/);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toMatch(/-opt-2$/);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(ITEMS[1]);
  });

  it('Escape closes the listbox without committing', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clicking outside closes the listbox', () => {
    render(
      <div>
        <button type="button">outside</button>
        <Harness />
      </div>,
    );
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    fireEvent.mouseDown(document.body);
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicking an option commits it and closes the listbox', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    const options = screen.getAllByRole('option');
    fireEvent.click(options[2]);
    expect(onChange).toHaveBeenCalledWith(ITEMS[2]);
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveValue(ITEMS[2].name);
  });

  it('Home / End jump active descendant to first / last', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'End' });
    expect(input.getAttribute('aria-activedescendant')).toMatch(/-opt-5$/);
    fireEvent.keyDown(input, { key: 'Home' });
    expect(input.getAttribute('aria-activedescendant')).toMatch(/-opt-1$/);
  });

  it('disabled state: input is disabled, no listbox opens on focus', () => {
    render(<Harness disabled />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    expect(input).toBeDisabled();
    fireEvent.focus(input);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('loading prop renders a spinner status node', () => {
    render(<Harness loading />);
    expect(
      screen.getAllByRole('status', { name: /loading/i }).length,
    ).toBeGreaterThan(0);
  });

  it('allowFreeText: Enter without an active option commits typed text', () => {
    const onCommit = vi.fn();
    const onChange = vi.fn();
    render(
      <Harness
        options={[]}
        allowFreeText
        onFreeTextCommit={onCommit}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'kiwi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('kiwi');
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('async options: aborts the previous fetch on a new keystroke', async () => {
    vi.useFakeTimers();
    const aborts: boolean[] = [];
    let callCount = 0;
    const asyncOptions = vi.fn(
      (q: string, signal: AbortSignal): Promise<Item[]> => {
        callCount += 1;
        return new Promise((resolve, reject) => {
          const id = setTimeout(() => {
            resolve([{ id: String(callCount), name: `result-${q}` }]);
          }, 100);
          signal.addEventListener('abort', () => {
            clearTimeout(id);
            aborts.push(true);
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      },
    );

    render(<Harness asyncOptions={asyncOptions} />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'a' } });
    // Fire the debounce timer for the first request.
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    fireEvent.change(input, { target: { value: 'ab' } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    fireEvent.change(input, { target: { value: 'abc' } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    // Resolve in-flight timers to give pending fetches a chance to settle.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    vi.useRealTimers();
    // At least one previous fetch should have been aborted by a newer keystroke.
    expect(aborts.length).toBeGreaterThanOrEqual(1);
    expect(asyncOptions).toHaveBeenCalled();
  });

  it('async options: surfaces returned rows in the listbox', async () => {
    vi.useFakeTimers();
    const asyncOptions = vi.fn(
      async (_q: string, _signal: AbortSignal): Promise<Item[]> => [
        { id: 'remote-1', name: 'Mango' },
        { id: 'remote-2', name: 'Pineapple' },
      ],
    );
    render(<Harness asyncOptions={asyncOptions} />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'm' } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await act(async () => {
      await Promise.resolve();
    });
    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.getByText('Mango')).toBeInTheDocument();
    });
    expect(screen.getByText('Pineapple')).toBeInTheDocument();
  });

  it('clear button resets the value and input text', () => {
    const onChange = vi.fn();
    render(<Harness initial={ITEMS[0]} onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    expect(input).toHaveValue('Apple');
    const clearBtn = screen.getByRole('button', { name: /clear selection/i });
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith(null);
    expect(input).toHaveValue('');
  });

  it('aria-controls only references the listbox while open', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    expect(input.getAttribute('aria-controls')).toBeNull();
    fireEvent.focus(input);
    expect(input.getAttribute('aria-controls')).toBeTruthy();
  });

  it('controlled inputValue + onInputChange round-trips typed text', () => {
    const onInputChange = vi.fn();
    function Wrapper() {
      const [text, setText] = useState('initial');
      return (
        <Combobox<Item>
          label="Fruit"
          value={null}
          onChange={() => {}}
          options={ITEMS}
          getOptionLabel={(o) => o.name}
          getOptionKey={(o) => o.id}
          inputValue={text}
          onInputChange={(t) => {
            setText(t);
            onInputChange(t);
          }}
        />
      );
    }
    render(<Wrapper />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    expect(input).toHaveValue('initial');
    fireEvent.change(input, { target: { value: 'banana' } });
    expect(onInputChange).toHaveBeenLastCalledWith('banana');
    expect(input).toHaveValue('banana');
  });

  it('selected option in dropdown carries aria-selected=true', () => {
    render(<Harness initial={ITEMS[1]} />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    const selected = screen.getByRole('option', {
      name: 'Banana',
    });
    expect(selected).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Combobox — custom renderOption', () => {
  /**
   * Regression: the option `<li>` used to carry an unconditional
   * `truncate` (⇒ `white-space: nowrap`) class. `nowrap` is inherited by
   * any descendant that doesn't reset it, which silently defeated a
   * custom `renderOption`'s own multi-line `line-clamp-2` treatment (the
   * shape AddressInput uses for geocoded results) — the clamp needs
   * `white-space: normal` to have more than one line to wrap onto.
   */
  it('does not force nowrap/truncate onto a custom renderOption — line-clamp keeps working', () => {
    render(
      <Combobox<Item>
        label="Fruit"
        value={null}
        onChange={() => {}}
        options={ITEMS}
        getOptionLabel={(o) => o.name}
        getOptionKey={(o) => o.id}
        renderOption={(o) => (
          <span data-testid={`custom-${o.id}`} className="line-clamp-2">
            {o.name}
          </span>
        )}
      />,
    );
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    const option = screen.getByRole('option', { name: 'Apple' });
    // The custom content rendered instead of the plain label.
    expect(screen.getByTestId('custom-1')).toHaveClass('line-clamp-2');
    // The `<li>` itself must not carry `truncate` (nowrap) — that class
    // would inherit into the custom span and collapse `line-clamp-2` to
    // a single line.
    expect(option.className).not.toMatch(/\btruncate\b/);
  });

  it('still exposes the full label as a title on custom-rendered options', () => {
    render(
      <Combobox<Item>
        label="Fruit"
        value={null}
        onChange={() => {}}
        options={ITEMS}
        getOptionLabel={(o) => o.name}
        getOptionKey={(o) => o.id}
        renderOption={(o) => <span>{o.name.toUpperCase()}</span>}
      />,
    );
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    // The accessible name now reflects the custom (uppercased) content, so
    // query by that instead of the original-case label.
    const option = screen.getByRole('option', { name: 'ELDERBERRY' });
    // `title` is inert markup — it's safe to surface the full original
    // label even though the visible text is custom-rendered (uppercased).
    expect(option).toHaveAttribute('title', 'Elderberry');
  });

  it('the default (non-custom) label branch keeps its truncate + title contract', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /fruit/i });
    fireEvent.focus(input);
    const option = screen.getByRole('option', { name: 'Apple' });
    expect(option.className).toMatch(/\btruncate\b/);
    expect(option).toHaveAttribute('title', 'Apple');
  });
});
