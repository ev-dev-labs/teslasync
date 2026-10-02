import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { BipolarBar } from '@/components/charts';
import { Skeleton } from '@/components/feedback';
import { useMotorLatest } from '@/api/hooks/useVehicles';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';
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

  const query = useMotorLatest(vid ?? 0, LIVE_REFRESH_MS);
  const {
    data, isLoading, error,
    isFetching, isStale, isError,
    dataUpdatedAt, refetch,
  } = query;
  const trust = useDataState({
    ...query,
    data: data ?? (isLoading || isError ? undefined : null),
  }, { provenance: 'cached', maxAgeMs: 120_000 });

  const isCompact = size.cols <= 1;
  const torque = knownNumber(data?.di_torque);
  const statorTemp = data?.di_stator_temp ?? data?.motor_temp_c_front ?? null;
  const gear = data?.gear ?? data?.shift_state ?? '—';
  // These extension fields are not declared by MotorSnapshot; narrow the
  // actual response rather than asserting that telemetry must be numeric.
  const lateralG = data && 'lateral_accel' in data ? knownNumber(data.lateral_accel) : null;
  const longitudinalG = data && 'longitudinal_accel' in data ? knownNumber(data.longitudinal_accel) : null;

  const gaugeColor = useMemo(() => torqueColor(Math.abs(torque ?? 0)), [torque]);

  const shellProps = {
    loading: isLoading,
    error: trust.fatalError ? String(error) : null,
    dataState: trust,
    loadingContent: <Skeleton className="h-24 w-full" />,
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
            <>
              <span className={dashboardTokens.metricLabel}>
                {t('widget.motorPerformance.gear', 'Gear')}
              </span>
              <span className={dashboardTokens.secondaryMetric}>{gear}</span>
              <span className={dashboardTokens.metricLabel}>
                {t('widget.motorPerformance.torque', 'Torque')}
              </span>
              <span className={dashboardTokens.secondaryMetric}>
                {torque == null ? '—' : fmtInt(torque)} {torque != null && t('widget.motorPerformance.nm', 'Nm')}
              </span>
            </>
          {!data && <p className={dashboardTokens.metricLabel}>{t('widget.motorPerformance.noData', 'No motor data')}</p>}
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.motorPerformance.title', 'Motor performance')}
      icon={<Zap className="h-3.5 w-3.5 text-yellow-400" />}
      {...shellProps}
    >
        <div className="flex min-w-0 flex-col gap-3">
          {torque != null ? <BipolarBar
            value={torque}
            max={TORQUE_MAX}
            min={TORQUE_REGEN_MAX}
            label={t('widget.motorPerformance.torque', 'Torque')}
            unit={` ${t('widget.motorPerformance.nm', 'Nm')}`}
            positiveColor={gaugeColor}
            negativeColor={gaugeColor}
            negativeLabel={t('widget.motorPerformance.regen', 'Regen')}
            positiveLabel={t('widget.motorPerformance.drive', 'Drive')}
          /> : <WidgetBigNumber value={null} label={t('widget.motorPerformance.torque', 'Torque')} />}
          <WidgetStatGrid cols={2} stats={[
            {
              label: t('widget.motorPerformance.statorTemp', 'Stator temp'),
              value: statorTemp != null ? fmtNumber(toTemperatureDisplay(statorTemp), 0) : null,
              unit: statorTemp != null ? tempUnit : undefined,
            },
            {
              label: t('widget.motorPerformance.gearState', 'Gear state'),
              value: gear,
            },
            {
              label: t('widget.motorPerformance.lateralG', 'Lateral G'),
              value: lateralG != null ? fmtNumber(lateralG, 2) : null,
              unit: lateralG != null ? 'g' : undefined,
            },
            {
              label: t('widget.motorPerformance.longitudinalG', 'Longitudinal G'),
              value: longitudinalG != null ? fmtNumber(longitudinalG, 2) : null,
              unit: longitudinalG != null ? 'g' : undefined,
            },
          ]} />
          {!data && <p className={dashboardTokens.metricLabel}>{t('widget.motorPerformance.noData', 'No motor data')}</p>}
        </div>
    </WidgetShell>
  );
}
