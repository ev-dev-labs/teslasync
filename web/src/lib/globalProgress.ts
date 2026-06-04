/**
 * GlobalProgress controller.
 *
 * Singleton "is the app busy?" channel that drives the top-of-viewport
 * <TopProgress> bar. Two callers:
 *
 *   1. <SuspenseProgressBoundary> — wraps every code-split route and
 *      starts/stops on Suspense fallback mount/unmount, so chunk
 *      downloads always show the bar.
 *   2. useGlobalProgress — opt-in hook for heavy mutations (file
 *      uploads, exports, bulk operations expected to exceed 800 ms).
 *
 * Concurrency contract: every call to `start` MUST be paired with
 * the returned stop function (`try/finally` or useEffect cleanup).
 * Multiple concurrent starts stack — the bar stays active until the
 * last stop fires. The returned stop is idempotent so React's
 * StrictMode (which double-invokes effects in dev) cannot push the
 * activeCount below zero.
 *
 * While at least one consumer is active, an internal trickle timer
 * advances `progress` asymptotically toward 80 % (NProgress-style),
 * so the bar moves even when the underlying work doesn't report
 * granular progress. When the last consumer stops, progress + active
 * snap back to 0/false.
 */

export type GlobalProgressListener = (active: boolean, progress: number) => void

/** Asymptotic ceiling the trickle approaches but never reaches without an explicit `stop`. */
export const TRICKLE_TARGET = 80
/** Initial jump on the first `start` so the bar is immediately visible. */
export const TRICKLE_INITIAL = 8
/** Tick interval driving the asymptotic trickle. */
export const TRICKLE_INTERVAL_MS = 120

let activeCount = 0
let progress = 0
let trickleHandle: ReturnType<typeof setInterval> | null = null
const listeners = new Set<GlobalProgressListener>()

function publish(): void {
  const active = activeCount > 0
  // Snapshot to a fresh array — listeners may add/remove during dispatch.
  for (const fn of Array.from(listeners)) {
    try {
      fn(active, progress)
    } catch {
      // Listener errors must never break the controller. The frontend
      // error reporter (installed in main.tsx) catches genuine runtime
      // errors via window.error; here we just keep the channel alive.
    }
  }
}

function startTrickle(): void {
  if (trickleHandle !== null) return
  trickleHandle = setInterval(() => {
    if (activeCount === 0) {
      stopTrickle()
      return
    }
    if (progress >= TRICKLE_TARGET) return
    const remaining = TRICKLE_TARGET - progress
    // Move 15 % of the remaining gap each tick — guarantees forward
    // motion (Math.max with 1) without ever crossing the target.
    progress = Math.min(TRICKLE_TARGET, progress + Math.max(1, remaining * 0.15))
    publish()
  }, TRICKLE_INTERVAL_MS)
}

function stopTrickle(): void {
  if (trickleHandle !== null) {
    clearInterval(trickleHandle)
    trickleHandle = null
  }
}

function start(): () => void {
  activeCount++
  if (activeCount === 1) {
    progress = TRICKLE_INITIAL
    startTrickle()
  }
  publish()

  // Closure-local guard so the same stop function can be safely called
  // twice (StrictMode double-invocation, defensive try/finally chains).
  // Without this guard the activeCount would underflow when the same
  // stop fires twice and another consumer is also active.
  let stopped = false
  return function stop(): void {
    if (stopped) return
    stopped = true
    activeCount = Math.max(0, activeCount - 1)
    if (activeCount === 0) {
      stopTrickle()
      progress = 0
      publish()
    }
  }
}

function subscribe(fn: GlobalProgressListener): () => void {
  listeners.add(fn)
  // Replay current state immediately so a listener mounted while the
  // bar is already active doesn't miss the "active" edge.
  try {
    fn(activeCount > 0, progress)
  } catch {
    /* see publish */
  }
  return () => {
    listeners.delete(fn)
  }
}

export const globalProgress = {
  start,
  subscribe,
} as const

// ── Test-only helpers ──────────────────────────────────────────────

// Exposed so each test can run against a clean controller without
// leaking activeCount or trickle timers between cases. The production
// app must NEVER import these — guarded by the leading double-underscore
// naming convention used throughout the codebase (titleStore,
// errorReporter, etc.).

export function __resetGlobalProgressForTests(): void {
  activeCount = 0
  progress = 0
  stopTrickle()
  listeners.clear()
}

export function __getGlobalProgressStateForTests(): {
  activeCount: number
  progress: number
  listeners: number
  trickling: boolean
} {
  return {
    activeCount,
    progress,
    listeners: listeners.size,
    trickling: trickleHandle !== null,
  }
}
