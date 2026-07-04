/**
 * DLQ Inspector — failure-reason breakdown.
 *
 * Derives a per-reason count from the same `useDLQList()` payload the
 * entries table consumes (no extra endpoint) and renders it as a compact
 * stack of `MetricBar`s so an operator can see *what* is failing at a
 * glance beside the row-level detail table.
 *
 * Self-sufficient states: loading → Skeleton, error → QueryError, empty →
 * EmptyState, else the bars. Colors come from the color-blind-safe
 * `chartTokens.series` palette so they stay consistent with every other
 * chart in the app.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListX } from 'lucide-react';

import { MetricBar } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
import type { DLQEntrySummary } from '@/types/admin-diagnostics';

interface ReasonBreakdownProps {
  rows: DLQEntrySummary[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

interface ReasonBucket {
  reason: string;
  count: number;
  color: string;
}

export function ReasonBreakdown({ rows, loading, error, onRetry }: ReasonBreakdownProps) {
  const { t } = useTranslation();

  const { buckets, total } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      const reason = row.parsed_reason?.trim() || t('admin.dlq.reasons.unknown', 'unknown');
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    const sorted: ReasonBucket[] = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count], i) => ({
        reason,
        count,
        color: chartTokens.series[i % chartTokens.series.length],
      }));
    const sum = sorted.reduce((acc, b) => acc + b.count, 0);
    return { buckets: sorted, total: sum };
  }, [rows, t]);

  if (error) {
    return <QueryError error={error} onRetry={onRetry} />;
  }

  if (loading && buckets.length === 0) {
    return <Skeleton height={200} />;
  }

  if (buckets.length === 0) {
    return (
      <EmptyState /* no-action: transient — surfaces only when the DLQ is empty, mirroring the entries table */
        icon={<ListX className="h-8 w-8" aria-hidden="true" />}
        message={t('admin.dlq.reasons.empty', 'No failed ingests — nothing to break down.')}
      />
    );
  }

  return (
    <ul
      className="space-y-3"
      aria-label={t('admin.dlq.reasons.listLabel', 'Failure reasons breakdown')}
    >
      {buckets.map((bucket) => (
        <li key={bucket.reason}>
          <MetricBar
            label={bucket.reason}
            value={bucket.count}
            max={total || bucket.count}
            color={bucket.color}
            sublabel={`${fmtInt(bucket.count)} · ${fmtPercent(
              total > 0 ? (bucket.count / total) * 100 : 0,
              0,
            )}`}
          />
        </li>
      ))}
    </ul>
  );
}
