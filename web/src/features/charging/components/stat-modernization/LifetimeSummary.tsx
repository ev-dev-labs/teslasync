import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { type StatMetric } from '@/components/data-display/stat-reference';
import { ChargingSummaryBrief } from '../operationalbrief-all/ChargingSummaryBrief';
import type { StatPeriod } from '@/lib/metric-reference';
import type { CoreStats, LifetimeMetrics } from '../cost-analysis/types';
import { CostStatSection } from './CostStatSection';
import { energyDisplay, minuteDisplay, kwhToCanonicalWh, minutesToCanonicalSeconds } from './displayBoundary';
import { useStatFormatting } from './useStatFormatting';

interface LifetimeSummaryProps {
  lifetimeMetrics: LifetimeMetrics | null;
  coreStats: CoreStats | null;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  period: StatPeriod;
}

/** Historical title is retained, with the bounded selected-query scope disclosed explicitly. */
export function LifetimeSummary({
  lifetimeMetrics, coreStats, isLoading, error, onRetry, period,
}: LifetimeSummaryProps) {
  const { t } = useTranslation();
  const { text, preferences } = useStatFormatting();
  const hasData = lifetimeMetrics != null && coreStats != null;
  const metrics: readonly StatMetric[] = [
    {
      metricId: 'currency',
      rawValue: coreStats?.totalCost,
      label: t('costAnalysis.lifetime.totalSpent', 'Total Spent'),
    },
    {
      metricId: 'energy',
      rawValue: kwhToCanonicalWh(coreStats?.totalEnergy),
      display: energyDisplay,
      label: t('costAnalysis.lifetime.totalEnergy', 'Total Energy'),
    },
    {
      metricId: 'count',
      rawValue: coreStats?.count,
      label: t('costAnalysis.lifetime.totalSessions', 'Total Sessions'),
    },
    {
      metricId: 'currency',
      rawValue: lifetimeMetrics?.avgSessionCost,
      label: t('costAnalysis.lifetime.avgSessionCost', 'Avg Session Cost'),
    },
    {
      metricId: 'energy',
      rawValue: kwhToCanonicalWh(lifetimeMetrics?.avgSessionEnergy),
      display: energyDisplay,
      label: t('costAnalysis.lifetime.avgEnergy', 'Avg Energy / Session'),
    },
    {
      metricId: 'duration',
      rawValue: minutesToCanonicalSeconds(lifetimeMetrics?.avgDuration),
      display: minuteDisplay,
      label: t('costAnalysis.lifetime.avgDuration', 'Avg Duration'),
    },
    {
      metricId: 'count',
      rawValue: lifetimeMetrics?.freeCount,
      label: t('costAnalysis.lifetime.freeSessions', 'Free Sessions'),
      context: `(${text('energy', kwhToCanonicalWh(lifetimeMetrics?.freeEnergy), energyDisplay)})`,
    },
  ];
  return (
    <CostStatSection title={t('costAnalysis.lifetime.title', 'Lifetime Summary')}
      icon={<TrendingUp className="h-4 w-4 text-cyan-300" aria-hidden="true" />} glow="cyan"
      isLoading={isLoading} error={error} onRetry={onRetry} retained={hasData}
      isEmpty={!hasData} period={period}
      emptyMessage={t('costAnalysis.lifetime.noData', 'No data')} skeletonHeight={200}>
      {periodHeaderId => (
        <ChargingSummaryBrief title={t('costAnalysis.lifetime.title', 'Lifetime Summary')}
          metrics={metrics} period={period} preferences={preferences}
          periodInHeader periodContextInHeader periodHeaderId={periodHeaderId} />
      )}
    </CostStatSection>
  );
}
