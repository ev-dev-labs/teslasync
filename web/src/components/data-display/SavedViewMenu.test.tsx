/**
 * SavedViewMenu — behaviour + hardening suite.
 *
 * Exercises the full contract of the list-page "save this filter combo"
 * affordance: the trigger label, popover open/close (click, Escape, outside
 * press), the four data states of the views query (loading, error, empty,
 * populated), applying a view (onApply + popover close + SR announcement),
 * the pin / set-default toggles wired to their mutations, the rename, delete
 * and save dialog flows (including the unchanged-name no-op and the
 * disabled-Save gate), the once-only auto-apply of a default view on an
 * unfiltered URL, the applied badge + clear affordance, the manage dialog, and
 * the null-safety fallback when the hook yields no data.
 *
 * The five `useSavedViews` hooks are mocked at the module seam (the same
 * convention NotificationGroupRow.test uses) so mutation arguments can be
 * asserted directly and no network is touched. `@testing-library/user-event`
 * is not a dependency here, so interactions are driven through `fireEvent`
 * (matching EditableText / BulkActionsToolbar). react-i18next is stubbed so
 * `t(key, fallback, vars)` resolves to the fallback with `{{var}}`
 * interpolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  render,
  screen,
  within,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react';
import type { SavedView } from '@/api/types';
import {
  __resetAnnouncerForTests,
  subscribeAnnouncer,
} from '@/hooks/useAnnouncer';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
        let fallback = key;
        let vars: Record<string, unknown> | undefined;
        if (typeof fallbackOrOpts === 'string') {
          fallback = fallbackOrOpts;
          vars = opts;
        } else if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') fallback = o.defaultValue;
          vars = o;
        }
        if (vars) {
          return Object.entries(vars).reduce<string>(
            (acc, [k, v]) => acc.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v)),
            fallback,
          );
        }
        return fallback;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// Controllable stand-ins for the saved-views data + mutation hooks. Tests set
// `hooks.query.*` before rendering and inspect `hooks.*Mutate` afterwards.
const hooks = vi.hoisted(() => ({
  query: { data: undefined as SavedView[] | undefined, isLoading: false, isError: false },
  pending: { create: false, update: false, delete: false, setDefault: false },
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  deleteMutate: vi.fn(),
  setDefaultMutate: vi.fn(),
}));

vi.mock('@/api/hooks/useSavedViews', () => ({
  useSavedViews: () => hooks.query,
  useCreateSavedView: () => ({ mutate: hooks.createMutate, isPending: hooks.pending.create }),
  useUpdateSavedView: () => ({ mutate: hooks.updateMutate, isPending: hooks.pending.update }),
  useDeleteSavedView: () => ({ mutate: hooks.deleteMutate, isPending: hooks.pending.delete }),
  useSetDefaultSavedView: () => ({ mutate: hooks.setDefaultMutate, isPending: hooks.pending.setDefault }),
}));

import { SavedViewMenu, type SavedViewMenuProps } from './SavedViewMenu';

const SAVE_CURRENT = 'Save current view…';
const strip = (s: string) => s.replace(/\u200B/g, '');
type MutateOpts = { onSuccess?: () => void };

function makeView(over: Partial<SavedView> = {}): SavedView {
  return {
    id: 1,
    name: 'Recent',
    route: '/drives',
    query: 'sort=recent',
    is_default: false,
    is_pinned: false,
    sort_order: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...over,
  };
}

let announced: string[] = [];
let unsub: (() => void) | undefined;

beforeEach(() => {
  hooks.query.data = [];
  hooks.query.isLoading = false;
  hooks.query.isError = false;
  hooks.pending.create = false;
  hooks.pending.update = false;
  hooks.pending.delete = false;
  hooks.pending.setDefault = false;
  hooks.createMutate.mockReset();
  hooks.updateMutate.mockReset();
  hooks.deleteMutate.mockReset();
  hooks.setDefaultMutate.mockReset();
  // Dialog-closing mutations resolve immediately so success flows can be
  // asserted; toggles receive no options object and simply record the call.
  hooks.createMutate.mockImplementation((_v: unknown, o?: MutateOpts) => o?.onSuccess?.());
  hooks.updateMutate.mockImplementation((_v: unknown, o?: MutateOpts) => o?.onSuccess?.());
  hooks.deleteMutate.mockImplementation((_v: unknown, o?: MutateOpts) => o?.onSuccess?.());

  announced = [];
  __resetAnnouncerForTests();
  unsub = subscribeAnnouncer((msg) => {
    announced.push(strip(msg));
  });
});

afterEach(() => {
  unsub?.();
  __resetAnnouncerForTests();
  cleanup();
});

function renderMenu(props: Partial<SavedViewMenuProps> = {}) {
  const onApply = props.onApply ?? vi.fn();
  render(<SavedViewMenu route="/drives" currentQuery="" onApply={onApply} {...props} />);
  return { onApply };
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' }));
  return screen.getByRole('menu', { name: 'Saved views' });
}

describe('SavedViewMenu — trigger + popover', () => {
  it('renders a closed trigger with menu semantics and no applied badge', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Saved views' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens on click and closes on Escape', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Saved views' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Saved views' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on an outside pointer press', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Saved views' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('SavedViewMenu — query states', () => {
  it('shows the empty state with both save affordances when there are no views', () => {
    hooks.query.data = [];
    renderMenu();
    openMenu();
    expect(screen.getByText('No saved views yet')).toBeInTheDocument();
    // The empty-state CTA plus the always-present footer button.
    expect(screen.getAllByRole('button', { name: SAVE_CURRENT })).toHaveLength(2);
    // No views → no "Manage views" entry point.
    expect(screen.queryByRole('button', { name: 'Manage views' })).not.toBeInTheDocument();
  });

  it('shows a loading message (not the empty state) while the query is pending', () => {
    hooks.query.data = undefined;
    hooks.query.isLoading = true;
    renderMenu();
    openMenu();
    expect(screen.getByText('Loading saved views…')).toBeInTheDocument();
    expect(screen.queryByText('No saved views yet')).not.toBeInTheDocument();
  });

  it('shows an error alert (not the empty state) when the query fails', () => {
    hooks.query.data = undefined;
    hooks.query.isError = true;
    renderMenu();
    openMenu();
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load saved views');
    expect(screen.queryByText('No saved views yet')).not.toBeInTheDocument();
  });

  it('lists views with per-row default, pin, rename and delete controls', () => {
    hooks.query.data = [
      makeView({ id: 1, name: 'Alpha', is_default: true, is_pinned: false }),
      makeView({ id: 2, name: 'Beta', is_default: false, is_pinned: true }),
    ];
    renderMenu({ currentQuery: 'nomatch' });
    openMenu();
    expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Beta/ })).toBeInTheDocument();
    // Default toggle reflects each row's current default flag.
    expect(screen.getByRole('button', { name: 'Clear default' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set as default' })).toBeInTheDocument();
    // Pin toggle reflects each row's current pin flag.
    expect(screen.getByRole('button', { name: 'Pin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpin' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Rename view' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
  });
});

describe('SavedViewMenu — applying + clearing', () => {
  it('applies a view: fires onApply with its query, closes the popover, announces it', () => {
    hooks.query.data = [makeView({ id: 3, name: 'Recent', query: 'sort=recent' })];
    const { onApply } = renderMenu({ currentQuery: 'nomatch' });
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    expect(onApply).toHaveBeenCalledWith('sort=recent');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(announced.some((m) => m.includes('View Recent applied'))).toBe(true);
  });

  it('renders the applied badge and clears the view on dismiss', () => {
    hooks.query.data = [makeView({ id: 15, name: 'Active One', query: 'q=1' })];
    const { onApply } = renderMenu({ currentQuery: 'q=1' });
    // The trigger collapses to the active view name when the query matches.
    expect(screen.getByRole('button', { name: 'Active One' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear applied view' }));
    expect(onApply).toHaveBeenCalledWith('');
    expect(announced.some((m) => m.includes('Saved view cleared'))).toBe(true);
  });
});

describe('SavedViewMenu — pin + default toggles', () => {
  it('toggles pin through the update mutation with the negated flag', () => {
    hooks.query.data = [makeView({ id: 5, name: 'Recent', route: '/drives', is_pinned: false })];
    renderMenu({ currentQuery: 'nomatch' });
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(hooks.updateMutate).toHaveBeenCalledWith({
      id: 5,
      route: '/drives',
      patch: { is_pinned: true },
    });
  });

  it('toggles default through the set-default mutation with the negated flag', () => {
    hooks.query.data = [makeView({ id: 6, name: 'Recent', route: '/drives', is_default: false })];
    renderMenu({ currentQuery: 'nomatch' });
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Set as default' }));
    expect(hooks.setDefaultMutate).toHaveBeenCalledWith({
      id: 6,
      route: '/drives',
      isDefault: true,
    });
  });
});

describe('SavedViewMenu — rename flow', () => {
  it('opens the rename dialog seeded with the name and saves a new one', async () => {
    hooks.query.data = [makeView({ id: 7, name: 'Old name', route: '/drives' })];
    renderMenu({ currentQuery: 'nomatch' });
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Rename view' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Rename view');
    const input = within(dialog).getByRole('textbox');
    await waitFor(() => expect(input).toHaveValue('Old name'));

    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(hooks.updateMutate).toHaveBeenCalledWith(
      { id: 7, route: '/drives', patch: { name: 'New name' } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes without mutating when the name is unchanged', async () => {
    hooks.query.data = [makeView({ id: 8, name: 'Keep', route: '/drives' })];
    renderMenu({ currentQuery: 'nomatch' });
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Rename view' }));

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('textbox')).toHaveValue('Keep'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(hooks.updateMutate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('SavedViewMenu — delete flow', () => {
  it('deletes a view through the confirm dialog', async () => {
    hooks.query.data = [makeView({ id: 9, name: 'Trash me', route: '/drives' })];
    renderMenu({ currentQuery: 'nomatch' });
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Trash me');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(hooks.deleteMutate).toHaveBeenCalledWith(
      { id: 9, route: '/drives' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('cancels deletion without mutating', async () => {
    hooks.query.data = [makeView({ id: 10, name: 'Safe', route: '/drives' })];
    renderMenu({ currentQuery: 'nomatch' });
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(hooks.deleteMutate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('SavedViewMenu — save flow', () => {
  it('saves the current query as a new view, honoring the make-default checkbox', async () => {
    hooks.query.data = [makeView({ id: 11, name: 'Existing', query: 'x=1' })];
    renderMenu({ currentQuery: 'status=active' });
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: SAVE_CURRENT }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(SAVE_CURRENT);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'My View' } });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(hooks.createMutate).toHaveBeenCalledWith(
      { name: 'My View', route: '/drives', query: 'status=active', is_default: true },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('disables Save until a non-whitespace name is entered', () => {
    hooks.query.data = [makeView({ id: 12, name: 'Existing' })];
    renderMenu({ currentQuery: 'nomatch' });
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: SAVE_CURRENT }));

    const dialog = screen.getByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    const input = within(dialog).getByRole('textbox');
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Named' } });
    expect(save).toBeEnabled();
    expect(hooks.createMutate).not.toHaveBeenCalled();
  });
});

describe('SavedViewMenu — auto-apply default', () => {
  it('auto-applies the default view exactly once on an unfiltered URL', () => {
    hooks.query.data = [
      makeView({ id: 13, name: 'Default', query: 'preset=default', is_default: true }),
    ];
    const onApply = vi.fn();
    const { rerender } = render(
      <SavedViewMenu route="/drives" currentQuery="" onApply={onApply} />,
    );
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('preset=default');
    rerender(<SavedViewMenu route="/drives" currentQuery="" onApply={onApply} />);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('does not auto-apply the default when the URL already carries a query', () => {
    hooks.query.data = [
      makeView({ id: 14, name: 'Default', query: 'preset=default', is_default: true }),
    ];
    const onApply = vi.fn();
    render(<SavedViewMenu route="/drives" currentQuery="already=1" onApply={onApply} />);
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('SavedViewMenu — manage dialog + null safety', () => {
  it('opens the manage dialog and routes a row action to the update mutation', () => {
    hooks.query.data = [
      makeView({ id: 1, name: 'Alpha', route: '/drives', is_pinned: false }),
      makeView({ id: 2, name: 'Beta', route: '/drives', is_pinned: true }),
    ];
    renderMenu({ currentQuery: 'nomatch' });
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Manage views' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Manage views');
    expect(within(dialog).getByRole('button', { name: /Alpha/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Beta/ })).toBeInTheDocument();

    // Alpha is unpinned → its toggle reads "Pin" and routes through update.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pin' }));
    expect(hooks.updateMutate).toHaveBeenCalledWith({
      id: 1,
      route: '/drives',
      patch: { is_pinned: true },
    });
  });

  it('renders safely and shows the empty state when the hook returns no data', () => {
    hooks.query.data = undefined;
    renderMenu();
    expect(screen.getByRole('button', { name: 'Saved views' })).toBeInTheDocument();
    openMenu();
    expect(screen.getByText('No saved views yet')).toBeInTheDocument();
  });
});
