import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import '@/i18n';
import { SearchInput } from './SearchInput';

interface HarnessProps {
  initial?: string;
  debounceMs?: number;
  onChange?: (v: string) => void;
}

function Harness({ initial = '', debounceMs, onChange }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <SearchInput
      value={value}
      onChange={(v) => { setValue(v); onChange?.(v); }}
      placeholder="Search…"
      debounceMs={debounceMs}
    />
  );
}

describe('SearchInput', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the placeholder', () => {
    render(<Harness />);
    expect(screen.getByPlaceholderText('Search…')).toBeInTheDocument();
  });

  it('forwards a programmatic label to the search field', () => {
    render(
      <SearchInput
        value=""
        onChange={() => undefined}
        ariaLabel="Filter by owner"
      />,
    );

    expect(screen.getByRole('searchbox', { name: 'Filter by owner' })).toBeInTheDocument();
  });

  it('reflects the initial controlled value', () => {
    render(<Harness initial="abc" />);
    expect(screen.getByPlaceholderText('Search…')).toHaveValue('abc');
  });

  it('debounces onChange — rapid typing fires once after delay', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} debounceMs={250} />);
    const input = screen.getByPlaceholderText('Search…');

    act(() => { fireEvent.change(input, { target: { value: 't' } }); });
    act(() => { fireEvent.change(input, { target: { value: 'te' } }); });
    act(() => { fireEvent.change(input, { target: { value: 'tes' } }); });
    act(() => { fireEvent.change(input, { target: { value: 'test' } }); });

    // Before the debounce window elapses, no onChange should have fired.
    expect(onChange).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(250); });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('test');
  });

  it('does not emit onChange when the value is unchanged', () => {
    const onChange = vi.fn();
    render(<Harness initial="abc" onChange={onChange} debounceMs={250} />);
    act(() => { vi.advanceTimersByTime(500); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the clear button only when there is text', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();

    const input = screen.getByPlaceholderText('Search…');
    act(() => { fireEvent.change(input, { target: { value: 'hi' } }); });

    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('clear button resets to empty string and emits onChange("")', () => {
    const onChange = vi.fn();
    render(<Harness initial="hello" onChange={onChange} debounceMs={250} />);
    expect(screen.getByPlaceholderText('Search…')).toHaveValue('hello');

    act(() => { fireEvent.click(screen.getByRole('button', { name: /clear/i })); });
    // Local state immediately reflects empty.
    expect(screen.getByPlaceholderText('Search…')).toHaveValue('');

    // After debounce, onChange fires with the empty string.
    act(() => { vi.advanceTimersByTime(250); });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('syncs from external value prop changes', () => {
    function Driver() {
      const [value, setValue] = useState('one');
      return (
        <>
          <button type="button" onClick={() => setValue('two')}>swap</button>
          <SearchInput value={value} onChange={() => undefined} placeholder="Search…" />
        </>
      );
    }
    render(<Driver />);
    expect(screen.getByPlaceholderText('Search…')).toHaveValue('one');

    act(() => { fireEvent.click(screen.getByText('swap')); });
    expect(screen.getByPlaceholderText('Search…')).toHaveValue('two');
  });
});
