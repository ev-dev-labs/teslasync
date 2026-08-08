/**
 * `<RadioCard>` primitive contract tests.
 *
 * Locks in the user-facing semantics that feature pages (e.g. the Helix
 * mode picker in AISettings) rely on:
 *   1. A real, screen-reader-visible `<input type="radio">` is the source
 *      of truth for keyboard arrow-navigation and form association.
 *   2. `onChange` reports the input's `value` string — callers never have
 *      to reach into `event.target`.
 *   3. The controlled `checked` prop drives both the DOM `checked` state
 *      and the visible accent styling.
 *   4. `disabled` fully blocks selection.
 *   5. `label`, `description`, and `icon` render (and the two optional
 *      slots are omitted when not supplied — no empty/blank nodes).
 *   6. The `accent` prop maps onto the neon token classes, and an
 *      out-of-contract accent degrades to the cyan default instead of
 *      crashing the card.
 *   7. Forwarded refs land on the `<input>`, and arbitrary input
 *      attributes (name, aria-label, data-*) pass through.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createRef } from 'react';
import { RadioCard } from './RadioCard';

afterEach(() => cleanup());

describe('RadioCard', () => {
  it('renders a real radio input carrying its accessible name', () => {
    render(
      <RadioCard
        label="Local-only"
        value="local"
        checked={false}
        onChange={() => {}}
        aria-label="Local-only mode"
      />,
    );
    const radio = screen.getByRole('radio', { name: 'Local-only mode' });
    expect(radio.tagName).toBe('INPUT');
    expect((radio as HTMLInputElement).type).toBe('radio');
    expect((radio as HTMLInputElement).value).toBe('local');
  });

  it('reflects the controlled checked prop on the underlying input', () => {
    const { rerender } = render(
      <RadioCard label="Cloud" value="cloud" checked={false} onChange={() => {}} />,
    );
    const radio = screen.getByRole('radio') as HTMLInputElement;
    expect(radio.checked).toBe(false);

    rerender(<RadioCard label="Cloud" value="cloud" checked onChange={() => {}} />);
    expect(radio.checked).toBe(true);
  });

  it('reports the input value via onChange when an unchecked card is selected', () => {
    const onChange = vi.fn();
    render(<RadioCard label="Local" value="local" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('local');
  });

  it('still reports a string (never undefined) via onChange when no value prop is set', () => {
    const onChange = vi.fn();
    render(<RadioCard label="Unnamed" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio'));
    // A valueless radio surfaces an empty string, not `undefined` — callers
    // typed against `(value: string) => void` can rely on that.
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('toggles selection when the visible label text is clicked', () => {
    const onChange = vi.fn();
    render(<RadioCard label="Pick me" value="picked" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByText('Pick me'));
    expect(onChange).toHaveBeenCalledWith('picked');
  });

  it('does not fire onChange when disabled', () => {
    const onChange = vi.fn();
    render(
      <RadioCard label="Locked" value="locked" disabled checked={false} onChange={onChange} />,
    );
    const radio = screen.getByRole('radio') as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    fireEvent.click(radio);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders the description line when provided and omits it otherwise', () => {
    const { rerender } = render(
      <RadioCard
        label="Cloud"
        value="cloud"
        description="Requires an API key"
        checked={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Requires an API key')).toBeInTheDocument();

    rerender(<RadioCard label="Cloud" value="cloud" checked={false} onChange={() => {}} />);
    expect(screen.queryByText('Requires an API key')).toBeNull();
  });

  it('renders a leading icon when provided and omits it otherwise', () => {
    const { rerender } = render(
      <RadioCard
        label="Server"
        value="local"
        icon={<svg data-testid="mode-icon" />}
        checked={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId('mode-icon')).toBeInTheDocument();

    rerender(<RadioCard label="Server" value="local" checked={false} onChange={() => {}} />);
    expect(screen.queryByTestId('mode-icon')).toBeNull();
  });

  it('applies the neon accent classes to the card only when checked', () => {
    const { rerender } = render(
      <RadioCard label="Local" value="local" accent="green" checked onChange={() => {}} />,
    );
    // The visible card is the span immediately after the sr-only input.
    const card = screen.getByRole('radio').nextElementSibling as HTMLElement;
    expect(card.className).toContain('border-neon-green/30');
    expect(card.className).toContain('bg-neon-green/10');

    rerender(
      <RadioCard label="Local" value="local" accent="green" checked={false} onChange={() => {}} />,
    );
    expect(card.className).not.toContain('border-neon-green/30');
    expect(card.className).toContain('border-[var(--border-subtle)]');
  });

  it('defaults the accent to cyan when none is supplied', () => {
    render(<RadioCard label="Default" value="d" checked onChange={() => {}} />);
    const card = screen.getByRole('radio').nextElementSibling as HTMLElement;
    expect(card.className).toContain('border-neon-cyan/30');
  });

  it('degrades an out-of-contract accent to the cyan default without crashing', () => {
    // A shared primitive must not hard-crash on a bad (untyped-caller)
    // accent — the source falls back to the cyan token map.
    expect(() =>
      render(
         
        <RadioCard label="Bad" value="b" accent={'lime' as any} checked onChange={() => {}} />,
      ),
    ).not.toThrow();
    const card = screen.getByRole('radio').nextElementSibling as HTMLElement;
    expect(card.className).toContain('border-neon-cyan/30');
  });

  it('forwards refs to the underlying input', () => {
    const ref = createRef<HTMLInputElement>();
    render(<RadioCard ref={ref} label="Ref" value="r" checked={false} onChange={() => {}} />);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('INPUT');
  });

  it('passes through arbitrary input attributes (name, data-*)', () => {
    render(
      <RadioCard
        label="Grouped"
        name="ai-mode"
        value="cloud"
        data-testid="ai-mode-cloud"
        checked={false}
        onChange={() => {}}
      />,
    );
    const radio = screen.getByTestId('ai-mode-cloud') as HTMLInputElement;
    expect(radio.name).toBe('ai-mode');
    expect(radio).toHaveAttribute('value', 'cloud');
  });
});
