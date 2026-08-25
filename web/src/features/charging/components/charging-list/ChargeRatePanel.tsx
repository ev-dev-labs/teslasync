import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { GlassPanel, MetricLabel, MetricValue, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import type { ChargeRateStats } from './helpers';

interface ChargeRatePanelProps {
  stats: ChargeRateStats;
}

export function ChargeRatePanel({ stats }: ChargeRatePanelProps) {
  const { t } = useTranslation();
  const { formatDuration, formatEnergy, formatPower } = useUnits();

  const metrics = [
    {
      key: 'average',
      label: t('charging.deliveryRate.average', 'Average delivery rate'),
      value: formatPower(stats.averagePowerW),
      detail: t(
        'charging.deliveryRate.averageDetail',
        'Time-weighted power across completed sessions with usable energy and duration.',
      ),
    },
    {
      key: 'best',
      label: t('charging.deliveryRate.best', 'Highest-rate session'),
      value: formatPower(stats.best.powerW),
      detail: formatDateTime(stats.best.date),
    },
    {
      key: 'worst',
      label: t('charging.deliveryRate.worst', 'Lowest-rate session'),
      value: formatPower(stats.worst.powerW),
      detail: formatDateTime(stats.worst.date),
    },
    {
      key: 'observed',
      label: t('charging.deliveryRate.observed', 'Observed delivery'),
      value: formatEnergy(stats.totalEnergyWh),
      detail: t(
        'charging.deliveryRate.observedDetail',
        '{{duration}} across {{count}} sessions',
        {
          duration: formatDuration(stats.totalDurationS),
          count: stats.count,
        },
      ),
    },
  ] as const;

  return (
    <GlassPanel className="p-5">
      <div className="mb-4 flex items-start gap-2">
        <Activity className="mt-0.5 h-4 w-4 text-emerald-300" aria-hidden="true" />
        <div>
          <PanelTitle>{t('charging.deliveryRate.title', 'Charging delivery rate')}</PanelTitle>
          <Text as="p" size="xs" color="muted" className="mt-1">
            {t(
              'charging.deliveryRate.hint',
              'Observed energy per elapsed hour; this is power delivery, not wall-to-battery efficiency.',
            )}
          </Text>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <GlassPanel key={metric.key} className="p-4">
            <MetricValue className="text-xl">{metric.value}</MetricValue>
            <MetricLabel className="mt-1">{metric.label}</MetricLabel>
            <Text as="p" size="2xs" color="muted" className="mt-1">
              {metric.detail}
            </Text>
          </GlassPanel>
        ))}
      </div>
    </GlassPanel>
  );
}
