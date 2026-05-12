import { Delta } from '@/components/data-display';
import { cn } from '@/lib/cn';

export interface ComparisonMetric {
  label: string;
  current: number;
  previous: number;
  formattedCurrent: string;
  unit?: string;
  higherIsBetter?: boolean;
}

interface WidgetComparisonCardProps {
  metrics: ComparisonMetric[];
  compact?: boolean;
}

function MetricRow({ metric }: { metric: ComparisonMetric }) {
  const higherIsBetter = metric.higherIsBetter ?? true;
  const direction = higherIsBetter ? 'higher_better' : 'lower_better';

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-white/[0.06] last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-xs text-[var(--text-muted)]">{metric.label}</span>
        <span className="truncate text-base font-semibold text-[var(--text-primary)]">
          {metric.formattedCurrent}
          {metric.unit && (
            <span className="ml-0.5 text-xs font-normal text-[var(--text-muted)]">
              {metric.unit}
            </span>
          )}
        </span>
      </div>
      <Delta
        metric={{ direction }}
        current={metric.current}
        previous={metric.previous}
        display="percent"
        size="sm"
      />
    </div>
  );
}

export function WidgetComparisonCard({
  metrics,
  compact,
}: WidgetComparisonCardProps) {
  const visible = compact ? metrics.slice(0, 2) : metrics;

  if (visible.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-2">No comparison data</p>
    );
  }

  return (
    <div className={cn('flex flex-col', compact && 'text-sm')}>
      {visible.map((m) => (
        <MetricRow key={m.label} metric={m} />
      ))}
    </div>
  );
}
