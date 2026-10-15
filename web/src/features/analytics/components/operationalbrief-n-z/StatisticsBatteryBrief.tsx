import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Battery } from 'lucide-react';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { LayoutCard } from '@/components/layout';
import { LinearGauge } from '@/components/charts';
import { DataSourceNotice, EmptyState, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';
import { StatisticsSource } from '../statistics-modernization/StatisticsSource';
import type { BatteryStatistics } from '../statistics-modernization/BatteryStatistics';

export function StatisticsBatteryBrief({ query }: ComponentProps<typeof BatteryStatistics>) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const battery: (NonNullable<typeof query.data> & { current_soh_available?: boolean }) | null | undefined = query.data;
  // Older responses encode unsupported SOH as zero; evidence, not the reading's sign, distinguishes it.
  const hasHealthEvidence = battery != null && (battery.current_soh_available ?? (
    (isFiniteNumber(battery.estimated_capacity_wh) && battery.estimated_capacity_wh > 0 &&
      isFiniteNumber(battery.original_capacity_wh) && battery.original_capacity_wh > 0) ||
    (battery.history ?? []).some(point =>
      isFiniteNumber(point.soh_pct) && isFiniteNumber(point.capacity_wh) && point.capacity_wh >= 0) ||
    battery.prediction?.has_enough_data === true
  ));
  const health = battery != null && hasHealthEvidence && isFiniteNumber(battery.current_soh) ? battery.current_soh : null;
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
      display: { formatter: raw => ({
        value: fmtNumber(raw),
        unit: t('statistics.ageMonths', { count: raw, defaultValue: raw === 1 ? 'month' : 'months' }),
      }) } },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const source = useDataState({ ...query, data: battery ?? undefined }, { provenance: 'historical' });
  const loading = query.isLoading && !source.isRefreshBlocked;
  const label = t('statistics.batteryHealth', 'Battery health');
  return <LayoutCard title={label}>
    <StaleRefreshWarning state={source} label={label} />
    <StatisticsSource hasData={battery != null} loading={loading} error={source.fatalError}
      onRetry={() => { void query.refetch(); }} skeleton={<Skeleton className="h-40 rounded-xl" />}
      empty={source.isRefreshBlocked
        ? <DataSourceNotice sources={[{ id: 'statistics-battery', label, query: { ...query, data: battery ?? undefined } }]} />
        : <EmptyState icon={<Battery className="h-8 w-8" aria-hidden="true" />}
        message={t('statistics.noBattery', 'No battery health data available')}
        description={t('statistics.noBatteryDescription', 'Battery health estimates appear after enough charging and range telemetry has accumulated.')}
        actionTo={{ label: t('routes.batteryHealth', 'Battery health'), to: '/battery' }} className="py-8" />}
    >
      {battery && <div className="flex justify-center">
        <LinearGauge value={health} preserveReadingAndScale max={100}
          label={t('statistics.health', 'Health')} unit="%" tone="neutral" size={140} className="max-w-xs" />
      </div>}
    </StatisticsSource>
    <OperationalBrief compact testId="statistics-battery-brief"
      eyebrow={t('statistics.batteryHealth', 'Battery health')}
      title={t('statistics.brief.batteryTitle', 'Battery estimate evidence')}
      description={t('statistics.brief.batteryDescription', 'Capacity, annual degradation rate, cycle count and source-reported age retain their distinct units.')}
      statusLabel={source.isRefreshBlocked ? t('dataSources.status.paused', 'Refresh paused')
        : source.isRefreshing ? t('dataSources.status.refreshing', 'Refreshing')
        : battery ? source.refreshError ? t('statistics.brief.retained', 'Retained statistics') : t('statistics.brief.available', 'Returned statistics')
        : loading ? t('statistics.brief.loading', 'Loading statistics') : t('statistics.brief.unavailable', 'Statistics unavailable')}
      statusTone={source.refreshError || source.isRefreshBlocked ? 'warning' : 'neutral'}
      scope={t('statistics.brief.batteryScope', 'Battery-health source estimates; observation bounds unknown')}
      provenance={t('statistics.batteryHealth', 'Battery health')} metrics={operationalMetrics}
      loading={loading && !battery} />
  </LayoutCard>;
}
