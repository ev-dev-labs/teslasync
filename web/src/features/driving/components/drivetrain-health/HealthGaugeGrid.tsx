import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';

import { GlassPanel } from '@/components/ui';
import { Grid } from '@/components/layout';
import { KVList } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';

import { HEALTH_COLOR, type HealthStatus, type TempSensor } from './constants';
import type { DrivingStats } from '@/types/driving';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';

interface HealthGaugeGridProps {
  overallHealth: HealthStatus;
  healthScore: number;
  motorStatus: string;
  sensors: TempSensor[];
  stats: DrivingStats | undefined;
}

export function HealthGaugeGrid({
  overallHealth,
  healthScore,
  motorStatus,
  sensors,
  stats,
}: HealthGaugeGridProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const toSpeedDisplay = (value: number) => convertSpeedFromSI(value, unitPrefs.speed);
  const healthColor = HEALTH_COLOR[overallHealth];

  return (
    <FadeIn delay={0.1}>
      <Grid cols={{ default: 1, md: 3 }} gap={4}>
        {/* Health score gauge */}
        <GlassPanel className="flex flex-col items-center justify-center p-6">
          <RadialGauge
            value={healthScore}
            max={100}
            label={t('drivetrain.healthScore', 'Health Score')}
            unit="%"
            color={healthColor}
            size={140}
          />
          <p className="mt-3 text-center text-xs text-[var(--text-muted)]">
            {t('drivetrain.healthScoreDesc', 'Overall drivetrain condition rating')}
          </p>
        </GlassPanel>

        {/* Motor status card */}
        <GlassPanel className="p-6">
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-[var(--text-muted)]">
            {t('drivetrain.motorDetails', 'Motor Details')}
          </h3>
          <KVList
            items={[
              { label: t('drivetrain.motorStatus', 'Motor Status'), value: motorStatus },
              {
                label: t('drivetrain.overallHealth', 'Overall Health'),
                value: overallHealth.charAt(0).toUpperCase() + overallHealth.slice(1),
              },
              { label: t('drivetrain.healthScoreLabel', 'Health Score'), value: `${healthScore}%` },
              {
                label: t('drivetrain.sensorCount', 'Active Sensors'),
                value: String(sensors.filter((s) => s.value !== null).length),
              },
            ]}
          />
          <div className="mt-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-[var(--text-muted)]" />
            <span className="text-xs text-[var(--text-muted)]">
              {t('drivetrain.realTime', 'Real-time telemetry active')}
            </span>
          </div>
        </GlassPanel>

        {/* Drive statistics summary */}
        <GlassPanel className="p-6">
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-[var(--text-muted)]">
            {t('drivetrain.driveStats', 'Drive Statistics')}
          </h3>
          {stats ? (
            <KVList
              items={[
                { label: t('drivetrain.totalDrives', 'Total Drives'), value: fmtInt(stats.totalDrives) },
                {
                  label: t('drivetrain.totalDistance', 'Total Distance'),
                  value: `${fmtInt(toDistanceDisplay(stats.totalDistanceKm))} ${distanceUnit}`,
                },
                {
                  label: t('drivetrain.avgSpeed', 'Avg Speed'),
                  value: `${fmtNumber(toSpeedDisplay(stats.avgSpeedKmh), 1)} ${speedUnit}`,
                },
                {
                  label: t('drivetrain.topSpeed', 'Top Speed'),
                  value: `${fmtNumber(toSpeedDisplay(stats.topSpeedKmh), 1)} ${speedUnit}`,
                },
              ]}
            />
          ) : (
            <Skeleton lines={4} />
          )}
        </GlassPanel>
      </Grid>
    </FadeIn>
  );
}
