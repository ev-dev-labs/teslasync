import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, BellRing, Clock3, Flame, ShieldCheck } from 'lucide-react';

import { useNotificationLogs } from '@/api/hooks/useNotifications';
import {
  Bar, BarChart, CartesianGrid, ChartContainer, ChartLegend, ChartTooltip,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '@/components/charts';
import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatTime } from '@/lib/dateFormat';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';

import {
  analyzeNotificationBurnRate,
  type BurnBreachStatus,
} from '../lib/notificationBurnRate';

const STATUS_FALLBACK: Record<BurnBreachStatus, string> = {
  healthy: 'Healthy',
  warning: 'Burning fast',
  critical: 'SLO breach',
  no_data: 'No outcomes',
};

export default function NotificationBurnRatePage() {
  const { t } = useTranslation();
  usePageTitle(t('notificationBurnRate.title', 'Notification Burn Rate'));
  const logsQuery = useNotificationLogs();
  const summary = useMemo(
    () => analyzeNotificationBurnRate(logsQuery.data ?? []),
    [logsQuery.data],
  );
  const timelineData = useMemo(
    () => summary.timeline.map((bucket) => ({
      time: formatTime(new Date(bucket.startMs)),
      sent: bucket.sent,
      failed: bucket.failed,
      deferred: bucket.deferred,
      pending: bucket.pending,
      deliveryRate: bucket.deliveryRate == null
        ? null
        : Math.round(bucket.deliveryRate * 1_000) / 10,
      burnRate: bucket.burnRate == null ? null : Math.round(bucket.burnRate * 100) / 100,
    })),
    [summary.timeline],
  );
  const isLoading = logsQuery.isLoading;
  const isError = logsQuery.isError;
  const statusLabel = t(
    `notificationBurnRate.status.${summary.breachStatus}`,
    STATUS_FALLBACK[summary.breachStatus],
  );

  return (
    <PageContainer
      title={t('notificationBurnRate.title', 'Notification Burn Rate')}
      subtitle={t(
        'notificationBurnRate.subtitle',
        'Track notification delivery reliability against a 99% SLO with short and long error-budget windows',
      )}
      query={logsQuery}
    >
      <FadeIn>
        <section
          aria-label={t('notificationBurnRate.kpis.label', 'Delivery SLO metrics')}
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
                label={t('notificationBurnRate.kpis.delivery', '24h Delivery SLO')}
                value={summary.longWindow.deliveryRate != null
                  ? fmtPercent(summary.longWindow.deliveryRate * 100, 2)
                  : '—'}
                subtitle={t('notificationBurnRate.kpis.objective', '99% objective')}
                icon={<ShieldCheck className="h-5 w-5" />}
                color={(summary.longWindow.deliveryRate ?? 1) >= summary.objective ? 'green' : 'red'}
              />
              <MetricCard
                label={t('notificationBurnRate.kpis.shortBurn', '1h Burn Rate')}
                value={summary.shortWindow.burnRate != null
                  ? t('notificationBurnRate.kpis.multiplier', '{{value}}×', {
                      value: fmtNumber(summary.shortWindow.burnRate, 2),
                    })
                  : '—'}
                subtitle={t('notificationBurnRate.kpis.shortOutcomes', '{{count}} delivery outcomes', {
                  count: summary.shortWindow.eligible,
                })}
                icon={<Flame className="h-5 w-5" />}
                color={(summary.shortWindow.burnRate ?? 0) > 1 ? 'amber' : 'cyan'}
              />
              <MetricCard
                label={t('notificationBurnRate.kpis.longBurn', '24h Burn Rate')}
                value={summary.longWindow.burnRate != null
                  ? t('notificationBurnRate.kpis.multiplier', '{{value}}×', {
                      value: fmtNumber(summary.longWindow.burnRate, 2),
                    })
                  : '—'}
                subtitle={t('notificationBurnRate.kpis.failures', '{{failed}} failed · {{sent}} sent', {
                  failed: summary.longWindow.failed,
                  sent: summary.longWindow.sent,
                })}
                icon={<Clock3 className="h-5 w-5" />}
                color={(summary.longWindow.burnRate ?? 0) > 1 ? 'red' : 'blue'}
              />
              <MetricCard
                label={t('notificationBurnRate.kpis.status', 'Budget Status')}
                value={statusLabel}
                subtitle={t('notificationBurnRate.kpis.deferred', '{{count}} deferred by DND', {
                  count: summary.deferredDnd,
                })}
                icon={<AlertTriangle className="h-5 w-5" />}
                color={summary.breachStatus === 'critical'
                  ? 'red'
                  : summary.breachStatus === 'warning'
                    ? 'amber'
                    : 'green'}
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
            title={t('notificationBurnRate.timeline.title', 'Delivery Outcomes by Hour')}
            subtitle={t(
              'notificationBurnRate.timeline.subtitle',
              'Deferred quiet-hours notifications remain visible but never consume delivery error budget',
            )}
            ariaLabel={t(
              'notificationBurnRate.timeline.aria',
              'Stacked bar chart of sent, failed, and do-not-disturb deferred notifications by hour',
            )}
            chartKey="notification-burn-rate-outcomes"
            loading={isLoading}
            empty={summary.longWindow.total === 0}
            height={330}
            data={timelineData}
            dataColumns={[
              { key: 'time', label: t('notificationBurnRate.columns.time', 'Hour') },
              { key: 'sent', label: t('notificationBurnRate.columns.sent', 'Sent') },
              { key: 'failed', label: t('notificationBurnRate.columns.failed', 'Failed') },
              { key: 'deferred', label: t('notificationBurnRate.columns.deferred', 'Deferred DND') },
              { key: 'pending', label: t('notificationBurnRate.columns.pending', 'Pending') },
              { key: 'deliveryRate', label: t('notificationBurnRate.columns.delivery', 'Delivery (%)') },
              { key: 'burnRate', label: t('notificationBurnRate.columns.burn', 'Burn rate') },
            ]}
          >
            {({ hiddenSeries }) => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={24} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <ChartLegend />
                  <Bar
                    dataKey="sent"
                    name={t('notificationBurnRate.columns.sent', 'Sent')}
                    fill={chartTokens.series[2]}
                    stackId="outcomes"
                    hide={hiddenSeries?.isHidden('sent') ?? false}
                  />
                  <Bar
                    dataKey="failed"
                    name={t('notificationBurnRate.columns.failed', 'Failed')}
                    fill={chartTokens.series[5]}
                    stackId="outcomes"
                    hide={hiddenSeries?.isHidden('failed') ?? false}
                  />
                  <Bar
                    dataKey="deferred"
                    name={t('notificationBurnRate.columns.deferred', 'Deferred DND')}
                    fill={chartTokens.series[3]}
                    stackId="outcomes"
                    hide={hiddenSeries?.isHidden('deferred') ?? false}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartContainer>
        )}
      </FadeIn>

      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <BellRing className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('notificationBurnRate.severity.title', 'Severity Breakdown')}
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={96} />
          ) : summary.severities.length === 0 ? (
            <EmptyState /* no-action: delivery outcomes populate automatically as notifications are processed. */
              icon={<BellRing className="h-8 w-8" />}
              message={t(
                'notificationBurnRate.severity.empty',
                'No notification outcomes are available in the last 24 hours.',
              )}
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {summary.severities.map((severity) => (
                <div
                  key={severity.severity}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Text variant="body" className="font-medium capitalize">
                      {severity.severity}
                    </Text>
                    <Badge
                      variant={(severity.burnRate ?? 0) > 1 ? 'warning' : 'success'}
                      size="sm"
                    >
                      {severity.burnRate != null
                        ? t('notificationBurnRate.kpis.multiplier', '{{value}}×', {
                            value: fmtNumber(severity.burnRate, 2),
                          })
                        : '—'}
                    </Badge>
                  </div>
                  <Text as="p" variant="caption">
                    {t(
                      'notificationBurnRate.severity.outcomes',
                      '{{sent}} sent · {{failed}} failed · {{deferred}} deferred · {{pending}} pending',
                      {
                        sent: severity.sent,
                        failed: severity.failed,
                        deferred: severity.deferred,
                        pending: severity.pending,
                      },
                    )}
                  </Text>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
