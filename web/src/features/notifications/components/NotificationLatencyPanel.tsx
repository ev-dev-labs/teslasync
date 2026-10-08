import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, Gauge, Hourglass, Rabbit, TimerReset } from 'lucide-react';

import { useNotificationDeliveryLogs } from '@/api/hooks/useNotifications';
import {
  Bar, BarChart, CartesianGrid, ChartContainer, ChartTooltip,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '@/components/charts';
import { OperationalBrief, DataProvenanceBadge, type StatMetric } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { Badge, DataTable, GlassPanel, PanelTitle, SectionTitle, Table, Text, type Column } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';

import { chartTokens } from '@/lib/tokens';

import { analyzeNotificationLatency } from '../lib/notificationLatency';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

export function NotificationLatencyPanel() {
  const { fmtNumber, fmtPercent, fmtScientificNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const logsQuery = useNotificationDeliveryLogs();
  const source = useDataState(logsQuery);
  const summary = useMemo(
    () => analyzeNotificationLatency(logsQuery.data ?? []),
    [logsQuery.data],
  );
  const latencyLabel = useCallback((value: number | null) => value == null
    ? '—'
    : t('notificationLatency.units.ms', '{{value}} ms', { value: fmtNumber(value) }), [t, fmtNumber]);
  const slowestColumns = useMemo<Column<(typeof summary.slowest)[number]>[]>(() => [
    {
      key: 'notification',
      header: t('notifications.inbox.columns.title', 'Notification'),
      render: record => (
        <div className="min-w-0">
          <Text as="p" variant="bodySm" className="break-words font-medium">{record.title}</Text>
          <Text as="p" variant="caption" className="break-words">
            {t('notificationLatency.slowest.meta', '{{severity}} · {{status}} · {{date}}', {
              severity: record.severity,
              status: record.status,
              date: formatDateTime(record.createdAt),
            })}
          </Text>
        </div>
      ),
    },
    {
      key: 'source',
      header: t('notifications.inbox.columns.source', 'Source'),
      render: record => (
        <Badge variant={record.source === 'measured' ? 'info' : 'neutral'} size="sm">
          {record.source === 'measured'
            ? t('notificationLatency.slowest.measured', 'Measured')
            : t('notificationLatency.slowest.derived', 'Derived')}
        </Badge>
      ),
    },
    {
      key: 'latency',
      header: t('notificationLatency.title', 'Notification latency'),
      align: 'right',
      render: record => <Text variant="body" mono className="font-medium">{latencyLabel(record.latencyMs)}</Text>,
    },
  ], [latencyLabel, t]);
  const histogramData = useMemo(
    () => summary.histogram.map((bin) => ({
      range: bin.upperMs == null
        ? t('notificationLatency.histogram.over', '> {{value}} ms', {
            value: fmtNumber(bin.lowerMs),
          })
        : t('notificationLatency.histogram.upTo', '≤ {{value}} ms', {
            value: fmtNumber(bin.upperMs),
          }),
      count: bin.count,
      share: Math.round(bin.share * 1_000) / 10,
    })),
    [summary.histogram, t, fmtNumber],
  );
  const isLoading = !source.hasData && !source.fatalError;
  const isError = Boolean(source.fatalError);
  const latencyProvenance = t('notificationLatency.brief.provenance', 'Percentiles use recorded delivery latency or created-to-sent timestamps for attempts with usable measurements. The recorded sample is not a guaranteed complete analysis window.');
  const metrics: StatMetric[] = [
    { metricId: 'latency', occurrenceId: 'latency-p50', rawValue: source.hasData && summary.p50Ms != null ? summary.p50Ms / 1000 : null,
      label: t('notificationLatency.kpis.p50', 'p50 latency'),
      display: { formatter: raw => ({ value: fmtNumber(raw * 1000), unit: 'ms' }) },
      context: <><Rabbit className="h-5 w-5" aria-hidden="true" />{t('notificationLatency.kpis.trimmed', 'trimmed mean {{value}}', { value: latencyLabel(summary.trimmedMeanMs) })}</> },
    { metricId: 'latency', occurrenceId: 'latency-p95', rawValue: source.hasData && summary.p95Ms != null ? summary.p95Ms / 1000 : null,
      label: t('notificationLatency.kpis.p95', 'p95 latency'),
      display: { formatter: raw => ({ value: fmtNumber(raw * 1000), unit: 'ms' }) },
      context: <><TimerReset className="h-5 w-5" aria-hidden="true" />{t('notificationLatency.kpis.samples', '{{count}} measured deliveries', { count: summary.count })}</> },
    { metricId: 'latency', occurrenceId: 'latency-p99', rawValue: source.hasData && summary.p99Ms != null ? summary.p99Ms / 1000 : null,
      label: t('notificationLatency.kpis.p99', 'p99 latency'),
      display: { formatter: raw => ({ value: fmtNumber(raw * 1000), unit: 'ms' }) },
      context: <><Hourglass className="h-5 w-5" aria-hidden="true" />{t('notificationLatency.kpis.tail', '{{value}} slower than 4 seconds', {
        value: summary.tailShare != null ? fmtPercent(summary.tailShare * 100) : '—',
      })}</> },
    { metricId: 'number', occurrenceId: 'latency-apdex', rawValue: source.hasData ? summary.apdex : null,
      label: t('notificationLatency.kpis.apdex', 'Delivery Apdex'),
      display: { formatter: raw => ({ value: fmtScientificNumber(raw, 3), unit: '' }) },
      context: <><Gauge className="h-5 w-5" aria-hidden="true" />{t('notificationLatency.kpis.apdexThreshold', 'T = 1 s · tolerating through 4 s')}</> },
  ];
  const operationalMetrics = useOperationalMetrics(metrics).map((metric, index) => ({
    ...metric,
    tone: index === 2 && (summary.tailShare ?? 0) > 0.05 ? 'warning' as const
      : index === 3 ? (summary.apdex ?? 0) >= 0.85 ? 'success' as const : 'warning' as const
        : 'neutral' as const,
  }));

  return (
    <section id="latency" aria-label={t('notificationLatency.title', 'Notification latency')} className="min-w-0 space-y-5 scroll-mt-24">
      <div className="max-w-3xl">
        <SectionTitle>{t('notificationLatency.title', 'Notification latency')}</SectionTitle>
        <Text as="p" color="secondary">
          {t('notificationLatency.subtitle', 'Measure all recorded delivery attempts using recorded latency or created-to-sent timestamps, including percentiles, Apdex, cohorts, and tail records')}
        </Text>
      </div>
      <StaleRefreshWarning state={source} label={t('notificationLatency.title', 'Notification latency')} />
      <FadeIn>
        <section
          aria-label={t('notificationLatency.kpis.label', 'Notification latency metrics')}
          className="min-w-0"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={source.fatalError} onRetry={() => logsQuery.refetch()} />
            </GlassPanel>
          ) : (
            <OperationalBrief compact loading={isLoading} testId="notification-latency-brief"
              eyebrow={t('notificationLatency.title', 'Notification latency')}
              title={t('notificationLatency.brief.title', 'Delivery speed, tail latency, and Apdex')}
              description={latencyProvenance}
              statusLabel={isLoading ? t('common.loading', 'Loading…') : source.isRefreshBlocked
                ? t('fleetOps.brief.refreshBlocked', 'Refresh paused')
                : source.status === 'stale' ? t('dataState.stale.title', 'Data may be stale')
                  : summary.count === 0 ? t('notificationLatency.brief.empty', 'No usable latency measurements')
                    : t('notificationLatency.brief.available', 'Latency measurements recorded')}
              statusTone={source.isRefreshBlocked || source.status === 'stale' ? 'warning' : 'neutral'}
              metrics={operationalMetrics}
              scope={t('notificationLatency.brief.scope', 'Recorded delivery attempts · usable latency sample')}
              freshness={<DataProvenanceBadge provenance={source.provenance} status={source.status} updatedAt={source.updatedAt} />}
              provenance={latencyProvenance} />
          )}
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        {isError ? (
          <GlassPanel className="p-4 sm:p-5">
            <QueryError error={source.fatalError} onRetry={() => logsQuery.refetch()} />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('notificationLatency.histogram.title', 'Latency distribution')}
            subtitle={t(
              'notificationLatency.histogram.subtitle',
              'Apdex bands are anchored to the documented 1-second satisfied threshold',
            )}
            ariaLabel={t(
              'notificationLatency.histogram.aria',
              'Bar chart of notification deliveries grouped into latency ranges',
            )}
            loading={isLoading}
            empty={summary.count === 0}
            height={310}
            data={histogramData}
            dataColumns={[
              { key: 'range', label: t('notificationLatency.columns.range', 'Latency range') },
              { key: 'count', label: t('notificationLatency.columns.count', 'Deliveries') },
              { key: 'share', label: t('notificationLatency.columns.share', 'Share (%)') },
            ]}
          >
            {/* Single histogram count series; percentile summaries are KPIs rather than toggleable series. */}
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histogramData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="count"
                  name={t('notificationLatency.columns.count', 'Deliveries')}
                  fill={chartTokens.series[0]}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <BellRing className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('notificationLatency.cohorts.title', 'Severity and status cohorts')}
          </PanelTitle>
          {isError ? (
            <QueryError error={source.fatalError} onRetry={() => { void logsQuery.refetch(); }} />
          ) : isLoading ? (
            <Skeleton height={96} />
          ) : summary.count === 0 ? (
            <EmptyState
              icon={<BellRing className="h-8 w-8" />}
              message={t(
                'notificationLatency.cohorts.empty',
                'No measured channel deliveries yet. Configure a channel and send a test notification to measure latency.',
              )}
              actionTo={{ label: t('notificationLatency.cohorts.configure', 'Manage delivery channels'), to: '/notifications/channels' }}
            />
          ) : (
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              {[
                {
                  title: t('notificationLatency.cohorts.severity', 'By severity'),
                  rows: summary.severityCohorts,
                },
                {
                  title: t('notificationLatency.cohorts.status', 'By status'),
                  rows: summary.statusCohorts,
                },
              ].map((group) => (
                <div key={group.title}>
                  <Text as="p" variant="body" className="mb-2 font-medium">{group.title}</Text>
                  <Table aria-label={group.title}>
                    <tbody>
                      {group.rows.map((cohort) => (
                        <tr key={cohort.key}>
                          <th scope="row" className="min-w-0 break-words">
                            <Text as="p" variant="bodySm" className="font-medium">
                              {cohort.key.replace('_', ' ')}
                            </Text>
                            <Text as="p" variant="caption">
                              {t('notificationLatency.cohorts.samples', '{{count}} samples · {{tail}} tail', {
                                count: cohort.count,
                                tail: fmtPercent(cohort.tailShare * 100),
                              })}
                            </Text>
                          </th>
                          <td className="text-right tabular-nums">
                            <Text variant="bodySm" mono>{latencyLabel(cohort.p95Ms)}</Text>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Hourglass className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('notificationLatency.slowest.title', 'Slowest delivery records')}
          </PanelTitle>
          {isError ? (
            <QueryError error={source.fatalError} onRetry={() => { void logsQuery.refetch(); }} />
          ) : isLoading ? (
            <Skeleton height={180} />
          ) : summary.slowest.length === 0 ? (
            <EmptyState /* no-action: slow records appear automatically when delivery latency is observed. */
              icon={<Hourglass className="h-8 w-8" />}
              message={t('notificationLatency.slowest.empty', 'No slow delivery records are available.')}
            />
          ) : (
            <DataTable
              tableId="notifications:slow-deliveries"
              caption={t('notificationLatency.slowest.title', 'Slowest delivery records')}
              columns={slowestColumns}
              data={summary.slowest}
              keyExtractor={record => record.id}
              rowLabel={record => record.title}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </section>
  );
}
