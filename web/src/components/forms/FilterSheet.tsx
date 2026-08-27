import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';

export interface FilterSheetProps {
  /**
   * The filter controls — typically a `<FilterBar>` full of `<Select>` /
   * `<Toggle>` / chip widgets. Mounted exactly once: inline at `md`+
   * (768px), or inside the sheet below `md`. Never rendered twice, so
   * controlled inputs never desync between a hidden copy and a visible one.
   */
  children: ReactNode;
  /**
   * Count of currently-active filters, shown as a badge on the mobile
   * trigger button. Omit or pass `0` to hide the badge.
   */
  activeCount?: number;
  /** Sheet title. Defaults to a translated "Filters". */
  title?: string;
  /** Accessible label override for the trigger button. */
  triggerLabel?: string;
  /** Label for the sheet's closing action. Defaults to a translated "Done". */
  doneLabel?: string;
  /** Pass-through className for the outer wrapper. */
  className?: string;
  /** Test id forwarded to the trigger button. */
  testId?: string;
}

/**
 * FilterSheet — collapses a list-page filter cluster into a mobile bottom
 * sheet below the `md` (768px) breakpoint, keeping it inline (unchanged
 * behaviour) at `md` and above.
 *
 * A phone-width filter row is one of the most common sources of layout
 * thrash on list pages: a `<FilterBar>` with 3-4 `<Select>`s wraps onto
 * several rows and pushes real content below the fold. `FilterSheet` fixes
 * this by rendering a single 44×44-safe "Filters" trigger (with an active-
 * count badge) that opens the exact same controls inside `<Modal>` — which
 * already renders as a bottom sheet on mobile (see MOBILE_GUIDELINES.md and
 * `mobile.viewport.test.tsx`), so no new sheet chrome is introduced here.
 *
 * Pair with `<ActiveFilterChips>` rendered alongside the trigger so users
 * can see — and remove — active filters without opening the sheet at all.
 *
 * Usage:
 * ```tsx
 * <FilterSheet activeCount={activeFilters.length}>
 *   <FilterBar ariaLabel={t('drives.filters')}>
 *     <SearchInput ... />
 *     <Select ... />
 *   </FilterBar>
 * </FilterSheet>
 * <ActiveFilterChips filters={chips} onClearAll={clearAll} />
 * ```
 */
export function FilterSheet({
  children,
  activeCount = 0,
  title,
  triggerLabel,
  doneLabel,
  className,
  testId = 'filter-sheet',
}: FilterSheetProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const contentId = useId();
  // Matches Tailwind's `md` breakpoint (768px) so this switches in lockstep
  // with every `md:` class already used across the app's filter bars.
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return (
      <div className={className} data-testid={testId}>
        {children}
      </div>
    );
  }

  const label = triggerLabel ?? t('filters.sheetTrigger', 'Filters');

  return (
    <div className={className} data-testid={testId}>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={contentId}
        className="min-h-[44px] min-w-[44px]"
        icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
      >
        {label}
        {activeCount > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              'ml-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1',
              'bg-cyan-500/20 text-2xs font-semibold tabular-nums text-cyan-300',
            )}
          >
            {activeCount}
          </span>
        )}
        {/* Announces the active count to screen readers without duplicating
            the visible badge text (which is aria-hidden to avoid "3 3"). */}
        {activeCount > 0 && (
          <span className="sr-only">
            {t('filters.sheetActiveCount', '{{count}} active', { count: activeCount })}
          </span>
        )}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title ?? t('filters.sheetTitle', 'Filters')}
      >
        <div id={contentId} className="flex flex-col gap-4">
          {children}
          <div className="flex justify-end border-t border-[var(--glass-border)] pt-3">
            <Button type="button" variant="primary" onClick={() => setOpen(false)}>
              {doneLabel ?? t('filters.sheetDone', 'Done')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
