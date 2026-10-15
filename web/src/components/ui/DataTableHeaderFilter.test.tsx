import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { DataTableHeaderFilter } from './DataTableHeaderFilter';

describe('DataTableHeaderFilter', () => {
  it('keeps controls closed until opened and exposes active and clear behavior outside a router', () => {
    const clear = vi.fn();
    render(<DataTableHeaderFilter label="Distance" active onClear={clear}>
      <span>Canonical values</span>
    </DataTableHeaderFilter>);
    const trigger = screen.getByRole('button', { name: 'Distance filter' });
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Distance filter' })).toHaveTextContent('Canonical values');
    expect(screen.getByText('Active')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(clear).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not offer a live clear action on an unapplied filter', () => {
    render(<DataTableHeaderFilter label="Status" onClear={() => undefined}>
      <span>Loaded values</span>
    </DataTableHeaderFilter>);
    fireEvent.click(screen.getByRole('button', { name: 'Status filter' }));
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('preserves supplied filter values and callbacks across open state and active updates', () => {
    const clear = vi.fn();
    const content = <span>Operator: greater than; SI value: 0</span>;
    const { rerender } = render(
      <DataTableHeaderFilter label="Energy" active onClear={clear}>{content}</DataTableHeaderFilter>,
    );
    const trigger = screen.getByRole('button', { name: 'Energy filter' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toHaveClass('max-w-shell-panel-viewport', 'max-h-table-filter-viewport');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(clear).toHaveBeenCalledOnce();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    rerender(<DataTableHeaderFilter label="Energy" onClear={clear}>{content}</DataTableHeaderFilter>);
    expect(trigger).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('dialog')).toHaveTextContent('Operator: greater than; SI value: 0');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toHaveTextContent('Operator: greater than; SI value: 0');
  });

  it('keeps full long RTL labels and restores trigger focus on Escape without clearing', () => {
    const label = 'استهلاك الطاقة '.repeat(12).trim();
    const clear = vi.fn();
    render(<div dir="rtl"><DataTableHeaderFilter label={label} active onClear={clear}>
      <span>Retained filter</span>
    </DataTableHeaderFilter></div>);
    const trigger = screen.getByRole('button', { name: `${label} filter` });
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.getByRole('dialog', { name: `${label} filter` })).toHaveAttribute('aria-modal', 'false');
    expect(screen.getByText(`${label} filter`)).toHaveClass('break-words');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    expect(clear).not.toHaveBeenCalled();
  });

  it('keeps keyboard activation and default inactive semantics without a clear callback', async () => {
    const user = userEvent.setup();
    render(<DataTableHeaderFilter label="Status">{null}</DataTableHeaderFilter>);
    const trigger = screen.getByRole('button', { name: 'Status filter' });
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-pressed', 'false');
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Status filter' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(screen.queryByText('Active')).toBeNull();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    await user.keyboard(' ');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });
});
