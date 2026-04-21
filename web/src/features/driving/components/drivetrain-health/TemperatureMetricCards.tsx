import { useTranslation } from 'react-i18next';
import { Heart, Zap } from 'lucide-react';

import { MetricCard } from '@/components/data-display';
import { StaggerContainer, StaggerItem } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';

import type { HealthStatus, TempSensor } from './constants';
import { tempNeonColor, displayTemp } from './helpers';

interface TemperatureMetricCardsProps {
  sensors: TempSensor[];
  overallHealth: HealthStatus;
  healthScore: number;
  peakPower: number;
}

export function TemperatureMetricCards({
  sensors,
  overallHealth,
  healthScore,
  peakPower,
}: TemperatureMetricCardsProps) {
  const { t } = useTranslation();
  const { fmtTemp } = useSettings();

  return (
    <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {sensors.map((sensor) => (
        <StaggerItem key={sensor.key}>
          <MetricCard
            label={t(sensor.labelKey, sensor.defaultLabel)}
            value={displayTemp(sensor.value, fmtTemp)}
            icon={sensor.icon}
            color={tempNeonColor(sensor.value, sensor.maxTemp)}
            subtitle={
              sensor.value !== null
                ? `${fmtNumber((sensor.value / sensor.maxTemp) * 100, 0)}% ${t('drivetrain.ofMax', 'of max')}`
                : t('drivetrain.noData', 'No data')
            }
          />
        </StaggerItem>
      ))}
      <StaggerItem>
        <MetricCard
          label={t('drivetrain.healthScore', 'Health Score')}
          value={`${healthScore}%`}
          icon={<Heart className="h-4 w-4" />}
          color={
            overallHealth === 'good'
              ? 'green'
              : overallHealth === 'warning'
                ? 'amber'
                : 'red'
          }
        />
      </StaggerItem>
      <StaggerItem>
        <MetricCard
          label={t('drivetrain.peakPower', 'Peak Power')}
          value={peakPower > 0 ? `${fmtInt(peakPower)} kW` : '—'}
          icon={<Zap className="h-4 w-4" />}
          color="purple"
        />
      </StaggerItem>
    </StaggerContainer>
  );
}
