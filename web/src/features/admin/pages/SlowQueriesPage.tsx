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
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Timer, Gauge, Repeat, Zap, Database, Layers, BarChart3, HardDrive,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, DataTable, type Column } from '@/components/ui';
import { PanelTitle, Caption, Code, Text } from '@/components/ui/Typography';
import { MetricCard, MetricBar } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import {
  EmptyState, AlertBanner, SectionErrorBoundary, Skeleton, QueryError,
} from '@/components/feedback';
import {
  ChartTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  CHART_COLORS,
} from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber, fmtInt, fmtCompact } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
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

/** Maps the sort control to the numeric field the chart ranks by. */
type MetricKey = 'mean_time_ms' | 'total_time_ms' | 'calls' | 'max_time_ms';
const ORDER_TO_METRIC: Record<SlowQueryOrderBy, MetricKey> = {
  mean_time: 'mean_time_ms',
  total_time: 'total_time_ms',
  calls: 'calls',
  max_time: 'max_time_ms',
};

// Chart/graphic-only hex — dynamic cache-tier fills, not static CSS vars.
const CACHE_GOOD_HEX = '#10b981';
const CACHE_WARN_HEX = '#f59e0b';
const CACHE_POOR_HEX = '#ef4444';

/** Format a millisecond duration, promoting to seconds past 1 s. */
function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms >= 1000) return `${fmtNumber(ms / 1000, 2)} s`;
  return `${fmtNumber(ms, ms < 10 ? 2 : 1)} ms`;
}

/** Clip long SQL fingerprints so axis ticks and bar labels stay one line. */
function shortFingerprint(value: string, max = 28): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Shared-buffer cache hit ratio (0–100) or null when no blocks were touched. */
function cacheHitRatioValue(row: SlowQueryRow): number | null {
  const hit = row.shared_blks_hit ?? 0;
  const read = row.shared_blks_read ?? 0;
  const total = hit + read;
  if (total <= 0) return null;
  return (hit / total) * 100;
}

/** Table-cell label form of the cache hit ratio. */
function cacheHitRatioLabel(row: SlowQueryRow): string {
  const v = cacheHitRatioValue(row);
  return v === null ? '—' : `${fmtNumber(v, 1)}%`;
}

/** Green (cached) → amber → red (I/O-bound) tier color for a hit ratio. */
function cacheColor(ratio: number): string {
  if (ratio >= 90) return CACHE_GOOD_HEX;
  if (ratio >= 50) return CACHE_WARN_HEX;
  return CACHE_POOR_HEX;
}

export default function SlowQueriesPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.slowQueries.pageTitle', 'Slow Queries'));

  const [orderBy, setOrderBy] = useState<SlowQueryOrderBy>('mean_time');
  const [limit, setLimit] = useState<number>(25);

  const query = useSlowQueries(orderBy, limit);
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;
  // A failed *background* refetch (after data has already loaded) leaves
  // `isError` true while TanStack Query keeps the last-good `data`. Gate the
  // error UI on `data === undefined` so a transient poll blip never blanks the
  // populated KPIs / chart / cache / table — mirrors IngestXRayPage's contract.
  const showError = query.isError && !subsystemMissing && query.data === undefined;
  const isLoading = query.isLoading;
  const rows = query.data?.slow_queries ?? [];
  const retry = () => query.refetch();

  const activeMetric = ORDER_TO_METRIC[orderBy];
  const isTimeMetric = activeMetric !== 'calls';
  const activeOption = ORDER_BY_OPTIONS.find((o) => o.value === orderBy) ?? ORDER_BY_OPTIONS[0];
  const activeMetricLabel = t(activeOption.labelKey, activeOption.fallback);

  const formatMetric = (v: number) => (isTimeMetric ? formatMs(v) : fmtInt(v));
  const axisFormat = (v: number) => (isTimeMetric ? formatMs(v) : fmtCompact(v));

  const totals = useMemo(() => {
    let calls = 0;
    let totalMs = 0;
    let rowsReturned = 0;
    let hit = 0;
    let read = 0;
    let maxMean = 0;
    let maxPeak = 0;
    for (const r of rows) {
      calls += r.calls ?? 0;
      totalMs += r.total_time_ms ?? 0;
      rowsReturned += r.rows_returned ?? 0;
      hit += r.shared_blks_hit ?? 0;
      read += r.shared_blks_read ?? 0;
      if ((r.mean_time_ms ?? 0) > maxMean) maxMean = r.mean_time_ms ?? 0;
      if ((r.max_time_ms ?? 0) > maxPeak) maxPeak = r.max_time_ms ?? 0;
    }
    const cacheTotal = hit + read;
    const cacheRatio = cacheTotal > 0 ? (hit / cacheTotal) * 100 : null;
    return { calls, totalMs, rowsReturned, cacheRatio, maxMean, maxPeak };
  }, [rows]);

  // Top slice ranked by the active metric — feeds the horizontal bar chart.
  const chartRows = useMemo(
    () => [...rows]
      .sort((a, b) => (b[activeMetric] ?? 0) - (a[activeMetric] ?? 0))
      .slice(0, 12)
      .map((r) => ({
        key: r.query_id,
        label: shortFingerprint(r.fingerprint),
        full: r.fingerprint || '—',
        value: r[activeMetric] ?? 0,
      })),
    [rows, activeMetric],
  );

  // Queries with shared-buffer stats, worst hit ratio first (I/O-bound =
  // strongest indexing candidates).
  const cacheLeaders = useMemo(
    () => rows
      .map((row) => ({ row, ratio: cacheHitRatioValue(row) }))
      .filter((x): x is { row: SlowQueryRow; ratio: number } => x.ratio !== null)
      .sort((a, b) => a.ratio - b.ratio)
      .slice(0, 8),
    [rows],
  );

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
        render: (r) => <span className="tabular-nums">{cacheHitRatioLabel(r)}</span>,
      },
    ],
    [t],
  );

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
    <PageContainer
      title={t('admin.slowQueries.pageTitle', 'Slow Queries')}
      subtitle={t(
        'admin.slowQueries.subtitle',
        'Top queries from pg_stat_statements. Sort by mean time to surface the slowest individual calls, or total time to surface the costliest in aggregate.',
      )}
      actions={actions}
      query={query}
    >
      {subsystemMissing && (
        <AlertBanner variant="warning" title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}>
          {t(
            'admin.slowQueries.notConfigured',
            'pg_stat_statements is not installed on this PostgreSQL instance. Run `CREATE EXTENSION pg_stat_statements;` and add it to shared_preload_libraries to enable this page.',
          )}
        </AlertBanner>
      )}

      {/* 1 — KPI band ---------------------------------------------------- */}
      <FadeIn>
        <section
          aria-label={t('admin.slowQueries.kpis', 'Query performance summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6"
        >
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={92} className="rounded-xl" />
            ))
          ) : showError ? (
            <div className="col-span-full">
              <QueryError
                error={query.error}
                onRetry={retry}
                resourceName={t('admin.slowQueries.pageTitle', 'Slow Queries')}
              />
            </div>
          ) : (
            <>
              <MetricCard
                label={t('admin.slowQueries.kpiAnalyzed', 'Queries analyzed')}
                value={fmtInt(rows.length)}
                icon={<Database className="h-5 w-5" aria-hidden="true" />}
                color="cyan"
                subtitle={t('admin.slowQueries.kpiAnalyzedSub', 'Top {{limit}} by {{metric}}', {
                  limit,
                  metric: activeMetricLabel,
                })}
              />
              <MetricCard
                label={t('admin.slowQueries.kpiCalls', 'Total calls')}
                value={fmtCompact(totals.calls)}
                icon={<Repeat className="h-5 w-5" aria-hidden="true" />}
                color="blue"
                subtitle={t('admin.slowQueries.kpiCallsSub', 'Across shown queries')}
              />
              <MetricCard
                label={t('admin.slowQueries.kpiTotalTime', 'Aggregate time')}
                value={formatMs(totals.totalMs)}
                icon={<Timer className="h-5 w-5" aria-hidden="true" />}
                color="amber"
                subtitle={t('admin.slowQueries.kpiTotalTimeSub', 'Summed total_time')}
              />
              <MetricCard
                label={t('admin.slowQueries.kpiSlowestMean', 'Slowest mean')}
                value={formatMs(totals.maxMean)}
                icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
                color="red"
                subtitle={t('admin.slowQueries.kpiSlowestMeanSub', 'Worst per-call average')}
              />
              <MetricCard
                label={t('admin.slowQueries.kpiPeak', 'Peak max')}
                value={formatMs(totals.maxPeak)}
                icon={<Zap className="h-5 w-5" aria-hidden="true" />}
                color="purple"
                subtitle={t('admin.slowQueries.kpiPeakSub', 'Slowest single call')}
              />
              <MetricCard
                label={t('admin.slowQueries.kpiCache', 'Cache hit ratio')}
                value={totals.cacheRatio === null ? '—' : `${fmtNumber(totals.cacheRatio, 1)}%`}
                icon={<Layers className="h-5 w-5" aria-hidden="true" />}
                color="green"
                subtitle={t('admin.slowQueries.kpiCacheSub', 'Shared-buffer hits')}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Ranking chart + cache efficiency ---------------------------- */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('admin.slowQueries.analysis', 'Query analysis')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.slowQueries.chartTitle', 'Top queries by {{metric}}', { metric: activeMetricLabel })}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={320} />
            ) : showError ? (
              <QueryError error={query.error} onRetry={retry} />
            ) : chartRows.length === 0 ? (
              <EmptyState /* no-action: pg_stat_statements populates as the system serves load */
                icon={<BarChart3 className="h-8 w-8" />}
                message={t('admin.slowQueries.noChart', 'No queries to chart yet.')}
              />
            ) : (
              <div
                className="h-72 sm:h-80"
                role="img"
                aria-label={t(
                  'admin.slowQueries.chartAria',
                  'Horizontal bar chart ranking the top queries by {{metric}}',
                  { metric: activeMetricLabel },
                )}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={chartRows} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                      tickFormatter={(v) => axisFormat(Number(v))}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={150}
                      tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                    />
                    <Tooltip
                      content={<ChartTooltip valueFormatter={(v) => formatMetric(Number(v))} />}
                      cursor={{ fill: 'var(--surface-2)', fillOpacity: 0.3 }}
                    />
                    <Bar dataKey="value" name={activeMetricLabel} radius={[0, 4, 4, 0]}>
                      {chartRows.map((d, i) => (
                        <Cell key={d.key} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.slowQueries.cacheTitle', 'Cache efficiency')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={260} />
            ) : showError ? (
              <QueryError error={query.error} onRetry={retry} />
            ) : cacheLeaders.length === 0 ? (
              <EmptyState /* no-action: shared-buffer stats accrue from Postgres, not user input */
                icon={<HardDrive className="h-8 w-8" />}
                message={t('admin.slowQueries.noCache', 'No shared-buffer statistics available for these queries.')}
              />
            ) : (
              <div className="space-y-3">
                <Text variant="helper">
                  {t(
                    'admin.slowQueries.cacheHint',
                    'Lowest hit ratios first — I/O-bound queries are the strongest indexing candidates.',
                  )}
                </Text>
                {cacheLeaders.map(({ row, ratio }) => (
                  <MetricBar
                    key={row.query_id}
                    label={shortFingerprint(row.fingerprint, 30)}
                    value={ratio}
                    max={100}
                    color={cacheColor(ratio)}
                    sublabel={`${fmtNumber(ratio, 1)}%`}
                  />
                ))}
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Per-query detail table ------------------------------------- */}
      <FadeIn delay={0.2}>
        <section aria-label={t('admin.slowQueries.tableTitle', 'Top queries')}>
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4">{t('admin.slowQueries.tableTitle', 'Top queries')}</PanelTitle>
            <SectionErrorBoundary name="slow-queries-table">
              {isLoading ? (
                <Skeleton height={280} />
              ) : showError ? (
                <QueryError error={query.error} onRetry={retry} />
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
                  data={rows}
                  keyExtractor={(r) => r.query_id}
                  emptyMessage={t('admin.slowQueries.emptyTable', 'No slow queries')}
                  pagination
                />
              )}
            </SectionErrorBoundary>
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
