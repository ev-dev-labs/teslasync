import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cog } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useDrivetrainHealth } from '@/api/hooks/useDriving';
import { useMotorLatest } from '@/api/hooks/useVehicles';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetGaugeHero, type GaugeHeroStat } from './shared';
import type { WidgetProps } from './types';
import { convertTempFromSI } from '@/lib/unitConversion';

function healthScore(overall: string | undefined): number {
  if (overall === 'good') return 95;
  if (overall === 'warning') return 60;
  if (overall === 'critical') return 25;
  return 0;
}

function healthColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

export default function DrivetrainHealthWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, tempUnit),
    [tempUnit],
  );
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data: health, isLoading: healthLoading, error: healthError,
    isFetching: healthFetching, isStale: healthStale, isError: healthIsError,
    dataUpdatedAt: healthUpdatedAt, refetch: healthRefetch,
  } = useDrivetrainHealth(vehicleIdStr);

  const {
    data: motor, isLoading: motorLoading,
    dataUpdatedAt: motorUpdatedAt,
    isFetching: motorFetching,
  } = useMotorLatest(vid ?? 0);

  const isLoading = healthLoading || motorLoading || (vehicleId == null && vehiclesLoading);
  const isCompact = size.cols <= 1;
  const hasData = !!health || !!motor;

  const score = useMemo(() => healthScore(health?.overallHealth), [health?.overallHealth]);
  const color = useMemo(() => healthColor(score), [score]);
  const statusLabel = useMemo(() => {
    switch (health?.overallHealth) {
      case 'good':
        return t('widget.drivetrainHealth.statusGood', 'Healthy');
      case 'warning':
        return t('widget.drivetrainHealth.statusWarning', 'Warning');
      case 'critical':
        return t('widget.drivetrainHealth.statusCritical', 'Critical');
      default:
        return t('widget.drivetrainHealth.statusUnknown', 'Unknown');
    }
  }, [health?.overallHealth, t]);

  const gaugeConfig = useMemo(() => ({
    value: score,
    max: 100,
    label: statusLabel,
    unit: t('widget.drivetrainHealth.score', 'health'),
    color,
  }), [score, color, statusLabel, t]);

  const motorTemp = health?.frontMotorTempC ?? motor?.motor_temp_c_front ?? null;
  const statorTemp = motor?.di_stator_temp ?? health?.rearMotorTempC ?? null;
  const inverterTemp = health?.inverterTempC ?? motor?.inverter_temp_c ?? null;
  const driveState = motor?.state_front ?? health?.motorStatus ?? '—';

  const stats: GaugeHeroStat[] = useMemo(() => [
    {
      label: t('widget.drivetrainHealth.motorTemp', 'Motor Temp'),
      value: motorTemp != null ? fmtNumber(toTemperatureDisplay(motorTemp), 0) : '—',
      unit: tempUnit,
    },
    {
      label: t('widget.drivetrainHealth.statorTemp', 'Stator Temp'),
      value: statorTemp != null ? fmtNumber(toTemperatureDisplay(statorTemp), 0) : '—',
      unit: tempUnit,
    },
    {
      label: t('widget.drivetrainHealth.inverterHealth', 'Inverter'),
      value: inverterTemp != null ? fmtNumber(toTemperatureDisplay(inverterTemp), 0) : '—',
      unit: tempUnit,
    },
    {
      label: t('widget.drivetrainHealth.driveState', 'Drive State'),
      value: driveState,
    },
  ], [motorTemp, statorTemp, inverterTemp, driveState, toTemperatureDisplay, tempUnit, t]);

  const updatedAt = Math.max(healthUpdatedAt ?? 0, motorUpdatedAt ?? 0);

  const shellProps = {
    loading: isLoading,
    error: healthError ? String(healthError) : null,
    updatedAt,
    isFetching: healthFetching || motorFetching,
    isStale: healthStale,
    isError: healthIsError,
    onRefresh: () => healthRefetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <div className="h-full flex flex-col items-center justify-center min-h-[44px]">
          {hasData ? (
            <WidgetGaugeHero gauge={gaugeConfig} compact />
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Cog className="h-5 w-5" />}
              message={t('widget.drivetrainHealth.noData', 'No drivetrain data')}
              className="py-2"
            />
          )}
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.drivetrainHealth.title', 'Drivetrain Health')}
      icon={<Cog className="h-3.5 w-3.5 text-emerald-400" />}
      {...shellProps}
    >
      {hasData ? (
        <WidgetGaugeHero gauge={gaugeConfig} stats={stats} />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Cog className="h-5 w-5" />}
          message={t('widget.drivetrainHealth.noData', 'No drivetrain data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
