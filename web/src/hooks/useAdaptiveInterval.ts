import { sseManager } from '../lib/sseManager'
import { useEffect, useState } from 'react'

/**
 * Returns adaptive polling interval based on SSE connection state.
 * - SSE connected: slow poll (fallback only) — 30s
 * - SSE reconnecting/unavailable: fast poll (primary data source) — 3s
 *
 * Usage: `refetchInterval: useAdaptiveInterval()`
 */
export function useAdaptiveInterval(fastMs = 3000, slowMs = 30_000): number {
  const [interval, setInterval_] = useState(() =>
    sseManager.getState() === 'connected' ? slowMs : fastMs
  )

  useEffect(() => {
    const onConnected = () => setInterval_(slowMs)
    const onDisconnected = () => setInterval_(fastMs)

    sseManager.subscribe('connected', onConnected)
    sseManager.subscribe('disconnected', onDisconnected)

    // Sync on mount
    setInterval_(sseManager.getState() === 'connected' ? slowMs : fastMs)

    return () => {
      sseManager.unsubscribe('connected', onConnected)
      sseManager.unsubscribe('disconnected', onDisconnected)
    }
  }, [fastMs, slowMs])

  return interval
}
