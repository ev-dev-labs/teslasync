import { useEffect, useState } from 'react';

/**
 * Reactive `window.matchMedia()` hook. Returns the current match state for
 * a CSS media query, and re-renders whenever the match state flips
 * (e.g. the user rotates their phone, resizes the window, or attaches an
 * external display whose pointer kind differs).
 *
 * Designed for mobile-aware UI:
 *   - `useMediaQuery('(max-width: 640px)')`  → phone vs tablet breakpoint
 *   - `useMediaQuery('(pointer: coarse)')`   → tap-to-tooltip on touch devices
 *   - `useMediaQuery('(prefers-reduced-motion: reduce)')` → motion gating
 *
 * SSR / no-window safety: returns `false` synchronously when `window` is
 * undefined (initial paint in node test environments / SSR), then upgrades
 * to the real value on the first client-side `useEffect` tick. This avoids
 * hydration mismatches without adding `useSyncExternalStore` complexity.
 *
 * Listener cleanup is handled automatically; we use the modern
 * `addEventListener('change', …)` API and never fall back to the
 * deprecated `addListener` (Safari ≥ 14 + every other evergreen browser
 * supports the modern call).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(query);
    // Sync once in case the SSR / first-paint default disagrees with the
    // current client state (e.g. browser was resized between mount and
    // effect).
    setMatches(mql.matches);

    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener('change', listener);
    return () => {
      mql.removeEventListener('change', listener);
    };
  }, [query]);

  return matches;
}

/** Convenience alias for the most common phone-vs-larger query. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 640px)');
}

/** True on touch / stylus / pen — i.e. devices where hover tooltips never fire. */
export function useIsCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
