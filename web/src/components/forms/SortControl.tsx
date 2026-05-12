import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';

export type SortDirection = 'asc' | 'desc';

export interface SortOption<F extends string = string> {
  /** Stable field key (also used in URL state). */
  value: F;
  /** Localised, user-visible label. */
  label: string;
}

export interface SortControlProps<F extends string = string> {
  /** Currently selected sort field. */
  field: F;
  /** Currently selected direction. */
  direction: SortDirection;
  options: readonly SortOption<F>[];
  onFieldChange: (field: F) => void;
  onDirectionChange: (dir: SortDirection) => void;
  className?: string;
  testId?: string;
  /** Optional explicit accessible label for the direction button. */
  directionAriaLabel?: string;
}

/**
 * `SortControl` — field dropdown + direction toggle (with arrow indicator).
 *
 * Renders as: [▾ Field name] [↓]
 *   - Field dropdown changes which column the list is sorted by
 *   - Direction toggle flips ascending / descending and shows an arrow
 *     (so users can read the current state at a glance, per UX critique)
 *
 * Generic over the field type so callers can use a string-literal union
 * (e.g. `'date' | 'distance' | 'score'`) for type-safety on URL parsing.
 */
export function SortControl<F extends string = string>({
  field,
  direction,
  options,
  onFieldChange,
  onDirectionChange,
  className,
  testId,
  directionAriaLabel,
}: SortControlProps<F>) {
  const { t } = useTranslation();
  const flip = () => onDirectionChange(direction === 'asc' ? 'desc' : 'asc');
  const dirLabel =
    direction === 'asc'
      ? t('sortControl.ascending', 'Ascending')
      : t('sortControl.descending', 'Descending');

  return (
    <div
      data-testid={testId}
      className={cn('inline-flex items-center gap-1', className)}
    >
      <Select
        value={field}
        onChange={(e) => onFieldChange(e.target.value as F)}
        aria-label={t('sortControl.fieldLabel', 'Sort by')}
        data-testid={testId ? `${testId}-field` : undefined}
        options={options.map((o) => ({ value: o.value, label: o.label }))}
        size="sm"
      />
      <button
        type="button"
        onClick={flip}
        aria-label={directionAriaLabel ?? `${t('sortControl.direction', 'Sort direction')}: ${dirLabel}`}
        title={dirLabel}
        data-testid={testId ? `${testId}-direction` : undefined}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--glass-border)] bg-[var(--surface-1)]/40',
          'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        )}
      >
        {direction === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}
