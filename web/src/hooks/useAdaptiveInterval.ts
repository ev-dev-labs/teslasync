import { sseManager } from '../lib/sseManager'
import { useEffect, useState } from 'react'

/** Default poll cadences — also used to repair invalid caller input. */
const DEFAULT_FAST_MS = 3000
const DEFAULT_SLOW_MS = 30_000

/**
 * Coerce a caller-supplied cadence to a positive, finite millisecond value.
 *
 * The result is fed straight into TanStack Query's `refetchInterval`, where a
 * non-finite (`NaN`/`Infinity`) or non-positive value silently breaks the
 * SSE-fallback contract: `<= 0` disables polling entirely and `NaN` throws off
 * the scheduler. Rather than propagate that, invalid input falls back to the
 * documented default. Valid positive cadences are returned untouched.
 */
function sanitizeInterval(ms: number, fallback: number): number {
  return Number.isFinite(ms) && ms > 0 ? ms : fallback
}

/**
 * Returns adaptive polling interval based on SSE connection state.
 * - SSE connected: slow poll (fallback only) — 30s
 * - SSE reconnecting: fast poll (primary data source) — 3s
 *
 * Usage: `refetchInterval: useAdaptiveInterval()`
 */
export function useAdaptiveInterval(
  fastMs = DEFAULT_FAST_MS,
  slowMs = DEFAULT_SLOW_MS,
): number {
  const fast = sanitizeInterval(fastMs, DEFAULT_FAST_MS)
  const slow = sanitizeInterval(slowMs, DEFAULT_SLOW_MS)

  const [interval, setInterval_] = useState(() =>
    sseManager.getState() === 'connected' ? slow : fast,
  )

  useEffect(() => {
    const onConnected = () => setInterval_(slow)
    const onDisconnected = () => setInterval_(fast)

    sseManager.subscribe('connected', onConnected)
    sseManager.subscribe('disconnected', onDisconnected)

    // Sync on mount — the wire state can change between the lazy `useState`
    // initializer (render phase) and this effect committing (after paint).
    setInterval_(sseManager.getState() === 'connected' ? slow : fast)

    return () => {
      sseManager.unsubscribe('connected', onConnected)
      sseManager.unsubscribe('disconnected', onDisconnected)
    }
  }, [fast, slow])

  return interval
}
