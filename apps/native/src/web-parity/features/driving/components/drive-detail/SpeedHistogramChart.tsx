// Native parity port of
// web/src/features/driving/components/drive-detail/SpeedHistogramChart.tsx.
//
// The web component renders a single-series Recharts BarChart of the per-speed-
// bucket "% of drive" distribution inside a `ChartContainer` (title, aria label,
// exportable CSV + accessible data table), wrapped in a `FadeIn`. When there is
// no telemetry it shows a faded `Activity` lucide icon + "No telemetry data
// available" caption.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - `@/components/charts` ChartContainer is reused via the native parity
//     ChartContainer barrel (identical title/ariaLabel/data/dataColumns/height
//     API, and it renders the same accessible fallback data table the web relies
//     on).
//   - `@/components/charts` BarChart/Bar/XAxis/YAxis/CartesianGrid/Tooltip/
//     ResponsiveContainer -> the native recharts barrel only renders an
//     "unavailable" placeholder (Recharts needs browser DOM/SVG), so the bars
//     become a self-contained native SpeedHistogramBars view: a left Y-axis tick
//     column (max / mid / 0) plus a horizontal ScrollView of proportional View
//     bars (one per bucket, coloured with the web `#a855f7` Bar fill and the web
//     [4,4,0,0] top-rounded radius) with the bucket `range` as the X label.
//     Recharts hover tooltips (`Tooltip`/ChartTooltip) are unavailable on touch,
//     so the ChartContainer data table carries the exact values instead.
//   - The `Bar name={`% ${t('driveDetail.ofDrive','of drive')}`}` series label
//     (only surfaced by Recharts in the hover tooltip on web) becomes a small
//     native series-key chip (a `#a855f7` swatch + the same "% of drive" copy)
//     above the bars, preserving the driveDetail.ofDrive key.
//   - `lucide-react` Activity (empty state icon) -> native SemanticIcon
//     name="activity"; the web `opacity-20` faded look is reproduced at 0.4 for
//     glyph legibility.
//   - `@/components/motion` FadeIn (framer-motion, browser-only) -> an inline
//     native Animated FadeIn (opacity 0->1 + slide-up 12->0) honouring
//     prefers-reduced-motion via AccessibilityInfo, matching the StatCard /
//     PageHeader parity ports. The web `className="h-full"` becomes flex:1.
//   - react-i18next useTranslation (key + fallback) -> useNativeTranslation()
//     shim returning the fallback copy verbatim; every web t() key + default
//     string is preserved.
//   - `import type { SpeedHistogramBucket } from './types'` -> inlined local
//     interface (same {range: string; pct: number} shape).

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {spacing} from '../../../../../theme/tokens';
import {ChartContainer} from '../../../../components/charts';

/* ─── inline shims ─────────────────────────────────────────────────────────── */

// react-i18next useTranslation(): t(key, fallback) returns the fallback copy.
function useNativeTranslation(): (key: string, fallback: string) => string {
  return (_key, fallback) => fallback;
}

// Web `FadeIn` default entrance duration (useMotionPreference(400)).
const FADE_DURATION_MS = 400;

// Mirrors the StatCard / PageHeader reduce-motion source-of-truth.
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

// Native parity for the web `@/components/motion` FadeIn: fades + slides children
// up on mount. Reduce-motion renders the final state with no entry animation.
function FadeIn({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      duration: FADE_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();

    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [12, 0],
        }),
      },
    ],
  };

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

/* ─── types + constants ─────────────────────────────────────────────────────── */

// Inlined native port of web `./types` SpeedHistogramBucket.
interface SpeedHistogramBucket {
  range: string;
  pct: number;
}

// Web Recharts Bar `fill="#a855f7"` (purple) — kept verbatim.
const BAR_COLOR = '#a855f7';
// Web ChartContainer height={220}.
const CHART_HEIGHT = 220;
// Bar/Y-axis plot height inside the fixed-height chart body (leaves room for the
// series key above and the X labels below within the 220px body).
const BAR_TRACK_HEIGHT = 150;
// Minimum rendered height (%) for a non-zero bucket so tiny buckets stay visible.
const MIN_BAR_PCT = 3;

function formatPct(value: number): string {
  return value.toLocaleString('en-US', {maximumFractionDigits: 1});
}

/* ─── histogram bars ────────────────────────────────────────────────────────── */

interface SpeedHistogramBarsProps {
  data: SpeedHistogramBucket[];
  seriesLabel: string;
  accessibilityLabel: string;
}

function SpeedHistogramBars({
  data,
  seriesLabel,
  accessibilityLabel,
}: SpeedHistogramBarsProps) {
  const maxValue = data.reduce((max, bucket) => Math.max(max, bucket.pct), 0);
  const hi = maxValue > 0 ? maxValue : 1;
  const yTicks = [hi, hi / 2, 0].map(formatPct);

  return (
    <View style={styles.plot}>
      <View style={styles.seriesKey}>
        <View style={styles.seriesSwatch} />
        <AppText tone="secondary" variant="caption">
          {seriesLabel}
        </AppText>
      </View>

      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="image"
        accessible
        style={styles.chartFrame}>
        <View style={styles.yAxis}>
          {yTicks.map((tick, index) => (
            <AppText
              key={`${tick}-${index}`}
              numberOfLines={1}
              style={styles.axisTick}
              tone="muted"
              variant="caption">
              {tick}
            </AppText>
          ))}
        </View>
        <ScrollView
          contentContainerStyle={styles.barsContent}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {data.map((bucket, index) => (
            <View key={`${bucket.range}-${index}`} style={styles.barColumn}>
              <View style={styles.barTrack}>
                <HistogramBar hi={hi} value={bucket.pct} />
              </View>
              <AppText
                numberOfLines={1}
                style={styles.barLabel}
                tone="muted"
                variant="caption">
                {bucket.range}
              </AppText>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function HistogramBar({value, hi}: {value: number; hi: number}) {
  const pct =
    value > 0 ? Math.max(Math.min(value / hi, 1) * 100, MIN_BAR_PCT) : 0;
  return (
    <View style={styles.barSlot}>
      <View
        pointerEvents="none"
        style={[styles.bar, {height: `${pct}%` as DimensionValue}]}
      />
    </View>
  );
}

/* ─── component ─────────────────────────────────────────────────────────────── */

interface SpeedHistogramChartProps {
  speedHistData: SpeedHistogramBucket[];
}

export function SpeedHistogramChart({speedHistData}: SpeedHistogramChartProps) {
  const t = useNativeTranslation();
  const ariaLabel = t(
    'driveDetail.speedHistogram.aria',
    'Speed-bucket distribution histogram',
  );
  const seriesLabel = `% ${t('driveDetail.ofDrive', 'of drive')}`;

  return (
    <FadeIn style={styles.fill}>
      <ChartContainer
        ariaLabel={ariaLabel}
        data={speedHistData.map(bucket => ({
          pct: bucket.pct,
          range: bucket.range,
        }))}
        dataColumns={[
          {key: 'range', label: t('driveDetail.col.range', 'Speed range')},
          {key: 'pct', label: t('driveDetail.col.pct', '% of drive')},
        ]}
        height={CHART_HEIGHT}
        style={styles.fill}
        title={t('driveDetail.speedHistogram', 'Speed Histogram')}>
        {speedHistData.length > 0 ? (
          <SpeedHistogramBars
            accessibilityLabel={ariaLabel}
            data={speedHistData}
            seriesLabel={seriesLabel}
          />
        ) : (
          <View style={styles.empty}>
            <SemanticIcon decorative name="activity" size="lg" style={styles.emptyIcon} />
            <AppText tone="muted" variant="caption">
              {t('driveDetail.noChartData', 'No telemetry data available')}
            </AppText>
          </View>
        )}
      </ChartContainer>
    </FadeIn>
  );
}

SpeedHistogramChart.displayName = 'SpeedHistogramChart';

const styles = StyleSheet.create({
  axisTick: {
    textAlign: 'right',
  },
  bar: {
    backgroundColor: BAR_COLOR,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    width: 18,
  },
  barColumn: {
    alignItems: 'center',
    gap: spacing.xs,
    width: 56,
  },
  barLabel: {
    maxWidth: 56,
    textAlign: 'center',
  },
  barSlot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  barTrack: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    height: BAR_TRACK_HEIGHT,
    justifyContent: 'center',
    width: '100%',
  },
  barsContent: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  chartFrame: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  emptyIcon: {
    opacity: 0.4,
  },
  fill: {
    flex: 1,
  },
  plot: {
    gap: spacing.xs,
  },
  seriesKey: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  seriesSwatch: {
    backgroundColor: BAR_COLOR,
    borderRadius: 3,
    height: 10,
    width: 12,
  },
  yAxis: {
    height: BAR_TRACK_HEIGHT,
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    width: 36,
  },
});
