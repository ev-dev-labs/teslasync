// Native parity port of web/src/components/feedback/PageSkeleton.tsx.
//
// Shaped page-skeleton building blocks.
//
// These primitives mirror the *structure* of common page sections so the
// loading UI claims the same vertical/horizontal space as the real content.
// That keeps layout shift close to zero and turns the perceived load from
// "empty -> suddenly full" into "loading -> ready".
//
// Each block is announced as a busy loading region so screen readers can
// identify it. On web this is `role="status" aria-busy="true"`; the native
// analog is accessibilityRole="progressbar" + accessibilityState={{busy:true}}
// + accessibilityLabel (the same literal English labels the web source hard
// codes, so the i18n intent — none — is preserved), with `accessible` so the
// shaped group reads as a single loading region.
//
// Native adaptations (each reduction documented in the .parity.json sidecar):
//   - The web `<Skeleton>` primitive (./Skeleton) is a DOM <div> with the
//     Tailwind `animate-pulse` class over a token background. There is no
//     native ./Skeleton parity port yet, so an equivalent native `Skeleton`
//     primitive is provided locally: an Animated.View whose opacity loops
//     1 -> 0.4 -> 1 (the perceptual shape of `animate-pulse`) over a token
//     surface colour, honouring the OS "reduce motion" setting by holding a
//     static dimmed opacity instead of animating.
//   - Tailwind sizing classes (`h-8`, `w-64`, `rounded-xl`, `rounded-t-xl`,
//     `max-w-full`, the `grid` stat row, the `grid gap-3` table rows) have no
//     RN equivalent and are translated to explicit StyleSheet dimensions /
//     flex layout. `grid grid-cols-2 md:grid-cols-4` becomes a wrapping flex
//     row; native is a phone viewport so the base 2-column layout applies.
//     `gridTemplateColumns: repeat(cols, minmax(0,1fr))` becomes one flex:1
//     cell per column inside a flex row.
//   - The `className` prop on every block is kept on the prop types for source
//     parity but is inert in native (layout is StyleSheet-driven), mirroring
//     the established MetricCard convention.
//   - `data-testid` -> `testID` with the exact same identifiers.

import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type AccessibilityState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {colors, spacing} from '../../../theme/tokens';

/** Shared accessibilityState mirroring the web `aria-busy="true"`. */
const BUSY_STATE: AccessibilityState = {busy: true};

/** Tracks the OS "reduce motion" preference so the pulse can hold static. */
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

interface SkeletonProps {
  /** Dimension / radius overrides for this placeholder. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Native equivalent of the web `<Skeleton>` primitive: a token-backed box that
 * pulses its opacity to signal "loading". Reuses the same visual intent as the
 * web `animate-pulse rounded bg-gray-…` block. Holds a static dimmed opacity
 * when the OS requests reduced motion.
 */
function Skeleton({style}: SkeletonProps) {
  const reduceMotion = useReduceMotion();
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
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.ease),
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

  const opacity = reduceMotion
    ? 0.6
    : pulse.interpolate({inputRange: [0, 1], outputRange: [1, 0.4]});

  return <Animated.View style={[styles.skeletonBase, style, {opacity}]} />;
}

interface BlockProps {
  /** Accepted for web source parity; native layout is StyleSheet-driven. */
  className?: string;
}

/** Mirrors `<PageContainer>`'s title + subtitle row. */
export function PageHeaderSkeleton(_props: BlockProps = {}) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityState={BUSY_STATE}
      accessibilityLabel="Loading page header"
      testID="page-header-skeleton"
      style={styles.headerBlock}>
      <Skeleton style={styles.headerTitle} />
      <Skeleton style={styles.headerSubtitle} />
    </View>
  );
}

interface StatGridSkeletonProps extends BlockProps {
  /** How many stat cards to render. Defaults to 4. */
  cards?: number;
}

/**
 * 2-column layout. Matches the typical
 * `grid grid-cols-2 md:grid-cols-4` stat-card row used across detail and
 * analytics pages — native renders the base (phone) 2-column variant.
 */
export function StatGridSkeleton({cards = 4}: StatGridSkeletonProps) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityState={BUSY_STATE}
      accessibilityLabel="Loading stat cards"
      testID="stat-grid-skeleton"
      style={styles.statGrid}>
      {Array.from({length: cards}).map((_, i) => (
        <Skeleton key={i} style={styles.statCard} />
      ))}
    </View>
  );
}

interface ChartBlockSkeletonProps extends BlockProps {
  /** Pixel height of the chart placeholder. Defaults to 320. */
  height?: number;
}

/**
 * Single rectangular placeholder sized to a chart container. Use for any
 * chart panel. Distinct from an animated-bar chart skeleton — this one is a
 * layout-preserving box.
 */
export function ChartBlockSkeleton({height = 320}: ChartBlockSkeletonProps) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityState={BUSY_STATE}
      accessibilityLabel="Loading chart"
      testID="chart-block-skeleton"
      style={styles.chartBlock}>
      <Skeleton style={[styles.chartBox, {height}]} />
    </View>
  );
}

interface TableSkeletonProps extends BlockProps {
  /** Number of body rows to render. Defaults to 8. */
  rows?: number;
  /** Number of columns. Defaults to 4. */
  cols?: number;
}

/** Table-shaped skeleton: header row + N body rows × M columns. */
export function TableSkeleton({rows = 8, cols = 4}: TableSkeletonProps) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityState={BUSY_STATE}
      accessibilityLabel="Loading table"
      testID="table-skeleton"
      style={styles.tableBlock}>
      <Skeleton style={styles.tableHeader} />
      {Array.from({length: rows}).map((_, r) => (
        <View key={r} style={styles.tableRow}>
          {Array.from({length: cols}).map((_, c) => (
            <Skeleton key={c} style={styles.tableCell} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonBase: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4,
    width: '100%',
  },
  headerBlock: {
    rowGap: spacing.sm,
  },
  headerTitle: {
    height: 32,
    width: 256,
  },
  headerSubtitle: {
    height: 16,
    maxWidth: '100%',
    width: 384,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  statCard: {
    borderRadius: 12,
    flexBasis: '40%',
    flexGrow: 1,
    height: 96,
  },
  chartBlock: {
    width: '100%',
  },
  chartBox: {
    borderRadius: 12,
  },
  tableBlock: {
    rowGap: spacing.sm,
  },
  tableHeader: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    height: 40,
  },
  tableRow: {
    columnGap: spacing.md,
    flexDirection: 'row',
  },
  tableCell: {
    borderRadius: 4,
    flexBasis: 0,
    flexGrow: 1,
    height: 32,
  },
});
