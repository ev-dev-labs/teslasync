/**
 * BulkActionsToolbar — behaviour + hardening suite.
 *
 * Covers the toolbar's full contract: render-gating on empty selection, the
 * count / noun / total labels, action ordering, the non-confirm vs
 * confirm-routed onClick paths, per-action busy state, the disabled gate, the
 * failure path (a rejected action must not blank the toolbar, lose the
 * selection, or leak an unhandled rejection), and the null-safety fallbacks.
 *
 * `import '@/i18n'` boots the real i18n bundle so `t(key, { defaultValue })`
 * resolves through the shipped English strings (mirrors the sibling
 * BulkActionToolbar alias suite) — no react-i18next mock, no network. `fireEvent`
 * is the repo's interaction primitive (user-event is not a dependency).
 */

import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import '@/i18n';
import { BulkActionsToolbar, type BulkAction } from './BulkActionsToolbar';

const noop = () => {};

function renderToolbar(props: Partial<ComponentProps<typeof BulkActionsToolbar>> = {}) {
  const merged: ComponentProps<typeof BulkActionsToolbar> = {
    selectedIds: [1, 2, 3],
    onClear: noop,
    actions: [],
    ...props,
  };
  return render(<BulkActionsToolbar {...merged} />);
}

describe('BulkActionsToolbar — render gating', () => {
  it('renders nothing when the selection is empty', () => {
    const { container } = renderToolbar({ selectedIds: [] });
    expect(container.firstChild).toBeNull();
  });

  it('renders a labelled region and live count once something is selected', () => {
    renderToolbar({ selectedIds: [1, 2, 3] });
    const region = screen.getByRole('region', { name: /bulk actions/i });
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent('3 selected');
  });
});

describe('BulkActionsToolbar — noun + total labels', () => {
  it('shows a singular noun and no total when one item is selected', () => {
    renderToolbar({ selectedIds: [1], itemNoun: { one: 'drive', other: 'drives' } });
    const region = screen.getByRole('region', { name: /bulk actions/i });
    expect(region).toHaveTextContent('1 selected');
    expect(region).toHaveTextContent('drive');
    expect(region).not.toHaveTextContent('drives');
  });

  it('shows the plural noun and the "of N" total when many are selected', () => {
    renderToolbar({
      selectedIds: [1, 2],
      total: 10,
      itemNoun: { one: 'drive', other: 'drives' },
    });
    const region = screen.getByRole('region', { name: /bulk actions/i });
    expect(region).toHaveTextContent('2 selected');
    expect(region).toHaveTextContent('drives');
    expect(region).toHaveTextContent('of 10');
  });

  it('omits the noun/total row entirely when itemNoun is absent', () => {
    renderToolbar({ selectedIds: [1, 2], total: 10 });
    const region = screen.getByRole('region', { name: /bulk actions/i });
    // The "of {{total}}" fragment lives inside the itemNoun block — without a
    // noun it must not appear.
    expect(region).not.toHaveTextContent('of 10');
    expect(region).toHaveTextContent('2 selected');
  });
});

describe('BulkActionsToolbar — actions', () => {
  it('renders one button per action in array order plus a Clear button', () => {
    const actions: BulkAction[] = [
      { id: 'archive', label: 'Archive', onClick: vi.fn().mockResolvedValue(undefined) },
      { id: 'delete', label: 'Delete', onClick: vi.fn().mockResolvedValue(undefined) },
    ];
    const { container } = renderToolbar({ selectedIds: [1], actions });

    const order = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-bulk-action]'),
    ).map((b) => b.getAttribute('data-bulk-action'));
    expect(order).toEqual(['archive', 'delete', 'clear']);
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('invokes a non-confirm action with the current selection and opens no dialog', async () => {
    const onClick = vi.fn().mockResolvedValue(undefined);
    renderToolbar({
      selectedIds: [7, 9],
      actions: [{ id: 'mark-read', label: 'Mark read', onClick }],
    });

    fireEvent.click(screen.getByRole('button', { name: /mark read/i }));

    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
    expect(onClick).toHaveBeenCalledWith([7, 9]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onClear when the Clear button is pressed', () => {
    const onClear = vi.fn();
    renderToolbar({ selectedIds: [1], onClear, actions: [] });

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('marks a disabled action as disabled and never invokes its onClick', () => {
    const onClick = vi.fn().mockResolvedValue(undefined);
    renderToolbar({
      selectedIds: [1],
      actions: [{ id: 'export', label: 'Export', disabled: true, onClick }],
    });

    const btn = screen.getByRole('button', { name: /export/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('BulkActionsToolbar — busy state', () => {
  it('shows a per-action busy state while the mutation is in flight, then re-enables', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onClick = vi.fn(() => gate);
    renderToolbar({
      selectedIds: [1],
      actions: [{ id: 'sync', label: 'Sync', onClick }],
    });

    fireEvent.click(screen.getByRole('button', { name: /sync/i }));

    const busy = screen.getByRole('button', { name: /sync/i });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      release();
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /sync/i })).not.toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: /sync/i })).not.toHaveAttribute('aria-busy');
  });
});

describe('BulkActionsToolbar — confirm routing', () => {
  const confirmAction = (onClick: BulkAction['onClick']): BulkAction => ({
    id: 'delete',
    label: 'Delete selected',
    variant: 'danger',
    confirm: {
      title: 'Delete drives?',
      description: 'This will permanently delete the selected drives.',
      confirmLabel: 'Confirm delete',
    },
    onClick,
  });

  it('routes through the ConfirmDialog and only fires onClick after confirmation', async () => {
    const onClick = vi.fn().mockResolvedValue(undefined);
    renderToolbar({ selectedIds: [1, 2, 3], actions: [confirmAction(onClick)] });

    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));

    // The confirmation dialog is now open and onClick has NOT fired yet.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('This will permanently delete the selected drives.');
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
    expect(onClick).toHaveBeenCalledWith([1, 2, 3]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not fire onClick when the confirmation is cancelled', async () => {
    const onClick = vi.fn().mockResolvedValue(undefined);
    renderToolbar({ selectedIds: [1], actions: [confirmAction(onClick)] });

    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('BulkActionsToolbar — failure path', () => {
  it('keeps the selection intact and clears busy state when an action rejects', async () => {
    const onClear = vi.fn();
    const onClick = vi.fn().mockRejectedValue(new Error('boom'));
    renderToolbar({
      selectedIds: [4],
      onClear,
      actions: [{ id: 'delete', label: 'Delete', onClick }],
    });

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    // The rejection is swallowed by the toolbar: the button recovers from the
    // busy state, the selection is left intact (no onClear), and no unhandled
    // rejection escapes.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /delete/i })).not.toBeDisabled(),
    );
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: /bulk actions/i })).toBeInTheDocument();
  });
});

describe('BulkActionsToolbar — null safety', () => {
  it('renders nothing (no crash) when selectedIds is undefined', () => {
    const { container } = render(
      <BulkActionsToolbar
        selectedIds={undefined as unknown as Array<string | number>}
        onClear={noop}
        actions={[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('still renders the toolbar with only Clear when actions is undefined', () => {
    render(
      <BulkActionsToolbar
        selectedIds={[1]}
        onClear={noop}
        actions={undefined as unknown as BulkAction[]}
      />,
    );
    expect(screen.getByRole('region', { name: /bulk actions/i })).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(/clear/i);
  });
});
