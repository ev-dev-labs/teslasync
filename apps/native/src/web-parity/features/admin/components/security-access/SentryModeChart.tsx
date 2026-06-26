// Native parity port of
// web/src/features/admin/components/security-access/SentryModeChart.tsx.
//
// Renders the daily Sentry Mode activity panel: a per-day stacked bar chart
// (Sentry On stacked over Sentry Off counts) inside a GlassPanel, or a
// title-less empty state when no day buckets exist. The web file leans on
// browser-only dependencies that are absent from the native parity manifest
// (contract rules 4, 5 & 7); each is replaced with a React Native-safe
// equivalent and documented in the sidecar:
//
//   - react-i18next `useTranslation` (web L1) -> inlined useNativeTranslation():
//     a stable (key, fallback) => fallback shim, so every t('key', 'English')
//     call keeps its English default and the translation key intent at each
//     call site (admin.security.sentryChart, admin.security.chart.sentryOn,
//     admin.security.chart.sentryOff, common.noData).
//   - lucide-react `Activity` icon (web L2) -> the shared SemanticIcon
//     'activity' glyph, dimmed to opacity 0.2 to mirror the web `opacity-20`.
//   - `@/components/ui/GlassPanel` (web L3) -> the existing native GlassPanel;
//     Tailwind `p-4 mb-6` maps to padding / marginBottom tokens.
//   - `@/components/charts` Recharts BarChart/Bar/XAxis/YAxis/CartesianGrid/
//     Tooltip/ResponsiveContainer/Legend + `@/components/charts/ChartTooltip`
//     (web L4, L7-16, L35-66) -> a native stacked-bar visualization built from
//     View/ScrollView/AppText. Recharts depends on browser DOM/SVG and is
//     unavailable on native, so the two-series stack (sentryOn #3b82f6 bottom,
//     sentryOff #6b7280 top, rounded top corners == radius [4,4,0,0],
//     stackId "sentry"), the legend, the integer y-axis max/0 ticks
//     (allowDecimals=false), and the per-bar formatted-date x labels are
//     reproduced with native primitives.
//   - `@/components/feedback/EmptyState` (web L5, L69-73) -> rendered inline:
//     the web call passes an icon + single message with no title and the native
//     EmptyState requires a title, so a centred icon + muted message faithfully
//     reproduces the title-less web empty state without inventing copy
//     (py-8 -> paddingVertical token).
//   - `@/components/motion/FadeIn` delay={0.2} (web L6, L28) -> an Animated.View
//     opacity 0->1 mount fade with a 200ms delay, preserving the entrance
//     motion intent.
//   - `@/lib/dateFormat` formatDateShort (web L17, L41) -> an inline native-safe
//     "MMM d" Intl formatter with the same null/invalid -> em-dash guards.
//   - `./helpers` SentryDayBucket type (web L18) -> declared locally; the native
//     security-access helpers are not yet ported and the {date, sentryOn,
//     sentryOff} shape mirrors the web helpers exactly.
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, or web UI components
// are imported -- only react, react-native primitives, and existing apps/native
// SemanticIcon / AppText / GlassPanel / theme tokens.

import React, {useEffect, useMemo, useRef} from 'react';
import {Animated, ScrollView, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

type NativeTFunction = (key: string, fallback: string) => string;

/** Mirrors the web `SentryDayBucket` from ./helpers (not yet ported native). */
export interface SentryDayBucket {
  date: string;
  sentryOn: number;
  sentryOff: number;
}

export interface SentryModeChartProps {
  sentryBuckets: SentryDayBucket[];
}

// Recharts series fills are data-visualization literals (not theme tokens); the
// exact web hex values are kept so the native stack matches the web palette.
const SENTRY_ON_COLOR = '#3b82f6';
const SENTRY_OFF_COLOR = '#6b7280';

const PLOT_HEIGHT = 180;
const BAR_WIDTH = 26;
const COLUMN_WIDTH = 44;
const BAR_RADIUS = 4;
const FADE_DELAY_MS = 200;
const FADE_DURATION_MS = 300;

// react-i18next useTranslation replacement: returns the English fallback so the
// translation key intent is preserved at every call site.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// Native-safe port of @/lib/dateFormat formatDateShort: "MMM d" with the same
// null / invalid -> em-dash guards.
function formatDateShort(value: string): string {
  if (!value) {
    return '\u2014';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '\u2014';
  }
  return date.toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
}

interface SentryBar {
  date: string;
  label: string;
  on: number;
  off: number;
  onHeight: number;
  offHeight: number;
}

function LegendSwatch({color, label}: {color: string; label: string}) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, {backgroundColor: color}]} />
      <AppText tone="muted" variant="caption">
        {label}
      </AppText>
    </View>
  );
}

export function SentryModeChart({sentryBuckets}: SentryModeChartProps) {
  const t = useNativeTranslation();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      delay: FADE_DELAY_MS,
      duration: FADE_DURATION_MS,
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  const safeBuckets = useMemo(
    () => (Array.isArray(sentryBuckets) ? sentryBuckets : []),
    [sentryBuckets],
  );

  const {maxTotal, bars} = useMemo(() => {
    let max = 1;
    for (const bucket of safeBuckets) {
      const total = (bucket.sentryOn ?? 0) + (bucket.sentryOff ?? 0);
      if (total > max) {
        max = total;
      }
    }
    const items: SentryBar[] = safeBuckets.map(bucket => {
      const on = bucket.sentryOn ?? 0;
      const off = bucket.sentryOff ?? 0;
      return {
        date: bucket.date,
        label: formatDateShort(bucket.date),
        off,
        offHeight: (off / max) * PLOT_HEIGHT,
        on,
        onHeight: (on / max) * PLOT_HEIGHT,
      };
    });
    return {bars: items, maxTotal: max};
  }, [safeBuckets]);

  const title = t('admin.security.sentryChart', 'Sentry Mode Activity');
  const sentryOnLabel = t('admin.security.chart.sentryOn', 'Sentry On');
  const sentryOffLabel = t('admin.security.chart.sentryOff', 'Sentry Off');
  const noData = t('common.noData', 'No data available');

  return (
    <Animated.View style={{opacity}}>
      <GlassPanel style={styles.panel}>
        <AppText
          style={styles.title}
          tone="secondary"
          variant="body"
          weight="semibold">
          {title}
        </AppText>
        {safeBuckets.length > 0 ? (
          <View
            accessibilityRole="summary"
            accessible
            accessibilityLabel={`Sentry mode activity stacked bar chart across ${bars.length} days.`}
            style={styles.chartArea}>
            <View style={styles.legendRow}>
              <LegendSwatch color={SENTRY_ON_COLOR} label={sentryOnLabel} />
              <LegendSwatch color={SENTRY_OFF_COLOR} label={sentryOffLabel} />
            </View>
            <View style={styles.plotRow}>
              <View style={styles.yAxis}>
                <AppText style={styles.axisLabel} variant="caption">
                  {String(maxTotal)}
                </AppText>
                <AppText style={styles.axisLabel} variant="caption">
                  0
                </AppText>
              </View>
              <ScrollView
                contentContainerStyle={styles.barsContent}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.barsScroll}>
                {bars.map(bar => {
                  const offIsTop = bar.offHeight > 0;
                  return (
                    <View key={bar.date} style={styles.column}>
                      <View
                        accessibilityRole="image"
                        accessible
                        accessibilityLabel={`${bar.label}: ${sentryOnLabel} ${bar.on}, ${sentryOffLabel} ${bar.off}`}
                        style={styles.barStack}>
                        <View
                          style={[
                            styles.barSegment,
                            {
                              backgroundColor: SENTRY_OFF_COLOR,
                              height: bar.offHeight,
                            },
                            offIsTop && styles.barSegmentTop,
                          ]}
                        />
                        <View
                          style={[
                            styles.barSegment,
                            {
                              backgroundColor: SENTRY_ON_COLOR,
                              height: bar.onHeight,
                            },
                            !offIsTop && styles.barSegmentTop,
                          ]}
                        />
                      </View>
                      <AppText
                        numberOfLines={1}
                        style={styles.xAxisLabel}
                        variant="caption">
                        {bar.label}
                      </AppText>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <SemanticIcon
              decorative
              name="activity"
              size="md"
              style={styles.emptyIcon}
            />
            <AppText tone="muted" variant="caption">
              {noData}
            </AppText>
          </View>
        )}
      </GlassPanel>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  axisLabel: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'right',
  },
  barSegment: {
    width: '100%',
  },
  barSegmentTop: {
    borderTopLeftRadius: BAR_RADIUS,
    borderTopRightRadius: BAR_RADIUS,
  },
  barStack: {
    alignItems: 'stretch',
    height: PLOT_HEIGHT,
    justifyContent: 'flex-end',
    width: BAR_WIDTH,
  },
  barsContent: {
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  barsScroll: {
    flex: 1,
  },
  chartArea: {
    gap: spacing.md,
    minHeight: 256,
  },
  column: {
    alignItems: 'center',
    gap: spacing.xs,
    width: COLUMN_WIDTH,
  },
  emptyIcon: {
    marginBottom: spacing.sm,
    opacity: 0.2,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  legendDot: {
    borderRadius: 3,
    height: 10,
    width: 10,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  panel: {
    marginBottom: spacing.xl,
    padding: spacing.lg,
  },
  plotRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  title: {
    marginBottom: spacing.md,
  },
  xAxisLabel: {
    color: colors.textMuted,
    fontSize: 10,
    maxWidth: COLUMN_WIDTH,
    textAlign: 'center',
  },
  yAxis: {
    height: PLOT_HEIGHT,
    justifyContent: 'space-between',
    width: 28,
  },
});
