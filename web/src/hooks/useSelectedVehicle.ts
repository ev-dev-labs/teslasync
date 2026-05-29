import { useEffect, useMemo } from 'react';
import { useMatch, useSearchParams } from 'react-router-dom';
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
  /** Update the persisted selection. */
  setVehicleId: (id: number | null) => void;
}

function parseId(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function useSelectedVehicle(): SelectedVehicleResult {
  const { vehicleId: stored, setVehicleId } = useSelectedVehicleStore();
  const { data: vehicles } = useVehicles();

  // Path param precedence: /vehicles/:id and /vehicles/:id/access (router uses :id).
  const vehicleDetailMatch = useMatch('/vehicles/:id');
  const vehicleAccessMatch = useMatch('/vehicles/:id/access');
  const pathId =
    parseId(vehicleDetailMatch?.params.id) ?? parseId(vehicleAccessMatch?.params.id);

  // Query param: alert-drillthrough URLs (`/battery?vehicle_id=42&t=...&signal=...`).
  const [searchParams] = useSearchParams();
  const queryId = parseId(searchParams.get('vehicle_id'));

  const urlId = pathId ?? queryId;

  // Sync the store whenever the URL provides a vehicle so sidebar navigation
  // stays scoped to the same vehicle on subsequent clicks.
  useEffect(() => {
    if (urlId != null && urlId !== stored) {
      setVehicleId(urlId);
    }
  }, [urlId, stored, setVehicleId]);

  // Default to the first vehicle the moment the fleet loads. Wrapped in a
  // non-throwing setStored so a missing provider doesn't crash the app.
  const firstVehicleId = vehicles && vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (stored == null && firstVehicleId != null) {
      setVehicleId(firstVehicleId);
    }
  }, [stored, firstVehicleId, setVehicleId]);

  // Effective id (computed inline so first-render reads don't wait for the effect).
  const effectiveId = urlId ?? stored ?? firstVehicleId;

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
