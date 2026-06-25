// Native parity port of web/src/components/data-display/InsightsEngine.tsx.
// Reproduces the eight client-side "Smart Insights" analyzers (charging cost,
// efficiency trend, battery health, optimal charging, vampire drain, driving
// patterns, EV cost savings, range optimization) and their severity/trend
// visual language using React Native primitives.
//
// The web source pulls modules with no native parity surface:
//   - `lucide-react` icons   -> short glyph strings rendered via AppText.
//   - `GlassPanel`/`FadeIn`  -> the native GlassPanel primitive and a local
//                               Animated FadeIn that mirrors the framer-motion
//                               opacity 0->1 / translateY 12->0 / 400ms / easeOut
//                               entry and honours reduced-motion.
//   - `fmtNumber`            -> inlined verbatim from `@/lib/numberFormat`
//                               (safeNumber + locale-fallback toLocaleString,
//                               default precision 2, default locale en-US).
//   - `useFormatting().formatCurrency` -> rebuilt locally from the native
//                               `useSettings` web-parity hook, matching the web
//                               currency-symbol + decimal-precision rules.
//   - `trendColor` from `@/lib/colors` -> inlined verbatim (up->BAD, down->GOOD,
//                               else MUTED).
// The web source is marked `@ts-nocheck` because two of its `@/api/client`
// shapes (`ChargingSession`, `EnergyStats`) still read legacy pre-SI field
// names; those two are reproduced as local legacy interfaces here so the port
// stays fully typed, while `Drive`/`BatteryReport`/`VampireDrainStats`/
// `MileageStats` (whose field names already match) are imported from the
// canonical native types. The source has no i18n (hardcoded English), so the
// literal copy is preserved byte-for-byte, including the CO2 subscript and the
// 20-80% en dash.

import React, {
  useCallback,
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
} from 'react-native';

import { AppText } from '../../../components/ui/AppText';
import { GlassPanel } from '../../../components/ui/GlassPanel';
import { colors } from '../../../theme/tokens';
import type {
  BatteryReport,
  Drive,
  MileageStats,
  VampireDrainStats,
} from '../../api/types';
import { useSettings } from '../../api/hooks/useSettings';

// ─── Types ────────────────────────────────────────────────────

/**
 * Legacy pre-SI charging-session shape consumed by the insight analyzers. The
 * canonical native `ChargingSession` now exposes `total_energy_added_wh`,
 * `charger_type`, and `end_soc_pct`; the web source still reads the legacy
 * `charge_energy_added` / `fast_charger_type` / `end_battery_level` names, so
 * those are reproduced here to keep the analysis byte-for-byte.
 */
interface ChargingSession {
  cost?: number | null;
  charge_energy_added: number;
  fast_charger_type?: string | null;
  end_battery_level?: number | null;
}

/**
 * Legacy pre-SI energy-stats shape consumed by the insight analyzers. The
 * canonical native `EnergyStats` exposes `total_energy_used_wh`,
 * `total_distance_m`, and `avg_efficiency_wh_per_m`; the web source still reads
 * the legacy kWh/km field names reproduced here.
 */
interface EnergyStats {
  total_energy_used_kwh: number;
  total_distance_km: number;
  total_cost: number;
  co2_saved_kg: number;
  avg_efficiency_wh_km: number;
}

export interface InsightData {
  drives?: Drive[];
  chargingSessions?: ChargingSession[];
  energyStats?: EnergyStats;
  batteryReport?: BatteryReport;
  mileageStats?: MileageStats;
  vampireDrainStats?: VampireDrainStats;
}

type Severity = 'info' | 'success' | 'warning' | 'alert';
type Trend = 'up' | 'down' | 'neutral';

interface Insight {
  id: string;
  glyph: string;
  title: string;
  description: string;
  trend: Trend;
  trendGood: boolean;
  severity: Severity;
}

type FormatCurrency = (amount: number, decimals?: number) => string;

// ─── Inlined number formatting (from @/lib/numberFormat) ───────

/** Default decimal precision — mirrors the web `_globalPrecision` floor of 2. */
const DEFAULT_PRECISION = 2;

/** Safe number extraction from unknown values; returns 0 for nullish/NaN. */
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Format a number with locale-aware separators, falling back to en-US on a bad
 * locale tag. Inlined verbatim from `@/lib/numberFormat` `fmtNumber`.
 */
function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

// ─── Severity → border colour ─────────────────────────────────

const SEVERITY_BORDER: Record<Severity, string> = {
  info: '#00f0ff',
  success: '#10b981',
  warning: '#f59e0b',
  alert: '#ef4444',
};

const TREND_GLYPH: Record<Trend, { glyph: string; color: string }> = {
  up: { glyph: 'UP', color: '#10b981' },
  down: { glyph: 'DN', color: '#ef4444' },
  neutral: { glyph: '>', color: colors.textSecondary },
};

/** Inlined verbatim from `@/lib/colors` `trendColor`. */
function trendColor(trend: string | undefined): string {
  if (trend === 'up') return '#ef4444';
  if (trend === 'down') return '#10b981';
  return '#6b7280';
}

// ─── Analysis helpers ─────────────────────────────────────────

function analyzeChargingCost(
  sessions: ChargingSession[],
  formatCurrency: FormatCurrency,
): Insight | null {
  const withCost = sessions.filter(
    s => s.cost != null && s.charge_energy_added > 0,
  );
  if (withCost.length < 2) return null;

  const supercharger = withCost.filter(s => s.fast_charger_type);
  const home = withCost.filter(s => !s.fast_charger_type);

  const avgCost = (arr: ChargingSession[]) => {
    const totalCost = arr.reduce((a, s) => a + (s.cost ?? 0), 0);
    const totalEnergy = arr.reduce((a, s) => a + s.charge_energy_added, 0);
    return totalEnergy > 0 ? totalCost / totalEnergy : 0;
  };

  const overall = avgCost(withCost);
  const homeCost = home.length > 0 ? avgCost(home) : null;
  const scCost = supercharger.length > 0 ? avgCost(supercharger) : null;

  let description = `Your average charging cost is ${formatCurrency(overall, 2)}/kWh.`;
  let trend: Trend = 'neutral';
  let trendGood = true;

  if (homeCost != null && scCost != null && scCost > 0) {
    const savings = ((scCost - homeCost) / scCost) * 100;
    if (savings > 0) {
      description += ` Home charging saves you ${fmtNumber(savings, 0)}% compared to Supercharging.`;
      trend = 'up';
    } else {
      description += ` Your home electricity rate is higher than Supercharger rates — consider off-peak charging.`;
      trend = 'down';
      trendGood = false;
    }
  }

  return {
    id: 'charging-cost',
    glyph: '$',
    title: 'Charging Cost',
    description,
    trend,
    trendGood,
    severity: 'info',
  };
}

function analyzeEfficiencyTrend(drives: Drive[]): Insight | null {
  const valid = drives.filter(
    d => d.distance_m > 0 && d.energy_used_wh != null,
  );
  if (valid.length < 4) return null;

  const half = Math.floor(valid.length / 2);
  const efficiency = (arr: Drive[]) => {
    const totalDist = arr.reduce((a, d) => a + d.distance_m, 0);
    const totalEnergy = arr.reduce((a, d) => a + (d.energy_used_wh ?? 0), 0);
    return totalDist > 0 ? (totalEnergy / totalDist) * 1000 : 0;
  };

  const recent = efficiency(valid.slice(0, half));
  const older = efficiency(valid.slice(half));

  if (older === 0) return null;
  const changePct = ((older - recent) / older) * 100;

  const improved = changePct > 0;
  const magnitude = fmtNumber(Math.abs(changePct), 1);

  return {
    id: 'efficiency-trend',
    glyph: 'ZP',
    title: 'Efficiency Trend',
    description: improved
      ? `Your driving efficiency improved ${magnitude}% in recent drives compared to earlier drives. Keep up the smooth driving!`
      : `Your driving efficiency decreased ${magnitude}% in recent drives. Consider gentler acceleration and highway cruise control.`,
    trend: improved ? 'up' : 'down',
    trendGood: improved,
    severity: improved ? 'success' : 'warning',
  };
}

function analyzeBatteryHealth(report: BatteryReport): Insight | null {
  if (!report.health_score) return null;

  const healthPct = report.current_capacity_pct;
  const degradation = report.degradation_pct;
  const trend = report.monthly_trend;

  let agingQuality = 'as expected';
  let severity: Severity = 'success';
  if (degradation > 10) {
    agingQuality = 'worse than average';
    severity = 'warning';
  } else if (degradation < 5) {
    agingQuality = 'better than average';
  }

  let yearlyRate = degradation;
  if (trend.length >= 2) {
    const first = trend[0]?.capacity_pct ?? 0;
    const last = trend[trend.length - 1]?.capacity_pct ?? 0;
    const months = trend.length;
    yearlyRate = months > 0 ? ((first - last) / months) * 12 : degradation;
  }

  return {
    id: 'battery-health',
    glyph: 'BT',
    title: 'Battery Health',
    description: `Battery health is at ${fmtNumber(healthPct, 1)}%. Degradation rate is ${fmtNumber(yearlyRate, 1)}% per year — your battery is aging ${agingQuality}.`,
    trend: degradation > 8 ? 'down' : 'up',
    trendGood: degradation <= 8,
    severity,
  };
}

function analyzeOptimalCharging(sessions: ChargingSession[]): Insight | null {
  const withEnd = sessions.filter(s => s.end_battery_level != null);
  if (withEnd.length < 3) return null;

  const avgEndLevel =
    withEnd.reduce((a, s) => a + s.end_battery_level!, 0) / withEnd.length;
  const above80 = withEnd.filter(s => s.end_battery_level! > 80).length;
  const above80Pct = (above80 / withEnd.length) * 100;

  let description = `You charge most often to ${fmtNumber(avgEndLevel, 0)}%.`;
  let severity: Severity = 'info';
  let trendGood = true;

  if (above80Pct > 50) {
    description += ` ${fmtNumber(above80Pct, 0)}% of your charges exceed 80%. For battery longevity, consider keeping charges between 20–80%.`;
    severity = 'warning';
    trendGood = false;
  } else {
    description += ` Great habit — most of your charges stay within the ideal 20–80% range for battery longevity.`;
    severity = 'success';
  }

  return {
    id: 'optimal-charging',
    glyph: 'BC',
    title: 'Optimal Charging',
    description,
    trend: trendGood ? 'up' : 'down',
    trendGood,
    severity,
  };
}

function analyzeVampireDrain(stats: VampireDrainStats): Insight | null {
  if (stats.event_count < 1) return null;

  const sentryDrain = stats.avg_sentry_drain;
  const noSentryDrain = stats.avg_nosentry_drain;

  if (sentryDrain <= 0 && noSentryDrain <= 0) return null;

  const diff = sentryDrain - noSentryDrain;
  const diffPct = noSentryDrain > 0 ? (diff / noSentryDrain) * 100 : 0;
  const dailyRangeLoss = sentryDrain * 24;

  let description: string;
  let severity: Severity = 'info';

  if (diffPct > 20) {
    description = `Sentry Mode increases battery drain by ${fmtNumber(diffPct, 0)}%. Consider disabling it at home to save ~${fmtNumber(dailyRangeLoss, 1)} km of range daily.`;
    severity = 'warning';
  } else {
    description = `Average vampire drain is ${fmtNumber(stats.avg_drain_rate, 2)} %/hr. Total range lost to idle drain: ${fmtNumber(stats.total_range_lost, 1)} km across ${stats.event_count} events.`;
  }

  return {
    id: 'vampire-drain',
    glyph: 'SH',
    title: 'Vampire Drain',
    description,
    trend: diffPct > 20 ? 'down' : 'neutral',
    trendGood: diffPct <= 20,
    severity,
  };
}

function analyzeDrivingPatterns(drives: Drive[]): Insight | null {
  if (drives.length < 3) return null;

  const totalDist = drives.reduce((a, d) => a + d.distance_m, 0);
  const dates = drives.map(d => new Date(d.start_ts));

  const daySpan =
    dates.length > 1
      ? (dates[0].getTime() - dates[dates.length - 1].getTime()) / 86_400_000
      : 1;
  const avgDaily = daySpan > 0 ? totalDist / Math.max(daySpan, 1) : totalDist;

  const dayNames = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const dayCounts = new Array(7).fill(0) as number[];
  const hourCounts = new Array(24).fill(0) as number[];

  dates.forEach(d => {
    dayCounts[d.getDay()]++;
    hourCounts[d.getHours()]++;
  });

  const busiestDay = dayNames[dayCounts.indexOf(Math.max(...dayCounts))];
  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
  const peakEnd = (peakHour + 1) % 24;

  return {
    id: 'driving-patterns',
    glyph: 'EV',
    title: 'Driving Patterns',
    description: `You drive an average of ${fmtNumber(avgDaily / 1000, 1)} km/day. Your most active day is ${busiestDay}. Peak driving time: ${peakHour}:00–${peakEnd}:00.`,
    trend: 'neutral',
    trendGood: true,
    severity: 'info',
  };
}

function analyzeCostSavings(
  energy: EnergyStats,
  formatCurrency: FormatCurrency,
): Insight | null {
  if (energy.total_energy_used_kwh <= 0) return null;

  // Average gas car: 8.5 L/100km, avg gas price ~$1.50/L
  const gasEquivalent = (energy.total_distance_km / 100) * 8.5 * 1.5;
  const evCost = energy.total_cost;
  const savings = gasEquivalent - evCost;

  if (savings <= 0) return null;

  return {
    id: 'cost-savings',
    glyph: 'LF',
    title: 'EV Cost Savings',
    description: `You've saved approximately ${formatCurrency(savings, 0)} vs. gasoline based on ${fmtNumber(energy.total_energy_used_kwh, 0)} kWh consumed over ${fmtNumber(energy.total_distance_km, 0)} km. That's also ${fmtNumber(energy.co2_saved_kg, 0)} kg of CO₂ saved!`,
    trend: 'up',
    trendGood: true,
    severity: 'success',
  };
}

function analyzeRangeOptimization(
  energy: EnergyStats,
  battery?: BatteryReport,
): Insight | null {
  if (energy.avg_efficiency_wh_km <= 0) return null;

  const effWhKm = energy.avg_efficiency_wh_km;
  const ratedRange = battery?.estimated_range_new_km ?? 500;
  const currentRange = battery?.estimated_range_current_km ?? ratedRange;

  // Nominal consumption ~150 Wh/km for base comparison
  const ratedEfficiency = 150;
  const effectiveRange = (ratedEfficiency / effWhKm) * currentRange;
  const rangePct = currentRange > 0 ? (effectiveRange / currentRange) * 100 : 100;

  return {
    id: 'range-optimization',
    glyph: 'CK',
    title: 'Range Optimization',
    description: `At your average efficiency of ${fmtNumber(effWhKm, 0)} Wh/km, your effective range is ~${fmtNumber(effectiveRange, 0)} km (${fmtNumber(rangePct, 0)}% of rated range). ${
      rangePct < 85
        ? 'Consider preconditioning and reducing highway speed for better range.'
        : 'Your driving style is range-efficient — great work!'
    }`,
    trend: rangePct >= 90 ? 'up' : rangePct >= 80 ? 'neutral' : 'down',
    trendGood: rangePct >= 80,
    severity: rangePct >= 90 ? 'success' : rangePct >= 80 ? 'info' : 'warning',
  };
}

// ─── Reduced-motion + FadeIn (parity for framer-motion FadeIn) ─

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

/**
 * Mirrors the web `<FadeIn delay>` (framer-motion): opacity 0->1 with a
 * translateY 12->0 slide over 400ms easeOut after an optional delay. When the
 * user prefers reduced motion the children render in their final state with no
 * entry animation.
 */
function FadeIn({
  children,
  delayMs = 0,
}: {
  children: ReactNode;
  delayMs?: number;
}) {
  const reduce = useReduceMotion();
  const progress = useRef(new Animated.Value(reduce ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 400,
      delay: delayMs,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [delayMs, progress, reduce]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [12, 0],
            }),
          },
        ],
      }}>
      {children}
    </Animated.View>
  );
}

// ─── Cards ────────────────────────────────────────────────────

function InsightCard({ insight }: { insight: Insight }) {
  const borderColor = SEVERITY_BORDER[insight.severity];
  const { glyph: trendGlyph, color: trendClr } = insight.trendGood
    ? TREND_GLYPH[insight.trend]
    : {
        glyph: TREND_GLYPH[insight.trend].glyph,
        color: trendColor(insight.trend),
      };

  return (
    <GlassPanel
      accessibilityLabel={insight.title}
      accessible
      style={[
        styles.card,
        { borderLeftColor: borderColor, borderLeftWidth: 3 },
      ]}
      testID={`insight-${insight.id}`}>
      <View style={styles.cardRow}>
        <View style={[styles.iconBox, { backgroundColor: `${borderColor}15` }]}>
          <AppText
            style={[styles.iconGlyph, { color: borderColor }]}
            variant="caption"
            weight="bold">
            {insight.glyph}
          </AppText>
        </View>

        <View style={styles.cardContent}>
          <View style={styles.titleRow}>
            <AppText
              numberOfLines={1}
              style={styles.title}
              weight="semibold">
              {insight.title}
            </AppText>
            <AppText
              style={[styles.trendGlyph, { color: trendClr }]}
              variant="caption"
              weight="bold">
              {trendGlyph}
            </AppText>
          </View>
          <AppText style={styles.description} tone="secondary" variant="caption">
            {insight.description}
          </AppText>
        </View>
      </View>
    </GlassPanel>
  );
}

// ─── Main component ───────────────────────────────────────────

export function InsightsEngine({ data }: { data: InsightData }) {
  const { data: settings } = useSettings();

  const formatCurrency = useCallback<FormatCurrency>(
    (amount, decimals) => {
      const symbol =
        settings?.currency_symbol && settings.currency_symbol.trim()
          ? settings.currency_symbol
          : '$';
      const userPrecision =
        typeof settings?.decimal_precision === 'number' &&
        Number.isFinite(settings.decimal_precision) &&
        settings.decimal_precision >= 0
          ? Math.floor(settings.decimal_precision)
          : 2;
      const d = decimals ?? userPrecision;
      return `${symbol}${fmtNumber(amount, d)}`;
    },
    [settings?.currency_symbol, settings?.decimal_precision],
  );

  const insights = useMemo(() => {
    const results: Insight[] = [];

    if (data.chargingSessions?.length) {
      const c = analyzeChargingCost(data.chargingSessions, formatCurrency);
      if (c) results.push(c);
    }
    if (data.drives?.length) {
      const e = analyzeEfficiencyTrend(data.drives);
      if (e) results.push(e);
    }
    if (data.batteryReport) {
      const b = analyzeBatteryHealth(data.batteryReport);
      if (b) results.push(b);
    }
    if (data.chargingSessions?.length) {
      const o = analyzeOptimalCharging(data.chargingSessions);
      if (o) results.push(o);
    }
    if (data.vampireDrainStats) {
      const v = analyzeVampireDrain(data.vampireDrainStats);
      if (v) results.push(v);
    }
    if (data.drives?.length) {
      const p = analyzeDrivingPatterns(data.drives);
      if (p) results.push(p);
    }
    if (data.energyStats) {
      const s = analyzeCostSavings(data.energyStats, formatCurrency);
      if (s) results.push(s);
    }
    if (data.energyStats) {
      const r = analyzeRangeOptimization(
        data.energyStats,
        data.batteryReport ?? undefined,
      );
      if (r) results.push(r);
    }

    return results;
  }, [data, formatCurrency]);

  if (insights.length === 0) return null;

  return (
    <FadeIn delayMs={150}>
      <View style={styles.root} testID="insights-engine">
        <View style={styles.headerRow}>
          <AppText
            style={styles.headerGlyph}
            variant="caption"
            weight="bold">
            LB
          </AppText>
          <AppText style={styles.headerTitle} weight="semibold">
            Smart Insights
          </AppText>
        </View>

        <View style={styles.grid}>
          {insights.map(insight => (
            <InsightCard insight={insight} key={insight.id} />
          ))}
        </View>
      </View>
    </FadeIn>
  );
}

InsightsEngine.displayName = 'InsightsEngine';

const styles = StyleSheet.create({
  card: {
    flexBasis: 260,
    flexGrow: 1,
    padding: 16,
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
  },
  cardRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
  description: {
    lineHeight: 18,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  headerGlyph: {
    color: colors.warning,
    letterSpacing: 0.4,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  iconBox: {
    alignItems: 'center',
    borderRadius: 8,
    flexShrink: 0,
    justifyContent: 'center',
    padding: 8,
  },
  iconGlyph: {
    letterSpacing: 0.4,
  },
  root: {
    gap: 16,
  },
  title: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  trendGlyph: {
    letterSpacing: 0.4,
  },
});
