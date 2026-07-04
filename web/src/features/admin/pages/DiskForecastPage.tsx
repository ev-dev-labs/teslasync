/**
 * Disk Forecast page.
 *
 * Per-hypertable disk usage with compressed/uncompressed split, growth
 * rate (bytes/day), and an estimate of days-to-quota when the deployment
 * configured `HYPERTABLE_QUOTA_BYTES`. Severity comes straight from the
 * backend so threshold tuning is a single Go ship.
 *
 * Modern-UI full-width bento: a KPI band, a storage-composition chart +
 * severity donut, a growth/quota outlook row, and a full-width detail
 * table. Every data section owns its loading / empty / error state.
 *
 * Backed by GET /api/v1/admin/observability/disk-forecast
 * (internal/handler/v1/admin_observability_handler.go).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Database, HardDrive, Archive, Boxes, TrendingUp, Gauge, Timer, ShieldAlert,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, DataTable, type Column } from '@/components/ui';
import { PanelTitle, Caption, Text } from '@/components/ui/Typography';
import { MetricCard, MetricBar } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import {
  EmptyState, AlertBanner, SectionErrorBoundary, Skeleton, QueryError,
} from '@/components/feedback';
import {
  ChartTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber, formatBytes } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
import { cn } from '@/lib/cn';
import { useDiskForecast } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import type {
  DiskForecastSeverity,
  HypertableSize,
} from '@/types/admin-operator-confidence';

const SEVERITY_VARIANT: Record<DiskForecastSeverity, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'success',
  warn: 'warning',
  critical: 'danger',
  unknown: 'neutral',
};

// Chart-only hex — dynamic fill values, not static CSS vars. `unknown`
// borrows the muted slate used across the app's neutral chips.
const SEVERITY_HEX: Record<DiskForecastSeverity, string> = {
  ok: '#10b981',
  warn: '#f59e0b',
  critical: '#ef4444',
  unknown: '#64748b',
};

const UNCOMPRESSED_HEX = '#f59e0b';
const COMPRESSED_HEX = '#10b981';
const SEVERITY_ORDER: DiskForecastSeverity[] = ['critical', 'warn', 'ok', 'unknown'];

/** Percentage of `part` within `whole`, or an em-dash when `whole` is zero. */
function pctOf(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—';
}

/** Clip long hypertable names so axis ticks and cards stay one line. */
function truncate(value: string, max = 18): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export default function DiskForecastPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.diskForecast.pageTitle', 'Disk Forecast'));

  const query = useDiskForecast();
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;
  const showError = query.isError && !subsystemMissing;
  const isLoading = query.isLoading;
  const rows = query.data?.hypertables ?? [];

  // Severity display labels resolved through i18n (module-level consts
  // can't call `t`); memoised so the columns/legend/list stay stable.
  const severityLabel = useMemo<Record<DiskForecastSeverity, string>>(
    () => ({
      ok: t('admin.diskForecast.severityOk', 'OK'),
      warn: t('admin.diskForecast.severityWarn', 'Warn'),
      critical: t('admin.diskForecast.severityCritical', 'Critical'),
      unknown: '—',
    }),
    [t],
  );

  const totals = useMemo(() => {
    const total = rows.reduce((acc, r) => acc + (r.total_bytes ?? 0), 0);
    const uncompressed = rows.reduce((acc, r) => acc + (r.uncompressed_bytes ?? 0), 0);
    const compressed = rows.reduce((acc, r) => acc + (r.compressed_bytes ?? 0), 0);
    const growth = rows.reduce((acc, r) => acc + (r.growth_bytes_per_day ?? 0), 0);
    return { total, uncompressed, compressed, growth };
  }, [rows]);

  const severityCounts = useMemo(() => {
    const c: Record<DiskForecastSeverity, number> = { ok: 0, warn: 0, critical: 0, unknown: 0 };
    for (const r of rows) c[r.severity] = (c[r.severity] ?? 0) + 1;
    return c;
  }, [rows]);

  const largest = useMemo(
    () => rows.reduce<HypertableSize | null>(
      (best, r) => (best === null || (r.total_bytes ?? 0) > (best.total_bytes ?? 0) ? r : best),
      null,
    ),
    [rows],
  );

  const soonest = useMemo(
    () => rows.reduce<HypertableSize | null>((best, r) => {
      const d = r.est_days_to_quota;
      if (d === null || d === undefined) return best;
      if (best === null || d < (best.est_days_to_quota ?? Infinity)) return r;
      return best;
    }, null),
    [rows],
  );

  const topBySize = useMemo(
    () => [...rows].sort((a, b) => (b.total_bytes ?? 0) - (a.total_bytes ?? 0)).slice(0, 10),
    [rows],
  );

  const growthLeaders = useMemo(
    () => [...rows]
      .filter((r) => (r.growth_bytes_per_day ?? 0) > 0)
      .sort((a, b) => (b.growth_bytes_per_day ?? 0) - (a.growth_bytes_per_day ?? 0))
      .slice(0, 8),
    [rows],
  );
  const maxGrowth = growthLeaders.length > 0 ? (growthLeaders[0].growth_bytes_per_day ?? 0) : 0;

  const quotaWatch = useMemo(
    () => rows
      .filter((r) => r.est_days_to_quota !== null && r.est_days_to_quota !== undefined)
      .sort((a, b) => (a.est_days_to_quota ?? 0) - (b.est_days_to_quota ?? 0)),
    [rows],
  );

  const severitySlices = useMemo(
    () => SEVERITY_ORDER
      .map((key) => ({ key, label: severityLabel[key], value: severityCounts[key] ?? 0 }))
      .filter((s) => s.value > 0),
    [severityCounts, severityLabel],
  );

  const columns = useMemo<Column<HypertableSize>[]>(
    () => [
      {
        key: 'hypertable',
        header: t('admin.diskForecast.colTable', 'Hypertable'),
        render: (r) => (
          <div className="flex flex-col">
            <Text weight="medium" color="primary">{r.hypertable_name}</Text>
            <Caption>
              {t('admin.diskForecast.chunkCount', '{{count}} chunks', { count: r.chunk_count ?? 0 })}
            </Caption>
          </div>
        ),
      },
      {
        key: 'total',
        header: t('admin.diskForecast.colTotal', 'Total'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{formatBytes(r.total_bytes ?? 0)}</span>,
      },
      {
        key: 'split',
        header: t('admin.diskForecast.colSplit', 'Uncompressed / compressed'),
        align: 'right',
        render: (r) => (
          <div className="text-right tabular-nums">
            <div>{formatBytes(r.uncompressed_bytes ?? 0)}</div>
            <Caption>
              {formatBytes(r.compressed_bytes ?? 0)} {t('admin.diskForecast.compressedSuffix', 'compressed')}
            </Caption>
          </div>
        ),
      },
      {
        key: 'growth',
        header: t('admin.diskForecast.colGrowth', 'Growth (per day)'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{formatBytes(r.growth_bytes_per_day ?? 0)}/d</span>,
      },
      {
        key: 'days',
        header: t('admin.diskForecast.colDays', 'Days to quota'),
        align: 'right',
        render: (r) => (
          <span className="tabular-nums">
            {r.est_days_to_quota === null || r.est_days_to_quota === undefined
              ? '—'
              : fmtNumber(r.est_days_to_quota)}
          </span>
        ),
      },
      {
        key: 'severity',
        header: t('admin.diskForecast.colSeverity', 'Severity'),
        align: 'right',
        render: (r) => (
          <Badge variant={SEVERITY_VARIANT[r.severity] ?? 'neutral'}>
            {severityLabel[r.severity] ?? r.severity}
          </Badge>
        ),
      },
    ],
    [t, severityLabel],
  );

  const retry = () => query.refetch();

  return (
    <PageContainer
      title={t('admin.diskForecast.pageTitle', 'Disk Forecast')}
      subtitle={t(
        'admin.diskForecast.subtitle',
        'Per-hypertable disk usage with compressed/uncompressed split and days-to-quota estimate. Severity reflects the configured quota threshold.',
      )}
      query={query}
    >
      {subsystemMissing && (
        <AlertBanner variant="warning" title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}>
          {t(
            'admin.diskForecast.notConfigured',
            'TimescaleDB hypertable metrics are unavailable on this deployment. This page requires TimescaleDB to be installed and accessible.',
          )}
        </AlertBanner>
      )}

      {severityCounts.critical > 0 && (
        <AlertBanner variant="danger" title={t('admin.diskForecast.criticalTitle', 'Quota pressure')}>
          {t(
            'admin.diskForecast.criticalMessage',
            '{{count}} hypertable(s) are in the critical tier for their configured quota. Review retention, compression, or the quota threshold.',
            { count: severityCounts.critical },
          )}
        </AlertBanner>
      )}

      {/* 1 — KPI band ---------------------------------------------------- */}
      <FadeIn>
        <section
          aria-label={t('admin.diskForecast.kpis', 'Fleet disk summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6"
        >
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={92} className="rounded-xl" />
            ))
          ) : showError ? (
            // A genuine (non-503) fetch failure must not surface fabricated
            // zero totals — mirror the error state the sections below own so
            // the whole band reads as "failed", not "0 B on disk".
            <div className="col-span-full">
              <QueryError error={query.error} onRetry={retry} />
            </div>
          ) : (
            <>
              <MetricCard
                label={t('admin.diskForecast.fleetTotal', 'Total disk')}
                value={formatBytes(totals.total)}
                icon={<Database className="h-5 w-5" />}
                color="cyan"
                subtitle={t('admin.diskForecast.tableCount', '{{count}} hypertables', { count: rows.length })}
              />
              <MetricCard
                label={t('admin.diskForecast.fleetUncompressed', 'Uncompressed')}
                value={formatBytes(totals.uncompressed)}
                icon={<HardDrive className="h-5 w-5" />}
                color="amber"
                subtitle={t('admin.diskForecast.percentSub', '{{pct}} of total', { pct: pctOf(totals.uncompressed, totals.total) })}
              />
              <MetricCard
                label={t('admin.diskForecast.fleetCompressed', 'Compressed')}
                value={formatBytes(totals.compressed)}
                icon={<Archive className="h-5 w-5" />}
                color="green"
                subtitle={t('admin.diskForecast.percentSub', '{{pct}} of total', { pct: pctOf(totals.compressed, totals.total) })}
              />
              <MetricCard
                label={t('admin.diskForecast.fleetGrowth', 'Growth (per day)')}
                value={`${formatBytes(totals.growth)}/d`}
                icon={<TrendingUp className="h-5 w-5" />}
                color="blue"
                subtitle={t('admin.diskForecast.growthSub', 'Sum across all hypertables')}
              />
              <MetricCard
                label={t('admin.diskForecast.largest', 'Largest table')}
                value={largest ? formatBytes(largest.total_bytes ?? 0) : '—'}
                icon={<Boxes className="h-5 w-5" />}
                color="purple"
                subtitle={largest ? truncate(largest.hypertable_name) : t('admin.diskForecast.noData', 'No data')}
              />
              <MetricCard
                label={t('admin.diskForecast.soonestQuota', 'Soonest quota')}
                value={soonest ? `${fmtNumber(soonest.est_days_to_quota ?? 0)} d` : '—'}
                icon={<Gauge className="h-5 w-5" />}
                color={soonest && soonest.severity === 'critical' ? 'red' : 'cyan'}
                subtitle={soonest ? truncate(soonest.hypertable_name) : t('admin.diskForecast.noQuota', 'No quota configured')}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Composition + severity ------------------------------------- */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('admin.diskForecast.composition', 'Storage composition')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.diskForecast.compositionTitle', 'Compressed vs uncompressed')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={320} />
            ) : showError ? (
              <QueryError error={query.error} onRetry={retry} />
            ) : topBySize.length === 0 ? (
              <EmptyState /* no-action: composition renders once hypertables report sizes */
                icon={<HardDrive className="h-8 w-8" />}
                message={t('admin.diskForecast.noComposition', 'No hypertable sizes to chart yet.')}
              />
            ) : (
              <div
                className="h-72 sm:h-80"
                role="img"
                aria-label={t('admin.diskForecast.compositionAria', 'Stacked bar chart of the largest hypertables split by uncompressed and compressed bytes')}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={topBySize} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                      tickFormatter={(v) => formatBytes(Number(v))}
                    />
                    <YAxis
                      type="category"
                      dataKey="hypertable_name"
                      width={132}
                      tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                      tickFormatter={(v) => truncate(String(v))}
                    />
                    <Tooltip content={<ChartTooltip />} formatter={(v) => formatBytes(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="uncompressed_bytes"
                      name={t('admin.diskForecast.uncompressed', 'Uncompressed')}
                      stackId="a"
                      fill={UNCOMPRESSED_HEX}
                      fillOpacity={0.85}
                    />
                    <Bar
                      dataKey="compressed_bytes"
                      name={t('admin.diskForecast.compressed', 'Compressed')}
                      stackId="a"
                      fill={COMPRESSED_HEX}
                      fillOpacity={0.85}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.diskForecast.severityTitle', 'Severity mix')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={220} />
            ) : showError ? (
              <QueryError error={query.error} onRetry={retry} />
            ) : severitySlices.length === 0 ? (
              <EmptyState /* no-action: severity is derived from backend thresholds */
                icon={<ShieldAlert className="h-8 w-8" />}
                message={t('admin.diskForecast.noSeverity', 'No severity data available yet.')}
              />
            ) : (
              <div className="space-y-4">
                <div
                  className="h-44"
                  role="img"
                  aria-label={t('admin.diskForecast.severityAria', 'Donut chart of hypertables grouped by quota severity tier')}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={severitySlices}
                        dataKey="value"
                        nameKey="label"
                        innerRadius={48}
                        outerRadius={72}
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {severitySlices.map((s) => (
                          <Cell key={s.key} fill={SEVERITY_HEX[s.key]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="space-y-1.5">
                  {SEVERITY_ORDER.map((key) => (
                    <li key={key} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: SEVERITY_HEX[key] }}
                          aria-hidden="true"
                        />
                        <Text variant="bodySm">{severityLabel[key]}</Text>
                      </span>
                      <Badge variant={SEVERITY_VARIANT[key]} size="sm">
                        {fmtNumber(severityCounts[key] ?? 0)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Growth & quota outlook ------------------------------------- */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('admin.diskForecast.outlook', 'Growth and quota outlook')}
          className="grid grid-cols-1 gap-4 2xl:grid-cols-2 xl:gap-5"
        >
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.diskForecast.growthTitle', 'Fastest-growing hypertables')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={200} />
            ) : showError ? (
              <QueryError error={query.error} onRetry={retry} />
            ) : growthLeaders.length === 0 ? (
              <EmptyState /* no-action: growth appears once tables accrue daily deltas */
                icon={<TrendingUp className="h-8 w-8" />}
                message={t('admin.diskForecast.noGrowth', 'No measurable daily growth yet.')}
              />
            ) : (
              <div className="space-y-3">
                {growthLeaders.map((r) => (
                  <MetricBar
                    key={r.hypertable_name}
                    label={truncate(r.hypertable_name, 28)}
                    value={r.growth_bytes_per_day ?? 0}
                    max={maxGrowth || (r.growth_bytes_per_day ?? 1)}
                    color={SEVERITY_HEX[r.severity] ?? SEVERITY_HEX.unknown}
                    sublabel={`${formatBytes(r.growth_bytes_per_day ?? 0)}/d`}
                  />
                ))}
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Timer className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.diskForecast.quotaTitle', 'Days to quota')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={200} />
            ) : showError ? (
              <QueryError error={query.error} onRetry={retry} />
            ) : quotaWatch.length === 0 ? (
              <EmptyState /* no-action: quota watch requires HYPERTABLE_QUOTA_BYTES to be configured */
                icon={<Gauge className="h-8 w-8" />}
                title={t('admin.diskForecast.noQuotaTitle', 'No quota configured')}
                message={t(
                  'admin.diskForecast.noQuotaMessage',
                  'Set HYPERTABLE_QUOTA_BYTES to surface a days-to-quota estimate for each hypertable.',
                )}
              />
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {quotaWatch.map((r) => (
                  <li key={r.hypertable_name} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Text variant="body" className="block truncate">{r.hypertable_name}</Text>
                      <Caption>{formatBytes(r.total_bytes ?? 0)} · {formatBytes(r.growth_bytes_per_day ?? 0)}/d</Caption>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Text size="sm" weight="semibold" className={cn('tabular-nums', r.severity === 'critical' ? 'text-rose-300' : 'text-[var(--text-primary)]')}>
                        {t('admin.diskForecast.daysValue', '{{days}} d', { days: fmtNumber(r.est_days_to_quota ?? 0) })}
                      </Text>
                      <Badge variant={SEVERITY_VARIANT[r.severity] ?? 'neutral'} size="sm">
                        {severityLabel[r.severity] ?? r.severity}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 4 — Per-hypertable detail table -------------------------------- */}
      <FadeIn delay={0.3}>
        <section aria-label={t('admin.diskForecast.tableTitle', 'Hypertables')}>
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4">{t('admin.diskForecast.tableTitle', 'Hypertables')}</PanelTitle>
            <SectionErrorBoundary name="disk-forecast-table">
              {isLoading ? (
                <Skeleton height={280} />
              ) : showError ? (
                <QueryError error={query.error} onRetry={retry} />
              ) : rows.length === 0 && !subsystemMissing ? (
                <EmptyState /* no-action: hypertable inventory is TimescaleDB system state; not user-creatable */
                  icon={<Database className="h-8 w-8" />}
                  title={t('admin.diskForecast.emptyTitle', 'No hypertables')}
                  message={t(
                    'admin.diskForecast.emptyMessage',
                    'No hypertables found in this database. The disk forecast surfaces TimescaleDB hypertables only.',
                  )}
                />
              ) : (
                <DataTable
                  tableId="admin:disk-forecast"
                  columns={columns}
                  data={rows}
                  keyExtractor={(r) => r.hypertable_name}
                  emptyMessage={t('admin.diskForecast.emptyTable', 'No hypertables')}
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
