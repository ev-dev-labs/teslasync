import { type ReactNode, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { dashboardTokens } from '../../lib/dashboardTokens';
import { WidgetTitleContext } from '../WidgetTitleContext';

export interface StatGridItem {
  label: string;
  value: string | number | null | undefined;
  unit?: string;
  icon?: ReactNode;
  sublabel?: string;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  /** Direction is not desirability: a declining cost can be a positive result. */
  trendPositive?: boolean;
  valueColor?: string;
}

export interface WidgetStatGridProps {
  stats?: StatGridItem[];
  compact?: boolean;
  cols?: 2 | 3 | 4;
  maxPerRow?: 2 | 3 | 4;
}

function autoCols(count: number): 2 | 3 | 4 {
  if (count <= 2) return 2;
  if (count % 3 === 0) return 3;
  if (count % 4 === 1 && count % 3 === 2) return 3;
  if (count % 4 === 0 || count % 4 >= 2) return 4;
  return 2;
}

export function WidgetStatGrid({ stats, compact, cols, maxPerRow }: WidgetStatGridProps) {
  const { t } = useTranslation('dashboard');
  const widgetTitle = useContext(WidgetTitleContext);
  const items = stats ?? [];

  if (items.length === 0) {
    return (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        message={t('widget.statGrid.noStats', 'No stats available')}
      />
    );
  }

  const resolvedMaxPerRow = compact ? 1 : (maxPerRow ?? cols ?? autoCols(items.length));

  return (
    <div
      className={cn(
        'grid min-w-0',
        dashboardTokens.statRail,
        compact ? 'gap-2' : dashboardTokens.density.statGap,
        dashboardTokens.columns[resolvedMaxPerRow] ?? dashboardTokens.columns[2],
      )}
      data-max-per-row={resolvedMaxPerRow}
    >
      {items.map((stat, index) => (
        <StatCard
          key={`${stat.label}-${index}`}
          label={stat.label === widgetTitle ? '' : stat.label}
          value={stat.value}
          unit={stat.unit}
          icon={undefined}
          sublabel={stat.sublabel}
          trend={
            stat.trend && stat.trendValue
              ? {
                  direction: stat.trend,
                  value: stat.trendValue,
                  positive: stat.trendPositive ?? stat.trend === 'up',
                }
              : undefined
          }
          className={cn(
            dashboardTokens.stat,
            // Spec `st` cell language (widgets-compare.html `.stats` / `.st`):
            // muted label, 18px semibold tabular value, quiet unit. StatCard
            // renders a 14px label/unit and a 24px (30px at sm:) metric, so the
            // structural selectors below re-voice them to the spec scale
            // without touching the shared StatCard. First row: the label span
            // (the decorative icon span stays hidden); value row: the
            // MetricValue div, then the unit span.
            '[&>div:first-child>span:first-child]:text-xs [&>div:first-child>span:first-child]:text-[var(--text-muted)]',
            '[&>div:nth-child(2)>div]:text-lg [&>div:nth-child(2)>span]:text-xs',
            // Long values wrap at spaces instead of overflowing the
            // minmax(0,1fr) column.
            '[&>div:nth-child(2)]:[overflow-wrap:normal] [&>div:nth-child(2)]:[word-break:normal]',
            '[&>div:first-child>span[aria-hidden=true]]:hidden',
            stat.valueColor,
          )}
        />
      ))}
    </div>
  );
}
