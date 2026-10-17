import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { dashboardTokens } from '../../lib/dashboardTokens';

export interface ChartSummaryStat {
  label: string;
  value: string | number | null | undefined;
  unit?: string;
}

export interface WidgetChartSummaryProps {
  stats: ChartSummaryStat[];
  chart: ReactNode;
  compact?: boolean;
  emptyMessage?: string;
  emptyDescription?: string;
  emptyIcon?: ReactNode;
  isEmpty?: boolean;
}

export function WidgetChartSummary({
  stats,
  chart,
  compact,
  emptyMessage,
  emptyDescription,
  emptyIcon,
  isEmpty,
}: WidgetChartSummaryProps) {
  const { t } = useTranslation('dashboard');

  if (isEmpty) {
    return (
      // no-action: widget data populates automatically from its source activity.
      <EmptyState
        icon={emptyIcon}
        message={emptyMessage ?? t(
          'widget.emptyMessage',
          'This widget has no qualifying data yet.',
        )}
        description={emptyDescription ?? t(
          'widget.emptyDescription',
          'It will populate after the source records relevant activity.',
        )}
      />
    );
  }

  // Null-safety: a caller may hand us a possibly-undefined array (e.g. `data?.stats`).
  // Coalesce before any `.length` / `.map` so a missing source degrades to a
  // chart-only render instead of throwing.
  const safeStats = stats ?? [];

  return (
    <div className="flex h-full min-w-0 flex-col">
      {safeStats.length > 0 && (
        <div
          className={cn(
            // Reflow against the widget width, including a narrow desktop column.
            compact
              ? 'grid grid-cols-1 gap-2 @xs:grid-cols-2'
              : 'grid grid-cols-1 gap-2 @xs:grid-cols-2 @sm:flex @sm:flex-wrap @sm:gap-4',
          )}
        >
          {safeStats.map((stat, index) => (
            <div key={`${stat.label}-${index}`} className="flex min-w-0 flex-col">
              <span className={dashboardTokens.metricLabel}>{stat.label}</span>
              <span className={cn(dashboardTokens.secondaryMetric, 'break-all')}>
                {stat.value == null || stat.value === '' || (typeof stat.value === 'number' && !Number.isFinite(stat.value)) ? '—' : stat.value}
                {stat.unit && stat.value != null && stat.value !== '' && (typeof stat.value !== 'number' || Number.isFinite(stat.value)) && (
                  <span className={cn(dashboardTokens.unit, 'ml-1 font-normal')}>
                    {stat.unit}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {!compact && <div className="mt-2 min-h-0 flex-1">{chart}</div>}
    </div>
  );
}
