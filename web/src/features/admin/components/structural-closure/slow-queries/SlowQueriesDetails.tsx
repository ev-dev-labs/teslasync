import { useMemo } from 'react';
import { Timer } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { DataTable, type Column } from '@/components/ui';
import { Code } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { EmptyState, SectionErrorBoundary, Skeleton, QueryError } from '@/components/feedback';
import type { SlowQueryRow } from '@/types/admin-operator-confidence';
import type { useSlowQueriesPage } from '../../../hooks/useSlowQueriesPage';
import { cacheHitRatioLabel } from './helpers';

type Props = { controller: ReturnType<typeof useSlowQueriesPage> };

export function SlowQueriesDetails({ controller }: Props) {
  const { fmtInt, fmtNumber, displayPrecision, displayLocale, t, queryState, subsystemMissing, showError, isLoading, rows, retry } = controller;
  const columns = useMemo<Column<SlowQueryRow>[]>(
    () => [
      {
        key: 'fingerprint',
        filterValue: (r) => r.fingerprint || null,
        header: t('admin.slowQueries.colFingerprint', 'Query fingerprint'),
        render: (r) => (
          <Code className="block max-w-md break-words [overflow-wrap:anywhere]" title={r.fingerprint}>
            {r.fingerprint || '—'}
          </Code>
        ),
      },
      {
        key: 'calls',
        filterValue: (r) => r.calls ?? null,
        filterValueLabel: (_value, r) => fmtInt(r.calls),
        header: t('admin.slowQueries.colCalls', 'Calls'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{fmtInt(r.calls)}</span>,
      },
      {
        key: 'mean_time_ms',
        filterValue: (r) => r.mean_time_ms ?? null,
        filterValueLabel: (_value, r) => fmtNumber(r.mean_time_ms),
        groupStart: true,
        header: t('admin.slowQueries.colMean', 'Mean (ms)'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{fmtNumber(r.mean_time_ms)}</span>,
      },
      {
        key: 'max_time_ms',
        filterValue: (r) => r.max_time_ms ?? null,
        filterValueLabel: (_value, r) => fmtNumber(r.max_time_ms),
        header: t('admin.slowQueries.colMax', 'Max (ms)'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{fmtNumber(r.max_time_ms)}</span>,
      },
      {
        key: 'total_time_ms',
        filterValue: (r) => r.total_time_ms ?? null,
        filterValueLabel: (_value, r) => fmtNumber(r.total_time_ms),
        header: t('admin.slowQueries.colTotal', 'Total (ms)'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{fmtNumber(r.total_time_ms)}</span>,
      },
      {
        key: 'rows_returned',
        filterValue: (r) => r.rows_returned ?? null,
        filterValueLabel: (_value, r) => fmtInt(r.rows_returned),
        header: t('admin.slowQueries.colRows', 'Rows'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{fmtInt(r.rows_returned)}</span>,
      },
      {
        key: 'cache',
        header: t('admin.slowQueries.colCache', 'Cache hit ratio'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{cacheHitRatioLabel(r)}</span>,
      },
    ],
    [t, fmtNumber, fmtInt, displayPrecision, displayLocale],
  );

  return (
<FadeIn delay={0.2}>
        <section aria-label={t('admin.slowQueries.tableTitle', 'Top queries')}>
          <LayoutCard title={t('admin.slowQueries.tableTitle', 'Top queries')}>
            <SectionErrorBoundary name="slow-queries-table">
              {isLoading ? (
                <Skeleton height={280} />
              ) : showError ? (
                <QueryError error={queryState.fatalError} onRetry={retry} />
              ) : rows.length === 0 && !subsystemMissing ? (
                // no-action: pg_stat_statements is populated by Postgres itself; users cannot seed rows from the UI
                <EmptyState
                  icon={<Timer className="h-8 w-8" />}
                  title={t('admin.slowQueries.emptyTitle', 'No slow queries')}
                  message={t(
                    'admin.slowQueries.emptyMessage',
                    'pg_stat_statements is empty or has been reset recently. Slow queries will accumulate here as the system processes load.',
                  )}
                />
              ) : (
                <DataTable
                  tableId="admin:slow-queries"
                  columns={columns}
                  mobileColumns={['fingerprint', 'mean_time_ms', 'calls']}
                  data={rows}
                  enableValueFilters
                  keyExtractor={(r) => r.query_id}
                  emptyMessage={t('admin.slowQueries.emptyTable', 'No slow queries')}
                  pagination
                />
              )}
            </SectionErrorBoundary>
          </LayoutCard>
        </section>
      </FadeIn>
  );
}
