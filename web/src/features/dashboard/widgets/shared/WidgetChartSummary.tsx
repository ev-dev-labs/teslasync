import { type ReactNode } from 'react';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

export interface ChartSummaryStat {
  label: string;
  value: string | number;
  unit?: string;
}

interface WidgetChartSummaryProps {
  stats: ChartSummaryStat[];
  chart: ReactNode;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  isEmpty?: boolean;
}

export function WidgetChartSummary({
  stats,
  chart,
  compact,
  emptyMessage,
  emptyIcon,
  isEmpty,
}: WidgetChartSummaryProps) {
  if (isEmpty) {
    return <EmptyState icon={emptyIcon} message={emptyMessage ?? 'No data available'} />;
  }

  return (
    <div className="flex h-full flex-col">
      {stats.length > 0 && (
        <div className={cn('flex gap-4', compact && 'grid grid-cols-2 gap-2')}>
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col">
              <span className="text-[10px] text-white/40">{stat.label}</span>
              <span className="text-sm font-semibold text-white/90">
                {stat.value}
                {stat.unit && (
                  <span className="ml-0.5 text-[10px] font-normal text-white/40">
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
