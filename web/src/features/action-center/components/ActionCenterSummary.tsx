import { useTranslation } from 'react-i18next';
import { GlassPanel, MetricLabel, MetricValue } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { Icons } from '@/lib/icons';
import type { ActionCenterSummary as Summary } from '@/types/actionCenter';

interface ActionCenterSummaryProps {
  summary: Summary | null;
  loading: boolean;
}

export function ActionCenterSummary({ summary, loading }: ActionCenterSummaryProps) {
  const { t } = useTranslation();
  const metrics = [
    { key: 'open', label: t('actionCenter.summary.open', 'Open'), value: summary?.open, Icon: Icons.notifications },
    {
      key: 'critical',
      label: t('actionCenter.summary.critical', 'Critical'),
      value: summary?.critical,
      Icon: Icons.securityAlert,
    },
    { key: 'high', label: t('actionCenter.summary.high', 'High'), value: summary?.high, Icon: Icons.warning },
    {
      key: 'acknowledged',
      label: t('actionCenter.summary.acknowledged', 'Acknowledged'),
      value: summary?.acknowledged,
      Icon: Icons.successFilled,
    },
    {
      key: 'snoozed',
      label: t('actionCenter.summary.snoozed', 'Snoozed'),
      value: summary?.snoozed,
      Icon: Icons.clock,
    },
    {
      key: 'dismissed',
      label: t('actionCenter.summary.dismissed', 'Dismissed'),
      value: summary?.dismissed,
      Icon: Icons.error,
    },
  ] as const;

  return (
    <section aria-label={t('actionCenter.summary.label', 'Action Center summary')}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {metrics.map(({ key, label, value, Icon }) => (
          <GlassPanel key={key} padding="md" className="min-h-24">
            <div className="flex items-center justify-between gap-2">
              <MetricLabel>{label}</MetricLabel>
              <Icon className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            </div>
            {loading ? (
              <Skeleton className="mt-3 h-7 w-12" />
            ) : (
              <MetricValue className="mt-2">{value ?? 0}</MetricValue>
            )}
          </GlassPanel>
        ))}
      </div>
    </section>
  );
}
