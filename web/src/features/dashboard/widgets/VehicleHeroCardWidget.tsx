import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Battery, Gauge, Thermometer } from 'lucide-react';
import { StatusBadge } from '@/components/data-display';
import { Badge, Text } from '@/components/ui';
import { deriveDataState } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import type { WidgetProps } from './types';

export default function VehicleHeroCardWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading, isError: vehiclesError } = useVehicles();
  const vehicle = vehicleId
    ? vehicles?.find((v) => v.id === vehicleId) ?? vehicles?.[0]
    : vehicles?.[0];

  const id = vehicle?.id ?? 0;
  const {
    data: stateData,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehicleState(id);
  const state = stateData?.state;
  /* SI-floor: state.ideal_range in METERS, state.{inside,outside}_temp in °C. */
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const tempUnit = unitPrefs.temperature;

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;

  const batteryColor = useMemo(() => {
    if (state?.battery_level == null) return 'text-[var(--text-muted)]';
    if (state.battery_level > 50) return 'text-emerald-400 [&_.tabular-nums]:text-emerald-400';
    if (state.battery_level > 20) return 'text-amber-400 [&_.tabular-nums]:text-amber-400';
    return 'text-red-400 [&_.tabular-nums]:text-red-400';
  }, [state]);

  const range = useMemo(
    () => (state?.ideal_range != null ? Math.round(convertDistanceFromSI(state.ideal_range, distanceUnit)) : null),
    [state, distanceUnit],
  );

  const insideTemp = useMemo(
    () => (state?.inside_temp != null ? Math.round(convertTempFromSI(state.inside_temp, tempUnit)) : null),
    [state, tempUnit],
  );

  const outsideTemp = useMemo(
    () => (state?.outside_temp != null ? Math.round(convertTempFromSI(state.outside_temp, tempUnit)) : null),
    [state, tempUnit],
  );

  // Loading spans two async sources. Before any vehicle is known the state
  // query runs with id 0 (disabled) and therefore reports `isLoading: false`,
  // which used to flash the "No vehicle data" empty state on first paint while
  // the fleet list was still in flight. Guard on the fleet load until a vehicle
  // resolves so the shell shows its skeleton instead.
  const loading = isLoading || (vehiclesLoading && !vehicle);

  // Surface failures as a real error panel (with the shell's built-in chrome)
  // rather than a misleading empty/stale tile: a fleet-load failure with no
  // vehicle to fall back on, or — mirroring the sibling range/motor tiles — a
  // state-query failure for the resolved vehicle.
  const errorMessage = error
    ? String(error)
    : vehiclesError && !vehicle
      ? t('widget.loadError', 'Failed to load vehicle')
      : null;
  const dataState = deriveDataState({
    data: loading && !state || errorMessage && !state ? undefined : vehicle ? { vehicle, state } : null,
    isLoading: loading,
    error: errorMessage,
    isError: isError || (vehiclesError && !vehicle),
    isFetching,
    dataUpdatedAt,
    refetch,
  });

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.vehicleHeroCard', 'Vehicle')}
      icon={isCompact ? undefined : <Car className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={loading}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {vehicle ? (
        <FadeIn>
          {isCompact ? (
            <CompactView
              name={vehicle.display_name || vehicle.vin}
              batteryLevel={state?.battery_level ?? null}
              batteryColor={batteryColor}
              status={state?.state ?? 'unknown'}
            />
          ) : (
            <FullView
              name={vehicle.display_name || vehicle.vin}
              model={vehicle.model}
              trimBadging={vehicle.trim_badging}
              status={state?.state ?? 'unknown'}
              batteryLevel={state?.battery_level ?? null}
              batteryColor={batteryColor}
              range={range}
              distanceUnit={distanceUnit}
              insideTemp={insideTemp}
              outsideTemp={outsideTemp}
              tempUnit={tempUnit}
              isCharging={state?.is_charging ?? false}
              chargerPower={state?.charger_power ?? null}
              isWide={isWide}
              isTall={isTall}
              t={t}
            />
          )}
        </FadeIn>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Car className="h-5 w-5" />}
          message={t('widget.noVehicle', 'No vehicle data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}

/* ── Compact: 1×1 ── */
function CompactView({
  name,
  batteryLevel,
  batteryColor,
  status,
}: {
  name: string;
  batteryLevel: number | null;
  batteryColor: string;
  status: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <StatusBadge status={status} size="sm" />
      <WidgetBigNumber value={batteryLevel != null ? `${batteryLevel}%` : null} valueColor={batteryColor} />
      <Text variant="bodySm" className="break-words">{name}</Text>
    </div>
  );
}

/* ── Full: 2×1+ ── */
interface FullViewProps {
  name: string;
  model: string;
  trimBadging: string;
  status: string;
  batteryLevel: number | null;
  batteryColor: string;
  range: number | null;
  distanceUnit: string;
  insideTemp: number | null;
  outsideTemp: number | null;
  tempUnit: string;
  isCharging: boolean;
  chargerPower: number | null;
  isWide: boolean;
  isTall: boolean;
  t: (k: string, f: string) => string;
}

function FullView({
  name, model, trimBadging, status,
  batteryLevel, batteryColor,
  range, distanceUnit,
  insideTemp, outsideTemp, tempUnit,
  isCharging, chargerPower,
  isWide, isTall, t,
}: FullViewProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Header: name + status badge */}
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <Text weight="semibold" className="min-w-0 break-words">{name}</Text>
        <StatusBadge status={status} size="sm" className="shrink-0" />
      </div>

      {/* Subtitle: model + trim */}
      <Text variant="bodySm" className="break-words">
        {model}{trimBadging ? ` ${trimBadging}` : ''}
      </Text>

      {/* Metrics row — collapses to 2 cols on very narrow widget widths */}
      <WidgetStatGrid cols={isWide ? 4 : 3} stats={[
        { icon: <Battery className="size-4" />, label: t('widget.battery', 'Battery'), value: batteryLevel != null ? `${batteryLevel}%` : '—', valueColor: batteryColor },
        { icon: <Gauge className="size-4" />, label: t('widget.range', 'Range'), value: range != null ? `${fmtInt(range)} ${distanceUnit}` : '—' },
        { icon: <Thermometer className="size-4" />, label: t('widget.cabin', 'Cabin'), value: insideTemp != null ? `${insideTemp}${tempUnit}` : '—' },
        ...(isWide || isTall ? [{
          icon: <Thermometer className="size-4" />,
          label: t('widget.outside', 'Outside'),
          value: outsideTemp != null ? `${outsideTemp}${tempUnit}` : '—',
        }] : []),
      ]} />

      {/* Charging banner — shown when actively charging */}
      {isCharging && (
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className="text-emerald-300">⚡</span>
          <Badge variant="success" size="sm">
            {t('widget.charging', 'Charging')}
          </Badge>
          {chargerPower != null && chargerPower > 0 && (
            <Text variant="bodySm" className="ml-auto">
              {fmtNumber(chargerPower, 1)} kW
            </Text>
          )}
        </div>
      )}

    </div>
  );
}
