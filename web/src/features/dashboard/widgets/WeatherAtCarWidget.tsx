import { useTranslation } from 'react-i18next';
import { CloudSun, Sun, CloudSnow, Thermometer } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

/** Pick an icon based on outside temperature (°C). */
function WeatherIcon({ tempC, className }: { tempC: number; className?: string }) {
  if (tempC <= 0) return <CloudSnow className={className} />;
  if (tempC >= 25) return <Sun className={className} />;
  return <CloudSun className={className} />;
}

export default function WeatherAtCarWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id, { refetchInterval: 30_000 });
  const { convertTemp, tempUnit } = useSettings();

  const state = stateData?.state;
  const outsideTemp = state?.outside_temp;
  const hasData = outsideTemp != null;
  const isCompact = size.cols === 1 && size.rows === 1;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.weatherAtCar', 'Weather at Car')}
      icon={!isCompact ? <CloudSun className="h-3.5 w-3.5 text-cyan-300" /> : undefined}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {hasData ? (
        isCompact ? (
          <div className="h-full flex flex-col items-center justify-center gap-1">
            <WeatherIcon tempC={outsideTemp} className="h-6 w-6 text-neon-cyan" />
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {fmtInt(convertTemp(outsideTemp))}{tempUnit}
            </span>
          </div>
        ) : (
          <div className="h-full flex items-center gap-4 py-2">
            <WeatherIcon tempC={outsideTemp} className="h-10 w-10 text-neon-cyan flex-shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="text-3xl font-bold text-[var(--text-primary)]">
                {fmtInt(convertTemp(outsideTemp))}{tempUnit}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {t('widget.outsideTemp', 'Outside Temperature')}
              </span>
              {state?.latitude != null && state?.longitude != null && (
                <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
                  {state.latitude.toFixed(2)}°, {state.longitude.toFixed(2)}°
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
