import { type ReactNode } from 'react';
import { Card, MetricValue, Text } from '@/components/ui';

export interface OwnershipStat {
  key: string;
  label: string;
  value: ReactNode;
  /** Source validity belongs to the caller, never to the formatted node. */
  state?: 'value' | 'missing' | 'invalid';
  hint?: string;
  tone?: 'default' | 'positive' | 'warning' | 'critical' | 'accent';
}

const toneClass: Record<NonNullable<OwnershipStat['tone']>, string> = {
  default: 'text-[var(--text-primary)]',
  positive: 'text-emerald-300',
  warning: 'text-amber-300',
  critical: 'text-rose-300',
  accent: 'text-theme-accent',
};

interface StatGridProps {
  stats: OwnershipStat[];
  columns?: 2 | 3 | 4;
}

const gridColumns = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
} as const;

/**
 * Headline KPI row. Values are pre-formatted by the caller so this component
 * never has to know whether it is rendering money, distance, or a percentage.
 */
export function StatGrid({ stats, columns = 4 }: StatGridProps) {
  return (
    <div data-app-part="metric-grid" className={`grid min-w-0 items-stretch gap-3 [&>*]:min-w-0 ${gridColumns[columns]}`}>
      {stats.map((stat) => (
        <Card
          key={stat.key}
          data-app-part="card metric"
          data-app-metric="tile"
          data-state={stat.state}
          className="min-w-0 space-y-1"
        >
          <Text data-app-part="metric-label" as="p" variant="caption">
            {stat.label}
          </Text>
          <MetricValue
            data-app-part="metric-value"
            className={`break-words tabular-nums ${toneClass[stat.tone ?? 'default']}`}
          >
            {stat.value}
          </MetricValue>
          {stat.hint ? (
            <Text data-app-part="metric-context" as="p" variant="caption" className="mt-1">
              {stat.hint}
            </Text>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
