import { useTranslation } from 'react-i18next';
import { Heart, Zap } from 'lucide-react';

import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { StaggerContainer, StaggerItem } from '@/components/motion';
import { Skeleton, EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';

import type { HealthStatus, TempSensor } from './constants';
import { tempNeonColor, displayTemp } from './helpers';

interface TemperatureMetricCardsProps {
  sensors: TempSensor[];
  overallHealth: HealthStatus;
  healthScore: number;
  peakPower: number;
  loading?: boolean;
}

export function TemperatureMetricCards({
  sensors,
  overallHealth,
  healthScore,
  peakPower,
  loading = false,
}: TemperatureMetricCardsProps) {
  const { t } = useTranslation();
  const { formatTemperature: formatTemperatureUnit } = useUnits();
  const formatTemperature = (value: number | null | undefined, precision?: number) => formatTemperatureUnit(value, { precision });

  // Defensive: a transient / undefined feed must degrade to the empty state,
  // never crash on `.length` / `.map` (repo null-safety contract).
  const sensorList = sensors ?? [];

  if (loading) {
    return (
      <div
        aria-hidden="true"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={76} />
        ))}
      </div>
    );
  }

  if (sensorList.length === 0) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <EmptyState /* no-action: transient — awaiting first thermal telemetry */
          message={t('drivetrain.noSensors', 'No temperature sensor data available yet')}
        />
      </GlassPanel>
    );
  }

  const safeHealthScore = Number.isFinite(healthScore) ? healthScore : 0;

  return (
    <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {sensorList.map((sensor) => {
        const reading = sensor.value;
        const maxTemp = sensor.maxTemp;
        // "% of max" is only meaningful for a finite reading against a
        // positive, finite ceiling. A missing / NaN / ±Infinity reading or a
        // non-positive ceiling would otherwise coerce to a misleading
        // "0% of max"; mirror displayTemp's '—' with the "No data" copy.
        const subtitle =
          reading !== null &&
          Number.isFinite(reading) &&
          Number.isFinite(maxTemp) &&
          maxTemp > 0
            ? `${fmtNumber((reading / maxTemp) * 100, 0)}% ${t('drivetrain.ofMax', 'of max')}`
            : t('drivetrain.noData', 'No data');
        return (
          <StaggerItem key={sensor.key}>
            <MetricCard
              label={t(sensor.labelKey, sensor.defaultLabel)}
              value={displayTemp(sensor.value, formatTemperature)}
              icon={sensor.icon}
              color={tempNeonColor(sensor.value, sensor.maxTemp)}
              subtitle={subtitle}
            />
          </StaggerItem>
        );
      })}
      <StaggerItem>
        <MetricCard
          label={t('drivetrain.healthScore', 'Health Score')}
          value={`${safeHealthScore}%`}
          icon={<Heart className="h-4 w-4" aria-hidden="true" />}
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
          icon={<Zap className="h-4 w-4" aria-hidden="true" />}
          color="purple"
        />
      </StaggerItem>
    </StaggerContainer>
  );
}
