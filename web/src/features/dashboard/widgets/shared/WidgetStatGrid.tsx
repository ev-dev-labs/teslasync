import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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
  stats?: StatGridItem[];
  compact?: boolean;
  cols?: 2 | 3 | 4;
}

function autoCols(count: number): 2 | 3 | 4 {
  if (count % 3 === 0) return 3;
  if (count % 4 === 0) return 4;
  return 2;
}

// Container-query class table. Each cell selects a column count based on
// the *widget's own rendered width* (via `@container` on WidgetShell's
// content area), not the viewport. This means a 4-up stat grid collapses
// to 2-up on narrow widgets — whether they are narrow because the user is
// on a phone or because the widget only spans 1 column on a wide desktop.
const containerColsClass: Record<1 | 2 | 3 | 4, string> = {
  1: 'grid-cols-1',
  // 2-col baseline; never collapses below 2
  2: 'grid-cols-2',
  // 3-col target: 1 col under @xs (~16rem≈256px), 2 cols under @sm (~24rem≈384px), 3 above
  3: 'grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3',
  // 4-col target: 2 cols under @sm, 4 above
  4: 'grid-cols-2 @sm:grid-cols-4',
};

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
    <div className={cn('grid', containerColsClass[resolvedCols], compact ? 'gap-2' : 'gap-3')}>
      {items.map((stat, index) => (
        <StatCard
          key={`${stat.label}-${index}`}
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
