import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { BulkActionToolbar } from '../BulkActionToolbar';

describe('BulkActionToolbar (alias)', () => {
  it('renders nothing when no items are selected', () => {
    const { container } = render(
      <BulkActionToolbar
        selectedIds={[]}
        onClear={() => {}}
        actions={[
          {
            id: 'noop',
            label: 'Noop',
            onClick: async () => {},
          },
        ]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the count label and exposes a toolbar landmark', () => {
    render(
      <BulkActionToolbar
        selectedIds={[1, 2, 3]}
        total={10}
        onClear={() => {}}
        actions={[]}
      />,
    );

    // role="region" with the bulk-actions a11y label is the landmark.
    expect(
      screen.getByRole('region', { name: /bulk actions/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
  });

  it('invokes the action onClick with the current selection', () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    render(
      <BulkActionToolbar
        selectedIds={[7, 9]}
        onClear={() => {}}
        actions={[
          {
            id: 'mark-read',
            label: 'Mark read',
            onClick: handle,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /mark read/i }));
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith([7, 9]);
  });

  it('Clear button calls onClear', () => {
    const onClear = vi.fn();
    render(
      <BulkActionToolbar
        selectedIds={[1]}
        onClear={onClear}
        actions={[]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
