// Native parity port of
// web/src/features/charging/components/cost-analysis/ForecastDetails.tsx.
//
// Three stacked GlassPanels — a charging breakdown, a gas-vs-EV savings panel,
// and an insights list — each driven by the optional `forecastData`
// (CostForecastData) prop. Every i18n key + English fallback, the
// `forecastData ? … : <EmptyState/>` gating, the `forecastData?.insights ?? []`
// null handling, the Currency precisions (3 for cost/kWh, 0 for annual/lifetime,
// default 2 for the gas/EV rows), the AnimatedNumber count-up, and the
// fmtNumber(avg_km, 0) call are all preserved.
//
// Web -> native mapping (conversion-contract rules 3-7):
//   - react-i18next useTranslation (web L1, L20) -> the module-level native-safe
//     `t(key, fallback?)` shim: `t('Home')` (no fallback, web L37) returns the
//     key, `t(key, fallback)` returns the English fallback. i18n intent kept.
//   - lucide-react Fuel/Lightbulb/Zap (web L2, L79/L127/L137) -> emoji text
//     glyphs ⛽/💡/⚡ tinted to the web neon colours (the GasPriceSettings /
//     BatteryHealthPage lucide->glyph precedent); React Native has no SVG icons.
//   - `@/components/ui` GlassPanel (web L3) -> native GlassPanel; `className="p-6"`
//     -> styles.panel padding 24.
//   - `@/components/motion` FadeIn (web L4, L26/L76/L124) -> a local
//     reduced-motion-aware FadeIn (Animated opacity 0->1 + translateY 12->0,
//     easeOut, 400ms), collapsing to the final state under reduced motion (the
//     web no-op) — the SummaryStatsGrid precedent.
//   - `@/components/data-display` AnimatedNumber/Currency (web L5) -> the native
//     parity AnimatedNumber + Currency; AnimatedNumber's `prefix` carries the
//     web `{currencySymbol}<AnimatedNumber/>` (web L89) inline currency glyph.
//   - `@/components/feedback` EmptyState (web L6) -> native shared EmptyState. The
//     web passes only `message` (title omitted); the native EmptyState requires a
//     title, so a generic `costAnalysis.forecast.empty` ('No data yet') title is
//     synthesised (the ChargingDetailSection precedent). Each web `message` kept.
//   - `@/components/charts` Recharts donut ResponsiveContainer/PieChart/Pie/Cell/
//     Tooltip/ChartTooltip (web L7-10, L33-51) -> a native-safe proportional
//     SplitBar (home.pct green #22c55e vs supercharger.pct amber #f59e0b),
//     because React Native has no SVG Recharts backend and no hover tooltip (the
//     BatteryHealthPage SplitBar / AlertsSection distribution precedent). The
//     web legend (coloured dot + label + Currency cost/kWh, web L52-67) is kept.
//   - `@/lib/numberFormat` fmtNumber (web L11, L113) -> the native parity
//     fmtNumber.
//   - `@/hooks/useFormatting` currencySymbol (web L12, L21) -> an inline
//     useFormatting() returning the web no-settings fallback '$' (the
//     SummaryStatsGrid / CostHeatmap leaf-component precedent — this parity tree
//     has no settings provider; the `currencySymbol` state name is preserved and
//     threaded to every Currency + the AnimatedNumber prefix).
//   - `CostForecastData` (web L13 `@/types/charging`) -> the native parity type
//     re-exported from ../../../../api/hooks/useCharging (same field shape).
//   - outer `grid grid-cols-1 … lg:grid-cols-3` (web L24) -> a phone-first single
//     column stack (grid-cols-1 base); the lg 3-up layout is web-desktop-only.
// See the .parity.json sidecar for the line-by-line source map.

import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../../theme/tokens';
import type {CostForecastData} from '../../../../api/hooks/useCharging';
import {AnimatedNumber} from '../../../../components/data-display/AnimatedNumber';
import {Currency} from '../../../../components/data-display/format';
import {fmtNumber} from '../../../../lib/numberFormat';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------
// `t('Home')` returns the key (no fallback); `t(key, fallback)` returns the
// English fallback — reproducing both web call shapes.
function t(key: string, fallback?: string): string {
  return fallback ?? key;
}

// ---- Currency symbol (web @/hooks/useFormatting currencySymbol) -------------
// No settings provider exists in this parity tree, so the web no-settings
// fallback '$' is used directly (the SummaryStatsGrid / CostHeatmap precedent).
const DEFAULT_CURRENCY_SYMBOL = '$';

function useFormatting(): {currencySymbol: string} {
  return {currencySymbol: DEFAULT_CURRENCY_SYMBOL};
}

// ---- Reduced-motion awareness (web prefers-reduced-motion) ------------------

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

// ---- Reduced-motion-aware FadeIn (web @/components/motion FadeIn) ------------
// web FadeIn initial {opacity:0, y:12} -> animate {opacity:1, y:0} easeOut; no
// delay prop is used here. Reduced motion collapses to the final state.

const FADE_IN_DURATION_MS = 400;
const FADE_IN_TRANSLATE_Y = 12;

function FadeIn({
  children,
  reduceMotion,
}: {
  children: React.ReactNode;
  reduceMotion: boolean;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      duration: FADE_IN_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [FADE_IN_TRANSLATE_Y, 0],
            }),
          },
        ],
      }}>
      {children}
    </Animated.View>
  );
}

// ---- Proportional SplitBar (web Recharts breakdown donut) -------------------
// Replaces ResponsiveContainer>PieChart>Pie>Cell (web L33-51): the two
// home/supercharger `pct` values become proportional coloured segments.

function pct(n: number): DimensionValue {
  return `${Math.max(0, Math.min(100, n))}%` as DimensionValue;
}

function SplitBar({
  segments,
}: {
  segments: {value: number; fill: string}[];
}): React.ReactElement {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0) || 1;

  return (
    <View style={styles.splitBar}>
      {segments.map(s => (
        <View
          key={s.fill}
          style={[
            styles.splitSegment,
            {
              backgroundColor: s.fill,
              width: pct((Math.max(0, s.value) / total) * 100),
            },
          ]}
        />
      ))}
    </View>
  );
}

// ---- Props (web ForecastDetailsProps L15-17) --------------------------------

interface ForecastDetailsProps {
  forecastData: CostForecastData | undefined;
}

export function ForecastDetails({
  forecastData,
}: ForecastDetailsProps): React.ReactElement {
  const {currencySymbol} = useFormatting();
  const reduceMotion = useReduceMotion();
  const insights = forecastData?.insights ?? [];

  return (
    <View style={styles.grid}>
      {/* Breakdown donut (web L25-73) */}
      <FadeIn reduceMotion={reduceMotion}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.panelTitle} weight="semibold">
            {t('costAnalysis.forecast.breakdown', 'Charging Breakdown')}
          </AppText>
          {forecastData ? (
            <View style={styles.breakdownBody}>
              <SplitBar
                segments={[
                  {value: forecastData.breakdown.home.pct, fill: HOME_COLOR},
                  {
                    value: forecastData.breakdown.supercharger.pct,
                    fill: SUPERCHARGER_COLOR,
                  },
                ]}
              />
              <View style={styles.legendList}>
                <View style={styles.legendRow}>
                  <View style={styles.legendLabel}>
                    <View style={[styles.dot, styles.dotHome]} />
                    <AppText tone="secondary" variant="caption">
                      {t('Home')}
                    </AppText>
                  </View>
                  <AppText style={styles.legendCost}>
                    <Currency
                      currencySymbol={currencySymbol}
                      precision={3}
                      style={styles.legendCost}
                      value={forecastData.breakdown.home.avg_cost_per_kwh}
                    />
                    /kWh
                  </AppText>
                </View>
                <View style={styles.legendRow}>
                  <View style={styles.legendLabel}>
                    <View style={[styles.dot, styles.dotSupercharger]} />
                    <AppText tone="secondary" variant="caption">
                      {t('Supercharger')}
                    </AppText>
                  </View>
                  <AppText style={styles.legendCost}>
                    <Currency
                      currencySymbol={currencySymbol}
                      precision={3}
                      style={styles.legendCost}
                      value={forecastData.breakdown.supercharger.avg_cost_per_kwh}
                    />
                    /kWh
                  </AppText>
                </View>
              </View>
            </View>
          ) : (
            // no-action: transient empty state — surfaces when source data is
            // missing; no specific recovery action available (web L70).
            <EmptyState
              message={t(
                'costAnalysis.forecast.noBreakdown',
                'Breakdown will appear once charging data is available.',
              )}
              title={t('costAnalysis.forecast.empty', 'No data yet')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Savings (web L75-121) */}
      <FadeIn reduceMotion={reduceMotion}>
        <GlassPanel style={styles.panel}>
          <View style={styles.titleRow}>
            <AppText style={styles.iconGreen}>⛽</AppText>
            <AppText style={styles.titleText} weight="semibold">
              {t('costAnalysis.forecast.savings', 'Gas vs EV Savings')}
            </AppText>
          </View>
          {forecastData ? (
            <View style={styles.savingsBody}>
              <View style={styles.monthlyCard}>
                <AppText style={styles.monthlyLabel} tone="muted">
                  {t('costAnalysis.forecast.monthlySavings', 'Monthly Savings')}
                </AppText>
                <AnimatedNumber
                  decimals={0}
                  prefix={currencySymbol}
                  style={styles.monthlyValue}
                  value={forecastData.gas_comparison.monthly_savings}
                />
              </View>
              <View style={styles.miniRow}>
                <View style={styles.miniCard}>
                  <AppText style={styles.tinyLabel} tone="muted">
                    {t('costAnalysis.forecast.annual', 'Annual')}
                  </AppText>
                  <Currency
                    currencySymbol={currencySymbol}
                    precision={0}
                    style={styles.miniValue}
                    value={forecastData.gas_comparison.annual_savings}
                  />
                </View>
                <View style={styles.miniCard}>
                  <AppText style={styles.tinyLabel} tone="muted">
                    {t('costAnalysis.forecast.lifetime', 'Lifetime')}
                  </AppText>
                  <Currency
                    currencySymbol={currencySymbol}
                    precision={0}
                    style={styles.miniValue}
                    value={forecastData.gas_comparison.lifetime_savings}
                  />
                </View>
              </View>
              <View style={styles.statList}>
                <View style={styles.statRow}>
                  <AppText tone="muted" variant="caption">
                    {t('costAnalysis.forecast.gasCost', 'Gas cost/mo')}
                  </AppText>
                  <Currency
                    currencySymbol={currencySymbol}
                    style={styles.gasValue}
                    value={forecastData.gas_comparison.gas_cost_per_month}
                  />
                </View>
                <View style={styles.statRow}>
                  <AppText tone="muted" variant="caption">
                    {t('costAnalysis.forecast.evCost', 'EV cost/mo')}
                  </AppText>
                  <Currency
                    currencySymbol={currencySymbol}
                    style={styles.evValue}
                    value={forecastData.gas_comparison.ev_cost_per_month}
                  />
                </View>
                <View style={styles.statRow}>
                  <AppText tone="muted" variant="caption">
                    {t('costAnalysis.forecast.avgKm', 'Avg km/mo')}
                  </AppText>
                  <AppText tone="muted" variant="caption">
                    {fmtNumber(forecastData.gas_comparison.avg_km_per_month, 0)}
                  </AppText>
                </View>
              </View>
            </View>
          ) : (
            // no-action: transient empty state — surfaces when source data is
            // missing; no specific recovery action available (web L118).
            <EmptyState
              message={t(
                'costAnalysis.forecast.noSavings',
                'Savings data will appear once driving history is available.',
              )}
              title={t('costAnalysis.forecast.empty', 'No data yet')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Insights (web L123-146) */}
      <FadeIn reduceMotion={reduceMotion}>
        <GlassPanel style={styles.panel}>
          <View style={styles.titleRow}>
            <AppText style={styles.iconAmber}>💡</AppText>
            <AppText style={styles.titleText} weight="semibold">
              {t('costAnalysis.forecast.insights', 'Insights')}
            </AppText>
          </View>
          {insights.length > 0 ? (
            <View style={styles.insightList}>
              {insights.map((insight, i) => (
                <View key={i} style={styles.insightRow}>
                  <AppText style={styles.insightIcon}>⚡</AppText>
                  <AppText style={styles.insightText} tone="secondary">
                    {insight}
                  </AppText>
                </View>
              ))}
            </View>
          ) : (
            // no-action: transient empty state — surfaces when source data is
            // missing; no specific recovery action available (web L143).
            <EmptyState
              message={t(
                'costAnalysis.forecast.noInsights',
                'Insights will appear as more data is collected.',
              )}
              title={t('costAnalysis.forecast.empty', 'No data yet')}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </View>
  );
}

ForecastDetails.displayName = 'ForecastDetails';

// ---- Colour + size constants (web Tailwind tokens) --------------------------

const PANEL_PADDING = 24; // web `p-6`
const GRID_GAP = 16; // web `gap-4`
const SECTION_GAP = 16; // web `space-y-4`
const TITLE_MARGIN_BOTTOM = 16; // web `mb-4`
const PANEL_TITLE_SIZE = 14; // web `text-sm`
const MONTHLY_VALUE_SIZE = 30; // web `text-3xl`
const MINI_VALUE_SIZE = 18; // web `text-lg`
const TINY_LABEL_SIZE = 10; // web `text-[10px]`
const CARD_RADIUS_LG = 8; // web `rounded-lg`
const CARD_RADIUS_XL = 12; // web `rounded-xl`
const SPLIT_BAR_HEIGHT = 24;

const HOME_COLOR = '#22c55e'; // web `bg-green-500` / Cell fill
const SUPERCHARGER_COLOR = '#f59e0b'; // web `bg-amber-500` / Cell fill
const NEON_GREEN = '#4ade80'; // web `text-neon-green`
const NEON_AMBER = '#fbbf24'; // web `text-neon-amber`
const EMERALD_300 = '#6ee7b7'; // web `text-emerald-300`
const RED_400 = '#f87171'; // web `text-red-400`
const GREEN_400 = '#4ade80'; // web `text-green-400`
const NEON_GREEN_SURFACE = 'rgba(74, 222, 128, 0.06)'; // web `bg-neon-green/[0.06]`
const NEON_GREEN_BORDER = 'rgba(74, 222, 128, 0.1)'; // web `border-neon-green/10`
const WHITE_SURFACE_04 = 'rgba(255, 255, 255, 0.04)'; // web `bg-white/[0.04]`
const WHITE_SURFACE_03 = 'rgba(255, 255, 255, 0.03)'; // web `bg-white/[0.03]`
const WHITE_BORDER_06 = 'rgba(255, 255, 255, 0.06)'; // web `border-white/[0.06]`

const styles = StyleSheet.create({
  // web `grid grid-cols-1 gap-4 lg:grid-cols-3` (L24) -> phone-first column.
  grid: {
    gap: GRID_GAP,
  },
  // web `p-6` (L27/L77/L125).
  panel: {
    padding: PANEL_PADDING,
  },
  // web `mb-4 text-sm font-semibold text-white` (L28).
  panelTitle: {
    fontSize: PANEL_TITLE_SIZE,
    marginBottom: TITLE_MARGIN_BOTTOM,
  },
  // web `mb-4 flex items-center gap-2 text-sm font-semibold text-white` (L78/L126).
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: TITLE_MARGIN_BOTTOM,
  },
  titleText: {
    fontSize: PANEL_TITLE_SIZE,
  },
  // web Fuel `h-4 w-4 text-neon-green` (L79).
  iconGreen: {
    color: NEON_GREEN,
    fontSize: PANEL_TITLE_SIZE,
  },
  // web Lightbulb `h-4 w-4 text-neon-amber` (L127).
  iconAmber: {
    color: NEON_AMBER,
    fontSize: PANEL_TITLE_SIZE,
  },
  // web `flex flex-col items-center` (L32).
  breakdownBody: {
    alignItems: 'center',
  },
  // web donut footprint -> proportional bar (L33-51).
  splitBar: {
    borderRadius: 999,
    flexDirection: 'row',
    height: SPLIT_BAR_HEIGHT,
    overflow: 'hidden',
    width: '100%',
  },
  splitSegment: {
    height: '100%',
  },
  // web `mt-2 space-y-2 text-xs w-full` (L52).
  legendList: {
    gap: spacing.sm,
    marginTop: spacing.sm,
    width: '100%',
  },
  // web `flex items-center justify-between` (L53/L60).
  legendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // web `flex items-center gap-2` (L54/L61).
  legendLabel: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  // web `inline-block h-2 w-2 rounded-full` (L55/L62).
  dot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  dotHome: {
    backgroundColor: HOME_COLOR,
  },
  dotSupercharger: {
    backgroundColor: SUPERCHARGER_COLOR,
  },
  // web `font-medium text-white` cost span (L58/L65).
  legendCost: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: '500',
  },
  // web `space-y-4` (L83).
  savingsBody: {
    gap: SECTION_GAP,
  },
  // web `rounded-xl p-4 bg-neon-green/[0.06] border border-neon-green/10 text-center` (L84).
  monthlyCard: {
    alignItems: 'center',
    backgroundColor: NEON_GREEN_SURFACE,
    borderColor: NEON_GREEN_BORDER,
    borderRadius: CARD_RADIUS_XL,
    borderWidth: 1,
    padding: 16,
  },
  // web `text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1` (L85).
  monthlyLabel: {
    fontSize: TINY_LABEL_SIZE,
    letterSpacing: 0.5,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  // web `text-3xl font-bold text-emerald-300` (L88).
  monthlyValue: {
    color: EMERALD_300,
    fontSize: MONTHLY_VALUE_SIZE,
    fontWeight: '700',
    textAlign: 'center',
  },
  // web `grid grid-cols-2 gap-3 text-center` (L92).
  miniRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  // web `rounded-lg bg-white/[0.04] p-3` (L93/L97).
  miniCard: {
    alignItems: 'center',
    backgroundColor: WHITE_SURFACE_04,
    borderRadius: CARD_RADIUS_LG,
    flex: 1,
    padding: 12,
  },
  // web `text-[10px] text-[var(--text-muted)]` (L94/L98).
  tinyLabel: {
    fontSize: TINY_LABEL_SIZE,
  },
  // web `text-lg font-semibold text-white` (L95/L99).
  miniValue: {
    color: colors.textPrimary,
    fontSize: MINI_VALUE_SIZE,
    fontWeight: '600',
    textAlign: 'center',
  },
  // web `text-xs text-[var(--text-muted)] space-y-1` (L102).
  statList: {
    gap: spacing.xs,
  },
  // web `flex justify-between` (L103/L107/L111).
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // web Currency `text-red-400` within text-xs (L105).
  gasValue: {
    color: RED_400,
    fontSize: typography.caption,
  },
  // web Currency `text-green-400` within text-xs (L109).
  evValue: {
    color: GREEN_400,
    fontSize: typography.caption,
  },
  // web `space-y-3` (L131).
  insightList: {
    gap: spacing.md,
  },
  // web `flex items-start gap-3 rounded-xl p-3 bg-white/[0.03] border border-white/[0.06]` (L133-136).
  insightRow: {
    alignItems: 'flex-start',
    backgroundColor: WHITE_SURFACE_03,
    borderColor: WHITE_BORDER_06,
    borderRadius: CARD_RADIUS_XL,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: 12,
  },
  // web Zap `h-4 w-4 mt-0.5 shrink-0 text-neon-amber` (L137).
  insightIcon: {
    color: NEON_AMBER,
    fontSize: PANEL_TITLE_SIZE,
    marginTop: 2,
  },
  // web `text-sm text-[var(--text-secondary)]` (L138).
  insightText: {
    flex: 1,
    fontSize: PANEL_TITLE_SIZE,
  },
});
