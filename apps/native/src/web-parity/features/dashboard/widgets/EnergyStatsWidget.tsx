// Native parity port of
// web/src/features/dashboard/widgets/EnergyStatsWidget.tsx.
//
// The web widget is a dashboard "Energy Stats" tile. It resolves the active
// vehicle (vehicleId prop, else the first vehicle, else id 0), fetches an
// energy summary via useEnergyStats(id > 0 ? String(id) : null) (EnergyStats
// with total_energy_used_wh / total_energy_charged_wh / total_wh / total_cost /
// avg_efficiency_wh_per_m / co2_saved_kg + a daily_breakdown[]), derives a
// chartData[] of { date, energy: energy_wh ?? 0 } and a StatGridItem[] of the
// per-period stats, then renders one of two layouts inside a <WidgetShell>:
//   1. Compact (size.cols <= 1): a title-less shell wrapping a centred
//      <AnimatedNumber value={(total_wh ?? 0) / 1000}> with a uppercase
//      unitPrefs.energy ('kWh') caption — or a Zap EmptyState ("No energy data
//      available") when there is no data.
//   2. Standard (size.cols >= 2) / Wide (size.cols >= 3): a titled shell
//      ("Energy Stats" + an amber Zap icon) wrapping a daily-energy area chart
//      (only when chartData has rows) above a <WidgetStatGrid> (2-up, or 3-up +
//      two extra Total Cost / Net Energy stats when wide). A Zap EmptyState
//      replaces the body when there is no data. Combined query freshness
//      (loading / fetching / stale / error / dataUpdatedAt) and a manual refresh
//      feed the shell header.
//
// This native port preserves that contract 1:1 — the same id/useEnergyStats
// resolution, the same chartData (date + energy_wh ?? 0) and stats derivations
// (incl. the toEfficiencyDisplay 1609.344 mi / 1000 km factors, the wide-only
// Total Cost + Net Energy push, and every formatEnergy/fmtNumber call), the same
// isCompact/isWide/hasData/hasChartData branches, the same i18n keys + English
// defaults, and the same visual intent — using React Native primitives, the
// existing native AppText + design tokens, and the already-ported native
// useEnergyStats / useVehicles / useSettings hooks.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime -> inline useNativeTranslation() returns t(key, fallback?) =
//     (fallback ?? key), preserving every key + English default. None of this
//     widget's t() calls use interpolation.
//   - lucide-react Zap / BatteryCharging / Leaf / DollarSign / Route /
//     TrendingUp (web L3): DOM SVG icons -> emoji/glyph stand-ins, tinted via
//     the muted stat-icon / amber title intent.
//   - @/components/charts AreaChart/Area/XAxis/YAxis/Tooltip/ResponsiveContainer
//     + chartGrid/chartMargin/axisTick/axisTickSm/chartAnimation/fmt (web L4-7):
//     Recharts depends on browser DOM/SVG layout and is unavailable in React
//     Native, so the daily-energy area chart is reproduced as a native
//     <EnergyStatsAreaChart> (an energy-axis + per-day filled column
//     approximation built from Views, amber #f59e0b fill mimicking the area's
//     linear gradient + stroke). The web `fmt` helper (fmtNumber, 1dp default)
//     is inlined and drives the YAxis ticks (fmt(v, 1)); the axisTick /
//     axisTickSm font sizes (11 vs 10) drive the native tick sizing; the
//     GRADIENT_ID stop colours (#f59e0b 0.4 -> 0) inform the fill opacity. The
//     hover-only <Tooltip> (formatter `${fmtNumber(value, 2)} kWh`) has no
//     native analogue and is dropped — an accessibilityLabel summarises the
//     series using the same `${fmtNumber(value, 2)} kWh` shape. As in the web
//     source the chart `energy` series is the raw energy_wh value (the YAxis
//     reads Wh while the tooltip suffixes "kWh"); that exact behaviour is
//     preserved rather than "corrected".
//   - @/components/data-display AnimatedNumber (web L8): the DOM count-up
//     <span> -> a native <AnimatedNumber> driving AppText with the same
//     ease-out-quad requestAnimationFrame count-up (Date.now in place of
//     performance.now), the same value/duration/decimals/prefix/suffix props,
//     tabular-nums -> fontVariant, frame cancelled on unmount.
//   - @/components/feedback EmptyState (web L9): reduced to a native centred
//     icon + message View.
//   - @/api/hooks/useEnergy useEnergyStats (web L10): the already-ported
//     web-parity useEnergyStats hook (same /vehicles/{id}/energy?days=30 path,
//     queryKey, enabled) returning EnergyStats.
//   - @/api/hooks/useVehicles useVehicles (web L11): the already-ported
//     web-parity useVehicles hook (same Vehicle[] shape with `.id`).
//   - @/hooks/useUnits useUnits (web L12): not yet ported -> reproduced here as
//     a scoped native useUnits() reading the same web-parity useSettings()
//     query and exposing the consumed unitPrefs (distance derived from
//     unit_of_length 'mi'->'mi' else 'km'; energy fixed to the 'kWh' default)
//     plus a formatEnergy(value, { precision }) that mirrors lib
//     formatEnergy/convertEnergyFromSI (Wh/1000 -> kWh, locale-aware
//     resolvePrecision, '\u2014' empty fallback, DEFAULT_PRECISION.energy = 2).
//   - @/lib/numberFormat fmtNumber (web L13): inlined native locale formatter
//     (en-US default, min=max fraction digits, toFixed fallback).
//   - ./WidgetShell WidgetShell (web L14): reproduced as a native-safe
//     <WidgetShell> — the loading skeleton, error body, the pulse-on-update
//     effect, and the inline DataFreshness chip (dot-only when title-less).
//   - ./shared WidgetStatGrid + StatGridItem (web L15): reproduced as a native
//     <WidgetStatGrid> (StatCard-style cells with label + icon header, value +
//     unit row, optional trend row, EmptyState when empty) and the same
//     StatGridItem shape; the web container-query cols (2 / 3) drive the native
//     flex-basis.
//   - ./types WidgetProps (web L16): the dashboard widget types module is not
//     yet ported, so the consumed subset (WidgetSize { cols, rows } +
//     WidgetProps) is mirrored as local interfaces.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {useEnergyStats} from '../../../api/hooks/useEnergy';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-ins (web L3)                              */
/* ------------------------------------------------------------------ */

const ICON_ZAP = '\u26A1'; // ⚡ (Zap)
const ICON_BATTERY_CHARGING = '\uD83D\uDD0B'; // 🔋 (BatteryCharging)
const ICON_LEAF = '\uD83C\uDF43'; // 🍃 (Leaf)
const ICON_DOLLAR = '\uD83D\uDCB2'; // 💲 (DollarSign)
const ICON_ROUTE = '\uD83D\uDEE3\uFE0F'; // 🛣️ (Route)
const ICON_TRENDING_UP = '\uD83D\uDCC8'; // 📈 (TrendingUp)

// web Area stroke/fill="#f59e0b" (amber-500) — daily energy area series.
const AREA_COLOR = '#f59e0b';
// web defs linearGradient #f59e0b 0.4 -> 0; approximated as a flat translucent
// amber fill (no native gradient primitive without an extra dependency).
const AREA_FILL = 'rgba(245, 158, 11, 0.35)';

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ------------------------------------------------------------------ */
/*  ported: ./types WidgetProps (consumed subset of the web types)     */
/* ------------------------------------------------------------------ */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  ported: ./shared StatGridItem (web shared/WidgetStatGrid)          */
/* ------------------------------------------------------------------ */

export interface StatGridItem {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  valueColor?: string;
}

/* ------------------------------------------------------------------ */
/*  native-safe number formatters (web @/lib/numberFormat + charts fmt) */
/* ------------------------------------------------------------------ */

/** Port of web fmtNumber — locale-aware (en-US default), min=max fractions. */
function fmtNumber(value: unknown, decimals = 2, locale?: string): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const lc = locale ?? 'en-US';
  try {
    return n.toLocaleString(lc, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

/** Port of the web charts `fmt` helper — like fmtNumber but defaulting to 1dp. */
function fmt(value: unknown, decimals = 1): string {
  return fmtNumber(value, decimals);
}

/* ------------------------------------------------------------------ */
/*  scoped native useUnits (web @/hooks/useUnits, consumed subset)      */
/* ------------------------------------------------------------------ */

type DistanceUnitPref = 'km' | 'mi';
type EnergyUnitPref = 'kWh';

interface NativeUnitPrefs {
  distance: DistanceUnitPref;
  energy: EnergyUnitPref;
  locale?: string;
  precision?: number;
}

interface FormatOptions {
  precision?: number;
}

type EnergyFormatter = (
  value: number | null | undefined,
  options?: FormatOptions,
) => string;

interface UseUnitsResult {
  unitPrefs: NativeUnitPrefs;
  formatEnergy: EnergyFormatter;
}

// web @/hooks/useUnits DEFAULT_ENERGY_PREF.
const DEFAULT_ENERGY_PREF: EnergyUnitPref = 'kWh';
// web @/lib/unitConversion DEFAULT_EMPTY_DISPLAY / DEFAULT_PRECISION.energy.
const DEFAULT_EMPTY_DISPLAY = '\u2014';
const DEFAULT_ENERGY_PRECISION = 2;
const DEFAULT_LOCALE = 'en-US';

/** web @/hooks/useUnits deriveDistance — 'mi' stays 'mi', else 'km'. */
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

/** web @/hooks/useUnits deriveLocale — non-empty string else en-US. */
function deriveLocale(locale: string | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) {
    return locale;
  }
  return DEFAULT_LOCALE;
}

/** web @/hooks/useUnits derivePrecision — finite, >= 0, floored. */
function derivePrecision(decimalPrecision: unknown): number | undefined {
  if (typeof decimalPrecision !== 'number') {
    return undefined;
  }
  if (!Number.isFinite(decimalPrecision)) {
    return undefined;
  }
  if (decimalPrecision < 0) {
    return undefined;
  }
  return Math.floor(decimalPrecision);
}

/** web @/lib/unitConversion resolvePrecision — override -> pref -> fallback. */
function resolvePrecision(
  prefPrecision: number | undefined,
  override: number | undefined,
  fallback: number,
): number {
  if (
    typeof override === 'number' &&
    Number.isFinite(override) &&
    override >= 0
  ) {
    return Math.floor(override);
  }
  if (
    typeof prefPrecision === 'number' &&
    Number.isFinite(prefPrecision) &&
    prefPrecision >= 0
  ) {
    return Math.floor(prefPrecision);
  }
  return fallback;
}

function useUnits(): UseUnitsResult {
  const {data: settings} = useSettings();

  const distance = deriveDistance(settings?.unit_of_length);
  const locale = deriveLocale(settings?.locale);
  const precision = derivePrecision(settings?.decimal_precision);

  const unitPrefs = useMemo<NativeUnitPrefs>(
    () => ({distance, energy: DEFAULT_ENERGY_PREF, locale, precision}),
    [distance, locale, precision],
  );

  // web lib formatEnergy: null/NaN -> empty; convertEnergyFromSI(wh,'kWh')=wh/1000.
  const formatEnergy = useCallback<EnergyFormatter>(
    (value, options) => {
      if (value == null || !Number.isFinite(value)) {
        return DEFAULT_EMPTY_DISPLAY;
      }
      const digits = resolvePrecision(
        unitPrefs.precision,
        options?.precision,
        DEFAULT_ENERGY_PRECISION,
      );
      const kwh = value / 1000;
      return `${fmtNumber(kwh, digits, unitPrefs.locale)} ${unitPrefs.energy}`;
    },
    [unitPrefs],
  );

  return useMemo(() => ({unitPrefs, formatEnergy}), [unitPrefs, formatEnergy]);
}

/* ------------------------------------------------------------------ */
/*  native DataFreshness (web @/components/data-display, WidgetShell)   */
/* ------------------------------------------------------------------ */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_COLOR: Record<FreshnessStatus, string> = {
  error: colors.danger,
  fetching: colors.accent,
  fresh: colors.success,
  stale: colors.warning,
};

const FRESHNESS_GLYPH: Record<FreshnessStatus, string> = {
  error: '\u2715', // ✕ WifiOff
  fetching: '\u21BB', // ↻ RefreshCw
  fresh: '\u25CF', // ● Wifi
  stale: '\u25CF', // ● Wifi
};

function relativeFreshness(ms: number, t: NativeTFunction): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  if (seconds < 604_800) {
    return `${Math.floor(seconds / 86_400)}d ago`;
  }
  return `${Math.floor(seconds / 604_800)}w ago`;
}

interface DataFreshnessProps {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: DataFreshnessProps) {
  const t = useNativeTranslation();
  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';
  const color = FRESHNESS_COLOR[status];
  const relativeTime =
    updatedAt && !isFetching
      ? relativeFreshness(updatedAt, t)
      : isFetching
        ? t('freshness.updating', 'updating…')
        : isError
          ? t('freshness.error', 'error')
          : '';

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => {
        if (!isFetching) {
          onRefresh?.();
        }
      }}
      style={styles.freshness}
      testID="data-freshness">
      <AppText
        importantForAccessibility="no-hide-descendants"
        style={[styles.freshnessGlyph, {color}]}>
        {FRESHNESS_GLYPH[status]}
      </AppText>
      {!compact && relativeTime ? (
        <AppText style={[styles.freshnessText, {color}]}>{relativeTime}</AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetShell (web ./WidgetShell)                             */
/* ------------------------------------------------------------------ */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  // Pulse on data change (web L59-80).
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return <View style={styles.skeleton} testID="widget-skeleton" />;
  }
  if (error) {
    return (
      <View style={styles.errorWrap}>
        <AppText style={styles.errorText} tone="danger">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (web L91).
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated ? styles.shellPulse : null]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.freshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={[styles.body, !title ? styles.bodyTopPad : null]}>
        {children}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)            */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
}

function EmptyState({icon, message}: EmptyStateProps) {
  return (
    <View style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyStateMessage}>{message}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  AnimatedNumber (native-safe port of data-display/AnimatedNumber)    */
/* ------------------------------------------------------------------ */

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
}

function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  prefix,
  suffix,
  style,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = Date.now();
    const from = 0;
    const to = value;
    const durationMs = duration * 1000;

    function tick() {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / durationMs, 1);
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplay(from + (to - from) * eased);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return (
    <AppText style={[styles.animatedNumber, style]}>
      {prefix}
      {fmtNumber(display, decimals)}
      {suffix}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  ported chart datum (web L38-44)                                    */
/* ------------------------------------------------------------------ */

interface AreaDatum {
  date: string;
  energy: number;
}

/* ------------------------------------------------------------------ */
/*  native EnergyStatsAreaChart (web Recharts AreaChart, L150-198)      */
/* ------------------------------------------------------------------ */

const CHART_GRID_PERCENTS = [0, 50, 100] as const;

interface EnergyStatsAreaChartProps {
  data: AreaDatum[];
  tickFontSize: number;
  height: number;
}

function EnergyStatsAreaChart({
  data,
  tickFontSize,
  height,
}: EnergyStatsAreaChartProps) {
  // web YAxis auto-domains [0, max]; scale the area to the largest energy value.
  const energyValues = data
    .map(d => d.energy)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const maxEnergy = energyValues.length > 0 ? Math.max(...energyValues) : 0;
  const domainMax = Math.max(maxEnergy, 1);

  const tickStyle = [styles.chartTick, {fontSize: tickFontSize}];
  const lastEnergy = data[data.length - 1]?.energy ?? 0;
  const midIndex = Math.floor((data.length - 1) / 2);

  return (
    <View
      accessible
      // web Tooltip formatter: `${fmtNumber(value, 2)} kWh`.
      accessibilityLabel={`Daily energy usage over ${
        data.length
      } days; latest ${fmtNumber(lastEnergy, 2)} kWh`}
      accessibilityRole="image"
      style={styles.chartRoot}>
      <View style={[styles.chartBody, {height}]}>
        {/* web YAxis tickFormatter: (v) => fmt(v, 1), width 40. */}
        <View style={styles.chartAxisLeft}>
          <AppText numberOfLines={1} style={tickStyle}>
            {fmt(domainMax, 1)}
          </AppText>
          <AppText numberOfLines={1} style={tickStyle}>
            {fmt(domainMax / 2, 1)}
          </AppText>
          <AppText numberOfLines={1} style={tickStyle}>
            {fmt(0, 1)}
          </AppText>
        </View>

        <View style={styles.chartPlot}>
          {CHART_GRID_PERCENTS.map(percent => (
            <View
              key={`grid-${percent}`}
              pointerEvents="none"
              style={[
                styles.chartGridLine,
                {top: `${percent}%` as DimensionValue},
              ]}
            />
          ))}

          {/* web Area type="monotone" dataKey="energy" — touching amber columns. */}
          <View style={styles.chartColumns}>
            {data.map((d, index) => {
              const pct =
                d.energy > 0 ? Math.max((d.energy / domainMax) * 100, 2) : 0;
              return (
                <View key={`${index}-${d.date}`} style={styles.chartColumn}>
                  {d.energy > 0 ? (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.areaFill,
                        {height: `${pct}%` as DimensionValue},
                      ]}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </View>

      {/* web XAxis dataKey="date" — Recharts auto-skips overlapping ticks; show
          first / middle / last day labels. */}
      <View style={styles.chartXAxis}>
        <View style={styles.chartAxisSpacer} />
        <View style={styles.chartXLabels}>
          <AppText
            numberOfLines={1}
            style={[styles.chartXLabel, styles.chartXLabelStart, {fontSize: tickFontSize}]}>
            {data[0]?.date ?? ''}
          </AppText>
          {data.length > 2 ? (
            <AppText
              numberOfLines={1}
              style={[styles.chartXLabel, styles.chartXLabelMid, {fontSize: tickFontSize}]}>
              {data[midIndex]?.date ?? ''}
            </AppText>
          ) : null}
          {data.length > 1 ? (
            <AppText
              numberOfLines={1}
              style={[styles.chartXLabel, styles.chartXLabelEnd, {fontSize: tickFontSize}]}>
              {data[data.length - 1]?.date ?? ''}
            </AppText>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetStatGrid (web ./shared/WidgetStatGrid)                */
/* ------------------------------------------------------------------ */

function trendColor(trend: 'up' | 'down' | 'flat'): string {
  return trend === 'up'
    ? colors.success
    : trend === 'flat'
      ? colors.textMuted
      : colors.danger;
}

interface WidgetStatGridProps {
  stats: StatGridItem[];
  cols: 2 | 3;
}

function WidgetStatGrid({stats, cols}: WidgetStatGridProps) {
  if (stats.length === 0) {
    return <EmptyState message="No stats available" />;
  }

  // web container-query cols 2 / 3 -> native flex-basis.
  const basis: DimensionValue = cols === 3 ? '31%' : '47%';

  return (
    <View style={styles.statGrid}>
      {stats.map(stat => (
        <View key={stat.label} style={[styles.statCard, {flexBasis: basis}]}>
          <View style={styles.statCardHeader}>
            <AppText numberOfLines={1} style={styles.statCardLabel}>
              {stat.label}
            </AppText>
            {stat.icon ? <View style={styles.statCardIcon}>{stat.icon}</View> : null}
          </View>
          <View style={styles.statValueRow}>
            <AppText
              numberOfLines={1}
              style={[styles.statValue, stat.valueColor ? {color: stat.valueColor} : null]}>
              {stat.value}
            </AppText>
            {stat.unit ? (
              <AppText numberOfLines={1} style={styles.statUnit}>
                {stat.unit}
              </AppText>
            ) : null}
          </View>
          {stat.trend && stat.trendValue ? (
            <View style={styles.statTrendRow}>
              <AppText style={[styles.statTrend, {color: trendColor(stat.trend)}]}>
                {`${
                  stat.trend === 'up'
                    ? '\u2191'
                    : stat.trend === 'down'
                      ? '\u2193'
                      : '\u2014'
                } ${stat.trendValue}`}
              </AppText>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  EnergyStatsWidget (web L20-212)                                    */
/* ------------------------------------------------------------------ */

export default function EnergyStatsWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useEnergyStats(id > 0 ? String(id) : null);

  const {unitPrefs, formatEnergy} = useUnits();
  // web L29: toEfficiencyDisplay (Wh/m -> Wh/mi via 1609.344, else Wh/km via
  // 1000). Wrapped in useCallback so the stats useMemo dep stays stable.
  const toEfficiencyDisplay = useCallback(
    (whPerM: number) =>
      unitPrefs.distance === 'mi' ? whPerM * 1609.344 : whPerM * 1000,
    [unitPrefs.distance],
  );

  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // web L36: data?.daily_breakdown ?? [] — memoised so the chartData useMemo
  // dep stays stable for react-hooks/exhaustive-deps (output identical).
  const dailyBreakdown = useMemo(() => data?.daily_breakdown ?? [], [data]);

  const chartData = useMemo<AreaDatum[]>(
    () =>
      dailyBreakdown.map(d => ({
        date: d.date,
        energy: d.energy_wh ?? 0,
      })),
    [dailyBreakdown],
  );

  const hasData = !!data;
  const hasChartData = chartData.length > 0;

  // Build stat items for the grid (web L50-95).
  const stats = useMemo<StatGridItem[]>(() => {
    if (!data) {
      return [];
    }

    const items: StatGridItem[] = [
      {
        label: t('widget.energyStats.totalUsed', 'Total Used'),
        value: formatEnergy(data.total_energy_used_wh ?? 0, {precision: 1}),
        icon: <AppText style={styles.statIconGlyph}>{ICON_ZAP}</AppText>,
      },
      {
        label: t('widget.energyStats.totalCharged', 'Total Charged'),
        value: formatEnergy(data.total_energy_charged_wh ?? 0, {precision: 1}),
        icon: (
          <AppText style={styles.statIconGlyph}>
            {ICON_BATTERY_CHARGING}
          </AppText>
        ),
      },
      {
        label: t('widget.energyStats.avgEfficiency', 'Avg Efficiency'),
        value: fmtNumber(toEfficiencyDisplay(data.avg_efficiency_wh_per_m ?? 0), 1),
        unit: efficiencyUnit,
        icon: <AppText style={styles.statIconGlyph}>{ICON_TRENDING_UP}</AppText>,
      },
      {
        label: t('widget.energyStats.co2Saved', 'CO\u2082 Saved'),
        value: fmtNumber(data.co2_saved_kg ?? 0, 1),
        unit: 'kg',
        icon: <AppText style={styles.statIconGlyph}>{ICON_LEAF}</AppText>,
      },
    ];

    if (isWide) {
      items.push(
        {
          label: t('widget.energyStats.totalCost', 'Total Cost'),
          value: fmtNumber(data.total_cost ?? 0, 2),
          unit: '$',
          icon: <AppText style={styles.statIconGlyph}>{ICON_DOLLAR}</AppText>,
        },
        {
          label: t('widget.energyStats.netBalance', 'Net Energy'),
          value: formatEnergy(
            (data.total_energy_charged_wh ?? 0) -
              (data.total_energy_used_wh ?? 0),
            {precision: 1},
          ),
          icon: <AppText style={styles.statIconGlyph}>{ICON_ROUTE}</AppText>,
        },
      );
    }

    return items;
  }, [data, isWide, toEfficiencyDisplay, efficiencyUnit, formatEnergy, t]);

  // ── Compact (1×2): large number only (web L107-136) ──
  if (isCompact) {
    return (
      <WidgetShell
        error={error ? String(error) : null}
        isError={isError}
        isFetching={isFetching}
        isStale={isStale}
        loading={isLoading}
        onRefresh={() => refetch()}
        updatedAt={dataUpdatedAt}>
        {hasData ? (
          <View style={styles.compactWrap}>
            <AnimatedNumber
              decimals={0}
              style={styles.compactNumber}
              value={(data?.total_wh ?? 0) / 1000}
            />
            <AppText style={styles.compactUnit}>{unitPrefs.energy}</AppText>
          </View>
        ) : (
          <EmptyState
            icon={<AppText style={styles.emptyGlyph}>{ICON_ZAP}</AppText>}
            message={t('widget.energyStats.noData', 'No energy data available')}
          />
        )}
      </WidgetShell>
    );
  }

  // ── Standard (2×4) / Wide (3×4+) (web L138-211) ──
  // web: tick = isWide ? axisTick : axisTickSm (fontSize 11 vs 10).
  const tick = isWide ? 11 : 10;

  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={<AppText style={styles.titleGlyph}>{ICON_ZAP}</AppText>}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.energyStats.title', 'Energy Stats')}
      updatedAt={dataUpdatedAt}>
      {hasData ? (
        <View style={styles.standardBody}>
          {/* Area chart: daily energy usage */}
          {hasChartData ? (
            <View style={styles.chartFlex}>
              <EnergyStatsAreaChart
                data={chartData}
                height={isWide ? 150 : 130}
                tickFontSize={tick}
              />
            </View>
          ) : null}

          {/* Stat cards grid */}
          <WidgetStatGrid cols={isWide ? 3 : 2} stats={stats} />
        </View>
      ) : (
        <EmptyState
          icon={<AppText style={styles.emptyGlyph}>{ICON_ZAP}</AppText>}
          message={t('widget.energyStats.noData', 'No energy data available')}
        />
      )}
    </WidgetShell>
  );
}

EnergyStatsWidget.displayName = 'EnergyStatsWidget';

// shadow-[0_0_12px_rgba(34,197,94,0.15)] pulse-on-update glow.
const PULSE_GLOW = '#22c55e';

const styles = StyleSheet.create({
  animatedNumber: {
    fontVariant: ['tabular-nums'],
  },
  areaFill: {
    backgroundColor: AREA_FILL,
    borderTopColor: AREA_COLOR,
    borderTopWidth: 2,
    minHeight: 2,
    width: '100%',
  },
  body: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  bodyTopPad: {
    paddingTop: spacing.md,
  },
  chartAxisLeft: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    width: 40,
  },
  chartAxisSpacer: {
    width: 40,
  },
  chartBody: {
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  chartColumn: {
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: 1,
  },
  chartColumns: {
    alignItems: 'flex-end',
    flex: 1,
    flexDirection: 'row',
  },
  chartFlex: {
    flexShrink: 1,
  },
  chartGridLine: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    opacity: 0.5,
    position: 'absolute',
    right: 0,
  },
  chartPlot: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  chartRoot: {
    width: '100%',
  },
  chartTick: {
    color: colors.textMuted,
  },
  chartXAxis: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  chartXLabel: {
    color: colors.textMuted,
    flex: 1,
  },
  chartXLabelEnd: {
    textAlign: 'right',
  },
  chartXLabelMid: {
    textAlign: 'center',
  },
  chartXLabelStart: {
    textAlign: 'left',
  },
  chartXLabels: {
    flex: 1,
    flexDirection: 'row',
  },
  compactNumber: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  compactUnit: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  compactWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    rowGap: 2,
  },
  emptyGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 24,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyStateMessage: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
  },
  errorWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    padding: spacing.md + 4,
  },
  freshness: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  freshnessGlyph: {
    fontSize: 10,
    lineHeight: 14,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.xs + 2,
    top: spacing.xs + 2,
    zIndex: 5,
  },
  freshnessText: {
    fontSize: 10,
    lineHeight: 14,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.md,
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    columnGap: spacing.xs + 2,
    flexDirection: 'row',
  },
  shell: {
    position: 'relative',
  },
  shellPulse: {
    elevation: 4,
    shadowColor: PULSE_GLOW,
    shadowOffset: {height: 0, width: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    minHeight: 120,
  },
  standardBody: {
    rowGap: spacing.md,
  },
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flexGrow: 1,
    minWidth: 0,
    padding: spacing.sm,
    rowGap: spacing.xs,
  },
  statCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCardIcon: {
    marginLeft: spacing.xs,
  },
  statCardLabel: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
  },
  statGrid: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  statIconGlyph: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 16,
  },
  statTrend: {
    fontSize: 11,
  },
  statTrendRow: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  statUnit: {
    color: colors.textMuted,
    fontSize: 12,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  statValueRow: {
    alignItems: 'baseline',
    columnGap: 2,
    flexDirection: 'row',
  },
  titleGlyph: {
    color: colors.warning,
    fontSize: 13,
    lineHeight: 16,
  },
});
