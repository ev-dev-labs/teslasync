import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Badge } from '@/components/ui';
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

function computeChange(current: number, previous: number) {
  if (previous === 0 || !Number.isFinite(previous)) return NaN;
  return ((current - previous) / Math.abs(previous)) * 100;
}

type Direction = 'up' | 'down' | 'neutral';

function getDirection(pct: number): Direction {
  if (!Number.isFinite(pct) || pct === 0) return 'neutral';
  return pct > 0 ? 'up' : 'down';
}

function getBadgeVariant(
  direction: Direction,
  higherIsBetter: boolean,
): 'success' | 'danger' | 'neutral' {
  if (direction === 'neutral') return 'neutral';
  const isPositiveOutcome =
    (direction === 'up' && higherIsBetter) ||
    (direction === 'down' && !higherIsBetter);
  return isPositiveOutcome ? 'success' : 'danger';
}

const directionIcon = {
  up: TrendingUp,
  down: TrendingDown,
  neutral: Minus,
} as const;

function ChangeBadge({
  pct,
  higherIsBetter,
}: {
  pct: number;
  higherIsBetter: boolean;
}) {
  const direction = getDirection(pct);
  const variant = getBadgeVariant(direction, higherIsBetter);
  const Icon = directionIcon[direction];

  const label =
    direction === 'neutral'
      ? '—'
      : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;

  return (
    <Badge variant={variant} size="sm" className="gap-0.5">
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function MetricRow({ metric }: { metric: ComparisonMetric }) {
  const pct = computeChange(metric.current, metric.previous);
  const higherIsBetter = metric.higherIsBetter ?? true;

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.06] last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-white/50">{metric.label}</span>
        <span className="text-base font-semibold text-white/90">
          {metric.formattedCurrent}
          {metric.unit && (
            <span className="ml-0.5 text-xs font-normal text-white/40">
              {metric.unit}
            </span>
          )}
        </span>
      </div>
      <ChangeBadge pct={pct} higherIsBetter={higherIsBetter} />
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
      <p className="text-sm text-white/40 py-2">No comparison data</p>
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
