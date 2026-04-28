import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { RadialGauge } from '@/components/charts';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useMotorLatest } from '@/api/hooks/useVehicles';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

const TORQUE_MAX = 600;

function torqueColor(nm: number): string {
  if (nm < 200) return '#10b981';
  if (nm < 400) return '#f59e0b';
  return '#ef4444';
}

export default function MotorPerformanceWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { convertTemp, tempUnit } = useSettings();
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;

  const {
    data, isLoading, error,
    isFetching, isStale, isError,
    dataUpdatedAt, refetch,
  } = useMotorLatest(vid ?? 0);

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
      <WidgetShell {...shellProps}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
        <div className="h-full flex flex-col items-center justify-center gap-1 min-h-[44px]">
          {hasData ? (
            <>
              <span className="text-[10px] uppercase tracking-wider text-white/40">
                {t('widget.motorPerformance.gear', 'Gear')}
              </span>
              <span className="text-lg font-bold text-white/90">{gear}</span>
              <span className="text-[10px] uppercase tracking-wider text-white/40 mt-1">
                {t('widget.motorPerformance.torque', 'Torque')}
              </span>
              <span className="text-sm font-semibold text-white/80">
                {fmtInt(torque)} {t('widget.motorPerformance.nm', 'Nm')}
              </span>
            </>
          ) : (
            <EmptyState
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
          <RadialGauge
            value={Math.abs(torque)}
            max={TORQUE_MAX}
            label={fmtInt(torque)}
            unit={t('widget.motorPerformance.nm', 'Nm')}
            color={gaugeColor}
            size={100}
          />
          <div className="grid grid-cols-2 gap-3 w-full">
            <StatCard
              label={t('widget.motorPerformance.statorTemp', 'Stator Temp')}
              value={statorTemp != null ? fmtNumber(convertTemp(statorTemp), 0) : '—'}
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
        <EmptyState
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.motorPerformance.noData', 'No motor data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
