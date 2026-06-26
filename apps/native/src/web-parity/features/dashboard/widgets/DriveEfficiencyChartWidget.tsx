// Native parity port of
// web/src/features/dashboard/widgets/DriveEfficiencyChartWidget.tsx.
//
// A dashboard widget that charts a vehicle's recent drive efficiency. It pulls
// the last 60 drives, filters to the last 30 days, estimates Wh/km for each
// drive (energy ÷ distance, with a battery-pct fallback), groups them into
// daily averages plus a 7-day rolling average, then renders a two-series area
// chart (daily efficiency + rolling average) with an Avg / Best day / Trend
// summary row. The compact (1×1) layout drops the chart and shows just the
// summary stats; the standard/wide layout shows both. When no efficiency data
// can be derived, the section never hides — it falls back to an EmptyState
// inside the WidgetChartSummary (preserving the web's `isEmpty` contract).
//
// The web original leans on browser-only / not-yet-ported infrastructure, so —
// following the established conversion idiom (BatteryHealthAnalyticsWidget /
// ChargingOptimizerWidget) — every such dependency is reproduced inline with
// React Native primitives + the shared native building blocks and documented in
// the sidecar:
//
//   - Recharts (AreaChart/Area/XAxis/YAxis/ResponsiveContainer/Tooltip/
//     ReferenceLine) + the chart helpers (chartGrid, axisTick/axisTickSm,
//     chartAnimation, fmt, AREA_DEFAULTS, areaGradient) + ChartTooltip are all
//     DOM/SVG-only and cannot run in React Native. They are replaced by the
//     existing native `AreaChartWrapper` charts port, which renders the area
//     series, axes, and a built-in legend (with each series' latest value). The
//     web's amber `ReferenceLine` at the overall average has no native
//     reference-line layer; that value is already surfaced as the "Avg" summary
//     stat, so the information is preserved. The web's manual bottom legend
//     (Daily / 7-day avg dots) maps onto the wrapper's built-in legend row.
//     `fmt` is inlined verbatim (fmtNumber at the given precision) and threaded
//     to the chart's yFormatter exactly as the web YAxis tickFormatter used it.
//   - useThemeChartPalette (web @/components/charts) -> the native charts-barrel
//     port of the same hook; `palette.series[0]` drives the daily series colour
//     exactly as the web does. The rolling-average series keeps the web's
//     hard-coded amber (#f59e0b).
//   - WidgetShell (web .../WidgetShell.tsx) has no native port yet, so its
//     structure is inlined as `WidgetShell`: loading -> a skeleton block; error
//     -> a centred error box with a retry Pressable (mirrors the web
//     <QueryError>); otherwise either a titled header (icon + uppercase muted
//     title + freshness chip) over the children, or — when title-less (the
//     compact branch) — the children with the freshness chip overlaid top-right,
//     exactly like the web shell. Only the props this widget passes (title,
//     icon, loading, error, updatedAt, isFetching, isStale, isError, onRefresh,
//     noPadding) are honoured; help/widgetId/PinButton/HelpTooltip extras are
//     out of scope. `noPadding` toggles the body padding as the web shell does.
//   - DataFreshness (web data-display) — the 4-state (fresh/fetching/stale/
//     error) chip the shell renders — is reproduced inline as `WidgetFreshness`:
//     same isError>fetching>stale>fresh precedence, the same dot colour tiers,
//     the "just now / Nm/Nh/Nd/Nw ago" relative ladder, "updating…"/"error"
//     labels, a 30s re-render tick, and onRefresh wired to a Pressable.
//   - WidgetChartSummary + ChartSummaryStat (web .../shared) -> inline
//     `WidgetChartSummary` + local `ChartSummaryStat`: same isEmpty ->
//     EmptyState fallback, the same stat row (label + value + optional unit),
//     and the chart rendered below only when !compact. The web emptyIcon
//     (TrendingUp) has no native EmptyState slot and is dropped (the trend
//     signal is preserved by the shell header glyph).
//   - feedback EmptyState -> shared native EmptyState (web's single `message`
//     becomes the native `title`).
//   - @/hooks/useUnits -> inline `useUnits` (derives `unitPrefs.distance` from
//     the native useSettings exactly as web useUnits' deriveDistance does:
//     unit_of_length === 'mi' -> 'mi' else 'km'). This widget only reads
//     `unitPrefs.distance`, so the mirror exposes just that pref.
//   - @/lib/unitConversion convertDistanceFromSI -> inlined verbatim (km = m/1000,
//     mi = m/1609.344) with the NIST metre constants.
//   - @/hooks/useDateFormat formatDateShort -> inline `formatDateShort` mirroring
//     web lib/dateFormat.formatDateShort (month short + day numeric, '—' on
//     invalid). The web hook is locale/tz-aware; the native mirror uses the
//     device locale (no settings-bound tz wiring), which is the faithful
//     unconfigured default.
//   - @/lib/numberFormat fmtNumber is inlined verbatim (safeNumber guard,
//     en-US grouping, default precision 2) without useSettings-driven global
//     precision/locale wiring.
//   - lucide-react TrendingUp has no native icon font; the wide-header icon
//     becomes a small cyan "↗" glyph (the meaningful efficiency-trend signal),
//     and the EmptyState TrendingUp icon is dropped as noted above.
//   - react-i18next useTranslation('dashboard') -> a native English-default `t`
//     that keeps every widget.driveEfficiencyChart.* / freshness.* key + the
//     {{var}} interpolation intact.
//
// The drives query is preserved unchanged: `useQuery` (TanStack) with the same
// queryKey (['drives', id, 'efficiency-chart-60']), the same queryFn calling
// `request<Drive[]>('/drives?vehicle_id=${id}&limit=60')` against the native API
// client, the same `enabled: id > 0` and `staleTime: 120_000`. useVehicles() is
// called unchanged for the vehicle fallback. State names (vehicles, id,
// unitPrefs, efficiencyUnit, formatDateShort, drives, isLoading, error,
// isFetching, isStale, isError, dataUpdatedAt, refetch, chartData, displayData,
// overallAvg, bestDay, trend, isCompact, palette, stats) are preserved. Pure
// helpers (estimateEfficiency, buildDailyEfficiency, DailyEfficiency) are ported
// verbatim. No DOM, react-router, framer-motion, lucide-react, Recharts,
// Leaflet, or old web UI components are imported into the native output.

import React, {useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {AreaChartWrapper} from '../../../components/charts/AreaChartWrapper';
import {useThemeChartPalette} from '../../../components/charts';
import {request} from '../../../api/client';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';
import type {ApiDrive as Drive} from '../../../api/hooks/useDriving';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this fallback returns that default
// while keeping every widget.*/freshness.* key verbatim and applying the same
// {{var}} interpolation as the web `t` (useTranslation('dashboard')).
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

/* ─── Inlined formatters (web @/lib/numberFormat) ─────────────────────────── */

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber — locale-grouped, fixed precision. The web global precision
// defaults to 2 (set by useSettings, which this widget does not wire), so 2 is
// the faithful unconfigured default.
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// web charts `fmt` — fmtNumber at the given precision (default 1). Threaded to
// the chart yFormatter exactly as the web YAxis tickFormatter used `fmt(v, 0)`.
function fmt(v: unknown, decimals = 1): string {
  return fmtNumber(v, decimals);
}

/* ─── Inlined unit handling (mirror web useUnits + lib/unitConversion) ─────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';

interface UnitPrefs {
  distance: DistanceUnitPref;
}

// NIST metre constants (web lib/unitConversion).
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;

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

// Mirrors web useUnits: derive the distance preference from useSettings exactly
// as web's deriveDistance does (unit_of_length === 'mi' -> 'mi' else 'km').
// This widget only reads `unitPrefs.distance`, so the mirror exposes just it.
function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  const distance: DistanceUnitPref =
    settings?.unit_of_length === 'mi' ? 'mi' : 'km';
  return useMemo(() => ({unitPrefs: {distance}}), [distance]);
}

/* ─── Inlined date formatter (mirror web @/lib/dateFormat formatDateShort) ─── */

// web formatDateShort: "Jun 26" — month short + day numeric, '—' on invalid.
// The web hook threads a settings-bound locale/tz; the native mirror uses the
// device locale (the faithful unconfigured default).
function formatDateShort(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '\u2014';
  }
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

/* ─── Widget contract types (web .../types.ts subset) ─────────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── Chart summary types (web .../shared WidgetChartSummary) ──────────────── */

interface ChartSummaryStat {
  label: string;
  value: string | number;
  unit?: string;
}

/* ─── Daily efficiency model + pure helpers (web source L23-92) ───────────── */

interface DailyEfficiency {
  date: string;
  label: string;
  efficiency: number;
  rollingAvg: number | null;
}

/** Estimate Wh/km for a single drive from energy + distance data. */
function estimateEfficiency(d: Drive): number | null {
  const distanceKm = convertDistanceFromSI(d.distance_m ?? 0, 'km');
  if (!distanceKm || distanceKm < 0.8) {
    return null; // skip tiny drives
  }

  if (d.energy_used_wh != null && d.energy_used_wh > 0) {
    const whPerKm = d.energy_used_wh / distanceKm;
    if (whPerKm < 30 || whPerKm > 500) {
      return null;
    }
    return whPerKm;
  }

  // Fallback: estimate from battery pct
  const startBatt = d.start_soc_pct;
  const endBatt = d.end_soc_pct;
  if (startBatt == null || endBatt == null) {
    return null;
  }
  const battUsed = startBatt - endBatt;
  if (battUsed <= 0) {
    return null;
  }
  const whPerKm = (battUsed * 0.75 * 1000) / distanceKm;
  if (whPerKm < 30 || whPerKm > 500) {
    return null;
  }
  return whPerKm;
}

/** Group drives by date and compute daily averages + rolling average. */
function buildDailyEfficiency(
  drives: Drive[],
  windowSize: number,
  fmtShortDate: (iso: string) => string,
): DailyEfficiency[] {
  const byDate = new Map<string, number[]>();

  for (const d of drives) {
    if (!d.start_ts) {
      continue;
    }
    const eff = estimateEfficiency(d);
    if (eff == null) {
      continue;
    }
    const dateKey = d.start_ts.slice(0, 10); // YYYY-MM-DD
    const existing = byDate.get(dateKey);
    if (existing) {
      existing.push(eff);
    } else {
      byDate.set(dateKey, [eff]);
    }
  }

  // Sort by date ascending
  const sorted = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  const dailyAvgs = sorted.map(([date, values]) => ({
    date,
    avg: values.reduce((s, v) => s + v, 0) / values.length,
  }));

  // Compute rolling average
  return dailyAvgs.map((entry, i) => {
    const windowStart = Math.max(0, i - windowSize + 1);
    const window = dailyAvgs.slice(windowStart, i + 1);
    const rollingAvg =
      window.length >= 2
        ? window.reduce((s, w) => s + w.avg, 0) / window.length
        : null;

    return {
      date: entry.date,
      label: fmtShortDate(entry.date + 'T00:00:00'),
      efficiency: Math.round(entry.avg * 10) / 10,
      rollingAvg: rollingAvg != null ? Math.round(rollingAvg * 10) / 10 : null,
    };
  });
}

/* ─── WidgetFreshness (web data-display DataFreshness 4-state chip) ────────── */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

// web FRESHNESS_COLORS dot tiers (emerald-400 / sky-400 / amber-400 / red-400).
const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: '#34d399',
  fetching: '#38bdf8',
  stale: '#fbbf24',
  error: '#f87171',
};

// web DataFreshness.formatRelativeTime — minute/hour/day/week relative ladder.
function formatFreshnessRelative(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return t('freshness.minutes', '{{m}}m ago', {m: Math.floor(seconds / 60)});
  }
  if (seconds < 86_400) {
    return t('freshness.hours', '{{h}}h ago', {h: Math.floor(seconds / 3600)});
  }
  if (seconds < 604_800) {
    return t('freshness.days', '{{d}}d ago', {d: Math.floor(seconds / 86_400)});
  }
  return t('freshness.weeks', '{{w}}w ago', {w: Math.floor(seconds / 604_800)});
}

function useThirtySecondTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [active]);
}

function WidgetFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  useThirtySecondTick(!!updatedAt && updatedAt > 0);

  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';

  const relativeTime =
    updatedAt && updatedAt > 0 && !isFetching
      ? formatFreshnessRelative(updatedAt)
      : isFetching
        ? t('freshness.updating', 'updating\u2026')
        : isError
          ? t('freshness.error', 'error')
          : '';

  const refreshable = !!onRefresh && !isFetching;

  return (
    <Pressable
      accessibilityRole={onRefresh ? 'button' : 'text'}
      accessibilityLabel={
        onRefresh
          ? t('freshness.refresh', 'Refresh')
          : t('a11y.dataFreshness', 'Data freshness: {{state}}', {
              state: status,
            })
      }
      accessibilityState={{disabled: !refreshable}}
      disabled={!refreshable}
      onPress={() => {
        if (refreshable) {
          onRefresh?.();
        }
      }}
      testID="drive-efficiency-chart-freshness"
      style={styles.freshness}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="drive-efficiency-chart-freshness-dot"
      />
      {relativeTime ? (
        <AppText
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={styles.freshnessLabel}>
          {relativeTime}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── WidgetShell (web .../WidgetShell.tsx subset) ────────────────────────── */

function WidgetShell({
  title,
  icon,
  loading,
  error,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  noPadding,
  children,
}: {
  title?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  noPadding?: boolean;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <View style={styles.skeleton} testID="drive-efficiency-chart-loading" />
    );
  }

  if (error) {
    return (
      <View style={styles.errorBox} testID="drive-efficiency-chart-error">
        <AppText tone="danger" weight="semibold" numberOfLines={3}>
          {error}
        </AppText>
        {onRefresh ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRefresh}
            testID="drive-efficiency-chart-error-retry">
            <AppText variant="caption" tone="accent">
              {t('common.retry', 'Retry')}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const freshness = (
    <WidgetFreshness
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={onRefresh}
    />
  );

  const body = (
    <View style={[styles.shellBody, noPadding && styles.shellBodyNoPad]}>
      {children}
    </View>
  );

  // Title-less widgets (the compact branch) overlay the freshness chip in the
  // top-right corner, exactly like the web shell.
  if (!title) {
    return (
      <View style={styles.shell} testID="drive-efficiency-chart-widget">
        <View style={styles.freshnessOverlay}>{freshness}</View>
        {body}
      </View>
    );
  }

  return (
    <View style={styles.shell} testID="drive-efficiency-chart-widget">
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleRow}>
          {icon}
          <AppText
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.shellTitle}>
            {title}
          </AppText>
        </View>
        {freshness}
      </View>
      {body}
    </View>
  );
}

/* ─── TrendGlyph (web header lucide TrendingUp, text-cyan-300) ─────────────── */

function TrendGlyph({style}: {style?: StyleProp<ViewStyle>}) {
  return (
    <View style={[styles.trendGlyph, style]} accessibilityElementsHidden>
      <AppText variant="caption" weight="bold" style={styles.trendGlyphText}>
        {'\u2197'}
      </AppText>
    </View>
  );
}

/* ─── WidgetChartSummary (web .../shared WidgetChartSummary) ───────────────── */

function WidgetChartSummary({
  stats,
  chart,
  compact,
  emptyMessage,
  isEmpty,
}: {
  stats: ChartSummaryStat[];
  chart: React.ReactNode;
  compact?: boolean;
  emptyMessage?: string;
  isEmpty?: boolean;
}) {
  if (isEmpty) {
    return (
      <View testID="drive-efficiency-chart-empty">
        <EmptyState title={emptyMessage ?? 'No data available'} message="" />
      </View>
    );
  }

  return (
    <View style={styles.summaryRoot}>
      {stats.length > 0 ? (
        <View
          style={styles.statRow}
          testID="drive-efficiency-chart-stats">
          {stats.map(stat => (
            <View key={stat.label} style={styles.statItem}>
              <AppText
                variant="caption"
                tone="muted"
                numberOfLines={1}
                style={styles.statLabel}>
                {stat.label}
              </AppText>
              <AppText weight="semibold" numberOfLines={1} style={styles.statValue}>
                {stat.value}
                {stat.unit ? (
                  <AppText
                    variant="caption"
                    tone="muted"
                    style={styles.statUnit}>
                    {' '}
                    {stat.unit}
                  </AppText>
                ) : null}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {!compact ? (
        <View style={styles.chartArea} testID="drive-efficiency-chart-plot">
          {chart}
        </View>
      ) : null}
    </View>
  );
}

/* ─── DriveEfficiencyChartWidget ──────────────────────────────────────────── */

export default function DriveEfficiencyChartWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {unitPrefs} = useUnits();
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  const {
    data: drives,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['drives', id, 'efficiency-chart-60'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${id}&limit=60`),
    enabled: id > 0,
    staleTime: 120_000,
  });

  const chartData = useMemo(() => {
    const items = drives ?? [];
    // Filter to last 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const recent = items.filter(
      d => d.start_ts && new Date(d.start_ts) >= cutoff,
    );
    return buildDailyEfficiency(recent, 7, formatDateShort);
  }, [drives]);

  // Convert Wh/km to the user's distance unit.
  const displayData = useMemo<DailyEfficiency[]>(
    () =>
      chartData.map(d => ({
        ...d,
        efficiency:
          Math.round(
            (unitPrefs.distance === 'mi'
              ? d.efficiency * 1.609344
              : d.efficiency) * 10,
          ) / 10,
        rollingAvg:
          d.rollingAvg != null
            ? Math.round(
                (unitPrefs.distance === 'mi'
                  ? d.rollingAvg * 1.609344
                  : d.rollingAvg) * 10,
              ) / 10
            : null,
      })),
    [chartData, unitPrefs.distance],
  );

  const overallAvg = useMemo(() => {
    if (displayData.length === 0) {
      return null;
    }
    const sum = displayData.reduce((s, d) => s + d.efficiency, 0);
    return Math.round((sum / displayData.length) * 10) / 10;
  }, [displayData]);

  const bestDay = useMemo(() => {
    if (displayData.length === 0) {
      return null;
    }
    return displayData.reduce(
      (min, d) => (d.efficiency < min ? d.efficiency : min),
      displayData[0].efficiency,
    );
  }, [displayData]);

  const trend = useMemo(() => {
    if (displayData.length < 4) {
      return null;
    }
    const mid = Math.floor(displayData.length / 2);
    const first = displayData.slice(0, mid);
    const second = displayData.slice(mid);
    const avgFirst = first.reduce((s, d) => s + d.efficiency, 0) / first.length;
    const avgSecond =
      second.reduce((s, d) => s + d.efficiency, 0) / second.length;
    return Math.round(((avgSecond - avgFirst) / avgFirst) * 1000) / 10;
  }, [displayData]);

  const isCompact = size.cols <= 1 && size.rows <= 1;

  // Series colour follows the active theme (web useThemeChartPalette).
  const palette = useThemeChartPalette();

  const stats = useMemo<ChartSummaryStat[]>(() => {
    const items: ChartSummaryStat[] = [
      {
        label: t('widget.driveEfficiencyChart.avg', 'Avg'),
        value: overallAvg != null ? fmtNumber(overallAvg, 0) : '\u2014',
        unit: efficiencyUnit,
      },
      {
        label: t('widget.driveEfficiencyChart.best', 'Best day'),
        value: bestDay != null ? fmtNumber(bestDay, 0) : '\u2014',
        unit: efficiencyUnit,
      },
      {
        label: t('widget.driveEfficiencyChart.trend', 'Trend'),
        value: trend != null ? `${trend > 0 ? '+' : ''}${trend}%` : '\u2014',
      },
    ];
    return items;
  }, [overallAvg, bestDay, trend, efficiencyUnit]);

  // Project the typed display points into the chart wrapper's row shape.
  const chartRows = useMemo<Record<string, unknown>[]>(
    () => displayData.map(d => ({...d})),
    [displayData],
  );

  const chartSeries = useMemo(
    () => [
      {
        key: 'efficiency',
        label:
          t('widget.driveEfficiencyChart.daily', 'Daily') +
          ` (${efficiencyUnit})`,
        color: palette.series[0],
      },
      {
        key: 'rollingAvg',
        label:
          t('widget.driveEfficiencyChart.rolling', '7-day avg') +
          ` (${efficiencyUnit})`,
        color: '#f59e0b',
      },
    ],
    [efficiencyUnit, palette],
  );

  const chartEl = (
    <AreaChartWrapper
      data={chartRows}
      xKey="label"
      series={chartSeries}
      height={180}
      yFormatter={(v: number) => `${fmt(v, 0)}`}
      testID="drive-efficiency-chart-area"
    />
  );

  return (
    <WidgetShell
      title={
        !isCompact
          ? t('widget.driveEfficiencyChart.title', 'Drive Efficiency')
          : undefined
      }
      icon={!isCompact ? <TrendGlyph /> : undefined}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      noPadding={!isCompact}>
      <WidgetChartSummary
        chart={chartEl}
        stats={stats}
        compact={isCompact}
        isEmpty={displayData.length === 0}
        emptyMessage={t(
          'widget.driveEfficiencyChart.empty',
          'No efficiency data yet',
        )}
      />
    </WidgetShell>
  );
}

DriveEfficiencyChartWidget.displayName = 'DriveEfficiencyChartWidget';

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    position: 'relative',
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shellTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  shellBodyNoPad: {
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  freshnessOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 5,
  },
  skeleton: {
    flex: 1,
    minHeight: 96,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  errorBox: {
    flex: 1,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: spacing.sm,
    padding: spacing.md,
  },
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    flexShrink: 0,
  },
  freshnessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  trendGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendGlyphText: {
    color: colors.accent,
  },
  summaryRoot: {
    flex: 1,
    minHeight: 0,
    rowGap: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.lg,
    rowGap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  statItem: {
    flexShrink: 1,
    minWidth: 0,
  },
  statLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  statValue: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  statUnit: {
    fontSize: 10,
  },
  chartArea: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
});
