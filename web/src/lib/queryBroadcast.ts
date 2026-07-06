import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { broadcast } from './broadcast'

/**
 * TanStack Query cross-tab invalidation.
 *
 * Wraps `queryClient.invalidateQueries` so the same cache invalidation also
 * fires across other open tabs. Other tabs receive a `queryInvalidate`
 * message via {@link broadcast} and their {@link QueryBroadcastBridge}
 * subscriber re-runs the invalidation against their own QueryClient.
 *
 * ## Coalescing
 *
 * A single mutation handler often invalidates several keys back-to-back
 * (e.g. notifications.read flips both `alerts` and `unread-count`).
 * Without coalescing, every invalidation would fire its own bus message,
 * and the receiving tabs would each invalidate one-at-a-time. Coalescing
 * batches all invalidations from a single tick (50 ms) into a single
 * envelope.
 */

interface PendingEntry {
  key: ReadonlyArray<unknown>
  serialized: string
}

let pending: Map<string, PendingEntry> = new Map()
let timer: ReturnType<typeof setTimeout> | null = null
const COALESCE_MS = 50

function flush(): void {
  timer = null
  if (pending.size === 0) return
  const keys = Array.from(pending.values()).map((e) => e.key)
  pending = new Map()
  broadcast({ type: 'queryInvalidate', keys })
}

function scheduleFlush(): void {
  if (timer != null) return
  timer = setTimeout(flush, COALESCE_MS)
}

function enqueue(key: ReadonlyArray<unknown>): void {
  let serialized: string
  try {
    serialized = JSON.stringify(key)
  } catch {
    // Query keys with circular refs / non-serializable members can't be
    // sent over the bus anyway — skip silently. The local invalidation
    // still happened.
    return
  }
  pending.set(serialized, { key, serialized })
  scheduleFlush()
}

/**
 * Locally invalidate a query AND broadcast the invalidation to every other
 * tab. Use this in mutation `onSuccess` handlers wherever the underlying
 * data is shared across tabs (alert rules, vehicles, automations, etc.).
 *
 * For purely local-UI invalidations (e.g. one-shot "refresh now" buttons,
 * dev-tools, admin pokes), keep using `qc.invalidateQueries(...)` directly
 * — there's no point bothering other tabs with the user's per-click intent.
 */
export function invalidateAndBroadcast(
  qc: QueryClient,
  filters: { queryKey: QueryKey },
): void {
  void qc.invalidateQueries(filters)
  // Cast through unknown[] to satisfy ReadonlyArray<unknown> on the wire.
  enqueue(filters.queryKey as ReadonlyArray<unknown>)
}

/**
 * Test-only helper: drains any pending coalesce timer immediately.
 *
 * Cancels the scheduled timer (if any) and flushes synchronously. `flush`
 * is a no-op when nothing is queued, so this is safe to call unconditionally
 * — and it still drains a queued batch even in the (defensive) case where a
 * timer was never armed, rather than silently stranding the pending keys.
 */
export function __flushQueryBroadcastForTests(): void {
  if (timer != null) {
    clearTimeout(timer)
    timer = null
  }
  flush()
}

/**
 * Test-only helper: cancels any pending coalesce timer and drops every queued
 * invalidation WITHOUT broadcasting. Use in test teardown to isolate the
 * module-level `pending`/`timer` state between cases (mirrors
 * `__resetBroadcastForTests` in `./broadcast`).
 */
export function __resetQueryBroadcastForTests(): void {
  if (timer != null) {
    clearTimeout(timer)
    timer = null
  }
  pending = new Map()
}
