import { useSyncExternalStore } from 'react'
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
 *
 * Why `useSyncExternalStore` (not `useState` + `useEffect`)?
 *   - It closes the mount-gap race: if the connection flips in the window
 *     between the initial render-time read and the effect that wires up the
 *     subscription, `useSyncExternalStore` re-reads the snapshot right after
 *     subscribing and reconciles, so consumers never latch a stale value.
 *   - It is tearing-safe under concurrent rendering and matches the store
 *     subscription pattern used across the app's other external-state hooks.
 */

// Module-scope adapters so their identities stay stable across renders —
// passing fresh closures to useSyncExternalStore would force a re-subscribe
// on every render.

function subscribe(onStoreChange: () => void): () => void {
  // onStatusChange invokes its callback with the new status, but the store
  // contract only needs a zero-arg "something changed" signal — React re-reads
  // getSnapshot() itself, so the status argument is intentionally ignored.
  return onStatusChange(onStoreChange)
}

function getSnapshot(): boolean {
  return getConnectionStatus() === 'online'
}

// During SSR / prerender there is no network signal to read, so assume online.
// This keeps an offline banner from flashing before the client hydrates and
// can consult navigator.onLine.
function getServerSnapshot(): boolean {
  return true
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
