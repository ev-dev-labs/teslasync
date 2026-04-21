import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cog,
  Activity,
  Gauge,
  Thermometer,
  Shield,
  Power,
  BatteryCharging,
  CheckCircle,
  AlertTriangle,
  Zap,
} from 'lucide-react';

import { GlassPanel } from '@/components/ui';
import { Grid } from '@/components/layout';
import { InlineMetric } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { AlertBanner } from '@/components/feedback';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

import type { MotorSnapshot } from '@/api/types';

interface LiveMotorStatusProps {
  motorLatest: MotorSnapshot;
  isolationResistance?: number | null;
}

export function LiveMotorStatus({ motorLatest, isolationResistance }: LiveMotorStatusProps) {
  const { t } = useTranslation();
  const { convertTemp, convertSpeed, tempUnit, speedUnit } = useSettings();

  const diStateColor = useMemo(() => {
    const state = motorLatest.di_state;
    if (!state) return 'text-[var(--text-muted)]';
    if (state === 'drive') return 'text-green-400';
    if (state === 'idle') return 'text-cyan-400';
    return 'text-amber-400';
  }, [motorLatest.di_state]);

  const gearValue = motorLatest.gear ?? '—';
  const gearColor = useMemo(() => {
    const g = motorLatest.gear;
    if (!g) return 'text-[var(--text-muted)]';
    if (g === 'D' || g === 'Drive') return 'text-green-400';
    if (g === 'R' || g === 'Reverse') return 'text-amber-400';
    if (g === 'P' || g === 'Park') return 'text-cyan-400';
    return 'text-[var(--text-muted)]';
  }, [motorLatest.gear]);

  return (
    <FadeIn delay={0.22}>
      <GlassPanel className="p-6">
        <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--text-muted)]">
          <Cog className="mr-2 inline-block h-4 w-4" />
          {t('drivetrain.liveMotor', 'Live Motor Status')}
        </h3>
        <Grid cols={{ default: 2, sm: 4 }} gap={3}>
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {t('drivetrain.diState', 'DI State')}
            </p>
            <p className={cn('text-lg font-bold', diStateColor)}>
              {motorLatest.di_state ?? '—'}
            </p>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {t('drivetrain.gear', 'Gear')}
            </p>
            <p className={cn('text-lg font-bold', gearColor)}>{gearValue}</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {t('drivetrain.vehicleSpeed', 'Vehicle Speed')}
            </p>
            <p className="text-lg font-bold text-cyan-400">
              {motorLatest.vehicle_speed != null
                ? `${fmtNumber(convertSpeed(motorLatest.vehicle_speed))} ${speedUnit}`
                : '—'}
            </p>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {t('drivetrain.torque', 'Torque')}
            </p>
            <p className="text-lg font-bold text-purple-400">
              {motorLatest.di_torque != null
                ? `${fmtNumber(motorLatest.di_torque)} Nm`
                : '—'}
            </p>
          </div>
        </Grid>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <InlineMetric
            icon={<Activity className="h-4 w-4 text-yellow-400" />}
            label={t('drivetrain.axleSpeed', 'Axle Speed')}
            value={
              motorLatest.di_axle_speed != null
                ? `${fmtInt(motorLatest.di_axle_speed)} RPM`
                : '—'
            }
          />
          <InlineMetric
            icon={<Cog className="h-4 w-4 text-cyan-400" />}
            label={t('drivetrain.diStateFront', 'Front DI State')}
            value={motorLatest.di_state_f ?? '—'}
          />
          <InlineMetric
            icon={<Activity className="h-4 w-4 text-cyan-400" />}
            label={t('drivetrain.axleSpeedFront', 'Front Axle Speed')}
            value={
              motorLatest.di_axle_speed_f != null
                ? `${fmtInt(motorLatest.di_axle_speed_f)} RPM`
                : '—'
            }
          />
          <InlineMetric
            icon={<Cog className="h-4 w-4 text-purple-400" />}
            label={t('drivetrain.diStateRearLeft', 'Rear-Left DI State')}
            value={motorLatest.di_state_rel ?? '—'}
          />
          <InlineMetric
            icon={<Cog className="h-4 w-4 text-purple-400" />}
            label={t('drivetrain.diStateRearRight', 'Rear-Right DI State')}
            value={motorLatest.di_state_rer ?? '—'}
          />
          <InlineMetric
            icon={<Activity className="h-4 w-4 text-purple-400" />}
            label={t('drivetrain.axleSpeedRearLeft', 'Rear-Left Axle Speed')}
            value={
              motorLatest.di_axle_speed_rel != null
                ? `${fmtInt(motorLatest.di_axle_speed_rel)} RPM`
                : '—'
            }
          />
          <InlineMetric
            icon={<Zap className="h-4 w-4 text-purple-400" />}
            label={t('drivetrain.slaveTorqueCmd', 'Slave Torque Cmd')}
            value={
              motorLatest.di_slave_torque_cmd != null
                ? `${fmtNumber(motorLatest.di_slave_torque_cmd)} Nm`
                : '—'
            }
          />
          <InlineMetric
            icon={<Zap className="h-4 w-4 text-cyan-400" />}
            label={t('drivetrain.torqueActualFront', 'Front Actual Torque')}
            value={
              motorLatest.di_torque_actual_f != null
                ? `${fmtNumber(motorLatest.di_torque_actual_f)} Nm`
                : '—'
            }
          />
          <InlineMetric
            icon={<Zap className="h-4 w-4 text-purple-400" />}
            label={t('drivetrain.torqueActualRear', 'Rear Actual Torque')}
            value={
              motorLatest.di_torque_actual_r != null
                ? `${fmtNumber(motorLatest.di_torque_actual_r)} Nm`
                : '—'
            }
          />
          <InlineMetric
            icon={<Zap className="h-4 w-4 text-purple-400" />}
            label={t('drivetrain.torqueActualRearLeft', 'Rear-Left Actual Torque')}
            value={
              motorLatest.di_torque_actual_rel != null
                ? `${fmtNumber(motorLatest.di_torque_actual_rel)} Nm`
                : '—'
            }
          />
          <InlineMetric
            icon={<Zap className="h-4 w-4 text-purple-400" />}
            label={t('drivetrain.torqueActualRearRight', 'Rear-Right Actual Torque')}
            value={
              motorLatest.di_torque_actual_rer != null
                ? `${fmtNumber(motorLatest.di_torque_actual_rer)} Nm`
                : '—'
            }
          />
          <InlineMetric
            icon={<Gauge className="h-4 w-4 text-green-400" />}
            label={t('drivetrain.pedalPos', 'Pedal Position')}
            value={
              motorLatest.pedal_position != null
                ? `${fmtNumber(motorLatest.pedal_position, 0)}%`
                : '—'
            }
          />
          <InlineMetric
            icon={<Thermometer className="h-4 w-4 text-red-400" />}
            label={t('drivetrain.statorTemp', 'Stator Temp')}
            value={
              motorLatest.di_stator_temp != null
                ? `${fmtNumber(convertTemp(motorLatest.di_stator_temp))} ${tempUnit}`
                : '—'
            }
          />
          <InlineMetric
            icon={<Thermometer className="h-4 w-4 text-red-400" />}
            label={t('drivetrain.statorTempFront', 'Front Stator Temp')}
            value={
              motorLatest.di_stator_temp_f != null
                ? `${fmtNumber(convertTemp(motorLatest.di_stator_temp_f))} ${tempUnit}`
                : '—'
            }
          />
          <InlineMetric
            icon={<Thermometer className="h-4 w-4 text-red-400" />}
            label={t('drivetrain.statorTempRear', 'Rear Stator Temp')}
            value={
              motorLatest.di_stator_temp_r != null
                ? `${fmtNumber(convertTemp(motorLatest.di_stator_temp_r))} ${tempUnit}`
                : '—'
            }
          />
          <InlineMetric
            icon={<Thermometer className="h-4 w-4 text-red-400" />}
            label={t('drivetrain.statorTempRearLeft', 'Rear-Left Stator Temp')}
            value={
              motorLatest.di_stator_temp_rel != null
                ? `${fmtNumber(convertTemp(motorLatest.di_stator_temp_rel))} ${tempUnit}`
                : '—'
            }
          />
          <InlineMetric
            icon={<Thermometer className="h-4 w-4 text-red-400" />}
            label={t('drivetrain.statorTempRearRight', 'Rear-Right Stator Temp')}
            value={
              motorLatest.di_stator_temp_rer != null
                ? `${fmtNumber(convertTemp(motorLatest.di_stator_temp_rer))} ${tempUnit}`
                : '—'
            }
          />
          <InlineMetric
            icon={<Thermometer className="h-4 w-4 text-orange-400" />}
            label={t('drivetrain.heatsinkTempFront', 'Front Heatsink Temp')}
            value={
              motorLatest.di_heatsink_t_f != null
                ? `${fmtNumber(convertTemp(motorLatest.di_heatsink_t_f))} ${tempUnit}`
                : '—'
            }
          />
          <InlineMetric
            icon={<Thermometer className="h-4 w-4 text-orange-400" />}
            label={t('drivetrain.heatsinkTempRear', 'Rear Heatsink Temp')}
            value={
              motorLatest.di_heatsink_t_r != null
                ? `${fmtNumber(convertTemp(motorLatest.di_heatsink_t_r))} ${tempUnit}`
                : '—'
            }
          />
          <InlineMetric
            icon={<Thermometer className="h-4 w-4 text-orange-400" />}
            label={t('drivetrain.heatsinkTempRearLeft', 'Rear-Left Heatsink Temp')}
            value={
              motorLatest.di_heatsink_t_rel != null
                ? `${fmtNumber(convertTemp(motorLatest.di_heatsink_t_rel))} ${tempUnit}`
                : '—'
            }
          />
          <InlineMetric
            icon={<Thermometer className="h-4 w-4 text-orange-400" />}
            label={t('drivetrain.heatsinkTempRearRight', 'Rear-Right Heatsink Temp')}
            value={
              motorLatest.di_heatsink_t_rer != null
                ? `${fmtNumber(convertTemp(motorLatest.di_heatsink_t_rer))} ${tempUnit}`
                : '—'
            }
          />
          <InlineMetric
            icon={<Thermometer className="h-4 w-4 text-amber-400" />}
            label={t('drivetrain.inverterTempFront', 'Front Inverter Temp')}
            value={
              motorLatest.di_inverter_t_f != null
                ? `${fmtNumber(convertTemp(motorLatest.di_inverter_t_f))} ${tempUnit}`
                : '—'
            }
          />
          <InlineMetric
            icon={<Thermometer className="h-4 w-4 text-amber-400" />}
            label={t('drivetrain.inverterTempRear', 'Rear Inverter Temp')}
            value={
              motorLatest.di_inverter_t_r != null
                ? `${fmtNumber(convertTemp(motorLatest.di_inverter_t_r))} ${tempUnit}`
                : '—'
            }
          />
          <InlineMetric
            icon={<Thermometer className="h-4 w-4 text-amber-400" />}
            label={t('drivetrain.inverterTempRearLeft', 'Rear-Left Inverter Temp')}
            value={
              motorLatest.di_inverter_t_rel != null
                ? `${fmtNumber(convertTemp(motorLatest.di_inverter_t_rel))} ${tempUnit}`
                : '—'
            }
          />
          <InlineMetric
            icon={<Thermometer className="h-4 w-4 text-amber-400" />}
            label={t('drivetrain.inverterTempRearRight', 'Rear-Right Inverter Temp')}
            value={
              motorLatest.di_inverter_t_rer != null
                ? `${fmtNumber(convertTemp(motorLatest.di_inverter_t_rer))} ${tempUnit}`
                : '—'
            }
          />
          <InlineMetric
            icon={<Zap className="h-4 w-4 text-cyan-400" />}
            label={t('drivetrain.motorCurrentFront', 'Front Motor Current')}
            value={
              motorLatest.di_motor_current_f != null
                ? `${fmtNumber(motorLatest.di_motor_current_f)} A`
                : '—'
            }
          />
          <InlineMetric
            icon={<Zap className="h-4 w-4 text-purple-400" />}
            label={t('drivetrain.motorCurrentRear', 'Rear Motor Current')}
            value={
              motorLatest.di_motor_current_r != null
                ? `${fmtNumber(motorLatest.di_motor_current_r)} A`
                : '—'
            }
          />
          <InlineMetric
            icon={<Zap className="h-4 w-4 text-purple-400" />}
            label={t('drivetrain.motorCurrentRearLeft', 'Rear-Left Motor Current')}
            value={
              motorLatest.di_motor_current_rel != null
                ? `${fmtNumber(motorLatest.di_motor_current_rel)} A`
                : '—'
            }
          />
          <InlineMetric
            icon={<Zap className="h-4 w-4 text-purple-400" />}
            label={t('drivetrain.motorCurrentRearRight', 'Rear-Right Motor Current')}
            value={
              motorLatest.di_motor_current_rer != null
                ? `${fmtNumber(motorLatest.di_motor_current_rer)} A`
                : '—'
            }
          />
          <InlineMetric
            icon={<BatteryCharging className="h-4 w-4 text-cyan-400" />}
            label={t('drivetrain.batteryVoltageFront', 'Front Battery Voltage')}
            value={
              motorLatest.di_v_bat_f != null
                ? `${fmtNumber(motorLatest.di_v_bat_f)} V`
                : '—'
            }
          />
          <InlineMetric
            icon={<BatteryCharging className="h-4 w-4 text-purple-400" />}
            label={t('drivetrain.batteryVoltageRear', 'Rear Battery Voltage')}
            value={
              motorLatest.di_v_bat_r != null
                ? `${fmtNumber(motorLatest.di_v_bat_r)} V`
                : '—'
            }
          />
          <InlineMetric
            icon={<BatteryCharging className="h-4 w-4 text-purple-400" />}
            label={t('drivetrain.batteryVoltageRearLeft', 'Rear-Left Battery Voltage')}
            value={
              motorLatest.di_v_bat_rel != null
                ? `${fmtNumber(motorLatest.di_v_bat_rel)} V`
                : '—'
            }
          />
          <InlineMetric
            icon={<BatteryCharging className="h-4 w-4 text-purple-400" />}
            label={t('drivetrain.batteryVoltageRearRight', 'Rear-Right Battery Voltage')}
            value={
              motorLatest.di_v_bat_rer != null
                ? `${fmtNumber(motorLatest.di_v_bat_rer)} V`
                : '—'
            }
          />
          <InlineMetric
            icon={
              <Shield
                className={cn(
                  'h-4 w-4',
                  motorLatest.hvil === 'Fault' ? 'text-red-400' : 'text-green-400',
                )}
              />
            }
            label={t('drivetrain.hvil', 'HV Interlock')}
            value={motorLatest.hvil ?? '—'}
          />
          <InlineMetric
            icon={
              <Power
                className={cn(
                  'h-4 w-4',
                  motorLatest.drive_rail == null
                    ? 'text-[var(--text-muted)]'
                    : motorLatest.drive_rail
                      ? 'text-green-400'
                      : 'text-amber-400',
                )}
              />
            }
            label={t('drivetrain.driveRail', 'Drive Rail')}
            value={
              motorLatest.drive_rail == null
                ? '—'
                : motorLatest.drive_rail
                  ? t('drivetrain.driveRailActive', 'Active')
                  : t('drivetrain.driveRailInactive', 'Inactive')
            }
          />
          <InlineMetric
            icon={
              <Shield
                className={cn(
                  'h-4 w-4',
                  isolationResistance == null || isolationResistance <= 0
                    ? 'text-[var(--text-muted)]'
                    : isolationResistance >= 500
                      ? 'text-green-400'
                      : isolationResistance >= 100
                        ? 'text-amber-400'
                        : 'text-red-400',
                )}
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
        {motorLatest.brake_pedal != null && (
          <div className="mt-3">
            <AlertBanner
              variant={motorLatest.brake_pedal ? 'danger' : 'success'}
              icon={
                motorLatest.brake_pedal ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )
              }
            >
              {motorLatest.brake_pedal
                ? t('drivetrain.brakeEngaged', 'Brake Engaged')
                : t('drivetrain.brakeReleased', 'Brake Released')}
            </AlertBanner>
          </div>
        )}
      </GlassPanel>
    </FadeIn>
  );
}
