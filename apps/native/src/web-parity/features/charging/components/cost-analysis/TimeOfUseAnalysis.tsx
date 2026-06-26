// Native parity port of
// web/src/features/charging/components/cost-analysis/TimeOfUseAnalysis.tsx.
//
// The cost-analysis "Electricity Rate Analysis (Time-of-Use)" GlassPanel: a
// Clock + title heading, then a (web: lg 3-col) layout whose 2-col-span left
// side holds an hourly sessions bar chart (24 buckets, colour-coded peak /
// off-peak / mid-peak) + a peak/mid/off legend, and whose right side holds an
// "Insights" header over four stat panels (cheapest hour, priciest hour,
// busiest hour, off-peak ratio) — or empty-state placeholders.
//
// React Native has no DOM, lucide-react, Recharts, Tailwind, or the web ui
// components, so the web tree is reproduced with native View/AppText/GlassPanel
// layers that preserve the same data, copy, units, colours, number formatting,
// the peak/off-peak hour logic, and proportional intent.
//
// Self-contained native adaptations (documented in the sidecar):
//   - @/components/ui GlassPanel -> the shared native GlassPanel; the `p-4` /
//     `p-3` paddings collapse to StyleSheet entries (16 / 12).
//   - The Recharts BarChart (ResponsiveContainer + BarChart + Bar + Cell +
//     XAxis/YAxis/CartesianGrid + Tooltip<ChartTooltip>) is reproduced as a
//     native vertical-bar histogram: each hour is a View whose height is its
//     `sessions / max` percentage, tinted by the verbatim peak/off-peak/mid
//     colour rule; a 3-tick y-axis (max / mid / 0) and interval=2 x-axis labels
//     (every 3rd, matching Recharts tick indexing) frame it — the same
//     native-bar idiom TimeToChargeSection used for its Recharts chart.
//   - Recharts hover Tooltip/ChartTooltip has no native equivalent (browser SVG
//     pointer events); each bar instead carries an accessibilityLabel with its
//     hour label + session count so the tooltip's information survives for
//     touch/screen-reader users (the SmallMultiplesChart tooltip-unavailable
//     idiom).
//   - lucide-react <Clock className="h-4 w-4 text-amber-400"/> is a small
//     decorative heading icon -> a lightweight inline "◷" glyph in the same
//     amber-400 (#fbbf24) tone (the DetailedStatistics inline-heading-icon
//     idiom); no boxed badge so the layout is unchanged.
//   - @/hooks/useChartPalette useChartPalette() -> an inlined native hook that
//     reads the same `chart_palette` preference from the native useSettings
//     query and resolves it to the CB-safe Okabe-Ito / neon palette (verbatim
//     from web @/lib/colors + @/hooks/useChartPalette), so the mid-peak bar's
//     `palette[0]` honours the user's palette setting (the DetailedStatistics
//     settings-derived idiom).
//   - @/lib/numberFormat fmtNumber / fmtInt are inlined with the same
//     safeNumber (nullish/NaN -> 0) guard and en-US grouping standing in for
//     the not-yet-ported global locale/precision settings (global default 2).
//   - ./types HourBucket / TouInsights are inlined because the native ./types
//     module is not yet a converted target (the same idiom TimeToChargeSection
//     used for TimeToChargeMetrics).
//   - The four repeated insight panels collapse to a shared InsightPanel
//     component (DRY); text-green-400 / red-400 / cyan-400 / emerald-400 value
//     hues and the legend bg-red-500 / bg-[#00f0ff] / bg-green-500 swatches are
//     used verbatim (no exact token), matching the engineering "toned-down" map.
//   - react-i18next useTranslation -> a native English-default `t` keeping every
//     costAnalysis.* key verbatim.
//
// No DOM, lucide-react, Recharts, Leaflet, framer-motion, or old web UI
// components are imported.

import React from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';

/* ─── Inlined types (web ./types HourBucket / TouInsights) ────────────────── */

interface HourBucket {
  hour: number;
  label: string;
  sessions: number;
  avgCost: number;
  totalEnergy: number;
}

interface TouInsights {
  cheapest: HourBucket;
  priciest: HourBucket;
  busiest: HourBucket;
  offPeakPct: number;
}

/* ─── Native i18n fallback (mirrors i18next default-value behaviour) ──────── */

// react-i18next is not wired in native; i18next returns the supplied default
// when a translation is missing, so this fallback returns the English default
// while keeping every costAnalysis.* key verbatim.
function t(_key: string, fallback: string): string {
  return fallback;
}

/* ─── Numeric helpers (mirror web @/lib/numberFormat + null safety) ───────── */

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// Mirrors web lib/numberFormat.fmtNumber. en-US grouping + the global default
// precision (2) stand in for the not-yet-ported global locale/precision.
function fmtNumber(v: unknown, decimals = 2): string {
  const n = safeNumber(v);
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

// Mirrors web lib/numberFormat.fmtInt -> fmtNumber(v, 0).
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── Inlined useChartPalette (web @/hooks/useChartPalette + @/lib/colors) ── */

// Color-blind-safe Okabe-Ito palette — the web CHART_COLORS default.
const CHART_COLORS_CB_SAFE = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#F0E442',
  '#56B4E9',
  '#D55E00',
  '#CC79A7',
  '#4B4B4B',
] as const;

// Original neon palette, opt-in via the `chart_palette` setting.
const CHART_COLORS_NEON = [
  '#00f0ff',
  '#10b981',
  '#a855f7',
  '#f59e0b',
  '#4f46e5',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
] as const;

// Verbatim from web @/hooks/useChartPalette.resolveChartPalette: unknown /
// missing values fall back to the CB-safe default.
function resolveChartPalette(
  pref: string | null | undefined,
): readonly string[] {
  return pref === 'neon' ? CHART_COLORS_NEON : CHART_COLORS_CB_SAFE;
}

// Mirrors the web reactive useChartPalette(): reads `chart_palette` from the
// native settings query so the mid-peak bar colour honours the user's setting.
function useChartPalette(): readonly string[] {
  const {data} = useSettings();
  return resolveChartPalette(data?.chart_palette);
}

/* ─── Source colours (web bar fills / legend swatches / insight values) ───── */

const BAR_PEAK = '#ef4444'; // web bar peak fill (#ef4444)
const BAR_OFF_PEAK = '#10b981'; // web bar off-peak fill (#10b981)
const LEGEND_PEAK = '#ef4444'; // web legend bg-red-500
const LEGEND_MID_PEAK = '#00f0ff'; // web legend bg-[#00f0ff]
const LEGEND_OFF_PEAK = '#22c55e'; // web legend bg-green-500
const AMBER_400 = '#fbbf24'; // web Clock text-amber-400
const VALUE_CHEAPEST = '#4ade80'; // web text-green-400
const VALUE_PRICIEST = '#f87171'; // web text-red-400
const VALUE_BUSIEST = '#22d3ee'; // web text-cyan-400
const VALUE_OFF_PEAK = '#34d399'; // web text-emerald-400

const BARS_HEIGHT = 220;
const X_TICK_INTERVAL = 3; // Recharts interval={2} -> show every 3rd tick.

function pctHeight(pct: number): DimensionValue {
  return `${Math.max(Math.min(pct, 100), 0)}%` as DimensionValue;
}

/* ─── Shared insight panel (web repeats the GlassPanel block 4×) ──────────── */

function InsightPanel({
  label,
  value,
  valueColor,
  sub,
}: {
  label: string;
  value: string;
  valueColor: string;
  sub: string;
}) {
  return (
    <GlassPanel style={styles.insightPanel}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText
        weight="semibold"
        style={[styles.insightValue, {color: valueColor}]}>
        {value}
      </AppText>
      <AppText tone="muted" style={styles.insightSub}>
        {sub}
      </AppText>
    </GlassPanel>
  );
}

interface TimeOfUseAnalysisProps {
  hourlyData: HourBucket[];
  touInsights: TouInsights | null;
}

export function TimeOfUseAnalysis({
  hourlyData,
  touInsights,
}: TimeOfUseAnalysisProps) {
  const palette = useChartPalette();
  const maxSessions =
    hourlyData.reduce((m, d) => Math.max(m, safeNumber(d.sessions)), 0) || 1;
  const yTicks = [maxSessions, Math.round(maxSessions / 2), 0];

  return (
    <GlassPanel style={styles.root}>
      <View style={styles.titleRow}>
        <AppText style={styles.titleIcon}>◷</AppText>
        <AppText weight="semibold" style={styles.title}>
          {t(
            'costAnalysis.tou.title',
            'Electricity Rate Analysis (Time-of-Use)',
          )}
        </AppText>
      </View>

      <View style={styles.grid}>
        {/* Hourly bar chart + legend */}
        <View style={styles.chartCol}>
          {hourlyData.length > 0 ? (
            <View style={styles.chartRow}>
              <View style={styles.yAxis}>
                {yTicks.map((tick, i) => (
                  <AppText
                    key={`y-${i}`}
                    variant="caption"
                    tone="muted"
                    numberOfLines={1}
                    style={styles.axisTick}>
                    {fmtInt(tick)}
                  </AppText>
                ))}
              </View>
              <View style={styles.plotColumn}>
                <View style={styles.barsArea}>
                  {hourlyData.map(entry => {
                    const isPeak = entry.hour >= 14 && entry.hour <= 19;
                    const isOffPeak = entry.hour >= 22 || entry.hour < 6;
                    const color = isPeak
                      ? BAR_PEAK
                      : isOffPeak
                        ? BAR_OFF_PEAK
                        : palette[0];
                    const pct =
                      (safeNumber(entry.sessions) / maxSessions) * 100;
                    return (
                      <View
                        key={entry.hour}
                        accessibilityLabel={`${entry.label}: ${fmtInt(
                          entry.sessions,
                        )} ${t('costAnalysis.tou.sessions', 'Sessions')}`}
                        style={[
                          styles.bar,
                          {height: pctHeight(pct), backgroundColor: color},
                        ]}
                      />
                    );
                  })}
                </View>
                <View style={styles.xAxis}>
                  {hourlyData.map((entry, i) => (
                    <View key={entry.hour} style={styles.xTickCell}>
                      {i % X_TICK_INTERVAL === 0 ? (
                        <AppText
                          variant="caption"
                          tone="muted"
                          numberOfLines={1}
                          style={styles.axisTick}>
                          {entry.label}
                        </AppText>
                      ) : null}
                    </View>
                  ))}
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.chartEmpty}>
              <AppText tone="muted">
                {t('costAnalysis.charts.noData', 'Not enough data')}
              </AppText>
            </View>
          )}

          {/* Legend for peak / off-peak */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, {backgroundColor: LEGEND_PEAK}]} />
              <AppText variant="caption" tone="muted">
                {t('costAnalysis.tou.peak', 'Peak (2–7 PM)')}
              </AppText>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendDot, {backgroundColor: LEGEND_MID_PEAK}]}
              />
              <AppText variant="caption" tone="muted">
                {t('costAnalysis.tou.midPeak', 'Mid-peak')}
              </AppText>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendDot, {backgroundColor: LEGEND_OFF_PEAK}]}
              />
              <AppText variant="caption" tone="muted">
                {t('costAnalysis.tou.offPeak', 'Off-peak (10 PM–6 AM)')}
              </AppText>
            </View>
          </View>
        </View>

        {/* ToU insights */}
        <View style={styles.insightsCol}>
          <AppText variant="caption" tone="muted" style={styles.insightsHeading}>
            {t('costAnalysis.tou.insights', 'Insights')}
          </AppText>
          {touInsights ? (
            <>
              <InsightPanel
                label={t('costAnalysis.tou.cheapestHour', 'Cheapest Hour')}
                value={touInsights.cheapest.label}
                valueColor={VALUE_CHEAPEST}
                sub={`${t('costAnalysis.tou.avgCost', 'avg')} $${fmtNumber(
                  touInsights.cheapest.avgCost,
                  3,
                )} ${t('costAnalysis.tou.perSession', '/ session')}`}
              />
              <InsightPanel
                label={t('costAnalysis.tou.priciestHour', 'Priciest Hour')}
                value={touInsights.priciest.label}
                valueColor={VALUE_PRICIEST}
                sub={`${t('costAnalysis.tou.avgCost', 'avg')} $${fmtNumber(
                  touInsights.priciest.avgCost,
                  3,
                )} ${t('costAnalysis.tou.perSession', '/ session')}`}
              />
              <InsightPanel
                label={t('costAnalysis.tou.busiestHour', 'Busiest Hour')}
                value={touInsights.busiest.label}
                valueColor={VALUE_BUSIEST}
                sub={`${fmtInt(touInsights.busiest.sessions)} ${t(
                  'costAnalysis.tou.sessions',
                  'sessions',
                )}`}
              />
              <InsightPanel
                label={t('costAnalysis.tou.offPeakRatio', 'Off-Peak Charging')}
                value={`${fmtNumber(touInsights.offPeakPct, 1)}%`}
                valueColor={VALUE_OFF_PEAK}
                sub={t(
                  'costAnalysis.tou.offPeakDesc',
                  'of sessions between 10 PM–6 AM',
                )}
              />
            </>
          ) : (
            <View style={styles.insightsEmpty}>
              <AppText tone="muted">
                {t('costAnalysis.tou.noInsights', 'No insights available')}
              </AppText>
            </View>
          )}
        </View>
      </View>
    </GlassPanel>
  );
}

TimeOfUseAnalysis.displayName = 'TimeOfUseAnalysis';

const styles = StyleSheet.create({
  axisTick: {
    fontSize: 10,
    lineHeight: 14,
  },
  bar: {
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    flex: 1,
    minWidth: 0,
  },
  barsArea: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 2,
    height: BARS_HEIGHT,
  },
  chartCol: {
    gap: 8,
  },
  chartEmpty: {
    alignItems: 'center',
    height: 260,
    justifyContent: 'center',
  },
  chartRow: {
    flexDirection: 'row',
    gap: 8,
  },
  grid: {
    gap: 24,
  },
  insightPanel: {
    gap: 2,
    padding: 12,
  },
  insightSub: {
    fontSize: 10,
    lineHeight: 14,
  },
  insightValue: {
    fontSize: 18,
    lineHeight: 24,
    marginTop: 4,
  },
  insightsCol: {
    gap: 12,
  },
  insightsEmpty: {
    alignItems: 'center',
    height: 128,
    justifyContent: 'center',
  },
  insightsHeading: {
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
    justifyContent: 'center',
    marginTop: 8,
  },
  legendDot: {
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  plotColumn: {
    flex: 1,
    gap: 4,
  },
  root: {
    padding: 16,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  titleIcon: {
    color: AMBER_400,
    fontSize: 16,
    lineHeight: 18,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  xAxis: {
    flexDirection: 'row',
    gap: 2,
  },
  xTickCell: {
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  yAxis: {
    alignItems: 'flex-end',
    height: BARS_HEIGHT,
    justifyContent: 'space-between',
    width: 32,
  },
});
