/**
 * ActiveFilterChips — Phase-46 / Prompt 06 unit tests.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@/i18n';
import { ActiveFilterChips, type FilterChipDescriptor } from '../ActiveFilterChips';

function chip(
  key: string,
  label: string,
  value: string,
  onRemove: () => void,
): FilterChipDescriptor {
  return { key, label, value, onRemove };
}

describe('ActiveFilterChips', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders one chip per descriptor', () => {
    const noop = vi.fn();
    render(
      <ActiveFilterChips
        filters={[
          chip('vehicle_id', 'Vehicle', 'Model 3', noop),
          chip('state', 'State', 'charging', noop),
          chip('range', 'Date', 'last 7 days', noop),
        ]}
      />,
    );
    const group = screen.getByRole('group', { name: /active filters/i });
    expect(within(group).getByText('Vehicle:')).toBeInTheDocument();
    expect(within(group).getByText('Model 3')).toBeInTheDocument();
    expect(within(group).getByText('State:')).toBeInTheDocument();
    expect(within(group).getByText('charging')).toBeInTheDocument();
    expect(within(group).getByText('Date:')).toBeInTheDocument();
    expect(within(group).getByText('last 7 days')).toBeInTheDocument();
  });

  it('clicking the X invokes onRemove exactly once', () => {
    const onRemoveA = vi.fn();
    const onRemoveB = vi.fn();
    render(
      <ActiveFilterChips
        filters={[
          chip('vehicle_id', 'Vehicle', 'Model 3', onRemoveA),
          chip('state', 'State', 'charging', onRemoveB),
        ]}
      />,
    );
    const removeButtons = screen.getAllByRole('button', { name: /remove filter/i });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]);
    expect(onRemoveA).toHaveBeenCalledTimes(1);
    expect(onRemoveB).not.toHaveBeenCalled();
    fireEvent.click(removeButtons[1]);
    expect(onRemoveB).toHaveBeenCalledTimes(1);
  });

  it('Backspace on the X also removes the filter', () => {
    const onRemove = vi.fn();
    render(
      <ActiveFilterChips
        filters={[chip('vehicle_id', 'Vehicle', 'Model 3', onRemove)]}
      />,
    );
    const btn = screen.getByRole('button', { name: /remove filter/i });
    fireEvent.keyDown(btn, { key: 'Backspace' });
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('clicking "Clear all" invokes onClearAll exactly once', () => {
    const onClearAll = vi.fn();
    render(
      <ActiveFilterChips
        filters={[
          chip('vehicle_id', 'Vehicle', 'Model 3', vi.fn()),
          chip('state', 'State', 'charging', vi.fn()),
        ]}
        onClearAll={onClearAll}
      />,
    );
    const clearAll = screen.getByRole('button', { name: /clear all/i });
    fireEvent.click(clearAll);
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('omits "Clear all" when prop is missing', () => {
    render(
      <ActiveFilterChips
        filters={[chip('vehicle_id', 'Vehicle', 'Model 3', vi.fn())]}
      />,
    );
    expect(screen.queryByRole('button', { name: /clear all/i })).toBeNull();
  });

  it('omits "Clear all" when there are no chips', () => {
    render(
      <ActiveFilterChips
        filters={[]}
        onClearAll={vi.fn()}
        hideWhenEmpty={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /clear all/i })).toBeNull();
  });

  it('renders maxVisible-1 chips inline plus "+N more" trigger when over the cap', () => {
    const filters = Array.from({ length: 5 }, (_, i) =>
      chip(`k${i}`, `Label${i}`, `Value${i}`, vi.fn()),
    );
    render(<ActiveFilterChips filters={filters} maxVisible={2} />);
    // visibleCount = max(0, maxVisible - 1) = 1 inline chip + 4 collapsed.
    expect(screen.getByText('Label0:')).toBeInTheDocument();
    expect(screen.queryByText('Label1:')).toBeNull();
    const more = screen.getByRole('button', { name: /\+4 more/i });
    expect(more).toBeInTheDocument();

    fireEvent.click(more);
    const popover = screen.getByRole('menu', { name: /additional active filters/i });
    expect(within(popover).getByText('Label1:')).toBeInTheDocument();
    expect(within(popover).getByText('Label4:')).toBeInTheDocument();
  });

  it('clicking a chip X inside the overflow popover invokes its onRemove', () => {
    const onRemoveOverflow = vi.fn();
    const filters = [
      chip('k0', 'L0', 'V0', vi.fn()),
      chip('k1', 'L1', 'V1', vi.fn()),
      chip('k2', 'L2', 'V2', onRemoveOverflow),
    ];
    render(<ActiveFilterChips filters={filters} maxVisible={2} />);
    fireEvent.click(screen.getByRole('button', { name: /\+2 more/i }));
    const popover = screen.getByRole('menu', { name: /additional active filters/i });
    const removeBtn = within(popover).getByRole('button', { name: /remove filter L2/i });
    fireEvent.click(removeBtn);
    expect(onRemoveOverflow).toHaveBeenCalledTimes(1);
  });

  it('returns null when filters are empty and hideWhenEmpty is true (default)', () => {
    const { container } = render(<ActiveFilterChips filters={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the empty group when hideWhenEmpty=false', () => {
    render(<ActiveFilterChips filters={[]} hideWhenEmpty={false} />);
    expect(screen.getByRole('group', { name: /active filters/i })).toBeInTheDocument();
  });

  it('exposes a polite live region for removal announcements', () => {
    const onRemove = vi.fn();
    render(
      <ActiveFilterChips
        filters={[chip('vehicle_id', 'Vehicle', 'Model 3', onRemove)]}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    // Initially empty, then populated after a removal.
    expect(status.textContent ?? '').toBe('');
    fireEvent.click(screen.getByRole('button', { name: /remove filter Vehicle/i }));
    expect(status.textContent ?? '').toContain('Filter removed');
    expect(status.textContent ?? '').toContain('Vehicle');
  });

  it('announces "All filters cleared" when clear-all is invoked', () => {
    render(
      <ActiveFilterChips
        filters={[chip('vehicle_id', 'Vehicle', 'Model 3', vi.fn())]}
        onClearAll={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
    const status = screen.getByRole('status');
    expect(status.textContent ?? '').toContain('All filters cleared');
  });

  it('falls back gracefully when maxVisible <= 0 (everything goes overflow)', () => {
    const filters = [
      chip('k0', 'L0', 'V0', vi.fn()),
      chip('k1', 'L1', 'V1', vi.fn()),
    ];
    render(<ActiveFilterChips filters={filters} maxVisible={0} />);
    // No inline chips — only the "+N more" trigger.
    expect(screen.queryByText('L0:')).toBeNull();
    expect(screen.getByRole('button', { name: /\+2 more/i })).toBeInTheDocument();
  });
});
