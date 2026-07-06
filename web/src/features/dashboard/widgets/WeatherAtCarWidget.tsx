import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudSun, Sun, CloudSnow, Thermometer } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt, isFiniteNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertTempFromSI } from '@/lib/unitConversion';

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
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: stateData,
    isLoading,
    isFetching,
    isStale,
    isError,
    error,
    dataUpdatedAt,
    refetch,
  } = useVehicleState(id, { refetchInterval: 30_000 });
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, tempUnit);

  const state = stateData?.state;
  // Treat a non-finite reading (missing, NaN, ±Infinity) as "no data" so a
  // malformed payload never renders as a misleading "0°" temperature.
  const rawOutsideTemp = state?.outside_temp;
  const outsideTemp = isFiniteNumber(rawOutsideTemp) ? rawOutsideTemp : null;
  const hasTemp = outsideTemp !== null;

  const lat = state?.latitude;
  const lon = state?.longitude;

  const isCompact = size.cols === 1 && size.rows === 1;

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.weatherAtCar', 'Weather at Car')}
      icon={!isCompact ? <CloudSun className="h-3.5 w-3.5 text-cyan-300" /> : undefined}
      loading={isLoading}
      // Surface a genuine initial-load failure (no usable reading yet) as a real
      // error panel instead of the misleading "No weather data" empty state.
      // When a reading is already on screen, a background-refetch error stays a
      // subtle freshness signal so valid data is never blanked out.
      error={isError && !hasTemp ? String(error ?? t('widget.weatherError', 'Unable to load weather data')) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {outsideTemp !== null ? (
        isCompact ? (
          <div className="h-full flex flex-col items-center justify-center gap-1">
            <WeatherIcon tempC={outsideTemp} className="h-6 w-6 text-neon-cyan" />
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {fmtInt(toTemperatureDisplay(outsideTemp))}{tempUnit}
            </span>
          </div>
        ) : (
          <div className="h-full flex items-center gap-4 py-2">
            <WeatherIcon tempC={outsideTemp} className="h-10 w-10 text-neon-cyan flex-shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="text-3xl font-bold text-[var(--text-primary)]">
                {fmtInt(toTemperatureDisplay(outsideTemp))}{tempUnit}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {t('widget.outsideTemp', 'Outside Temperature')}
              </span>
              {isFiniteNumber(lat) && isFiniteNumber(lon) && (
                <span className="text-2xs text-[var(--text-muted)] tabular-nums">
                  {lat.toFixed(2)}°, {lon.toFixed(2)}°
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
