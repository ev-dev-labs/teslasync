import { useTranslation } from 'react-i18next';

import { Card, CardHeader } from '@/components/ui';
import { Grid } from '@/components/layout';
import { KVList } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt, isFiniteNumber } from '@/lib/numberFormat';

import type { DrivetrainHealthData, DrivingStats } from '@/types/driving';
import { displayTemp } from './helpers';

interface DetailCardsProps {
  health: DrivetrainHealthData | null | undefined;
  peakPower: number;
  avgPowerMax: number;
  minRegenPower: number;
  stats: DrivingStats | undefined;
  loading?: boolean;
}

export function DetailCards({
  health,
  peakPower,
  avgPowerMax,
  minRegenPower,
  stats,
  loading = false,
}: DetailCardsProps) {
  const { t } = useTranslation();
  const { formatTemperature: formatTemperatureUnit, formatEnergy } = useUnits();
  const formatTemperature = (value: number | null | undefined, precision?: number) => formatTemperatureUnit(value, { precision });

  return (
    <FadeIn delay={0.4}>
      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        <Card>
          <CardHeader title={t('drivetrain.temperatures', 'Temperature Details')} />
          {loading ? (
            <Skeleton lines={4} />
          ) : !health ? (
            <EmptyState /* no-action: transient — awaiting first health telemetry */
              message={t('drivetrain.noHealth', 'No drivetrain health data available yet')}
            />
          ) : (
            <KVList
              items={[
                { label: t('drivetrain.frontMotorTemp', 'Front Motor Temp'), value: displayTemp(health.frontMotorTempC, formatTemperature) },
                { label: t('drivetrain.rearMotorTemp', 'Rear Motor Temp'), value: displayTemp(health.rearMotorTempC, formatTemperature) },
                { label: t('drivetrain.inverterTemp', 'Inverter Temp'), value: displayTemp(health.inverterTempC, formatTemperature) },
                { label: t('drivetrain.batteryTemp', 'Battery Temp'), value: displayTemp(health.batteryTempC, formatTemperature) },
              ]}
            />
          )}
        </Card>

        <Card>
          <CardHeader title={t('drivetrain.powerSummary', 'Power Summary')} />
          <KVList
            items={[
              {
                label: t('drivetrain.peakPowerLabel', 'Peak Power'),
                value: isFiniteNumber(peakPower) && peakPower > 0 ? `${fmtInt(peakPower)} kW` : '—',
              },
              {
                label: t('drivetrain.avgPowerLabel', 'Avg Peak Power'),
                value: isFiniteNumber(avgPowerMax) && avgPowerMax > 0 ? `${fmtNumber(avgPowerMax, 1)} kW` : '—',
              },
              {
                label: t('drivetrain.maxRegenLabel', 'Max Regen'),
                value:
                  isFiniteNumber(minRegenPower) && minRegenPower < 0
                    ? `${fmtNumber(Math.abs(minRegenPower), 1)} kW`
                    : '—',
              },
              {
                label: t('drivetrain.regenLabel', 'Total Regen'),
                value: stats ? formatEnergy(stats.regenEnergyWh, { precision: 1 }) : '—',
              },
              {
                label: t('drivetrain.co2Label', 'CO₂ Saved'),
                value:
                  stats && isFiniteNumber(stats.co2SavedKg)
                    ? `${fmtNumber(stats.co2SavedKg, 1)} kg`
                    : '—',
              },
            ]}
          />
        </Card>
      </Grid>
    </FadeIn>
  );
}
