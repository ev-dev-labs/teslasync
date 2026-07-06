import { globalProgress } from '@/lib/globalProgress'

/**
 * Narrow controller surface returned by {@link useGlobalProgress}.
 *
 * Deliberately a subset of the {@link globalProgress} singleton — only
 * `start` is handed to consumers; `subscribe` stays private to the
 * <TopProgress> renderer.
 */
export interface GlobalProgressHandle {
  /**
   * Begin a global-progress span; returns its stop function.
   *
   * The returned stop is idempotent and MUST be paired with the start
   * (via `try/finally` or a `useEffect` cleanup) so the top bar clears
   * when the work finishes.
   */
  start: () => () => void
}

// Hoisted, frozen singleton so the handle's identity is *guaranteed*
// stable for the module's lifetime (see the stability note on the hook
// below). `globalProgress.start` does not close over `this`, so
// referencing it bare here is safe.
const HANDLE: GlobalProgressHandle = Object.freeze({ start: globalProgress.start })

/**
 * Opt-in hook for heavy mutations.
 *
 * Returns the {@link globalProgress} controller (currently just
 * `start()`) so callers can bind a long-running mutation's lifecycle
 * to the global top-progress bar:
 *
 *     const progress = useGlobalProgress()
 *     useEffect(() => {
 *       if (!mutation.isPending) return
 *       const stop = progress.start()
 *       return stop
 *     }, [mutation.isPending, progress])
 *
 * Adopt for mutations expected to exceed ~800 ms (file uploads,
 * exports, bulk operations). Quick (<1 s) mutations should keep
 * their per-button spinner — the global bar is for work that
 * outlives the user's attention to a single control.
 *
 * The returned handle's identity is stable across renders (and across
 * every component instance) so callers can safely include it in
 * `useEffect` dependency arrays without triggering re-runs. A hoisted
 * constant is used rather than `useMemo(() => …, [])` because React
 * treats memo caches as a best-effort optimisation and may discard
 * them — which would silently break that dependency-array contract.
 */
export function useGlobalProgress(): GlobalProgressHandle {
  return HANDLE
}
