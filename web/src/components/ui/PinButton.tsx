import { useTranslation } from 'react-i18next';
import { Pin, PinOff } from 'lucide-react';

import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { usePinned, useTogglePin } from '@/api/hooks/usePinned';
import type { PinnedItemType } from '@/api/types';
import { Button } from './Button';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

/**
 * Shared "pin" affordance.
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
  /** Caller-owned localized name, for example identifying the vehicle. */
  ariaLabel?: string;
  /** Opt in to a 44px target without changing compact consumers. */
  minTargetSize?: 44;
}

const SIZE_CLASS: Record<NonNullable<PinButtonProps['size']>, string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
};

export function PinButton({
  itemType,
  itemId,
  context,
  size = 'sm',
  showLabel = false,
  className,
  ariaLabel,
  minTargetSize,
}: PinButtonProps) {
  const { t } = useTranslation();
  const pins = usePinned(itemType, context);
  const pinned = pins.data ?? [];
  const toggle = useTogglePin(itemType);
  const unknown = pins.data === undefined;
  const busy = toggle.isPending || (unknown && pins.isPending);

  const idStr = String(itemId);
  const isPinned = pinned.some(p => String(p.item_id) === idStr);

  const actionLabel = isPinned
    ? t('pin.unpin', { defaultValue: 'Unpin' })
    : t('pin.pin', { defaultValue: 'Pin' });
  const tooltipLabel = unknown
    ? pins.isError
      ? t('common.retry', { defaultValue: 'Retry' })
      : t('common.loading', { defaultValue: 'Loading...' })
    : toggle.isError
      ? isPinned
        ? t('toast.pin.unpinned.error', { defaultValue: 'Failed to unpin' })
        : t('toast.pin.pinned.error', { defaultValue: 'Failed to pin' })
      : actionLabel;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Pin buttons are routinely placed inside row cards / list items that
    // navigate on click. Stop propagation so toggling the pin doesn't also
    // trigger the row's onClick handler.
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    if (unknown) {
      void pins.refetch();
      return;
    }
    toggle.mutate({ itemId: idStr, context, pin: !isPinned });
  };

  return (
    <Tooltip content={
      !unknown && pins.isError ? (
        <>
          {tooltipLabel}
          <span className="block">{t('common.unavailable', { defaultValue: 'Unavailable' })}</span>
        </>
      ) : tooltipLabel
    } multiline>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={handleClick}
        aria-pressed={unknown ? undefined : isPinned}
        aria-label={ariaLabel ?? (unknown ? tooltipLabel : actionLabel)}
        aria-busy={busy || undefined}
        disabled={busy}
        data-testid="pin-button"
        className={cn(
          'gap-1.5 px-0',
          showLabel ? 'h-auto min-h-7 max-w-full px-2 py-1 whitespace-normal' : SIZE_CLASS[size],
          size === 'sm' ? typography.size.xs : typography.size.sm,
          minTargetSize === 44 && 'min-h-11 min-w-11',
          isPinned
            ? 'bg-[var(--surface-2)] text-[var(--text-primary)] hover:bg-[var(--surface-3)]'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          className,
        )}
      >
        <Icon icon={isPinned ? PinOff : Pin} size={size} />
        {showLabel && (
          <span className={cn(typography.role.label, 'min-w-0 break-words')}>
            {unknown ? tooltipLabel : isPinned
              ? t('pin.pinned', { defaultValue: 'Pinned' })
              : t('pin.pin', { defaultValue: 'Pin' })}
          </span>
        )}
      </Button>
    </Tooltip>
  );
}
