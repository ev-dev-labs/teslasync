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
import { afterEach, describe, it, expect, vi } from 'vitest';
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

describe('BulkActionsToolbar — viewport containment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps long labels, disabled reasons and Clear in the wrapping mobile action rail', () => {
    const label = 'Export only the selected loaded records with their complete metadata';
    const reason = 'Read-only access prevents changing the selected loaded records.';
    renderToolbar({
      actions: [
        { id: 'export', label, onClick: vi.fn().mockResolvedValue(undefined) },
        { id: 'delete', label: 'Delete selected', disabled: true, disabledReason: reason, onClick: vi.fn() },
      ],
    });
    const action = screen.getByRole('button', { name: label });
    expect(action).toBeVisible();
    expect(action).toHaveClass('min-h-11', 'whitespace-normal');
    expect(action.parentElement).toHaveClass('w-full', 'min-w-0', 'md:w-auto');
    expect(action.parentElement?.parentElement).toHaveClass('flex-wrap', 'w-full');
    expect(screen.getByRole('button', { name: 'Delete selected' })).toHaveAccessibleDescription(reason);
    expect(screen.getByRole('button', { name: /clear/i })).toHaveClass('w-full', 'min-h-11');
  });

  it('keeps oversized actions in flow and restores sticky positioning when they fit', () => {
    let height = window.innerHeight + 20;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, 320, height),
    );
    const { rerender } = renderToolbar({ selectedIds: [] });
    rerender(<BulkActionsToolbar selectedIds={[1]} onClear={noop} actions={[]} />);
    const region = screen.getByRole('region', { name: /bulk actions/i });
    expect(region).not.toHaveClass('sticky');
    height = window.innerHeight / 2;
    act(() => window.dispatchEvent(new Event('resize')));
    expect(region).toHaveClass('sticky', 'top-0');
  });

  it('remeasures content changes and disconnects its observer on unmount', () => {
    let height = window.innerHeight / 2;
    let resize = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, 320, height),
    );
    const { unmount } = renderToolbar();
    const region = screen.getByRole('region', { name: /bulk actions/i });
    expect(region).toHaveClass('sticky');
    expect(observe).toHaveBeenCalledWith(region);
    height = window.innerHeight + 20;
    act(() => resize());
    expect(region).not.toHaveClass('sticky');
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

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

  it('clears once on toolbar Escape without changing focus or consuming other keys', () => {
    const onClear = vi.fn();
    renderToolbar({ onClear });
    const button = screen.getByRole('button', { name: /clear/i });
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onClear).not.toHaveBeenCalled();
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(onClear).toHaveBeenCalledOnce();
    expect(button).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClear).toHaveBeenCalledOnce();
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

describe('BulkActionsToolbar — caller-described selection', () => {
  it('keeps a caller-measured zero denominator distinct from unknown', () => {
    renderToolbar({
      selectedIds: ['row-0'],
      total: 0,
      itemNoun: { one: 'drive', other: 'drives' },
    });
    expect(screen.getByRole('region')).toHaveTextContent('of 0');
  });

  it.each([
    ['loaded', '2 of 8 loaded notifications selected'],
    ['filtered', '2 of 6 filtered automations selected'],
  ] as const)('renders the explicit %s summary instead of the legacy count/noun/total', (scope, summary) => {
    renderToolbar({
      selectedIds: [1, 2],
      total: 100,
      itemNoun: { one: 'item', other: 'items' },
      selectionScope: scope,
      selectionSummary: summary,
    });

    const region = screen.getByRole('region', { name: /bulk actions/i });
    expect(region).toHaveAttribute('data-selection-scope', scope);
    expect(region).toHaveTextContent(summary);
    expect(region).not.toHaveTextContent('of 100');
    expect(region).not.toHaveTextContent('2 selected');
    expect(screen.getByText(summary)).toHaveAttribute('aria-live', 'polite');
  });

  it.each([undefined, null])('does not invent a denominator when total is %s', (total) => {
    renderToolbar({
      selectedIds: [1, 2],
      total,
      selectionScope: 'loaded',
      itemNoun: { one: 'notification', other: 'notifications' },
    });

    const region = screen.getByRole('region', { name: /bulk actions/i });
    expect(region).toHaveTextContent('2 selected');
    expect(region).toHaveTextContent('notifications');
    expect(region).not.toHaveTextContent(/\bof\b/);
    expect(region).not.toHaveTextContent('of 2');
  });

  it('renders caller-localized structured content for an unknown filtered total', () => {
    renderToolbar({
      selectedIds: [1, 2],
      total: null,
      selectionScope: 'filtered',
      selectionSummary: <span>2 sélectionnés · nombre de résultats filtrés inconnu</span>,
    });

    const region = screen.getByRole('region', { name: /bulk actions/i });
    expect(region).toHaveTextContent('2 sélectionnés · nombre de résultats filtrés inconnu');
    expect(region).not.toHaveTextContent('2 selected');
    expect(region).not.toHaveTextContent(/\bof\b/);
  });

  it('treats all-matching scope as metadata and passes only caller-owned IDs to actions', async () => {
    const onClick = vi.fn().mockResolvedValue(undefined);
    renderToolbar({
      selectedIds: [7, 9],
      selectionScope: 'all-matching',
      selectionSummary: 'Selection managed by the caller; matching total unknown',
      actions: [{ id: 'archive', label: 'Archive', onClick }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(onClick).toHaveBeenCalledWith([7, 9]));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region')).toHaveAttribute('data-selection-scope', 'all-matching');
    expect(screen.getByRole('region')).not.toHaveTextContent('All items selected');
  });

  it('still renders nothing for an empty selection with an explicit summary', () => {
    const { container } = renderToolbar({
      selectedIds: [],
      selectionScope: 'all-matching',
      selectionSummary: 'Caller-owned summary',
    });
    expect(container.firstChild).toBeNull();
  });
});

describe('BulkActionsToolbar — accessible disabled reasons', () => {
  it('visibly associates a localized read-only reason with the actual disabled action', () => {
    const onClick = vi.fn().mockResolvedValue(undefined);
    const reason = 'Lecture seule : les modifications ne sont pas disponibles.';
    renderToolbar({
      actions: [{ id: 'enable', label: 'Activer', disabled: true, disabledReason: reason, onClick }],
    });

    const button = screen.getByRole('button', { name: 'Activer' });
    const explanation = screen.getByText(reason);
    expect(button).toBeDisabled();
    expect(explanation).toBeVisible();
    expect(button).toHaveAttribute('aria-describedby', explanation.id);
    expect(button).toHaveAccessibleDescription(reason);
    expect(button).not.toHaveAttribute('title');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps reason identity stable across localized labels and action reordering', () => {
    const onClick = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderToolbar({
      actions: [
        { id: 'enable', label: 'Enable', disabled: true, disabledReason: 'Read-only mode', onClick },
        { id: 'delete', label: 'Delete', disabled: true, disabledReason: 'Deletion unavailable', onClick },
      ],
    });
    const enableId = screen.getByRole('button', { name: 'Enable' }).getAttribute('aria-describedby');
    const deleteId = screen.getByRole('button', { name: 'Delete' }).getAttribute('aria-describedby');
    expect(enableId).toBeTruthy();
    expect(deleteId).toBeTruthy();
    expect(enableId).not.toBe(deleteId);

    rerender(
      <BulkActionsToolbar
        selectedIds={[1]}
        onClear={noop}
        actions={[
          { id: 'delete', label: 'Supprimer', disabled: true, disabledReason: 'Suppression indisponible', onClick },
          { id: 'enable', label: 'Activer', disabled: true, disabledReason: 'Mode lecture seule', onClick },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Activer' })).toHaveAttribute('aria-describedby', enableId);
    expect(screen.getByRole('button', { name: 'Activer' })).toHaveAccessibleDescription('Mode lecture seule');
    expect(screen.getByRole('button', { name: 'Supprimer' })).toHaveAttribute('aria-describedby', deleteId);
  });

  it('uses distinct reason IDs for identical actions in separate toolbar instances', () => {
    const actions: BulkAction[] = [{
      id: 'export selected',
      label: 'Export',
      disabled: true,
      disabledReason: 'Read-only mode',
      onClick: vi.fn().mockResolvedValue(undefined),
    }];
    renderToolbar({ actions });
    renderToolbar({ actions });

    const buttons = screen.getAllByRole('button', { name: 'Export' });
    const ids = buttons.map((button) => button.getAttribute('aria-describedby'));
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
    for (const button of buttons) {
      expect(button).toHaveAccessibleDescription('Read-only mode');
      expect(button.getAttribute('aria-describedby')).not.toMatch(/\s/);
    }
  });

  it('removes the explanation and association when the caller enables the action', () => {
    const onClick = vi.fn().mockResolvedValue(undefined);
    const action: BulkAction = {
      id: 'export',
      label: 'Export',
      disabled: true,
      disabledReason: 'Read-only mode',
      onClick,
    };
    const { rerender } = renderToolbar({ actions: [action] });
    expect(screen.getByRole('button', { name: 'Export' })).toHaveAccessibleDescription('Read-only mode');

    rerender(
      <BulkActionsToolbar selectedIds={[1]} onClear={noop} actions={[{ ...action, disabled: false }]} />,
    );
    expect(screen.getByRole('button', { name: 'Export' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export' })).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText('Read-only mode')).not.toBeInTheDocument();
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

  it('gives confirmation Escape precedence over clearing and restores trigger focus', async () => {
    const onClear = vi.fn();
    const onClick = vi.fn().mockResolvedValue(undefined);
    renderToolbar({ onClear, actions: [confirmAction(onClick)] });
    const trigger = screen.getByRole('button', { name: 'Delete selected' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onClear).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('region')).toHaveTextContent('3 selected');
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('preserves confirmation and per-action pending semantics with an explicit scoped summary', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onClick = vi.fn(() => gate);
    renderToolbar({
      selectedIds: [7, 9],
      selectionScope: 'loaded',
      selectionSummary: '2 loaded drives selected; total unknown',
      actions: [confirmAction(onClick)],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
    await screen.findByRole('dialog');
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete selected' })).not.toHaveAttribute('aria-busy');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(onClick).toHaveBeenCalledWith([7, 9]));
    const button = screen.getByRole('button', { name: 'Delete selected' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region')).toHaveTextContent('2 loaded drives selected; total unknown');

    await act(async () => {
      release();
    });
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).not.toHaveAttribute('aria-busy');
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
