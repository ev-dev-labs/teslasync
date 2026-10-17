import { useCallback, useEffect, useMemo } from 'react';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUrlString } from '@/hooks/useUrlState';

export const ALL_VEHICLES_VIN = '*';

/**
 * Bridges VIN-backed Tesla endpoints to the app-wide numeric vehicle scope.
 *
 * A missing `vin` parameter follows the global selection. `vin=*` is the
 * page-local fleet-wide override. Choosing a concrete VIN updates the global
 * vehicle, while a later status-bar selection clears the VIN override through
 * `useSelectedVehicle()` and immediately re-scopes the page.
 * Unmatched bookmarks are retained; VIN-backed consumers must gate requests
 * on `scopeReady` rather than interpreting a missing `queryVin` as fleet.
 */
export function useVehicleVinFilter() {
  const {
    vehicleId,
    vehicle,
    vehicles,
    vehiclesState,
    setVehicleId,
  } = useSelectedVehicle();
  const vehiclesQuery = useVehicles();
  const [vinOverride, setVinOverride] = useUrlString('vin', '');

  const overrideVehicle = useMemo(
    () =>
      vinOverride && vinOverride !== ALL_VEHICLES_VIN
        ? vehicles.find((candidate) => candidate.vin === vinOverride) ?? null
        : null,
    [vehicles, vinOverride],
  );

  // Preserve old bookmarks that used ?vin=... by promoting that VIN into the
  // canonical numeric selection once the fleet resolves.
  useEffect(() => {
    if (overrideVehicle && overrideVehicle.id !== vehicleId) {
      setVehicleId(overrideVehicle.id);
    }
  }, [overrideVehicle, setVehicleId, vehicleId]);

  const allVehicles = vinOverride === ALL_VEHICLES_VIN;
  // A bookmarked VIN must never fall through to a different global vehicle.
  const selectedVehicle = vinOverride ? overrideVehicle : vehicle;
  const scopeReady = allVehicles || Boolean(selectedVehicle?.vin);
  const selectedVin = allVehicles
    ? ALL_VEHICLES_VIN
    : vinOverride || selectedVehicle?.vin || '';

  const setSelectedVin = useCallback(
    (vin: string) => {
      if (vin === ALL_VEHICLES_VIN) {
        setVinOverride(ALL_VEHICLES_VIN);
        return;
      }

      const nextVehicle = vehicles.find((candidate) => candidate.vin === vin);
      if (nextVehicle) {
        setVehicleId(nextVehicle.id);
      }
    },
    [setVehicleId, setVinOverride, vehicles],
  );

  return {
    allVehicles,
    queryVin: allVehicles ? undefined : selectedVehicle?.vin || undefined,
    scopeReady,
    isResolving: vehiclesQuery.isLoading,
    vehiclesState,
    selectedVin,
    setSelectedVin,
    vehicles,
  };
}
