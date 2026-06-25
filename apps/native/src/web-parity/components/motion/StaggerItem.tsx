// Native parity port of web/src/components/motion/StaggerItem.tsx.
//
// The web component is a framer-motion `motion.div` variant child orchestrated
// by a parent <StaggerContainer> (initial="hidden" / animate="show" +
// staggerChildren). React Native has no framer-motion variant context, so this
// port self-drives the same entrance the `show` variant produces: fade in
// (opacity 0 -> 1) with a 15px slide-up (translateY 15 -> 0) over the
// motion-preference duration. The optional `delayMs` prop lets a native stagger
// container reproduce framer-motion's per-child `staggerChildren` offset.
//
// Honors the OS reduce-motion preference exactly like the web
// `useMotionPreference(350)` hook: when reduced motion is requested the item
// renders in its final state (opacity 1, translateY 0) with no slide-up.

import React, {useEffect, useRef, useState, type ReactNode} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export interface MotionPreference {
  /** True when the user has requested reduced motion. */
  reduce: boolean;
  /** Recommended transition duration in milliseconds (0 when reduced). */
  durationMs: number;
}

/**
 * Native parity for the web `useMotionPreference` hook. Mirrors framer-motion's
 * `useReducedMotion()` through React Native's `AccessibilityInfo` reduce-motion
 * API and derives the same `{ reduce, durationMs }` shape consumers destructure.
 * `durationMs` is `0` when reduced motion is requested, `defaultMs` otherwise.
 */
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

export interface StaggerItemProps {
  children?: ReactNode;
  /** Web Tailwind className retained for source parity; ignored on native. */
  className?: string;
  /**
   * Per-child entrance offset in milliseconds. A native <StaggerContainer> can
   * pass an incrementing value to reproduce framer-motion's `staggerChildren`.
   */
  delayMs?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Child item inside a StaggerContainer — animates in sequence. Respects the OS
 * reduce-motion preference: when set, items render in their final state with no
 * slide-up.
 */
export function StaggerItem({
  children,
  className: _className,
  delayMs = 0,
  style,
  testID,
}: StaggerItemProps): React.ReactElement {
  const {reduce, durationMs} = useMotionPreference(350);
  const progress = useRef(new Animated.Value(reduce ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      delay: delayMs,
      duration: durationMs,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [delayMs, durationMs, progress, reduce]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [15, 0],
        }),
      },
    ],
  };

  return (
    <Animated.View style={[animatedStyle, style]} testID={testID}>
      {children}
    </Animated.View>
  );
}

StaggerItem.displayName = 'StaggerItem';
