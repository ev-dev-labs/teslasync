// Native parity port of web/src/components/feedback/ChartSkeleton.tsx.
//
// Replaces the DOM div container + Tailwind `animate-skeleton-wave` bars with
// React Native View/Animated.View primitives. The web `skeletonWave` keyframe
// pulses opacity 0.03 -> 0.08 -> 0.03 over 1.8s ease-in-out, staggered per bar
// by `i * 0.1s`; that intent is reproduced with Animated + reduced-motion
// awareness. The web container has no explicit height (percentage bar heights
// resolve against the flex parent), so a native-safe default `height` is
// exposed for the percentage heights to resolve against.

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

const DEFAULT_BARS = 7;
const DEFAULT_HEIGHT = 120;
const WAVE_DURATION_MS = 1800;
const STAGGER_MS = 100;
const OPACITY_MIN = 0.03;
const OPACITY_MAX = 0.08;

export interface ChartSkeletonProps {
  /** Web-only Tailwind className; retained for API parity but unused natively. */
  className?: string;
  /** Number of animated bars to render (mirrors the web `bars` prop). */
  bars?: number;
  /**
   * Container height in px. The web component has no explicit height and relies
   * on percentage bar heights resolving against the flex parent; native
   * percentage heights need a concrete parent height, so this defaults to 120.
   */
  height?: number;
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

function SkeletonBar({
  delayMs,
  heightPercent,
  reduceMotion,
}: {
  delayMs: number;
  heightPercent: DimensionValue;
  reduceMotion: boolean;
}): React.ReactElement {
  const wave = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      wave.setValue(0.5);
      return;
    }

    wave.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delayMs),
        Animated.timing(wave, {
          duration: WAVE_DURATION_MS / 2,
          easing: Easing.inOut(Easing.sin),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(wave, {
          duration: WAVE_DURATION_MS / 2,
          easing: Easing.inOut(Easing.sin),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [delayMs, reduceMotion, wave]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.bar,
        {
          height: heightPercent,
          opacity: wave.interpolate({
            inputRange: [0, 1],
            outputRange: [OPACITY_MIN, OPACITY_MAX],
          }),
        },
      ]}
    />
  );
}

/** Skeleton shaped like a chart area — shows animated bars growing. */
export function ChartSkeleton({
  className: _className = '',
  bars = DEFAULT_BARS,
  height = DEFAULT_HEIGHT,
  style,
  accessibilityLabel,
  testID,
  'data-testid': dataTestID,
}: ChartSkeletonProps): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const barCount = Math.max(0, Math.floor(bars));

  const heights = useMemo<DimensionValue[]>(
    () =>
      Array.from({length: barCount}).map((_unused, i) => {
        const pct = Math.max(
          0,
          25 + Math.sin(i * 0.9) * 20 + Math.random() * 30,
        );
        return `${Math.round(pct * 100) / 100}%` as DimensionValue;
      }),
    [barCount],
  );

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? 'Loading chart'}
      accessibilityRole="image"
      style={[styles.root, {height}, style]}
      testID={testID ?? dataTestID}>
      {heights.map((heightPercent, i) => (
        <SkeletonBar
          key={i}
          delayMs={i * STAGGER_MS}
          heightPercent={heightPercent}
          reduceMotion={reduceMotion}
        />
      ))}
    </View>
  );
}
ChartSkeleton.displayName = 'ChartSkeleton';

const styles = StyleSheet.create({
  bar: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    flex: 1,
  },
  root: {
    alignItems: 'flex-end',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    padding: 16,
  },
});
