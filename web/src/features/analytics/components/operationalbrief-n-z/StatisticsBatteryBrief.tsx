import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Battery } from 'lucide-react';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { LayoutCard } from '@/components/layout';
import { LinearGauge } from '@/components/charts';
import { EmptyState, Skeleton } from '@/components/feedback';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { StatisticsSource } from '../statistics-modernization/StatisticsSource';
import type { BatteryStatistics } from '../statistics-modernization/BatteryStatistics';

export function StatisticsBatteryBrief({ query }: ComponentProps<typeof BatteryStatistics>) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const battery = query.data;
  const metrics: StatMetric[] = [
    { metricId: 'energy', occurrenceId: 'statistics-battery-capacity',
      rawValue: battery?.estimated_capacity_wh, label: t('statistics.capacity', 'Capacity'),
      display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'rate', occurrenceId: 'statistics-battery-degradation',
      rawValue: battery?.degradation_rate_pct_per_year, label: t('statistics.degradation', 'Degradation'),
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: '%/yr' }) } },
    { metricId: 'count', occurrenceId: 'statistics-battery-cycles',
      rawValue: battery?.total_cycles, label: t('statistics.cycles', 'Cycles'),
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
    { metricId: 'rate', occurrenceId: 'statistics-battery-age',
      rawValue: battery?.battery_age_months, label: t('statistics.age', 'Age'),
      display: { formatter: raw => ({ value: String(raw), unit: 'mo' }) } },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return <LayoutCard title={t('statistics.batteryHealth', 'Battery health')}>
    <StatisticsSource hasData={battery != null} loading={query.isLoading} error={query.error}
      onRetry={() => { void query.refetch(); }} skeleton={<Skeleton className="h-40 rounded-xl" />}
      empty={<EmptyState icon={<Battery className="h-8 w-8" aria-hidden="true" />}
        message={t('statistics.noBattery', 'No battery health data available')}
        description={t('statistics.noBatteryDescription', 'Battery health estimates appear after enough charging and range telemetry has accumulated.')}
        actionTo={{ label: t('routes.batteryHealth', 'Battery health'), to: '/battery' }} className="py-8" />}
    >
      {battery && <div className="flex justify-center">
        <LinearGauge value={Math.round(battery.current_soh ?? 0)} max={100}
          label={t('statistics.health', 'Health')} unit="%" tone="success" size={140} className="max-w-xs" />
      </div>}
    </StatisticsSource>
    <OperationalBrief compact testId="statistics-battery-brief"
      eyebrow={t('statistics.batteryHealth', 'Battery health')}
      title={t('statistics.brief.batteryTitle', 'Battery estimate evidence')}
      description={t('statistics.brief.batteryDescription', 'Capacity, annual degradation rate, cycle count and source-reported age retain their distinct units.')}
      statusLabel={battery ? query.error ? t('statistics.brief.retained', 'Retained statistics') : t('statistics.brief.available', 'Returned statistics')
        : query.isLoading ? t('statistics.brief.loading', 'Loading statistics') : t('statistics.brief.unavailable', 'Statistics unavailable')}
      statusTone={query.error ? 'warning' : 'neutral'}
      scope={t('statistics.brief.batteryScope', 'Battery-health source estimates; observation bounds unknown')}
      provenance={t('statistics.batteryHealth', 'Battery health')} metrics={operationalMetrics}
      loading={query.isLoading && !battery} />
  </LayoutCard>;
}
