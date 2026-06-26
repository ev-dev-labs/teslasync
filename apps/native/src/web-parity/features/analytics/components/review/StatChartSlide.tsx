// Native parity port of
// web/src/features/analytics/components/review/StatChartSlide.tsx.
//
// Renders the Year-in-Review "Stat chart" slide: a spring-popped calendar emoji,
// the headline total-drives count (animated 0 -> value) next to a "drives" label,
// an average-drives-per-week caption, and a monthly drives bar chart. The web file
// leans on several browser-only dependencies that have no native counterpart in
// this parity tree (contract rules 4, 5 & 7); each is replaced with a React
// Native-safe equivalent and documented in the sidecar:
//
//   - `@/components/data-display` AnimatedNumber (web L1) -> the native web-parity
//     AnimatedNumber, which eases 0 -> value with the same ease-out-quad curve and
//     a settings-aware fmt; duration={1.2}s is preserved.
//   - `@/components/motion` framer-motion `motion.span/div/p` (web L2) -> native
//     Animated.View entrance animations (no framer-motion / DOM): the emoji's
//     framer spring { scale: 0 -> 1, type 'spring', stiffness 200, damping 15 }
//     maps to an Animated.spring driving a scale transform (overshoot preserved);
//     the total-drives row { y: 30 -> 0, opacity: 0 -> 1, delay 0.2s, duration
//     0.5s } and the chart { y: 40 -> 0, opacity: 0 -> 1, delay 0.7s, duration
//     0.6s } map to Animated.timing slide-up + fade; the avg-per-week paragraph
//     { opacity: 0 -> 1, delay 0.5s, duration 0.4s } maps to the same timing with
//     zero translate (pure fade).
//   - `@/components/charts` Recharts BarChart/Bar/XAxis/YAxis/ResponsiveContainer/
//     CartesianGrid (web L3) -> the native web-parity charts barrel, which keeps
//     the same public API and props but renders Recharts as native-safe
//     "unavailable" placeholders because Recharts depends on browser DOM/SVG.
//   - react-i18next `useTranslation` (web L4) -> inlined useNativeTranslation():
//     a stable (key, fallbackOrOptions) => fallback shim that also reproduces
//     i18next `{{count}}` interpolation so t('yearReview.drives','drives') and
//     t('yearReview.avgPerWeek', { count, defaultValue }) keep their English
//     defaults and translation-key intent at the call site.
//   - `@/lib/numberFormat` fmtNumber (web L5) -> the locale-aware prefs.fmt from
//     the native format primitives bridge (useFormatPrefs), matching the web's
//     global-locale/precision fmtNumber output.
//   - `@/api/types` YearReview (web L6) -> the same interface re-exported from the
//     native web-parity api/types; imported type-only.
//   - `react` useMemo (web L7) -> preserved verbatim.
//
// The Tailwind utility classes on the web DOM elements are reproduced with RN
// StyleSheet entries (text-5xl -> fontSize 48, text-xl -> 20, mb-4/mb-2/mb-6 ->
// 16/8/24, gap-3 -> 12, px-6 -> 24, max-w-lg -> 512, h-48 -> 192, items-baseline,
// text-center). CSS-var colors map to AppText tones (var(--text-secondary) ->
// tone="secondary", var(--text-muted) -> tone="muted"); text-white maps to an
// explicit white number color.
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, or web UI components are
// imported — only react, react-native primitives, the native web-parity charts
// barrel / AnimatedNumber / format bridge, the existing apps/native AppText, and
// theme spacing tokens.

import React, {useEffect, useMemo, useRef, type ReactNode} from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {spacing} from '../../../../../theme/tokens';
import {AnimatedNumber} from '../../../../components/data-display/AnimatedNumber';
import {useFormatPrefs} from '../../../../components/data-display/format/_formatPrimitives';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from '../../../../components/charts';
import type {YearReview} from '../../../../api/types';

interface Props {
  data: YearReview;
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

type TranslationOptions = {
  count?: string | number;
  defaultValue?: string;
};

type NativeTFunction = (
  key: string,
  fallbackOrOptions?: string | TranslationOptions,
) => string;

function interpolate(template: string, values: TranslationOptions): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key as keyof TranslationOptions];
    return value === undefined ? '' : String(value);
  });
}

// react-i18next useTranslation replacement: returns the English fallback (string
// arg or options.defaultValue) and reproduces i18next `{{count}}` interpolation so
// every translation-key intent is preserved at the call site.
const nativeTranslate: NativeTFunction = (_key, fallbackOrOptions) => {
  const fallback =
    typeof fallbackOrOptions === 'string'
      ? fallbackOrOptions
      : fallbackOrOptions?.defaultValue ?? _key;

  if (!fallbackOrOptions || typeof fallbackOrOptions === 'string') {
    return fallback;
  }

  return interpolate(fallback, fallbackOrOptions);
};

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

const EMOJI_SPRING_STIFFNESS = 200;
const EMOJI_SPRING_DAMPING = 15;
const EMOJI_SPRING_MASS = 1;

const COUNT_DELAY_MS = 200;
const COUNT_DURATION_MS = 500;
const COUNT_TRANSLATE_Y = 30;

const AVG_DELAY_MS = 500;
const AVG_DURATION_MS = 400;

const CHART_DELAY_MS = 700;
const CHART_DURATION_MS = 600;
const CHART_TRANSLATE_Y = 40;

// @/components/motion motion.span -> Animated.spring scale-in entrance (framer
// initial { scale: 0 } -> animate { scale: 1 }, type 'spring', stiffness 200,
// damping 15). Opacity is left at 1 because the web span only animates scale.
function SpringScale({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.spring(scale, {
      toValue: 1,
      stiffness: EMOJI_SPRING_STIFFNESS,
      damping: EMOJI_SPRING_DAMPING,
      mass: EMOJI_SPRING_MASS,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [scale]);

  return (
    <Animated.View style={[style, {transform: [{scale}]}]}>
      {children}
    </Animated.View>
  );
}

// @/components/motion motion.div / motion.p -> Animated.timing slide-up + fade
// entrance (framer initial { y, opacity: 0 } -> animate { y: 0, opacity: 1 }).
// fromTranslateY 0 yields a pure fade for the avg-per-week paragraph.
function EntranceView({
  children,
  delayMs,
  durationMs,
  fromTranslateY = 0,
  style,
}: {
  children: ReactNode;
  delayMs: number;
  durationMs: number;
  fromTranslateY?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      delay: delayMs,
      duration: durationMs,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, delayMs, durationMs]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [fromTranslateY, 0],
  });

  return (
    <Animated.View
      style={[style, {opacity: progress, transform: [{translateY}]}]}>
      {children}
    </Animated.View>
  );
}

export function StatChartSlide({data}: Props) {
  const t = useNativeTranslation();
  const {fmt} = useFormatPrefs();

  const chartData = useMemo(
    () =>
      (data.monthly_stats ?? []).map(m => ({
        name: MONTH_LABELS[m.month - 1] ?? `M${m.month}`,
        drives: m.drives,
      })),
    [data.monthly_stats],
  );

  return (
    <View style={styles.root}>
      <SpringScale style={styles.emojiWrap}>
        <AppText style={styles.emoji}>🗓️</AppText>
      </SpringScale>

      <EntranceView
        delayMs={COUNT_DELAY_MS}
        durationMs={COUNT_DURATION_MS}
        fromTranslateY={COUNT_TRANSLATE_Y}
        style={styles.countRow}>
        <AnimatedNumber
          value={data.total_drives}
          duration={1.2}
          style={styles.countValue}
        />
        <AppText tone="secondary" style={styles.countLabel}>
          {t('yearReview.drives', 'drives')}
        </AppText>
      </EntranceView>

      <EntranceView
        delayMs={AVG_DELAY_MS}
        durationMs={AVG_DURATION_MS}
        style={styles.avgWrap}>
        <AppText tone="muted" style={styles.avgText}>
          {t('yearReview.avgPerWeek', {
            count: fmt(data.avg_drives_per_week, 1),
            defaultValue: '{{count}} drives per week on average',
          })}
        </AppText>
      </EntranceView>

      <EntranceView
        delayMs={CHART_DELAY_MS}
        durationMs={CHART_DURATION_MS}
        fromTranslateY={CHART_TRANSLATE_Y}
        style={styles.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{top: 0, right: 0, left: -20, bottom: 0}}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.06)"
            />
            <XAxis
              dataKey="name"
              tick={{fill: 'rgba(255,255,255,0.4)', fontSize: 12}}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{fill: 'rgba(255,255,255,0.3)', fontSize: 11}}
              axisLine={false}
              tickLine={false}
            />
            <Bar
              dataKey="drives"
              fill="rgba(167,139,250,0.7)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </EntranceView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emojiWrap: {
    marginBottom: 16,
  },
  emoji: {
    fontSize: 48,
    lineHeight: 60,
    textAlign: 'center',
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  countValue: {
    fontSize: 48,
    lineHeight: 56,
    fontWeight: '700',
    color: '#ffffff',
  },
  countLabel: {
    fontSize: 20,
    lineHeight: 26,
  },
  avgWrap: {
    marginBottom: 24,
  },
  avgText: {
    textAlign: 'center',
  },
  chartWrap: {
    width: '100%',
    maxWidth: 512,
    height: 192,
  },
});
