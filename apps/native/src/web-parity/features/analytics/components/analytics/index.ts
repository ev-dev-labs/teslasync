// Native parity port of
// web/src/features/analytics/components/analytics/index.ts.
//
// The web module (7 lines) is a barrel that re-exports the analytics tab
// building blocks: HeroGauges (L1), OverviewTab (L2), DrivingTab (L3),
// ChargingTab (L4), BatteryTab (L5), the TabKey type (L6) and TAB_KEYS (L7).
//
// The web tab siblings (HeroGauges.tsx / OverviewTab.tsx / DrivingTab.tsx /
// ChargingTab.tsx / BatteryTab.tsx / constants.tsx) are NOT yet present in the
// native parity tree, so — following the established native barrel precedent
// for sibling-less barrels (web-parity/components/charts/index.ts,
// features/admin/components/devtools/index.ts) — this is a SELF-CONTAINED
// native port that reimplements every export here. It is a `.ts` barrel that
// builds its tree with React.createElement because JSX requires `.tsx`.
//
// The web stack has no native equivalents wired into this tree, so:
//   - GlassPanel/MetricCard/EmptyState web UI -> native shared components, with
//     MetricCard re-expressed as a tone-dot MetricTile (the native MetricCard
//     has no icon/color/subtitle slots).
//   - lucide-react icons -> tone-coloured indicator dots.
//   - Recharts (Bar/Composed/Area/Line/Pie/Scatter/Radar) -> the native
//     AreaChartWrapper, which flattens every cartesian/pie/radar/scatter chart
//     to a single native domain with a latest-value summary because hover
//     tooltips, dual Y axes and SVG plots are unavailable in React Native.
//   - react-router <Link> Quick Links -> a non-interactive native list (no
//     router is wired into this parity barrel).
//   - useTranslation/useUnits/useFormatting -> native-safe fallbacks: the web
//     no-settings defaults are metric (km, km/h, °C, kWh) and '$' currency.
//   - The already-converted native ChargingDetailSection sibling is reused by
//     ChargingTab unchanged.
// See the .parity.json sidecar for the line-by-line source map.

import React, {useMemo, type ReactNode} from 'react';
import {StyleSheet, View, type DimensionValue} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import type {FleetAnalytics} from '../../../../api/types';
import {AreaChartWrapper} from '../../../../components/charts/AreaChartWrapper';
import {CHART_COLORS, safe} from '../../../../components/charts/chartUtils';
import {ChargingDetailSection} from './ChargingDetailSection';

const el = React.createElement;

// ---- constants.tsx port -----------------------------------------------------
// TAB_KEYS / TabKey are the barrel's two constants exports (web L6-7). PIE_COLORS
// and QUICK_LINKS are module-local (the web barrel does not re-export them); the
// lucide icons of QUICK_LINKS are dropped because lucide-react is browser-only.

export const TAB_KEYS = ['overview', 'driving', 'charging', 'battery'] as const;
export type TabKey = (typeof TAB_KEYS)[number];

const PIE_COLORS = [
  CHART_COLORS[0],
  CHART_COLORS[1],
  CHART_COLORS[2],
  CHART_COLORS[3],
  CHART_COLORS[4],
  CHART_COLORS[5],
];

const QUICK_LINKS = [
  {labelKey: 'analytics.links.statistics', href: '/statistics'},
  {labelKey: 'analytics.links.compare', href: '/period-compare'},
  {labelKey: 'analytics.links.weeklyDigest', href: '/weekly-digest'},
  {labelKey: 'analytics.links.mileage', href: '/mileage'},
  {labelKey: 'analytics.links.timeline', href: '/timeline'},
];

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

function t(_key: string, fallback: string): string {
  return fallback;
}

const EMPTY_TITLE = t('analytics.empty', 'No data');

// ---- Native-safe number + currency formatting ------------------------------
// Ported from web/src/lib/numberFormat.ts (fmtNumber/fmtInt) and the
// useFormatting().formatCurrency contract (`${'$'}${fmtNumber(amount, decimals)}`
// with the web no-settings defaults: currency '$', precision 2, locale en-US).

const DEFAULT_LOCALE = 'en-US';

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = 2): string {
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

function formatCurrency(amount: number, decimals = 2): string {
  return `$${fmtNumber(amount, decimals)}`;
}

// ---- Native-safe unit conversion -------------------------------------------
// The web components convert SI -> display via useUnits()/lib/unitConversion.
// With no settings store wired into the native parity tree, the web no-settings
// defaults apply: distance km, speed km/h, temperature °C, energy kWh. The
// helpers keep the web names + SI-floor intent so a future settings wire-up can
// flip the target unit at this boundary only.

const METERS_PER_KM = 1000;
const SECONDS_PER_HOUR = 3600;

const DISTANCE_UNIT = 'km';
const SPEED_UNIT = 'km/h';
const TEMP_UNIT = '°C';
const ENERGY_UNIT = 'kWh';
const EFFICIENCY_UNIT = 'Wh/km';

function convertDistanceFromSI(meters: number): number {
  return meters / METERS_PER_KM;
}

function convertSpeedFromSI(mps: number): number {
  return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
}

function convertTempFromSI(celsius: number): number {
  return celsius;
}

function convertEnergyFromSI(wh: number): number {
  return wh / 1000;
}

function formatEnergy(wh: number, precision = 1): string {
  return `${fmtNumber(convertEnergyFromSI(safeNumber(wh)), precision)} ${ENERGY_UNIT}`;
}

// ---- Shared presentational helpers -----------------------------------------

type Tone = 'cyan' | 'purple' | 'green' | 'amber';

const TONE_COLOR: Record<Tone, string> = {
  cyan: colors.accent,
  purple: colors.violet,
  green: colors.success,
  amber: colors.warning,
};

// SectionTitle ports web helpers.tsx (text-sm font-semibold text-[--text-primary]).
function SectionTitle({children}: {children: ReactNode}) {
  return el(
    AppText,
    {weight: 'semibold', style: styles.sectionTitle},
    children,
  );
}

// GlassPanel requires `children` in its props type, so createElement children
// are wrapped into a Fragment and passed via the props object.
function panel(...children: ReactNode[]) {
  return el(GlassPanel, {
    style: styles.panel,
    children: el(React.Fragment, null, ...children),
  });
}

// Native stand-in for the web MetricCard (label + lucide icon + value + colour
// + optional subtitle). The tone-coloured dot represents the icon accent.
function MetricTile({
  label,
  value,
  subtitle,
  tone,
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone: Tone;
}) {
  return el(
    View,
    {style: styles.tile},
    el(
      View,
      {style: styles.tileHeader},
      el(View, {style: [styles.tileDot, {backgroundColor: TONE_COLOR[tone]}]}),
      el(
        AppText,
        {
          variant: 'caption',
          tone: 'muted',
          weight: 'semibold',
          numberOfLines: 1,
          style: styles.tileLabel,
        },
        label,
      ),
    ),
    el(
      View,
      {style: styles.tileValueRow},
      el(AppText, {variant: 'title', weight: 'bold'}, value),
      subtitle
        ? el(
            AppText,
            {variant: 'caption', tone: 'muted', style: styles.tileSubtitle},
            subtitle,
          )
        : null,
    ),
  );
}

// Web MetricSkeleton (helpers.tsx) -> two muted placeholder bars.
function MetricSkeleton() {
  return el(
    View,
    {style: styles.tile},
    el(View, {style: styles.skeletonLineWide}),
    el(View, {style: styles.skeletonLineNarrow}),
  );
}

function MetricGrid({children}: {children: ReactNode}) {
  return el(View, {style: styles.grid}, children);
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

// Leaderboard / distribution bar row (web `h-2 track + fill width %`).
function BarRow({
  label,
  valueLabel,
  pct,
  color,
}: {
  label: string;
  valueLabel: string;
  pct: number;
  color: string;
}) {
  return el(
    View,
    {style: styles.barRow},
    el(
      View,
      {style: styles.barRowHeader},
      el(
        AppText,
        {
          variant: 'caption',
          weight: 'semibold',
          numberOfLines: 1,
          style: styles.barRowLabel,
        },
        label,
      ),
      el(AppText, {variant: 'caption', tone: 'muted'}, valueLabel),
    ),
    el(
      View,
      {style: styles.barTrack},
      el(View, {
        style: [
          styles.barFill,
          {width: `${clampPct(pct)}%` as DimensionValue, backgroundColor: color},
        ],
      }),
    ),
  );
}

interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

// GlassPanel + SectionTitle + (AreaChartWrapper | EmptyState). Every recharts
// chart in the web tabs collapses to this single native renderer.
function ChartPanel({
  title,
  data,
  xKey,
  series,
  emptyMessage,
  height = 280,
  xFormatter,
}: {
  title: string;
  data: Record<string, unknown>[];
  xKey: string;
  series: ChartSeries[];
  emptyMessage: string;
  height?: number;
  xFormatter?: (value: string) => string;
}) {
  return panel(
    el(SectionTitle, null, title),
    data.length > 0
      ? el(AreaChartWrapper, {
          data,
          xKey,
          series,
          height,
          xFormatter,
          yFormatter: (value: number) => fmtNumber(value, 1),
        })
      : el(EmptyState, {title: EMPTY_TITLE, message: emptyMessage}),
  );
}

const formatDate = (value: string) => value.slice(5);
const formatHour = (value: string) => `${value}:00`;

// ---- HeroGauges (web HeroGauges.tsx) ---------------------------------------

export function HeroGauges({data}: {data: FleetAnalytics | undefined}) {
  if (!data) {
    return el(
      MetricGrid,
      null,
      Array.from({length: 6}).map((_unused, i) =>
        el(MetricSkeleton, {key: i}),
      ),
    );
  }

  const totalDistKm = data.total_distance_km ?? 0;
  const totalDist = convertDistanceFromSI(totalDistKm * 1000);
  // Gas savings + CO₂ heuristics are tied to KM regardless of display unit.
  const gasSavings = totalDistKm * 0.085 * 1.5 - safe(data.total_cost);
  const co2Saved = totalDistKm * 0.12;
  const avgEffDisplay = data.avg_efficiency_wh_km ?? 0;

  return el(
    MetricGrid,
    null,
    el(MetricTile, {
      key: 'distance',
      label: t('analytics.hero.distance', 'Distance'),
      value: fmtNumber(totalDist, 1),
      subtitle: DISTANCE_UNIT,
      tone: 'cyan',
    }),
    el(MetricTile, {
      key: 'drives',
      label: t('analytics.hero.drives', 'Drives'),
      value: fmtInt(data.total_drives),
      tone: 'purple',
    }),
    el(MetricTile, {
      key: 'energy',
      label: t('analytics.hero.energy', 'Energy'),
      value: fmtNumber(data.total_energy_kwh, 1),
      subtitle: 'kWh',
      tone: 'green',
    }),
    el(MetricTile, {
      key: 'efficiency',
      label: t('analytics.hero.efficiency', 'Efficiency'),
      value: fmtNumber(avgEffDisplay, 1),
      subtitle: EFFICIENCY_UNIT,
      tone: 'amber',
    }),
    el(MetricTile, {
      key: 'gasSavings',
      label: t('analytics.hero.gasSavings', 'Gas Savings'),
      value: formatCurrency(Math.max(gasSavings, 0), 0),
      tone: 'green',
    }),
    el(MetricTile, {
      key: 'co2Saved',
      label: t('analytics.hero.co2Saved', 'CO₂ Saved'),
      value: fmtNumber(co2Saved, 0),
      subtitle: 'kg',
      tone: 'green',
    }),
  );
}

// ---- OverviewVehicleComparison (web OverviewVehicleComparison.tsx) ----------

function OverviewVehicleComparison({data}: {data: FleetAnalytics | undefined}) {
  const comparison = data?.vehicle_comparison;

  const leaderboard = useMemo(() => {
    const vehicles = comparison ?? [];
    const sorted = [...vehicles].sort(
      (a, b) => safe(a.efficiency) - safe(b.efficiency),
    );
    const maxEff =
      sorted.length > 0 ? safe(sorted[sorted.length - 1].efficiency) : 1;
    return sorted.map(v => ({
      ...v,
      pct: maxEff > 0 ? (safe(v.efficiency) / maxEff) * 100 : 0,
    }));
  }, [comparison]);

  const radarData = useMemo<Record<string, string | number>[]>(() => {
    const vehicles = comparison ?? [];
    if (vehicles.length < 2) return [];
    const maxDist = Math.max(...vehicles.map(v => safe(v.distance)), 1);
    const maxEnergy = Math.max(...vehicles.map(v => safe(v.energy)), 1);
    const maxDrives = Math.max(...vehicles.map(v => safe(v.drives)), 1);
    const maxEff = Math.max(...vehicles.map(v => safe(v.efficiency)), 1);
    return ['Distance', 'Energy', 'Drives', 'Efficiency'].map(metric => {
      const row: Record<string, string | number> = {metric};
      vehicles.forEach(v => {
        switch (metric) {
          case 'Distance':
            row[v.name] = (safe(v.distance) / maxDist) * 100;
            break;
          case 'Energy':
            row[v.name] = (safe(v.energy) / maxEnergy) * 100;
            break;
          case 'Drives':
            row[v.name] = (safe(v.drives) / maxDrives) * 100;
            break;
          case 'Efficiency':
            row[v.name] = ((maxEff - safe(v.efficiency)) / maxEff) * 100;
            break;
        }
      });
      return row;
    });
  }, [comparison]);

  const vehicles = comparison ?? [];
  const fleetUsage = vehicles.map(v => ({
    name: v.name,
    value: convertDistanceFromSI(safe(v.distance) * 1000),
  }));
  const radarSeries: ChartSeries[] = vehicles.map((v, i) => ({
    key: v.name,
    label: v.name,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return el(
    View,
    {style: styles.stack},
    // Fleet Usage donut -> single-series distribution.
    el(ChartPanel, {
      title: t('analytics.overview.fleetUsage', 'Fleet Usage'),
      data: fleetUsage,
      xKey: 'name',
      series: [
        {key: 'value', label: DISTANCE_UNIT, color: CHART_COLORS[0]},
      ],
      emptyMessage: t('analytics.overview.noVehicles', 'No vehicle data'),
    }),
    // Efficiency Leaderboard.
    panel(
      el(
        SectionTitle,
        null,
        t('analytics.overview.effLeaderboard', 'Efficiency Leaderboard'),
      ),
      leaderboard.length > 0
        ? el(
            View,
            {style: styles.list},
            leaderboard.map((v, idx) =>
              el(BarRow, {
                key: v.id,
                label: `#${idx + 1} ${v.name}`,
                valueLabel: `${fmtNumber(safe(v.efficiency), 1)} ${EFFICIENCY_UNIT}`,
                pct: v.pct,
                color: colors.accent,
              }),
            ),
          )
        : el(EmptyState, {
            title: EMPTY_TITLE,
            message: t('analytics.overview.noEfficiency', 'No efficiency data'),
          }),
    ),
    // Radar Vehicle Comparison -> normalized per-metric multi-series.
    el(ChartPanel, {
      title: t('analytics.overview.vehicleComparison', 'Vehicle Comparison'),
      data: radarData,
      xKey: 'metric',
      series: radarSeries,
      emptyMessage: t(
        'analytics.overview.noComparison',
        'Need 2+ vehicles for comparison',
      ),
    }),
    // Energy & Activity.
    el(ChartPanel, {
      title: t('analytics.overview.energyActivity', 'Energy & Activity'),
      data: vehicles,
      xKey: 'name',
      series: [
        {
          key: 'energy',
          label: t('analytics.overview.energykWh', 'Energy (kWh)'),
          color: CHART_COLORS[1],
        },
        {
          key: 'drives',
          label: t('analytics.overview.drives', 'Drives'),
          color: CHART_COLORS[3],
        },
      ],
      emptyMessage: t('analytics.overview.noVehicles', 'No vehicle data'),
    }),
  );
}

// ---- OverviewTab (web OverviewTab.tsx) -------------------------------------

export function OverviewTab({data}: {data: FleetAnalytics | undefined}) {
  const vehicles = data?.vehicle_comparison ?? [];
  const monthlyTrend = data?.charging_analytics?.monthly_trend ?? [];
  const dowData = data?.drive_analytics?.day_of_week ?? [];

  const vehicleDistData = vehicles.map(v => ({
    name: v.name,
    distance: convertDistanceFromSI(safe(v.distance) * 1000),
  }));

  return el(
    View,
    {style: styles.stack},
    el(ChartPanel, {
      title: t('analytics.overview.distByVehicle', 'Distance by Vehicle'),
      data: vehicleDistData,
      xKey: 'name',
      series: [{key: 'distance', label: DISTANCE_UNIT, color: CHART_COLORS[0]}],
      emptyMessage: t('analytics.overview.noVehicles', 'No vehicle data'),
    }),
    el(OverviewVehicleComparison, {data}),
    el(ChartPanel, {
      title: t('analytics.overview.dayOfWeek', 'Day of Week Pattern'),
      data: dowData,
      xKey: 'day',
      series: [
        {
          key: 'drives',
          label: t('analytics.overview.drives', 'Drives'),
          color: CHART_COLORS[2],
        },
        {
          key: 'avg_distance',
          label: t('analytics.overview.avgDist', 'Avg Distance'),
          color: CHART_COLORS[3],
        },
      ],
      emptyMessage: t('analytics.overview.noDow', 'No day-of-week data'),
    }),
    el(ChartPanel, {
      title: t('analytics.overview.monthlyCost', 'Monthly Cost Comparison'),
      data: monthlyTrend,
      xKey: 'month',
      height: 300,
      series: [
        {
          key: 'cost',
          label: t('analytics.overview.electricCost', 'Electric Cost'),
          color: CHART_COLORS[0],
        },
        {
          key: 'gas_cost',
          label: t('analytics.overview.gasCost', 'Gas Cost'),
          color: CHART_COLORS[5],
        },
        {
          key: 'savings',
          label: t('analytics.overview.savings', 'Savings'),
          color: CHART_COLORS[1],
        },
      ],
      emptyMessage: t('analytics.overview.noMonthly', 'No monthly data'),
    }),
    // Quick Links (web react-router <Link> list -> non-interactive native list).
    panel(
      el(
        SectionTitle,
        null,
        t('analytics.overview.quickLinks', 'Quick Links'),
      ),
      el(
        View,
        {style: styles.quickLinks},
        QUICK_LINKS.map(link =>
          el(
            View,
            {key: link.href, style: styles.quickLinkRow},
            el(View, {style: styles.quickLinkDot}),
            el(
              AppText,
              {variant: 'body', weight: 'semibold', style: styles.quickLinkLabel},
              t(link.labelKey, link.labelKey.split('.').pop() ?? ''),
            ),
            el(AppText, {tone: 'muted'}, '→'),
          ),
        ),
      ),
    ),
  );
}

// ---- DrivingPerformanceCards (web DrivingPerformanceCards.tsx) --------------

function DrivingPerformanceCards({data}: {data: FleetAnalytics | undefined}) {
  // backend speed_stats is km/h (SI floor m/s); distance_stats is km (SI floor m).
  const fromKmh = (kmh: number) =>
    convertSpeedFromSI((kmh * METERS_PER_KM) / SECONDS_PER_HOUR);
  const fromKm = (km: number) => convertDistanceFromSI(km * METERS_PER_KM);

  const da = data?.drive_analytics;
  const ss = da?.speed_stats;
  const ps = da?.power_stats;
  const rs = da?.regen_stats;
  const ds = da?.distance_stats;

  return el(
    MetricGrid,
    null,
    el(MetricTile, {
      key: 'topSpeed',
      label: t('analytics.driving.topSpeed', 'Top Speed'),
      value: ss ? fmtNumber(fromKmh(safe(ss.max)), 0) : '—',
      subtitle: SPEED_UNIT,
      tone: 'cyan',
    }),
    el(MetricTile, {
      key: 'avgSpeed',
      label: t('analytics.driving.avgSpeed', 'Avg Speed'),
      value: ss ? fmtNumber(fromKmh(safe(ss.avg)), 0) : '—',
      subtitle: SPEED_UNIT,
      tone: 'purple',
    }),
    el(MetricTile, {
      key: 'peakPower',
      label: t('analytics.driving.peakPower', 'Peak Power'),
      value: ps ? fmtNumber(safe(ps.max), 0) : '—',
      subtitle: 'kW',
      tone: 'amber',
    }),
    el(MetricTile, {
      key: 'peakRegen',
      label: t('analytics.driving.peakRegen', 'Peak Regen'),
      value: rs ? fmtNumber(safe(rs.max), 0) : '—',
      subtitle: 'kW',
      tone: 'green',
    }),
    el(MetricTile, {
      key: 'avgDriveDist',
      label: t('analytics.driving.avgDriveDist', 'Avg Drive Distance'),
      value: ds ? fmtNumber(fromKm(safe(ds.avg)), 1) : '—',
      subtitle: DISTANCE_UNIT,
      tone: 'cyan',
    }),
    el(MetricTile, {
      key: 'longestDrive',
      label: t('analytics.driving.longestDrive', 'Longest Drive'),
      value: ds ? fmtNumber(fromKm(safe(ds.max)), 1) : '—',
      subtitle: DISTANCE_UNIT,
      tone: 'purple',
    }),
  );
}

// ---- DrivingTemperatureStats (web DrivingTemperatureStats.tsx) --------------

function DrivingTemperatureStats({data}: {data: FleetAnalytics | undefined}) {
  const fromC = (c: number) => convertTempFromSI(c);
  const da = data?.drive_analytics;
  const insideTemp = da?.temperature?.inside;
  const outsideTemp = da?.temperature?.outside;

  return panel(
    el(
      SectionTitle,
      null,
      t('analytics.driving.tempStats', 'Temperature Stats'),
    ),
    insideTemp || outsideTemp
      ? el(
          MetricGrid,
          null,
          el(MetricTile, {
            key: 'insideMin',
            label: t('analytics.driving.insideMin', 'Inside Min'),
            value: insideTemp ? fmtNumber(fromC(safe(insideTemp.min)), 1) : '—',
            subtitle: TEMP_UNIT,
            tone: 'cyan',
          }),
          el(MetricTile, {
            key: 'insideAvg',
            label: t('analytics.driving.insideAvg', 'Inside Avg'),
            value: insideTemp ? fmtNumber(fromC(safe(insideTemp.avg)), 1) : '—',
            subtitle: TEMP_UNIT,
            tone: 'green',
          }),
          el(MetricTile, {
            key: 'insideMax',
            label: t('analytics.driving.insideMax', 'Inside Max'),
            value: insideTemp ? fmtNumber(fromC(safe(insideTemp.max)), 1) : '—',
            subtitle: TEMP_UNIT,
            tone: 'amber',
          }),
          el(MetricTile, {
            key: 'outsideMin',
            label: t('analytics.driving.outsideMin', 'Outside Min'),
            value: outsideTemp
              ? fmtNumber(fromC(safe(outsideTemp.min)), 1)
              : '—',
            subtitle: TEMP_UNIT,
            tone: 'cyan',
          }),
          el(MetricTile, {
            key: 'outsideAvg',
            label: t('analytics.driving.outsideAvg', 'Outside Avg'),
            value: outsideTemp
              ? fmtNumber(fromC(safe(outsideTemp.avg)), 1)
              : '—',
            subtitle: TEMP_UNIT,
            tone: 'green',
          }),
          el(MetricTile, {
            key: 'outsideMax',
            label: t('analytics.driving.outsideMax', 'Outside Max'),
            value: outsideTemp
              ? fmtNumber(fromC(safe(outsideTemp.max)), 1)
              : '—',
            subtitle: TEMP_UNIT,
            tone: 'amber',
          }),
        )
      : el(EmptyState, {
          title: EMPTY_TITLE,
          message: t('analytics.driving.noTempStats', 'No temperature stats'),
        }),
  );
}

// ---- DrivingTab (web DrivingTab.tsx) ---------------------------------------

export function DrivingTab({data}: {data: FleetAnalytics | undefined}) {
  const da = data?.drive_analytics;
  const speedDist = da?.speed_distribution ?? [];
  const distDist = da?.distance_distribution ?? [];
  const hourly = da?.hourly_pattern ?? [];
  const tempEff = da?.temp_vs_efficiency ?? [];
  const dailyTrend = da?.daily_trend ?? [];
  const durationDist = da?.duration_distribution ?? [];
  const effTrend = useMemo(
    () => (da?.daily_trend ?? []).filter(d => safe(d.efficiency) > 0),
    [da],
  );

  const tempEffData = tempEff.map(d => ({
    temp: convertTempFromSI(safe(d.temp)),
    efficiency: safe(d.efficiency),
    distance: convertDistanceFromSI(safe(d.distance) * 1000),
  }));

  return el(
    View,
    {style: styles.stack},
    el(DrivingPerformanceCards, {data}),
    el(ChartPanel, {
      title: t('analytics.driving.speedDist', 'Speed Distribution'),
      data: speedDist,
      xKey: 'range',
      height: 260,
      series: [
        {
          key: 'count',
          label: t('analytics.driving.trips', 'Trips'),
          color: CHART_COLORS[0],
        },
      ],
      emptyMessage: t('analytics.driving.noSpeed', 'No speed data'),
    }),
    el(ChartPanel, {
      title: t('analytics.driving.distDist', 'Trip Distance Distribution'),
      data: distDist,
      xKey: 'range',
      height: 260,
      series: [
        {
          key: 'count',
          label: t('analytics.driving.trips', 'Trips'),
          color: CHART_COLORS[2],
        },
      ],
      emptyMessage: t(
        'analytics.driving.noDistDist',
        'No distance distribution data',
      ),
    }),
    el(ChartPanel, {
      title: t('analytics.driving.hourlyPattern', 'Hourly Driving Pattern'),
      data: hourly,
      xKey: 'hour',
      xFormatter: formatHour,
      series: [
        {
          key: 'drives',
          label: t('analytics.driving.drives', 'Drives'),
          color: CHART_COLORS[0],
        },
        {
          key: 'distance',
          label: t('analytics.driving.distance', 'Distance'),
          color: CHART_COLORS[3],
        },
      ],
      emptyMessage: t('analytics.driving.noHourly', 'No hourly data'),
    }),
    el(ChartPanel, {
      title: t('analytics.driving.tempVsEff', 'Temperature vs Efficiency'),
      data: tempEffData,
      xKey: 'temp',
      series: [
        {
          key: 'efficiency',
          label: t('analytics.driving.efficiency', 'Efficiency'),
          color: CHART_COLORS[1],
        },
      ],
      emptyMessage: t('analytics.driving.noTempEff', 'No temperature data'),
    }),
    el(ChartPanel, {
      title: t('analytics.driving.dailyTrend', 'Daily Driving Trend'),
      data: dailyTrend,
      xKey: 'date',
      xFormatter: formatDate,
      series: [
        {key: 'distance', label: DISTANCE_UNIT, color: CHART_COLORS[0]},
        {
          key: 'drives',
          label: t('analytics.driving.drives', 'Drives'),
          color: CHART_COLORS[3],
        },
      ],
      emptyMessage: t('analytics.driving.noDailyTrend', 'No daily trend data'),
    }),
    el(ChartPanel, {
      title: t('analytics.driving.durationDist', 'Drive Duration Distribution'),
      data: durationDist,
      xKey: 'range',
      height: 260,
      series: [
        {
          key: 'count',
          label: t('analytics.driving.drives', 'Drives'),
          color: CHART_COLORS[4],
        },
      ],
      emptyMessage: t(
        'analytics.driving.noDurationData',
        'Not enough drive data for distribution chart',
      ),
    }),
    el(ChartPanel, {
      title: t('analytics.driving.effTrend', 'Efficiency Trend'),
      data: effTrend,
      xKey: 'date',
      xFormatter: formatDate,
      height: 260,
      series: [
        {key: 'efficiency', label: EFFICIENCY_UNIT, color: CHART_COLORS[1]},
      ],
      emptyMessage: t('analytics.driving.noEffTrend', 'No efficiency trend data'),
    }),
    el(DrivingTemperatureStats, {data}),
  );
}

// ---- ChargingTab (web ChargingTab.tsx) -------------------------------------

export function ChargingTab({data}: {data: FleetAnalytics | undefined}) {
  const ca = data?.charging_analytics;
  const chargerTypes = ca?.charger_types ?? [];
  const batteryDist = ca?.start_battery_dist ?? [];
  const hourly = ca?.hourly_pattern ?? [];
  const powerStats = ca?.power_stats;
  const durStats = ca?.duration_stats;
  const effStats = ca?.efficiency_stats;

  return el(
    View,
    {style: styles.stack},
    el(
      MetricGrid,
      null,
      el(MetricTile, {
        key: 'sessions',
        label: t('analytics.charging.sessions', 'Sessions'),
        value: fmtInt(data?.total_charging_sessions),
        tone: 'cyan',
      }),
      el(MetricTile, {
        key: 'totalEnergy',
        label: t('analytics.charging.totalEnergy', 'Total Energy'),
        value: fmtNumber(data?.total_energy_kwh, 1),
        subtitle: 'kWh',
        tone: 'green',
      }),
      el(MetricTile, {
        key: 'totalCost',
        label: t('analytics.charging.totalCost', 'Total Cost'),
        value: formatCurrency(data?.total_cost ?? 0, 2),
        tone: 'amber',
      }),
      el(MetricTile, {
        key: 'avgPower',
        label: t('analytics.charging.avgPower', 'Avg Power'),
        value: powerStats ? fmtNumber(safe(powerStats.avg), 1) : '—',
        subtitle: 'kW',
        tone: 'purple',
      }),
      el(MetricTile, {
        key: 'avgDuration',
        label: t('analytics.charging.avgDuration', 'Avg Duration'),
        value: durStats ? fmtNumber(safe(durStats.avg), 0) : '—',
        subtitle: t('analytics.charging.min', 'min'),
        tone: 'cyan',
      }),
      el(MetricTile, {
        key: 'chargeEff',
        label: t('analytics.charging.chargeEff', 'Charge Efficiency'),
        value: effStats ? fmtNumber(safe(effStats.avg), 1) : '—',
        subtitle: '%',
        tone: 'green',
      }),
    ),
    // Charger Types donut -> single-series distribution.
    el(ChartPanel, {
      title: t('analytics.charging.chargerTypes', 'Charger Types'),
      data: chargerTypes,
      xKey: 'type',
      series: [
        {
          key: 'count',
          label: t('analytics.charging.sessions', 'Sessions'),
          color: PIE_COLORS[0],
        },
      ],
      emptyMessage: t('analytics.charging.noTypes', 'No charger type data'),
    }),
    el(ChartPanel, {
      title: t('analytics.charging.startBattery', 'Start Battery Distribution'),
      data: batteryDist,
      xKey: 'range',
      series: [
        {
          key: 'count',
          label: t('analytics.charging.sessions', 'Sessions'),
          color: CHART_COLORS[1],
        },
      ],
      emptyMessage: t(
        'analytics.charging.noBatDist',
        'No battery distribution data',
      ),
    }),
    el(ChartPanel, {
      title: t('analytics.charging.hourlyPattern', 'Hourly Charging Pattern'),
      data: hourly,
      xKey: 'hour',
      xFormatter: formatHour,
      series: [
        {
          key: 'charges',
          label: t('analytics.charging.charges', 'Charges'),
          color: CHART_COLORS[0],
        },
        {
          key: 'energy',
          label: t('analytics.charging.energykWh', 'Energy (kWh)'),
          color: CHART_COLORS[3],
        },
      ],
      emptyMessage: t('analytics.charging.noHourly', 'No hourly data'),
    }),
    el(ChargingDetailSection, {data}),
  );
}

// ---- BatteryTab (web BatteryTab.tsx) ---------------------------------------

export function BatteryTab({data}: {data: FleetAnalytics | undefined}) {
  const fromKm = (km: number) => convertDistanceFromSI(km * 1000);
  const trend = data?.battery_trend ?? [];
  const latest = trend.length > 0 ? trend[trend.length - 1] : null;

  if (trend.length === 0) {
    return panel(
      el(EmptyState, {
        title: EMPTY_TITLE,
        message: t(
          'analytics.battery.noData',
          'No battery trend data available',
        ),
      }),
    );
  }

  const rangeTrend = trend.map(d => ({...d, range: fromKm(safe(d.range_km))}));

  return el(
    View,
    {style: styles.stack},
    el(
      MetricGrid,
      null,
      el(MetricTile, {
        key: 'healthScore',
        label: t('analytics.battery.healthScore', 'Health Score'),
        value: latest ? fmtNumber(safe(latest.health_score), 1) : '—',
        subtitle: '%',
        tone: 'green',
      }),
      el(MetricTile, {
        key: 'capacity',
        label: t('analytics.battery.capacity', 'Capacity'),
        value: latest ? formatEnergy(safe(latest.capacity_wh), 1) : '—',
        tone: 'cyan',
      }),
      el(MetricTile, {
        key: 'degradation',
        label: t('analytics.battery.degradation', 'Degradation'),
        value: latest ? fmtNumber(safe(latest.degradation_pct), 2) : '—',
        subtitle: '%',
        tone: 'amber',
      }),
      el(MetricTile, {
        key: 'estRange',
        label: t('analytics.battery.estRange', 'Est. Range'),
        value: latest ? fmtNumber(fromKm(safe(latest.range_km)), 0) : '—',
        subtitle: DISTANCE_UNIT,
        tone: 'purple',
      }),
      el(MetricTile, {
        key: 'cycles',
        label: t('analytics.battery.cycles', 'Cycles'),
        value: latest ? fmtInt(safe(latest.cycle_count)) : '—',
        tone: 'cyan',
      }),
    ),
    el(ChartPanel, {
      title: t('analytics.battery.healthTimeline', 'Health Score Timeline'),
      data: trend,
      xKey: 'date',
      xFormatter: formatDate,
      series: [
        {
          key: 'health_score',
          label: t('analytics.battery.health', 'Health %'),
          color: CHART_COLORS[1],
        },
      ],
      emptyMessage: t(
        'analytics.battery.noData',
        'No battery trend data available',
      ),
    }),
    el(ChartPanel, {
      title: t('analytics.battery.capacityTrend', 'Capacity Trend'),
      data: trend,
      xKey: 'date',
      xFormatter: formatDate,
      height: 260,
      series: [
        {
          key: 'capacity_wh',
          label: t('analytics.battery.capacity', 'Capacity'),
          color: CHART_COLORS[0],
        },
      ],
      emptyMessage: t(
        'analytics.battery.noData',
        'No battery trend data available',
      ),
    }),
    el(ChartPanel, {
      title: t('analytics.battery.rangeTrend', 'Range Trend'),
      data: rangeTrend,
      xKey: 'date',
      xFormatter: formatDate,
      height: 260,
      series: [
        {
          key: 'range',
          label: `${t('analytics.battery.range', 'Range')} (${DISTANCE_UNIT})`,
          color: CHART_COLORS[2],
        },
      ],
      emptyMessage: t(
        'analytics.battery.noData',
        'No battery trend data available',
      ),
    }),
    el(ChartPanel, {
      title: t('analytics.battery.degradationCycles', 'Degradation & Cycles'),
      data: trend,
      xKey: 'date',
      xFormatter: formatDate,
      series: [
        {
          key: 'degradation_pct',
          label: t('analytics.battery.degradPct', 'Degradation %'),
          color: CHART_COLORS[5],
        },
        {
          key: 'cycle_count',
          label: t('analytics.battery.cycleCount', 'Cycle Count'),
          color: CHART_COLORS[4],
        },
      ],
      emptyMessage: t(
        'analytics.battery.noData',
        'No battery trend data available',
      ),
    }),
  );
}

// ---- Capabilities (mirrors the native charts/devtools barrels) -------------

export const nativeAnalyticsBarrelCapabilities = {
  charts: 'flattened-to-AreaChartWrapper',
  quickLinksNavigation: 'unavailable-no-router',
  unitSettings: 'metric-defaults-no-settings-store',
} as const;

const styles = StyleSheet.create({
  stack: {
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.textPrimary,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tile: {
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 150,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
    gap: spacing.xs,
  },
  tileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tileDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  tileLabel: {
    flexShrink: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  tileValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  tileSubtitle: {
    paddingBottom: 3,
  },
  skeletonLineWide: {
    height: 12,
    width: '60%',
    borderRadius: 6,
    backgroundColor: colors.surfaceHover,
  },
  skeletonLineNarrow: {
    height: 22,
    width: '40%',
    borderRadius: 6,
    backgroundColor: colors.surfaceHover,
  },
  list: {
    gap: spacing.md,
  },
  barRow: {
    gap: spacing.xs,
  },
  barRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  barRowLabel: {
    flexShrink: 1,
    color: colors.textPrimary,
  },
  barTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  quickLinks: {
    gap: spacing.sm,
  },
  quickLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surfaceRaised,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  quickLinkDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
  },
  quickLinkLabel: {
    flex: 1,
  },
});
