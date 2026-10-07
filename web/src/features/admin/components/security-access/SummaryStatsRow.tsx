import { useTranslation } from 'react-i18next';
import { ShieldCheck, Clock, Activity, BarChart3 } from 'lucide-react';

import { MetricCard } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { timeSince } from './helpers';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface SummaryStatsRowProps {
  isSecure: boolean;
  lastLockChange: string | undefined;
  sentryUptime: number;
  totalEvents: number;
  isLoading: boolean;
}

/** Full-width KPI band — the top-of-page summary metrics. */
export function SummaryStatsRow({
  isSecure,
  lastLockChange,
  sentryUptime,
  totalEvents,
  isLoading,
}: SummaryStatsRowProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        role="status"
        aria-busy="true"
        aria-label={t('common.loading', 'Loading…')}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={88} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <MetricCard
        label={t('admin.security.stat.status', 'Current status')}
        value={isSecure ? t('admin.security.secure', 'Secure') : t('admin.security.unsecure', 'Unsecure')}
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
        color={isSecure ? 'green' : 'red'}
      />
      <MetricCard
        label={t('admin.security.stat.lastLock', 'Last lock change')}
        value={timeSince(lastLockChange, t)}
        icon={<Clock className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('admin.security.stat.sentryUptime', 'Sentry uptime')}
        value={`${fmtInt(sentryUptime)}%`}
        icon={<Activity className="h-5 w-5" aria-hidden="true" />}
        color="blue"
      />
      <MetricCard
        label={t('admin.security.stat.totalEvents', 'Total events')}
        // fmtInt matches the Sentry Uptime card, adds locale thousands
        // separators for large histories, and coerces a non-finite count to 0.
        value={fmtInt(totalEvents)}
        icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
        color="purple"
      />
    </div>
  );
}
