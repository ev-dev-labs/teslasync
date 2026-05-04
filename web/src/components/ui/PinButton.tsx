import { useTranslation } from 'react-i18next';
import { Pin, PinOff } from 'lucide-react';

import { cn } from '@/lib/cn';
import { usePinned, useTogglePin } from '@/api/hooks/usePinned';
import type { PinnedItemType } from '@/api/types';
import { Tooltip } from './Tooltip';

/**
 * Phase 40 / Prompt 48 — shared "pin" affordance.
 *
 * Renders a focusable icon-only button that toggles the user's pin state for
 * a single item. It composes the unified `usePinned` query so any open
 * surface (vehicle picker, alerts list, dashboard widgets, …) re-orders
 * pinned-first the moment a pin is added or removed.
 *
 * Backed by `pinned_items` (migration 000162) — survives a fresh browser
 * profile, syncs across devices, and replaces ad-hoc localStorage stores.
 */
export interface PinButtonProps {
  /** Domain bucket — drives both the API call and the cache key. */
  itemType: PinnedItemType;
  /** Stable identifier for the row being pinned. Coerced to string. */
  itemId: string | number;
  /** Optional sub-surface scope (e.g. dashboardId for widget pins). */
  context?: string;
  /** Icon size. `sm` = compact list/table cell, `md` = card header. */
  size?: 'sm' | 'md';
  /** When true, render "Pin"/"Pinned" next to the icon. */
  showLabel?: boolean;
  /** Extra classes for the trigger button. */
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<PinButtonProps['size']>, string> = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-8 w-8 text-sm',
};

const ICON_CLASS: Record<NonNullable<PinButtonProps['size']>, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
};

export function PinButton({
  itemType,
  itemId,
  context,
  size = 'sm',
  showLabel = false,
  className,
}: PinButtonProps) {
  const { t } = useTranslation();
  const { data: pinned = [] } = usePinned(itemType, context);
  const toggle = useTogglePin(itemType);

  const idStr = String(itemId);
  const isPinned = pinned.some(p => String(p.item_id) === idStr);

  const Icon = isPinned ? PinOff : Pin;
  const tooltipLabel = isPinned
    ? t('pin.unpin', { defaultValue: 'Unpin' })
    : t('pin.pin', { defaultValue: 'Pin' });

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Pin buttons are routinely placed inside row cards / list items that
    // navigate on click. Stop propagation so toggling the pin doesn't also
    // trigger the row's onClick handler.
    e.stopPropagation();
    e.preventDefault();
    if (toggle.isPending) return;
    toggle.mutate({ itemId: idStr, context, pin: !isPinned });
  };

  return (
    <Tooltip content={tooltipLabel}>
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={isPinned}
        aria-label={tooltipLabel}
        disabled={toggle.isPending}
        data-testid="pin-button"
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded-md transition-colors',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-secondary)]',
          'disabled:opacity-60 disabled:cursor-not-allowed',
          showLabel ? 'px-2' : SIZE_CLASS[size],
          isPinned
            ? 'text-amber-300 hover:text-amber-200 hover:bg-amber-500/10'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]',
          className,
        )}
      >
        <Icon className={ICON_CLASS[size]} aria-hidden />
        {showLabel && (
          <span className="text-xs font-medium">
            {isPinned
              ? t('pin.pinned', { defaultValue: 'Pinned' })
              : t('pin.pin', { defaultValue: 'Pin' })}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
