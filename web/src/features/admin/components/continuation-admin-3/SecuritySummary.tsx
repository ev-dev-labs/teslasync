import { useTranslation } from 'react-i18next';
import { ShieldCheck, Clock, Activity, BarChart3 } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { timeSince } from '../security-access/helpers';

interface SecuritySummaryProps {
  isSecure: boolean | null;
  lastLockChange: string | undefined;
  sentryUptime: number | null;
  totalEvents: number | null;
  latestLoading: boolean;
  historyLoading: boolean;
}

export function SecuritySummary({
  isSecure, lastLockChange, sentryUptime, totalEvents, latestLoading, historyLoading,
}: SecuritySummaryProps) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {latestLoading ? <Skeleton height={88} /> : (
        <MetricCard
          label={t('admin.security.stat.status', 'Current status')}
          value={isSecure === null ? '—' : isSecure
            ? t('admin.security.secure', 'Secure')
            : t('admin.security.unsecure', 'Unsecure')}
          icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
          color={isSecure === null ? 'cyan' : isSecure ? 'green' : 'red'}
        />
      )}
      {historyLoading ? (
        <>
          <Skeleton height={88} />
          <Skeleton height={88} />
          <Skeleton height={88} />
        </>
      ) : (
        <>
          <MetricCard
            label={t('admin.security.stat.lastLock', 'Last lock change')}
            value={timeSince(lastLockChange, t)}
            icon={<Clock className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('admin.security.stat.sentryUptime', 'Sentry uptime')}
            value={sentryUptime === null ? '—' : `${fmtInt(sentryUptime)}%`}
            icon={<Activity className="h-5 w-5" aria-hidden="true" />}
            color="blue"
          />
          <MetricCard
            label={t('admin.security.stat.totalEvents', 'Total events')}
            value={totalEvents === null ? '—' : fmtInt(totalEvents)}
            icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
            color="purple"
          />
        </>
      )}
    </div>
  );
}
