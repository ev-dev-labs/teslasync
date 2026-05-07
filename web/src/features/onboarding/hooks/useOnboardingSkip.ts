import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { broadcast, subscribe as subscribeBroadcast } from '@/lib/broadcast';

/**
 * useOnboardingSkip — Phase 40 follow-up.
 *
 * Lets the user bypass the OnboardingGate while setup anchors are
 * still incomplete. The flag is persisted in localStorage so it
 * survives reloads, and broadcast across tabs so a "Skip" in one
 * tab takes effect in others.
 *
 * The flag is intentionally NOT cleared when onboarding completes
 * — keeping it set is harmless (the gate also bypasses on
 * `is_complete`) and avoids re-trapping the user on /onboarding if
 * they later disconnect their Tesla account.
 *
 * Implementation: backed by a module-level subscriber list and
 * useSyncExternalStore so EVERY hook instance in the same tab
 * (OnboardingPage + OnboardingGate at the app root) sees the flip
 * synchronously when any caller invokes skip()/unskip(). The prior
 * implementation used per-component useState and only broadcast
 * cross-tab — which meant clicking "Skip for now" updated the
 * OnboardingPage's local state but the OnboardingGate kept the old
 * value, immediately re-routing the user back to /onboarding. A
 * second click after a hard refresh worked only because the gate's
 * useState initializer re-read localStorage on mount.
 */

const STORAGE_KEY = 'teslasync:onboarding:skipped:v1';

function readSkipped(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSkipped(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* quota / private mode — best-effort drop */
  }
}

/* ── Module-level shared state ────────────────────────────── */

const listeners = new Set<() => void>();
let cachedSnapshot: boolean = readSkipped();

function notify(): void {
  listeners.forEach((cb) => {
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
  /* Cross-tab notification. Broadcast filters self-broadcasts via TAB_ID, so
   * this never re-enters the local listener set — same-tab consumers were
   * already covered by notify() above. */
  broadcast({ type: 'onboarding.skip.changed', skipped: value });
}

/* Bootstrapping: subscribe ONCE to cross-tab updates and to the native
 * `storage` event (defensive — covers tabs that use a different broadcast
 * transport implementation, e.g. older browsers without BroadcastChannel).
 * Both paths funnel into the same notify() so consumers don't care which
 * source fired. */
let bootstrapped = false;
function bootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  subscribeBroadcast((msg) => {
    if (msg.type !== 'onboarding.skip.changed') return;
    if (cachedSnapshot === msg.skipped) return;
    cachedSnapshot = msg.skipped;
    notify();
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      const next = readSkipped();
      if (cachedSnapshot === next) return;
      cachedSnapshot = next;
      notify();
    });
  }
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
  const isSkipped = useSyncExternalStore(subscribeListener, getSnapshot, getServerSnapshot);

  /* Defensive resync on mount: covers the edge case where localStorage
   * was mutated by a non-app actor (e.g. devtools, manual edit) while
   * no tab subscribed and the storage event therefore did not fire. */
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

  return { isSkipped, skip, unskip };
}
