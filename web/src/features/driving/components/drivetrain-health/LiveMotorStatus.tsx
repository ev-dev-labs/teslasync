import { useTranslation } from 'react-i18next';
import { Cog, Activity, Thermometer, Shield, Zap, BatteryCharging } from 'lucide-react';

import { GlassPanel, PanelTitle } from '@/components/ui';
import { Grid } from '@/components/layout';
import { InlineMetric, MetricCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState, Skeleton } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';

import type { MotorSnapshot } from '@/api/types';
import { convertTempFromSI } from '@/lib/unitConversion';

interface LiveMotorStatusProps {
  motorLatest: MotorSnapshot | null | undefined;
  isolationResistance?: number | null;
  loading?: boolean;
}

export function LiveMotorStatus({ motorLatest, isolationResistance, loading = false }: LiveMotorStatusProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;

  const hasData = motorLatest != null;

  return (
    <FadeIn delay={0.22}>
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Cog className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('drivetrain.liveMotor', 'Live Motor Status')}
        </PanelTitle>
        {loading && !hasData ? (
          <Skeleton height={220} />
        ) : hasData ? (
          <>
            <Grid cols={{ default: 2, sm: 4 }} gap={3}>
              <MetricCard
                label={t('drivetrain.shiftState', 'Shift State')}
                value={motorLatest.shift_state ?? '—'}
                icon={<Cog className="h-4 w-4" aria-hidden="true" />}
                color="cyan"
              />
              <MetricCard
                label={t('drivetrain.power', 'Power')}
                value={motorLatest.power_kw != null ? `${fmtNumber(motorLatest.power_kw)} kW` : '—'}
                icon={<Zap className="h-4 w-4" aria-hidden="true" />}
                color="purple"
              />
              <MetricCard
                label={t('drivetrain.regen', 'Regen')}
                value={motorLatest.regen_kw != null ? `${fmtNumber(motorLatest.regen_kw)} kW` : '—'}
                icon={<BatteryCharging className="h-4 w-4" aria-hidden="true" />}
                color="green"
              />
              <MetricCard
                label={t('drivetrain.source', 'Source')}
                value={motorLatest.source ?? '—'}
                icon={<Activity className="h-4 w-4" aria-hidden="true" />}
                color="blue"
              />
            </Grid>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <InlineMetric
                icon={<Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                label={t('drivetrain.rpmFront', 'Front Motor RPM')}
                value={
                  motorLatest.motor_rpm_front != null
                    ? `${fmtInt(motorLatest.motor_rpm_front)} RPM`
                    : '—'
                }
              />
              <InlineMetric
                icon={<Activity className="h-4 w-4 text-purple-300" aria-hidden="true" />}
                label={t('drivetrain.rpmRear', 'Rear Motor RPM')}
                value={
                  motorLatest.motor_rpm_rear != null
                    ? `${fmtInt(motorLatest.motor_rpm_rear)} RPM`
                    : '—'
                }
              />
              <InlineMetric
                icon={<Zap className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                label={t('drivetrain.torqueFront', 'Front Torque')}
                value={
                  motorLatest.torque_nm_front != null
                    ? `${fmtNumber(motorLatest.torque_nm_front)} Nm`
                    : '—'
                }
              />
              <InlineMetric
                icon={<Zap className="h-4 w-4 text-purple-300" aria-hidden="true" />}
                label={t('drivetrain.torqueRear', 'Rear Torque')}
                value={
                  motorLatest.torque_nm_rear != null
                    ? `${fmtNumber(motorLatest.torque_nm_rear)} Nm`
                    : '—'
                }
              />
              <InlineMetric
                icon={<Thermometer className="h-4 w-4 text-rose-300" aria-hidden="true" />}
                label={t('drivetrain.motorTempFront', 'Front Motor Temp')}
                value={
                  motorLatest.motor_temp_c_front != null
                    ? `${fmtNumber(toTemperatureDisplay(motorLatest.motor_temp_c_front))} ${tempUnit}`
                    : '—'
                }
              />
              <InlineMetric
                icon={<Thermometer className="h-4 w-4 text-rose-300" aria-hidden="true" />}
                label={t('drivetrain.motorTempRear', 'Rear Motor Temp')}
                value={
                  motorLatest.motor_temp_c_rear != null
                    ? `${fmtNumber(toTemperatureDisplay(motorLatest.motor_temp_c_rear))} ${tempUnit}`
                    : '—'
                }
              />
              <InlineMetric
                icon={<Thermometer className="h-4 w-4 text-amber-300" aria-hidden="true" />}
                label={t('drivetrain.inverterTemp', 'Inverter Temp')}
                value={
                  motorLatest.inverter_temp_c != null
                    ? `${fmtNumber(toTemperatureDisplay(motorLatest.inverter_temp_c))} ${tempUnit}`
                    : '—'
                }
              />
              <InlineMetric
                icon={<Thermometer className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
                label={t('drivetrain.batteryTemp', 'Battery Temp')}
                value={
                  motorLatest.battery_temp_c != null
                    ? `${fmtNumber(toTemperatureDisplay(motorLatest.battery_temp_c))} ${tempUnit}`
                    : '—'
                }
              />
              <InlineMetric
                icon={
                  <Shield
                    aria-hidden="true"
                    className={
                      isolationResistance == null || isolationResistance <= 0
                        ? 'h-4 w-4 text-[var(--text-muted)]'
                        : isolationResistance >= 500
                          ? 'h-4 w-4 text-emerald-300'
                          : isolationResistance >= 100
                            ? 'h-4 w-4 text-amber-300'
                            : 'h-4 w-4 text-rose-300'
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
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            message={t('drivetrain.noLiveMotor', 'No live motor telemetry yet')}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
