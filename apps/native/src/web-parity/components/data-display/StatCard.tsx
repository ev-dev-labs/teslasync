// Native parity port of web/src/components/data-display/StatCard.tsx.
//
// Replaces the web `Card`/`Skeleton`/`cn` + Tailwind/DOM `<div>`/`<span>` stack
// with React Native primitives, the native GlassPanel card shell, AppText, and
// theme tokens. The web `Skeleton` (an `animate-pulse` block) has no native
// parity component, so a reduced-motion-aware pulse block is inlined here while
// preserving the original width/height intent. See the parity sidecar for the
// line-by-line coverage map.

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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

import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../theme/tokens';

/** Directional intent for the optional trend chip (mirrors the web union). */
export type StatCardTrendDirection = 'up' | 'down' | 'flat';

/**
 * Optional change indicator rendered under the value. `value` is an
 * already-formatted, already-localised string (e.g. "12%"); `positive` flips
 * the colour to the success tone regardless of direction.
 */
export interface StatCardTrend {
  direction: StatCardTrendDirection;
  value: string;
  positive?: boolean;
}

export interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  /** Native node (typically a small glyph) shown to the right of the label. */
  icon?: ReactNode;
  trend?: StatCardTrend;
  sublabel?: string;
  loading?: boolean;
  /** Web Tailwind override; retained for source compatibility, ignored on native. */
  className?: string;
  /** Native style override on the outer card. */
  style?: StyleProp<ViewStyle>;
  /** Test hook on the outer card. */
  testID?: string;
}

const SKELETON_COLOR = 'rgba(148, 163, 184, 0.18)';

/** Mirrors the web `animate-pulse` skeleton primitive used for the loading state. */
function StatSkeleton({
  width,
  height,
  style,
}: {
  width: DimensionValue;
  height: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const pulse = useLoopingPulse(reduceMotion);
  const animatedStyle = reduceMotion
    ? null
    : {
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.45, 0.85],
        }),
      };

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.skeleton, {height, width}, animatedStyle, style]}
    />
  );
}

export function StatCard({
  label,
  value,
  unit,
  icon,
  trend,
  sublabel,
  loading,
  className: _className,
  style,
  testID,
}: StatCardProps) {
  if (loading) {
    return (
      <GlassPanel style={[styles.card, style]} testID={testID}>
        <StatSkeleton height={16} width="60%" />
        <StatSkeleton height={32} style={styles.skeletonSpacing} width="40%" />
      </GlassPanel>
    );
  }

  return (
    <GlassPanel style={[styles.card, styles.cardStack, style]} testID={testID}>
      <View style={styles.headerRow}>
        <AppText style={styles.labelText} tone="muted">
          {label}
        </AppText>
        {icon ? <View style={styles.icon}>{icon}</View> : null}
      </View>
      <View style={styles.valueRow}>
        <AppText style={styles.valueText} weight="bold">
          {value}
        </AppText>
        {unit ? (
          <AppText style={styles.unitText} tone="muted">
            {unit}
          </AppText>
        ) : null}
      </View>
      {trend ? (
        <View style={styles.trendRow}>
          <AppText style={[styles.trendText, {color: trendColor(trend)}]}>
            {trendArrow(trend.direction)}
          </AppText>
          <AppText style={[styles.trendText, {color: trendColor(trend)}]}>
            {trend.value}
          </AppText>
        </View>
      ) : null}
      {sublabel ? (
        <AppText style={styles.sublabelText} tone="muted">
          {sublabel}
        </AppText>
      ) : null}
    </GlassPanel>
  );
}

StatCard.displayName = 'StatCard';

function trendArrow(direction: StatCardTrendDirection): string {
  if (direction === 'up') {
    return '\u2191';
  }
  if (direction === 'down') {
    return '\u2193';
  }
  return '\u2014';
}

function trendColor(trend: StatCardTrend): string {
  if (trend.positive) {
    return colors.success;
  }
  if (trend.direction === 'flat') {
    return colors.textMuted;
  }
  return colors.danger;
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

  const reset = useCallback(() => pulse.setValue(0), [pulse]);

  useEffect(() => {
    if (reduceMotion) {
      reset();
      return;
    }

    reset();
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 700,
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
  }, [pulse, reduceMotion, reset]);

  return pulse;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: spacing.md,
  },
  cardStack: {
    gap: spacing.xs,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelText: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  skeleton: {
    backgroundColor: SKELETON_COLOR,
    borderRadius: 6,
  },
  skeletonSpacing: {
    marginTop: spacing.sm,
  },
  sublabelText: {
    fontSize: 12,
    lineHeight: 16,
  },
  trendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  trendText: {
    fontSize: 12,
    lineHeight: 16,
  },
  unitText: {
    fontSize: 14,
    lineHeight: 20,
  },
  valueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  valueText: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
});
