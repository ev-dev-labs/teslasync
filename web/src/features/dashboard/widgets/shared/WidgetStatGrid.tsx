import { type ReactNode } from 'react';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

export interface StatGridItem {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  valueColor?: string;
}

interface WidgetStatGridProps {
  stats: StatGridItem[];
  compact?: boolean;
  cols?: 2 | 3 | 4;
}

function autoCols(count: number): 2 | 3 | 4 {
  if (count % 3 === 0) return 3;
  if (count % 4 === 0) return 4;
  return 2;
}

const colsClass: Record<1 | 2 | 3 | 4, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

export function WidgetStatGrid({ stats, compact, cols }: WidgetStatGridProps) {
  if (stats.length === 0) {
    return <EmptyState message="No stats available" />;
  }

  const resolvedCols = compact ? 1 : (cols ?? autoCols(stats.length));

  return (
    <div className={cn('grid', colsClass[resolvedCols], compact ? 'gap-2' : 'gap-3')}>
      {stats.map((stat) => (
        <StatCard
          key={stat.label}
          label={stat.label}
          value={stat.value}
          unit={stat.unit}
          icon={stat.icon}
          trend={
            stat.trend && stat.trendValue
              ? {
                  direction: stat.trend,
                  value: stat.trendValue,
                  positive: stat.trend === 'up',
                }
              : undefined
          }
          className={stat.valueColor}
        />
      ))}
    </div>
  );
}
