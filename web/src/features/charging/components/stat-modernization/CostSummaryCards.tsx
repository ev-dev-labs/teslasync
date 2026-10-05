import { useTranslation } from 'react-i18next';
import { DollarSign } from 'lucide-react';
import { StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
import { QueryError, EmptyState } from '@/components/feedback';
import { useSettings } from '@/hooks/useSettings';
import type { StatPeriod } from '@/lib/metric-reference';
import type { CoreStats } from '../cost-analysis/types';
import { energyDisplay, kwhToCanonicalWh } from './displayBoundary';
import { useStatFormatting } from './useStatFormatting';

interface CostSummaryCardsProps {
  coreStats: CoreStats | null;
  gasPrice: number;
  distanceUnit: string;
  isMiles: boolean;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onResetRange?: () => void;
  period: StatPeriod;
}

/** Every original KPI/subtitle remains; null models are empty, not six fabricated zero totals. */
export function CostSummaryCards({
  coreStats, gasPrice, distanceUnit, isMiles, isLoading, error, onRetry, onResetRange, period,
}: CostSummaryCardsProps) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { text, preferences } = useStatFormatting();
  const gasUnitLabel = settings.gas_unit === 'liter' ? 'L' : 'gal';
  const metrics: readonly StatMetric[] = [
    {
      metricId: 'currency', rawValue: coreStats?.totalCost,
      label: t('costAnalysis.stats.totalCost', 'Total Cost'),
      context: `${text('count', coreStats?.count)} ${t('costAnalysis.stats.sessions', 'sessions')}`,
    },
    {
      metricId: 'currency', rawValue: coreStats?.avgCostPerKwh,
      label: t('costAnalysis.stats.avgPerKwh', 'Avg $/kWh'),
      context: t('costAnalysis.stats.blendedRate', 'blended rate'),
    },
    {
      metricId: 'currency', rawValue: coreStats?.costPerDist,
      label: t('costAnalysis.stats.costPerDist', { unit: isMiles ? 'Mile' : 'km', defaultValue: 'Cost Per {{unit}}' }),
      context: `${t('costAnalysis.stats.per', 'per')} ${distanceUnit}`,
    },
    {
      metricId: 'energy', rawValue: kwhToCanonicalWh(coreStats?.totalEnergy),
      label: t('costAnalysis.stats.totalEnergy', 'Total Energy'), display: energyDisplay,
      context: `${text('number', coreStats?.gallonsEquiv)} ${t('costAnalysis.stats.galEquiv', 'gal equiv')}`,
    },
    {
      metricId: 'currency', rawValue: coreStats?.savings,
      label: t('costAnalysis.stats.gasSavings', 'Gas Savings $'),
      context: `${t('costAnalysis.stats.vs', 'vs')} ${text('currency', gasPrice)}/${gasUnitLabel}`,
    },
    {
      metricId: 'percent', rawValue: coreStats?.savingsPercent,
      label: t('costAnalysis.stats.savingsPercent', 'Savings %'),
      context: t('costAnalysis.stats.vsGasoline', 'vs gasoline'),
    },
  ];
  const hasData = coreStats != null;
  return (
    <StatStrip metrics={hasData || (isLoading && !error) ? metrics : []} period={period}
      title={t('costAnalysis.kpis', 'Cost summary metrics')} preferences={preferences}
      loading={isLoading} retained={hasData && Boolean(error || isLoading)}
      footer={error && hasData ? <QueryError error={error} onRetry={onRetry} /> : undefined}
      emptyContent={error ? <QueryError error={error} onRetry={onRetry} /> : (
        <EmptyState
          icon={<DollarSign className="h-6 w-6" aria-hidden="true" />}
          title={t('costAnalysis.stats.emptyTitle', 'No cost data yet')}
          message={t('costAnalysis.stats.emptyMessage',
            'No charging sessions in the selected range. Charge your vehicle or widen the date range to see cost metrics.')}
          action={onResetRange
            ? { label: t('costAnalysis.stats.resetRange', 'Reset date range'), onClick: onResetRange }
            : undefined}
        />
      )}
    />
  );
}
