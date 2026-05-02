import { useCallback, useEffect, useMemo, useState } from 'react';
import { broadcast, subscribe } from '@/lib/broadcast';
import {
  FALLBACK_PAINT,
  PAINT_PALETTES,
  inferPaintFromTesla,
  isPaintPaletteId,
  type PaintPalette,
  type PaintPaletteId,
} from '@/lib/vehicleColors';

/**
 * useVehiclePaint — per-vehicle paint color override for the Digital Twin.
 *
 * Resolution order:
 *   1. Local override (from `localStorage`), if set and still a valid id.
 *   2. Inferred from the Tesla `exterior_color` field, if any.
 *   3. {@link FALLBACK_PAINT} — Pearl White (high contrast on dark UI).
 *
 * The override is **browser-local** — it does not sync to the server or
 * across devices. The Tesla-reported exterior color is the source of truth
 * for any new device. Users override only when they want a different
 * cosmetic look, or when Tesla's color metadata is missing/wrong.
 *
 * The override is keyed per-vehicle so a Pearl White and a Midnight Silver
 * in the same garage each render correctly. `vehicleId` of `null`, `0`, or
 * `undefined` is treated as "no vehicle yet" and disables persistence
 * (the hook still returns the inferred or fallback paint so the SVG
 * renders normally during loading).
 *
 * Cross-tab sync: writes broadcast a `vehicle.paint.changed` message via
 * the shared `broadcast` bus so other tabs (e.g. a pinned dashboard) pick
 * up the new color without a reload.
 */

const STORAGE_PREFIX = 'teslasync:vehicle:';
const STORAGE_SUFFIX = ':paint';

// In-tab pub/sub: localStorage `storage` events only fire in *other* tabs,
// and the broadcast bus self-filters by TAB_ID, so two hook instances in the
// same tab (e.g. the picker on the page and the <VehicleTwin> below it) need
// a separate notify channel to stay in sync without a refresh.
type Listener = (id: PaintPaletteId | null) => void;
const inTabListeners = new Map<number, Set<Listener>>();

function notifyInTab(vehicleId: number, value: PaintPaletteId | null): void {
  const set = inTabListeners.get(vehicleId);
  if (!set) return;
  for (const fn of set) fn(value);
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
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) inTabListeners.delete(vehicleId);
  };
}

function storageKey(vehicleId: number | null | undefined): string | null {
  if (typeof vehicleId !== 'number' || !Number.isFinite(vehicleId) || vehicleId <= 0) {
    return null;
  }
  return `${STORAGE_PREFIX}${vehicleId}${STORAGE_SUFFIX}`;
}

function readOverride(vehicleId: number | null | undefined): PaintPaletteId | null {
  const key = storageKey(vehicleId);
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return isPaintPaletteId(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeOverride(vehicleId: number, value: PaintPaletteId | null): void {
  const key = storageKey(vehicleId);
  if (!key || typeof window === 'undefined') return;
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    /* quota / private mode — best-effort drop */
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
  const [overrideId, setOverrideId] = useState<PaintPaletteId | null>(() => readOverride(vehicleId));

  // Re-read when the vehicleId switches (e.g. user changes vehicle in the
  // selector). Each vehicle has its own override slot so we have to refresh.
  useEffect(() => {
    setOverrideId(readOverride(vehicleId));
  }, [vehicleId]);

  // Same-tab sync: another hook instance in this tab updated the override.
  useEffect(() => {
    if (typeof vehicleId !== 'number' || !Number.isFinite(vehicleId) || vehicleId <= 0) {
      return;
    }
    return subscribeInTab(vehicleId, (value) => {
      setOverrideId(value);
    });
  }, [vehicleId]);

  // Cross-tab sync: another tab edited this vehicle's paint → re-read.
  useEffect(() => {
    const off = subscribe((msg) => {
      if (msg.type !== 'vehicle.paint.changed') return;
      if (msg.vehicleId !== vehicleId) return;
      setOverrideId(isPaintPaletteId(msg.paintId) ? msg.paintId : null);
    });
    return off;
  }, [vehicleId]);

  // Defense in depth — if another tab wrote straight to localStorage
  // without going through this hook, we still want to update.
  useEffect(() => {
    const key = storageKey(vehicleId);
    if (!key || typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      setOverrideId(readOverride(vehicleId));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [vehicleId]);

  const inferred = useMemo<PaintPalette>(
    () => inferPaintFromTesla(exteriorColor),
    [exteriorColor],
  );

  const paint = overrideId ? PAINT_PALETTES[overrideId] ?? inferred : inferred;

  const setPaint = useCallback(
    (id: PaintPaletteId | null) => {
      // Treat "set to the inferred color" as "clear the override" so the
      // picker can stay in sync if Tesla later reports a paint.
      const normalized: PaintPaletteId | null = id === inferred.id ? null : id;
      setOverrideId(normalized);
      if (typeof vehicleId === 'number' && vehicleId > 0) {
        writeOverride(vehicleId, normalized);
        notifyInTab(vehicleId, normalized);
        broadcast({ type: 'vehicle.paint.changed', vehicleId, paintId: normalized });
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
