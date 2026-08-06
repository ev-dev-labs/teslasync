import { useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Cog, Gauge } from 'lucide-react';

import { GlassPanel, Badge, PanelTitle, Caption } from '@/components/ui';
import { RadialGauge, BipolarBar, temperatureGaugeRange } from '@/components/charts';
import { EmptyState, Spinner, QueryError } from '@/components/feedback';
import { useMotorLatest } from '@/api/hooks/useVehicles';
import { INTERVALS } from '@/lib/constants';
import { fmtNumber } from '@/lib/numberFormat';
import type { TemperatureUnitPref } from '@/lib/unitConversion';

interface LiveMotorStatusProps {
  vehicleId: number | null | undefined;
  toTemperatureDisplay: (v: number) => number;
  // See MotorEfficiencyInsights tempUnit comment — already includes '°'.
  tempUnit: TemperatureUnitPref;
}

/**
 * Full-scale ends for the powertrain readouts.
 *
 * Torque and axle speed are **signed** on the wire: DiTorqueActualF/R go
 * negative under regenerative braking and DiAxleSpeedF/R go negative in
 * reverse. They are therefore drawn as zero-centred BipolarBars — a radial
 * gauge clamps at zero, so regen and reverse used to render identically to a
 * parked car. The drive and regen ends are scaled independently because the
 * powertrain is asymmetric: peak drive torque is several times the regen
 * limit, so a symmetric scale would waste most of the regen half.
 */
const TORQUE_DRIVE_MAX_NM = 1000;
const TORQUE_REGEN_MAX_NM = 400;
const RPM_FORWARD_MAX = 18000;
const RPM_REVERSE_MAX = 3000;

/**
 * Stator temperature full scale. Motors idle around ambient and cruise in the
 * 40–80 °C band; the previous 0–200 scale squashed every healthy reading into
 * the first fifth of the ring, so a normal motor looked like a flat-empty
 * gauge. 150 °C still leaves headroom above the derate threshold.
 */
const MOTOR_TEMP_FULL_SCALE_C = 150;
const MOTOR_TEMP_WARN_C = 80;
const MOTOR_TEMP_HOT_C = 120;

/** Colour the temperature ring by band rather than showing one flat hue. */
function motorTempColor(tempC: number): string {
  if (tempC >= MOTOR_TEMP_HOT_C) return '#f43f5e';
  if (tempC >= MOTOR_TEMP_WARN_C) return '#f59e0b';
  return '#10b981';
}

/**
 * Live powertrain readout — torque, axle speed, stator temperature and gear.
 *
 * Owns its own `useMotorLatest` subscription at REALTIME cadence rather than
 * receiving a prop from the page. Panels on this page refresh at very
 * different rates (live motor at 5s, aggregate history at 10s, coach at 5m);
 * driving them all from one page-level fetch meant every panel inherited the
 * page's single cadence and the whole tree re-rendered on each poll. TanStack
 * dedupes by query key, so a sibling panel reading the same key shares this
 * cache entry instead of issuing a second request.
 */
export default function LiveMotorStatus({
  vehicleId,
  toTemperatureDisplay,
  tempUnit,
}: LiveMotorStatusProps) {
  const { t } = useTranslation();

  const {
    data: motorLatest,
    isLoading,
    isError,
    error,
    refetch,
  } = useMotorLatest(vehicleId ?? 0, INTERVALS.REALTIME);

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  // Sum the axles only when at least one reported, so a vehicle that has never
  // emitted torque reads "—" instead of a confident 0 Nm.
  const torqueFront = motorLatest?.torque_nm_front ?? null;
  const torqueRear = motorLatest?.torque_nm_rear ?? null;
  const torqueTotal =
    torqueFront == null && torqueRear == null
      ? null
      : (torqueFront ?? 0) + (torqueRear ?? 0);

  const rpmFront = motorLatest?.motor_rpm_front ?? null;
  const rpmRear = motorLatest?.motor_rpm_rear ?? null;

  const tempCandidates = [
    motorLatest?.motor_temp_c_front,
    motorLatest?.motor_temp_c_rear,
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const motorTempC = tempCandidates.length > 0 ? Math.max(...tempCandidates) : null;

  const hasAny =
    torqueTotal != null || rpmFront != null || rpmRear != null || motorTempC != null;

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="flex min-h-[8rem] items-center justify-center py-8">
        <Spinner label={t('dynamics.motorLoading', 'Loading motor telemetry…')} />
      </div>
    );
  } else if (hasAny) {
    body = (
      <div className="grid grid-cols-1 gap-5 @xl:grid-cols-2 @xl:items-center">
        <div className="flex items-center justify-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <RadialGauge
              value={
                motorTempC != null
                  ? toTemperatureDisplay(motorTempC)
                  : toTemperatureDisplay(0)
              }
              {...temperatureGaugeRange(toTemperatureDisplay, {
                maxC: MOTOR_TEMP_FULL_SCALE_C,
              })}
              label={t('dynamics.motorTemp', 'Motor')}
              unit={motorTempC != null ? tempUnit : '—'}
              color={motorTempColor(motorTempC ?? 0)}
              size={120}
              decimals={0}
            />
            <Caption>
              {motorTempC != null
                ? `${fmtNumber(toTemperatureDisplay(motorTempC), 1)}${tempUnit}`
                : t('dynamics.awaiting', 'Awaiting data')}
            </Caption>
          </div>
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-[120px] items-center justify-center">
              <Badge
                variant={motorLatest?.shift_state === 'D' ? 'success' : 'neutral'}
                size="lg"
                aria-label={`${t('dynamics.shiftState', 'Shift State')}: ${
                  motorLatest?.shift_state ?? t('dynamics.unknown', 'Unknown')
                }`}
              >
                <Cog className="mr-1 h-4 w-4" aria-hidden="true" />
                {motorLatest?.shift_state ?? t('dynamics.unknown', 'Unknown')}
              </Badge>
            </div>
            <Caption>{t('dynamics.shiftState', 'Shift State')}</Caption>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <BipolarBar
            value={torqueTotal ?? 0}
            min={TORQUE_REGEN_MAX_NM}
            max={TORQUE_DRIVE_MAX_NM}
            label={t('dynamics.torque', 'Torque')}
            unit={torqueTotal != null ? ' Nm' : ''}
            positiveColor="#3b82f6"
            negativeColor="#10b981"
            negativeLabel={t('dynamics.regen', 'Regen')}
            positiveLabel={t('dynamics.drive', 'Drive')}
          />
          <BipolarBar
            value={rpmFront ?? 0}
            min={RPM_REVERSE_MAX}
            max={RPM_FORWARD_MAX}
            label={t('dynamics.rpmFront', 'Front RPM')}
            unit={rpmFront != null ? ' RPM' : ''}
            positiveColor="#a855f7"
            negativeColor="#f59e0b"
            negativeLabel={t('dynamics.reverse', 'Reverse')}
            positiveLabel={t('dynamics.forward', 'Forward')}
          />
          <BipolarBar
            value={rpmRear ?? 0}
            min={RPM_REVERSE_MAX}
            max={RPM_FORWARD_MAX}
            label={t('dynamics.rpmRear', 'Rear RPM')}
            unit={rpmRear != null ? ' RPM' : ''}
            positiveColor="#a855f7"
            negativeColor="#f59e0b"
            negativeLabel={t('dynamics.reverse', 'Reverse')}
            positiveLabel={t('dynamics.forward', 'Forward')}
          />
        </div>
      </div>
    );
  } else if (isError) {
    // Surface the failure rather than masking it as an empty panel, but only
    // when there is no prior snapshot to keep showing — a failed background
    // poll must never blank good data.
    body = (
      <QueryError
        error={error}
        onRetry={handleRetry}
        resourceName={t('dynamics.motorResource', 'Motor telemetry')}
      />
    );
  } else {
    body = (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        message={t('dynamics.noLiveMotor', 'Awaiting live motor data')}
      />
    );
  }

  return (
    <GlassPanel className="h-full p-4 sm:p-5 @container">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('dynamics.liveMotor', 'Live Motor Status')}
      </PanelTitle>
      {body}
    </GlassPanel>
  );
}
