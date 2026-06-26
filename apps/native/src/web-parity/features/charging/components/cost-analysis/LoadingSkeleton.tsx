// Native parity port of
// web/src/features/charging/components/cost-analysis/LoadingSkeleton.tsx.
//
// Renders the charging cost-analysis loading placeholder: a header row, a grid
// of six metric-card placeholders, two chart-panel placeholders, and a table
// placeholder of five rows. The structure, ordering, sizes and spacing of every
// web skeleton bar are preserved exactly.
//
// Three web imports have no DOM/native-shared equivalent and are replaced with
// React Native-safe equivalents (contract rules 4-7), documented in the sidecar:
//
//   - `@/components/ui` GlassPanel (web L1) -> the shared native GlassPanel; the
//     panels' className 'p-4' -> a padding of 16.
//   - `@/components/feedback` Skeleton (web L2) -> an internal native Skeleton:
//     an Animated.View whose opacity loops 1->0.4->1 (the native stand-in for
//     web's `animate-pulse`), honoring the width/height/rounded props and the
//     className margins (mt-2/mt-1/mt-4 -> marginTop 8/4/16). Skeleton is a
//     shared web component that is not a separate native conversion target, and
//     each loop commit is exactly one .tsx + one .parity.json, so it is inlined
//     here (the CostForecastSection/SessionComparisonChart precedent).
//   - `@/components/motion` FadeIn (web L3) -> an internal Animated.View mount
//     animation (opacity 0->1 + translateY 12->0 over 400ms), matching the web
//     FadeIn default (useMotionPreference(400), initial { opacity:0, y:12 }).
//
// CSS grid has no native equivalent: the 'grid-cols-2' card grid (web L18)
// becomes a row/flex-wrap with two 48%-width columns (space-between + rowGap),
// and the 'grid-cols-1' chart grid (web L28) is a single stacked column on
// native, matching each grid's mobile-first base column count.

import React, {useEffect, useRef, type ReactNode} from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';

const FADE_DURATION_MS = 400;
const PULSE_DURATION_MS = 600;

// web @/components/motion FadeIn: fade + slide-up entrance (400ms ease-out).
function FadeIn({children}: {children: ReactNode}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      duration: FADE_DURATION_MS,
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View style={{opacity: progress, transform: [{translateY}]}}>
      {children}
    </Animated.View>
  );
}

interface SkeletonProps {
  pulse: Animated.Value;
  width?: string;
  height?: number;
  rounded?: boolean;
  style?: StyleProp<ViewStyle>;
}

// web @/components/feedback Skeleton: a pulsing bar; rounded -> pill.
function Skeleton({pulse, width, height = 16, rounded, style}: SkeletonProps) {
  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          borderRadius: rounded ? 999 : 4,
          height,
          opacity: pulse,
          width: parseWidth(width),
        },
        style,
      ]}
    />
  );
}

// web Skeleton width default is '100%'; 'NNpx' strings become numeric points,
// percentage strings pass through unchanged.
function parseWidth(width?: string): DimensionValue {
  if (!width) {
    return '100%';
  }
  if (width.endsWith('px')) {
    const value = Number.parseFloat(width);
    return Number.isFinite(value) ? value : '100%';
  }
  return width as DimensionValue;
}

export function LoadingSkeleton() {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: PULSE_DURATION_MS,
          toValue: 0.4,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: PULSE_DURATION_MS,
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <FadeIn>
      <View style={styles.root}>
        {/* Header skeleton */}
        <View style={styles.header}>
          <View>
            <Skeleton pulse={pulse} width="220px" height={28} />
            <Skeleton pulse={pulse} width="340px" height={16} style={styles.mt2} />
          </View>
          <Skeleton pulse={pulse} width="200px" height={36} rounded />
        </View>

        {/* Card skeletons */}
        <View style={styles.cardsGrid}>
          {Array.from({length: 6}).map((_, i) => (
            <GlassPanel key={i} style={styles.card}>
              <Skeleton pulse={pulse} height={14} width="60%" />
              <Skeleton pulse={pulse} height={24} width="80%" style={styles.mt2} />
              <Skeleton pulse={pulse} height={12} width="40%" style={styles.mt1} />
            </GlassPanel>
          ))}
        </View>

        {/* Chart skeletons */}
        <View style={styles.chartsGrid}>
          <GlassPanel style={styles.chartPanel}>
            <Skeleton pulse={pulse} height={16} width="40%" />
            <Skeleton pulse={pulse} height={200} style={styles.mt4} />
          </GlassPanel>
          <GlassPanel style={styles.chartPanel}>
            <Skeleton pulse={pulse} height={16} width="40%" />
            <Skeleton pulse={pulse} height={200} style={styles.mt4} />
          </GlassPanel>
        </View>

        {/* Table skeleton */}
        <GlassPanel style={styles.tablePanel}>
          <Skeleton pulse={pulse} height={16} width="30%" />
          <View style={styles.tableRows}>
            {Array.from({length: 5}).map((_, i) => (
              <Skeleton key={i} pulse={pulse} height={32} />
            ))}
          </View>
        </GlassPanel>
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    width: '48%',
  },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 16,
  },
  chartPanel: {
    padding: 16,
  },
  chartsGrid: {
    gap: 16,
  },
  header: {
    gap: 16,
  },
  mt1: {
    marginTop: 4,
  },
  mt2: {
    marginTop: 8,
  },
  mt4: {
    marginTop: 16,
  },
  root: {
    gap: 24,
    padding: 24,
  },
  skeleton: {
    backgroundColor: colors.surfaceHover,
  },
  tablePanel: {
    padding: 16,
  },
  tableRows: {
    gap: 8,
    marginTop: 16,
  },
});
