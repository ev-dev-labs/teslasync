import { useCallback, useSyncExternalStore } from 'react';

import { isValidBudgetConfig, type MileageBudgetConfig } from '../lib/mileageBudget';

/**
 * localStorage-backed configuration for the Mileage Budget page (lease /
 * warranty allowance terms). Client-side by the same reasoning as
 * `useTripLogbook`: instant edits, offline-safe, cross-tab via the `storage`
 * event. One config per browser profile — allowance terms are per-owner, not
 * per-vehicle, and the page scopes the drive data by the selected vehicle.
 */

const STORAGE_KEY = 'teslasync:mileage-budget:v1';

function seedConfig(): MileageBudgetConfig {
  // Default to a common 3-year / 15,000 km-per-year lease starting Jan 1 of
  // the current year — visible immediately, obviously editable.
  const year = new Date().getFullYear();
  return {
    annualAllowanceKm: 15_000,
    termStartIso: `${year}-01-01`,
    termMonths: 36,
    overagePerKm: 0.1,
  };
}

function parseConfig(raw: string | null): MileageBudgetConfig {
  const fallback = seedConfig();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<MileageBudgetConfig>;
    const candidate: MileageBudgetConfig = {
      annualAllowanceKm:
        typeof parsed.annualAllowanceKm === 'number' ? parsed.annualAllowanceKm : fallback.annualAllowanceKm,
      termStartIso: typeof parsed.termStartIso === 'string' ? parsed.termStartIso : fallback.termStartIso,
      termMonths: typeof parsed.termMonths === 'number' ? parsed.termMonths : fallback.termMonths,
      overagePerKm: typeof parsed.overagePerKm === 'number' ? parsed.overagePerKm : fallback.overagePerKm,
    };
    return isValidBudgetConfig(candidate) ? candidate : fallback;
  } catch {
    return fallback;
  }
}

function readConfig(): MileageBudgetConfig {
  try {
    return parseConfig(localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseConfig(null);
  }
}

// Stable cache so useSyncExternalStore returns referentially-equal snapshots
// when nothing has changed (otherwise React 18 raises an infinite-render).
let cachedConfig: MileageBudgetConfig = readConfig();
let cachedSerialized = JSON.stringify(cachedConfig);

function getSnapshot(): MileageBudgetConfig {
  return cachedConfig;
}

function refreshSnapshot(): void {
  const next = readConfig();
  const serialized = JSON.stringify(next);
  if (serialized !== cachedSerialized) {
    cachedConfig = next;
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

export interface UseMileageBudgetResult {
  config: MileageBudgetConfig;
  /** Patch the config; invalid resulting configs are ignored. */
  update: (patch: Partial<MileageBudgetConfig>) => void;
}

export function useMileageBudget(): UseMileageBudgetResult {
  const config = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const update = useCallback((patch: Partial<MileageBudgetConfig>) => {
    const next: MileageBudgetConfig = { ...cachedConfig, ...patch };
    if (!isValidBudgetConfig(next)) return;
    const serialized = JSON.stringify(next);
    if (serialized === cachedSerialized) return;
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // Quota / privacy-mode failure: keep the in-memory copy for this tab.
    }
    cachedConfig = next;
    cachedSerialized = serialized;
    for (const cb of listeners) cb();
  }, []);

  return { config, update };
}
