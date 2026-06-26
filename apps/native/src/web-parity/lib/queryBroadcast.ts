// Native parity port of web/src/lib/queryBroadcast.ts.
//
// TanStack Query cross-surface invalidation.
//
// Wraps `queryClient.invalidateQueries` so the same cache invalidation also
// fires across other open surfaces. Other surfaces receive a `queryInvalidate`
// message via {@link broadcast} and their `QueryBroadcastBridge` subscriber
// re-runs the invalidation against their own QueryClient.
//
// ## Coalescing
//
// A single mutation handler often invalidates several keys back-to-back
// (e.g. notifications.read flips both `alerts` and `unread-count`). Without
// coalescing, every invalidation would fire its own bus message, and the
// receiving surfaces would each invalidate one-at-a-time. Coalescing batches
// all invalidations from a single tick (50 ms) into a single envelope.
//
// ## Native conversion (contract rule 6)
//
// This is non-visual utility code: a coalescing layer over the cross-surface
// `broadcast` bus. It touches no DOM, no browser HTML elements, no
// Recharts/Leaflet, and no web UI components — the only platform primitives it
// uses are `setTimeout`/`clearTimeout`, `Map`, `Array.from`, and
// `JSON.stringify`, all of which React Native provides on the global scope. The
// logic therefore ports 1:1 to React Native-compatible TypeScript with no
// behavioral change (same module state, same 50 ms coalesce window, same
// serialize-and-skip-on-throw guard, same test-only flush helper).
//
// `@tanstack/react-query` (QueryClient/QueryKey) is RN-compatible and already a
// dependency of this app; `./broadcast` is the sibling native parity port whose
// `broadcast()` carries the identical `queryInvalidate` envelope. The
// `QueryBroadcastBridge` named above is the subscriber-side surface prose (NOT
// an import) — its native equivalent re-runs the invalidation on the peer
// surface's QueryClient.

import type {QueryClient, QueryKey} from '@tanstack/react-query';
import {broadcast} from './broadcast';

interface PendingEntry {
  key: ReadonlyArray<unknown>;
  serialized: string;
}

let pending: Map<string, PendingEntry> = new Map();
let timer: ReturnType<typeof setTimeout> | null = null;
const COALESCE_MS = 50;

function flush(): void {
  timer = null;
  if (pending.size === 0) {
    return;
  }
  const keys = Array.from(pending.values()).map(e => e.key);
  pending = new Map();
  broadcast({type: 'queryInvalidate', keys});
}

function scheduleFlush(): void {
  if (timer != null) {
    return;
  }
  timer = setTimeout(flush, COALESCE_MS);
}

function enqueue(key: ReadonlyArray<unknown>): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(key);
  } catch {
    // Query keys with circular refs / non-serializable members can't be
    // sent over the bus anyway — skip silently. The local invalidation
    // still happened.
    return;
  }
  pending.set(serialized, {key, serialized});
  scheduleFlush();
}

/**
 * Locally invalidate a query AND broadcast the invalidation to every other
 * surface. Use this in mutation `onSuccess` handlers wherever the underlying
 * data is shared across surfaces (alert rules, vehicles, automations, etc.).
 *
 * For purely local-UI invalidations (e.g. one-shot "refresh now" buttons,
 * dev-tools, admin pokes), keep using `qc.invalidateQueries(...)` directly
 * — there's no point bothering other surfaces with the user's per-click intent.
 */
export function invalidateAndBroadcast(
  qc: QueryClient,
  filters: {queryKey: QueryKey},
): void {
  void qc.invalidateQueries(filters);
  // Cast through unknown[] to satisfy ReadonlyArray<unknown> on the wire.
  enqueue(filters.queryKey as ReadonlyArray<unknown>);
}

/**
 * Test-only helper: drains any pending coalesce timer immediately.
 */
export function __flushQueryBroadcastForTests(): void {
  if (timer != null) {
    clearTimeout(timer);
    flush();
  }
}
