import { useTranslation } from 'react-i18next';
import { BarChart3, MapPin, TrendingUp, Zap, DollarSign, Leaf, Gauge } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { MetricCard } from '@/components/data-display';
import { EmptyState, StatGridSkeleton } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useFormatting } from '@/hooks/useFormatting';
import { StatisticsSource } from './StatisticsSource';

export interface PeriodStats {
  total_distance: number;
  total_drives: number;
  energy_used: number;
  avg_efficiency: number;
  total_cost: number;
  co2_saved: number;
}

interface PeriodStatisticsProps {
  stats?: PeriodStats;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  fromKm: (km: number) => number;
  whPerKmToDisplay: (value: number) => number;
  distanceUnit: string;
  efficiencyUnit: string;
}

/** Specialist renderers retain source rounding, suffixes and currency semantics. */
export function PeriodStatistics({
  stats, loading, error, onRetry, fromKm, whPerKmToDisplay, distanceUnit, efficiencyUnit,
}: PeriodStatisticsProps) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { formatCurrency } = useFormatting();
  const avgDriveDistance = stats && stats.total_drives > 0
    ? (stats.total_distance ?? 0) / stats.total_drives : 0;
  return (
    <LayoutCard title={t('statistics.title', 'Statistics')}>
      <StatisticsSource
        hasData={stats != null}
        loading={loading}
        error={error}
        onRetry={onRetry}
        skeleton={
          <div className="space-y-3 sm:space-y-4">
            <StatGridSkeleton cards={5} className="sm:grid-cols-3 lg:grid-cols-5" />
            <StatGridSkeleton cards={3} className="grid-cols-1 sm:grid-cols-3" />
          </div>
        }
        empty={
          <EmptyState
            icon={<BarChart3 className="h-10 w-10" aria-hidden="true" />}
            title={t('statistics.noData', 'No statistics yet')}
            message={t('statistics.noDataMsg', 'This vehicle has no completed driving or charging history in the selected period.')}
            description={t('statistics.noDataDescription', 'Complete a drive or charging session, then return after TeslaSync has processed the activity.')}
            actionTo={{ label: t('statistics.viewDrives', 'View drives'), to: '/drives' }}
          />
        }
      >
        {stats ? (
          <div className="space-y-3 sm:space-y-4">
            <section
              aria-label={t('statistics.title', 'Statistics')}
              className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-5"
            >
              <MetricCard label={t('statistics.totalDistance', 'Total distance')} value={`${fmtInt(fromKm(stats.total_distance ?? 0))} ${distanceUnit}`} icon={<MapPin className="h-4 w-4" />} color="cyan" />
              <MetricCard label={t('statistics.totalDrives', 'Total drives')} value={fmtInt(stats.total_drives ?? 0)} icon={<TrendingUp className="h-4 w-4" />} color="green" />
              <MetricCard label={t('statistics.totalEnergy', 'Total energy')} value={`${fmtNumber(stats.energy_used ?? 0)} kWh`} icon={<Zap className="h-4 w-4" />} color="amber" />
              <MetricCard label={t('statistics.totalCost', 'Total cost')} value={formatCurrency(stats.total_cost ?? 0)} icon={<DollarSign className="h-4 w-4" />} color="red" />
              <MetricCard label={t('statistics.co2Saved', 'CO₂ saved')} value={`${fmtNumber(stats.co2_saved ?? 0)} kg`} icon={<Leaf className="h-4 w-4" />} color="green" />
            </section>
            <section
              aria-label={t('statistics.averages', 'Averages')}
              className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-3"
            >
              <MetricCard label={t('statistics.avgDriveDistance', 'Avg drive distance')} value={`${fmtNumber(fromKm(avgDriveDistance))} ${distanceUnit}`} icon={<MapPin className="h-4 w-4" />} color="cyan" />
              <MetricCard label={t('statistics.avgEfficiency', 'Avg efficiency')} value={`${fmtNumber(whPerKmToDisplay(stats.avg_efficiency ?? 0))} ${efficiencyUnit}`} icon={<Gauge className="h-4 w-4" />} color="green" />
              <MetricCard label={t('statistics.costPerKm', 'Cost per km')} value={(stats.total_distance ?? 0) > 0 ? formatCurrency((stats.total_cost ?? 0) / stats.total_distance) : '—'} icon={<DollarSign className="h-4 w-4" />} color="amber" />
            </section>
          </div>
        ) : null}
      </StatisticsSource>
    </LayoutCard>
  );
}
