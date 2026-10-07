import { useTranslation } from 'react-i18next';
import { MapPin, Car, Clock, TrendingUp } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import type { useMileageStats } from '@/api/hooks/useAnalytics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { StatisticsSource } from './StatisticsSource';

interface MileageStatisticsProps {
  query: ReturnType<typeof useMileageStats>;
  fromKm: (km: number) => number;
  distanceUnit: string;
}

export function MileageStatistics({ query, fromKm, distanceUnit }: MileageStatisticsProps) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const mileage = query.data;
  return (
    <LayoutCard title={t('statistics.mileage', 'Mileage summary')}>
      <StatisticsSource
        hasData={mileage != null}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => { void query.refetch(); }}
        skeleton={<Skeleton className="h-40 rounded-xl" />}
        empty={
          <EmptyState
            icon={<Car className="h-8 w-8" aria-hidden="true" />}
            message={t('statistics.noMileage', 'No mileage data available')}
            description={t('statistics.noMileageDescription', 'Distance totals and projections appear after the first completed drive is recorded.')}
            actionTo={{ label: t('statistics.viewDrives', 'View drives'), to: '/drives' }}
            className="py-8"
          />
        }
      >
        {mileage ? (
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label={t('statistics.totalMileage', 'Total distance')} value={`${fmtInt(fromKm(mileage.lifetime_km ?? 0))} ${distanceUnit}`} icon={<MapPin className="h-4 w-4" />} color="cyan" />
            <MetricCard label={t('statistics.dailyAvg', 'Daily average')} value={`${fmtNumber(fromKm((mileage.last_30d_km ?? 0) / 30))} ${distanceUnit}`} icon={<Car className="h-4 w-4" />} color="green" />
            <MetricCard label={t('statistics.totalDrives', 'Total drives')} value={fmtInt(mileage.drive_count_lifetime ?? 0)} icon={<Clock className="h-4 w-4" />} color="purple" />
            <MetricCard label={t('statistics.yearlyProjection', 'Yearly projection')} value={`${fmtInt(fromKm(((mileage.last_30d_km ?? 0) / 30) * 365))} ${distanceUnit}`} icon={<TrendingUp className="h-4 w-4" />} color="amber" />
          </div>
        ) : null}
      </StatisticsSource>
    </LayoutCard>
  );
}
