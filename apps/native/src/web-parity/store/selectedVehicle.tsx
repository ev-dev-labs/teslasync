// Native parity port of web/src/store/selectedVehicle.tsx.
//
// The web module is the app-wide "selected vehicle" context: a persistent global
// store for the vehicle the user is currently focused on. On the web it survives
// reloads via `window.localStorage` and stays in sync across browser tabs via the
// DOM `storage` event. Every public + internal name, the storage key, the
// `vehicleId`/`setVehicleId` contract, the positive-finite validation, and the
// out-of-provider no-op fallback are preserved verbatim.
//
// DOM/web-only pieces and their native mappings (conversion-contract rule 7):
//   - `window.localStorage` (loadInitial L34-44, persist L46-58) has no React
//     Native analog and no AsyncStorage / web-storage dependency is installed in
//     apps/native, so the `teslasync-selected-vehicle` key is backed by a
//     native-safe in-process Map (`selectedVehicleStore`) that mirrors the
//     getItem/setItem/removeItem string contract exactly — the established
//     ThemeProvider.tsx / useSidebarStyle.ts / browserCompat.ts precedent. Within
//     a session reads/writes behave identically to the web localStorage path; the
//     selection does NOT survive an app restart (durable, sticky persistence is a
//     browser-only guarantee). The `typeof window === 'undefined'` SSR guards
//     (web L35, L47) are unnecessary on the always-present Map and folded away;
//     the defensive try/catch wrappers (web L36-43, L48-57) are kept so the
//     contract is identical even though the Map cannot throw.
//   - the cross-tab `window.addEventListener('storage', ...)` effect (web L71-84)
//     reacts to selection changes made in OTHER browser tabs. React Native is a
//     single JS runtime with no sibling tabs and no `window` storage events, so
//     that listener is replaced by a native-safe in-process broadcast bus that
//     preserves the SAME intent: mirror selection changes made by OTHER mounted
//     providers, with self-filtering (by source id) standing in for the web
//     `storage` event NOT firing in the window that made the write, and the SAME
//     positive-finite validation before applying. With the single app-root
//     provider this mirror is inert by design, exactly as the web cross-tab
//     mirror collapses on a single device (the ThemeProvider.tsx bus precedent).
//
// No DOM, window/localStorage, Recharts, Leaflet, or web-UI imports reach the
// native output — only react.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Selected-vehicle store.
 *
 * Persistent global state for "the vehicle the user is currently focused on".
 * On the web this survives reloads via localStorage; on native it lives in an
 * in-process store (see the file header) so multi-vehicle owners don't have to
 * re-pick their vehicle every time they navigate within a session.
 *
 * The store deliberately does NOT know about the vehicles list, URL params,
 * or alert context. Pages should consume `useSelectedVehicle()` (which
 * composes the store with list awareness) rather than this store directly.
 *
 * The header `<VehiclePicker>` and the page-side `useSelectedVehicle()` hook
 * are the only intended writers.
 */

const STORAGE_KEY = 'teslasync-selected-vehicle';

export interface SelectedVehicleStoreValue {
  vehicleId: number | null;
  setVehicleId: (id: number | null) => void;
}

// --- Native-safe replacement for the web `window.localStorage` persistence
// layer. No web storage / AsyncStorage dependency is installed, so the selected
// vehicle key lives in an in-process Map mirroring the getItem/setItem/removeItem
// string contract. The value does NOT survive an app restart (durable
// persistence is browser-only on native); within a session reads/writes behave
// exactly like the web localStorage path.
const selectedVehicleStore = new Map<string, string>();

function readStored(key: string): string | null {
  return selectedVehicleStore.get(key) ?? null;
}

function writeStored(key: string, value: string): void {
  selectedVehicleStore.set(key, value);
}

function removeStored(key: string): void {
  selectedVehicleStore.delete(key);
}

function loadInitial(): number | null {
  try {
    const raw = readStored(STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function persist(id: number | null): void {
  try {
    if (id == null) {
      removeStored(STORAGE_KEY);
    } else {
      writeStored(STORAGE_KEY, String(id));
    }
  } catch {
    // In-process store unavailable — mirrors the web private-browsing / quota
    // guard: selection still works for the current session, it just doesn't
    // survive a write failure. (The Map cannot actually throw.)
  }
}

// --- Native-safe in-process replacement for the web cross-tab `storage` event.
// React Native has no sibling tabs / window storage events, so selection changes
// are fanned out through this module-level listener set instead. Self-filtering
// by source id mirrors the web `storage` event NOT firing in the window that made
// the write; with the single app-root provider the bus is inert by design.
type SelectedVehicleListener = (next: number | null, from: number) => void;

const storageListeners = new Set<SelectedVehicleListener>();
let nextStorageSource = 1;

function allocateStorageSource(): number {
  const source = nextStorageSource;
  nextStorageSource += 1;
  return source;
}

function broadcastSelection(from: number, next: number | null): void {
  storageListeners.forEach(listener => {
    listener(next, from);
  });
}

function subscribeSelection(
  source: number,
  handler: (next: number | null) => void,
): () => void {
  const listener: SelectedVehicleListener = (next, from) => {
    if (from === source) return;
    handler(next);
  };
  storageListeners.add(listener);
  return () => {
    storageListeners.delete(listener);
  };
}

const SelectedVehicleContext = createContext<SelectedVehicleStoreValue | null>(
  null,
);

export function SelectedVehicleProvider({ children }: { children: ReactNode }) {
  const [vehicleId, setVehicleIdState] = useState<number | null>(loadInitial);

  // Stable per-instance source so this provider never reacts to its own write
  // (native analog of the web `storage` event not firing in the writing window).
  const sourceRef = useRef<number | null>(null);
  if (sourceRef.current === null) {
    sourceRef.current = allocateStorageSource();
  }
  const source = sourceRef.current;

  const setVehicleId = useCallback(
    (id: number | null) => {
      setVehicleIdState(id);
      persist(id);
      broadcastSelection(source, id);
    },
    [source],
  );

  // Mirror selection changes made by OTHER mounted providers in this process —
  // the native stand-in for the web cross-tab `storage` listener (web L71-84).
  useEffect(() => {
    return subscribeSelection(source, next => {
      if (next == null) {
        setVehicleIdState(null);
        return;
      }
      if (Number.isFinite(next) && next > 0) setVehicleIdState(next);
    });
  }, [source]);

  return (
    <SelectedVehicleContext.Provider value={{ vehicleId, setVehicleId }}>
      {children}
    </SelectedVehicleContext.Provider>
  );
}

/** Read & write the persisted selected-vehicle id. Returns a no-op
 *  fallback when used outside the provider so tests that mount a
 *  page-level component in isolation degrade gracefully instead of
 *  crashing on a benign read. {@link useSelectedVehicle}'s doc-string
 *  promises this behavior.
 */
export function useSelectedVehicleStore(): SelectedVehicleStoreValue {
  const ctx = useContext(SelectedVehicleContext);
  if (!ctx) {
    return { vehicleId: null, setVehicleId: () => {} };
  }
  return ctx;
}

// Exported for tests; intentionally not part of the public API.
export const __SELECTED_VEHICLE_STORAGE_KEY__ = STORAGE_KEY;
