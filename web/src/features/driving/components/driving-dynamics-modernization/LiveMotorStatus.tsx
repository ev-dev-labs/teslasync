import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Cog } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Badge, Caption } from '@/components/ui';
import { LinearGauge, temperatureGaugeRange } from '@/components/charts';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { useMotorLatest } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';
import { INTERVALS } from '@/lib/constants';
import type { TemperatureUnitPref } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';
import { SignedMotorReading } from './SignedMotorReading';

interface LiveMotorStatusProps {
  vehicleId: number | null | undefined;
  toTemperatureDisplay: (v: number) => number;
  tempUnit: TemperatureUnitPref;
}
// Signed drive/regen and forward/reverse scales are unchanged.
const TORQUE_DRIVE_MAX_NM = 1000;
const TORQUE_REGEN_MAX_NM = 400;
const RPM_FORWARD_MAX = 18000;
const RPM_REVERSE_MAX = 3000;
const MOTOR_TEMP_FULL_SCALE_C = 150;
const MOTOR_TEMP_WARN_C = 80;
const MOTOR_TEMP_HOT_C = 120;
function motorTempColor(tempC: number): string {
  if (tempC >= MOTOR_TEMP_HOT_C) return '#f43f5e';
  if (tempC >= MOTOR_TEMP_WARN_C) return '#f59e0b';
  return '#10b981';
}

export default function LiveMotorStatus({ vehicleId, toTemperatureDisplay, tempUnit }: LiveMotorStatusProps) {
  const { fmtNumber, precision: displayPrecision } = useNumberFormatting();
  const { t } = useTranslation();
  const query = useMotorLatest(vehicleId ?? 0, INTERVALS.REALTIME);
  const state = useDataState(query);
  const motorLatest = state.data;
  const handleRetry = useCallback(() => { void query.refetch(); }, [query.refetch]);
  const torqueFront = motorLatest?.torque_nm_front ?? null;
  const torqueRear = motorLatest?.torque_nm_rear ?? null;
  // Preserve the original reported-axle sum. Invalid arithmetic is unknown,
  // not a confident zero or a silently recomputed partial-axle total.
  const reportedTorque = torqueFront == null && torqueRear == null
    ? null : (torqueFront ?? 0) + (torqueRear ?? 0);
  const torqueTotal = isFiniteNumber(reportedTorque) ? reportedTorque : null;
  const rpmFront = isFiniteNumber(motorLatest?.motor_rpm_front) ? motorLatest.motor_rpm_front : null;
  const rpmRear = isFiniteNumber(motorLatest?.motor_rpm_rear) ? motorLatest.motor_rpm_rear : null;
  const tempCandidates = [motorLatest?.motor_temp_c_front, motorLatest?.motor_temp_c_rear]
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const motorTempC = tempCandidates.length > 0 ? Math.max(...tempCandidates) : null;
  const hasAny = torqueTotal != null || rpmFront != null || rpmRear != null || motorTempC != null;

  return (
    <LayoutCard title={t('dynamics.liveMotor', 'Live Motor Status')}>
      {query.isLoading && !state.hasData ? (
        <div role="status" aria-busy="true"
          aria-label={t('dynamics.motorLoading', 'Loading motor telemetry…')}
          className="grid min-h-[8rem] grid-cols-1 gap-5 py-2 @xl:grid-cols-2">
          <div className="flex items-center justify-center gap-6">
            <Skeleton rounded className="h-28 w-28" />
            <Skeleton rounded className="h-20 w-20" />
          </div>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        </div>
      ) : hasAny ? (
        <div className="grid min-w-0 grid-cols-1 gap-5 @xl:grid-cols-2 @xl:items-center">
          <div className="flex flex-wrap items-center justify-center gap-6">
            <div className="flex flex-col items-center gap-2">
              <LinearGauge
                value={motorTempC != null ? toTemperatureDisplay(motorTempC) : null}
                {...temperatureGaugeRange(toTemperatureDisplay, { maxC: MOTOR_TEMP_FULL_SCALE_C })}
                label={t('dynamics.motorTemp', 'Motor')}
                unit={motorTempC != null ? tempUnit : '—'}
                color={motorTempColor(motorTempC ?? 0)}
                size={120}
                decimals={displayPrecision}
              />
              <Caption>{motorTempC != null ? `${fmtNumber(toTemperatureDisplay(motorTempC))}${tempUnit}`
                : t('dynamics.awaiting', 'Awaiting data')}</Caption>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-[120px] items-center justify-center">
                <Badge variant={motorLatest?.shift_state === 'D' ? 'success' : 'neutral'} size="lg"
                  aria-label={`${t('dynamics.shiftState', 'Shift State')}: ${motorLatest?.shift_state ?? t('dynamics.unknown', 'Unknown')}`}>
                  <Cog className="mr-1 h-4 w-4" aria-hidden="true" />
                  {motorLatest?.shift_state ?? t('dynamics.unknown', 'Unknown')}
                </Badge>
              </div>
              <Caption>{t('dynamics.shiftState', 'Shift State')}</Caption>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <SignedMotorReading value={torqueTotal} min={TORQUE_REGEN_MAX_NM} max={TORQUE_DRIVE_MAX_NM}
              label={t('dynamics.torque', 'Torque')} unit={torqueTotal != null ? ' Nm' : ''}
              positiveColor="#3b82f6" negativeColor="#10b981"
              negativeLabel={t('dynamics.regen', 'Regen')} positiveLabel={t('dynamics.drive', 'Drive')} />
            <SignedMotorReading value={rpmFront} min={RPM_REVERSE_MAX} max={RPM_FORWARD_MAX}
              label={t('dynamics.rpmFront', 'Front RPM')} unit={rpmFront != null ? ' RPM' : ''}
              positiveColor="#a855f7" negativeColor="#f59e0b"
              negativeLabel={t('dynamics.reverse', 'Reverse')} positiveLabel={t('dynamics.forward', 'Forward')} />
            <SignedMotorReading value={rpmRear} min={RPM_REVERSE_MAX} max={RPM_FORWARD_MAX}
              label={t('dynamics.rpmRear', 'Rear RPM')} unit={rpmRear != null ? ' RPM' : ''}
              positiveColor="#a855f7" negativeColor="#f59e0b"
              negativeLabel={t('dynamics.reverse', 'Reverse')} positiveLabel={t('dynamics.forward', 'Forward')} />
          </div>
        </div>
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={handleRetry} resourceName={t('dynamics.motorResource', 'Motor telemetry')} />
      ) : (
        <EmptyState message={t('dynamics.noLiveMotor', 'Awaiting live motor data')} />
      )}
    </LayoutCard>
  );
}
