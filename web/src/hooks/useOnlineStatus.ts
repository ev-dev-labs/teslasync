import { useEffect, useState } from 'react'
import { getConnectionStatus, onStatusChange } from '@/lib/resilience'

/**
 * useOnlineStatus — subscribe to browser online/offline state.
 *
 * Returns `true` when the browser reports a network connection, `false`
 * otherwise. Backed by `navigator.onLine` and the shared resilience-module
 * status broadcaster (which already wires the `online` / `offline` window
 * events), so every consumer agrees on the same state without duplicating
 * listeners.
 *
 * Use this hook in PWA-aware UI (offline banners, query-error fallbacks,
 * "retry when online" buttons) to render contextual messaging when the
 * user disconnects — e.g. driving through a tunnel on the installed
 * mobile app.
 *
 * Why not just `navigator.onLine`?
 *   - `navigator.onLine` is a one-shot read; React won't re-render on
 *     change without an event subscription.
 *   - Routing both reads through `lib/resilience` means the offline
 *     banner, fetch retry logic, and query error states all share one
 *     source of truth.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() => getConnectionStatus() === 'online')

  useEffect(() => {
    return onStatusChange((status) => {
      setOnline(status === 'online')
    })
  }, [])

  return online
}
