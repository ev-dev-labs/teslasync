import { useTranslation } from 'react-i18next';
import {
  Gauge,
  CornerDownRight,
  TrendingDown,
  Zap,
  BarChart3,
  Thermometer,
} from 'lucide-react';

import { StatCard } from '@/components/data-display';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { QueryError, Skeleton } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';

import { useMotorStats } from './useMotorStats';
import type { MotorHistoryQuery } from '@/api/hooks/useVehicles';
import type { TemperatureUnitPref } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface SummaryStatsProps {
  vehicleId: number | null | undefined;
  toTemperatureDisplay: (v: number) => number;
  // See MotorEfficiencyInsights tempUnit comment — already includes '°'.
  tempUnit: TemperatureUnitPref;
  historyQuery?: MotorHistoryQuery;
}

export default function SummaryStats({
  vehicleId,
  toTemperatureDisplay,
  tempUnit,
  historyQuery,
}: SummaryStatsProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const query = useMotorStats(vehicleId, historyQuery);
  const { motorStats } = query;
  const { formatPower } = useUnits();
  const power = (value: number | null | undefined) => formatPower(value != null ? value * 1000 : null);

  return (
    <FadeIn delay={0.05}>
      {query.isLoading ? <Skeleton className="mb-4 h-12" /> : null}
      {query.isError ? <QueryError error={query.error} onRetry={query.refetch} /> : null}
      <StaggerContainer className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-6">
        <StaggerItem>
          <StatCard
            label={t('dynamics.totalReadings', 'Total Readings')}
            value={motorStats ? fmtNumber(motorStats.totalReadings, 0) : '—'}
            icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label={t('dynamics.avgTorque', 'Avg Torque')}
            value={motorStats?.avgTorque != null ? `${fmtNumber(motorStats.avgTorque)} Nm` : '—'}
            icon={<Zap className="h-4 w-4" aria-hidden="true" />}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label={t('dynamics.peakPower', 'Peak Power')}
            value={power(motorStats?.peakPower)}
            icon={<CornerDownRight className="h-4 w-4" aria-hidden="true" />}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label={t('dynamics.peakRegen', 'Peak Regen')}
            value={power(motorStats?.peakRegen)}
            icon={<TrendingDown className="h-4 w-4" aria-hidden="true" />}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label={t('dynamics.avgPower', 'Avg Power')}
            value={power(motorStats?.avgPower)}
            icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label={t('dynamics.avgMotorTemp', 'Avg Motor Temp')}
            value={motorStats?.avgMotorTemp != null
              ? `${fmtNumber(toTemperatureDisplay(motorStats.avgMotorTemp))}${tempUnit}`
              : '—'}
            icon={<Thermometer className="h-4 w-4" aria-hidden="true" />}
          />
        </StaggerItem>
      </StaggerContainer>
    </FadeIn>
  );
}
