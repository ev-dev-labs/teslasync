import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cog,
  Activity,
  Gauge,
  Thermometer,
  Shield,
  CheckCircle,
  AlertTriangle,
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
}

export function LiveMotorStatus({ motorLatest }: LiveMotorStatusProps) {
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
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
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
