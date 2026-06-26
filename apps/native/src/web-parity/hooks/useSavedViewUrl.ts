/**
 * useSavedViewUrl — native-safe port of web/src/hooks/useSavedViewUrl.ts.
 *
 * Web parity source: web/src/hooks/useSavedViewUrl.ts.
 *
 * On the web this hook wires the route's URL query string into the
 * `<SavedViewMenu>` contract. It reads the canonical current querystring (with
 * no leading '?') from react-router-dom's `useLocation().search` and exposes an
 * `apply(query)` callback that replaces the entire querystring via
 * `useSearchParams()`'s `setSearchParams(new URLSearchParams(query))`. Adopting
 * pages call `apply('')` to reset to the unfiltered URL when the user clicks the
 * badge's clear button. The hook exists so every adopting page (EnergyPage,
 * StatisticsPage, ChargingListPage, CostAnalysisPage, EfficiencyPage,
 * DrivesListPage, TripListPage, AlertsListPage, SignalsWorkspacePage,
 * SignalDiffPage) avoids duplicating the same
 * `location.search.replace(/^\?/, '')` + `setSearchParams(new
 * URLSearchParams(q))` boilerplate.
 *
 * React Native has no browser URL and no react-router location/history to read
 * the query string from or navigate. This native-safe port keeps the exact
 * public surface and behaviour of the web hook (`{ currentQuery, apply }`) while
 * backing the "URL query string" with a tiny in-process, subscribable module
 * store — the same approach the sibling useAlertContext.ts port and the inlined
 * EfficiencyPage.tsx URL store use. `apply(query)` replaces the stored
 * querystring (the analog of navigating to `…?<query>`) and `apply('')` clears
 * it (the analog of resetting to the unfiltered URL); `currentQuery` reads the
 * canonical stored value back, exactly like the web hook reads `location.search`
 * sans '?'. Until something calls `apply`/`replaceSavedViewQuery` the query is
 * empty — exactly like a fresh web URL carrying no params.
 *
 * The web `{ replace: false }` history-push semantics have no native counterpart
 * (there is no browser history stack here); only the querystring-replacement
 * behaviour is preserved. See {@link nativeSavedViewUrlCapabilities}.
 *
 * No DOM modules, browser HTML elements, Recharts, Leaflet, or old web UI
 * components are imported here.
 */
import {useCallback, useSyncExternalStore} from 'react';

/**
 * Capability descriptor for the native saved-view URL seam. Mirrors the explicit
 * "unavailable" pattern used by the other web-parity ports so callers can branch
 * on what the platform can actually do instead of discovering it via a thrown
 * error.
 */
export const nativeSavedViewUrlCapabilities = {
  /** No browser `window.location` / URL to read or write. */
  browserUrlAvailable: false,
  /** No react-router-dom `useLocation`/`useSearchParams` on native. */
  reactRouterLocationAvailable: false,
  /** The querystring is backed by an in-process module store instead. */
  inMemoryQueryStoreAvailable: true,
  /** No browser history stack, so web's `{ replace: false }` push is a no-op. */
  historyPushReplaceAvailable: false,
} as const;

/* ------------------------------------------------------------------ */
/*  native-safe URL query store (web react-router location/search)    */
/* ------------------------------------------------------------------ */

// In-memory analog of `location.search` (sans leading '?'): a single canonical
// querystring plus subscribers, living for the JS runtime's lifetime (no
// cross-restart persistence). This is the native stand-in for the single shared
// URL the web hook reads from and writes to.
let currentQuerySnapshot = '';
const listeners = new Set<() => void>();

/**
 * Read the canonical current querystring (no leading '?'). Native equivalent of
 * the web hook reading `location.search` and stripping a leading '?'.
 */
export function getSavedViewQuery(): string {
  return currentQuerySnapshot;
}

/**
 * Subscribe to querystring changes. Native equivalent of react-router
 * re-rendering consumers when `location.search` changes. Returns an unsubscribe
 * function.
 */
export function subscribeSavedViewQuery(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Replace the entire stored querystring, the native analog of the web
 * `setSearchParams(new URLSearchParams(query), { replace: false })`. The value
 * is normalized through `URLSearchParams` so the stored/exposed form matches the
 * serialized querystring react-router would put in `location.search` (and a
 * leading '?' is stripped). An empty string clears all params, matching
 * `apply('')`'s reset-to-unfiltered behaviour.
 *
 * Exported as a module function so the native navigation / deep-link layer can
 * seed or restore a saved view's params from outside React — the analog of the
 * web navigating to `…?<query>`.
 */
export function replaceSavedViewQuery(query: string): void {
  // Strip a leading '?' defensively (web's location.search includes it; the URL
  // spec also strips it) before normalizing via URLSearchParams.
  const raw = query.startsWith('?') ? query.slice(1) : query;
  const next = new URLSearchParams(raw).toString();
  if (next === currentQuerySnapshot) {
    return;
  }
  currentQuerySnapshot = next;
  listeners.forEach(listener => {
    listener();
  });
}

/**
 * Clear all saved-view params (native analog of `apply('')` / navigating to the
 * unfiltered URL). Convenience wrapper over {@link replaceSavedViewQuery}.
 */
export function clearSavedViewQuery(): void {
  replaceSavedViewQuery('');
}

/**
 * Wires the in-process query store into the `<SavedViewMenu>` contract.
 *
 * Returns the canonical current querystring (no leading '?') and an `apply`
 * callback that replaces it. Pages call `apply('')` to reset to the unfiltered
 * state when the user clicks the badge's clear button.
 *
 * The `apply` identity is stable across renders (memoized with no deps, since it
 * only calls the module-level writer) so callers can safely include it in
 * `useEffect`/`useCallback` dependency arrays — matching the web hook's
 * `useCallback(..., [setSearchParams])` where `setSearchParams` is stable.
 */
export function useSavedViewUrl(): {
  currentQuery: string;
  apply: (query: string) => void;
} {
  const currentQuery = useSyncExternalStore(
    subscribeSavedViewQuery,
    getSavedViewQuery,
    getSavedViewQuery,
  );

  const apply = useCallback((query: string) => {
    // replaceSavedViewQuery normalizes via URLSearchParams and notifies
    // subscribers; an empty string clears all params.
    replaceSavedViewQuery(query);
  }, []);

  return {currentQuery, apply};
}
