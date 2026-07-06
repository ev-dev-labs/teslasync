import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useSafety } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtInt } from '@/lib/numberFormat';
import { cleanSafetyEnum, isSafetyEnumActive, type SafetyEnumField } from '@/lib/safetyEnum';
import { WidgetShell } from './WidgetShell';
import { WidgetStatusGrid } from './shared';
import type { StatusCell } from './shared';
import type { WidgetProps } from './types';
import type { SafetySnapshot } from '@/types/vehicle-systems';

export function boolStatus(val: boolean | null | undefined): StatusCell['status'] {
  if (val == null) return 'unknown';
  return val ? 'ok' : 'inactive';
}

export function invertedBoolStatus(val: boolean | null | undefined): StatusCell['status'] {
  if (val == null) return 'unknown';
  // Field is "off" flag — true means feature is disabled
  return val ? 'inactive' : 'ok';
}

/** Maps a safety enum value to a StatusCell.status.
 *  Accepts unknown so a stray boolean/number from the backend never
 *  crashes .toLowerCase(). See lib/safetyEnum.ts for the contract. */
export function safetyEnumStatus(val: unknown, field: SafetyEnumField): StatusCell['status'] {
  if (val == null) return 'unknown';
  return isSafetyEnumActive(val, field) ? 'ok' : 'inactive';
}

export function buildCells(
  data: SafetySnapshot,
  t: (key: string, defaultValue: string) => string,
): StatusCell[] {
  return [
    {
      id: 'fcw',
      label: t('widget.safety.fcw', 'Forward Collision Warning'),
      status: safetyEnumStatus(data.forward_collision_warning, 'forward_collision_warning'),
      value: cleanSafetyEnum(data.forward_collision_warning, 'forward_collision_warning'),
    },
    {
      id: 'aeb',
      label: t('widget.safety.aeb', 'Auto Emergency Braking'),
      status: invertedBoolStatus(data.automatic_emergency_braking_off),
      value: data.automatic_emergency_braking_off == null
        ? '—'
        : data.automatic_emergency_braking_off
          ? t('widget.safety.disabled', 'Disabled')
          : t('widget.safety.enabled', 'Enabled'),
    },
    {
      id: 'lda',
      label: t('widget.safety.lda', 'Lane Departure Avoidance'),
      status: safetyEnumStatus(data.lane_departure_avoidance, 'lane_departure_avoidance'),
      value: cleanSafetyEnum(data.lane_departure_avoidance, 'lane_departure_avoidance'),
    },
    {
      id: 'elda',
      label: t('widget.safety.elda', 'Emergency Lane Departure'),
      status: boolStatus(data.emergency_lane_departure_avoidance),
      value: data.emergency_lane_departure_avoidance == null
        ? '—'
        : data.emergency_lane_departure_avoidance
          ? t('widget.safety.enabled', 'Enabled')
          : t('widget.safety.disabled', 'Disabled'),
    },
    {
      id: 'bsc',
      label: t('widget.safety.bsc', 'Blind Spot Camera'),
      status: boolStatus(data.automatic_blind_spot_camera),
      value: data.automatic_blind_spot_camera == null
        ? '—'
        : data.automatic_blind_spot_camera
          ? t('widget.safety.enabled', 'Enabled')
          : t('widget.safety.disabled', 'Disabled'),
    },
    {
      id: 'bscw',
      label: t('widget.safety.bscw', 'Blind Spot Collision Warning'),
      status: boolStatus(data.blind_spot_collision_warning),
      value: data.blind_spot_collision_warning == null
        ? '—'
        : data.blind_spot_collision_warning
          ? t('widget.safety.enabled', 'Enabled')
          : t('widget.safety.disabled', 'Disabled'),
    },
    {
      id: 'slw',
      label: t('widget.safety.slw', 'Speed Limit Warning'),
      status: safetyEnumStatus(data.speed_limit_warning, 'speed_limit_warning'),
      value: cleanSafetyEnum(data.speed_limit_warning, 'speed_limit_warning'),
    },
    {
      id: 'cfd',
      label: t('widget.safety.cfd', 'Cruise Follow Distance'),
      status: safetyEnumStatus(data.cruise_follow_distance, 'cruise_follow_distance'),
      value: cleanSafetyEnum(data.cruise_follow_distance, 'cruise_follow_distance'),
    },
  ];
}

export default function SafetyFeaturesWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data, isLoading, error,
    isFetching, isStale, isError,
    dataUpdatedAt, refetch,
  } = useSafety(vid > 0 ? String(vid) : '');

  const isCompact = size.cols <= 1;

  const cells = useMemo<StatusCell[]>(
    () => (data ? buildCells(data, t) : []),
    [data, t],
  );

  const activeCount = useMemo(
    () => cells.filter((c) => c.status === 'ok').length,
    [cells],
  );

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.safety.title', 'Safety Features')}
      icon={<ShieldAlert className="h-3.5 w-3.5 text-neon-green" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {data ? (
        isCompact ? (
          <div className="flex flex-col items-center justify-center h-full gap-1">
            <span className="text-3xl font-bold text-emerald-300">
              {fmtInt(activeCount)}
            </span>
            <span className="text-xs text-[var(--text-secondary)]">
              {t('widget.safety.activeFeatures', 'Active Features')}
            </span>
          </div>
        ) : (
          <WidgetStatusGrid
            cells={cells}
            cols={size.cols >= 3 ? 4 : 2}
            compact={false}
            emptyMessage={t('widget.safety.noData', 'No safety data')}
            emptyIcon={<ShieldAlert className="h-5 w-5" />}
          />
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<ShieldAlert className="h-5 w-5" />}
          message={t('widget.safety.noData', 'No safety data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
