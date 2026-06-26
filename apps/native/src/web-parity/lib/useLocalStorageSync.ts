// Native parity port of web/src/lib/useLocalStorageSync.ts.
//
// Reusable hook for cross-tab localStorage sync:
//
//   "feature writes a localStorage value, broadcasts a one-line message,
//    other tabs subscribe to the message and re-read the value"
//
// Returns the parsed value plus a setter that (a) writes the value, (b) updates
// local React state, and (c) broadcasts the supplied message type so every other
// consumer re-reads. The bus message itself does NOT carry the value — the value
// lives in storage. Receivers get the signal, read storage fresh, and update
// their own state. This keeps the bus payload small and avoids version-skew
// between what's broadcast and what's in storage.
//
// Web -> native adaptation (conversion contract rules 3 & 7) — every browser-only
// touch point is replaced with a documented native-safe substitute, behaviour
// (and the public `[value, set]` contract) otherwise preserved:
//   * `window.localStorage` (read/set) -> the shared process-scoped 'local' store
//     from lib/nativeWebStorage.ts (getNativeStorage('local') — the same backend
//     useFormDraft / draftIndex / useVehiclePaint use). The caller-supplied `key`
//     is preserved verbatim, and the web `typeof window === 'undefined'`
//     SSR/availability guard becomes a `storage === null` guard so the null-safe
//     try/catch ladders stay structurally identical.
//   * `./broadcast` (cross-tab signal) -> the native parity port in ./broadcast.
//     The `subscribe`/`broadcast` calls and the `BroadcastMessage` union are
//     unchanged. In React Native there are no peer tabs, so the bus self-filters
//     to a no-op (see lib/broadcast.ts); the subscription stays lifecycle-safe so
//     a future RN multi-window transport wires delivery in without touching
//     callers.
//   * The web defense-in-depth `window` 'storage' event listener (source
//     L43-49) re-read the value when ANOTHER tab wrote `key` straight to
//     localStorage, bypassing the hook. React Native has no `window`, no
//     `StorageEvent`, and no peer tabs, so there is no out-of-band writer to
//     observe. Its role — keeping sibling consumers of the same signal in sync —
//     is served by an in-process listener channel keyed by `msgType` (mirroring
//     useVehiclePaint's notifyInTab): `set` fans out to every other mounted
//     consumer of that signal, which then re-reads storage exactly like the web
//     bus subscriber did.

import { useEffect, useState } from 'react';

import { broadcast, subscribe, type BroadcastMessage } from './broadcast';
import { getNativeStorage, type NativeKeyValueStorage } from './nativeWebStorage';

// In-process pub/sub keyed by the signal's message type. On the web the bus
// self-filters by TAB_ID and `storage` events only fire in OTHER tabs, so two
// hook instances in the same tab synced through cross-tab traffic; React Native
// runs a single context with no peer tabs, so this channel is the primary sync
// path for sibling consumers of the same signal.
type Listener = () => void;
const inProcessListeners = new Map<BroadcastMessage['type'], Set<Listener>>();

function notifyInProcess(msgType: BroadcastMessage['type']): void {
  const set = inProcessListeners.get(msgType);
  if (!set) {
    return;
  }
  for (const fn of set) {
    try {
      fn();
    } catch {
      /* never let one consumer crash the fan-out */
    }
  }
}

function subscribeInProcess(
  msgType: BroadcastMessage['type'],
  fn: Listener,
): () => void {
  let set = inProcessListeners.get(msgType);
  if (!set) {
    set = new Set();
    inProcessListeners.set(msgType, set);
  }
  set.add(fn);
  return () => {
    const s = inProcessListeners.get(msgType);
    if (!s) {
      return;
    }
    s.delete(fn);
    if (s.size === 0) {
      inProcessListeners.delete(msgType);
    }
  };
}

// Native-safe replacement for the web `window.localStorage`. The shared
// process-scoped 'local' store (lib/nativeWebStorage.ts) is the canonical
// localStorage substitute; it is always present, but the |null union + guard is
// kept so read/set mirror the source's window-availability ladder exactly.
function getSyncStorage(): NativeKeyValueStorage | null {
  try {
    return getNativeStorage('local');
  } catch {
    return null;
  }
}

export function useLocalStorageSync<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string | null,
  msgType: BroadcastMessage['type'],
): [T, (next: T) => void] {
  const read = (): T => {
    const storage = getSyncStorage();
    if (!storage) {
      return parse(null);
    }
    try {
      return parse(storage.getItem(key));
    } catch {
      return parse(null);
    }
  };

  const [value, setValue] = useState<T>(read);

  // Subscribe to the bus + the in-process channel: another consumer may write
  // the same signal. The web also wired a `window` 'storage' listener for tabs
  // writing storage directly without this hook — RN has no such out-of-band
  // writer (see the module header). Deps are intentionally [key, msgType]
  // (mirroring the source) so a fresh parse/serialize identity each render does
  // not re-subscribe; the native preset enables react-hooks/exhaustive-deps as
  // an error, so the deps line is annotated below.
  useEffect(() => {
    const refresh = () => setValue(read());
    const off = subscribe(m => {
      if (m.type === msgType) refresh();
    });
    const offInProcess = subscribeInProcess(msgType, refresh);
    return () => {
      off();
      offInProcess();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, msgType]);

  const set = (next: T) => {
    const storage = getSyncStorage();
    if (storage) {
      try {
        const serialized = serialize(next);
        if (serialized === null) storage.removeItem(key);
        else storage.setItem(key, serialized);
      } catch {
        /* quota / private mode — best-effort */
      }
    }
    setValue(next);
    // Wake sibling consumers of this signal in the current process (the web bus
    // delivered this across tabs; RN has none, so notify in-process). Each
    // re-reads storage rather than trusting a payload.
    notifyInProcess(msgType);
    // The discriminated union forbids constructing a payload from a bare
    // type tag — every adapter that uses this helper happens to be one of
    // the no-payload variants ('checklist.dismissed', 'onboarded',
    // 'install.dismissed', 'dashboard.layout'). Cast through unknown to
    // keep this helper generic over those.
    broadcast({ type: msgType } as unknown as BroadcastMessage);
  };

  return [value, set];
}

/**
 * Test-only helper: clears the in-process listener registry so suites start from
 * a clean fan-out state. Mirrors the broadcast.ts `__resetBroadcastForTests`
 * convention; the storage backend (lib/nativeWebStorage.ts) is separate and
 * persists per process, so tests should use distinct keys for isolation.
 */
export function __resetLocalStorageSyncForTests(): void {
  inProcessListeners.clear();
}
