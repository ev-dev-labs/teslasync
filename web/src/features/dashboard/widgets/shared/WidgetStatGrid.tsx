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
  maxPerRow?: 2 | 3 | 4;
}

function autoCols(count: number): 2 | 3 | 4 {
  if (count % 3 === 0) return 3;
  if (count % 4 === 0) return 4;
  return 2;
}

export function WidgetStatGrid({ stats, compact, cols, maxPerRow }: WidgetStatGridProps) {
  const { t } = useTranslation('dashboard');
  const items = stats ?? [];

  if (items.length === 0) {
    return (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        message={t('widget.statGrid.noStats', 'No stats available')}
      />
    );
  }

  const resolvedMaxPerRow = compact ? 1 : (maxPerRow ?? cols ?? autoCols(items.length));
  const gap = compact ? 8 : 12;
  const tileStyle = {
    flex: compact ? '1 1 100%' : '1 1 200px',
    minWidth: compact ? '100%' : 'min(100%, 200px)',
    maxWidth: `calc((100% - ${gap * (resolvedMaxPerRow - 1)}px) / ${resolvedMaxPerRow})`,
  };

  return (
    <div className={cn('flex min-w-0 flex-wrap items-stretch', compact ? 'gap-2' : 'gap-3')} data-max-per-row={resolvedMaxPerRow}>
      {items.map((stat, index) => (
        <StatCard
          key={`${stat.label}-${index}`}
          label={stat.label}
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
            'min-w-0 flex-[1_1_200px] [&>div:first-child>span[aria-hidden=true]]:hidden [&>div:nth-child(2)]:[overflow-wrap:normal] [&>div:nth-child(2)]:[word-break:normal]',
            compact && '!basis-full',
            stat.valueColor,
          )}
          style={tileStyle}
        />
      ))}
    </div>
  );
}
