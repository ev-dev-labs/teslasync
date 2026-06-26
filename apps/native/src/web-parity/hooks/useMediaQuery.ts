/**
 * Native web-parity port of `web/src/hooks/useMediaQuery.ts`.
 *
 * Reactive media-query hook. Returns the current match state for a CSS media
 * query string and re-renders whenever that state flips (the user rotates the
 * device, resizes the window, or toggles a reduce-motion accessibility
 * setting).
 *
 * Designed for mobile-aware UI (contract identical to web):
 *   - `useMediaQuery('(max-width: 640px)')`  → phone vs tablet breakpoint
 *   - `useMediaQuery('(pointer: coarse)')`   → tap-to-tooltip on touch devices
 *   - `useMediaQuery('(prefers-reduced-motion: reduce)')` → motion gating
 *
 * Native adaptations (public API — `useMediaQuery` / `useIsMobile` /
 * `useIsCoarsePointer` — is unchanged):
 *   - The web hook drove everything through `window.matchMedia()`, a DOM-only
 *     API that does not exist on iOS / Android / Windows / macOS. Importing a
 *     DOM module into native output is forbidden, so this port resolves the
 *     query without one:
 *       1. If a `matchMedia` implementation is reachable on `globalThis`
 *          (react-native-web running inside a real browser), it is used exactly
 *          like the web hook — same initial value, same `addEventListener
 *          ('change', …)` subscription, same modern-only listener (never the
 *          deprecated `addListener`) — so the `web` target keeps 1:1 parity.
 *       2. Otherwise the query string is parsed and evaluated against React
 *          Native primitives: width / height / orientation come from
 *          `Dimensions`, `pointer` / `hover` from `Platform.OS` (ios/android =
 *          touch → coarse, no hover), and `prefers-reduced-motion` from
 *          `AccessibilityInfo`. Width changes re-evaluate via the `Dimensions`
 *          `change` event; reduce-motion changes via the `reduceMotion` event.
 *   - SSR / first-paint safety is preserved: `prefers-reduced-motion` resolves
 *     to `false` synchronously (matching the web SSR default) because
 *     `AccessibilityInfo.isReduceMotionEnabled()` is async, then upgrades to the
 *     real value on the first effect tick — the same "false now, correct on
 *     effect" philosophy the web hook used to avoid hydration mismatches.
 *   - Features not derivable on native (e.g. `prefers-color-scheme`) and
 *     unrecognised feature names evaluate to `false`, mirroring the web hook's
 *     no-match default rather than throwing. This is the documented explicit
 *     "unavailable" state required for browser-only behaviour.
 *
 * Listener cleanup is handled automatically on unmount for every subscription
 * path (matchMedia, Dimensions, AccessibilityInfo).
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Dimensions, Platform } from 'react-native';

/* ── matchMedia bridge (react-native-web / browser only) ──────────────────── */

/**
 * Minimal structural shape of a `MediaQueryList`. Declared locally so the DOM
 * `lib` is never pulled into native output — only the two members this hook
 * touches are typed, and the modern `addEventListener` API is used exclusively.
 */
interface MediaQueryListLike {
  matches: boolean;
  addEventListener: (
    type: 'change',
    listener: (event: { matches: boolean }) => void,
  ) => void;
  removeEventListener: (
    type: 'change',
    listener: (event: { matches: boolean }) => void,
  ) => void;
}

type MatchMediaFn = (query: string) => MediaQueryListLike;

/**
 * Resolve a `matchMedia` implementation from `globalThis` without referencing
 * `window` (which is untyped in the React Native tsconfig) or importing a DOM
 * module. Returns `null` on native, where the parser fallback takes over. The
 * returned wrapper keeps `globalThis` as the call receiver so browsers never
 * raise "Illegal invocation".
 */
function getMatchMedia(): MatchMediaFn | null {
  const g = globalThis as unknown as { matchMedia?: (q: string) => MediaQueryListLike };
  if (typeof g.matchMedia !== 'function') {
    return null;
  }
  return (q: string) => g.matchMedia!(q);
}

/* ── Native query evaluator (iOS / Android / Windows / macOS) ──────────────── */

interface MediaEnv {
  width: number;
  height: number;
  reduceMotion: boolean;
}

/**
 * Touch platforms expose a coarse pointer and cannot hover. react-native-web
 * (`Platform.OS === 'web'`) only reaches this evaluator when `matchMedia` is
 * unreachable, in which case treating it as non-touch (fine pointer, hover) is
 * the safest desktop-leaning default.
 */
const IS_TOUCH_PLATFORM = Platform.OS === 'ios' || Platform.OS === 'android';

function readEnv(reduceMotion: boolean): MediaEnv {
  const { width, height } = Dimensions.get('window');
  return { width, height, reduceMotion };
}

/** Parse a `<number>px` length. Non-numeric input yields `NaN` so every numeric comparison falls through to `false`. */
function parsePx(value: string): number {
  return parseFloat(value.replace(/px$/, '').trim());
}

function evaluateFeature(feature: string, env: MediaEnv): boolean {
  const inner = feature.replace(/^\(/, '').replace(/\)$/, '').trim();
  if (inner.length === 0) {
    return false;
  }
  const colon = inner.indexOf(':');
  const name = (colon === -1 ? inner : inner.slice(0, colon)).trim();
  const value = colon === -1 ? '' : inner.slice(colon + 1).trim();

  switch (name) {
    case 'min-width':
      return env.width >= parsePx(value);
    case 'max-width':
      return env.width <= parsePx(value);
    case 'width':
      return env.width === parsePx(value);
    case 'min-height':
      return env.height >= parsePx(value);
    case 'max-height':
      return env.height <= parsePx(value);
    case 'height':
      return env.height === parsePx(value);
    case 'orientation':
      return value === 'landscape'
        ? env.width > env.height
        : env.height >= env.width;
    case 'pointer':
    case 'any-pointer':
      if (value === 'coarse') {
        return IS_TOUCH_PLATFORM;
      }
      if (value === 'fine') {
        return !IS_TOUCH_PLATFORM;
      }
      return false;
    case 'hover':
    case 'any-hover':
      return value === 'none' ? IS_TOUCH_PLATFORM : !IS_TOUCH_PLATFORM;
    case 'prefers-reduced-motion':
      // `(prefers-reduced-motion)` shorthand and `: reduce` both mean reduce.
      return value === 'no-preference' ? !env.reduceMotion : env.reduceMotion;
    default:
      // Unknown / non-derivable features (e.g. prefers-color-scheme) → no match,
      // mirroring the web hook's default of `false` rather than throwing.
      return false;
  }
}

/** Evaluate a single `and`-joined feature group (every feature must match). */
function evaluateGroup(group: string, env: MediaEnv): boolean {
  const features = group
    .split(/\band\b/)
    .map((f) => f.trim())
    .filter(
      (f) =>
        f.length > 0 &&
        f !== 'screen' &&
        f !== 'all' &&
        f !== 'only' &&
        f !== 'print',
    );
  if (features.length === 0) {
    // Bare media type (e.g. `screen`): match unless it targets print only.
    return !group.includes('print');
  }
  return features.every((f) => evaluateFeature(f, env));
}

/** Evaluate a full media-query string. A top-level comma is CSS OR. */
function evaluateQuery(query: string, env: MediaEnv): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  return normalized.split(',').some((group) => evaluateGroup(group.trim(), env));
}

/* ── Public hook ──────────────────────────────────────────────────────────── */

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    const mm = getMatchMedia();
    if (mm) {
      return mm(query).matches;
    }
    // reduce-motion starts false (web SSR default) and upgrades on the effect.
    return evaluateQuery(query, readEnv(false));
  });

  useEffect(() => {
    const mm = getMatchMedia();
    if (mm) {
      // Faithful web path: identical to the original matchMedia subscription.
      const mql = mm(query);
      // Sync once in case the first-paint default disagrees with current state
      // (e.g. the window was resized between mount and effect).
      setMatches(mql.matches);
      const listener = (event: { matches: boolean }) => setMatches(event.matches);
      mql.addEventListener('change', listener);
      return () => {
        mql.removeEventListener('change', listener);
      };
    }

    // Native path: resolve against Dimensions + AccessibilityInfo + Platform.
    let cancelled = false;
    let reduceMotion = false;

    const recompute = () => {
      if (!cancelled) {
        setMatches(evaluateQuery(query, readEnv(reduceMotion)));
      }
    };

    recompute();

    // Seed reduce-motion asynchronously; the web SSR default was false, so we
    // upgrade to the device value once the async read resolves.
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        reduceMotion = value;
        recompute();
      })
      .catch(() => {
        /* keep the false default when the platform cannot report it */
      });

    const dimensionsSub = Dimensions.addEventListener('change', recompute);
    const motionSub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value: boolean) => {
        reduceMotion = value;
        recompute();
      },
    );

    return () => {
      cancelled = true;
      dimensionsSub.remove();
      motionSub.remove();
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
