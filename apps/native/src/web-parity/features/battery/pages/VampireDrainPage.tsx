// Native parity port of web/src/features/battery/pages/VampireDrainPage.tsx.
//
// Vampire Drain page for the selected vehicle. Backed by a single query:
//   GET /api/v1/vampire-drain/stats?vehicle_id=  (request<VampireDrainStats>)
// which drives, top to bottom: an opt-in AI narration, four summary stat
// cards (Avg Drain Rate / Total Phantom Loss / Worst Session / Drain Score),
// a drain-score gauge + drain-rate trend chart, a daily-drain-while-parked bar
// chart, a sortable + paginated drain-sessions table, and a tips panel.
//
// Every web behavior, state name (vampireQuery / data / isLoading / error /
// sortKey / sortDir / onSort / sortFn / sortedEntries / columns / scoreColor /
// tips / activeId), API path, unit-handling rule and i18n key is preserved; the
// web DOM / Tailwind / Recharts / lucide stack is replaced with React Native
// primitives + the native parity component library, following the TrueCostPage
// and BatteryDegradationPage precedents:
//
//   - `@/components/layout` PageContainer (title/subtitle/loading/error/actions)
//     has no native parity component, so a local ScrollView screen scaffold
//     reproduces the header (title + subtitle), the `actions` row (VehicleSelect
//     + DataFreshnessAuto), the centred loading spinner, the error panel, and
//     the body wrapped in the native ErrorBoundary (== PageContainer's
//     PageErrorBoundary). The web container shows EXACTLY ONE of loading /
//     error / children, so the native scaffold mirrors that branch order; the
//     per-section <Skeleton> placeholders only appear once children render
//     (i.e. not first-load), exactly as on web.
//   - `@/components/forms` VehicleSelect (the global header picker) -> a local
//     NativeSelect bound to useVehicles() + local state; combined with the
//     useSelectedVehicle shim (first-vehicle default) this reproduces the
//     "default to a vehicle, allow switching" behaviour without the web
//     router/store. The query stays disabled (enabled: activeId !== '') until a
//     vehicle id resolves, matching the web `enabled` gate.
//   - `@/components/ui` GlassPanel reuses the native parity GlassPanel; Badge,
//     DataTable/Column + useSortToggle have no native parity, so a local native
//     Badge (success/warning/danger/neutral) + a controlled native DataTable
//     (external sortKey/sortDir/onSort like the web DataTable, tap-to-sort
//     headers + client pagination) + a useSortToggle shim (verbatim web logic,
//     default key 'date', default dir 'desc') reproduce them.
//   - `@/components/data-display` MetricCard -> a local native MetricCard (label
//     + value + colour-coded glyph; the web `help` "?" tooltip becomes an
//     accessibilityHint since native has no hover tooltip). DataFreshnessAuto ->
//     a local FreshnessChip driven by the query (isError/isFetching/isStale),
//     rendered via StatusPill; the web call passes no `forceStaleAfterMs`, so
//     the chip's forced-stale override is left off.
//   - `@/components/charts` RadialGauge reuses the native parity RadialGauge.
//     The Recharts LineChart (drain-rate trend) and dual-axis BarChart (daily
//     drain) — the native recharts barrel only renders an "unavailable"
//     placeholder — become a local ChartPanel-less inline title + a real native
//     SeriesBarChart (proportional View bars in a horizontal ScrollView with a
//     y-axis + an interactive legend). The Line degrades to single-series
//     columns; the daily BarChart's two Recharts Y axes collapse to one shared
//     scale (RN has no dual-axis primitive) — documented in the sidecar. The
//     Recharts CartesianGrid / Tooltip / Legend / tickFormatter live inside the
//     native SeriesBarChart (x labels are pre-formatted via formatDate).
//     CHART_COLORS is the same CB-safe palette imported from the native chart
//     utils, so scoreColor's [1]/[3]/[5] indices and the [2]/[5]/[0] series
//     colours are byte-identical to web.
//   - `@/components/feedback` Skeleton -> a local SkeletonBlock (a muted rounded
//     View) reproducing the gauge / chart loading placeholders.
//   - `@/components/motion` FadeIn -> a reduced-motion-aware FadeIn honouring the
//     web per-section `delay` (0.1 / 0.2 / 0.3 / 0.4).
//   - `@/hooks/useSelectedVehicle` -> first-vehicle default + NativeSelect.
//   - `@/hooks/usePageTitle` (document.title) -> native no-op shim.
//   - `@/lib/dateFormat` formatDate/formatDateTime + `@/lib/numberFormat`
//     fmtNumber -> inlined native-safe equivalents.
//   - `@/lib/cn` (clsx + tailwind-merge) is dropped; conditional classNames
//     become StyleSheet style arrays.
//   - react-i18next useTranslation -> a local t(key, defaultOrVars?, vars?) shim
//     mirroring i18next's flexible signature so every key + English copy is
//     preserved verbatim (most calls pass the English string AS the key, e.g.
//     t('Date'), which the shim returns unchanged).
//   - `@/components/ai/AIVampireDrainExplanation` reuses the already-ported
//     native parity component (withAiFeature gates the whole surface;
//     ai_mode='off' renders nothing).
//   - lucide-react icons (BatteryWarning/Clock/Zap/Activity/Lightbulb/
//     ShieldAlert) are decorative; rendered as colour-coded emoji glyphs (the
//     native labels carry the meaning).

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
import {useQuery} from '@tanstack/react-query';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {StatusPill} from '../../../../components/ui/StatusPill';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {AIVampireDrainExplanation} from '../../../components/ai/AIVampireDrainExplanation';
import {CHART_COLORS} from '../../../components/charts/chartUtils';
import {RadialGauge} from '../../../components/charts/RadialGauge';
import {ErrorBoundary} from '../../../components/feedback/ErrorBoundary';
import {GlassPanel} from '../../../components/ui/GlassPanel';

/* ─── Types (web `interface VampireDrainEntry` / `VampireDrainStats`) ──────── */

interface VampireDrainEntry {
  id: number;
  vehicle_id: number;
  date: string;
  start_battery: number;
  end_battery: number;
  drain_pct: number;
  drain_rate_pct_hr: number;
  duration_hours: number;
  energy_lost_kwh: number;
  sentry_active: boolean;
}

interface VampireDrainStats {
  avg_drain_rate: number;
  total_energy_lost: number;
  worst_drain_pct: number;
  drain_score: number;
  entries: VampireDrainEntry[];
  daily: {date: string; drain_pct: number; hours_parked: number}[];
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

// Mirrors i18next's flexible signature: t('Date') returns the key (which IS the
// English copy here), t(key, 'Default') returns the default, and either form
// interpolates {{vars}}. Native has no translation table, so the key/default is
// the visible string — preserving every web key + English copy verbatim.
function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (
      key: string,
      defaultValueOrVars?: string | TranslationVars,
      maybeVars?: TranslationVars,
    ) => {
      if (typeof defaultValueOrVars === 'string') {
        return interpolate(defaultValueOrVars, maybeVars);
      }
      return interpolate(key, defaultValueOrVars);
    },
    [],
  );
}

/* ─── usePageTitle (web sets document.title; native has no document) ───────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── native-safe formatting (web `@/lib/numberFormat`) ────────────────────── */

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

/* ─── native-safe date formatting (web `@/lib/dateFormat`) ─────────────────── */

// web `formatDate` -> "Apr 4, 2026"
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

// web `formatDateTime` -> "Apr 4, 2026, 09:30 PM"
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '\u2014';
  }
  return d.toLocaleString('en-US', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/* ─── useSortToggle (web `@/components/ui` useSortToggle) ───────────────────── */

type SortDir = 'asc' | 'desc';

interface SortToggle {
  sortKey: string;
  sortDir: SortDir;
  onSort: (key: string) => void;
  sortFn: <T>(
    rows: T[],
    accessor: (row: T, key: string) => number | string,
  ) => T[];
}

// Verbatim port of the web hook: default dir 'desc', toggling the active key
// flips the direction, selecting a new key resets to 'desc'.
function useSortToggle(defaultKey?: string, defaultDir: SortDir = 'desc'): SortToggle {
  const [sortKey, setSortKey] = useState(defaultKey ?? '');
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const onSort = useCallback(
    (key: string) => {
      if (key === sortKey) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('desc');
      }
    },
    [sortKey],
  );

  const sortFn = useCallback(
    <T,>(rows: T[], accessor: (row: T, key: string) => number | string): T[] => {
      if (!sortKey) {
        return rows;
      }
      return [...rows].sort((a, b) => {
        const av = accessor(a, sortKey);
        const bv = accessor(b, sortKey);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    },
    [sortKey, sortDir],
  );

  return {onSort, sortDir, sortFn, sortKey};
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

/* ─── SkeletonBlock (web `@/components/feedback` Skeleton) ──────────────────── */

function SkeletonBlock({
  height,
  width,
}: {
  height: number;
  width?: DimensionValue;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.skeleton, {height, width: width ?? '100%'}]}
    />
  );
}

SkeletonBlock.displayName = 'SkeletonBlock';

/* ─── query-driven freshness chip (web `<DataFreshnessAuto>`) ───────────────── */

interface FreshnessQueryLike {
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
}

function FreshnessChip({
  query,
  t,
}: {
  query: FreshnessQueryLike;
  t: NativeTFunction;
}) {
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
  if (query.isStale) {
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

type Variant = 'success' | 'warning' | 'danger' | 'neutral';

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
    <View
      style={[
        styles.badge,
        badgeVariantStyles[variant],
        size === 'sm' && styles.badgeSm,
      ]}>
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

/* ─── SeriesBarChart (web `@/components/charts` Recharts Line/BarChart) ─────── */

interface BarSeries {
  key: string;
  label: string;
  color: string;
}

type ChartRow = Record<string, string | number>;

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
  showLegend,
}: {
  data: ReadonlyArray<ChartRow>;
  xKey: string;
  series: ReadonlyArray<BarSeries>;
  height: number;
  yFormatter: (value: number) => string;
  accessibilityLabel: string;
  showLegend?: boolean;
}) {
  const maxVal = data.reduce((max, row) => {
    const rowMax = series.reduce(
      (m, s) => Math.max(m, toBarNumber(row[s.key])),
      0,
    );
    return Math.max(max, rowMax);
  }, 0);

  const yTicks = [maxVal, maxVal / 2, 0].map(yFormatter);
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
        <ScrollView
          contentContainerStyle={styles.barsContent}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {data.map((row, rowIndex) => (
            <View key={rowIndex} style={[styles.barColumn, {width: columnWidth}]}>
              <View style={[styles.barTrack, {height}]}>
                <View style={styles.barGroup}>
                  {series.map(s => {
                    const value = toBarNumber(row[s.key]);
                    const pct =
                      maxVal > 0
                        ? Math.max(
                            (Math.max(value, 0) / maxVal) * 100,
                            value > 0 ? 3 : 0,
                          )
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

/* ─── DataTable (web `@/components/ui` DataTable, controlled sort) ──────────── */

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
}

// Web `pagination` boolean defaults to 25 rows/page (DataTable defaultPageSize).
const TABLE_PAGE_SIZE = 25;

function DataTable<T>({
  columns,
  data,
  keyExtractor,
  sortKey,
  sortDir,
  onSort,
  emptyMessage,
  pagination,
}: {
  columns: ReadonlyArray<Column<T>>;
  data: ReadonlyArray<T>;
  keyExtractor: (row: T) => string | number;
  sortKey?: string;
  sortDir?: SortDir;
  onSort?: (key: string) => void;
  emptyMessage: string;
  pagination?: boolean;
}) {
  // Sort is controlled by the parent (useSortToggle + sortFn), exactly like the
  // web DataTable: this table only paginates the already-sorted `data`.
  const [page, setPage] = useState(0);

  const pageCount = pagination
    ? Math.max(1, Math.ceil(data.length / TABLE_PAGE_SIZE))
    : 1;
  const safePage = Math.min(page, pageCount - 1);
  const rows = pagination
    ? data.slice(safePage * TABLE_PAGE_SIZE, (safePage + 1) * TABLE_PAGE_SIZE)
    : data;

  if (data.length === 0) {
    return <EmptyState message={emptyMessage} title={emptyMessage} />;
  }

  return (
    <View>
      <View style={styles.tableHeaderRow}>
        {columns.map(col => {
          const active = sortKey === col.key;
          const indicator = active
            ? sortDir === 'asc'
              ? ' \u25B2'
              : ' \u25BC'
            : '';
          return (
            <Pressable
              accessibilityRole={col.sortable ? 'button' : undefined}
              disabled={!col.sortable}
              key={col.key}
              onPress={() => {
                if (col.sortable) {
                  onSort?.(col.key);
                  setPage(0);
                }
              }}
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
        <View key={String(keyExtractor(row))} style={styles.tableRow}>
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

/* ─── chart colours (web Recharts literals via shared CB-safe palette) ─────── */

const TREND_COLOR = CHART_COLORS[2];
const DAILY_DRAIN_COLOR = CHART_COLORS[5];
const DAILY_HOURS_COLOR = CHART_COLORS[0];
const GAUGE_SIZE = 160;

/* ─── tip glyphs (web lucide icons -> decorative emoji) ────────────────────── */

const GLYPH_SHIELD_ALERT = '\uD83D\uDEE1'; // ShieldAlert
const GLYPH_CLOCK = '\u23F0'; // Clock
const GLYPH_BATTERY_WARNING = '\uD83E\uDEAB'; // BatteryWarning
const GLYPH_ACTIVITY = '\uD83D\uDCC8'; // Activity
const GLYPH_ZAP = '\u26A1'; // Zap
const GLYPH_LIGHTBULB = '\uD83D\uDCA1'; // Lightbulb

/* ─── VampireDrainPage ─────────────────────────────────────────────────────── */

export default function VampireDrainPage() {
  const t = useNativeTranslation();
  usePageTitle(t('vampire.title', 'Vampire Drain'));

  // useSelectedVehicle shim: default to the first vehicle (the web hook's final
  // fallback) while letting the header NativeSelect switch it.
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
  const activeId = vehicleId != null ? String(vehicleId) : '';

  const vampireQuery = useQuery<VampireDrainStats>({
    enabled: activeId !== '',
    queryFn: () =>
      request<VampireDrainStats>(
        `/vampire-drain/stats?vehicle_id=${activeId}`,
      ),
    queryKey: ['vampire-drain-stats', activeId],
  });
  const {data, isLoading, error} = vampireQuery;

  const {sortKey, sortDir, onSort, sortFn} = useSortToggle('date');

  const sortedEntries = useMemo(() => {
    if (!data?.entries) {
      return [];
    }
    return sortFn(data.entries, (row, key) => {
      const val = row[key as keyof VampireDrainEntry];
      return typeof val === 'number' ? val : String(val);
    });
  }, [data?.entries, sortFn]);

  const columns: Column<VampireDrainEntry>[] = useMemo(
    () => [
      {
        header: t('Date'),
        key: 'date',
        render: r => formatDateTime(r.date),
        sortable: true,
      },
      {
        header: t('Duration'),
        key: 'duration_hours',
        render: r => `${fmtNumber(r.duration_hours, 1)}h`,
        sortable: true,
      },
      {
        header: t('Start %'),
        key: 'start_battery',
        render: r => `${fmtNumber(r.start_battery, 0)}%`,
        sortable: true,
      },
      {
        header: t('End %'),
        key: 'end_battery',
        render: r => `${fmtNumber(r.end_battery, 0)}%`,
        sortable: true,
      },
      {
        header: t('Loss %'),
        key: 'drain_pct',
        render: r => (
          <Badge
            variant={
              r.drain_pct > 5 ? 'danger' : r.drain_pct > 2 ? 'warning' : 'success'
            }>
            {`${fmtNumber(r.drain_pct, 1)}%`}
          </Badge>
        ),
        sortable: true,
      },
      {
        header: t('Rate %/hr'),
        key: 'drain_rate_pct_hr',
        render: r => fmtNumber(r.drain_rate_pct_hr, 2),
        sortable: true,
      },
      {
        header: t('Sentry'),
        key: 'sentry_active',
        render: r => (
          <Badge size="sm" variant={r.sentry_active ? 'warning' : 'neutral'}>
            {r.sentry_active ? t('On') : t('Off')}
          </Badge>
        ),
        sortable: true,
      },
    ],
    [t],
  );

  const scoreColor =
    (data?.drain_score ?? 0) >= 80
      ? CHART_COLORS[1]
      : (data?.drain_score ?? 0) >= 50
        ? CHART_COLORS[3]
        : CHART_COLORS[5];

  const tips = useMemo(
    () => [
      {
        glyph: GLYPH_SHIELD_ALERT,
        text: t(
          'Disable Sentry Mode when parked at home to save 1\u20132 % per day.',
        ),
      },
      {
        glyph: GLYPH_CLOCK,
        text: t(
          'Reduce third-party app polling intervals to let the car sleep faster.',
        ),
      },
      {
        glyph: GLYPH_BATTERY_WARNING,
        text: t(
          'Avoid opening the app frequently \u2014 each wake cycle costs battery.',
        ),
      },
      {
        glyph: GLYPH_ACTIVITY,
        text: t(
          'Enable energy-saving mode in vehicle settings for better standby.',
        ),
      },
    ],
    [t],
  );

  const vehicleOptions: NativeSelectOption[] = vehicles.map(v => ({
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
    value: String(v.id),
  }));

  const trendData: ChartRow[] = (data?.entries ?? []).map(e => ({
    date: formatDate(e.date),
    drain_rate_pct_hr: e.drain_rate_pct_hr,
  }));

  const dailyData: ChartRow[] = (data?.daily ?? []).map(d => ({
    date: formatDate(d.date),
    drain_pct: d.drain_pct,
    hours_parked: d.hours_parked,
  }));

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="battery-vampire-drain">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {t('Vampire Drain')}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {t('Analyze phantom energy loss while your vehicle is parked')}
          </AppText>
        </View>
        <View style={styles.actions}>
          <NativeSelect
            accessibilityLabel={t('common.vehicle.select', 'Select vehicle')}
            onChange={v => setSelectedVehicleId(v ? Number(v) : null)}
            options={vehicleOptions}
            value={vehicleId != null ? String(vehicleId) : ''}
          />
          <FreshnessChip query={vampireQuery} t={t} />
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error instanceof Error ? (
        <GlassPanel padding="lg">
          <AppText style={styles.errorText} tone="danger">
            {error.message}
          </AppText>
        </GlassPanel>
      ) : (
        <ErrorBoundary name="vampire-drain-page">
          <View style={styles.stack}>
            {/* Vampire-drain explanation. The AI narrator is feature-gated via
                withAiFeature inside AIVampireDrainExplanation: when ai_mode='off'
                OR the per-feature toggle is off the wrapper returns null and the
                deterministic page below remains the canonical view (ADR-015). */}
            <FadeIn>
              <AIVampireDrainExplanation vehicleId={vehicleId ?? undefined} />
            </FadeIn>

            {/* Summary Metrics */}
            <FadeIn>
              <View style={styles.metricsGrid}>
                <MetricCard
                  color="purple"
                  glyph={GLYPH_ZAP}
                  help={t(
                    'help.vampireDrain.avgRate',
                    'Mean battery loss per hour while parked and not charging across the selected period.',
                  )}
                  label={t('Avg Drain Rate')}
                  value={`${fmtNumber(data?.avg_drain_rate, 2)}%/hr`}
                />
                <MetricCard
                  color="red"
                  glyph={GLYPH_BATTERY_WARNING}
                  help={t(
                    'help.vampireDrain.totalLoss',
                    'Estimated kWh lost to vampire drain across all parked sessions in the selected period.',
                  )}
                  label={t('Total Phantom Loss')}
                  value={`${fmtNumber(data?.total_energy_lost, 1)} kWh`}
                />
                <MetricCard
                  color="amber"
                  glyph={GLYPH_ACTIVITY}
                  help={t(
                    'help.vampireDrain.worstSession',
                    'Single parked session with the largest % battery drop.',
                  )}
                  label={t('Worst Session')}
                  value={`${fmtNumber(data?.worst_drain_pct, 1)}%`}
                />
                <MetricCard
                  color="green"
                  glyph={GLYPH_SHIELD_ALERT}
                  help={t(
                    'help.vampireDrain.score',
                    '0\u2013100 health score derived from your drain rate vs. fleet expectations. Higher is better.',
                  )}
                  label={t('Drain Score')}
                  value={`${fmtNumber(data?.drain_score, 0)}/100`}
                />
              </View>
            </FadeIn>

            {/* Gauge + Drain Rate Trend */}
            <FadeIn delay={0.1}>
              <View style={styles.gaugeTrendRow}>
                <GlassPanel padding="lg" style={styles.gaugeWrap}>
                  {data ? (
                    <RadialGauge
                      color={scoreColor}
                      label={t('Score')}
                      max={100}
                      size={GAUGE_SIZE}
                      unit="/100"
                      value={Math.round(data.drain_score)}
                    />
                  ) : (
                    <SkeletonBlock height={GAUGE_SIZE} width={GAUGE_SIZE} />
                  )}
                </GlassPanel>

                <GlassPanel padding="md" style={styles.trendWrap}>
                  <AppText style={styles.panelTitle} tone="secondary">
                    {t('Drain Rate Trend')}
                  </AppText>
                  {data?.entries && data.entries.length > 0 ? (
                    <SeriesBarChart
                      accessibilityLabel={t('Drain Rate Trend')}
                      data={trendData}
                      height={220}
                      series={[
                        {
                          color: TREND_COLOR,
                          key: 'drain_rate_pct_hr',
                          label: t('Drain Rate'),
                        },
                      ]}
                      xKey="date"
                      yFormatter={v => `${fmtNumber(v, 2)}`}
                    />
                  ) : (
                    <SkeletonBlock height={220} />
                  )}
                </GlassPanel>
              </View>
            </FadeIn>

            {/* Daily Drain Bar Chart */}
            <FadeIn delay={0.2}>
              <GlassPanel padding="md">
                <AppText style={styles.panelTitle} tone="secondary">
                  {t('Daily Drain While Parked')}
                </AppText>
                {data?.daily && data.daily.length > 0 ? (
                  <SeriesBarChart
                    accessibilityLabel={t('Daily Drain While Parked')}
                    data={dailyData}
                    height={260}
                    series={[
                      {
                        color: DAILY_DRAIN_COLOR,
                        key: 'drain_pct',
                        label: t('Drain %'),
                      },
                      {
                        color: DAILY_HOURS_COLOR,
                        key: 'hours_parked',
                        label: t('Parked Hours'),
                      },
                    ]}
                    xKey="date"
                    yFormatter={v => `${fmtNumber(v, 1)}`}
                  />
                ) : (
                  <SkeletonBlock height={260} />
                )}
              </GlassPanel>
            </FadeIn>

            {/* Drain Sessions Table */}
            <FadeIn delay={0.3}>
              <GlassPanel padding="md">
                <View style={styles.sessionsHeader}>
                  <AppText style={styles.panelTitle} tone="secondary">
                    {t('Drain Sessions')}
                  </AppText>
                  <Badge variant="neutral">
                    {`${data?.entries?.length ?? 0} ${t('sessions')}`}
                  </Badge>
                </View>
                <DataTable<VampireDrainEntry>
                  columns={columns}
                  data={sortedEntries}
                  emptyMessage={t('No drain sessions recorded yet.')}
                  keyExtractor={r => r.id}
                  onSort={onSort}
                  pagination
                  sortDir={sortDir}
                  sortKey={sortKey}
                />
              </GlassPanel>
            </FadeIn>

            {/* Recommendations */}
            <FadeIn delay={0.4}>
              <GlassPanel glow="green" hover padding="lg">
                <View style={styles.tipsHeader}>
                  <AppText style={styles.tipsGlyph}>{GLYPH_LIGHTBULB}</AppText>
                  <AppText weight="semibold">
                    {t('Tips to Reduce Vampire Drain')}
                  </AppText>
                </View>
                <View style={styles.tipsList}>
                  {tips.map((tip, i) => (
                    <View key={i} style={styles.tipItem}>
                      <AppText style={styles.tipGlyph} tone="muted">
                        {tip.glyph}
                      </AppText>
                      <AppText style={styles.tipText} tone="secondary" variant="caption">
                        {tip.text}
                      </AppText>
                    </View>
                  ))}
                </View>
              </GlassPanel>
            </FadeIn>
          </View>
        </ErrorBoundary>
      )}
    </ScrollView>
  );
}

VampireDrainPage.displayName = 'VampireDrainPage';

const badgeVariantStyles = StyleSheet.create<Record<Variant, ViewStyle>>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
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
  neutral: colors.textSecondary,
  success: colors.success,
  warning: colors.warning,
};

const styles = StyleSheet.create({
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
  errorText: {
    fontSize: 13,
  },
  gaugeTrendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  gaugeWrap: {
    alignItems: 'center',
    flexBasis: '30%',
    flexGrow: 1,
    justifyContent: 'center',
    minWidth: 180,
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
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
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
  sessionsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
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
  tipGlyph: {
    fontSize: 14,
    marginTop: 1,
  },
  tipItem: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tipsGlyph: {
    color: colors.success,
    fontSize: 18,
  },
  tipsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tipsList: {
    gap: spacing.sm,
  },
  tipText: {
    flex: 1,
  },
  trendWrap: {
    flexBasis: '60%',
    flexGrow: 1,
    minWidth: 260,
  },
  yAxis: {
    justifyContent: 'space-between',
    paddingBottom: 20,
    width: 56,
  },
});
