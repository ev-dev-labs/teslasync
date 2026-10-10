import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TIME_MACHINE_OPEN_PICKER_EVENT } from '../../feedback/TimeMachineBanner';
import { OperationalModeSegment } from './OperationalModeSegment';

const { modeMock } = vi.hoisted(() => ({ modeMock: vi.fn() }));

vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => modeMock(),
}));

describe('OperationalModeSegment', () => {
  it('shows Now rather than a third indistinguishable Live label and opens the time picker', () => {
    modeMock.mockReturnValue({
      mode: 'live',
      label: 'Live',
      description: 'Current data with live actions available.',
    });
    const onOpen = vi.fn();
    window.addEventListener(TIME_MACHINE_OPEN_PICKER_EVENT, onOpen, { once: true });
    render(<OperationalModeSegment />);
    const control = screen.getByRole('button', { name: 'Current data with live actions available.' });
    expect(control).toHaveTextContent('Now');
    expect(control).not.toHaveTextContent('Live');
    expect(control.querySelector('svg')?.getAttribute('class')).toContain('lucide-clock');
    fireEvent.click(control);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('retains the distinct cached and historical mode labels', () => {
    modeMock.mockReturnValue({
      mode: 'cached',
      label: 'Cached',
      description: 'Offline data',
    });
    const { rerender } = render(<OperationalModeSegment />);
    expect(screen.getByRole('button', { name: 'Offline data' })).toHaveTextContent('Cached');
    modeMock.mockReturnValue({
      mode: 'as_of',
      label: 'As of Tuesday',
      description: 'Historical data',
    });
    rerender(<OperationalModeSegment />);
    expect(screen.getByRole('button', { name: 'Historical data' })).toHaveTextContent('As of Tuesday');
  });

  it.each([
    ['live', 'success', 'clock'],
    ['cached', 'warning', 'database'],
    ['as_of', 'info', 'history'],
  ])('uses existing restrained roles without changing %s classification', (mode, tone, glyph) => {
    modeMock.mockReturnValue({ mode, label: 'Mode label', description: 'Source description' });
    render(<OperationalModeSegment />);
    const control = screen.getByRole('button', { name: 'Source description' });
    expect(control.className).toContain(`text-[var(--semantic-${tone})]`);
    expect(control.querySelector('span[aria-hidden="true"]')?.className)
      .toContain(`bg-[var(--semantic-${tone})]`);
    expect(control.querySelector('svg')?.getAttribute('class')).toContain(`lucide-${glyph}`);
    expect(control.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(control).toHaveAttribute('type', 'button');
  });

  it('preserves the full long RTL source label and focus in icon-only mode', () => {
    const label = 'As of الثلاثاء '.repeat(20);
    const description = 'Retained historical source description';
    modeMock.mockReturnValue({ mode: 'as_of', label, description });
    const { rerender } = render(<OperationalModeSegment />);
    const control = screen.getByRole('button', { name: description });
    expect(control).toHaveTextContent(label.trim());
    expect(control.className).toContain('focus-visible:outline');
    control.focus();
    expect(control).toHaveFocus();
    rerender(<OperationalModeSegment iconOnly />);
    expect(screen.getByRole('button', { name: description })).toBe(control);
    expect(control).toHaveFocus();
    expect(control).not.toHaveTextContent(label.trim());
    expect(control.querySelector('svg')?.getAttribute('class')).toContain('lucide-history');
    expect(control).not.toBeDisabled();
  });
});
