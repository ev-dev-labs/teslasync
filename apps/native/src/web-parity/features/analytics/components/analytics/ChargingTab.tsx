// Native parity port of
// web/src/features/analytics/components/analytics/ChargingTab.tsx.
//
// The Charging analytics tab: a 6-up summary MetricCard grid (Sessions, Total
// Energy, Total Cost, Avg Power, Avg Duration, Charge Efficiency) followed by
// three Recharts visualisations — a Charger Types donut (PieChart), a Start
// Battery Distribution BarChart, and an Hourly Charging Pattern ComposedChart
// (Bar charges + Line energy on a dual axis) — and finally the
// <ChargingDetailSection> (Charger Brands leaderboard, Monthly Charging Trend
// ComposedChart, Cost Analysis MetricCards, Cost by Charger Type bars).
//
// React Native has no DOM/SVG Recharts backend, so every Recharts tree
// (PieChart/Pie/Cell, BarChart/Bar, ComposedChart/Bar/Line/Area, plus
// XAxis/YAxis/Tooltip/Legend/ResponsiveContainer) is reproduced with native
// View/AppText layers that preserve each chart's data keys, colour mapping and
// proportional intent (the same idiom as the converted XRayBucketChart /
// ChartSummary charts): a colour-swatch legend breakdown for the donut,
// proportional horizontal bars for the distributions, and dual labelled bars
// per hour/month for the composed charts. The accessible numeric values stay
// visible alongside every bar.
//
// Self-contained native adaptations (documented in the sidecar):
//   - @/components/ui GlassPanel + @/components/data-display MetricCard +
//     @/components/feedback EmptyState -> the shared native GlassPanel /
//     MetricCard / EmptyState / AppText against the theme tokens. Native
//     MetricCard has no icon slot, so the lucide-react icons (Plug/Zap/
//     DollarSign/Gauge/Timer/TrendingUp) are dropped; the web subtitle becomes
//     the MetricCard `helper`, and the web `color` maps onto the native `tone`
//     (cyan -> accent, every other hue -> neutral, since native exposes only
//     accent/danger/neutral).
//   - @/hooks/useFormatting.formatCurrency -> an inlined native formatter using
//     the web default currency symbol "$" and precision 2 (the user
//     settings/currency wiring is not ported on native yet).
//   - @/lib/numberFormat fmtNumber/fmtInt and @/components/charts `safe` ->
//     inlined locale formatters with the same nullish/NaN -> 0 semantics.
//   - react-i18next useTranslation -> a native key/English-default fallback `t`
//     preserving every analytics.charging.* key + default verbatim.
//   - ./helpers SectionTitle, ./constants PIE_COLORS and ./ChargingDetailSection
//     are inlined here because their native modules are not yet converted
//     targets; CHART_COLORS is the web CB-safe Okabe-Ito palette verbatim.
//   - FleetAnalytics is inlined as the subset of fields this tab reads.
//   - <FadeIn> is a presentation-only entrance animation with no native
//     equivalent yet, so the container renders statically.
//
// No DOM, Recharts, Leaflet, lucide-react, or old web UI components are imported.

import React, {useMemo, type ReactNode} from 'react';
import {StyleSheet, View, type DimensionValue} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {MetricCard} from '../../../../../components/ui/MetricCard';
import {colors, spacing} from '../../../../../theme/tokens';

/* ─── Inlined types (subset of web @/api/types.FleetAnalytics) ──────────── */

interface StatsSummary {
  min: number;
  max: number;
  avg: number;
  median: number;
  p95: number;
  count: number;
}

interface ChargingAnalytics {
  hourly_pattern: {hour: number; charges: number; energy: number}[];
  charger_types: {type: string; count: number}[];
  charger_brands: {brand: string; count: number}[];
  monthly_trend: {
    month: string;
    energy: number;
    cost: number;
    sessions: number;
    avg_power: number;
    gas_cost: number;
    savings: number;
  }[];
  power_stats: StatsSummary;
  duration_stats: StatsSummary;
  energy_stats: StatsSummary;
  cost_stats: StatsSummary;
  start_battery_dist: {range: string; count: number}[];
  efficiency_stats: StatsSummary;
}

interface FleetAnalytics {
  total_charging_sessions: number;
  total_energy_kwh: number;
  total_cost: number;
  charging_analytics: ChargingAnalytics;
}

/* ─── Inlined helpers (mirror web lib/numberFormat + charts `safe`) ─────── */

type TFunc = (key: string, fallback: string) => string;

// react-i18next is not wired in native; i18next returns the supplied default
// when a translation is missing, so the fallback returns the English default
// while keeping every analytics.charging.* key verbatim in source.
const t: TFunc = (_key, fallback) => fallback;

// Mirrors web @/components/charts `safe`: nullish / non-finite -> 0.
const safe = (v: unknown): number =>
  typeof v === 'number' && isFinite(v) ? v : 0;

// Mirrors web lib/numberFormat.fmtNumber with an explicit precision (every
// call site passes one). en-US grouping stands in for the not-yet-ported
// global locale; nullish / non-finite -> 0.
function fmtNumber(v: unknown, decimals = 2): string {
  const n = safe(v);
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

// Mirrors web useFormatting().formatCurrency: `${symbol}${fmtNumber(amount,d)}`.
// User currency/precision settings are not wired on native, so the web defaults
// (symbol "$", precision 2) are used.
function formatCurrency(amount: number, decimals = 2): string {
  return `$${fmtNumber(amount, decimals)}`;
}

// Web @/lib/colors CHART_COLORS (CB-safe Okabe-Ito palette) verbatim.
const CHART_COLORS = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#F0E442',
  '#56B4E9',
  '#D55E00',
  '#CC79A7',
  '#4B4B4B',
] as const;

// Web ./constants PIE_COLORS = CHART_COLORS[0..5].
const PIE_COLORS = [
  CHART_COLORS[0],
  CHART_COLORS[1],
  CHART_COLORS[2],
  CHART_COLORS[3],
  CHART_COLORS[4],
  CHART_COLORS[5],
];

// Native MetricCard exposes only accent/danger/neutral; the web `color` hues
// collapse to accent (cyan) or neutral.
function toneFor(color: string): 'accent' | 'danger' | 'neutral' {
  return color === 'cyan' ? 'accent' : 'neutral';
}

/* ─── Shared native chart primitives (replace Recharts SVG) ────────────── */

// Web ./helpers SectionTitle: text-sm font-semibold text-[var(--text-primary)].
function SectionTitle({children}: {children: ReactNode}) {
  return (
    <AppText weight="semibold" style={styles.sectionTitle}>
      {children}
    </AppText>
  );
}

function ProportionBar({pct, color}: {pct: number; color: string}) {
  const width = `${Math.max(Math.min(pct, 100), 0)}%` as DimensionValue;
  return (
    <View style={styles.track}>
      <View style={[styles.fill, {width, backgroundColor: color}]} />
    </View>
  );
}

function ChartLegend({items}: {items: {label: string; color: string}[]}) {
  return (
    <View style={styles.legend}>
      {items.map(item => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.legendDot, {backgroundColor: item.color}]} />
          <AppText variant="caption" tone="secondary">
            {item.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

// Native stand-in for the Recharts PieChart/Pie/Cell donut: a colour-swatch
// breakdown preserving nameKey="type", dataKey="count" and the PIE_COLORS map.
function DonutBreakdown({
  data,
  palette,
}: {
  data: {type: string; count: number}[];
  palette: string[];
}) {
  const total = data.reduce((sum, d) => sum + safe(d.count), 0);
  return (
    <View style={styles.list}>
      {data.map((d, i) => {
        const pct = total > 0 ? (safe(d.count) / total) * 100 : 0;
        const color = palette[i % palette.length];
        return (
          <View key={`${d.type}-${i}`} style={styles.stackRow}>
            <View style={styles.inlineHead}>
              <View style={[styles.swatch, {backgroundColor: color}]} />
              <AppText
                variant="caption"
                style={styles.flexLabel}
                numberOfLines={1}>
                {d.type}
              </AppText>
              <AppText variant="caption" tone="secondary">
                {fmtInt(d.count)} ({fmtInt(pct)}%)
              </AppText>
            </View>
            <ProportionBar pct={pct} color={color} />
          </View>
        );
      })}
    </View>
  );
}

// Native stand-in for the Recharts BarChart (range -> count).
function DistributionBars({
  data,
  color,
}: {
  data: {range: string; count: number}[];
  color: string;
}) {
  const max = data.reduce((m, d) => Math.max(m, safe(d.count)), 0) || 1;
  return (
    <View style={styles.list}>
      {data.map((d, i) => (
        <View key={`${d.range}-${i}`} style={styles.row}>
          <AppText
            variant="caption"
            tone="secondary"
            style={styles.rowLabel}
            numberOfLines={1}>
            {d.range}
          </AppText>
          <ProportionBar pct={(safe(d.count) / max) * 100} color={color} />
          <AppText variant="caption" weight="semibold" style={styles.rowValue}>
            {fmtInt(d.count)}
          </AppText>
        </View>
      ))}
    </View>
  );
}

// Native stand-in for the Recharts ComposedChart (Bar charges + Line energy on
// a dual axis): one row per hour with both series scaled to their own maxima.
function HourlyPatternBars({
  data,
}: {
  data: {hour: number; charges: number; energy: number}[];
}) {
  const maxCharges = data.reduce((m, d) => Math.max(m, safe(d.charges)), 0) || 1;
  const maxEnergy = data.reduce((m, d) => Math.max(m, safe(d.energy)), 0) || 1;
  return (
    <View style={styles.list}>
      <ChartLegend
        items={[
          {label: t('analytics.charging.charges', 'Charges'), color: CHART_COLORS[0]},
          {
            label: t('analytics.charging.energykWh', 'Energy (kWh)'),
            color: CHART_COLORS[3],
          },
        ]}
      />
      {data.map((d, i) => (
        <View key={`${d.hour}-${i}`} style={styles.dualOuter}>
          <AppText variant="caption" tone="muted" style={styles.hourLabel}>
            {`${d.hour}:00`}
          </AppText>
          <View style={styles.dualBars}>
            <View style={styles.dualRow}>
              <ProportionBar
                pct={(safe(d.charges) / maxCharges) * 100}
                color={CHART_COLORS[0]}
              />
              <AppText variant="caption" style={styles.dualValue}>
                {fmtInt(d.charges)}
              </AppText>
            </View>
            <View style={styles.dualRow}>
              <ProportionBar
                pct={(safe(d.energy) / maxEnergy) * 100}
                color={CHART_COLORS[3]}
              />
              <AppText variant="caption" style={styles.dualValue}>
                {fmtNumber(d.energy, 1)}
              </AppText>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

// Native stand-in for the ChargingDetailSection Monthly Trend ComposedChart
// (Area energy + Line avg_power + Bar sessions): one row per month preserving
// all three series.
function MonthlyTrendBars({
  data,
}: {
  data: {month: string; energy: number; avg_power: number; sessions: number}[];
}) {
  const maxEnergy = data.reduce((m, d) => Math.max(m, safe(d.energy)), 0) || 1;
  return (
    <View style={styles.list}>
      <ChartLegend
        items={[
          {
            label: t('analytics.charging.energykWh', 'Energy (kWh)'),
            color: CHART_COLORS[1],
          },
          {
            label: t('analytics.charging.avgPowerkW', 'Avg Power (kW)'),
            color: CHART_COLORS[3],
          },
          {label: t('analytics.charging.sessions', 'Sessions'), color: CHART_COLORS[2]},
        ]}
      />
      {data.map((d, i) => (
        <View key={`${d.month}-${i}`} style={styles.stackRow}>
          <View style={styles.spaceBetween}>
            <AppText variant="caption" weight="semibold">
              {d.month}
            </AppText>
            <AppText variant="caption" tone="secondary">
              {fmtInt(d.sessions)} {t('analytics.charging.sessions', 'sessions')}
            </AppText>
          </View>
          <ProportionBar
            pct={(safe(d.energy) / maxEnergy) * 100}
            color={CHART_COLORS[1]}
          />
          <View style={styles.metricRow}>
            <AppText variant="caption" tone="muted">
              {fmtNumber(d.energy, 1)} kWh
            </AppText>
            <AppText variant="caption" tone="muted">
              {fmtNumber(d.avg_power, 1)} kW
            </AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

/* ─── ChargingDetailSection (inlined web ./ChargingDetailSection) ───────── */

function ChargingDetailSection({data}: {data: FleetAnalytics | undefined}) {
  const ca = data?.charging_analytics;
  const chargerTypes = ca?.charger_types ?? [];
  const monthlyTrend = ca?.monthly_trend ?? [];
  const costStats = ca?.cost_stats;

  const brandLeaderboard = useMemo(() => {
    const brands = ca?.charger_brands ?? [];
    const maxCount = brands.reduce((m, b) => Math.max(m, safe(b.count)), 0) || 1;
    return brands.map(b => ({...b, pct: (safe(b.count) / maxCount) * 100}));
  }, [ca]);

  const totalTypeSessions = chargerTypes.reduce((s, x) => s + safe(x.count), 0);

  return (
    <>
      {/* Charger Brands */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.charging.chargerBrands', 'Charger Brands')}
        </SectionTitle>
        {brandLeaderboard.length > 0 ? (
          <View style={styles.list}>
            {brandLeaderboard.map((b, idx) => (
              <View key={b.brand} style={styles.stackRow}>
                <View style={styles.spaceBetween}>
                  <AppText variant="caption" weight="semibold">
                    #{idx + 1} {b.brand}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {fmtInt(b.count)} {t('analytics.charging.sessions', 'sessions')}
                  </AppText>
                </View>
                <ProportionBar pct={b.pct} color={colors.success} />
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            title={t('analytics.charging.chargerBrands', 'Charger Brands')}
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
          <MonthlyTrendBars data={monthlyTrend} />
        ) : (
          <EmptyState
            title={t('analytics.charging.monthlyTrend', 'Monthly Charging Trend')}
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
          <View style={styles.metricGrid}>
            <MetricCard
              label={t('analytics.charging.minCost', 'Min Cost')}
              value={formatCurrency(safe(costStats.min), 2)}
              helper=""
              tone={toneFor('green')}
            />
            <MetricCard
              label={t('analytics.charging.avgCost', 'Avg Cost')}
              value={formatCurrency(safe(costStats.avg), 2)}
              helper=""
              tone={toneFor('cyan')}
            />
            <MetricCard
              label={t('analytics.charging.medianCost', 'Median Cost')}
              value={formatCurrency(safe(costStats.median), 2)}
              helper=""
              tone={toneFor('purple')}
            />
            <MetricCard
              label={t('analytics.charging.maxCost', 'Max Cost')}
              value={formatCurrency(safe(costStats.max), 2)}
              helper=""
              tone={toneFor('amber')}
            />
          </View>
        ) : (
          <EmptyState
            title={t('analytics.charging.costAnalysis', 'Cost Analysis')}
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
              const pct =
                totalTypeSessions > 0
                  ? (safe(ct.count) / totalTypeSessions) * 100
                  : 0;
              return (
                <View key={`${ct.type}-${i}`} style={styles.row}>
                  <AppText
                    variant="caption"
                    tone="secondary"
                    weight="semibold"
                    style={styles.rowLabel}
                    numberOfLines={1}>
                    {ct.type}
                  </AppText>
                  <ProportionBar
                    pct={pct}
                    color={CHART_COLORS[i % CHART_COLORS.length]}
                  />
                  <AppText
                    variant="caption"
                    style={styles.rowValueWide}
                    numberOfLines={1}>
                    {safe(ct.count)} ({fmtInt(pct)}%)
                  </AppText>
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyState
            title={t('analytics.charging.costByType', 'Cost by Charger Type')}
            message={t('analytics.charging.noCostByType', 'No charger type data')}
          />
        )}
      </GlassPanel>
    </>
  );
}

/* ─── ChargingTab ──────────────────────────────────────────────────────── */

export function ChargingTab({data}: {data: FleetAnalytics | undefined}) {
  const ca = data?.charging_analytics;
  const chargerTypes = ca?.charger_types ?? [];
  const batteryDist = ca?.start_battery_dist ?? [];
  const hourly = ca?.hourly_pattern ?? [];
  const powerStats = ca?.power_stats;
  const durStats = ca?.duration_stats;
  const effStats = ca?.efficiency_stats;

  return (
    <View style={styles.root}>
      {/* Summary Cards */}
      <View style={styles.metricGrid}>
        <MetricCard
          label={t('analytics.charging.sessions', 'Sessions')}
          value={fmtInt(data?.total_charging_sessions)}
          helper=""
          tone={toneFor('cyan')}
        />
        <MetricCard
          label={t('analytics.charging.totalEnergy', 'Total Energy')}
          value={fmtNumber(data?.total_energy_kwh, 1)}
          helper="kWh"
          tone={toneFor('green')}
        />
        <MetricCard
          label={t('analytics.charging.totalCost', 'Total Cost')}
          value={formatCurrency(data?.total_cost ?? 0, 2)}
          helper=""
          tone={toneFor('amber')}
        />
        <MetricCard
          label={t('analytics.charging.avgPower', 'Avg Power')}
          value={powerStats ? fmtNumber(safe(powerStats.avg), 1) : '—'}
          helper="kW"
          tone={toneFor('purple')}
        />
        <MetricCard
          label={t('analytics.charging.avgDuration', 'Avg Duration')}
          value={durStats ? fmtNumber(safe(durStats.avg), 0) : '—'}
          helper={t('analytics.charging.min', 'min')}
          tone={toneFor('cyan')}
        />
        <MetricCard
          label={t('analytics.charging.chargeEff', 'Charge Efficiency')}
          value={effStats ? fmtNumber(safe(effStats.avg), 1) : '—'}
          helper="%"
          tone={toneFor('green')}
        />
      </View>

      <View style={styles.twoColumn}>
        {/* Charger Types Donut */}
        <GlassPanel style={styles.panelFlex}>
          <SectionTitle>
            {t('analytics.charging.chargerTypes', 'Charger Types')}
          </SectionTitle>
          {chargerTypes.length > 0 ? (
            <DonutBreakdown data={chargerTypes} palette={PIE_COLORS} />
          ) : (
            <EmptyState
              title={t('analytics.charging.chargerTypes', 'Charger Types')}
              message={t('analytics.charging.noTypes', 'No charger type data')}
            />
          )}
        </GlassPanel>

        {/* Start Battery Distribution */}
        <GlassPanel style={styles.panelFlex}>
          <SectionTitle>
            {t('analytics.charging.startBattery', 'Start Battery Distribution')}
          </SectionTitle>
          {batteryDist.length > 0 ? (
            <DistributionBars data={batteryDist} color={CHART_COLORS[1]} />
          ) : (
            <EmptyState
              title={t(
                'analytics.charging.startBattery',
                'Start Battery Distribution',
              )}
              message={t(
                'analytics.charging.noBatDist',
                'No battery distribution data',
              )}
            />
          )}
        </GlassPanel>
      </View>

      {/* Hourly Charging Pattern */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.charging.hourlyPattern', 'Hourly Charging Pattern')}
        </SectionTitle>
        {hourly.length > 0 ? (
          <HourlyPatternBars data={hourly} />
        ) : (
          <EmptyState
            title={t('analytics.charging.hourlyPattern', 'Hourly Charging Pattern')}
            message={t('analytics.charging.noHourly', 'No hourly data')}
          />
        )}
      </GlassPanel>

      <ChargingDetailSection data={data} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  twoColumn: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelFlex: {
    flex: 1,
    minWidth: 260,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: 14,
  },
  list: {
    gap: spacing.md,
  },
  stackRow: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  spaceBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inlineHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  flexLabel: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    width: 104,
    textAlign: 'right',
  },
  rowValue: {
    width: 48,
    textAlign: 'right',
  },
  rowValueWide: {
    width: 88,
    textAlign: 'right',
  },
  track: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dualOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  hourLabel: {
    width: 48,
  },
  dualBars: {
    flex: 1,
    gap: spacing.xs,
  },
  dualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dualValue: {
    width: 48,
    textAlign: 'right',
  },
});
