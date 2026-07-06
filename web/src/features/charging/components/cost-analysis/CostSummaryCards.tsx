import { useTranslation } from 'react-i18next';
import {
  DollarSign, Zap, TrendingDown, Car, Fuel,
} from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { GlassPanel } from '@/components/ui';
import { Skeleton, QueryError, EmptyState } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import type { CoreStats } from './types';

interface CostSummaryCardsProps {
  coreStats: CoreStats | null;
  gasPrice: number;
  distanceUnit: string;
  isMiles: boolean;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

const GRID = 'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6';

export function CostSummaryCards({
  coreStats,
  gasPrice,
  distanceUnit,
  isMiles,
  isLoading,
  error,
  onRetry,
}: CostSummaryCardsProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { settings } = useSettings();
  const gasUnitLabel = settings.gas_unit === 'liter' ? 'L' : 'gal';

  if (error) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <QueryError error={error} onRetry={onRetry} />
      </GlassPanel>
    );
  }

  if (isLoading && !coreStats) {
    return (
      <div className={GRID} aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <GlassPanel key={i} className="p-4">
            <Skeleton height={12} width="60%" />
            <Skeleton height={24} width="80%" className="mt-2" />
            <Skeleton height={10} width="40%" className="mt-2" />
          </GlassPanel>
        ))}
      </div>
    );
  }

  // Loaded, no error, but no sessions in range → show a real empty state
  // instead of six misleading "$0.00" tiles (which read as real zero-cost
  // data rather than "nothing to summarise yet").
  if (!coreStats) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <EmptyState
          icon={<DollarSign className="h-6 w-6" aria-hidden="true" />}
          title={t('costAnalysis.stats.emptyTitle', 'No cost data yet')}
          message={t(
            'costAnalysis.stats.emptyMessage',
            'No charging sessions in the selected range. Charge your vehicle or widen the date range to see cost metrics.',
          )}
        />
      </GlassPanel>
    );
  }

  return (
    <div className={GRID}>
      <MetricCard
        color="cyan"
        icon={<DollarSign className="h-5 w-5" aria-hidden="true" />}
        label={t('costAnalysis.stats.totalCost', 'Total Cost')}
        value={formatCurrency(coreStats?.totalCost ?? 0, 2)}
        subtitle={`${fmtInt(coreStats?.count ?? 0)} ${t('costAnalysis.stats.sessions', 'sessions')}`}
      />
      <MetricCard
        color="amber"
        icon={<Zap className="h-5 w-5" aria-hidden="true" />}
        label={t('costAnalysis.stats.avgPerKwh', 'Avg $/kWh')}
        value={formatCurrency(coreStats?.avgCostPerKwh ?? 0, 3)}
        subtitle={t('costAnalysis.stats.blendedRate', 'blended rate')}
      />
      <MetricCard
        color="blue"
        icon={<Car className="h-5 w-5" aria-hidden="true" />}
        label={t('costAnalysis.stats.costPerDist', { unit: isMiles ? 'Mile' : 'km', defaultValue: 'Cost Per {{unit}}' })}
        value={formatCurrency(coreStats?.costPerDist ?? 0, 3)}
        subtitle={`${t('costAnalysis.stats.per', 'per')} ${distanceUnit}`}
      />
      <MetricCard
        color="green"
        icon={<Zap className="h-5 w-5" aria-hidden="true" />}
        label={t('costAnalysis.stats.totalEnergy', 'Total Energy')}
        value={fmtWithUnit(coreStats?.totalEnergy ?? 0, 'kWh', 1)}
        subtitle={`${fmtNumber(coreStats?.gallonsEquiv ?? 0, 1)} ${t('costAnalysis.stats.galEquiv', 'gal equiv')}`}
      />
      <MetricCard
        color="green"
        icon={<Fuel className="h-5 w-5" aria-hidden="true" />}
        label={t('costAnalysis.stats.gasSavings', 'Gas Savings $')}
        value={formatCurrency(coreStats?.savings ?? 0, 2)}
        subtitle={`${t('costAnalysis.stats.vs', 'vs')} ${formatCurrency(gasPrice, 2)}/${gasUnitLabel}`}
      />
      <MetricCard
        color="green"
        icon={<TrendingDown className="h-5 w-5" aria-hidden="true" />}
        label={t('costAnalysis.stats.savingsPercent', 'Savings %')}
        value={`${fmtNumber(coreStats?.savingsPercent ?? 0, 1)}%`}
        subtitle={t('costAnalysis.stats.vsGasoline', 'vs gasoline')}
      />
    </div>
  );
}
