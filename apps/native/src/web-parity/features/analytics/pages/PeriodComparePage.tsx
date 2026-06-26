// Native parity port of web/src/features/analytics/pages/PeriodComparePage.tsx.
//
// Two-period analytics comparison surface. Every behaviour from the web page is
// preserved one-for-one:
//   - All state names (vehicleId, periodA, periodB, bannerVisible) and their
//     defaults ('' / '30' / '90' / persisted-visible).
//   - The activeVehicle / daysA / daysB derivations, the two `period-stats`
//     TanStack queries (GET /analytics/period-stats?vehicle_id=&days=, enabled
//     when a vehicle is selected), isLoading / error / a / b, and the
//     single-vehicle banner-hide effect.
//   - The periodOptions / vehicleOptions / metrics / chartData / tableRows /
//     columns / insights useMemos, with identical SI->display unit handling:
//     total_distance (SI km) -> meters -> convertDistanceFromSI(distanceUnit);
//     avg_efficiency (SI Wh/km) -> Wh/mi via *KM_PER_MILE for mi users.
//   - The pctChange helper, PERIOD_DAYS / PERIOD_VALUES, KM_PER_MILE /
//     METERS_PER_KM, and the BANNER_DISMISSED_KEY localStorage contract.
//   - Every i18n key keeps its English default string (intent preserved).
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-i18next useTranslation -> inlined useNativeTranslation(): a stable
//     (key, fallback, options?) => fallback shim reproducing i18next `{{name}}`
//     interpolation against the English fallback copy (used by the insights).
//   - react-router-dom Link / useUrlString / useUrlEnum (URL-synced state) ->
//     native-safe in-memory useState hooks that keep the same value/validation
//     contract (enum guard falls back to default); there is no URL on bare
//     native so persistence to the query string is intentionally dropped. The
//     fleet-comparison Link becomes an accessibilityRole="link" Pressable whose
//     navigation target is unavailable in this parity surface.
//   - lucide-react Car/Calendar/TrendingUp/Zap/Gauge/DollarSign/Leaf/Lightbulb/
//     ArrowLeftRight -> SemanticIcon glyphs + per-metric colour chips.
//   - @/components/layout PageContainer -> inline native PageContainer (title +
//     subtitle + loading spinner + error banner + children, mirroring the web
//     loading/error/children branches).
//   - @/components/ui GlassPanel/Badge/Select/DataTable(+Column) -> the existing
//     native GlassPanel plus inline native Badge, chip-row Select, and a
//     horizontally scrolling comparison table with optional column sorting.
//   - @/components/data-display MetricCard -> inline native MetricCard (label,
//     value, colour-chip icon, subtitle, ↑/↓ change pill).
//   - @/components/feedback Skeleton/EmptyState/AlertBanner -> inline native
//     Skeleton (placeholder bars), EmptyState (icon+message), and a dismissible
//     AlertBanner.
//   - @/components/motion FadeIn -> Animated.View opacity 0->1 mount fade.
//   - @/components/charts Recharts BarChart (grouped, shared linear axis) ->
//     an inline native grouped horizontal bar chart: per-metric A/B bars
//     coloured from the user palette with explicit value labels and a legend,
//     so the A-vs-B comparison intent is preserved and no value is hidden by
//     the small-screen scale.
//   - @/hooks/usePageTitle -> native-safe usePageTitle (feature-detects
//     document.title; writes "{title} — TeslaSync").
//   - @/hooks/useUnits -> inlined useDistanceUnit() reading unit_of_length from
//     the ported useSettings ('mi' -> 'mi', else 'km'), matching deriveDistance.
//   - @/hooks/useChartPalette -> inlined useChartPalette() reading chart_palette
//     from useSettings (resolveChartPalette: 'neon' -> neon, else cb-safe).
//   - @/lib/unitConversion convertDistanceFromSI + @/lib/numberFormat fmtNumber
//     -> ported byte-for-byte (incl. safeNumber; default precision 2 / en-US,
//     the web module defaults).
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web UI components are imported — only react, react-native
// primitives, the ported web-parity api client + hooks + AI narration, and the
// existing apps/native SemanticIcon / AppText / GlassPanel / theme tokens.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { SemanticIcon, type SemanticIconName } from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';

import { request } from '../../../api/client';
import { useVehicles } from '../../../api/hooks/useVehicles';
import { useSettings } from '../../../api/hooks/useSettings';
import { AIPeriodCompareNarration } from '../../../components/ai/AIPeriodCompareNarration';

/* ── Types ─────────────────────────────────────────────── */

interface PeriodStats {
  total_distance: number;
  total_drives: number;
  energy_used: number;
  avg_efficiency: number;
  total_cost: number;
  co2_saved: number;
}

interface ComparisonRow {
  metric: string;
  periodA: number;
  periodB: number;
  change: number;
  pctChange: string;
  positive: boolean;
}

type MetricColor = 'cyan' | 'green' | 'purple';

interface MetricEntry {
  key: string;
  label: string;
  glyph: string;
  a: number;
  b: number;
  unit: string;
  color: MetricColor;
}

type SortDirection = 'asc' | 'desc';

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: number;
}

interface SelectOption {
  value: string;
  label: string;
}

type BadgeVariant = 'success' | 'danger';
type AlertVariant = 'info';

type NativeTOptions = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

/* ── Helpers (ported from @/lib/numberFormat) ──────────── */

// Web fmtNumber reads a module-global precision/locale set by the settings
// load path; this parity port keeps the same web defaults (precision 2,
// en-US) since the page never overrides them except the explicit pct call.
const DEFAULT_PRECISION = 2;
const DEFAULT_LOCALE = 'en-US';

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale?: string): string {
  const d = decimals ?? DEFAULT_PRECISION;
  const lc = locale ?? DEFAULT_LOCALE;
  try {
    return safeNumber(v).toLocaleString(lc, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

/* ── Helpers (ported from @/lib/unitConversion) ────────── */

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

type DistanceUnitPref = 'km' | 'mi' | 'ft';

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

/* ── Helpers (page-local, ported verbatim) ─────────────── */

function pctChange(a: number, b: number): { value: string; positive: boolean } {
  if (b === 0) return { value: '—', positive: true };
  const pct = ((a - b) / b) * 100;
  return { value: `${pct > 0 ? '+' : ''}${fmtNumber(pct, 1)}%`, positive: pct >= 0 };
}

const PERIOD_DAYS: Record<string, number> = {
  '7': 7,
  '30': 30,
  '90': 90,
  '365': 365,
  '0': 0,
};

const PERIOD_VALUES = ['7', '30', '90', '365', '0'] as const;
type PeriodValue = (typeof PERIOD_VALUES)[number];

const KM_PER_MILE = 1.609344;
const METERS_PER_KM = 1000;

// Disambiguation banner dismissal is persisted so users who already understand
// the difference between compare pages do not have to dismiss it on every visit.
// Separate keys let each compare page track its own banner.
const BANNER_DISMISSED_KEY = 'phase40.compareBanner.dismissed.period';

/* ── Chart palette (ported from @/lib/colors + useChartPalette) ── */

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

function resolveChartPalette(pref: string | null | undefined): readonly string[] {
  return pref === 'neon' ? CHART_COLORS_NEON : CHART_COLORS_CB_SAFE;
}

// @/hooks/useChartPalette: reads chart_palette from the server-persisted
// settings and resolves to the matching palette (cb-safe default).
function useChartPalette(): readonly string[] {
  const { data } = useSettings();
  return resolveChartPalette(data?.chart_palette);
}

// @/hooks/useUnits (distance slice): derives the distance display unit from
// settings.unit_of_length exactly as deriveDistance ('mi' -> 'mi', else 'km').
function useDistanceUnit(): 'mi' | 'km' {
  const { data } = useSettings();
  return data?.unit_of_length === 'mi' ? 'mi' : 'km';
}

/* ── i18n shim (react-i18next useTranslation) ──────────── */

function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      return Object.keys(options).reduce(
        (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
        fallback,
      );
    },
    [],
  );
}

/* ── usePageTitle shim ─────────────────────────────────── */

function usePageTitle(title: string): void {
  useEffect(() => {
    const doc = (globalThis as { document?: { title?: string } }).document;
    if (doc && typeof doc.title === 'string') {
      const prev = doc.title;
      doc.title = `${title} — TeslaSync`;
      return () => {
        doc.title = prev;
      };
    }
    return undefined;
  }, [title]);
}

/* ── URL-state shims (react-router-dom useSearchParams) ── */

interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Feature-detects Web Storage (present on react-native-web, absent on bare
// native). When unavailable the banner dismissal lives only in memory.
function getLocalStorage(): LocalStorageLike | null {
  const ls = (globalThis as { localStorage?: LocalStorageLike }).localStorage;
  if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') {
    return ls;
  }
  return null;
}

type StringSetter = (value: string | ((prev: string) => string)) => void;
type EnumSetter<E extends string> = (value: E | ((prev: E) => E)) => void;

// useUrlString: in-memory equivalent of the URL-synced string param. The
// value/updater setter contract is preserved; native has no query string.
function useUrlString(_key: string, defaultValue = ''): [string, StringSetter] {
  const [value, setValue] = useState<string>(defaultValue);
  const set = useCallback<StringSetter>(next => {
    setValue(prev =>
      typeof next === 'function' ? (next as (p: string) => string)(prev) : next,
    );
  }, []);
  return [value, set];
}

// useUrlEnum: in-memory equivalent of the URL-synced enum param. Values not in
// `allowed` fall back to `defaultValue`, matching the web parse guard.
function useUrlEnum<E extends string>(
  _key: string,
  allowed: readonly E[],
  defaultValue: E,
): [E, EnumSetter<E>] {
  const [value, setValue] = useState<E>(defaultValue);
  const set = useCallback<EnumSetter<E>>(
    next => {
      setValue(prev => {
        const resolved =
          typeof next === 'function' ? (next as (p: E) => E)(prev) : next;
        return allowed.includes(resolved) ? resolved : defaultValue;
      });
    },
    [allowed, defaultValue],
  );
  return [value, set];
}

/* ── FadeIn (web @/components/motion FadeIn) ───────────── */

function FadeIn({
  children,
  delay = 0,
}: {
  children: ReactNode;
  delay?: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 220,
      delay: Math.round(delay * 1000),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity, delay]);

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

/* ── PageContainer (web @/components/layout PageContainer) ── */

function PageContainer({
  title,
  subtitle,
  loading,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: Error | null;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      style={styles.page}>
      <View style={styles.pageHeader}>
        <AppText variant="title" weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {subtitle}
          </AppText>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <AppText style={styles.errorText} variant="caption" weight="semibold">
            {error.message}
          </AppText>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/* ── AlertBanner (web @/components/feedback AlertBanner) ── */

function AlertBanner({
  icon,
  onClose,
  children,
}: {
  variant: AlertVariant;
  icon: SemanticIconName;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useNativeTranslation();
  return (
    <View style={styles.alert}>
      <SemanticIcon decorative name={icon} size="sm" style={styles.alertIcon} />
      <View style={styles.alertBody}>{children}</View>
      <Pressable
        accessibilityLabel={t('common.dismiss', 'Dismiss')}
        accessibilityRole="button"
        hitSlop={6}
        onPress={onClose}
        style={({ pressed }) => [styles.alertClose, pressed && styles.pressed]}>
        <SemanticIcon decorative name="close" size="sm" />
      </Pressable>
    </View>
  );
}

/* ── Select (web @/components/ui Select) ───────────────── */

// Native-safe replacement for the web <select>: a label plus a horizontally
// scrollable row of option chips. onValueChange(value) preserves the web
// onChange(e => e.target.value) contract.
function Select({
  label,
  options,
  value,
  onValueChange,
}: {
  label: string;
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <AppText
        style={styles.fieldLabel}
        tone="secondary"
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}>
        <View style={styles.selectRow}>
          {options.map(option => {
            const active = option.value === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                hitSlop={4}
                key={option.value === '' ? '__all__' : option.value}
                onPress={() => onValueChange(option.value)}
                style={({ pressed }) => [
                  styles.selectChip,
                  active && styles.selectChipActive,
                  pressed && styles.pressed,
                ]}>
                <AppText
                  style={active ? styles.selectChipTextActive : styles.selectChipText}
                  variant="caption"
                  weight="semibold">
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

/* ── Badge (web @/components/ui Badge) ─────────────────── */

function Badge({ label, variant }: { label: string; variant: BadgeVariant }) {
  return (
    <View style={[styles.badge, badgeSurfaceStyles[variant]]}>
      <AppText
        style={badgeTextStyles[variant]}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/* ── MetricCard (web @/components/data-display MetricCard) ── */

function MetricCard({
  label,
  value,
  glyph,
  color,
  subtitle,
  change,
}: {
  label: string;
  value: string;
  glyph: string;
  color: MetricColor;
  subtitle: string;
  change: { value: string; positive: boolean };
}) {
  const chip = METRIC_CHIP[color];
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricTop}>
        <View style={styles.metricTextCol}>
          <AppText
            numberOfLines={1}
            style={styles.metricLabel}
            tone="muted"
            variant="caption"
            weight="semibold">
            {label}
          </AppText>
          <AppText style={styles.metricValue} weight="bold">
            {value}
          </AppText>
          <AppText
            numberOfLines={1}
            style={styles.metricSubtitle}
            tone="muted"
            variant="caption">
            {subtitle}
          </AppText>
          <AppText
            style={[
              styles.metricChange,
              change.positive ? styles.changePositive : styles.changeNegative,
            ]}
            variant="caption"
            weight="semibold">
            {change.positive ? '↑' : '↓'} {change.value}
          </AppText>
        </View>
        <View
          style={[
            styles.metricChip,
            { backgroundColor: chip.bg, borderColor: chip.border },
          ]}>
          <AppText style={[styles.metricGlyph, { color: chip.text }]} weight="bold">
            {glyph}
          </AppText>
        </View>
      </View>
    </View>
  );
}

/* ── ComparisonBarChart (web @/components/charts BarChart) ── */

// Recharts grouped BarChart (Period A / Period B per metric, shared linear
// axis) -> native grouped horizontal bars. Each metric's A/B bars are scaled
// to that metric's own max so both series stay legible on a phone; the exact
// values are always printed beside the bars so no information is lost.
function ComparisonBarChart({
  data,
  palette,
  labelA,
  labelB,
}: {
  data: { name: string; A: number; B: number }[];
  palette: readonly string[];
  labelA: string;
  labelB: string;
}) {
  const colorA = palette[0] ?? colors.accent;
  const colorB = palette[1] ?? colors.success;
  return (
    <View style={styles.chart}>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: colorA }]} />
          <AppText tone="secondary" variant="caption">
            {labelA}
          </AppText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: colorB }]} />
          <AppText tone="secondary" variant="caption">
            {labelB}
          </AppText>
        </View>
      </View>
      {data.map(entry => {
        const max = Math.max(Math.abs(entry.A), Math.abs(entry.B), 1);
        const widthA = Math.max((Math.max(entry.A, 0) / max) * 100, entry.A > 0 ? 4 : 0);
        const widthB = Math.max((Math.max(entry.B, 0) / max) * 100, entry.B > 0 ? 4 : 0);
        return (
          <View key={entry.name} style={styles.chartGroup}>
            <AppText numberOfLines={1} variant="caption" weight="semibold">
              {entry.name}
            </AppText>
            <View style={styles.chartBarRow}>
              <View style={styles.chartTrack}>
                <View
                  style={[styles.chartFill, { width: `${widthA}%`, backgroundColor: colorA }]}
                />
              </View>
              <AppText style={styles.chartValue} variant="caption">
                {fmtNumber(entry.A)}
              </AppText>
            </View>
            <View style={styles.chartBarRow}>
              <View style={styles.chartTrack}>
                <View
                  style={[styles.chartFill, { width: `${widthB}%`, backgroundColor: colorB }]}
                />
              </View>
              <AppText style={styles.chartValue} variant="caption">
                {fmtNumber(entry.B)}
              </AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ── ComparisonTable (web @/components/ui DataTable) ───── */

const TABLE_COL_WIDTH = 120;

function ComparisonTable({
  columns,
  data,
  keyExtractor,
}: {
  columns: Column<ComparisonRow>[];
  data: ComparisonRow[];
  keyExtractor: (row: ComparisonRow) => string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  const toggleSort = useCallback((key: string) => {
    setSortKey(prevKey => {
      if (prevKey === key) {
        setSortDir(prevDir => (prevDir === 'asc' ? 'desc' : 'asc'));
        return key;
      }
      setSortDir('desc');
      return key;
    });
  }, []);

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const rows = [...data];
    rows.sort((ra, rb) => {
      const va = (ra as unknown as Record<string, unknown>)[sortKey];
      const vb = (rb as unknown as Record<string, unknown>)[sortKey];
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va ?? '').localeCompare(String(vb ?? ''));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  const totalWidth = columns.reduce(
    (sum, col) => sum + (col.width ?? TABLE_COL_WIDTH),
    0,
  );

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={{ width: totalWidth }}>
        <View style={styles.tableHeaderRow}>
          {columns.map(col => {
            const isSorted = sortKey === col.key;
            const header = (
              <AppText
                style={cellTextAlign(col.align)}
                tone="muted"
                variant="caption"
                weight="semibold">
                {col.header}
                {isSorted ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </AppText>
            );
            return (
              <View
                key={col.key}
                style={[styles.tableHeaderCell, { width: col.width ?? TABLE_COL_WIDTH }]}>
                {col.sortable ? (
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={4}
                    onPress={() => toggleSort(col.key)}>
                    {header}
                  </Pressable>
                ) : (
                  header
                )}
              </View>
            );
          })}
        </View>

        {sorted.map(row => (
          <View key={keyExtractor(row)} style={styles.tableRow}>
            {columns.map(col => (
              <View
                key={col.key}
                style={[
                  styles.tableCell,
                  { width: col.width ?? TABLE_COL_WIDTH },
                  alignContainer(col.align),
                ]}>
                {col.render(row)}
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/* ── Skeleton (web @/components/feedback Skeleton) ─────── */

function Skeleton({ lines }: { lines: number }) {
  return (
    <View style={styles.skeleton}>
      {Array.from({ length: lines }).map((_, idx) => (
        <View key={idx} style={styles.skeletonLine} />
      ))}
    </View>
  );
}

/* ── EmptyState (web @/components/feedback EmptyState) ──── */

function EmptyState({
  icon,
  message,
}: {
  icon: SemanticIconName;
  message: string;
}) {
  return (
    <View accessibilityRole="summary" style={styles.empty}>
      <SemanticIcon decorative name={icon} size="lg" style={styles.emptyIcon} />
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ── Component ─────────────────────────────────────────── */

export default function PeriodComparePage() {
  const t = useNativeTranslation();
  usePageTitle(t('compare.title', 'Period Comparison'));
  const distanceUnit = useDistanceUnit();
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const [vehicleId, setVehicleId] = useUrlString('vehicle_id', '');
  const [periodA, setPeriodA] = useUrlEnum<PeriodValue>('period_a', PERIOD_VALUES, '30');
  const [periodB, setPeriodB] = useUrlEnum<PeriodValue>('period_b', PERIOD_VALUES, '90');

  // Reactive chart palette (color-blind-safe or neon, per user preference).
  const palette = useChartPalette();

  // Disambiguation banner — defaults to visible, persists dismissal.
  const [bannerVisible, setBannerVisible] = useState<boolean>(() => {
    try {
      return getLocalStorage()?.getItem(BANNER_DISMISSED_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const dismissBanner = () => {
    setBannerVisible(false);
    try {
      getLocalStorage()?.setItem(BANNER_DISMISSED_KEY, '1');
    } catch {
      // Storage failures are non-fatal — banner just reappears next mount.
    }
  };

  /* ── Queries ── */

  const { data: vehicles } = useVehicles();

  const activeVehicle = vehicleId || String(vehicles?.[0]?.id ?? '');
  const daysA = PERIOD_DAYS[periodA] ?? 30;
  const daysB = PERIOD_DAYS[periodB] ?? 90;

  const statsA = useQuery({
    queryKey: ['period-stats', activeVehicle, daysA],
    queryFn: () =>
      request<PeriodStats>(
        `/analytics/period-stats?vehicle_id=${activeVehicle}&days=${daysA}`,
      ),
    enabled: !!activeVehicle,
  });

  const statsB = useQuery({
    queryKey: ['period-stats', activeVehicle, daysB],
    queryFn: () =>
      request<PeriodStats>(
        `/analytics/period-stats?vehicle_id=${activeVehicle}&days=${daysB}`,
      ),
    enabled: !!activeVehicle,
  });

  const isLoading = statsA.isLoading || statsB.isLoading;
  const error = statsA.error ?? statsB.error;
  const a = statsA.data;
  const b = statsB.data;

  // Hide the disambiguation banner for accounts with only one vehicle —
  // they can't usefully cross-navigate to fleet comparison anyway.
  const vehicleCount = (vehicles ?? []).length;
  useEffect(() => {
    if (vehicleCount < 2 && bannerVisible) {
      setBannerVisible(false);
    }
  }, [vehicleCount, bannerVisible]);

  /* ── Derived data ── */

  const periodOptions: SelectOption[] = useMemo(
    () => [
      { value: '7', label: t('compare.last7', 'Last 7 days') },
      { value: '30', label: t('compare.last30', 'Last 30 days') },
      { value: '90', label: t('compare.last90', 'Last 90 days') },
      { value: '365', label: t('compare.lastYear', 'Last year') },
      { value: '0', label: t('compare.allTime', 'All time') },
    ],
    [t],
  );

  const vehicleOptions: SelectOption[] = useMemo(
    () =>
      (vehicles ?? []).map(v => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  const metrics = useMemo<MetricEntry[]>(() => {
    if (!a || !b) return [];
    // backend `total_distance` is SI km; `avg_efficiency` is SI Wh/km. Convert
    // both to the user's preferred display unit so chart / table values match
    // the unit label and don't silently mis-render for mi-unit users.
    const distA = convertDistanceFromSI(a.total_distance * METERS_PER_KM, distanceUnit);
    const distB = convertDistanceFromSI(b.total_distance * METERS_PER_KM, distanceUnit);
    const effA = distanceUnit === 'mi' ? a.avg_efficiency * KM_PER_MILE : a.avg_efficiency;
    const effB = distanceUnit === 'mi' ? b.avg_efficiency * KM_PER_MILE : b.avg_efficiency;
    return [
      { key: 'distance', label: t('compare.totalDistance', 'Total Distance'), glyph: 'EV', a: distA, b: distB, unit: distanceUnit, color: 'cyan' },
      { key: 'drives', label: t('compare.totalDrives', 'Total Drives'), glyph: 'UP', a: a.total_drives, b: b.total_drives, unit: '', color: 'green' },
      { key: 'energy', label: t('compare.energyUsed', 'Energy Used'), glyph: 'ZP', a: a.energy_used, b: b.energy_used, unit: 'kWh', color: 'purple' },
      { key: 'efficiency', label: t('compare.avgEfficiency', 'Avg Efficiency'), glyph: 'EF', a: effA, b: effB, unit: efficiencyUnit, color: 'cyan' },
      { key: 'cost', label: t('compare.totalCost', 'Total Cost'), glyph: '$', a: a.total_cost, b: b.total_cost, unit: '$', color: 'green' },
      { key: 'co2', label: t('compare.co2Saved', 'CO₂ Saved'), glyph: 'LF', a: a.co2_saved, b: b.co2_saved, unit: 'kg', color: 'purple' },
    ];
  }, [a, b, t, distanceUnit, efficiencyUnit]);

  const chartData = useMemo(
    () => metrics.map(m => ({ name: m.label, A: m.a, B: m.b })),
    [metrics],
  );

  const tableRows: ComparisonRow[] = useMemo(
    () =>
      metrics.map(m => {
        const delta = m.a - m.b;
        const pct = pctChange(m.a, m.b);
        return {
          metric: m.label,
          periodA: m.a,
          periodB: m.b,
          change: delta,
          pctChange: pct.value,
          positive: pct.positive,
        };
      }),
    [metrics],
  );

  const columns: Column<ComparisonRow>[] = useMemo(
    () => [
      {
        key: 'metric',
        header: t('compare.metric', 'Metric'),
        width: 150,
        render: r => (
          <AppText weight="semibold">{r.metric}</AppText>
        ),
      },
      {
        key: 'periodA',
        header: t('compare.periodA', 'Period A'),
        sortable: true,
        align: 'right',
        render: r => <AppText tone="secondary">{fmtNumber(r.periodA)}</AppText>,
      },
      {
        key: 'periodB',
        header: t('compare.periodB', 'Period B'),
        sortable: true,
        align: 'right',
        render: r => <AppText tone="secondary">{fmtNumber(r.periodB)}</AppText>,
      },
      {
        key: 'change',
        header: t('compare.change', 'Change'),
        sortable: true,
        align: 'right',
        render: r => (
          <AppText
            style={r.positive ? styles.changePositive : styles.changeNegative}
            weight="semibold">
            {r.positive ? '↑' : '↓'} {fmtNumber(Math.abs(r.change))}
          </AppText>
        ),
      },
      {
        key: 'pctChange',
        header: t('compare.pctChange', '% Change'),
        align: 'right',
        render: r => (
          <Badge label={r.pctChange} variant={r.positive ? 'success' : 'danger'} />
        ),
      },
    ],
    [t],
  );

  const insights = useMemo(() => {
    if (!a || !b) return [];
    const distPct = pctChange(a.total_distance, b.total_distance);
    const effPct = pctChange(a.avg_efficiency, b.avg_efficiency);
    const costPct = pctChange(a.total_cost, b.total_cost);
    return [
      t('compare.insightDistance', 'Distance traveled was {{pct}} {{dir}} in Period A vs Period B.', {
        pct: distPct.value,
        dir: distPct.positive ? t('compare.more', 'more') : t('compare.less', 'less'),
      }),
      t('compare.insightEfficiency', 'Efficiency {{dir}} by {{pct}} compared to Period B.', {
        pct: effPct.value,
        dir: effPct.positive ? t('compare.improved', 'improved') : t('compare.declined', 'declined'),
      }),
      t('compare.insightCost', 'Costs were {{pct}} {{dir}} in Period A.', {
        pct: costPct.value,
        dir: costPct.positive ? t('compare.higher', 'higher') : t('compare.lower', 'lower'),
      }),
    ];
  }, [a, b, t]);

  /* ── Render ── */

  return (
    <PageContainer
      title={t('compare.title', 'Period Comparison')}
      subtitle={t('compare.subtitle', 'Compare key metrics across two time periods')}
      loading={isLoading}
      error={error as Error | null}>
      {/* Disambiguation banner — points users who wanted the fleet view to the
          right page. Hidden for single-vehicle accounts and once dismissed. */}
      {bannerVisible && (
        <FadeIn>
          <AlertBanner variant="info" icon="arrowLeftRight" onClose={dismissBanner}>
            <AppText tone="secondary" variant="caption">
              {t(
                'compare.banner.toFleetPrefix',
                'Looking to compare two vehicles instead?',
              )}{' '}
            </AppText>
            <Pressable accessibilityRole="link" hitSlop={4}>
              <AppText style={styles.bannerLink} variant="caption" weight="semibold">
                {t('compare.banner.toFleetCta', 'Open Fleet comparison →')}
              </AppText>
            </Pressable>
          </AlertBanner>
        </FadeIn>
      )}

      {/* Selectors */}
      <FadeIn>
        <GlassPanel style={styles.selectorPanel}>
          <Select
            label={t('compare.vehicle', 'Vehicle')}
            options={vehicleOptions}
            value={activeVehicle}
            onValueChange={value => setVehicleId(value)}
          />
          <Select
            label={t('compare.periodA', 'Period A')}
            options={periodOptions}
            value={periodA}
            onValueChange={value => setPeriodA(value as PeriodValue)}
          />
          <Select
            label={t('compare.periodB', 'Period B')}
            options={periodOptions}
            value={periodB}
            onValueChange={value => setPeriodB(value as PeriodValue)}
          />
        </GlassPanel>
      </FadeIn>

      {/* AI period-compare narration; opt-in and hidden when ai_mode='off'. */}
      <FadeIn delay={0.025}>
        <View style={styles.aiBlock}>
          <AIPeriodCompareNarration
            vehicleId={activeVehicle}
            daysA={daysA}
            daysB={daysB}
          />
        </View>
      </FadeIn>

      {!a || !b ? (
        isLoading ? (
          <Skeleton lines={6} />
        ) : (
          <EmptyState
            icon="calendar"
            message={t('compare.empty', 'Select a vehicle and two periods to compare.')}
          />
        )
      ) : (
        <>
          {/* Metric cards */}
          <FadeIn delay={0.05}>
            <View style={styles.metricGrid}>
              {metrics.map(m => {
                const pct = pctChange(m.a, m.b);
                return (
                  <MetricCard
                    key={m.key}
                    label={m.label}
                    value={`${fmtNumber(m.a)} ${m.unit}`}
                    glyph={m.glyph}
                    color={m.color}
                    subtitle={`${t('compare.periodB', 'Period B')}: ${fmtNumber(m.b)} ${m.unit}`}
                    change={pct}
                  />
                );
              })}
            </View>
          </FadeIn>

          {/* Bar chart */}
          <FadeIn delay={0.1}>
            <GlassPanel style={styles.panel}>
              <AppText style={styles.panelTitle} weight="semibold">
                {t('compare.chartTitle', 'Side-by-Side Comparison')}
              </AppText>
              <ComparisonBarChart
                data={chartData}
                palette={palette}
                labelA={t('compare.periodA', 'Period A')}
                labelB={t('compare.periodB', 'Period B')}
              />
            </GlassPanel>
          </FadeIn>

          {/* Data table */}
          <FadeIn delay={0.15}>
            <GlassPanel style={styles.panel}>
              <AppText style={styles.panelTitle} weight="semibold">
                {t('compare.tableTitle', 'Comparison Details')}
              </AppText>
              <ComparisonTable
                columns={columns}
                data={tableRows}
                keyExtractor={r => r.metric}
              />
            </GlassPanel>
          </FadeIn>

          {/* Insights */}
          <FadeIn delay={0.2}>
            <GlassPanel style={styles.panel}>
              <View style={styles.insightsHeader}>
                <SemanticIcon decorative name="lightbulb" size="sm" />
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('compare.insights', 'Insights')}
                </AppText>
              </View>
              <View style={styles.insightsList}>
                {insights.map((line, idx) => (
                  <AppText
                    key={idx}
                    style={styles.insightLine}
                    tone="secondary"
                    variant="caption">
                    • {line}
                  </AppText>
                ))}
              </View>
            </GlassPanel>
          </FadeIn>
        </>
      )}
    </PageContainer>
  );
}

/* ── style helpers ─────────────────────────────────────── */

function cellTextAlign(align: Column<ComparisonRow>['align']): TextStyle {
  if (align === 'right') return styles.textRight;
  if (align === 'center') return styles.textCenter;
  return styles.textLeft;
}

function alignContainer(align: Column<ComparisonRow>['align']): ViewStyle {
  if (align === 'right') return styles.cellRight;
  if (align === 'center') return styles.cellCenter;
  return styles.cellLeft;
}

const METRIC_CHIP: Record<MetricColor, { bg: string; border: string; text: string }> = {
  cyan: { bg: colors.accentSoft, border: colors.borderAccent, text: colors.accent },
  green: { bg: colors.successSurface, border: colors.successBorder, text: colors.success },
  purple: { bg: colors.violetSurface, border: colors.violetBorder, text: colors.violet },
};

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pageContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  pageHeader: {
    gap: spacing.xs,
  },
  pageSubtitle: {
    marginTop: 2,
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    borderRadius: 16,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
    borderRadius: 16,
    padding: spacing.md,
  },
  alertIcon: {
    marginTop: 1,
  },
  alertBody: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  alertClose: {
    padding: 2,
  },
  bannerLink: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  selectorPanel: {
    padding: spacing.md,
    gap: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    letterSpacing: 0.4,
  },
  selectRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  selectChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  selectChipActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  selectChipText: {
    color: colors.textSecondary,
  },
  selectChipTextActive: {
    color: colors.accent,
  },
  aiBlock: {
    marginBottom: spacing.xs,
  },
  badge: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 150,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  metricTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  metricTextCol: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 20,
    lineHeight: 26,
    color: colors.textPrimary,
  },
  metricSubtitle: {
    marginTop: 1,
  },
  metricChange: {
    marginTop: spacing.xs,
  },
  metricChip: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricGlyph: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
  },
  changePositive: {
    color: colors.success,
  },
  changeNegative: {
    color: colors.danger,
  },
  panel: {
    padding: spacing.md,
    gap: spacing.md,
  },
  panelTitle: {
    color: colors.textPrimary,
  },
  chart: {
    gap: spacing.md,
  },
  legendRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  chartGroup: {
    gap: spacing.xs,
  },
  chartBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chartTrack: {
    flex: 1,
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  chartFill: {
    height: '100%',
    borderRadius: 999,
  },
  chartValue: {
    width: 84,
    textAlign: 'right',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  tableHeaderCell: {
    paddingHorizontal: spacing.xs,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableCell: {
    paddingHorizontal: spacing.xs,
  },
  textLeft: {
    textAlign: 'left',
  },
  textRight: {
    textAlign: 'right',
  },
  textCenter: {
    textAlign: 'center',
  },
  cellLeft: {
    alignItems: 'flex-start',
  },
  cellRight: {
    alignItems: 'flex-end',
  },
  cellCenter: {
    alignItems: 'center',
  },
  skeleton: {
    gap: spacing.sm,
  },
  skeletonLine: {
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  insightsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  insightsList: {
    gap: spacing.xs,
  },
  insightLine: {
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.6,
  },
});

const badgeSurfaceStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  danger: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  success: {
    color: colors.success,
  },
  danger: {
    color: colors.danger,
  },
});
