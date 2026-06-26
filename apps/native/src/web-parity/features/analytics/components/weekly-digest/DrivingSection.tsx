// Native parity port of
// web/src/features/analytics/components/weekly-digest/DrivingSection.tsx.
//
// `DrivingSection` is one panel of the analytics Weekly Digest. It renders, in
// order: a "Driving" header with a car icon; a "Daily Distance (km)" bar chart
// (or an empty state when there is no data); a four-up grid of efficiency
// MiniStats (Avg Efficiency, Total Driving Time, Efficiency Change, Drives); and
// a "Top Drive" card with the week's best drive (date / distance / duration /
// efficiency) or an empty state. Behaviour, state names, the i18n keys + English
// fallbacks, the unit strings ("Wh/km", "km", "min"), and the efficiency-trend
// logic (`avgEfficiency <= prevAvgEfficiency` => improvement) are preserved
// verbatim.
//
// Web module -> native-safe mappings (contract rules 4-7):
//   - `@/components/ui` `GlassPanel` -> the native `components/ui/GlassPanel`
//     primitive (View-based glass card).
//   - `@/components/ui` `Badge` -> the ported `web-parity/components/ui/Badge`
//     (variant="success" size="sm" preserved).
//   - `@/components/motion` `FadeIn` -> the ported `web-parity/components/motion`
//     FadeIn (Animated entrance; `delay` in seconds preserved at 0.1).
//   - `@/components/feedback` `EmptyState` -> the native
//     `components/feedback/EmptyState`. The web API is `{message, className}`;
//     the native primitive requires `{title, message}`, so each call keeps the
//     original message key/copy verbatim and adds a companion `.title` key
//     (same approach as the AuditPanel / EventTimeline ports). `className`
//     (py-8 / py-6) has no native analog and is dropped.
//   - `@/components/charts` `ResponsiveContainer/BarChart/Bar/XAxis/YAxis/
//     Tooltip` + `ChartTooltip/CHART_COLORS/chartGrid/axisTickSm/
//     chartMarginLabeled/chartAnimation` -> the ported `web-parity/components/
//     charts` barrel. That barrel replaces Recharts (a DOM/SVG dependency with
//     no native surface) with native-safe primitives; the bar chart therefore
//     renders the barrel's explicit "native chart renderer unavailable"
//     placeholder rather than plotting bars. Every chart prop (data, margin,
//     dataKey, tickFormatter, fill, radius, name, animation) is forwarded
//     identically so the source shape is preserved. Documented in the sidecar.
//   - lucide-react `Car/BarChart3/Clock/TrendingDown/TrendingUp/Activity` (SVG,
//     no native analog) -> decorative emoji/caret glyphs rendered in `AppText`
//     and hidden from assistive tech (the adjacent label/value carry the
//     meaning), matching the SummarySlide / EventTimeline glyph technique. The
//     trend caret keeps the web colour semantic: improvement = success ▼,
//     regression = danger ▲.
//   - react-i18next `useTranslation` -> the standard local fallback shim
//     returning the inline English copy while keeping every i18n key, so
//     translation intent is preserved (no react-i18next in the native deps).
//   - `@/lib/numberFormat` `fmtNumber/fmtInt` and `@/lib/dateFormat` `formatDate`
//     -> inlined native-safe equivalents (locale-aware `toLocaleString` with the
//     same precision contract + "—" date fallback); there is no ported native
//     numberFormat/dateFormat module yet.
//   - `./helpers` `pctChange` and `./types` `DigestMetrics/DailyDistanceEntry`
//     (plus the referenced `Drive`) -> inlined verbatim; the sibling
//     weekly-digest helpers/types have not been ported yet, so this component is
//     kept self-contained (same precedent as the SummarySlide inline of
//     AnimatedNumber / convertDistanceFromSI).
//   - `./MiniStat` -> reproduced as a local native `MiniStat` (GlassPanel row:
//     muted icon glyph + caption label + semibold value), mirroring the web
//     component exactly.
//
// DOM -> native element mapping: every web `<span>`/`<div>` becomes a `View`
// (layout) or `AppText` (text); Tailwind classes become StyleSheet/token styles
// (1 spacing unit = 4px: p-6 -> 24, gap-2 -> 8, gap-3/gap-4 -> 12/16,
// space-y-6/gap-6 -> 24, mb-3 -> 12). The responsive multi-column grids collapse
// to flex-wrap rows (two-up on a phone) since native has no CSS grid breakpoints.
// `text-neon-cyan` -> accent token; `--text-secondary`/`--text-muted`/`white` ->
// the AppText secondary/muted/primary tones.

import React, {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {Badge} from '../../../../components/ui/Badge';
import {
  BarChart,
  Bar,
  CHART_COLORS,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTickSm,
  chartAnimation,
  chartGrid,
  chartMarginLabeled,
} from '../../../../components/charts';
import {FadeIn} from '../../../../components/motion';
import {AppText} from '../../../../../components/ui/AppText';
import {EmptyState} from '../../../../../components/feedback/EmptyState';
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
// coerces to 0, and a bad locale falls back to en-US. The web default precision
// is 2; both surviving call sites pass an explicit precision (1 and 0).
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

// ─── Inlined `@/lib/dateFormat` (formatDate) ──────────────────
// "Apr 4, 2026"; returns the universal "—" placeholder for nullish/invalid input
// (mirrors the web formatter contract — callers do not pre-guard).
function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Inlined `./helpers` (pctChange) ──────────────────────────
function pctChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

// ─── Inlined `./types` (Drive / DigestMetrics / DailyDistanceEntry) ──
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

export interface DailyDistanceEntry {
  day: string;
  distance: number;
}

// ─── Glyph (lucide -> emoji/caret) ────────────────────────────
// Decorative; hidden from assistive tech since the adjacent text carries meaning.
interface GlyphProps {
  char: string;
  color?: string;
  size?: number;
}

function Glyph({char, color, size = 16}: GlyphProps) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, {fontSize: size}, color ? {color} : null]}>
      {char}
    </AppText>
  );
}

// ─── MiniStat (local port of ./MiniStat) ──────────────────────
interface MiniStatProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
}

function MiniStat({label, value, icon}: MiniStatProps) {
  return (
    <GlassPanel style={styles.miniStat}>
      {icon != null ? <View style={styles.miniStatIcon}>{icon}</View> : null}
      <View style={styles.miniStatBody}>
        <AppText tone="secondary" variant="caption">
          {label}
        </AppText>
        <AppText style={styles.miniStatValue} weight="semibold">
          {String(value)}
        </AppText>
      </View>
    </GlassPanel>
  );
}

// ─── Top-drive stat column ────────────────────────────────────
interface DriveStatProps {
  label: string;
  value: string;
}

function DriveStat({label, value}: DriveStatProps) {
  return (
    <View style={styles.driveStat}>
      <AppText tone="secondary" variant="caption">
        {label}
      </AppText>
      <AppText style={styles.driveStatValue} weight="semibold">
        {value}
      </AppText>
    </View>
  );
}

interface DrivingSectionProps {
  metrics: DigestMetrics;
  dailyDistanceData: DailyDistanceEntry[];
}

export function DrivingSection({metrics, dailyDistanceData}: DrivingSectionProps) {
  const {t} = useTranslation();

  const efficiencyImproved = metrics.avgEfficiency <= metrics.prevAvgEfficiency;

  return (
    <FadeIn delay={0.1}>
      <GlassPanel style={styles.root}>
        <View style={styles.header}>
          <Glyph char="🚗" color={colors.accent} size={20} />
          <AppText style={styles.headerTitle} weight="bold">
            {t('analytics.weeklyDigest.drivingSection', 'Driving')}
          </AppText>
        </View>

        {/* Daily Distance BarChart */}
        <GlassPanel style={styles.panel}>
          <AppText style={styles.panelLabel} tone="secondary" variant="caption">
            {t('analytics.weeklyDigest.dailyDistance', 'Daily Distance (km)')}
          </AppText>
          {dailyDistanceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dailyDistanceData} margin={chartMarginLabeled}>
                {chartGrid}
                <XAxis dataKey="day" {...axisTickSm} />
                <YAxis {...axisTickSm} tickFormatter={(v: number) => fmtInt(v)} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="distance"
                  name={t('analytics.weeklyDigest.distance', 'Distance')}
                  fill={CHART_COLORS[0]}
                  radius={[4, 4, 0, 0]}
                  {...chartAnimation}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              title={t('analytics.weeklyDigest.noDailyDistanceTitle', 'No driving data')}
              message={t(
                'analytics.weeklyDigest.noDailyDistance',
                'No driving distance data is available for this week.',
              )}
            />
          )}
        </GlassPanel>

        {/* Driving efficiency stats */}
        <View style={styles.statsGrid}>
          <MiniStat
            label={t('analytics.weeklyDigest.avgEfficiency', 'Avg Efficiency')}
            value={`${fmtNumber(metrics.avgEfficiency, 1)} Wh/km`}
            icon={<Glyph char="📊" color={colors.textMuted} />}
          />
          <MiniStat
            label={t('analytics.weeklyDigest.totalDrivingTime', 'Total Driving Time')}
            value={`${fmtInt(Math.floor(metrics.totalDuration / 60))}h ${fmtInt(
              metrics.totalDuration % 60,
            )}m`}
            icon={<Glyph char="🕒" color={colors.textMuted} />}
          />
          <MiniStat
            label={t('analytics.weeklyDigest.efficiencyChange', 'Efficiency Change')}
            value={
              metrics.prevAvgEfficiency > 0
                ? `${fmtNumber(
                    pctChange(metrics.avgEfficiency, metrics.prevAvgEfficiency),
                    1,
                  )}%`
                : '—'
            }
            icon={
              efficiencyImproved ? (
                <Glyph char="▼" color={colors.success} />
              ) : (
                <Glyph char="▲" color={colors.danger} />
              )
            }
          />
          <MiniStat
            label={t('analytics.weeklyDigest.drivesCount', 'Drives')}
            value={fmtInt(metrics.totalDrives)}
            icon={<Glyph char="⚡" color={colors.textMuted} />}
          />
        </View>

        {/* Top drive card */}
        <GlassPanel style={styles.panel}>
          {metrics.topDrive ? (
            <View style={styles.topDrive}>
              <Badge variant="success" size="sm">
                {t('analytics.weeklyDigest.topDrive', 'Top Drive')}
              </Badge>
              <View style={styles.topDriveStats}>
                <DriveStat
                  label={t('analytics.weeklyDigest.date', 'Date')}
                  value={formatDate(metrics.topDrive.start_date)}
                />
                <DriveStat
                  label={t('analytics.weeklyDigest.distance', 'Distance')}
                  value={`${fmtNumber(metrics.topDrive.distance, 1)} km`}
                />
                <DriveStat
                  label={t('analytics.weeklyDigest.duration', 'Duration')}
                  value={`${fmtInt(metrics.topDrive.duration_min)} min`}
                />
                <DriveStat
                  label={t('analytics.weeklyDigest.efficiency', 'Efficiency')}
                  value={`${fmtNumber(metrics.topDrive.efficiency_wh_km, 1)} Wh/km`}
                />
              </View>
            </View>
          ) : (
            <EmptyState
              title={t('analytics.weeklyDigest.noTopDriveTitle', 'No top drive')}
              message={t(
                'analytics.weeklyDigest.noTopDrive',
                'No top drive is available for this week yet.',
              )}
            />
          )}
        </GlassPanel>
      </GlassPanel>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 24, // space-y-6
    padding: 24, // p-6
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
  },
  headerTitle: {
    fontSize: 18, // text-lg
    color: colors.textPrimary,
  },
  glyph: {
    lineHeight: 22,
  },
  panel: {
    padding: 16, // p-4
  },
  panelLabel: {
    marginBottom: 12, // mb-3
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12, // gap-3
  },
  miniStat: {
    alignItems: 'center',
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: 12, // gap-3
    paddingHorizontal: 16, // px-4
    paddingVertical: 12, // py-3
  },
  miniStatIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniStatBody: {
    flexDirection: 'column',
    flexShrink: 1,
  },
  miniStatValue: {
    fontSize: 14, // text-sm
    color: colors.textPrimary,
  },
  topDrive: {
    flexDirection: 'column',
    gap: 8, // gap-2
  },
  topDriveStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16, // gap-4
  },
  driveStat: {
    flexBasis: '40%',
    flexDirection: 'column',
    flexGrow: 1,
  },
  driveStatValue: {
    fontSize: 14, // text-sm
    color: colors.textPrimary,
  },
});
