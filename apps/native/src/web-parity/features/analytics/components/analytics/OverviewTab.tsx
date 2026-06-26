// Native parity port of
// web/src/features/analytics/components/analytics/OverviewTab.tsx.
//
// The Overview analytics tab: a Distance-by-Vehicle BarChart, the
// <OverviewVehicleComparison> block (Fleet Usage PieChart donut, Efficiency
// Leaderboard bars, a Vehicle Comparison RadarChart, and an Energy & Activity
// dual-series BarChart), a Day-of-Week ComposedChart (Bar drives + Line
// avg_distance on a dual axis), a Monthly Cost ComposedChart (Bar electric cost
// + Bar gas cost + Line savings), and a Quick Links grid.
//
// React Native has no DOM/SVG Recharts backend, so every Recharts tree
// (BarChart/Bar, ComposedChart/Bar/Line, PieChart/Pie/Cell, RadarChart/Radar/
// PolarGrid/PolarAngleAxis, plus XAxis/YAxis/Tooltip/Legend/ResponsiveContainer/
// AREA_DEFAULTS) is reproduced with native View/AppText layers that preserve
// each chart's data keys, colour mapping and proportional intent (the same
// idiom as the converted ChargingTab): a colour-swatch donut breakdown, single
// proportional bars for one-series charts, dual/triple labelled bars per
// category for the composed charts, and a per-metric normalised bar group for
// the radar. The accessible numeric values stay visible alongside every bar.
//
// Self-contained native adaptations (documented in the sidecar):
//   - @/components/ui GlassPanel + @/components/feedback EmptyState -> the shared
//     native GlassPanel / EmptyState / AppText against the theme tokens. Native
//     EmptyState requires a title, so each web `message`-only EmptyState gains
//     the section title (matching the converted ChargingTab).
//   - @/hooks/useUnits -> an inlined `distanceUnit` using the web useSettings
//     default unit_of_length ('km'); the native settings/unit-preference bridge
//     is not wired yet. @/lib/unitConversion.convertDistanceFromSI and KM_PER_MILE
//     are inlined verbatim (pure SI -> display math).
//   - @/lib/numberFormat fmtNumber/fmtInt, useFormatting().formatCurrency and
//     @/components/charts `safe` -> inlined formatters with the same
//     nullish/NaN -> 0 and "$"+precision-2 semantics as ChargingTab.
//   - react-i18next useTranslation -> a native key/English-default fallback `t`
//     preserving every analytics.overview.* / analytics.links.* key verbatim.
//   - ./helpers SectionTitle and ./constants QUICK_LINKS are inlined because
//     their native modules are not yet converted targets; the lucide-react link
//     icons (BarChart3/Activity/Calendar/MapPin/Clock) and ArrowRight have no
//     native equivalent, so a neutral icon slot + a "->" chevron stand in.
//   - ./OverviewVehicleComparison is inlined here because its native module is
//     not yet a converted target (the same idiom ChargingTab used for
//     ./ChargingDetailSection); CHART_COLORS is the web CB-safe Okabe-Ito palette
//     verbatim and PIE_COLORS = CHART_COLORS[0..5].
//   - react-router-dom <Link> navigation is not wired on native, so the Quick
//     Links render as static rows that preserve every label + href.
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
import {colors, spacing} from '../../../../../theme/tokens';

/* ─── Inlined types (subset of web @/api/types.FleetAnalytics) ──────────── */

interface VehicleComparison {
  id: number;
  name: string;
  distance: number;
  energy: number;
  efficiency: number;
  drives: number;
}

interface FleetAnalytics {
  vehicle_comparison: VehicleComparison[];
  drive_analytics: {
    day_of_week: {
      day: string;
      drives: number;
      distance: number;
      avg_distance: number;
    }[];
  };
  charging_analytics: {
    monthly_trend: {
      month: string;
      energy: number;
      cost: number;
      sessions: number;
      avg_power: number;
      gas_cost: number;
      savings: number;
    }[];
  };
}

/* ─── Inlined helpers (mirror web lib/numberFormat + charts `safe` + i18n) ─ */

type TFunc = (key: string, fallback: string) => string;

// react-i18next is not wired in native; i18next returns the supplied default
// when a translation is missing, so the fallback returns the English default
// while keeping every analytics.overview.* / analytics.links.* key verbatim.
const t: TFunc = (_key, fallback) => fallback;

// Mirrors web @/components/charts `safe`: nullish / non-finite -> 0.
const safe = (v: unknown): number =>
  typeof v === 'number' && isFinite(v) ? v : 0;

// Mirrors web lib/numberFormat.fmtNumber with an explicit precision (every call
// site passes one). en-US grouping stands in for the not-yet-ported global
// locale; nullish / non-finite -> 0.
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

/* ─── Inlined unit handling (mirror web useUnits + lib/unitConversion) ──── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;
const KM_PER_MILE = 1.609344;

// Pure SI -> display converter, verbatim from web lib/unitConversion.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

// Web useUnits().unitPrefs.distance derives from settings.unit_of_length, whose
// useSettings default is 'km'. The native settings/unit bridge is not wired yet,
// so the web default preference is used here.
const distanceUnit: DistanceUnitPref = 'km';

// Web ./constants QUICK_LINKS (lucide icons dropped — no native equivalent).
const QUICK_LINKS = [
  {labelKey: 'analytics.links.statistics', href: '/statistics'},
  {labelKey: 'analytics.links.compare', href: '/period-compare'},
  {labelKey: 'analytics.links.weeklyDigest', href: '/weekly-digest'},
  {labelKey: 'analytics.links.mileage', href: '/mileage'},
  {labelKey: 'analytics.links.timeline', href: '/timeline'},
];

/* ─── Shared native chart primitives (replace Recharts SVG) ────────────── */

interface SeriesDef {
  label: string;
  color: string;
  format: (n: number) => string;
}

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
// breakdown preserving nameKey/dataKey and the PIE_COLORS map + percent share.
function DonutBreakdown({
  data,
  palette,
  format,
}: {
  data: {label: string; value: number}[];
  palette: string[];
  format: (n: number) => string;
}) {
  const total = data.reduce((sum, d) => sum + safe(d.value), 0);
  return (
    <View style={styles.list}>
      {data.map((d, i) => {
        const pct = total > 0 ? (safe(d.value) / total) * 100 : 0;
        const color = palette[i % palette.length];
        return (
          <View key={`${d.label}-${i}`} style={styles.stackRow}>
            <View style={styles.inlineHead}>
              <View style={[styles.swatch, {backgroundColor: color}]} />
              <AppText
                variant="caption"
                style={styles.flexLabel}
                numberOfLines={1}>
                {d.label}
              </AppText>
              <AppText variant="caption" tone="secondary">
                {format(safe(d.value))} ({fmtInt(pct)}%)
              </AppText>
            </View>
            <ProportionBar pct={pct} color={color} />
          </View>
        );
      })}
    </View>
  );
}

// Native stand-in for a single-series Recharts BarChart (label -> value, no
// Legend) — used for Distance by Vehicle.
function ValueBars({
  data,
  color,
  format,
}: {
  data: {label: string; value: number}[];
  color: string;
  format: (n: number) => string;
}) {
  const max = data.reduce((m, d) => Math.max(m, safe(d.value)), 0) || 1;
  return (
    <View style={styles.list}>
      {data.map((d, i) => (
        <View key={`${d.label}-${i}`} style={styles.row}>
          <AppText
            variant="caption"
            tone="secondary"
            style={styles.rowLabel}
            numberOfLines={1}>
            {d.label}
          </AppText>
          <ProportionBar pct={(safe(d.value) / max) * 100} color={color} />
          <AppText
            variant="caption"
            weight="semibold"
            style={styles.rowValueWide}
            numberOfLines={1}>
            {format(safe(d.value))}
          </AppText>
        </View>
      ))}
    </View>
  );
}

// Native stand-in for a multi-series Recharts ComposedChart/BarChart (Bar + Bar
// + Line on shared/dual axes): one row per category with a Legend and every
// series scaled to its own maximum. Used for Day-of-Week, Monthly Cost, and
// Energy & Activity.
function GroupedBars({
  rows,
  series,
}: {
  rows: {label: string; values: number[]}[];
  series: SeriesDef[];
}) {
  const maxes = series.map(
    (_s, si) => rows.reduce((m, r) => Math.max(m, r.values[si] ?? 0), 0) || 1,
  );
  return (
    <View style={styles.list}>
      <ChartLegend items={series.map(s => ({label: s.label, color: s.color}))} />
      {rows.map((r, i) => (
        <View key={`${r.label}-${i}`} style={styles.groupOuter}>
          <AppText
            variant="caption"
            tone="muted"
            style={styles.groupLabel}
            numberOfLines={1}>
            {r.label}
          </AppText>
          <View style={styles.groupBars}>
            {series.map((s, si) => (
              <View key={s.label} style={styles.groupRow}>
                <ProportionBar
                  pct={((r.values[si] ?? 0) / maxes[si]) * 100}
                  color={s.color}
                />
                <AppText variant="caption" style={styles.groupValue}>
                  {s.format(r.values[si] ?? 0)}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

// Native stand-in for the Recharts RadarChart: each metric (Distance, Energy,
// Drives, Efficiency) keeps the web's 0-100 fleet-relative normalisation and is
// shown as one normalised bar per vehicle, with the same per-vehicle colour map.
function RadarComparison({
  metrics,
  vehicles,
}: {
  metrics: {metric: string; values: number[]}[];
  vehicles: {name: string; color: string}[];
}) {
  return (
    <View style={styles.list}>
      <ChartLegend
        items={vehicles.map(v => ({label: v.name, color: v.color}))}
      />
      {metrics.map(m => (
        <View key={m.metric} style={styles.stackRow}>
          <AppText variant="caption" weight="semibold">
            {m.metric}
          </AppText>
          {m.values.map((val, i) => (
            <View key={vehicles[i]?.name ?? i} style={styles.groupRow}>
              <ProportionBar
                pct={val}
                color={vehicles[i]?.color ?? CHART_COLORS[0]}
              />
              <AppText variant="caption" style={styles.groupValue}>
                {fmtInt(val)}
              </AppText>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/* ─── OverviewVehicleComparison (inlined web ./OverviewVehicleComparison) ── */

function OverviewVehicleComparison({data}: {data: FleetAnalytics | undefined}) {
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  // backend efficiency is Wh/km — convert to Wh/mi when the user prefers miles.
  const whPerKmToDisplay = (whPerKm: number) =>
    distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;

  // Memoised so the [vehicles] dependency below has a stable reference (the web
  // `data?.vehicle_comparison ?? []` literal is re-created every render).
  const vehicles = useMemo(() => data?.vehicle_comparison ?? [], [data]);

  const leaderboard = useMemo(() => {
    const sorted = [...vehicles].sort(
      (a, b) => safe(a.efficiency) - safe(b.efficiency),
    );
    const maxEff =
      sorted.length > 0 ? safe(sorted[sorted.length - 1].efficiency) : 1;
    return sorted.map(v => ({
      ...v,
      pct: maxEff > 0 ? (safe(v.efficiency) / maxEff) * 100 : 0,
    }));
  }, [vehicles]);

  const radarMetrics = useMemo(() => {
    if (vehicles.length < 2) return [];
    const maxDist = Math.max(...vehicles.map(v => safe(v.distance)), 1);
    const maxEnergy = Math.max(...vehicles.map(v => safe(v.energy)), 1);
    const maxDrives = Math.max(...vehicles.map(v => safe(v.drives)), 1);
    const maxEff = Math.max(...vehicles.map(v => safe(v.efficiency)), 1);
    return ['Distance', 'Energy', 'Drives', 'Efficiency'].map(metric => ({
      metric,
      values: vehicles.map(v => {
        switch (metric) {
          case 'Distance':
            return (safe(v.distance) / maxDist) * 100;
          case 'Energy':
            return (safe(v.energy) / maxEnergy) * 100;
          case 'Drives':
            return (safe(v.drives) / maxDrives) * 100;
          case 'Efficiency':
            return ((maxEff - safe(v.efficiency)) / maxEff) * 100;
          default:
            return 0;
        }
      }),
    }));
  }, [vehicles]);

  const vehicleColors = vehicles.map((v, i) => ({
    name: v.name,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const fleetUsage = vehicles.map(v => ({
    label: v.name,
    value: convertDistanceFromSI(safe(v.distance) * 1000, distanceUnit),
  }));

  const energyActivityRows = vehicles.map(v => ({
    label: v.name,
    values: [safe(v.energy), safe(v.drives)],
  }));

  return (
    <>
      {/* Fleet Usage Donut + Efficiency Leaderboard */}
      <View style={styles.twoColumn}>
        <GlassPanel style={styles.panelFlex}>
          <SectionTitle>
            {t('analytics.overview.fleetUsage', 'Fleet Usage')}
          </SectionTitle>
          {vehicles.length > 0 ? (
            <DonutBreakdown
              data={fleetUsage}
              palette={PIE_COLORS}
              format={n => `${fmtNumber(n, 0)} ${distanceUnit}`}
            />
          ) : (
            <EmptyState
              title={t('analytics.overview.fleetUsage', 'Fleet Usage')}
              message={t('analytics.overview.noVehicles', 'No vehicle data')}
            />
          )}
        </GlassPanel>

        <GlassPanel style={styles.panelFlex}>
          <SectionTitle>
            {t('analytics.overview.effLeaderboard', 'Efficiency Leaderboard')}
          </SectionTitle>
          {leaderboard.length > 0 ? (
            <View style={styles.list}>
              {leaderboard.map((v, idx) => (
                <View key={v.id} style={styles.stackRow}>
                  <View style={styles.spaceBetween}>
                    <AppText variant="caption" weight="semibold">
                      #{idx + 1} {v.name}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {fmtNumber(whPerKmToDisplay(safe(v.efficiency)), 1)}{' '}
                      {efficiencyUnit}
                    </AppText>
                  </View>
                  <ProportionBar pct={v.pct} color={colors.accent} />
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              title={t(
                'analytics.overview.effLeaderboard',
                'Efficiency Leaderboard',
              )}
              message={t('analytics.overview.noEfficiency', 'No efficiency data')}
            />
          )}
        </GlassPanel>
      </View>

      {/* Radar Vehicle Comparison + Energy & Activity */}
      <View style={styles.twoColumn}>
        <GlassPanel style={styles.panelFlex}>
          <SectionTitle>
            {t('analytics.overview.vehicleComparison', 'Vehicle Comparison')}
          </SectionTitle>
          {radarMetrics.length > 0 ? (
            <RadarComparison metrics={radarMetrics} vehicles={vehicleColors} />
          ) : (
            <EmptyState
              title={t(
                'analytics.overview.vehicleComparison',
                'Vehicle Comparison',
              )}
              message={t(
                'analytics.overview.noComparison',
                'Need 2+ vehicles for comparison',
              )}
            />
          )}
        </GlassPanel>

        <GlassPanel style={styles.panelFlex}>
          <SectionTitle>
            {t('analytics.overview.energyActivity', 'Energy & Activity')}
          </SectionTitle>
          {vehicles.length > 0 ? (
            <GroupedBars
              rows={energyActivityRows}
              series={[
                {
                  label: t('analytics.overview.energykWh', 'Energy (kWh)'),
                  color: CHART_COLORS[1],
                  format: n => fmtNumber(n, 1),
                },
                {
                  label: t('analytics.overview.drives', 'Drives'),
                  color: CHART_COLORS[3],
                  format: fmtInt,
                },
              ]}
            />
          ) : (
            <EmptyState
              title={t('analytics.overview.energyActivity', 'Energy & Activity')}
              message={t('analytics.overview.noVehicles', 'No vehicle data')}
            />
          )}
        </GlassPanel>
      </View>
    </>
  );
}

/* ─── OverviewTab ──────────────────────────────────────────────────────── */

export function OverviewTab({data}: {data: FleetAnalytics | undefined}) {
  // Memoised so the [vehicles] dependency below has a stable reference (the web
  // `data?.vehicle_comparison ?? []` literal is re-created every render).
  const vehicles = useMemo(() => data?.vehicle_comparison ?? [], [data]);
  const monthlyTrend = data?.charging_analytics?.monthly_trend ?? [];
  const dowData = data?.drive_analytics?.day_of_week ?? [];

  const vehicleDistData = useMemo(
    // backend `vehicle_comparison[].distance` is SI km — convert via meter floor.
    () =>
      vehicles.map(v => ({
        label: v.name,
        value: convertDistanceFromSI(safe(v.distance) * 1000, distanceUnit),
      })),
    [vehicles],
  );

  const dowRows = dowData.map(d => ({
    label: d.day,
    values: [safe(d.drives), safe(d.avg_distance)],
  }));

  const monthlyRows = monthlyTrend.map(m => ({
    label: m.month,
    values: [safe(m.cost), safe(m.gas_cost), safe(m.savings)],
  }));

  return (
    <View style={styles.root}>
      {/* Distance by Vehicle */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.overview.distByVehicle', 'Distance by Vehicle')}
        </SectionTitle>
        {vehicleDistData.length > 0 ? (
          <ValueBars
            data={vehicleDistData}
            color={CHART_COLORS[0]}
            format={n => `${fmtNumber(n, 1)} ${distanceUnit}`}
          />
        ) : (
          <EmptyState
            title={t('analytics.overview.distByVehicle', 'Distance by Vehicle')}
            message={t('analytics.overview.noVehicles', 'No vehicle data')}
          />
        )}
      </GlassPanel>

      <OverviewVehicleComparison data={data} />

      {/* Day of Week Pattern */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.overview.dayOfWeek', 'Day of Week Pattern')}
        </SectionTitle>
        {dowData.length > 0 ? (
          <GroupedBars
            rows={dowRows}
            series={[
              {
                label: t('analytics.overview.drives', 'Drives'),
                color: CHART_COLORS[2],
                format: fmtInt,
              },
              {
                label: t('analytics.overview.avgDist', 'Avg Distance'),
                color: CHART_COLORS[3],
                format: n => fmtNumber(n, 1),
              },
            ]}
          />
        ) : (
          <EmptyState
            title={t('analytics.overview.dayOfWeek', 'Day of Week Pattern')}
            message={t('analytics.overview.noDow', 'No day-of-week data')}
          />
        )}
      </GlassPanel>

      {/* Monthly Cost Comparison */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.overview.monthlyCost', 'Monthly Cost Comparison')}
        </SectionTitle>
        {monthlyTrend.length > 0 ? (
          <GroupedBars
            rows={monthlyRows}
            series={[
              {
                label: t('analytics.overview.electricCost', 'Electric Cost'),
                color: CHART_COLORS[0],
                format: n => formatCurrency(n, 2),
              },
              {
                label: t('analytics.overview.gasCost', 'Gas Cost'),
                color: CHART_COLORS[5],
                format: n => formatCurrency(n, 2),
              },
              {
                label: t('analytics.overview.savings', 'Savings'),
                color: CHART_COLORS[1],
                format: n => formatCurrency(n, 2),
              },
            ]}
          />
        ) : (
          <EmptyState
            title={t('analytics.overview.monthlyCost', 'Monthly Cost Comparison')}
            message={t('analytics.overview.noMonthly', 'No monthly data')}
          />
        )}
      </GlassPanel>

      {/* Quick Links */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.overview.quickLinks', 'Quick Links')}
        </SectionTitle>
        <View style={styles.quickGrid}>
          {QUICK_LINKS.map(link => (
            <GlassPanel key={link.href} style={styles.quickLink}>
              <View style={styles.quickIcon} />
              <AppText
                variant="caption"
                weight="semibold"
                style={styles.quickLabel}
                numberOfLines={1}>
                {t(link.labelKey, link.labelKey.split('.').pop() ?? '')}
              </AppText>
              <AppText tone="muted">{'->'}</AppText>
            </GlassPanel>
          ))}
        </View>
      </GlassPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
    marginTop: spacing.md,
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
  flexLabel: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    width: 104,
    textAlign: 'right',
  },
  rowValueWide: {
    width: 96,
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
  groupOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  groupLabel: {
    width: 80,
  },
  groupBars: {
    flex: 1,
    gap: spacing.xs,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  groupValue: {
    width: 80,
    textAlign: 'right',
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  quickLink: {
    flexGrow: 1,
    minWidth: 150,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  quickIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
  },
  quickLabel: {
    flex: 1,
    minWidth: 0,
  },
});
