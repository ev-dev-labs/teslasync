import { useCallback, useSyncExternalStore } from 'react';

/**
 * Phase 40 / Prompt 62 — multi-chart cursor sync external store.
 *
 * Recharts' built-in `syncId` already mirrors the active hover index across
 * sibling charts, but the active cursor disappears the moment the user moves
 * their mouse off the participating chart. This tiny external store lets us
 * draw a *persistent* vertical reference line at the last hovered x value
 * across every chart that opts in via {@link useSyncedCursor}.
 *
 * The store is keyed by `syncId` (e.g. `'drive-detail'`, `'charging.session'`).
 * Pages choose unique `syncId` strings, so cross-page leakage is impossible
 * by construction. {@link ChartTimeRangeProvider} additionally clears its own
 * entry on unmount so navigating between pages drops the stale value
 * regardless of `syncId` choice.
 *
 * Design notes:
 *  - Built on `useSyncExternalStore` so React stays in control of subscription
 *    cleanup and concurrent rendering remains safe.
 *  - No new dependency (no `zustand`) — the store is tiny and isolated to
 *    one module.
 *  - The store survives across component remounts within the same page (good:
 *    a chart that re-mounts after a tab change keeps the cursor) and across
 *    HMR (irrelevant: the value re-derives instantly on next mousemove).
 */

export type CursorSyncValue = string | number | null;

interface Store {
  positions: Map<string, CursorSyncValue>;
  listeners: Set<() => void>;
}

const store: Store = {
  positions: new Map<string, CursorSyncValue>(),
  listeners: new Set<() => void>(),
};

function emit(): void {
  store.listeners.forEach((listener) => {
    listener();
  });
}

/**
 * Set the active cursor x value for a syncId. Pass `null` to clear the entry.
 * No-op when the value is unchanged so subscribed components don't re-render
 * spuriously on every mousemove tick from siblings.
 */
export function setCursorSyncPosition(syncId: string, value: CursorSyncValue): void {
  const current = store.positions.get(syncId) ?? null;
  if (current === value) return;
  if (value == null) {
    store.positions.delete(syncId);
  } else {
    store.positions.set(syncId, value);
  }
  emit();
}

/** Read the current cursor position synchronously (for tests/debug). */
export function getCursorSyncPosition(syncId: string): CursorSyncValue {
  return store.positions.get(syncId) ?? null;
}

/**
 * Drop the entry for a `syncId`. Called by `<ChartTimeRangeProvider>` on
 * unmount so pages don't leak a stale persistent cursor into the next page.
 */
export function clearCursorSync(syncId: string): void {
  if (!store.positions.has(syncId)) return;
  store.positions.delete(syncId);
  emit();
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

/**
 * Subscribe to the persistent cursor x value for a given `syncId`. Returns
 * `null` when no syncId is set or no chart has been hovered yet.
 *
 * Safe to call outside a `<ChartTimeRangeProvider>` — passing `undefined`
 * always returns `null` without touching the store.
 */
export function useCursorSyncPosition(syncId: string | undefined): CursorSyncValue {
  const getSnapshot = useCallback((): CursorSyncValue => {
    if (!syncId) return null;
    return store.positions.get(syncId) ?? null;
  }, [syncId]);
  const getServerSnapshot = useCallback((): CursorSyncValue => null, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Test helper — fully reset the store. Not exported from the barrel; tests
 * import it directly from the module path.
 */
export function _resetCursorSyncStore(): void {
  store.positions.clear();
  store.listeners.clear();
}
