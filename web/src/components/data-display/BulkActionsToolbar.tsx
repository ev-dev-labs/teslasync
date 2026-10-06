import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Text } from '@/components/ui/Typography';
import { useConfirm } from '@/hooks/useConfirm';
import { cn } from '@/lib/cn';

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
  /** Already-localized, visible explanation associated with a disabled action. */
  disabledReason?: string;
}

export interface BulkActionsToolbarProps {
  /** Currently selected row identifiers. */
  selectedIds: Array<string | number>;
  /** Caller-known total visible rows. Omit or pass null when unknown; never inferred. */
  total?: number | null;
  /**
   * Already-localized summary replacing the default count/noun/total display.
   * Caller owns scope wording and known denominators (e.g. selected loaded
   * rows vs filtered results); this never changes the IDs passed to actions.
   */
  selectionSummary?: ReactNode;
  /**
   * Caller-described presentation metadata only, not a select-all operation.
   * `all-matching` requires caller-owned selection/mutation semantics; the
   * toolbar neither discovers matching IDs nor infers a result count.
   */
  selectionScope?: 'selected' | 'loaded' | 'filtered' | 'all-matching';
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
  selectionSummary,
  selectionScope,
  onClear,
  actions,
  itemNoun,
  className,
}: BulkActionsToolbarProps) {
  const { t } = useTranslation();
  const { confirm, dialogProps } = useConfirm();
  const toolbarId = useId();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const [canStick, setCanStick] = useState(true);

  // Null-safety: these are typed as required, but defend against an
  // `undefined` selection / action list at runtime so a stray value never
  // throws on `.length` / `.map` and blanks the whole page.
  const ids = selectedIds ?? EMPTY_IDS;
  const items = actions ?? EMPTY_ACTIONS;

  const count = ids.length;
  const hasSelection = count > 0;

  // Oversized sticky bars obscure their results and cannot expose all actions.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () => setCanStick(panel.getBoundingClientRect().height < window.innerHeight);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(panel);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [hasSelection]);

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
        ref={panelRef}
        className={cn('z-30 mb-3 flex flex-wrap items-center gap-3 px-4 py-3', canStick && 'sticky top-0', className)}
        role="region"
        aria-label={t('bulk.toolbarLabel', 'Bulk actions for selected items')}
        data-selection-scope={selectionScope}
      >
        <div className="flex min-w-0 max-w-full items-center gap-2 text-sm text-[var(--text-primary)]">
          <span
            className="inline-flex min-w-0 max-w-full items-center justify-center break-words rounded-full bg-[var(--surface-3)] px-2 py-0.5 font-semibold text-[var(--text-primary)]"
            aria-live="polite"
          >
            {selectionSummary ?? countLabel}
          </span>
          {selectionSummary == null && itemNoun && (
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

        <div className="ms-auto flex min-w-0 max-w-full flex-wrap items-center gap-2">
          {items.map((action) => {
            const reason = action.disabled ? action.disabledReason : undefined;
            const reasonId = `${toolbarId}-${encodeURIComponent(action.id)}-disabled-reason`;
            return (
              <div key={action.id} className="flex min-w-0 max-w-full flex-col gap-1">
                <Button
                  variant={action.variant === 'danger' ? 'danger' : 'secondary'}
                  size="sm"
                  wrapLabel
                  icon={action.icon}
                  loading={Boolean(pending[action.id])}
                  disabled={action.disabled || Boolean(pending[action.id])}
                  aria-describedby={reason ? reasonId : undefined}
                  onClick={() => {
                    void runAction(action);
                  }}
                  data-bulk-action={action.id}
                >
                  {action.label}
                </Button>
                {reason && (
                  <Text id={reasonId} variant="bodySm" className="max-w-xs">
                    {reason}
                  </Text>
                )}
              </div>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            wrapLabel
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
