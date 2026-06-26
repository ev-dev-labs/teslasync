// Native parity port of web/src/hooks/useVehiclePaint.ts.
//
// The web hook persists a per-vehicle paint override in `localStorage` and
// syncs it across tabs via the `storage` event + a `broadcast` bus. React
// Native has none of those browser primitives (no `window`, `localStorage`,
// `BroadcastChannel`, or multi-tab concept). The native-safe replacement keeps
// the exact same public API and resolution order (override > inferred >
// fallback) and the same in-process notify channel the web used to keep two
// hook instances (the picker + the <VehicleTwin> below it) in sync, but backs
// the override with a module-level in-memory store. Consequences vs. web:
//   - The override lives for the app session only (no cold-restart persistence)
//     — the same graceful-degradation the web hook documents for
//     private-browsing / SSR where storage is unavailable.
//   - There is no cross-device or cross-tab sync (native is single-surface).
// Same-surface sync (picker ⇄ twin) is preserved via `inTabListeners`.

import {useCallback, useEffect, useMemo, useState} from 'react';

import {
  FALLBACK_PAINT,
  PAINT_PALETTES,
  inferPaintFromTesla,
  isPaintPaletteId,
  type PaintPalette,
  type PaintPaletteId,
} from './_vehicleColors';

// In-memory per-vehicle override store (native analogue of localStorage).
const overrideStore = new Map<number, PaintPaletteId>();

// In-process pub/sub so two hook instances on the same screen stay in sync
// without a reload — mirrors the web hook's `inTabListeners`.
type Listener = (id: PaintPaletteId | null) => void;
const inTabListeners = new Map<number, Set<Listener>>();

function notifyInTab(vehicleId: number, value: PaintPaletteId | null): void {
  const set = inTabListeners.get(vehicleId);
  if (!set) {
    return;
  }
  for (const fn of set) {
    fn(value);
  }
}

function subscribeInTab(vehicleId: number, fn: Listener): () => void {
  let set = inTabListeners.get(vehicleId);
  if (!set) {
    set = new Set();
    inTabListeners.set(vehicleId, set);
  }
  set.add(fn);
  return () => {
    const s = inTabListeners.get(vehicleId);
    if (!s) {
      return;
    }
    s.delete(fn);
    if (s.size === 0) {
      inTabListeners.delete(vehicleId);
    }
  };
}

function isPersistableId(
  vehicleId: number | null | undefined,
): vehicleId is number {
  return (
    typeof vehicleId === 'number' && Number.isFinite(vehicleId) && vehicleId > 0
  );
}

function readOverride(
  vehicleId: number | null | undefined,
): PaintPaletteId | null {
  if (!isPersistableId(vehicleId)) {
    return null;
  }
  const raw = overrideStore.get(vehicleId);
  return isPaintPaletteId(raw) ? raw : null;
}

function writeOverride(vehicleId: number, value: PaintPaletteId | null): void {
  if (value === null) {
    overrideStore.delete(vehicleId);
  } else {
    overrideStore.set(vehicleId, value);
  }
}

export interface UseVehiclePaint {
  /** Currently active paint (override > inferred > fallback). */
  paint: PaintPalette;
  /** What auto-detection alone would produce (ignoring override). */
  inferred: PaintPalette;
  /** True when the user has manually picked a color for this vehicle. */
  isOverridden: boolean;
  /** Set the override (or `null` to clear it and revert to inferred). */
  setPaint: (id: PaintPaletteId | null) => void;
  /** Clear the override — equivalent to `setPaint(null)`. */
  reset: () => void;
}

export function useVehiclePaint(
  vehicleId: number | null | undefined,
  exteriorColor?: string | null,
): UseVehiclePaint {
  const [overrideId, setOverrideId] = useState<PaintPaletteId | null>(() =>
    readOverride(vehicleId),
  );

  // Re-read when the vehicleId switches (e.g. user changes vehicle in the
  // selector). Each vehicle has its own override slot so we have to refresh.
  useEffect(() => {
    setOverrideId(readOverride(vehicleId));
  }, [vehicleId]);

  // Same-surface sync: another hook instance updated this vehicle's override.
  useEffect(() => {
    if (!isPersistableId(vehicleId)) {
      return;
    }
    return subscribeInTab(vehicleId, value => {
      setOverrideId(value);
    });
  }, [vehicleId]);

  const inferred = useMemo<PaintPalette>(
    () => inferPaintFromTesla(exteriorColor),
    [exteriorColor],
  );

  const paint = overrideId ? PAINT_PALETTES[overrideId] ?? inferred : inferred;

  const setPaint = useCallback(
    (id: PaintPaletteId | null) => {
      // Treat "set to the inferred color" as "clear the override" so the picker
      // stays in sync if Tesla later reports a paint.
      const normalized: PaintPaletteId | null = id === inferred.id ? null : id;
      setOverrideId(normalized);
      if (isPersistableId(vehicleId)) {
        writeOverride(vehicleId, normalized);
        notifyInTab(vehicleId, normalized);
      }
    },
    [vehicleId, inferred.id],
  );

  const reset = useCallback(() => setPaint(null), [setPaint]);

  return {
    paint: paint ?? FALLBACK_PAINT,
    inferred,
    isOverridden: overrideId !== null,
    setPaint,
    reset,
  };
}
