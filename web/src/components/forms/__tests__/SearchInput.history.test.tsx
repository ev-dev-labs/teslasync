import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import '@/i18n';
import { SearchInput } from '../SearchInput';
import { recordSearch, _resetSearchHistory } from '@/lib/searchHistory';

const SCOPE = 'test-history-scope';

interface HarnessProps {
  initial?: string;
  onChange?: (v: string) => void;
  scope?: string;
  showHistoryOnFocus?: boolean;
  maxHistory?: number;
}

function Harness({
  initial = '',
  onChange,
  scope = SCOPE,
  showHistoryOnFocus,
  maxHistory,
}: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <SearchInput
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      placeholder="Search…"
      historyScope={scope}
      showHistoryOnFocus={showHistoryOnFocus}
      maxHistory={maxHistory}
    />
  );
}

beforeEach(() => {
  _resetSearchHistory();
});

afterEach(() => {
  _resetSearchHistory();
  vi.useRealTimers();
});

describe('SearchInput — recent searches dropdown', () => {
  it('does NOT show dropdown when historyScope is omitted', () => {
    function NoScope() {
      const [value, setValue] = useState('');
      return (
        <SearchInput
          value={value}
          onChange={setValue}
          placeholder="Search…"
        />
      );
    }
    recordSearch(SCOPE, 'foo bar');
    render(<NoScope />);
    fireEvent.focus(screen.getByPlaceholderText('Search…'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does NOT show dropdown when there is no history', () => {
    render(<Harness />);
    fireEvent.focus(screen.getByPlaceholderText('Search…'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows dropdown on focus when scope has entries and value is empty', () => {
    recordSearch(SCOPE, 'foo bar');
    recordSearch(SCOPE, 'baz qux');
    render(<Harness />);
    const input = screen.getByPlaceholderText('Search…');
    fireEvent.focus(input);
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(2);
    // Newest-first order
    expect(options[0]).toHaveTextContent('baz qux');
    expect(options[1]).toHaveTextContent('foo bar');
  });

  it('hides dropdown when input has any value', () => {
    recordSearch(SCOPE, 'foo bar');
    render(<Harness initial="x" />);
    fireEvent.focus(screen.getByPlaceholderText('Search…'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('respects showHistoryOnFocus={false}', () => {
    recordSearch(SCOPE, 'foo bar');
    render(<Harness showHistoryOnFocus={false} />);
    fireEvent.focus(screen.getByPlaceholderText('Search…'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('clicking an entry fills the input and fires onChange', () => {
    const onChange = vi.fn();
    recordSearch(SCOPE, 'M3 sport');
    render(<Harness onChange={onChange} />);
    fireEvent.focus(screen.getByPlaceholderText('Search…'));
    // Each option contains two buttons: the entry button (clickable label)
    // and the × remove button. Click the entry button (first one).
    const option = screen.getByRole('option', { name: /M3 sport/i });
    const entryButton = within(option).getAllByRole('button')[0];
    fireEvent.click(entryButton);
    expect(screen.getByPlaceholderText('Search…')).toHaveValue('M3 sport');
    expect(onChange).toHaveBeenCalledWith('M3 sport');
  });

  it('removing a single entry via the × button updates the dropdown', () => {
    recordSearch(SCOPE, 'alpha');
    recordSearch(SCOPE, 'beta');
    recordSearch(SCOPE, 'gamma');
    render(<Harness />);
    fireEvent.focus(screen.getByPlaceholderText('Search…'));
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(3);

    const removeBtn = screen.getByRole('button', { name: /Remove "beta"/i });
    fireEvent.click(removeBtn);

    const remainingOptions = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(remainingOptions).toHaveLength(2);
    expect(remainingOptions.map((o) => o.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('gamma'), expect.stringContaining('alpha')]),
    );
    expect(remainingOptions.find((o) => o.textContent?.includes('beta'))).toBeUndefined();
  });

  it('"Clear history" empties the dropdown and dismisses it', () => {
    recordSearch(SCOPE, 'one');
    recordSearch(SCOPE, 'two');
    render(<Harness />);
    fireEvent.focus(screen.getByPlaceholderText('Search…'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Clear history/i }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('ArrowDown / ArrowUp moves the active option', () => {
    recordSearch(SCOPE, 'first');
    recordSearch(SCOPE, 'second');
    recordSearch(SCOPE, 'third');
    render(<Harness />);
    const input = screen.getByPlaceholderText('Search…');
    fireEvent.focus(input);
    const listbox = screen.getByRole('listbox');

    // No active option initially
    expect(input).not.toHaveAttribute('aria-activedescendant');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    let options = within(listbox).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    options = within(listbox).getAllByRole('option');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    options = within(listbox).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    // Bounds: at top, ArrowUp should clear active selection
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).not.toHaveAttribute('aria-activedescendant');

    // Bounds: at bottom, ArrowDown should clamp
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 0
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 1
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 2 (last)
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // stays at 2
    options = within(listbox).getAllByRole('option');
    expect(options[2]).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter on an active option selects it', () => {
    const onChange = vi.fn();
    recordSearch(SCOPE, 'alpha');
    recordSearch(SCOPE, 'beta');
    render(<Harness onChange={onChange} />);
    const input = screen.getByPlaceholderText('Search…');
    fireEvent.focus(input);

    fireEvent.keyDown(input, { key: 'ArrowDown' }); // active = 0 ("beta", newest)
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveValue('beta');
    expect(onChange).toHaveBeenCalledWith('beta');
  });

  it('Escape closes the dropdown', () => {
    recordSearch(SCOPE, 'foo');
    render(<Harness />);
    const input = screen.getByPlaceholderText('Search…');
    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('aria-expanded reflects dropdown visibility', () => {
    recordSearch(SCOPE, 'foo');
    render(<Harness />);
    const input = screen.getByPlaceholderText('Search…');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    fireEvent.focus(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('records the typed query on Enter (≥ 2 chars)', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByPlaceholderText('Search…');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'hello' } });
    // Dropdown is hidden because value is non-empty; pressing Enter should
    // still record the query.
    fireEvent.keyDown(input, { key: 'Enter' });

    // Re-focus an empty input by clearing it; this should now show "hello"
    // in the dropdown.
    fireEvent.change(input, { target: { value: '' } });
    // Force a re-focus so the dropdown re-evaluates entries.
    fireEvent.blur(input);
    fireEvent.focus(input);

    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.some((o) => (o.textContent ?? '').includes('hello'))).toBe(true);
  });

  it('does NOT record queries shorter than MIN_QUERY_LEN on Enter', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('Search…');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Clear and re-focus — there should still be no history.
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    fireEvent.focus(input);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('records on blur when value is non-empty (≥ 2 chars)', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('Search…');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'committed' } });
    fireEvent.blur(input);

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.focus(input);
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.some((o) => (o.textContent ?? '').includes('committed'))).toBe(true);
  });

  it('removeAria label includes the entry text', () => {
    recordSearch(SCOPE, 'M3 sport');
    render(<Harness />);
    fireEvent.focus(screen.getByPlaceholderText('Search…'));
    expect(screen.getByRole('button', { name: /Remove "M3 sport"/i })).toBeInTheDocument();
  });
});
