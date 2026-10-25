import { Icons } from '@/lib/icons';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { GlassPanel, PanelTitle } from '@/components/ui';
import type { SecurityStats } from './helpers';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <PanelTitle className="mb-3">{t('admin.security.statsTitle', 'Security statistics')}</PanelTitle>
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
            label={t('admin.security.stats.lockEvents', 'Lock/unlock events')}
            value={securityStats.lockEvents ?? 0}
            icon={<Icons.locked className="h-4 w-4" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('admin.security.stats.sentryUptime', 'Sentry uptime')}
            value={`${fmtInt(sentryUptime)}%`}
            icon={<Icons.show className="h-4 w-4" aria-hidden="true" />}
            color="blue"
          />
          <MetricCard
            label={t('admin.security.stats.doorOpens', 'Door open events')}
            value={securityStats.doorOpenCount ?? 0}
            icon={<Icons.doorOpen className="h-4 w-4" aria-hidden="true" />}
            color="amber"
          />
          <MetricCard
            label={t('admin.security.stats.windowOpens', 'Window open events')}
            value={securityStats.windowOpenCount ?? 0}
            icon={<Icons.vehicle className="h-4 w-4" aria-hidden="true" />}
            color="amber"
          />
          <MetricCard
            label={t('admin.security.stats.homelink', 'HomeLink detections')}
            value={securityStats.homelinkCount ?? 0}
            icon={<Icons.home className="h-4 w-4" aria-hidden="true" />}
            color="purple"
          />
          <MetricCard
            label={t('admin.security.stats.guestMode', 'Guest mode usage')}
            value={securityStats.guestCount ?? 0}
            icon={<Icons.userCheck className="h-4 w-4" aria-hidden="true" />}
            color="amber"
          />
          <MetricCard
            label={t('admin.security.stats.totalEvents', 'Total events')}
            value={securityStats.total ?? 0}
            icon={<Icons.activity className="h-4 w-4" aria-hidden="true" />}
            color="cyan"
          />
        </div>
      ) : (
        <EmptyState
          icon={<Icons.activity className="h-8 w-8" aria-hidden="true" />}
          message={t(
            'admin.security.statsEmpty',
            'No security events are available in this history window.',
          )}
          description={t(
            'admin.security.statsEmptyDescription',
            'Lock, door, window, HomeLink, and Sentry statistics appear after security state changes are recorded.',
          )}
          className="py-8"
          action={onRetry ? {
            label: t('admin.security.refreshHistory', 'Refresh security history'),
            onClick: onRetry,
          } : undefined}
        />
      )}
    </GlassPanel>
  );
}
