// Native parity port of web/src/components/feedback/StatSkeleton.tsx.
//
// The web component renders a responsive CSS grid (`grid-cols-2`,
// `sm:grid-cols-${count}`, `gap-3`) of `GlassPanel` cards, each holding two
// pulsing `<Skeleton>` bars (a short "label" bar over a taller "value" bar).
// Native equivalents:
//   * The CSS grid becomes a flex-wrap row of fixed-fraction cells. The
//     Tailwind `sm:` breakpoint (>=640px) is reproduced with
//     useWindowDimensions: 2 columns below 640px, `count` columns at/above it.
//   * The 12px (`gap-3`) gutter is reproduced with the negative-margin /
//     cell-padding technique so cards keep even spacing on first paint.
//   * The web `<Skeleton>` (`animate-pulse bg-gray-700 rounded`) is reproduced
//     inline as `SkeletonBar` using Animated opacity 1 -> 0.5 -> 1 over 2s,
//     with AccessibilityInfo reduced-motion awareness.
//
// NOTE on bar sizing: the web `<Skeleton>` applies an inline
// `style={{ width: '100%', height: 16 }}` that overrides the `h-3 w-16` /
// `h-7 w-24` classes, so both bars actually render full-width/16px tall on the
// web. The component's own doc comment + class names express the *intended*
// shape (a short label bar over a taller value bar), so this port honors that
// visual intent (label 64x12, value 96x28) rather than the latent web quirk.

import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {GlassPanel} from '../../../components/ui/GlassPanel';

const DEFAULT_COUNT = 4;
const SM_BREAKPOINT = 640;
const GRID_GAP = 12;
const CARD_PADDING = 16;
const BAR_GAP = 8;
const PULSE_DURATION_MS = 1000;
const OPACITY_BRIGHT = 1;
const OPACITY_DIM = 0.5;
const REDUCED_MOTION_OPACITY = 0.75;
const SKELETON_COLOR = '#374151';

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
  width,
  height,
  reduceMotion,
}: {
  width: number;
  height: number;
  reduceMotion: boolean;
}): React.ReactElement {
  const pulse = useRef(new Animated.Value(OPACITY_BRIGHT)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(REDUCED_MOTION_OPACITY);
      return;
    }

    pulse.setValue(OPACITY_BRIGHT);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: PULSE_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          toValue: OPACITY_DIM,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: PULSE_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          toValue: OPACITY_BRIGHT,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.bar, {width, height, opacity: pulse}]}
    />
  );
}

export interface StatSkeletonProps {
  /** Number of stat-card skeletons to render (mirrors the web `count` prop). */
  count?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
  'data-testid'?: string;
}

/** Skeleton shaped like a stat card with a number and label. */
export function StatSkeleton({
  count = DEFAULT_COUNT,
  style,
  accessibilityLabel,
  testID,
  'data-testid': dataTestID,
}: StatSkeletonProps): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const {width} = useWindowDimensions();
  const itemCount = Math.max(0, Math.floor(count));

  const columns = width >= SM_BREAKPOINT ? Math.max(1, itemCount) : 2;
  const cellWidth = `${100 / columns}%` as DimensionValue;

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? 'Loading statistics'}
      accessibilityState={{busy: true}}
      style={[styles.grid, style]}
      testID={testID ?? dataTestID}>
      {Array.from({length: itemCount}).map((_unused, i) => (
        <View key={i} style={[styles.cell, {width: cellWidth}]}>
          <GlassPanel style={styles.card}>
            <SkeletonBar width={64} height={12} reduceMotion={reduceMotion} />
            <SkeletonBar width={96} height={28} reduceMotion={reduceMotion} />
          </GlassPanel>
        </View>
      ))}
    </View>
  );
}
StatSkeleton.displayName = 'StatSkeleton';

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    margin: -GRID_GAP / 2,
  },
  cell: {
    padding: GRID_GAP / 2,
  },
  card: {
    gap: BAR_GAP,
    padding: CARD_PADDING,
  },
  bar: {
    backgroundColor: SKELETON_COLOR,
    borderRadius: 4,
  },
});
