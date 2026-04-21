import { useTranslation } from 'react-i18next';
import { ShieldCheck, Clock, Activity, BarChart3 } from 'lucide-react';
import { fmtInt } from '@/lib/numberFormat';
import { MetricCard } from '@/components/data-display/MetricCard';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import { timeSince } from './helpers';

interface SummaryStatsRowProps {
  isSecure: boolean;
  lastLockChange: string | undefined;
  sentryUptime: number;
  totalEvents: number;
  isLoading: boolean;
}

export function SummaryStatsRow({
  isSecure,
  lastLockChange,
  sentryUptime,
  totalEvents,
  isLoading,
}: SummaryStatsRowProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={88} />
        ))}
      </div>
    );
  }

  return (
    <FadeIn>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label={t('admin.security.stat.status', 'Current Status')}
          value={isSecure ? t('admin.security.secure', 'Secure') : t('admin.security.unsecure', 'Unsecure')}
          icon={<ShieldCheck className="h-5 w-5" />}
          color={isSecure ? 'green' : 'red'}
        />
        <MetricCard
          label={t('admin.security.stat.lastLock', 'Last Lock Change')}
          value={timeSince(lastLockChange)}
          icon={<Clock className="h-5 w-5" />}
          color="cyan"
        />
        <MetricCard
          label={t('admin.security.stat.sentryUptime', 'Sentry Uptime')}
          value={`${fmtInt(sentryUptime)}%`}
          icon={<Activity className="h-5 w-5" />}
          color="blue"
        />
        <MetricCard
          label={t('admin.security.stat.totalEvents', 'Total Events')}
          value={totalEvents}
          icon={<BarChart3 className="h-5 w-5" />}
          color="purple"
        />
      </div>
    </FadeIn>
  );
}
