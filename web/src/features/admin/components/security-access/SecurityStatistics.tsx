import { useTranslation } from 'react-i18next';
import { Lock, Eye, DoorOpen, Car, Home, UserCheck, Activity } from 'lucide-react';
import { fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { GlassPanel, PanelTitle } from '@/components/ui';
import type { SecurityStats } from './helpers';

/** Responsive metric grid: 2 cols on phones, 3 on small, 2 in the xl bento column. */
const GRID_CLASS = 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2';

interface SecurityStatisticsProps {
  securityStats: SecurityStats | null;
  sentryUptime: number;
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function SecurityStatistics({
  securityStats,
  sentryUptime,
  isLoading,
  error,
  onRetry,
  className,
}: SecurityStatisticsProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <PanelTitle className="mb-3">{t('admin.security.statsTitle', 'Security Statistics')}</PanelTitle>
      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <div aria-hidden="true" className={GRID_CLASS}>
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} height={80} />
          ))}
        </div>
      ) : securityStats ? (
        <div
          role="group"
          aria-label={t('admin.security.stats.aria', 'Security statistics metrics')}
          className={GRID_CLASS}
        >
          <MetricCard
            label={t('admin.security.stats.lockEvents', 'Lock/Unlock Events')}
            value={securityStats.lockEvents ?? 0}
            icon={<Lock className="h-4 w-4" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('admin.security.stats.sentryUptime', 'Sentry Uptime')}
            value={`${fmtInt(sentryUptime)}%`}
            icon={<Eye className="h-4 w-4" aria-hidden="true" />}
            color="blue"
          />
          <MetricCard
            label={t('admin.security.stats.doorOpens', 'Door Open Events')}
            value={securityStats.doorOpenCount ?? 0}
            icon={<DoorOpen className="h-4 w-4" aria-hidden="true" />}
            color="amber"
          />
          <MetricCard
            label={t('admin.security.stats.windowOpens', 'Window Open Events')}
            value={securityStats.windowOpenCount ?? 0}
            icon={<Car className="h-4 w-4" aria-hidden="true" />}
            color="amber"
          />
          <MetricCard
            label={t('admin.security.stats.homelink', 'HomeLink Detections')}
            value={securityStats.homelinkCount ?? 0}
            icon={<Home className="h-4 w-4" aria-hidden="true" />}
            color="purple"
          />
          <MetricCard
            label={t('admin.security.stats.guestMode', 'Guest Mode Usage')}
            value={securityStats.guestCount ?? 0}
            icon={<UserCheck className="h-4 w-4" aria-hidden="true" />}
            color="amber"
          />
          <MetricCard
            label={t('admin.security.stats.totalEvents', 'Total Events')}
            value={securityStats.total ?? 0}
            icon={<Activity className="h-4 w-4" aria-hidden="true" />}
            color="cyan"
          />
        </div>
      ) : (
        <EmptyState
          icon={<Activity className="h-8 w-8" aria-hidden="true" />}
          message={t('common.noData', 'No data available')}
          className="py-8"
          action={onRetry ? { label: t('common.retry', 'Retry'), onClick: onRetry } : undefined}
        />
      )}
    </GlassPanel>
  );
}
