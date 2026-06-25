import {useEffect} from 'react';
import {useQueryClient} from '@tanstack/react-query';

/**
 * Native parity port of web/src/components/QueryBroadcastBridge.tsx.
 *
 * WEB ORIGINAL: a zero-render component mounted INSIDE the QueryClientProvider
 * that listens (via `subscribe` from `@/lib/broadcast`) for `queryInvalidate`
 * messages broadcast from OTHER BROWSER TABS of the same origin and replays the
 * matching `invalidateQueries(...)` against this tab's QueryClient. It calls the
 * bare `qc.invalidateQueries(...)` — NOT `invalidateAndBroadcast(...)` — to
 * avoid an infinite ping-pong between tabs A and B re-broadcasting each other's
 * invalidations. Mount once, near the top of the React tree but inside the
 * QueryClientProvider so `useQueryClient()` resolves. The component renders
 * nothing.
 *
 * NATIVE REALITY: React Native runs a SINGLE app instance — there is no
 * multi-tab model, no `BroadcastChannel`, and no `localStorage` `storage`
 * event, so the web bus's cross-instance transport is UNAVAILABLE (see
 * `nativeQueryBroadcastBridgeCapabilities`). This port preserves the EXACT same
 * component contract (mount once inside the QueryClientProvider, render
 * nothing) and the EXACT same message-handling logic, but wires it to an
 * in-process invalidation bus that stands in for the absent cross-tab
 * transport. With no peer publishers on a single instance the bridge is an
 * inert no-op — matching the web behavior of a tab that has no peers — while
 * remaining fully exercised when `publishQueryInvalidate` is called locally
 * (e.g. by tests or a future native multi-window shell).
 */

/**
 * The `queryInvalidate` variant of the web `BroadcastMessage` union
 * (web/src/lib/broadcast.ts). Ported verbatim so the `type` discriminant guard
 * below stays meaningful and the `keys` shape matches the wire payload the web
 * bus carried (`ReadonlyArray<ReadonlyArray<unknown>>`).
 */
export interface QueryInvalidateMessage {
  type: 'queryInvalidate';
  keys: ReadonlyArray<ReadonlyArray<unknown>>;
}

/** Message union the native bridge bus can deliver. */
export type BridgeBroadcastMessage = QueryInvalidateMessage;

type BridgeHandler = (msg: BridgeBroadcastMessage) => void;

const queryInvalidateListeners = new Set<BridgeHandler>();

/**
 * Native-safe replacement for `subscribe` from `@/lib/broadcast`. The web
 * version wired both a `BroadcastChannel` listener and a `localStorage`
 * `storage`-event fallback to receive messages from OTHER tabs; neither exists
 * on React Native. This registers an in-process listener and returns the same
 * unsubscribe contract. Handlers are isolated so one throwing consumer never
 * crashes the bus (parity with the web `subscribe` try/catch).
 */
export function subscribeToQueryInvalidations(
  handler: BridgeHandler,
): () => void {
  queryInvalidateListeners.add(handler);
  return () => {
    queryInvalidateListeners.delete(handler);
  };
}

/**
 * In-process stand-in for the web `broadcast({ type: 'queryInvalidate', ... })`
 * emitter. On native there are no peer tabs, so this is the only way a
 * `queryInvalidate` message can reach the bridge. The web bus filtered
 * self-broadcasts by tab id; here every delivery is intentionally local, so no
 * self-filter applies.
 */
export function publishQueryInvalidate(
  keys: ReadonlyArray<ReadonlyArray<unknown>>,
): void {
  const msg: QueryInvalidateMessage = {type: 'queryInvalidate', keys};
  for (const handler of Array.from(queryInvalidateListeners)) {
    try {
      handler(msg);
    } catch {
      // Subscriber threw — never let one consumer crash the bus (parity with
      // the web `subscribe` handler isolation).
    }
  }
}

/**
 * Records which browser capabilities the web bridge relied on that are
 * unavailable on native, so the unavailable state is explicit and
 * programmatically inspectable (parity-contract rule 7).
 */
export const nativeQueryBroadcastBridgeCapabilities = {
  broadcastChannelAvailable: false,
  crossTabTransportAvailable: false,
  localStorageStorageEventAvailable: false,
  inProcessInvalidationBus: true,
} as const;

export function QueryBroadcastBridge(): null {
  const qc = useQueryClient();
  useEffect(() => {
    return subscribeToQueryInvalidations(msg => {
      if (msg.type !== 'queryInvalidate') {
        return;
      }
      for (const key of msg.keys) {
        // QueryKey is `readonly unknown[]` in TanStack — cast through the same
        // shape we received over the wire.
        void qc.invalidateQueries({queryKey: key as unknown[]});
      }
    });
  }, [qc]);
  return null;
}
