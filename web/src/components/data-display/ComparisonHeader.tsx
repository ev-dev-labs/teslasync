import { type ReactNode } from 'react';
import { Delta, type DeltaProps } from './Delta';
import { cn } from '@/lib/cn';

export interface ComparisonHeaderProps {
  /** Section title, e.g. "Overview" or "Charging summary". */
  title: ReactNode;
  /**
   * Localised period descriptor — what the current numbers represent
   * (e.g. "Last 30 days" or "Apr 13 – May 12").
   */
  currentLabel: string;
  /**
   * Localised label for the comparison period (e.g. "prior 30 days"
   * or "vs last week"). Pre-formatted by the caller so this component
   * stays free of date/i18n logic.
   */
  comparisonLabel?: string;
  /**
   * Optional headline delta indicator — typically the most important
   * metric in the section. Renders to the right of the title row.
   */
  delta?: Omit<DeltaProps, 'comparedTo'>;
  /** Optional right-aligned actions (links, menus). */
  actions?: ReactNode;
  className?: string;
  /** Keep the title and period comparison on one wrapping line when space permits. */
  compact?: boolean;
  /** Test hook. */
  testId?: string;
}

/**
 * `ComparisonHeader` — section title bar with current/prior period
 * labels and an optional headline delta. Used by overview cards and
 * other comparison-driven surfaces ("This month vs last month",
 * "Selected range vs prior range") where the page already has the
 * computed numbers and just needs a consistent header treatment.
 *
 * Visual hierarchy:
 *   - Title (h3) is primary
 *   - Period strip is muted, secondary
 *   - Optional delta sits to the right
 */
export function ComparisonHeader({
  title,
  currentLabel,
  comparisonLabel,
  delta,
  actions,
  className,
  compact = false,
  testId,
}: ComparisonHeaderProps) {
  return (
    <div
      data-testid={testId}
      className={cn('flex flex-wrap items-start justify-between gap-3', compact && 'items-center gap-2', className)}
    >
      <div className={cn('min-w-0 flex-1', compact && 'flex flex-wrap items-baseline gap-x-3 gap-y-0.5')}>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-wide">
          {title}
        </h3>
        <p className={cn('mt-0.5 text-xs text-[var(--text-muted)]', compact && 'mt-0')}>
          <span>{currentLabel}</span>
          {comparisonLabel && (
            <>
              <span className="mx-1.5 opacity-60">·</span>
              <span>{comparisonLabel}</span>
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {delta && <Delta {...delta} size="sm" />}
        {actions}
      </div>
    </div>
  );
}
