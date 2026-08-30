import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { getProductPreferencesSnapshot } from '@/lib/productPreferences';

/**
 * Selected-vehicle store.
 *
 * Persistent global state for "the vehicle the user is currently focused on".
 * Survives reloads via localStorage. When the user has configured a default
 * vehicle, that explicit startup preference wins over the last active
 * selection; otherwise the previous sticky-selection behavior is preserved.
 *
 * The store deliberately does NOT know about the vehicles list, URL params,
 * or alert context. Pages should consume `useSelectedVehicle()` (which
 * composes the store with URL/list awareness) rather than this store
 * directly.
 *
 * The header `<VehiclePicker>` and the page-side `useSelectedVehicle()` hook
 * are the only intended writers. URL params (`/vehicles/:id`,
 * `?vehicle_id=N`) flow into the store via `useSelectedVehicle()`.
 */

const STORAGE_KEY = 'teslasync-selected-vehicle';

export interface SelectedVehicleStoreValue {
  vehicleId: number | null;
  setVehicleId: (id: number | null) => void;
}

function loadInitial(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const preferred =
      getProductPreferencesSnapshot().defaultVehicleId;
    if (preferred != null) return preferred;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function persist(id: number | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id == null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, String(id));
    }
  } catch {
    // localStorage unavailable (private browsing, quota, SSR) — selection
    // still works for the current session, just doesn't survive reload.
  }
}

const SelectedVehicleContext = createContext<SelectedVehicleStoreValue | null>(null);

export function SelectedVehicleProvider({ children }: { children: ReactNode }) {
  const [vehicleId, setVehicleIdState] = useState<number | null>(loadInitial);

  const setVehicleId = useCallback((id: number | null) => {
    setVehicleIdState(id);
    persist(id);
  }, []);

  // Listen for cross-tab updates so two open tabs stay in sync.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue == null) {
        setVehicleIdState(null);
        return;
      }
      const n = Number(e.newValue);
      if (Number.isFinite(n) && n > 0) setVehicleIdState(n);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

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
