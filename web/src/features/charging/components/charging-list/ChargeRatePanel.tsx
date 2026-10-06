import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { type StatMetric } from '@/components/data-display';
import { ChargingSummaryBrief } from '../operationalbrief-all/ChargingSummaryBrief';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import type { ChargeRateStats } from './helpers';

interface ChargeRatePanelProps {
  stats: ChargeRateStats;
}

export function ChargeRatePanel({ stats }: ChargeRatePanelProps) {
  const { t } = useTranslation();
  const { formatDuration, formatEnergy, formatPower } = useUnits();

  const metrics: StatMetric[] = [
    {
      occurrenceId: 'average', metricId: 'power',
      label: t('charging.deliveryRate.average', 'Average delivery rate'),
      rawValue: stats.averagePowerW,
      display: { formatter: raw => ({ value: formatPower(raw), unit: '' }) },
      context: t(
        'charging.deliveryRate.averageDetail',
        'Time-weighted power across completed sessions with usable energy and duration.',
      ),
    },
    {
      occurrenceId: 'best', metricId: 'power',
      label: t('charging.deliveryRate.best', 'Highest-rate session'),
      rawValue: stats.best.powerW,
      display: { formatter: raw => ({ value: formatPower(raw), unit: '' }) },
      context: formatDateTime(stats.best.date),
    },
    {
      occurrenceId: 'worst', metricId: 'power',
      label: t('charging.deliveryRate.worst', 'Lowest-rate session'),
      rawValue: stats.worst.powerW,
      display: { formatter: raw => ({ value: formatPower(raw), unit: '' }) },
      context: formatDateTime(stats.worst.date),
    },
    {
      occurrenceId: 'observed', metricId: 'energy',
      label: t('charging.deliveryRate.observed', 'Observed delivery'),
      rawValue: stats.totalEnergyWh,
      display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) },
      context: t(
        'charging.deliveryRate.observedDetail',
        '{{duration}} across {{count}} sessions',
        {
          duration: formatDuration(stats.totalDurationS),
          count: stats.count,
        },
      ),
    },
  ];

  return (
    <GlassPanel className="p-5">
      <div className="mb-2 flex items-start gap-2">
        <Activity className="mt-0.5 h-4 w-4 text-emerald-300" aria-hidden="true" />
      </div>
      <ChargingSummaryBrief metrics={metrics}
        title={t('charging.deliveryRate.title', 'Charging delivery rate')}
        description={t('charging.deliveryRate.hint', 'Observed energy per elapsed hour; this is power delivery, not wall-to-battery efficiency.')}
        period={{ kind: 'unknown', label: t('charging.brief.loadedSessions', 'Loaded charging sessions'),
          reason: t('charging.brief.deliveryScope', 'Computed from the loaded history, independently of collection and search filters; only usable energy and positive completed-session duration contribute.') }} />
    </GlassPanel>
  );
}
