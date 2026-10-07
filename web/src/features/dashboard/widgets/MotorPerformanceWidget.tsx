import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { BipolarBar } from '@/components/charts';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useMotorLatest } from '@/api/hooks/useVehicles';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertTempFromSI } from '@/lib/unitConversion';

const TORQUE_MAX = 600;

/* Regen absorbs far less than the drive limit puts down, so the two ends of
 * the torque scale are sized independently rather than mirrored. */
const TORQUE_REGEN_MAX = 250;

// Live poll cadence (ms) for the motor telemetry tile. Mirrors the 5s interval
// every other live-telemetry widget (door/window, live signals, energy flow)
// and the drivetrain/dynamics pages use, so the tile stays current instead of
// freezing on the first reading until a manual refresh.
const LIVE_REFRESH_MS = 5_000;

/**
 * Map an absolute torque magnitude (Nm) to a gauge colour: green below 200,
 * amber below 400, red at/above 400. Exported for unit testing.
 */
export function torqueColor(nm: number): string {
  if (nm < 200) return '#10b981';
  if (nm < 400) return '#f59e0b';
  return '#ef4444';
}

export default function MotorPerformanceWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;

  const {
    data, isLoading, error,
    isFetching, isStale, isError,
    dataUpdatedAt, refetch,
  } = useMotorLatest(vid ?? 0, LIVE_REFRESH_MS);

  const isCompact = size.cols <= 1;
  const hasData = !!data;

  const torque = data?.di_torque ?? 0;
  const statorTemp = data?.di_stator_temp ?? data?.motor_temp_c_front ?? null;
  const gear = data?.gear ?? data?.shift_state ?? '—';
  // lateral_accel / longitudinal_accel may be present in the API response
  // but are not yet in the MotorSnapshot interface — access safely via unknown cast.
  const raw = data as unknown as Record<string, number | null | undefined> | undefined;
  const lateralG = raw?.lateral_accel ?? null;
  const longitudinalG = raw?.longitudinal_accel ?? null;

  const gaugeColor = useMemo(() => torqueColor(Math.abs(torque)), [torque]);

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt ?? 0,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <div className="h-full flex flex-col items-center justify-center gap-1 min-h-[44px]">
          {hasData ? (
            <>
              <span className="text-2xs uppercase tracking-wider text-[var(--text-muted)]">
                {t('widget.motorPerformance.gear', 'Gear')}
              </span>
              <span className="text-lg font-bold text-[var(--text-primary)]">{gear}</span>
              <span className="text-2xs uppercase tracking-wider text-[var(--text-muted)] mt-1">
                {t('widget.motorPerformance.torque', 'Torque')}
              </span>
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {fmtInt(torque)} {t('widget.motorPerformance.nm', 'Nm')}
              </span>
            </>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Zap className="h-5 w-5" />}
              message={t('widget.motorPerformance.noData', 'No motor data')}
              className="py-2"
            />
          )}
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.motorPerformance.title', 'Motor Performance')}
      icon={<Zap className="h-3.5 w-3.5 text-yellow-400" />}
      {...shellProps}
    >
      {hasData ? (
        <div className="flex flex-col items-center gap-3">
          <BipolarBar
            value={torque}
            max={TORQUE_MAX}
            min={TORQUE_REGEN_MAX}
            label={t('widget.motorPerformance.torque', 'Torque')}
            unit={` ${t('widget.motorPerformance.nm', 'Nm')}`}
            positiveColor={gaugeColor}
            negativeColor={gaugeColor}
            negativeLabel={t('widget.motorPerformance.regen', 'Regen')}
            positiveLabel={t('widget.motorPerformance.drive', 'Drive')}
          />
          <div className="grid grid-cols-2 gap-3 w-full">
            <StatCard
              label={t('widget.motorPerformance.statorTemp', 'Stator Temp')}
              value={statorTemp != null ? fmtNumber(toTemperatureDisplay(statorTemp), 0) : '—'}
              unit={statorTemp != null ? tempUnit : undefined}
            />
            <StatCard
              label={t('widget.motorPerformance.gearState', 'Gear State')}
              value={gear}
            />
            <StatCard
              label={t('widget.motorPerformance.lateralG', 'Lateral G')}
              value={lateralG != null ? fmtNumber(lateralG, 2) : '—'}
              unit={lateralG != null ? 'g' : undefined}
            />
            <StatCard
              label={t('widget.motorPerformance.longitudinalG', 'Longitudinal G')}
              value={longitudinalG != null ? fmtNumber(longitudinalG, 2) : '—'}
              unit={longitudinalG != null ? 'g' : undefined}
            />
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.motorPerformance.noData', 'No motor data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
