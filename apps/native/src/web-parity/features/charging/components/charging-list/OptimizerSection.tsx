import {Glyph} from '../../../../../components/icons/Glyph';
// Native parity port of
// web/src/features/charging/components/charging-list/OptimizerSection.tsx.
//
// `OptimizerSection` is the charging-list "Charging Optimizer" block. It renders
// (in order):
//   1. a conditional success savings AlertBanner (only when
//      cost_analysis.potential_monthly_savings > 5),
//   2. a 3-up panel row (grid-cols-1 lg:grid-cols-3) of Charging Habits /
//      Battery-Friendly Score (RadialGauge) / Cost Analysis,
//   3. a conditional Cost Heatmap (only when weekly_heatmap is non-empty), and
//   4. an Optimization Recommendations panel that either lists priority-styled
//      recommendation cards or shows an EmptyState.
// Every threshold (savings > 5, score >= 75 / >= 50, sessions_during_peak_pct >
// 30, estimated_savings != null && > 0), every i18n key + English fallback, the
// FadeIn delays (0.23 / 0.24 / 0.25 / 0.26 / 0.27 / 0.28), the literal gauge
// colors (#22c55e / #f59e0b / #ef4444), the fmtNumber precisions (0 / 1 / 3),
// the "$<n>/kWh" + "~$<n>/mo" copy, and the peak/off-peak "<h>:00, …" || "—"
// joins are preserved verbatim.
//
// Web modules -> native-safe mappings (contract rules 4-7):
//   - react-i18next `useTranslation` (L1) -> a local key-preserving fallback
//     shim returning the inline English copy. It also reproduces the
//     `{{amount}}` interpolation the savings-banner title relies on (3rd options
//     arg), so the i18n intent survives without react-i18next in the native deps.
//   - lucide-react `Calendar`/`DollarSign`/`Lightbulb`/`Shield` (L2, plus the
//     `Clock` used by the inlined heatmap) are SVG icons with no native analog ->
//     decorative emoji glyphs rendered in `AppText` (accessibilityElementsHidden,
//     the AutomationCard / ChargerSpecsPanel `<Glyph/>` precedent). Tints follow
//     the source Tailwind hues mapped to SI tokens: text-neon-cyan -> colors.accent,
//     text-neon-green -> colors.success, text-neon-amber -> colors.warning,
//     text-neon-purple -> colors.violet.
//   - `GlassPanel` from @/components/ui (L3) -> the shared native
//     components/ui/GlassPanel primitive.
//   - `RadialGauge` from @/components/charts (L4) -> the native charts-barrel
//     RadialGauge (same value/max/label/color/size API).
//   - `FadeIn` from @/components/motion (L5) -> the native motion-barrel FadeIn
//     (Animated entrance; `delay` in seconds preserved).
//   - `EmptyState` from @/components/feedback (L6) -> a faithful message-only
//     local shim mirroring the web single-`message` API (the shared native
//     EmptyState requires a `title` the source never supplies). The web
//     no-action JSDoc intent is carried in the sidecar.
//   - `AlertBanner` from @/components/feedback (L7) is not ported -> a local
//     success AlertBanner (the SecurityAccessPage / GDPRExportPage precedent),
//     mapping the web success variant (neon-green/border/title) to the SI success
//     palette (successSurface/successBorder/success). icon -> the leading Glyph.
//   - `fmtNumber` from @/lib/numberFormat (L8) -> an inlined native-safe
//     equivalent (+ its `safeNumber` dep): nullish/non-finite -> 0, en-US locale,
//     default precision 2. `useFormatting().formatCurrency` (used by the inlined
//     heatmap) -> a local USD `$<n>` formatter (the per-user currency/locale hook
//     is not ported; documented in the sidecar).
//   - `cn` from @/lib/cn (L9) -> dropped; conditional Tailwind classes become
//     conditional StyleSheet style arrays.
//   - `ChargingOptimizerData` type from @/types/charging (L10) -> inlined verbatim
//     with its OptimizerSchedule / OptimizerCostAnalysis / OptimizerRecommendation
//     / OptimizerHeatmapEntry member types (the charging types module is not yet
//     ported as a standalone native file).
//   - `CostHeatmap` from ./CostHeatmap (L11) is not yet ported -> inlined as a
//     local native-safe component reproducing the 7x24 day/hour grid, the exact
//     rgba intensity formula, the hour labels, and the Cheap/Expensive legend.
//     The web `overflow-x-auto min-w-[600px]` becomes a horizontal ScrollView;
//     the per-cell hover `title` becomes the cell `accessibilityLabel`.
//
// DOM -> native element mapping: the web fragment `<>…</>` (spaced by its parent)
// -> a `<View>` stack (styles.container, gap 16) so the four blocks keep their
// vertical separation on native; the `grid grid-cols-1 lg:grid-cols-3 gap-4` ->
// the mobile base single column (grid-cols-1) as a vertical View stack (gap 16);
// every `<GlassPanel className="p-6">` -> GlassPanel styles.panel (padding 24);
// `<h3 className="… text-sm font-semibold text-white">` -> a heading row View +
// AppText; each `<div className="flex justify-between text-xs">` -> a row View;
// `<span className="text-[var(--text-secondary)]">` -> AppText tone="secondary";
// the recommendation `<div>` cards -> Views with priority-conditional styles.
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

import React, {type ReactNode} from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {RadialGauge} from '../../../../components/charts';
import {FadeIn} from '../../../../components/motion';

// ─── i18n fallback shim ───────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key. The optional 3rd
// argument reproduces react-i18next's `{{name}}` interpolation (the savings
// banner title depends on it) so intent is preserved.
type TOptions = Record<string, string | number>;
type TFunc = (key: string, fallback: string, options?: TOptions) => string;

function useTranslation(): {t: TFunc} {
  return {
    t: (_key, fallback, options) =>
      options
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
            options[name] != null ? String(options[name]) : '',
          )
        : fallback,
  };
}

// ─── Inlined `@/lib/numberFormat` (safeNumber / fmtNumber) ─────
// Locale-aware formatting matching the web helper: nullish/non-finite input
// coerces to 0, default precision is 2, and a bad locale falls back to en-US.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toFixed(decimals);
  }
}

// Native-safe substitute for `useFormatting().formatCurrency` (per-user currency
// + locale hook not ported): the inlined heatmap only uses it for the USD-style
// "$<n>/kWh" cell accessibility label.
function formatCurrency(v: unknown, decimals = 2): string {
  return `$${fmtNumber(v, decimals)}`;
}

// ─── Inlined `@/types/charging` (ChargingOptimizerData + members) ──
// The charging types module is not yet ported as a standalone native file, so the
// consumed types are inlined verbatim to keep this component self-contained.
interface OptimizerSchedule {
  most_common_start_hour: number;
  most_common_day: string;
  avg_sessions_per_week: number;
  home_charging_pct: number;
  avg_charge_to_pct: number;
}

interface OptimizerCostAnalysis {
  peak_hours: number[];
  offpeak_hours: number[];
  peak_cost_per_kwh: number;
  offpeak_cost_per_kwh: number;
  sessions_during_peak_pct: number;
  potential_monthly_savings: number;
}

interface OptimizerRecommendation {
  type: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  estimated_savings?: number;
}

interface OptimizerHeatmapEntry {
  day: number;
  hour: number;
  sessions: number;
  avg_cost_per_kwh: number;
}

export interface ChargingOptimizerData {
  current_schedule: OptimizerSchedule;
  cost_analysis: OptimizerCostAnalysis;
  battery_health_score: number;
  recommendations: OptimizerRecommendation[];
  weekly_heatmap: OptimizerHeatmapEntry[];
}

// ─── Decorative glyph (lucide icon → native-safe text glyph) ──
// The adjacent label/heading text carries the meaning, so each glyph is hidden
// from the accessibility tree.
function GlyphLegacyUnused({
  glyph,
  style,
}: {
  glyph: string;
  style?: StyleProp<TextStyle>;
}): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, style]}>
      {glyph}
    </AppText>
  );
}

// ─── EmptyState (web @/components/feedback EmptyState, message-only) ──
// Faithful message-only shim: the shared native EmptyState requires a title the
// source never supplies. Web no-action note: transient empty state — surfaces
// when source data is missing; no specific recovery action available.
function EmptyState({message}: {message: string}): React.ReactElement {
  return (
    <View accessibilityRole="text" style={styles.emptyState}>
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// ─── AlertBanner (web @/components/feedback AlertBanner, success variant) ──
// Not ported; this local success banner maps the web success variant
// (neon-green border/bg/title) to the SI success palette.
interface AlertBannerProps {
  glyph?: string;
  title?: string;
  children: ReactNode;
}

function AlertBanner({glyph, title, children}: AlertBannerProps): React.ReactElement {
  return (
    <View accessibilityRole="alert" style={styles.alert}>
      {glyph ? <Glyph glyph={glyph} style={styles.alertGlyph} /> : null}
      <View style={styles.alertBody}>
        {title ? <AppText style={styles.alertTitle}>{title}</AppText> : null}
        <AppText style={[styles.alertText, title ? styles.alertTextSpaced : null]}>
          {children}
        </AppText>
      </View>
    </View>
  );
}

// ─── CostHeatmap (web ./CostHeatmap, inlined) ─────────────────
// The sibling native module is not ported yet, so the 7x24 charging-cost grid is
// reproduced here. The web `overflow-x-auto min-w-[600px]` -> a horizontal
// ScrollView with a min-width inner; each `flex-1 aspect-square` cell -> a fixed
// square View; the per-cell hover `title` -> the cell accessibilityLabel. The
// rgba intensity formula and the Cheap/Expensive legend are preserved verbatim.
const HEATMAP_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HEATMAP_HOURS = Array.from({length: 24}, (_unused, i) => i);
const HEATMAP_LEGEND = [0.15, 0.3, 0.5, 0.7, 0.9];

interface CostHeatmapProps {
  heatmap: OptimizerHeatmapEntry[];
  peakCostPerKwh: number;
}

function CostHeatmap({heatmap, peakCostPerKwh}: CostHeatmapProps): React.ReactElement {
  const {t} = useTranslation();
  const maxCost = peakCostPerKwh || 0.3;

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.heading}>
        <Glyph glyph="🕐" style={styles.glyphPurple} />
        <AppText style={styles.headingText}>
          {t('charging.optimizer.heatmap', 'Charging Cost Heatmap')}
        </AppText>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.heatmapInner}>
          {/* Hour labels */}
          <View style={styles.heatmapHourLabels}>
            {HEATMAP_HOURS.map(i => (
              <View key={i} style={styles.heatmapHourCell}>
                <AppText style={styles.heatmapHourText} tone="muted">
                  {i % 3 === 0 ? `${i}` : ''}
                </AppText>
              </View>
            ))}
          </View>
          {/* Grid rows */}
          {HEATMAP_DAYS.map((dayLabel, dayIdx) => (
            <View key={dayIdx} style={styles.heatmapRow}>
              <AppText style={styles.heatmapDayLabel} tone="muted">
                {dayLabel}
              </AppText>
              {HEATMAP_HOURS.map(hourIdx => {
                const entry = heatmap.find(
                  e => e.day === dayIdx && e.hour === hourIdx,
                );
                const sessions = entry?.sessions ?? 0;
                const cost = entry?.avg_cost_per_kwh ?? 0;
                const intensity = maxCost > 0 ? Math.min(1, cost / maxCost) : 0;
                return (
                  <View
                    key={hourIdx}
                    accessibilityLabel={
                      sessions > 0
                        ? `${dayLabel} ${hourIdx}:00 — ${sessions} sessions, ${formatCurrency(
                            cost,
                            3,
                          )}/kWh`
                        : `${dayLabel} ${hourIdx}:00`
                    }
                    style={[
                      styles.heatmapCell,
                      {
                        backgroundColor:
                          sessions > 0
                            ? `rgba(${Math.round(intensity * 239)}, ${Math.round(
                                (1 - intensity) * 187,
                              )}, ${Math.round((1 - intensity) * 100)}, ${Math.min(
                                0.9,
                                0.15 + sessions * 0.12,
                              )})`
                            : 'rgba(255,255,255,0.02)',
                      },
                    ]}
                  />
                );
              })}
            </View>
          ))}
          {/* Legend */}
          <View style={styles.heatmapLegend}>
            <AppText style={styles.heatmapLegendText} tone="muted">
              {t('charging.optimizer.cheap', 'Cheap')}
            </AppText>
            <View style={styles.heatmapLegendSwatches}>
              {HEATMAP_LEGEND.map((o, i) => (
                <View
                  key={i}
                  style={[
                    styles.heatmapLegendSwatch,
                    {
                      backgroundColor: `rgba(${Math.round(o * 239)}, ${Math.round(
                        (1 - o) * 187,
                      )}, ${Math.round((1 - o) * 100)}, 0.6)`,
                    },
                  ]}
                />
              ))}
            </View>
            <AppText style={styles.heatmapLegendText} tone="muted">
              {t('charging.optimizer.expensive', 'Expensive')}
            </AppText>
          </View>
        </View>
      </ScrollView>
    </GlassPanel>
  );
}

// ─── Priority style pickers (Tailwind class chains → style arrays) ──
function recCardStyle(priority: OptimizerRecommendation['priority']): ViewStyle {
  return priority === 'high'
    ? styles.recCardHigh
    : priority === 'medium'
    ? styles.recCardMedium
    : styles.recCardLow;
}

function shieldStyle(priority: OptimizerRecommendation['priority']): TextStyle {
  return priority === 'high'
    ? styles.shieldHigh
    : priority === 'medium'
    ? styles.shieldMedium
    : styles.shieldLow;
}

function badgeBgStyle(priority: OptimizerRecommendation['priority']): ViewStyle {
  return priority === 'high'
    ? styles.badgeHigh
    : priority === 'medium'
    ? styles.badgeMedium
    : styles.badgeLow;
}

function badgeTextStyle(priority: OptimizerRecommendation['priority']): TextStyle {
  return priority === 'high'
    ? styles.badgeTextHigh
    : priority === 'medium'
    ? styles.badgeTextMedium
    : styles.badgeTextLow;
}

interface OptimizerSectionProps {
  optimizer: ChargingOptimizerData;
}

export function OptimizerSection({optimizer}: OptimizerSectionProps) {
  const {t} = useTranslation();

  const habitRows = [
    {
      label: t('charging.optimizer.sessionsWeek', 'Sessions/week'),
      value: fmtNumber(optimizer.current_schedule.avg_sessions_per_week, 1),
    },
    {
      label: t('charging.optimizer.homePct', 'Home charging'),
      value: `${fmtNumber(optimizer.current_schedule.home_charging_pct, 0)}%`,
    },
    {
      label: t('charging.optimizer.avgTarget', 'Avg charge target'),
      value: `${fmtNumber(optimizer.current_schedule.avg_charge_to_pct, 0)}%`,
    },
    {
      label: t('charging.optimizer.commonHour', 'Common start hour'),
      value: `${optimizer.current_schedule.most_common_start_hour}:00`,
    },
    {
      label: t('charging.optimizer.commonDay', 'Most common'),
      value: optimizer.current_schedule.most_common_day,
    },
  ];

  const score = optimizer.battery_health_score;
  const recommendations = optimizer.recommendations ?? [];

  return (
    <View style={styles.container}>
      {/* Savings banner */}
      {optimizer.cost_analysis.potential_monthly_savings > 5 ? (
        <FadeIn delay={0.23}>
          <AlertBanner
            glyph="💲"
            title={t(
              'charging.optimizer.savingsBanner',
              'Save ~${{amount}}/month by adjusting your charging schedule',
              {
                amount: fmtNumber(
                  optimizer.cost_analysis.potential_monthly_savings,
                  0,
                ),
              },
            )}>
            {t(
              'charging.optimizer.savingsDetail',
              'Based on your charging patterns, shifting to off-peak hours could reduce your monthly costs.',
            )}
          </AlertBanner>
        </FadeIn>
      ) : null}

      {/* Habits + Battery Score + Cost Analysis */}
      <View style={styles.columns}>
        {/* Current Habits */}
        <FadeIn delay={0.24}>
          <GlassPanel style={styles.panel}>
            <View style={styles.heading}>
              <Glyph glyph="📅" style={styles.glyphCyan} />
              <AppText style={styles.headingText}>
                {t('charging.optimizer.habits', 'Charging Habits')}
              </AppText>
            </View>
            <View style={styles.rows}>
              {habitRows.map(item => (
                <View key={item.label} style={styles.row}>
                  <AppText style={styles.rowLabel} tone="secondary">
                    {item.label}
                  </AppText>
                  <AppText style={styles.rowValue}>{item.value}</AppText>
                </View>
              ))}
            </View>
          </GlassPanel>
        </FadeIn>

        {/* Battery Health Score */}
        <FadeIn delay={0.25}>
          <GlassPanel style={[styles.panel, styles.gaugePanel]}>
            <RadialGauge
              value={score}
              max={100}
              label={t('charging.optimizer.batteryScore', 'Battery-Friendly Score')}
              color={score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444'}
              size={150}
            />
            <AppText style={styles.scoreCaption} tone="secondary">
              {score >= 75
                ? t('charging.optimizer.scoreGood', 'Your habits are battery-friendly')
                : score >= 50
                ? t('charging.optimizer.scoreFair', 'Room for improvement')
                : t('charging.optimizer.scorePoor', 'Consider adjusting your habits')}
            </AppText>
          </GlassPanel>
        </FadeIn>

        {/* Cost Analysis */}
        <FadeIn delay={0.26}>
          <GlassPanel style={styles.panel}>
            <View style={styles.heading}>
              <Glyph glyph="💲" style={styles.glyphGreen} />
              <AppText style={styles.headingText}>
                {t('charging.optimizer.costAnalysis', 'Cost Analysis')}
              </AppText>
            </View>
            <View style={styles.rows}>
              <View style={styles.row}>
                <AppText style={styles.rowLabel} tone="secondary">
                  {t('charging.optimizer.peakRate', 'Peak rate')}
                </AppText>
                <AppText style={[styles.rowValue, styles.valueDanger]}>
                  ${fmtNumber(optimizer.cost_analysis.peak_cost_per_kwh, 3)}/kWh
                </AppText>
              </View>
              <View style={styles.row}>
                <AppText style={styles.rowLabel} tone="secondary">
                  {t('charging.optimizer.offpeakRate', 'Off-peak rate')}
                </AppText>
                <AppText style={[styles.rowValue, styles.valueSuccess]}>
                  ${fmtNumber(optimizer.cost_analysis.offpeak_cost_per_kwh, 3)}/kWh
                </AppText>
              </View>
              <View style={styles.row}>
                <AppText style={styles.rowLabel} tone="secondary">
                  {t('charging.optimizer.peakSessions', 'Sessions during peak')}
                </AppText>
                <AppText
                  style={[
                    styles.rowValue,
                    optimizer.cost_analysis.sessions_during_peak_pct > 30
                      ? styles.valueDanger
                      : styles.valueSuccess,
                  ]}>
                  {fmtNumber(optimizer.cost_analysis.sessions_during_peak_pct, 0)}%
                </AppText>
              </View>
              <View style={styles.divider}>
                <View style={styles.row}>
                  <AppText style={styles.rowLabel} tone="secondary">
                    {t('charging.optimizer.peakHours', 'Peak hours')}
                  </AppText>
                  <AppText style={styles.hoursValue} tone="secondary">
                    {(optimizer.cost_analysis.peak_hours ?? [])
                      .map(h => `${h}:00`)
                      .join(', ') || '—'}
                  </AppText>
                </View>
                <View style={[styles.row, styles.rowSpaced]}>
                  <AppText style={styles.rowLabel} tone="secondary">
                    {t('charging.optimizer.offpeakHours', 'Off-peak hours')}
                  </AppText>
                  <AppText style={styles.hoursValue} tone="secondary">
                    {(optimizer.cost_analysis.offpeak_hours ?? [])
                      .map(h => `${h}:00`)
                      .join(', ') || '—'}
                  </AppText>
                </View>
              </View>
            </View>
          </GlassPanel>
        </FadeIn>
      </View>

      {/* Cost Heatmap */}
      {(optimizer.weekly_heatmap ?? []).length > 0 ? (
        <FadeIn delay={0.27}>
          <CostHeatmap
            heatmap={optimizer.weekly_heatmap ?? []}
            peakCostPerKwh={optimizer.cost_analysis.peak_cost_per_kwh}
          />
        </FadeIn>
      ) : null}

      {/* Recommendations */}
      <FadeIn delay={0.28}>
        <GlassPanel style={styles.panel}>
          <View style={styles.heading}>
            <Glyph glyph="💡" style={styles.glyphAmber} />
            <AppText style={styles.headingText}>
              {t('charging.optimizer.recommendations', 'Optimization Recommendations')}
            </AppText>
          </View>
          {recommendations.length > 0 ? (
            <View style={styles.rows}>
              {recommendations.map((rec, i) => (
                <View key={i} style={[styles.recCard, recCardStyle(rec.priority)]}>
                  <Glyph glyph="🛡️" style={[styles.recShield, shieldStyle(rec.priority)]} />
                  <View style={styles.recBody}>
                    <View style={styles.recTitleRow}>
                      <AppText style={styles.recTitle}>{rec.title}</AppText>
                      <View style={[styles.badge, badgeBgStyle(rec.priority)]}>
                        <AppText style={[styles.badgeText, badgeTextStyle(rec.priority)]}>
                          {rec.priority}
                        </AppText>
                      </View>
                      {rec.estimated_savings != null && rec.estimated_savings > 0 ? (
                        <View style={[styles.badge, styles.badgeSavings]}>
                          <AppText style={[styles.badgeText, styles.badgeTextSavings]}>
                            ~${fmtNumber(rec.estimated_savings, 0)}/mo
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                    <AppText style={styles.recDetail} tone="secondary">
                      {rec.detail}
                    </AppText>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              message={t(
                'charging.optimizer.noRecs',
                'Recommendations will appear after more charging sessions.',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </View>
  );
}

OptimizerSection.displayName = 'OptimizerSection';

export default OptimizerSection;

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  columns: {
    gap: 16, // grid-cols-1 mobile base — vertical stack (gap-4)
  },
  panel: {
    padding: 24, // p-6
  },
  gaugePanel: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
    marginBottom: 16, // mb-4
  },
  headingText: {
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
    lineHeight: 20,
  },
  glyph: {
    fontSize: 14, // h-4 w-4
    lineHeight: 18,
  },
  glyphCyan: {
    color: colors.accent, // text-neon-cyan
  },
  glyphGreen: {
    color: colors.success, // text-neon-green
  },
  glyphAmber: {
    color: colors.warning, // text-neon-amber
  },
  glyphPurple: {
    color: colors.violet, // text-neon-purple
  },
  rows: {
    gap: 12, // space-y-3
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowSpaced: {
    marginTop: 4, // mt-1
  },
  rowLabel: {
    fontSize: 12, // text-xs
  },
  rowValue: {
    fontSize: 12, // text-xs
    fontWeight: '600', // font-semibold
  },
  valueDanger: {
    color: colors.danger, // text-red-400
  },
  valueSuccess: {
    color: colors.success, // text-emerald-300
  },
  hoursValue: {
    flexShrink: 1,
    fontSize: 12, // text-xs
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  divider: {
    borderTopColor: 'rgba(255,255,255,0.06)', // border-white/[0.06]
    borderTopWidth: 1,
    marginTop: 8, // mt-2
    paddingTop: 8, // pt-2
  },
  scoreCaption: {
    fontSize: 12, // text-xs
    marginTop: 8, // mt-2
    textAlign: 'center',
  },
  // Recommendation cards
  recCard: {
    alignItems: 'flex-start',
    borderRadius: 12, // rounded-xl
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12, // gap-3
    padding: 16, // p-4
  },
  recCardHigh: {
    backgroundColor: 'rgba(251,113,133,0.06)', // bg-red-500/[0.06]
    borderColor: 'rgba(251,113,133,0.1)', // border-red-500/10
  },
  recCardMedium: {
    backgroundColor: 'rgba(251,191,36,0.06)', // bg-neon-amber/[0.06]
    borderColor: 'rgba(251,191,36,0.1)', // border-neon-amber/10
  },
  recCardLow: {
    backgroundColor: 'rgba(255,255,255,0.03)', // bg-white/[0.03]
    borderColor: 'rgba(255,255,255,0.06)', // border-white/[0.06]
  },
  recShield: {
    fontSize: 18, // h-5 w-5
    lineHeight: 22,
    marginTop: 2, // mt-0.5
  },
  shieldHigh: {
    color: colors.danger, // text-red-400
  },
  shieldMedium: {
    color: colors.warning, // text-amber-300
  },
  shieldLow: {
    color: colors.success, // text-emerald-300
  },
  recBody: {
    flex: 1,
  },
  recTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8, // gap-2
    marginBottom: 4, // mb-1
  },
  recTitle: {
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
  },
  recDetail: {
    fontSize: 12, // text-xs
  },
  badge: {
    borderRadius: 999, // rounded-full
    paddingHorizontal: 6, // px-1.5
    paddingVertical: 2, // py-0.5
  },
  badgeText: {
    fontSize: 10, // text-[10px]
    fontWeight: '500', // font-medium
    letterSpacing: 0.5, // tracking-wider
    textTransform: 'uppercase',
  },
  badgeHigh: {
    backgroundColor: 'rgba(251,113,133,0.2)', // bg-red-500/20
  },
  badgeMedium: {
    backgroundColor: 'rgba(251,191,36,0.2)', // bg-neon-amber/20
  },
  badgeLow: {
    backgroundColor: 'rgba(52,211,153,0.2)', // bg-neon-green/20
  },
  badgeTextHigh: {
    color: colors.danger, // text-red-400
  },
  badgeTextMedium: {
    color: colors.warning, // text-neon-amber
  },
  badgeTextLow: {
    color: colors.success, // text-neon-green
  },
  badgeSavings: {
    backgroundColor: 'rgba(52,211,153,0.2)', // bg-neon-green/20
  },
  badgeTextSavings: {
    color: colors.success, // text-neon-green
  },
  // AlertBanner (success)
  alert: {
    alignItems: 'flex-start',
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: 12, // rounded-xl
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12, // gap-3
    padding: 16, // p-4
  },
  alertGlyph: {
    color: colors.success,
    fontSize: 20, // h-5 w-5
    lineHeight: 24,
    marginTop: 2, // mt-0.5
  },
  alertBody: {
    flex: 1,
  },
  alertTitle: {
    color: colors.success, // titleText text-neon-green
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
  },
  alertText: {
    color: 'rgba(52,211,153,0.85)', // text-neon-green/80
    fontSize: 12, // text-xs
  },
  alertTextSpaced: {
    marginTop: 2, // mt-0.5 when a title is present
  },
  // EmptyState
  emptyState: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  // CostHeatmap
  heatmapInner: {
    minWidth: 600, // min-w-[600px]
  },
  heatmapHourLabels: {
    flexDirection: 'row',
    gap: 2, // gap-0.5
    marginBottom: 4, // mb-1
    marginLeft: 46, // ml-12 (aligns with the data columns past the day label)
  },
  heatmapHourCell: {
    alignItems: 'center',
    width: 20,
  },
  heatmapHourText: {
    fontSize: 8, // text-[8px]
    lineHeight: 10,
  },
  heatmapRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2, // gap-0.5
    marginBottom: 2, // mb-0.5
  },
  heatmapDayLabel: {
    fontSize: 10, // text-[10px]
    marginRight: 4, // mr-1
    textAlign: 'right',
    width: 40, // w-10
  },
  heatmapCell: {
    borderRadius: 2, // rounded-sm
    height: 20,
    width: 20, // flex-1 aspect-square → fixed square (native layout adaptation)
  },
  heatmapLegend: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
    justifyContent: 'flex-end',
    marginTop: 8, // mt-2
  },
  heatmapLegendText: {
    fontSize: 10, // text-[10px]
  },
  heatmapLegendSwatches: {
    flexDirection: 'row',
    gap: 2, // gap-0.5
  },
  heatmapLegendSwatch: {
    borderRadius: 2, // rounded-sm
    height: 12, // h-3
    width: 12, // w-3
  },
});
