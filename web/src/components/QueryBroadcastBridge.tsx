import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { subscribe } from '@/lib/broadcast'

/**
 * listens for `queryInvalidate` messages from other
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
export function QueryBroadcastBridge(): null {
  const qc = useQueryClient()
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type !== 'queryInvalidate') return
      // A peer tab may be running a different app version, so the wire
      // payload is NOT guaranteed to match our current type. Guard both
      // the `keys` array and each entry defensively: a missing/non-array
      // `keys` would otherwise throw inside the bus subscriber (silently
      // dropping the invalidation), and a non-array entry would be handed
      // to invalidateQueries as an invalid QueryKey.
      const keys = Array.isArray(msg.keys) ? msg.keys : []
      for (const key of keys) {
        if (!Array.isArray(key)) continue
        // QueryKey is `readonly unknown[]` in TanStack — cast through
        // the same shape we received over the wire.
        void qc.invalidateQueries({ queryKey: key as unknown[] })
      }
    })
  }, [qc])
  return null
}
