import { useTranslation } from 'react-i18next';
import { Cog } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel, Badge } from '@/components/ui';
import { RadialGauge } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { fmtNumber } from '@/lib/numberFormat';
import type { MotorSnapshot } from '@/api/types';

interface LiveMotorStatusProps {
  motorLatest: MotorSnapshot | null | undefined;
  toTemperatureDisplay: (v: number) => number;
  tempUnit: string;
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
    <FadeIn>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">
          {t('dynamics.liveMotor', 'Live Motor Status')}
        </h2>
        {motorLatest ? (
          <Grid cols={{ default: 2, md: 4 }} gap={6}>
            <div className="flex flex-col items-center gap-2">
              <RadialGauge
                value={torqueTotal}
                max={1000}
                label={t('dynamics.torque', 'Torque')}
                unit="Nm"
                color="#3b82f6"
                size={120}
              />
              <span className="text-xs text-[var(--text-secondary)]">
                {`${fmtNumber(torqueTotal)} Nm`}
              </span>
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
              <span className="text-xs text-[var(--text-secondary)]">
                {`${fmtNumber(rpmFront, 0)} RPM`}
              </span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <RadialGauge
                value={motorTempDisplay}
                max={200}
                label={t('dynamics.motorTemp', 'Motor')}
                unit={`°${tempUnit}`}
                color="#f59e0b"
                size={120}
              />
              <span className="text-xs text-[var(--text-secondary)]">
                {motorTempC != null && isFinite(motorTempC)
                  ? `${fmtNumber(toTemperatureDisplay(motorTempC), 1)}°${tempUnit}`
                  : t('dynamics.awaiting', 'Awaiting data')}
              </span>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-[120px] w-[120px] items-center justify-center">
                <Badge
                  variant={motorLatest.shift_state === 'D' ? 'success' : 'neutral'}
                  size="lg"
                >
                  <Cog className="mr-1 h-4 w-4" />
                  {motorLatest.shift_state ?? t('dynamics.unknown', 'Unknown')}
                </Badge>
              </div>
              <span className="text-xs text-[var(--text-secondary)]">
                {t('dynamics.shiftState', 'Shift State')}
              </span>
            </div>
          </Grid>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('dynamics.noLiveMotor', 'Awaiting live motor data')} />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
