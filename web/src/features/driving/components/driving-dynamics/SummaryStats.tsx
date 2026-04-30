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
import { fmtNumber } from '@/lib/numberFormat';
import type { MotorStats } from './helpers';

interface SummaryStatsProps {
  motorStats: MotorStats | null;
  convertTemp: (v: number) => number;
  tempUnit: string;
}

export default function SummaryStats({ motorStats, convertTemp, tempUnit }: SummaryStatsProps) {
  const { t } = useTranslation();

  return (
    <FadeIn delay={0.4}>
      <StaggerContainer className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StaggerItem>
          <StatCard
            label={t('dynamics.totalReadings', 'Total Readings')}
            value={motorStats?.totalReadings ?? 0}
            icon={<BarChart3 className="h-4 w-4" />}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label={t('dynamics.avgTorque', 'Avg Torque')}
            value={`${fmtNumber(motorStats?.avgTorque ?? 0, 1)} Nm`}
            icon={<Zap className="h-4 w-4" />}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label={t('dynamics.peakPower', 'Peak Power')}
            value={`${fmtNumber(motorStats?.peakPower ?? 0, 1)} kW`}
            icon={<CornerDownRight className="h-4 w-4" />}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label={t('dynamics.peakRegen', 'Peak Regen')}
            value={`${fmtNumber(motorStats?.peakRegen ?? 0, 1)} kW`}
            icon={<TrendingDown className="h-4 w-4" />}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label={t('dynamics.avgPower', 'Avg Power')}
            value={`${fmtNumber(motorStats?.avgPower ?? 0, 1)} kW`}
            icon={<Gauge className="h-4 w-4" />}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label={t('dynamics.avgMotorTemp', 'Avg Motor Temp')}
            value={motorStats
              ? `${fmtNumber(convertTemp(motorStats.avgMotorTemp), 1)}°${tempUnit}`
              : '—'}
            icon={<Thermometer className="h-4 w-4" />}
          />
        </StaggerItem>
      </StaggerContainer>
    </FadeIn>
  );
}
