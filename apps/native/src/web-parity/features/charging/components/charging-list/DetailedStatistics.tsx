// Native parity port of
// web/src/features/charging/components/charging-list/DetailedStatistics.tsx.
//
// The charging-list "Detailed Statistics" GlassPanel: a TrendingUp + title
// heading followed by a responsive 6-stat grid (web: 2-col mobile / 3-col sm /
// 6-col md) of total sessions, avg duration, avg power, top charger,
// total cost, and avg $/kWh.
//
// React Native has no DOM, lucide-react, Recharts, Tailwind, or the web
// data-display/ui components, so the web tree is reproduced with native
// View/AppText/GlassPanel layers that preserve the same data, copy, units,
// number/currency formatting, and proportional intent.
//
// Self-contained native adaptations (documented in the sidecar):
//   - @/components/ui GlassPanel -> the shared native GlassPanel; the `p-5`
//     padding collapses to a StyleSheet entry (20px).
//   - lucide-react <TrendingUp className="h-4 w-4 text-neon-cyan"/> is a small
//     inline decorative heading icon. The native SemanticIcon `trendUp` is a
//     boxed, success-green badge that would change the layout and drop the
//     source's cyan accent, so (matching the ChargingTab idiom that reduced
//     inline lucide heading icons) it becomes a lightweight inline accent
//     "↗" glyph in the same accent/cyan tone — visually equivalent at rest.
//   - @/components/data-display AnimatedNumber -> an inlined native
//     AnimatedNumber reproducing the exact ease-out-quad count-up (0 -> value
//     over `duration`s) with requestAnimationFrame + Date.now() (React Native
//     has no performance.now()), same decimals/prefix/suffix contract, cancelled
//     on unmount — the same idiom SavingsSlide used.
//   - @/components/data-display Currency -> an inlined native Currency that
//     renders `${symbol}${fmtNumber(value, precision)}` with the same
//     null/non-finite -> "—" fallback and precision contract. The web reads the
//     symbol from useFormatting(); the native port derives it from the
//     useSettings() query (currency_symbol, '$' fallback) — the FleetComparePage
//     idiom.
//   - @/lib/numberFormat fmtWithUnit / fmtNumber are inlined with the same
//     nullish/NaN -> 0 (safeNumber) guard and en-US grouping standing in for the
//     not-yet-ported global locale/precision settings (global default 2).
//   - ../ChargingSessionCard formatDuration (a re-export of
//     @/lib/dateFormat.formatDurationMinutes) is inlined verbatim: "—" for
//     invalid/negative, "{h}h {m}m" / "{m}m" otherwise.
//   - ./helpers ChargingStats / EnhancedStats are inlined because the native
//     ./helpers module is not yet a converted target (the same idiom
//     TimeToChargeSection used for its ./types import).
//   - text-purple-300 / text-amber-300 / text-emerald-300 have no exact token,
//     so the exact Tailwind -300 hues are used verbatim (the SavingsSlide idiom),
//     matching the engineering "toned-down" colour map.
//   - react-i18next useTranslation -> a native English-default `t` keeping every
//     charging.stats.* key verbatim.
//
// No DOM, lucide-react, Recharts, Leaflet, framer-motion, or old web UI
// components are imported.

import React, {useEffect, useRef, useState} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';

/* ─── Inlined types (web ./helpers ChargingStats / EnhancedStats) ─────────── */

interface ChargingStats {
  totalEnergy: number;
  totalCost: number;
  totalDuration: number;
  avgPower: number;
  avgCostPerKwh: number;
  homeCount: number;
  scCount: number;
  dcCount: number;
  count: number;
}

interface EnhancedStats {
  avgDuration: number;
  mostCommonType: [string, number];
}

/* ─── Native i18n fallback (mirrors i18next default-value behaviour) ──────── */

// react-i18next is not wired in native; i18next returns the supplied default
// when a translation is missing, so this fallback returns the English default
// while keeping every charging.stats.* key verbatim.
function t(_key: string, fallback: string): string {
  return fallback;
}

/* ─── Numeric helpers (mirror web @/lib/numberFormat + null safety) ───────── */

// Mirrors web lib/numberFormat.isFiniteNumber.
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

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

// Mirrors web lib/numberFormat.fmtWithUnit -> `${fmtNumber(v, decimals)} ${unit}`.
function fmtWithUnit(v: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(v, decimals)} ${unit}`;
}

/* ─── Duration helper (web @/lib/dateFormat.formatDurationMinutes) ────────── */

const DURATION_FALLBACK = '—';

// Mirrors web lib/dateFormat.formatRoundedInt (en-US, 0 fraction digits).
function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// Verbatim port of web lib/dateFormat.formatDurationMinutes, which
// ../ChargingSessionCard re-exports as `formatDuration`.
function formatDuration(
  minutes: number | null | undefined,
  options: {subMinuteLabel?: string} = {},
): string {
  if (!isFiniteNumber(minutes) || minutes < 0) {
    return DURATION_FALLBACK;
  }
  if (options.subMinuteLabel && minutes < 1) {
    return options.subMinuteLabel;
  }
  const h = Math.floor(minutes / 60);
  const m = formatRoundedInt(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ─── Source colours (web text-purple-300 / amber-300 / emerald-300) ──────── */

// Exact Tailwind -300 hues — no token equivalent — used verbatim like the
// SavingsSlide colour-coded values, matching the engineering "toned-down" map.
const PURPLE_300 = '#d8b4fe';
const AMBER_300 = '#fcd34d';
const EMERALD_300 = '#6ee7b7';

/* ─── Inlined native AnimatedNumber (web @/components/data-display) ────────── */

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
}

// Reproduces the web AnimatedNumber ease-out-quad count-up from 0 to `value`
// over `duration` seconds. Uses requestAnimationFrame + Date.now() because
// React Native has no performance.now(); the frame is cancelled on unmount.
function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  prefix,
  suffix,
  style,
}: AnimatedNumberProps): React.ReactElement {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = Date.now();
    const from = 0;
    const to = value;
    const durationMs = duration * 1000;

    function tick() {
      const elapsed = Date.now() - start;
      const progress = durationMs > 0 ? Math.min(elapsed / durationMs, 1) : 1;
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplay(from + (to - from) * eased);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [value, duration]);

  return (
    <AppText style={style}>
      {prefix}
      {fmtNumber(display, decimals)}
      {suffix}
    </AppText>
  );
}

/* ─── Inlined native Currency (web @/components/data-display format/Currency) ─ */

interface CurrencyProps {
  value?: number | null;
  precision?: number;
  symbol: string;
  fallback?: string;
  style?: StyleProp<TextStyle>;
}

// Renders the user's preferred symbol + the locale-formatted numeric portion,
// with the same null/undefined/NaN -> "—" fallback as the web component.
function Currency({
  value,
  precision = 2,
  symbol,
  fallback = '—',
  style,
}: CurrencyProps): React.ReactElement {
  if (value == null || !Number.isFinite(value)) {
    return <AppText style={style}>{fallback}</AppText>;
  }
  return <AppText style={style}>{`${symbol}${fmtNumber(value, precision)}`}</AppText>;
}

/* ─── Stat cell (web grid `<div>` value + label) ──────────────────────────── */

function StatCell({
  value,
  label,
}: {
  value: React.ReactNode;
  label: string;
}): React.ReactElement {
  return (
    <View style={styles.cell}>
      {value}
      <AppText tone="muted" style={styles.label}>
        {label}
      </AppText>
    </View>
  );
}

interface DetailedStatisticsProps {
  stats: ChargingStats;
  enhanced: EnhancedStats;
}

export function DetailedStatistics({
  stats,
  enhanced,
}: DetailedStatisticsProps): React.ReactElement {
  // Mirrors web useFormatting().currencySymbol (settings-derived, '$' fallback).
  const {data: settings} = useSettings();
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <AppText style={styles.titleIcon}>↗</AppText>
        <AppText weight="semibold" style={styles.title}>
          {t('charging.stats.detailedStatistics', 'Detailed Statistics')}
        </AppText>
      </View>

      <View style={styles.grid}>
        <StatCell
          value={
            <AnimatedNumber
              value={stats.count}
              style={[styles.statValue, styles.valuePrimary]}
            />
          }
          label={t('charging.stats.totalSessions', 'Total Sessions')}
        />
        <StatCell
          value={
            <AppText style={[styles.statValue, styles.valuePrimary]}>
              {formatDuration(enhanced.avgDuration)}
            </AppText>
          }
          label={t('charging.stats.avgDuration', 'Avg Duration')}
        />
        <StatCell
          value={
            <AppText style={[styles.statValue, styles.valuePurple]}>
              {fmtWithUnit(stats.avgPower, 'kW')}
            </AppText>
          }
          label={t('charging.stats.avgPower', 'Avg Power')}
        />
        <StatCell
          value={
            <AppText style={[styles.statValue, styles.valuePrimary]}>
              {enhanced.mostCommonType[0]}
            </AppText>
          }
          label={`${t('charging.stats.topCharger', 'Top Charger')} (${
            enhanced.mostCommonType[1]
          }×)`}
        />
        <StatCell
          value={
            <Currency
              value={stats.totalCost}
              symbol={currencySymbol}
              style={[styles.statValue, styles.valueAmber]}
            />
          }
          label={t('charging.stats.totalCost', 'Total Cost')}
        />
        <StatCell
          value={
            <Currency
              value={stats.avgCostPerKwh}
              precision={3}
              symbol={currencySymbol}
              style={[styles.statValue, styles.valueEmerald]}
            />
          }
          label={t('charging.stats.avgCostPerKwh', 'Avg $/kWh')}
        />
      </View>
    </GlassPanel>
  );
}

DetailedStatistics.displayName = 'DetailedStatistics';

const styles = StyleSheet.create({
  cell: {
    alignItems: 'center',
    flexBasis: '28%',
    flexGrow: 1,
    gap: 2,
    minWidth: 88,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  label: {
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },
  panel: {
    padding: 20,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    textAlign: 'center',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    letterSpacing: -0.4,
    lineHeight: 24,
  },
  titleIcon: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 18,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  valueAmber: {
    color: AMBER_300,
  },
  valueEmerald: {
    color: EMERALD_300,
  },
  valuePrimary: {
    color: colors.textPrimary,
  },
  valuePurple: {
    color: PURPLE_300,
  },
});
