import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useSafety } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';
import { cleanSafetyEnum, isSafetyEnumActive, type SafetyEnumField } from '@/lib/safetyEnum';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatusGrid } from './shared';
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
  const cleaned = cleanSafetyEnum(val, field);
  if (cleaned === '—' || /unknown$/i.test(cleaned)) return 'unknown';
  return isSafetyEnumActive(val, field) ? 'ok' : 'inactive';
}

export function buildCells(
  data: SafetySnapshot,
  t: (key: string, defaultValue: string) => string,
): StatusCell[] {
  return [
    {
      id: 'fcw',
      label: t('widget.safety.fcw', 'Forward collision warning'),
      status: safetyEnumStatus(data.forward_collision_warning, 'forward_collision_warning'),
      value: cleanSafetyEnum(data.forward_collision_warning, 'forward_collision_warning'),
    },
    {
      id: 'aeb',
      label: t('widget.safety.aeb', 'Auto emergency braking'),
      status: invertedBoolStatus(data.automatic_emergency_braking_off),
      value: data.automatic_emergency_braking_off == null
        ? '—'
        : data.automatic_emergency_braking_off
          ? t('widget.safety.disabled', 'Disabled')
          : t('widget.safety.enabled', 'Enabled'),
    },
    {
      id: 'lda',
      label: t('widget.safety.lda', 'Lane departure avoidance'),
      status: safetyEnumStatus(data.lane_departure_avoidance, 'lane_departure_avoidance'),
      value: cleanSafetyEnum(data.lane_departure_avoidance, 'lane_departure_avoidance'),
    },
    {
      id: 'elda',
      label: t('widget.safety.elda', 'Emergency lane departure'),
      status: boolStatus(data.emergency_lane_departure_avoidance),
      value: data.emergency_lane_departure_avoidance == null
        ? '—'
        : data.emergency_lane_departure_avoidance
          ? t('widget.safety.enabled', 'Enabled')
          : t('widget.safety.disabled', 'Disabled'),
    },
    {
      id: 'bsc',
      label: t('widget.safety.bsc', 'Blind spot camera'),
      status: boolStatus(data.automatic_blind_spot_camera),
      value: data.automatic_blind_spot_camera == null
        ? '—'
        : data.automatic_blind_spot_camera
          ? t('widget.safety.enabled', 'Enabled')
          : t('widget.safety.disabled', 'Disabled'),
    },
    {
      id: 'bscw',
      label: t('widget.safety.bscw', 'Blind spot collision warning'),
      status: boolStatus(data.blind_spot_collision_warning),
      value: data.blind_spot_collision_warning == null
        ? '—'
        : data.blind_spot_collision_warning
          ? t('widget.safety.enabled', 'Enabled')
          : t('widget.safety.disabled', 'Disabled'),
    },
    {
      id: 'slw',
      label: t('widget.safety.slw', 'Speed limit warning'),
      status: safetyEnumStatus(data.speed_limit_warning, 'speed_limit_warning'),
      value: cleanSafetyEnum(data.speed_limit_warning, 'speed_limit_warning'),
    },
    {
      id: 'cfd',
      label: t('widget.safety.cfd', 'Cruise follow distance'),
      status: safetyEnumStatus(data.cruise_follow_distance, 'cruise_follow_distance'),
      value: cleanSafetyEnum(data.cruise_follow_distance, 'cruise_follow_distance'),
    },
  ];
}

export default function SafetyFeaturesWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehicleQuery = useVehicles();
  const { data: vehicles } = vehicleQuery;
  const vehicleState = useDataState(vehicleQuery);
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const query = useSafety(vid > 0 ? String(vid) : '');
  const {
    data, isLoading,
    isFetching, isStale, isError,
    dataUpdatedAt, refetch,
  } = query;
  const state = useDataState(query, { provenance: 'live' });
  const displayState = vid === 0 && (vehicleState.fatalError || vehicleQuery.isLoading) ? vehicleState : state;

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
      title={t('widget.safety.title', 'Safety features')}
      icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}
      loading={isLoading}
      dataState={{ ...displayState, status: displayState.status === 'initial' && !isLoading && !vehicleQuery.isLoading ? 'unavailable' : displayState.status }}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {data ? (
        isCompact ? (
          <WidgetBigNumber
            value={cells.some((cell) => cell.status !== 'unknown') ? activeCount : null}
            label={t('widget.safety.activeFeatures', 'Active features')}
            subtitle={cells.some((cell) => cell.status === 'unknown')
              ? t('widget.safety.partialReadings', 'Some feature states are unknown')
              : undefined}
            animated={false}
          />
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
