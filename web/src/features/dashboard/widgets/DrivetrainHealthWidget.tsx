import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cog } from 'lucide-react';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Caption } from '@/components/ui';
import { SourceContent } from '@/components/layout';
import { useDrivetrainHealth } from '@/api/hooks/useDriving';
import { useMotorLatest } from '@/api/hooks/useVehicles';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates } from '@/api/dataState';

import { WidgetShell } from './WidgetShell';
import { WidgetStatusGrid, WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import { convertTempFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function DrivetrainHealthWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
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

  const healthQuery = useDrivetrainHealth(vehicleIdStr);
  const {
    data: health, isLoading: healthLoading,
    isFetching: healthFetching, isStale: healthStale, isError: healthIsError,
    dataUpdatedAt: healthUpdatedAt, refetch: healthRefetch,
  } = healthQuery;

  const motorQuery = useMotorLatest(vid ?? 0);
  const {
    data: motor, isLoading: motorLoading,
    dataUpdatedAt: motorUpdatedAt,
    isFetching: motorFetching,
  } = motorQuery;

  const isLoading = healthLoading || motorLoading || (vehicleId == null && vehiclesLoading);
  const isCompact = size.cols <= 1;
  const hasData = !!health || !!motor;

  const healthTrust = useDataState({
    ...healthQuery,
    data: health ?? (healthLoading || healthIsError ? undefined : null),
  }, { provenance: 'inferred' });
  const motorTrust = useDataState({
    ...motorQuery,
    data: motor ?? (motorLoading || motorQuery.isError ? undefined : null),
  }, { provenance: 'cached', maxAgeMs: 120_000 });
  const combined = combineDataStates([healthTrust, motorTrust]);
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

  // The API supplies a categorical assessment, not a numerical score.
  // A good assessment must never become a fabricated "95%" reading.
  const assessmentStatus = health?.overallHealth === 'good'
    ? 'ok' : health?.overallHealth === 'warning'
      ? 'warning' : health?.overallHealth === 'critical' ? 'error' : 'unknown';
  const assessment = [{
    id: 'assessment',
    label: t('widget.drivetrainHealth.assessment', 'Assessment'),
    status: assessmentStatus,
    statusLabel,
  }] satisfies Parameters<typeof WidgetStatusGrid>[0]['cells'];

  const motorTemp = health?.frontMotorTempC ?? motor?.motor_temp_c_front ?? null;
  const statorTemp = motor?.di_stator_temp ?? null;
  const inverterTemp = health?.inverterTempC ?? motor?.inverter_temp_c ?? null;
  const driveState = motor?.state_front ?? health?.motorStatus ?? '—';

  const stats: StatGridItem[] = useMemo(() => [
    {
      label: t('widget.drivetrainHealth.motorTemp', 'Motor temp'),
      value: motorTemp != null ? fmtNumber(toTemperatureDisplay(motorTemp)) : '—',
      unit: motorTemp != null ? tempUnit : undefined,
    },
    {
      label: t('widget.drivetrainHealth.statorTemp', 'Stator temp'),
      value: statorTemp != null ? fmtNumber(toTemperatureDisplay(statorTemp)) : '—',
      unit: statorTemp != null ? tempUnit : undefined,
    },
    {
      label: t('widget.drivetrainHealth.inverterHealth', 'Inverter'),
      value: inverterTemp != null ? fmtNumber(toTemperatureDisplay(inverterTemp)) : '—',
      unit: inverterTemp != null ? tempUnit : undefined,
    },
    {
      label: t('widget.drivetrainHealth.driveState', 'Drive state'),
      value: driveState,
    },
    {
      label: t('widget.drivetrainHealth.rearMotorTemp', 'Rear motor temp'),
      value: health?.rearMotorTempC != null || motor?.motor_temp_c_rear != null
        ? fmtNumber(toTemperatureDisplay(health?.rearMotorTempC ?? motor?.motor_temp_c_rear ?? 0))
        : '—',
      unit: health?.rearMotorTempC != null || motor?.motor_temp_c_rear != null ? tempUnit : undefined,
    },
  ], [motorTemp, statorTemp, inverterTemp, driveState, health?.rearMotorTempC, motor?.motor_temp_c_rear, toTemperatureDisplay, tempUnit, t, fmtNumber]);

  const updatedAt = combined.updatedAt ?? Math.min(healthUpdatedAt || Infinity, motorUpdatedAt || Infinity);

  const shellProps = {
    loading: isLoading,
    dataState: {
      ...combined,
      status: !hasData && isLoading ? 'initial' : combined.status,
      data: [health, motor],
      hasData,
      retry: () => { void healthRefetch(); void motorQuery.refetch?.(); },
    } satisfies Parameters<typeof WidgetShell>[0]['dataState'],
    loadingContent: <Skeleton className="h-24 w-full" />,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    isFetching: healthFetching || motorFetching,
    isStale: healthStale,
    isError: healthIsError,
    onRefresh: () => { void healthRefetch(); void motorQuery.refetch?.(); },
  };

  if (isCompact) {
    return (
      <WidgetShell title={t('widget.drivetrainHealth.title', 'Drivetrain health')} {...shellProps}>
        <div className="h-full flex flex-col items-center justify-center min-h-[44px]">
          <SourceContent
            state={healthTrust.fatalError ? 'error' : !healthTrust.hasData && healthLoading ? 'loading' : 'ready'}
            label={t('widget.drivetrainHealth.assessment', 'Assessment')}
            emptyMessage={t('widget.drivetrainHealth.noData', 'No drivetrain data')}
            errorMessage={t('widget.drivetrainHealth.assessmentError', 'The drivetrain assessment could not be loaded.')}
            error={healthTrust.fatalError}
            errorRecovery={{ onRetry: healthTrust.retry ?? undefined }}
          >
          <WidgetStatusGrid cells={assessment} compact />
          </SourceContent>
          {!hasData && <Caption className="break-words">{t('widget.drivetrainHealth.noData', 'No drivetrain data')}</Caption>}
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.drivetrainHealth.title', 'Drivetrain health')}
      icon={<Cog className="h-3.5 w-3.5 text-emerald-400" />}
      {...shellProps}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <SourceContent
          state={healthTrust.fatalError ? 'error' : !healthTrust.hasData && healthLoading ? 'loading' : health == null ? 'empty' : healthTrust.refreshError ? 'retained' : 'ready'}
          label={t('widget.drivetrainHealth.assessment', 'Assessment')}
          emptyMessage={t('widget.drivetrainHealth.noData', 'No drivetrain data')}
          errorMessage={t('widget.drivetrainHealth.assessmentError', 'The drivetrain assessment could not be loaded.')}
          error={healthTrust.fatalError}
          errorRecovery={{ onRetry: healthTrust.retry ?? undefined }}
          emptyContent={<WidgetStatusGrid cells={assessment} />}
          retainedMessage={t('widget.drivetrainHealth.assessmentRetained', 'The previous drivetrain assessment remains visible while it refreshes.')}
        >
          <WidgetStatusGrid cells={assessment} />
        </SourceContent>
        <StaleRefreshWarning state={motorTrust} />
        {motorTrust.fatalError && <QueryError error={motorTrust.fatalError} onRetry={motorTrust.retry ?? undefined} />}
        <WidgetStatGrid stats={stats} cols={2} />
        <Caption className="block break-words">
          {t('widget.drivetrainHealth.assessmentCaveat', 'Assessment from available telemetry; not a mechanical inspection.')}
        </Caption>
        {!hasData && <Caption className="block break-words">{t('widget.drivetrainHealth.noData', 'No drivetrain data')}</Caption>}
      </div>
    </WidgetShell>
  );
}
