/**
 * ChannelStatsBand — full-width KPI strip summarising notification delivery
 * health (total sent, failed, pending, and active-channel ratio). Owns its
 * own loading state: renders four skeletons inside a labelled, `aria-busy`
 * status region until the stats query resolves, then four null-safe metric
 * cards. Every value falls back to `0` (and the channel ratio to `0/0`) so the
 * band never renders a blank or `NaN` cell.
 */

import { useTranslation } from 'react-i18next';
import { Bell, CheckCircle, XCircle } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import type { NotificationStats } from '@/api/types';

interface ChannelStatsBandProps {
  stats?: NotificationStats;
  isLoading: boolean;
}

export function ChannelStatsBand({ stats, isLoading }: ChannelStatsBandProps) {
  const { t } = useTranslation();

  if (isLoading && !stats) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={t('notifications.stats.loading', 'Loading notification statistics')}
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      >
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[76px]" />
        ))}
      </div>
    );
  }

  const enabled = stats?.enabled_channels ?? 0;
  const total = stats?.total_channels ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <MetricCard
        label={t('notifications.stats.sent', 'Total Sent')}
        value={stats?.sent ?? 0}
        icon={<CheckCircle className="h-4 w-4" aria-hidden="true" />}
        color="green"
      />
      <MetricCard
        label={t('notifications.stats.failed', 'Failed')}
        value={stats?.failed ?? 0}
        icon={<XCircle className="h-4 w-4" aria-hidden="true" />}
        color="red"
      />
      <MetricCard
        label={t('notifications.stats.pending', 'Pending')}
        value={stats?.pending ?? 0}
        icon={<Bell className="h-4 w-4" aria-hidden="true" />}
        color="amber"
      />
      <MetricCard
        label={t('notifications.stats.activeChannels', 'Active Channels')}
        value={`${enabled}/${total}`}
        icon={<Bell className="h-4 w-4" aria-hidden="true" />}
        color="cyan"
      />
    </div>
  );
}
