import { useTranslation } from 'react-i18next';
import { Cog, Activity, Thermometer, Shield, Zap, BatteryCharging } from 'lucide-react';

import { GlassPanel, PanelTitle } from '@/components/ui';
import { Grid } from '@/components/layout';
import { InlineMetric, MetricCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState, Skeleton } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt, isFiniteNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

import type { MotorSnapshot } from '@/api/types';
import { convertTempFromSI, type TemperatureUnitPref } from '@/lib/unitConversion';

/** Neutral placeholder for an absent or non-finite reading. */
const DASH = '—';

/**
 * Render a finite scalar with a unit suffix, or the neutral placeholder.
 * A `null` / `undefined` / `NaN` / `±Infinity` reading collapses to "—"
 * instead of the fabricated "0" that the underlying `safeNumber` coercion
 * inside `fmtNumber` would otherwise emit.
 */
function numberMetric(value: number | null | undefined, unit: string): string {
  return isFiniteNumber(value) ? `${fmtNumber(value)} ${unit}` : DASH;
}

/** Integer variant of {@link numberMetric} for whole-count fields (RPM). */
function intMetric(value: number | null | undefined, unit: string): string {
  return isFiniteNumber(value) ? `${fmtInt(value)} ${unit}` : DASH;
}

/** Convert an SI-celsius reading to the display unit, guarding non-finite input. */
function temperatureMetric(
  value: number | null | undefined,
  tempUnit: TemperatureUnitPref,
): string {
  return isFiniteNumber(value)
    ? `${fmtNumber(convertTempFromSI(value, tempUnit))} ${tempUnit}`
    : DASH;
}

/** HV isolation reading in kΩ. Only finite, strictly-positive values render. */
function isolationMetric(value: number | null | undefined): string {
  return isFiniteNumber(value) && value > 0 ? `${fmtNumber(value)} kΩ` : DASH;
}

/** Trim a text reading to a non-empty value, or the neutral placeholder. */
function textMetric(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : DASH;
}

/**
 * Icon tint for the HV isolation reading. Non-finite or non-positive
 * readings are treated as "unknown" (muted) so the glyph never implies a
 * danger (red) state for a value the cell itself renders as "—".
 */
function isolationTint(value: number | null | undefined): string {
  if (!isFiniteNumber(value) || value <= 0) return 'text-[var(--text-muted)]';
  if (value >= 500) return 'text-emerald-300';
  if (value >= 100) return 'text-amber-300';
  return 'text-rose-300';
}

interface LiveMotorStatusProps {
  motorLatest: MotorSnapshot | null | undefined;
  isolationResistance?: number | null;
  loading?: boolean;
}

export function LiveMotorStatus({ motorLatest, isolationResistance, loading = false }: LiveMotorStatusProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
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
                value={textMetric(motorLatest.shift_state)}
                icon={<Cog className="h-4 w-4" aria-hidden="true" />}
                color="cyan"
              />
              <MetricCard
                label={t('drivetrain.power', 'Power')}
                value={numberMetric(motorLatest.power_kw, 'kW')}
                icon={<Zap className="h-4 w-4" aria-hidden="true" />}
                color="purple"
              />
              <MetricCard
                label={t('drivetrain.regen', 'Regen')}
                value={numberMetric(motorLatest.regen_kw, 'kW')}
                icon={<BatteryCharging className="h-4 w-4" aria-hidden="true" />}
                color="green"
              />
              <MetricCard
                label={t('drivetrain.source', 'Source')}
                value={textMetric(motorLatest.source)}
                icon={<Activity className="h-4 w-4" aria-hidden="true" />}
                color="blue"
              />
            </Grid>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <InlineMetric
                icon={<Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                label={t('drivetrain.rpmFront', 'Front Motor RPM')}
                value={intMetric(motorLatest.motor_rpm_front, 'RPM')}
              />
              <InlineMetric
                icon={<Activity className="h-4 w-4 text-purple-300" aria-hidden="true" />}
                label={t('drivetrain.rpmRear', 'Rear Motor RPM')}
                value={intMetric(motorLatest.motor_rpm_rear, 'RPM')}
              />
              <InlineMetric
                icon={<Zap className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                label={t('drivetrain.torqueFront', 'Front Torque')}
                value={numberMetric(motorLatest.torque_nm_front, 'Nm')}
              />
              <InlineMetric
                icon={<Zap className="h-4 w-4 text-purple-300" aria-hidden="true" />}
                label={t('drivetrain.torqueRear', 'Rear Torque')}
                value={numberMetric(motorLatest.torque_nm_rear, 'Nm')}
              />
              <InlineMetric
                icon={<Thermometer className="h-4 w-4 text-rose-300" aria-hidden="true" />}
                label={t('drivetrain.motorTempFront', 'Front Motor Temp')}
                value={temperatureMetric(motorLatest.motor_temp_c_front, tempUnit)}
              />
              <InlineMetric
                icon={<Thermometer className="h-4 w-4 text-rose-300" aria-hidden="true" />}
                label={t('drivetrain.motorTempRear', 'Rear Motor Temp')}
                value={temperatureMetric(motorLatest.motor_temp_c_rear, tempUnit)}
              />
              <InlineMetric
                icon={<Thermometer className="h-4 w-4 text-amber-300" aria-hidden="true" />}
                label={t('drivetrain.inverterTemp', 'Inverter Temp')}
                value={temperatureMetric(motorLatest.inverter_temp_c, tempUnit)}
              />
              <InlineMetric
                icon={<Thermometer className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
                label={t('drivetrain.batteryTemp', 'Battery Temp')}
                value={temperatureMetric(motorLatest.battery_temp_c, tempUnit)}
              />
              <InlineMetric
                icon={
                  <Shield
                    aria-hidden="true"
                    className={cn('h-4 w-4', isolationTint(isolationResistance))}
                  />
                }
                label={t('drivetrain.isolationResistance', 'HV Isolation')}
                value={isolationMetric(isolationResistance)}
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
