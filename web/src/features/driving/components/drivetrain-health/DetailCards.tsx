import { useTranslation } from 'react-i18next';

import { Card, CardHeader } from '@/components/ui';
import { Grid } from '@/components/layout';
import { KVList } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';

import type { DrivetrainHealthData, DrivingStats } from '@/types/driving';
import { displayTemp } from './helpers';

interface DetailCardsProps {
  health: DrivetrainHealthData;
  peakPower: number;
  avgPowerMax: number;
  minRegenPower: number;
  stats: DrivingStats | undefined;
}

export function DetailCards({
  health,
  peakPower,
  avgPowerMax,
  minRegenPower,
  stats,
}: DetailCardsProps) {
  const { t } = useTranslation();
  const { formatTemperature: formatTemperatureUnit, formatEnergy } = useUnits();
  const formatTemperature = (value: number | null | undefined, precision?: number) => formatTemperatureUnit(value, { precision });

  return (
    <FadeIn delay={0.4}>
      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        <Card>
          <CardHeader title={t('drivetrain.temperatures', 'Temperature Details')} />
          <KVList
            items={[
              { label: t('drivetrain.frontMotorTemp', 'Front Motor Temp'), value: displayTemp(health.frontMotorTempC, formatTemperature) },
              { label: t('drivetrain.rearMotorTemp', 'Rear Motor Temp'), value: displayTemp(health.rearMotorTempC, formatTemperature) },
              { label: t('drivetrain.inverterTemp', 'Inverter Temp'), value: displayTemp(health.inverterTempC, formatTemperature) },
              { label: t('drivetrain.batteryTemp', 'Battery Temp'), value: displayTemp(health.batteryTempC, formatTemperature) },
            ]}
          />
        </Card>

        <Card>
          <CardHeader title={t('drivetrain.powerSummary', 'Power Summary')} />
          <KVList
            items={[
              {
                label: t('drivetrain.peakPowerLabel', 'Peak Power'),
                value: peakPower > 0 ? `${fmtInt(peakPower)} kW` : '—',
              },
              {
                label: t('drivetrain.avgPowerLabel', 'Avg Peak Power'),
                value: avgPowerMax > 0 ? `${fmtNumber(avgPowerMax, 1)} kW` : '—',
              },
              {
                label: t('drivetrain.maxRegenLabel', 'Max Regen'),
                value: minRegenPower < 0 ? `${fmtNumber(Math.abs(minRegenPower), 1)} kW` : '—',
              },
              {
                label: t('drivetrain.regenLabel', 'Total Regen'),
                value: stats ? formatEnergy(stats.regenEnergyWh, { precision: 1 }) : '—',
              },
              {
                label: t('drivetrain.co2Label', 'CO₂ Saved'),
                value: stats ? `${fmtNumber(stats.co2SavedKg, 1)} kg` : '—',
              },
            ]}
          />
        </Card>
      </Grid>
    </FadeIn>
  );
}
