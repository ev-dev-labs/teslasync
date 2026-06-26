// Native parity port of web/src/components/motion/index.ts.
//
// The web file is the `components/motion` barrel. It re-exports five animation
// components (CarAnimation, FadeIn, RouteTransition, StaggerContainer,
// StaggerItem) plus the framer-motion `motion` / `AnimatePresence` primitives
// "for advanced use cases". Every one of those source lines pulls in
// browser-only animation machinery with no native parity surface, so — matching
// the established pattern for a barrel whose siblings have not been converted
// yet (the a11y barrel was likewise a self-contained .ts file) — this file is a
// SELF-CONTAINED native-safe implementation. Later per-component conversions
// are expected to extract these into sibling files and slim this barrel down to
// re-exports.
//
// Browser-only -> native-safe mappings (each documented in the parity sidecar):
//   - framer-motion `motion.*` + `useReducedMotion` -> React Native `Animated`
//     driven by a local `useMotionPreference` hook that mirrors the web hook
//     exactly (`reduce` coalesced from `AccessibilityInfo.isReduceMotionEnabled`,
//     `durationMs = reduce ? 0 : defaultMs`). framer's declarative
//     initial/animate/exit/variants API is unavailable; the entrance tweens are
//     reproduced imperatively with `Animated.timing`.
//   - `@/hooks/useMotionPreference` -> the local hook above (same name/shape).
//   - react-i18next `useTranslation` (the CarAnimation aria-label) -> a local
//     fallback resolver returning the inline English string while keeping the
//     i18n key (`carAnimation.tesla`), the same approach used by the
//     data-display / feedback web-parity ports.
//   - CarAnimation's inline SVG silhouette -> there is no `react-native-svg`
//     dependency, so the decorative Tesla is approximated with positioned
//     `View`s (body, cabin, two wheels, head/tail light, ground shadow). The
//     entrance draw-in + pulsing lights honour reduced motion.
//   - RouteTransition's react-router-dom `useLocation`/`matchPath` cross-fade ->
//     React Native has no DOM router, so route-change detection is UNAVAILABLE.
//     The component is a native-safe passthrough (mirroring the web
//     `initial={false}` "no first-render flash"); `skipPattern` is retained for
//     source compatibility but unused. See `nativeMotionCapabilities`.
//   - framer `AnimatePresence` exit animations -> unavailable on native; the
//     shim renders children. `motion` -> a native-safe namespace exposing the
//     RN `Animated` primitives (View/Text/ScrollView/Image).
//   - the web-only `className` prop on every component is retained on the prop
//     types for source compatibility but ignored on native (RN has no className).
//
// `.ts` (not `.tsx`) is required by the conversion contract, so all rendering
// uses `React.createElement` rather than JSX (same as the a11y barrel port).

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import {colors} from '../../../theme/tokens';

const createEl = React.createElement;

// ─── i18n fallback ────────────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while the call sites still reference the i18n key so intent is preserved.

type TFunc = (key: string, fallback: string) => string;

function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// ─── Reduced-motion preference ────────────────────────────────
// Native mirror of web `useMotionPreference`: `reduce` is coalesced to a boolean
// and `durationMs` is 0 when reduced, otherwise `defaultMs` (web default 250).

interface MotionPreference {
  reduce: boolean;
  durationMs: number;
}

function useMotionPreference(defaultMs = 250): MotionPreference {
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

// ─── FadeIn ───────────────────────────────────────────────────
// Mirrors the web framer FadeIn: opacity 0->1 with a translateY 12->0 slide over
// 400ms easeOut after an optional delay. Reduced motion renders the final state
// with no entry animation.

export interface FadeInProps {
  children?: ReactNode;
  /** Entrance delay in SECONDS (mirrors the web framer `transition.delay`). */
  delay?: number;
  /** Web-only; ignored on native. */
  className?: string;
}

export function FadeIn({children, delay = 0}: FadeInProps) {
  const {reduce, durationMs} = useMotionPreference(400);
  const progress = useRef(new Animated.Value(reduce ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      delay: delay * 1000,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, durationMs, progress, reduce]);

  return createEl(
    Animated.View,
    {
      style: {
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [12, 0],
            }),
          },
        ],
      },
    },
    children,
  );
}

// ─── Stagger ──────────────────────────────────────────────────
// The web `StaggerContainer` sets framer `staggerChildren: 0.06s` and relies on
// variant propagation; native has no variant context, so the container injects
// an incremental `delay` (index * 0.06s) into each direct child element. Each
// `StaggerItem` then animates opacity 0->1 / translateY 15->0 over 350ms after
// that delay. Reduced motion collapses the stagger to a no-op.

const STAGGER_SECONDS = 0.06;

export interface StaggerContainerProps {
  children?: ReactNode;
  /** Web-only; ignored on native. */
  className?: string;
}

export function StaggerContainer({children}: StaggerContainerProps) {
  const {reduce} = useMotionPreference();

  const staggered = React.Children.map(children, (child, index) => {
    if (!React.isValidElement(child)) {
      return child;
    }
    const childDelay = reduce ? 0 : index * STAGGER_SECONDS;
    return React.cloneElement(child as ReactElement<{delay?: number}>, {
      delay: childDelay,
    });
  });

  return createEl(View, null, staggered);
}

export interface StaggerItemProps {
  children?: ReactNode;
  /**
   * Entrance delay in SECONDS. On the web this is supplied implicitly by the
   * framer `staggerChildren` orchestration; on native `StaggerContainer`
   * injects it explicitly (index * 0.06s). Defaults to 0 for standalone use.
   */
  delay?: number;
  /** Web-only; ignored on native. */
  className?: string;
}

export function StaggerItem({children, delay = 0}: StaggerItemProps) {
  const {reduce, durationMs} = useMotionPreference(350);
  const progress = useRef(new Animated.Value(reduce ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      delay: delay * 1000,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, durationMs, progress, reduce]);

  return createEl(
    Animated.View,
    {
      style: {
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [15, 0],
            }),
          },
        ],
      },
    },
    children,
  );
}

// ─── RouteTransition ──────────────────────────────────────────
// The web component cross-fades route content on `pathname` change via
// react-router-dom (`useLocation` + `matchPath`) and framer `AnimatePresence`.
// React Native has no DOM router, so route-change detection is UNAVAILABLE; the
// native port is a passthrough that fills its parent. This preserves the web
// `initial={false}` behaviour (no first-render flash). `skipPattern` is kept for
// source compatibility but unused. See `nativeMotionCapabilities`.

export interface RouteTransitionProps {
  children: ReactNode;
  /**
   * Web route patterns that suppress the cross-fade. Retained for source
   * compatibility; unused on native (there is no DOM router to observe).
   */
  skipPattern?: readonly string[];
}

export function RouteTransition({children}: RouteTransitionProps) {
  return createEl(View, {style: styles.routeFill}, children);
}

// ─── CarAnimation ─────────────────────────────────────────────
// Decorative animated Tesla silhouette. The web source is an inline SVG; with no
// `react-native-svg` dependency the shape is approximated with positioned Views.
// The entrance draw-in (fade + scale) and the pulsing head/tail lights honour
// reduced motion (final, static state when requested).

export interface CarAnimationProps {
  size?: number;
  /** Web-only; ignored on native. */
  className?: string;
}

function makeCarDims(w: number, h: number): Record<string, ViewStyle> {
  const wheel = h * 0.4;
  const bodyHeight = h * 0.34;
  const headlightSize = Math.max(3, w * 0.04);
  return {
    shadow: {
      position: 'absolute',
      left: w * 0.1,
      top: h - h * 0.06,
      width: w * 0.8,
      height: h * 0.08,
      borderRadius: h * 0.04,
      backgroundColor: colors.textMuted,
    },
    body: {
      position: 'absolute',
      left: w * 0.08,
      top: h * 0.3,
      width: w * 0.84,
      height: bodyHeight,
      borderRadius: bodyHeight * 0.5,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1.5,
      borderColor: colors.accent,
    },
    cabin: {
      position: 'absolute',
      left: w * 0.3,
      top: h * 0.12,
      width: w * 0.4,
      height: h * 0.26,
      borderTopLeftRadius: h * 0.18,
      borderTopRightRadius: h * 0.18,
      borderBottomLeftRadius: h * 0.04,
      borderBottomRightRadius: h * 0.04,
      backgroundColor: colors.accentSoft,
      borderWidth: 0.8,
      borderColor: colors.accent,
    },
    wheelFront: {
      position: 'absolute',
      left: w * 0.2,
      top: h - wheel,
      width: wheel,
      height: wheel,
      borderRadius: wheel * 0.5,
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: colors.textMuted,
    },
    wheelRear: {
      position: 'absolute',
      left: w * 0.8 - wheel,
      top: h - wheel,
      width: wheel,
      height: wheel,
      borderRadius: wheel * 0.5,
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: colors.textMuted,
    },
    headlight: {
      position: 'absolute',
      right: w * 0.05,
      top: h * 0.42,
      width: headlightSize,
      height: headlightSize,
      borderRadius: headlightSize * 0.5,
      backgroundColor: colors.accent,
    },
    taillight: {
      position: 'absolute',
      left: w * 0.05,
      top: h * 0.38,
      width: Math.max(2, w * 0.025),
      height: h * 0.18,
      borderRadius: 2,
      backgroundColor: colors.danger,
    },
  };
}

export function CarAnimation({size = 120}: CarAnimationProps) {
  const {reduce} = useMotionPreference();
  const {t} = useTranslation();
  const w = size;
  const h = size * 0.4;

  const enter = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const pulse = useRef(new Animated.Value(reduce ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) {
      enter.setValue(1);
      pulse.setValue(1);
      return;
    }
    enter.setValue(0);
    const entrance = Animated.timing(enter, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    entrance.start();
    loop.start();
    return () => {
      entrance.stop();
      loop.stop();
    };
  }, [enter, pulse, reduce]);

  const dims = useMemo(() => makeCarDims(w, h), [w, h]);
  const shadowOpacity = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.18],
  });

  return createEl(
    View,
    {
      accessibilityRole: 'image',
      accessibilityLabel: t('carAnimation.tesla', 'Tesla vehicle illustration'),
      style: [styles.carRoot, {width: w, height: h}],
    },
    createEl(
      Animated.View,
      {
        style: {
          width: w,
          height: h,
          opacity: enter,
          transform: [
            {
              scale: enter.interpolate({
                inputRange: [0, 1],
                outputRange: [0.92, 1],
              }),
            },
          ],
        },
      },
      createEl(Animated.View, {
        key: 'shadow',
        style: [dims.shadow, {opacity: shadowOpacity}],
      }),
      createEl(View, {key: 'body', style: dims.body}),
      createEl(View, {key: 'cabin', style: dims.cabin}),
      createEl(View, {key: 'wheelFront', style: dims.wheelFront}),
      createEl(View, {key: 'wheelRear', style: dims.wheelRear}),
      createEl(Animated.View, {
        key: 'headlight',
        style: [dims.headlight, {opacity: pulse}],
      }),
      createEl(Animated.View, {
        key: 'taillight',
        style: [dims.taillight, {opacity: pulse}],
      }),
    ),
  );
}

// ─── framer-motion primitives (native-safe shims) ─────────────
// Re-exported by the web barrel "for advanced use cases". framer-motion is a
// DOM-only dependency absent from the native app, so these are native-safe
// substitutes: `AnimatePresence` renders its children (no exit-animation phase
// on native) and `motion` is a namespace of the RN `Animated` primitives that
// advanced consumers drive imperatively.

export interface AnimatePresenceProps {
  children?: ReactNode;
  /** Accepted for source compatibility; native has no exit-animation phase. */
  mode?: 'sync' | 'wait' | 'popLayout';
  /** Accepted for source compatibility; ignored on native. */
  initial?: boolean;
}

export function AnimatePresence({children}: AnimatePresenceProps) {
  return createEl(React.Fragment, null, children);
}

/**
 * Native-safe substitute for framer-motion's `motion` namespace. framer's
 * declarative props (initial/animate/exit/variants) are unavailable on native;
 * advanced consumers drive these `Animated` primitives imperatively.
 */
export const motion = {
  View: Animated.View,
  Text: Animated.Text,
  ScrollView: Animated.ScrollView,
  Image: Animated.Image,
} as const;

/** Documents which web/framer capabilities are unavailable in this native port. */
export const nativeMotionCapabilities = {
  framerMotionAvailable: false,
  declarativeVariantsAvailable: false,
  exitAnimationsAvailable: false,
  routeChangeCrossFadeAvailable: false,
  reactNativeSvgAvailable: false,
} as const;

const styles = StyleSheet.create({
  carRoot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeFill: {
    flexGrow: 1,
  },
});
