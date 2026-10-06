/**
 * ChannelStatsBand — full-width KPI strip summarising notification delivery
 * health (total sent, failed, pending, and active-channel ratio). Owns its
 * own loading state: renders four skeletons inside a labelled, `aria-busy`
 * status region until the stats query resolves, then four null-safe metric
 * cards. Every value falls back to `0` (and the channel ratio to `0/0`) so the
 * band never renders a blank or `NaN` cell. A failed stats query renders an
 * inline error with retry instead of zeros that would read as healthy.
 */

import { useTranslation } from 'react-i18next';
import { Bell, CheckCircle, XCircle } from 'lucide-react';
import { OperationalBrief, DataProvenanceBadge, type StatMetric } from '@/components/data-display';
import { QueryError, Skeleton } from '@/components/feedback';
import type { NotificationStats } from '@/api/types';
import type { DataState } from '@/api/dataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

interface ChannelStatsBandProps {
  stats?: NotificationStats;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  retained?: boolean;
  source?: DataState<NotificationStats>;
}

export function ChannelStatsBand({ stats, isLoading, error, onRetry, retained = false, source }: ChannelStatsBandProps) {
  const { t } = useTranslation();

  const enabled = stats?.enabled_channels ?? 0;
  const total = stats?.total_channels ?? 0;
  const metrics: StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'channels-sent', rawValue: stats?.sent ?? 0,
      label: t('notifications.stats.sent', 'Total sent'),
      context: <CheckCircle className="h-4 w-4" aria-hidden="true" />,
    },
    {
      metricId: 'count', occurrenceId: 'channels-failed', rawValue: stats?.failed ?? 0,
      label: t('notifications.stats.failed', 'Failed'),
      context: <XCircle className="h-4 w-4" aria-hidden="true" />,
    },
    {
      metricId: 'count', occurrenceId: 'channels-pending', rawValue: stats?.pending ?? 0,
      label: t('notifications.stats.pending', 'Pending'),
      context: <Bell className="h-4 w-4" aria-hidden="true" />,
    },
    {
      metricId: 'count', occurrenceId: 'channels-active', rawValue: enabled,
      display: { countTotal: total },
      label: t('notifications.stats.activeChannels', 'Active channels'),
      context: <Bell className="h-4 w-4" aria-hidden="true" />,
    },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  if (error && !stats) {
    return <QueryError error={error} onRetry={onRetry} compact
      resourceName={t('notifications.stats.resource', 'notification statistics')} />;
  }
  if (isLoading && !stats) {
    return <div role="status" aria-busy="true"
      aria-label={t('notifications.stats.loading', 'Loading notification statistics')}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[76px]" />)}
    </div>;
  }

  return (
    <OperationalBrief
      compact
      testId="notification-channel-brief"
      eyebrow={t('notifications.stats.brief.eyebrow', 'Notification delivery')}
      title={t('notifications.stats.brief.title', 'Delivery channels and recorded outcomes')}
      description={t('notifications.stats.periodReason', 'Delivery counts have no reported time bounds; active channels are the configured enabled/total count.')}
      statusLabel={retained
        ? t('dataState.stale.title', 'Data may be stale')
        : stats ? t('notifications.stats.brief.available', 'Statistics available')
          : t('notifications.stats.brief.unavailable', 'No statistics supplied')}
      statusTone={retained ? 'warning' : 'neutral'}
      metrics={operationalMetrics}
      scope={t('notifications.stats.period', 'Delivery statistics and current channels')}
      freshness={<DataProvenanceBadge provenance={source?.provenance ?? 'unknown'}
        status={source?.status ?? (retained ? 'stale' : 'ok')} updatedAt={source?.updatedAt} />}
      provenance={t('notifications.stats.periodReason', 'Delivery counts have no reported time bounds; active channels are the configured enabled/total count.')}
    />
  );
}
