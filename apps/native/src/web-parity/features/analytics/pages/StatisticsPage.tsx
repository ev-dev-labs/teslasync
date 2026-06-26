// Native parity port of web/src/features/analytics/pages/StatisticsPage.tsx.
//
// The web module is the "Statistics" page: a PageContainer (title + subtitle +
// an actions row with a vehicle Select, a RangePicker, a refresh Button, a
// SavedViewMenu, and a DataFreshnessAuto chip) that, while the period-stats
// query loads, shows a StatisticsSkeleton; when there is no stats payload shows
// an EmptyState; otherwise renders five stacked FadeIn sections:
//   1. Period Stats — a 5-up MetricCard grid (Total Distance / Total Drives /
//      Total Energy / Total Cost / CO₂ Saved).
//   2. Averages — a 3-up MetricCard grid (Avg Drive Distance / Avg Efficiency /
//      Cost per km).
//   3. Battery Health — a GlassPanel with a RadialGauge (SoH) + a 2x2 MetricCard
//      grid (Capacity / Degradation / Cycles / Age), or an EmptyState.
//   4. State Distribution (ChartContainer + Recharts PieChart) beside a Mileage
//      Summary GlassPanel (2x2 MetricCard grid), each with its own EmptyState.
//   5. Vehicle Comparison — a ChartContainer wrapping a Recharts grouped
//      distance/energy BarChart with a toggle ChartLegend, or an EmptyState.
// Backend distances/efficiency are SI (km / Wh/km); the page converts at the
// display boundary to the user's distance pref. Period stats come from GET
// /api/v1/analytics/period-stats?vehicle_id=; the rest from the ported analytics
// + energy hooks.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?) returns the English fallback (or the key), preserving
//     every translation key verbatim at the call site.
//   • usePageTitle(...) -> a native no-op hook (no document.title in RN); the
//     call site + translated title key are preserved.
//   • @/hooks/useUnits (unitPrefs.distance) + @/hooks/useFormatting
//     (formatCurrency) -> derived from the native useSettings() query exactly
//     like the web hooks (deriveDistance: unit_of_length === 'mi' ? 'mi' : 'km';
//     formatCurrency = `${symbol}${fmtNumber(amount, decimals ?? precision)}`).
//   • @/lib/unitConversion convertDistanceFromSI + @/lib/numberFormat
//     fmtNumber/fmtInt -> inlined verbatim (meters/1000 for km, /1609.344 for mi;
//     locale-aware fixed-decimal formatting with non-finite -> 0; fmtInt = 0dp).
//   • @/hooks/useChartPalette -> inlined CB-safe (Okabe-Ito) + neon palettes and
//     the resolveChartPalette('neon' ? neon : cb_safe) fallback, read from the
//     settings `chart_palette` pref.
//   • @/hooks/useSelectedVehicle -> a native hook over the ported useVehicles()
//     that keeps the "first vehicle is the default" precedence in local state
//     (RN has no router path/query precedence or persisted store).
//   • @/hooks/useUrlState (useUrlString/useUrlBatch) + the picker's vehicle_id
//     URL write -> in-memory React state (RN has no browser URL/search params);
//     the from/to range still drives the query and setUrlVehicleId is a no-op
//     because the selection already persists via useSelectedVehicle.
//   • @/hooks/useHiddenSeries -> an in-memory HiddenSeriesState (the same
//     toggle/isHidden/reset contract the ported ChartHiddenSeriesContext uses),
//     since URL-persisted hidden series are unavailable in RN.
//   • @/components/data-display SavedViewMenu + useSavedViewUrl -> a native-safe
//     SavedViewMenu chip that surfaces an explicit "unavailable" notice on press
//     (URL-serialised saved views require a browser URL); useSavedViewUrl
//     collapses to an empty-query / no-op apply stub.
//   • @/components/data-display DataFreshnessAuto -> an inlined DataFreshness
//     chip (status error > fetching > stale > fresh, the same relative-time /
//     "updating…" / "error" label logic; computed once at render to avoid a
//     dangling 30s timer under --detectOpenHandles).
//   • lucide-react glyphs (MapPin/Zap/DollarSign/Leaf/Battery/TrendingUp/Gauge/
//     RefreshCw/Car/Clock/BarChart3) -> the native SemanticIcon registry glyphs.
//   • The shared web <PageContainer>/<Grid>/<Select>/<Button>/<MetricCard> ->
//     inlined native equivalents covering exactly the props these call sites use
//     (PageContainer keeps the header + error/children branch; Grid/grids
//     collapse to flex-wrap ~2-up cells; Select = a pressable option-chip row
//     whose onChange yields the chosen value mirroring web e.target.value; Button
//     = a small Pressable; MetricCard = label / bold value / tinted icon).
//   • The shared web <GlassPanel>/<FadeIn>/<RadialGauge>/<ChartContainer>/
//     <ChartLegend>/<EmptyState>/<Skeleton> -> the already-ported native
//     components (ui/charts/motion/feedback).
//   • Recharts <PieChart>/<Pie>/<Cell>/<ResponsiveContainer>/<Legend>/<Tooltip>
//     (+ ChartTooltip) -> a native-safe State Distribution breakdown: a colour-
//     swatched, proportional-bar list of each state's share (the slice name +
//     percentage value + fill colour are preserved). Recharts <BarChart>/<Bar>/
//     <XAxis>/<YAxis>/<Tooltip> (+ chartGrid/axisTickSm) -> a native-safe grouped
//     bar list: per-vehicle distance + energy bars scaled to a shared max
//     (matching Recharts' shared Y axis), with the toggle ChartLegend hiding a
//     series exactly as the web `hide={hidden.isHidden(...)}` Bars do.
// Field access stays snake_case (the native request() camelCaseKeys keeps the
// original keys); every API path / query key is preserved. No DOM elements,
// react-i18next, lucide-react, framer-motion, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {request} from '../../../api/client';
import {
  useFleetAnalytics,
  useMileageStats,
  useStateSummary,
} from '../../../api/hooks/useAnalytics';
import {useBatteryHealthAnalytics} from '../../../api/hooks/useEnergy';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {ChartContainer} from '../../../components/charts/ChartContainer';
import {
  ChartLegend,
  type LegendPayloadEntry,
} from '../../../components/charts/ChartLegend';
import {RadialGauge} from '../../../components/charts/RadialGauge';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {FadeIn} from '../../../components/motion/FadeIn';
import {RangePicker} from '../../../components/forms/RangePicker';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── web module constants (verbatim) ──────────────────────────────────── */

const KM_PER_MILE = 1.609344;
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;

/* ─── Types ─────────────────────────────────────────────────────────────── */

interface PeriodStats {
  total_distance: number;
  total_drives: number;
  energy_used: number;
  avg_efficiency: number;
  total_cost: number;
  co2_saved: number;
}

const STATE_COLORS: Record<string, string> = {
  driving: '#10b981',
  charging: '#00f0ff',
  parked: '#f59e0b',
  sleeping: '#64748b',
  online: '#3b82f6',
  idle: '#a855f7',
};

/* ─── i18n fallback (web react-i18next useTranslation) ──────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

// Web usePageTitle sets document.title; RN has no document, so this is a no-op
// that keeps the call site (and its translated title key) intact.
function usePageTitle(_title: string): void {
  // intentionally empty — no document.title equivalent in React Native.
}

/* ─── inlined @/lib/numberFormat fmtNumber + fmtInt ─────────────────────── */

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber(value, decimals?, locale?): locale-aware fixed-decimal formatting
// with non-finite inputs coerced to 0; the web global precision default is 2 and
// a bad locale tag falls back to en-US so a string is always produced.
function fmtNumber(
  v: unknown,
  decimals: number = DEFAULT_PRECISION,
  locale: string = DEFAULT_LOCALE,
): string {
  const d = Math.max(0, Math.min(20, Math.floor(decimals)));
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

// web fmtInt(value) = fmtNumber(value, 0).
function fmtInt(v: unknown, locale: string = DEFAULT_LOCALE): string {
  return fmtNumber(v, 0, locale);
}

/* ─── inlined @/lib/unitConversion convertDistanceFromSI ────────────────── */

type DistanceUnitPref = 'km' | 'mi';

// Pure SI meters -> display distance (web lib convertDistanceFromSI): km divides
// by 1000, mi divides by 1609.344.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

/* ─── inlined @/hooks/useUnits + @/hooks/useFormatting (settings-derived) ── */

// web useUnits' deriveDistance: 'mi' selects miles, everything else km.
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

function derivePrecision(decimalPrecision: unknown): number {
  if (
    typeof decimalPrecision === 'number' &&
    Number.isFinite(decimalPrecision) &&
    decimalPrecision >= 0
  ) {
    return Math.floor(decimalPrecision);
  }
  return DEFAULT_PRECISION;
}

/* ─── inlined @/hooks/useChartPalette (CB-safe + neon) ──────────────────── */

// web @/lib/colors CHART_COLORS_CB_SAFE (Okabe-Ito) — the static default.
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

// web @/lib/colors CHART_COLORS_NEON — the opt-in stylistic palette.
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

// web resolveChartPalette: 'neon' selects the neon palette, anything else (incl.
// missing/unloaded) falls back to the CB-safe default.
function resolveChartPalette(pref: string | null | undefined): readonly string[] {
  return pref === 'neon' ? CHART_COLORS_NEON : CHART_COLORS_CB_SAFE;
}

/* ─── inlined @/hooks/useSelectedVehicle ────────────────────────────────── */

interface SelectedVehicleResult {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

// Native useSelectedVehicle: RN has no router path/query precedence or persisted
// store, so the selection lives in local state, defaulting to the first vehicle
// the moment the fleet loads (the web hook's final precedence tier).
function useSelectedVehicle(): SelectedVehicleResult {
  const {data} = useVehicles();
  const vehicles = data ?? [];
  const [stored, setVehicleId] = useState<number | null>(null);

  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (stored == null && firstVehicleId != null) {
      setVehicleId(firstVehicleId);
    }
  }, [stored, firstVehicleId]);

  const effectiveId = stored ?? firstVehicleId;
  return {vehicleId: effectiveId, vehicles, setVehicleId};
}

/* ─── inlined @/hooks/useHiddenSeries (in-memory) ───────────────────────── */

interface HiddenSeriesState {
  hidden: Set<string>;
  toggle: (seriesKey: string) => void;
  isHidden: (seriesKey: string) => boolean;
  reset: () => void;
}

// web useHiddenSeries persists the hidden dataKeys in the URL; RN has no URL, so
// the hidden set is retained in component state with the same contract.
function useHiddenSeries(_chartKey: string): HiddenSeriesState {
  const [values, setValues] = useState<readonly string[]>([]);
  const hidden = useMemo(() => new Set(values), [values]);

  const isHidden = useCallback(
    (seriesKey: string) => hidden.has(seriesKey),
    [hidden],
  );
  const toggle = useCallback((seriesKey: string) => {
    setValues(prev => {
      const next = new Set(prev);
      if (next.has(seriesKey)) {
        next.delete(seriesKey);
      } else {
        next.add(seriesKey);
      }
      return Array.from(next).sort();
    });
  }, []);
  const reset = useCallback(() => setValues([]), []);

  return useMemo(
    () => ({hidden, toggle, isHidden, reset}),
    [hidden, toggle, isHidden, reset],
  );
}

/* ─── inlined @/hooks/useSavedViewUrl (native-safe stub) ────────────────── */

// web useSavedViewUrl wires the browser querystring into <SavedViewMenu>; RN has
// no URL, so the current query is always empty and apply() is a no-op.
function useSavedViewUrl(): {currentQuery: string; apply: (query: string) => void} {
  const apply = useCallback((_query: string) => {}, []);
  return {currentQuery: '', apply};
}

/* ─── inlined @/lib/tokens NeonColor + neon tints ───────────────────────── */

type NeonColor = 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'blue';

interface NeonTint {
  fg: string;
  bg: string;
  border: string;
}

// web neonColorMap (Tailwind neon text/bg/ring classes) -> native tinted tokens.
const NEON_TINT: Record<NeonColor, NeonTint> = {
  cyan: {fg: colors.accent, bg: colors.accentSoft, border: colors.borderAccent},
  green: {
    fg: colors.success,
    bg: colors.successSurface,
    border: colors.successBorder,
  },
  amber: {
    fg: colors.warning,
    bg: colors.warningSurface,
    border: colors.warningBorder,
  },
  red: {fg: colors.danger, bg: colors.dangerSurface, border: colors.dangerBorder},
  purple: {
    fg: colors.violet,
    bg: colors.violetSurface,
    border: colors.violetBorder,
  },
  blue: {
    fg: '#a5b4fc',
    bg: 'rgba(99, 102, 241, 0.12)',
    border: 'rgba(99, 102, 241, 0.32)',
  },
};

/* ─── inlined @/components/data-display MetricCard (subset used here) ────── */

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: SemanticIconName;
  color?: NeonColor;
}

// web MetricCard: a label, a bold value, and a tinted icon box. The
// change/delta/subtitle/help props the page never passes are omitted.
function MetricCard({label, value, icon, color = 'cyan'}: MetricCardProps) {
  const tint = NEON_TINT[color];
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricRow}>
        <View style={styles.metricBody}>
          <AppText numberOfLines={1} style={styles.metricLabel} tone="muted">
            {label}
          </AppText>
          <AppText numberOfLines={1} style={styles.metricValue} weight="bold">
            {value}
          </AppText>
        </View>
        {icon ? (
          <View
            style={[
              styles.metricIconBox,
              {backgroundColor: tint.bg, borderColor: tint.border},
            ]}>
            <AppText style={[styles.metricIconGlyph, {color: tint.fg}]} weight="bold">
              {getSemanticIconDefinition(icon).glyph}
            </AppText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// Grid cell wrapper — the flexGrow/flexBasis card slot that mirrors the web
// responsive metric grids (2/3/5 columns) by wrapping to ~2-up on a phone.
function Cell({children}: {children: ReactNode}) {
  return <View style={styles.cell}>{children}</View>;
}

/* ─── inlined @/components/ui Select ────────────────────────────────────── */

interface SelectOption {
  value: string;
  label: string;
}

// web <Select> (native <select>) -> a row of pressable option chips (the
// selected chip is accent-tinted). onChange receives the chosen option value,
// mirroring the web `e.target.value` payload.
function Select({
  options,
  value,
  onChange,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.optionRow}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            onPress={() => onChange(opt.value)}
            style={({pressed}) => [
              styles.option,
              active ? styles.optionActive : null,
              pressed ? styles.optionPressed : null,
            ]}>
            <AppText
              numberOfLines={1}
              style={active ? styles.optionTextActive : styles.optionText}
              weight={active ? 'semibold' : 'regular'}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── inlined @/components/ui Button (icon, sm) ─────────────────────────── */

// web <Button size="sm"> wrapping a lucide glyph -> a small pressable square.
function IconButton({
  glyph,
  label,
  onPress,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [styles.iconButton, pressed ? styles.iconButtonPressed : null]}>
      <AppText style={styles.iconButtonGlyph} weight="bold">
        {glyph}
      </AppText>
    </Pressable>
  );
}

/* ─── inlined @/components/data-display SavedViewMenu (native-safe) ──────── */

// web SavedViewMenu serialises the page querystring into shareable, persisted
// "saved views". RN has no browser URL to serialise, so the native menu is a
// chip that surfaces an explicit unavailable notice on press.
function SavedViewMenu({
  route,
  currentQuery: _currentQuery,
  onApply: _onApply,
}: {
  route: string;
  currentQuery: string;
  onApply: (query: string) => void;
}) {
  const {t} = useTranslation();
  const [notice, setNotice] = useState(false);
  return (
    <View style={styles.savedViewWrap}>
      <IconButton
        glyph="SV"
        label={t('savedViews.menu', 'Saved views')}
        onPress={() => setNotice(prev => !prev)}
      />
      {notice ? (
        <AppText
          accessibilityLabel={`${route} ${t(
            'savedViews.unavailable',
            'Saved views require a browser URL and are unavailable in native.',
          )}`}
          style={styles.savedViewNotice}
          tone="muted"
          variant="caption">
          {t(
            'savedViews.unavailable',
            'Saved views require a browser URL and are unavailable in native.',
          )}
        </AppText>
      ) : null}
    </View>
  );
}

/* ─── inlined @/components/data-display DataFreshness (Auto) ─────────────── */

interface FreshnessQuery {
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
}

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  fetching: colors.accent,
  stale: colors.warning,
  error: colors.danger,
};

function formatFreshnessTime(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return 'just now';
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

// web DataFreshnessAuto: a status dot + relative-time label. Status priority is
// error > fetching > stale > fresh; computed once at render (the web 30s
// re-render interval is dropped to avoid a dangling timer under --detectOpenHandles).
function DataFreshness({query}: {query: FreshnessQuery}) {
  const status: FreshnessStatus = query.isError
    ? 'error'
    : query.isFetching
      ? 'fetching'
      : query.isStale
        ? 'stale'
        : 'fresh';
  const dot = FRESHNESS_DOT[status];
  const updatedAt = query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null;
  const label =
    updatedAt && !query.isFetching
      ? formatFreshnessTime(updatedAt)
      : query.isFetching
        ? 'updating…'
        : query.isError
          ? 'error'
          : '';

  return (
    <View accessibilityRole="text" style={styles.freshness}>
      <View style={[styles.freshnessDot, {backgroundColor: dot}]} />
      {label ? (
        <AppText style={[styles.freshnessText, {color: dot}]}>{label}</AppText>
      ) : null}
    </View>
  );
}

/* ─── inlined @/components/layout PageContainer ─────────────────────────── */

function PageContainer({
  title,
  subtitle,
  actions,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  error?: Error | null;
  children: ReactNode;
}) {
  return (
    <ScrollView contentContainerStyle={styles.pageContent} style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>

      {error ? (
        <View style={styles.pageErrorBox}>
          <AppText style={styles.pageErrorText}>{error.message}</AppText>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/* ─── Loading skeleton ──────────────────────────────────────────────────── */

// web @/components/feedback StatGridSkeleton: a responsive grid of N pulse cards.
function StatGridSkeleton({cards}: {cards: number}) {
  return (
    <View style={styles.grid}>
      {Array.from({length: cards}).map((_, i) => (
        <Cell key={i}>
          <Skeleton height={84} style={styles.skeletonCard} />
        </Cell>
      ))}
    </View>
  );
}

// web @/components/charts ChartBlockSkeleton: a titled panel placeholder with a
// chart-area pulse of the given height.
function ChartBlockSkeleton({height}: {height: number}) {
  return (
    <View style={styles.chartBlockSkeleton}>
      <Skeleton height={14} style={styles.chartBlockSkeletonTitle} width="40%" />
      <Skeleton height={height} style={styles.skeletonCard} />
    </View>
  );
}

/**
 * Mirrors the StatisticsPage layout while data loads:
 * 5 period-stat cards → 3 averages → 1 battery-health panel →
 * 2 side-by-side panels (state + mileage) → 1 vehicle-comparison chart.
 */
function StatisticsSkeleton() {
  return (
    <View style={styles.sectionStack} testID="statistics-skeleton">
      <StatGridSkeleton cards={5} />
      <StatGridSkeleton cards={3} />
      <Skeleton height={224} style={styles.skeletonCard} />
      <View style={styles.twoColumn}>
        <View style={styles.twoColumnCell}>
          <ChartBlockSkeleton height={280} />
        </View>
        <View style={styles.twoColumnCell}>
          <Skeleton height={288} style={styles.skeletonCard} />
        </View>
      </View>
      <ChartBlockSkeleton height={320} />
    </View>
  );
}

/* ─── native-safe State Distribution (Recharts PieChart substitute) ─────── */

interface StateSlice {
  name: string;
  value: number;
  fill: string;
}

// Recharts PieChart of aggregated state shares -> a colour-swatched,
// proportional-bar breakdown preserving each slice's name + percentage + fill.
function StateDistributionChart({data}: {data: StateSlice[]}) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`State distribution with ${data.length} states`}
      style={styles.breakdown}>
      {data.map((slice, i) => (
        <View key={`${slice.name}-${i}`} style={styles.breakdownRow}>
          <View style={[styles.swatch, {backgroundColor: slice.fill}]} />
          <AppText numberOfLines={1} style={styles.breakdownName}>
            {slice.name}
          </AppText>
          <View style={styles.breakdownTrack}>
            <View
              style={[
                styles.breakdownFill,
                {
                  backgroundColor: slice.fill,
                  width: `${Math.max((slice.value / max) * 100, 4)}%`,
                },
              ]}
            />
          </View>
          <AppText style={styles.breakdownValue} tone="secondary" variant="caption">
            {slice.value}%
          </AppText>
        </View>
      ))}
    </View>
  );
}

/* ─── native-safe Vehicle Comparison (Recharts BarChart substitute) ─────── */

interface CompRow {
  name: string;
  distance: number;
  energy: number;
}

// Recharts grouped distance/energy BarChart -> per-vehicle distance + energy
// bars scaled to a shared max (matching Recharts' shared Y axis); a series is
// dropped when the toggle ChartLegend hides it, mirroring the web Bars' `hide`.
function VehicleComparisonChart({
  data,
  distanceUnit,
  palette,
  hidden,
}: {
  data: CompRow[];
  distanceUnit: DistanceUnitPref;
  palette: readonly string[];
  hidden: HiddenSeriesState;
}) {
  const {t} = useTranslation();
  const distanceColor = palette[0] ?? colors.accent;
  const energyColor = palette[1] ?? colors.violet;
  const distanceName = `${t('statistics.distance', 'Distance')} (${distanceUnit})`;
  const energyName = t('statistics.energy', 'Energy (kWh)');
  const distanceHidden = hidden.isHidden('distance');
  const energyHidden = hidden.isHidden('energy');

  const max = Math.max(
    ...data.flatMap(d => [
      distanceHidden ? 0 : d.distance,
      energyHidden ? 0 : d.energy,
    ]),
    1,
  );

  const legendPayload: LegendPayloadEntry[] = [
    {value: distanceName, dataKey: 'distance', color: distanceColor},
    {value: energyName, dataKey: 'energy', color: energyColor},
  ];

  return (
    <View style={styles.comparison}>
      <View style={styles.comparisonBars}>
        {data.map((row, i) => (
          <View key={`${row.name}-${i}`} style={styles.comparisonGroup}>
            <AppText numberOfLines={1} style={styles.comparisonLabel} tone="muted" variant="caption">
              {row.name}
            </AppText>
            {!distanceHidden ? (
              <View style={styles.comparisonBarRow}>
                <View style={styles.comparisonTrack}>
                  <View
                    style={[
                      styles.comparisonFill,
                      {
                        backgroundColor: distanceColor,
                        width: `${Math.max((row.distance / max) * 100, 2)}%`,
                      },
                    ]}
                  />
                </View>
                <AppText style={styles.comparisonValue} variant="caption">
                  {fmtInt(row.distance)}
                </AppText>
              </View>
            ) : null}
            {!energyHidden ? (
              <View style={styles.comparisonBarRow}>
                <View style={styles.comparisonTrack}>
                  <View
                    style={[
                      styles.comparisonFill,
                      {
                        backgroundColor: energyColor,
                        width: `${Math.max((row.energy / max) * 100, 2)}%`,
                      },
                    ]}
                  />
                </View>
                <AppText style={styles.comparisonValue} variant="caption">
                  {fmtInt(row.energy)}
                </AppText>
              </View>
            ) : null}
          </View>
        ))}
      </View>
      <ChartLegend payload={legendPayload} state={hidden} />
    </View>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────── */

export default function StatisticsPage(): React.ReactElement {
  const {t} = useTranslation();
  usePageTitle(t('statistics.title', 'Statistics'));

  const {data: settings} = useSettings();
  const distanceUnit = deriveDistance(settings?.unit_of_length);
  const locale = deriveLocale(settings?.locale);
  const precision = derivePrecision(settings?.decimal_precision);
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  // web useFormatting.formatCurrency: `${symbol}${fmtNumber(amount, decimals ?? precision)}`.
  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? precision, locale)}`,
    [currencySymbol, precision, locale],
  );

  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  // backend `total_distance` and `vehicle_comparison[].distance` are SI km;
  // `avg_efficiency` is SI Wh/km. Convert at boundary so display matches the
  // user's distance unit pref.
  const fromKm = useCallback(
    (km: number) => convertDistanceFromSI(km * METERS_PER_KM, distanceUnit),
    [distanceUnit],
  );
  const whPerKmToDisplay = (whPerKm: number) =>
    distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;
  const savedView = useSavedViewUrl();

  const setUrlVehicleId = useCallback((_id: string) => {
    // web useUrlString('vehicle_id') writes the picker selection to the URL for
    // deep-linking; RN has no URL, so the selection persists via useSelectedVehicle.
  }, []);
  const {vehicleId, vehicles, setVehicleId} = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  const onPickVehicle = (id: string) => {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0) {
      setVehicleId(n);
      setUrlVehicleId(id);
    }
  };

  const defaultStart = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  }, []);
  const defaultEnd = useMemo(() => new Date().toISOString().slice(0, 10), []);
  // web useUrlString('from'/'to') + useUrlBatch() collapse to in-memory state
  // (RN has no browser URL/search params); the range still drives the query.
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const setRangeBatch = useCallback((next: {from: string; to: string}) => {
    setStartDate(next.from);
    setEndDate(next.to);
  }, []);

  // Reactive chart palette: color-blind safe or neon per user preference.
  const palette = resolveChartPalette(settings?.chart_palette);

  // Persist hidden series so users can isolate one fleet metric across the
  // multi-vehicle distance/energy bar chart.
  const fleetCompareHidden = useHiddenSeries('fleet-vehicle-comparison');

  /* ── Data hooks ────────────────────────────────────────────────── */
  const statsQuery = useQuery({
    queryKey: ['period-stats', activeId],
    queryFn: ({signal}) =>
      request<PeriodStats>(`/analytics/period-stats?vehicle_id=${activeId}`, {
        signal,
      }),
    enabled: !!activeId,
  });
  const {data: stats, isLoading, error, refetch} = statsQuery;

  const {data: batteryHealth} = useBatteryHealthAnalytics(activeId || null);
  const {data: mileage} = useMileageStats(activeId);
  const {data: stateSummary} = useStateSummary(activeId);
  const {data: fleet} = useFleetAnalytics(30, startDate);

  /* ── Derived ───────────────────────────────────────────────────── */
  const avgDriveDistance =
    stats && stats.total_drives > 0 ? stats.total_distance / stats.total_drives : 0;

  const stateData = useMemo<StateSlice[]>(() => {
    if (!stateSummary?.length) {
      return [];
    }
    // Backend (deleted) returned `total_min`; legacy camelCase wrapper surfaced
    // `totalMin`. Reading both via fallback keeps the empty-state banner correct
    // even if a future replacement endpoint emits snake_case.
    const total = stateSummary.reduce((s, e) => {
      const minutes =
        (e as {totalMin?: number; total_min?: number}).totalMin ??
        (e as {total_min?: number}).total_min ??
        0;
      return s + minutes;
    }, 0);
    return stateSummary.map(e => {
      const minutes =
        (e as {totalMin?: number; total_min?: number}).totalMin ??
        (e as {total_min?: number}).total_min ??
        0;
      return {
        name: e.state,
        value: Math.round((minutes / Math.max(total, 1)) * 100),
        fill: STATE_COLORS[e.state] ?? palette[5],
      };
    });
  }, [stateSummary, palette]);

  const compData = useMemo<CompRow[]>(() => {
    if (!fleet?.vehicle_comparison) {
      return [];
    }
    return fleet.vehicle_comparison.map(v => ({
      name: v.name ?? `Vehicle ${v.id}`,
      distance: Math.round(fromKm(v.distance)),
      energy: Math.round(v.energy),
    }));
  }, [fleet, fromKm]);

  const vehicleOptions = vehicles.map(v => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));

  /* ── Render ────────────────────────────────────────────────────── */
  return (
    <PageContainer
      title={t('statistics.title', 'Statistics')}
      subtitle={t('statistics.subtitle', 'Lifetime vehicle statistics and records')}
      error={error as Error | null}
      actions={
        <View style={styles.actions}>
          {vehicles.length > 0 ? (
            <Select
              value={activeId}
              onChange={onPickVehicle}
              options={vehicleOptions}
            />
          ) : null}
          <RangePicker
            value={{start: startDate, end: endDate}}
            onChange={r => setRangeBatch({from: r.start, to: r.end})}
            align="end"
            triggerTestId="statistics-range"
          />
          <IconButton
            glyph={getSemanticIconDefinition('refresh').glyph}
            label={t('common.refresh', 'Refresh')}
            onPress={() => {
              void refetch();
            }}
          />
          <SavedViewMenu
            route="/statistics"
            currentQuery={savedView.currentQuery}
            onApply={savedView.apply}
          />
          <DataFreshness query={statsQuery} />
        </View>
      }>
      {isLoading ? (
        <StatisticsSkeleton />
      ) : !stats ? (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <EmptyState
          icon={<SectionGlyph color="cyan" name="analytics" />}
          title={t('statistics.noData', 'No Data')}
          message={t('statistics.noDataMsg', 'No statistics available for this vehicle.')}
        />
      ) : (
        <View style={styles.sectionStack}>
          {/* ── Period Stats ──────────────────────────────────── */}
          <FadeIn>
            <View style={styles.grid}>
              <Cell>
                <MetricCard
                  label={t('statistics.totalDistance', 'Total Distance')}
                  value={`${fmtInt(fromKm(stats.total_distance), locale)} ${distanceUnit}`}
                  icon="mapPinned"
                  color="cyan"
                />
              </Cell>
              <Cell>
                <MetricCard
                  label={t('statistics.totalDrives', 'Total Drives')}
                  value={fmtInt(stats.total_drives, locale)}
                  icon="trendUp"
                  color="green"
                />
              </Cell>
              <Cell>
                <MetricCard
                  label={t('statistics.totalEnergy', 'Total Energy')}
                  value={`${fmtNumber(stats.energy_used, DEFAULT_PRECISION, locale)} kWh`}
                  icon="bolt"
                  color="amber"
                />
              </Cell>
              <Cell>
                <MetricCard
                  label={t('statistics.totalCost', 'Total Cost')}
                  value={formatCurrency(stats.total_cost, 0)}
                  icon="dollarSign"
                  color="red"
                />
              </Cell>
              <Cell>
                <MetricCard
                  label={t('statistics.co2Saved', 'CO₂ Saved')}
                  value={`${fmtNumber(stats.co2_saved, DEFAULT_PRECISION, locale)} kg`}
                  icon="leaf"
                  color="green"
                />
              </Cell>
            </View>
          </FadeIn>

          {/* ── Averages ─────────────────────────────────────── */}
          <FadeIn delay={0.05}>
            <View style={styles.grid}>
              <Cell>
                <MetricCard
                  label={t('statistics.avgDriveDistance', 'Avg Drive Distance')}
                  value={`${fmtNumber(fromKm(avgDriveDistance), DEFAULT_PRECISION, locale)} ${distanceUnit}`}
                  icon="mapPinned"
                  color="cyan"
                />
              </Cell>
              <Cell>
                <MetricCard
                  label={t('statistics.avgEfficiency', 'Avg Efficiency')}
                  value={`${fmtNumber(whPerKmToDisplay(stats.avg_efficiency), DEFAULT_PRECISION, locale)} ${efficiencyUnit}`}
                  icon="speedCircle"
                  color="green"
                />
              </Cell>
              <Cell>
                <MetricCard
                  label={t('statistics.costPerKm', 'Cost per km')}
                  value={
                    stats.total_distance > 0
                      ? formatCurrency(stats.total_cost / stats.total_distance, 3)
                      : '—'
                  }
                  icon="dollarSign"
                  color="amber"
                />
              </Cell>
            </View>
          </FadeIn>

          {/* ── Battery Health ────────────────────────────────── */}
          <FadeIn delay={0.1}>
            <GlassPanel style={styles.panel}>
              <AppText style={styles.sectionTitle} weight="semibold">
                {t('statistics.batteryHealth', 'Battery Health')}
              </AppText>
              {batteryHealth ? (
                <View style={styles.batteryRow}>
                  <View style={styles.batteryGaugeCell}>
                    <RadialGauge
                      value={Math.round(batteryHealth.current_soh)}
                      max={100}
                      label={t('statistics.health', 'Health')}
                      unit="%"
                      color="#10b981"
                      size={140}
                    />
                  </View>
                  <View style={styles.batteryGrid}>
                    <Cell>
                      <MetricCard
                        label={t('statistics.capacity', 'Capacity')}
                        value={`${fmtNumber(batteryHealth.estimated_capacity, 1, locale)} kWh`}
                        icon="battery"
                        color="cyan"
                      />
                    </Cell>
                    <Cell>
                      <MetricCard
                        label={t('statistics.degradation', 'Degradation')}
                        value={`${fmtNumber(batteryHealth.degradation_rate_yr, 2, locale)}%/yr`}
                        icon="trendUp"
                        color="amber"
                      />
                    </Cell>
                    <Cell>
                      <MetricCard
                        label={t('statistics.cycles', 'Cycles')}
                        value={fmtInt(batteryHealth.total_cycles, locale)}
                        icon="refresh"
                        color="purple"
                      />
                    </Cell>
                    <Cell>
                      <MetricCard
                        label={t('statistics.age', 'Age')}
                        value={`${batteryHealth.battery_age_months} mo`}
                        icon="clock"
                        color="green"
                      />
                    </Cell>
                  </View>
                </View>
              ) : (
                // no-action: transient empty state — surfaces when source data is
                // missing; no specific recovery action available.
                <EmptyState
                  icon={<SectionGlyph color="cyan" name="battery" />}
                  message={t('statistics.noBattery', 'No battery health data available')}
                  style={styles.panelEmpty}
                />
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── State Distribution + Mileage ──────────────────── */}
          <FadeIn delay={0.15}>
            <View style={styles.twoColumn}>
              {/* State Distribution */}
              {/* chart-a11y:no-table pie-chart slices are aggregated state counts; SR users get the same info via the State page */}
              <View style={styles.twoColumnCell}>
                <ChartContainer
                  title={t('statistics.stateDistribution', 'State Distribution')}
                  ariaLabel={t(
                    'statistics.stateDistribution.aria',
                    'Vehicle state distribution pie chart',
                  )}
                  exportable
                  exportFilename="state-distribution"
                  height={256}>
                  {stateData.length > 0 ? (
                    <StateDistributionChart data={stateData} />
                  ) : (
                    // no-action: transient empty state — surfaces when source data
                    // is missing; no specific recovery action available.
                    <EmptyState
                      icon={<SectionGlyph color="cyan" name="clock" />}
                      message={t('statistics.noStates', 'No state distribution data')}
                      style={styles.panelEmpty}
                    />
                  )}
                </ChartContainer>
              </View>

              {/* Mileage Summary */}
              <View style={styles.twoColumnCell}>
                <GlassPanel style={styles.panel}>
                  <AppText style={styles.sectionTitle} weight="semibold">
                    {t('statistics.mileage', 'Mileage Summary')}
                  </AppText>
                  {mileage ? (
                    <View style={styles.batteryGrid}>
                      <Cell>
                        <MetricCard
                          label={t('statistics.totalMileage', 'Total Distance')}
                          value={`${fmtInt(fromKm(mileage.lifetime_km), locale)} ${distanceUnit}`}
                          icon="mapPinned"
                          color="cyan"
                        />
                      </Cell>
                      <Cell>
                        <MetricCard
                          label={t('statistics.dailyAvg', 'Daily Average (30d)')}
                          value={`${fmtNumber(fromKm((mileage.last_30d_km ?? 0) / 30), DEFAULT_PRECISION, locale)} ${distanceUnit}`}
                          icon="vehicle"
                          color="green"
                        />
                      </Cell>
                      <Cell>
                        <MetricCard
                          label={t('statistics.totalDrives', 'Total Drives')}
                          value={fmtInt(mileage.drive_count_lifetime, locale)}
                          icon="clock"
                          color="purple"
                        />
                      </Cell>
                      <Cell>
                        <MetricCard
                          label={t('statistics.yearlyProjection', 'Yearly Projection')}
                          value={`${fmtInt(fromKm(((mileage.last_30d_km ?? 0) / 30) * 365), locale)} ${distanceUnit}`}
                          icon="trendUp"
                          color="amber"
                        />
                      </Cell>
                    </View>
                  ) : (
                    // no-action: transient empty state — surfaces when source data
                    // is missing; no specific recovery action available.
                    <EmptyState
                      icon={<SectionGlyph color="cyan" name="vehicle" />}
                      message={t('statistics.noMileage', 'No mileage data available')}
                      style={styles.panelEmpty}
                    />
                  )}
                </GlassPanel>
              </View>
            </View>
          </FadeIn>

          {/* ── Vehicle Comparison ────────────────────────────── */}
          <FadeIn delay={0.2}>
            {/* chart-a11y:no-table multi-vehicle bar chart — fleet rollup with per-vehicle drill-down available */}
            <ChartContainer
              title={t('statistics.vehicleComparison', 'Vehicle Comparison')}
              ariaLabel={t(
                'statistics.vehicleComparison.aria',
                'Distance and energy bar chart comparing all vehicles in the fleet',
              )}
              chartKey="fleet-vehicle-comparison"
              exportable
              exportFilename="vehicle-comparison"
              height={288}>
              {compData.length > 1 ? (
                <VehicleComparisonChart
                  data={compData}
                  distanceUnit={distanceUnit}
                  palette={palette}
                  hidden={fleetCompareHidden}
                />
              ) : (
                // no-action: transient empty state — surfaces when source data is
                // missing; no specific recovery action available.
                <EmptyState
                  icon={<SectionGlyph color="cyan" name="vehicle" />}
                  message={t('statistics.singleVehicle', 'Add more vehicles to compare')}
                  style={styles.panelEmpty}
                />
              )}
            </ChartContainer>
          </FadeIn>
        </View>
      )}
    </PageContainer>
  );
}

/* ─── EmptyState icon glyph (lucide icon slot) ──────────────────────────── */

// The web EmptyState icons are lucide glyphs (BarChart3/Battery/Clock/Car);
// natively they render as a tinted SemanticIcon glyph box.
function SectionGlyph({color, name}: {color: NeonColor; name: SemanticIconName}) {
  const tint = NEON_TINT[color];
  return (
    <View style={[styles.emptyGlyphBox, {borderColor: tint.border, backgroundColor: tint.bg}]}>
      <AppText style={[styles.emptyGlyphText, {color: tint.fg}]} weight="bold">
        {getSemanticIconDefinition(name).glyph}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
  },
  pageContent: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  pageHeaderText: {
    flexShrink: 1,
    minWidth: 0,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.4,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
    fontSize: 13,
    lineHeight: 18,
  },
  pageActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  pageErrorBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    padding: spacing.md,
  },
  pageErrorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sectionStack: {
    gap: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  cell: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 140,
  },
  twoColumn: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  twoColumnCell: {
    flexGrow: 1,
    flexBasis: '100%',
    minWidth: 280,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelEmpty: {
    paddingVertical: spacing.xl,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
  },
  metricCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  metricBody: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
  },
  metricIconBox: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
  },
  metricIconGlyph: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
  },
  batteryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    alignItems: 'center',
  },
  batteryGaugeCell: {
    flexGrow: 1,
    flexBasis: '40%',
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  batteryGrid: {
    flexGrow: 1,
    flexBasis: '52%',
    minWidth: 200,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  option: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  optionActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  optionTextActive: {
    color: colors.accent,
    fontSize: 13,
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  iconButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  iconButtonGlyph: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.4,
  },
  savedViewWrap: {
    alignItems: 'flex-end',
  },
  savedViewNotice: {
    marginTop: spacing.xs,
    maxWidth: 200,
    textAlign: 'right',
  },
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  freshnessDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  freshnessText: {
    fontSize: 11,
    lineHeight: 14,
  },
  skeletonCard: {
    borderRadius: 12,
  },
  chartBlockSkeleton: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
  },
  chartBlockSkeletonTitle: {
    borderRadius: 6,
  },
  breakdown: {
    gap: spacing.sm,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 4,
  },
  breakdownName: {
    width: 84,
    color: colors.textPrimary,
    fontSize: 13,
    textTransform: 'capitalize',
  },
  breakdownTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  breakdownFill: {
    height: '100%',
    borderRadius: 999,
  },
  breakdownValue: {
    width: 44,
    textAlign: 'right',
  },
  comparison: {
    gap: spacing.md,
  },
  comparisonBars: {
    gap: spacing.md,
  },
  comparisonGroup: {
    gap: spacing.xs,
  },
  comparisonLabel: {
    fontSize: 12,
  },
  comparisonBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  comparisonTrack: {
    flex: 1,
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  comparisonFill: {
    height: '100%',
    borderRadius: 999,
  },
  comparisonValue: {
    width: 56,
    textAlign: 'right',
    color: colors.textSecondary,
  },
  emptyGlyphBox: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
  },
  emptyGlyphText: {
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.4,
  },
});
