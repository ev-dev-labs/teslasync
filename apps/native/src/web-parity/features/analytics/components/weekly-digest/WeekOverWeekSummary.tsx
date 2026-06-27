import {Glyph} from '../../../../../components/icons/Glyph';
// Native parity port of
// web/src/features/analytics/components/weekly-digest/WeekOverWeekSummary.tsx.
//
// `WeekOverWeekSummary` is one panel of the analytics Weekly Digest. It renders a
// "Week-over-Week Comparison" header followed by a responsive grid of six
// StatCards — Distance (km), Drives, Energy (kWh), Cost, Efficiency (Wh/km) and
// CO₂ Saved (kg) — each showing the current value plus a directional trend chip
// versus the previous week. Behaviour, state names, the i18n keys + English
// fallbacks, the unit strings ("km", "kWh", "Wh/km", "kg"), the value precisions
// (distance/energy/efficiency/CO₂ at 1 dp, drives as integer, cost via
// formatCurrency at 2 dp) and the `trendFor(...)` arguments — including the
// `invertPositive` flag on energy/cost/efficiency (lower is better) — are
// preserved verbatim.
//
// Web module -> native-safe mappings (contract rules 4-7):
//   - `@/components/ui` `GlassPanel` -> the native `components/ui/GlassPanel`
//     primitive (View-based glass card).
//   - `@/components/data-display` `StatCard` -> reproduced as a local native
//     `StatCard` (GlassPanel column: label+icon row, value+unit baseline row,
//     coloured trend chip), mirroring the web component's markup exactly. The web
//     `loading`/`sublabel`/`className` props are not used by this consumer, so —
//     as with the DrivingSection MiniStat port — the local copy reproduces only
//     the surface this file exercises (label/value/unit/icon/trend). The trend
//     colour semantic is preserved: positive => success, flat => muted,
//     otherwise danger; arrow ↑/↓/—.
//   - `@/components/motion` `FadeIn` -> the ported `web-parity/components/motion`
//     FadeIn (Animated entrance; `delay` in seconds preserved at 0.3).
//   - lucide-react `Car/Activity/Zap/Fuel/BarChart3/Leaf` (SVG, no native analog)
//     -> decorative emoji glyphs rendered in `AppText` and hidden from assistive
//     tech (the adjacent StatCard label carries the meaning), matching the
//     DrivingSection / SummarySlide glyph technique.
//   - react-i18next `useTranslation` -> the standard local fallback shim
//     returning the inline English copy while keeping every i18n key, so
//     translation intent is preserved (no react-i18next in the native deps).
//   - `@/hooks/useFormatting` `formatCurrency` -> inlined native-safe equivalent.
//     The web hook reads `currency_symbol`/precision from `useSettings`; there is
//     no ported native settings provider here, so the port uses the web default
//     symbol "$" and the call site's explicit precision (2). Documented in the
//     sidecar.
//   - `@/lib/numberFormat` `fmtNumber/fmtInt` -> inlined native-safe equivalents
//     (locale-aware `toLocaleString` with the same nullish->0 + precision
//     contract); there is no ported native numberFormat module yet.
//   - `./helpers` `trendFor` (+ its `pctChange` dependency) and `./types`
//     `DigestMetrics` (+ the referenced `Drive`) -> inlined verbatim; the sibling
//     weekly-digest helpers/types have not been ported as standalone native
//     modules yet, so this component is kept self-contained (same precedent as
//     the DrivingSection inline of pctChange / DigestMetrics).
//
// DOM -> native element mapping: the title `<span>` becomes `AppText`; the grid
// `<span>` and StatCard `<div>`s become `View`s; Tailwind classes become
// StyleSheet/token styles (1 spacing unit = 4px: p-6 -> 24, space-y-4 -> 16,
// gap-3 -> 12, gap-1 -> 4). The responsive grid (`grid-cols-1 sm:grid-cols-2
// lg:grid-cols-3`) collapses to a flex-wrap two-up row since native has no CSS
// grid breakpoints. `text-white` -> the AppText primary tone;
// `--text-muted` -> the AppText muted tone; green-600/red-600 trend colours ->
// the success/danger tokens.

import React, {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {FadeIn} from '../../../../components/motion';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';

// ─── i18n fallback ────────────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, so intent survives.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// ─── Inlined `@/lib/numberFormat` (fmtNumber / fmtInt) ────────
// Locale-aware formatting matching the web helpers: nullish/non-finite input
// coerces to 0, and a bad locale falls back to en-US.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toFixed(decimals);
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// ─── Inlined `@/hooks/useFormatting` (formatCurrency) ─────────
// The web hook resolves the currency symbol + default precision from useSettings;
// with no ported native settings provider, this uses the web default symbol "$"
// and honours the call site's explicit precision.
const CURRENCY_SYMBOL = '$';

function formatCurrency(amount: number, decimals = 2): string {
  return `${CURRENCY_SYMBOL}${fmtNumber(amount, decimals)}`;
}

// ─── Inlined `./helpers` (pctChange / trendFor) ───────────────
interface Trend {
  direction: 'up' | 'down' | 'flat';
  value: string;
  positive: boolean;
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

function trendFor(
  current: number,
  previous: number,
  invertPositive = false,
): Trend {
  const diff = current - previous;
  const pct = pctChange(current, previous);
  if (Math.abs(diff) < 0.01) {
    return {direction: 'flat', value: '0%', positive: true};
  }
  const isUp = diff > 0;
  return {
    direction: isUp ? 'up' : 'down',
    value: `${isUp ? '+' : ''}${fmtNumber(pct, 1)}%`,
    positive: invertPositive ? !isUp : isUp,
  };
}

// ─── Inlined `./types` (Drive / DigestMetrics) ────────────────
interface Drive {
  id: number;
  start_date: string;
  distance: number;
  duration_min: number;
  efficiency_wh_km: number;
  energy_used: number;
}

export interface DigestMetrics {
  totalDistance: number;
  prevDistance: number;
  totalDrives: number;
  prevDriveCount: number;
  energyUsed: number;
  prevEnergy: number;
  chargingCost: number;
  prevChargingCost: number;
  co2Saved: number;
  prevCo2: number;
  avgEfficiency: number;
  prevAvgEfficiency: number;
  totalDuration: number;
  topDrive: Drive | undefined;
  chargeEnergyAdded: number;
  prevChargeEnergy: number;
  avgChargeRate: number;
  chargingSessionCount: number;
  batteryStart: number;
  batteryEnd: number;
  alertsByType: Record<string, number>;
  alertTotal: number;
}

// ─── Glyph (lucide -> emoji) ──────────────────────────────────
// Decorative; hidden from assistive tech since the adjacent label carries
// meaning. Car/Activity/Zap/Fuel/BarChart3/Leaf -> 🚗/📈/⚡/⛽/📊/🍃.
interface GlyphProps {
  char: string;
  color?: string;
  size?: number;
}

function GlyphLegacyUnused({char, color, size = 16}: GlyphProps) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, {fontSize: size}, color ? {color} : null]}>
      {char}
    </AppText>
  );
}

// ─── StatCard (local port of @/components/data-display StatCard) ──
interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: {direction: 'up' | 'down' | 'flat'; value: string; positive?: boolean};
}

function StatCard({label, value, unit, icon, trend}: StatCardProps) {
  const trendColor = trend
    ? trend.positive
      ? colors.success
      : trend.direction === 'flat'
        ? colors.textMuted
        : colors.danger
    : colors.textMuted;
  const trendArrow = trend
    ? trend.direction === 'up'
      ? '↑'
      : trend.direction === 'down'
        ? '↓'
        : '—'
    : '';

  return (
    <GlassPanel style={styles.card}>
      <View style={styles.cardHeader}>
        <AppText style={styles.cardLabel} tone="muted">
          {label}
        </AppText>
        {icon != null ? <View style={styles.cardIcon}>{icon}</View> : null}
      </View>
      <View style={styles.cardValueRow}>
        <AppText style={styles.cardValue} weight="bold">
          {String(value)}
        </AppText>
        {unit ? (
          <AppText style={styles.cardUnit} tone="muted">
            {unit}
          </AppText>
        ) : null}
      </View>
      {trend ? (
        <View style={styles.cardTrend}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.cardTrendText, {color: trendColor}]}>
            {trendArrow}
          </AppText>
          <AppText style={[styles.cardTrendText, {color: trendColor}]}>
            {trend.value}
          </AppText>
        </View>
      ) : null}
    </GlassPanel>
  );
}

interface WeekOverWeekSummaryProps {
  metrics: DigestMetrics;
}

export function WeekOverWeekSummary({metrics}: WeekOverWeekSummaryProps) {
  const {t} = useTranslation();

  return (
    <FadeIn delay={0.3}>
      <GlassPanel style={styles.root}>
        <AppText style={styles.title} weight="bold">
          {t('analytics.weeklyDigest.weekOverWeek', 'Week-over-Week Comparison')}
        </AppText>
        <View style={styles.grid}>
          <StatCard
            label={t('analytics.weeklyDigest.distance', 'Distance')}
            value={fmtNumber(metrics.totalDistance, 1)}
            unit="km"
            icon={<Glyph char="🚗" color={colors.textMuted} />}
            trend={trendFor(metrics.totalDistance, metrics.prevDistance)}
          />
          <StatCard
            label={t('analytics.weeklyDigest.drives', 'Drives')}
            value={fmtInt(metrics.totalDrives)}
            icon={<Glyph char="📈" color={colors.textMuted} />}
            trend={trendFor(metrics.totalDrives, metrics.prevDriveCount)}
          />
          <StatCard
            label={t('analytics.weeklyDigest.energy', 'Energy')}
            value={fmtNumber(metrics.energyUsed, 1)}
            unit="kWh"
            icon={<Glyph char="⚡" color={colors.textMuted} />}
            trend={trendFor(metrics.energyUsed, metrics.prevEnergy, true)}
          />
          <StatCard
            label={t('analytics.weeklyDigest.cost', 'Cost')}
            value={formatCurrency(metrics.chargingCost, 2)}
            icon={<Glyph char="⛽" color={colors.textMuted} />}
            trend={trendFor(metrics.chargingCost, metrics.prevChargingCost, true)}
          />
          <StatCard
            label={t('analytics.weeklyDigest.efficiency', 'Efficiency')}
            value={fmtNumber(metrics.avgEfficiency, 1)}
            unit="Wh/km"
            icon={<Glyph char="📊" color={colors.textMuted} />}
            trend={trendFor(metrics.avgEfficiency, metrics.prevAvgEfficiency, true)}
          />
          <StatCard
            label={t('analytics.weeklyDigest.co2', 'CO₂ Saved')}
            value={fmtNumber(metrics.co2Saved, 1)}
            unit="kg"
            icon={<Glyph char="🍃" color={colors.textMuted} />}
            trend={trendFor(metrics.co2Saved, metrics.prevCo2)}
          />
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 16, // space-y-4
    padding: 24, // p-6
  },
  title: {
    fontSize: 18, // text-lg
    color: colors.textPrimary,
  },
  glyph: {
    lineHeight: 22,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12, // gap-3
  },
  card: {
    flexBasis: '47%',
    flexDirection: 'column',
    flexGrow: 1,
    gap: 4, // gap-1
    padding: 16, // p-4
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardLabel: {
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
  },
  cardIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 4, // gap-1
  },
  cardValue: {
    fontSize: 24, // text-2xl
    color: colors.textPrimary,
  },
  cardUnit: {
    fontSize: 14, // text-sm
  },
  cardTrend: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4, // gap-1
  },
  cardTrendText: {
    fontSize: 12, // text-xs
  },
});
