import { type ReactNode } from 'react';
import { Grid } from '@/components/layout';
import { Card, MetricValue, Text } from '@/components/ui';

export interface OwnershipStat {
  key: string;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'positive' | 'warning' | 'critical' | 'accent';
}

const toneClass: Record<NonNullable<OwnershipStat['tone']>, string> = {
  default: 'text-[var(--text-primary)]',
  positive: 'text-emerald-300',
  warning: 'text-amber-300',
  critical: 'text-rose-300',
  accent: 'text-cyan-300',
};

interface StatGridProps {
  stats: OwnershipStat[];
  columns?: 2 | 3 | 4;
}

const gridColumns = {
  2: { default: 1, sm: 2 },
  3: { default: 1, sm: 2, lg: 3 },
  4: { default: 1, sm: 2, lg: 4 },
} as const;

/**
 * Headline KPI row. Values are pre-formatted by the caller so this component
 * never has to know whether it is rendering money, distance, or a percentage.
 */
export function StatGrid({ stats, columns = 4 }: StatGridProps) {
  return (
    <Grid cols={gridColumns[columns]} gap={3}>
      {stats.map((stat) => (
        <Card
          key={stat.key}
          className="min-w-0 space-y-1"
        >
          <Text as="p" variant="caption">
            {stat.label}
          </Text>
          <MetricValue
            className={`break-words tabular-nums ${toneClass[stat.tone ?? 'default']}`}
          >
            {stat.value}
          </MetricValue>
          {stat.hint ? (
            <Text as="p" variant="caption" className="mt-1">
              {stat.hint}
            </Text>
          ) : null}
        </Card>
      ))}
    </Grid>
  );
}
