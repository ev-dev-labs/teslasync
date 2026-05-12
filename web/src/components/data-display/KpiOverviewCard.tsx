import { type ReactNode } from 'react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { ComparisonHeader, type ComparisonHeaderProps } from './ComparisonHeader';
import { cn } from '@/lib/cn';

/**
 * `KpiOverviewCard` — section card composed of:
 *   1. A {@link ComparisonHeader} (title + period strip + optional headline delta + actions)
 *   2. A KPI grid where the page renders one or more `<MetricCard>` (or any
 *      tile-shaped child) per slot
 *   3. An optional muted `secondary` line for "fold-down" stats
 *      (e.g. "Top speed 152 mph · Longest 29.1 mi · …")
 *   4. An optional `footer` slot — typically an `<InlineCallout>` for
 *      anomalies or other actionable insight
 *
 * The card is purely presentational: page logic computes the values, and
 * the card supplies a consistent visual shell across overview surfaces
 * (Drives, Charging, Trips, …) so they all read as the same product.
 *
 * Example:
 * ```tsx
 * <KpiOverviewCard
 *   header={{ title: 'Overview', currentLabel: 'Last 30 days', comparisonLabel: 'vs prior 30 days' }}
 *   kpis={
 *     <>
 *       <MetricCard label="Drives" value={fmtCompact(stats.count)} delta={...} />
 *       <MetricCard label="Distance" value={fmtNumber(distMi)} delta={...} />
 *       …
 *     </>
 *   }
 *   secondary="Top speed 152 mph · Longest 29.1 mi · Avg trip 11.5 mi"
 *   footer={<InlineCallout variant="warning">…</InlineCallout>}
 * />
 * ```
 */
export interface KpiOverviewCardProps {
  /** Header configuration — passed straight through to {@link ComparisonHeader}. */
  header: ComparisonHeaderProps;
  /**
   * KPI tile slot. Pages typically pass one or more `<MetricCard>` —
   * the card lays them out in a responsive grid.
   */
  kpis: ReactNode;
  /**
   * Optional secondary stats line — rendered muted under the grid.
   * Accept `ReactNode` so callers can mix icons / spans freely.
   */
  secondary?: ReactNode;
  /**
   * Optional footer slot — typically an {@link InlineCallout} for an
   * actionable insight (e.g. "1 anomaly in this range →").
   */
  footer?: ReactNode;
  /**
   * Override the responsive grid template. Defaults to "auto-fit"
   * with a min-tile-width sized for ~6 tiles per row on desktop.
   */
  gridClassName?: string;
  className?: string;
  /** Test hook on the outer panel. */
  testId?: string;
  /** Optional id, useful for IntersectionObserver targeting (sticky bar). */
  id?: string;
}

export function KpiOverviewCard({
  header,
  kpis,
  secondary,
  footer,
  gridClassName,
  className,
  testId,
  id,
}: KpiOverviewCardProps) {
  return (
    <GlassPanel
      className={cn('p-4 sm:p-5 space-y-4', className)}
      data-testid={testId}
      id={id}
    >
      <ComparisonHeader {...header} />

      <div
        className={cn(
          'grid gap-3 sm:gap-4',
          gridClassName ??
            'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
        )}
        data-testid={testId ? `${testId}-kpis` : undefined}
      >
        {kpis}
      </div>

      {secondary && (
        <div className="text-xs text-[var(--text-muted)] leading-relaxed">
          {secondary}
        </div>
      )}

      {footer && <div>{footer}</div>}
    </GlassPanel>
  );
}
