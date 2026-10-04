import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { dashboardTokens } from '../../lib/dashboardTokens';

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
}

function autoCols(count: number): 2 | 3 | 4 {
  if (count % 3 === 0) return 3;
  if (count % 4 === 0) return 4;
  return 2;
}

export function WidgetStatGrid({ stats, compact, cols }: WidgetStatGridProps) {
  const { t } = useTranslation('dashboard');
  const items = stats ?? [];

  if (items.length === 0) {
    return (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        message={t('widget.statGrid.noStats', 'No stats available')}
      />
    );
  }

  const resolvedCols = compact ? 1 : (cols ?? autoCols(items.length));

  return (
    <div className={cn('grid min-w-0', dashboardTokens.columns[resolvedCols], compact ? 'gap-2' : 'gap-3')}>
      {items.map((stat, index) => (
        <StatCard
          key={`${stat.label}-${index}`}
          label={stat.label}
          value={stat.value}
          unit={stat.unit}
          icon={stat.icon}
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
          className={cn(dashboardTokens.stat, 'min-w-0 [&_span]:break-words [&_.tabular-nums]:break-all', stat.valueColor)}
        />
      ))}
    </div>
  );
}
