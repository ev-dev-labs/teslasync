/**
 * useGlobalProgress — native-safe port of web/src/hooks/useGlobalProgress.ts.
 *
 * Web parity source: web/src/hooks/useGlobalProgress.ts.
 *
 * Opt-in hook for heavy mutations.
 *
 * Returns the {@link globalProgress} controller (currently just `start()`) so
 * callers can bind a long-running mutation's lifecycle to the global
 * top-progress strip:
 *
 *     const progress = useGlobalProgress();
 *     useEffect(() => {
 *       if (!mutation.isPending) return;
 *       const stop = progress.start();
 *       return stop;
 *     }, [mutation.isPending, progress]);
 *
 * Adopt for mutations expected to exceed ~800 ms (file uploads, exports, bulk
 * operations). Quick (<1 s) mutations should keep their per-button spinner —
 * the global strip is for work that outlives the user's attention to a single
 * control.
 *
 * The returned object identity is stable across renders so callers can safely
 * include it in `useEffect` dependency arrays without triggering re-runs.
 *
 * Pure React + the native globalProgress controller (which itself imports no
 * DOM modules, browser HTML elements, Recharts, Leaflet, or old web UI
 * components). The web `@/lib/globalProgress` import is rewired to the native
 * parity controller at ../lib/globalProgress.
 */
import { useMemo } from 'react';

import { globalProgress } from '../lib/globalProgress';

export function useGlobalProgress() {
  return useMemo(() => ({ start: globalProgress.start }), []);
}
