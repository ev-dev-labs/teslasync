import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { subscribe } from '@/lib/broadcast'

/**
 * Phase-40 / Prompt 69 — listens for `queryInvalidate` messages from other
 * tabs and re-runs the corresponding `invalidateQueries(...)` against this
 * tab's QueryClient.
 *
 * Mount once, near the top of the React tree but INSIDE the
 * QueryClientProvider so `useQueryClient()` resolves. The component
 * renders nothing.
 *
 * The bridge intentionally calls the bare `qc.invalidateQueries(...)` —
 * NOT `invalidateAndBroadcast(...)` — to avoid an infinite ping-pong
 * between tabs A and B re-broadcasting each other's invalidations.
 */
export function QueryBroadcastBridge() {
  const qc = useQueryClient()
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type !== 'queryInvalidate') return
      for (const key of msg.keys) {
        // QueryKey is `readonly unknown[]` in TanStack — cast through
        // the same shape we received over the wire.
        void qc.invalidateQueries({ queryKey: key as unknown[] })
      }
    })
  }, [qc])
  return null
}
