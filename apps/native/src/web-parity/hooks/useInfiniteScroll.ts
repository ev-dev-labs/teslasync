/**
 * Native web-parity port of `web/src/hooks/useInfiniteScroll.ts`.
 *
 * Infinite-scroll trigger: invoke `onLoadMore` once the user scrolls to the
 * bottom of a list and there is more data to fetch (`hasMore`). The web hook
 * returned a `sentinelRef` to attach to a trailing sentinel `<div>`; a DOM
 * `IntersectionObserver` (threshold 0.1) fired `onLoadMore` whenever that
 * sentinel scrolled into view while `hasMore` was true.
 *
 * Native adaptations (behavior, the `sentinelRef` state name, the 0.1
 * threshold, and the `isIntersecting && hasMore -> onLoadMore` rule are all
 * preserved 1:1):
 *   - `IntersectionObserver` and `HTMLDivElement` are DOM-only and do not exist
 *     on iOS / Android / Windows / macOS, and importing a DOM module into
 *     native output is forbidden. So `useInfiniteScroll` resolves the observer
 *     without one:
 *       1. If a global `IntersectionObserver` constructor is reachable
 *          (react-native-web running inside a real browser) it is used exactly
 *          like the web hook — same lazy `sentinelRef`, same
 *          `new IntersectionObserver(handleObserver, { threshold: 0.1 })`, same
 *          `observe` / `disconnect` lifecycle — so the `web` target keeps 1:1
 *          parity.
 *       2. Otherwise (true React Native) the observer is unavailable: the
 *          returned ref is inert and the effect is a no-op that never throws.
 *          This is the documented explicit "unavailable" state for the
 *          browser-only API.
 *   - React Native lists expose no viewport sentinel; the idiomatic
 *     end-of-list trigger is `FlatList` / `ScrollView`'s `onEndReached`. The
 *     companion `useInfiniteScrollHandlers` hook returns the props
 *     (`onEndReached`, `onEndReachedThreshold`) that reproduce the SAME
 *     "load more at the end while `hasMore`" behavior on native, mapping the web
 *     0.1 IntersectionObserver threshold onto FlatList's `onEndReachedThreshold`.
 *
 * Unit handling: none — this is a pure UI-interaction utility with no
 * unit-suffixed fields, API paths, or i18n strings, so the SI cutover contract
 * is unaffected.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

/* ── IntersectionObserver bridge (react-native-web / browser only) ─────────── */

/**
 * Structural stand-in for the DOM element the observer watches, declared
 * locally so the DOM `lib` is never pulled into native output. The web hook's
 * ref was typed `HTMLDivElement`; only attach-and-observe is needed here, so a
 * minimal node-like shape suffices (a real DOM element is assignable to it
 * under react-native-web).
 */
interface SentinelElement {
  readonly nodeType?: number;
}

/**
 * Minimal structural shape of an `IntersectionObserverEntry`. Only
 * `isIntersecting` — the single member the web hook reads — is typed.
 */
interface IntersectionEntryLike {
  isIntersecting: boolean;
}

/**
 * Minimal structural shape of an `IntersectionObserver`. Only the two members
 * the web hook touches (`observe`, `disconnect`) are typed.
 */
interface IntersectionObserverLike {
  observe: (target: SentinelElement) => void;
  disconnect: () => void;
}

type IntersectionObserverCtor = new (
  callback: (entries: IntersectionEntryLike[]) => void,
  options?: { threshold?: number },
) => IntersectionObserverLike;

/**
 * Resolve a global `IntersectionObserver` constructor without referencing
 * `window` (untyped/forbidden in native) or importing a DOM module. Returns
 * `null` on real React Native, where the observer simply does not exist.
 */
function getIntersectionObserver(): IntersectionObserverCtor | null {
  const g = globalThis as unknown as {
    IntersectionObserver?: IntersectionObserverCtor;
  };
  return typeof g.IntersectionObserver === 'function'
    ? g.IntersectionObserver
    : null;
}

/**
 * Threshold shared by both paths: the web hook used `0.1` for the
 * IntersectionObserver, and the native `onEndReached` path reuses it verbatim
 * as FlatList's `onEndReachedThreshold` so the "fire near the end" intent
 * stays identical.
 */
const SCROLL_THRESHOLD = 0.1;

/* ── Public hook (web parity) ──────────────────────────────────────────────── */

export function useInfiniteScroll(onLoadMore: () => void, hasMore: boolean) {
  const sentinelRef = useRef<SentinelElement | null>(null);

  const handleObserver = useCallback(
    (entries: IntersectionEntryLike[]) => {
      if (entries[0].isIntersecting && hasMore) onLoadMore();
    },
    [onLoadMore, hasMore],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const Observer = getIntersectionObserver();
    if (!Observer) return;
    const observer = new Observer(handleObserver, {
      threshold: SCROLL_THRESHOLD,
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleObserver]);

  return sentinelRef;
}

/* ── Native list handlers (FlatList / ScrollView) ──────────────────────────── */

export interface InfiniteScrollHandlers {
  /**
   * Pass to a `FlatList`/`ScrollView`: fires `onLoadMore` while `hasMore` is
   * true, mirroring the web `isIntersecting && hasMore -> onLoadMore` rule.
   */
  onEndReached: () => void;
  /** Mirrors the web 0.1 IntersectionObserver threshold. */
  onEndReachedThreshold: number;
}

/**
 * React Native-idiomatic counterpart to `useInfiniteScroll` for hosts that have
 * no DOM sentinel. Wire the returned props onto a `FlatList`/`ScrollView` to get
 * the identical "load more at the end while `hasMore`" behavior the web hook
 * provided through its IntersectionObserver sentinel.
 */
export function useInfiniteScrollHandlers(
  onLoadMore: () => void,
  hasMore: boolean,
): InfiniteScrollHandlers {
  const onEndReached = useCallback(() => {
    if (hasMore) onLoadMore();
  }, [onLoadMore, hasMore]);

  return useMemo<InfiniteScrollHandlers>(
    () => ({ onEndReached, onEndReachedThreshold: SCROLL_THRESHOLD }),
    [onEndReached],
  );
}
