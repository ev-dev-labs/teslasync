// Native parity port of
// web/src/features/analytics/components/review/ChargingBreakdownSlide.tsx.
//
// The web component is one slide of the Tesla "year in review" story: an animated
// plug emoji, the total charge-session count, the average plug-in battery level,
// a Recharts donut of the supercharger / DC-fast / AC-other split, and a colour
// legend underneath. Every datum comes from the `YearReview` API shape.
//
// Native reductions (documented in the parity sidecar):
//   - framer-motion `motion` (web L1): there is no native framer-motion runtime,
//     so a local `MotionView` reproduces each entry animation with React Native
//     `Animated` (spring for the emoji pop, timed opacity/translateY/scale for the
//     rest), honouring the OS reduce-motion setting (jumps to the final state) —
//     the same contract as the proven SecurityStatusCards FadeIn port.
//   - Recharts `PieChart/Pie/Cell/ResponsiveContainer` (web L2, L60-77): Recharts
//     needs browser DOM/SVG layout and `react-native-svg` is not a dependency, so
//     the donut is replaced by a native-safe proportional segmented bar built from
//     plain Views coloured by the identical `COLORS` palette. It preserves the
//     donut's information (the relative share of each charging source); the colour
//     legend below carries the exact per-source percentages, exactly as on web.
//   - react-i18next `useTranslation` (web L3/L14): no native i18next runtime, so a
//     native-safe `t(key, fallback | options)` shim returns the English default
//     (else the key) and interpolates i18next-style `{{token}}` placeholders,
//     preserving every key plus the parameterised avgStartSOC `{{soc}}` value.
//   - `YearReview` (web L4) is imported from the web-parity native api/types mirror.

import React, {
  useEffect,
  useMemo,
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
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type {YearReview} from '../../../../api/types';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';

interface Props {
  data: YearReview;
}

const COLORS = ['#f59e0b', '#3b82f6', '#6b7280'];

// ── native-safe useTranslation (react-i18next has no native runtime) ─────────
type TVars = Record<string, string | number>;
type TOptions = {defaultValue?: string} & TVars;
type NativeTFunction = (key: string, fallback?: string | TOptions) => string;

/** Interpolates i18next-style `{{token}}` placeholders against `vars`. */
function interpolate(template: string, vars?: TVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, token: string) =>
    token in vars ? String(vars[token]) : `{{${token}}}`,
  );
}

/** Mirrors react-i18next `t(key, default)` and `t(key, {defaultValue, ...vars})`. */
function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallback) => {
      if (typeof fallback === 'string') {
        return fallback;
      }
      if (fallback && typeof fallback === 'object') {
        const {defaultValue, ...vars} = fallback;
        return interpolate(defaultValue ?? key, vars);
      }
      return key;
    },
    [],
  );
}

// ── reduce-motion preference (drives the entry animations) ───────────────────
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

// ── MotionView (native-safe port of the framer-motion entry animations) ──────
interface MotionViewProps {
  children: ReactNode;
  delay?: number;
  duration?: number;
  fromOpacity?: number;
  fromScale?: number;
  fromTranslateY?: number;
  spring?: boolean;
  style?: StyleProp<ViewStyle>;
}

function MotionView({
  children,
  delay = 0,
  duration = 0.4,
  fromOpacity = 1,
  fromScale = 1,
  fromTranslateY = 0,
  spring = false,
  style,
}: MotionViewProps) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = spring
      ? Animated.spring(progress, {
          toValue: 1,
          delay: delay * 1000,
          stiffness: 200,
          damping: 15,
          mass: 1,
          useNativeDriver: true,
        })
      : Animated.timing(progress, {
          toValue: 1,
          duration: duration * 1000,
          delay: delay * 1000,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion, delay, duration, spring]);

  const opacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [fromOpacity, 1],
  });
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [fromScale, 1],
  });
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [fromTranslateY, 0],
  });

  return (
    <Animated.View
      style={[{opacity, transform: [{scale}, {translateY}]}, style]}>
      {children}
    </Animated.View>
  );
}

export function ChargingBreakdownSlide({data}: Props) {
  const t = useNativeTranslation();

  const chartData = useMemo(() => {
    const items = [
      {name: t('yearReview.supercharger', 'Supercharger'), value: data.supercharger_pct},
      {name: t('yearReview.dcFast', 'DC Fast'), value: data.dc_fast_pct},
      {name: t('yearReview.acOther', 'AC / Other'), value: data.ac_other_pct},
    ];
    return items.filter(d => d.value > 0);
  }, [data.supercharger_pct, data.dc_fast_pct, data.ac_other_pct, t]);

  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <View style={styles.root}>
      <MotionView fromScale={0} spring style={styles.emojiWrap}>
        <AppText style={styles.emoji}>🔌</AppText>
      </MotionView>

      <MotionView
        delay={0.2}
        duration={0.4}
        fromOpacity={0}
        fromTranslateY={20}
        style={styles.sessionsWrap}>
        <AppText variant="title" weight="bold" style={styles.centerText}>
          {data.total_charge_sessions} {t('yearReview.chargeSessions', 'charge sessions')}
        </AppText>
      </MotionView>

      <MotionView
        delay={0.4}
        duration={0.3}
        fromOpacity={0}
        style={styles.socWrap}>
        <AppText tone="muted" style={styles.centerText}>
          {t('yearReview.avgStartSOC', {
            soc: Math.round(data.avg_charge_start_soc),
            defaultValue: 'Average plug-in at {{soc}}% battery',
          })}
        </AppText>
      </MotionView>

      <MotionView
        delay={0.5}
        duration={0.6}
        fromOpacity={0}
        fromScale={0.8}
        style={styles.chartWrap}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={chartData
            .map(item => `${item.name} ${Math.round(item.value)}%`)
            .join(', ')}
          style={styles.bar}>
          {chartData.map((item, i) => (
            <View
              key={item.name}
              style={[
                styles.segment,
                {
                  backgroundColor: COLORS[i % COLORS.length],
                  flexGrow: total > 0 ? item.value / total : 1,
                },
              ]}
            />
          ))}
        </View>
      </MotionView>

      <MotionView
        delay={0.8}
        duration={0.4}
        fromOpacity={0}
        fromTranslateY={20}
        style={styles.legend}>
        {chartData.map((item, i) => (
          <View key={item.name} style={styles.legendItem}>
            <View
              style={[styles.dot, {backgroundColor: COLORS[i % COLORS.length]}]}
            />
            <AppText tone="secondary" style={styles.legendLabel}>
              {item.name} ({Math.round(item.value)}%)
            </AppText>
          </View>
        ))}
      </MotionView>
    </View>
  );
}

ChargingBreakdownSlide.displayName = 'ChargingBreakdownSlide';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emojiWrap: {
    marginBottom: spacing.md,
  },
  emoji: {
    fontSize: 48,
    lineHeight: 56,
    textAlign: 'center',
  },
  sessionsWrap: {
    marginBottom: spacing.xs,
  },
  socWrap: {
    marginBottom: spacing.lg,
  },
  centerText: {
    textAlign: 'center',
  },
  chartWrap: {
    width: 224,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  bar: {
    flexDirection: 'row',
    width: '100%',
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  segment: {
    height: '100%',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: spacing.lg,
    rowGap: spacing.sm,
    marginTop: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
  },
  dot: {
    height: 12,
    width: 12,
    borderRadius: 6,
  },
  legendLabel: {
    fontSize: 14,
  },
});
