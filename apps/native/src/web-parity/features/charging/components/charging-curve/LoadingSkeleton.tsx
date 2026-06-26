// Native parity port of
// web/src/features/charging/components/charging-curve/LoadingSkeleton.tsx.
//
// The charging-curve page's loading placeholder. It claims the same vertical
// rhythm as the real charging-curve layout (header + filter row + a 6-up stat
// grid + two stacked chart panels + a 2-up panel grid + a 4-up stat grid) so
// the perceived load is "loading -> ready" rather than "empty -> full".
//
// Native adaptations (each documented in the .parity.json sidecar):
//   - Web imports `Skeleton` from '@/components/feedback' (a DOM <div> with the
//     Tailwind `animate-pulse` class over a token background). There is no
//     native parity port of that primitive yet, so an equivalent local
//     `Skeleton` is provided: an Animated.View whose opacity loops 1 -> 0.4 -> 1
//     (the perceptual shape of `animate-pulse`) over the colors.surfaceRaised
//     token, holding a static dimmed opacity when the OS "reduce motion"
//     setting is on. This mirrors the established PageSkeleton convention.
//   - Web `GlassPanel` (@/components/ui) -> the native GlassPanel parity
//     component (View with border + glass surface). `className` padding (`p-4`,
//     `p-6`) is translated to StyleSheet padding on the panel style.
//   - Tailwind sizing classes (`h-8`, `w-48`, `mt-2`, `w-full`, …) have no RN
//     equivalent and are translated to explicit StyleSheet dimensions /
//     margins. Tailwind unit = 0.25rem = 4px (e.g. `h-8` -> 32, `w-72` -> 288).
//   - CSS layout classes become flex: `space-y-*` -> rowGap; `flex gap-4` ->
//     a wrapping flex row; the responsive grids render their *base* (phone)
//     column count — `grid-cols-2 lg:grid-cols-3 xl:grid-cols-6` -> a 2-up
//     wrapping row, `grid-cols-1 lg:grid-cols-2` -> a single stacked column,
//     `grid-cols-2 lg:grid-cols-4` -> a 2-up wrapping row.
//   - The source carries no role/aria text, so no translatable strings are
//     invented; the root is only marked as a busy progressbar region (a
//     semantic, text-free native enhancement) so screen readers announce the
//     loading state.

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

import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';

/** Marks the skeleton as a busy loading region (text-free; no source aria). */
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
 * pulses its opacity to signal "loading", reproducing the web
 * `animate-pulse rounded bg-gray-…` visual intent. Holds a static dimmed
 * opacity when the OS requests reduced motion.
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

export default function LoadingSkeleton() {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityState={BUSY_STATE}
      style={styles.root}>
      <View style={styles.headerBlock}>
        <Skeleton style={styles.headerTitle} />
        <Skeleton style={styles.headerSubtitle} />
      </View>

      <View style={styles.filterRow}>
        <Skeleton style={styles.filterPrimary} />
        <Skeleton style={styles.filterSecondary} />
      </View>

      <View style={styles.statGrid}>
        {Array.from({length: 6}).map((_, i) => (
          <GlassPanel key={i} style={styles.statCard}>
            <Skeleton style={styles.statLabelNarrow} />
            <Skeleton style={styles.statValueWide} />
          </GlassPanel>
        ))}
      </View>

      <GlassPanel style={styles.panel}>
        <Skeleton style={styles.panelTitleSm} />
        <Skeleton style={styles.chartTall} />
      </GlassPanel>

      <GlassPanel style={styles.panel}>
        <Skeleton style={styles.panelTitleMd} />
        <Skeleton style={styles.chartMedium} />
      </GlassPanel>

      <View style={styles.dualGrid}>
        <GlassPanel style={styles.panel}>
          <Skeleton style={styles.panelTitleLg} />
          <Skeleton style={styles.chartShort} />
        </GlassPanel>
        <GlassPanel style={styles.panel}>
          <Skeleton style={styles.panelTitleLg} />
          <Skeleton style={styles.chartShort} />
        </GlassPanel>
      </View>

      <View style={styles.statGrid}>
        {Array.from({length: 4}).map((_, i) => (
          <GlassPanel key={i} style={styles.statCard}>
            <Skeleton style={styles.statLabelWide} />
            <Skeleton style={styles.statValueNarrow} />
          </GlassPanel>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonBase: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4,
    width: '100%',
  },
  // space-y-6
  root: {
    rowGap: 24,
  },
  // space-y-2
  headerBlock: {
    rowGap: 8,
  },
  // h-8 w-48
  headerTitle: {
    height: 32,
    width: 192,
  },
  // h-4 w-72
  headerSubtitle: {
    height: 16,
    width: 288,
  },
  // flex gap-4 (wraps on a phone viewport where the fixed widths can't fit)
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  // h-10 w-48
  filterPrimary: {
    height: 40,
    width: 192,
  },
  // h-10 w-64
  filterSecondary: {
    height: 40,
    width: 256,
  },
  // grid grid-cols-2 gap-4 (base/phone column count)
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  // GlassPanel p-4, two per wrapped row
  statCard: {
    flexBasis: '40%',
    flexGrow: 1,
    padding: 16,
  },
  // h-3 w-16
  statLabelNarrow: {
    height: 12,
    width: 64,
  },
  // mt-2 h-7 w-20
  statValueWide: {
    height: 28,
    marginTop: 8,
    width: 80,
  },
  // h-3 w-20
  statLabelWide: {
    height: 12,
    width: 80,
  },
  // mt-2 h-7 w-16
  statValueNarrow: {
    height: 28,
    marginTop: 8,
    width: 64,
  },
  // GlassPanel p-6
  panel: {
    padding: 24,
  },
  // h-5 w-40
  panelTitleSm: {
    height: 20,
    width: 160,
  },
  // h-5 w-56
  panelTitleMd: {
    height: 20,
    width: 224,
  },
  // h-5 w-44
  panelTitleLg: {
    height: 20,
    width: 176,
  },
  // mt-4 h-64 w-full
  chartTall: {
    height: 256,
    marginTop: 16,
    width: '100%',
  },
  // mt-4 h-52 w-full
  chartMedium: {
    height: 208,
    marginTop: 16,
    width: '100%',
  },
  // mt-4 h-48 w-full
  chartShort: {
    height: 192,
    marginTop: 16,
    width: '100%',
  },
  // grid grid-cols-1 gap-6 (base/phone single column -> stacked)
  dualGrid: {
    rowGap: 24,
  },
});
