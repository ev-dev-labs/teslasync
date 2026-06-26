// Native parity port of web/src/hooks/useVehiclePaint.ts.
//
// Per-vehicle paint color override for the Digital Twin. Resolves the active
// paint as override > inferred-from-Tesla > Pearl White fallback, keyed per
// vehicle, and keeps every mounted consumer in the same app process in sync.
//
// Web -> native adaptation (conversion contract rules 3 & 7) — every
// browser-only touch point is replaced with a documented native-safe
// substitute, behaviour otherwise preserved:
//   * `window.localStorage` (readOverride/writeOverride) -> the shared
//     process-scoped key/value store from lib/nativeWebStorage.ts
//     (getNativeStorage('local') — the same 'local' backend useFormDraft uses).
//     The storage keys `teslasync:vehicle:{id}:paint` are preserved verbatim,
//     and the web `typeof window === 'undefined'` SSR/availability guard
//     becomes a `storage === null` guard so the null-safe try/catch ladders
//     stay structurally identical.
//   * `@/lib/broadcast` (cross-tab paint sync) -> the native parity port under
//     ../lib/broadcast. The `vehicle.paint.changed` message and its
//     {vehicleId, paintId} payload already exist in that port's
//     BroadcastMessage union.
//   * `@/lib/vehicleColors` -> the native parity support module under
//     ../lib/vehicleColors (pure palette data/types/logic, no DOM).
//   * The web defense-in-depth `window` 'storage' event listener (source
//     L146-155) has no native analogue — React Native is a single JS context
//     with no peer tabs and no DOM `StorageEvent`, so there is no out-of-band
//     writer to react to. Every write goes through `writeOverride`, which
//     already fans out via `notifyInTab` (same-process, the in-tab effect) and
//     the `broadcast` bus (the cross-tab effect). That fourth effect therefore
//     collapses into the two effects above; see the note where it used to be.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { broadcast, subscribe } from '../lib/broadcast';
import {
  getNativeStorage,
  type NativeKeyValueStorage,
} from '../lib/nativeWebStorage';
import {
  FALLBACK_PAINT,
  PAINT_PALETTES,
  inferPaintFromTesla,
  isPaintPaletteId,
  type PaintPalette,
  type PaintPaletteId,
} from '../lib/vehicleColors';

/**
 * useVehiclePaint — per-vehicle paint color override for the Digital Twin.
 *
 * Resolution order:
 *   1. Local override (from device-local storage), if set and still a valid id.
 *   2. Inferred from the Tesla `exterior_color` field, if any.
 *   3. {@link FALLBACK_PAINT} — Pearl White (high contrast on dark UI).
 *
 * The override is **device-local** — it does not sync to the server or
 * across devices. The Tesla-reported exterior color is the source of truth
 * for any new device. Users override only when they want a different
 * cosmetic look, or when Tesla's color metadata is missing/wrong.
 *
 * The override is keyed per-vehicle so a Pearl White and a Midnight Silver
 * in the same garage each render correctly. `vehicleId` of `null`, `0`, or
 * `undefined` is treated as "no vehicle yet" and disables persistence
 * (the hook still returns the inferred or fallback paint so the twin
 * renders normally during loading).
 *
 * In-process sync: writes broadcast a `vehicle.paint.changed` message via
 * the shared `broadcast` bus and notify the in-tab listener set so other
 * mounted consumers (e.g. the picker on the screen and the twin below it)
 * pick up the new color without a reload.
 */

const STORAGE_PREFIX = 'teslasync:vehicle:';
const STORAGE_SUFFIX = ':paint';

// In-process pub/sub: on the web, localStorage `storage` events only fired in
// *other* tabs and the broadcast bus self-filters by TAB_ID, so two hook
// instances in the same tab (e.g. the picker on the screen and the twin below
// it) needed a separate notify channel to stay in sync without a refresh. React
// Native runs a single context, so this in-process channel is the primary sync
// path for sibling consumers.
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

// Native-safe replacement for the web `window.localStorage`. The shared
// process-scoped 'local' store (lib/nativeWebStorage.ts) is the canonical
// localStorage substitute; it is always present, but the |null union + guard is
// kept so readOverride/writeOverride mirror the source's window-availability
// ladder exactly.
function getOverrideStorage(): NativeKeyValueStorage | null {
  try {
    return getNativeStorage('local');
  } catch {
    return null;
  }
}

function storageKey(vehicleId: number | null | undefined): string | null {
  if (
    typeof vehicleId !== 'number' ||
    !Number.isFinite(vehicleId) ||
    vehicleId <= 0
  ) {
    return null;
  }
  return `${STORAGE_PREFIX}${vehicleId}${STORAGE_SUFFIX}`;
}

function readOverride(
  vehicleId: number | null | undefined,
): PaintPaletteId | null {
  const key = storageKey(vehicleId);
  const storage = getOverrideStorage();
  if (!key || !storage) {
    return null;
  }
  try {
    const raw = storage.getItem(key);
    return isPaintPaletteId(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeOverride(vehicleId: number, value: PaintPaletteId | null): void {
  const key = storageKey(vehicleId);
  const storage = getOverrideStorage();
  if (!key || !storage) {
    return;
  }
  try {
    if (value === null) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, value);
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
  const [overrideId, setOverrideId] = useState<PaintPaletteId | null>(() =>
    readOverride(vehicleId),
  );

  // Re-read when the vehicleId switches (e.g. user changes vehicle in the
  // selector). Each vehicle has its own override slot so we have to refresh.
  useEffect(() => {
    setOverrideId(readOverride(vehicleId));
  }, [vehicleId]);

  // Same-process sync: another hook instance updated the override.
  useEffect(() => {
    if (
      typeof vehicleId !== 'number' ||
      !Number.isFinite(vehicleId) ||
      vehicleId <= 0
    ) {
      return;
    }
    return subscribeInTab(vehicleId, value => {
      setOverrideId(value);
    });
  }, [vehicleId]);

  // Cross-tab sync: another tab edited this vehicle's paint → re-read. On the
  // web this carried BroadcastChannel traffic between tabs; in React Native the
  // bus has no peer-tab source (see lib/broadcast.ts), so the subscription is
  // lifecycle-safe and simply never fires from cross-tab traffic — same-process
  // writes are delivered through `notifyInTab` (effect above) instead.
  useEffect(() => {
    const off = subscribe(msg => {
      if (msg.type !== 'vehicle.paint.changed') {
        return;
      }
      if (msg.vehicleId !== vehicleId) {
        return;
      }
      setOverrideId(isPaintPaletteId(msg.paintId) ? msg.paintId : null);
    });
    return off;
  }, [vehicleId]);

  // Web defense-in-depth (source L146-155): a `window` 'storage' event re-read
  // the override when ANOTHER tab wrote this vehicle's key straight to
  // localStorage, bypassing the hook. React Native has no `window`, no
  // `StorageEvent`, and no peer tabs, so there is no out-of-band writer to
  // observe — every write goes through `writeOverride`, which already fans out
  // via `notifyInTab` (same-process effect) and the `broadcast` bus (cross-tab
  // effect). That fourth effect therefore collapses into the two effects above.

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
        broadcast({
          type: 'vehicle.paint.changed',
          vehicleId,
          paintId: normalized,
        });
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
