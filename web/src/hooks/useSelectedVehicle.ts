import { useCallback, useEffect, useMemo } from 'react';
import { useLocation, useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSelectedVehicleStore } from '@/store/selectedVehicle';
import type { Vehicle } from '@/types/vehicle';

/**
 * Returns the user's currently selected vehicle, with a precedence order
 * tuned for multi-vehicle owners:
 *
 *   1. Path param  `/vehicles/:id` (and `/vehicles/:id/access`)
 *   2. Query param `?vehicle_id=N` (alert drillthrough)
 *   3. Persisted store value (last header-picker selection)
 *   4. First vehicle in the fleet (sensible default for fresh installs)
 *
 * Whenever the URL provides a vehicle id, that id is also written back to
 * the store so subsequent sidebar navigation stays scoped to it. This is
 * the "sticky picker" behavior that makes Battery → Charging → Drives
 * navigation feel consistent.
 *
 * The returned setter performs the reverse synchronization: an explicit
 * selection updates the store and the current URL. That lets URL-backed
 * filters react immediately when the status-bar, sidebar, command palette,
 * or a page-level picker changes the active vehicle.
 *
 * The hook does NOT throw if the store provider is missing; pages that
 * mount before the provider would otherwise crash on a benign read. It
 * gracefully degrades to URL-only selection in that case.
 */

export interface SelectedVehicleResult {
  /** Effective vehicle id (URL > store > first vehicle). `null` only when the fleet is empty. */
  vehicleId: number | null;
  /** Vehicle record matching {@link vehicleId}, or `null` if not yet loaded / not found. */
  vehicle: Vehicle | null;
  /** Full vehicles list (always an array — empty when not loaded). */
  vehicles: Vehicle[];
  /** Update the persisted selection and current URL vehicle scope. */
  setVehicleId: (id: number | null) => void;
}

function parseId(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function useSelectedVehicle(): SelectedVehicleResult {
  const { vehicleId: stored, setVehicleId: setStoredVehicleId } = useSelectedVehicleStore();
  const { data: vehicles } = useVehicles();
  const navigate = useNavigate();
  const location = useLocation();

  // Path param precedence: /vehicles/:id and /vehicles/:id/access (router uses :id).
  const vehicleDetailMatch = useMatch('/vehicles/:id');
  const vehicleAccessMatch = useMatch('/vehicles/:id/access');
  const pathId =
    parseId(vehicleDetailMatch?.params.id) ?? parseId(vehicleAccessMatch?.params.id);

  // Query param: alert-drillthrough URLs (`/battery?vehicle_id=42&t=...&signal=...`).
  const [searchParams, setSearchParams] = useSearchParams();
  const queryId = parseId(searchParams.get('vehicle_id'));

  const requestedUrlId = pathId ?? queryId;
  const fleetResolved = vehicles !== undefined;
  const isKnownVehicle = useCallback(
    (id: number | null): id is number =>
      id != null && (!fleetResolved || vehicles.some((candidate) => candidate.id === id)),
    [fleetResolved, vehicles],
  );
  const urlId = isKnownVehicle(requestedUrlId) ? requestedUrlId : null;
  const storedId = isKnownVehicle(stored) ? stored : null;
  const firstVehicleId = vehicles && vehicles.length > 0 ? vehicles[0].id : null;
  const effectiveId = urlId ?? storedId ?? firstVehicleId;

  // Sync the store whenever the URL provides a vehicle so sidebar navigation
  // stays scoped to the same vehicle on subsequent clicks. Once the fleet is
  // resolved, this also repairs a persisted id for a vehicle that was deleted.
  // Do not erase a persisted selection for a transient successful empty
  // response; if vehicles return later, the prior id can still be reconciled.
  useEffect(() => {
    if (effectiveId != null && effectiveId !== stored) {
      setStoredVehicleId(effectiveId);
    }
  }, [effectiveId, stored, setStoredVehicleId]);

  const writeVehicleToLocation = useCallback(
    (id: number | null, clearVinOverride = true) => {
      if (vehicleDetailMatch || vehicleAccessMatch) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('vehicle_id');
        if (clearVinOverride) nextParams.delete('vin');
        const query = nextParams.toString();
        const suffix = vehicleAccessMatch ? '/access' : '';
        const pathname = id == null ? '/vehicles' : `/vehicles/${id}${suffix}`;
        navigate(
          {
            pathname,
            search: query ? `?${query}` : '',
            hash: location.hash,
          },
          { replace: true },
        );
        return;
      }

      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (id == null) {
            next.delete('vehicle_id');
          } else {
            next.set('vehicle_id', String(id));
          }
          // VIN-backed Tesla charging pages use this as an explicit local
          // override. A new global selection must clear that competing scope.
          if (clearVinOverride) next.delete('vin');
          return next;
        },
        { replace: true },
      );
    },
    [
      location.hash,
      navigate,
      searchParams,
      setSearchParams,
      vehicleAccessMatch,
      vehicleDetailMatch,
    ],
  );

  const setVehicleId = useCallback(
    (id: number | null) => {
      setStoredVehicleId(id);
      writeVehicleToLocation(id);
    },
    [setStoredVehicleId, writeVehicleToLocation],
  );

  // A positive numeric URL id that no longer exists must not strand the app
  // on a stale selection. Replace it with the effective fallback while
  // preserving every unrelated query parameter.
  useEffect(() => {
    if (
      fleetResolved &&
      requestedUrlId != null &&
      urlId == null &&
      requestedUrlId !== effectiveId
    ) {
      // Automatic stale-id repair must not discard an explicit `vin=*`
      // fleet scope. Only a deliberate global selector action clears VIN.
      writeVehicleToLocation(effectiveId, false);
    }
  }, [
    effectiveId,
    fleetResolved,
    requestedUrlId,
    urlId,
    writeVehicleToLocation,
  ]);

  const vehicle = useMemo<Vehicle | null>(() => {
    if (effectiveId == null || !vehicles) return null;
    return vehicles.find((v) => v.id === effectiveId) ?? null;
  }, [effectiveId, vehicles]);

  return {
    vehicleId: effectiveId,
    vehicle,
    vehicles: vehicles ?? [],
    setVehicleId,
  };
}
