// Native parity port of web/src/hooks/useSelectedVehicle.ts.
//
// The web hook returns the user's currently selected vehicle using a four-tier
// precedence order tuned for multi-vehicle owners:
//   1. Path param  `/vehicles/:id` (and `/vehicles/:id/access`)  [react-router]
//   2. Query param `?vehicle_id=N` (alert drill-through)         [react-router]
//   3. Persisted store value (last header-picker selection)      [localStorage]
//   4. First vehicle in the fleet (sensible default)             [portable]
// Whenever the URL provides an id it is also written back to the store so
// sidebar navigation stays "sticky" (Battery -> Charging -> Drives stays scoped
// to the same vehicle).
//
// Web -> native mapping notes (contract rules 3, 4, 5, 6 & 7):
//   - Tiers 1 & 2 (`useMatch('/vehicles/:id')`, `useMatch('/vehicles/:id/access')`,
//     `useSearchParams().get('vehicle_id')` from react-router-dom, web L2, L48-57)
//     are STRUCTURALLY UNAVAILABLE: React Native has no address bar / router in
//     the parity tree (the same drop documented by VehicleSelect.tsx,
//     useHiddenSeries.ts and useNotificationListener.ts). `urlId` is therefore
//     permanently `null`, the URL->store write-back effect (web L59-65) is inert
//     and is not wired, and the precedence collapses to store > first vehicle —
//     exactly the native-safe selection VehicleSelect.tsx already settled on.
//   - The `useSelectedVehicleStore()` dependency (web L4, from
//     store/selectedVehicle.tsx: a React Context backed by localStorage with a
//     cross-tab `storage` listener) is browser-only. It is replaced by an
//     inlined module-level external store read through `useSyncExternalStore`,
//     mirroring the VehicleSelect.tsx parity store: a single shared selection
//     for every consumer in the app session. localStorage cold-restart
//     persistence and cross-tab sync are dropped — the same graceful
//     degradation the web store documents for private-browsing / SSR.
//   - `Vehicle` (web L5, from @/types/vehicle) is imported from the ported
//     useVehicles hook, whose exported `Vehicle` is the identical superset shape
//     (snake_case fields + camelCase aliases + extended detail fields) and is
//     exactly the element type of `useVehicles().data`, so the find/return paths
//     carry no type friction.
//   - Tiers 3 & 4, the `parseId` validator, the default-to-first-vehicle effect,
//     the inline `effectiveId` computation and the memoised vehicle lookup all
//     port faithfully with their behavior and the SelectedVehicleResult shape
//     (vehicleId / vehicle / vehicles / setVehicleId) preserved verbatim.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or web UI
// components are imported — only react's useEffect / useMemo / useSyncExternalStore
// and the ported useVehicles hook.

import {useEffect, useMemo, useSyncExternalStore} from 'react';

import {useVehicles, type Vehicle} from '../api/hooks/useVehicles';

export interface SelectedVehicleResult {
  /** Effective vehicle id (store > first vehicle). `null` only when the fleet is empty. */
  vehicleId: number | null;
  /** Vehicle record matching {@link vehicleId}, or `null` if not yet loaded / not found. */
  vehicle: Vehicle | null;
  /** Full vehicles list (always an array — empty when not loaded). */
  vehicles: Vehicle[];
  /** Update the persisted selection. */
  setVehicleId: (id: number | null) => void;
}

/**
 * Normalises a raw id to a positive integer or `null`. On the web this guarded
 * the URL string params (path / query); the same validation gates writes into
 * the native store. Signature widened to also accept the `number | null` the
 * store setter receives (the web original only parsed `string | null`).
 */
function parseId(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// --- Native-safe shared selected-vehicle store -----------------------------
// Native analogue of web store/selectedVehicle (React Context + localStorage).
// RN has no localStorage and the parity tree pulls in no router, so the store
// is a lean module-level external store shared across every consumer of this
// hook. Selection lives for the app session only (no cold-restart persistence
// and no cross-tab sync — the graceful degradation the web store documents for
// private-browsing / SSR). Mirrors the VehicleSelect.tsx parity store so a
// single selection is shared app-wide.

let selectedVehicleId: number | null = null;
const selectionListeners = new Set<() => void>();

function setStoredVehicleId(id: number | null): void {
  const next = parseId(id);
  if (next === selectedVehicleId) {
    return;
  }
  selectedVehicleId = next;
  selectionListeners.forEach(listener => listener());
}

function subscribeSelection(listener: () => void): () => void {
  selectionListeners.add(listener);
  return () => {
    selectionListeners.delete(listener);
  };
}

function getSelectionSnapshot(): number | null {
  return selectedVehicleId;
}

/**
 * Returns the user's currently selected vehicle. Web precedence is
 * URL > store > first vehicle; on native the browser-router URL tiers are
 * unavailable, so the effective precedence is store > first vehicle. The
 * selection is shared across every hook consumer for the app session and
 * defaults to the first vehicle the moment the fleet loads.
 *
 * The hook never throws when the (inlined) store is missing — there is no
 * provider to mount on native — gracefully matching the web doc-string promise
 * that pages mounting before the provider degrade instead of crashing.
 */
export function useSelectedVehicle(): SelectedVehicleResult {
  const {data: vehicles} = useVehicles();

  const stored = useSyncExternalStore(
    subscribeSelection,
    getSelectionSnapshot,
    getSelectionSnapshot,
  );
  const setVehicleId = setStoredVehicleId;

  // Web tiers 1 & 2 (path param `/vehicles/:id`[/access] and query param
  // `?vehicle_id=N`) require react-router, which is absent from the native
  // parity tree, so `urlId` is permanently null and the URL->store write-back
  // effect (web L59-65) is intentionally not wired.

  // Default to the first vehicle the moment the fleet loads. `setStoredVehicleId`
  // is a stable module-level function so it is not a hook dependency.
  const firstVehicleId =
    vehicles && vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (stored == null && firstVehicleId != null) {
      setStoredVehicleId(firstVehicleId);
    }
  }, [stored, firstVehicleId]);

  // Effective id (computed inline so first-render reads don't wait for the effect).
  const effectiveId = stored ?? firstVehicleId;

  const vehicle = useMemo<Vehicle | null>(() => {
    if (effectiveId == null || !vehicles) return null;
    return vehicles.find(v => v.id === effectiveId) ?? null;
  }, [effectiveId, vehicles]);

  return {
    vehicleId: effectiveId,
    vehicle,
    vehicles: vehicles ?? [],
    setVehicleId,
  };
}
