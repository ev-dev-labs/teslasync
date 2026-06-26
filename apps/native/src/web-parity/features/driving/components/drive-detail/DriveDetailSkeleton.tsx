// DriveDetailSkeleton — native parity port of
// web/src/features/driving/components/drive-detail/DriveDetailSkeleton.tsx.
//
// Mirrors the DriveDetailPage loading layout (web doc comment, verbatim intent):
// page header -> hero gauges -> 8 stat cards -> overview chart ->
// 2 side-by-side charts (SoC + elevation).
//
// The web component composes four shared building blocks from
// `@/components/feedback` — `Skeleton` (./Skeleton) plus `PageHeaderSkeleton`,
// `StatGridSkeleton`, `ChartBlockSkeleton` (./PageSkeleton). Those primitives
// are not yet ported as standalone native files (only ChartSkeleton /
// StatSkeleton exist under components/feedback). Following the established
// self-contained convention (see StatSkeleton.tsx / ChargingListPage.tsx),
// native-safe equivalents of each are reproduced inline here; their canonical
// standalone native files remain owned by their own conversion turns.
//
// Web -> native mapping:
//   * `<div className="space-y-6 p-4">` container -> root View (padding 16 =
//     p-4, column `gap` 24 = space-y-6).
//   * `<Skeleton>` (animate-pulse bg-gray-200 dark:bg-gray-700 rounded) ->
//     `SkeletonBox` Animated.View pulsing opacity 1->0.5->1 over 2s (Tailwind
//     animate-pulse curve cubic-bezier(0.4,0,0.6,1)); dark bg-gray-700 -> #374151.
//     A single shared pulse driver keeps every box in phase, exactly like the
//     web's one global animate-pulse keyframe.
//   * Responsive Tailwind grids are reproduced with useWindowDimensions:
//       - StatGrid `grid-cols-2 sm:grid-cols-4 lg:grid-cols-8` (cards=8) ->
//         2 cols <640, 4 cols 640-1023, 8 cols >=1024.
//       - Dual charts `grid-cols-1 lg:grid-cols-2` -> 1 col <1024, 2 cols >=1024.
//     Grid gutters (gap-4 / gap-6) use the negative-margin/cell-padding
//     technique so cells align flush with the full-width hero/chart boxes.
//   * AccessibilityInfo reduced-motion awareness freezes the pulse at a static
//     opacity. Web `role="status" aria-busy aria-label` -> RN `accessible` +
//     `accessibilityState={{busy:true}}` + `accessibilityLabel` (RN has no
//     'status' role); each block keeps its web data-testid as a native testID.
// No DOM / Recharts / Leaflet / web-UI imports — RN primitives only.

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

const CONTAINER_PADDING = 16; // p-4
const SECTION_GAP = 24; // space-y-6
const HEADER_BAR_GAP = 8; // PageHeaderSkeleton space-y-2

const TITLE_BAR_WIDTH = 256; // h-8 w-64
const TITLE_BAR_HEIGHT = 32;
const SUBTITLE_BAR_WIDTH = 384; // h-4 w-96 (capped by max-w-full)
const SUBTITLE_BAR_HEIGHT = 16;

const HERO_HEIGHT = 144; // Skeleton h-36
const STAT_CARDS = 8;
const STAT_CARD_HEIGHT = 96; // h-24
const STAT_GRID_GAP = 16; // gap-4
const OVERVIEW_CHART_HEIGHT = 320;
const SIDE_CHART_HEIGHT = 280;
const DUAL_GRID_GAP = 24; // gap-6

const RADIUS_SM = 4; // rounded
const RADIUS_XL = 12; // rounded-xl

const SM_BREAKPOINT = 640;
const LG_BREAKPOINT = 1024;

const PULSE_HALF_MS = 1000; // 2s total animate-pulse cycle
const PULSE_EASING = Easing.bezier(0.4, 0, 0.6, 1); // Tailwind animate-pulse curve
const OPACITY_BRIGHT = 1;
const OPACITY_DIM = 0.5;
const REDUCED_MOTION_OPACITY = 0.75;
const SKELETON_COLOR = '#374151'; // dark:bg-gray-700

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

function useSkeletonPulse(reduceMotion: boolean): Animated.Value {
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
          duration: PULSE_HALF_MS,
          easing: PULSE_EASING,
          toValue: OPACITY_DIM,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: PULSE_HALF_MS,
          easing: PULSE_EASING,
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

  return pulse;
}

/** Native equivalent of the web `<Skeleton>` (animate-pulse rounded block). */
function SkeletonBox({
  width = '100%',
  height,
  borderRadius = RADIUS_SM,
  pulse,
  style,
}: {
  width?: DimensionValue;
  height: DimensionValue;
  borderRadius?: number;
  pulse: Animated.Value;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.skeleton, {width, height, borderRadius, opacity: pulse}, style]}
    />
  );
}

/** Native equivalent of `PageHeaderSkeleton` — title bar over a subtitle bar. */
function PageHeaderSkeleton({pulse}: {pulse: Animated.Value}): React.ReactElement {
  return (
    <View
      accessible
      accessibilityLabel="Loading page header"
      accessibilityState={{busy: true}}
      style={styles.headerBlock}
      testID="page-header-skeleton">
      <SkeletonBox width={TITLE_BAR_WIDTH} height={TITLE_BAR_HEIGHT} pulse={pulse} />
      <SkeletonBox
        height={SUBTITLE_BAR_HEIGHT}
        pulse={pulse}
        style={styles.subtitleBar}
      />
    </View>
  );
}

/** Native equivalent of `StatGridSkeleton` (cards=8, sm:4 / lg:8 columns). */
function StatGridSkeleton({pulse}: {pulse: Animated.Value}): React.ReactElement {
  const {width} = useWindowDimensions();
  const columns = width >= LG_BREAKPOINT ? 8 : width >= SM_BREAKPOINT ? 4 : 2;
  const cellWidth = `${100 / columns}%` as DimensionValue;

  return (
    <View
      accessible
      accessibilityLabel="Loading stat cards"
      accessibilityState={{busy: true}}
      style={styles.statGrid}
      testID="stat-grid-skeleton">
      {Array.from({length: STAT_CARDS}).map((_unused, i) => (
        <View key={i} style={[styles.statCell, {width: cellWidth}]}>
          <SkeletonBox
            height={STAT_CARD_HEIGHT}
            borderRadius={RADIUS_XL}
            pulse={pulse}
          />
        </View>
      ))}
    </View>
  );
}

/** Native equivalent of `ChartBlockSkeleton` — a layout-preserving chart box. */
function ChartBlockSkeleton({
  height,
  pulse,
}: {
  height: number;
  pulse: Animated.Value;
}): React.ReactElement {
  return (
    <View
      accessible
      accessibilityLabel="Loading chart"
      accessibilityState={{busy: true}}
      style={styles.fullWidth}
      testID="chart-block-skeleton">
      <SkeletonBox height={height} borderRadius={RADIUS_XL} pulse={pulse} />
    </View>
  );
}

export interface DriveDetailSkeletonProps {
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

export function DriveDetailSkeleton({
  style,
  testID,
  'data-testid': dataTestID,
}: DriveDetailSkeletonProps = {}): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const pulse = useSkeletonPulse(reduceMotion);
  const {width} = useWindowDimensions();

  const chartColumns = width >= LG_BREAKPOINT ? 2 : 1;
  const chartCellWidth = `${100 / chartColumns}%` as DimensionValue;

  return (
    <View
      accessible
      accessibilityLabel="Loading drive detail"
      accessibilityState={{busy: true}}
      style={[styles.root, style]}
      testID={testID ?? dataTestID ?? 'drive-detail-skeleton'}>
      <PageHeaderSkeleton pulse={pulse} />
      <SkeletonBox height={HERO_HEIGHT} borderRadius={RADIUS_XL} pulse={pulse} />
      <StatGridSkeleton pulse={pulse} />
      <ChartBlockSkeleton height={OVERVIEW_CHART_HEIGHT} pulse={pulse} />
      <View style={styles.dualGrid}>
        {[SIDE_CHART_HEIGHT, SIDE_CHART_HEIGHT].map((chartHeight, i) => (
          <View key={i} style={[styles.dualCell, {width: chartCellWidth}]}>
            <ChartBlockSkeleton height={chartHeight} pulse={pulse} />
          </View>
        ))}
      </View>
    </View>
  );
}
DriveDetailSkeleton.displayName = 'DriveDetailSkeleton';

const styles = StyleSheet.create({
  root: {
    gap: SECTION_GAP,
    padding: CONTAINER_PADDING,
  },
  skeleton: {
    backgroundColor: SKELETON_COLOR,
  },
  headerBlock: {
    gap: HEADER_BAR_GAP,
  },
  subtitleBar: {
    maxWidth: SUBTITLE_BAR_WIDTH,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    margin: -STAT_GRID_GAP / 2,
  },
  statCell: {
    padding: STAT_GRID_GAP / 2,
  },
  fullWidth: {
    width: '100%',
  },
  dualGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    margin: -DUAL_GRID_GAP / 2,
  },
  dualCell: {
    padding: DUAL_GRID_GAP / 2,
  },
});
