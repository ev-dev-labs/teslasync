// Native parity port of web/src/components/motion/StaggerContainer.tsx.
//
// The web component wraps children in a framer-motion `motion.div` with
// `initial="hidden"`/`animate="show"` variants whose only job is the
// `staggerChildren: reduce ? 0 : 0.06` transition — it orchestrates a staggered
// entrance of its children and collapses to a no-op when the user requests
// reduced motion (children render in their final state immediately).
//
// React Native has NO framer-motion and no variant-propagation system, so that
// orchestration is reproduced natively: each direct child is wrapped in an
// Animated.View that fades + slides into place with a per-child delay of
// `index * 0.06s` (the web `staggerChildren` value). Reduced motion is read from
// `AccessibilityInfo` (the native equivalent of `prefers-reduced-motion`); when
// enabled the stagger collapses to 0 and every child is shown in its final state
// at once, matching the web no-op. The web-only Tailwind `className` is retained
// for API parity but unused natively; a `style` escape hatch is exposed instead.

import React, {useEffect, useRef, useState, type ReactNode} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// Mirrors the web `staggerChildren: reduce ? 0 : 0.06` (seconds between each
// child's entrance).
const STAGGER_SECONDS = 0.06;
const ENTRANCE_DURATION_MS = 300;
const ENTRANCE_TRANSLATE_Y = 8;

export interface StaggerContainerProps {
  children: ReactNode;
  /** Web-only Tailwind className; retained for API parity but unused natively. */
  className?: string;
  /** Native style escape hatch applied to the container wrapper. */
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
  'data-testid'?: string;
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

function StaggerChild({
  children,
  delayMs,
  reduceMotion,
}: {
  children: ReactNode;
  delayMs: number;
  reduceMotion: boolean;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      // Reduced motion: collapse the stagger — child appears in its final state.
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      delay: delayMs,
      duration: ENTRANCE_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [delayMs, progress, reduceMotion]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [ENTRANCE_TRANSLATE_Y, 0],
            }),
          },
        ],
      }}>
      {children}
    </Animated.View>
  );
}

StaggerChild.displayName = 'StaggerChild';

/**
 * Container that staggers the entrance animation of its children. When the user
 * has requested reduced motion, the stagger is collapsed to a no-op so children
 * appear in their final state immediately.
 */
export function StaggerContainer({
  children,
  className: _className = '',
  style,
  accessibilityLabel,
  testID,
  'data-testid': dataTestID,
}: StaggerContainerProps): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const staggerMs = (reduceMotion ? 0 : STAGGER_SECONDS) * 1000;
  const items = React.Children.toArray(children);

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={style}
      testID={testID ?? dataTestID}>
      {items.map((child, index) => (
        <StaggerChild
          key={index}
          delayMs={index * staggerMs}
          reduceMotion={reduceMotion}>
          {child}
        </StaggerChild>
      ))}
    </View>
  );
}

StaggerContainer.displayName = 'StaggerContainer';
