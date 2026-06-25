// Native parity port of web/src/components/motion/FadeIn.tsx.
//
// Replaces framer-motion's <motion.div> (initial/animate/transition props), the
// DOM-only `className` hook, and the web `useMotionPreference(400)` wrapper with
// React Native primitives (Animated.View), a single 0->1 driver value, and a
// native AccessibilityInfo-backed reduced-motion check.
//
// Visual intent is preserved: children fade in (opacity 0 -> 1) while sliding up
// (translateY 12 -> 0) over a 400ms easeOut curve, with an optional per-instance
// delay for stagger orchestration. When the OS "reduce motion" setting is on,
// the element renders directly in its final state (opacity 1, translateY 0) with
// no entry animation — mirroring the web `initial={false}` reduced-motion path.

import React, {useEffect, useRef, useState, type ReactNode} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// `useMotionPreference(400)` in the source: 400ms default entry duration.
const DEFAULT_DURATION_MS = 400;
// framer initial `y: 12` slide-up offset (logical px) that resolves to 0.
const INITIAL_TRANSLATE_Y = 12;
// framer 'easeOut' is the cubic-bezier(0, 0, 0.58, 1) curve.
const EASE_OUT = Easing.bezier(0, 0, 0.58, 1);

export interface FadeInProps {
  children: ReactNode;
  /**
   * Entry delay in seconds, matching the web framer-motion `transition.delay`
   * unit. Used for stagger orchestration; ignored when reduced motion is on.
   */
  delay?: number;
  /** Native composition hook replacing the DOM-only `className` prop. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

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
 * Fades in children with a slide-up animation. Optional `delay` (seconds) for
 * stagger orchestration. Honours the OS reduced-motion setting: when reduced
 * motion is requested, the element renders in its final state with no entry
 * animation.
 */
export function FadeIn({
  children,
  delay = 0,
  style,
  testID,
}: FadeInProps): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: DEFAULT_DURATION_MS,
      delay: delay * 1000,
      easing: EASE_OUT,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [delay, progress, reduceMotion]);

  const animatedStyle = reduceMotion
    ? null
    : {
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [INITIAL_TRANSLATE_Y, 0],
            }),
          },
        ],
      };

  return (
    <Animated.View style={[style, animatedStyle]} testID={testID}>
      {children}
    </Animated.View>
  );
}

FadeIn.displayName = 'FadeIn';
