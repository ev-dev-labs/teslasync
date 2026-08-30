/**
 * @module hooks/useCrossTabRefresh
 *
 * Makes a refresh in one tab count for all of them.
 *
 * TeslaSync is routinely open in two tabs — a pinned live dashboard on a
 * second monitor and a working tab. When the operator hits refresh (or a
 * recovery path invalidates) in the working tab, the pinned dashboard used to
 * keep showing the pre-refresh values until its own poll came round, which is
 * exactly the window in which someone reads a stale number off the big
 * screen and acts on it.
 *
 * This hook reuses the existing cross-tab infrastructure rather than opening
 * another channel:
 *
 *   - `lib/queryBroadcast.ts::invalidateAndBroadcast` invalidates locally and
 *     coalesces a `queryInvalidate` envelope onto the shared `teslasync`
 *     `BroadcastChannel`;
 *   - `components/QueryBroadcastBridge` (already mounted app-wide) receives it
 *     in the peer tabs and replays the invalidation against their own
 *     QueryClient.
 *
 * Coalescing lives in `queryBroadcast` (50 ms window), so invalidating five
 * keys in a loop still produces a single cross-tab message.
 *
 * ## Deliberately not broadcast
 *
 * SSE reconnect recovery (`useLiveRecovery`) stays local. Every tab holds its
 * own `EventSource` and detects its own outage; broadcasting one tab's
 * recovery would multiply a single reconnect into N tabs' worth of refetches,
 * and would wake hidden tabs that the visibility contract says must stay
 * quiet.
 */

import { useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { invalidateAndBroadcast } from '@/lib/queryBroadcast'

export interface UseCrossTabRefreshOptions {
  /** Query keys to invalidate. Treated as prefixes by TanStack Query. */
  queryKeys: readonly (readonly unknown[])[]
  /**
   * Minimum gap between two broadcast refreshes from THIS tab. Guards against
   * an operator leaning on the refresh button turning into a burst of
   * cross-tab traffic.
   */
  cooldownMs?: number
}

/** Repeated refreshes inside this window are dropped. */
export const DEFAULT_CROSS_TAB_COOLDOWN_MS = 1_000

export interface CrossTabRefresh {
  /**
   * Invalidate the configured keys locally and in every peer tab. Returns
   * `true` when the refresh ran, `false` when it was suppressed by the
   * cooldown — useful for feedback ("already refreshing").
   */
  refresh: () => boolean
}

export function useCrossTabRefresh({
  queryKeys,
  cooldownMs = DEFAULT_CROSS_TAB_COOLDOWN_MS,
}: UseCrossTabRefreshOptions): CrossTabRefresh {
  const queryClient = useQueryClient()
  const keysRef = useRef(queryKeys)
  keysRef.current = queryKeys
  const lastRefreshAtRef = useRef(0)

  const refresh = useCallback((): boolean => {
    const now = Date.now()
    if (now - lastRefreshAtRef.current < cooldownMs) return false
    lastRefreshAtRef.current = now
    for (const queryKey of keysRef.current) {
      invalidateAndBroadcast(queryClient, { queryKey: queryKey as unknown[] })
    }
    return true
  }, [queryClient, cooldownMs])

  return { refresh }
}
