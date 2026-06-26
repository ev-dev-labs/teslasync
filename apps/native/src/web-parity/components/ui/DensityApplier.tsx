// Native parity port of web/src/components/ui/DensityApplier.tsx.
//
// The web component (source L16-19) mounts useDensitySync() purely for its side
// effect and renders null, so the user's `ui_density` setting is applied to a
// single global location the rest of the UI reads. On the web (source docblock
// L3-15) that location is `document.body.dataset.density`, consumed by the
// `body[data-density="..."]` CSS selectors in web/src/index.css + the Tailwind
// tokens in web/tailwind.config.js.
//
// React Native has neither a DOM body dataset nor those CSS selectors, and the
// web `@/hooks/useDensitySync` hook imported on source L1 is itself browser-only
// (document.body + localStorage). Following the in-file native-safe port pattern
// used by the sibling ConfirmDialog conversion, the useDensitySync behaviour is
// reproduced inline here against:
//   - useSettings() (native parity hook) for the source `ui_density` value, and
//   - an in-memory, subscribable density store standing in for
//     `document.body.dataset.density`. Native screens read the applied density
//     via getCurrentDensity()/subscribeDensity() and map it to spacing tokens.
//
// Explicit unavailable browser capabilities (documented in the sidecar):
//   - document.body.dataset.density  -> in-memory module store + listeners.
//   - localStorage flash-prevention persistence -> unavailable (AsyncStorage is
//     not a dependency of this app), so the persist write is a no-op; the value
//     still applies for the JS runtime's lifetime. The `teslasync-density` key
//     namespace is retained for traceability.
//   - The source docblock's QueryClientProvider-placement note still holds: this
//     carrier must render under the React Query provider so useSettings() works.

import {useEffect, useRef} from 'react';

import {useSettings} from '../../api/hooks/useSettings';

/**
 * Allowed values for the `ui_density` setting. Kept in lockstep with the backend
 * validator (internal/api/settings_handler.go) and the web tokens, mirroring
 * web/src/hooks/useDensitySync.ts.
 */
export type Density = 'compact' | 'comfortable' | 'spacious';

/** Retained key namespace from the web localStorage flash-prevention cache. */
const DENSITY_LS_KEY = 'teslasync-density';
const ALLOWED: readonly Density[] = ['compact', 'comfortable', 'spacious'];

/** Web bootstrap default applied before the settings query resolves. */
const DEFAULT_DENSITY: Density = 'comfortable';

export const nativeDensityApplierCapabilities = {
  documentBodyDatasetAvailable: false,
  localStoragePersistenceAvailable: false,
  inMemoryDensityStoreAvailable: true,
  densityLocalStorageKey: DENSITY_LS_KEY,
} as const;

function isDensity(v: unknown): v is Density {
  return typeof v === 'string' && (ALLOWED as readonly string[]).includes(v);
}

// In-memory analog of `document.body.dataset.density`: a single applied value
// plus subscribers, living for the JS runtime's lifetime (no cross-restart
// persistence — see nativeDensityApplierCapabilities).
let currentDensity: Density = DEFAULT_DENSITY;
const listeners = new Set<() => void>();

/**
 * Read the currently-applied density. Native equivalent of reading
 * `document.body.dataset.density`; defaults to 'comfortable' before the settings
 * query resolves, matching the web bootstrap default in useDensitySync.ts.
 */
export function getCurrentDensity(): Density {
  return currentDensity;
}

/**
 * Subscribe to applied-density changes. Native equivalent of the web CSS
 * `body[data-density="..."]` selectors reacting to the body data attribute.
 * Returns an unsubscribe function.
 */
export function subscribeDensity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function applyDensity(next: Density): void {
  if (currentDensity === next) {
    return;
  }
  currentDensity = next;
  listeners.forEach(listener => {
    listener();
  });
}

/**
 * Native-safe port of web/src/hooks/useDensitySync.ts. Subscribes to the user's
 * `ui_density` setting and applies it to the in-memory density store. Only
 * writes once the settings query has resolved with a valid value that differs
 * from what is currently applied, preventing the default from being clobbered by
 * an undefined/loading state.
 */
export function useDensitySync(): void {
  const {data: settings, isSuccess} = useSettings();
  const lastApplied = useRef<Density | null>(null);

  useEffect(() => {
    if (!isSuccess) {
      return;
    }
    const next = settings?.ui_density;
    if (!isDensity(next)) {
      return;
    }
    if (lastApplied.current === next) {
      return;
    }
    lastApplied.current = next;
    applyDensity(next);
    // localStorage flash-prevention persistence is unavailable on native
    // (AsyncStorage is not a dependency); the write is intentionally a no-op.
  }, [isSuccess, settings?.ui_density]);
}

/**
 * Mounts useDensitySync() so the user's `ui_density` setting is applied to the
 * native in-memory density store. Renders nothing — a pure side-effect carrier
 * that must sit underneath the React Query provider (where useSettings() works)
 * without forcing every screen to import the hook.
 */
export function DensityApplier(): null {
  useDensitySync();
  return null;
}
