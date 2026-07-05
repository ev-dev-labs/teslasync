import { useTranslation } from 'react-i18next';
import { Cog, Gauge } from 'lucide-react';

import { GlassPanel, Badge, PanelTitle, Caption } from '@/components/ui';
import { RadialGauge } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { fmtNumber } from '@/lib/numberFormat';
import type { MotorSnapshot } from '@/api/types';
import type { TemperatureUnitPref } from '@/lib/unitConversion';

interface LiveMotorStatusProps {
  motorLatest: MotorSnapshot | null | undefined;
  toTemperatureDisplay: (v: number) => number;
  // See MotorEfficiencyInsights tempUnit comment — already includes '°'.
  tempUnit: TemperatureUnitPref;
}

export default function LiveMotorStatus({ motorLatest, toTemperatureDisplay, tempUnit }: LiveMotorStatusProps) {
  const { t } = useTranslation();

  const torqueTotal =
    motorLatest
      ? (motorLatest.torque_nm_front ?? 0) + (motorLatest.torque_nm_rear ?? 0)
      : 0;
  const rpmFront = motorLatest?.motor_rpm_front ?? 0;
  const motorTempC = motorLatest
    ? Math.max(
        motorLatest.motor_temp_c_front ?? -Infinity,
        motorLatest.motor_temp_c_rear ?? -Infinity,
      )
    : null;
  const motorTempDisplay = motorTempC != null && isFinite(motorTempC) ? toTemperatureDisplay(motorTempC) : 0;

  return (
    <GlassPanel className="h-full p-4 sm:p-5 @container">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('dynamics.liveMotor', 'Live Motor Status')}
      </PanelTitle>
      {motorLatest ? (
        <div className="grid grid-cols-2 gap-4 @xl:grid-cols-4">
          <div className="flex flex-col items-center gap-2">
            <RadialGauge
              value={torqueTotal}
              max={1000}
              label={t('dynamics.torque', 'Torque')}
              unit="Nm"
              color="#3b82f6"
              size={120}
            />
            <Caption>{`${fmtNumber(torqueTotal)} Nm`}</Caption>
          </div>
          <div className="flex flex-col items-center gap-2">
            <RadialGauge
              value={rpmFront}
              max={18000}
              label={t('dynamics.rpmFront', 'Front RPM')}
              unit="RPM"
              color="#a855f7"
              size={120}
            />
            <Caption>{`${fmtNumber(rpmFront, 0)} RPM`}</Caption>
          </div>
          <div className="flex flex-col items-center gap-2">
            <RadialGauge
              value={motorTempDisplay}
              max={200}
              label={t('dynamics.motorTemp', 'Motor')}
              unit={tempUnit}
              color="#f59e0b"
              size={120}
            />
            <Caption>
              {motorTempC != null && isFinite(motorTempC)
                ? `${fmtNumber(toTemperatureDisplay(motorTempC), 1)}${tempUnit}`
                : t('dynamics.awaiting', 'Awaiting data')}
            </Caption>
          </div>
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-[120px] w-[120px] items-center justify-center">
              <Badge
                variant={motorLatest.shift_state === 'D' ? 'success' : 'neutral'}
                size="lg"
                aria-label={`${t('dynamics.shiftState', 'Shift State')}: ${
                  motorLatest.shift_state ?? t('dynamics.unknown', 'Unknown')
                }`}
              >
                <Cog className="mr-1 h-4 w-4" aria-hidden="true" />
                {motorLatest.shift_state ?? t('dynamics.unknown', 'Unknown')}
              </Badge>
            </div>
            <Caption>{t('dynamics.shiftState', 'Shift State')}</Caption>
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('dynamics.noLiveMotor', 'Awaiting live motor data')} />
      )}
    </GlassPanel>
  );
}
