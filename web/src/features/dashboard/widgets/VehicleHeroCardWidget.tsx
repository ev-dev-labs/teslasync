import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Battery, Gauge, Thermometer } from 'lucide-react';
import { StatusBadge } from '@/components/data-display/StatusBadge';
import { AnimatedNumber } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
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
    if (!state) return 'text-[var(--text-muted)]';
    if (state.battery_level > 50) return 'text-emerald-400';
    if (state.battery_level > 20) return 'text-amber-400';
    return 'text-red-400';
  }, [state]);

  const range = useMemo(
    () => (state ? Math.round(convertDistanceFromSI(state.ideal_range ?? 0, distanceUnit)) : null),
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

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.vehicleHeroCard', 'Vehicle')}
      icon={isCompact ? undefined : <Car className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={loading}
      error={errorMessage}
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
              status={state?.state ?? 'offline'}
            />
          ) : (
            <FullView
              name={vehicle.display_name || vehicle.vin}
              model={vehicle.model}
              trimBadging={vehicle.trim_badging}
              status={state?.state ?? 'offline'}
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
    <div className="h-full flex flex-col items-center justify-center gap-1.5">
      <StatusBadge status={status} size="sm" />
      {batteryLevel != null ? (
        <AnimatedNumber
          value={batteryLevel}
          suffix="%"
          className={`text-xl font-bold ${batteryColor}`}
        />
      ) : (
        <span className="text-xl font-bold text-[var(--text-muted)]">—</span>
      )}
      <span className="text-2xs text-[var(--text-muted)] truncate max-w-full px-1">{name}</span>
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
    <div className="h-full flex flex-col justify-center gap-2">
      {/* Header: name + status badge */}
      <div className="flex items-center gap-2 min-w-0">
        <h3 className="text-sm font-bold text-[var(--text-primary)] truncate">{name}</h3>
        <StatusBadge status={status} size="sm" className="shrink-0" />
      </div>

      {/* Subtitle: model + trim */}
      <p className="text-xs text-[var(--text-muted)] truncate -mt-1">
        {model}{trimBadging ? ` ${trimBadging}` : ''}
      </p>

      {/* Metrics row — collapses to 2 cols on very narrow widget widths */}
      <div className={`grid ${isWide ? 'grid-cols-2 @xs:grid-cols-4' : 'grid-cols-2 @xs:grid-cols-3'} gap-2`}>
        <MetricCell
          icon={<Battery className="h-3 w-3" />}
          label={t('widget.battery', 'Battery')}
          value={batteryLevel != null ? `${batteryLevel}%` : '—'}
          valueColor={batteryColor}
        />
        <MetricCell
          icon={<Gauge className="h-3 w-3 text-neon-cyan" />}
          label={t('widget.range', 'Range')}
          value={range != null ? `${fmtInt(range)} ${distanceUnit}` : '—'}
        />
        <MetricCell
          icon={<Thermometer className="h-3 w-3 text-orange-400" />}
          label={t('widget.cabin', 'Cabin')}
          value={insideTemp != null ? `${insideTemp}${tempUnit}` : '—'}
        />
        {isWide && (
          <MetricCell
            icon={<Thermometer className="h-3 w-3 text-blue-400" />}
            label={t('widget.outside', 'Outside')}
            value={outsideTemp != null ? `${outsideTemp}${tempUnit}` : '—'}
          />
        )}
      </div>

      {/* Charging banner — shown when actively charging */}
      {isCharging && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-neon-green/5 border border-neon-green/10">
          <span aria-hidden="true" className="text-emerald-300 animate-pulse text-xs">⚡</span>
          <span className="text-xs font-medium text-emerald-300">
            {t('widget.charging', 'Charging')}
          </span>
          {chargerPower != null && chargerPower > 0 && (
            <span className="text-xs text-neon-green/70 ml-auto">
              {fmtNumber(chargerPower, 1)} kW
            </span>
          )}
        </div>
      )}

      {/* Extra row when tall — outside temp + additional context */}
      {isTall && !isWide && (
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/[0.06]">
          <MetricCell
            icon={<Thermometer className="h-3 w-3 text-blue-400" />}
            label={t('widget.outside', 'Outside')}
            value={outsideTemp != null ? `${outsideTemp}${tempUnit}` : '—'}
          />
          <MetricCell
            icon={<Gauge className="h-3 w-3 text-neon-cyan" />}
            label={t('widget.idealRange', 'Ideal')}
            value={range != null ? `${fmtInt(range)} ${distanceUnit}` : '—'}
          />
        </div>
      )}
    </div>
  );
}

/* ── Metric cell ── */
function MetricCell({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      <span className="mt-0.5 shrink-0 text-[var(--text-muted)]">{icon}</span>
      <div className="min-w-0">
        <p className="text-2xs text-[var(--text-muted)] truncate">{label}</p>
        <p className={`text-sm font-semibold truncate ${valueColor ?? 'text-[var(--text-primary)]'}`}>
          {value}
        </p>
      </div>
    </div>
  );
}
