// Native parity port of web/src/features/onboarding/hooks/useOnboardingSkip.ts.
//
// The web hook persists the operator's "skip onboarding wizard" choice in
// browser localStorage and keeps that choice in lockstep across tabs via the
// `@/lib/broadcast` BroadcastChannel bus plus a native `storage` DOM event.
// React Native has none of those browser primitives, so this port preserves
// the full public contract (the STORAGE_KEY, the useSyncExternalStore model,
// the isSkipped/skip/unskip surface, isOnboardingSkippedSync, and the
// test-only reset helper) while substituting the browser-only pieces with
// native-safe equivalents that carry an explicit unavailable state (see
// nativeOnboardingSkipCapabilities and the parity sidecar):
//
//   - `window.localStorage` (readSkipped/writeSkipped) prefers
//     globalThis.localStorage when present (react-native-web target,
//     preserving the exact STORAGE_KEY and the '1' flag value) and falls back
//     to an in-process boolean; durable cross-restart persistence on a pure
//     native runtime is intentionally unavailable.
//   - The `@/lib/broadcast` cross-tab bus ({type:'onboarding.skip.changed'})
//     becomes a module-level listener set (broadcastOnboardingSkipChanged /
//     subscribeOnboardingSkipChange) so same-process consumers still stay in
//     lockstep; cross-tab / cross-device fan-out is web-only and unavailable.
//   - The native `storage` DOM event has no React Native source, so that
//     defensive fallback path folds into the same module bus and is marked
//     unavailable; both still funnel into the same notify() contract.

import {useCallback, useEffect, useSyncExternalStore} from 'react';

/**
 * Persists the operator's "skip wizard" choice locally so the shell can
 * suppress onboarding before server-side onboarding state exists.
 */
const STORAGE_KEY = 'teslasync:onboarding:skipped:v1';

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// react-native-web exposes the real localStorage; a pure native runtime does
// not, so we keep an in-process boolean as the fallback transport.
let inMemorySkipped = false;

function getWebStorage(): WebStorageLike | undefined {
  const candidate = (
    globalThis as typeof globalThis & {localStorage?: WebStorageLike}
  ).localStorage;
  return candidate && typeof candidate.getItem === 'function'
    ? candidate
    : undefined;
}

function readSkipped(): boolean {
  const store = getWebStorage();
  if (store) {
    try {
      return store.getItem(STORAGE_KEY) === '1';
    } catch {
      return inMemorySkipped;
    }
  }
  return inMemorySkipped;
}

function writeSkipped(value: boolean): void {
  inMemorySkipped = value;
  const store = getWebStorage();
  if (!store) {
    return;
  }
  try {
    if (value) {
      store.setItem(STORAGE_KEY, '1');
    } else {
      store.removeItem(STORAGE_KEY);
    }
  } catch {
    /* quota / private mode — best-effort drop */
  }
}

/* ── Native-safe cross-surface bus ────────────────────────────
 * Stand-in for the web `@/lib/broadcast` channel. The web bus fans an
 * { type: 'onboarding.skip.changed' } envelope out to OTHER tabs (filtering
 * self-broadcasts by TAB_ID). React Native is a single process, so this is a
 * module-level listener set that keeps in-process subscribers in lockstep.
 * Cross-tab / cross-device fan-out is web-only and intentionally unavailable. */

type OnboardingSkipMessage = {
  type: 'onboarding.skip.changed';
  skipped: boolean;
};
type OnboardingSkipBusListener = (msg: OnboardingSkipMessage) => void;

const busListeners = new Set<OnboardingSkipBusListener>();

/** Native stand-in for `broadcast({ type: 'onboarding.skip.changed' })`. */
export function broadcastOnboardingSkipChanged(skipped: boolean): void {
  const msg: OnboardingSkipMessage = {type: 'onboarding.skip.changed', skipped};
  busListeners.forEach(listener => {
    try {
      listener(msg);
    } catch {
      /* swallow — one bad listener must not block the rest */
    }
  });
}

function subscribeOnboardingSkipChange(
  handler: OnboardingSkipBusListener,
): () => void {
  busListeners.add(handler);
  return () => {
    busListeners.delete(handler);
  };
}

/** Explicit capability matrix for the native onboarding-skip surface. */
export const nativeOnboardingSkipCapabilities = {
  // Durable persistence is real on the react-native-web target (localStorage)
  // but unavailable on a pure native runtime, where state is in-process only.
  durablePersistenceAvailable: false,
  crossTabBroadcastAvailable: false,
  storageEventAvailable: false,
} as const;

/* ── Module-level shared state ────────────────────────────── */

const listeners = new Set<() => void>();
let cachedSnapshot: boolean = readSkipped();

function notify(): void {
  listeners.forEach(cb => {
    try {
      cb();
    } catch {
      /* swallow listener errors — one bad listener must not block the rest */
    }
  });
}

function setSkipped(value: boolean): void {
  writeSkipped(value);
  if (cachedSnapshot !== value) {
    cachedSnapshot = value;
    notify();
  }
  /* Cross-surface notification. The native bus is single-process, so the
   * bootstrap subscriber's value guard prevents a redundant re-notify —
   * same-process consumers were already covered by notify() above. */
  broadcastOnboardingSkipChanged(value);
}

/* Bootstrapping: subscribe ONCE to cross-surface updates. The web hook also
 * attaches a native `storage` DOM event listener (defensive — covers browsers
 * without BroadcastChannel); React Native has no `storage` event, so that path
 * folds into the same module bus and is marked unavailable. Both funnel into
 * the same notify() so consumers don't care which source fired. */
let bootstrapped = false;
function bootstrap(): void {
  if (bootstrapped) {
    return;
  }
  bootstrapped = true;
  subscribeOnboardingSkipChange(msg => {
    if (msg.type !== 'onboarding.skip.changed') {
      return;
    }
    if (cachedSnapshot === msg.skipped) {
      return;
    }
    cachedSnapshot = msg.skipped;
    notify();
  });
}

function subscribeListener(cb: () => void): () => void {
  bootstrap();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): boolean {
  return cachedSnapshot;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Synchronous read for callers that run outside React (e.g. the
 * gate effect that needs the value on the very first render).
 */
export function isOnboardingSkippedSync(): boolean {
  return cachedSnapshot;
}

/**
 * Test-only helper — resets module state between tests so the
 * skipped flag does not bleed across test boundaries.
 */
export function __resetOnboardingSkipForTests(): void {
  listeners.clear();
  cachedSnapshot = readSkipped();
}

export interface UseOnboardingSkip {
  isSkipped: boolean;
  skip: () => void;
  unskip: () => void;
}

export function useOnboardingSkip(): UseOnboardingSkip {
  const isSkipped = useSyncExternalStore(
    subscribeListener,
    getSnapshot,
    getServerSnapshot,
  );

  /* Defensive resync on mount: covers the edge case where the backing store
   * was mutated by a non-app actor (e.g. devtools, manual edit) while no
   * consumer subscribed and the bus therefore did not fire. */
  useEffect(() => {
    const stored = readSkipped();
    if (stored !== cachedSnapshot) {
      cachedSnapshot = stored;
      notify();
    }
  }, []);

  const skip = useCallback(() => {
    setSkipped(true);
  }, []);

  const unskip = useCallback(() => {
    setSkipped(false);
  }, []);

  return {isSkipped, skip, unskip};
}
