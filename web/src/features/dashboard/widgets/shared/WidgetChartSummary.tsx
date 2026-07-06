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
    return <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={emptyIcon} message={emptyMessage ?? 'No data available'} />;
  }

  // Null-safety: a caller may hand us a possibly-undefined array (e.g. `data?.stats`).
  // Coalesce before any `.length` / `.map` so a missing source degrades to a
  // chart-only render instead of throwing.
  const safeStats = stats ?? [];

  return (
    <div className="flex h-full flex-col">
      {safeStats.length > 0 && (
        <div
          className={cn(
            // Stat row: 2-col grid by default (mobile-safe). On wider widgets
            // (@sm ≈ 24rem) it relaxes to a horizontal flex row so values can
            // breathe. In compact mode (caller-driven) we always force 2-col.
            compact
              ? 'grid grid-cols-2 gap-2'
              : 'grid grid-cols-2 gap-2 @sm:flex @sm:gap-4',
          )}
        >
          {safeStats.map((stat, index) => (
            <div key={`${stat.label}-${index}`} className="flex min-w-0 flex-col">
              <span className="truncate text-2xs text-[var(--text-muted)]">{stat.label}</span>
              <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
                {stat.value ?? '—'}
                {stat.unit && (
                  <span className="ml-0.5 text-2xs font-normal text-[var(--text-muted)]">
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
