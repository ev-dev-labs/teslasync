import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { Text } from '@/components/ui';
import { useFormatting } from '@/hooks/useFormatting';
import { fmtNumber, fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import { CostSection } from './CostSection';
import type { CoreStats, LifetimeMetrics } from './types';

interface LifetimeSummaryProps {
  lifetimeMetrics: LifetimeMetrics | null;
  coreStats: CoreStats | null;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

function LifetimeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--surface-2)] p-3">
      <Text as="p" variant="caption" className="truncate">{label}</Text>
      <Text as="p" size="sm" weight="semibold" color="primary" className="mt-0.5">
        {value}
      </Text>
    </div>
  );
}

export function LifetimeSummary({
  lifetimeMetrics, coreStats, isLoading, error, onRetry,
}: LifetimeSummaryProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  return (
    <CostSection
      title={t('costAnalysis.lifetime.title', 'Lifetime Summary')}
      icon={<TrendingUp className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      glow="cyan"
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={!lifetimeMetrics || !coreStats}
      emptyMessage={t('costAnalysis.lifetime.noData', 'No data')}
      skeletonHeight={200}
    >
      {lifetimeMetrics && coreStats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 3xl:grid-cols-4">
          <LifetimeMetric
            label={t('costAnalysis.lifetime.totalSpent', 'Total Spent')}
            value={formatCurrency(coreStats.totalCost, 2)}
          />
          <LifetimeMetric
            label={t('costAnalysis.lifetime.totalEnergy', 'Total Energy')}
            value={fmtWithUnit(coreStats.totalEnergy, 'kWh', 1)}
          />
          <LifetimeMetric
            label={t('costAnalysis.lifetime.totalSessions', 'Total Sessions')}
            value={fmtInt(coreStats.count)}
          />
          <LifetimeMetric
            label={t('costAnalysis.lifetime.avgSessionCost', 'Avg Session Cost')}
            value={formatCurrency(lifetimeMetrics.avgSessionCost, 2)}
          />
          <LifetimeMetric
            label={t('costAnalysis.lifetime.avgEnergy', 'Avg Energy / Session')}
            value={fmtWithUnit(lifetimeMetrics.avgSessionEnergy, 'kWh', 1)}
          />
          <LifetimeMetric
            label={t('costAnalysis.lifetime.avgDuration', 'Avg Duration')}
            value={`${fmtNumber(lifetimeMetrics.avgDuration, 0)} min`}
          />
          <LifetimeMetric
            label={t('costAnalysis.lifetime.freeSessions', 'Free Sessions')}
            value={`${fmtInt(lifetimeMetrics.freeCount)} (${fmtWithUnit(lifetimeMetrics.freeEnergy, 'kWh', 1)})`}
          />
        </div>
      )}
    </CostSection>
  );
}
