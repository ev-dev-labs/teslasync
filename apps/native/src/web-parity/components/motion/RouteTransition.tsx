// Native parity port of web/src/components/motion/RouteTransition.tsx.
//
// The web component cross-fades route content on `pathname` change. It wraps
// React Router's <Outlet /> so the chrome (sidebar, header) does not animate
// alongside the page body. Behaviour: a 120ms ease-out fade + 4px y-translate,
// framer-motion `mode="wait"` (the outgoing page unmounts before the incoming
// mounts so two pages are never visually layered), `initial={false}` (no fade
// on the very first/cold render), re-key by pathname only, honour
// `prefers-reduced-motion`, and skip list<->detail drill navigations entirely.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - framer-motion (`AnimatePresence`, `motion.div`) is unavailable in this
//     app, so the cross-fade is reimplemented with React Native `Animated`: a
//     single `Animated.View` driving `opacity` + `translateY`. `mode="wait"`
//     is preserved by freezing the OUTGOING children during the exit phase and
//     only swapping to the incoming children at the trough — so the two pages
//     are never layered, exactly like framer's wait mode. `initial={false}` is
//     preserved by skipping the animation on the first render.
//   - react-router-dom (`useLocation`, `matchPath`) is unavailable in native;
//     the current pathname is supplied via a `pathname` prop from the native
//     navigation shell (same precedent as the RouteAnnouncer parity port), and
//     `matchPath({ path, end: true }, pathname)` is reimplemented as the native
//     `matchRoutePattern()` (react-router v6 `:param` compile + `end` trailing
//     slash + case-insensitive semantics).
//   - `useMotionPreference(120)` (framer-motion's `prefers-reduced-motion`)
//     becomes a native `useReduceMotion()` backed by `AccessibilityInfo`
//     (`isReduceMotionEnabled` + `reduceMotionChanged`). `reduce` keeps the
//     same meaning (collapse the fade to a no-op) and the 120ms default is kept
//     as the `durationMs` prop default.
//   - The web `style={{ minHeight: '100%' }}` fill maps to RN `flex: 1` (the
//     idiomatic "fill the container" style), keeping the page body filling the
//     available height under the chrome.

import React, {useEffect, useRef, useState} from 'react';
import {AccessibilityInfo, Animated, Easing, StyleSheet} from 'react-native';

/**
 * Route patterns where the page-transition cross-fade is suppressed. Drilling
 * from a list (`/drives`) into a detail (`/drives/123`) — and back out — feels
 * better when it is near-instant. Animating those transitions makes the UI
 * feel sluggish even at 120ms because the user is mentally focused on the same
 * content (a row -> its expanded view).
 *
 * The check fires when EITHER the previous or current pathname matches any of
 * these patterns, so back-navigation (POP) is also skipped.
 *
 * Order does not matter — the first match wins.
 */
export const DEFAULT_SKIP_PATTERNS: readonly string[] = [
  '/drives/:id',
  '/drives/:id/replay',
  '/charging/:id',
  '/vehicles/:id',
  '/vehicles/:id/access',
  '/trips/:id',
];

/**
 * Documents which behaviours of the original web component survive the React
 * Native port and which degrade to explicit native-safe fallbacks.
 */
export const nativeRouteTransitionCapabilities = {
  reactRouterLocationAvailable: false,
  framerMotionAvailable: false,
  reducedMotionAvailable: true,
  crossFadeAvailable: true,
} as const;

export interface RouteTransitionProps {
  children: React.ReactNode;
  /**
   * Native-safe replacement for React Router's `useLocation().pathname`. Pass
   * the current route path from the native navigation shell so the cross-fade
   * fires on pathname changes (and only pathname — query/hash changes that the
   * shell keeps out of this value never re-trigger a fade, mirroring the web
   * re-key-by-pathname behaviour). Defaults to '' (no transitions).
   */
  pathname?: string;
  /**
   * Override the default list of route patterns that should NOT animate. When
   * either the previous or new pathname matches a pattern, the cross-fade is
   * suppressed for that navigation.
   *
   * Patterns use react-router v6 syntax (passed to `matchRoutePattern`).
   */
  skipPattern?: readonly string[];
  /**
   * Cross-fade duration in milliseconds. Mirrors the web `useMotionPreference(120)`
   * default; exposed as a prop so tests can drive the animation deterministically.
   */
  durationMs?: number;
}

/**
 * Compiles a react-router v6 path pattern into a RegExp using the same rules as
 * react-router's `compilePath(path, caseSensitive=false, end=true)`: escape
 * regex specials, turn each `/:param` segment into `/([^/]+)`, tolerate trailing
 * slashes, and match case-insensitively.
 */
function compilePattern(pattern: string): RegExp {
  const source =
    '^' +
    pattern
      .replace(/\/*\*?$/, '')
      .replace(/^\/*/, '/')
      .replace(/[\\.*+^${}|()[\]]/g, '\\$&')
      .replace(/\/:(\w+)/g, '/([^\\/]+)') +
    '\\/*$';
  return new RegExp(source, 'i');
}

/**
 * Native replacement for `matchPath({ path: pattern, end: true }, pathname)` —
 * returns true when `pathname` fully matches the react-router v6 `pattern`.
 */
export function matchRoutePattern(pattern: string, pathname: string): boolean {
  return compilePattern(pattern).test(pathname);
}

/**
 * Native `prefers-reduced-motion` equivalent backed by `AccessibilityInfo`.
 * Returns `true` when the OS reports reduced-motion, mirroring the `reduce`
 * value from the web `useMotionPreference()`.
 */
function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

/**
 * Cross-fades the route content on `pathname` change. Designed to be wrapped
 * around the navigation outlet so the chrome (sidebar, header) does not animate
 * alongside the page body.
 *
 * Behaviour:
 *   - 120ms ease-out fade + 4px y-translate. Subtle enough to feel polished
 *     without slowing the user down.
 *   - mode="wait" semantics: the outgoing page is frozen and faded out before
 *     the incoming page is swapped in and faded up, so two pages are never
 *     visually layered.
 *   - The very first render does not animate (no flash on cold page load).
 *   - Re-keyed by `pathname` only — the native shell keeps query/hash changes
 *     out of this value so filters/sort/anchors never trigger a re-fade.
 *   - Honours reduced motion via `useReduceMotion()`. When the user has
 *     requested reduced motion, the fade collapses to a no-op.
 *   - List-detail navigations (`/drives` <-> `/drives/:id`, etc.) skip the
 *     animation entirely so the drill-in / drill-back-out feel snappy.
 */
export function RouteTransition({
  children,
  pathname = '',
  skipPattern = DEFAULT_SKIP_PATTERNS,
  durationMs = 120,
}: RouteTransitionProps): React.ReactElement {
  const reduce = useReduceMotion();

  const opacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  const prevPathRef = useRef<string>(pathname);
  const committedChildrenRef = useRef<React.ReactNode>(children);
  const firstRenderRef = useRef(true);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  // During the exit phase we render `frozen` (the OUTGOING page) instead of the
  // latest `children` so the two pages are never layered — framer `mode="wait"`.
  const [exiting, setExiting] = useState(false);
  const [frozen, setFrozen] = useState<React.ReactNode>(null);

  useEffect(() => {
    const prevPath = prevPathRef.current;
    const newPath = pathname;

    // `initial={false}` — skip the entry animation on the very first render.
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      prevPathRef.current = newPath;
      return;
    }

    // Re-key by pathname only — query/hash-only changes never re-fade.
    if (newPath === prevPath) {
      return;
    }

    const matchesSkip = (path: string): boolean =>
      skipPattern.some(pattern => matchRoutePattern(pattern, path));

    const skipForList = matchesSkip(prevPath) || matchesSkip(newPath);
    const effectiveDurationMs = reduce || skipForList ? 0 : durationMs;

    // Track the previous path AFTER computing skipForList so the next change
    // sees the correct prev.
    prevPathRef.current = newPath;

    animRef.current?.stop();

    // Reduced motion or a list-detail navigation collapses to an instant swap.
    if (effectiveDurationMs === 0) {
      opacity.setValue(1);
      translateY.setValue(0);
      setFrozen(null);
      setExiting(false);
      return;
    }

    // Freeze the outgoing page and fade it out (opacity 1 -> 0, y 0 -> -4).
    setFrozen(committedChildrenRef.current);
    setExiting(true);

    const exitAnim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: effectiveDurationMs,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: -4,
        duration: effectiveDurationMs,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]);
    animRef.current = exitAnim;
    exitAnim.start(({finished}) => {
      if (!finished) {
        return;
      }

      // Swap to the incoming page at the trough, then fade it up
      // (opacity 0 -> 1, y 4 -> 0).
      setFrozen(null);
      setExiting(false);
      opacity.setValue(0);
      translateY.setValue(4);

      const enterAnim = Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: effectiveDurationMs,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: effectiveDurationMs,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]);
      animRef.current = enterAnim;
      enterAnim.start();
    });

    return () => {
      animRef.current?.stop();
    };
  }, [pathname, reduce, durationMs, skipPattern, opacity, translateY]);

  // Keep the committed-children snapshot fresh. Declared AFTER the pathname
  // effect so that, on a navigation render, the pathname effect freezes the
  // OUTGOING children (this ref still holds them) before this effect advances
  // the ref to the incoming children.
  useEffect(() => {
    committedChildrenRef.current = children;
  }, [children]);

  return (
    <Animated.View
      style={[styles.container, {opacity, transform: [{translateY}]}]}
      testID="route-transition">
      {exiting ? frozen : children}
    </Animated.View>
  );
}

RouteTransition.displayName = 'RouteTransition';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
