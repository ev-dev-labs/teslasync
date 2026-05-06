import { Suspense, useEffect, type PropsWithChildren, type ReactNode } from 'react'
import { globalProgress } from '@/lib/globalProgress'

/**
 * Phase-46 / Prompt 07 — Suspense → globalProgress bridge.
 *
 * Wraps `<Suspense>` so that whenever the fallback mounts (because a
 * lazy-loaded route chunk is being downloaded) the global progress
 * bar activates, and whenever the real component finally renders the
 * fallback unmounts and the bar deactivates. This gives every
 * `React.lazy()` boundary in the route tree a visible progress
 * affordance without each page wiring its own loader.
 *
 * Wire as a 1:1 replacement for `<Suspense>` at every lazy boundary:
 *
 *     <SuspenseProgressBoundary fallback={<PageLoadSkeleton />}>
 *       <LazyPage />
 *     </SuspenseProgressBoundary>
 */
export function SuspenseProgressBoundary({
  children,
  fallback,
}: PropsWithChildren<{ fallback: ReactNode }>) {
  return <Suspense fallback={<ProgressTrackingFallback>{fallback}</ProgressTrackingFallback>}>{children}</Suspense>
}

/**
 * Internal fallback wrapper — the only point at which `start()` /
 * `stop()` fire. Mounting this component (because Suspense suspended)
 * activates the bar; unmounting it (because the lazy import resolved)
 * deactivates the bar.
 *
 * Implementation note: the `start()` call lives inside `useEffect`,
 * not at render time, because under `React.StrictMode` render bodies
 * may run twice in dev without the matching cleanup. `useEffect`
 * guarantees the start/stop pair fires exactly once per real mount,
 * and the closure-local idempotency guard inside `start()`'s returned
 * stop function defends against StrictMode's effect double-invocation
 * in dev.
 */
function ProgressTrackingFallback({ children }: PropsWithChildren) {
  useEffect(() => {
    const stop = globalProgress.start()
    return stop
  }, [])
  return <>{children}</>
}
