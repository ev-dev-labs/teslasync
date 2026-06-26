import {useCallback, useEffect, useSyncExternalStore} from 'react';

import {useOnboardingStatus} from '../../../api/hooks/useOnboarding';

/**
 * Onboarding gate (React Native parity port of
 * web/src/features/onboarding/components/OnboardingGate.tsx).
 *
 * First-run redirect guard. While the install has not completed all
 * three onboarding anchors (tesla_connected + vehicle_count > 0 +
 * data_flowing), this component routes the user to /onboarding so
 * they're not dropped into a dashboard that can only render empty
 * states.
 * Allow-listed paths bypass the gate so the user can reach the
 * Tesla account setup page, public share links, the watch face,
 * and onboarding itself.
 * The user can also click "Skip for now" on the onboarding page,
 * which sets the skip flag (see useOnboardingSkip) that the gate
 * honours across re-renders.
 * The gate is intentionally non-blocking: it renders nothing
 * (`return null`) and only triggers redirects via effects, so the
 * surrounding navigation shell can render normally for already-
 * onboarded users.
 *
 * Web -> native mapping:
 *   • react-router-dom useLocation().pathname -> the `currentPath` prop.
 *   • react-router-dom useNavigate()          -> the `onNavigate(to, opts)`
 *     callback prop; the web `{ replace: true }` redirect intent is carried
 *     verbatim in the optional second argument.
 *   • useOnboardingStatus is imported from the already-ported native
 *     web-parity hook (../../../api/hooks/useOnboarding).
 *   • useOnboardingSkip (web/src/features/onboarding/hooks/useOnboardingSkip.ts)
 *     is browser-only (window.localStorage + the storage event + @/lib/broadcast
 *     cross-tab channel) and is not yet in the parity manifest, so a native-safe
 *     in-process port is inlined below.
 *
 * No DOM elements, react-router-dom, lucide-react, Recharts, Leaflet, react-dom,
 * or web UI-kit modules are imported into this native output.
 */

export const nativeOnboardingGateCapabilities = {
  /** react-router-dom location/navigate are replaced by props. */
  reactRouterAvailable: false,
  /** No window.localStorage in React Native; skip flag is in-process only. */
  localStoragePersistenceAvailable: false,
  /** No AsyncStorage is bundled in this parity shell. */
  asyncStoragePersistenceAvailable: false,
  /** No BroadcastChannel / window storage event for cross-tab sync. */
  crossTabSyncAvailable: false,
  /** The skip flag is shared across consumers for the running app session. */
  inProcessSkipStore: true,
} as const;

/* ── Inlined native-safe port of useOnboardingSkip ──────────────────────────
 * The web hook persists the operator's "Skip for now" choice in
 * window.localStorage and synchronises it across browser tabs via
 * @/lib/broadcast plus the native `storage` event. React Native has none of
 * those (no localStorage, no BroadcastChannel, no storage event) and no
 * AsyncStorage is bundled in this parity shell, so the flag is held in a
 * module-level in-process store: it survives re-renders and is shared across
 * every OnboardingGate / consumer in the running app, but does NOT persist
 * across full app restarts and does NOT sync across devices/tabs. The
 * isSkipped/skip/unskip surface, the synchronous read, and the test reset are
 * preserved so callers behave identically within a session.
 */

const skipListeners = new Set<() => void>();
let skipSnapshot = false;

function notifySkip(): void {
  skipListeners.forEach(cb => {
    try {
      cb();
    } catch {
      /* swallow listener errors — one bad listener must not block the rest */
    }
  });
}

function setSkipped(value: boolean): void {
  if (skipSnapshot === value) {
    return;
  }
  skipSnapshot = value;
  notifySkip();
}

function subscribeSkip(cb: () => void): () => void {
  skipListeners.add(cb);
  return () => {
    skipListeners.delete(cb);
  };
}

function getSkipSnapshot(): boolean {
  return skipSnapshot;
}

/**
 * Synchronous read for callers that run outside React (e.g. the gate effect
 * that needs the value on the very first render).
 */
export function isOnboardingSkippedSync(): boolean {
  return skipSnapshot;
}

/**
 * Test-only helper — resets module state between tests so the skipped flag does
 * not bleed across test boundaries.
 */
export function __resetOnboardingSkipForTests(): void {
  skipListeners.clear();
  skipSnapshot = false;
}

/**
 * Test/shell helper — sets the in-process skip flag directly (the native analog
 * of the web hook mutating localStorage). Production code should prefer the
 * skip()/unskip() actions returned by useOnboardingSkip().
 */
export function setOnboardingSkippedForParity(value: boolean): void {
  setSkipped(value);
}

export interface UseOnboardingSkip {
  isSkipped: boolean;
  skip: () => void;
  unskip: () => void;
}

export function useOnboardingSkip(): UseOnboardingSkip {
  const isSkipped = useSyncExternalStore(
    subscribeSkip,
    getSkipSnapshot,
    getSkipSnapshot,
  );

  const skip = useCallback(() => {
    setSkipped(true);
  }, []);

  const unskip = useCallback(() => {
    setSkipped(false);
  }, []);

  return {isSkipped, skip, unskip};
}

/* ── Gate ───────────────────────────────────────────────────────────────── */

// Paths that bypass the gate. Match by prefix so nested routes
// (e.g. /vehicles/:id/access) work without listing every variant.
const ALLOW_PREFIXES = [
  '/onboarding',
  '/tesla-account',
  '/settings',
  '/s/', // public share links
  '/watch',
  '/login',
];

function isAllowed(pathname: string): boolean {
  return ALLOW_PREFIXES.some(prefix =>
    prefix.endsWith('/')
      ? pathname.startsWith(prefix)
      : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export interface OnboardingGateProps {
  /**
   * Native-safe replacement for react-router-dom's useLocation().pathname.
   * The navigation shell passes the current route path so the gate can decide
   * whether the user is on an allow-listed screen.
   */
  currentPath?: string;
  /**
   * Native-safe replacement for react-router-dom's useNavigate(). Receives the
   * same path string the web gate redirected to ('/onboarding') and the web
   * `{ replace: true }` option so the shell can replace rather than push.
   */
  onNavigate?: (to: string, options?: {replace?: boolean}) => void;
}

export function OnboardingGate({
  currentPath = '/',
  onNavigate,
}: OnboardingGateProps = {}) {
  const {data, isLoading, isError} = useOnboardingStatus();
  const {isSkipped} = useOnboardingSkip();

  useEffect(() => {
    // While the status request is in flight or has errored, don't
    // bounce the user — let them see whatever is loading rather than
    // a flash redirect, and never trap them on /onboarding when the
    // backend is briefly unreachable.
    if (isLoading || isError || !data) {
      return;
    }
    if (data.is_complete) {
      return;
    }
    // The user explicitly chose "Skip for now" on the onboarding
    // page. Honour that within the running session.
    if (isSkipped) {
      return;
    }
    if (isAllowed(currentPath)) {
      return;
    }

    onNavigate?.('/onboarding', {replace: true});
  }, [data, isLoading, isError, isSkipped, currentPath, onNavigate]);

  return null;
}
