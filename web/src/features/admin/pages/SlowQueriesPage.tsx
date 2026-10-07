/**
 * Slow Queries page for admin observability.
 *
 * Top-N slowest queries from pg_stat_statements with sortable order
 * (mean_time / total_time / calls / max_time) and a configurable
 * limit. Each row shows the fingerprint, call count, time stats, and
 * shared-buffer cache hit/read ratio so operators can spot the
 * difference between "slow but cached" and "slow because of I/O".
 *
 * Modern-UI full-width bento: a KPI band derived from the fetched
 * rows, a top-queries ranking chart beside a cache-efficiency panel,
 * and a full-width detail table. Every data section owns its
 * loading / empty / error state. The order-by + limit controls live
 * in the page header and drive the single hook the whole page reads.
 *
 * Backed by GET /api/v1/admin/observability/slow-queries
 * (internal/handler/v1/admin_observability_handler.go).
 */
import { PageLayout } from '@/components/layout';
import { Select } from '@/components/ui';
import { Caption } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { DataStateNotice } from '@/components/feedback';
import type { SlowQueryOrderBy } from '@/types/admin-operator-confidence';
import { SlowQueryAnalysis } from '../components/continuation-admin-1/SlowQueryAnalysis';
import { SlowQuerySummary } from '../components/continuation-admin-1/SlowQuerySummary';
import { useSlowQueriesPage } from '../hooks/useSlowQueriesPage';
import { SlowQueriesDetails } from '../components/structural-closure/slow-queries/SlowQueriesDetails';
import { ORDER_BY_OPTIONS, LIMIT_OPTIONS } from '../components/structural-closure/slow-queries/helpers';

export default function SlowQueriesPage() {
  const controller = useSlowQueriesPage();
  const { t, orderBy, setOrderBy, limit, setLimit, query, queryState, subsystemMissing, showError, isLoading, rows, retry, activeMetricLabel, formatMetric, axisFormat, totals, chartRows, cacheLeaders } = controller;
  const actions = (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2">
        <Caption>{t('admin.slowQueries.orderBy', 'Order by')}</Caption>
        <Select
          size="sm"
          aria-label={t('admin.slowQueries.orderBy', 'Order by')}
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
          size="sm"
          aria-label={t('admin.slowQueries.limit', 'Limit')}
          value={String(limit)}
          onChange={(e) => setLimit(Number(e.target.value))}
          options={LIMIT_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
        />
      </label>
    </div>
  );
  return (
    <PageLayout
      title={t('admin.slowQueries.pageTitle', 'Slow queries')}
      subtitle={t(
        'admin.slowQueries.subtitle',
        'Top queries from pg_stat_statements. Sort by mean time to surface the slowest individual calls, or total time to surface the costliest in aggregate.',
      )}
      contextActions={actions}
      query={query}
      dataSources={!subsystemMissing
        ? [{ id: 'slow-queries', label: t('admin.slowQueries.pageTitle', 'Slow queries'), query }]
        : undefined}
    >
      {subsystemMissing && (
        <DataStateNotice state="unsupported" title={t('admin.subsystem.unsupportedTitle', 'Feature not supported')}>
          {t(
            'admin.slowQueries.notConfigured',
            'pg_stat_statements is not installed on this PostgreSQL instance. Run `CREATE EXTENSION pg_stat_statements;` and add it to shared_preload_libraries to enable this page.',
          )}
        </DataStateNotice>
      )}

      {/* 1 — KPI band ---------------------------------------------------- */}
      <FadeIn>
        <SlowQuerySummary count={rows.length} totals={totals} limit={limit}
          metricLabel={activeMetricLabel} known={queryState.hasData} loading={isLoading}
          retained={queryState.hasData && (queryState.status === 'stale' || queryState.isRefreshing)}
          error={showError ? queryState.fatalError : null} onRetry={retry} />
      </FadeIn>

      {/* 2 — Ranking chart + cache efficiency ---------------------------- */}
      <FadeIn delay={0.1}>
        <SlowQueryAnalysis chartRows={chartRows} cacheLeaders={cacheLeaders}
          metricLabel={activeMetricLabel} loading={isLoading}
          error={showError ? queryState.fatalError : null} onRetry={retry}
          formatMetric={formatMetric} axisFormat={axisFormat} />
      </FadeIn>

      <SlowQueriesDetails controller={controller} />
    </PageLayout>
  );
}
