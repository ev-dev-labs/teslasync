import { fireEvent, render, screen } from '@testing-library/react';
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
});
