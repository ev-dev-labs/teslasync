import { useTranslation } from 'react-i18next';
import { Rows, Rows3, Table2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type Density = 'comfortable' | 'compact' | 'table';

export interface DensityToggleProps {
  value: Density;
  onChange: (next: Density) => void;
  /** Hide one or more options (e.g. some pages don't support 'table'). */
  options?: readonly Density[];
  className?: string;
  /** Test hook. */
  testId?: string;
  /** Accessible name for the radio group. */
  ariaLabel?: string;
}

const DEFAULT_OPTIONS: readonly Density[] = ['table', 'compact', 'comfortable'];

const ICONS: Record<Density, typeof Rows> = {
  table: Table2,
  compact: Rows3,
  comfortable: Rows,
};

/**
 * `DensityToggle` — three-way Table / Compact / Comfortable selector
 * for list pages. Implements the WAI-ARIA radiogroup pattern: arrow
 * keys move + commit the selection, Tab moves out of the group.
 *
 * Controlled component — caller owns the value (typically via a URL
 * param so the user's preference survives a refresh).
 */
export function DensityToggle({
  value,
  onChange,
  options = DEFAULT_OPTIONS,
  className,
  testId,
  ariaLabel,
}: DensityToggleProps) {
  const { t } = useTranslation();
  const labelMap: Record<Density, string> = {
    table: t('density.table', 'Table'),
    compact: t('density.compact', 'Compact'),
    comfortable: t('density.comfortable', 'Comfortable'),
  };
  const groupLabel = ariaLabel ?? t('density.groupLabel', 'List density');

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const idx = options.indexOf(value);
    if (idx < 0) return;
    e.preventDefault();
    const next = e.key === 'ArrowRight'
      ? options[(idx + 1) % options.length]
      : options[(idx - 1 + options.length) % options.length];
    onChange(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label={groupLabel}
      data-testid={testId}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-[var(--glass-border)] bg-[var(--surface-1)]/40 p-0.5',
        className,
      )}
    >
      {options.map((opt) => {
        const Icon = ICONS[opt];
        const selected = opt === value;
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={labelMap[opt]}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt)}
            data-testid={testId ? `${testId}-${opt}` : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
              selected
                ? 'bg-[var(--surface-2)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]/50',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{labelMap[opt]}</span>
          </button>
        );
      })}
    </div>
  );
}
