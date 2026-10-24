import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import { EmptyState, QueryError } from '@/components/feedback';
import { Badge } from '@/components/ui';
import { useNotificationStats, useNotificationLogs } from '@/api/hooks/useNotifications';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';

export default function NotificationStatsWidget({ size }: WidgetProps) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { formatDateTime } = useDateFormat();

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

  const statsState = useDataState(
    { ...statsQuery, data: stats ?? undefined },
    {
      partial: !!stats && [
        stats.total_sent,
        stats.sent,
        stats.failed,
        stats.enabled_channels,
      ].some((value) => knownNumber(value) == null),
    },
  );
  const totalSent = knownNumber(stats?.total_sent);
  const sent = knownNumber(stats?.sent);
  const deliveryRate = totalSent != null && totalSent > 0 && sent != null
    ? (sent / totalSent) * 100
    : null;

  const lastFailure = useMemo(() => {
    const list = logs ?? [];
    return [...list]
      .filter((log) => log.status === 'failed')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null;
  }, [logs]);

  const handleRefresh = useCallback(() => {
    void statsRefetch();
    void logsRefetch();
  }, [statsRefetch, logsRefetch]);

  const displayState = {
    ...statsState,
    data: stats ?? logs,
    hasData: stats != null || logs != null,
    retry: handleRefresh,
    status: statsState.status === 'initial' && !statsLoading && !logsLoading
      ? 'unavailable' as const
      : statsState.status,
  };

  const enabledChannels = knownNumber(stats?.enabled_channels);
  const lastFailureText = useMemo(() => {
    if (!lastFailure) return null;
    const parts = [
      lastFailure.title?.trim() || null,
      formatDateTime(lastFailure.created_at),
      lastFailure.error?.trim() || null,
    ].filter((part): part is string => Boolean(part));
    return parts.length > 0
      ? `${t('widget.notificationStats.failed', 'Failed')}: ${parts.join(' · ')}`
      : null;
  }, [lastFailure, formatDateTime, t]);

  const isLoading = statsLoading && stats == null;

  return (
    <WidgetShell
      title={t('widget.notificationStats.title', 'Notification stats')}
      icon={<Bell className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      dataState={displayState}
      updatedAt={statsUpdatedAt}
      isFetching={statsFetching || logsQuery.isFetching}
      isStale={statsStale || logsQuery.isStale}
      isError={statsIsError || logsQuery.isError}
      onRefresh={handleRefresh}
    >
      {statsState.fatalError ? (
        <QueryError error={statsState.fatalError} onRetry={() => { void statsRefetch(); }} />
      ) : statsLoading && stats == null ? (
        <div className="min-h-[44px]" aria-label={t('common.loading', 'Loading')} />
      ) : stats ? (
        <div className="flex h-full min-h-[44px] flex-col justify-center gap-2">
          <WidgetBigNumber
            value={deliveryRate == null ? null : fmtNumber(deliveryRate, 1)}
            unit="%"
            label={t('widget.notificationStats.deliveryRate', 'Delivery rate')}
            align={size.cols <= 1 ? 'center' : 'start'}
          />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {enabledChannels != null && enabledChannels > 0 && (
              <Badge variant="neutral" size="sm">
                {fmtInt(enabledChannels)} {t('widget.notificationStats.activeChannels', 'Active channels')}
              </Badge>
            )}
          </div>
          {lastFailureText && (
            <span className="min-w-0 truncate text-xs text-[var(--text-muted)] tabular-nums" title={lastFailureText}>
              {lastFailureText}
            </span>
          )}
        </div>
      ) : (
        <EmptyState
          variant="informational"
          icon={<Bell className="h-5 w-5" />}
          message={t('widget.notificationStats.noData', 'No notification data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
