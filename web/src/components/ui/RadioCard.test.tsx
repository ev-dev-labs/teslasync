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
 *   6. The `accent` prop maps onto restrained checked-indicator roles, and an
 *      out-of-contract accent degrades to the cyan default instead of
 *      crashing the card.
 *   7. Forwarded refs land on the `<input>`, and arbitrary input
 *      attributes (name, aria-label, data-*) pass through.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createRef } from 'react';
import userEvent from '@testing-library/user-event';
import { RadioCard, type RadioCardProps } from './RadioCard';

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

  it('applies accent identity only to the checked indicator, keeping card chrome neutral', () => {
    const { rerender } = render(
      <RadioCard label="Local" value="local" accent="green" checked onChange={() => {}} />,
    );
    // The visible card is the span immediately after the sr-only input.
    const card = screen.getByRole('radio').nextElementSibling as HTMLElement;
    expect(card.className).toContain('border-[var(--control-border-hover)]');
    expect(card.className).toContain('bg-[var(--control-bg)]');
    expect(card.firstElementChild).toHaveClass('text-[var(--semantic-success)]');
    expect(card.firstElementChild?.firstElementChild).toHaveClass('bg-[var(--semantic-success)]');

    rerender(
      <RadioCard label="Local" value="local" accent="green" checked={false} onChange={() => {}} />,
    );
    expect(card.firstElementChild).not.toHaveClass('text-[var(--semantic-success)]');
    expect(card.firstElementChild?.firstElementChild).toHaveClass('bg-transparent');
    expect(card.className).toContain('border-[var(--control-border)]');
  });

  it('defaults the accent to cyan when none is supplied', () => {
    render(<RadioCard label="Default" value="d" checked onChange={() => {}} />);
    const card = screen.getByRole('radio').nextElementSibling as HTMLElement;
    expect(card.firstElementChild).toHaveClass('text-[var(--semantic-info)]');
  });

  it('degrades an out-of-contract accent to the cyan default without crashing', () => {
    // A shared primitive must not hard-crash on a bad (untyped-caller)
    // accent — the source falls back to the cyan token map.
    const props: RadioCardProps = { label: 'Bad', value: 'b', accent: 'cyan', checked: true, onChange: () => {} };
    Reflect.set(props, 'accent', 'lime');
    expect(() =>
      render(
        <RadioCard {...props} />,
      ),
    ).not.toThrow();
    const card = screen.getByRole('radio').nextElementSibling as HTMLElement;
    expect(card.firstElementChild).toHaveClass('text-[var(--semantic-info)]');
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

  it('associates descriptions with the native input without dropping external help', () => {
    render(<RadioCard id="choice" label="Choice" description="Details" aria-describedby="external-help" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('radio')).toHaveAttribute('aria-describedby', 'external-help choice-description');
    expect(screen.getByText('Details')).toHaveAttribute('id', 'choice-description');
    expect(screen.getByRole('radio').closest('label')).toHaveAttribute('for', 'choice');
  });

  it('retains unique implicit IDs and native keyboard radio selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<>
      <RadioCard label="First" name="keyboard-mode" value="first" checked onChange={onChange} />
      <RadioCard label="Second" name="keyboard-mode" value="second" checked={false} onChange={onChange} />
    </>);
    const first = screen.getByRole<HTMLInputElement>('radio', { name: 'First' });
    const second = screen.getByRole<HTMLInputElement>('radio', { name: 'Second' });
    expect(first.id).not.toBe(second.id);
    await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(second).toHaveFocus();
    expect(onChange).toHaveBeenCalledWith('second');
    expect(first).toBeChecked();
    expect(second).not.toBeChecked();
  });

  it('keeps disabled labels inert and removes hover chrome while retaining focus and system-color roles', () => {
    const onChange = vi.fn();
    render(<RadioCard label="Disabled choice" disabled checked onChange={onChange} className="caller-class" />);
    const radio = screen.getByRole('radio');
    const card = radio.nextElementSibling;
    fireEvent.click(screen.getByText('Disabled choice'));
    expect(onChange).not.toHaveBeenCalled();
    expect(radio.closest('label')).toHaveClass('caller-class', 'cursor-not-allowed');
    expect(card).not.toHaveClass('hover:bg-[var(--control-bg-hover)]');
    expect(card).toHaveClass('peer-focus-visible:outline-offset-2', 'peer-focus-visible:outline-[var(--focus-ring)]', 'motion-reduce:transition-none', 'forced-colors:bg-[ButtonFace]');
    expect(card?.firstElementChild?.firstElementChild).toHaveClass('forced-colors:bg-[ButtonText]');
  });
});
