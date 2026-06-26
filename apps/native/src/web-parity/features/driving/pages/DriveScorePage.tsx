// Native parity port of web/src/features/driving/pages/DriveScorePage.tsx.
//
// Drive Score page for the selected vehicle. Backed by two driving queries:
//   - GET /api/v1/drives/score?vehicle_id=  (useDriveScore -> DriveScore) drives
//     the optional server-provided overall/category scores + grade + trend.
//   - GET /api/v1/drives?vehicle_id=        (useDrives -> Drive[]) drives the
//     client-side scoring algorithm (scoreDrive), the date filter, the sortable
//     paginated history table, every chart, the best/worst drives, the weekly /
//     monthly period stats, and the achievement checks.
//
// Every web behavior, state name, API path, unit-handling rule and i18n key is
// preserved; the web DOM / Tailwind / Recharts / lucide stack is replaced with
// React Native primitives + the native parity component library, following the
// TrueCostPage / BatteryDegradationPage precedents:
//
//   - `@/components/layout` PageContainer (title/subtitle/loading/actions) has no
//     native parity component, so a local ScrollView screen scaffold reproduces
//     the header (title + subtitle), the `actions` row (VehicleSelect +
//     RangePicker), the centred loading spinner, and the body wrapped in the
//     native ErrorBoundary (== PageContainer's PageErrorBoundary). Grid -> native
//     flex-wrap rows.
//   - `@/components/forms` VehicleSelect -> a local NativeSelect bound to
//     useVehicles() + local state; combined with the useSelectedVehicle shim
//     (first-vehicle default) this reproduces the "default to a vehicle, allow
//     switching" behaviour without the web router/store. RangePicker (a calendar
//     popover) has no native date-picker dependency here, so it degrades to a
//     preset NativeSelect (Last 7/30/90/365 days) that drives the same
//     start/end ISO state — documented in the sidecar.
//   - `@/components/ui` GlassPanel reuses the native parity GlassPanel. Badge,
//     Card/CardHeader, Pagination and HelpTooltip have no native parity, so local
//     native Badge / CardHeader / Pagination / HelpGlyph reproduce them (the web
//     hover tooltip becomes an accessibilityHint).
//   - `@/components/data-display` AnimatedNumber / StatCard / MetricBar /
//     InlineMetric / KVList -> the native parity StatCard plus local native
//     AnimatedNumber (reduced-motion count-up), MetricBar, InlineMetric and
//     KVList.
//   - `@/components/charts` RadialGauge reuses the native parity RadialGauge.
//     ChartContainer + Recharts LineChart/BarChart/Cell/ReferenceLine/Legend
//     (the native recharts barrel only renders an "unavailable" placeholder)
//     become a local ChartPanel wrapping a real native SeriesBarChart
//     (proportional View bars in a horizontal ScrollView with a y-axis, an
//     interactive legend, an optional fixed [yMin,yMax] domain, per-row colours,
//     and dashed reference lines). The Score-Trend line chart degrades to a
//     grouped bar chart of the same series; the web hover tooltip + CSV/PNG
//     export + chart annotations are browser/SVG-only and unavailable on native
//     (documented in the sidecar); the y=80 grade-A reference line + the 0..100
//     domain + category colours are preserved.
//   - `@/components/feedback` EmptyState -> native parity EmptyState (the web
//     icon-only variants get a short title).
//   - `@/components/motion` StaggerContainer/StaggerItem -> a reduced-motion-aware
//     FadeIn honouring a per-section delay.
//   - `@/hooks/usePageTitle` (document.title) -> native no-op shim.
//   - `@/hooks/useSelectedVehicle` -> first-vehicle default + NativeSelect.
//   - `@/hooks/useUnits` + `@/lib/unitConversion` convertDistanceFromSI /
//     convertSpeedFromSI -> native shims mirroring the web out-of-box defaults
//     (distance 'km', speed 'km/h'); the API already returns SI and conversion
//     happens at the display boundary, exactly as the web hooks do.
//   - `@/lib/dateFormat` formatDateShort/formatDurationMinutes +
//     `@/lib/numberFormat` fmtNumber/fmtInt/fmtWithUnit -> inlined native-safe
//     equivalents.
//   - `@/lib/cn` (clsx + tailwind-merge) is dropped; conditional classNames
//     become StyleSheet style arrays + computed colour literals.
//   - react-i18next useTranslation -> a local t(key, fallbackOrVars?, vars?) shim
//     mirroring i18next's flexible signature so every key + English copy +
//     `{{count}}/{{grade}}/{{val}}/{{category}}` interpolation + the
//     `{defaultValue}` form are preserved verbatim.
//   - `@/lib/icons` Icons.* + lucide are decorative; rendered as colour-coded
//     emoji glyphs (the native labels carry the meaning).

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
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useDriveScore, useDrives, type Drive} from '../../../api/hooks/useDriving';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {RadialGauge} from '../../../components/charts/RadialGauge';
import {StatCard} from '../../../components/data-display/StatCard';
import {ErrorBoundary} from '../../../components/feedback/ErrorBoundary';
import {GlassPanel} from '../../../components/ui/GlassPanel';

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type TranslationVars = Record<string, string | number> & {
  defaultValue?: string;
};
type NativeTFunction = (
  key: string,
  fallbackOrVars?: string | TranslationVars,
  vars?: TranslationVars,
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

function useNativeTranslation(): NativeTFunction {
  return (key, fallbackOrVars, vars) => {
    if (typeof fallbackOrVars === 'string') {
      return interpolate(fallbackOrVars, vars);
    }
    if (fallbackOrVars != null && typeof fallbackOrVars === 'object') {
      const fallback =
        typeof fallbackOrVars.defaultValue === 'string'
          ? fallbackOrVars.defaultValue
          : key;
      return interpolate(fallback, fallbackOrVars);
    }
    return key;
  };
}

/* ─── usePageTitle (web sets document.title; native has no document) ────────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── native-safe formatting (web `@/lib/numberFormat`) ─────────────────────── */

const DEFAULT_GLOBAL_PRECISION = 2;
const FALLBACK = '\u2014';

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
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

function fmtWithUnit(v: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(v, decimals)} ${unit}`;
}

/* ─── native-safe date helpers (web `@/lib/dateFormat`) ─────────────────────── */

// Mirrors web formatDateShort: "Jun 26" (month short + numeric day).
function formatDateShort(iso: string | Date | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  try {
    return d.toLocaleDateString('en-US', {day: 'numeric', month: 'short'});
  } catch {
    return FALLBACK;
  }
}

// Mirrors web formatDurationMinutes: "1h 5m" / "42m"; "—" for nullish/negative.
function formatDurationMinutes(minutes: number | null | undefined): string {
  if (!isFiniteNumber(minutes) || minutes < 0) {
    return FALLBACK;
  }
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ─── native unit shim (web `@/hooks/useUnits` + `@/lib/unitConversion`) ────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type SpeedUnitPref = 'km/h' | 'mph';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;
const SECONDS_PER_HOUR = 3600;

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

// Mirrors web `convertSpeedFromSI` (SI m/s -> display unit).
function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
    case 'km/h':
    default:
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
  }
}

interface UseUnitsResult {
  unitPrefs: {distance: DistanceUnitPref; speed: SpeedUnitPref};
}

// The native parity layer has no settings store wired in, so the hook mirrors
// the web out-of-box defaults: distance 'km', speed 'km/h'. The API returns SI;
// conversion happens here at the display boundary, exactly as the web hook does.
function useUnits(): UseUnitsResult {
  return useMemo<UseUnitsResult>(
    () => ({unitPrefs: {distance: 'km', speed: 'km/h'}}),
    [],
  );
}

/* ─── reduced-motion + FadeIn (web `@/components/motion`) ───────────────────── */

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

/* ─── AnimatedNumber (web `@/components/data-display` AnimatedNumber) ────────── */

function AnimatedNumber({
  value,
  decimals = 0,
  style,
}: {
  value: number;
  decimals?: number;
  style?: StyleProp<TextStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(safeNumber(value))).current;
  const [display, setDisplay] = useState(() => safeNumber(value));

  useEffect(() => {
    const target = safeNumber(value);
    if (reduceMotion) {
      anim.setValue(target);
      setDisplay(target);
      return;
    }
    const id = anim.addListener(({value: v}) => setDisplay(v));
    const animation = Animated.timing(anim, {
      duration: 600,
      easing: Easing.out(Easing.cubic),
      toValue: target,
      useNativeDriver: false,
    });
    animation.start();
    return () => {
      animation.stop();
      anim.removeListener(id);
    };
  }, [anim, reduceMotion, value]);

  return (
    <AppText style={style} weight="bold">
      {fmtNumber(display, decimals)}
    </AppText>
  );
}

AnimatedNumber.displayName = 'AnimatedNumber';

/* ─── Badge (web `@/components/ui` Badge) ───────────────────────────────────── */

type BadgeVariant = 'success' | 'info' | 'warning' | 'danger';
type BadgeSize = 'sm' | 'lg';

const BADGE_PALETTE: Record<
  BadgeVariant,
  {bg: string; border: string; text: string}
> = {
  danger: {
    bg: 'rgba(248, 113, 113, 0.12)',
    border: 'rgba(248, 113, 113, 0.32)',
    text: '#f87171',
  },
  info: {
    bg: 'rgba(34, 211, 238, 0.12)',
    border: 'rgba(34, 211, 238, 0.32)',
    text: '#22d3ee',
  },
  success: {
    bg: 'rgba(74, 222, 128, 0.12)',
    border: 'rgba(74, 222, 128, 0.32)',
    text: '#4ade80',
  },
  warning: {
    bg: 'rgba(251, 191, 36, 0.12)',
    border: 'rgba(251, 191, 36, 0.32)',
    text: '#fbbf24',
  },
};

function Badge({
  variant = 'info',
  size = 'sm',
  children,
  style,
}: {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children: string;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = BADGE_PALETTE[variant];
  return (
    <View
      style={[
        styles.badge,
        size === 'lg' ? styles.badgeLg : styles.badgeSm,
        {backgroundColor: palette.bg, borderColor: palette.border},
        style,
      ]}>
      <AppText
        style={[
          size === 'lg' ? styles.badgeTextLg : styles.badgeTextSm,
          {color: palette.text},
        ]}
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

Badge.displayName = 'Badge';

/* ─── CardHeader (web `@/components/ui` Card/CardHeader) ─────────────────────── */

function CardHeader({title}: {title: string}) {
  return (
    <View style={styles.cardHeader}>
      <AppText style={styles.cardHeaderTitle} weight="semibold">
        {title}
      </AppText>
    </View>
  );
}

CardHeader.displayName = 'CardHeader';

/* ─── MetricBar (web `@/components/data-display` MetricBar) ──────────────────── */

function MetricBar({
  value,
  max,
  color,
  label,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
}) {
  const pct =
    max > 0 ? Math.max(0, Math.min(1, safeNumber(value) / max)) * 100 : 0;
  return (
    <View
      accessibilityLabel={`${label}: ${fmtInt(value)}/${fmtInt(max)}`}
      accessibilityRole="progressbar"
      style={styles.metricBarTrack}>
      <View
        pointerEvents="none"
        style={[
          styles.metricBarFill,
          {backgroundColor: color, width: `${pct}%` as DimensionValue},
        ]}
      />
    </View>
  );
}

MetricBar.displayName = 'MetricBar';

/* ─── InlineMetric (web `@/components/data-display` InlineMetric) ────────────── */

function InlineMetric({
  glyph,
  glyphColor,
  label,
  value,
}: {
  glyph: string;
  glyphColor: string;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.inlineMetric}>
      <AppText style={[styles.inlineGlyph, {color: glyphColor}]}>
        {glyph}
      </AppText>
      <AppText
        numberOfLines={1}
        style={styles.inlineLabel}
        tone="muted"
        variant="caption">
        {label}
      </AppText>
      <AppText numberOfLines={1} style={styles.inlineValue} variant="caption">
        {value}
      </AppText>
    </View>
  );
}

InlineMetric.displayName = 'InlineMetric';

/* ─── KVList (web `@/components/data-display` KVList) ────────────────────────── */

function KVList({items}: {items: Array<{label: string; value: string}>}) {
  return (
    <View style={styles.kvList}>
      {items.map((item, index) => (
        <View key={index} style={styles.kvRow}>
          <AppText style={styles.kvLabel} tone="muted">
            {item.label}
          </AppText>
          <AppText style={styles.kvValue}>{item.value}</AppText>
        </View>
      ))}
    </View>
  );
}

KVList.displayName = 'KVList';

/* ─── HelpGlyph (web `@/components/ui` HelpTooltip; no native hover) ─────────── */

function HelpGlyph({hint, label}: {hint: string; label: string}) {
  return (
    <AppText
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole="summary"
      style={styles.helpGlyph}
      tone="muted">
      {'\u24D8'}
    </AppText>
  );
}

HelpGlyph.displayName = 'HelpGlyph';

/* ─── Pagination (web `@/components/ui` Pagination) ─────────────────────────── */

function Pagination({
  page,
  total,
  pageSize,
  onPageChange,
  t,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  t: NativeTFunction;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;
  return (
    <View style={styles.pagination}>
      <Pressable
        accessibilityLabel={t('common.pagination.prev', 'Previous page')}
        accessibilityRole="button"
        accessibilityState={{disabled: !canPrev}}
        disabled={!canPrev}
        onPress={() => onPageChange(page - 1)}
        style={({pressed}) => [
          styles.pageButton,
          !canPrev && styles.pageButtonDisabled,
          pressed && canPrev && styles.pressed,
        ]}>
        <AppText tone={canPrev ? 'primary' : 'muted'}>{'\u2039'}</AppText>
      </Pressable>
      <AppText style={styles.pageLabel} tone="muted" variant="caption">
        {t('common.pagination.pageOf', 'Page {{page}} of {{total}}', {
          page,
          total: totalPages,
        })}
      </AppText>
      <Pressable
        accessibilityLabel={t('common.pagination.next', 'Next page')}
        accessibilityRole="button"
        accessibilityState={{disabled: !canNext}}
        disabled={!canNext}
        onPress={() => onPageChange(page + 1)}
        style={({pressed}) => [
          styles.pageButton,
          !canNext && styles.pageButtonDisabled,
          pressed && canNext && styles.pressed,
        ]}>
        <AppText tone={canNext ? 'primary' : 'muted'}>{'\u203A'}</AppText>
      </Pressable>
    </View>
  );
}

Pagination.displayName = 'Pagination';

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
          {selected ? selected.label : FALLBACK}
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

/* ─── RangePicker (web `@/components/forms` RangePicker calendar popover) ────── */

interface DateRange {
  start: string;
  end: string;
}

const RANGE_PRESETS: ReadonlyArray<{key: string; days: number}> = [
  {days: 7, key: '7d'},
  {days: 30, key: '30d'},
  {days: 90, key: '90d'},
  {days: 365, key: '365d'},
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// The web RangePicker is an interactive calendar popover; native has no
// date-picker dependency wired in, so it degrades to a preset dropdown driving
// the same {start,end} ISO state (default Last 30 days == getDefaultStartDate).
function RangePicker({
  value,
  onChange,
  t,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  t: NativeTFunction;
}) {
  const presetLabels: Record<string, string> = {
    '30d': t('driveScore.range.30d', 'Last 30 days'),
    '365d': t('driveScore.range.365d', 'Last 365 days'),
    '7d': t('driveScore.range.7d', 'Last 7 days'),
    '90d': t('driveScore.range.90d', 'Last 90 days'),
  };
  const matched = RANGE_PRESETS.find(p => value.start === isoDaysAgo(p.days));
  const current = matched ? matched.key : 'custom';
  const options: NativeSelectOption[] = RANGE_PRESETS.map(p => ({
    label: presetLabels[p.key],
    value: p.key,
  }));
  if (!matched) {
    options.unshift({
      label: t('driveScore.range.custom', 'Custom range'),
      value: 'custom',
    });
  }
  return (
    <NativeSelect
      accessibilityLabel={t('driveScore.range.select', 'Select date range')}
      onChange={key => {
        const preset = RANGE_PRESETS.find(p => p.key === key);
        if (preset) {
          onChange({end: todayIso(), start: isoDaysAgo(preset.days)});
        }
      }}
      options={options}
      value={current}
    />
  );
}

RangePicker.displayName = 'RangePicker';

/* ─── SeriesBarChart (web `@/components/charts` Recharts charts) ────────────── */

interface BarSeries {
  key: string;
  label: string;
  color: string;
}

interface ChartReferenceLine {
  value: number;
  color: string;
  label?: string;
}

type ChartRow = Record<string, string | number | undefined>;

const BAR_WIDTH = 14;
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
  colorFor,
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
  referenceLines?: ReadonlyArray<ChartReferenceLine>;
  colorFor?: (row: ChartRow, seriesKey: string) => string | undefined;
  showLegend?: boolean;
}) {
  const dataMax = data.reduce((max, row) => {
    const rowMax = series.reduce(
      (m, s) => Math.max(m, toBarNumber(row[s.key])),
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

  if (data.length === 0) {
    return null;
  }

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
            const top =
              Math.max(0, Math.min(1, 1 - (rl.value - lo) / span)) * height;
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
              <View
                key={rowIndex}
                style={[styles.barColumn, {width: columnWidth}]}>
                <View style={[styles.barTrack, {height}]}>
                  <View style={styles.barGroup}>
                    {series.map(s => {
                      const value = toBarNumber(row[s.key]);
                      const ratio = (value - lo) / span;
                      const pct =
                        value > lo ? Math.max(Math.min(ratio, 1) * 100, 3) : 0;
                      const fill = colorFor?.(row, s.key) ?? s.color;
                      return (
                        <View
                          key={s.key}
                          pointerEvents="none"
                          style={[
                            styles.bar,
                            {
                              backgroundColor: fill,
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
          {series.map(s => (
            <View key={s.key} style={styles.legendItem}>
              <View
                pointerEvents="none"
                style={[styles.legendDot, {backgroundColor: s.color}]}
              />
              <AppText tone="muted" variant="caption">
                {s.label}
              </AppText>
            </View>
          ))}
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
  // ChartContainer's exportable CSV/PNG download + hover tooltip + chart
  // annotations are browser/SVG-only affordances (unavailable on native); the
  // title + accessibilityLabel intent is kept.
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

/* ─── SortHeader (web inline Button-based sort header) ──────────────────────── */

function SortHeader({
  field,
  label,
  sortField,
  sortDir,
  onSort,
}: {
  field: SortField;
  label: string;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected: active}}
      onPress={() => onSort(field)}
      style={({pressed}) => [styles.sortHeader, pressed && styles.pressed]}>
      <AppText style={styles.sortHeaderLabel} tone="muted" variant="caption">
        {label}
      </AppText>
      {active ? (
        <AppText style={styles.sortHeaderArrow} tone="muted" variant="caption">
          {sortDir === 'asc' ? '\u25B2' : '\u25BC'}
        </AppText>
      ) : null}
    </Pressable>
  );
}

SortHeader.displayName = 'SortHeader';

/* ─── Types ─────────────────────────────────────────────────────────────────── */

interface DriveScore {
  total: number;
  efficiency: number;
  smoothness: number;
  speed: number;
  grade: string;
  whPerKm: number;
}

type SortField = 'date' | 'distance' | 'score' | 'efficiency';
type SortDir = 'asc' | 'desc';

interface ScoredDrive {
  drive: Drive;
  score: DriveScore;
}

/* ─── Constants ─────────────────────────────────────────────────────────────── */

const GRADE_COLORS: Record<string, string> = {
  'A+': '#39ff14',
  A: '#4ade80',
  B: '#22d3ee',
  C: '#fbbf24',
  D: '#fb923c',
  F: '#f87171',
};

const CATEGORY_COLORS = {
  efficiency: '#4ade80',
  smoothness: '#22d3ee',
  speed: '#a78bfa',
};

const COLOR_GOOD = '#4ade80'; // web COLOR.GOOD — grade-A reference line.
const COLOR_MAX_TRACK = '#1e293b'; // faint category "max" track bar.

const DRIVES_PER_PAGE = 10;

/* ─── Scoring algorithm (web `scoreDrive`, ported verbatim) ─────────────────── */

function scoreDrive(drive: Drive): DriveScore {
  const battUsed = (drive.startBatteryPct ?? 50) - (drive.endBatteryPct ?? 45);
  const energyKwh =
    drive.energyUsedWh != null ? drive.energyUsedWh / 1000 : (battUsed / 100) * 75;
  const distanceKm = drive.distanceM / 1000;
  const whPerKm = distanceKm > 0 ? (energyKwh * 1000) / distanceKm : 200;

  const effScore = Math.max(0, Math.min(40, 40 - (whPerKm - 130) / 3));
  const avgPowerKw = drive.avgPowerW != null ? drive.avgPowerW / 1000 : 30;
  const smoothScore = Math.max(0, Math.min(30, 30 - avgPowerKw / 3));
  const maxSpeedDisplayMph =
    drive.maxSpeedMps != null ? drive.maxSpeedMps * 2.2369362920544 : 80;
  const speedScore = Math.max(
    0,
    Math.min(30, 30 - Math.max(0, maxSpeedDisplayMph - 90) / 2),
  );

  const total = Math.round(effScore + smoothScore + speedScore);
  const grade =
    total >= 90
      ? 'A+'
      : total >= 80
        ? 'A'
        : total >= 70
          ? 'B'
          : total >= 60
            ? 'C'
            : total >= 50
              ? 'D'
              : 'F';

  return {
    efficiency: Math.round(effScore),
    grade,
    smoothness: Math.round(smoothScore),
    speed: Math.round(speedScore),
    total,
    whPerKm: Math.round(whPerKm),
  };
}

/* ─── Helpers (web `gradeVariant`/`gradeColor`/text-class helpers) ──────────── */

function gradeVariant(grade: string): BadgeVariant {
  if (grade === 'A+' || grade === 'A') {
    return 'success';
  }
  if (grade === 'B') {
    return 'info';
  }
  if (grade === 'C') {
    return 'warning';
  }
  return 'danger';
}

function gradeColor(grade: string): string {
  return GRADE_COLORS[grade] ?? '#94a3b8';
}

const GRADE_TEXT_COLORS: Record<string, string> = {
  'A+': '#39ff14',
  A: '#4ade80',
  B: '#22d3ee',
  C: '#fbbf24',
  D: '#fb923c',
  F: '#f87171',
};

function gradeTextColor(grade: string): string {
  return GRADE_TEXT_COLORS[grade] ?? colors.textSecondary;
}

function scoreTextColor(score: number | null): string {
  if (score == null) {
    return colors.textMuted;
  }
  if (score >= 80) {
    return '#4ade80';
  }
  if (score >= 60) {
    return '#fbbf24';
  }
  return '#f87171';
}

function getDefaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function getDefaultEndDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ─── Tips data (web `buildTips`) ───────────────────────────────────────────── */

interface Tip {
  key: string;
  category: 'efficiency' | 'smoothness' | 'speed';
  glyph: string;
  glyphColor: string;
}

function buildTips(t: NativeTFunction): Tip[] {
  return [
    {
      category: 'efficiency',
      glyph: '\u26A1',
      glyphColor: '#4ade80',
      key: t(
        'driveScore.tips.preCondition',
        'Pre-condition your cabin while plugged in to reduce HVAC battery drain.',
      ),
    },
    {
      category: 'efficiency',
      glyph: '\u26A1',
      glyphColor: '#4ade80',
      key: t(
        'driveScore.tips.coastMore',
        'Coast more by lifting your foot earlier before stops.',
      ),
    },
    {
      category: 'efficiency',
      glyph: '\u26A1',
      glyphColor: '#4ade80',
      key: t(
        'driveScore.tips.tirePressure',
        'Keep tire pressure at recommended levels for better efficiency.',
      ),
    },
    {
      category: 'smoothness',
      glyph: '\u267B\uFE0F',
      glyphColor: '#22d3ee',
      key: t(
        'driveScore.tips.smoothAccel',
        'Accelerate gradually — aim for steady pedal pressure.',
      ),
    },
    {
      category: 'smoothness',
      glyph: '\u267B\uFE0F',
      glyphColor: '#22d3ee',
      key: t(
        'driveScore.tips.regenBraking',
        'Use regenerative braking instead of the brake pedal when possible.',
      ),
    },
    {
      category: 'smoothness',
      glyph: '\u267B\uFE0F',
      glyphColor: '#22d3ee',
      key: t(
        'driveScore.tips.followDistance',
        'Maintain a larger following distance to avoid sudden braking.',
      ),
    },
    {
      category: 'speed',
      glyph: '\uD83C\uDFC1',
      glyphColor: '#a78bfa',
      key: t(
        'driveScore.tips.speedLimit',
        'Stay within the speed limit — aerodynamic drag rises exponentially above 90 km/h.',
      ),
    },
    {
      category: 'speed',
      glyph: '\uD83C\uDFC1',
      glyphColor: '#a78bfa',
      key: t(
        'driveScore.tips.cruiseControl',
        'Use Autopilot or cruise control on highways for consistent speed.',
      ),
    },
    {
      category: 'speed',
      glyph: '\uD83C\uDFC1',
      glyphColor: '#a78bfa',
      key: t(
        'driveScore.tips.routePlanning',
        'Plan routes to avoid high-speed stretches when possible.',
      ),
    },
  ];
}

/* ─── Achievement definitions (web `buildAchievements`) ─────────────────────── */

interface Achievement {
  id: string;
  label: string;
  description: string;
  glyph: string;
  glyphColor: string;
  check: (scores: DriveScore[], drives: Drive[]) => boolean;
}

function buildAchievements(t: NativeTFunction): Achievement[] {
  return [
    {
      check: (_scores, drives) => drives.length >= 1,
      description: t(
        'driveScore.achievements.firstDriveDesc',
        'Complete your first scored drive.',
      ),
      glyph: '\uD83D\uDE97',
      glyphColor: colors.textPrimary,
      id: 'first-drive',
      label: t('driveScore.achievements.firstDrive', 'First Drive'),
    },
    {
      check: (_scores, drives) => drives.length >= 10,
      description: t(
        'driveScore.achievements.tenDrivesDesc',
        'Complete 10 scored drives.',
      ),
      glyph: '\u2B50',
      glyphColor: colors.textPrimary,
      id: 'ten-drives',
      label: t('driveScore.achievements.tenDrives', 'Road Regular'),
    },
    {
      check: (_scores, drives) => drives.length >= 50,
      description: t(
        'driveScore.achievements.fiftyDrivesDesc',
        'Complete 50 scored drives.',
      ),
      glyph: '\uD83C\uDFC6',
      glyphColor: '#facc15',
      id: 'fifty-drives',
      label: t('driveScore.achievements.fiftyDrives', 'Highway Hero'),
    },
    {
      check: scores => scores.some(s => s.total >= 100),
      description: t(
        'driveScore.achievements.perfectScoreDesc',
        'Achieve a 100/100 on any drive.',
      ),
      glyph: '\uD83C\uDFC5',
      glyphColor: '#fbbf24',
      id: 'perfect-score',
      label: t('driveScore.achievements.perfectScore', 'Perfect Score'),
    },
    {
      check: scores => {
        let streak = 0;
        for (const s of scores) {
          if (s.grade === 'A+') {
            streak += 1;
            if (streak >= 5) {
              return true;
            }
          } else {
            streak = 0;
          }
        }
        return false;
      },
      description: t(
        'driveScore.achievements.aPlusStreakDesc',
        'Get A+ grade on 5 consecutive drives.',
      ),
      glyph: '\uD83C\uDFC6',
      glyphColor: '#4ade80',
      id: 'a-plus-streak',
      label: t('driveScore.achievements.aPlusStreak', 'A+ Streak'),
    },
    {
      check: scores => scores.filter(s => s.efficiency >= 38).length >= 3,
      description: t(
        'driveScore.achievements.efficiencyMasterDesc',
        'Score 38+ in efficiency on 3 drives.',
      ),
      glyph: '\u26A1',
      glyphColor: '#4ade80',
      id: 'efficiency-master',
      label: t('driveScore.achievements.efficiencyMaster', 'Efficiency Master'),
    },
    {
      check: scores => scores.filter(s => s.smoothness >= 28).length >= 3,
      description: t(
        'driveScore.achievements.smoothOperatorDesc',
        'Score 28+ in smoothness on 3 drives.',
      ),
      glyph: '\uD83D\uDEE1\uFE0F',
      glyphColor: '#22d3ee',
      id: 'smooth-operator',
      label: t('driveScore.achievements.smoothOperator', 'Smooth Operator'),
    },
    {
      check: scores => scores.filter(s => s.speed >= 28).length >= 5,
      description: t(
        'driveScore.achievements.speedSaintDesc',
        'Score 28+ in speed discipline on 5 drives.',
      ),
      glyph: '\uD83C\uDFAF',
      glyphColor: '#a78bfa',
      id: 'speed-saint',
      label: t('driveScore.achievements.speedSaint', 'Speed Saint'),
    },
  ];
}

/* ─── DriveScorePage ───────────────────────────────────────────────────────── */

export default function DriveScorePage() {
  const t = useNativeTranslation();
  usePageTitle(t('driveScore.title', 'Drive Score'));

  /* ---- vehicle selector: useSelectedVehicle shim (first-vehicle default) ---- */
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
  const vehicleId = selectedVehicleId ?? firstVehicleId;
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  /* ---- queries ---- */
  const {data: apiScore} = useDriveScore(vehicleIdStr);
  const {data: drives, isLoading: drivesLoading} = useDrives(vehicleIdStr);

  /* ---- settings ---- */
  const {unitPrefs} = useUnits();
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toSpeedDisplay = (value: number) =>
    convertSpeedFromSI(value, unitPrefs.speed);
  const toEfficiencyDisplay = (whPerKm: number) =>
    unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm;

  /* ---- date filter ---- */
  const [startDate, setStartDate] = useState<string>(getDefaultStartDate);
  const [endDate, setEndDate] = useState<string>(getDefaultEndDate);

  /* ---- sort state ---- */
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  /* ---- pagination ---- */
  const [currentPage, setCurrentPage] = useState(1);

  /* ---- filtered & scored drives ---- */
  const filteredDrives = useMemo(() => {
    if (!drives) {
      return [];
    }
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime() + 86_400_000;
    return drives.filter(d => {
      const ts = new Date(d.startTs).getTime();
      return ts >= start && ts <= end;
    });
  }, [drives, startDate, endDate]);

  const scoredDrives = useMemo<ScoredDrive[]>(
    () =>
      filteredDrives.map(d => ({
        drive: d,
        score: scoreDrive(d),
      })),
    [filteredDrives],
  );

  /* ---- sorted drives ---- */
  const sortedDrives = useMemo(() => {
    const sorted = [...scoredDrives];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date':
          cmp =
            new Date(a.drive.startTs).getTime() -
            new Date(b.drive.startTs).getTime();
          break;
        case 'distance':
          cmp = a.drive.distanceM - b.drive.distanceM;
          break;
        case 'score':
          cmp = a.score.total - b.score.total;
          break;
        case 'efficiency':
          cmp = a.score.whPerKm - b.score.whPerKm;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [scoredDrives, sortField, sortDir]);

  /* ---- paginated drives ---- */
  const totalPages = Math.max(1, Math.ceil(sortedDrives.length / DRIVES_PER_PAGE));
  const paginatedDrives = useMemo(
    () =>
      sortedDrives.slice(
        (currentPage - 1) * DRIVES_PER_PAGE,
        currentPage * DRIVES_PER_PAGE,
      ),
    [sortedDrives, currentPage],
  );

  /* ---- aggregate scored data for charts ---- */
  const allScores = useMemo(
    () => scoredDrives.map(sd => sd.score),
    [scoredDrives],
  );

  const avgScores = useMemo(() => {
    if (allScores.length === 0) {
      return {total: 0, efficiency: 0, smoothness: 0, speed: 0};
    }
    const sum = allScores.reduce(
      (acc, s) => ({
        efficiency: acc.efficiency + s.efficiency,
        smoothness: acc.smoothness + s.smoothness,
        speed: acc.speed + s.speed,
        total: acc.total + s.total,
      }),
      {total: 0, efficiency: 0, smoothness: 0, speed: 0},
    );
    const n = allScores.length;
    return {
      efficiency: Math.round(sum.efficiency / n),
      smoothness: Math.round(sum.smoothness / n),
      speed: Math.round(sum.speed / n),
      total: Math.round(sum.total / n),
    };
  }, [allScores]);

  const overallScore = apiScore?.overall ?? avgScores.total;
  const overallGrade =
    apiScore?.grade ??
    (overallScore >= 90
      ? 'A+'
      : overallScore >= 80
        ? 'A'
        : overallScore >= 70
          ? 'B'
          : overallScore >= 60
            ? 'C'
            : overallScore >= 50
              ? 'D'
              : 'F');
  const overallTrend = apiScore?.trend ?? 'flat';

  /* ---- trend chart data (last 20 drives) ---- */
  const trendChartData = useMemo(() => {
    const recent = [...scoredDrives]
      .sort(
        (a, b) =>
          new Date(a.drive.startTs).getTime() -
          new Date(b.drive.startTs).getTime(),
      )
      .slice(-20);
    return recent.map(sd => ({
      date: formatDateShort(sd.drive.startTs),
      efficiency: sd.score.efficiency,
      score: sd.score.total,
      smoothness: sd.score.smoothness,
      speed: sd.score.speed,
    }));
  }, [scoredDrives]);

  /* ---- category bar chart data ---- */
  const categoryBarData = useMemo(
    () => [
      {
        fill: CATEGORY_COLORS.efficiency,
        max: 40,
        name: t('driveScore.efficiency', 'Efficiency'),
        value: apiScore?.efficiency ?? avgScores.efficiency,
      },
      {
        fill: CATEGORY_COLORS.smoothness,
        max: 30,
        name: t('driveScore.smoothness', 'Smoothness'),
        value: apiScore?.smoothness ?? avgScores.smoothness,
      },
      {
        fill: CATEGORY_COLORS.speed,
        max: 30,
        name: t('driveScore.speedDiscipline', 'Speed Discipline'),
        value: apiScore?.speedDiscipline ?? avgScores.speed,
      },
    ],
    [apiScore, avgScores, t],
  );

  /* ---- tips based on weakest category ---- */
  const tips = useMemo(() => buildTips(t), [t]);

  const weakestCategory = useMemo((): 'efficiency' | 'smoothness' | 'speed' => {
    const eff = (apiScore?.efficiency ?? avgScores.efficiency) / 40;
    const sm = (apiScore?.smoothness ?? avgScores.smoothness) / 30;
    const sp = (apiScore?.speedDiscipline ?? avgScores.speed) / 30;
    if (eff <= sm && eff <= sp) {
      return 'efficiency';
    }
    if (sm <= sp) {
      return 'smoothness';
    }
    return 'speed';
  }, [apiScore, avgScores]);

  const relevantTips = useMemo(
    () => tips.filter(tip => tip.category === weakestCategory),
    [tips, weakestCategory],
  );

  /* ---- achievements ---- */
  const achievements = useMemo(() => buildAchievements(t), [t]);
  const unlockedAchievements = useMemo(
    () =>
      achievements.map(a => ({
        ...a,
        unlocked: a.check(allScores, filteredDrives),
      })),
    [achievements, allScores, filteredDrives],
  );

  /* ---- handlers ---- */
  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('desc');
      }
      setCurrentPage(1);
    },
    [sortField],
  );

  const handleDateApply = useCallback(() => {
    setCurrentPage(1);
  }, []);

  /* ---- best & worst drives ---- */
  const bestDrive = useMemo(
    () =>
      scoredDrives.length > 0
        ? [...scoredDrives].sort((a, b) => b.score.total - a.score.total)[0]
        : null,
    [scoredDrives],
  );
  const worstDrive = useMemo(
    () =>
      scoredDrives.length > 0
        ? [...scoredDrives].sort((a, b) => a.score.total - b.score.total)[0]
        : null,
    [scoredDrives],
  );

  /* ---- score distribution histogram ---- */
  const histogramData = useMemo(() => {
    const ranges = [
      {color: '#f87171', max: 20, min: 0, range: '0\u201320'},
      {color: '#fb923c', max: 40, min: 20, range: '20\u201340'},
      {color: '#fbbf24', max: 60, min: 40, range: '40\u201360'},
      {color: '#22d3ee', max: 80, min: 60, range: '60\u201380'},
      {color: '#4ade80', max: 101, min: 80, range: '80\u2013100'},
    ];
    return ranges.map(r => ({
      ...r,
      count: allScores.filter(s => s.total >= r.min && s.total < r.max).length,
    }));
  }, [allScores]);

  /* ---- weekly / monthly averages ---- */
  const periodStats = useMemo(() => {
    if (scoredDrives.length === 0) {
      return null;
    }
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const avg = (items: ScoredDrive[]) =>
      items.length > 0
        ? Math.round(
            items.reduce((s, d) => s + d.score.total, 0) / items.length,
          )
        : null;

    const thisWeekDrives = scoredDrives.filter(
      sd => new Date(sd.drive.startTs) >= weekStart,
    );
    const lastWeekDrives = scoredDrives.filter(sd => {
      const d = new Date(sd.drive.startTs);
      return d >= lastWeekStart && d < weekStart;
    });
    const thisMonthDrives = scoredDrives.filter(
      sd => new Date(sd.drive.startTs) >= monthStart,
    );
    const lastMonthDrives = scoredDrives.filter(sd => {
      const d = new Date(sd.drive.startTs);
      return d >= lastMonthStart && d <= lastMonthEnd;
    });

    const weekMap = new Map<string, ScoredDrive[]>();
    const monthMap = new Map<string, ScoredDrive[]>();
    scoredDrives.forEach(sd => {
      const d = new Date(sd.drive.startTs);
      const wk = `${d.getFullYear()}-W${Math.ceil(
        (d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7,
      )}`;
      const mo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!weekMap.has(wk)) {
        weekMap.set(wk, []);
      }
      weekMap.get(wk)!.push(sd);
      if (!monthMap.has(mo)) {
        monthMap.set(mo, []);
      }
      monthMap.get(mo)!.push(sd);
    });

    let bestWeek = {avg: 0, label: FALLBACK};
    weekMap.forEach((items, label) => {
      const a = avg(items);
      if (a != null && a > bestWeek.avg) {
        bestWeek = {avg: a, label};
      }
    });
    let bestMonth = {avg: 0, label: FALLBACK};
    monthMap.forEach((items, label) => {
      const a = avg(items);
      if (a != null && a > bestMonth.avg) {
        bestMonth = {avg: a, label};
      }
    });

    const aOrBetter = allScores.filter(
      s => s.grade === 'A+' || s.grade === 'A',
    ).length;

    return {
      aOrBetter,
      bestMonth,
      bestWeek,
      lastMonthAvg: avg(lastMonthDrives),
      lastWeekAvg: avg(lastWeekDrives),
      thisMonthAvg: avg(thisMonthDrives),
      thisWeekAvg: avg(thisWeekDrives),
      totalDrives: scoredDrives.length,
    };
  }, [scoredDrives, allScores]);

  /* ---- loading state ---- */
  const isLoading = drivesLoading;

  /* When the global vehicle changes, reset pagination so the user immediately
     sees the first page of the newly-scoped fleet view. */
  useEffect(() => {
    setCurrentPage(1);
  }, [vehicleId]);

  /* ---- trend glyph + labels ---- */
  const trendGlyph =
    overallTrend === 'up' ? '\u2191' : overallTrend === 'down' ? '\u2193' : '\u2014';
  const trendLabel =
    overallTrend === 'up'
      ? t('driveScore.trendUp', 'Improving')
      : overallTrend === 'down'
        ? t('driveScore.trendDown', 'Declining')
        : t('driveScore.trendFlat', 'Stable');
  const trendColorValue =
    overallTrend === 'up'
      ? '#4ade80'
      : overallTrend === 'down'
        ? '#f87171'
        : colors.textSecondary;

  /* ---- vehicle select options ---- */
  const vehicleOptions: NativeSelectOption[] = vehicles.map(v => ({
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
    value: String(v.id),
  }));

  const avgConsumption =
    scoredDrives.length > 0
      ? toEfficiencyDisplay(
          scoredDrives.reduce((sum, sd) => sum + sd.score.whPerKm, 0) /
            scoredDrives.length,
        )
      : 0;
  const avgPowerRange =
    scoredDrives.length > 0
      ? scoredDrives.reduce(
          (sum, sd) => sum + (sd.drive.avgPowerW ?? 30000) / 1000,
          0,
        ) / scoredDrives.length
      : 0;
  const avgMaxSpeed =
    scoredDrives.length > 0
      ? toSpeedDisplay(
          scoredDrives.reduce((sum, sd) => sum + (sd.drive.maxSpeedMps ?? 0), 0) /
            scoredDrives.length,
        )
      : 0;

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="driving-drive-score">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {t('driveScore.title', 'Drive Score')}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {t('driveScore.subtitle', 'Your driving rating and breakdown')}
          </AppText>
        </View>
        <View style={styles.actions}>
          <NativeSelect
            accessibilityLabel={t('common.vehicle.select', 'Select vehicle')}
            onChange={v => setSelectedVehicleId(v ? Number(v) : null)}
            options={vehicleOptions}
            value={vehicleId != null ? String(vehicleId) : ''}
          />
          <RangePicker
            onChange={r => {
              setStartDate(r.start);
              setEndDate(r.end);
              handleDateApply();
            }}
            t={t}
            value={{end: endDate, start: startDate}}
          />
        </View>
      </View>

      <ErrorBoundary name="drive-score-page">
        <View style={styles.stack}>
          {isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <>
              {/* -------- Empty guard -------- */}
              {scoredDrives.length === 0 ? (
                <EmptyState
                  message={t(
                    'driveScore.empty',
                    'Not enough drives in the selected period to calculate a score.',
                  )}
                  title={t('driveScore.emptyTitle', 'No Scored Drives')}
                />
              ) : null}

              {scoredDrives.length > 0 ? (
                <>
                  {/* -------- Section 1: Hero overall score gauge -------- */}
                  <FadeIn>
                    <GlassPanel style={styles.heroPanel}>
                      <RadialGauge
                        color={gradeColor(overallGrade)}
                        label={t('driveScore.overall', 'Overall Score')}
                        max={100}
                        size={200}
                        value={overallScore}
                      />
                      <View style={styles.heroValueRow}>
                        <AnimatedNumber
                          style={styles.heroValue}
                          value={overallScore}
                        />
                        <AppText style={styles.heroValueSuffix} tone="secondary">
                          {' /100'}
                        </AppText>
                        <HelpGlyph
                          hint={t(
                            'help.driveScore.body',
                            '0–100 score derived from smoothness of acceleration, braking, and cornering combined with energy efficiency. Tunable in Settings → Driving.',
                          )}
                          label={t('help.driveScore.iconLabel', {
                            defaultValue: 'More info about Drive Score',
                          })}
                        />
                      </View>
                      <View style={styles.heroTrendRow}>
                        <AppText style={{color: trendColorValue}}>
                          {trendGlyph}
                        </AppText>
                        <AppText
                          style={[styles.heroTrendLabel, {color: trendColorValue}]}
                          weight="semibold">
                          {trendLabel}
                        </AppText>
                      </View>
                      {apiScore ? (
                        <AppText
                          style={styles.heroBasedOn}
                          tone="muted"
                          variant="caption">
                          {t('driveScore.basedOn', 'Based on {{count}} drives', {
                            count: apiScore.totalDrives,
                          })}
                        </AppText>
                      ) : null}
                    </GlassPanel>
                  </FadeIn>

                  {/* -------- Section 3: Grade badge -------- */}
                  <FadeIn delay={0.05}>
                    <GlassPanel style={styles.gradePanel}>
                      <View style={styles.gradeLeft}>
                        <Badge size="lg" variant={gradeVariant(overallGrade)}>
                          {overallGrade}
                        </Badge>
                        <View style={styles.gradeCopy}>
                          <AppText style={styles.gradeLabel} weight="semibold">
                            {t('driveScore.gradeLabel', 'Grade: {{grade}}', {
                              grade: overallGrade,
                            })}
                          </AppText>
                          <View style={styles.gradeTrendRow}>
                            <AppText style={{color: trendColorValue}} variant="caption">
                              {trendGlyph}
                            </AppText>
                            <AppText
                              style={{color: trendColorValue}}
                              variant="caption">
                              {trendLabel}
                            </AppText>
                          </View>
                        </View>
                      </View>
                      <AppText
                        style={styles.gradeRight}
                        tone="secondary"
                        variant="caption">
                        {t(
                          'driveScore.drivesInPeriod',
                          '{{count}} drives in period',
                          {count: scoredDrives.length},
                        )}
                      </AppText>
                    </GlassPanel>
                  </FadeIn>

                  {/* -------- Section 2: Score breakdown cards -------- */}
                  <FadeIn delay={0.1}>
                    <View style={styles.breakdownGrid}>
                      <GlassPanel style={styles.breakdownCard}>
                        <RadialGauge
                          color={CATEGORY_COLORS.efficiency}
                          label={t('driveScore.efficiency', 'Efficiency')}
                          max={40}
                          size={120}
                          value={apiScore?.efficiency ?? avgScores.efficiency}
                        />
                        <View style={styles.breakdownValueRow}>
                          <AnimatedNumber
                            style={styles.breakdownValue}
                            value={apiScore?.efficiency ?? avgScores.efficiency}
                          />
                          <AppText style={styles.breakdownMax} tone="muted">
                            {' /40'}
                          </AppText>
                        </View>
                        <MetricBar
                          color={CATEGORY_COLORS.efficiency}
                          label={t('driveScore.efficiency', 'Efficiency')}
                          max={40}
                          value={apiScore?.efficiency ?? avgScores.efficiency}
                        />
                        <InlineMetric
                          glyph={'\u26A1'}
                          glyphColor="#4ade80"
                          label={t('driveScore.avgConsumption', 'Avg consumption')}
                          value={fmtWithUnit(avgConsumption, efficiencyUnit)}
                        />
                      </GlassPanel>

                      <GlassPanel style={styles.breakdownCard}>
                        <RadialGauge
                          color={CATEGORY_COLORS.smoothness}
                          label={t('driveScore.smoothness', 'Smoothness')}
                          max={30}
                          size={120}
                          value={apiScore?.smoothness ?? avgScores.smoothness}
                        />
                        <View style={styles.breakdownValueRow}>
                          <AnimatedNumber
                            style={styles.breakdownValue}
                            value={apiScore?.smoothness ?? avgScores.smoothness}
                          />
                          <AppText style={styles.breakdownMax} tone="muted">
                            {' /30'}
                          </AppText>
                        </View>
                        <MetricBar
                          color={CATEGORY_COLORS.smoothness}
                          label={t('driveScore.smoothness', 'Smoothness')}
                          max={30}
                          value={apiScore?.smoothness ?? avgScores.smoothness}
                        />
                        <InlineMetric
                          glyph={'\u267B\uFE0F'}
                          glyphColor="#22d3ee"
                          label={t('driveScore.powerRange', 'Power range')}
                          value={fmtWithUnit(avgPowerRange, 'kW')}
                        />
                      </GlassPanel>

                      <GlassPanel style={styles.breakdownCard}>
                        <RadialGauge
                          color={CATEGORY_COLORS.speed}
                          label={t('driveScore.speedDiscipline', 'Speed Discipline')}
                          max={30}
                          size={120}
                          value={apiScore?.speedDiscipline ?? avgScores.speed}
                        />
                        <View style={styles.breakdownValueRow}>
                          <AnimatedNumber
                            style={styles.breakdownValue}
                            value={apiScore?.speedDiscipline ?? avgScores.speed}
                          />
                          <AppText style={styles.breakdownMax} tone="muted">
                            {' /30'}
                          </AppText>
                        </View>
                        <MetricBar
                          color={CATEGORY_COLORS.speed}
                          label={t('driveScore.speedDiscipline', 'Speed Discipline')}
                          max={30}
                          value={apiScore?.speedDiscipline ?? avgScores.speed}
                        />
                        <InlineMetric
                          glyph={'\uD83C\uDFC1'}
                          glyphColor="#a78bfa"
                          label={t('driveScore.avgMaxSpeed', 'Avg max speed')}
                          value={fmtWithUnit(avgMaxSpeed, speedUnit)}
                        />
                      </GlassPanel>
                    </View>
                  </FadeIn>

                  {/* -------- Section 4: Score trend chart -------- */}
                  <FadeIn delay={0.15}>
                    <ChartPanel
                      ariaLabel={t(
                        'driveScore.scoreTrend.aria',
                        'Drive score trend line chart with category breakdowns',
                      )}
                      title={t('driveScore.scoreTrend', 'Score Trend')}>
                      <SeriesBarChart
                        accessibilityLabel={t(
                          'driveScore.scoreTrend.aria',
                          'Drive score trend line chart with category breakdowns',
                        )}
                        data={trendChartData}
                        height={260}
                        referenceLines={[
                          {
                            color: COLOR_GOOD,
                            label: t('driveScore.gradeALine', 'A'),
                            value: 80,
                          },
                        ]}
                        series={[
                          {
                            color: gradeColor(overallGrade),
                            key: 'score',
                            label: t('driveScore.totalScore', 'Total Score'),
                          },
                          {
                            color: CATEGORY_COLORS.efficiency,
                            key: 'efficiency',
                            label: t('driveScore.efficiency', 'Efficiency'),
                          },
                          {
                            color: CATEGORY_COLORS.smoothness,
                            key: 'smoothness',
                            label: t('driveScore.smoothness', 'Smoothness'),
                          },
                          {
                            color: CATEGORY_COLORS.speed,
                            key: 'speed',
                            label: t('driveScore.speedDiscipline', 'Speed Discipline'),
                          },
                        ]}
                        xKey="date"
                        yFormatter={fmtInt}
                        yMax={100}
                        yMin={0}
                      />
                    </ChartPanel>
                  </FadeIn>

                  {/* -------- Section 5: Category bar chart -------- */}
                  <FadeIn delay={0.2}>
                    <ChartPanel
                      ariaLabel={t(
                        'driveScore.categoryBreakdown.aria',
                        'Drive score category breakdown horizontal bar chart',
                      )}
                      title={t('driveScore.categoryBreakdown', 'Category Breakdown')}>
                      <SeriesBarChart
                        accessibilityLabel={t(
                          'driveScore.categoryBreakdown.aria',
                          'Drive score category breakdown horizontal bar chart',
                        )}
                        colorFor={(row, key) =>
                          key === 'value' && typeof row.fill === 'string'
                            ? row.fill
                            : COLOR_MAX_TRACK
                        }
                        data={categoryBarData}
                        height={220}
                        series={[
                          {
                            color: CATEGORY_COLORS.efficiency,
                            key: 'value',
                            label: t('driveScore.col.value', 'Value'),
                          },
                          {
                            color: COLOR_MAX_TRACK,
                            key: 'max',
                            label: t('driveScore.col.max', 'Max'),
                          },
                        ]}
                        showLegend={false}
                        xKey="name"
                        yFormatter={fmtInt}
                        yMax={40}
                        yMin={0}
                      />
                    </ChartPanel>
                  </FadeIn>

                  {/* -------- Section 5b: Score Distribution Histogram -------- */}
                  <FadeIn delay={0.25}>
                    <ChartPanel
                      ariaLabel={t(
                        'driveScore.scoreDistribution.aria',
                        'Drive score distribution histogram bar chart',
                      )}
                      title={t('driveScore.scoreDistribution', 'Score Distribution')}>
                      <SeriesBarChart
                        accessibilityLabel={t(
                          'driveScore.scoreDistribution.aria',
                          'Drive score distribution histogram bar chart',
                        )}
                        colorFor={row =>
                          typeof row.color === 'string' ? row.color : undefined
                        }
                        data={histogramData.map(h => ({
                          color: h.color,
                          count: h.count,
                          range: h.range,
                        }))}
                        height={200}
                        series={[
                          {
                            color: CATEGORY_COLORS.efficiency,
                            key: 'count',
                            label: t('driveScore.drives', 'Drives'),
                          },
                        ]}
                        showLegend={false}
                        xKey="range"
                        yFormatter={fmtInt}
                      />
                    </ChartPanel>
                  </FadeIn>

                  {/* -------- Section 6: Tips / Recommendations -------- */}
                  <FadeIn delay={0.3}>
                    <GlassPanel padding="lg">
                      <CardHeader
                        title={t('driveScore.tipsTitle', 'Improvement Tips')}
                      />
                      <AppText
                        style={styles.tipsSubtitle}
                        tone="secondary"
                        variant="caption">
                        {t(
                          'driveScore.tipsSubtitle',
                          'Based on your weakest category: {{category}}',
                          {
                            category:
                              weakestCategory === 'efficiency'
                                ? t('driveScore.efficiency', 'Efficiency')
                                : weakestCategory === 'smoothness'
                                  ? t('driveScore.smoothness', 'Smoothness')
                                  : t(
                                      'driveScore.speedDiscipline',
                                      'Speed Discipline',
                                    ),
                          },
                        )}
                      </AppText>
                      <View style={styles.tipsList}>
                        {relevantTips.map((tip, idx) => (
                          <View key={idx} style={styles.tipRow}>
                            <AppText style={styles.tipGlyph}>{'\uD83D\uDCA1'}</AppText>
                            <AppText style={styles.tipText}>{tip.key}</AppText>
                          </View>
                        ))}
                      </View>
                    </GlassPanel>
                  </FadeIn>

                  {/* -------- Section 6b: Best & Worst Drives -------- */}
                  <FadeIn delay={0.35}>
                    <View style={styles.bestWorstGrid}>
                      <GlassPanel style={styles.bestWorstCard}>
                        <View style={styles.bestWorstHeader}>
                          <AppText style={styles.bestGlyph}>{'\u2605'}</AppText>
                          <AppText style={styles.bestWorstTitle} weight="semibold">
                            {t('driveScore.bestDrive', 'Best Drive')}
                          </AppText>
                        </View>
                        {bestDrive ? (
                          <View style={styles.bestWorstBody}>
                            <View style={styles.bestWorstTopRow}>
                              <AppText tone="muted" variant="caption">
                                {formatDateShort(bestDrive.drive.startTs)}
                              </AppText>
                              <Badge size="sm" variant={gradeVariant(bestDrive.score.grade)}>
                                {bestDrive.score.grade}
                              </Badge>
                            </View>
                            <View style={styles.bestWorstMain}>
                              <RadialGauge
                                color="#4ade80"
                                label={t('driveScore.score', 'Score')}
                                max={100}
                                size={72}
                                value={bestDrive.score.total}
                              />
                              <View style={styles.bestWorstStats}>
                                <View style={styles.bestWorstStatRow}>
                                  <AppText tone="muted" variant="caption">
                                    {t('driveScore.distance', 'Distance')}
                                  </AppText>
                                  <AppText variant="caption">
                                    {`${fmtNumber(
                                      toDistanceDisplay(bestDrive.drive.distanceM),
                                    )} ${distanceUnit}`}
                                  </AppText>
                                </View>
                                <View style={styles.bestWorstStatRow}>
                                  <AppText tone="muted" variant="caption">
                                    {t('driveScore.durationLabel', 'Duration')}
                                  </AppText>
                                  <AppText variant="caption">
                                    {formatDurationMinutes(bestDrive.drive.durationS / 60)}
                                  </AppText>
                                </View>
                                <View style={styles.bestWorstStatRow}>
                                  <AppText tone="muted" variant="caption">
                                    {t('driveScore.consumption', 'Consumption')}
                                  </AppText>
                                  <AppText variant="caption">
                                    {`${fmtInt(
                                      toEfficiencyDisplay(bestDrive.score.whPerKm),
                                    )} ${efficiencyUnit}`}
                                  </AppText>
                                </View>
                              </View>
                            </View>
                            <View style={styles.bestTipBox}>
                              <AppText style={styles.bestTipText} variant="caption">
                                {'\u2605 '}
                                {bestDrive.score.efficiency >= 35
                                  ? t(
                                      'driveScore.tipBestEff',
                                      'Outstanding energy efficiency — minimal energy wasted!',
                                    )
                                  : bestDrive.score.smoothness >= 25
                                    ? t(
                                        'driveScore.tipBestSmooth',
                                        'Exceptionally smooth driving with controlled acceleration.',
                                      )
                                    : t(
                                        'driveScore.tipBestSpeed',
                                        'Great speed discipline, staying in the optimal range.',
                                      )}
                              </AppText>
                            </View>
                          </View>
                        ) : (
                          <AppText tone="muted">
                            {t('driveScore.noDrives', 'No drives available')}
                          </AppText>
                        )}
                      </GlassPanel>

                      <GlassPanel style={styles.bestWorstCard}>
                        <View style={styles.bestWorstHeader}>
                          <AppText style={styles.worstGlyph}>{'\u26A0'}</AppText>
                          <AppText style={styles.bestWorstTitle} weight="semibold">
                            {t('driveScore.worstDrive', 'Worst Drive')}
                          </AppText>
                        </View>
                        {worstDrive ? (
                          <View style={styles.bestWorstBody}>
                            <View style={styles.bestWorstTopRow}>
                              <AppText tone="muted" variant="caption">
                                {formatDateShort(worstDrive.drive.startTs)}
                              </AppText>
                              <Badge size="sm" variant={gradeVariant(worstDrive.score.grade)}>
                                {worstDrive.score.grade}
                              </Badge>
                            </View>
                            <View style={styles.bestWorstMain}>
                              <RadialGauge
                                color="#f87171"
                                label={t('driveScore.score', 'Score')}
                                max={100}
                                size={72}
                                value={worstDrive.score.total}
                              />
                              <View style={styles.bestWorstStats}>
                                <View style={styles.bestWorstStatRow}>
                                  <AppText tone="muted" variant="caption">
                                    {t('driveScore.distance', 'Distance')}
                                  </AppText>
                                  <AppText variant="caption">
                                    {`${fmtNumber(
                                      toDistanceDisplay(worstDrive.drive.distanceM),
                                    )} ${distanceUnit}`}
                                  </AppText>
                                </View>
                                <View style={styles.bestWorstStatRow}>
                                  <AppText tone="muted" variant="caption">
                                    {t('driveScore.durationLabel', 'Duration')}
                                  </AppText>
                                  <AppText variant="caption">
                                    {formatDurationMinutes(worstDrive.drive.durationS / 60)}
                                  </AppText>
                                </View>
                                <View style={styles.bestWorstStatRow}>
                                  <AppText tone="muted" variant="caption">
                                    {t('driveScore.consumption', 'Consumption')}
                                  </AppText>
                                  <AppText variant="caption">
                                    {`${fmtInt(
                                      toEfficiencyDisplay(worstDrive.score.whPerKm),
                                    )} ${efficiencyUnit}`}
                                  </AppText>
                                </View>
                              </View>
                            </View>
                            <View style={styles.worstTipBox}>
                              <AppText style={styles.worstTipText} variant="caption">
                                {'\u26A0 '}
                                {worstDrive.score.efficiency < 15
                                  ? t(
                                      'driveScore.tipWorstEff',
                                      'High energy consumption — possibly high speeds or cold weather.',
                                    )
                                  : worstDrive.score.smoothness < 10
                                    ? t(
                                        'driveScore.tipWorstSmooth',
                                        'Aggressive acceleration and braking detected.',
                                      )
                                    : t(
                                        'driveScore.tipWorstSpeed',
                                        'Excessive highway speed reduced the overall score.',
                                      )}
                              </AppText>
                            </View>
                          </View>
                        ) : (
                          <AppText tone="muted">
                            {t('driveScore.noDrives', 'No drives available')}
                          </AppText>
                        )}
                      </GlassPanel>
                    </View>
                  </FadeIn>

                  {/* -------- Section 7: Drive history table -------- */}
                  <FadeIn delay={0.4}>
                    <GlassPanel padding="lg">
                      <CardHeader
                        title={t('driveScore.driveHistory', 'Drive History')}
                      />
                      <View style={styles.tableSortRow}>
                        <SortHeader
                          field="date"
                          label={t('driveScore.colDate', 'Date')}
                          onSort={handleSort}
                          sortDir={sortDir}
                          sortField={sortField}
                        />
                        <SortHeader
                          field="distance"
                          label={t('driveScore.colDistance', 'Distance')}
                          onSort={handleSort}
                          sortDir={sortDir}
                          sortField={sortField}
                        />
                        <SortHeader
                          field="score"
                          label={t('driveScore.colScore', 'Score')}
                          onSort={handleSort}
                          sortDir={sortDir}
                          sortField={sortField}
                        />
                        <SortHeader
                          field="efficiency"
                          label={t('driveScore.colEfficiency', 'Eff')}
                          onSort={handleSort}
                          sortDir={sortDir}
                          sortField={sortField}
                        />
                      </View>

                      {paginatedDrives.length === 0 ? (
                        <AppText style={styles.tableEmpty} tone="muted">
                          {t(
                            'driveScore.noDrives',
                            'No drives found for the selected period.',
                          )}
                        </AppText>
                      ) : null}

                      {paginatedDrives.map(({drive, score: ds}) => (
                        <View key={drive.id} style={styles.tableRow}>
                          <View style={styles.tableRowTop}>
                            <AppText style={styles.tableDate} weight="semibold">
                              {formatDateShort(drive.startTs)}
                            </AppText>
                            <View style={styles.tableRowTopRight}>
                              <AppText
                                style={[
                                  styles.tableScore,
                                  {color: gradeTextColor(ds.grade)},
                                ]}
                                weight="semibold">
                                {`${ds.total}/100`}
                              </AppText>
                              <Badge size="sm" variant={gradeVariant(ds.grade)}>
                                {ds.grade}
                              </Badge>
                            </View>
                          </View>
                          <AppText
                            numberOfLines={1}
                            style={styles.tableRoute}
                            tone="secondary"
                            variant="caption">
                            {drive.startAddress
                              ? `${drive.startAddress}${
                                  drive.endAddress ? ` \u2192 ${drive.endAddress}` : ''
                                }`
                              : t('driveScore.unknownRoute', 'Unknown')}
                          </AppText>
                          <View style={styles.tableMetaRow}>
                            <AppText tone="muted" variant="caption">
                              {fmtWithUnit(
                                toDistanceDisplay(drive.distanceM),
                                distanceUnit,
                              )}
                            </AppText>
                            <AppText tone="muted" variant="caption">
                              {formatDurationMinutes(drive.durationS / 60)}
                            </AppText>
                            <AppText tone="muted" variant="caption">
                              {fmtWithUnit(toEfficiencyDisplay(ds.whPerKm), efficiencyUnit)}
                            </AppText>
                            <AppText tone="muted" variant="caption">
                              {`${ds.efficiency}/${ds.smoothness}/${ds.speed}`}
                            </AppText>
                          </View>
                        </View>
                      ))}

                      {totalPages > 1 ? (
                        <View style={styles.paginationWrap}>
                          <Pagination
                            onPageChange={setCurrentPage}
                            page={currentPage}
                            pageSize={DRIVES_PER_PAGE}
                            t={t}
                            total={sortedDrives.length}
                          />
                        </View>
                      ) : null}
                    </GlassPanel>
                  </FadeIn>

                  {/* -------- Section 8: Score summary cards -------- */}
                  <FadeIn delay={0.45}>
                    <View style={styles.summaryGrid}>
                      <View style={styles.summaryCardWrap}>
                        <StatCard
                          icon={<AppText style={styles.statGlyphMuted}>{'\uD83C\uDFAF'}</AppText>}
                          label={t('driveScore.avgScore', 'Avg Score')}
                          trend={{
                            direction: overallTrend,
                            positive: overallTrend === 'up',
                            value: trendLabel,
                          }}
                          unit="/100"
                          value={avgScores.total}
                        />
                      </View>
                      <View style={styles.summaryCardWrap}>
                        <StatCard
                          icon={<AppText style={styles.statGlyphGold}>{'\uD83C\uDFC6'}</AppText>}
                          label={t('driveScore.bestScore', 'Best Score')}
                          unit="/100"
                          value={
                            allScores.length > 0
                              ? Math.max(...allScores.map(s => s.total))
                              : 0
                          }
                        />
                      </View>
                      <View style={styles.summaryCardWrap}>
                        <StatCard
                          icon={<AppText style={styles.statGlyphMuted}>{'\uD83D\uDE97'}</AppText>}
                          label={t('driveScore.totalDrivesLabel', 'Total Drives')}
                          value={scoredDrives.length}
                        />
                      </View>
                      <View style={styles.summaryCardWrap}>
                        <StatCard
                          icon={<AppText style={styles.statGlyphGreen}>{'\u26A1'}</AppText>}
                          label={t('driveScore.avgEffLabel', 'Avg Efficiency')}
                          unit={efficiencyUnit}
                          value={fmtNumber(avgConsumption)}
                        />
                      </View>
                    </View>
                  </FadeIn>

                  {/* -------- Section 9: Weekly / Monthly Averages -------- */}
                  <FadeIn delay={0.5}>
                    {periodStats ? (
                      <View style={styles.periodGrid}>
                        <GlassPanel style={styles.periodCard}>
                          <AppText style={styles.periodLabel} tone="muted" variant="caption">
                            {t('driveScore.thisWeek', 'This Week')}
                          </AppText>
                          <View style={styles.periodValueRow}>
                            <AppText
                              style={[
                                styles.periodValue,
                                {color: scoreTextColor(periodStats.thisWeekAvg)},
                              ]}
                              weight="bold">
                              {periodStats.thisWeekAvg ?? FALLBACK}
                            </AppText>
                            {periodStats.thisWeekAvg != null &&
                            periodStats.lastWeekAvg != null ? (
                              <AppText
                                style={{
                                  color:
                                    periodStats.thisWeekAvg >= periodStats.lastWeekAvg
                                      ? '#4ade80'
                                      : '#f87171',
                                }}
                                variant="caption">
                                {`${
                                  periodStats.thisWeekAvg >= periodStats.lastWeekAvg
                                    ? '\u25B2'
                                    : '\u25BC'
                                }${Math.abs(
                                  periodStats.thisWeekAvg - periodStats.lastWeekAvg,
                                )}`}
                              </AppText>
                            ) : null}
                          </View>
                          <AppText style={styles.periodSub} tone="muted" variant="caption">
                            {t('driveScore.vsLastWeek', 'vs {{val}} last week', {
                              val: periodStats.lastWeekAvg ?? FALLBACK,
                            })}
                          </AppText>
                        </GlassPanel>

                        <GlassPanel style={styles.periodCard}>
                          <AppText style={styles.periodLabel} tone="muted" variant="caption">
                            {t('driveScore.thisMonth', 'This Month')}
                          </AppText>
                          <View style={styles.periodValueRow}>
                            <AppText
                              style={[
                                styles.periodValue,
                                {color: scoreTextColor(periodStats.thisMonthAvg)},
                              ]}
                              weight="bold">
                              {periodStats.thisMonthAvg ?? FALLBACK}
                            </AppText>
                            {periodStats.thisMonthAvg != null &&
                            periodStats.lastMonthAvg != null ? (
                              <AppText
                                style={{
                                  color:
                                    periodStats.thisMonthAvg >= periodStats.lastMonthAvg
                                      ? '#4ade80'
                                      : '#f87171',
                                }}
                                variant="caption">
                                {`${
                                  periodStats.thisMonthAvg >= periodStats.lastMonthAvg
                                    ? '\u25B2'
                                    : '\u25BC'
                                }${Math.abs(
                                  periodStats.thisMonthAvg - periodStats.lastMonthAvg,
                                )}`}
                              </AppText>
                            ) : null}
                          </View>
                          <AppText style={styles.periodSub} tone="muted" variant="caption">
                            {t('driveScore.vsLastMonth', 'vs {{val}} last month', {
                              val: periodStats.lastMonthAvg ?? FALLBACK,
                            })}
                          </AppText>
                        </GlassPanel>

                        <GlassPanel style={styles.periodCard}>
                          <AppText style={styles.periodLabel} tone="muted" variant="caption">
                            {t('driveScore.bestWeek', 'Best Week')}
                          </AppText>
                          <AppText
                            style={[
                              styles.periodValue,
                              {color: scoreTextColor(periodStats.bestWeek.avg)},
                            ]}
                            weight="bold">
                            {periodStats.bestWeek.avg || FALLBACK}
                          </AppText>
                          <AppText style={styles.periodSub} tone="muted" variant="caption">
                            {periodStats.bestWeek.label}
                          </AppText>
                        </GlassPanel>

                        <GlassPanel style={styles.periodCard}>
                          <AppText style={styles.periodLabel} tone="muted" variant="caption">
                            {t('driveScore.bestMonth', 'Best Month')}
                          </AppText>
                          <AppText
                            style={[
                              styles.periodValue,
                              {color: scoreTextColor(periodStats.bestMonth.avg)},
                            ]}
                            weight="bold">
                            {periodStats.bestMonth.avg || FALLBACK}
                          </AppText>
                          <AppText style={styles.periodSub} tone="muted" variant="caption">
                            {periodStats.bestMonth.label}
                          </AppText>
                        </GlassPanel>

                        <GlassPanel style={styles.periodCard}>
                          <AppText style={styles.periodLabel} tone="muted" variant="caption">
                            {t('driveScore.totalDrivesLabel', 'Total Drives')}
                          </AppText>
                          <AppText style={styles.periodValuePlain} weight="bold">
                            {periodStats.totalDrives}
                          </AppText>
                          <AppText style={styles.periodSub} tone="muted" variant="caption">
                            {t('driveScore.drivesScored', 'drives scored')}
                          </AppText>
                        </GlassPanel>

                        <GlassPanel style={styles.periodCard}>
                          <AppText style={styles.periodLabel} tone="muted" variant="caption">
                            {t('driveScore.ratedAPlus', 'Rated A+/A')}
                          </AppText>
                          <AppText style={styles.periodValueGreen} weight="bold">
                            {periodStats.aOrBetter}
                          </AppText>
                          <AppText style={styles.periodSub} tone="muted" variant="caption">
                            {periodStats.totalDrives > 0
                              ? `${fmtInt(
                                  (periodStats.aOrBetter / periodStats.totalDrives) * 100,
                                )}% ${t('driveScore.ofDrives', 'of drives')}`
                              : t('driveScore.noDrives', 'no drives')}
                          </AppText>
                        </GlassPanel>
                      </View>
                    ) : (
                      <GlassPanel padding="lg">
                        <EmptyState
                          message={t(
                            'driveScore.noPeriodStats',
                            'No weekly/monthly averages available yet',
                          )}
                          title={t('driveScore.noPeriodStats.title', 'No averages')}
                        />
                      </GlassPanel>
                    )}
                  </FadeIn>

                  {/* -------- Section 10: Achievement badges -------- */}
                  <FadeIn delay={0.55}>
                    <GlassPanel padding="lg">
                      <CardHeader
                        title={t('driveScore.achievements.title', 'Achievements')}
                      />
                      <View style={styles.achievementGrid}>
                        {unlockedAchievements.map(ach => (
                          <View
                            key={ach.id}
                            style={[
                              styles.achievementCard,
                              ach.unlocked
                                ? styles.achievementUnlocked
                                : styles.achievementLocked,
                            ]}>
                            <View
                              style={[
                                styles.achievementIcon,
                                ach.unlocked
                                  ? styles.achievementIconUnlocked
                                  : styles.achievementIconLocked,
                              ]}>
                              <AppText
                                style={{
                                  color: ach.unlocked ? ach.glyphColor : colors.textMuted,
                                }}>
                                {ach.glyph}
                              </AppText>
                            </View>
                            <AppText
                              style={styles.achievementLabel}
                              tone={ach.unlocked ? 'primary' : 'muted'}
                              weight="semibold">
                              {ach.label}
                            </AppText>
                            <AppText
                              style={styles.achievementDesc}
                              tone="muted"
                              variant="caption">
                              {ach.description}
                            </AppText>
                            {ach.unlocked ? (
                              <Badge size="sm" style={styles.achievementBadge} variant="success">
                                {t('driveScore.achievements.unlocked', 'Unlocked')}
                              </Badge>
                            ) : null}
                          </View>
                        ))}
                      </View>
                    </GlassPanel>
                  </FadeIn>

                  {/* -------- Score detail KVList -------- */}
                  <FadeIn delay={0.6}>
                    <View style={styles.kvGrid}>
                      <GlassPanel padding="lg" style={styles.kvCard}>
                        <CardHeader
                          title={t('driveScore.breakdown', 'Score Breakdown')}
                        />
                        <KVList
                          items={[
                            {
                              label: t(
                                'driveScore.efficiencyLabel',
                                'Efficiency (Wh/km)',
                              ),
                              value: `${apiScore?.efficiency ?? avgScores.efficiency}/40`,
                            },
                            {
                              label: t(
                                'driveScore.smoothnessLabel',
                                'Smoothness (power range)',
                              ),
                              value: `${apiScore?.smoothness ?? avgScores.smoothness}/30`,
                            },
                            {
                              label: t('driveScore.speedLabel', 'Speed Discipline'),
                              value: `${apiScore?.speedDiscipline ?? avgScores.speed}/30`,
                            },
                            {
                              label: t('driveScore.totalLabel', 'Total'),
                              value: `${overallScore}/100`,
                            },
                          ]}
                        />
                      </GlassPanel>

                      <GlassPanel padding="lg" style={styles.kvCard}>
                        <CardHeader
                          title={t('driveScore.periodStats', 'Period Statistics')}
                        />
                        <KVList
                          items={[
                            {
                              label: t('driveScore.totalDistance', 'Total Distance'),
                              value: fmtWithUnit(
                                toDistanceDisplay(
                                  filteredDrives.reduce((sum, d) => sum + d.distanceM, 0),
                                ),
                                distanceUnit,
                              ),
                            },
                            {
                              label: t('driveScore.totalDuration', 'Total Duration'),
                              value: formatDurationMinutes(
                                filteredDrives.reduce((sum, d) => sum + d.durationS, 0) / 60,
                              ),
                            },
                            {
                              label: t('driveScore.avgDistance', 'Avg Distance/Drive'),
                              value: fmtWithUnit(
                                filteredDrives.length > 0
                                  ? toDistanceDisplay(
                                      filteredDrives.reduce(
                                        (sum, d) => sum + d.distanceM,
                                        0,
                                      ) / filteredDrives.length,
                                    )
                                  : 0,
                                distanceUnit,
                              ),
                            },
                            {
                              label: t('driveScore.avgDuration', 'Avg Duration/Drive'),
                              value: formatDurationMinutes(
                                filteredDrives.length > 0
                                  ? filteredDrives.reduce(
                                      (sum, d) => sum + d.durationS,
                                      0,
                                    ) /
                                      filteredDrives.length /
                                      60
                                  : 0,
                              ),
                            },
                            {
                              label: t('driveScore.highestSpeed', 'Highest Max Speed'),
                              value: fmtWithUnit(
                                filteredDrives.length > 0
                                  ? toSpeedDisplay(
                                      Math.max(
                                        ...filteredDrives.map(d => d.maxSpeedMps ?? 0),
                                      ),
                                    )
                                  : 0,
                                speedUnit,
                              ),
                            },
                            {
                              label: t('driveScore.aPlusCount', 'A+ Drives'),
                              value: fmtInt(
                                allScores.filter(s => s.grade === 'A+').length,
                              ),
                            },
                          ]}
                        />
                      </GlassPanel>
                    </View>
                  </FadeIn>
                </>
              ) : (
                <EmptyState
                  message={t('common.noData', 'No data available')}
                  title={t('driveScore.noDataTitle', 'No data')}
                />
              )}
            </>
          )}
        </View>
      </ErrorBoundary>
    </ScrollView>
  );
}

DriveScorePage.displayName = 'DriveScorePage';

const styles = StyleSheet.create({
  achievementBadge: {
    marginTop: spacing.sm,
  },
  achievementCard: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 140,
    padding: spacing.md,
  },
  achievementDesc: {
    textAlign: 'center',
  },
  achievementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  achievementIcon: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    marginBottom: spacing.xs,
    width: 40,
  },
  achievementIconLocked: {
    backgroundColor: colors.surfaceRaised,
  },
  achievementIconUnlocked: {
    backgroundColor: 'rgba(250, 204, 21, 0.2)',
  },
  achievementLabel: {
    textAlign: 'center',
  },
  achievementLocked: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: colors.border,
    opacity: 0.6,
  },
  achievementUnlocked: {
    backgroundColor: 'rgba(234, 179, 8, 0.05)',
    borderColor: 'rgba(234, 179, 8, 0.3)',
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  axisLabel: {
    textAlign: 'right',
  },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
  },
  badgeLg: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  badgeSm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeTextLg: {
    fontSize: 16,
  },
  badgeTextSm: {
    fontSize: 12,
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
    maxWidth: 72,
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
    paddingLeft: spacing.sm,
  },
  bestGlyph: {
    color: '#4ade80',
  },
  bestTipBox: {
    backgroundColor: 'rgba(74, 222, 128, 0.05)',
    borderColor: 'rgba(74, 222, 128, 0.2)',
    borderRadius: 10,
    borderWidth: 1,
    padding: spacing.md,
  },
  bestTipText: {
    color: '#4ade80',
  },
  bestWorstBody: {
    gap: spacing.md,
  },
  bestWorstCard: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.md,
    minWidth: 220,
    padding: spacing.lg,
  },
  bestWorstGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  bestWorstHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bestWorstMain: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  bestWorstStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bestWorstStats: {
    flex: 1,
    gap: spacing.xs,
  },
  bestWorstTitle: {
    fontSize: 14,
  },
  bestWorstTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  breakdownCard: {
    alignItems: 'center',
    flexBasis: '30%',
    flexGrow: 1,
    gap: spacing.sm,
    minWidth: 200,
    padding: spacing.lg,
  },
  breakdownGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  breakdownMax: {
    fontSize: 14,
  },
  breakdownValue: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
  },
  breakdownValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  cardHeader: {
    marginBottom: spacing.sm,
  },
  cardHeaderTitle: {
    fontSize: 16,
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
  gradeCopy: {
    gap: 2,
  },
  gradeLabel: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  gradeLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  gradePanel: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  gradeRight: {
    textAlign: 'right',
  },
  gradeTrendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
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
  helpGlyph: {
    marginLeft: spacing.xs,
  },
  heroBasedOn: {
    marginTop: spacing.xs,
  },
  heroPanel: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  heroTrendLabel: {
    fontSize: 14,
  },
  heroTrendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  heroValue: {
    color: colors.textPrimary,
    fontSize: 34,
    lineHeight: 40,
  },
  heroValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  heroValueSuffix: {
    fontSize: 18,
  },
  inlineGlyph: {
    fontSize: 13,
  },
  inlineLabel: {
    flexShrink: 1,
  },
  inlineMetric: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    width: '100%',
  },
  inlineValue: {
    color: colors.textPrimary,
    marginLeft: 'auto',
  },
  kvCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 220,
  },
  kvGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  kvLabel: {
    flexShrink: 1,
  },
  kvList: {
    gap: spacing.xs,
  },
  kvRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  kvValue: {
    color: colors.textPrimary,
    textAlign: 'right',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  legendDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
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
  metricBarFill: {
    borderRadius: 999,
    height: '100%',
  },
  metricBarTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 6,
    marginTop: spacing.sm,
    overflow: 'hidden',
    width: '100%',
  },
  pageButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  pageButtonDisabled: {
    opacity: 0.4,
  },
  pageLabel: {},
  pageSubtitle: {},
  pageTitle: {
    color: colors.textPrimary,
  },
  pagination: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  paginationWrap: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  panelTitle: {
    fontSize: 15,
    marginBottom: spacing.xs,
  },
  periodCard: {
    flexBasis: '30%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 140,
    padding: spacing.md,
  },
  periodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  periodLabel: {
    textTransform: 'uppercase',
  },
  periodSub: {},
  periodValue: {
    fontSize: 22,
    lineHeight: 28,
  },
  periodValueGreen: {
    color: '#4ade80',
    fontSize: 22,
    lineHeight: 28,
  },
  periodValuePlain: {
    color: colors.textPrimary,
    fontSize: 22,
    lineHeight: 28,
  },
  periodValueRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  plotArea: {
    flex: 1,
    justifyContent: 'flex-end',
    position: 'relative',
  },
  pressed: {
    opacity: 0.7,
  },
  refLabel: {
    position: 'absolute',
    right: 0,
    top: -14,
  },
  refLine: {
    borderStyle: 'dashed',
    borderTopWidth: 1,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  select: {
    minWidth: 170,
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
  sortHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  sortHeaderArrow: {},
  sortHeaderLabel: {
    textTransform: 'uppercase',
  },
  stack: {
    gap: spacing.lg,
  },
  statGlyphGold: {
    color: '#facc15',
  },
  statGlyphGreen: {
    color: '#4ade80',
  },
  statGlyphMuted: {
    color: colors.textMuted,
  },
  summaryCardWrap: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tableDate: {
    color: colors.textPrimary,
  },
  tableEmpty: {
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  tableMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tableRoute: {},
  tableRow: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  tableRowTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tableRowTopRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tableScore: {
    fontSize: 14,
  },
  tableSortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  tipGlyph: {
    marginTop: 1,
  },
  tipRow: {
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  tipText: {
    color: colors.textPrimary,
    flex: 1,
  },
  tipsList: {
    gap: spacing.sm,
  },
  tipsSubtitle: {
    marginBottom: spacing.sm,
  },
  worstGlyph: {
    color: '#f87171',
  },
  worstTipBox: {
    backgroundColor: 'rgba(248, 113, 113, 0.05)',
    borderColor: 'rgba(248, 113, 113, 0.2)',
    borderRadius: 10,
    borderWidth: 1,
    padding: spacing.md,
  },
  worstTipText: {
    color: '#f87171',
  },
  yAxis: {
    justifyContent: 'space-between',
    paddingBottom: 18,
    width: 44,
  },
});
