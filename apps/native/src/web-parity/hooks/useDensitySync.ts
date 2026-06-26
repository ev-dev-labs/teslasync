/**
 * useDensitySync — native-safe port of web/src/hooks/useDensitySync.ts.
 *
 * Web parity source: web/src/hooks/useDensitySync.ts.
 *
 * On the web this hook subscribes to the user's `ui_density` setting and applies
 * the resolved value to a single global location the rest of the UI reads:
 * `document.body.dataset.density`. The `body[data-density="..."]` CSS selectors in
 * web/src/index.css (backed by the Tailwind tokens in web/tailwind.config.js) then
 * react to that attribute, and the value is mirrored into localStorage so the next
 * page load can bootstrap the correct density synchronously without a flash of the
 * wrong spacing.
 *
 * React Native has neither a DOM `<body>` dataset nor those CSS selectors, and no
 * localStorage. This port keeps the exact public surface and behaviour of the web
 * hook (`Density`, `getCurrentDensity`, `useDensitySync`) while routing the two
 * browser-only seams through native-safe analogs:
 *
 *   - `document.body.dataset.density` -> an in-memory, subscribable module store
 *     (`currentDensity` + listeners). `getCurrentDensity()` reads it (exactly like
 *     the web getter reads the body dataset) and `subscribeDensity()` lets native
 *     screens react to changes, standing in for the web CSS attribute reactivity.
 *     Screens map the value to spacing tokens at the render boundary — the native
 *     analog of the web density CSS variables.
 *   - localStorage flash-prevention persistence -> unavailable (AsyncStorage is not
 *     a dependency of this app), so the persist write is an explicit no-op; the
 *     value still applies for the JS runtime's lifetime. The `teslasync-density` key
 *     namespace is retained for traceability and a future AsyncStorage adapter drops
 *     in at `persistDensity` without changing the hook contract. See
 *     `nativeDensitySyncCapabilities`.
 *
 * The source's QueryClientProvider-placement note still holds: any carrier that
 * mounts this hook (see DensityApplier) must render under the React Query provider
 * so the native `useSettings()` query resolves.
 *
 * No DOM modules, browser HTML elements, Recharts, Leaflet, localStorage, or old web
 * UI components are imported here.
 */
import {useEffect, useRef} from 'react';

import {useSettings} from '../api/hooks/useSettings';

/**
 * Allowed values for the `ui_density` setting. Kept in lockstep with the backend
 * validator in `internal/api/settings_handler.go` and the Tailwind tokens in
 * `web/tailwind.config.js`, mirroring web/src/hooks/useDensitySync.ts.
 */
export type Density = 'compact' | 'comfortable' | 'spacious';

/** Retained key namespace from the web localStorage flash-prevention cache. */
const DENSITY_LS_KEY = 'teslasync-density';
const ALLOWED: readonly Density[] = ['compact', 'comfortable', 'spacious'];

/**
 * Web bootstrap default. On the web this is the value `getCurrentDensity()` falls
 * back to before the settings query resolves (web source L24/L26); here it seeds the
 * in-memory store to the same value.
 */
const DEFAULT_DENSITY: Density = 'comfortable';

/**
 * Capability descriptor for the native density seam. Mirrors the explicit
 * "unavailable" pattern used by the other web-parity ports so callers can branch on
 * what the platform can actually do instead of discovering it via a thrown error.
 */
export const nativeDensitySyncCapabilities = {
  documentBodyDatasetAvailable: false,
  localStoragePersistenceAvailable: false,
  inMemoryDensityStoreAvailable: true,
  densityLocalStorageKey: DENSITY_LS_KEY,
} as const;

function isDensity(v: unknown): v is Density {
  return typeof v === 'string' && (ALLOWED as readonly string[]).includes(v);
}

// In-memory analog of `document.body.dataset.density`: a single applied value plus
// subscribers, living for the JS runtime's lifetime (no cross-restart persistence —
// see nativeDensitySyncCapabilities).
let currentDensity: Density = DEFAULT_DENSITY;
const listeners = new Set<() => void>();

/**
 * Read the bootstrapped / applied density. Native equivalent of the web getter that
 * reads `document.body.dataset.density`; defaults to 'comfortable' before the
 * settings query resolves, matching the web bootstrap default.
 */
export function getCurrentDensity(): Density {
  return currentDensity;
}

/**
 * Subscribe to applied-density changes. Native equivalent of the web CSS
 * `body[data-density="..."]` selectors reacting to the body data attribute. Returns
 * an unsubscribe function.
 */
export function subscribeDensity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Apply a density to the in-memory store and notify subscribers. Native analog of
 * the web `document.body.dataset.density = next` write.
 */
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
 * Native analog of the web localStorage flash-prevention write
 * (`localStorage.setItem(DENSITY_LS_KEY, next)`, web source L53-57). React Native has
 * no localStorage and AsyncStorage is not a dependency, so this is an explicit no-op
 * until a platform persistence adapter is wired in here — see
 * nativeDensitySyncCapabilities. The web try/catch that swallows quota/disabled
 * errors has no native counterpart because there is no write to fail.
 */
function persistDensity(_next: Density): void {
  // Intentional no-op: localStorage flash-prevention persistence is unavailable on
  // native. The DENSITY_LS_KEY namespace is retained for a future AsyncStorage adapter.
}

/**
 * Subscribes to the user's `ui_density` setting and applies it to the in-memory
 * density store (the native stand-in for `document.body.dataset.density`). Also
 * "persists" the value via persistDensity so a future load could bootstrap without a
 * flash of the wrong density — a no-op on native today.
 *
 * Only writes when the settings query has actually resolved with a valid value AND
 * the value differs from what is currently applied — this prevents the bootstrap
 * value from being clobbered by an undefined/loading state.
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
    persistDensity(next);
  }, [isSuccess, settings?.ui_density]);
}
