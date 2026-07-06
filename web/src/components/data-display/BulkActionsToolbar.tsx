import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, GlassPanel } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';

/**
 * Shared bulk-action toolbar.
 *
 * Renders a sticky bar at the top of a list-page content area when one or
 * more rows/cards are selected. Each `BulkAction` may declare a
 * `confirm` payload that routes its onClick through the shared
 * `<ConfirmDialog>` before mutating, satisfying the
 * destructive-action contract.
 *
 * Per-action loading state is local to the toolbar so the page does not
 * need to wire a separate `pending` flag for each action — it just
 * returns a `Promise` from `onClick`.
 *
 * Keyboard:
 *   `Escape` clears the selection (handled by the consumer).
 *
 * The toolbar renders nothing when `selectedIds.length === 0` so consumers
 * can always mount it unconditionally.
 */

export interface BulkAction {
  /** Stable id used as React key and for action telemetry. */
  id: string;
  /** Already-translated button label. */
  label: string;
  /** Optional leading icon (lucide). */
  icon?: ReactNode;
  /** Visual intent. `danger` switches the underlying Button variant. */
  variant?: 'default' | 'danger';
  /** When provided, route the onClick through `<ConfirmDialog>` first. */
  confirm?: {
    title: string;
    description: string;
    confirmLabel?: string;
  };
  /**
   * Invoked with the current selection. Should resolve when the mutation
   * completes; toolbar uses the returned Promise to drive a per-action
   * spinner. Throwing leaves the selection intact so the user can retry.
   */
  onClick: (selectedIds: Array<string | number>) => Promise<void>;
  /** Disable the action regardless of selection (e.g., feature gate). */
  disabled?: boolean;
}

export interface BulkActionsToolbarProps {
  /** Currently selected row identifiers. */
  selectedIds: Array<string | number>;
  /** Total visible rows — used by the count label, e.g. "3 selected of 27". */
  total?: number;
  /** Clears the selection. Wired to the "Clear" button + Escape key. */
  onClear: () => void;
  /** Per-page action definitions, rendered in array order. */
  actions: BulkAction[];
  /** Optional override for the count noun (e.g., "drive(s)"). */
  itemNoun?: { one: string; other: string };
  /** Extra classes for the wrapper (rare). */
  className?: string;
}

// Stable empty fallbacks so the null-safe defaults below don't hand
// `runAction` (or the render map) a fresh array identity on every render
// when a consumer omits the prop. Never mutated.
const EMPTY_IDS: Array<string | number> = [];
const EMPTY_ACTIONS: BulkAction[] = [];

export function BulkActionsToolbar({
  selectedIds,
  total,
  onClear,
  actions,
  itemNoun,
  className,
}: BulkActionsToolbarProps) {
  const { t } = useTranslation();
  const { confirm, dialogProps } = useConfirm();
  const [pending, setPending] = useState<Record<string, boolean>>({});

  // Null-safety: these are typed as required, but defend against an
  // `undefined` selection / action list at runtime so a stray value never
  // throws on `.length` / `.map` and blanks the whole page.
  const ids = selectedIds ?? EMPTY_IDS;
  const items = actions ?? EMPTY_ACTIONS;

  const count = ids.length;

  const noun = itemNoun
    ? count === 1
      ? itemNoun.one
      : itemNoun.other
    : t('bulk.itemDefault', { count, defaultValue: 'item' });

  const runAction = useCallback(
    async (action: BulkAction) => {
      if (pending[action.id]) return;

      if (action.confirm) {
        const ok = await confirm({
          title: action.confirm.title,
          message: action.confirm.description,
          confirmLabel: action.confirm.confirmLabel,
          variant: action.variant === 'danger' ? 'danger' : 'warning',
        });
        if (!ok) return;
      }

      setPending((prev) => ({ ...prev, [action.id]: true }));
      try {
        await action.onClick(ids);
      } catch {
        // The consumer's onClick surfaces its own failure (toast / mutation
        // error state); the toolbar only owns the per-action spinner, reset
        // in `finally`. Swallow here so a rejected action never escapes as an
        // unhandled promise rejection, and leave the selection intact so the
        // user can retry.
      } finally {
        setPending((prev) => {
          const next = { ...prev };
          delete next[action.id];
          return next;
        });
      }
    },
    [confirm, pending, ids],
  );

  if (count === 0) return null;

  const countLabel = t('bulk.selected', {
    count,
    defaultValue: '{{count}} selected',
  });

  return (
    <>
      <GlassPanel
        className={`sticky top-0 z-30 mb-3 flex flex-wrap items-center gap-3 px-4 py-3 ${className ?? ''}`}
        role="region"
        aria-label={t('bulk.toolbarLabel', 'Bulk actions for selected items')}
      >
        <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
          <span
            className="inline-flex items-center justify-center rounded-full bg-blue-500/15 px-2 py-0.5 font-semibold text-blue-200"
            aria-live="polite"
          >
            {countLabel}
          </span>
          {itemNoun && (
            <span className="text-[var(--text-secondary)]">
              {noun}
              {typeof total === 'number' && (
                <>
                  {' '}
                  <span className="text-[var(--text-muted)]">
                    {t('bulk.ofTotal', { total, defaultValue: 'of {{total}}' })}
                  </span>
                </>
              )}
            </span>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {items.map((action) => (
            <Button
              key={action.id}
              variant={action.variant === 'danger' ? 'danger' : 'secondary'}
              size="sm"
              icon={action.icon}
              loading={Boolean(pending[action.id])}
              disabled={action.disabled || Boolean(pending[action.id])}
              onClick={() => {
                void runAction(action);
              }}
              data-bulk-action={action.id}
            >
              {action.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            data-bulk-action="clear"
          >
            {t('bulk.clear', 'Clear selection')}
          </Button>
        </div>
      </GlassPanel>
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </>
  );
}
