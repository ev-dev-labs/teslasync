// Native parity port of web/src/features/battery/pages/BatteryDegradationPage.tsx.
//
// Battery Degradation page for the selected vehicle. Backed by two analytics
// queries:
//   - GET /api/v1/analytics/battery-health?vehicle_id=  (useBatteryHealthAnalytics
//     -> BatteryHealthAnalytics) drives the overview stat cards, the SoH gauge,
//     the range-loss chart, the Battery-Health-Factors panel, and the history
//     table.
//   - GET /api/v1/analytics/battery-degradation?vehicle_id= (useBatteryDegradation
//     -> DegradationData) drives the prediction panel, the health-trend +
//     projection chart, the risk-factor gauges, the recommendations list, and
//     the charging-habits-impact banner.
//
// Every web behavior, state name, API path, unit-handling rule and i18n key is
// preserved; the web DOM / Tailwind / Recharts / lucide stack is replaced with
// React Native primitives + the native parity component library, following the
// TrueCostPage precedent:
//
//   - `@/components/layout` PageContainer (title/subtitle/loading/error/actions)
//     has no native parity component, so a local ScrollView screen scaffold
//     reproduces the header (title + subtitle), the `actions` row (VehicleSelect
//     + DataFreshnessAuto), the centred loading spinner, the error panel, and
//     the body wrapped in the native ErrorBoundary (== PageContainer's
//     PageErrorBoundary). The web container shows EXACTLY ONE of loading /
//     error / children, so the native scaffold mirrors that branch order.
//   - `@/components/layout` Grid -> native flex-wrap rows.
//   - `@/components/forms` VehicleSelect (global header picker) -> a local
//     NativeSelect bound to useVehicles() + local state; combined with the
//     useSelectedVehicle shim (first-vehicle default) this reproduces the
//     "default to a vehicle, allow switching" behaviour without the web
//     router/store.
//   - `@/components/ui` GlassPanel reuses the native parity GlassPanel; Badge,
//     DataTable/Column have no native parity, so local native Badge + DataTable
//     (tap-to-sort headers + client pagination) reproduce them.
//   - `@/components/data-display` MetricCard -> a local native MetricCard (label
//     + value + colour-coded glyph; the web `help` "?" tooltip becomes an
//     accessibilityHint since native has no hover tooltip). DataFreshnessAuto ->
//     a local FreshnessChip driven by the query (isError/isFetching/isStale)
//     plus the web `forceStaleAfterMs={24h}` cagg-staleness override, rendered
//     via StatusPill.
//   - `@/components/charts` RadialGauge reuses the native parity RadialGauge.
//     ChartContainer + Recharts ComposedChart/AreaChart/Line/Area/ReferenceLine
//     /Brush/Legend/Tooltip (the native recharts barrel only renders an
//     "unavailable" placeholder) become a local ChartPanel wrapping a real
//     native SeriesBarChart (proportional View bars in a horizontal ScrollView
//     with a y-axis, an interactive legend == ChartLegend, optional fixed
//     [yMin,yMax] domain, and dashed reference lines). The web confidence-band
//     area + brush zoom + hover tooltip + chart annotations are browser/SVG-only
//     affordances and are approximated / unavailable on native (documented in
//     the sidecar); the title/ariaLabel + 80%/70% threshold lines + the
//     trendHidden series-toggle state are preserved. CHART_COLORS is the same
//     CB-safe palette imported from the native chart utils.
//   - `@/components/feedback` Skeleton/EmptyState/AlertBanner -> native
//     EmptyState + a local native AlertBanner; the Skeleton chart placeholder
//     degrades to an EmptyState while the projection has no points.
//   - `@/components/motion` FadeIn -> a reduced-motion-aware FadeIn honouring
//     the web per-section `delay`.
//   - `@/hooks/usePageTitle` (document.title) -> native no-op shim.
//   - `@/hooks/useSelectedVehicle` -> first-vehicle default + NativeSelect.
//   - `@/hooks/useHiddenSeries` (URL-persisted) -> an in-memory useState shim
//     (React Native has no URL query string); the toggle/isHidden/reset surface
//     is preserved so the chart legend still declutters the projection view.
//   - `@/hooks/useUnits` + `@/lib/unitConversion` convertDistanceFromSI ->
//     native shims mirroring the web out-of-box defaults (distance 'km', energy
//     'kWh', en-US); the API already returns SI and conversion happens at the
//     display boundary, exactly as the web hooks do.
//   - `@/lib/dateFormat` formatDate + `@/lib/numberFormat` fmtNumber/fmtInt ->
//     inlined native-safe equivalents.
//   - `@/lib/cn` (clsx + tailwind-merge) is dropped; conditional classNames
//     become StyleSheet style arrays.
//   - react-i18next useTranslation -> a local t(key, defaultOrVars?, vars?) shim
//     mirroring i18next's flexible signature so every key + English copy +
//     `{{count}}/{{y}}/{{m}}` interpolation is preserved verbatim.
//   - lucide-react icons (Battery/TrendingDown/Zap/Thermometer/Shield/Activity/
//     Calendar/AlertTriangle) are decorative; rendered as colour-coded emoji
//     glyphs (the native labels carry the meaning).

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {StatusPill} from '../../../../components/ui/StatusPill';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useBatteryDegradation,
  useBatteryHealthAnalytics,
  type RiskFactorData,
} from '../../../api/hooks/useEnergy';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {RadialGauge} from '../../../components/charts/RadialGauge';
import {CHART_COLORS} from '../../../components/charts/chartUtils';
import {ErrorBoundary} from '../../../components/feedback/ErrorBoundary';
import {GlassPanel} from '../../../components/ui/GlassPanel';

/* ─── Types (web `interface DegradationEntry`) ─────────────────────────────── */

interface DegradationEntry {
  date: string;
  odometer: number;
  soh_pct: number;
  capacity_wh: number;
  range_km: number;
}

/* ─── i18n shim (web `react-i18next` is unavailable in native) ─────────────── */

type TranslationVars = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  defaultValueOrVars?: string | TranslationVars,
  maybeVars?: TranslationVars,
) => string;

function interpolate(template: string, vars?: TranslationVars): string {
  if (vars == null) {
    return template;
  }
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : match,
  );
}

// Mirrors i18next's flexible signature: t(key), t(key, default),
// t(key, vars), t(key, default, vars). When no default is supplied the key
// itself is the template (so `t('Date')` -> 'Date' and `t('{{count}} months',
// {count})` -> 'N months'), matching the web call sites verbatim.
function useNativeTranslation(): NativeTFunction {
  return (key, defaultValueOrVars, maybeVars) => {
    if (typeof defaultValueOrVars === 'string') {
      return interpolate(defaultValueOrVars, maybeVars);
    }
    return interpolate(key, defaultValueOrVars);
  };
}

/* ─── usePageTitle (web sets document.title; native has no document) ────────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── native-safe formatting (web `@/lib/numberFormat`) ─────────────────────── */

const DEFAULT_GLOBAL_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── native-safe date format (web `@/lib/dateFormat` formatDate) ───────────── */

// "Apr 4, 2026"; null/invalid -> the universal "—" placeholder, matching the
// web formatter contract. en-US keeps the native render deterministic.
function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '\u2014';
  }
  return d.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/* ─── native unit shim (web `@/hooks/useUnits` + `@/lib/unitConversion`) ────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

// Mirrors web `convertDistanceFromSI` (SI meters -> display unit).
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
    case 'km':
    default:
      return meters / METERS_PER_KM;
  }
}

interface FormatOptions {
  precision?: number;
}

interface UseUnitsResult {
  unitPrefs: {distance: DistanceUnitPref};
  formatEnergy: (wh: number | null | undefined, options?: FormatOptions) => string;
}

// The native parity layer has no settings store wired in, so the hook mirrors
// the web out-of-box defaults: distance 'km', energy 'kWh', en-US locale. The
// API already returns SI; conversion happens here at the display boundary.
function useUnits(): UseUnitsResult {
  return useMemo<UseUnitsResult>(
    () => ({
      formatEnergy: (wh, options) => {
        if (wh == null || !Number.isFinite(wh)) {
          return '\u2014';
        }
        return `${fmtNumber(
          wh / 1000,
          options?.precision ?? DEFAULT_GLOBAL_PRECISION,
        )} kWh`;
      },
      unitPrefs: {distance: 'km'},
    }),
    [],
  );
}

/* ─── useHiddenSeries (web URL-persisted; native in-memory) ─────────────────── */

interface HiddenSeriesState {
  hidden: Set<string>;
  toggle: (seriesKey: string) => void;
  isHidden: (seriesKey: string) => boolean;
  reset: () => void;
}

// React Native has no URL query string to persist into, so the hidden-series
// set lives in component state. The toggle/isHidden/reset surface is identical,
// so the chart legend still declutters the projection view (deep-link sharing
// is the only web affordance lost — documented).
function useHiddenSeries(_chartKey: string): HiddenSeriesState {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const isHidden = useCallback(
    (seriesKey: string) => hidden.has(seriesKey),
    [hidden],
  );
  const toggle = useCallback((seriesKey: string) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(seriesKey)) {
        next.delete(seriesKey);
      } else {
        next.add(seriesKey);
      }
      return next;
    });
  }, []);
  const reset = useCallback(() => setHidden(new Set()), []);
  return {hidden, isHidden, reset, toggle};
}

/* ─── colour helpers (web `sohColor` / score / risk helpers) ───────────────── */

type Variant = 'success' | 'warning' | 'danger';

const COLOR_CRITICAL = '#ef4444';
const COLOR_HEALTH = '#10b981';
const COLOR_PROJECTED = '#a855f7';
const COLOR_WARRANTY = '#f59e0b';
const COLOR_CONFIDENCE = 'rgba(168, 85, 247, 0.35)';
const COLOR_RISK_GOOD = '#6ee7b7'; // text-emerald-300
const COLOR_RISK_WARN = '#fcd34d'; // text-amber-300
const COLOR_BAR_GOOD = '#10b981';
const COLOR_BAR_WARN = '#f59e0b';

function sohColor(soh: number): string {
  if (soh > 90) {
    return CHART_COLORS[1];
  }
  if (soh >= 80) {
    return CHART_COLORS[3];
  }
  return COLOR_CRITICAL;
}

function scoreVariant(score: number): Variant {
  if (score >= 80) {
    return 'success';
  }
  if (score >= 50) {
    return 'warning';
  }
  return 'danger';
}

function riskScoreColor(score: number): string {
  if (score <= 25) {
    return COLOR_RISK_GOOD;
  }
  if (score <= 50) {
    return COLOR_RISK_WARN;
  }
  return COLOR_CRITICAL;
}

function riskBarColor(score: number): string {
  if (score <= 25) {
    return COLOR_BAR_GOOD;
  }
  if (score <= 50) {
    return COLOR_BAR_WARN;
  }
  return COLOR_CRITICAL;
}

function riskBadgeVariant(score: number): Variant {
  if (score <= 25) {
    return 'success';
  }
  if (score <= 50) {
    return 'warning';
  }
  return 'danger';
}

// web `riskFactorIcon` (lucide) -> decorative emoji glyph.
function riskFactorGlyph(name: string): string {
  switch (name) {
    case 'fast_charge_ratio':
      return '\u26A1'; // Zap
    case 'high_soc_charging':
      return '\uD83D\uDD0B'; // Battery
    case 'temperature_exposure':
      return '\uD83C\uDF21'; // Thermometer
    case 'cycle_count_rate':
      return '\uD83D\uDCC8'; // Activity
    case 'deep_discharge_frequency':
      return '\uD83D\uDCC9'; // TrendingDown
    default:
      return '\uD83D\uDEE1'; // Shield
  }
}

function ageLabel(months: number, t: NativeTFunction): string {
  if (months < 12) {
    return t('{{count}} months', {count: months});
  }
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0
    ? t('{{y}}y {{m}}m', {m: rem, y: years})
    : t('{{y}} years', {y: years});
}

/* ─── FadeIn (web `@/components/motion` FadeIn) ─────────────────────────────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      delay: delay * 1000,
      duration: 320,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduceMotion]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0],
        }),
      },
    ],
  };

  return (
    <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>
  );
}

FadeIn.displayName = 'FadeIn';

/* ─── query-driven freshness chip (web `<DataFreshnessAuto>`) ───────────────── */

interface FreshnessQueryLike {
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
}

function FreshnessChip({
  query,
  forceStaleAfterMs,
  t,
}: {
  query: FreshnessQueryLike;
  forceStaleAfterMs: number;
  t: NativeTFunction;
}) {
  // Cagg-driven: force amber after the configured window to surface stale
  // aggregates, mirroring the web `forceStaleAfterMs` override.
  const forcedStale =
    query.dataUpdatedAt > 0 &&
    Date.now() - query.dataUpdatedAt > forceStaleAfterMs;

  if (query.isError) {
    return (
      <StatusPill label={t('common.freshness.error', 'Error')} state="offline" />
    );
  }
  if (query.isFetching) {
    return (
      <StatusPill
        label={t('common.freshness.updating', 'Updating\u2026')}
        state="warning"
      />
    );
  }
  if (query.isStale || forcedStale) {
    return (
      <StatusPill label={t('common.freshness.stale', 'Stale')} state="warning" />
    );
  }
  return (
    <StatusPill label={t('common.freshness.live', 'Live')} state="online" />
  );
}

FreshnessChip.displayName = 'FreshnessChip';

/* ─── NativeSelect (web `@/components/forms` VehicleSelect picker) ──────────── */

interface NativeSelectOption {
  value: string;
  label: string;
}

function NativeSelect({
  value,
  options,
  onChange,
  accessibilityLabel,
}: {
  value: string;
  options: NativeSelectOption[];
  onChange: (value: string) => void;
  accessibilityLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <View style={styles.select}>
      <Pressable
        accessibilityHint="Opens the option list"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(prev => !prev)}
        style={({pressed}) => [styles.selectTrigger, pressed && styles.pressed]}>
        <AppText numberOfLines={1} style={styles.selectValue}>
          {selected ? selected.label : '\u2014'}
        </AppText>
        <AppText style={styles.selectChevron} tone="muted">
          {open ? '\u25B4' : '\u25BE'}
        </AppText>
      </Pressable>
      {open ? (
        <View style={styles.selectList}>
          {options.map(option => {
            const isSelected = option.value === value;
            return (
              <Pressable
                accessibilityLabel={option.label}
                accessibilityRole="button"
                accessibilityState={{selected: isSelected}}
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({pressed}) => [
                  styles.selectOption,
                  isSelected && styles.selectOptionSelected,
                  pressed && styles.pressed,
                ]}>
                <AppText
                  numberOfLines={1}
                  tone={isSelected ? 'accent' : 'primary'}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

NativeSelect.displayName = 'NativeSelect';

/* ─── Badge (web `@/components/ui` Badge) ───────────────────────────────────── */

function Badge({
  children,
  variant,
  size = 'md',
}: {
  children: ReactNode;
  variant: Variant;
  size?: 'sm' | 'md';
}) {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant], size === 'sm' && styles.badgeSm]}>
      <AppText
        style={[styles.badgeText, {color: badgeTextColor[variant]}]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

Badge.displayName = 'Badge';

/* ─── MetricCard (web `@/components/data-display` MetricCard) ───────────────── */

type MetricColor = 'cyan' | 'green' | 'purple' | 'red' | 'amber' | 'default';

function metricColor(color: MetricColor): string {
  switch (color) {
    case 'green':
      return colors.success;
    case 'purple':
      return colors.violet;
    case 'red':
      return colors.danger;
    case 'amber':
      return colors.warning;
    case 'cyan':
      return colors.accent;
    default:
      return colors.textMuted;
  }
}

function MetricCard({
  label,
  value,
  glyph,
  color = 'cyan',
  help,
}: {
  label: string;
  value: string;
  glyph?: string;
  color?: MetricColor;
  // web help "?" tooltip -> accessibilityHint (native has no hover tooltip).
  help?: string;
}) {
  return (
    <View
      accessibilityHint={help}
      accessibilityRole={help ? 'summary' : undefined}
      style={styles.metricCard}>
      <View style={styles.metricHeader}>
        <AppText
          numberOfLines={1}
          style={styles.metricLabel}
          tone="muted"
          variant="caption">
          {label}
        </AppText>
        {glyph ? (
          <AppText style={[styles.metricGlyph, {color: metricColor(color)}]}>
            {glyph}
          </AppText>
        ) : null}
      </View>
      <AppText numberOfLines={1} style={styles.metricValue} weight="bold">
        {value}
      </AppText>
    </View>
  );
}

MetricCard.displayName = 'MetricCard';

/* ─── SeriesBarChart (web `@/components/charts` Recharts charts) ────────────── */

interface BarSeries {
  key: string;
  label: string;
  color: string;
  // Optional separate key into the hidden-series set (web ChartLegend keys the
  // confidence band by 'confidence_band' while it plots 'confidence_low').
  hideKey?: string;
}

interface ReferenceLine {
  value: number;
  color: string;
  label?: string;
}

type ChartRow = Record<string, string | number | undefined>;

const BAR_WIDTH = 16;
const BAR_INNER_GAP = 5;

function toBarNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function SeriesBarChart({
  data,
  xKey,
  series,
  height,
  yFormatter,
  accessibilityLabel,
  yMin,
  yMax,
  referenceLines,
  hidden,
  onToggleSeries,
  showLegend,
}: {
  data: ReadonlyArray<ChartRow>;
  xKey: string;
  series: ReadonlyArray<BarSeries>;
  height: number;
  yFormatter: (value: number) => string;
  accessibilityLabel: string;
  yMin?: number;
  yMax?: number;
  referenceLines?: ReadonlyArray<ReferenceLine>;
  hidden?: Set<string>;
  onToggleSeries?: (seriesKey: string) => void;
  showLegend?: boolean;
}) {
  const isSeriesHidden = (s: BarSeries): boolean =>
    hidden?.has(s.hideKey ?? s.key) ?? false;

  const dataMax = data.reduce((max, row) => {
    const rowMax = series.reduce(
      (m, s) => (isSeriesHidden(s) ? m : Math.max(m, toBarNumber(row[s.key]))),
      0,
    );
    return Math.max(max, rowMax);
  }, 0);

  const lo = yMin ?? 0;
  const hi = yMax ?? (dataMax > 0 ? dataMax : 1);
  const span = hi - lo > 0 ? hi - lo : 1;

  const yTicks = [hi, lo + span / 2, lo].map(yFormatter);
  const columnWidth = Math.max(
    48,
    series.length * BAR_WIDTH + (series.length - 1) * BAR_INNER_GAP + 18,
  );
  const legendVisible = showLegend ?? series.length > 1;

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      accessible
      style={styles.chartRoot}>
      <View style={styles.chartFrame}>
        <View style={[styles.yAxis, {height}]}>
          {yTicks.map((tick, index) => (
            <AppText
              key={`${tick}-${index}`}
              numberOfLines={1}
              style={styles.axisLabel}
              tone="muted"
              variant="caption">
              {tick}
            </AppText>
          ))}
        </View>
        <View style={[styles.plotArea, {height}]}>
          {(referenceLines ?? []).map(rl => {
            const top = Math.max(
              0,
              Math.min(1, 1 - (rl.value - lo) / span),
            ) * height;
            return (
              <View
                key={`ref-${rl.value}`}
                pointerEvents="none"
                style={[styles.refLine, {borderTopColor: rl.color, top}]}>
                {rl.label ? (
                  <AppText
                    style={[styles.refLabel, {color: rl.color}]}
                    variant="caption">
                    {rl.label}
                  </AppText>
                ) : null}
              </View>
            );
          })}
          <ScrollView
            contentContainerStyle={styles.barsContent}
            horizontal
            showsHorizontalScrollIndicator={false}>
            {data.map((row, rowIndex) => (
              <View key={rowIndex} style={[styles.barColumn, {width: columnWidth}]}>
                <View style={[styles.barTrack, {height}]}>
                  <View style={styles.barGroup}>
                    {series.map(s => {
                      if (isSeriesHidden(s)) {
                        return null;
                      }
                      const value = toBarNumber(row[s.key]);
                      const ratio = (value - lo) / span;
                      const pct =
                        value > lo
                          ? Math.max(Math.min(ratio, 1) * 100, 3)
                          : 0;
                      return (
                        <View
                          key={s.key}
                          pointerEvents="none"
                          style={[
                            styles.bar,
                            {
                              backgroundColor: s.color,
                              height: `${pct}%` as DimensionValue,
                            },
                          ]}
                        />
                      );
                    })}
                  </View>
                </View>
                <AppText
                  numberOfLines={1}
                  style={styles.barLabel}
                  tone="muted"
                  variant="caption">
                  {String(row[xKey] ?? '')}
                </AppText>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
      {legendVisible ? (
        <View style={styles.legend}>
          {series.map(s => {
            const itemHidden = isSeriesHidden(s);
            const inner = (
              <View style={styles.legendItem}>
                <View
                  pointerEvents="none"
                  style={[
                    styles.legendDot,
                    {backgroundColor: s.color, opacity: itemHidden ? 0.3 : 1},
                  ]}
                />
                <AppText
                  style={itemHidden ? styles.legendHidden : undefined}
                  tone="muted"
                  variant="caption">
                  {s.label}
                </AppText>
              </View>
            );
            return onToggleSeries ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{selected: !itemHidden}}
                key={s.key}
                onPress={() => onToggleSeries(s.hideKey ?? s.key)}
                style={({pressed}) => (pressed ? styles.pressed : undefined)}>
                {inner}
              </Pressable>
            ) : (
              <View key={s.key}>{inner}</View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

SeriesBarChart.displayName = 'SeriesBarChart';

/* ─── ChartPanel (web `@/components/charts` ChartContainer) ─────────────────── */

function ChartPanel({
  title,
  ariaLabel,
  children,
}: {
  title: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  // ChartContainer's exportable CSV/PNG download + brush zoom + hover tooltip +
  // chart annotations are browser/SVG-only affordances (unavailable on native);
  // the title + accessibilityLabel intent is kept.
  return (
    <GlassPanel accessibilityLabel={ariaLabel} padding="lg">
      <AppText style={styles.panelTitle} weight="semibold">
        {title}
      </AppText>
      {children}
    </GlassPanel>
  );
}

ChartPanel.displayName = 'ChartPanel';

/* ─── AlertBanner (web `@/components/feedback` AlertBanner) ─────────────────── */

function AlertBanner({
  variant,
  glyph,
  title,
  children,
}: {
  variant: Variant;
  glyph: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={[styles.alertBanner, alertVariantStyles[variant]]}>
      <AppText style={[styles.alertGlyph, {color: badgeTextColor[variant]}]}>
        {glyph}
      </AppText>
      <View style={styles.alertBody}>
        <AppText style={styles.alertTitle} weight="semibold">
          {title}
        </AppText>
        <AppText tone="secondary" variant="caption">
          {children}
        </AppText>
      </View>
    </View>
  );
}

AlertBanner.displayName = 'AlertBanner';

/* ─── DataTable (web `@/components/ui` DataTable) ───────────────────────────── */

interface Column<T> {
  key: keyof T & string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
}

const TABLE_PAGE_SIZE = 10;

function DataTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage,
  pagination,
}: {
  columns: ReadonlyArray<Column<T>>;
  data: ReadonlyArray<T>;
  keyExtractor: (row: T) => string;
  emptyMessage: string;
  pagination?: boolean;
}) {
  const [sortKey, setSortKey] = useState<(keyof T & string) | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (sortKey == null) {
      return data;
    }
    const copy = [...data];
    copy.sort((a, b) => {
      const av = a[sortKey] as unknown;
      const bv = b[sortKey] as unknown;
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [data, sortKey, sortDir]);

  const pageCount = pagination ? Math.ceil(sorted.length / TABLE_PAGE_SIZE) : 1;
  const safePage = Math.min(page, Math.max(0, pageCount - 1));
  const rows = pagination
    ? sorted.slice(safePage * TABLE_PAGE_SIZE, (safePage + 1) * TABLE_PAGE_SIZE)
    : sorted;

  const onHeaderPress = (col: Column<T>) => {
    if (!col.sortable) {
      return;
    }
    if (sortKey === col.key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      setSortDir('asc');
    }
    setPage(0);
  };

  if (data.length === 0) {
    return <EmptyState message={emptyMessage} title={emptyMessage} />;
  }

  return (
    <View>
      <View style={styles.tableHeaderRow}>
        {columns.map(col => {
          const active = sortKey === col.key;
          const indicator = active ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';
          return (
            <Pressable
              accessibilityRole={col.sortable ? 'button' : undefined}
              disabled={!col.sortable}
              key={col.key}
              onPress={() => onHeaderPress(col)}
              style={styles.tableCell}>
              <AppText
                numberOfLines={1}
                tone="muted"
                variant="caption"
                weight="semibold">
                {col.header}
                {indicator}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {rows.map(row => (
        <View key={keyExtractor(row)} style={styles.tableRow}>
          {columns.map(col => {
            const content = col.render(row);
            return (
              <View key={col.key} style={styles.tableCell}>
                {typeof content === 'string' || typeof content === 'number' ? (
                  <AppText numberOfLines={1} variant="caption">
                    {content}
                  </AppText>
                ) : (
                  content
                )}
              </View>
            );
          })}
        </View>
      ))}
      {pagination && pageCount > 1 ? (
        <View style={styles.pagination}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{disabled: safePage === 0}}
            disabled={safePage === 0}
            onPress={() => setPage(p => Math.max(0, p - 1))}
            style={({pressed}) => [
              styles.pageBtn,
              safePage === 0 && styles.pageBtnDisabled,
              pressed && styles.pressed,
            ]}>
            <AppText variant="caption">{'\u2039'}</AppText>
          </Pressable>
          <AppText tone="muted" variant="caption">
            {`${safePage + 1} / ${pageCount}`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{disabled: safePage >= pageCount - 1}}
            disabled={safePage >= pageCount - 1}
            onPress={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            style={({pressed}) => [
              styles.pageBtn,
              safePage >= pageCount - 1 && styles.pageBtnDisabled,
              pressed && styles.pressed,
            ]}>
            <AppText variant="caption">{'\u203A'}</AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

DataTable.displayName = 'DataTable';

/* ─── section header (web inline icon + title row) ─────────────────────────── */

function SectionHeader({glyph, color, text}: {glyph: string; color: string; text: string}) {
  return (
    <View style={styles.sectionHeader}>
      <AppText style={[styles.sectionIcon, {color}]}>{glyph}</AppText>
      <AppText style={styles.sectionTitle} weight="semibold">
        {text}
      </AppText>
    </View>
  );
}

SectionHeader.displayName = 'SectionHeader';

/* ─── constants ────────────────────────────────────────────────────────────── */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const PROJECTION_CHART_HEIGHT = 200;
const RANGE_CHART_HEIGHT = 180;

/* ─── BatteryDegradationPage ───────────────────────────────────────────────── */

export default function BatteryDegradationPage() {
  const t = useNativeTranslation();
  usePageTitle(t('battery.degradation.title', 'Battery Degradation'));

  // useSelectedVehicle shim: the header picker is the source of truth; default
  // to the first vehicle in the fleet (the web hook's final fallback).
  const vehiclesQuery = useVehicles();
  const vehicles: Vehicle[] = vehiclesQuery.data ?? [];
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(
    null,
  );
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (selectedVehicleId == null && firstVehicleId != null) {
      setSelectedVehicleId(firstVehicleId);
    }
  }, [selectedVehicleId, firstVehicleId]);
  const activeId = selectedVehicleId ?? firstVehicleId;
  const activeIdStr = activeId != null ? String(activeId) : null;

  // Battery health analytics (for overview stats, history table).
  const healthQuery = useBatteryHealthAnalytics(activeIdStr);
  const {data, isLoading, error} = healthQuery;

  // Degradation data (for prediction, risk factors, trend).
  const {data: degradation} = useBatteryDegradation(activeIdStr);

  // In-memory hidden-series state lets users declutter the projection view.
  const trendHidden = useHiddenSeries('battery-degradation-trend');

  // Backend `range_km` and `odometer` fields are derived SI in km. Convert
  // km -> metres -> user-pref display via the SI-canonical helper.
  const {unitPrefs, formatEnergy} = useUnits();
  const fromKm = useCallback(
    (km: number): number => convertDistanceFromSI(km * 1000, unitPrefs.distance),
    [unitPrefs.distance],
  );

  // Range-loss chart data.
  const rangeData = useMemo(() => {
    if (!data?.history || data.history.length === 0) {
      return [];
    }
    const originalRange = data.history[0].range_km;
    return data.history.map(h => ({
      current: h.range_km,
      date: formatDate(h.date),
      original: originalRange,
    }));
  }, [data]);

  // Projection chart: actual history + predicted future with confidence band.
  const projectionChartData = useMemo(() => {
    const hist = (data?.history ?? []).map(h => ({
      confidence_band: undefined as number | undefined,
      confidence_low: undefined as number | undefined,
      health: h.soh_pct,
      label: formatDate(h.date),
      projected: undefined as number | undefined,
    }));
    const projections = degradation?.projections ?? [];
    const proj = projections.map(p => ({
      confidence_band: Math.max(0, p.confidence_high - p.confidence_low),
      confidence_low: p.confidence_low,
      health: undefined as number | undefined,
      label: p.date,
      projected: p.health_pct,
    }));
    if (hist.length > 0 && proj.length > 0) {
      proj[0] = {...proj[0], health: hist[hist.length - 1].health};
    }
    return [...hist, ...proj];
  }, [data, degradation]);

  // Risk factors / charging-habit summaries.
  const habits = degradation?.charging_habits;
  const totalCharges =
    (habits?.fast_charge_count ?? 0) + (habits?.slow_charge_count ?? 0);
  const fastChargePct = fmtInt(
    totalCharges > 0
      ? ((habits?.fast_charge_count ?? 0) / totalCharges) * 100
      : 0,
  );

  const cycleDepthScore = data
    ? Math.max(0, Math.round(100 - data.avg_depth_of_discharge))
    : 0;

  // Table columns.
  const columns: Column<DegradationEntry>[] = useMemo(
    () => [
      {
        header: t('Date'),
        key: 'date',
        render: (row: DegradationEntry) => formatDate(row.date),
        sortable: true,
      },
      {
        header: t('Odometer'),
        key: 'odometer',
        render: (row: DegradationEntry) =>
          `${fmtNumber(fromKm(row.odometer))} ${unitPrefs.distance}`,
        sortable: true,
      },
      {
        header: t('SOH %'),
        key: 'soh_pct',
        render: (row: DegradationEntry) => (
          <Badge
            variant={
              row.soh_pct > 90
                ? 'success'
                : row.soh_pct >= 80
                ? 'warning'
                : 'danger'
            }>
            {`${fmtNumber(row.soh_pct)}%`}
          </Badge>
        ),
        sortable: true,
      },
      {
        header: t('Capacity'),
        key: 'capacity_wh',
        render: (row: DegradationEntry) =>
          formatEnergy(row.capacity_wh, {precision: 1}),
        sortable: true,
      },
      {
        header: t('Range'),
        key: 'range_km',
        render: (row: DegradationEntry) =>
          `${fmtNumber(fromKm(row.range_km))} ${unitPrefs.distance}`,
        sortable: true,
      },
    ],
    [t, fromKm, unitPrefs.distance, formatEnergy],
  );

  const vehicleOptions: NativeSelectOption[] = vehicles.map(v => ({
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
    value: String(v.id),
  }));

  const soh = data?.current_soh ?? 0;
  const sohBadgeVariant: Variant =
    soh > 90 ? 'success' : soh >= 80 ? 'warning' : 'danger';
  const sohBadgeLabel =
    soh > 90 ? t('Excellent') : soh >= 80 ? t('Good') : t('Degraded');

  const riskFactors = degradation?.risk_factors ?? [];
  const recommendations = degradation?.recommendations ?? [];
  const history = data?.history ?? [];

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="battery-degradation-page">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {t('Battery Degradation')}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {t(
              'Health trends, degradation predictions, and charging habit impact',
            )}
          </AppText>
        </View>
        <View style={styles.actions}>
          <NativeSelect
            accessibilityLabel={t('common.vehicle.select', 'Select vehicle')}
            onChange={v => setSelectedVehicleId(v ? Number(v) : null)}
            options={vehicleOptions}
            value={activeId != null ? String(activeId) : ''}
          />
          {/* Battery health analytics derive from a daily cagg; force amber after 24h. */}
          <FreshnessChip
            forceStaleAfterMs={TWENTY_FOUR_HOURS_MS}
            query={healthQuery}
            t={t}
          />
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <GlassPanel padding="lg">
          <EmptyState
            message={(error as Error).message}
            title={t('Failed to load battery degradation')}
          />
        </GlassPanel>
      ) : (
        <ErrorBoundary name="battery-degradation-page">
          <View style={styles.stack}>
            {/* ── Summary Metrics ───────────────────────────── */}
            <FadeIn>
              <View style={styles.metricsGrid}>
                <MetricCard
                  color="green"
                  glyph={'\uD83D\uDD0B'}
                  help={t(
                    'help.battery.soh',
                    'State of Health — current usable capacity divided by the original rated capacity, expressed as a percentage. Higher is better; new packs start at 100%.',
                  )}
                  label={t('Current SOH')}
                  value={`${fmtNumber(data?.current_soh ?? 0)}%`}
                />
                <MetricCard
                  color="cyan"
                  glyph={'\u26A1'}
                  help={t(
                    'help.battery.capacity',
                    'Estimated current usable energy capacity of the pack in kWh, derived from the SoH and the original rated capacity.',
                  )}
                  label={t('Estimated Capacity')}
                  value={`${fmtNumber(data?.estimated_capacity ?? 0)} kWh`}
                />
                <MetricCard
                  color="purple"
                  glyph={'\uD83D\uDCC9'}
                  help={t(
                    'help.battery.degradationRate',
                    'Annualised rate of capacity loss based on observed SoH trend. Combines calendar fade (time at temperature/SoC) and cycle fade (kWh throughput).',
                  )}
                  label={t('Degradation Rate')}
                  value={`${fmtNumber(data?.degradation_rate_yr ?? 0)}%/yr`}
                />
                <MetricCard
                  glyph={'\uD83D\uDCC5'}
                  label={t('Battery Age')}
                  value={data ? ageLabel(data.battery_age_months, t) : '\u2014'}
                />
              </View>
            </FadeIn>

            {/* ── Health Gauge + Prediction ─────────────────── */}
            <View style={styles.twoColGrid}>
              <FadeIn delay={0.05} style={styles.twoColItem}>
                <GlassPanel padding="lg" style={styles.gaugePanel}>
                  <RadialGauge
                    color={sohColor(data?.current_soh ?? 0)}
                    label={t('Battery Health')}
                    max={100}
                    size={180}
                    unit="%"
                    value={data?.current_soh ?? 0}
                  />
                  <View style={styles.gaugeBadge}>
                    <Badge variant={sohBadgeVariant}>{sohBadgeLabel}</Badge>
                  </View>
                </GlassPanel>
              </FadeIn>

              <FadeIn delay={0.1} style={styles.twoColItem}>
                <GlassPanel padding="lg">
                  <SectionHeader
                    color={colors.violet}
                    glyph={'\uD83D\uDCC9'}
                    text={t('battery.degradation.prediction', 'Prediction')}
                  />
                  {degradation?.prediction?.has_enough_data ? (
                    <View style={styles.predictionBody}>
                      <View style={styles.predictionCallout}>
                        <AppText tone="secondary" variant="caption">
                          {t(
                            'battery.degradation.predictionDesc',
                            'At current rate, battery reaches',
                          )}{' '}
                          <AppText style={styles.warrantyAccent} weight="bold">
                            80%
                          </AppText>{' '}
                          {t(
                            'battery.degradation.inApprox',
                            'in approximately',
                          )}{' '}
                          <AppText style={styles.projectedAccent} weight="bold">
                            {`~${fmtNumber(
                              degradation.prediction.years_to_80_pct ?? 0,
                            )} ${t('battery.degradation.years', 'years')}`}
                          </AppText>
                          {degradation.prediction.predicted_date
                            ? ` (${degradation.prediction.predicted_date})`
                            : ''}
                        </AppText>
                      </View>
                      <View style={styles.predictionGrid}>
                        <MetricCard
                          color="red"
                          help={t(
                            'help.battery.degradationRate',
                            'Annualised rate of capacity loss based on observed SoH trend. Combines calendar fade (time at temperature/SoC) and cycle fade (kWh throughput).',
                          )}
                          label={t(
                            'battery.degradation.rate',
                            'Degradation Rate',
                          )}
                          value={`${fmtNumber(
                            Math.abs(degradation.prediction.slope_per_year),
                          )}%/yr`}
                        />
                        <MetricCard
                          color={
                            degradation.stress_level === 'Low'
                              ? 'green'
                              : degradation.stress_level === 'Medium'
                              ? 'amber'
                              : 'red'
                          }
                          label={t('battery.degradation.stress', 'Stress Level')}
                          value={degradation.stress_level ?? '\u2014'}
                        />
                        <MetricCard
                          color="cyan"
                          help={t(
                            'help.battery.totalCycles',
                            'Cumulative full-pack equivalent cycles. One cycle = one full discharge + one full charge worth of energy (partial cycles add up over time).',
                          )}
                          label={t(
                            'battery.degradation.totalCycles',
                            'Total Cycles',
                          )}
                          value={fmtNumber(
                            data?.total_cycles ??
                              degradation.current_cycles ??
                              0,
                          )}
                        />
                        <MetricCard
                          color="purple"
                          help={t(
                            'help.battery.avgDoD',
                            'Average Depth of Discharge per cycle — how deeply the pack is typically discharged before being recharged. Shallower cycles cause less wear.',
                          )}
                          label={t(
                            'battery.degradation.avgDoD',
                            'Avg Depth of Discharge',
                          )}
                          value={`${fmtNumber(
                            data?.avg_depth_of_discharge ?? 0,
                          )}%`}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={styles.needMorePanel}>
                      <AppText style={styles.needMoreGlyph}>
                        {'\u26A0'}
                      </AppText>
                      <AppText tone="secondary" variant="caption">
                        {t(
                          'battery.degradation.needMore',
                          'Need more data points to generate prediction (minimum 3 snapshots required)',
                        )}
                      </AppText>
                    </View>
                  )}
                </GlassPanel>
              </FadeIn>
            </View>

            {/* ── Health Trend & Projection ─────────────────── */}
            {projectionChartData.length > 0 ? (
              <FadeIn delay={0.15}>
                <ChartPanel
                  ariaLabel={t(
                    'battery.degradation.trendTitle.aria',
                    'Battery health trend and 95% confidence projection chart',
                  )}
                  title={t(
                    'battery.degradation.trendTitle',
                    'Health Trend & Projection',
                  )}>
                  <SeriesBarChart
                    accessibilityLabel={t(
                      'battery.degradation.trendTitle.aria',
                      'Battery health trend and 95% confidence projection chart',
                    )}
                    data={projectionChartData}
                    height={PROJECTION_CHART_HEIGHT}
                    hidden={trendHidden.hidden}
                    onToggleSeries={trendHidden.toggle}
                    referenceLines={[
                      {
                        color: COLOR_WARRANTY,
                        label: t(
                          'battery.degradation.warranty',
                          '80% Warranty',
                        ),
                        value: 80,
                      },
                      {color: COLOR_CRITICAL, value: 70},
                    ]}
                    series={[
                      {
                        color: COLOR_CONFIDENCE,
                        hideKey: 'confidence_band',
                        key: 'confidence_low',
                        label: t(
                          'battery.degradation.confidence',
                          '95% Confidence',
                        ),
                      },
                      {
                        color: COLOR_HEALTH,
                        key: 'health',
                        label: t(
                          'battery.degradation.actualHealth',
                          'Actual Health %',
                        ),
                      },
                      {
                        color: COLOR_PROJECTED,
                        key: 'projected',
                        label: t('battery.degradation.projected', 'Projected %'),
                      },
                    ]}
                    xKey="label"
                    yFormatter={v => `${fmtNumber(v, 0)}%`}
                    yMax={100}
                    yMin={60}
                  />
                </ChartPanel>
              </FadeIn>
            ) : (
              <FadeIn delay={0.15}>
                <GlassPanel padding="lg">
                  <EmptyState
                    message={t(
                      'battery.degradation.trendLoading',
                      'Trend data will appear once history is available.',
                    )}
                    title={t('battery.degradation.trendTitle', 'Health Trend & Projection')}
                  />
                </GlassPanel>
              </FadeIn>
            )}

            {/* ── Range Loss Chart ──────────────────────────── */}
            {rangeData.length > 0 ? (
              <FadeIn delay={0.2}>
                <GlassPanel padding="lg">
                  <AppText style={styles.panelTitle} weight="semibold">
                    {t('battery.degradation.rangeLoss', 'Range Loss Over Time')}
                  </AppText>
                  <SeriesBarChart
                    accessibilityLabel={t(
                      'battery.degradation.rangeLoss',
                      'Range Loss Over Time',
                    )}
                    data={rangeData}
                    height={RANGE_CHART_HEIGHT}
                    series={[
                      {
                        color: CHART_COLORS[0],
                        key: 'original',
                        label: t('Original Range'),
                      },
                      {
                        color: CHART_COLORS[2],
                        key: 'current',
                        label: t('Current Range'),
                      },
                    ]}
                    xKey="date"
                    yFormatter={v => fmtNumber(v, 0)}
                  />
                </GlassPanel>
              </FadeIn>
            ) : (
              <FadeIn delay={0.2}>
                <GlassPanel padding="lg">
                  <EmptyState
                    message={t(
                      'battery.degradation.noRange',
                      'Range data will appear once history is available.',
                    )}
                    title={t('battery.degradation.rangeLoss', 'Range Loss Over Time')}
                  />
                </GlassPanel>
              </FadeIn>
            )}

            {/* ── Risk Factors (Scored Gauges) ──────────────── */}
            <FadeIn delay={0.25}>
              <GlassPanel padding="lg">
                <SectionHeader
                  color={colors.warning}
                  glyph={'\uD83D\uDEE1'}
                  text={t('battery.degradation.riskFactors', 'Risk Factors')}
                />
                {riskFactors.length > 0 ? (
                  <View style={styles.riskGrid}>
                    {riskFactors.map((rf: RiskFactorData) => (
                      <GlassPanel
                        key={rf.name}
                        padding="md"
                        style={styles.riskCard}>
                        <View style={styles.riskHeader}>
                          <View style={styles.riskNameRow}>
                            <AppText
                              style={[
                                styles.riskGlyph,
                                {color: riskScoreColor(rf.score)},
                              ]}>
                              {riskFactorGlyph(rf.name)}
                            </AppText>
                            <AppText
                              numberOfLines={1}
                              style={styles.riskName}
                              variant="caption"
                              weight="semibold">
                              {t(
                                `battery.degradation.risk.${rf.name}`,
                                rf.name.replace(/_/g, ' '),
                              )}
                            </AppText>
                          </View>
                          <Badge size="sm" variant={riskBadgeVariant(rf.score)}>
                            {rf.label}
                          </Badge>
                        </View>
                        <View style={styles.riskBarRow}>
                          <View style={styles.riskBarTrack}>
                            <View
                              style={[
                                styles.riskBarFill,
                                {
                                  backgroundColor: riskBarColor(rf.score),
                                  width: `${Math.max(
                                    0,
                                    Math.min(100, rf.score),
                                  )}%` as DimensionValue,
                                },
                              ]}
                            />
                          </View>
                          <AppText
                            style={[
                              styles.riskScore,
                              {color: riskScoreColor(rf.score)},
                            ]}
                            weight="bold">
                            {rf.score}
                          </AppText>
                        </View>
                        <AppText style={styles.riskDetail} tone="secondary" variant="caption">
                          {rf.detail}
                        </AppText>
                      </GlassPanel>
                    ))}
                  </View>
                ) : (
                  <EmptyState
                    message={t(
                      'battery.degradation.noRiskData',
                      'Risk data will appear once charging history is available.',
                    )}
                    title={t('battery.degradation.riskFactors', 'Risk Factors')}
                  />
                )}
              </GlassPanel>
            </FadeIn>

            {/* ── Recommendations ───────────────────────────── */}
            <FadeIn delay={0.27}>
              <GlassPanel padding="lg">
                <SectionHeader
                  color={colors.warning}
                  glyph={'\u26A0'}
                  text={t(
                    'battery.degradation.recommendations',
                    'Recommendations',
                  )}
                />
                {recommendations.length > 0 ? (
                  <View style={styles.recoList}>
                    {recommendations.map((rec, i) => (
                      <View key={i} style={styles.recoItem}>
                        <AppText style={styles.recoGlyph}>{'\u26A1'}</AppText>
                        <AppText style={styles.recoText}>{rec}</AppText>
                      </View>
                    ))}
                  </View>
                ) : (
                  <EmptyState
                    message={t(
                      'battery.degradation.noRecommendations',
                      'Recommendations will appear based on your usage patterns.',
                    )}
                    title={t(
                      'battery.degradation.recommendations',
                      'Recommendations',
                    )}
                  />
                )}
              </GlassPanel>
            </FadeIn>

            {/* ── Charging Habits Impact ────────────────────── */}
            <FadeIn delay={0.3}>
              <GlassPanel padding="lg">
                <SectionHeader
                  color={colors.success}
                  glyph={'\u26A1'}
                  text={t(
                    'battery.degradation.chargingImpact',
                    'Charging Habits Impact',
                  )}
                />
                <AlertBanner
                  glyph={'\uD83C\uDF21'}
                  title={`${fastChargePct}% ${t(
                    'battery.degradation.fastCharges',
                    'fast charges',
                  )}, ${habits?.deep_discharge_count ?? 0} ${t(
                    'battery.degradation.deepDischarges',
                    'deep discharges',
                  )} — ${degradation?.stress_level ?? 'Unknown'} ${t(
                    'battery.degradation.stressLabel',
                    'stress',
                  )}`}
                  variant={
                    degradation?.stress_level === 'Low'
                      ? 'success'
                      : degradation?.stress_level === 'Medium'
                      ? 'warning'
                      : 'danger'
                  }>
                  {degradation?.stress_level === 'Low'
                    ? t(
                        'battery.degradation.stressLow',
                        'Your charging habits are optimal for battery longevity.',
                      )
                    : degradation?.stress_level === 'Medium'
                    ? t(
                        'battery.degradation.stressMedium',
                        'Consider reducing fast charging frequency and avoiding full charges when possible.',
                      )
                    : t(
                        'battery.degradation.stressHigh',
                        'High stress detected. Reducing fast charges and deep discharges can improve battery lifespan.',
                      )}
                </AlertBanner>
              </GlassPanel>
            </FadeIn>

            {/* ── Battery Health Factors ────────────────────── */}
            <FadeIn delay={0.25}>
              <GlassPanel padding="lg">
                <SectionHeader
                  color={colors.warning}
                  glyph={'\uD83D\uDEE1'}
                  text={t('Battery Health Factors')}
                />
                <View style={styles.healthFactorsGrid}>
                  {/* Charge habits */}
                  <GlassPanel padding="md" style={styles.factorCard}>
                    <View style={styles.factorHeader}>
                      <AppText style={styles.factorLabel} variant="caption" weight="semibold">
                        {t('Charge Habits')}
                      </AppText>
                      <Badge
                        size="sm"
                        variant={scoreVariant(data?.charge_habits_score ?? 0)}>
                        {`${fmtNumber(data?.charge_habits_score ?? 0)}/100`}
                      </Badge>
                    </View>
                    <View style={styles.factorRows}>
                      <View style={styles.factorRow}>
                        <AppText tone="muted" variant="caption">
                          {t('Fast Charge')}
                        </AppText>
                        <AppText variant="caption" weight="semibold">
                          {`${fmtNumber(data?.fast_charge_pct ?? 0)}%`}
                        </AppText>
                      </View>
                      <View style={styles.factorRow}>
                        <AppText tone="muted" variant="caption">
                          {t('Full Charge')}
                        </AppText>
                        <AppText variant="caption" weight="semibold">
                          {`${fmtNumber(data?.full_charge_pct ?? 0)}%`}
                        </AppText>
                      </View>
                    </View>
                  </GlassPanel>

                  {/* Temperature exposure */}
                  <GlassPanel padding="md" style={styles.factorCard}>
                    <View style={styles.factorHeader}>
                      <AppText style={styles.factorLabel} variant="caption" weight="semibold">
                        {t('Temperature Exposure')}
                      </AppText>
                      <Badge
                        size="sm"
                        variant={scoreVariant(data?.temp_exposure_score ?? 0)}>
                        {`${fmtNumber(data?.temp_exposure_score ?? 0)}/100`}
                      </Badge>
                    </View>
                    <View style={styles.factorRow}>
                      <AppText tone="muted" variant="caption">
                        {'\uD83C\uDF21 '}
                        {t('Lower is better for longevity')}
                      </AppText>
                    </View>
                  </GlassPanel>

                  {/* Cycle depth */}
                  <GlassPanel padding="md" style={styles.factorCard}>
                    <View style={styles.factorHeader}>
                      <AppText style={styles.factorLabel} variant="caption" weight="semibold">
                        {t('Cycle Depth')}
                      </AppText>
                      <Badge size="sm" variant={scoreVariant(cycleDepthScore)}>
                        {`${fmtNumber(cycleDepthScore)}/100`}
                      </Badge>
                    </View>
                    <View style={styles.factorRow}>
                      <AppText tone="muted" variant="caption">
                        {t('Avg DoD')}
                      </AppText>
                      <AppText variant="caption" weight="semibold">
                        {`${fmtNumber(data?.avg_depth_of_discharge ?? 0)}%`}
                      </AppText>
                    </View>
                  </GlassPanel>
                </View>
              </GlassPanel>
            </FadeIn>

            {/* ── Degradation History Table ─────────────────── */}
            <FadeIn delay={0.3}>
              <GlassPanel padding="lg">
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('Degradation History')}
                </AppText>
                {history.length > 0 ? (
                  <DataTable
                    columns={columns}
                    data={history as DegradationEntry[]}
                    emptyMessage={t('No degradation records found.')}
                    keyExtractor={(row: DegradationEntry) =>
                      `${row.date}-${row.odometer}`
                    }
                    pagination
                  />
                ) : (
                  <EmptyState
                    message={t(
                      'battery.degradation.noHistory',
                      'No degradation records found.',
                    )}
                    title={t('Degradation History')}
                  />
                )}
              </GlassPanel>
            </FadeIn>
          </View>
        </ErrorBoundary>
      )}
    </ScrollView>
  );
}

BatteryDegradationPage.displayName = 'BatteryDegradationPage';

const badgeVariantStyles = StyleSheet.create<Record<Variant, ViewStyle>>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const badgeTextColor: Record<Variant, string> = {
  danger: colors.danger,
  success: colors.success,
  warning: colors.warning,
};

const alertVariantStyles = StyleSheet.create<Record<Variant, ViewStyle>>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  alertBanner: {
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  alertBody: {
    flex: 1,
    gap: spacing.xs,
  },
  alertGlyph: {
    fontSize: 16,
  },
  alertTitle: {
    fontSize: 14,
  },
  axisLabel: {
    textAlign: 'right',
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgeSm: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
  },
  bar: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    minHeight: 2,
    width: BAR_WIDTH,
  },
  barColumn: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  barGroup: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: BAR_INNER_GAP,
    height: '100%',
  },
  barLabel: {
    maxWidth: 70,
    textAlign: 'center',
  },
  barTrack: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  barsContent: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  chartFrame: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  chartRoot: {
    gap: spacing.sm,
    marginTop: spacing.sm,
    width: '100%',
  },
  factorCard: {
    flexBasis: '30%',
    flexGrow: 1,
    gap: spacing.sm,
    minWidth: 150,
  },
  factorHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  factorLabel: {
    flexShrink: 1,
  },
  factorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  factorRows: {
    gap: spacing.xs,
  },
  gaugeBadge: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  gaugePanel: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerCopy: {
    flexGrow: 1,
    flexShrink: 1,
    gap: spacing.xs,
    minWidth: 200,
  },
  healthFactorsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  legendDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  legendHidden: {
    textDecorationLine: 'line-through',
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  metricCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: '46%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 150,
    padding: spacing.md,
  },
  metricGlyph: {
    fontSize: 14,
  },
  metricHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  metricLabel: {
    flexShrink: 1,
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 20,
    lineHeight: 26,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  needMoreGlyph: {
    color: colors.warning,
    fontSize: 24,
  },
  needMorePanel: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  pageBtn: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pageBtnDisabled: {
    opacity: 0.4,
  },
  pageSubtitle: {},
  pageTitle: {
    color: colors.textPrimary,
  },
  pagination: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  panelTitle: {
    fontSize: 15,
    marginBottom: spacing.sm,
  },
  plotArea: {
    flex: 1,
    position: 'relative',
  },
  predictionBody: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  predictionCallout: {
    backgroundColor: colors.violetSurface,
    borderColor: colors.violetBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  predictionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  projectedAccent: {
    color: colors.violet,
  },
  recoGlyph: {
    color: colors.warning,
    fontSize: 14,
    marginTop: 1,
  },
  recoItem: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  recoList: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  recoText: {
    flex: 1,
  },
  refLabel: {
    position: 'absolute',
    right: 2,
    top: -14,
  },
  refLine: {
    borderStyle: 'dashed',
    borderTopWidth: 1,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  riskBarFill: {
    borderRadius: 999,
    height: '100%',
  },
  riskBarRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  riskBarTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flex: 1,
    height: 8,
    overflow: 'hidden',
  },
  riskCard: {
    flexBasis: '46%',
    flexGrow: 1,
    gap: spacing.sm,
    minWidth: 160,
  },
  riskDetail: {
    fontSize: 11,
  },
  riskGlyph: {
    fontSize: 14,
  },
  riskGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  riskHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  riskName: {
    flexShrink: 1,
    textTransform: 'capitalize',
  },
  riskNameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.xs,
  },
  riskScore: {
    fontSize: 14,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sectionIcon: {
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 14,
  },
  select: {
    minWidth: 200,
    position: 'relative',
  },
  selectChevron: {
    marginLeft: spacing.sm,
  },
  selectList: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  selectOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectOptionSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectValue: {
    flexShrink: 1,
  },
  stack: {
    gap: spacing.lg,
  },
  tableCell: {
    flex: 1,
    paddingHorizontal: spacing.xs,
  },
  tableHeaderRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingBottom: spacing.sm,
  },
  tableRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingVertical: spacing.sm,
  },
  twoColGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  twoColItem: {
    flexBasis: '46%',
    flexGrow: 1,
    minWidth: 280,
  },
  warrantyAccent: {
    color: colors.warning,
  },
  yAxis: {
    justifyContent: 'space-between',
    paddingBottom: 20,
    width: 56,
  },
});
