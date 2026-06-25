import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type {RefObject} from 'react';
import type {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from 'react-native';

/**
 * Native parity port of web/src/components/layout/ScrollRestoration.tsx.
 *
 * The web file re-implements React Router v6's `<ScrollRestoration>` for the
 * classic `<BrowserRouter>` route tree. It:
 *   - Tracks the scrollTop of the scrollable region per location key
 *     (path + search), persisted so it survives a navigation but not a
 *     "tab close".
 *   - On POP (back/forward) restores the saved offset synchronously before
 *     paint; first visits scroll to top.
 *   - On PUSH/REPLACE scrolls to top — what a user expects from a nav link.
 *   - Operates on the `<main id="main-content">` DOM scroll container, falling
 *     back to `window` for standalone routes.
 *
 * React Native has none of those browser primitives — no react-router
 * `useLocation`/`useNavigationType`, no `sessionStorage`, no
 * `document.getElementById('main-content')` DOM scroll container, and no
 * synchronous `window.scrollY`/`window.scrollTo`. This native port preserves
 * the SAME save/restore behavior using native-safe replacements:
 *   - Location/navigation come in as props (`pathname`, `search`, `navType`)
 *     supplied by the native navigation shell.
 *   - `sessionStorage` is replaced by an in-process session-scoped Map with the
 *     same lifetime contract (survives in-session navigation, not an app
 *     restart) and the same string-keyed read/write/parse semantics.
 *   - The DOM scroll container is replaced by a `ScrollView` ref; the live
 *     `scrollTop` read is replaced by the offset tracked from `onScroll`, and
 *     `setScrollTop` maps to `ScrollView.scrollTo({ animated: false })`.
 *   - The web global `addEventListener('scroll')` has no native analogue, so
 *     the throttled handler is surfaced to the owning ScrollView via the hook
 *     return / `onRegisterScrollHandler` instead of being attached implicitly.
 *
 * Mount `ScrollRestoration` ONCE near the navigation root, mirroring the web
 * contract; mounting it twice would double the writes (harmless) but read the
 * wrong key on restoration.
 */

const STORAGE_PREFIX = 'teslasync.scroll:';

/**
 * Recommended `scrollEventThrottle` (ms) for the managed ScrollView. ~16ms is
 * one frame at 60fps, matching the web throttle that wrote at most once per
 * `requestAnimationFrame`.
 */
const SCROLL_EVENT_THROTTLE_MS = 16;

/**
 * Native-safe replacement for React Router's NavigationType. The native shell
 * maps its transition kind onto this union: 'POP' for back/forward (restore),
 * 'PUSH'/'REPLACE' for fresh navigation (scroll to top).
 */
export type ScrollNavigationType = 'POP' | 'PUSH' | 'REPLACE';

/** Throttled scroll handler suitable for a `ScrollView`'s `onScroll` prop. */
export type ScrollHandler = (
  event: NativeSyntheticEvent<NativeScrollEvent>,
) => void;

/**
 * In-memory session store replacing the browser `sessionStorage`. React Native
 * has no sessionStorage; this module-level Map keeps the same lifetime contract
 * the web file relied on — it survives in-session navigation but not an app
 * restart (the native equivalent of "survives a navigation but not a tab
 * close"). Values are kept as strings to mirror sessionStorage's read/write
 * semantics exactly.
 */
const scrollSessionStore = new Map<string, string>();

/**
 * Records which browser capabilities the web file used are unavailable on
 * native, so the unavailable state is explicit and programmatically
 * inspectable (parity-contract rule 7).
 */
export const nativeScrollRestorationCapabilities = {
  reactRouterLocationAvailable: false,
  reactRouterNavigationTypeAvailable: false,
  sessionStorageAvailable: false,
  domScrollContainerAvailable: false,
  windowScrollAvailable: false,
  requestAnimationFrameAvailable:
    typeof (
      globalThis as typeof globalThis & {requestAnimationFrame?: unknown}
    ).requestAnimationFrame === 'function',
  inMemorySessionStore: true,
} as const;

/**
 * Clears the in-memory session store. Replaces the implicit "tab close"
 * reset of the web `sessionStorage`; also lets host shells reset between
 * logical sessions and lets tests isolate specs.
 */
export function resetScrollSessionStore(): void {
  scrollSessionStore.clear();
}

function keyFor(pathname: string, search: string): string {
  return `${STORAGE_PREFIX}${pathname}${search}`;
}

function readSaved(key: string): number | null {
  try {
    const raw = scrollSessionStore.has(key)
      ? (scrollSessionStore.get(key) as string)
      : null;
    if (raw == null) {
      return null;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string, value: number): void {
  try {
    scrollSessionStore.set(key, String(value));
  } catch {
    // Parity with the web no-op: the store may reject a write (e.g. a host
    // shim). The user just loses scroll restoration for that visit — never a
    // fatal.
  }
}

/**
 * Native replacement for the web `setScrollTop`. The DOM `target.scrollTop = n`
 * / `window.scrollTo` becomes an imperative `ScrollView.scrollTo`. With no
 * scroll container (parity with the web `window` fallback, which has no native
 * analogue) this is a no-op.
 */
function setScrollTop(
  target: RefObject<ScrollView | null> | null | undefined,
  top: number,
): void {
  const node = target?.current;
  if (!node) {
    return;
  }
  node.scrollTo({y: top, animated: false});
}

/**
 * Schedules a callback on the next frame, falling back to a macrotask when
 * `requestAnimationFrame` is unavailable (e.g. under Jest). Mirrors the web
 * throttle's "at most once per paint" intent while staying native-safe.
 */
function scheduleFrame(callback: () => void): void {
  const raf = (
    globalThis as typeof globalThis & {requestAnimationFrame?: unknown}
  ).requestAnimationFrame;
  if (typeof raf === 'function') {
    (raf as (frame: (timestamp: number) => void) => number)(() => {
      callback();
    });
    return;
  }
  setTimeout(callback, 0);
}

export interface UseScrollRestorationOptions {
  /** Native-safe replacement for React Router `location.pathname`. */
  pathname?: string;
  /** Native-safe replacement for React Router `location.search`. */
  search?: string;
  /** Native-safe replacement for React Router's navigation type. */
  navType?: ScrollNavigationType;
  /**
   * Ref to the scrollable container this instance manages — the native
   * equivalent of `<main id="main-content">`. When absent the save/restore
   * keys are still maintained but no viewport is moved (parity with the web
   * `window` fallback, which does not exist on native).
   */
  scrollRef?: RefObject<ScrollView | null>;
}

export interface ScrollRestorationApi {
  /** Attach to the managed ScrollView's `onScroll` prop. */
  onScroll: ScrollHandler;
  /** Recommended `scrollEventThrottle` for the managed ScrollView. */
  scrollEventThrottle: number;
}

/**
 * Working native implementation. Owners pass their ScrollView `scrollRef` plus
 * the current `pathname`/`search`/`navType`, attach the returned `onScroll`
 * (and `scrollEventThrottle`) to that ScrollView, and get web-parity scroll
 * restoration.
 */
export function useNativeScrollRestoration(
  options: UseScrollRestorationOptions = {},
): ScrollRestorationApi {
  const {pathname = '', search = '', navType = 'PUSH', scrollRef} = options;

  const lastKey = useRef<string | null>(null);
  const latestOffset = useRef(0);
  const scheduled = useRef(false);

  // Persist the current offset while the user scrolls. The web file added a
  // global 'scroll' listener and threw away all-but-one event per frame via
  // requestAnimationFrame; native has no global scroll source, so this handler
  // is attached to the managed ScrollView and applies the same per-frame
  // throttle, reading the live offset from the scroll event.
  const onScroll = useCallback<ScrollHandler>(event => {
    latestOffset.current = event.nativeEvent.contentOffset.y;
    if (scheduled.current) {
      return;
    }
    scheduled.current = true;
    scheduleFrame(() => {
      scheduled.current = false;
      if (lastKey.current) {
        writeSaved(lastKey.current, latestOffset.current);
      }
    });
  }, []);

  // Track the active key and flush the final position before a route change or
  // unmount (mirrors the web cleanup that flushed on unmount/route change). The
  // web removeEventListener has no native analogue — the handler lifetime is
  // owned by the ScrollView it is attached to.
  useEffect(() => {
    const key = keyFor(pathname, search);
    lastKey.current = key;
    return () => {
      if (lastKey.current) {
        writeSaved(lastKey.current, latestOffset.current);
      }
    };
  }, [pathname, search]);

  // Restore (or scroll-to-top) on every navigation. useLayoutEffect keeps the
  // pre-paint timing of the web original so the user does not briefly see the
  // top before it jumps. The tracked offset is synced to the imperative scroll
  // so it matches the live-DOM read the web file performed.
  useLayoutEffect(() => {
    const key = keyFor(pathname, search);

    if (navType === 'POP') {
      const saved = readSaved(key);
      const top = saved ?? 0;
      setScrollTop(scrollRef, top);
      latestOffset.current = top;
    } else {
      // PUSH or REPLACE — fresh navigation. Always start at the top.
      setScrollTop(scrollRef, 0);
      latestOffset.current = 0;
    }
  }, [pathname, search, navType, scrollRef]);

  return useMemo(
    () => ({onScroll, scrollEventThrottle: SCROLL_EVENT_THROTTLE_MS}),
    [onScroll],
  );
}

export interface ScrollRestorationProps extends UseScrollRestorationOptions {
  /**
   * Receives the throttled scroll handler the owning ScrollView must wire to
   * its `onScroll` prop. The web component attached a global scroll listener
   * itself; native has no global scroll source, so the handler is surfaced to
   * the caller instead.
   */
  onRegisterScrollHandler?: (api: ScrollRestorationApi) => void;
}

/**
 * Parity export mirroring the web `<ScrollRestoration>` component: mount it
 * once near the navigation root. It renders nothing (returns null) and drives
 * the save/restore lifecycle via {@link useNativeScrollRestoration}, surfacing
 * the throttled scroll handler through `onRegisterScrollHandler`.
 */
export function ScrollRestoration({
  onRegisterScrollHandler,
  ...options
}: ScrollRestorationProps = {}): null {
  const api = useNativeScrollRestoration(options);

  useEffect(() => {
    onRegisterScrollHandler?.(api);
  }, [onRegisterScrollHandler, api]);

  return null;
}
