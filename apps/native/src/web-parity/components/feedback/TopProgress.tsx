// Native parity port of web/src/components/feedback/TopProgress.tsx.
//
// A slim, top-of-screen progress strip that appears while at least one consumer
// (Suspense route bridge, opt-in heavy mutation) is active and snaps away once
// the active count returns to zero. The web source composes:
//   • the @/lib/globalProgress singleton controller (subscribe/start + trickle),
//   • the react-i18next t() for the aria-label,
//   • @/hooks/useMotionPreference (framer-motion's prefers-reduced-motion), and
//   • a fixed-position <div role="progressbar"> with a cyan->indigo->emerald
//     Tailwind gradient, a cyan glow box-shadow, and a width:`${n}%` style that
//     CSS-transitions unless reduced motion is requested.
//
// Every browser-only piece is adapted here (see the parity sidecar for the full
// line-by-line mapping):
//   • @/lib/globalProgress  -> an inline, byte-for-byte faithful port of the
//       controller. It is pure TypeScript (Set + setInterval + Math, no DOM), so
//       it runs unchanged in React Native. It is inlined (and re-exported) rather
//       than imported because the web lib lives outside the native app and has
//       not yet been ported into the parity tree; future consumers
//       (SuspenseProgressBoundary, useGlobalProgress) import the singleton + test
//       helpers from here so the start/stop concurrency contract stays shared.
//   • react-i18next t()     -> an inline English-default t(key, fallback).
//   • useMotionPreference   -> an inline native hook backed by
//       AccessibilityInfo.isReduceMotionEnabled() + the 'reduceMotionChanged'
//       event, returning the same { reduce, durationMs } shape as the web hook.
//   • <div role="progressbar"> -> an <Animated.View accessibilityRole="progressbar">
//       with accessibilityValue={{min,max,now}} + accessibilityLabel.
//   • fixed top-0 left-0 right-0 z-[60] -> position:'absolute' top/left/right:0 +
//       zIndex:60 (the native app's root host renders this inside a full-screen
//       container, the analog of the DOM viewport-fixed layer); an optional
//       `style` prop lets the host retarget it.
//   • h-0.5 (2px) + pointer-events-none -> height:2 + pointerEvents="none".
//   • cyan->indigo->emerald gradient + cyan glow box-shadow -> React Native ships
//       no CSS gradient and no gradient library is installed, so the multi-stop
//       gradient collapses to the solid cyan accent token (the gradient's leading
//       and dominant tone) plus a cyan glow shadow (the faithful analog of
//       shadow-[0_0_8px_rgba(34,211,238,0.55)]).
//   • width:`${n}%` + transition-[width] duration-fast ease-linear -> an
//       Animated.Value interpolated to a percentage string, eased linearly over
//       the 150ms --motion-duration-fast token when motion is allowed, and set
//       instantly (no smoothing) when reduced motion is requested — exactly the
//       web `reduce ? null : 'transition-[width] ...'` branch.
//
// No DOM modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {colors} from '../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  GlobalProgress controller (inline native-safe port)               */
/* ------------------------------------------------------------------ */
//
// Singleton "is the app busy?" channel that drives this <TopProgress> bar.
// Faithful port of @/lib/globalProgress: pure TypeScript with no DOM access, so
// it behaves identically under React Native. Two callers (once ported):
//   1. SuspenseProgressBoundary — starts/stops on Suspense fallback mount/unmount.
//   2. useGlobalProgress — opt-in for heavy mutations expected to exceed ~800ms.
//
// Concurrency contract: every `start` MUST be paired with the returned stop
// (try/finally or effect cleanup). Multiple concurrent starts stack — the bar
// stays active until the last stop fires. The returned stop is idempotent so
// React StrictMode's double-invoked effects cannot push activeCount below zero.
//
// While at least one consumer is active, an internal trickle timer advances
// `progress` asymptotically toward 80% (NProgress-style), so the bar moves even
// when the underlying work reports no granular progress. When the last consumer
// stops, progress + active snap back to 0/false.

export type GlobalProgressListener = (active: boolean, progress: number) => void;

/** Asymptotic ceiling the trickle approaches but never reaches without an explicit `stop`. */
export const TRICKLE_TARGET = 80;
/** Initial jump on the first `start` so the bar is immediately visible. */
export const TRICKLE_INITIAL = 8;
/** Tick interval driving the asymptotic trickle. */
export const TRICKLE_INTERVAL_MS = 120;

let activeCount = 0;
let progress = 0;
let trickleHandle: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<GlobalProgressListener>();

function publish(): void {
  const active = activeCount > 0;
  // Snapshot to a fresh array — listeners may add/remove during dispatch.
  for (const fn of Array.from(listeners)) {
    try {
      fn(active, progress);
    } catch {
      // Listener errors must never break the controller; keep the channel alive.
    }
  }
}

function startTrickle(): void {
  if (trickleHandle !== null) {
    return;
  }
  trickleHandle = setInterval(() => {
    if (activeCount === 0) {
      stopTrickle();
      return;
    }
    if (progress >= TRICKLE_TARGET) {
      return;
    }
    const remaining = TRICKLE_TARGET - progress;
    // Move 15% of the remaining gap each tick — guarantees forward motion
    // (Math.max with 1) without ever crossing the target.
    progress = Math.min(
      TRICKLE_TARGET,
      progress + Math.max(1, remaining * 0.15),
    );
    publish();
  }, TRICKLE_INTERVAL_MS);
}

function stopTrickle(): void {
  if (trickleHandle !== null) {
    clearInterval(trickleHandle);
    trickleHandle = null;
  }
}

function start(): () => void {
  activeCount++;
  if (activeCount === 1) {
    progress = TRICKLE_INITIAL;
    startTrickle();
  }
  publish();

  // Closure-local guard so the same stop can be safely called twice (StrictMode
  // double-invocation, defensive try/finally) without underflowing activeCount.
  let stopped = false;
  return function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    activeCount = Math.max(0, activeCount - 1);
    if (activeCount === 0) {
      stopTrickle();
      progress = 0;
      publish();
    }
  };
}

function subscribe(fn: GlobalProgressListener): () => void {
  listeners.add(fn);
  // Replay current state immediately so a listener mounted while the bar is
  // already active doesn't miss the "active" edge.
  try {
    fn(activeCount > 0, progress);
  } catch {
    /* see publish */
  }
  return () => {
    listeners.delete(fn);
  };
}

export const globalProgress = {
  start,
  subscribe,
} as const;

// ── Test-only helpers ──────────────────────────────────────────────
// Exposed so each test runs against a clean controller without leaking
// activeCount or trickle timers between cases. Production code must NEVER import
// these — guarded by the leading double-underscore naming convention.

export function __resetGlobalProgressForTests(): void {
  activeCount = 0;
  progress = 0;
  stopTrickle();
  listeners.clear();
}

export function __getGlobalProgressStateForTests(): {
  activeCount: number;
  progress: number;
  listeners: number;
  trickling: boolean;
} {
  return {
    activeCount,
    progress,
    listeners: listeners.size,
    trickling: trickleHandle !== null,
  };
}

/* ------------------------------------------------------------------ */
/*  Motion preference (inline native useMotionPreference)             */
/* ------------------------------------------------------------------ */

/** Native parity ships no react-i18next provider; return the English default. */
function t(_key: string, fallback: string): string {
  return fallback;
}

// --motion-duration-fast resolves to 150ms (and 0ms under prefers-reduced-motion)
// in the web theme; this is the `duration-fast` the web component transitions on.
const DURATION_FAST_MS = 150;
/** Default transition duration the web hook returns when motion is allowed. */
const MOTION_DEFAULT_MS = 250;

interface MotionPreference {
  /** True when the user has requested reduced motion. */
  reduce: boolean;
  /** Recommended transition duration in milliseconds (0 when reduced). */
  durationMs: number;
}

/**
 * useMotionPreference — native equivalent of @/hooks/useMotionPreference.
 *
 * The web hook wraps framer-motion's useReducedMotion(); the native analog reads
 * AccessibilityInfo.isReduceMotionEnabled() and subscribes to OS changes,
 * coalescing the framer-motion tri-state to a plain boolean and exposing the
 * same { reduce, durationMs } shape.
 */
function useMotionPreference(defaultMs = MOTION_DEFAULT_MS): MotionPreference {
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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export interface TopProgressProps {
  /**
   * Native composition hook replacing the web fixed-viewport positioning. React
   * Native's `position:'absolute'` is relative to the nearest positioned
   * ancestor, so the host renders <TopProgress /> inside its full-screen root;
   * pass `style` to retarget the strip.
   */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * TopProgress — top-of-screen progress strip.
 *
 * Subscribes to {@link globalProgress} and renders a slim 2px strip along the
 * top of the host's full-screen root while at least one consumer (Suspense
 * bridge, opt-in mutation) is active. Disappears once `activeCount` returns to
 * zero.
 *
 * Visual:
 *   - 2px tall, full-width, absolutely positioned at the top, zIndex 60 so it
 *     sits above banners (modals stay above at higher z).
 *   - The web cyan->indigo->emerald gradient collapses to the solid cyan accent
 *     token plus a cyan glow shadow (no native gradient primitive exists).
 *   - Width reflects the asymptotic trickle (0..80%) plus the final snap-back to
 *     0 on completion.
 *
 * Accessibility:
 *   - accessibilityRole="progressbar" with accessibilityValue {min,max,now} +
 *     an i18n-sourced accessibilityLabel.
 *   - Honors reduced motion: the width transition is omitted (no smoothing) but
 *     the bar still appears so users keep the loading affordance.
 */
export function TopProgress({style, testID}: TopProgressProps = {}) {
  const {reduce} = useMotionPreference();

  const [active, setActive] = useState(false);
  const [progressValue, setProgressValue] = useState(0);

  useEffect(() => {
    return globalProgress.subscribe((nextActive, nextProgress) => {
      setActive(nextActive);
      setProgressValue(nextProgress);
    });
  }, []);

  const valuenow = Math.round(Math.max(0, Math.min(100, progressValue)));

  const widthAnim = useRef(new Animated.Value(valuenow)).current;

  useEffect(() => {
    if (reduce) {
      // No smoothing under reduced motion — snap the width instantly.
      widthAnim.setValue(valuenow);
      return;
    }
    const animation = Animated.timing(widthAnim, {
      toValue: valuenow,
      duration: DURATION_FAST_MS,
      easing: Easing.linear,
      // Width is a layout prop, unsupported by the native driver.
      useNativeDriver: false,
    });
    animation.start();
    return () => {
      animation.stop();
    };
  }, [widthAnim, valuenow, reduce]);

  if (!active) {
    return null;
  }

  const width = widthAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel={t('global.loading', 'Loading')}
      accessibilityValue={{min: 0, max: 100, now: valuenow}}
      pointerEvents="none"
      testID={testID ?? 'top-progress'}
      style={[styles.bar, {width}, style]}
    />
  );
}

TopProgress.displayName = 'TopProgress';

export default TopProgress;

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.accent,
    elevation: 4,
    height: 2,
    left: 0,
    position: 'absolute',
    right: 0,
    // Faithful analog of shadow-[0_0_8px_rgba(34,211,238,0.55)] — a cyan glow.
    shadowColor: '#22d3ee',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.55,
    shadowRadius: 8,
    top: 0,
    zIndex: 60,
  },
});
