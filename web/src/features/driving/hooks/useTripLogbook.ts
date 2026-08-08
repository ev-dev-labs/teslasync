import { useCallback, useSyncExternalStore } from 'react';

import {
  parseLogbookStore,
  serializeLogbookStore,
  type CategoryMap,
  type LogbookStore,
  type RateMap,
  type TripCategory,
} from '../lib/tripLogbook';

/**
 * localStorage-backed store for the Trip Logbook's classifications and
 * reimbursement rates.
 *
 * Kept client-side (mirroring `useAchievementCelebrationPrefs` /
 * `useStatusBarPrefs`) rather than in the settings table: classification is a
 * per-click interaction over potentially hundreds of drives, so it must apply
 * instantly without a network round-trip and keep working offline. Cross-tab
 * sync rides the `storage` window event, so classifying in one tab live-updates
 * a logbook open in another.
 *
 * Categories are keyed by drive id — drive ids are globally unique across
 * vehicles, so one store serves every vehicle without namespacing.
 */

const STORAGE_KEY = 'teslasync:trip-logbook:v1';

// Stable cache so useSyncExternalStore returns referentially-equal snapshots
// when nothing has changed (otherwise React 18 raises an infinite-render).
let cachedStore: LogbookStore = readStore();
let cachedSerialized = serializeLogbookStore(cachedStore);

function readStore(): LogbookStore {
  try {
    return parseLogbookStore(localStorage.getItem(STORAGE_KEY));
  } catch {
    // localStorage itself may throw (privacy mode); degrade to defaults.
    return parseLogbookStore(null);
  }
}

function getSnapshot(): LogbookStore {
  return cachedStore;
}

function refreshSnapshot(): void {
  const next = readStore();
  const serialized = serializeLogbookStore(next);
  if (serialized !== cachedSerialized) {
    cachedStore = next;
    cachedSerialized = serialized;
  }
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    refreshSnapshot();
    cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function commit(next: LogbookStore): void {
  const serialized = serializeLogbookStore(next);
  if (serialized === cachedSerialized) return;
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Quota / privacy-mode failure: fall through so the current tab still
    // reflects the change in memory for this session.
  }
  cachedStore = next;
  cachedSerialized = serialized;
  for (const cb of listeners) cb();
}

export interface UseTripLogbookResult {
  /** driveId → category; drives absent from the map are unclassified. */
  categories: CategoryMap;
  /** Reimbursement rates per km in major currency units. */
  ratesPerKm: RateMap;
  /** Classify one drive; pass `null` to return it to unclassified. */
  setCategory: (driveId: number, category: TripCategory | null) => void;
  /** Bulk-classify (used by corridor suggestions) in a single commit. */
  setCategories: (entries: readonly { driveId: number; category: TripCategory }[]) => void;
  /** Update one category's per-km rate. Non-finite / negative values are ignored. */
  setRatePerKm: (category: TripCategory, rate: number) => void;
}

export function useTripLogbook(): UseTripLogbookResult {
  const store = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setCategory = useCallback((driveId: number, category: TripCategory | null) => {
    const categories = { ...cachedStore.categories };
    if (category == null) delete categories[driveId];
    else categories[driveId] = category;
    commit({ ...cachedStore, categories });
  }, []);

  const setCategories = useCallback((entries: readonly { driveId: number; category: TripCategory }[]) => {
    if (entries.length === 0) return;
    const categories = { ...cachedStore.categories };
    for (const { driveId, category } of entries) categories[driveId] = category;
    commit({ ...cachedStore, categories });
  }, []);

  const setRatePerKm = useCallback((category: TripCategory, rate: number) => {
    if (!Number.isFinite(rate) || rate < 0) return;
    commit({
      ...cachedStore,
      ratesPerKm: { ...cachedStore.ratesPerKm, [category]: rate },
    });
  }, []);

  return {
    categories: store.categories,
    ratesPerKm: store.ratesPerKm,
    setCategory,
    setCategories,
    setRatePerKm,
  };
}
