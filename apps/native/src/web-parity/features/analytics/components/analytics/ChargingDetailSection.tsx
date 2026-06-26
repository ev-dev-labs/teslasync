// Native parity port of
// web/src/features/analytics/components/analytics/ChargingDetailSection.tsx.
//
// Preserves the four-panel charging analytics layout (Charger Brands
// leaderboard, Monthly Charging Trend chart, Cost Analysis cards, Cost by
// Charger Type bars), the `data?.charging_analytics` derivation chain, the
// `brandLeaderboard` useMemo, the `safe()`/`fmtInt()` null handling, the
// formatCurrency contract, and every i18n key/fallback.
//
// The web stack has no native equivalents wired into this parity tree, so:
//   - GlassPanel/MetricCard/EmptyState web UI -> native shared components.
//   - lucide-react DollarSign -> a tone-coloured indicator dot (the "$" is
//     already produced by formatCurrency).
//   - Recharts ComposedChart (Area energy + Line avg_power + Bar sessions,
//     dual Y axes, Tooltip, Legend) -> the AreaChartWrapper parity sibling,
//     which flattens to a single native domain with a latest-value summary
//     because hover tooltips and dual axes are unavailable in React Native.
//   - useTranslation / useFormatting -> native-safe fallbacks.
// See the .parity.json sidecar for the line-by-line source map.

import React, {useCallback, useMemo} from 'react';
import {StyleSheet, View, type DimensionValue} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import type {FleetAnalytics} from '../../../../api/types';
import {AreaChartWrapper} from '../../../../components/charts/AreaChartWrapper';
import {CHART_COLORS, safe} from '../../../../components/charts/chartUtils';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

// ---- Native-safe number + currency formatting ------------------------------
// Ported from web/src/lib/numberFormat.ts (fmtNumber/fmtInt) and the
// useFormatting().formatCurrency contract:
// `${currencySymbol}${fmtNumber(amount, decimals)}` with the web no-settings
// defaults (currency symbol '$', precision 2, locale en-US).

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;
const DEFAULT_CURRENCY_SYMBOL = '$';

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = DEFAULT_PRECISION): string {
  try {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toFixed(decimals);
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

function formatCurrency(amount: number, decimals = DEFAULT_PRECISION): string {
  return `${DEFAULT_CURRENCY_SYMBOL}${fmtNumber(amount, decimals)}`;
}

// ---- Local presentational helpers ------------------------------------------
// SectionTitle ports web/src/features/analytics/components/analytics/helpers.tsx
// (text-sm font-semibold text-[var(--text-primary)]).

function SectionTitle({children}: {children: React.ReactNode}) {
  return (
    <AppText weight="semibold" style={styles.sectionTitle}>
      {children}
    </AppText>
  );
}

type CostTone = 'green' | 'cyan' | 'purple' | 'amber';

const COST_TONE_COLOR: Record<CostTone, string> = {
  green: colors.success,
  cyan: colors.accent,
  purple: colors.violet,
  amber: colors.warning,
};

// Native stand-in for the web MetricCard (label + DollarSign icon + value +
// colour). The tone-coloured dot represents the icon accent; formatCurrency
// supplies the "$".
function CostCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: CostTone;
}) {
  return (
    <View style={styles.costCard}>
      <View style={styles.costCardHeader}>
        <View style={[styles.costDot, {backgroundColor: COST_TONE_COLOR[tone]}]} />
        <AppText
          variant="caption"
          tone="muted"
          weight="semibold"
          numberOfLines={1}
          style={styles.costLabel}>
          {label}
        </AppText>
      </View>
      <AppText variant="title" weight="bold">
        {value}
      </AppText>
    </View>
  );
}

// ---- Component --------------------------------------------------------------

export function ChargingDetailSection({
  data,
}: {
  data: FleetAnalytics | undefined;
}) {
  const t = useNativeTranslationFallback();

  const ca = data?.charging_analytics;
  const chargerTypes = ca?.charger_types ?? [];
  const monthlyTrend = ca?.monthly_trend ?? [];
  const costStats = ca?.cost_stats;

  // `brands` is derived inside the memo (depending on the stable `ca`) so the
  // per-render `?? []` literal does not retrigger the hook -- behaviour matches
  // the web `const brands = ca?.charger_brands ?? []` + `[brands]` memo.
  const brandLeaderboard = useMemo(() => {
    const brands = ca?.charger_brands ?? [];
    const maxCount = brands.reduce((m, b) => Math.max(m, safe(b.count)), 0) || 1;
    return brands.map(b => ({...b, pct: (safe(b.count) / maxCount) * 100}));
  }, [ca]);

  // Recharts Area (energy) + Line (avg_power) + Bar (sessions) -> three native
  // series. The web dual Y axes (energy/sessions left, avg_power right) flatten
  // to AreaChartWrapper's single native domain.
  const monthlySeries = useMemo(
    () => [
      {
        key: 'energy',
        label: t('analytics.charging.energykWh', 'Energy (kWh)'),
        color: CHART_COLORS[1],
      },
      {
        key: 'avg_power',
        label: t('analytics.charging.avgPowerkW', 'Avg Power (kW)'),
        color: CHART_COLORS[3],
      },
      {
        key: 'sessions',
        label: t('analytics.charging.sessions', 'Sessions'),
        color: CHART_COLORS[2],
      },
    ],
    [t],
  );

  return (
    <View style={styles.root}>
      {/* Charger Brands */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.charging.chargerBrands', 'Charger Brands')}
        </SectionTitle>
        {brandLeaderboard.length > 0 ? (
          <View style={styles.list}>
            {brandLeaderboard.map((b, idx) => (
              <View key={b.brand}>
                <View style={styles.barRow}>
                  <AppText variant="caption" weight="semibold" style={styles.barLabel}>
                    #{idx + 1} {b.brand}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {fmtInt(b.count)}{' '}
                    {t('analytics.charging.sessions', 'sessions')}
                  </AppText>
                </View>
                <View style={styles.brandTrack}>
                  <View
                    style={[styles.brandFill, {width: `${b.pct}%` as DimensionValue}]}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            title={t('analytics.charging.empty', 'No data')}
            message={t('analytics.charging.noBrands', 'No charger brand data')}
          />
        )}
      </GlassPanel>

      {/* Monthly Charging Trend */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.charging.monthlyTrend', 'Monthly Charging Trend')}
        </SectionTitle>
        {monthlyTrend.length > 0 ? (
          <AreaChartWrapper
            data={monthlyTrend}
            xKey="month"
            series={monthlySeries}
            height={300}
            yFormatter={value => fmtNumber(value, 1)}
          />
        ) : (
          <EmptyState
            title={t('analytics.charging.empty', 'No data')}
            message={t('analytics.charging.noMonthly', 'No monthly data')}
          />
        )}
      </GlassPanel>

      {/* Cost Analysis Cards */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.charging.costAnalysis', 'Cost Analysis')}
        </SectionTitle>
        {costStats ? (
          <View style={styles.costGrid}>
            <CostCard
              label={t('analytics.charging.minCost', 'Min Cost')}
              value={formatCurrency(safe(costStats.min), 2)}
              tone="green"
            />
            <CostCard
              label={t('analytics.charging.avgCost', 'Avg Cost')}
              value={formatCurrency(safe(costStats.avg), 2)}
              tone="cyan"
            />
            <CostCard
              label={t('analytics.charging.medianCost', 'Median Cost')}
              value={formatCurrency(safe(costStats.median), 2)}
              tone="purple"
            />
            <CostCard
              label={t('analytics.charging.maxCost', 'Max Cost')}
              value={formatCurrency(safe(costStats.max), 2)}
              tone="amber"
            />
          </View>
        ) : (
          <EmptyState
            title={t('analytics.charging.empty', 'No data')}
            message={t('analytics.charging.noCostStats', 'No cost statistics')}
          />
        )}
      </GlassPanel>

      {/* Cost by Charger Type */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.charging.costByType', 'Cost by Charger Type')}
        </SectionTitle>
        {chargerTypes.length > 0 ? (
          <View style={styles.list}>
            {chargerTypes.map((ct, i) => {
              const totalSessions = chargerTypes.reduce(
                (s, x) => s + safe(x.count),
                0,
              );
              const pct =
                totalSessions > 0 ? (safe(ct.count) / totalSessions) * 100 : 0;
              return (
                <View key={i} style={styles.typeRow}>
                  <AppText
                    variant="caption"
                    weight="semibold"
                    tone="secondary"
                    numberOfLines={1}
                    style={styles.typeLabel}>
                    {ct.type}
                  </AppText>
                  <View style={styles.typeTrack}>
                    <View
                      style={[
                        styles.typeFill,
                        {
                          width: `${pct}%` as DimensionValue,
                          backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                        },
                      ]}
                    />
                  </View>
                  <AppText variant="caption" style={styles.typeValue}>
                    {safe(ct.count)} ({fmtInt(pct)}%)
                  </AppText>
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyState
            title={t('analytics.charging.empty', 'No data')}
            message={t(
              'analytics.charging.noCostByType',
              'No charger type data',
            )}
          />
        )}
      </GlassPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  list: {
    gap: spacing.md,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  barLabel: {
    color: colors.textPrimary,
  },
  brandTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  brandFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.success,
  },
  costGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  costCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 140,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
    gap: spacing.xs,
  },
  costCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  costDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  costLabel: {
    flex: 1,
    minWidth: 0,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  typeLabel: {
    width: 112,
    textAlign: 'right',
  },
  typeTrack: {
    flex: 1,
    height: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  typeFill: {
    height: '100%',
    borderRadius: 999,
  },
  typeValue: {
    width: 80,
    textAlign: 'right',
    fontFamily: 'monospace',
    color: colors.textPrimary,
  },
});
