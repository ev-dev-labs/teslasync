import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudSun, Sun, CloudSnow, Thermometer } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { isFiniteNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertTempFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { safeArray } from '@/lib/safeArray';
import { WidgetBigNumber } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';

/** Coarse weather condition derived from the outside temperature (°C, SI). */
export type WeatherCondition = 'freezing' | 'warm' | 'mild';

/**
 * Classify the outside temperature (°C, SI) into the condition that drives the
 * widget's decorative icon. Non-finite input (NaN / ±Infinity) coalesces to
 * `'mild'` so a malformed reading never throws or picks a misleading extreme.
 */
export function weatherConditionFor(tempC: number): WeatherCondition {
  if (!isFiniteNumber(tempC)) return 'mild';
  if (tempC <= 0) return 'freezing';
  if (tempC >= 25) return 'warm';
  return 'mild';
}

/** Decorative icon picked from the outside temperature (°C). */
function WeatherIcon({ tempC, className }: { tempC: number; className?: string }) {
  const condition = weatherConditionFor(tempC);
  const Icon = condition === 'freezing' ? CloudSnow : condition === 'warm' ? Sun : CloudSun;
  return <Icon aria-hidden className={className} />;
}

export default function WeatherAtCarWidget({ vehicleId, size }: WidgetProps) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const candidate = vehicleId ?? safeArray(vehiclesQuery.data)[0]?.id;
  const id = Number.isSafeInteger(candidate) && Number(candidate) > 0 ? Number(candidate) : 0;
  const query = useVehicleState(id, { refetchInterval: 30_000 });
  const {
    data: stateData,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, tempUnit);

  const state = stateData?.state;
  // Treat a non-finite reading (missing, NaN, ±Infinity) as "no data" so a
  // malformed payload never renders as a misleading "0°" temperature.
  const rawOutsideTemp = state?.outside_temp;
  const outsideTemp = isFiniteNumber(rawOutsideTemp) ? rawOutsideTemp : null;
  const hasTemp = outsideTemp !== null;
  const discoveryState = useDataState(vehiclesQuery);
  const sourceState = useDataState({
    ...query,
    data: stateData ?? (!id || (!isLoading && !query.isPending && !isError) ? null : undefined),
  }, { provenance: 'live', unavailable: !hasTemp });
  const dataState = !id && vehicleId == null && discoveryState.status !== 'ok'
    ? discoveryState : sourceState;

  const lat = state?.latitude;
  const lon = state?.longitude;

  const isCompact = size.cols === 1 && size.rows === 1;

  const handleRefresh = useCallback(() => {
    if (vehicleId == null) void vehiclesQuery.refetch?.();
    if (id) void refetch();
  }, [refetch, vehicleId, id, vehiclesQuery]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.weatherAtCar', 'Weather at car')}
      icon={!isCompact ? <CloudSun className="h-3.5 w-3.5 text-[var(--text-secondary)]" /> : undefined}
      dataState={{ ...dataState, retry: handleRefresh }}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {outsideTemp !== null ? (
        isCompact ? (
          <div className="h-full flex flex-col items-center justify-center gap-1">
            <WeatherIcon tempC={outsideTemp} className="h-6 w-6 text-[var(--text-secondary)]" />
            <WidgetBigNumber value={`${fmtInt(toTemperatureDisplay(outsideTemp))}${tempUnit}`} align="center" />
          </div>
        ) : (
          <div className="h-full flex flex-wrap items-center gap-4 py-2">
            <WeatherIcon tempC={outsideTemp} className="h-10 w-10 text-[var(--text-secondary)] flex-shrink-0" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <WidgetBigNumber value={`${fmtInt(toTemperatureDisplay(outsideTemp))}${tempUnit}`} label={t('widget.outsideTemp', 'Outside temperature')} />
              {isFiniteNumber(lat) && isFiniteNumber(lon) && (
                <span className={dashboardTokens.metricLabel}>
                  {fmtNumber(lat)}°, {fmtNumber(lon)}°
                </span>
              )}
            </div>
          </div>
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Thermometer className="h-5 w-5" />}
          message={t('widget.noWeather', 'No weather data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
