/**
 * @module hooks/useLiveRecovery
 *
 * Recovers missed state after the SSE pipe comes back.
 *
 * ## The gap this closes
 *
 * The backend fans `signal_change` events out over Redis Pub/Sub. Pub/Sub has
 * **no replay**: anything published while a subscriber was disconnected is
 * gone. So a tab that loses its `EventSource` for 40 seconds and then
 * reconnects has a cache that is silently 40 seconds behind, with no error,
 * no spinner and no indication that anything is wrong — the most dangerous
 * failure mode in the whole data path, because the UI looks healthy.
 *
 * The fix is not to ask the stream for history (it cannot provide it) but to
 * re-read the canonical sources on reconnect:
 *
 *   - live current state via the REST live-read endpoints (Redis L2 →
 *     signal.Store L1), and
 *   - durable history via `signal_log`-backed endpoints,
 *
 * which is exactly what invalidating the affected query keys does.
 *
 * ## What it deliberately does NOT do
 *
 *   - It never treats a reconnect as a replay of the missed events.
 *   - It never fires on a connection that was never preceded by a *proven*
 *     connected state. Two distinct cases collapse into this rule:
 *       (a) the ordinary first connect of a session, and
 *       (b) an `EventSource` that errors before it ever opens — `sseManager`
 *           emits `disconnected` for that failure, and treating it as an
 *           outage would make the very first successful connect look like a
 *           recovery and re-fetch everything the page just loaded.
 *     A recovery therefore requires a disconnect that happened *after* a
 *     connection we actually observed.
 *   - Conversely it DOES fire for an outage that began before the hook
 *     mounted. The shared manager replays neither `connected` nor
 *     `disconnected` to a late subscriber, so both the "we have seen a live
 *     pipe" flag and the outage marker are seeded from the manager's own
 *     state at subscribe time.
 *   - It never refetches while the tab is hidden. The pending recovery is
 *     held and flushed on `visibilitychange`, mirroring
 *     `useSignalQueryInvalidation` so this hook cannot reintroduce the
 *     background traffic that `refetchIntervalInBackground: false` exists to
 *     prevent.
 */

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { sseManager } from '@/lib/sseManager'

export interface UseLiveRecoveryOptions {
  /**
   * Query keys re-read after a reconnect. Treated as key *prefixes* by
   * TanStack Query, so `['drives']` recovers every drives query regardless of
   * its scope suffix.
   */
  queryKeys: readonly (readonly unknown[])[]
  enabled?: boolean
  /**
   * Minimum gap between two recoveries. A flapping connection emits
   * connect/disconnect pairs in quick succession; without this a bad network
   * would turn into a refetch storm.
   */
  cooldownMs?: number
  /** Invoked after a recovery actually runs. Primarily for telemetry/tests. */
  onRecover?: (missedForMs: number) => void
}

/** Two reconnects inside this window collapse into a single recovery. */
export const DEFAULT_RECOVERY_COOLDOWN_MS = 5_000

export function useLiveRecovery({
  queryKeys,
  enabled = true,
  cooldownMs = DEFAULT_RECOVERY_COOLDOWN_MS,
  onRecover,
}: UseLiveRecoveryOptions): void {
  const queryClient = useQueryClient()

  // Callers pass an inline array literal; holding it in a ref keeps the
  // effect from resubscribing on every render without forcing memoisation
  // on every call site.
  const keysRef = useRef(queryKeys)
  keysRef.current = queryKeys
  const onRecoverRef = useRef(onRecover)
  onRecoverRef.current = onRecover

  const disconnectedAtRef = useRef<number | null>(null)
  const hasConnectedRef = useRef(false)
  const lastRecoveryAtRef = useRef(0)
  const pendingRef = useRef<number | null>(null)
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCooldownTimer = () => {
    if (cooldownTimerRef.current != null) {
      clearTimeout(cooldownTimerRef.current)
      cooldownTimerRef.current = null
    }
  }

  const recoverRef = useRef<() => void>(() => {})
  recoverRef.current = () => {
    const missedForMs = pendingRef.current
    if (missedForMs == null) return
    // Hidden tabs must not issue network traffic; keep the pending marker so
    // the visibility handler can catch up when the user returns.
    if (typeof document !== 'undefined' && document.hidden) return

    // Inside the cooldown, DEFER — never drop. Returning here without a timer
    // is what let a reconnect that landed a few seconds after a recovery
    // discard its outage marker permanently, so the state missed during that
    // second outage was never re-read and the UI silently stayed behind.
    const now = Date.now()
    const remainingCooldownMs = cooldownMs - (now - lastRecoveryAtRef.current)
    if (remainingCooldownMs > 0) {
      // One timer only: further outages inside the window coalesce into the
      // already-scheduled recovery rather than queueing their own.
      if (cooldownTimerRef.current == null) {
        cooldownTimerRef.current = setTimeout(() => {
          cooldownTimerRef.current = null
          recoverRef.current()
        }, remainingCooldownMs)
      }
      return
    }

    clearCooldownTimer()
    pendingRef.current = null
    lastRecoveryAtRef.current = now
    for (const queryKey of keysRef.current) {
      void queryClient.invalidateQueries({ queryKey: queryKey as unknown[] })
    }
    onRecoverRef.current?.(missedForMs)
  }

  useEffect(() => {
    if (!enabled) return

    // The shared manager does not replay a `connected` event to a late
    // subscriber, so seed both flags from its own state.
    const alreadyConnected = sseManager.getState() === 'connected'
    const everConnected = sseManager.hasEverConnected()
    hasConnectedRef.current = alreadyConnected || everConnected

    // Late mount DURING a real outage: the pipe connected earlier this
    // session and is currently down, which means the `disconnected` event
    // fired before this hook subscribed and will never be replayed. Without
    // seeding the outage marker here, the next `connected` looks like a first
    // connect and the state missed while the pipe was down is never re-read —
    // the silent-staleness failure this hook exists to prevent, now hidden
    // behind a green indicator.
    if (!alreadyConnected && everConnected && disconnectedAtRef.current == null) {
      disconnectedAtRef.current = Date.now()
    }

    const onDisconnected = () => {
      // An EventSource that errors before it ever opened is a failed FIRST
      // connect, not an outage — there is no missed state to recover, because
      // there was never a stream delivering any.
      if (!hasConnectedRef.current) return
      // Record the outage start only once per outage — a flapping pipe can
      // emit several `disconnected` events before the next `connected`.
      if (disconnectedAtRef.current == null) disconnectedAtRef.current = Date.now()
    }

    const onConnected = () => {
      const wasConnected = hasConnectedRef.current
      hasConnectedRef.current = true

      const disconnectedAt = disconnectedAtRef.current
      disconnectedAtRef.current = null
      // Nothing was missed unless we had a proven connection that then
      // dropped: first connect of the session, or first connect after a
      // pre-open error, both land here with `disconnectedAt == null`.
      if (!wasConnected || disconnectedAt == null) return

      const missedForMs = Math.max(0, Date.now() - disconnectedAt)
      // Coalesce: several outages inside one cooldown collapse into a single
      // recovery, and the longest gap wins so the reported window is honest.
      pendingRef.current = Math.max(pendingRef.current ?? 0, missedForMs)
      recoverRef.current()
    }

    const onVisible = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      recoverRef.current()
    }

    sseManager.subscribe('disconnected', onDisconnected)
    sseManager.subscribe('connected', onConnected)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible)
    }

    return () => {
      sseManager.unsubscribe('disconnected', onDisconnected)
      sseManager.unsubscribe('connected', onConnected)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible)
      }
      // A deferred recovery must not fire into an unmounted consumer.
      clearCooldownTimer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clearCooldownTimer
    // is a stable ref-based closure; including it would resubscribe every render.
  }, [enabled, cooldownMs])
}
