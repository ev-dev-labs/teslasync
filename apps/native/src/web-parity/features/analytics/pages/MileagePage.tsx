/**
 * Native parity port of web/src/features/analytics/pages/MileagePage.tsx.
 *
 * The web page is the per-vehicle "Mileage" analytics surface: a header with a
 * VehicleSelect + DataFreshness chip, four summary MetricCards (total distance,
 * total drives, 30-day daily average, annual projection), an odometer-over-time
 * area chart, a daily-distance bar chart, and a monthly-summary DataTable. It
 * reads three restored endpoints — `/mileage/stats`, `/mileage/daily?days=90`,
 * and `/mileage/monthly` — through the canonical `useMileageStats` /
 * `useDailyMileage` / `useMonthlyMileage` TanStack Query hooks, converts the
 * backend's kilometre figures to the user's display unit at the render boundary,
 * and guards against a null selected vehicle with `<NoVehicleSelected>`.
 *
 * This native port preserves that contract 1:1 — the same three queries and
 * exact API paths, the same `activeId` / `fromKm` derivations, the verbatim
 * `totalDistanceDisplay` / `totalDrives` / `dailyAvgKm` / `dailyAvgDisplay` /
 * `annualProjectionDisplay` rollups, the `odometerData` (end_odometer_km, NULL
 * filtered) / `dailyData` (total_km) / `monthlyRows` (year_month, total_km,
 * drive_count) memos, the four MetricCards, both chart panels with their empty
 * states, and the monthly summary table — using React Native primitives, the
 * existing native AppText / GlassPanel + design tokens, the already-ported
 * web-parity MetricCard, and the native-safe web-parity charts barrel.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L2/L50): no native i18next runtime, so
 *     an inline native-safe `t(key, fallback?)` shim returns the English
 *     fallback (else the key), preserving every i18n key + intent verbatim.
 *   - lucide-react `Gauge`/`TrendingUp`/`Calendar`/`BarChart3`/`AlertCircle`
 *     (web L3): DOM SVG icons → semantic emoji glyph constants (the
 *     DrivingPerformanceCards precedent) passed as the MetricCard string `icon`
 *     and the AlertBanner glyph.
 *   - `@/components/layout` PageContainer (web L5): no native parity port yet, so
 *     a minimal native-safe `PageContainer` is reproduced locally (title /
 *     subtitle / loading / error / actions / children — the props this page
 *     uses), gating children behind the loading spinner exactly as the web does.
 *   - `@/components/forms` VehicleSelect (web L6): the web `<Select>` dropdown →
 *     a native-safe Pressable chip selector wired to the same selected-vehicle
 *     state (renders nothing for an empty fleet, label = display_name || vin ||
 *     `Vehicle {id}`).
 *   - `@/components/ui` GlassPanel / DataTable / Column (web L7): native
 *     GlassPanel is the existing port; DataTable + the `Column<T>` type are
 *     reproduced locally as a native-safe table (header / rows / sortable
 *     columns / empty message / compact density / pagination — the props this
 *     page uses).
 *   - `@/components/data-display` MetricCard / DataFreshnessAuto (web L8):
 *     MetricCard is the already-ported web-parity component; DataFreshnessAuto +
 *     its DataFreshness body are reproduced locally as a native-safe freshness
 *     chip (fresh / fetching / stale / error, relative-time label, tap-to-refetch
 *     via query.refetch()).
 *   - `@/components/feedback` Skeleton / EmptyState / AlertBanner (web L9):
 *     native-safe local equivalents (a static placeholder block; a message-only
 *     empty state; a variant banner with a glyph slot). The web animate-pulse /
 *     animate-spin animations are static on native (visual-only, dropped).
 *   - `@/lib/errorMessage` getErrorMessage (web L10), `@/lib/dateFormat`
 *     formatDate (web L25), `@/lib/numberFormat` fmtNumber / fmtInt (web L26),
 *     `@/lib/unitConversion` convertDistanceFromSI (web L23), and `@/lib/cn` cn
 *     (web L27): ported verbatim into native-safe helpers. `cn`'s Tailwind grid
 *     string becomes a native StyleSheet 2-column grid, so the helper itself is
 *     not needed.
 *   - `@/components/motion` FadeIn (web L11): framer-motion entrance → a static
 *     passthrough View (the established Layout framer-motion → static precedent);
 *     the `delay` prop is accepted but inert.
 *   - `@/components/charts` ChartTooltip / AreaChart / Area / BarChart / Bar /
 *     XAxis / YAxis / CartesianGrid / Tooltip / ResponsiveContainer /
 *     AREA_DEFAULTS / areaGradient (web L12-17): imported from the native-safe
 *     web-parity charts barrel. Recharts has no React Native SVG backend, so the
 *     chart primitives render explicit "native chart unavailable" placeholders;
 *     the JSX structure, data wiring, and axis/series props are preserved 1:1.
 *   - `@/hooks/usePageTitle` (web L19): `document.title` is browser-only → a
 *     documented no-op (the native navigator owns the title).
 *   - `@/hooks/useSelectedVehicle` (web L20): the web hook layers react-router
 *     path/query params over a zustand store; native has neither, so a native-
 *     safe hook derives the selection from the ported `useVehicles()` list
 *     (local override state → first vehicle), preserving the `vehicleId` /
 *     `vehicles` / `setVehicleId` contract this page + VehicleSelect consume.
 *   - `@/hooks/useUnits` (web L22): reproduced as the DrivingPerformanceCards
 *     native-safe hook deriving `{distance}` from `useSettings().unit_of_length`.
 *   - `@/hooks/useChartPalette` (web L24): reproduced as a native-safe hook
 *     resolving `useSettings().chart_palette` to the CB-safe / neon arrays.
 *   - `@/features/onboarding/components/NoVehicleSelected` (web L21): reproduced
 *     locally (scaffold + GlassPanel + EmptyState); the web "Set up TeslaSync"
 *     navigate('/onboarding') CTA has no native router, so it is dropped.
 *   - `@/api/hooks/useAnalytics` useMileageStats / useMonthlyMileage /
 *     useDailyMileage (web L28-32): the already-ported native hooks, same
 *     `/mileage/{stats,daily,monthly}` paths + response shapes.
 */
import React, {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import {useMileageStats, useMonthlyMileage, useDailyMileage} from '../../../api/hooks/useAnalytics';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {
  AREA_DEFAULTS,
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  areaGradient,
} from '../../../components/charts';
import {MetricCard} from '../../../components/data-display/MetricCard';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MonthRow {
  month: string;
  distance: number;
  drives: number;
  dailyAvg: number;
}

/** Native-safe port of web/src/components/ui DataTable `Column<T>`. */
export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
}

type DistanceUnitPref = 'km' | 'mi';

/* ------------------------------------------------------------------ */
/*  lucide-react icon stand-ins (web L3)                               */
/* ------------------------------------------------------------------ */

const ICON_TOTAL_DISTANCE = '\uD83D\uDCCF'; // 📏 (Gauge)
const ICON_TOTAL_DRIVES = '\uD83D\uDCC8'; // 📈 (TrendingUp)
const ICON_DAILY_AVG = '\uD83D\uDCC5'; // 📅 (Calendar)
const ICON_ANNUAL = '\uD83D\uDCCA'; // 📊 (BarChart3)
const ICON_ALERT = '\u26A0'; // ⚠ (AlertCircle)
const ICON_NO_VEHICLE = '\uD83D\uDE97'; // 🚗 (Car)

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ------------------------------------------------------------------ */
/*  native-safe usePageTitle (web document.title is browser-only)      */
/* ------------------------------------------------------------------ */

function usePageTitle(_title: string): void {
  // The web hook writes document.title via titleStore; on native the navigator
  // owns the header title, so the resolved title is intentionally not applied.
}

/* ------------------------------------------------------------------ */
/*  ported lib helpers (web L23/L25/L26/L10)                           */
/* ------------------------------------------------------------------ */

/** 1 mile = 1609.344 m exactly (web/src/lib/unitConversion.ts). */
const METERS_PER_MILE = 1609.344;
/** 1 km = 1000 m exactly. */
const METERS_PER_KM = 1000;

/** convertDistanceFromSI — SI meters → display unit (web L23). */
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** fmtNumber — locale-aware, default precision 2 (web/src/lib/numberFormat.ts). */
function fmtNumber(v: unknown, decimals = 2): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toFixed(decimals);
  }
}

/** fmtInt — integer with locale separators (web L26). */
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/** formatDate — "Apr 4, 2026" else "—" (web/src/lib/dateFormat.ts formatDate). */
function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

/** getErrorMessage — normalise an unknown error (web/src/lib/errorMessage.ts). */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

/* ------------------------------------------------------------------ */
/*  native-safe useUnits (web L22 → useSettings derivation)            */
/* ------------------------------------------------------------------ */

interface UnitPrefs {
  distance: DistanceUnitPref;
}

function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  const unitOfLength = settings?.unit_of_length;
  return useMemo<{unitPrefs: UnitPrefs}>(
    () => ({unitPrefs: {distance: unitOfLength === 'mi' ? 'mi' : 'km'}}),
    [unitOfLength],
  );
}

/* ------------------------------------------------------------------ */
/*  native-safe useChartPalette (web L24 → useSettings derivation)     */
/* ------------------------------------------------------------------ */

// Okabe-Ito CB-safe palette (web/src/lib/colors.ts CHART_COLORS_CB_SAFE).
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

// Neon palette (web/src/lib/colors.ts CHART_COLORS_NEON).
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

function useChartPalette(): readonly string[] {
  const {data: settings} = useSettings();
  return settings?.chart_palette === 'neon'
    ? CHART_COLORS_NEON
    : CHART_COLORS_CB_SAFE;
}

/* ------------------------------------------------------------------ */
/*  native-safe useSelectedVehicle (web L20)                           */
/* ------------------------------------------------------------------ */

interface SelectedVehicleResult {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

// Module-level shared selection store. The web hook persists the picker choice
// in a zustand store so the header VehicleSelect and the page body stay in sync;
// native reproduces that single source of truth with a tiny external store
// (router path/query-param precedence is dropped — there is no native router).
let selectedVehicleOverride: number | null = null;
const selectedVehicleListeners = new Set<() => void>();

function getSelectedVehicleOverride(): number | null {
  return selectedVehicleOverride;
}

function subscribeSelectedVehicle(listener: () => void): () => void {
  selectedVehicleListeners.add(listener);
  return () => {
    selectedVehicleListeners.delete(listener);
  };
}

function setSelectedVehicleOverride(id: number | null): void {
  if (selectedVehicleOverride === id) {
    return;
  }
  selectedVehicleOverride = id;
  selectedVehicleListeners.forEach(listener => listener());
}

/**
 * The web hook layers react-router path/query params over a persisted zustand
 * store, then falls back to the first vehicle. Native has no router, so the
 * precedence collapses to: shared override store → first vehicle.
 */
function useSelectedVehicle(): SelectedVehicleResult {
  const {data} = useVehicles();
  const vehicles = data ?? [];
  const override = useSyncExternalStore(
    subscribeSelectedVehicle,
    getSelectedVehicleOverride,
    getSelectedVehicleOverride,
  );
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  const vehicleId = override ?? firstVehicleId;
  const setVehicleId = useCallback(
    (id: number | null) => setSelectedVehicleOverride(id),
    [],
  );
  return {vehicleId, vehicles, setVehicleId};
}

/* ------------------------------------------------------------------ */
/*  native FadeIn (web @/components/motion FadeIn)                      */
/* ------------------------------------------------------------------ */

function FadeIn({children}: {children: ReactNode; delay?: number}) {
  return <View>{children}</View>;
}

/* ------------------------------------------------------------------ */
/*  native Skeleton (web @/components/feedback Skeleton)                */
/* ------------------------------------------------------------------ */

function Skeleton({height = 16}: {height?: number}) {
  return <View style={[styles.skeleton, {height}]} />;
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)            */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  message: string;
  testID?: string;
}

function EmptyState({icon, title, message, testID}: EmptyStateProps) {
  return (
    <View style={styles.emptyState} testID={testID}>
      {icon ? <View style={styles.emptyStateIcon}>{icon}</View> : null}
      {title ? (
        <AppText style={styles.emptyStateTitle} weight="semibold">
          {title}
        </AppText>
      ) : null}
      <AppText style={styles.emptyStateMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native AlertBanner (web @/components/feedback AlertBanner)          */
/* ------------------------------------------------------------------ */

type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

const ALERT_VARIANT: Record<
  AlertVariant,
  {border: string; bg: string; text: string}
> = {
  info: {border: colors.borderAccent, bg: colors.accentSoft, text: colors.accent},
  success: {
    border: colors.successBorder,
    bg: colors.successSurface,
    text: colors.success,
  },
  warning: {
    border: colors.warningBorder,
    bg: colors.warningSurface,
    text: colors.warning,
  },
  danger: {
    border: colors.dangerBorder,
    bg: colors.dangerSurface,
    text: colors.danger,
  },
};

interface AlertBannerProps {
  variant: AlertVariant;
  icon?: ReactNode;
  children: ReactNode;
  testID?: string;
}

function AlertBanner({variant, icon, children, testID}: AlertBannerProps) {
  const v = ALERT_VARIANT[variant];
  return (
    <View
      style={[styles.alertBanner, {borderColor: v.border, backgroundColor: v.bg}]}
      testID={testID}>
      {icon ? (
        <View style={[styles.alertIcon]}>
          <AppText
            importantForAccessibility="no-hide-descendants"
            style={[styles.alertGlyph, {color: v.text}]}>
            {icon}
          </AppText>
        </View>
      ) : null}
      <View style={styles.alertBody}>
        <AppText style={[styles.alertText, {color: v.text}]} variant="caption">
          {children}
        </AppText>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native DataFreshnessAuto (web @/components/data-display)            */
/* ------------------------------------------------------------------ */

interface FreshnessQuery {
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => unknown;
}

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_COLOR: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  fetching: colors.accent,
  stale: colors.warning,
  error: colors.danger,
};

const FRESHNESS_GLYPH: Record<FreshnessStatus, string> = {
  fresh: '\u25CF', // ● Wifi
  fetching: '\u21BB', // ↻ RefreshCw
  stale: '\u25CF', // ● Wifi
  error: '\u2715', // ✕ WifiOff
};

function relativeFreshness(
  ms: number,
  t: NativeTFunction,
): string {
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

function DataFreshnessAuto({query}: {query: FreshnessQuery}) {
  const t = useNativeTranslation();
  const status: FreshnessStatus = query.isError
    ? 'error'
    : query.isFetching
      ? 'fetching'
      : query.isStale
        ? 'stale'
        : 'fresh';

  const color = FRESHNESS_COLOR[status];
  const updatedAt = query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null;
  const relativeTime =
    updatedAt && !query.isFetching
      ? relativeFreshness(updatedAt, t)
      : query.isFetching
        ? t('freshness.updating', 'updating…')
        : query.isError
          ? t('freshness.error', 'error')
          : '';

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => {
        if (!query.isFetching) {
          query.refetch();
        }
      }}
      style={styles.freshness}
      testID="data-freshness">
      <AppText
        importantForAccessibility="no-hide-descendants"
        style={[styles.freshnessGlyph, {color}]}>
        {FRESHNESS_GLYPH[status]}
      </AppText>
      <AppText style={[styles.freshnessText, {color}]}>{relativeTime}</AppText>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native VehicleSelect (web @/components/forms VehicleSelect)         */
/* ------------------------------------------------------------------ */

function VehicleSelect() {
  const {vehicleId, vehicles, setVehicleId} = useSelectedVehicle();

  if (vehicles.length === 0) {
    return null;
  }

  return (
    <View style={styles.vehicleSelect} testID="vehicle-select">
      {vehicles.map(v => {
        const active = v.id === vehicleId;
        const label = v.display_name || v.vin || `Vehicle ${v.id}`;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            hitSlop={4}
            key={v.id}
            onPress={() => setVehicleId(v.id)}
            style={[styles.vehicleChip, active && styles.vehicleChipActive]}>
            <AppText
              numberOfLines={1}
              style={[
                styles.vehicleChipText,
                active && styles.vehicleChipTextActive,
              ]}
              variant="caption">
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native PageContainer (web @/components/layout PageContainer)        */
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: Error | null;
  actions?: ReactNode;
  children: ReactNode;
  testID?: string;
}

function PageContainer({
  title,
  subtitle,
  loading,
  error,
  actions,
  children,
  testID,
}: PageContainerProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.scaffold}
      testID={testID ?? 'mileage-page'}>
      <View style={styles.scaffoldHeader}>
        <View style={styles.scaffoldHeaderText}>
          <AppText style={styles.scaffoldTitle} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.scaffoldSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.scaffoldActions}>{actions}</View> : null}
      </View>

      {loading ? (
        <View style={styles.loading} testID="mileage-loading">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.errorBox} testID="mileage-error">
          <AppText style={styles.errorText} variant="caption">
            {error.message}
          </AppText>
        </View>
      ) : (
        <View style={styles.scaffoldBody}>{children}</View>
      )}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  native DataTable (web @/components/ui DataTable)                    */
/* ------------------------------------------------------------------ */

interface DataTableProps<T> {
  tableId?: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  emptyMessage?: string;
  compact?: boolean;
  pagination?: boolean;
}

const PAGE_SIZE = 10;

function toComparable(node: ReactNode): number | string {
  const s = node == null ? '' : String(node);
  const stripped = s.replace(/[^0-9.\-]/g, '');
  const num = Number(stripped);
  if (stripped !== '' && Number.isFinite(num) && /[0-9]/.test(s)) {
    return num;
  }
  return s.toLowerCase();
}

function DataTable<T>({
  tableId,
  columns,
  data,
  keyExtractor,
  emptyMessage = 'No data',
  compact,
  pagination,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sortKey) {
      return data;
    }
    const col = columns.find(c => c.key === sortKey);
    if (!col) {
      return data;
    }
    const rows = [...data];
    rows.sort((a, b) => {
      const av = toComparable(col.render(a));
      const bv = toComparable(col.render(b));
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [data, columns, sortKey, sortDir]);

  const pageCount = pagination ? Math.max(1, Math.ceil(sorted.length / PAGE_SIZE)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visible = pagination
    ? sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
    : sorted;

  const onSort = useCallback(
    (key: string, sortable?: boolean) => {
      if (!sortable) {
        return;
      }
      if (sortKey === key) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('asc');
      }
      setPage(0);
    },
    [sortKey],
  );

  if (data.length === 0) {
    return (
      <View testID={tableId ? `${tableId}-empty` : 'datatable-empty'}>
        <EmptyState message={emptyMessage} />
      </View>
    );
  }

  return (
    <View testID={tableId ?? 'datatable'}>
      <View style={[styles.tableRow, styles.tableHeaderRow]}>
        {columns.map(col => {
          const isSorted = sortKey === col.key;
          const indicator = isSorted ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
          return (
            <Pressable
              accessibilityRole={col.sortable ? 'button' : 'text'}
              disabled={!col.sortable}
              key={col.key}
              onPress={() => onSort(col.key, col.sortable)}
              style={styles.tableCell}>
              <AppText
                numberOfLines={1}
                style={[styles.tableHeaderText, alignStyle(col.align)]}
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

      {visible.map(row => (
        <View
          key={String(keyExtractor(row))}
          style={[styles.tableRow, compact && styles.tableRowCompact]}>
          {columns.map(col => (
            <View key={col.key} style={styles.tableCell}>
              <AppText
                numberOfLines={1}
                style={[styles.tableCellText, alignStyle(col.align)]}
                variant="caption">
                {col.render(row)}
              </AppText>
            </View>
          ))}
        </View>
      ))}

      {pagination && pageCount > 1 ? (
        <View style={styles.pagination}>
          <Pressable
            accessibilityRole="button"
            disabled={safePage === 0}
            hitSlop={6}
            onPress={() => setPage(p => Math.max(0, p - 1))}
            style={[styles.pageButton, safePage === 0 && styles.pageButtonDisabled]}>
            <AppText style={styles.pageButtonText} variant="caption">
              ‹
            </AppText>
          </Pressable>
          <AppText style={styles.pageLabel} tone="muted" variant="caption">
            {`${safePage + 1} / ${pageCount}`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            disabled={safePage >= pageCount - 1}
            hitSlop={6}
            onPress={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            style={[
              styles.pageButton,
              safePage >= pageCount - 1 && styles.pageButtonDisabled,
            ]}>
            <AppText style={styles.pageButtonText} variant="caption">
              ›
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function alignStyle(align: Column<unknown>['align']): ViewStyle {
  if (align === 'right') {
    return {textAlign: 'right'} as ViewStyle;
  }
  if (align === 'center') {
    return {textAlign: 'center'} as ViewStyle;
  }
  return {textAlign: 'left'} as ViewStyle;
}

/* ------------------------------------------------------------------ */
/*  NoVehicleSelected (web @/features/onboarding/components)           */
/* ------------------------------------------------------------------ */

function NoVehicleSelected({pageTitle}: {pageTitle: string}) {
  const t = useNativeTranslation();
  return (
    <PageContainer testID="mileage-no-vehicle" title={pageTitle}>
      <GlassPanel style={styles.panel}>
        <EmptyState
          icon={
            <AppText
              importantForAccessibility="no-hide-descendants"
              style={styles.noVehicleGlyph}
              tone="muted">
              {ICON_NO_VEHICLE}
            </AppText>
          }
          message={t(
            'common.noVehicleSelected.desc',
            'Add a vehicle to your fleet to see data on this page.',
          )}
          testID="mileage-no-vehicle-empty"
          title={t('common.noVehicleSelected.title', 'No vehicle selected')}
        />
      </GlassPanel>
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MileagePage() {
  const t = useNativeTranslation();
  usePageTitle(t('mileage.title', 'Mileage'));

  const {unitPrefs} = useUnits();
  const distanceUnit = unitPrefs.distance;
  // Backend `/mileage/{stats,daily,monthly}` returns kilometres, while
  // `convertDistanceFromSI` expects meters — multiply km by 1000.
  const fromKm = useCallback(
    (km: number) => convertDistanceFromSI(km * 1000, distanceUnit),
    [distanceUnit],
  );

  // Reactive chart palette follows the active theme and color-vision settings.
  const palette = useChartPalette();

  // Header VehiclePicker is the source of truth.
  const {vehicleId} = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  const statsQuery = useMileageStats(activeId);
  const {data: stats, isLoading, error: statsError} = statsQuery;

  // 90 daily buckets matches the legacy `limit=90` query string the page
  // used before /mileage/daily was restored.
  const {data: dailyBuckets, error: dailyError} = useDailyMileage(activeId, 90);
  const dailyRows = useMemo(() => dailyBuckets ?? [], [dailyBuckets]);

  const {data: monthlyBuckets, error: monthlyError} = useMonthlyMileage(activeId);
  const monthlyData = useMemo(() => monthlyBuckets ?? [], [monthlyBuckets]);

  const anyError = [statsError, dailyError, monthlyError].find(Boolean);

  /* Summary metric derivations from /mileage/stats. The restored
     endpoint exposes lifetime + windowed rollups (lifetime_km,
     last_30d_km, drive_count_lifetime, …). Daily avg = last_30d_km / 30
     so it reflects recent activity rather than a lifetime-flat average
     that would understate current usage on long-tail histories. */
  const totalDistanceDisplay = fromKm(stats?.lifetime_km ?? 0);
  const totalDrives = stats?.drive_count_lifetime ?? 0;
  const dailyAvgKm = (stats?.last_30d_km ?? 0) / 30;
  const dailyAvgDisplay = fromKm(dailyAvgKm);
  const annualProjectionDisplay = fromKm(dailyAvgKm * 365);

  /* Odometer over time (area chart). Uses end_odometer_km — the
     absolute odometer reading at the end of the latest qualifying
     drive in each day. Days where every drive had a NULL odometer
     reading (rare; only on abnormally-ended drives) are filtered out
     so the line doesn't dive to zero. */
  const odometerData = useMemo(
    () =>
      dailyRows
        .filter(d => d.end_odometer_km != null)
        .map(d => ({
          date: formatDate(d.date),
          odometer: fromKm(d.end_odometer_km ?? 0),
        })),
    [dailyRows, fromKm],
  );

  const dailyData = useMemo(
    () =>
      dailyRows.map(d => ({
        date: formatDate(d.date),
        distance: fromKm(d.total_km ?? 0),
      })),
    [dailyRows, fromKm],
  );

  /* Monthly summary rows derive from /mileage/monthly which already
     groups per UTC calendar month. */
  const monthlyRows: MonthRow[] = useMemo(() => {
    return monthlyData.map(m => {
      const km = m.total_km ?? 0;
      const drives = m.drive_count ?? 0;
      return {
        month: m.year_month ?? '',
        distance: fromKm(km),
        drives,
        dailyAvg: drives > 0 ? fromKm(km / drives) : 0,
      };
    });
  }, [monthlyData, fromKm]);

  const monthColumns: Column<MonthRow>[] = useMemo(
    () => [
      {key: 'month', header: t('Month'), render: r => r.month, sortable: true},
      {
        key: 'distance',
        header: `${t('Distance')} (${distanceUnit})`,
        render: r => fmtNumber(r.distance),
        sortable: true,
        align: 'right',
      },
      {key: 'drives', header: t('Drives'), render: r => fmtInt(r.drives), sortable: true, align: 'right'},
      {
        key: 'dailyAvg',
        header: `${t('Distance per Drive')} (${distanceUnit})`,
        render: r => fmtNumber(r.dailyAvg),
        sortable: true,
        align: 'right',
      },
    ],
    [t, distanceUnit],
  );

  // Defensive guard: no vehicle selected.
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('mileage.title', 'Mileage')} />;
  }

  return (
    <PageContainer
      actions={
        <View style={styles.headerActions}>
          <VehicleSelect />
          <DataFreshnessAuto query={statsQuery} />
        </View>
      }
      error={null}
      loading={isLoading}
      subtitle={t('mileage.subtitle', 'Daily and monthly distance tracking')}
      title={t('mileage.title', 'Mileage')}>
      {anyError ? (
        <AlertBanner icon={ICON_ALERT} testID="mileage-alert" variant="danger">
          {`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(
            anyError,
          )}`}
        </AlertBanner>
      ) : null}

      {/* Summary metric cards */}
      <FadeIn>
        <View style={styles.metricGrid}>
          {isLoading
            ? Array.from({length: 4}).map((_, i) => (
                <View key={i} style={styles.metricCell}>
                  <Skeleton height={96} />
                </View>
              ))
            : (
              <>
                <View style={styles.metricCell}>
                  <MetricCard
                    color="cyan"
                    icon={ICON_TOTAL_DISTANCE}
                    label={t('mileage.totalDistance', 'Total Distance')}
                    value={`${fmtInt(totalDistanceDisplay)} ${distanceUnit}`}
                  />
                </View>
                <View style={styles.metricCell}>
                  <MetricCard
                    color="green"
                    icon={ICON_TOTAL_DRIVES}
                    label={t('mileage.totalDrives', 'Total Drives')}
                    value={fmtInt(totalDrives)}
                  />
                </View>
                <View style={styles.metricCell}>
                  <MetricCard
                    color="purple"
                    icon={ICON_DAILY_AVG}
                    label={t('mileage.dailyAvg', 'Daily Avg (30d)')}
                    value={`${fmtNumber(dailyAvgDisplay)} ${distanceUnit}`}
                  />
                </View>
                <View style={styles.metricCell}>
                  <MetricCard
                    color="cyan"
                    icon={ICON_ANNUAL}
                    label={t('mileage.annualProjection', 'Annual Projection')}
                    value={`${fmtInt(annualProjectionDisplay)} ${distanceUnit}`}
                  />
                </View>
              </>
            )}
        </View>
      </FadeIn>

      {/* Odometer over time */}
      <FadeIn delay={0.1}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.panelTitle} weight="semibold">
            {t('Odometer Over Time')}
          </AppText>
          {odometerData.length === 0 ? (
            // no-action: transient empty state — surfaces when source data is
            // missing; no specific recovery action available.
            <EmptyState message={t('No Entries')} testID="mileage-odometer-empty" />
          ) : (
            <ResponsiveContainer height={280} width="100%">
              <AreaChart data={odometerData}>
                {areaGradient('odoGrad', palette[2])}
                <CartesianGrid stroke={colors.border} strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{fontSize: 10, fill: colors.textMuted}} />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{fontSize: 10, fill: colors.textMuted}}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  {...AREA_DEFAULTS}
                  dataKey="odometer"
                  fill="url(#odoGrad)"
                  name={`${t('Odometer')} (${distanceUnit})`}
                  stroke={palette[2]}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Daily distance */}
      <FadeIn delay={0.2}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.panelTitle} weight="semibold">
            {t('Daily Distance')}
          </AppText>
          {dailyData.length === 0 ? (
            // no-action: transient empty state — surfaces when source data is
            // missing; no specific recovery action available.
            <EmptyState message={t('No Entries')} testID="mileage-daily-empty" />
          ) : (
            <ResponsiveContainer height={280} width="100%">
              <BarChart data={dailyData}>
                <CartesianGrid stroke={colors.border} strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{fontSize: 10, fill: colors.textMuted}} />
                <YAxis tick={{fontSize: 10, fill: colors.textMuted}} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="distance"
                  fill={palette[0]}
                  name={`${t('Distance')} (${distanceUnit})`}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Monthly summary table */}
      <FadeIn delay={0.3}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.panelTitle} weight="semibold">
            {t('Monthly Summary')}
          </AppText>
          <DataTable<MonthRow>
            columns={monthColumns}
            compact
            data={monthlyRows}
            emptyMessage={t('No Entries')}
            keyExtractor={r => r.month}
            pagination
            tableId="analytics:mileage-monthly"
          />
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  scaffold: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  scaffoldHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  scaffoldHeaderText: {
    flexShrink: 1,
    minWidth: 0,
  },
  scaffoldTitle: {
    letterSpacing: -0.5,
  },
  scaffoldSubtitle: {
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
  scaffoldActions: {
    flexShrink: 0,
  },
  scaffoldBody: {
    gap: spacing.lg,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    borderRadius: 12,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
    marginBottom: spacing.lg,
  },
  metricCell: {
    width: '48%',
  },
  panel: {
    padding: spacing.md,
    gap: spacing.md,
  },
  panelTitle: {
    fontSize: typography.body,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    width: '100%',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyStateIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateTitle: {
    color: colors.textPrimary,
  },
  emptyStateMessage: {
    textAlign: 'center',
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
  },
  alertIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertGlyph: {
    fontSize: 16,
    lineHeight: 20,
  },
  alertBody: {
    flex: 1,
    minWidth: 0,
  },
  alertText: {
    lineHeight: 18,
  },
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  freshnessGlyph: {
    fontSize: 10,
  },
  freshnessText: {
    fontSize: 10,
  },
  vehicleSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  vehicleChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  vehicleChipActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  vehicleChipText: {
    color: colors.textSecondary,
    maxWidth: 160,
  },
  vehicleChipTextActive: {
    color: colors.textPrimary,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  tableRowCompact: {
    paddingVertical: spacing.xs,
  },
  tableHeaderRow: {
    borderBottomWidth: 1,
  },
  tableCell: {
    flex: 1,
    minWidth: 0,
  },
  tableHeaderText: {
    letterSpacing: 0.4,
  },
  tableCellText: {
    color: colors.textPrimary,
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  pageButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pageButtonDisabled: {
    opacity: 0.4,
  },
  pageButtonText: {
    color: colors.textPrimary,
  },
  pageLabel: {
    minWidth: 48,
    textAlign: 'center',
  },
  noVehicleGlyph: {
    fontSize: 40,
    lineHeight: 46,
  },
});
