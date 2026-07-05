import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bookmark,
  BookmarkCheck,
  Pin,
  PinOff,
  Star,
  Pencil,
  Trash2,
  Plus,
  X,
} from 'lucide-react';
import { Button, Input, Modal, Badge, ConfirmDialog } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { useAnnouncer } from '@/hooks/useAnnouncer';
import {
  useSavedViews,
  useCreateSavedView,
  useUpdateSavedView,
  useDeleteSavedView,
  useSetDefaultSavedView,
} from '@/api/hooks/useSavedViews';
import type { SavedView } from '@/api/types';

/**
 * List-page affordance for "save this filter combo
 * and recall it later".
 *
 * Renders THREE coordinated UI elements as one piece:
 *   1. A trigger button that opens the popover. The label collapses to the
 *      active view name when the current querystring exactly matches a
 *      saved view.
 *   2. The popover itself: pinned views first, then unpinned. Each row
 *      offers pin / default / rename / delete actions and a click target
 *      that re-applies the view's querystring via `onApply`.
 *   3. A small badge (`{t('View')}: {name} ✕`) when a saved view is
 *      currently applied — clicking the X clears the URL back to the
 *      unfiltered route.
 *
 * Behaviour notes:
 *   On mount, when the URL has no querystring AND a default view exists
 *     for this route, the default is auto-applied exactly once. A ref
 *     guards against re-applying after the user clears it manually.
 *   The popover closes on outside click, on Escape, when a view is
 *     applied, and when the rename or delete flow is launched (each of
 *     those opens its own dialog). Pin and set-default intentionally
 *     keep the popover open so several can be toggled in a row and the
 *     list can visibly reorder.
 */
export interface SavedViewMenuProps {
  /** The SPA pathname this menu manages views for (e.g. '/drives'). */
  route: string;
  /**
   * The current canonical querystring for the page (no leading '?').
   * Pages compute this from useSearchParams() — see the page adoption
   * comments in DrivesListPage etc.
   */
  currentQuery: string;
  /**
   * Apply a saved view's querystring to the URL. The empty string clears
   * the URL back to the unfiltered route. Pages typically wire this to
   * setSearchParams() with the view's `query` value.
   */
  onApply: (query: string) => void;
  /** Optional className for the wrapping flex container. */
  className?: string;
}

export function SavedViewMenu({
  route,
  currentQuery,
  onApply,
  className,
}: SavedViewMenuProps) {
  const { t } = useTranslation();
  const { data: viewsRaw, isLoading, isError } = useSavedViews(route);
  const createMut = useCreateSavedView();
  const updateMut = useUpdateSavedView();
  const deleteMut = useDeleteSavedView();
  const setDefaultMut = useSetDefaultSavedView();

  const views = useMemo(() => viewsRaw ?? [], [viewsRaw]);
  const activeView = useMemo(
    () => views.find((v) => v.query === currentQuery) ?? null,
    [views, currentQuery],
  );
  const defaultView = useMemo(() => views.find((v) => v.is_default) ?? null, [views]);

  // -- Auto-apply default on first mount when URL has no querystring --
  // The ref guard ensures back-navigation that clears the URL doesn't
  // re-trigger the auto-apply (which would create an infinite loop with
  // the user's "clear filters" intent).
  const autoAppliedRef = useRef(false);
  useEffect(() => {
    if (autoAppliedRef.current) return;
    if (!defaultView) return;
    if (currentQuery !== '') {
      // The URL already has filters — mark as "applied" so we never
      // overwrite the user's deep-link.
      autoAppliedRef.current = true;
      return;
    }
    autoAppliedRef.current = true;
    onApply(defaultView.query);
  }, [defaultView, currentQuery, onApply]);

  // -- Popover state --
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // -- Save / rename / delete dialogs --
  const [saveOpen, setSaveOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SavedView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedView | null>(null);

  // -- Handlers --
  const { announce } = useAnnouncer();
  const handleApply = (view: SavedView) => {
    onApply(view.query);
    setOpen(false);
    announce(
      t('savedViews.announceApplied', 'View {{name}} applied', { name: view.name }),
    );
  };

  const handleClear = () => {
    onApply('');
    announce(t('savedViews.announceCleared', 'Saved view cleared'));
  };

  const handleTogglePin = (view: SavedView) => {
    updateMut.mutate({
      id: view.id,
      route: view.route,
      patch: { is_pinned: !view.is_pinned },
    });
  };

  const handleToggleDefault = (view: SavedView) => {
    setDefaultMut.mutate({
      id: view.id,
      route: view.route,
      isDefault: !view.is_default,
    });
  };

  const triggerLabel = activeView
    ? activeView.name
    : t('savedViews.title', 'Saved views');

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div ref={containerRef} className="relative inline-block">
        <Button
          variant={activeView ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {activeView ? (
            <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span className="ml-1.5 max-w-[12rem] truncate">{triggerLabel}</span>
        </Button>

        {open && (
          <div
            role="menu"
            aria-label={t('savedViews.title', 'Saved views')}
            className={cn(
              'absolute right-0 z-30 mt-1 w-72 rounded-lg p-2',
              'border border-white/[0.08] bg-[var(--surface-elevated)] shadow-xl',
            )}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-2xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                {t('savedViews.title', 'Saved views')}
              </span>
              {views.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setManageOpen(true);
                  }}
                  className="text-2xs font-medium text-cyan-300 hover:text-cyan-200 focus-visible:outline-none focus-visible:underline"
                >
                  {t('savedViews.manage', 'Manage views')}
                </button>
              )}
            </div>

            {isError ? (
              <div
                role="alert"
                className="px-1 py-6 text-center text-sm text-[var(--text-secondary)]"
              >
                {t('savedViews.error', 'Unable to load saved views')}
              </div>
            ) : isLoading && views.length === 0 ? (
              <div className="px-1 py-6 text-center text-sm text-[var(--text-muted)]">
                {t('savedViews.loading', 'Loading saved views…')}
              </div>
            ) : views.length === 0 ? (
              <div className="py-3">
                <EmptyState
                  message={t('savedViews.empty', 'No saved views yet')}
                  action={{
                    label: t('savedViews.saveCurrent', 'Save current view…'),
                    onClick: () => {
                      setOpen(false);
                      setSaveOpen(true);
                    },
                  }}
                />
              </div>
            ) : (
              <ul className="max-h-72 space-y-0.5 overflow-y-auto">
                {views.map((v) => {
                  const isActive = v.query === currentQuery;
                  return (
                    <li key={v.id}>
                      <div
                        className={cn(
                          'group flex items-center gap-1 rounded px-2 py-1.5',
                          'hover:bg-white/[0.04]',
                          isActive && 'bg-white/[0.06]',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => handleApply(v)}
                          className={cn(
                            'flex-1 truncate text-left text-sm',
                            isActive
                              ? 'text-[var(--text-primary)]'
                              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                          )}
                          title={v.name}
                        >
                          {v.is_default && (
                            <Star
                              className="mr-1 inline h-3 w-3 text-amber-300"
                              aria-label={t('savedViews.defaultBadge', 'Default')}
                            />
                          )}
                          {v.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleDefault(v)}
                          className="rounded p-1.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:text-amber-300 group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={
                            v.is_default
                              ? t('savedViews.unsetDefault', 'Clear default')
                              : t('savedViews.setDefault', 'Set as default')
                          }
                        >
                          <Star className={cn('h-3.5 w-3.5', v.is_default && 'fill-amber-300 text-amber-300')} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTogglePin(v)}
                          className="rounded p-1.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:text-cyan-300 group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={v.is_pinned ? t('savedViews.unpin', 'Unpin') : t('savedViews.pin', 'Pin')}
                        >
                          {v.is_pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenameTarget(v);
                            setOpen(false);
                          }}
                          className="rounded p-1.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={t('savedViews.renamePrompt', 'Rename view')}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteTarget(v);
                            setOpen(false);
                          }}
                          className="rounded p-1.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:text-rose-300 group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={t('common.delete', 'Delete')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-2 flex items-center justify-between border-t border-white/[0.06] pt-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSaveOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-cyan-300 hover:text-cyan-200 focus-visible:outline-none focus-visible:underline"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('savedViews.saveCurrent', 'Save current view…')}
              </button>
            </div>
          </div>
        )}
      </div>

      {activeView && (
        <Badge variant="info" size="sm">
          <span className="mr-1">{t('savedViews.appliedBadge', 'View')}:</span>
          <span className="max-w-[12rem] truncate">{activeView.name}</span>
          <button
            type="button"
            onClick={handleClear}
            className="touch-target-overlay ml-1.5 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500"
            aria-label={t('savedViews.clearApplied', 'Clear applied view')}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}

      <SavedViewSaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSave={(name, makeDefault) => {
          createMut.mutate(
            {
              name,
              route,
              query: currentQuery,
              is_default: makeDefault,
            },
            {
              onSuccess: () => setSaveOpen(false),
            },
          );
        }}
        saving={createMut.isPending}
      />

      <SavedViewRenameDialog
        view={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRename={(view, name) => {
          updateMut.mutate(
            { id: view.id, route: view.route, patch: { name } },
            { onSuccess: () => setRenameTarget(null) },
          );
        }}
        saving={updateMut.isPending}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        title={t('savedViews.deleteTitle', 'Delete saved view')}
        message={t('savedViews.deleteConfirm', 'Delete saved view "{{name}}"?', {
          name: deleteTarget?.name ?? '',
        })}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="danger"
        loading={deleteMut.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMut.mutate(
            { id: deleteTarget.id, route: deleteTarget.route },
            { onSuccess: () => setDeleteTarget(null) },
          );
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <SavedViewManageDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        views={views}
        onApply={(v) => {
          handleApply(v);
          setManageOpen(false);
        }}
        onTogglePin={handleTogglePin}
        onToggleDefault={handleToggleDefault}
        onRename={(v) => setRenameTarget(v)}
        onDelete={(v) => setDeleteTarget(v)}
        currentQuery={currentQuery}
      />
    </div>
  );
}

// ── Save dialog ────────────────────────────────────────────────────────────

interface SavedViewSaveDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, makeDefault: boolean) => void;
  saving: boolean;
}

function SavedViewSaveDialog({ open, onClose, onSave, saving }: SavedViewSaveDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);

  // Reset on open so a previous abort doesn't leak state into the next
  // save flow.
  useEffect(() => {
    if (open) {
      setName('');
      setMakeDefault(false);
    }
  }, [open]);

  const trimmed = name.trim();
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    onSave(trimmed, makeDefault);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('savedViews.saveCurrent', 'Save current view…')}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('savedViews.namePlaceholder', 'View name')}
          maxLength={80}
          autoFocus
          label={t('savedViews.name', 'Name')}
        />
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={makeDefault}
            onChange={(e) => setMakeDefault(e.target.checked)}
            className="rounded border-[var(--border-strong)] bg-[var(--surface-2)] text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
          />
          {t('savedViews.makeDefault', 'Apply automatically when I open this page')}
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button size="sm" type="submit" disabled={!trimmed || saving}>
            {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Rename dialog ──────────────────────────────────────────────────────────

interface SavedViewRenameDialogProps {
  view: SavedView | null;
  onClose: () => void;
  onRename: (view: SavedView, name: string) => void;
  saving: boolean;
}

function SavedViewRenameDialog({ view, onClose, onRename, saving }: SavedViewRenameDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');

  useEffect(() => {
    if (view) setName(view.name);
  }, [view]);

  const trimmed = name.trim();
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!view || !trimmed || trimmed === view.name) {
      onClose();
      return;
    }
    onRename(view, trimmed);
  };

  return (
    <Modal
      open={view != null}
      onClose={onClose}
      title={t('savedViews.renamePrompt', 'Rename view')}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('savedViews.namePlaceholder', 'View name')}
          maxLength={80}
          autoFocus
          label={t('savedViews.name', 'Name')}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button size="sm" type="submit" disabled={!trimmed || saving}>
            {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Manage dialog ──────────────────────────────────────────────────────────

interface SavedViewManageDialogProps {
  open: boolean;
  onClose: () => void;
  views: SavedView[];
  currentQuery: string;
  onApply: (view: SavedView) => void;
  onTogglePin: (view: SavedView) => void;
  onToggleDefault: (view: SavedView) => void;
  onRename: (view: SavedView) => void;
  onDelete: (view: SavedView) => void;
}

function SavedViewManageDialog({
  open,
  onClose,
  views,
  currentQuery,
  onApply,
  onTogglePin,
  onToggleDefault,
  onRename,
  onDelete,
}: SavedViewManageDialogProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('savedViews.manage', 'Manage views')}
      size="md"
    >
      {views.length === 0 ? (
        <EmptyState message={t('savedViews.empty', 'No saved views yet')} />
      ) : (
        <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
          {views.map((v) => {
            const isActive = v.query === currentQuery;
            return (
              <li
                key={v.id}
                className={cn(
                  'flex items-center gap-2 rounded border border-white/[0.06] bg-white/[0.02] px-3 py-2',
                  isActive && 'border-cyan-400/30 bg-cyan-500/5',
                )}
              >
                <button
                  type="button"
                  onClick={() => onApply(v)}
                  className="flex-1 truncate text-left text-sm text-[var(--text-primary)] hover:text-cyan-300"
                  title={v.query || t('savedViews.emptyQuery', 'No filters')}
                >
                  {v.is_default && (
                    <Star className="mr-1 inline h-3 w-3 text-amber-300" aria-hidden="true" />
                  )}
                  {v.name}
                </button>
                <button
                  type="button"
                  onClick={() => onToggleDefault(v)}
                  className="rounded p-1 text-[var(--text-muted)] hover:text-amber-300"
                  aria-label={
                    v.is_default
                      ? t('savedViews.unsetDefault', 'Clear default')
                      : t('savedViews.setDefault', 'Set as default')
                  }
                >
                  <Star className={cn('h-4 w-4', v.is_default && 'fill-amber-300 text-amber-300')} />
                </button>
                <button
                  type="button"
                  onClick={() => onTogglePin(v)}
                  className="rounded p-1.5 text-[var(--text-muted)] hover:text-cyan-300"
                  aria-label={v.is_pinned ? t('savedViews.unpin', 'Unpin') : t('savedViews.pin', 'Pin')}
                >
                  {v.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => onRename(v)}
                  className="rounded p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  aria-label={t('savedViews.renamePrompt', 'Rename view')}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(v)}
                  className="rounded p-1.5 text-[var(--text-muted)] hover:text-rose-300"
                  aria-label={t('common.delete', 'Delete')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex justify-end pt-3">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('common.close', 'Close')}
        </Button>
      </div>
    </Modal>
  );
}
