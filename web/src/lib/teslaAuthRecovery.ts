/**
 * @module teslaAuthRecovery
 *
 * Best-effort queue and replay for mutations that failed because the
 * user's third-party Tesla refresh token expired.
 *
 * When a Tesla-bound mutation throws {@link TeslaAuthExpiredError},
 * mutation hooks call {@link queueTeslaMutation} with a closure that
 * re-issues the original request. After the user reconnects, the
 * <TeslaAccountSection> emits a `teslasync:tesla-auth-recovered` event;
 * the <TeslaReauthBanner> consumes it and calls
 * {@link drainQueuedTeslaMutations}, which replays each queued closure
 * in FIFO order.
 *
 * Constraints (all intentional):
 *   • TTL 5 minutes — older entries are dropped silently. Users who
 *     reconnect later are not surprised by stale commands firing.
 *   • Cap 10 entries — keeps the queue bounded; further attempts during
 *     the disconnected window are dropped at queue-time.
 *   • Per-tab only — the queue lives in module memory; reload clears it.
 *   • Replay errors are swallowed — the underlying hook's normal
 *     onError path (toast / error boundary) surfaces them again.
 */

interface QueuedMutation {
  at: number
  replay: () => Promise<unknown>
}

const QUEUE: QueuedMutation[] = []

/** Maximum number of pending mutations held during the disconnected window. */
export const TESLA_AUTH_QUEUE_MAX = 10

/** Mutations older than this are dropped silently when the queue drains. */
export const TESLA_AUTH_QUEUE_TTL_MS = 5 * 60 * 1000

/**
 * Adds a mutation replay closure to the queue. The closure should
 * re-invoke the original mutation with the user's original arguments
 * (typically `() => mutate(originalVariables)` from the hook's onError
 * callback).
 *
 * Drops the entry silently when the queue is full — the user has
 * already had visible error feedback for the original failure, and a
 * "queue full" toast on top of that would be noise.
 */
export function queueTeslaMutation(replay: () => Promise<unknown>): void {
  if (QUEUE.length >= TESLA_AUTH_QUEUE_MAX) return
  QUEUE.push({ at: Date.now(), replay })
}

/**
 * Replays every queued mutation that is still within the TTL window, in
 * FIFO order. Resolves once every replay has settled (success or
 * failure); replay errors are swallowed because the underlying mutation
 * hook's own onError surfaces them again.
 *
 * Idempotent — calling repeatedly with no queued entries is a no-op.
 */
export async function drainQueuedTeslaMutations(): Promise<void> {
  if (QUEUE.length === 0) return
  const now = Date.now()
  const drained = QUEUE.splice(0, QUEUE.length)
  const live = drained.filter(q => now - q.at <= TESLA_AUTH_QUEUE_TTL_MS)
  for (const item of live) {
    try {
      await item.replay()
    } catch {
      /* surfaces in the mutation's normal onError → toast path */
    }
  }
}

/**
 * Emits the `teslasync:tesla-auth-recovered` event. Called by the
 * Tesla-account UI when an auth-status poll flips from `authenticated:
 * false` to `authenticated: true`, or when a manual refresh succeeds.
 *
 * The matching listener lives in {@link TeslaReauthBanner} which both
 * hides the banner and triggers the queue drain.
 */
export function notifyTeslaAuthRecovered(): void {
  if (typeof document === 'undefined') return
  document.dispatchEvent(new CustomEvent('teslasync:tesla-auth-recovered'))
}

/** Test-only — wipes the queue. Not exported from the barrel. */
export function _resetTeslaAuthRecoveryQueue(): void {
  QUEUE.length = 0
}

/** Test-only — current queue depth (does not drain). */
export function _peekTeslaAuthRecoveryQueueSize(): number {
  return QUEUE.length
}
