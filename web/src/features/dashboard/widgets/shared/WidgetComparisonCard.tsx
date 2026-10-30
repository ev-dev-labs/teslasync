import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Delta } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

export interface ComparisonMetric {
  label: string;
  current: number;
  previous: number;
  formattedCurrent: string;
  /**
   * Caller-formatted previous-period value (units included, e.g. "162 mi").
   * Renders the spec's previous-period sub-line ("Last week 162 mi").
   * Omit when unknown — the sub-line is dropped, never fabricated.
   */
  formattedPrevious?: string;
  unit?: string;
  higherIsBetter?: boolean;
  /**
   * Whether the delta may carry status colour. Week-over-week movement is
   * neutral by default (spec rule 4: colour means status only), matching the
   * After design where plain movements render muted and only a genuine
   * improvement (e.g. efficiency −6%) renders good. 'good'/'bad' opt a row
   * into directional colouring; the actual colour still follows the measured
   * movement via `higherIsBetter`, so a mislabelled tone self-corrects.
   */
  tone?: 'good' | 'bad' | 'neutral';
  /** Percent change (default) or absolute change — counts read better absolute. */
  deltaDisplay?: 'percent' | 'absolute';
}

interface WidgetComparisonCardProps {
  metrics: ComparisonMetric[];
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  /**
   * Prefix for the previous-period sub-line ("Last week 162 mi").
   * Pass `useCompareWindow(...).previousLabel`; defaults to localised "Last week".
   */
  previousLabel?: string;
}

function MetricRow({ metric, previousLabel }: { metric: ComparisonMetric; previousLabel: string }) {
  const direction =
    metric.tone === 'good' || metric.tone === 'bad'
      ? (metric.higherIsBetter === false ? 'lower_better' : 'higher_better')
      : 'neutral';

  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-[var(--border-subtle)] py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-sm font-medium text-[var(--text-primary)]"
          title={metric.label}
        >
          {metric.label}
        </div>
        {metric.formattedPrevious != null && metric.formattedPrevious !== '' ? (
          <div className="truncate text-xs text-[var(--text-muted)]">
            {previousLabel} {metric.formattedPrevious}
          </div>
        ) : null}
      </div>
      <div className="shrink-0 text-end tabular-nums">
        <div className="whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
          {metric.formattedCurrent ?? '—'}
          {metric.unit && (
            <span className="ms-1 text-xs font-normal text-[var(--text-muted)]">
              {metric.unit}
            </span>
          )}
        </div>
        <div className="flex justify-end">
          <Delta
            metric={{ direction }}
            current={metric.current}
            previous={metric.previous}
            display={metric.deltaDisplay ?? 'percent'}
            size="sm"
            hideArrow
          />
        </div>
      </div>
    </div>
  );
}

export function WidgetComparisonCard({
  metrics,
  compact = false,
  emptyMessage = 'No comparison data',
  emptyIcon,
  previousLabel,
}: WidgetComparisonCardProps) {
  const { t } = useTranslation('dashboard');
  const resolvedPreviousLabel = previousLabel ?? t('widget.comparison.previousLabel', 'Last week');
  const list = metrics ?? [];
  const visible = compact ? list.slice(0, 2) : list;

  if (visible.length === 0) {
    return (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        icon={emptyIcon}
        message={emptyMessage}
        className="py-4"
      />
    );
  }

  return (
    <div className={cn('widget-stat-rail flex flex-col', compact && 'text-sm')}>
      {visible.map((m, i) => (
        <MetricRow key={`${m.label}-${i}`} metric={m} previousLabel={resolvedPreviousLabel} />
      ))}
    </div>
  );
}
