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
  /* Phase-43 SI-floor: state.{rated_range, odometer, ideal_range} arrive in
   * METERS, state.speed in M/S, state.{inside, outside}_temp in °C. The legacy
   * useSettings.convert{Distance, Speed} expected miles/mph in and would multiply
   * by ~1× when user prefs were "mi" — which is why the values appeared
   * 1000× / 2000× too large on the dashboard. Wrap SI-aware converters so the
   * VehicleHero component's contract stays intact. */
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
