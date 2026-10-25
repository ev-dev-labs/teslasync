import { Icons } from '@/lib/icons';
/**
 * Disk Forecast page.
 *
 * Current per-hypertable disk usage, before/after compression sizes,
 * growth rate (bytes/day), and any source-supplied days-to-quota estimate.
 * Compression sizes describe compressed chunks, not additive current usage.
 * Severity comes straight from the backend.
 *
 * Modern-UI full-width bento: a KPI band, a compression-comparison chart +
 * severity donut, a growth/quota outlook row, and a full-width detail
 * table. Every data section owns its loading / empty / error state.
 *
 * Backed by GET /api/v1/admin/observability/disk-forecast
 * (internal/handler/v1/admin_observability_handler.go).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageLayout, LayoutCard } from '@/components/layout';
import { Badge, DataTable, Icon, type Column } from '@/components/ui';
import { Caption, Text } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import {
  EmptyState, AlertBanner, DataStateNotice, SectionErrorBoundary, Skeleton, QueryError,
} from '@/components/feedback';
import {
  ChartTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ChartLegend, ResponsiveContainer,
  PieChart, Pie, Cell,
  EmbeddedChart, axisTick,
} from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';

import { chartTokens, gaugeTone, severityTokens, typography } from '@/lib/tokens';
import { cn } from '@/lib/cn';
import { getChartFontFamily, getChartFontSize } from '@/lib/chartTypography';
import { useDiskForecast } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import type {
  DiskForecastSeverity,
  HypertableSize,
} from '@/types/admin-operator-confidence';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { deriveDataState } from '@/api/dataState';
import { useChartPalette } from '@/hooks/useChartPalette';
import { DiskForecastSummary } from '../components/statstrip-performance-storage/DiskForecastSummary';

const SEVERITY_VARIANT: Record<DiskForecastSeverity, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'success',
  warn: 'warning',
  critical: 'danger',
  unknown: 'neutral',
};

const SEVERITY_COLOR: Record<DiskForecastSeverity, string> = {
  ok: gaugeTone.success,
  warn: gaugeTone.warning,
  critical: gaugeTone.danger,
  unknown: gaugeTone.neutral,
};
const SEVERITY_DOT: Record<DiskForecastSeverity, string> = {
  ok: severityTokens.success.dot,
  warn: severityTokens.warn.dot,
  critical: severityTokens.critical.dot,
  unknown: 'bg-[var(--text-secondary)]',
};

const SEVERITY_ORDER: DiskForecastSeverity[] = ['critical', 'warn', 'ok', 'unknown'];

/** Clip long hypertable names so axis ticks and cards stay one line. */
function truncate(value: string, max = 18): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export default function DiskForecastPage() {
  const { formatBytes, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const palette = useChartPalette();
  const [expandedKeys, setExpandedKeys] = useState<Array<string | number>>([]);
  usePageTitle(t('admin.diskForecast.pageTitle', 'Disk forecast'));

  const query = useDiskForecast();
  const source = deriveDataState(query);
  const subsystemMissing = isApiError(source.fatalError) && source.fatalError.status === 503;
  const showError = source.fatalError !== null && !subsystemMissing;
  const isLoading = source.status === 'initial';
  const rows = query.data?.hypertables ?? [];

  // Severity display labels resolved through i18n (module-level consts
  // can't call `t`); memoised so the columns/legend/list stay stable.
  const severityLabel = useMemo<Record<DiskForecastSeverity, string>>(
    () => ({
      ok: t('admin.diskForecast.severityOk', 'OK'),
      warn: t('admin.diskForecast.severityWarn', 'Warn'),
      critical: t('admin.diskForecast.severityCritical', 'Critical'),
      unknown: t('common.unknown', 'Unknown'),
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
  const topBySizeChartRows = useMemo(
    () => topBySize.map(({ hypertable_name, uncompressed_bytes, compressed_bytes }) => ({
      hypertable_name,
      uncompressed_bytes,
      compressed_bytes,
    })),
    [topBySize],
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
        filterValue: (r) => r.hypertable_name ?? null,
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
        filterValue: (r) => r.total_bytes ?? null,
        filterValueLabel: (_value, r) => r.total_bytes == null ? '—' : formatBytes(r.total_bytes),
        groupStart: true,
        header: t('admin.diskForecast.colTotal', 'Total'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{formatBytes(r.total_bytes ?? 0)}</span>,
      },
      {
        key: 'split',
        header: t('admin.diskForecast.colSplit', 'Before / after compression'),
        align: 'right',
        render: (r) => (
          <div className="text-right tabular-nums">
            <div>{formatBytes(r.uncompressed_bytes ?? 0)}</div>
            <Caption>
              {formatBytes(r.compressed_bytes ?? 0)} {t('admin.diskForecast.compressedSuffix', 'after compression')}
            </Caption>
          </div>
        ),
      },
      {
        key: 'growth',
        filterValue: (r) => r.growth_bytes_per_day ?? null,
        filterValueLabel: (_value, r) => r.growth_bytes_per_day == null ? '—' : `${formatBytes(r.growth_bytes_per_day)}/d`,
        header: t('admin.diskForecast.colGrowth', 'Growth (per day)'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{formatBytes(r.growth_bytes_per_day ?? 0)}/d</span>,
      },
      {
        key: 'days',
        filterValue: (r) => r.est_days_to_quota ?? null,
        filterValueLabel: (_value, r) => r.est_days_to_quota == null ? '—' : fmtNumber(r.est_days_to_quota),
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
        filterValue: (r) => r.severity ?? null,
        filterValueLabel: (_value, r) => severityLabel[r.severity] ?? r.severity,
        header: t('admin.diskForecast.colSeverity', 'Severity'),
        align: 'right',
        render: (r) => (
          <Badge variant={SEVERITY_VARIANT[r.severity] ?? 'neutral'}>
            {severityLabel[r.severity] ?? r.severity}
          </Badge>
        ),
      },
    ],
    [t, severityLabel, formatBytes, fmtNumber],
  );

  const retry = () => query.refetch();
  const unmeasuredMessage = t(
    'dataSources.unavailableMessage',
    'No requested source has returned usable data yet.',
  );

  return (
    <PageLayout
      title={t('admin.diskForecast.pageTitle', 'Disk forecast')}
      subtitle={t(
        'admin.diskForecast.subtitle',
        'Current per-hypertable disk usage, before/after compression sizes for compressed chunks, and source-supplied days-to-quota estimates. Compression sizes are not additive parts of current disk usage.',
      )}
      query={query}
      dataSources={[{
        id: 'disk-forecast',
        label: t('admin.diskForecast.pageTitle', 'Disk forecast'),
        query,
      }]}
    >
      {subsystemMissing && (
        <DataStateNotice state="unsupported" title={t('admin.subsystem.unsupportedTitle', 'Feature not supported')}>
          {t(
            'admin.diskForecast.notConfigured',
            'TimescaleDB hypertable metrics are unavailable on this deployment. This page requires TimescaleDB to be installed and accessible.',
          )}
        </DataStateNotice>
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
        <DiskForecastSummary totals={totals} count={rows.length} largest={largest} soonest={soonest}
          known={source.hasData} loading={source.status === 'initial'}
          retained={source.hasData && (source.status === 'stale' || source.isRefreshing)}
          error={showError ? source.fatalError : null} onRetry={retry} />
      </FadeIn>

      {/* 2 — Compression comparison + severity --------------------------- */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('admin.diskForecast.composition', 'Compression size comparison')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <div className="min-w-0 xl:col-span-2">
          <LayoutCard title={t('admin.diskForecast.compositionTitle', 'Before vs after compression')}>
            <EmbeddedChart
              chartKey="admin-disk-composition"
              title={t('admin.diskForecast.compositionTitle', 'Before vs after compression')}
              ariaLabel={t('admin.diskForecast.compositionAria', 'Grouped bar chart comparing before and after compression sizes of compressed chunks in the largest hypertables')}
              loading={isLoading}
              error={showError ? (query.error ?? undefined) : undefined}
              onRetry={retry}
              empty={!isLoading && !showError && topBySize.length === 0}
              emptyMessage={source.hasData
                ? t('admin.diskForecast.noComposition', 'No hypertable sizes to chart yet.')
                : t('admin.operationalBrief.unmeasured', 'Not measured')}
              data={topBySizeChartRows}
              dataColumns={[
                { key: 'hypertable_name', label: t('admin.diskForecast.colTable', 'Hypertable') },
                { key: 'uncompressed_bytes', label: t('admin.diskForecast.uncompressed', 'Before compression'), format: (v) => formatBytes(Number(v)) },
                { key: 'compressed_bytes', label: t('admin.diskForecast.compressed', 'After compression'), format: (v) => formatBytes(Number(v)) },
              ]}
            >
              {({ hiddenSeries }) => (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={topBySize} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ ...axisTick, fontSize: getChartFontSize(12), fontFamily: getChartFontFamily() }}
                      tickFormatter={(v) => formatBytes(Number(v))}
                    />
                    <YAxis
                      type="category"
                      dataKey="hypertable_name"
                      width={132}
                      tick={{ ...axisTick, fontSize: getChartFontSize(12), fontFamily: getChartFontFamily() }}
                      tickFormatter={(v) => truncate(String(v))}
                    />
                    <Tooltip content={<ChartTooltip />} formatter={(v) => formatBytes(Number(v))} />
                    <ChartLegend />
                    <Bar
                      dataKey="uncompressed_bytes"
                      name={t('admin.diskForecast.uncompressed', 'Before compression')}
                      fill={palette[0]}
                      fillOpacity={0.85}
                      hide={hiddenSeries?.isHidden('uncompressed_bytes') ?? false}
                    />
                    <Bar
                      dataKey="compressed_bytes"
                      name={t('admin.diskForecast.compressed', 'After compression')}
                      fill={palette[1]}
                      fillOpacity={0.85}
                      radius={[0, 4, 4, 0]}
                      hide={hiddenSeries?.isHidden('compressed_bytes') ?? false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </EmbeddedChart>
          </LayoutCard>
          </div>

          <LayoutCard title={t('admin.diskForecast.severityTitle', 'Severity mix')}>
            <div className="space-y-4">
              <EmbeddedChart
                title={t('admin.diskForecast.severityTitle', 'Severity mix')}
                ariaLabel={t('admin.diskForecast.severityAria', 'Donut chart of hypertables grouped by quota severity tier')}
                loading={isLoading}
                error={showError ? (query.error ?? undefined) : undefined}
                onRetry={retry}
                empty={!isLoading && !showError && severitySlices.length === 0}
                emptyMessage={source.hasData
                  ? t('admin.diskForecast.noSeverity', 'No severity data available yet.')
                  : t('admin.operationalBrief.unmeasured', 'Not measured')}
                data={severitySlices}
                dataColumns={[
                  { key: 'label', label: t('admin.diskForecast.col.severity', 'Severity') },
                  { key: 'value', label: t('admin.diskForecast.col.count', 'Count') },
                ]}
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
                        <Cell key={s.key} fill={SEVERITY_COLOR[s.key]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </EmbeddedChart>
              {!isLoading && !showError && severitySlices.length > 0 && (
                <ul className="space-y-1.5">
                  {SEVERITY_ORDER.map((key) => (
                    <li key={key} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn('inline-block h-2.5 w-2.5 rounded-full', SEVERITY_DOT[key])}
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
              )}
            </div>
          </LayoutCard>
        </section>
      </FadeIn>

      {/* 3 — Growth & quota outlook ------------------------------------- */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('admin.diskForecast.outlook', 'Growth and quota outlook')}
          className="grid grid-cols-1 gap-4 2xl:grid-cols-2 xl:gap-5"
        >
          <LayoutCard title={t('admin.diskForecast.growthTitle', 'Fastest-growing hypertables')}>
            {isLoading ? (
              <Skeleton height={200} />
            ) : showError ? (
              <QueryError error={query.error} onRetry={retry} />
            ) : !source.hasData ? (
              <Text as="p" variant="bodySm" color="secondary">{unmeasuredMessage}</Text>
            ) : growthLeaders.length === 0 ? (
              <EmptyState /* no-action: growth appears once tables accrue daily deltas */
                icon={<Icon icon={Icons.trendUp} size="xl" />}
                message={t('admin.diskForecast.noGrowth', 'No measurable daily growth yet.')}
              />
            ) : (
              <div className="space-y-3">
                {growthLeaders.map((r) => (
                  <MetricBar
                    key={r.hypertable_name}
                    label={r.hypertable_name}
                    value={r.growth_bytes_per_day ?? 0}
                    max={maxGrowth || (r.growth_bytes_per_day ?? 1)}
                    color={SEVERITY_COLOR[r.severity] ?? SEVERITY_COLOR.unknown}
                    fill="solid"
                    sublabel={`${formatBytes(r.growth_bytes_per_day ?? 0)}/d`}
                  />
                ))}
              </div>
            )}
          </LayoutCard>

          <LayoutCard title={t('admin.diskForecast.quotaTitle', 'Days to quota')}>
            {isLoading ? (
              <Skeleton height={200} />
            ) : showError ? (
              <QueryError error={query.error} onRetry={retry} />
            ) : !source.hasData ? (
              <Text as="p" variant="bodySm" color="secondary">{unmeasuredMessage}</Text>
            ) : quotaWatch.length === 0 ? (
              <EmptyState /* no-action: the source has supplied no quota estimate */
                icon={<Icon icon={Icons.speed} size="xl" />}
                title={t('admin.diskForecast.noQuotaTitle', 'No quota estimate available')}
                message={t(
                  'admin.diskForecast.noQuotaMessage',
                  'An estimate may be absent when there is no measurable growth. Missing estimates do not establish whether a quota is configured.',
                )}
              />
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {quotaWatch.map((r) => (
                  <li key={r.hypertable_name} className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Text variant="body" className="block break-words">{r.hypertable_name}</Text>
                      <Caption>{formatBytes(r.total_bytes ?? 0)} · {formatBytes(r.growth_bytes_per_day ?? 0)}/d</Caption>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Text size="sm" weight="semibold" className={cn('tabular-nums', r.severity === 'critical' ? severityTokens.critical.fg : typography.color.primary)}>
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
          </LayoutCard>
        </section>
      </FadeIn>

      {/* 4 — Per-hypertable detail table -------------------------------- */}
      <FadeIn delay={0.3}>
        <section aria-label={t('admin.diskForecast.tableTitle', 'Hypertables')}>
          <LayoutCard title={t('admin.diskForecast.tableTitle', 'Hypertables')}>
            <SectionErrorBoundary name="disk-forecast-table">
              {isLoading ? (
                <Skeleton height={280} />
              ) : showError ? (
                <QueryError error={query.error} onRetry={retry} />
              ) : !source.hasData ? (
                <Text as="p" variant="bodySm" color="secondary">{unmeasuredMessage}</Text>
              ) : rows.length === 0 ? (
                <EmptyState /* no-action: hypertable inventory is TimescaleDB system state; not user-creatable */
                  icon={<Icon icon={Icons.database} size="xl" />}
                  title={t('admin.diskForecast.emptyTitle', 'No hypertables')}
                  message={t(
                    'admin.diskForecast.emptyMessage',
                    'No hypertables found in this database. The disk forecast surfaces TimescaleDB hypertables only.',
                  )}
                />
              ) : (
                <DataTable
                  tableId="admin:disk-forecast"
                  caption={t('admin.diskForecast.tableTitle', 'Hypertables')}
                  variant="embedded"
                  columns={columns}
                  mobileColumns={['hypertable', 'severity', 'days']}
                  expandable
                  expandedKeys={expandedKeys}
                  onExpandedChange={setExpandedKeys}
                  renderExpanded={(row) => (
                    <dl className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                      {columns.map((column) => (
                        <div key={column.key} className="min-w-0 break-words">
                          <Caption as="dt">{column.header}</Caption>
                          <dd className={typography.role.body}>{column.render(row)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  data={rows}
                  enableValueFilters
                  keyExtractor={(r) => r.hypertable_name}
                  emptyMessage={t('admin.diskForecast.emptyTable', 'No hypertables')}
                  pagination
                />
              )}
            </SectionErrorBoundary>
          </LayoutCard>
        </section>
      </FadeIn>
    </PageLayout>
  );
}
