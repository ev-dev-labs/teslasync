import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudSun, Sun, CloudSnow, Thermometer } from 'lucide-react';
import { KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Badge, Caption } from '@/components/ui';
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
import WidgetClimateReadout from './shared/WidgetClimateReadout';
import InstrumentPresentation from './designPacks/InstrumentPresentation';

/** Classic's decorative temperature bands, not measured weather conditions. */
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
  const { fmtInt } = useNumberFormatting();
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
  const observedAt = isFiniteNumber(stateData?.observedAt) && stateData.observedAt > 0
    ? stateData.observedAt : null;
  const discoveryState = useDataState(vehiclesQuery);
  const sourceState = useDataState({
    ...query,
    data: stateData ?? (!id || (!isLoading && !query.isPending && !isError) ? null : undefined),
    dataUpdatedAt: observedAt ?? dataUpdatedAt,
  }, {
    provenance: stateData?.live ? 'live' : 'cached',
    unavailable: !hasTemp,
    partial: hasTemp && stateData?.freshness === 'unknown',
    maxAgeMs: 120_000,
  });
  const dataState = !id && vehicleId == null && discoveryState.status !== 'ok'
    ? discoveryState : sourceState;

  const isCompact = size.cols === 1 && size.rows === 1;

  const handleRefresh = useCallback(() => {
    if (vehicleId == null) void vehiclesQuery.refetch?.();
    if (id) void refetch();
  }, [refetch, vehicleId, id, vehiclesQuery]);

  const emptyState = (
    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; refresh remains available in the shell */
      icon={<Thermometer className="h-5 w-5" />}
      message={t('widget.noWeather', 'No weather data')}
      className="py-4"
    />
  );

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.weatherAtCar', 'Weather at car')}
      icon={!isCompact ? <CloudSun className="h-3.5 w-3.5 text-[var(--text-secondary)]" /> : undefined}
      dataState={{ ...dataState, retry: handleRefresh }}
      updatedAt={observedAt ?? dataUpdatedAt}
      refreshIntervalMs={30_000}
      isFetching={isFetching}
      isStale={isStale || dataState.status === 'stale' || (hasTemp && stateData?.freshness === 'unknown')}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <InstrumentPresentation
        family="climate"
        compact={isCompact}
        icon={<Thermometer aria-hidden="true" />}
        headline={<WidgetClimateReadout>
          <WidgetBigNumber
            value={outsideTemp !== null ? `${fmtInt(toTemperatureDisplay(outsideTemp))}${tempUnit}` : null}
            label={t('automations.builder.signals.outsideTemp', 'Outside temperature')}
            align={isCompact ? 'center' : 'start'}
            animated={false}
          />
        </WidgetClimateReadout>}
        context={<Badge variant="neutral" size="sm">{t('dashboardWidgets.climate.weatherAtVehicle', 'AT VEHICLE')}</Badge>}
        instrument={!hasTemp ? emptyState : undefined}
        details={
          <div className="flex min-w-0 flex-col gap-3">
            <KVList wrap items={[
              { id: 'source', label: t('dashboardWidgets.climate.weatherSource', 'Source'),
                value: hasTemp ? t('dashboardWidgets.climate.weatherVehicleReading', 'Vehicle reading') : '—' },
              { id: 'conditions', label: t('dashboardWidgets.climate.weatherConditions', 'Conditions'), value: '—' },
            ]} />
            <Caption as="p">
              {t('dashboardWidgets.climate.weatherConditionsNote', 'Do not infer weather conditions from temperature alone.')}
            </Caption>
          </div>
        }
      >
        {outsideTemp !== null ? (
          isCompact ? (
            <div className="h-full flex flex-col items-center justify-center gap-1">
              <WeatherIcon tempC={outsideTemp} className="h-6 w-6 text-[var(--text-secondary)]" />
              <WidgetBigNumber value={`${fmtInt(toTemperatureDisplay(outsideTemp))}${tempUnit}`} align="center" />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center gap-3 py-2">
              <WidgetBigNumber value={`${fmtInt(toTemperatureDisplay(outsideTemp))}${tempUnit}`} align="center" />
              <WeatherIcon tempC={outsideTemp} className="h-10 w-10 text-[var(--text-secondary)] flex-shrink-0" />
            </div>
          )
        ) : (
          emptyState
        )}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
