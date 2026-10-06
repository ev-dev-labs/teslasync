import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Delta } from '@/components/data-display';
import { EmptyState, QueryError } from '@/components/feedback';
import { type StatMetric } from '@/components/data-display/stat-reference';
import { ChargingSummaryBrief } from '../operationalbrief-all/ChargingSummaryBrief';
import type { StatPeriod } from '@/lib/metric-reference';
import type { ChargingPeriodStats } from '@/lib/chargingAggregation';
import { convertEnergyFromSI, convertPowerFromSI } from '@/lib/unitConversion';
import { kwToCanonicalWatts, minutesToCanonicalSeconds } from './displayBoundary';

export interface ChargingOverviewStatsProps {
  stats: ChargingPeriodStats;
  priorStats: ChargingPeriodStats | null;
  priorHasData: boolean;
  hasRecordedCosts: boolean;
  period: StatPeriod;
  priorLabel?: string;
  secondary: ReactNode;
  footer: ReactNode;
  loading: boolean;
  retained: boolean;
  error?: unknown;
  onRetry?: () => void;
}

/** Six distinct existing aggregates. Existing Delta remains the specialist comparison owner. */
export function ChargingOverviewStats({
  stats, priorStats, priorHasData, hasRecordedCosts, period, priorLabel,
  secondary, footer, loading, retained, error, onRetry,
}: ChargingOverviewStatsProps) {
  const { t } = useTranslation();
  const prior = priorHasData ? priorStats : null;
  const metrics: readonly StatMetric[] = [
    { metricId: 'charge.sessions', rawValue: stats.count, label: t('charging.totalSessions', 'Sessions'),
      display: { notation: 'compact' },
      comparisonContent: prior ? <Delta metric="trip_count" current={stats.count} previous={prior.count} display="percent" /> : undefined },
    { metricId: 'charge.energyAdded', rawValue: stats.totalEnergyWh,
      label: t('charging.totalEnergy', 'Energy (kWh)'),
      display: { units: { energy: 'kWh' }, notation: 'compact', compactThreshold: 10000 },
      comparisonContent: prior ? <Delta metric="energy_consumed"
        current={convertEnergyFromSI(stats.totalEnergyWh, 'kWh')}
        previous={convertEnergyFromSI(prior.totalEnergyWh, 'kWh')} display="percent" /> : undefined },
    { metricId: 'charge.recordedCost', rawValue: hasRecordedCosts ? stats.totalCost : null,
      label: t('charging.totalCost', 'Cost'), missingReason: hasRecordedCosts ? undefined : t('charging.stats.costMissing', 'No recorded session costs in the selected returned sessions.'),
      comparisonContent: prior ? <Delta metric="cost" current={stats.totalCost} previous={prior.totalCost} display="percent" /> : undefined },
    { metricId: 'charge.overallRate', rawValue: kwToCanonicalWatts(stats.avgRateKw),
      label: t('developerReference.stats.metric.charge.overallRate.label', 'Overall charging rate'),
      context: t('charging.avgRate', 'Avg rate (kW)'), display: { units: { power: 'kW' } },
      comparisonContent: prior && stats.avgRateKw != null && prior.avgRateKw != null
        ? <Delta metric={{ direction: 'neutral' }} current={stats.avgRateKw} previous={prior.avgRateKw} display="percent" /> : undefined },
    { metricId: 'charge.avgDuration', rawValue: minutesToCanonicalSeconds(stats.avgDurationMin),
      label: t('charging.avgDuration', 'Avg duration'), display: { durationStyle: 'roundedMinutes' },
      comparisonContent: prior && stats.avgDurationMin != null && prior.avgDurationMin != null
        ? <Delta metric={{ direction: 'neutral' }} current={stats.avgDurationMin} previous={prior.avgDurationMin} display="percent" /> : undefined },
    { metricId: 'charge.meanSessionPower', rawValue: stats.avgPowerW,
      label: t('developerReference.stats.metric.charge.meanSessionPower.label', 'Mean session power'),
      context: t('charging.avgPower', 'Avg power (kW)'), display: { units: { power: 'kW' } },
      comparisonContent: prior && stats.avgPowerW != null && prior.avgPowerW != null
        ? <Delta metric={{ direction: 'neutral' }}
          current={convertPowerFromSI(stats.avgPowerW, 'kW')}
          previous={convertPowerFromSI(prior.avgPowerW, 'kW')} display="percent" /> : undefined },
  ];
  return <ChargingSummaryBrief id="charging-overview" testId="charging-overview"
    title={t('charging.overview', 'Overview')} period={period} comparisonLabel={priorLabel}
    metrics={stats.count > 0 || loading ? metrics : []} loading={loading} retained={retained}
    secondary={secondary} footer={footer}
    emptyContent={error
      ? <QueryError error={error} onRetry={onRetry} />
      : <EmptyState
        message={t('charging.noStatsRange', 'No charging sessions in this range')}
        action={onRetry ? { label: t('common.retry', 'Retry'), onClick: onRetry } : undefined}
      />} />;
}
