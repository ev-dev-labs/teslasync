import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Battery, Gauge, Thermometer } from 'lucide-react';
import { MetricBar, StatusBadge } from '@/components/data-display';
import { Badge, Text } from '@/components/ui';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useVehicles, useVehicleState, useSecurityLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertPowerFromSI, convertTempFromSI } from '@/lib/unitConversion';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import VehicleStudio from './vehicle-instruments/VehicleStudio';
import { useVerifiedDriving } from './vehicle-instruments/useVerifiedDriving';
import { useVerifiedStudioLights } from './vehicle-instruments/useVerifiedStudioLights';
import { cn } from '@/lib/cn';
import { observedVehicleReadings } from '../lib/observedVehicleReadings';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';

export default function VehicleHeroCardWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { fmtNumber } = useNumberFormatting();
  const packId = usePackPresentation();
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
  const state = observedVehicleReadings(stateData?.state, stateData?.verifiedFields);
  const driving = useVerifiedDriving(stateData, isError);
  const securityQuery = useSecurityLatest(driving ? id : 0);
  const lightsOn = useVerifiedStudioLights(id, securityQuery);
  /* SI-floor: ideal_range in meters, temperatures in °C, charger_power in watts. */
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const tempUnit = unitPrefs.temperature;
  const powerUnit = unitPrefs.power;
  const observedBattery = knownNumber(state?.battery_level);
  const batteryLevel = observedBattery != null && observedBattery >= 0 && observedBattery <= 100
    ? observedBattery : null;

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;

  const batteryColor = useMemo(() => {
    if (batteryLevel == null) return 'text-[var(--text-muted)]';
    if (batteryLevel > 50) return 'text-emerald-400 [&_.tabular-nums]:text-emerald-400';
    if (batteryLevel > 20) return 'text-amber-400 [&_.tabular-nums]:text-amber-400';
    return 'text-red-400 [&_.tabular-nums]:text-red-400';
  }, [batteryLevel]);

  const range = useMemo(() => {
    const reading = knownNumber(state?.ideal_range);
    return reading != null && reading >= 0 ? convertDistanceFromSI(reading, distanceUnit) : null;
  }, [state, distanceUnit]);

  const insideTemp = useMemo(() => {
    const reading = knownNumber(state?.inside_temp);
    return reading != null ? convertTempFromSI(reading, tempUnit) : null;
  }, [state, tempUnit]);

  const outsideTemp = useMemo(() => {
    const reading = knownNumber(state?.outside_temp);
    return reading != null ? convertTempFromSI(reading, tempUnit) : null;
  }, [state, tempUnit]);
  const chargerPower = useMemo(() => {
    const reading = knownNumber(state?.charger_power);
    return reading != null && reading >= 0 ? convertPowerFromSI(reading, powerUnit) : null;
  }, [state, powerUnit]);

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
  const fullViewProps: FullViewProps = {
    name: vehicle?.display_name || vehicle?.vin || '—',
    model: vehicle?.model ?? '',
    trimBadging: vehicle?.trim_badging ?? '',
    status: state?.state ?? 'unknown',
    batteryLevel,
    batteryColor,
    range,
    distanceUnit,
    insideTemp,
    outsideTemp,
    tempUnit,
    isCharging: state?.is_charging === true,
    chargerPower,
    powerUnit,
    isWide,
    isTall,
    dense: true,
    t,
  };
  const artwork = vehicle
    ? <VehicleStudio vehicle={vehicle} driving={driving} lightsOn={lightsOn} compact size="sm" />
    : null;
  const empty = <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
    icon={<Car className="h-5 w-5" />}
    message={t('widget.noVehicle', 'No vehicle data')}
    className="py-4"
  />;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.vehicleHeroCard', 'Vehicle')}
      icon={isCompact ? undefined : <Car className="h-3.5 w-3.5 text-[var(--semantic-info)]" />}
      loading={loading}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => {
        void refetch();
        if (driving) void securityQuery.refetch();
      }}
    >
      <InstrumentPresentation
        family="vehicle"
        compact={isCompact}
        icon={vehicle ? <Car className="size-6" aria-hidden="true" /> : undefined}
        context={vehicle ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Text weight="semibold" className="min-w-0 break-words">{fullViewProps.name}</Text>
            <StatusBadge status={fullViewProps.status} size="sm" className="shrink-0" />
            {!isCompact && <Text variant="caption" className="break-words">
              {fullViewProps.model}{fullViewProps.trimBadging ? ` ${fullViewProps.trimBadging}` : ''}
            </Text>}
          </div>
        ) : undefined}
        headline={vehicle ? <WidgetBigNumber
          value={batteryLevel != null ? `${fmtNumber(batteryLevel)}%` : null}
          label={t('widget.battery', 'Battery')}
          valueColor={batteryColor}
          animated={false}
        /> : undefined}
        instrument={vehicle ? (
          <div className="min-w-0 space-y-3" data-vehicle-card-layout="pack">
            {artwork}
            <MetricBar
              value={batteryLevel}
              max={100}
              ariaLabel={t('widget.battery', 'Battery')}
              color="var(--theme-primary)"
              fill={packId === 'v7' ? 'segmented' : 'solid'}
              size={packId === 'v3' ? 'slim' : 'default'}
              showHeader={false}
            />
          </div>
        ) : empty}
        details={vehicle && !isCompact
          ? <FullView {...fullViewProps} showIdentity={false} showBattery={false} />
          : undefined}
      >
        {vehicle ? (
          <FadeIn className="grid grid-cols-[minmax(72px,0.28fr)_minmax(0,1fr)] items-center gap-3">
            {artwork}
            <div className="min-w-0" data-vehicle-card-layout="short">
              {isCompact ? (
                <CompactView
                  name={vehicle.display_name || vehicle.vin}
                  batteryLevel={batteryLevel}
                  batteryColor={batteryColor}
                  status={state?.state ?? 'unknown'}
                />
              ) : (
                <FullView {...fullViewProps} />
              )}
            </div>
          </FadeIn>
        ) : (
          empty
        )}
      </InstrumentPresentation>
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
  const { fmtNumber } = useNumberFormatting();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <StatusBadge status={status} size="sm" />
      <WidgetBigNumber value={batteryLevel != null ? `${fmtNumber(batteryLevel)}%` : null} valueColor={batteryColor} />
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
  powerUnit: string;
  isWide: boolean;
  isTall: boolean;
  dense: boolean;
  showIdentity?: boolean;
  showBattery?: boolean;
  t: (k: string, f: string) => string;
}

function FullView({
  name, model, trimBadging, status,
  batteryLevel, batteryColor,
  range, distanceUnit,
  insideTemp, outsideTemp, tempUnit,
  isCharging, chargerPower, powerUnit,
  isWide, isTall, dense, showIdentity = true, showBattery = true, t,
}: FullViewProps) {
  const { fmtNumber } = useNumberFormatting();
  const stats = [
    ...(showBattery ? [{ icon: <Battery className="size-4" />, label: t('widget.battery', 'Battery'), value: batteryLevel != null ? `${fmtNumber(batteryLevel)}%` : '—', valueColor: batteryColor }] : []),
    { icon: <Gauge className="size-4" />, label: t('widget.range', 'Range'), value: range != null ? `${fmtNumber(range)} ${distanceUnit}` : '—' },
    { icon: <Thermometer className="size-4" />, label: t('widget.cabin', 'Cabin'), value: insideTemp != null ? `${fmtNumber(insideTemp)}${tempUnit}` : '—' },
    ...(isWide || isTall ? [{
      icon: <Thermometer className="size-4" />,
      label: t('widget.outside', 'Outside'),
      value: outsideTemp != null ? `${fmtNumber(outsideTemp)}${tempUnit}` : '—',
    }] : []),
  ];
  return (
    <div className={cn('flex min-w-0 flex-col', dense ? 'gap-1' : 'gap-3')}>
      {/* Header: name + status badge */}
      {showIdentity && <div className="flex flex-wrap items-center gap-2 min-w-0">
        <Text weight="semibold" className="min-w-0 break-words">{name}</Text>
        <StatusBadge status={status} size="sm" className="shrink-0" />
        {dense && <Text variant="caption" className="break-words">{model}{trimBadging ? ` ${trimBadging}` : ''}</Text>}
      </div>}

      {/* Subtitle: model + trim */}
      {showIdentity && !dense && <Text variant="bodySm" className="break-words">
        {model}{trimBadging ? ` ${trimBadging}` : ''}
      </Text>}

      {/* Metrics row — collapses to 2 cols on very narrow widget widths */}
      {dense ? <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {stats.map(stat => <div key={stat.label} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-1">
          <Text variant="caption">{stat.label}</Text>
          <Text variant="bodySm" weight="semibold" className={cn('tabular-nums', 'valueColor' in stat && stat.valueColor)}>{stat.value}</Text>
        </div>)}
      </div> : <WidgetStatGrid cols={isWide ? 4 : 3} stats={stats} />}

      {/* Charging banner — shown when actively charging */}
      {isCharging && (
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className="text-emerald-300">⚡</span>
          <Badge variant="success" size="sm">
            {t('widget.charging', 'Charging')}
          </Badge>
          {chargerPower != null && chargerPower > 0 && (
            <Text variant="bodySm" className="ml-auto">
              {fmtNumber(chargerPower)} {powerUnit}
            </Text>
          )}
        </div>
      )}

    </div>
  );
}
