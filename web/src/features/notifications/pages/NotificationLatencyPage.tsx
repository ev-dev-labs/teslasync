import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, Gauge, Hourglass, Rabbit, TimerReset } from 'lucide-react';

import { useNotificationLogs } from '@/api/hooks/useNotifications';
import {
  Bar, BarChart, CartesianGrid, ChartContainer, ChartTooltip,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '@/components/charts';
import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';

import { analyzeNotificationLatency } from '../lib/notificationLatency';

export default function NotificationLatencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('notificationLatency.title', 'Notification Latency'));
  const logsQuery = useNotificationLogs();
  const summary = useMemo(
    () => analyzeNotificationLatency(logsQuery.data ?? []),
    [logsQuery.data],
  );
  const latencyLabel = (value: number | null) => value == null
    ? '—'
    : t('notificationLatency.units.ms', '{{value}} ms', { value: fmtNumber(value, 0) });
  const histogramData = useMemo(
    () => summary.histogram.map((bin) => ({
      range: bin.upperMs == null
        ? t('notificationLatency.histogram.over', '> {{value}} ms', {
            value: fmtNumber(bin.lowerMs, 0),
          })
        : t('notificationLatency.histogram.upTo', '≤ {{value}} ms', {
            value: fmtNumber(bin.upperMs, 0),
          }),
      count: bin.count,
      share: Math.round(bin.share * 1_000) / 10,
    })),
    [summary.histogram, t],
  );
  const isLoading = logsQuery.isLoading;
  const isError = logsQuery.isError;

  return (
    <PageContainer
      title={t('notificationLatency.title', 'Notification Latency')}
      subtitle={t(
        'notificationLatency.subtitle',
        'Measure delivery speed from backend latency or created-to-sent timestamps, including percentiles, Apdex, cohorts, and tail records',
      )}
      query={logsQuery}
    >
      <FadeIn>
        <section
          aria-label={t('notificationLatency.kpis.label', 'Notification latency metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={logsQuery.error} onRetry={() => logsQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('notificationLatency.kpis.p50', 'p50 Latency')}
                value={latencyLabel(summary.p50Ms)}
                subtitle={t('notificationLatency.kpis.trimmed', 'trimmed mean {{value}}', {
                  value: latencyLabel(summary.trimmedMeanMs),
                })}
                icon={<Rabbit className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('notificationLatency.kpis.p95', 'p95 Latency')}
                value={latencyLabel(summary.p95Ms)}
                subtitle={t('notificationLatency.kpis.samples', '{{count}} measured deliveries', {
                  count: summary.count,
                })}
                icon={<TimerReset className="h-5 w-5" />}
                color="blue"
              />
              <MetricCard
                label={t('notificationLatency.kpis.p99', 'p99 Latency')}
                value={latencyLabel(summary.p99Ms)}
                subtitle={t('notificationLatency.kpis.tail', '{{value}} slower than 4 seconds', {
                  value: summary.tailShare != null
                    ? fmtPercent(summary.tailShare * 100, 1)
                    : '—',
                })}
                icon={<Hourglass className="h-5 w-5" />}
                color={(summary.tailShare ?? 0) > 0.05 ? 'amber' : 'purple'}
              />
              <MetricCard
                label={t('notificationLatency.kpis.apdex', 'Delivery Apdex')}
                value={summary.apdex != null ? fmtNumber(summary.apdex, 3) : '—'}
                subtitle={t('notificationLatency.kpis.apdexThreshold', 'T = 1 s · tolerating through 4 s')}
                icon={<Gauge className="h-5 w-5" />}
                color={(summary.apdex ?? 0) >= 0.85 ? 'green' : 'amber'}
              />
            </>
          )}
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        {isError ? (
          <GlassPanel className="p-4 sm:p-5">
            <QueryError error={logsQuery.error} onRetry={() => logsQuery.refetch()} />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('notificationLatency.histogram.title', 'Latency Distribution')}
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
            {t('notificationLatency.cohorts.title', 'Severity and Status Cohorts')}
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={96} />
          ) : summary.count === 0 ? (
            <EmptyState /* no-action: latency cohorts populate automatically from measured deliveries. */
              icon={<BellRing className="h-8 w-8" />}
              message={t(
                'notificationLatency.cohorts.empty',
                'No notification records include a usable delivery latency yet.',
              )}
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
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
                  <div className="space-y-2">
                    {group.rows.map((cohort) => (
                      <div
                        key={cohort.key}
                        className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                      >
                        <div>
                          <Text as="p" variant="bodySm" className="font-medium capitalize">
                            {cohort.key.replace('_', ' ')}
                          </Text>
                          <Text as="p" variant="caption">
                            {t('notificationLatency.cohorts.samples', '{{count}} samples · {{tail}} tail', {
                              count: cohort.count,
                              tail: fmtPercent(cohort.tailShare * 100, 1),
                            })}
                          </Text>
                        </div>
                        <Text variant="bodySm" mono>{latencyLabel(cohort.p95Ms)}</Text>
                      </div>
                    ))}
                  </div>
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
            {t('notificationLatency.slowest.title', 'Slowest Delivery Records')}
          </PanelTitle>
          {summary.slowest.length === 0 ? (
            <EmptyState /* no-action: slow records appear automatically when delivery latency is observed. */
              icon={<Hourglass className="h-8 w-8" />}
              message={t('notificationLatency.slowest.empty', 'No slow delivery records are available.')}
            />
          ) : (
            <div className="space-y-2">
              {summary.slowest.map((record) => (
                <div
                  key={record.id}
                  className="grid gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <Text as="p" variant="bodySm" className="truncate font-medium">{record.title}</Text>
                    <Text as="p" variant="caption">
                      {t('notificationLatency.slowest.meta', '{{severity}} · {{status}} · {{date}}', {
                        severity: record.severity,
                        status: record.status,
                        date: formatDateTime(record.createdAt),
                      })}
                    </Text>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={record.source === 'measured' ? 'info' : 'neutral'} size="sm">
                      {record.source === 'measured'
                        ? t('notificationLatency.slowest.measured', 'Measured')
                        : t('notificationLatency.slowest.derived', 'Derived')}
                    </Badge>
                    <Text variant="body" mono className="font-medium">
                      {latencyLabel(record.latencyMs)}
                    </Text>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
