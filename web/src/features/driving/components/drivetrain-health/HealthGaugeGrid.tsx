import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption } from '@/components/ui';
import { Grid } from '@/components/layout';
import { KVList } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { LinearGauge } from '@/components/charts/LinearGauge';
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
  /** Whether the drivetrain-health query resolved with real data. */
  hasHealth: boolean;
  loading?: boolean;
  statsLoading?: boolean;
}

export function HealthGaugeGrid({
  overallHealth,
  healthScore,
  motorStatus,
  sensors,
  stats,
  hasHealth,
  loading = false,
  statsLoading = false,
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
        <GlassPanel className="flex flex-col items-center justify-center p-4 sm:p-5">
          {loading ? (
            <Skeleton height={160} />
          ) : !hasHealth ? (
            <EmptyState /* no-action: transient — awaiting first health telemetry */
              message={t('drivetrain.noHealth', 'No drivetrain health data available yet')}
            />
          ) : (
            <>
              <LinearGauge
                value={healthScore}
                max={100}
                label={t('drivetrain.healthScore', 'Health Score')}
                unit="%"
                color={healthColor}
                size={140}
              />
              <Text as="p" variant="caption" className="mt-3 text-center">
                {t('drivetrain.healthScoreDesc', 'Overall drivetrain condition rating')}
              </Text>
            </>
          )}
        </GlassPanel>

        {/* Motor status card */}
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3">
            {t('drivetrain.motorDetails', 'Motor Details')}
          </PanelTitle>
          {loading ? (
            <Skeleton lines={4} />
          ) : !hasHealth ? (
            <EmptyState /* no-action: transient — awaiting first health telemetry */
              message={t('drivetrain.noHealth', 'No drivetrain health data available yet')}
            />
          ) : (
            <>
              <KVList
                items={[
                  { label: t('drivetrain.motorStatus', 'Motor Status'), value: motorStatus },
                  {
                    label: t('drivetrain.overallHealth', 'Overall Health'),
                    value: t(
                      `drivetrain.health.${overallHealth}`,
                      overallHealth.charAt(0).toUpperCase() + overallHealth.slice(1),
                    ),
                  },
                  { label: t('drivetrain.healthScoreLabel', 'Health Score'), value: `${healthScore}%` },
                  {
                    label: t('drivetrain.sensorCount', 'Active Sensors'),
                    value: String((sensors ?? []).filter((s) => s.value !== null).length),
                  },
                ]}
              />
              <div className="mt-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                <Caption>
                  {t('drivetrain.realTime', 'Real-time telemetry active')}
                </Caption>
              </div>
            </>
          )}
        </GlassPanel>

        {/* Drive statistics summary */}
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3">
            {t('drivetrain.driveStats', 'Drive Statistics')}
          </PanelTitle>
          {stats ? (
            <KVList
              items={[
                { label: t('drivetrain.totalDrives', 'Total Drives'), value: fmtInt(stats.totalDrives ?? 0) },
                {
                  label: t('drivetrain.totalDistance', 'Total Distance'),
                  value: `${fmtInt(toDistanceDisplay(stats.totalDistanceKm ?? 0))} ${distanceUnit}`,
                },
                {
                  label: t('drivetrain.avgSpeed', 'Avg Speed'),
                  value: `${fmtNumber(toSpeedDisplay(stats.avgSpeedKmh ?? 0), 1)} ${speedUnit}`,
                },
                {
                  label: t('drivetrain.topSpeed', 'Top Speed'),
                  value: `${fmtNumber(toSpeedDisplay(stats.topSpeedKmh ?? 0), 1)} ${speedUnit}`,
                },
              ]}
            />
          ) : statsLoading ? (
            <Skeleton lines={4} />
          ) : (
            <EmptyState /* no-action: transient — awaiting first completed drive */
              message={t('drivetrain.noStats', 'No drive statistics available yet')}
            />
          )}
        </GlassPanel>
      </Grid>
    </FadeIn>
  );
}
