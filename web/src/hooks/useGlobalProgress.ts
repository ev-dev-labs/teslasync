import { useMemo } from 'react'
import { globalProgress } from '@/lib/globalProgress'

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
 * The returned object identity is stable across renders so callers
 * can safely include it in `useEffect` dependency arrays without
 * triggering re-runs.
 */
export function useGlobalProgress() {
  return useMemo(() => ({ start: globalProgress.start }), [])
}
