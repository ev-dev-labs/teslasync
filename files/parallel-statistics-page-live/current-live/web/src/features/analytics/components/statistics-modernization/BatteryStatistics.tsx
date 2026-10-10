import { useTranslation } from 'react-i18next';
import { Battery, TrendingUp, RefreshCw, Clock } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { MetricCard } from '@/components/data-display';
import { LinearGauge } from '@/components/charts';
import { Skeleton, EmptyState } from '@/components/feedback';
import type { useBatteryHealthAnalytics } from '@/api/hooks/useEnergy';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { StatisticsSource } from './StatisticsSource';

interface BatteryStatisticsProps {
  query: ReturnType<typeof useBatteryHealthAnalytics>;
}

export function BatteryStatistics({ query }: BatteryStatisticsProps) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { formatEnergy } = useUnits();
  const batteryHealth = query.data;
  return (
    <LayoutCard title={t('statistics.batteryHealth', 'Battery health')}>
      <StatisticsSource
        hasData={batteryHealth != null}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => { void query.refetch(); }}
        skeleton={<Skeleton className="h-40 rounded-xl" />}
        empty={
          // Battery estimates populate automatically after sufficient telemetry.
          <EmptyState
            icon={<Battery className="h-8 w-8" aria-hidden="true" />}
            message={t('statistics.noBattery', 'No battery health data available')}
            description={t('statistics.noBatteryDescription', 'Battery health estimates appear after enough charging and range telemetry has accumulated.')}
            className="py-8"
          />
        }
      >
        {batteryHealth ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-center">
            <div className="flex justify-center">
              <LinearGauge
                value={Math.round(batteryHealth.current_soh ?? 0)}
                max={100}
                label={t('statistics.health', 'Health')}
                unit="%"
                tone="success"
                size={140}
                className="max-w-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label={t('statistics.capacity', 'Capacity')} value={formatEnergy(batteryHealth.estimated_capacity_wh ?? 0)} icon={<Battery className="h-4 w-4" />} color="cyan" />
              <MetricCard label={t('statistics.degradation', 'Degradation')} value={`${fmtNumber(batteryHealth.degradation_rate_pct_per_year ?? 0)}%/yr`} icon={<TrendingUp className="h-4 w-4" />} color="amber" />
              <MetricCard label={t('statistics.cycles', 'Cycles')} value={fmtInt(batteryHealth.total_cycles ?? 0)} icon={<RefreshCw className="h-4 w-4" />} color="purple" />
              <MetricCard label={t('statistics.age', 'Age')} value={`${batteryHealth.battery_age_months ?? 0} mo`} icon={<Clock className="h-4 w-4" />} color="green" />
            </div>
          </div>
        ) : null}
      </StatisticsSource>
    </LayoutCard>
  );
}
