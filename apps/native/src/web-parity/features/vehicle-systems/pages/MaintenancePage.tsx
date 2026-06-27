// Native parity port of
// web/src/features/vehicle-systems/pages/MaintenancePage.tsx.
//
// MaintenancePage is the per-vehicle maintenance tracker: a summary metric row
// (Total / Due Soon / Overdue / Completed), an opt-in Helix predictive-
// maintenance card, a category-filter + status-sort toolbar with a "Schedule
// Maintenance" action, a grid of maintenance-item cards (category chip, status
// badge, progress bar, mileage/last-service footer), a two-up Cost Summary +
// Service Projections block, and a sortable + paginated Service Records table.
//
// The web original composes the shared DOM page kit (PageContainer, GlassPanel,
// Badge, Button, Select, DataTable + Column, MetricCard, Currency, Skeleton,
// EmptyState, AlertBanner, FadeIn, VehicleSelect), lucide SVG icons,
// react-i18next, the app-level useSelectedVehicle / useFormatting / usePageTitle
// hooks and the @/lib number/date/error formatters. React Native has no DOM,
// Tailwind, lucide, document.title or wired react-i18next, so — following the
// established self-contained page idiom (TirePressurePage, the sibling in this
// directory) — this port reproduces the page with RN primitives + the shared
// native parity building blocks and documents every adaptation in the sidecar:
//
//   - The CONVERTED native AIPredictiveMaintenance is imported (not re-inlined),
//     exactly as the web wires @/components/ai/...; vehicleId is passed through
//     verbatim (vehicleId ?? undefined).
//   - The two real data reads keep the web's inline useQuery + request calls so
//     the exact API paths (/maintenance and /maintenance/records), the
//     snake_case MaintenanceItem / ServiceRecord interfaces and the query keys
//     (['maintenance', vehicleId] / ['service-records', vehicleId]) are all
//     preserved. The paths intentionally carry no vehicle_id param, matching web.
//   - @/hooks/useSelectedVehicle has no native global selection context, so the
//     `vehicleId` name + `setVehicleId` setter are kept as local state seeded to
//     the first useVehicles() vehicle; the actions-row VehicleSelect becomes a
//     native pill group (the TirePressurePage idiom).
//   - @/hooks/useFormatting -> an inlined `useFormatting` deriving currencySymbol
//     (settings.currency_symbol, default '$') and userPrecision
//     (settings.decimal_precision, default 2) exactly as web, exposing the same
//     formatCurrency(amount, decimals?) contract; the data-display Currency
//     component is reproduced natively with the same symbol + em-dash fallback.
//   - usePageTitle (document.title) has no native analogue -> the same translated
//     title renders in the on-screen header.
//   - lucide icons map onto the shared native SemanticIcon glyph set
//     (Wrench->maintenance, AlertTriangle->warning, CheckCircle->success,
//     Clock->clock, ListChecks->fileText, CalendarPlus->calendarPlus,
//     Filter->filter, ArrowUpDown->arrowUpDown, Gauge->speed, DollarSign->
//     dollarSign, TrendingUp->trendUp, AlertCircle->alertCircle). lucide Tag has
//     no SemanticIcon analogue, so CategoryBadge keeps its category-tinted chip
//     (color + tinted surface) with a leading colored dot to carry the intent.
//   - Select -> a native pill group (PillSelect); Button -> a native Pressable
//     (PrimaryButton); DataTable + Column -> a native sortable + paginated table
//     (page size 25, the web DataTable default) driven by a verbatim local
//     useSortToggle; GlassPanel/Badge/MetricCard/Skeleton/AlertBanner/FadeIn are
//     reproduced with RN primitives.
//   - @/lib fmtNumber / formatDate / formatDateTime / getErrorMessage are inlined
//     verbatim in intent (safeNumber + en-US grouping; localized "MMM d, yyyy"
//     and "MMM d, yyyy, h:mm a" with the em-dash nullish fallback; Error.message
//     extraction).
//   - react-i18next useTranslation -> a native key/English-default `t` fallback
//     preserving every bare-key default verbatim at the call sites.
//
// State names (vehicleId, setVehicleId, items, records, loadingItems,
// loadingRecords, itemsError, recordsError, categoryFilter, sortBy, categories,
// categoryOptions, sortOptions, filteredItems, summary, serviceColumns,
// costStats, projections, handleSchedule, anyError, isLoading), every API path,
// the query keys, and the section order are preserved. No DOM, Recharts,
// Leaflet, framer-motion, lucide-react, or old web UI components are imported.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {AIPredictiveMaintenance} from '../../../components/ai/AIPredictiveMaintenance';

/* ─── i18n fallback ─────────────────────────────────────────────────────────
   react-i18next is not wired in native; i18next returns the supplied default
   (or the key itself when no default) when a translation is missing. The
   fallback keeps every bare-key label verbatim at the call sites. */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeT(): NativeTFunction {
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

/* ------------------------------------------------------------------ */
/*  Types (snake_case from backend)                                    */
/* ------------------------------------------------------------------ */

interface MaintenanceItem {
  id: number;
  vehicle_id: number;
  category: string;
  name: string;
  description: string;
  due_date: string | null;
  due_mileage: number | null;
  current_mileage: number;
  last_service_date: string | null;
  last_service_mileage: number | null;
  interval_months: number | null;
  interval_miles: number | null;
  status: 'good' | 'soon' | 'overdue' | 'completed';
  created_at: string;
}

interface ServiceRecord {
  id: number;
  vehicle_id: number;
  date: string;
  description: string;
  mileage: number;
  cost: number;
  provider: string;
  notes: string;
  created_at: string;
}

type MaintenanceStatus = 'good' | 'soon' | 'overdue' | 'completed';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORY_COLORS: Record<string, string> = {
  tires: 'cyan',
  brakes: 'red',
  battery: 'green',
  filters: 'amber',
  fluids: 'purple',
  wipers: 'cyan',
  alignment: 'amber',
  general: 'neutral',
};

const STATUS_BADGE_MAP: Record<
  MaintenanceStatus,
  {variant: BadgeVariant; label: string}
> = {
  good: {variant: 'success', label: 'Good'},
  soon: {variant: 'warning', label: 'Due Soon'},
  overdue: {variant: 'danger', label: 'Overdue'},
  completed: {variant: 'info', label: 'Completed'},
};

const STATUS_SORT_ORDER: Record<MaintenanceStatus, number> = {
  overdue: 0,
  soon: 1,
  good: 2,
  completed: 3,
};

const SORT_OPTIONS = [
  {value: 'status', label: 'Status'},
  {value: 'name', label: 'Name'},
  {value: 'due_date', label: 'Due Date'},
  {value: 'category', label: 'Category'},
];

/* ------------------------------------------------------------------ */
/*  Inlined number / date / error helpers (verbatim intent from        */
/*  @/lib/numberFormat, @/lib/dateFormat, @/lib/errorMessage)           */
/* ------------------------------------------------------------------ */

const FALLBACK = '\u2014';

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Mirrors web lib/numberFormat fmtNumber: safeNumber guard + en-US grouping +
// the global default precision of 2 (settings-driven precision is not wired
// natively; every call site here passes an explicit precision).
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

// Verbatim intent from web lib/dateFormat formatDate: ISO -> localized
// "MMM d, yyyy"; nullish/invalid -> the universal em-dash placeholder.
function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// Verbatim intent from web lib/dateFormat formatDateTime: ISO -> localized
// "MMM d, yyyy, h:mm a"; nullish/invalid -> the em-dash placeholder.
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// Verbatim from web lib/errorMessage getErrorMessage.
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
/*  Domain helpers (verbatim from the web source)                      */
/* ------------------------------------------------------------------ */

function computeProgress(item: MaintenanceItem): number {
  if (item.interval_miles && item.last_service_mileage != null) {
    const elapsed = item.current_mileage - item.last_service_mileage;
    return Math.min(100, Math.max(0, (elapsed / item.interval_miles) * 100));
  }
  if (item.interval_months && item.last_service_date) {
    const lastDate = new Date(item.last_service_date).getTime();
    const now = Date.now();
    const intervalMs = item.interval_months * 30.44 * 24 * 60 * 60 * 1000;
    const elapsed = now - lastDate;
    return Math.min(100, Math.max(0, (elapsed / intervalMs) * 100));
  }
  if (item.due_mileage) {
    const pct = (item.current_mileage / item.due_mileage) * 100;
    return Math.min(100, Math.max(0, pct));
  }
  return 0;
}

function statusFromPct(pct: number): MaintenanceStatus {
  if (pct >= 90) {
    return 'overdue';
  }
  if (pct >= 70) {
    return 'soon';
  }
  return 'good';
}

// Web returns the bg-neon-* utility class; native returns the equivalent token
// hex so the fill paints the same red/amber/green.
function progressBarColor(pct: number): string {
  if (pct >= 90) {
    return colors.danger;
  }
  if (pct >= 70) {
    return colors.warning;
  }
  return colors.success;
}

// Web categoryBgClass returns a bg/text utility pair; native resolves the same
// CATEGORY_COLORS name to a {color, surface} token pair for the chip.
function categoryTone(category: string): {color: string; surface: string} {
  const color = CATEGORY_COLORS[category] ?? 'neutral';
  const map: Record<string, {color: string; surface: string}> = {
    cyan: {color: colors.accent, surface: colors.accentSoft},
    red: {color: colors.danger, surface: colors.dangerSurface},
    green: {color: colors.success, surface: colors.successSurface},
    amber: {color: colors.warning, surface: colors.warningSurface},
    purple: {color: colors.violet, surface: colors.violetSurface},
    neutral: {color: colors.textSecondary, surface: colors.surfaceRaised},
  };
  return map[color] ?? map.neutral;
}

function sortItems(items: MaintenanceItem[], sortBy: string): MaintenanceItem[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    switch (sortBy) {
      case 'status':
        return STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status];
      case 'name':
        return a.name.localeCompare(b.name);
      case 'due_date': {
        const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        return da - db;
      }
      case 'category':
        return a.category.localeCompare(b.category);
      default:
        return 0;
    }
  });
  return sorted;
}

/* ------------------------------------------------------------------ */
/*  useFormatting + Currency (inlined from @/hooks/useFormatting +      */
/*  @/components/data-display/format/Currency)                          */
/* ------------------------------------------------------------------ */

interface UseFormattingResult {
  currencySymbol: string;
  formatCurrency: (amount: number, decimals?: number) => string;
}

function useFormatting(): UseFormattingResult {
  const {data: settings} = useSettings();

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

  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string => {
      const d = decimals ?? userPrecision;
      return `${currencySymbol}${fmtNumber(amount, d)}`;
    },
    [currencySymbol, userPrecision],
  );

  return useMemo(
    () => ({currencySymbol, formatCurrency}),
    [currencySymbol, formatCurrency],
  );
}

function Currency({
  value,
  precision = 2,
}: {
  value?: number | null;
  precision?: number;
}) {
  const {currencySymbol} = useFormatting();
  if (value == null || !Number.isFinite(value)) {
    return (
      <AppText numberOfLines={1} variant="caption">
        {FALLBACK}
      </AppText>
    );
  }
  return (
    <AppText numberOfLines={1} variant="caption">
      {`${currencySymbol}${fmtNumber(value, precision)}`}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  Native UI building blocks (GlassPanel kit reproductions)           */
/* ------------------------------------------------------------------ */

const BADGE_TONES: Record<
  BadgeVariant,
  {color: string; border: string; surface: string}
> = {
  success: {
    border: colors.successBorder,
    color: colors.success,
    surface: colors.successSurface,
  },
  warning: {
    border: colors.warningBorder,
    color: colors.warning,
    surface: colors.warningSurface,
  },
  danger: {
    border: colors.dangerBorder,
    color: colors.danger,
    surface: colors.dangerSurface,
  },
  info: {
    border: colors.borderAccent,
    color: colors.accent,
    surface: colors.accentSoft,
  },
};

function Badge({
  variant,
  children,
  size,
}: {
  variant: BadgeVariant;
  children: React.ReactNode;
  size?: 'sm';
}) {
  const tone = BADGE_TONES[variant];
  return (
    <View
      style={[
        styles.badge,
        {backgroundColor: tone.surface, borderColor: tone.border},
        size === 'sm' ? styles.badgeSm : null,
      ]}>
      <AppText
        numberOfLines={1}
        style={{color: tone.color}}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

type MetricColor = 'cyan' | 'green' | 'amber' | 'red' | 'purple';

const METRIC_COLORS: Record<MetricColor, string> = {
  amber: colors.warning,
  cyan: colors.accent,
  green: colors.success,
  purple: colors.violet,
  red: colors.danger,
};

function MetricCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon?: SemanticIconName;
  color: MetricColor;
}) {
  return (
    <GlassPanel style={styles.metricCard}>
      <View style={styles.metricHeader}>
        {icon ? <SemanticIcon name={icon} size="sm" /> : null}
        <AppText
          numberOfLines={1}
          style={styles.metricLabel}
          tone="muted"
          variant="caption"
          weight="semibold">
          {label}
        </AppText>
      </View>
      <AppText
        numberOfLines={1}
        style={[styles.metricValue, {color: METRIC_COLORS[color]}]}
        variant="title"
        weight="bold">
        {value}
      </AppText>
    </GlassPanel>
  );
}

function Skeleton({height}: {height: number}) {
  return <View style={[styles.skeleton, {height}]} />;
}

function AlertBanner({
  variant,
  icon,
  children,
}: {
  variant: BadgeVariant;
  icon: SemanticIconName;
  children: React.ReactNode;
}) {
  const tone = BADGE_TONES[variant];
  return (
    <View
      style={[
        styles.alertBanner,
        {backgroundColor: tone.surface, borderColor: tone.border},
      ]}>
      <SemanticIcon name={icon} size="sm" />
      <AppText
        style={[styles.alertText, {color: tone.color}]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// Presentation-only entrance animation on web; rendered statically on native
// (no native FadeIn). `delay` is accepted for source parity but is a no-op.
function FadeIn({children}: {children: React.ReactNode; delay?: number}) {
  return <View style={styles.fadeIn}>{children}</View>;
}

function ProgressBar({pct}: {pct: number}) {
  const width = `${Math.min(pct, 100)}%` as DimensionValue;
  return (
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          {backgroundColor: progressBarColor(pct), width},
        ]}
      />
    </View>
  );
}

function CategoryBadge({category}: {category: string}) {
  const tone = categoryTone(category);
  const label = category.charAt(0).toUpperCase() + category.slice(1);
  return (
    <View style={[styles.categoryChip, {backgroundColor: tone.surface}]}>
      <View style={[styles.categoryDot, {backgroundColor: tone.color}]} />
      <AppText
        numberOfLines={1}
        style={{color: tone.color}}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Select / Button / VehicleSelect (native pill + pressable controls) */
/* ------------------------------------------------------------------ */

interface PillOption {
  value: string;
  label: string;
}

function PillSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: PillOption[];
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.pillRow}>
      {options.map(opt => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{selected}}
            onPress={() => onChange(opt.value)}
            style={[styles.pill, selected ? styles.pillSelected : null]}>
            <AppText
              numberOfLines={1}
              tone={selected ? 'accent' : 'secondary'}
              variant="caption">
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function PrimaryButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: SemanticIconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.primaryButton}>
      <SemanticIcon name={icon} size="sm" />
      <AppText style={styles.primaryButtonLabel} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

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
    <View style={styles.pillRow}>
      {options.map(opt => {
        const selected = opt.id === value;
        return (
          <Pressable
            key={opt.id}
            accessibilityRole="button"
            accessibilityState={{selected}}
            onPress={() => onChange(opt.id)}
            style={[styles.pill, selected ? styles.pillSelected : null]}>
            <AppText
              numberOfLines={1}
              tone={selected ? 'accent' : 'secondary'}
              variant="caption">
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  MaintenanceItemCard                                                */
/* ------------------------------------------------------------------ */

function MaintenanceItemCard({
  item,
  t,
}: {
  item: MaintenanceItem;
  t: NativeTFunction;
}) {
  const pct = computeProgress(item);
  const derivedStatus =
    item.status === 'completed' ? 'completed' : statusFromPct(pct);
  const badge = STATUS_BADGE_MAP[derivedStatus];

  let dueLabel = '';
  if (item.due_date) {
    dueLabel = `${t('Due')}: ${formatDate(item.due_date)}`;
  } else if (item.due_mileage) {
    dueLabel = `${t('Due')}: ${fmtNumber(item.due_mileage, 0)} ${t('mi')}`;
  }

  return (
    <GlassPanel style={styles.itemCard}>
      <View style={styles.itemTags}>
        <CategoryBadge category={item.category} />
        <Badge size="sm" variant={badge.variant}>
          {t(badge.label)}
        </Badge>
      </View>

      <AppText numberOfLines={1} variant="caption" weight="semibold">
        {item.name}
      </AppText>
      <AppText numberOfLines={2} tone="muted" variant="caption">
        {item.description}
      </AppText>

      {derivedStatus !== 'completed' ? (
        <View style={styles.progressSection}>
          <View style={styles.progressLabels}>
            <AppText tone="muted" variant="caption">
              {`${fmtNumber(pct, 0)}%`}
            </AppText>
            <AppText numberOfLines={1} tone="muted" variant="caption">
              {dueLabel}
            </AppText>
          </View>
          <ProgressBar pct={pct} />
        </View>
      ) : null}

      <View style={styles.itemFooter}>
        {item.current_mileage > 0 ? (
          <View style={styles.itemFooterItem}>
            <SemanticIcon name="speed" size="sm" />
            <AppText tone="secondary" variant="caption">
              {`${fmtNumber(item.current_mileage, 0)} ${t('mi')}`}
            </AppText>
          </View>
        ) : null}
        {item.last_service_date ? (
          <View style={styles.itemFooterItem}>
            <SemanticIcon name="clock" size="sm" />
            <AppText tone="secondary" variant="caption">
              {formatDate(item.last_service_date)}
            </AppText>
          </View>
        ) : null}
      </View>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading skeletons                                                  */
/* ------------------------------------------------------------------ */

function SummarySkeleton() {
  return (
    <View style={styles.metricGrid}>
      {[1, 2, 3, 4].map(i => (
        <View key={i} style={styles.metricCard}>
          <Skeleton height={72} />
        </View>
      ))}
    </View>
  );
}

function ItemsSkeleton() {
  return (
    <View style={styles.itemGrid}>
      {[1, 2, 3, 4, 5, 6].map(i => (
        <Skeleton key={i} height={140} />
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Service Records: useSortToggle + native DataTable                  */
/* ------------------------------------------------------------------ */

interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
  sortValue?: (row: T) => number | string;
}

// Verbatim toggle semantics from the web DataTable: clicking a column sorts
// desc, clicking the active column flips direction.
function useSortToggle(defaultKey = '', defaultDir: 'asc' | 'desc' = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultDir);

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
    <T,>(data: T[], accessor: (row: T) => number | string) => {
      if (!sortKey) {
        return data;
      }
      return [...data].sort((a, b) => {
        const av = accessor(a);
        const bv = accessor(b);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    },
    [sortKey, sortDir],
  );

  return {onSort, sortDir, sortFn, sortKey};
}

const TABLE_PAGE_SIZE = 25; // web DataTable defaultPageSize

function renderCell(content: React.ReactNode): React.ReactNode {
  if (typeof content === 'string' || typeof content === 'number') {
    return (
      <AppText numberOfLines={1} variant="caption">
        {content}
      </AppText>
    );
  }
  return content;
}

function DataTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage,
}: {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => number | string;
  emptyMessage: string;
}) {
  const {sortKey, sortDir, onSort, sortFn} = useSortToggle('', 'desc');
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const col = columns.find(c => c.key === sortKey);
    if (!col?.sortValue) {
      return data;
    }
    const accessor = col.sortValue;
    return sortFn(data, row => accessor(row));
  }, [columns, data, sortFn, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / TABLE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice(
    (safePage - 1) * TABLE_PAGE_SIZE,
    safePage * TABLE_PAGE_SIZE,
  );

  if (data.length === 0) {
    return <EmptyState message={emptyMessage} title={emptyMessage} />;
  }

  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        {columns.map(col => {
          const active = !!col.sortable && sortKey === col.key;
          const indicator = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
          return (
            <Pressable
              key={col.key}
              accessibilityRole={col.sortable ? 'button' : undefined}
              disabled={!col.sortable}
              onPress={col.sortable ? () => onSort(col.key) : undefined}
              style={styles.tableCell}>
              <AppText
                numberOfLines={1}
                tone={active ? 'accent' : 'muted'}
                variant="caption"
                weight="semibold">
                {col.header}
                {indicator}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {pageRows.map(row => (
        <View key={keyExtractor(row)} style={styles.tableRow}>
          {columns.map(col => (
            <View key={col.key} style={styles.tableCell}>
              {renderCell(col.render(row))}
            </View>
          ))}
        </View>
      ))}

      {totalPages > 1 ? (
        <View style={styles.pagination}>
          <Pressable
            accessibilityRole="button"
            disabled={safePage <= 1}
            onPress={() => setPage(p => Math.max(1, p - 1))}
            style={[styles.pill, safePage <= 1 ? styles.pillDisabled : null]}>
            <AppText tone="secondary" variant="caption">
              Prev
            </AppText>
          </Pressable>
          <AppText tone="muted" variant="caption">
            {`Page ${safePage} of ${totalPages}`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            disabled={safePage >= totalPages}
            onPress={() => setPage(p => Math.min(totalPages, p + 1))}
            style={[
              styles.pill,
              safePage >= totalPages ? styles.pillDisabled : null,
            ]}>
            <AppText tone="secondary" variant="caption">
              Next
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function buildServiceColumns(
  t: NativeTFunction,
): Column<ServiceRecord>[] {
  return [
    {
      key: 'date',
      header: t('Date'),
      sortable: true,
      sortValue: r => r.date ?? '',
      render: r => formatDateTime(r.date),
    },
    {
      key: 'description',
      header: t('Description'),
      render: r => r.description,
    },
    {
      key: 'mileage',
      header: t('Mileage'),
      sortable: true,
      sortValue: r => r.mileage ?? 0,
      render: r => `${fmtNumber(r.mileage, 0)} ${t('mi')}`,
    },
    {
      key: 'cost',
      header: t('Cost'),
      sortable: true,
      sortValue: r => r.cost ?? 0,
      render: r => <Currency value={r.cost} />,
    },
    {
      key: 'provider',
      header: t('Provider'),
      render: r => r.provider || FALLBACK,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function MaintenancePage() {
  const t = useNativeT();
  // usePageTitle(t('Maintenance')) sets document.title on web; no native
  // analogue, so the same translated title renders in the on-screen header.
  const {formatCurrency} = useFormatting();

  // useSelectedVehicle (global) -> local state seeded to the first vehicle.
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

  // Data fetching — API paths + query keys preserved verbatim (no vehicle_id
  // param, matching web; the key carries vehicleId for cache scoping).
  const {
    data: items,
    isLoading: loadingItems,
    error: itemsError,
  } = useQuery({
    queryKey: ['maintenance', vehicleId],
    queryFn: () => request<MaintenanceItem[]>('/maintenance'),
    enabled: vehicleId !== null,
  });

  const {
    data: records,
    isLoading: loadingRecords,
    error: recordsError,
  } = useQuery({
    queryKey: ['service-records', vehicleId],
    queryFn: () => request<ServiceRecord[]>('/maintenance/records'),
    enabled: vehicleId !== null,
  });

  // Filters & sorting
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('status');

  const categories = useMemo(() => {
    if (!items) {
      return [];
    }
    return Array.from(new Set(items.map(i => i.category))).sort();
  }, [items]);

  const categoryOptions = useMemo<PillOption[]>(
    () => [
      {value: 'all', label: t('All Categories')},
      ...categories.map(c => ({
        value: c,
        label: c.charAt(0).toUpperCase() + c.slice(1),
      })),
    ],
    [categories, t],
  );

  const sortOptions = useMemo<PillOption[]>(
    () => SORT_OPTIONS.map(o => ({value: o.value, label: t(o.label)})),
    [t],
  );

  const filteredItems = useMemo(() => {
    if (!items) {
      return [];
    }
    let result = items;
    if (categoryFilter !== 'all') {
      result = result.filter(i => i.category === categoryFilter);
    }
    return sortItems(result, sortBy);
  }, [items, categoryFilter, sortBy]);

  const summary = useMemo(() => {
    if (!items) {
      return {total: 0, soon: 0, overdue: 0, completed: 0};
    }
    return items.reduce(
      (acc, item) => {
        acc.total++;
        if (item.status === 'soon') {
          acc.soon++;
        } else if (item.status === 'overdue') {
          acc.overdue++;
        } else if (item.status === 'completed') {
          acc.completed++;
        }
        return acc;
      },
      {total: 0, soon: 0, overdue: 0, completed: 0},
    );
  }, [items]);

  const serviceColumns = useMemo(() => buildServiceColumns(t), [t]);

  // Cost summary from service records.
  const costStats = useMemo(() => {
    if (!records || records.length === 0) {
      return null;
    }
    const totalCost = records.reduce((s, r) => s + (r.cost ?? 0), 0);
    const dates = records
      .map(r => new Date(r.date).getTime())
      .filter(d => !isNaN(d));
    if (dates.length < 2) {
      return {
        totalCost,
        annualCost: totalCost,
        avgPerService: totalCost / records.length,
      };
    }
    const spanYears = Math.max(
      (Math.max(...dates) - Math.min(...dates)) / (365.25 * 24 * 3600000),
      0.1,
    );
    return {
      totalCost,
      annualCost: totalCost / spanYears,
      avgPerService: totalCost / records.length,
    };
  }, [records]);

  // Service projections.
  const projections = useMemo(() => {
    if (!items || items.length === 0) {
      return [];
    }
    return items
      .filter(i => i.status !== 'completed' && (i.interval_miles || i.interval_months))
      .map(item => {
        const milesRemaining =
          item.due_mileage != null
            ? Math.max(item.due_mileage - item.current_mileage, 0)
            : null;
        const dueDate = item.due_date ? formatDate(item.due_date) : null;
        return {
          name: item.name,
          category: item.category,
          milesRemaining,
          dueDate,
          status: item.status,
        };
      })
      .sort((a, b) => {
        if (a.status === 'overdue' && b.status !== 'overdue') {
          return -1;
        }
        if (b.status === 'overdue' && a.status !== 'overdue') {
          return 1;
        }
        return (a.milesRemaining ?? Infinity) - (b.milesRemaining ?? Infinity);
      })
      .slice(0, 8);
  }, [items]);

  const handleSchedule = useCallback(() => {
    // placeholder — would open scheduling modal
  }, []);

  const anyError = [itemsError, recordsError].find(Boolean);
  const isLoading = loadingItems || loadingRecords;

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      testID="maintenance-page">
      <View style={styles.header}>
        <AppText variant="title" weight="bold">
          {t('Maintenance')}
        </AppText>
        <AppText tone="muted">
          {t('Service schedule, records, and upcoming maintenance')}
        </AppText>
        <View style={styles.actions}>
          <VehicleSelect
            onChange={setVehicleId}
            options={vehicleOptions}
            value={vehicleId}
          />
        </View>
      </View>

      {isLoading && !items ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}

      {anyError ? (
        <AlertBanner icon="alertCircle" variant="danger">
          {`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(
            anyError,
          )}`}
        </AlertBanner>
      ) : null}

      <View style={styles.sections}>
        {/* Summary metric cards */}
        <FadeIn>
          {loadingItems && !items ? (
            <SummarySkeleton />
          ) : (
            <View style={styles.metricGrid}>
              <MetricCard
                color="cyan"
                icon="fileText"
                label={t('Total Items')}
                value={summary.total}
              />
              <MetricCard
                color="amber"
                icon="clock"
                label={t('Due Soon')}
                value={summary.soon}
              />
              <MetricCard
                color="red"
                icon="warning"
                label={t('Overdue')}
                value={summary.overdue}
              />
              <MetricCard
                color="green"
                icon="success"
                label={t('Completed')}
                value={summary.completed}
              />
            </View>
          )}
        </FadeIn>

        {/* Helix Predictive Maintenance (opt-in AI). withAiFeature returns null
            when ai_mode='off' OR the predictive-maintenance toggle is off; the
            deterministic reminders above remain the canonical baseline. */}
        <FadeIn delay={0.03}>
          <AIPredictiveMaintenance vehicleId={vehicleId ?? undefined} />
        </FadeIn>

        {/* Filter / Sort toolbar */}
        <FadeIn delay={0.05}>
          <View style={styles.toolbar}>
            <View style={styles.toolbarGroup}>
              <SemanticIcon name="filter" size="sm" />
              <PillSelect
                onChange={setCategoryFilter}
                options={categoryOptions}
                value={categoryFilter}
              />
            </View>
            <View style={styles.toolbarGroup}>
              <SemanticIcon name="arrowUpDown" size="sm" />
              <PillSelect
                onChange={setSortBy}
                options={sortOptions}
                value={sortBy}
              />
            </View>
            <View style={styles.toolbarAction}>
              <PrimaryButton
                icon="calendarPlus"
                label={t('Schedule Maintenance')}
                onPress={handleSchedule}
              />
            </View>
          </View>
        </FadeIn>

        {/* Maintenance items grid */}
        <FadeIn delay={0.1}>
          {loadingItems && !items ? (
            <ItemsSkeleton />
          ) : filteredItems.length === 0 ? (
            <EmptyState
              message={
                categoryFilter !== 'all'
                  ? t('No items match the selected category. Try a different filter.')
                  : t('No maintenance items found for this vehicle.')
              }
              title={t('No maintenance items')}
            />
          ) : (
            <View style={styles.itemGrid}>
              {filteredItems.map(item => (
                <MaintenanceItemCard key={item.id} item={item} t={t} />
              ))}
            </View>
          )}
        </FadeIn>

        {/* Cost Summary & Service Projections */}
        <FadeIn delay={0.15}>
          <View style={styles.twoColumn}>
            {/* Estimated Annual Cost */}
            <GlassPanel style={styles.panel}>
              <View style={styles.panelHeading}>
                <SemanticIcon name="dollarSign" size="sm" />
                <AppText variant="caption" weight="semibold">
                  {t('Estimated Annual Cost')}
                </AppText>
              </View>
              {loadingRecords && !records ? (
                <Skeleton height={80} />
              ) : costStats ? (
                <View style={styles.costBody}>
                  <View style={styles.costMetricRow}>
                    <MetricCard
                      color="green"
                      label={t('Total Spent')}
                      value={formatCurrency(costStats.totalCost, 0)}
                    />
                    <MetricCard
                      color="cyan"
                      label={t('Annual Est.')}
                      value={`${formatCurrency(costStats.annualCost, 0)}/yr`}
                    />
                    <MetricCard
                      color="purple"
                      label={t('Avg / Service')}
                      value={formatCurrency(costStats.avgPerService, 0)}
                    />
                  </View>
                  <View style={styles.costNote}>
                    <AppText style={styles.costNoteText} variant="caption">
                      {t(
                        'EV maintenance is typically 40-60% cheaper than a comparable gas vehicle.',
                      )}
                    </AppText>
                  </View>
                </View>
              ) : (
                <EmptyState
                  message={t(
                    'No cost data available yet. Log service records to see cost estimates.',
                  )}
                  title={t('No cost data')}
                />
              )}
            </GlassPanel>

            {/* Service Projections */}
            <GlassPanel style={styles.panel}>
              <View style={styles.panelHeading}>
                <SemanticIcon name="trendUp" size="sm" />
                <AppText variant="caption" weight="semibold">
                  {t('Service Projections')}
                </AppText>
              </View>
              {loadingItems && !items ? (
                <Skeleton height={80} />
              ) : projections.length > 0 ? (
                <View style={styles.projectionList}>
                  {projections.map(p => {
                    const badge =
                      STATUS_BADGE_MAP[p.status] ?? STATUS_BADGE_MAP.good;
                    return (
                      <View key={p.name} style={styles.projectionRow}>
                        <View style={styles.projectionName}>
                          <SemanticIcon name="maintenance" size="sm" />
                          <AppText
                            numberOfLines={1}
                            tone="secondary"
                            variant="caption">
                            {p.name}
                          </AppText>
                        </View>
                        <View style={styles.projectionMeta}>
                          {p.milesRemaining != null ? (
                            <AppText tone="muted" variant="caption">
                              {`${fmtNumber(p.milesRemaining, 0)} mi`}
                            </AppText>
                          ) : null}
                          {p.dueDate ? (
                            <AppText tone="muted" variant="caption">
                              {p.dueDate}
                            </AppText>
                          ) : null}
                          <Badge size="sm" variant={badge.variant}>
                            {t(badge.label)}
                          </Badge>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <EmptyState
                  message={t('No upcoming service projections available.')}
                  title={t('No projections')}
                />
              )}
            </GlassPanel>
          </View>
        </FadeIn>

        {/* Service records table */}
        <FadeIn delay={0.2}>
          <GlassPanel style={styles.panel}>
            <AppText
              style={styles.recordsTitle}
              variant="caption"
              weight="semibold">
              {t('Service Records')}
            </AppText>

            {loadingRecords && !records ? (
              <View style={styles.recordsSkeletonList}>
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} height={48} />
                ))}
              </View>
            ) : !records?.length ? (
              <EmptyState
                message={t('No service records logged yet.')}
                title={t('No service records')}
              />
            ) : (
              <DataTable<ServiceRecord>
                columns={serviceColumns}
                data={records}
                emptyMessage={t('No service records found.')}
                keyExtractor={r => r.id}
              />
            )}
          </GlassPanel>
        </FadeIn>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  alertBanner: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  alertText: {
    flex: 1,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  badgeSm: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  categoryChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  categoryDot: {
    borderRadius: 999,
    height: 6,
    width: 6,
  },
  costBody: {
    gap: spacing.md,
  },
  costMetricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  costNote: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  costNoteText: {
    color: colors.success,
  },
  fadeIn: {
    width: '100%',
  },
  header: {
    gap: spacing.xs,
  },
  itemCard: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  itemFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  itemFooterItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  itemGrid: {
    gap: spacing.md,
  },
  itemTags: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  metricCard: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 140,
    padding: spacing.md,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  metricLabel: {
    flex: 1,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  metricValue: {
    marginTop: spacing.xs,
  },
  pagination: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  panel: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
  panelHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  pill: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pillDisabled: {
    opacity: 0.4,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pillSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderWidth: 1,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  primaryButtonLabel: {
    color: colors.accent,
  },
  progressFill: {
    borderRadius: 999,
    height: '100%',
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  progressSection: {
    gap: spacing.xs,
  },
  progressTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
    width: '100%',
  },
  projectionList: {
    gap: spacing.sm,
  },
  projectionMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  projectionName: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  projectionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  recordsSkeletonList: {
    gap: spacing.sm,
  },
  recordsTitle: {
    marginBottom: spacing.xs,
  },
  scrollContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  sections: {
    gap: spacing.lg,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    width: '100%',
  },
  table: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  tableCell: {
    flex: 1,
  },
  tableHeaderRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  tableRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  toolbarAction: {
    marginLeft: 'auto',
  },
  toolbarGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  twoColumn: {
    gap: spacing.md,
  },
});
