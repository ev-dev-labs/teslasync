/**
 * ActiveFilterChips — visible summary of every active list-page filter.
 *
 * Renders one chip per active filter ("Vehicle: Model 3 ×"), an optional
 * "Clear all" button, and an a11y live region that announces removals.
 *
 * Designed to be mounted immediately after a `<FilterBar>` so users never
 * have to re-open a control to learn what's filtering the current view.
 *
 * URL-state is owned by the page; chips are a presentation surface — every
 * removal flows through the descriptor's `onRemove` callback so the page
 * stays in charge of how the URL is rewritten.
 *
 * Phase-46 / Prompt 06.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/lib/icons';
import { VisuallyHidden } from '@/components/a11y';

/**
 * Description of one chip — typically derived from a single URL search-param.
 *
 * `key` should match the URL search-param name so chips are stable and
 * uniquely keyable. `label` is the i18n'd field name (e.g. "Vehicle"),
 * `value` is the user-facing value (e.g. "Model 3"). `onRemove` should
 * delete the param (commonly `setFilter(undefined)`).
 */
export interface FilterChipDescriptor {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
}

export interface ActiveFilterChipsProps {
  filters: readonly FilterChipDescriptor[];
  /** When provided, renders a "Clear all" affordance after the chips. */
  onClearAll?: () => void;
  /** Pass-through className for the outer wrapper. */
  className?: string;
  /**
   * When true (default), the component renders nothing if `filters` is
   * empty AND there is nothing to clear.
   */
  hideWhenEmpty?: boolean;
  /**
   * Maximum number of chips rendered inline. The remaining chips collapse
   * into a "+N more" trigger that opens a small popover. Default 8.
   */
  maxVisible?: number;
}

const POPOVER_DISMISS_KEYS = new Set(['Escape']);

/**
 * ActiveFilterChips — see file header for the contract.
 */
export function ActiveFilterChips({
  filters,
  onClearAll,
  className,
  hideWhenEmpty = true,
  maxVisible = 8,
}: ActiveFilterChipsProps) {
  const { t } = useTranslation();
  const [removalAnnouncement, setRemovalAnnouncement] = useState('');
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Announcement is a transient string; we never queue, but if a second
  // removal lands within the same render cycle, react sees a fresh string
  // (we suffix a zero-width counter) so screen-readers re-read it.
  const announceCounterRef = useRef(0);

  // Close overflow popover on outside click / Escape.
  useEffect(() => {
    if (!overflowOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!overflowRef.current?.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (POPOVER_DISMISS_KEYS.has(e.key)) setOverflowOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [overflowOpen]);

  // When filters drop to zero, also collapse the overflow popover.
  useEffect(() => {
    if (filters.length === 0 && overflowOpen) setOverflowOpen(false);
  }, [filters.length, overflowOpen]);

  const { visible, overflow } = useMemo(() => {
    if (maxVisible <= 0) {
      return { visible: [] as FilterChipDescriptor[], overflow: [...filters] };
    }
    if (filters.length <= maxVisible) {
      return { visible: [...filters], overflow: [] as FilterChipDescriptor[] };
    }
    // When we need an overflow bucket, leave room for the "+N more" trigger
    // by reserving one of the visible slots for it.
    const visibleCount = Math.max(0, maxVisible - 1);
    return {
      visible: filters.slice(0, visibleCount),
      overflow: filters.slice(visibleCount),
    };
  }, [filters, maxVisible]);

  const isEmpty = filters.length === 0;
  if (hideWhenEmpty && isEmpty) {
    return null;
  }

  const announceRemoval = (descriptor: FilterChipDescriptor) => {
    announceCounterRef.current += 1;
    // Trailing zero-width spaces force a fresh string for AT re-announce.
    const padding = '\u200B'.repeat(announceCounterRef.current % 4);
    setRemovalAnnouncement(
      `${t('filters.removed', 'Filter removed')}: ${descriptor.label}${padding}`,
    );
  };

  const handleRemove = (descriptor: FilterChipDescriptor) => {
    announceRemoval(descriptor);
    descriptor.onRemove();
  };

  const handleClearAll = () => {
    if (!onClearAll) return;
    announceCounterRef.current += 1;
    const padding = '\u200B'.repeat(announceCounterRef.current % 4);
    setRemovalAnnouncement(
      `${t('filters.clearedAll', 'All filters cleared')}${padding}`,
    );
    onClearAll();
  };

  const handleChipKey = (
    e: KeyboardEvent<HTMLButtonElement>,
    descriptor: FilterChipDescriptor,
  ) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      handleRemove(descriptor);
    }
  };

  return (
    <div
      className={cn('flex flex-wrap items-center gap-2', className)}
      data-testid="active-filter-chips"
      aria-label={t('filters.activeLabel', 'Active filters')}
      role="group"
    >
      {visible.map((descriptor) => (
        <Chip
          key={descriptor.key}
          descriptor={descriptor}
          onRemove={handleRemove}
          onKey={handleChipKey}
        />
      ))}

      {overflow.length > 0 && (
        <div ref={overflowRef} className="relative inline-block">
          <button
            type="button"
            onClick={() => setOverflowOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
              'border-[var(--border-subtle)] bg-[var(--surface-2)]/40 text-[var(--text-secondary)]',
              'hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
            )}
          >
            {t('filters.moreCount', '+{{count}} more', { count: overflow.length })}
          </button>
          {overflowOpen && (
            <div
              role="menu"
              aria-label={t('filters.moreLabel', 'Additional active filters')}
              className={cn(
                'absolute left-0 z-30 mt-1 min-w-[12rem] max-w-xs rounded-lg p-2',
                'border border-white/[0.08] bg-[var(--surface-elevated)] shadow-xl',
                'flex flex-col gap-1',
              )}
            >
              {overflow.map((descriptor) => (
                <Chip
                  key={descriptor.key}
                  descriptor={descriptor}
                  onRemove={(d) => {
                    handleRemove(d);
                    if (overflow.length === 1) setOverflowOpen(false);
                  }}
                  onKey={handleChipKey}
                  fullWidth
                />
              ))}
            </div>
          )}
        </div>
      )}

      {onClearAll && filters.length > 0 && (
        <button
          type="button"
          onClick={handleClearAll}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
            'text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
          )}
        >
          {t('filters.clearAll', 'Clear all')}
        </button>
      )}

      {/* a11y live region — announces individual removals + clear-all. */}
      <VisuallyHidden liveRegion>{removalAnnouncement}</VisuallyHidden>
    </div>
  );
}

interface ChipProps {
  descriptor: FilterChipDescriptor;
  onRemove: (descriptor: FilterChipDescriptor) => void;
  onKey: (e: KeyboardEvent<HTMLButtonElement>, descriptor: FilterChipDescriptor) => void;
  fullWidth?: boolean;
}

function Chip({ descriptor, onRemove, onKey, fullWidth }: ChipProps) {
  const { t } = useTranslation();
  const removeLabel = t(
    'filters.removeAria',
    'Remove filter {{label}}',
    { label: descriptor.label },
  );
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
        'border-[var(--border-subtle)] bg-[var(--surface-2)]/40 text-[var(--text-secondary)]',
        fullWidth && 'w-full justify-between',
      )}
    >
      <span className="truncate">
        <span className="text-[var(--text-muted)]">{descriptor.label}:</span>{' '}
        <span className="text-[var(--text-primary)]">{descriptor.value}</span>
      </span>
      <button
        type="button"
        onClick={() => onRemove(descriptor)}
        onKeyDown={(e) => onKey(e, descriptor)}
        aria-label={removeLabel}
        className={cn(
          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
          'text-[var(--text-muted)] hover:bg-white/[0.08] hover:text-[var(--text-primary)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
        )}
      >
        <Icon icon={Icons.close} size="xs" />
      </button>
    </span>
  );
}
