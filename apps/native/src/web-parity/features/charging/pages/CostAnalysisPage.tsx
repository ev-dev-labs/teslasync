// Native parity port of web/src/features/charging/pages/CostAnalysisPage.tsx.
//
// CostAnalysisPage is the charging-economics dashboard: a header (title /
// subtitle / actions), a 6-up cost-summary grid, two cost charts (monthly trend
// + cost-per-kWh), a charger-type breakdown, a gas-vs-electric savings
// calculator, a sortable monthly-cost table, the time-of-use analysis, an AI
// cost-forecast narration, the statistical cost-forecast section, and a
// lifetime-summary + environmental-impact pair. Loading shows a skeleton; an
// empty session list shows a centered EmptyState.
//
// The web original is a thin orchestrator that delegates every section to a
// sibling component under ../components/cost-analysis (the index barrel) and
// leans on browser-only infrastructure (DOM, lucide-react, Recharts, framer-
// motion, react-router URL state, document.title, the web ui kit). React Native
// has none of that, and only two of the eleven cost-analysis siblings are
// converted yet (TimeOfUseAnalysis + the helpers module), so — following the
// established self-contained page idiom (YearReviewPage, FleetComparePage) —
// this port reproduces the page with RN primitives + the shared native building
// blocks, inlines the not-yet-converted data hook + section renderings, and
// documents every adaptation in the sidecar:
//
//   - The two CONVERTED siblings are imported, not re-inlined: the native
//     cost-analysis/TimeOfUseAnalysis (hourlyData/touInsights) and the native
//     components/ai/AICostForecastNarration (vehicleId) — exactly the web wiring.
//   - The CONVERTED native helper modules are imported (DRY): distanceAddedM /
//     durationMinutes from ../components/charging-curve/helpers and
//     categorizeCharger / gasEquivalentCost from ../components/cost-analysis/
//     helpers — the same modules the web useCostAnalysisData imports.
//   - The real data hooks are called unchanged: useChargingSessionsPaginated
//     (limit 5000, start, end) and useCostForecast(vehicleIdStr) via the native
//     web-parity useCharging hooks, so every API path is preserved.
//   - useCostAnalysisData (the per-session reduce/bucket/insight engine) is
//     inlined verbatim from web ./useCostAnalysisData — same coreStats /
//     monthlyData / costPerKwhTrend / chargerTypeData / hourlyData / touInsights
//     / gasComparison / lifetimeMetrics math, fed by the same helpers + inlined
//     SI converters (convertEnergyFromSI / convertDistanceFromSI) copied verbatim
//     from @/lib/unitConversion. No unit math is invented.
//   - @/hooks/useSettings (isMiles, settings.gas_unit) + @/hooks/useUnits
//     (unitPrefs.distance) are derived from the native useSettings AppSettings
//     query exactly as web useUnits/useSettings derive them (unit_of_length ===
//     'mi'); formatCurrency / currencySymbol mirror @/hooks/useFormatting
//     (currency_symbol + decimal_precision). fmtNumber / fmtInt / fmtWithUnit are
//     inlined from @/lib/numberFormat with the same safeNumber (nullish/NaN -> 0)
//     guard and en-US grouping (the global locale/precision settings are not
//     wired natively, matching the sibling TimeOfUseAnalysis port).
//   - @/hooks/useSelectedVehicle (the header VehiclePicker source-of-truth) has
//     no native global selection context, so the `vehicleId` name is preserved
//     as local state seeded to the first useVehicles() vehicle; the actions-row
//     VehicleSelect becomes a native segmented pill group that drives it (the
//     YearReviewPage auto-select-first idiom).
//   - useUrlString('from'/'to') + useUrlBatch (URL query state) have no native
//     URL; `startDate` / `endDate` / `setRangeBatch` keep their exact names as
//     local state, and the web RangePicker (value/onChange) becomes a native
//     preset range control (30D / 90D / 1Y) calling setRangeBatch({from,to}).
//   - usePageTitle sets document.title (no native analogue) -> dropped; the same
//     translated title renders in the on-screen header instead.
//   - SavedViewMenu (URL-saved views) + PrintButton (window.print) are browser-
//     only with no native analogue and are omitted (documented), as are the
//     data-print-hide / data-tour markers and framer-motion FadeIn.
//   - Recharts (Area/Line/Composed/Pie charts) and the lucide heading icons are
//     reproduced with the native vertical-bar / progress-bar / glyph idioms the
//     converted TimeOfUseAnalysis / FleetComparePage established; hover tooltips
//     (browser SVG pointer events) survive as bar accessibilityLabels.
//   - react-i18next useTranslation -> a native English-default `t` that keeps
//     every costAnalysis.* key verbatim and reproduces i18next `{{var}}`
//     interpolation + the {defaultValue} object form (CostSummaryCards).
//
// State names (gasPrice, mpg, electricityRate, startDate, endDate, vehicleId,
// tableSortKey, tableSortDir), the section order, the loading/empty gates, and
// every snake_case field read are preserved. No DOM, lucide-react, Recharts,
// Leaflet, framer-motion, or old web UI components are imported.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type DimensionValue,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppButton} from '../../../../components/ui/AppButton';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useChargingSessionsPaginated,
  useCostForecast,
  type CostForecastData,
} from '../../../api/hooks/useCharging';
import {useSettings, type AppSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';
import type {ChargingSession} from '../../../api/types';
import {AICostForecastNarration} from '../../../components/ai/AICostForecastNarration';
import {
  distanceAddedM,
  durationMinutes,
} from '../components/charging-curve/helpers';
import {
  categorizeCharger,
  gasEquivalentCost,
} from '../components/cost-analysis/helpers';
import {TimeOfUseAnalysis} from '../components/cost-analysis/TimeOfUseAnalysis';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;
type TArg = string | (TVars & {defaultValue?: string});

// react-i18next is not wired in native; i18next returns the supplied default
// (string fallback or the {defaultValue} object form) when a translation is
// missing, interpolating any {{var}} placeholders. Every costAnalysis.* key is
// preserved verbatim at the call sites.
function t(_key: string, arg?: TArg, vars?: TVars): string {
  let fallback = '';
  let interp: TVars = {};
  if (typeof arg === 'string') {
    fallback = arg;
    interp = vars ?? {};
  } else if (arg) {
    fallback = typeof arg.defaultValue === 'string' ? arg.defaultValue : '';
    interp = arg;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    const value = interp[k];
    return value == null ? '' : String(value);
  });
}

/* ─── Number formatters (mirror @/lib/numberFormat + null safety) ─────────── */

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

// Mirrors web lib/numberFormat.fmtInt -> fmtNumber(v, 0).
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// Mirrors web lib/numberFormat.fmtWithUnit.
function fmtWithUnit(v: unknown, unit: string, decimals = 2): string {
  return `${fmtNumber(v, decimals)} ${unit}`;
}

// Mirrors web lib/dateFormat.formatDateShort ("Apr 4" in device locale; nullish
// / unparseable -> em dash) — the same form the native charging-curve helpers use.
function formatDateShort(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

/* ─── SI converters (verbatim from web @/lib/unitConversion) ───────────────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type EnergyUnitPref = 'Wh' | 'kWh';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  if (to === 'mi') {
    return meters / METERS_PER_MILE;
  }
  if (to === 'ft') {
    return meters / METERS_PER_FOOT;
  }
  return meters / METERS_PER_KM;
}

function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  return to === 'Wh' ? wh : wh / 1000;
}

// Mirrors web useUnits.deriveDistance: unit_of_length === 'mi' -> 'mi' else 'km'.
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

/* ─── Chart palette (verbatim from @/lib/colors + @/hooks/useChartPalette) ── */

const CHART_COLORS_CB_SAFE = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#F0E442',
  '#56B4E9',
  '#D55E00',
  '#CC79A7',
  '#4B4B4B',
] as const;

const CHART_COLORS_NEON = [
  '#00f0ff',
  '#10b981',
  '#a855f7',
  '#f59e0b',
  '#4f46e5',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
] as const;

function resolveChartPalette(
  pref: string | null | undefined,
): readonly string[] {
  return pref === 'neon' ? CHART_COLORS_NEON : CHART_COLORS_CB_SAFE;
}

// Charger-type display-name colours (verbatim from web @/lib/colors.CHARGER_COLORS).
const CHARGER_COLORS: Record<string, string> = {
  Home: '#10b981',
  Supercharger: '#ef4444',
  'Public DC': '#a855f7',
  'Work / L2': '#f59e0b',
  Other: '#6366f1',
};

/* ─── Cost constants (verbatim from web ./constants) ──────────────────────── */

const DEFAULT_GAS_PRICE = 3.5;
const DEFAULT_MPG = 30;
const DEFAULT_ELECTRICITY_RATE = 0.13;
const CO2_PER_GAL_KG = 8.887;
const KG_CO2_PER_TREE_YEAR = 22;
const KWH_PER_GALLON = 33.7;

/* ─── Types (verbatim from web ./types) ───────────────────────────────────── */

interface MonthlyBucket {
  month: string;
  cost: number;
  energy: number;
  sessions: number;
  avgCostPerKwh: number;
  gasEquiv: number;
  savings: number;
}

interface ChargerTypeData {
  name: string;
  cost: number;
  energy: number;
  sessions: number;
  color: string;
}

interface HourBucket {
  hour: number;
  label: string;
  sessions: number;
  avgCost: number;
  totalEnergy: number;
}

interface CoreStats {
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

interface GasComparison {
  gasCost: number;
  evCost: number;
  actualCost: number;
  savings: number;
  monthlySavings: number;
  yearlySavings: number;
  costPerMileGas: number;
  costPerMileEV: number;
}

interface LifetimeMetrics {
  avgSessionCost: number;
  avgSessionEnergy: number;
  avgDuration: number;
  freeCount: number;
  freeEnergy: number;
  maxSessionCost: number;
  minSessionCost: number;
}

interface TouInsights {
  cheapest: HourBucket;
  priciest: HourBucket;
  busiest: HourBucket;
  offPeakPct: number;
}

interface UseCostAnalysisDataParams {
  sessions: ChargingSession[] | undefined;
  gasPrice: number;
  mpg: number;
  electricityRate: number;
  toDistanceDisplay: (km: number) => number;
  isMiles: boolean;
}

interface UseCostAnalysisDataResult {
  coreStats: CoreStats | null;
  monthlyData: MonthlyBucket[];
  costPerKwhTrend: {date: string; costPerKwh: number}[];
  chargerTypeData: ChargerTypeData[];
  hourlyData: HourBucket[];
  touInsights: TouInsights | null;
  gasComparison: GasComparison | null;
  lifetimeMetrics: LifetimeMetrics | null;
}

/* ─── useCostAnalysisData (inlined verbatim from web ./useCostAnalysisData) ── */

function useCostAnalysisData({
  sessions,
  gasPrice,
  mpg,
  electricityRate,
  toDistanceDisplay,
  isMiles,
}: UseCostAnalysisDataParams): UseCostAnalysisDataResult {
  const coreStats = useMemo<CoreStats | null>(() => {
    if (!sessions || sessions.length === 0) {
      return null;
    }
    const totalCost = sessions.reduce((s, c) => s + (c.cost_decimal ?? 0), 0);
    const totalEnergy = convertEnergyFromSI(
      sessions.reduce((s, c) => s + c.total_energy_added_wh, 0),
      'kWh',
    );
    const avgCostPerKwh = totalEnergy > 0 ? totalCost / totalEnergy : 0;
    const totalDuration = sessions.reduce(
      (s, c) => s + durationMinutes(c.started_at, c.ended_at),
      0,
    );

    let totalDistanceM = 0;
    sessions.forEach(s => {
      totalDistanceM += distanceAddedM(s) ?? 0;
    });

    const distVal = toDistanceDisplay(totalDistanceM / 1609.344);
    const costPerDist = distVal > 0 ? totalCost / distVal : 0;

    const gallonsEquiv = totalEnergy / KWH_PER_GALLON;
    const gasCost = gallonsEquiv * gasPrice;
    const savings = gasCost - totalCost;
    const savingsPercent = gasCost > 0 ? (savings / gasCost) * 100 : 0;

    const co2SavedKg = gallonsEquiv * CO2_PER_GAL_KG;
    const treeEquiv = co2SavedKg / KG_CO2_PER_TREE_YEAR;

    return {
      totalCost,
      totalEnergy,
      avgCostPerKwh,
      totalDuration,
      totalDistanceM,
      costPerDist,
      gasCost,
      savings,
      savingsPercent,
      co2SavedKg,
      treeEquiv,
      gallonsEquiv,
      count: sessions.length,
    };
  }, [sessions, gasPrice, toDistanceDisplay]);

  const monthlyData = useMemo<MonthlyBucket[]>(() => {
    if (!sessions || sessions.length === 0) {
      return [];
    }
    const buckets: Record<
      string,
      {cost: number; energy: number; sessions: number}
    > = {};
    sessions.forEach(s => {
      const d = new Date(s.started_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        '0',
      )}`;
      if (!buckets[key]) {
        buckets[key] = {cost: 0, energy: 0, sessions: 0};
      }
      buckets[key].cost += s.cost_decimal ?? 0;
      buckets[key].energy += s.total_energy_added_wh;
      buckets[key].sessions++;
    });
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => {
        const energyKwh = convertEnergyFromSI(v.energy, 'kWh');
        const ge = gasEquivalentCost(energyKwh, mpg, gasPrice);
        return {
          month,
          cost: v.cost,
          energy: energyKwh,
          sessions: v.sessions,
          avgCostPerKwh: energyKwh > 0 ? v.cost / energyKwh : 0,
          gasEquiv: ge,
          savings: ge - v.cost,
        };
      });
  }, [sessions, gasPrice, mpg]);

  const costPerKwhTrend = useMemo(() => {
    if (!sessions || sessions.length === 0) {
      return [];
    }
    return sessions
      .filter(s => s.cost_decimal != null && s.total_energy_added_wh > 0)
      .sort(
        (a, b) =>
          new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
      )
      .map(s => ({
        date: formatDateShort(s.started_at),
        costPerKwh: (s.cost_decimal ?? 0) / (s.total_energy_added_wh / 1000),
      }));
  }, [sessions]);

  const chargerTypeData = useMemo<ChargerTypeData[]>(() => {
    if (!sessions || sessions.length === 0) {
      return [];
    }
    const groups: Record<
      string,
      {cost: number; energy: number; sessions: number}
    > = {};
    sessions.forEach(s => {
      const cat = categorizeCharger(s);
      if (!groups[cat]) {
        groups[cat] = {cost: 0, energy: 0, sessions: 0};
      }
      groups[cat].cost += s.cost_decimal ?? 0;
      groups[cat].energy += s.total_energy_added_wh;
      groups[cat].sessions++;
    });
    return Object.entries(groups)
      .map(([name, v]) => ({
        name,
        cost: v.cost,
        energy: convertEnergyFromSI(v.energy, 'kWh'),
        sessions: v.sessions,
        color: CHARGER_COLORS[name] ?? CHART_COLORS_CB_SAFE[4],
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [sessions]);

  const hourlyData = useMemo<HourBucket[]>(() => {
    if (!sessions || sessions.length === 0) {
      return [];
    }
    const buckets: Record<
      number,
      {sessions: number; totalCost: number; totalEnergy: number}
    > = {};
    for (let h = 0; h < 24; h++) {
      buckets[h] = {sessions: 0, totalCost: 0, totalEnergy: 0};
    }
    sessions.forEach(s => {
      const hour = new Date(s.started_at).getHours();
      buckets[hour].sessions++;
      buckets[hour].totalCost += s.cost_decimal ?? 0;
      buckets[hour].totalEnergy += s.total_energy_added_wh;
    });
    return Object.entries(buckets)
      .map(([h, v]) => ({
        hour: Number(h),
        label: `${String(h).padStart(2, '0')}:00`,
        sessions: v.sessions,
        avgCost: v.sessions > 0 ? v.totalCost / v.sessions : 0,
        totalEnergy: convertEnergyFromSI(v.totalEnergy, 'kWh'),
      }))
      .sort((a, b) => a.hour - b.hour);
  }, [sessions]);

  const touInsights = useMemo<TouInsights | null>(() => {
    if (hourlyData.length === 0) {
      return null;
    }
    const withSessions = hourlyData.filter(h => h.sessions > 0);
    if (withSessions.length === 0) {
      return null;
    }
    const cheapest = [...withSessions].sort((a, b) => a.avgCost - b.avgCost)[0];
    const priciest = [...withSessions].sort((a, b) => b.avgCost - a.avgCost)[0];
    const busiest = [...withSessions].sort((a, b) => b.sessions - a.sessions)[0];
    const offPeakCount =
      sessions?.filter(s => {
        const h = new Date(s.started_at).getHours();
        return h >= 22 || h < 6;
      }).length ?? 0;
    const offPeakPct =
      sessions && sessions.length > 0
        ? (offPeakCount / sessions.length) * 100
        : 0;
    return {cheapest, priciest, busiest, offPeakPct};
  }, [hourlyData, sessions]);

  const gasComparison = useMemo<GasComparison | null>(() => {
    if (!coreStats) {
      return null;
    }
    const {totalEnergy, totalCost, totalDistanceM} = coreStats;
    const distMiles = toDistanceDisplay(totalDistanceM / 1609.344);
    const gallonsNeeded = isMiles
      ? distMiles / mpg
      : toDistanceDisplay(totalDistanceM / 1609.344) / mpg;
    const gasCostCalc = gallonsNeeded * gasPrice;
    const evCostCalc = totalEnergy * electricityRate;
    const monthlySavings =
      monthlyData.length > 0
        ? (gasCostCalc - evCostCalc) / Math.max(monthlyData.length, 1)
        : 0;
    const yearlySavings = monthlySavings * 12;

    return {
      gasCost: gasCostCalc,
      evCost: evCostCalc,
      actualCost: totalCost,
      savings: gasCostCalc - totalCost,
      monthlySavings,
      yearlySavings,
      costPerMileGas: distMiles > 0 ? gasCostCalc / distMiles : 0,
      costPerMileEV: distMiles > 0 ? totalCost / distMiles : 0,
    };
  }, [
    coreStats,
    gasPrice,
    mpg,
    electricityRate,
    isMiles,
    toDistanceDisplay,
    monthlyData.length,
  ]);

  const lifetimeMetrics = useMemo<LifetimeMetrics | null>(() => {
    if (!sessions || sessions.length === 0 || !coreStats) {
      return null;
    }
    const avgSessionCost =
      coreStats.count > 0 ? coreStats.totalCost / coreStats.count : 0;
    const avgSessionEnergy =
      coreStats.count > 0 ? coreStats.totalEnergy / coreStats.count : 0;
    const avgDuration =
      coreStats.count > 0 ? coreStats.totalDuration / coreStats.count : 0;
    const freeCount = sessions.filter(
      s => !s.cost_decimal || s.cost_decimal === 0,
    ).length;
    const freeEnergy = sessions
      .filter(s => !s.cost_decimal || s.cost_decimal === 0)
      .reduce((sum, s) => sum + s.total_energy_added_wh, 0);
    const maxSessionCost = Math.max(...sessions.map(s => s.cost_decimal ?? 0));
    const minSessionCost = Math.min(
      ...sessions
        .filter(s => (s.cost_decimal ?? 0) > 0)
        .map(s => s.cost_decimal!),
      0,
    );

    return {
      avgSessionCost,
      avgSessionEnergy,
      avgDuration,
      freeCount,
      freeEnergy,
      maxSessionCost,
      minSessionCost,
    };
  }, [sessions, coreStats]);

  return {
    coreStats,
    monthlyData,
    costPerKwhTrend,
    chargerTypeData,
    hourlyData,
    touInsights,
    gasComparison,
    lifetimeMetrics,
  };
}

/* ─── Source colours (web text/glow hues, toned to native primitives) ─────── */

const HUE_CYAN = '#22d3ee'; // web text-cyan-400
const HUE_YELLOW = '#facc15'; // web text-yellow-400
const HUE_BLUE = '#60a5fa'; // web text-blue-400
const HUE_GREEN = '#4ade80'; // web text-green-400
const HUE_EMERALD = '#34d399'; // web text-emerald-400
const HUE_EMERALD_SOFT = '#6ee7b7'; // web text-green-300
const HUE_RED = '#f87171'; // web text-red-400
const HUE_PURPLE = '#a855f7'; // web neon-purple / purple-400
const HUE_AMBER = '#f59e0b'; // web neon-amber

type Formatter = (amount: number, decimals?: number) => string;

/* ─── Shared section primitives ───────────────────────────────────────────── */

function SectionTitle({
  glyph,
  glyphColor,
  title,
}: {
  glyph: string;
  glyphColor: string;
  title: string;
}) {
  return (
    <View style={styles.titleRow}>
      <AppText style={[styles.titleGlyph, {color: glyphColor}]}>{glyph}</AppText>
      <AppText weight="semibold" style={styles.titleText}>
        {title}
      </AppText>
    </View>
  );
}

function ChartEmpty({message, height}: {message: string; height: number}) {
  return (
    <View style={[styles.chartEmpty, {height}]}>
      <AppText tone="muted">{message}</AppText>
    </View>
  );
}

function pctHeight(pct: number): DimensionValue {
  return `${Math.max(Math.min(pct, 100), 0)}%` as DimensionValue;
}

const BARS_HEIGHT = 200;

interface MiniBarDatum {
  label: string;
  value: number;
}

// Native vertical-bar reproduction of the web Recharts Area/Line charts (the
// converted TimeOfUseAnalysis idiom): a 3-tick y-axis (max / mid / 0) + bars
// whose height is value / max, each carrying an accessibilityLabel so the
// Recharts hover tooltip information survives for touch / screen-reader users.
function MiniBars({
  data,
  color,
  formatValue,
  formatTick,
}: {
  data: MiniBarDatum[];
  color: string;
  formatValue: (v: number) => string;
  formatTick: (v: number) => string;
}) {
  const max =
    data.reduce((m, d) => Math.max(m, safeNumber(d.value)), 0) || 1;
  const yTicks = [max, max / 2, 0];
  const tickEvery = Math.max(1, Math.ceil(data.length / 8));
  return (
    <View style={styles.chartRow}>
      <View style={styles.yAxis}>
        {yTicks.map((tick, i) => (
          <AppText
            key={`y-${i}`}
            variant="caption"
            tone="muted"
            numberOfLines={1}
            style={styles.axisTick}>
            {formatTick(tick)}
          </AppText>
        ))}
      </View>
      <View style={styles.plotColumn}>
        <View style={styles.barsArea}>
          {data.map((entry, i) => {
            const pct = (safeNumber(entry.value) / max) * 100;
            return (
              <View
                key={`${entry.label}-${i}`}
                accessibilityLabel={`${entry.label}: ${formatValue(
                  entry.value,
                )}`}
                style={[
                  styles.bar,
                  {height: pctHeight(pct), backgroundColor: color},
                ]}
              />
            );
          })}
        </View>
        <View style={styles.xAxis}>
          {data.map((entry, i) => (
            <View key={`${entry.label}-x-${i}`} style={styles.xTickCell}>
              {i % tickEvery === 0 ? (
                <AppText
                  variant="caption"
                  tone="muted"
                  numberOfLines={1}
                  style={styles.axisTick}>
                  {entry.label}
                </AppText>
              ) : null}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/* ─── 1. Cost summary cards (web StatBox + CostSummaryCards) ───────────────── */

function StatBox({
  glyph,
  glyphColor,
  label,
  value,
  sub,
}: {
  glyph: string;
  glyphColor: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <GlassPanel style={styles.statBox}>
      <View style={styles.statBoxRow}>
        <View style={styles.statIconBox}>
          <AppText style={[styles.statGlyph, {color: glyphColor}]}>
            {glyph}
          </AppText>
        </View>
        <View style={styles.statBoxText}>
          <AppText
            variant="caption"
            tone="muted"
            numberOfLines={1}
            style={styles.statLabel}>
            {label}
          </AppText>
          <AppText weight="semibold" style={styles.statValue}>
            {value}
          </AppText>
          {sub ? (
            <AppText variant="caption" tone="muted" style={styles.statSub}>
              {sub}
            </AppText>
          ) : null}
        </View>
      </View>
    </GlassPanel>
  );
}

function CostSummaryCards({
  coreStats,
  gasPrice,
  distanceUnit,
  isMiles,
  formatCurrency,
  gasUnitLabel,
}: {
  coreStats: CoreStats | null;
  gasPrice: number;
  distanceUnit: string;
  isMiles: boolean;
  formatCurrency: Formatter;
  gasUnitLabel: string;
}) {
  return (
    <View style={styles.summaryGrid}>
      <StatBox
        glyph="$"
        glyphColor={HUE_CYAN}
        label={t('costAnalysis.stats.totalCost', 'Total Cost')}
        value={formatCurrency(coreStats?.totalCost ?? 0, 2)}
        sub={`${fmtInt(coreStats?.count ?? 0)} ${t(
          'costAnalysis.stats.sessions',
          'sessions',
        )}`}
      />
      <StatBox
        glyph="⚡"
        glyphColor={HUE_YELLOW}
        label={t('costAnalysis.stats.avgPerKwh', 'Avg $/kWh')}
        value={formatCurrency(coreStats?.avgCostPerKwh ?? 0, 3)}
        sub={t('costAnalysis.stats.blendedRate', 'blended rate')}
      />
      <StatBox
        glyph="🚗"
        glyphColor={HUE_BLUE}
        label={t('costAnalysis.stats.costPerDist', {
          unit: isMiles ? 'Mile' : 'km',
          defaultValue: 'Cost Per {{unit}}',
        })}
        value={formatCurrency(coreStats?.costPerDist ?? 0, 3)}
        sub={`per ${distanceUnit}`}
      />
      <StatBox
        glyph="⚡"
        glyphColor={HUE_GREEN}
        label={t('costAnalysis.stats.totalEnergy', 'Total Energy')}
        value={fmtWithUnit(coreStats?.totalEnergy ?? 0, 'kWh', 1)}
        sub={fmtWithUnit(coreStats?.gallonsEquiv ?? 0, 'gal equiv', 1)}
      />
      <StatBox
        glyph="⛽"
        glyphColor={HUE_RED}
        label={t('costAnalysis.stats.gasSavings', 'Gas Savings $')}
        value={formatCurrency(coreStats?.savings ?? 0, 2)}
        sub={`vs ${formatCurrency(gasPrice, 2)}/${gasUnitLabel}`}
      />
      <StatBox
        glyph="↓"
        glyphColor={HUE_EMERALD}
        label={t('costAnalysis.stats.savingsPercent', 'Savings %')}
        value={`${fmtNumber(coreStats?.savingsPercent ?? 0, 1)}%`}
        sub={t('costAnalysis.stats.vsGasoline', 'vs gasoline')}
      />
    </View>
  );
}

/* ─── 2. Monthly cost trend chart (web MonthlyCostChart) ───────────────────── */

function monthLabel(v: string): string {
  const parts = v.split('-');
  return parts.length === 2 ? `${parts[1]}/${parts[0].slice(2)}` : v;
}

function MonthlyCostChart({
  data,
  palette,
  formatCurrency,
}: {
  data: MonthlyBucket[];
  palette: readonly string[];
  formatCurrency: Formatter;
}) {
  return (
    <GlassPanel style={styles.panel}>
      <SectionTitle
        glyph="◔"
        glyphColor={palette[0]}
        title={t('costAnalysis.charts.monthlyCost', 'Monthly Cost Trend')}
      />
      {data.length > 0 ? (
        <MiniBars
          data={data.map(d => ({label: monthLabel(d.month), value: d.cost}))}
          color={palette[0]}
          formatValue={v => formatCurrency(v, 2)}
          formatTick={v => formatCurrency(v, 0)}
        />
      ) : (
        <ChartEmpty
          message={t('costAnalysis.charts.noData', 'Not enough data')}
          height={BARS_HEIGHT}
        />
      )}
    </GlassPanel>
  );
}

/* ─── 3. Cost-per-kWh trend chart (web CostPerKwhChart) ────────────────────── */

function CostPerKwhChart({
  data,
  palette,
  formatCurrency,
}: {
  data: {date: string; costPerKwh: number}[];
  palette: readonly string[];
  formatCurrency: Formatter;
}) {
  return (
    <GlassPanel style={styles.panel}>
      <SectionTitle
        glyph="◴"
        glyphColor={HUE_PURPLE}
        title={t('costAnalysis.charts.costPerKwh', 'Cost per kWh Trend')}
      />
      {data.length > 0 ? (
        <MiniBars
          data={data.map(d => ({label: d.date, value: d.costPerKwh}))}
          color={palette[2]}
          formatValue={v => formatCurrency(v, 3)}
          formatTick={v => formatCurrency(v, 2)}
        />
      ) : (
        <ChartEmpty
          message={t('costAnalysis.charts.noData', 'Not enough data')}
          height={BARS_HEIGHT}
        />
      )}
    </GlassPanel>
  );
}

/* ─── 4. Charger-type breakdown (web ChargerTypeBreakdown) ─────────────────── */

function ChargerTypeBreakdown({
  data,
  totalCost,
  formatCurrency,
}: {
  data: ChargerTypeData[];
  totalCost: number;
  formatCurrency: Formatter;
}) {
  return (
    <GlassPanel style={styles.panel}>
      <SectionTitle
        glyph="⚡"
        glyphColor={HUE_YELLOW}
        title={t('costAnalysis.chargerType.title', 'Cost by Charger Type')}
      />
      {data.length > 0 ? (
        <View style={styles.gap12}>
          <View style={styles.legendRow}>
            {data.map(entry => (
              <View key={entry.name} style={styles.legendItem}>
                <View
                  style={[styles.legendDot, {backgroundColor: entry.color}]}
                />
                <AppText variant="caption" tone="muted">
                  {entry.name}
                </AppText>
              </View>
            ))}
          </View>
          {data.map(entry => {
            const pct = totalCost > 0 ? (entry.cost / totalCost) * 100 : 0;
            return (
              <View key={entry.name} style={styles.gap4}>
                <View style={styles.spaceBetween}>
                  <AppText
                    variant="caption"
                    weight="semibold"
                    tone="secondary">
                    {entry.name}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {formatCurrency(entry.cost, 2)} · {fmtInt(entry.sessions)}{' '}
                    {t('costAnalysis.chargerType.sessions', 'sessions')}
                  </AppText>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: pctHeight(pct),
                        backgroundColor: entry.color,
                      },
                    ]}
                  />
                </View>
                <View style={styles.spaceBetween}>
                  <AppText style={styles.tiny} tone="muted">
                    {fmtWithUnit(entry.energy, 'kWh', 1)}
                  </AppText>
                  <AppText style={styles.tiny} tone="muted">
                    {entry.energy > 0
                      ? `${formatCurrency(entry.cost / entry.energy, 3)}/kWh`
                      : '—'}
                  </AppText>
                  <AppText style={styles.tiny} tone="muted">
                    {fmtNumber(pct, 1)}%
                  </AppText>
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <ChartEmpty
          message={t('costAnalysis.charts.noData', 'Not enough data')}
          height={160}
        />
      )}
    </GlassPanel>
  );
}

/* ─── 5. Savings calculator (web SavingsCalculator) ───────────────────────── */

function NumberField({
  label,
  value,
  suffix,
  onChangeNumber,
  fallback,
}: {
  label: string;
  value: number;
  suffix: string;
  onChangeNumber: (v: number) => void;
  fallback: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);
  return (
    <View style={styles.gap4}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          keyboardType="numeric"
          onChangeText={next => {
            setText(next);
            onChangeNumber(Number(next) || fallback);
          }}
          placeholder="0"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <AppText variant="caption" tone="muted" style={styles.inputSuffix}>
          {suffix}
        </AppText>
      </View>
    </View>
  );
}

function ComparisonTile({
  label,
  value,
  valueColor,
  sub,
}: {
  label: string;
  value: string;
  valueColor: string;
  sub: string;
}) {
  return (
    <GlassPanel style={styles.comparisonTile}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText weight="bold" style={[styles.comparisonValue, {color: valueColor}]}>
        {value}
      </AppText>
      <AppText style={styles.tiny} tone="muted">
        {sub}
      </AppText>
    </GlassPanel>
  );
}

function SavingsCalculator({
  gasComparison,
  gasPrice,
  mpg,
  electricityRate,
  onGasPriceChange,
  onMpgChange,
  onElectricityRateChange,
  distanceUnit,
}: {
  gasComparison: GasComparison | null;
  gasPrice: number;
  mpg: number;
  electricityRate: number;
  onGasPriceChange: (v: number) => void;
  onMpgChange: (v: number) => void;
  onElectricityRateChange: (v: number) => void;
  distanceUnit: string;
}) {
  return (
    <GlassPanel style={styles.panel}>
      <SectionTitle
        glyph="🧮"
        glyphColor={HUE_GREEN}
        title={t(
          'costAnalysis.calculator.title',
          'Gas vs Electric Savings Calculator',
        )}
      />
      <View style={styles.gap12}>
        <AppText variant="caption" tone="muted" style={styles.subhead}>
          {t('costAnalysis.calculator.inputs', 'Your Assumptions')}
        </AppText>
        <NumberField
          label={t('costAnalysis.calculator.gasPrice', 'Gas Price ($/gal)')}
          value={gasPrice}
          suffix="$/gal"
          onChangeNumber={onGasPriceChange}
          fallback={0}
        />
        <NumberField
          label={t('costAnalysis.calculator.mpg', 'Gas Car MPG')}
          value={mpg}
          suffix="mpg"
          onChangeNumber={onMpgChange}
          fallback={1}
        />
        <NumberField
          label={t(
            'costAnalysis.calculator.elecRate',
            'Electricity Rate ($/kWh)',
          )}
          value={electricityRate}
          suffix="$/kWh"
          onChangeNumber={onElectricityRateChange}
          fallback={0}
        />
        <AppButton
          label={t('costAnalysis.calculator.reset', 'Reset Defaults')}
          onPress={() => {
            onGasPriceChange(DEFAULT_GAS_PRICE);
            onMpgChange(DEFAULT_MPG);
            onElectricityRateChange(DEFAULT_ELECTRICITY_RATE);
          }}
        />

        <AppText variant="caption" tone="muted" style={styles.subhead}>
          {t('costAnalysis.calculator.comparison', 'Comparison')}
        </AppText>
        {gasComparison ? (
          <View style={styles.comparisonGrid}>
            <ComparisonTile
              label={t(
                'costAnalysis.calculator.gasCost',
                'Gas Cost (equivalent)',
              )}
              value={`$${fmtNumber(gasComparison.gasCost, 2)}`}
              valueColor={HUE_RED}
              sub={`$${fmtNumber(
                gasComparison.costPerMileGas,
                3,
              )}/${distanceUnit}`}
            />
            <ComparisonTile
              label={t('costAnalysis.calculator.evCost', 'EV Cost (actual)')}
              value={`$${fmtNumber(gasComparison.actualCost, 2)}`}
              valueColor={HUE_CYAN}
              sub={`$${fmtNumber(
                gasComparison.costPerMileEV,
                3,
              )}/${distanceUnit}`}
            />
            <ComparisonTile
              label={t('costAnalysis.calculator.totalSavings', 'Total Savings')}
              value={`$${fmtNumber(gasComparison.savings, 2)}`}
              valueColor={HUE_GREEN}
              sub={t('costAnalysis.calculator.overPeriod', 'over selected period')}
            />
            <ComparisonTile
              label={t(
                'costAnalysis.calculator.monthlySavings',
                'Monthly Savings',
              )}
              value={`$${fmtNumber(gasComparison.monthlySavings, 2)}`}
              valueColor={HUE_EMERALD_SOFT}
              sub={`~$${fmtNumber(gasComparison.yearlySavings, 0)} ${t(
                'costAnalysis.calculator.perYear',
                '/ year',
              )}`}
            />
          </View>
        ) : (
          <ChartEmpty
            message={t(
              'costAnalysis.calculator.noData',
              'Not enough data for comparison',
            )}
            height={128}
          />
        )}
      </View>
    </GlassPanel>
  );
}

/* ─── 6. Monthly cost table (web MonthlyCostTable) ─────────────────────────── */

type SortKey =
  | 'month'
  | 'sessions'
  | 'energy'
  | 'cost'
  | 'avgCostPerKwh'
  | 'gasEquiv'
  | 'savings';

interface TableColumn {
  key: SortKey;
  header: string;
  width: number;
  render: (row: MonthlyBucket, formatCurrency: Formatter) => React.ReactNode;
}

function MonthlyCostTable({
  data,
  formatCurrency,
}: {
  data: MonthlyBucket[];
  formatCurrency: Formatter;
}) {
  const [tableSortKey, setTableSortKey] = useState<SortKey>('month');
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc');

  const columns = useMemo<TableColumn[]>(
    () => [
      {
        key: 'month',
        header: t('costAnalysis.table.month', 'Month'),
        width: 84,
        render: row => (
          <AppText weight="semibold" numberOfLines={1}>
            {row.month}
          </AppText>
        ),
      },
      {
        key: 'sessions',
        header: t('costAnalysis.table.sessions', 'Sessions'),
        width: 76,
        render: row => <AppText tone="secondary">{fmtInt(row.sessions)}</AppText>,
      },
      {
        key: 'energy',
        header: t('costAnalysis.table.energy', 'Energy'),
        width: 96,
        render: row => (
          <AppText tone="secondary">{fmtWithUnit(row.energy, 'kWh', 1)}</AppText>
        ),
      },
      {
        key: 'cost',
        header: t('costAnalysis.table.cost', 'Cost'),
        width: 84,
        render: (row, fc) => (
          <AppText style={{color: HUE_CYAN}}>{fc(row.cost, 2)}</AppText>
        ),
      },
      {
        key: 'avgCostPerKwh',
        header: t('costAnalysis.table.avgRate', 'Avg $/kWh'),
        width: 92,
        render: (row, fc) => (
          <AppText tone="secondary">{fc(row.avgCostPerKwh, 3)}</AppText>
        ),
      },
      {
        key: 'gasEquiv',
        header: t('costAnalysis.table.gasEquiv', 'Gas Equiv'),
        width: 92,
        render: (row, fc) => (
          <AppText style={{color: HUE_RED}}>{fc(row.gasEquiv, 2)}</AppText>
        ),
      },
      {
        key: 'savings',
        header: t('costAnalysis.table.savings', 'Savings'),
        width: 92,
        render: (row, fc) => (
          <AppText
            weight="semibold"
            style={{color: row.savings >= 0 ? HUE_GREEN : HUE_RED}}>
            {row.savings >= 0 ? '+' : ''}
            {fc(row.savings, 2)}
          </AppText>
        ),
      },
    ],
    [],
  );

  const sortedData = useMemo(() => {
    if (data.length === 0) {
      return [];
    }
    return [...data].sort((a, b) => {
      const aVal = a[tableSortKey];
      const bVal = b[tableSortKey];
      const cmp =
        typeof aVal === 'number' && typeof bVal === 'number'
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal));
      return tableSortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, tableSortKey, tableSortDir]);

  const handleSort = useCallback((key: SortKey) => {
    setTableSortKey(prevKey => {
      if (key === prevKey) {
        setTableSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      }
      setTableSortDir('desc');
      return key;
    });
  }, []);

  return (
    <GlassPanel style={styles.panel}>
      <SectionTitle
        glyph="▦"
        glyphColor={HUE_CYAN}
        title={t('costAnalysis.table.title', 'Monthly Cost Breakdown')}
      />
      {sortedData.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <View style={styles.tableHeaderRow}>
              {columns.map(col => {
                const active = col.key === tableSortKey;
                const arrow = active
                  ? tableSortDir === 'asc'
                    ? ' ▲'
                    : ' ▼'
                  : '';
                return (
                  <Pressable
                    key={col.key}
                    accessibilityRole="button"
                    onPress={() => handleSort(col.key)}
                    style={[styles.tableCell, {width: col.width}]}>
                    <AppText
                      variant="caption"
                      tone={active ? 'accent' : 'muted'}
                      numberOfLines={1}>
                      {col.header}
                      {arrow}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
            {sortedData.map(row => (
              <View key={row.month} style={styles.tableRow}>
                {columns.map(col => (
                  <View
                    key={col.key}
                    style={[styles.tableCell, {width: col.width}]}>
                    {col.render(row, formatCurrency)}
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      ) : (
        <ChartEmpty
          message={t('costAnalysis.table.noData', 'No monthly data available')}
          height={128}
        />
      )}
    </GlassPanel>
  );
}

/* ─── 8. Cost forecast section (web CostForecastSection + ForecastDetails) ── */

function KVRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.spaceBetween}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText variant="caption" style={valueColor ? {color: valueColor} : undefined}>
        {value}
      </AppText>
    </View>
  );
}

function ForecastDetails({
  forecastData,
  formatCurrency,
  currencySymbol,
}: {
  forecastData: CostForecastData | undefined;
  formatCurrency: Formatter;
  currencySymbol: string;
}) {
  const insights = forecastData?.insights ?? [];
  return (
    <View style={styles.gap16}>
      {/* Breakdown */}
      <GlassPanel style={styles.panel}>
        <AppText weight="semibold" style={styles.titleText}>
          {t('costAnalysis.forecast.breakdown', 'Charging Breakdown')}
        </AppText>
        {forecastData ? (
          <View style={[styles.gap12, styles.mt12]}>
            <View style={styles.spaceBetween}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, {backgroundColor: '#22c55e'}]} />
                <AppText tone="secondary">{t('Home', 'Home')}</AppText>
              </View>
              <AppText weight="semibold">
                {formatCurrency(
                  forecastData.breakdown.home.avg_cost_per_kwh,
                  3,
                )}
                /kWh · {fmtNumber(forecastData.breakdown.home.pct, 0)}%
              </AppText>
            </View>
            <View style={styles.spaceBetween}>
              <View style={styles.legendItem}>
                <View
                  style={[styles.legendDot, {backgroundColor: HUE_AMBER}]}
                />
                <AppText tone="secondary">
                  {t('Supercharger', 'Supercharger')}
                </AppText>
              </View>
              <AppText weight="semibold">
                {formatCurrency(
                  forecastData.breakdown.supercharger.avg_cost_per_kwh,
                  3,
                )}
                /kWh · {fmtNumber(forecastData.breakdown.supercharger.pct, 0)}%
              </AppText>
            </View>
          </View>
        ) : (
          <EmptyState
            title={t('costAnalysis.forecast.breakdown', 'Charging Breakdown')}
            message={t(
              'costAnalysis.forecast.noBreakdown',
              'Breakdown will appear once charging data is available.',
            )}
          />
        )}
      </GlassPanel>

      {/* Savings */}
      <GlassPanel style={styles.panel}>
        <SectionTitle
          glyph="⛽"
          glyphColor={HUE_GREEN}
          title={t('costAnalysis.forecast.savings', 'Gas vs EV Savings')}
        />
        {forecastData ? (
          <View style={styles.gap12}>
            <View style={styles.savingsHero}>
              <AppText
                variant="caption"
                tone="muted"
                style={styles.subhead}>
                {t('costAnalysis.forecast.monthlySavings', 'Monthly Savings')}
              </AppText>
              <AppText weight="bold" style={styles.savingsHeroValue}>
                {currencySymbol}
                {fmtNumber(forecastData.gas_comparison.monthly_savings, 0)}
              </AppText>
            </View>
            <View style={styles.comparisonGrid}>
              <GlassPanel style={styles.comparisonTile}>
                <AppText style={styles.tiny} tone="muted">
                  {t('costAnalysis.forecast.annual', 'Annual')}
                </AppText>
                <AppText weight="semibold" style={styles.smallStat}>
                  {formatCurrency(
                    forecastData.gas_comparison.annual_savings,
                    0,
                  )}
                </AppText>
              </GlassPanel>
              <GlassPanel style={styles.comparisonTile}>
                <AppText style={styles.tiny} tone="muted">
                  {t('costAnalysis.forecast.lifetime', 'Lifetime')}
                </AppText>
                <AppText weight="semibold" style={styles.smallStat}>
                  {formatCurrency(
                    forecastData.gas_comparison.lifetime_savings,
                    0,
                  )}
                </AppText>
              </GlassPanel>
            </View>
            <View style={styles.gap4}>
              <KVRow
                label={t('costAnalysis.forecast.gasCost', 'Gas cost/mo')}
                value={formatCurrency(
                  forecastData.gas_comparison.gas_cost_per_month,
                  2,
                )}
                valueColor={HUE_RED}
              />
              <KVRow
                label={t('costAnalysis.forecast.evCost', 'EV cost/mo')}
                value={formatCurrency(
                  forecastData.gas_comparison.ev_cost_per_month,
                  2,
                )}
                valueColor={HUE_GREEN}
              />
              <KVRow
                label={t('costAnalysis.forecast.avgKm', 'Avg km/mo')}
                value={fmtNumber(
                  forecastData.gas_comparison.avg_km_per_month,
                  0,
                )}
              />
            </View>
          </View>
        ) : (
          <EmptyState
            title={t('costAnalysis.forecast.savings', 'Gas vs EV Savings')}
            message={t(
              'costAnalysis.forecast.noSavings',
              'Savings data will appear once driving history is available.',
            )}
          />
        )}
      </GlassPanel>

      {/* Insights */}
      <GlassPanel style={styles.panel}>
        <SectionTitle
          glyph="💡"
          glyphColor={HUE_AMBER}
          title={t('costAnalysis.forecast.insights', 'Insights')}
        />
        {insights.length > 0 ? (
          <View style={styles.gap8}>
            {insights.map((insight, i) => (
              <View key={i} style={styles.insightRow}>
                <AppText style={[styles.titleGlyph, {color: HUE_AMBER}]}>
                  ⚡
                </AppText>
                <AppText tone="secondary" style={styles.flex1}>
                  {insight}
                </AppText>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            title={t('costAnalysis.forecast.insights', 'Insights')}
            message={t(
              'costAnalysis.forecast.noInsights',
              'Insights will appear as more data is collected.',
            )}
          />
        )}
      </GlassPanel>
    </View>
  );
}

function CostForecastSection({
  forecastData,
  palette,
  formatCurrency,
  currencySymbol,
}: {
  forecastData: CostForecastData | undefined;
  palette: readonly string[];
  formatCurrency: Formatter;
  currencySymbol: string;
}) {
  const historicalData = forecastData?.historical ?? [];
  const forecast = forecastData?.forecast ?? [];
  const hasForecast = historicalData.length >= 3 && forecast.length > 0;
  const hasCostPerKwhTrend = historicalData.length > 1;

  return (
    <View style={styles.gap16}>
      <GlassPanel style={styles.panelLg}>
        <SectionTitle
          glyph="↗"
          glyphColor={HUE_PURPLE}
          title={t('costAnalysis.forecast.title', 'Cost Forecast')}
        />
        {hasForecast ? (
          <MiniBars
            data={[
              ...historicalData.map(h => ({label: h.month, value: h.cost})),
              ...forecast.map(f => ({label: f.month, value: f.cost})),
            ]}
            color={palette[0]}
            formatValue={v => formatCurrency(v, 2)}
            formatTick={v => formatCurrency(v, 0)}
          />
        ) : (
          <EmptyState
            title={t('costAnalysis.forecast.title', 'Cost Forecast')}
            message={t(
              'costAnalysis.forecast.needData',
              'Need at least 3 months of charging data for cost forecasting.',
            )}
          />
        )}
      </GlassPanel>

      <ForecastDetails
        forecastData={forecastData}
        formatCurrency={formatCurrency}
        currencySymbol={currencySymbol}
      />

      <GlassPanel style={styles.panelLg}>
        <AppText weight="semibold" style={styles.titleText}>
          {t('costAnalysis.forecast.costPerKwhTrend', 'Cost per kWh Trend')}
        </AppText>
        {hasCostPerKwhTrend ? (
          <View style={styles.mt12}>
            <MiniBars
              data={historicalData.map(h => ({
                label: h.month,
                value: h.cost_per_kwh,
              }))}
              color="#06b6d4"
              formatValue={v => formatCurrency(v, 3)}
              formatTick={v => formatCurrency(v, 2)}
            />
          </View>
        ) : (
          <EmptyState
            title={t('costAnalysis.forecast.costPerKwhTrend', 'Cost per kWh Trend')}
            message={t(
              'costAnalysis.forecast.needTrendData',
              'Need at least 2 months of charging data to show the cost per kWh trend.',
            )}
          />
        )}
      </GlassPanel>
    </View>
  );
}

/* ─── 9. Lifetime summary (web LifetimeSummary) ───────────────────────────── */

function LifetimeMetric({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.lifetimeTile}>
      <AppText style={styles.tiny} tone="muted" numberOfLines={1}>
        {label}
      </AppText>
      <AppText weight="semibold" style={styles.lifetimeValue}>
        {value}
      </AppText>
    </View>
  );
}

function LifetimeSummary({
  lifetimeMetrics,
  coreStats,
  formatCurrency,
}: {
  lifetimeMetrics: LifetimeMetrics | null;
  coreStats: CoreStats | null;
  formatCurrency: Formatter;
}) {
  return (
    <GlassPanel style={styles.panel}>
      <SectionTitle
        glyph="↗"
        glyphColor={HUE_CYAN}
        title={t('costAnalysis.lifetime.title', 'Lifetime Summary')}
      />
      {lifetimeMetrics && coreStats ? (
        <View style={styles.tileGrid}>
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
      ) : (
        <ChartEmpty message={t('costAnalysis.lifetime.noData', 'No data')} height={128} />
      )}
    </GlassPanel>
  );
}

/* ─── 10. Environmental impact (web EnvironmentalImpact) ───────────────────── */

function EnvironmentalImpact({coreStats}: {coreStats: CoreStats | null}) {
  return (
    <GlassPanel style={styles.panel}>
      <SectionTitle
        glyph="🌿"
        glyphColor={HUE_GREEN}
        title={t('costAnalysis.environment.title', 'Environmental Impact')}
      />
      {coreStats ? (
        <View style={styles.gap12}>
          <View style={styles.comparisonGrid}>
            <View style={styles.ecoTile}>
              <AppText weight="bold" style={[styles.ecoValue, {color: HUE_GREEN}]}>
                {fmtNumber(coreStats.co2SavedKg, 1)}
              </AppText>
              <AppText variant="caption" tone="muted">
                {t('costAnalysis.environment.kgCo2', 'kg CO₂ saved')}
              </AppText>
            </View>
            <View style={styles.ecoTile}>
              <AppText weight="bold" style={[styles.ecoValue, {color: HUE_GREEN}]}>
                {fmtNumber(coreStats.treeEquiv, 1)}
              </AppText>
              <AppText variant="caption" tone="muted">
                {t('costAnalysis.environment.treeEquiv', 'tree-years equivalent')}
              </AppText>
            </View>
          </View>
          <View style={styles.ecoNote}>
            <AppText style={styles.titleGlyph}>🌳</AppText>
            <AppText tone="secondary" style={styles.flex1}>
              {t(
                'costAnalysis.environment.desc',
                'By driving electric instead of a gas car, you have avoided the equivalent of',
              )}{' '}
              <AppText weight="semibold" style={{color: HUE_GREEN}}>
                {fmtNumber(coreStats.co2SavedKg, 0)} kg
              </AppText>{' '}
              {t('costAnalysis.environment.ofCo2', 'of CO₂ emissions.')}{' '}
              {t('costAnalysis.environment.treeNote', "That's the same as")}{' '}
              <AppText weight="semibold" style={{color: HUE_GREEN}}>
                {fmtNumber(coreStats.treeEquiv, 1)}
              </AppText>{' '}
              {t(
                'costAnalysis.environment.treesAbsorbing',
                'trees absorbing carbon for a full year.',
              )}
            </AppText>
          </View>
          <View style={styles.threeUp}>
            <View style={styles.threeUpItem}>
              <AppText weight="semibold" style={styles.smallStat}>
                {fmtNumber(coreStats.gallonsEquiv, 1)}
              </AppText>
              <AppText style={styles.tiny} tone="muted">
                {t('costAnalysis.environment.gallons', 'gallons avoided')}
              </AppText>
            </View>
            <View style={styles.threeUpItem}>
              <AppText weight="semibold" style={styles.smallStat}>
                {fmtNumber(coreStats.co2SavedKg / 1000, 2)}
              </AppText>
              <AppText style={styles.tiny} tone="muted">
                {t('costAnalysis.environment.metricTons', 'metric tons CO₂')}
              </AppText>
            </View>
            <View style={styles.threeUpItem}>
              <AppText weight="semibold" style={styles.smallStat}>
                {fmtNumber(coreStats.savings, 0)}
              </AppText>
              <AppText style={styles.tiny} tone="muted">
                {t('costAnalysis.environment.dollarsSaved', '$ saved total')}
              </AppText>
            </View>
          </View>
        </View>
      ) : (
        <ChartEmpty
          message={t('costAnalysis.environment.noData', 'No data')}
          height={128}
        />
      )}
    </GlassPanel>
  );
}

/* ─── Loading skeleton (web LoadingSkeleton) ──────────────────────────────── */

function SkeletonBar({
  width,
  height,
  style,
}: {
  width: DimensionValue;
  height: number;
  style?: object;
}) {
  return <View style={[styles.skeleton, {width, height}, style]} />;
}

function LoadingSkeleton() {
  return (
    <ScrollView
      testID="cost-analysis-loading"
      contentContainerStyle={styles.scrollContent}>
      <View style={styles.gap8}>
        <SkeletonBar width={220} height={28} />
        <SkeletonBar width="80%" height={16} />
      </View>
      <View style={styles.summaryGrid}>
        {Array.from({length: 6}).map((_, i) => (
          <GlassPanel key={i} style={styles.statBox}>
            <SkeletonBar width="60%" height={14} />
            <SkeletonBar width="80%" height={24} style={styles.mt8} />
            <SkeletonBar width="40%" height={12} style={styles.mt8} />
          </GlassPanel>
        ))}
      </View>
      <View style={styles.chartsRow}>
        <GlassPanel style={[styles.panel, styles.flex1]}>
          <SkeletonBar width="40%" height={16} />
          <SkeletonBar width="100%" height={180} style={styles.mt12} />
        </GlassPanel>
        <GlassPanel style={[styles.panel, styles.flex1]}>
          <SkeletonBar width="40%" height={16} />
          <SkeletonBar width="100%" height={180} style={styles.mt12} />
        </GlassPanel>
      </View>
      <GlassPanel style={styles.panel}>
        <SkeletonBar width="30%" height={16} />
        <View style={[styles.gap8, styles.mt12]}>
          {Array.from({length: 5}).map((_, i) => (
            <SkeletonBar key={i} width="100%" height={32} />
          ))}
        </View>
      </GlassPanel>
    </ScrollView>
  );
}

/* ─── Header controls (web VehicleSelect + RangePicker) ───────────────────── */

interface VehicleOption {
  id: number;
  label: string;
}

function VehicleSelect({
  options,
  value,
  onChange,
}: {
  options: VehicleOption[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  if (options.length === 0) {
    return null;
  }
  return (
    <View testID="cost-analysis-vehicle-select" style={styles.pillRow}>
      {options.map(opt => {
        const active = opt.id === value;
        return (
          <Pressable
            key={opt.id}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            onPress={() => onChange(opt.id)}
            style={[styles.pill, active && styles.pillActive]}>
            <AppText
              variant="caption"
              tone={active ? 'accent' : 'secondary'}
              numberOfLines={1}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function isoToday(): string {
  return new Date().toISOString().split('T')[0];
}

function RangePicker({
  value,
  onChange,
}: {
  value: {start: string; end: string};
  onChange: (r: {start: string; end: string}) => void;
}) {
  const presets: {label: string; days: number}[] = [
    {label: '30D', days: 30},
    {label: '90D', days: 90},
    {label: '1Y', days: 365},
  ];
  return (
    <View testID="cost-analysis-range" style={styles.rangeRow}>
      <AppText variant="caption" tone="muted" numberOfLines={1}>
        {value.start} → {value.end}
      </AppText>
      <View style={styles.pillRow}>
        {presets.map(p => (
          <Pressable
            key={p.label}
            accessibilityRole="button"
            onPress={() => onChange({start: isoDaysAgo(p.days), end: isoToday()})}
            style={styles.pill}>
            <AppText variant="caption" tone="secondary">
              {p.label}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */

export default function CostAnalysisPage() {
  // usePageTitle (document.title) has no native analogue — the same translated
  // title renders in the on-screen header below.
  const pageTitle = t('costAnalysis.title', 'Cost Analysis');

  const settingsQuery = useSettings();
  const settings: AppSettings | undefined = settingsQuery.data;
  const isMiles = settings?.unit_of_length === 'mi';
  const distanceUnit = deriveDistance(settings?.unit_of_length);
  const palette = resolveChartPalette(settings?.chart_palette);
  const gasUnitLabel = settings?.gas_unit === 'liter' ? 'L' : 'gal';

  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;
  const formatCurrency = useCallback<Formatter>(
    (amount, decimals) =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    [currencySymbol, userPrecision],
  );

  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, distanceUnit),
    [distanceUnit],
  );

  // Header VehiclePicker is the source of truth in web; native stand-in keeps
  // the `vehicleId` name as local selection seeded to the first vehicle.
  const {data: vehicles} = useVehicles();
  const vehicleList = useMemo(() => vehicles ?? [], [vehicles]);
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  useEffect(() => {
    if (vehicleId == null && vehicleList.length > 0) {
      setVehicleId(vehicleList[0].id);
    }
  }, [vehicleId, vehicleList]);
  const vehicleOptions: VehicleOption[] = vehicleList.map(v => ({
    id: v.id,
    label: v.display_name,
  }));

  // ── Filters ──────────────────────────────────────────────────────────
  const defaultStartDate = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEndDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const setRangeBatch = useCallback((r: {from?: string; to?: string}) => {
    if (r.from !== undefined) {
      setStartDate(r.from);
    }
    if (r.to !== undefined) {
      setEndDate(r.to);
    }
  }, []);

  // ── Gas calculator inputs ────────────────────────────────────────────
  const [gasPrice, setGasPrice] = useState(DEFAULT_GAS_PRICE);
  const [mpg, setMpg] = useState(DEFAULT_MPG);
  const [electricityRate, setElectricityRate] = useState(
    DEFAULT_ELECTRICITY_RATE,
  );

  const {data: sessions, isLoading} = useChargingSessionsPaginated(vehicleId, {
    limit: 5000,
    start: startDate,
    end: endDate,
  });
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;
  const {data: forecastData} = useCostForecast(vehicleIdStr);

  const {
    coreStats,
    monthlyData,
    costPerKwhTrend,
    chargerTypeData,
    hourlyData,
    touInsights,
    gasComparison,
    lifetimeMetrics,
  } = useCostAnalysisData({
    sessions,
    gasPrice,
    mpg,
    electricityRate,
    toDistanceDisplay,
    isMiles,
  });

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (!sessions || sessions.length === 0) {
    return (
      <View testID="cost-analysis-empty" style={styles.emptyRoot}>
        <EmptyState
          title={t('costAnalysis.empty.title', 'No Charging Data')}
          message={t(
            'costAnalysis.empty.message',
            'Start charging your vehicle to see cost analysis and savings trends.',
          )}
        />
      </View>
    );
  }

  return (
    <ScrollView
      testID="cost-analysis-page"
      contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.header}>
        <AppText variant="title" weight="bold">
          {pageTitle}
        </AppText>
        <AppText tone="muted">
          {t(
            'costAnalysis.subtitle',
            'Electricity cost trends, gas savings, and charging economics',
          )}
        </AppText>
        <View style={styles.actions}>
          <VehicleSelect
            options={vehicleOptions}
            value={vehicleId}
            onChange={setVehicleId}
          />
          <RangePicker
            value={{start: startDate, end: endDate}}
            onChange={r => setRangeBatch({from: r.start, to: r.end})}
          />
        </View>
      </View>

      <CostSummaryCards
        coreStats={coreStats}
        gasPrice={gasPrice}
        distanceUnit={distanceUnit}
        isMiles={isMiles}
        formatCurrency={formatCurrency}
        gasUnitLabel={gasUnitLabel}
      />

      <View style={styles.chartsRow}>
        <View style={styles.flex1}>
          <MonthlyCostChart
            data={monthlyData}
            palette={palette}
            formatCurrency={formatCurrency}
          />
        </View>
        <View style={styles.flex1}>
          <CostPerKwhChart
            data={costPerKwhTrend}
            palette={palette}
            formatCurrency={formatCurrency}
          />
        </View>
      </View>

      <ChargerTypeBreakdown
        data={chargerTypeData}
        totalCost={coreStats?.totalCost ?? 1}
        formatCurrency={formatCurrency}
      />

      <SavingsCalculator
        gasComparison={gasComparison}
        gasPrice={gasPrice}
        mpg={mpg}
        electricityRate={electricityRate}
        onGasPriceChange={setGasPrice}
        onMpgChange={setMpg}
        onElectricityRateChange={setElectricityRate}
        distanceUnit={distanceUnit}
      />

      <MonthlyCostTable data={monthlyData} formatCurrency={formatCurrency} />

      <TimeOfUseAnalysis hourlyData={hourlyData} touInsights={touInsights} />

      <AICostForecastNarration vehicleId={vehicleId ?? undefined} />

      <CostForecastSection
        forecastData={forecastData}
        palette={palette}
        formatCurrency={formatCurrency}
        currencySymbol={currencySymbol}
      />

      <View style={styles.chartsRow}>
        <View style={styles.flex1}>
          <LifetimeSummary
            lifetimeMetrics={lifetimeMetrics}
            coreStats={coreStats}
            formatCurrency={formatCurrency}
          />
        </View>
        <View style={styles.flex1}>
          <EnvironmentalImpact coreStats={coreStats} />
        </View>
      </View>
    </ScrollView>
  );
}

CostAnalysisPage.displayName = 'CostAnalysisPage';

const styles = StyleSheet.create({
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  axisTick: {
    fontSize: 10,
    lineHeight: 14,
  },
  bar: {
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    flex: 1,
    minWidth: 0,
  },
  barsArea: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 2,
    height: BARS_HEIGHT,
  },
  chartEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chartsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  comparisonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  comparisonTile: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: 2,
    padding: 12,
  },
  comparisonValue: {
    fontSize: 20,
    lineHeight: 26,
    marginVertical: 2,
  },
  ecoNote: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  ecoTile: {
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    borderRadius: 12,
    flexBasis: '47%',
    flexGrow: 1,
    gap: 4,
    padding: 16,
  },
  ecoValue: {
    fontSize: 24,
    lineHeight: 30,
  },
  emptyRoot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  flex1: {
    flex: 1,
    minWidth: 260,
  },
  gap4: {
    gap: 4,
  },
  gap8: {
    gap: 8,
  },
  gap12: {
    gap: 12,
  },
  gap16: {
    gap: 16,
  },
  header: {
    gap: 4,
  },
  input: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
  },
  inputSuffix: {
    paddingRight: 12,
  },
  insightRow: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    padding: 12,
  },
  legendDot: {
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  lifetimeTile: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flexBasis: '47%',
    flexGrow: 1,
    gap: 2,
    padding: 12,
  },
  lifetimeValue: {
    fontSize: 14,
    lineHeight: 20,
  },
  mt8: {
    marginTop: 8,
  },
  mt12: {
    marginTop: 12,
  },
  panel: {
    gap: spacing.sm,
    padding: 16,
  },
  panelLg: {
    gap: spacing.sm,
    padding: 20,
  },
  pill: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  plotColumn: {
    flex: 1,
    gap: 4,
  },
  progressFill: {
    borderRadius: 999,
    height: '100%',
  },
  progressTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  rangeRow: {
    gap: 6,
  },
  savingsHero: {
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
    padding: 16,
  },
  savingsHeroValue: {
    color: HUE_EMERALD,
    fontSize: 30,
    lineHeight: 36,
  },
  scrollContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
  },
  smallStat: {
    fontSize: 18,
    lineHeight: 24,
  },
  spaceBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statBox: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: 16,
  },
  statBoxRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statBoxText: {
    flex: 1,
    minWidth: 0,
  },
  statGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  statIconBox: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
    padding: 8,
  },
  statLabel: {
    marginBottom: 2,
  },
  statSub: {
    marginTop: 2,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
  },
  subhead: {
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tableCell: {
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  tableHeaderRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
  },
  tableRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  threeUp: {
    flexDirection: 'row',
    gap: 8,
  },
  threeUpItem: {
    alignItems: 'center',
    flex: 1,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  tiny: {
    fontSize: 10,
    lineHeight: 14,
  },
  titleGlyph: {
    fontSize: 16,
    lineHeight: 20,
    marginTop: 1,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  titleText: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  xAxis: {
    flexDirection: 'row',
    gap: 2,
  },
  xTickCell: {
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  yAxis: {
    alignItems: 'flex-end',
    height: BARS_HEIGHT,
    justifyContent: 'space-between',
    width: 40,
  },
});
