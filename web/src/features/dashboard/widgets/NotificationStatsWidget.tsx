import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Send, AlertTriangle, Radio, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Badge, DataTable, type Column } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useNotificationStats, useNotificationLogs } from '@/api/hooks/useNotifications';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import type { NotificationLog } from '@/api/types';

const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'warning'> = {
  sent: 'success',
  failed: 'danger',
  pending: 'warning',
};

export default function NotificationStatsWidget({ size }: WidgetProps) {
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
        return t('widget.notificationStats.minutesAgo', '{{minutes}}m ago', { minutes: diffMin });
      const diffHrs = Math.floor(diffMin / 60);
      if (diffHrs < 24)
        return t('widget.notificationStats.hoursAgo', '{{hours}}h ago', { hours: diffHrs });
      return formatDateTime(isoStr);
    },
    [formatDateTime, t],
  );

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
    isFetching: statsFetching,
    isStale: statsStale,
    isError: statsIsError,
    dataUpdatedAt: statsUpdatedAt,
    refetch: statsRefetch,
  } = useNotificationStats();

  const {
    data: logs,
    isLoading: logsLoading,
    refetch: logsRefetch,
  } = useNotificationLogs();

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const totalSent = stats?.total_sent ?? 0;
  const sent = stats?.sent ?? 0;
  const failed = stats?.failed ?? 0;
  const enabledChannels = stats?.enabled_channels ?? 0;
  const deliveryRate = totalSent > 0 ? (sent / totalSent) * 100 : 0;

  const coreStats = useMemo((): StatGridItem[] => {
    if (!stats) return [];
    return [
      {
        label: t('widget.notificationStats.totalSent', 'Total Sent (7d)'),
        value: fmtInt(totalSent),
        icon: <Send className="h-3.5 w-3.5" />,
        trend: totalSent > 0 ? 'up' as const : 'flat' as const,
        trendValue: totalSent > 0 ? fmtInt(totalSent) : undefined,
      },
      {
        label: t('widget.notificationStats.deliveryRate', 'Delivery Rate'),
        value: fmtNumber(deliveryRate, 1),
        unit: '%',
        icon: <CheckCircle className="h-3.5 w-3.5" />,
        trend: deliveryRate >= 95 ? 'up' as const : deliveryRate > 0 ? 'down' as const : 'flat' as const,
        trendValue: deliveryRate >= 95 ? t('widget.notificationStats.healthy', 'Healthy') : undefined,
      },
      {
        label: t('widget.notificationStats.failed', 'Failed'),
        value: fmtInt(failed),
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
        valueColor: failed > 0 ? 'text-red-400' : undefined,
        trend: failed > 0 ? 'down' as const : 'flat' as const,
        trendValue: failed > 0 ? t('widget.notificationStats.needsAttention', 'Needs attention') : undefined,
      },
      {
        label: t('widget.notificationStats.activeChannels', 'Active Channels'),
        value: fmtInt(enabledChannels),
        icon: <Radio className="h-3.5 w-3.5" />,
      },
    ];
  }, [stats, totalSent, deliveryRate, failed, enabledChannels, t]);

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
        <span className="block truncate text-[var(--text-secondary)]">
          {log.title ?? '—'}
        </span>
      ),
    },
    {
      key: 'message',
      header: t('widget.notificationStats.notificationMessage', 'Message'),
      className: 'max-w-[100px]',
      render: (log) => (
        <span className="block truncate text-[var(--text-secondary)]">
          {log.message ?? '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('widget.notificationStats.status', 'Status'),
      render: (log) => (
        <Badge variant={STATUS_VARIANT[log.status] ?? 'warning'}>
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
      className: 'text-right whitespace-nowrap',
      render: (log) => (
        <span className="text-[var(--text-muted)]">
          {formatLogTime(log.created_at)}
        </span>
      ),
    },
  ], [t, formatLogTime]);

  const handleRefresh = useCallback(() => {
    statsRefetch();
    logsRefetch();
  }, [statsRefetch, logsRefetch]);

  // Compact layout: single big number
  if (isCompact) {
    return (
      <WidgetShell
        loading={statsLoading}
        error={statsError ? String(statsError) : null}
        updatedAt={statsUpdatedAt}
        isFetching={statsFetching}
        isStale={statsStale}
        isError={statsIsError}
        onRefresh={handleRefresh}
      >
        {stats ? (
          <div className="h-full flex flex-col items-center justify-center gap-0.5 min-h-[44px]">
            <span className="text-2xl font-bold text-[var(--text-primary)]">{fmtNumber(deliveryRate, 1)}%</span>
            <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
              {t('widget.notificationStats.deliveryRate', 'Delivery Rate')}
            </span>
            {failed > 0 && (
              <span className="text-2xs text-red-400 mt-0.5">
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

  const isLoading = statsLoading || logsLoading;

  // Standard (2×2) and Wide (2×4)
  return (
    <WidgetShell
      title={t('widget.notificationStats.title', 'Notification Stats')}
      icon={<Bell className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={statsError ? String(statsError) : null}
      updatedAt={statsUpdatedAt}
      isFetching={statsFetching}
      isStale={statsStale}
      isError={statsIsError}
      onRefresh={handleRefresh}
    >
      {stats ? (
        <div className="space-y-3">
          <WidgetStatGrid stats={coreStats} cols={isWide ? 4 : 2} />

          {isWide && recentLogs.length > 0 && (
            <DataTable
              tableId="dashboard:notification-stats-recent"
              columns={logColumns}
              data={recentLogs}
              keyExtractor={(log) => log.id}
              compact
              className="text-xs"
            />
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
