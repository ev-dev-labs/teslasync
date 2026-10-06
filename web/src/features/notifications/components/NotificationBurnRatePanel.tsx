import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, BellRing, Clock3, Flame, ShieldCheck } from 'lucide-react';

import { useNotificationDeliveryLogs } from '@/api/hooks/useNotifications';
import {
  Bar, BarChart, CartesianGrid, ChartContainer, ChartLegend, ChartTooltip,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '@/components/charts';
import { OperationalBrief, DataProvenanceBadge, type StatMetric } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { Badge, GlassPanel, PanelTitle, SectionTitle, Text } from '@/components/ui';
import { formatTime } from '@/lib/dateFormat';

import { chartTokens } from '@/lib/tokens';

import {
  analyzeNotificationBurnRate,
  type BurnBreachStatus,
} from '../lib/notificationBurnRate';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

const STATUS_FALLBACK: Record<BurnBreachStatus, string> = {
  healthy: 'Healthy',
  warning: 'Burning fast',
  critical: 'SLO breach',
  no_data: 'No outcomes',
};

export function NotificationBurnRatePanel() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const logsQuery = useNotificationDeliveryLogs();
  const source = useDataState(logsQuery);
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
  const isLoading = !source.hasData && !source.fatalError;
  const isError = Boolean(source.fatalError);
  const statusLabel = t(
    `notificationBurnRate.status.${summary.breachStatus}`,
    STATUS_FALLBACK[summary.breachStatus],
  );
  const metrics: StatMetric[] = [
    {
      metricId: 'percent', occurrenceId: 'burn-delivery',
      rawValue: summary.longWindow.deliveryRate == null ? null : summary.longWindow.deliveryRate * 100,
      label: t('notificationBurnRate.kpis.delivery', '24h delivery SLO'),
      missingReason: t('notificationBurnRate.kpis.noLongOutcomes', 'No delivery outcomes in the last 24 hours'),
      context: <><ShieldCheck className="h-5 w-5" aria-hidden="true" />{t('notificationBurnRate.kpis.objective', '99% objective')}</>,
    },
    {
      metricId: 'multiplier', occurrenceId: 'burn-short', rawValue: summary.shortWindow.burnRate,
      display: { precision: 2 },
      label: t('notificationBurnRate.kpis.shortBurn', '1h burn rate'),
      missingReason: t('notificationBurnRate.kpis.noShortOutcomes', 'No delivery outcomes in the last hour'),
      context: <><Flame className="h-5 w-5" aria-hidden="true" />{t('notificationBurnRate.kpis.shortOutcomes', '{{count}} delivery outcomes', { count: summary.shortWindow.eligible })}</>,
    },
    {
      metricId: 'multiplier', occurrenceId: 'burn-long', rawValue: summary.longWindow.burnRate,
      display: { precision: 2 },
      label: t('notificationBurnRate.kpis.longBurn', '24h burn rate'),
      missingReason: t('notificationBurnRate.kpis.noLongOutcomes', 'No delivery outcomes in the last 24 hours'),
      context: <><Clock3 className="h-5 w-5" aria-hidden="true" />{t('notificationBurnRate.kpis.failures', '{{failed}} failed · {{sent}} sent', { failed: summary.longWindow.failed, sent: summary.longWindow.sent })}</>,
    },
    {
      metricId: 'status', occurrenceId: 'burn-budget', rawValue: statusLabel,
      label: t('notificationBurnRate.kpis.status', 'Budget status'),
      context: <><AlertTriangle className="h-5 w-5" aria-hidden="true" />{t('notificationBurnRate.kpis.deferred', '{{count}} deferred by DND', { count: summary.deferredDnd })}</>,
    },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);

  return (
    <section id="burn-rate" aria-label={t('notificationBurnRate.title', 'Notification burn rate')} className="min-w-0 space-y-5 scroll-mt-24">
      <div className="max-w-3xl">
        <SectionTitle>{t('notificationBurnRate.title', 'Notification burn rate')}</SectionTitle>
        <Text as="p" color="secondary">
          {t('notificationBurnRate.subtitle', 'Track all recorded notification delivery attempts against a 99% SLO with short and long error-budget windows')}
        </Text>
      </div>
      <StaleRefreshWarning state={source} label={t('notificationBurnRate.title', 'Notification burn rate')} />
      <FadeIn>
        <section
          aria-label={t('notificationBurnRate.kpis.label', 'Delivery SLO metrics')}
          className={isLoading ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4' : 'min-w-0'}
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={source.fatalError} onRetry={() => logsQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} height={96} className="rounded-xl" />
            ))
          ) : (
            <OperationalBrief
              compact
              testId="notification-burn-rate-brief"
              eyebrow={t('notificationBurnRate.summary.brief.eyebrow', 'Delivery SLO')}
              title={t('notificationBurnRate.summary.brief.title', 'Delivery reliability and error budget')}
              description={t('notificationBurnRate.summary.periodReason', 'Short and long windows are separate; only sent and failed outcomes consume the 1% error budget. Deferred DND and pending attempts are excluded.')}
              statusLabel={source.status === 'stale' ? t('dataState.stale.title', 'Data may be stale')
                : summary.longWindow.eligible === 0
                  ? t('notificationBurnRate.summary.brief.empty', 'No eligible delivery outcomes')
                  : t('notificationBurnRate.summary.brief.available', 'Delivery outcomes recorded')}
              statusTone={source.status === 'stale' || summary.breachStatus === 'warning' ? 'warning'
                : summary.breachStatus === 'critical' ? 'danger' : 'neutral'}
              metrics={operationalMetrics}
              scope={t('notificationBurnRate.summary.period', 'Recorded outcomes · 1h and 24h windows')}
              freshness={<DataProvenanceBadge provenance={source.provenance} status={source.status} updatedAt={source.updatedAt} />}
              provenance={t('notificationBurnRate.summary.periodReason', 'Short and long windows are separate; only sent and failed outcomes consume the 1% error budget. Deferred DND and pending attempts are excluded.')}
            />
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
            title={t('notificationBurnRate.timeline.title', 'Delivery outcomes by hour')}
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
            {t('notificationBurnRate.severity.title', 'Severity breakdown')}
          </PanelTitle>
          {isError ? (
            <QueryError error={source.fatalError} onRetry={() => { void logsQuery.refetch(); }} />
          ) : isLoading ? (
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
            <div className="grid min-w-0 gap-3 md:grid-cols-2">
              {summary.severities.map((severity) => (
                <div
                  key={severity.severity}
                  className="min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 sm:p-4"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Text variant="body" className="min-w-0 break-words font-medium">
                      {severity.severity}
                    </Text>
                    <Badge
                      variant={(severity.burnRate ?? 0) > 1 ? 'warning' : 'success'}
                      size="sm"
                    >
                      {severity.burnRate != null
                        ? t('notificationBurnRate.kpis.multiplier', '{{value}}×', {
                            value: fmtNumber(severity.burnRate),
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
    </section>
  );
}
