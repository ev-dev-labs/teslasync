import { useTranslation } from 'react-i18next';
import { Cog, Activity, Thermometer, Shield, Zap } from 'lucide-react';

import { GlassPanel } from '@/components/ui';
import { Grid } from '@/components/layout';
import { InlineMetric } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';

import type { MotorSnapshot } from '@/api/types';

interface LiveMotorStatusProps {
  motorLatest: MotorSnapshot | null | undefined;
  isolationResistance?: number | null;
}

export function LiveMotorStatus({ motorLatest, isolationResistance }: LiveMotorStatusProps) {
  const { t } = useTranslation();
  const { convertTemp, tempUnit } = useSettings();

  const hasData = motorLatest != null;

  return (
    <FadeIn delay={0.22}>
      <GlassPanel className="p-6">
        <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--text-muted)]">
          <Cog className="mr-2 inline-block h-4 w-4" />
          {t('drivetrain.liveMotor', 'Live Motor Status')}
        </h3>
        {hasData ? (
          <>
            <Grid cols={{ default: 2, sm: 4 }} gap={3}>
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 text-center">
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  {t('drivetrain.shiftState', 'Shift State')}
                </p>
                <p className="text-lg font-bold text-cyan-400">
                  {motorLatest.shift_state ?? '—'}
                </p>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 text-center">
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  {t('drivetrain.power', 'Power')}
                </p>
                <p className="text-lg font-bold text-purple-400">
                  {motorLatest.power_kw != null
                    ? `${fmtNumber(motorLatest.power_kw)} kW`
                    : '—'}
                </p>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 text-center">
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  {t('drivetrain.regen', 'Regen')}
                </p>
                <p className="text-lg font-bold text-green-400">
                  {motorLatest.regen_kw != null
                    ? `${fmtNumber(motorLatest.regen_kw)} kW`
                    : '—'}
                </p>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 text-center">
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  {t('drivetrain.source', 'Source')}
                </p>
                <p className="text-lg font-bold text-[var(--text-primary)]">
                  {motorLatest.source ?? '—'}
                </p>
              </div>
            </Grid>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <InlineMetric
                icon={<Activity className="h-4 w-4 text-cyan-400" />}
                label={t('drivetrain.rpmFront', 'Front Motor RPM')}
                value={
                  motorLatest.motor_rpm_front != null
                    ? `${fmtInt(motorLatest.motor_rpm_front)} RPM`
                    : '—'
                }
              />
              <InlineMetric
                icon={<Activity className="h-4 w-4 text-purple-400" />}
                label={t('drivetrain.rpmRear', 'Rear Motor RPM')}
                value={
                  motorLatest.motor_rpm_rear != null
                    ? `${fmtInt(motorLatest.motor_rpm_rear)} RPM`
                    : '—'
                }
              />
              <InlineMetric
                icon={<Zap className="h-4 w-4 text-cyan-400" />}
                label={t('drivetrain.torqueFront', 'Front Torque')}
                value={
                  motorLatest.torque_nm_front != null
                    ? `${fmtNumber(motorLatest.torque_nm_front)} Nm`
                    : '—'
                }
              />
              <InlineMetric
                icon={<Zap className="h-4 w-4 text-purple-400" />}
                label={t('drivetrain.torqueRear', 'Rear Torque')}
                value={
                  motorLatest.torque_nm_rear != null
                    ? `${fmtNumber(motorLatest.torque_nm_rear)} Nm`
                    : '—'
                }
              />
              <InlineMetric
                icon={<Thermometer className="h-4 w-4 text-red-400" />}
                label={t('drivetrain.motorTempFront', 'Front Motor Temp')}
                value={
                  motorLatest.motor_temp_c_front != null
                    ? `${fmtNumber(convertTemp(motorLatest.motor_temp_c_front))} ${tempUnit}`
                    : '—'
                }
              />
              <InlineMetric
                icon={<Thermometer className="h-4 w-4 text-red-400" />}
                label={t('drivetrain.motorTempRear', 'Rear Motor Temp')}
                value={
                  motorLatest.motor_temp_c_rear != null
                    ? `${fmtNumber(convertTemp(motorLatest.motor_temp_c_rear))} ${tempUnit}`
                    : '—'
                }
              />
              <InlineMetric
                icon={<Thermometer className="h-4 w-4 text-amber-400" />}
                label={t('drivetrain.inverterTemp', 'Inverter Temp')}
                value={
                  motorLatest.inverter_temp_c != null
                    ? `${fmtNumber(convertTemp(motorLatest.inverter_temp_c))} ${tempUnit}`
                    : '—'
                }
              />
              <InlineMetric
                icon={<Thermometer className="h-4 w-4 text-green-400" />}
                label={t('drivetrain.batteryTemp', 'Battery Temp')}
                value={
                  motorLatest.battery_temp_c != null
                    ? `${fmtNumber(convertTemp(motorLatest.battery_temp_c))} ${tempUnit}`
                    : '—'
                }
              />
              <InlineMetric
                icon={
                  <Shield
                    className={
                      isolationResistance == null || isolationResistance <= 0
                        ? 'h-4 w-4 text-[var(--text-muted)]'
                        : isolationResistance >= 500
                          ? 'h-4 w-4 text-green-400'
                          : isolationResistance >= 100
                            ? 'h-4 w-4 text-amber-400'
                            : 'h-4 w-4 text-red-400'
                    }
                  />
                }
                label={t('drivetrain.isolationResistance', 'HV Isolation')}
                value={
                  isolationResistance != null && isolationResistance > 0
                    ? `${fmtNumber(isolationResistance)} kΩ`
                    : '—'
                }
              />
            </div>
          </>
        ) : (
          <EmptyState
            message={t('drivetrain.noLiveMotor', 'No live motor telemetry yet')}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
