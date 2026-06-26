/**
 * Native parity port of
 * web/src/features/charging/components/cost-analysis/LifetimeSummary.tsx.
 *
 * The web component is the Cost Analysis "Lifetime Summary" card: a cyan-glow
 * GlassPanel with a TrendingUp-iconed title and either (a) a responsive grid of
 * seven LifetimeMetric tiles (Total Spent, Total Energy, Total Sessions, Avg
 * Session Cost, Avg Energy / Session, Avg Duration, Free Sessions) when both
 * `lifetimeMetrics` and `coreStats` are present, or (b) a centered "No data"
 * empty state otherwise. This native port preserves that contract 1:1 using
 * React Native primitives + the existing native AppText / GlassPanel / tokens.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the .parity.json sidecar:
 *   - react-i18next `useTranslation` (web L1): native-safe `t(key, fallback)`
 *     shim returning the English fallback (else the key) — every i18n key kept.
 *   - `useFormatting` (web L2): the web hook derives the currency symbol +
 *     decimal precision from `useSettings()`; only `formatCurrency` is consumed
 *     here, so a scoped native `formatCurrency` is reproduced reading the same
 *     web-parity `useSettings()` query (currency_symbol / decimal_precision),
 *     defaulting to "$" / precision 2 exactly like the web hook.
 *   - lucide-react `TrendingUp` (web L3): DOM SVG icon → the established 📈 emoji
 *     glyph stand-in, rendered cyan-400 (#22d3ee) like the web `text-cyan-400`.
 *   - `@/components/ui` GlassPanel (web L4): GlassPanel → native GlassPanel; the
 *     web `glow="cyan"` (a hover-only, here-inert tint) is preserved as a subtle
 *     static cyan border tint — the established SummaryHeroCards glow convention.
 *   - `fmtNumber` / `fmtInt` / `fmtWithUnit` (web L5): ported from
 *     web/src/lib/numberFormat.ts (safeNumber → 0, en-US locale, min=max
 *     fraction digits; fmtWithUnit = `${fmtNumber(v, d)} ${unit}`).
 *   - `./types` `CoreStats` / `LifetimeMetrics` (web L6): reproduced locally as
 *     verbatim interface ports so the prop contract is byte-for-byte identical.
 */
import React, {useMemo, type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {useSettings} from '../../../../api/hooks/useSettings';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

// ── ported types (web ./types CoreStats / LifetimeMetrics) ───────────────────
export interface CoreStats {
  totalCost: number;
  totalEnergy: number;
  avgCostPerKwh: number;
  totalDuration: number;
  totalDistanceM: number;
  costPerDist: number;
  gasCost: number;
  savings: number;
  savingsPercent: number;
  co2SavedKg: number;
  treeEquiv: number;
  gallonsEquiv: number;
  count: number;
}

export interface LifetimeMetrics {
  avgSessionCost: number;
  avgSessionEnergy: number;
  avgDuration: number;
  freeCount: number;
  freeEnergy: number;
  maxSessionCost: number;
  minSessionCost: number;
}

interface LifetimeSummaryProps {
  lifetimeMetrics: LifetimeMetrics | null;
  coreStats: CoreStats | null;
}

// ── native-safe useTranslation (react-i18next has no native runtime) ─────────
type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

// ── number formatters (ported from web/src/lib/numberFormat.ts) ──────────────
function fmtNumber(value: unknown, decimals = 2): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

function fmtWithUnit(value: unknown, unit: string, decimals = 2): string {
  return `${fmtNumber(value, decimals)} ${unit}`;
}

// ── scoped native formatCurrency (web useFormatting → useSettings derivation) ─
function useFormatCurrency(): (amount: number, decimals?: number) => string {
  const {data: settings} = useSettings();
  const symbolRaw = settings?.currency_symbol;
  const currencySymbol = symbolRaw && symbolRaw.trim() ? symbolRaw : '$';
  const precisionRaw = settings?.decimal_precision;
  const userPrecision =
    typeof precisionRaw === 'number' &&
    Number.isFinite(precisionRaw) &&
    precisionRaw >= 0
      ? Math.floor(precisionRaw)
      : 2;

  return useMemo(
    () =>
      (amount: number, decimals?: number): string =>
        `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    [currencySymbol, userPrecision],
  );
}

// lucide-react `TrendingUp` (web L3) glyph stand-in, web `text-cyan-400`.
const GLYPH_TRENDING_UP = '📈';
const CYAN_400 = '#22d3ee';
// Web `bg-[var(--surface-2)]` (LifetimeMetric tile) — dark-theme value from
// web/src/index.css; the established StatusPill SURFACE_2 native mapping.
const SURFACE_2 = '#151621';

// ── LifetimeMetric (native-safe port of the web local tile component) ────────
function LifetimeMetric({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.tile}>
      <AppText
        style={styles.tileLabel}
        tone="muted"
        numberOfLines={1}>
        {label}
      </AppText>
      <AppText style={styles.tileValue} weight="semibold">
        {value}
      </AppText>
    </View>
  );
}

export function LifetimeSummary({
  lifetimeMetrics,
  coreStats,
}: LifetimeSummaryProps) {
  const t = useNativeTranslation();
  const formatCurrency = useFormatCurrency();

  let body: ReactNode;
  if (lifetimeMetrics && coreStats) {
    body = (
      <View style={styles.grid}>
        <LifetimeMetric
          label={t('costAnalysis.lifetime.totalSpent', 'Total Spent')}
          value={formatCurrency(coreStats.totalCost, 2)}
        />
        <LifetimeMetric
          label={t('costAnalysis.lifetime.totalEnergy', 'Total Energy')}
          value={fmtWithUnit(coreStats.totalEnergy, 'kWh', 1)}
        />
        <LifetimeMetric
          label={t('costAnalysis.lifetime.totalSessions', 'Total Sessions')}
          value={fmtInt(coreStats.count)}
        />
        <LifetimeMetric
          label={t('costAnalysis.lifetime.avgSessionCost', 'Avg Session Cost')}
          value={formatCurrency(lifetimeMetrics.avgSessionCost, 2)}
        />
        <LifetimeMetric
          label={t('costAnalysis.lifetime.avgEnergy', 'Avg Energy / Session')}
          value={fmtWithUnit(lifetimeMetrics.avgSessionEnergy, 'kWh', 1)}
        />
        <LifetimeMetric
          label={t('costAnalysis.lifetime.avgDuration', 'Avg Duration')}
          value={`${fmtNumber(lifetimeMetrics.avgDuration, 0)} min`}
        />
        <LifetimeMetric
          label={t('costAnalysis.lifetime.freeSessions', 'Free Sessions')}
          value={`${fmtInt(lifetimeMetrics.freeCount)} (${fmtWithUnit(
            lifetimeMetrics.freeEnergy,
            'kWh',
            1,
          )})`}
        />
      </View>
    );
  } else {
    body = (
      <View style={styles.emptyState}>
        <AppText style={styles.emptyText} tone="muted">
          {t('costAnalysis.lifetime.noData', 'No data')}
        </AppText>
      </View>
    );
  }

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <AppText style={styles.titleIcon}>{GLYPH_TRENDING_UP}</AppText>
        <AppText style={styles.titleText} weight="semibold">
          {t('costAnalysis.lifetime.title', 'Lifetime Summary')}
        </AppText>
      </View>
      {body}
    </GlassPanel>
  );
}

LifetimeSummary.displayName = 'LifetimeSummary';

const styles = StyleSheet.create({
  panel: {
    padding: spacing.md + 4, // p-4 (16px)
    // web glow="cyan" (hover-only, here inert) → subtle static cyan border tint.
    borderColor: colors.borderAccent,
  },
  titleRow: {
    alignItems: 'center',
    columnGap: spacing.sm, // gap-2 (8px)
    flexDirection: 'row',
    marginBottom: spacing.md + 4, // mb-4 (16px)
  },
  titleIcon: {
    color: CYAN_400, // text-cyan-400
    fontSize: 16, // h-4 w-4
  },
  titleText: {
    fontSize: 14, // text-sm
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between', // grid-cols-2 with gap-3 spacing between
    rowGap: spacing.md, // gap-3 (12px) between wrapped rows
  },
  tile: {
    backgroundColor: SURFACE_2, // bg-[var(--surface-2)]
    borderRadius: 8, // rounded-lg
    padding: spacing.md, // p-3 (12px)
    width: '48%', // grid-cols-2 (two columns)
  },
  tileLabel: {
    fontSize: 10, // text-[10px]
  },
  tileValue: {
    fontSize: 14, // text-sm
    marginTop: 2, // mt-0.5
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 128, // h-32
  },
  emptyText: {
    fontSize: 14, // text-sm
  },
});
