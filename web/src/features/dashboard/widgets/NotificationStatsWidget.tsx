import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Badge, DataTable, type Column, type MobileDataTablePresentation } from '@/components/ui';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { useNotificationStats, useNotificationLogs } from '@/api/hooks/useNotifications';

import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import type { WidgetProps } from './types';
import type { NotificationLog } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownNumber } from '@/api/dataState';
import { dashboardTokens } from '../lib/dashboardTokens';

const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'warning'> = {
  sent: 'success',
  failed: 'danger',
  pending: 'warning',
};

export default function NotificationStatsWidget({ size }: WidgetProps) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { formatDateTime } = useDateFormat();

  const formatLogTime = useCallback(
    (isoStr: string): string => {
      const ms = new Date(isoStr).getTime();
      // Invalid/absent timestamp: defer to the locale-aware formatter, which
      // renders an em-dash rather than "NaNm ago".
      if (Number.isNaN(ms)) return formatDateTime(isoStr);
      const diffMin = Math.floor((Date.now() - ms) / 60_000);
      if (diffMin < 1) return t('widget.notificationStats.justNow', 'Just now');
      if (diffMin < 60)
        return t('widget.notificationStats.minutesAgo', '{{minutes}}m ago', { minutes: fmtInt(diffMin) });
      const diffHrs = Math.floor(diffMin / 60);
      if (diffHrs < 24)
        return t('widget.notificationStats.hoursAgo', '{{hours}}h ago', { hours: fmtInt(diffHrs) });
      return formatDateTime(isoStr);
    },
    [formatDateTime, t, fmtInt],
  );

  const statsQuery = useNotificationStats();
  const {
    data: stats,
    isLoading: statsLoading,
    isFetching: statsFetching,
    isStale: statsStale,
    isError: statsIsError,
    dataUpdatedAt: statsUpdatedAt,
    refetch: statsRefetch,
  } = statsQuery;

  const logsQuery = useNotificationLogs();
  const {
    data: logs,
    isLoading: logsLoading,
    refetch: logsRefetch,
  } = logsQuery;
  const statsState = useDataState({ ...statsQuery, data: stats ?? undefined }, {
    partial: !!stats && [stats.total_sent, stats.sent, stats.failed, stats.enabled_channels].some(value => knownNumber(value) == null),
  });
  const logsState = useDataState({ ...logsQuery, data: logs ?? undefined }, { provenance: 'historical' });

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const totalSent = knownNumber(stats?.total_sent);
  const sent = knownNumber(stats?.sent);
  const failed = knownNumber(stats?.failed);
  const enabledChannels = knownNumber(stats?.enabled_channels);
  const deliveryRate = totalSent != null && totalSent > 0 && sent != null ? (sent / totalSent) * 100 : null;

  const coreStats = useMemo((): StatMetric[] => {
    return [
      {
        label: t('widget.notificationStats.totalSent', 'Total sent (7d)'),
        metricId: 'count', rawValue: totalSent,
        description: t('widget.notificationStats.sentDescription', 'Recorded total sent for the reported seven-day window.'),
        comparisonContent: totalSent != null && totalSent > 0 ? <Badge variant="success">{fmtInt(totalSent)}</Badge> : undefined,
      },
      {
        label: t('widget.notificationStats.deliveryRate', 'Delivery rate'),
        metricId: 'percent', rawValue: deliveryRate,
        display: { formatter: raw => ({ value: fmtNumber(Number(raw)), unit: '%' }) },
        description: t('widget.notificationStats.deliveryDescription', 'Sent divided by a positive reported total; a zero denominator leaves delivery rate unknown.'),
        comparisonContent: deliveryRate != null && deliveryRate >= 95 ? <Badge variant="success">{t('widget.notificationStats.healthy', 'Healthy')}</Badge> : undefined,
      },
      {
        label: t('widget.notificationStats.failed', 'Failed'),
        metricId: 'count', rawValue: failed,
        description: t('widget.notificationStats.failedDescription', 'Reported failures remain independent of the recent notification log rows.'),
        comparisonContent: failed != null && failed > 0 ? <Badge variant="danger">{t('widget.notificationStats.needsAttention', 'Needs attention')}</Badge> : undefined,
      },
      {
        label: t('widget.notificationStats.activeChannels', 'Active channels'),
        metricId: 'count', rawValue: enabledChannels,
        description: t('widget.notificationStats.channelsDescription', 'Enabled notification channels, not a delivery-success guarantee.'),
      },
    ];
  }, [stats, totalSent, deliveryRate, failed, enabledChannels, t, fmtInt, fmtNumber]);

  const recentLogs = useMemo(() => {
    const list = logs ?? [];
    const limit = isCompact ? 3 : 5;
    return [...list]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }, [logs, isCompact]);

  const logColumns = useMemo<Column<NotificationLog>[]>(() => [
    {
      key: 'title',
      header: t('widget.notificationStats.notificationTitle', 'Title'),
      className: 'max-w-[120px]',
      render: (log) => (
        <span className="block whitespace-normal break-words [overflow-wrap:anywhere] text-[var(--text-secondary)]">
          {log.title ?? '—'}
        </span>
      ),
    },
    {
      key: 'message',
      header: t('widget.notificationStats.notificationMessage', 'Message'),
      className: 'max-w-[100px]',
      render: (log) => (
        <span className="block whitespace-normal break-words [overflow-wrap:anywhere] text-[var(--text-secondary)]">
          {log.message ?? '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('widget.notificationStats.status', 'Status'),
      render: (log) => (
        <Badge variant={Object.prototype.hasOwnProperty.call(STATUS_VARIANT, log.status) ? STATUS_VARIANT[log.status] : 'neutral'}>
          {log.status === 'sent' && <CheckCircle className="h-3 w-3 mr-1" />}
          {log.status === 'failed' && <XCircle className="h-3 w-3 mr-1" />}
          {log.status === 'pending' && <Clock className="h-3 w-3 mr-1" />}
          {log.status ?? '—'}
        </Badge>
      ),
    },
    {
      key: 'time',
      header: t('widget.notificationStats.time', 'Time'),
      align: 'right',
      className: 'whitespace-nowrap',
      render: (log) => (
        <span className="text-[var(--text-muted)]">
          {formatLogTime(log.created_at)}
        </span>
      ),
    },
  ], [t, formatLogTime]);

  const logMobile = useMemo<MobileDataTablePresentation<NotificationLog>>(() => ({
    variant: 'cards',
    roles: { title: 'title', message: 'primary', status: 'badge', time: 'meta' },
    displayValue: (log, key) => {
      if (key === 'title') return log.title;
      if (key === 'message') return log.message;
      if (key === 'status') return log.status;
      if (key === 'time') return formatLogTime(log.created_at);
      return null;
    },
  }), [formatLogTime]);

  const handleRefresh = useCallback(() => {
    void statsRefetch();
    void logsRefetch();
  }, [statsRefetch, logsRefetch]);
  const combined = isWide ? combineDataStates([statsState, logsState]) : statsState;
  const displayState = {
    ...combined,
    data: stats ?? (isWide ? logs : undefined),
    hasData: stats != null || (isWide && logs != null),
    retry: handleRefresh,
    status: combined.status === 'initial' && !statsLoading && !(isWide && logsLoading) ? 'unavailable' as const : combined.status,
  };

  // Compact layout: single big number
  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.notificationStats.summaryTitle', 'Notification counters')}
        loading={statsLoading}
        dataState={displayState}
        updatedAt={statsUpdatedAt}
        isFetching={statsFetching}
        isStale={statsStale}
        isError={statsIsError}
        onRefresh={handleRefresh}
      >
        {statsState.fatalError ? (
          <QueryError error={statsState.fatalError} onRetry={() => { void statsRefetch(); }} />
        ) : stats ? (
          <div className="h-full flex flex-col items-center justify-center gap-0.5 min-h-[44px]">
            <WidgetBigNumber
              value={deliveryRate == null ? null : fmtNumber(deliveryRate)}
              unit="%"
              label={t('widget.notificationStats.deliveryRate', 'Delivery rate')}
              align="center"
            />
            {failed != null && failed > 0 && (
              <span className={`${dashboardTokens.metricLabel} text-red-400 mt-0.5`}>
                {fmtInt(failed)} {t('widget.notificationStats.failedLabel', 'failed')}
              </span>
            )}
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Bell className="h-5 w-5" />}
            message={t('widget.notificationStats.noData', 'No notification data')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  const isLoading = statsLoading && !(isWide && logs != null);

  // Standard (2×2) and Wide (2×4)
  return (
    <WidgetShell
      title={t('widget.notificationStats.title', 'Notification stats')}
      icon={<Bell className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      dataState={displayState}
      updatedAt={statsUpdatedAt}
      isFetching={statsFetching || (isWide && logsQuery.isFetching)}
      isStale={statsStale || (isWide && logsQuery.isStale)}
      isError={statsIsError || (isWide && logsQuery.isError)}
      onRefresh={handleRefresh}
    >
      <div className="space-y-3">
        <DashboardSourceBrief
          metrics={coreStats} state={statsState}
          eyebrow={t('dashboard.summary.eyebrow', 'Source summary')}
          title={t('widget.notificationStats.title', 'Notification stats')}
          description={t('widget.notificationStats.summaryDescription', 'Notification counters preserve the existing delivery formula and attention thresholds; recent logs recover independently.')}
          scope={t('widget.notificationStats.summaryScope', 'System notifications; reported seven-day counters and separate latest log rows')}
          loading={statsLoading && !stats} testId="notification-stats-operational-brief"
        />
        {statsState.fatalError ? (
          <QueryError error={statsState.fatalError} onRetry={() => { void statsRefetch(); }} />
        ) : statsLoading && stats == null ? (
          <Skeleton className="h-20 rounded-xl" />
        ) : stats ? null : (
          <EmptyState /* no-action: source activity supplies these statistics */
            icon={<Bell className="h-5 w-5" />}
            message={t('widget.notificationStats.noData', 'No notification data')}
            className="py-4"
          />
        )}
        {isWide && (
          logsState.fatalError ? (
            <QueryError error={logsState.fatalError} onRetry={() => { void logsRefetch(); }} />
          ) : logsLoading && logs == null ? (
            <Skeleton className="h-20 rounded-xl" />
          ) : recentLogs.length > 0 ? (
            <DataTable
              tableId="dashboard:notification-stats-recent"
              columns={logColumns}
              mobileColumns={['title', 'status', 'time']}
              mobilePresentation={logMobile}
              data={recentLogs}
              keyExtractor={(log) => log.id}
              compact
              className="text-xs"
            />
          ) : (
            <EmptyState /* no-action: source activity supplies notification history */
              message={t('widget.notificationStats.noData', 'No notification data')}
              className="py-2"
            />
          )
        )}
      </div>
    </WidgetShell>
  );
}
