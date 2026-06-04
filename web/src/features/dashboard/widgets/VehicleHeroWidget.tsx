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
  const { data: vehicles } = useVehicles();
  const vehicle = vehicleId
    ? vehicles?.find((v) => v.id === vehicleId) ?? vehicles?.[0]
    : vehicles?.[0];

  const id = vehicle?.id ?? 0;
  const { data: stateData, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id);
  const { state: live } = useVehicleLive(vehicle?.id);
  /* State values arrive in SI units: range/odometer in meters, speed in m/s,
   * and temperatures in °C. Wrap SI-aware converters so VehicleHero receives
   * display-unit values without changing its component contract. */
  const { unitPrefs } = useUnits();
  const { isFahrenheit } = useSettings();

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  const toDistanceDisplay = (meters: number) =>
    convertDistanceFromSI(meters, unitPrefs.distance);
  const toSpeedDisplay = (mps: number) => convertSpeedFromSI(mps, unitPrefs.speed);
  const toTemperatureDisplay = (celsius: number) => convertTempFromSI(celsius, unitPrefs.temperature);

  const firmwareVersion =
    live.version || live.swUpdateVersion || stateData?.state?.software_version || '—';

  return (
    <WidgetShell loading={!vehicle} noPadding updatedAt={dataUpdatedAt} isFetching={isFetching} isStale={isStale} isError={isError} onRefresh={() => refetch()}>
      {vehicle && (
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
      )}
    </WidgetShell>
  );
}
