import { useTranslation } from 'react-i18next';
import { Lock, Eye, DoorOpen, Car, Home, UserCheck, Activity } from 'lucide-react';
import { fmtInt } from '@/lib/numberFormat';
import { MetricCard } from '@/components/data-display/MetricCard';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { FadeIn } from '@/components/motion/FadeIn';
import type { SecurityStats } from './helpers';

interface SecurityStatisticsProps {
  securityStats: SecurityStats | null;
  sentryUptime: number;
  isLoading: boolean;
}

export function SecurityStatistics({ securityStats, sentryUptime, isLoading }: SecurityStatisticsProps) {
  const { t } = useTranslation();

  return (
    <FadeIn delay={0.25}>
      <GlassPanel className="p-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          {t('admin.security.statsTitle', 'Security Statistics')}
        </h2>
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} height={80} />
            ))}
          </div>
        ) : securityStats ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <MetricCard
              label={t('admin.security.stats.lockEvents', 'Lock/Unlock Events')}
              value={securityStats.lockEvents}
              icon={<Lock className="h-4 w-4" />}
              color="green"
            />
            <MetricCard
              label={t('admin.security.stats.sentryUptime', 'Sentry Uptime')}
              value={`${fmtInt(sentryUptime)}%`}
              icon={<Eye className="h-4 w-4" />}
              color="blue"
            />
            <MetricCard
              label={t('admin.security.stats.doorOpens', 'Door Open Events')}
              value={securityStats.doorOpenCount}
              icon={<DoorOpen className="h-4 w-4" />}
              color="amber"
            />
            <MetricCard
              label={t('admin.security.stats.windowOpens', 'Window Open Events')}
              value={securityStats.windowOpenCount}
              icon={<Car className="h-4 w-4" />}
              color="amber"
            />
            <MetricCard
              label={t('admin.security.stats.homelink', 'HomeLink Detections')}
              value={securityStats.homelinkCount}
              icon={<Home className="h-4 w-4" />}
              color="purple"
            />
            <MetricCard
              label={t('admin.security.stats.guestMode', 'Guest Mode Usage')}
              value={securityStats.guestCount}
              icon={<UserCheck className="h-4 w-4" />}
              color="amber"
            />
            <MetricCard
              label={t('admin.security.stats.totalEvents', 'Total Events')}
              value={securityStats.total}
              icon={<Activity className="h-4 w-4" />}
              color="cyan"
            />
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Activity className="h-8 w-8 opacity-20" />}
            message={t('common.noData', 'No data available')}
            className="py-8"
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
