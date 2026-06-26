// Native parity port of web/src/hooks/useMotionPreference.ts.
//
// Web -> native adaptation (conversion contract rule 7): the web hook wrapped
// framer-motion's `useReducedMotion()`, which reads the browser
// `prefers-reduced-motion: reduce` media query. framer-motion is a DOM-only
// dependency with no React Native equivalent, so it is replaced with React
// Native's `AccessibilityInfo` ("Reduce Motion" accessibility setting), which
// is the canonical OS-level reduced-motion signal on iOS/Android/Windows/macOS.
// The public contract is preserved exactly: the same `MotionPreference`
// interface, the same `useMotionPreference(defaultMs = 250)` signature, and the
// same derived `durationMs` (0 when reduced, `defaultMs` otherwise). This is the
// canonical version of the inline stand-in already embedded in
// web-parity/components/mobile/PullToRefresh.tsx.

import {useEffect, useState} from 'react';
import {AccessibilityInfo} from 'react-native';

/**
 * Project wrapper around the OS reduced-motion accessibility preference.
 *
 * Returns the user's reduced-motion preference plus a derived duration value
 * components can pass straight into an Animated timing
 * (`Animated.timing(value, { duration: durationMs, ... })`).
 *
 * - `reduce` is `true` when the OS reports its "Reduce Motion" accessibility
 *   setting is enabled, `false` otherwise. The async lookup starts at `false`
 *   on first render and updates once `AccessibilityInfo` resolves — mirroring
 *   the web hook's first-paint coalesce of framer-motion's tri-state `null` to
 *   `false`, so consumers never have to handle the indeterminate case.
 * - `durationMs` is `0` when reduced motion is requested, `defaultMs` (default
 *   `250`) otherwise. Pass `defaultMs` to override per-component.
 *
 * Usage:
 * ```tsx
 * const {reduce, durationMs} = useMotionPreference();
 * useEffect(() => {
 *   if (reduce) {
 *     opacity.setValue(1); // skip the entry animation entirely
 *     return;
 *   }
 *   Animated.timing(opacity, {
 *     toValue: 1,
 *     duration: durationMs,
 *     easing: Easing.out(Easing.ease),
 *     useNativeDriver: true,
 *   }).start();
 * }, [reduce, durationMs, opacity]);
 * ```
 *
 * Setting the animated value directly (skipping the timing) when `reduce` is
 * `true` is the native equivalent of the web `initial={false}` pattern: the
 * element renders in its final state immediately — the recommended pattern when
 * reduced motion is requested.
 *
 * See `docs/A11Y_GUIDELINES.md` for the project policy.
 */
export interface MotionPreference {
  /** True when the user has requested reduced motion. */
  reduce: boolean;
  /** Recommended transition duration in milliseconds (0 when reduced). */
  durationMs: number;
}

export function useMotionPreference(defaultMs = 250): MotionPreference {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduce(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduce,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return {reduce, durationMs: reduce ? 0 : defaultMs};
}
