import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { Car, Activity, Zap, Fuel, BarChart3, Leaf } from 'lucide-react';
import { SectionTitle, GlassPanel } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { QueryError } from '@/components/feedback';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { trendFor } from './helpers';
import { formatEfficiencyFromSI } from './display';
import type { DigestMetrics } from './types';

interface WeekOverWeekSummaryProps {
  metrics: DigestMetrics;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function WeekOverWeekSummary({
  metrics,
  isLoading,
  isError,
  error,
  onRetry,
}: WeekOverWeekSummaryProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { unitPrefs, formatDistance, formatEnergy } = useUnits();

  return (
    <section
      aria-label={t('analytics.weeklyDigest.weekOverWeek', 'Week-over-Week Comparison')}
      className="space-y-3"
    >
      <SectionTitle>
        {t('analytics.weeklyDigest.weekOverWeek', 'Week-over-Week Comparison')}
      </SectionTitle>
      {isError ? (
        <GlassPanel className="p-4 sm:p-5">
          <QueryError error={error} onRetry={onRetry} />
        </GlassPanel>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6">
          <StatCard
            loading={isLoading}
            label={t('analytics.weeklyDigest.distance', 'Distance')}
            value={formatDistance(metrics.totalDistanceM ?? 0, { precision: 1 })}
            icon={<Car className="h-4 w-4" aria-hidden="true" />}
            trend={trendFor(metrics.totalDistanceM ?? 0, metrics.prevDistanceM ?? 0)}
          />
          <StatCard
            loading={isLoading}
            label={t('analytics.weeklyDigest.drives', 'Drives')}
            value={fmtInt(metrics.totalDrives ?? 0)}
            icon={<Activity className="h-4 w-4" aria-hidden="true" />}
            trend={trendFor(metrics.totalDrives ?? 0, metrics.prevDriveCount ?? 0)}
          />
          <StatCard
            loading={isLoading}
            label={t('analytics.weeklyDigest.energy', 'Energy')}
            value={formatEnergy(metrics.energyUsedWh ?? 0, { precision: 1 })}
            icon={<Zap className="h-4 w-4" aria-hidden="true" />}
            trend={trendFor(metrics.energyUsedWh ?? 0, metrics.prevEnergyWh ?? 0, true)}
          />
          <StatCard
            loading={isLoading}
            label={t('analytics.weeklyDigest.cost', 'Cost')}
            value={formatCurrency(metrics.chargingCost ?? 0, 2)}
            icon={<Fuel className="h-4 w-4" aria-hidden="true" />}
            trend={trendFor(metrics.chargingCost ?? 0, metrics.prevChargingCost ?? 0, true)}
          />
          <StatCard
            loading={isLoading}
            label={t('analytics.weeklyDigest.efficiency', 'Efficiency')}
            value={formatEfficiencyFromSI(metrics.avgEfficiencyWhPerM ?? 0, unitPrefs)}
            icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
            trend={trendFor(
              metrics.avgEfficiencyWhPerM ?? 0,
              metrics.prevAvgEfficiencyWhPerM ?? 0,
              true,
            )}
          />
          <StatCard
            loading={isLoading}
            label={t('analytics.weeklyDigest.co2', 'CO₂ Saved')}
            value={fmtNumber(metrics.co2Saved ?? 0, 1)}
            unit="kg"
            icon={<Leaf className="h-4 w-4" aria-hidden="true" />}
            trend={trendFor(metrics.co2Saved ?? 0, metrics.prevCo2 ?? 0)}
          />
        </div>
      )}
    </section>
  );
}
