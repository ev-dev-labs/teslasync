import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { EmptyState, Skeleton } from '@/components/feedback';
import { useDriveDynamicsLatest, useMotorLatest, useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertTempFromSI } from '@/lib/unitConversion';

const LIVE_REFRESH_MS = 5_000;

export function torqueColor(nm: number): string {
  if (Math.abs(nm) < 200) return '#10b981';
  if (Math.abs(nm) < 400) return '#f59e0b';
  return '#ef4444';
}

export default function MotorPerformanceWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
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

  const torque = knownNumber(data?.di_torque);
  const statorTemp = knownNumber(data?.di_stator_temp ?? data?.motor_temp_c_front);
  const gear = data?.gear ?? data?.shift_state ?? null;
  const dynamics = useDriveDynamicsLatest(vid ?? 0, LIVE_REFRESH_MS);
  const dynamicsData = dynamics.data;
  const lateralG = knownNumber(dynamicsData?.lateral_acceleration);
  const longitudinalG = knownNumber(dynamicsData?.longitudinal_acceleration);
  const isCompact = size.cols <= 1;

  const shellProps = {
    loading: isLoading,
    error: trust.fatalError ? String(error) : null,
    dataState: trust,
    loadingContent: <Skeleton className="h-24 w-full" />,
    updatedAt: dataUpdatedAt ?? 0,
    refreshIntervalMs: LIVE_REFRESH_MS,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell title={t('widget.motorPerformance.title', 'Motor performance')} {...shellProps}>
        <div className="flex h-full min-h-[44px] flex-col justify-center">
          <WidgetBigNumber
            value={torque != null ? fmtNumber(torque, 0) : null}
            unit={torque != null ? t('widget.motorPerformance.nm', 'Nm') : undefined}
            label={t('widget.motorPerformance.torque', 'Torque')}
            animated={false}
          />
          {!data && <p className="text-xs text-[var(--text-muted)]">{t('widget.motorPerformance.noData', 'No motor data')}</p>}
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.motorPerformance.title', 'Motor performance')}
      icon={<Gauge className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      {...shellProps}
    >
      {data ? (
        <div className="flex min-w-0 flex-col gap-3">
          <WidgetBigNumber
            value={torque != null ? fmtNumber(torque, 0) : null}
            unit={torque != null ? t('widget.motorPerformance.nm', 'Nm') : undefined}
            label={t('widget.motorPerformance.torque', 'Torque')}
            animated={false}
          />
          <WidgetStatGrid
            stats={[
              {
                label: t('widget.motorPerformance.statorTemp', 'Stator temp'),
                value: statorTemp != null ? fmtNumber(toTemperatureDisplay(statorTemp), 0) : null,
                unit: statorTemp != null ? tempUnit : undefined,
              },
              {
                label: t('widget.motorPerformance.gearState', 'Gear state'),
                value: gear != null && String(gear).trim() ? String(gear) : null,
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
            ]}
            compact={size.cols <= 2}
            cols={2}
          />
        </div>
      ) : (
        <EmptyState
          variant="informational"
          icon={<Gauge className="h-5 w-5" />}
          message={t('widget.motorPerformance.noData', 'No motor data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
