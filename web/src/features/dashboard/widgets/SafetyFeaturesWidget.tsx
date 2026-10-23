import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { useSafety } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';
import { cleanSafetyEnum, isSafetyEnumActive, type SafetyEnumField } from '@/lib/safetyEnum';
import { WidgetShell } from './WidgetShell';
import { WidgetDetailCard, type DetailEntry } from './shared';
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
  const enumValue = (value: unknown, field: SafetyEnumField) =>
  {
    const cleaned = cleanSafetyEnum(value, field);
    if (cleaned === '—' || /unknown$/i.test(cleaned)) return '—';
    if (cleaned === 'On') return t('widget.safety.enabled', 'Enabled');
    if (cleaned === 'Off' || cleaned === 'None') return t('widget.safety.disabled', 'Disabled');
    return cleaned;
  };
  return [
    {
      id: 'fcw',
      label: t('widget.safety.fcw', 'Forward collision warning'),
      status: safetyEnumStatus(data.forward_collision_warning, 'forward_collision_warning'),
      statusLabel: enumValue(data.forward_collision_warning, 'forward_collision_warning'),
    },
    {
      id: 'aeb',
      label: t('widget.safety.aeb', 'Auto emergency braking'),
      status: invertedBoolStatus(data.automatic_emergency_braking_off),
      statusLabel: data.automatic_emergency_braking_off == null
        ? '—'
        : data.automatic_emergency_braking_off
          ? t('widget.safety.disabled', 'Disabled')
          : t('widget.safety.enabled', 'Enabled'),
    },
    {
      id: 'lda',
      label: t('widget.safety.ldaShort', 'Lane departure'),
      status: safetyEnumStatus(data.lane_departure_avoidance, 'lane_departure_avoidance'),
      statusLabel: enumValue(data.lane_departure_avoidance, 'lane_departure_avoidance'),
    },
    {
      id: 'bscw',
      label: t('widget.safety.bswShort', 'Blind spot'),
      status: boolStatus(data.blind_spot_collision_warning),
      statusLabel: data.blind_spot_collision_warning == null
        ? '—'
        : data.blind_spot_collision_warning
          ? t('widget.safety.enabled', 'Enabled')
          : t('widget.safety.disabled', 'Disabled'),
    },
    {
      id: 'slw',
      label: t('widget.safety.slw', 'Speed limit warning'),
      status: safetyEnumStatus(data.speed_limit_warning, 'speed_limit_warning'),
      statusLabel: enumValue(data.speed_limit_warning, 'speed_limit_warning'),
    },
  ];
}

export function buildEntries(
  data: SafetySnapshot,
  t: (key: string, defaultValue: string) => string,
): DetailEntry[] {
  return buildCells(data, t).map((cell) => {
    let detailStatus: DetailEntry['status'] = 'neutral';
    if (cell.status === 'ok') detailStatus = 'success';
    else if (cell.status === 'warning' || cell.status === 'error') detailStatus = 'warning';
    return {
      id: cell.id,
      label: cell.label,
      value: cell.statusLabel ?? '—',
      status: detailStatus,
    };
  });
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

  const entries = useMemo<DetailEntry[]>(
    () => (data ? buildEntries(data, t) : []),
    [data, t],
  );

  const handleRefresh = useCallback(() => {
    if (vid > 0) void refetch();
    else void vehicleQuery.refetch();
  }, [refetch, vid, vehicleQuery.refetch]);

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
        <WidgetDetailCard
          entries={entries}
          compact={false}
          emptyMessage={t('widget.safety.noData', 'No safety data')}
          emptyIcon={<ShieldAlert className="h-5 w-5" />}
        />
      ) : (
        <WidgetDetailCard
          entries={[]}
          emptyMessage={t('widget.safety.noData', 'No safety data')}
          emptyIcon={<ShieldAlert className="h-5 w-5" />}
        />
      )}
    </WidgetShell>
  );
}
