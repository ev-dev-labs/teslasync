import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Battery, Gauge, Thermometer } from 'lucide-react';
import { StatusBadge } from '@/components/data-display/StatusBadge';
import { AnimatedNumber } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function VehicleHeroCardWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vehicle = vehicleId
    ? vehicles?.find((v) => v.id === vehicleId) ?? vehicles?.[0]
    : vehicles?.[0];

  const id = vehicle?.id ?? 0;
  const { data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id);
  const state = stateData?.state;
  const { convertDistance, convertTemp, distanceUnit, tempUnit } = useSettings();

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;

  const batteryColor = useMemo(() => {
    if (!state) return 'text-white/40';
    if (state.battery_level > 50) return 'text-emerald-400';
    if (state.battery_level > 20) return 'text-amber-400';
    return 'text-red-400';
  }, [state]);

  const range = useMemo(
    () => (state ? Math.round(convertDistance(state.ideal_range)) : null),
    [state, convertDistance],
  );

  const insideTemp = useMemo(
    () => (state?.inside_temp != null ? Math.round(convertTemp(state.inside_temp)) : null),
    [state, convertTemp],
  );

  const outsideTemp = useMemo(
    () => (state?.outside_temp != null ? Math.round(convertTemp(state.outside_temp)) : null),
    [state, convertTemp],
  );

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.vehicleHeroCard', 'Vehicle')}
      icon={isCompact ? undefined : <Car className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
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
              status={vehicle.state}
            />
          ) : (
            <FullView
              name={vehicle.display_name || vehicle.vin}
              model={vehicle.model}
              trimBadging={vehicle.trim_badging}
              status={vehicle.state}
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
        <EmptyState
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
        <span className="text-xl font-bold text-white/30">—</span>
      )}
      <span className="text-[10px] text-white/40 truncate max-w-full px-1">{name}</span>
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
        <h3 className="text-sm font-bold text-white/90 truncate">{name}</h3>
        <StatusBadge status={status} size="sm" className="shrink-0" />
      </div>

      {/* Subtitle: model + trim */}
      <p className="text-[11px] text-white/40 truncate -mt-1">
        {model}{trimBadging ? ` ${trimBadging}` : ''}
      </p>

      {/* Metrics row */}
      <div className={`grid ${isWide ? 'grid-cols-4' : 'grid-cols-3'} gap-2`}>
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
          <span className="text-neon-green animate-pulse text-xs">⚡</span>
          <span className="text-xs font-medium text-neon-green">
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
      <span className="mt-0.5 shrink-0 text-white/40">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-white/40 truncate">{label}</p>
        <p className={`text-sm font-semibold truncate ${valueColor ?? 'text-white/90'}`}>
          {value}
        </p>
      </div>
    </div>
  );
}
