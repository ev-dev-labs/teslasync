import { type ReactNode } from 'react';
import { Text } from '@/components/ui';

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

const columnClass: Record<2 | 3 | 4, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
};

/**
 * Headline KPI row. Values are pre-formatted by the caller so this component
 * never has to know whether it is rendering money, distance, or a percentage.
 */
export function StatGrid({ stats, columns = 4 }: StatGridProps) {
  return (
    <div className={`grid gap-3 ${columnClass[columns]}`}>
      {stats.map((stat) => (
        <div
          key={stat.key}
          className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4"
        >
          <Text as="p" variant="caption">
            {stat.label}
          </Text>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass[stat.tone ?? 'default']}`}
          >
            {stat.value}
          </p>
          {stat.hint ? (
            <Text as="p" variant="caption" className="mt-1">
              {stat.hint}
            </Text>
          ) : null}
        </div>
      ))}
    </div>
  );
}
