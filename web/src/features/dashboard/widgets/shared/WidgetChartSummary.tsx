import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { chartTokens, typography } from '@/lib/tokens';
import { dashboardTokens } from '../../lib/dashboardTokens';

export interface ChartSummaryStat {
  label: string;
  value: string | number | null | undefined;
  unit?: string;
}

/**
 * Static dot + word series key for chart bodies whose series are not managed
 * by the interactive `<ChartLegend>` (single-series charts, non-recharts
 * bodies). The word always carries the meaning; the dot never stands alone.
 */
export interface ChartSummaryLegendItem {
  label: string;
  /**
   * Series swatch. Defaults to the restrained `chartTokens.series` dark/light
   * pair at this item's index, so the key stays legible in both modes without
   * caller-supplied hex.
   */
  color?: string;
}

export interface WidgetChartSummaryProps {
  stats: ChartSummaryStat[];
  chart: ReactNode;
  compact?: boolean;
  emptyMessage?: string;
  emptyDescription?: string;
  emptyIcon?: ReactNode;
  isEmpty?: boolean;
  /**
   * Quiet axis title rendered above the chart body (unit or scale context,
   * e.g. "kW"). Caller-localized. Hidden in `compact` mode with the chart.
   */
  yAxisLabel?: string;
  /**
   * Quiet axis title rendered below the chart body (e.g. "Speed range").
   * Caller-localized. Hidden in `compact` mode with the chart.
   */
  xAxisLabel?: string;
  /**
   * Static series key rendered below the chart body. Hidden in `compact`
   * mode with the chart.
   */
  legend?: ChartSummaryLegendItem[];
}

export function WidgetChartSummary({
  stats,
  chart,
  compact,
  emptyMessage,
  emptyDescription,
  emptyIcon,
  isEmpty,
  yAxisLabel,
  xAxisLabel,
  legend,
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
  const safeLegend = legend ?? [];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {safeStats.length > 0 && (
        <div
          className={cn(
            'shrink-0',
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

      {!compact && (
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          {yAxisLabel != null && yAxisLabel !== '' && (
            <p className={cn(typography.role.label, 'mb-1 shrink-0 break-words text-start')}>
              {yAxisLabel}
            </p>
          )}
          <div className="min-h-0 flex-1">{chart}</div>
          {safeLegend.length > 0 && (
            <ul className="mt-1.5 flex min-w-0 shrink-0 flex-wrap gap-x-3 gap-y-1">
              {safeLegend.map((item, index) => (
                <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
                  {/* Dot repeats the adjacent word; meaning never relies on color alone. */}
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color ?? chartTokens.series[index % chartTokens.series.length] }}
                  />
                  <span className={cn(typography.role.caption, 'break-words')}>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {xAxisLabel != null && xAxisLabel !== '' && (
            <p className={cn(typography.role.caption, 'mt-1.5 shrink-0 break-words text-start')}>
              {xAxisLabel}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
