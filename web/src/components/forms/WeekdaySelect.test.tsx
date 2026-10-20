import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WeekdaySelect, type WeekdaySelectOption } from './WeekdaySelect';

const options: readonly WeekdaySelectOption[] = Object.freeze([
  Object.freeze({ id: 5, label: 'Fr', ariaLabel: 'Freitag' }),
  Object.freeze({ id: 1, label: 'Mo', ariaLabel: 'Montag' }),
  Object.freeze({ id: 0, label: 'So', ariaLabel: 'Sonntag' }),
]);
const ariaLabel = 'Wochentage';

describe('WeekdaySelect', () => {
  it('renders options in caller order with localized full accessible names', () => {
    render(<WeekdaySelect options={options} selectedIds={[]} onChange={vi.fn()} ariaLabel={ariaLabel} />);
    const buttons = within(screen.getByRole('group', { name: ariaLabel })).getAllByRole('button');
    expect(buttons.map(button => button.textContent)).toEqual(['Fr', 'Mo', 'So']);
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual(['Freitag', 'Montag', 'Sonntag']);
  });

  it('treats empty selection literally as no pressed buttons without emitting a default', () => {
    const onChange = vi.fn();
    render(<WeekdaySelect options={options} selectedIds={[]} onChange={onChange} ariaLabel={ariaLabel} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Montag' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([1]);
  });

  it('renders explicit subset and all selections without inferring business rules', () => {
    const { rerender } = render(
      <WeekdaySelect options={options} selectedIds={[1]} onChange={vi.fn()} ariaLabel={ariaLabel} />,
    );
    expect(screen.getByRole('button', { name: 'Montag' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Freitag' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Sonntag' })).toHaveAttribute('aria-pressed', 'false');
    rerender(<WeekdaySelect options={options} selectedIds={[0, 5, 1]} onChange={vi.fn()} ariaLabel={ariaLabel} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('appends additions without mutating props or sorting existing selection', () => {
    const selectedIds = Object.freeze([0, 5]);
    const onChange = vi.fn();
    render(<WeekdaySelect options={options} selectedIds={selectedIds} onChange={onChange} ariaLabel={ariaLabel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Montag' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([0, 5, 1]);
    expect(onChange.mock.calls[0][0]).not.toBe(selectedIds);
    expect(selectedIds).toEqual([0, 5]);
    expect(options.map(option => option.id)).toEqual([5, 1, 0]);
  });

  it('removes only the displayed selected ID and preserves remaining selection order', () => {
    const selectedIds = Object.freeze([0, 5, 1]);
    const onChange = vi.fn();
    render(<WeekdaySelect options={options} selectedIds={selectedIds} onChange={onChange} ariaLabel={ariaLabel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Freitag' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([0, 1]);
    expect(onChange.mock.calls[0][0]).not.toBe(selectedIds);
    expect(selectedIds).toEqual([0, 5, 1]);
  });

  it('retains unrelated IDs and their order when adding or removing a displayed option', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <WeekdaySelect options={options} selectedIds={[99, 0, 42]} onChange={onChange} ariaLabel={ariaLabel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Freitag' }));
    expect(onChange).toHaveBeenLastCalledWith([99, 0, 42, 5]);
    rerender(
      <WeekdaySelect options={options} selectedIds={[99, 0, 42, 5]} onChange={onChange} ariaLabel={ariaLabel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sonntag' }));
    expect(onChange).toHaveBeenLastCalledWith([99, 42, 5]);
  });

  it('allows removing the last explicit selected day to produce an empty selection', () => {
    const onChange = vi.fn();
    render(<WeekdaySelect options={options} selectedIds={[1]} onChange={onChange} ariaLabel={ariaLabel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Montag' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('disables every native button when the group is disabled', () => {
    const onChange = vi.fn();
    render(<WeekdaySelect options={options} selectedIds={[5]} onChange={onChange} ariaLabel={ariaLabel} disabled />);
    expect(screen.getByRole('group')).toHaveAttribute('aria-disabled', 'true');
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(screen.getByRole('button', { name: 'Freitag' })).toHaveAttribute('aria-pressed', 'true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables only the specified option while preserving its pressed state', () => {
    const onChange = vi.fn();
    const disabledOptions = options.map(option => ({ ...option, disabled: option.id === 5 }));
    render(<WeekdaySelect options={disabledOptions} selectedIds={[5]} onChange={onChange} ariaLabel={ariaLabel} />);
    const friday = screen.getByRole('button', { name: 'Freitag' });
    expect(friday).toBeDisabled();
    expect(friday).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group')).not.toHaveAttribute('aria-disabled');
    fireEvent.click(friday);
    expect(onChange).not.toHaveBeenCalled();
    const monday = screen.getByRole('button', { name: 'Montag' });
    expect(monday).not.toBeDisabled();
    fireEvent.click(monday);
    expect(onChange).toHaveBeenCalledExactlyOnceWith([5, 1]);
  });

  it('uses type button and never submits an enclosing form', () => {
    const onSubmit = vi.fn(event => event.preventDefault());
    const onChange = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <WeekdaySelect options={options} selectedIds={[]} onChange={onChange} ariaLabel={ariaLabel} />
      </form>,
    );
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('type', 'button');
      fireEvent.click(button);
    }
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('changes pressed state only after a controlled parent rerender', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <WeekdaySelect options={options} selectedIds={[]} onChange={onChange} ariaLabel={ariaLabel} />,
    );
    const monday = screen.getByRole('button', { name: 'Montag' });
    fireEvent.click(monday);
    expect(onChange).toHaveBeenLastCalledWith([1]);
    expect(monday).toHaveAttribute('aria-pressed', 'false');
    rerender(<WeekdaySelect options={options} selectedIds={[1]} onChange={onChange} ariaLabel={ariaLabel} />);
    expect(monday).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(monday);
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(monday).toHaveAttribute('aria-pressed', 'true');
    rerender(<WeekdaySelect options={options} selectedIds={[]} onChange={onChange} ariaLabel={ariaLabel} />);
    expect(monday).toHaveAttribute('aria-pressed', 'false');
  });

  it('preserves long ReactNode labels with wrapping and minimum 44px target classes', () => {
    const label = 'Ein sehr langer lokalisierter Wochentagsname ohne Kürzung';
    render(
      <WeekdaySelect
        options={[{ id: 1, label: <strong>{label}</strong>, ariaLabel: label }]}
        selectedIds={[1]} onChange={vi.fn()} ariaLabel={ariaLabel} className="mt-2"
      />,
    );
    expect(screen.getByRole('group')).toHaveClass('flex', 'flex-wrap', 'min-w-0', 'mt-2');
    const button = screen.getByRole('button', { name: label });
    expect(button).toHaveTextContent(label);
    expect(button).toHaveClass('h-auto', 'min-h-11', 'min-w-11', 'max-w-full', 'whitespace-normal');
    expect(button.querySelector('span')).toHaveClass('min-w-0', '[overflow-wrap:anywhere]');
    expect(button.className).not.toMatch(/truncate|line-clamp|whitespace-nowrap/);
    expect(button).toHaveClass('bg-[var(--theme-primary)]', 'text-[var(--theme-on-primary)]');
  });

  it('inherits RTL direction without reversing caller option order', () => {
    render(
      <div dir="rtl">
        <WeekdaySelect options={options} selectedIds={[]} onChange={vi.fn()} ariaLabel={ariaLabel} />
      </div>,
    );
    const group = screen.getByRole('group');
    expect(group.closest('[dir]')).toHaveAttribute('dir', 'rtl');
    expect(group).not.toHaveAttribute('dir');
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Fr', 'Mo', 'So']);
  });

  it('retains native focus and keyboard attributes rather than tab or radio semantics', () => {
    render(<WeekdaySelect options={options} selectedIds={[]} onChange={vi.fn()} ariaLabel={ariaLabel} />);
    const button = screen.getByRole('button', { name: 'Montag' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).not.toHaveAttribute('role');
    expect(button).not.toHaveAttribute('tabindex');
    expect(button).not.toHaveAttribute('aria-checked');
    expect(button).toHaveClass(
      'focus-visible:outline',
      'focus-visible:outline-2',
      'focus-visible:outline-offset-2',
      'focus-visible:outline-[var(--focus-ring)]',
      'forced-colors:focus-visible:outline-[Highlight]',
    );
    button.focus();
    expect(button).toHaveFocus();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('keeps an empty option group literal without generating days or changing selection', () => {
    const onChange = vi.fn();
    render(<WeekdaySelect options={[]} selectedIds={[99]} onChange={onChange} ariaLabel={ariaLabel} />);
    expect(screen.getByRole('group', { name: ariaLabel })).toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
