/**
 * Slow Queries Page — Phase-45 admin observability surface.
 *
 * Top-N slowest queries from pg_stat_statements with sortable order
 * (mean_time / total_time / calls / max_time) and a configurable
 * limit. Each row shows the fingerprint, call count, time stats, and
 * shared-buffer cache hit/read ratio so operators can spot the
 * difference between "slow but cached" and "slow because of I/O".
 *
 * Backed by GET /api/v1/admin/observability/slow-queries
 * (internal/handler/v1/admin_observability_handler.go).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Timer } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, DataTable, type Column } from '@/components/ui';
import { PanelTitle, Caption, Code } from '@/components/ui/Typography';
import { FadeIn } from '@/components/motion';
import { EmptyState, AlertBanner, SectionErrorBoundary } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { useSlowQueries } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import type {
  SlowQueryOrderBy,
  SlowQueryRow,
} from '@/types/admin-operator-confidence';

const ORDER_BY_OPTIONS: ReadonlyArray<{ value: SlowQueryOrderBy; labelKey: string; fallback: string }> = [
  { value: 'mean_time', labelKey: 'admin.slowQueries.orderMean', fallback: 'Mean time' },
  { value: 'total_time', labelKey: 'admin.slowQueries.orderTotal', fallback: 'Total time' },
  { value: 'calls', labelKey: 'admin.slowQueries.orderCalls', fallback: 'Calls' },
  { value: 'max_time', labelKey: 'admin.slowQueries.orderMax', fallback: 'Max time' },
];

const LIMIT_OPTIONS = [10, 25, 50, 100];

export default function SlowQueriesPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.slowQueries.pageTitle', 'Slow Queries'));

  const [orderBy, setOrderBy] = useState<SlowQueryOrderBy>('mean_time');
  const [limit, setLimit] = useState<number>(25);

  const query = useSlowQueries(orderBy, limit);
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;
  const rows = query.data?.slow_queries ?? [];

  const columns = useMemo<Column<SlowQueryRow>[]>(
    () => [
      {
        key: 'fingerprint',
        header: t('admin.slowQueries.colFingerprint', 'Query fingerprint'),
        render: (r) => (
          <Code className="block max-w-md truncate" title={r.fingerprint}>
            {r.fingerprint || '—'}
          </Code>
        ),
      },
      {
        key: 'calls',
        header: t('admin.slowQueries.colCalls', 'Calls'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{fmtNumber(r.calls)}</span>,
      },
      {
        key: 'mean_time_ms',
        header: t('admin.slowQueries.colMean', 'Mean (ms)'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{fmtNumber(r.mean_time_ms, 2)}</span>,
      },
      {
        key: 'max_time_ms',
        header: t('admin.slowQueries.colMax', 'Max (ms)'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{fmtNumber(r.max_time_ms, 2)}</span>,
      },
      {
        key: 'total_time_ms',
        header: t('admin.slowQueries.colTotal', 'Total (ms)'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{fmtNumber(r.total_time_ms, 0)}</span>,
      },
      {
        key: 'rows_returned',
        header: t('admin.slowQueries.colRows', 'Rows'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{fmtNumber(r.rows_returned)}</span>,
      },
      {
        key: 'cache',
        header: t('admin.slowQueries.colCache', 'Cache hit ratio'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{cacheHitRatio(r)}</span>,
      },
    ],
    [t],
  );

  return (
    <PageContainer
      title={t('admin.slowQueries.pageTitle', 'Slow Queries')}
      subtitle={t(
        'admin.slowQueries.subtitle',
        'Top queries from pg_stat_statements. Sort by mean time to surface the slowest individual calls, or total time to surface the costliest in aggregate.',
      )}
      query={query}
    >
      <FadeIn>
        <div className="space-y-6">
          {subsystemMissing && (
            <AlertBanner variant="warning" title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}>
              {t(
                'admin.slowQueries.notConfigured',
                'pg_stat_statements is not installed on this PostgreSQL instance. Run `CREATE EXTENSION pg_stat_statements;` and add it to shared_preload_libraries to enable this page.',
              )}
            </AlertBanner>
          )}

          <GlassPanel className="p-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
              <PanelTitle>{t('admin.slowQueries.tableTitle', 'Top queries')}</PanelTitle>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2">
                  <Caption>{t('admin.slowQueries.orderBy', 'Order by')}</Caption>
                  <Select
                    value={orderBy}
                    onChange={(e) => setOrderBy(e.target.value as SlowQueryOrderBy)}
                    options={ORDER_BY_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey, opt.fallback),
                    }))}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <Caption>{t('admin.slowQueries.limit', 'Limit')}</Caption>
                  <Select
                    value={String(limit)}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    options={LIMIT_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
                  />
                </label>
              </div>
            </div>
            <SectionErrorBoundary name="slow-queries-table">
              {rows.length === 0 && !query.isLoading && !subsystemMissing ? (
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
                  data={rows}
                  keyExtractor={(r) => r.query_id}
                  emptyMessage={t('admin.slowQueries.emptyTable', 'No slow queries')}
                />
              )}
            </SectionErrorBoundary>
          </GlassPanel>
        </div>
      </FadeIn>
    </PageContainer>
  );
}

function cacheHitRatio(row: SlowQueryRow): string {
  const hit = row.shared_blks_hit ?? 0;
  const read = row.shared_blks_read ?? 0;
  const total = hit + read;
  if (total <= 0) return '—';
  return `${fmtNumber((hit / total) * 100, 1)}%`;
}
