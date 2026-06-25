// Native parity port of web/src/components/feedback/Skeleton.tsx.
//
// Replaces the DOM <div> placeholder bars, Tailwind's `animate-pulse` /
// `rounded` / `rounded-full` / `bg-gray-200 dark:bg-gray-700` classes, the
// `space-y-2` vertical rhythm, and the `cn()` class composer with React Native
// primitives (View / Animated.View), native theme tokens, and an
// Animated-driven looping opacity pulse that mirrors Tailwind's animate-pulse
// (a 1 <-> 0.5 opacity cycle over a 2s ease-in-out keyframe).
//
// The native app is dark-only, so the single web `bg-gray-200 dark:bg-gray-700`
// light/dark pair collapses to the dark-mode token `colors.surfaceRaised` (a
// subtle raised neutral), matching the rest of the parity tree. The pulse
// honours the OS "reduce motion" setting: when enabled the bar renders at a
// steady mid opacity with no animation, exactly like the AIThinkingIndicator
// skeleton port.
//
// The web `width: string` / `height: number | string` CSS values become RN
// `DimensionValue` (numbers + percentage strings — the only width values the
// source ever produces are '100%' and '60%'). The DOM-only `className` prop is
// replaced by the native-friendly `style` / `testID` composition hooks.

import React, {useEffect, useRef, useState} from 'react';
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

import {colors, spacing} from '../../../theme/tokens';

// Tailwind animate-pulse: opacity 1 -> 0.5 -> 1 across a 2s cycle, so each
// half-cycle runs for 1s. `rounded` = 4px, `rounded-full` = a pill radius.
const PULSE_MIN_OPACITY = 0.5;
const PULSE_MAX_OPACITY = 1;
const PULSE_HALF_DURATION_MS = 1000;
const REDUCED_MOTION_OPACITY = 0.75;
const RADIUS_DEFAULT = 4;
const RADIUS_FULL = 9999;
// space-y-2 in the multi-line branch is a 0.5rem (8px) vertical gap.
const LINE_GAP = spacing.sm;

export interface SkeletonProps {
  /** Bar width — number or percentage string (web default '100%'). */
  width?: DimensionValue;
  /** Bar height — number or percentage string (web default 16). */
  height?: DimensionValue;
  /** Single-bar pill radius (web `rounded-full`); ignored when `lines > 1`. */
  rounded?: boolean;
  /** Number of stacked placeholder bars (web default 1). */
  lines?: number;
  /** Native composition hook replacing the web `className`. */
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

function useLoopingPulse(reduceMotion: boolean): Animated.Value {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0);
      return;
    }

    pulse.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: PULSE_HALF_DURATION_MS,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: PULSE_HALF_DURATION_MS,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [pulse, reduceMotion]);

  return pulse;
}

/**
 * Skeleton — animated placeholder bar(s) shown while content loads. A single
 * bar by default; pass `lines > 1` to stack that many bars with the last one
 * truncated to 60% width (mirroring the web ragged-paragraph look). The
 * `rounded` pill radius only applies to the single-bar form, matching the
 * source where the multi-line branch always uses the 4px `rounded` radius.
 */
export function Skeleton({
  width,
  height = 16,
  rounded,
  lines = 1,
  style,
  testID,
}: SkeletonProps) {
  const reduceMotion = useReduceMotion();
  const pulse = useLoopingPulse(reduceMotion);

  const pulseStyle = reduceMotion
    ? {opacity: REDUCED_MOTION_OPACITY}
    : {
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [PULSE_MAX_OPACITY, PULSE_MIN_OPACITY],
        }),
      };

  if (lines > 1) {
    const fallbackWidth: DimensionValue = width ?? '100%';

    return (
      <View style={[styles.lineGroup, style]} testID={testID ?? 'skeleton'}>
        {Array.from({length: lines}).map((_, i) => (
          <Animated.View
            key={i}
            style={[
              styles.bar,
              styles.barRounded,
              {width: i === lines - 1 ? '60%' : fallbackWidth, height},
              pulseStyle,
            ]}
          />
        ))}
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.bar,
        rounded ? styles.barRoundedFull : styles.barRounded,
        {width: width ?? '100%', height},
        pulseStyle,
        style,
      ]}
      testID={testID ?? 'skeleton'}
    />
  );
}

Skeleton.displayName = 'Skeleton';

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surfaceRaised,
  },
  barRounded: {
    borderRadius: RADIUS_DEFAULT,
  },
  barRoundedFull: {
    borderRadius: RADIUS_FULL,
  },
  lineGroup: {
    gap: LINE_GAP,
  },
});
