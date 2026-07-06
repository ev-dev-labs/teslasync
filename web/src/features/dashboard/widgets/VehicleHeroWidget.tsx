import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Car } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { useUnits } from '@/hooks/useUnits';
import {
  convertDistanceFromSI,
  convertSpeedFromSI,
  convertTempFromSI,
} from '@/lib/unitConversion';
import { useVehicleLive } from '@/hooks/useVehicleLive';
import { VehicleHero } from '../components/VehicleHero';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Vehicle, VehicleState } from '../types';

export default function VehicleHeroWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const vehicle = vehicleId
    ? vehicles?.find((v) => v.id === vehicleId) ?? vehicles?.[0]
    : vehicles?.[0];

  const id = vehicle?.id ?? 0;
  const { data: stateData, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id);
  const { state: live } = useVehicleLive(vehicle?.id);
  /* State values arrive in SI units: range/odometer in meters, speed in m/s,
   * and temperatures in °C. Wrap SI-aware converters so VehicleHero receives
   * display-unit values without changing its component contract. The callbacks
   * are memoised on their unit preference so a background re-render (the state
   * query polls) doesn't hand VehicleHero fresh function identities each time. */
  const { unitPrefs } = useUnits();
  const { isFahrenheit } = useSettings();

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  const toDistanceDisplay = useCallback(
    (meters: number) => convertDistanceFromSI(meters, distanceUnit),
    [distanceUnit],
  );
  const toSpeedDisplay = useCallback(
    (mps: number) => convertSpeedFromSI(mps, speedUnit),
    [speedUnit],
  );
  const toTemperatureDisplay = useCallback(
    (celsius: number) => convertTempFromSI(celsius, tempUnit),
    [tempUnit],
  );
  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  // Live-progress firmware (SSE) wins over the last persisted state snapshot;
  // fall back to an em-dash so the tile never renders an empty string.
  const firmwareVersion =
    live.version || live.swUpdateVersion || stateData?.state?.software_version || '—';

  return (
    <WidgetShell
      loading={vehiclesLoading}
      noPadding
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {vehicle ? (
        <VehicleHero
          vehicle={vehicle as unknown as Vehicle}
          state={(stateData?.state ?? null) as VehicleState | null}
          firmwareVersion={firmwareVersion}
          lastFetchedAt={dataUpdatedAt}
          toDistanceDisplay={toDistanceDisplay}
          toSpeedDisplay={toSpeedDisplay}
          toTemperatureDisplay={toTemperatureDisplay}
          isFahrenheit={isFahrenheit}
          distanceUnit={distanceUnit}
          speedUnit={speedUnit}
          tempUnit={tempUnit}
        />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when no vehicle is linked; no specific recovery action available */
          icon={<Car className="h-5 w-5" />}
          message={t('widget.noVehicle', 'No vehicle data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
