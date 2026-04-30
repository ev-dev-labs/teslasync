import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Send, AlertTriangle, Radio, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Badge, DataTable, type Column } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useNotificationStats, useNotificationLogs } from '@/api/hooks/useNotifications';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import type { NotificationLog } from '@/api/types';

function formatLogTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'warning'> = {
  sent: 'success',
  failed: 'danger',
  pending: 'warning',
};

export default function NotificationStatsWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');

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
      key: 'channel',
      header: t('widget.notificationStats.channel', 'Channel'),
      className: 'max-w-[120px]',
      render: (log) => (
        <span className="block truncate text-white/70">
          {log.title ?? '—'}
        </span>
      ),
    },
    {
      key: 'type',
      header: t('widget.notificationStats.type', 'Type'),
      className: 'max-w-[100px]',
      render: (log) => (
        <span className="block truncate text-white/50">
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
        <span className="text-white/40">
          {formatLogTime(log.created_at)}
        </span>
      ),
    },
  ], [t]);

  const handleRefresh = () => {
    statsRefetch();
    logsRefetch();
  };

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
            <span className="text-2xl font-bold text-white/90">{fmtNumber(deliveryRate, 1)}%</span>
            <span className="text-[10px] text-white/40 uppercase tracking-wider">
              {t('widget.notificationStats.deliveryRate', 'Delivery Rate')}
            </span>
            {failed > 0 && (
              <span className="text-[10px] text-red-400 mt-0.5">
                {fmtInt(failed)} {t('widget.notificationStats.failedLabel', 'failed')}
              </span>
            )}
          </div>
        ) : (
          <EmptyState
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
              columns={logColumns}
              data={recentLogs}
              keyExtractor={(log) => log.id}
              compact
              className="text-xs"
            />
          )}
        </div>
      ) : (
        <EmptyState
          icon={<Bell className="h-5 w-5" />}
          message={t('widget.notificationStats.noData', 'No notification data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
