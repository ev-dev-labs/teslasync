// Native parity port of web/src/features/system/pages/DBHealthPage.tsx.
//
// DB Health dashboard for admin observability: total database size, table
// count, large-table (>100MB) count, current migration version, a Top-15
// table-sizes bar chart (sorted by row count), a sortable table list
// (size/rows/name) and a sidebar with migration status + connection-pool
// telemetry. Backed by GET /dev-tools/db-stats, /dev-tools/migration-status
// and /dev-tools/runtime-info via useDBStats / useMigrations /
// useConnectionPool.
//
// Every web behavior + state name is preserved (the `sortKey` state, the three
// admin queries with their `isLoading`/`isFetching`/`error` flags, the
// `queryError = statsError ?? migrationError` union, `tables`, the
// `sortedTables` + `chartData` useMemos, the `migrationVersion` field-name
// fallback cast, `migrationDirty`/`migrationPending`/`migrations`, the
// `poolUsage` clamp, `largeTables` count, `dbSizeDisplay`, the five
// `tableColumns`, and every loading/empty branch). The web DOM/Tailwind stack
// is replaced with React Native primitives + the native parity component
// library:
//
//   - `@/components/layout` PageContainer (title/subtitle/loading/actions) has
//     no native parity component, so a local screen scaffold reproduces the
//     header (title + subtitle), the page-level boundary via the native
//     ErrorBoundary, and the `actions` auto-refresh indicator via a local
//     RefreshIndicator (a reduced-motion-aware spinning glyph + the preserved
//     "Auto-refresh 30s" copy). The `loading` full-page gate is expressed
//     through per-section loading states (StatCard loading, chart skeleton,
//     table skeleton, sidebar skeletons) — the DiskForecast/SlowQueries
//     precedent.
//   - `@/components/layout` Grid becomes a flex-wrap 2-column summary grid.
//   - `@/components/ui` GlassPanel reuses the native parity GlassPanel
//     (`padding="lg"` = web `p-5`-ish 24px).
//   - `@/components/ui` Button (sort controls) becomes a compact local
//     SortButton (Pressable) preserving the active/idle (primary/secondary)
//     variant mapping.
//   - `@/components/ui` DataTable/Column (a browser <table>) becomes a native
//     header row + data rows inside a horizontal ScrollView so every column
//     stays usable on a phone, preserving each column's `className` align +
//     `render` config, the `keyExtractor` (row key = table name) and the
//     `emptyMessage`. Web `pagination` + `max-h-[50vh]` collapse into the page
//     scroll (no native paginator); all sorted rows render.
//   - `@/components/charts` ChartContainer + Recharts BarChart become a local
//     horizontal bar chart (label + proportional fill + fmtInt value), an
//     accessible summary role, the preserved chart title + aria label, the
//     Table/Rows column captions and the "Rows" series legend, plus a
//     reduced-motion skeleton for the `loading` state.
//   - `@/components/data-display` StatCard reuses the already-ported native
//     parity component; the lucide Database/AlertTriangle/CheckCircle glyphs
//     map to the native SemanticIcon (database/warning/success).
//   - `@/components/data-display` TimeStamp (a tooltip'd auto/relative renderer)
//     becomes an inlined formatRelative string (the IngestXRay precedent); the
//     hover tooltip has no native analog.
//   - `@/components/feedback` Skeleton becomes a local reduced-motion pulse
//     block; EmptyState reuses the native parity component (which requires a
//     title, so a concise title key accompanies each preserved message);
//     AlertBanner variant="danger" becomes a local DangerBanner.
//   - `@/components/motion` FadeIn becomes a reduced-motion-aware mount fade
//     that honours the web `delay` prop.
//   - `@/lib/numberFormat` fmtNumber/fmtInt and the page-local formatBytes are
//     inlined native-safe (locale precision defaults to the web global 2; GB at
//     2 decimals exactly as the web source).
//   - `@/lib/cn` (clsx) is dropped — native uses StyleSheet arrays.
//   - `@/hooks/usePageTitle` (sets document.title) is a native no-op shim — RN
//     has no document — but the `t()` title call is preserved.
//   - react-i18next useTranslation becomes a local fallback shim so every
//     `dbHealth.*` key + English copy is preserved verbatim.

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
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {
  useConnectionPool,
  useDBStats,
  useMigrations,
  type TableInfo,
} from '../../../api/hooks/useAdmin';
import {StatCard} from '../../../components/data-display/StatCard';
import {ErrorBoundary} from '../../../components/feedback/ErrorBoundary';
import {GlassPanel} from '../../../components/ui/GlassPanel';

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type TranslationVars = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: TranslationVars) => {
    if (vars == null) {
      return fallback;
    }
    return fallback.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
    );
  }, []);
}

/* ─── usePageTitle (web sets document.title; native has no document) ────────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── native-safe number formatting (web `@/lib/numberFormat`) ─────────────── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2, locale = 'en-US'): string {
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// Page-local byte formatter (web DBHealthPage L24-29). Binary units; GB at 2
// decimals exactly as the web source (distinct from the lib formatBytes).
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Web `<TimeStamp value={…} />` (default auto/relative + hover tooltip) -> a
// static relative string. The tooltip alternate has no native analog.
function formatRelative(value: string | null | undefined): string {
  if (!value) {
    return '\u2014';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '\u2014';
  }
  const diff = Date.now() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ─── reduced-motion + animation helpers (web `@/components/motion`) ────────── */

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

function useLoopingPulse(reduceMotion: boolean): Animated.Value {
  const pulse = useRef(new Animated.Value(0)).current;
  const reset = useCallback(() => pulse.setValue(0), [pulse]);

  useEffect(() => {
    if (reduceMotion) {
      reset();
      return;
    }
    reset();
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotion, reset]);

  return pulse;
}

/* ─── FadeIn (web `@/components/motion` FadeIn, honouring `delay`) ──────────── */

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
      delay: Math.max(delay, 0) * 1000,
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

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

FadeIn.displayName = 'FadeIn';

/* ─── Skeleton (web `@/components/feedback` Skeleton, animate-pulse) ────────── */

function Skeleton({
  height,
  width = '100%',
  style,
}: {
  height: number;
  width?: DimensionValue;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const pulse = useLoopingPulse(reduceMotion);
  const animatedStyle = reduceMotion
    ? null
    : {
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.45, 0.85],
        }),
      };

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.skeleton, {height, width}, animatedStyle, style]}
    />
  );
}

Skeleton.displayName = 'Skeleton';

/* ─── RefreshIndicator (web PageContainer `actions` auto-refresh chip) ──────── */

function RefreshIndicator({active, label}: {active: boolean; label: string}) {
  const reduceMotion = useReduceMotion();
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active || reduceMotion) {
      spin.setValue(0);
      return;
    }
    spin.setValue(0);
    const animation = Animated.loop(
      Animated.timing(spin, {
        duration: 1000,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [active, reduceMotion, spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.refreshRow}>
      <Animated.View style={{transform: [{rotate}]}}>
        <AppText style={styles.refreshGlyph} tone="muted">
          {'\u21BB'}
        </AppText>
      </Animated.View>
      <AppText tone="muted" variant="caption">
        {label}
      </AppText>
    </View>
  );
}

RefreshIndicator.displayName = 'RefreshIndicator';

/* ─── DangerBanner (web `@/components/feedback` AlertBanner variant="danger") ─ */

function DangerBanner({children, title}: {children: ReactNode; title: string}) {
  return (
    <View accessibilityRole="alert" style={styles.dangerBanner}>
      <View pointerEvents="none">
        <AppText style={styles.dangerGlyph} weight="bold">
          {'\u26A0'}
        </AppText>
      </View>
      <View style={styles.bannerCopy}>
        <AppText style={styles.dangerTitle} variant="caption" weight="semibold">
          {title}
        </AppText>
        <AppText style={styles.dangerBody} variant="caption">
          {children}
        </AppText>
      </View>
    </View>
  );
}

DangerBanner.displayName = 'DangerBanner';

/* ─── SortButton (web `@/components/ui` Button size="sm" variant) ───────────── */

function SortButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{selected: active}}
      onPress={onPress}
      style={({pressed}) => [
        styles.sortButton,
        active ? styles.sortButtonActive : styles.sortButtonIdle,
        pressed && styles.pressed,
      ]}>
      <AppText
        style={active ? styles.sortButtonTextActive : styles.sortButtonText}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

SortButton.displayName = 'SortButton';

/* ─── UsageBar (web pool usage track + fill) ────────────────────────────────── */

function UsageBar({
  label,
  percentLabel,
  usage,
}: {
  label: string;
  percentLabel: string;
  usage: number;
}) {
  const clamped = Math.min(Math.max(usage, 0), 100);
  return (
    <View style={styles.usageWrap}>
      <View style={styles.usageHeader}>
        <AppText style={styles.usageCaption} tone="muted">
          {label}
        </AppText>
        <AppText style={styles.usageCaption} tone="muted">
          {percentLabel}
        </AppText>
      </View>
      <View style={styles.usageTrack}>
        <View
          style={[
            styles.usageFill,
            usage >= 80 ? styles.usageFillDanger : styles.usageFillAccent,
            {width: `${clamped}%`},
          ]}
        />
      </View>
    </View>
  );
}

UsageBar.displayName = 'UsageBar';

/* ─── TableSizeChart (web ChartContainer + Recharts horizontal BarChart) ───── */

interface ChartDatum {
  name: string;
  rows: number;
}

function TableSizeChart({
  ariaLabel,
  data,
  emptyLabel,
  loading,
  rowsHeader,
  seriesLabel,
  tableHeader,
}: {
  ariaLabel: string;
  data: ChartDatum[];
  emptyLabel: string;
  loading: boolean;
  rowsHeader: string;
  seriesLabel: string;
  tableHeader: string;
}) {
  if (loading) {
    return (
      <View style={styles.chartBars}>
        {Array.from({length: 6}).map((_, i) => (
          <Skeleton height={18} key={i} />
        ))}
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <AppText tone="muted" variant="caption">
        {emptyLabel}
      </AppText>
    );
  }

  const max = Math.max(...data.map(d => d.rows), 1);

  return (
    <View
      accessible
      accessibilityLabel={ariaLabel}
      accessibilityRole="summary"
      style={styles.chartWrap}>
      <View style={styles.chartLegend}>
        <View style={styles.chartLegendSwatch} />
        <AppText tone="muted" variant="caption">
          {seriesLabel}
        </AppText>
      </View>
      <View style={styles.chartHeaderRow}>
        <AppText style={styles.chartHeaderTable} tone="muted" variant="caption">
          {tableHeader}
        </AppText>
        <AppText style={styles.chartHeaderValue} tone="muted" variant="caption">
          {rowsHeader}
        </AppText>
      </View>
      <View style={styles.chartBars}>
        {data.map(d => (
          <View key={d.name} style={styles.chartRow}>
            <AppText numberOfLines={1} style={styles.chartLabel} variant="caption">
              {d.name}
            </AppText>
            <View style={styles.chartTrack}>
              <View
                style={[styles.chartFill, {width: `${Math.max((d.rows / max) * 100, 2)}%`}]}
              />
            </View>
            <AppText style={styles.chartValue} variant="caption">
              {fmtInt(d.rows)}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

TableSizeChart.displayName = 'TableSizeChart';

/* ─── native table cells (web DataTable header + body) ─────────────────────── */

interface Column {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (tbl: TableInfo) => ReactNode;
}

const COLUMN_WIDTHS: Record<string, number> = {
  indexes: 90,
  name: 200,
  rows: 110,
  size: 110,
  vacuum: 150,
};

const DEFAULT_WIDTH = 120;

function columnWidth(key: string): number {
  return COLUMN_WIDTHS[key] ?? DEFAULT_WIDTH;
}

function tableWidth(columns: Column[]): number {
  return columns.reduce((sum, column) => sum + columnWidth(column.key) + spacing.md, 0);
}

function HeaderCell({column}: {column: Column}) {
  return (
    <View
      style={[
        styles.headerCell,
        {width: columnWidth(column.key)},
        column.align === 'right' ? styles.cellRight : null,
      ]}>
      <AppText style={styles.headerText} tone="muted" variant="caption" weight="semibold">
        {column.header}
      </AppText>
    </View>
  );
}

HeaderCell.displayName = 'HeaderCell';

function DataCell({column, row}: {column: Column; row: TableInfo}) {
  return (
    <View
      style={[
        styles.cell,
        {width: columnWidth(column.key)},
        column.align === 'right' ? styles.cellRight : null,
      ]}>
      {column.render(row)}
    </View>
  );
}

DataCell.displayName = 'DataCell';

/* ─── constants (carried over verbatim from the web source) ────────────────── */

const LARGE_TABLE_THRESHOLD = 100 * 1024 * 1024; // 100MB

type SortKey = 'size' | 'rows' | 'name';

const SORT_KEYS: SortKey[] = ['size', 'rows', 'name'];

/* ─── DBHealthPage ─────────────────────────────────────────────────────────── */

export default function DBHealthPage() {
  const t = useNativeTranslationFallback();
  usePageTitle(t('dbHealth.title', 'DB Health'));
  const [sortKey, setSortKey] = useState<SortKey>('size');

  const {
    data: dbStats,
    isLoading: statsLoading,
    isFetching: statsFetching,
    error: statsError,
  } = useDBStats();
  const {
    data: migrationData,
    isLoading: migrationLoading,
    error: migrationError,
  } = useMigrations();
  const {data: poolData, isLoading: poolLoading} = useConnectionPool();

  const queryError = statsError ?? migrationError;
  const tables = useMemo<TableInfo[]>(() => dbStats?.tables ?? [], [dbStats]);

  const sortedTables = useMemo(() => {
    const sorted = [...tables];
    sorted.sort((a, b) => {
      if (sortKey === 'size') {
        return (b.sizeBytes ?? b.rowCount) - (a.sizeBytes ?? a.rowCount);
      }
      if (sortKey === 'rows') {
        return b.rowCount - a.rowCount;
      }
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [tables, sortKey]);

  // Chart data — always sorted by row count, independent of table sort.
  const chartData = useMemo<ChartDatum[]>(
    () =>
      [...tables]
        .sort((a, b) => b.rowCount - a.rowCount)
        .slice(0, 15)
        .map(tbl => ({
          name: tbl.name.length > 20 ? tbl.name.slice(0, 18) + '\u2026' : tbl.name,
          rows: tbl.rowCount,
        })),
    [tables],
  );

  // Backend returns {version, dirty} — handle both field names.
  const migrationVersion =
    (migrationData as Record<string, unknown> | undefined)?.version ??
    migrationData?.currentVersion ??
    '\u2014';
  const migrationDirty = migrationData?.dirty ?? false;
  const migrationPending = migrationData?.pending ?? 0;
  const migrations = migrationData?.migrations ?? [];

  const pool = poolData;
  const poolUsage =
    pool?.maxOpen && pool.maxOpen > 0
      ? Math.min((pool.inUse / pool.maxOpen) * 100, 100)
      : 0;

  const largeTables = tables.filter(
    tbl => (tbl.sizeBytes ?? 0) > LARGE_TABLE_THRESHOLD,
  ).length;

  // databaseSize is numeric bytes from the backend.
  const dbSizeDisplay = dbStats ? formatBytes(Number(dbStats.databaseSize) || 0) : '\u2014';

  const tableColumns = useMemo<Column[]>(
    () => [
      {
        key: 'name',
        header: t('dbHealth.table.name', 'Table'),
        render: (tbl: TableInfo) => {
          const isLarge = (tbl.sizeBytes ?? 0) > LARGE_TABLE_THRESHOLD;
          return (
            <View style={styles.nameCell}>
              {isLarge ? (
                <AppText style={styles.warningGlyph}>{'\u26A0'}</AppText>
              ) : null}
              <AppText
                numberOfLines={1}
                style={isLarge ? styles.nameTextLarge : styles.nameText}>
                {tbl.name}
              </AppText>
            </View>
          );
        },
      },
      {
        key: 'rows',
        header: t('dbHealth.table.rows', 'Rows'),
        align: 'right',
        render: (tbl: TableInfo) => (
          <AppText style={styles.monoSecondary}>{fmtInt(tbl.rowCount)}</AppText>
        ),
      },
      {
        key: 'size',
        header: t('dbHealth.table.size', 'Size'),
        align: 'right',
        render: (tbl: TableInfo) => (
          <AppText style={styles.monoSecondary}>
            {tbl.sizeBytes ? formatBytes(tbl.sizeBytes) : '\u2014'}
          </AppText>
        ),
      },
      {
        key: 'indexes',
        header: t('dbHealth.table.indexes', 'Indexes'),
        align: 'right',
        render: (tbl: TableInfo) => (
          <AppText style={styles.monoMuted}>{tbl.indexCount ?? '\u2014'}</AppText>
        ),
      },
      {
        key: 'vacuum',
        header: t('dbHealth.table.lastVacuum', 'Last Vacuum'),
        align: 'right',
        render: (tbl: TableInfo) => (
          <AppText numberOfLines={1} style={styles.monoMuted}>
            {formatRelative(tbl.lastVacuum ?? null)}
          </AppText>
        ),
      },
    ],
    [t],
  );

  const fullTableWidth = tableWidth(tableColumns);
  const sortLabels: Record<SortKey, string> = {
    name: t('dbHealth.sort.name', 'Name'),
    rows: t('dbHealth.sort.rows', 'Rows'),
    size: t('dbHealth.sort.size', 'Size'),
  };

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="system-db-health">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {t('dbHealth.title', 'DB Health Dashboard')}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {t('dbHealth.subtitle', 'Database health metrics and table statistics')}
          </AppText>
        </View>
        <RefreshIndicator
          active={statsFetching}
          label={t('dbHealth.autoRefresh', 'Auto-refresh 30s')}
        />
      </View>

      <ErrorBoundary name="db-health-page">
        <View style={styles.stack}>
          {queryError ? (
            <DangerBanner title={t('dbHealth.error', 'Error loading data')}>
              {(queryError as Error).message}
            </DangerBanner>
          ) : null}

          {/* Summary Cards */}
          <FadeIn delay={0.1}>
            <View style={styles.summaryGrid}>
              <StatCard
                icon={<SemanticIcon decorative name="database" size="sm" />}
                label={t('dbHealth.totalSize', 'Total DB Size')}
                loading={statsLoading}
                style={styles.summaryCard}
                value={dbSizeDisplay}
              />
              <StatCard
                icon={<SemanticIcon decorative name="database" size="sm" />}
                label={t('dbHealth.tables', 'Tables')}
                style={styles.summaryCard}
                value={statsLoading ? '\u2014' : tables.length}
              />
              <StatCard
                icon={<SemanticIcon decorative name="warning" size="sm" />}
                label={t('dbHealth.largeTables', 'Large Tables (>100MB)')}
                style={styles.summaryCard}
                value={largeTables}
              />
              <StatCard
                icon={<SemanticIcon decorative name="success" size="sm" />}
                label={t('dbHealth.migration', 'Migration Version')}
                loading={migrationLoading}
                style={styles.summaryCard}
                value={String(migrationVersion)}
              />
            </View>
          </FadeIn>

          {/* Table Size Bar Chart */}
          <FadeIn delay={0.2}>
            <GlassPanel padding="lg" style={styles.panel}>
              <AppText style={styles.panelTitle} weight="semibold">
                {t('dbHealth.chartTitle', 'Table Sizes (Top 15)')}
              </AppText>
              <TableSizeChart
                ariaLabel={t(
                  'dbHealth.chartTitle.aria',
                  'Top fifteen database table sizes horizontal bar chart',
                )}
                data={chartData}
                emptyLabel={t('dbHealth.noTables', 'No tables found')}
                loading={statsLoading}
                rowsHeader={t('dbHealth.col.rows', 'Rows')}
                seriesLabel={t('dbHealth.rows', 'Rows')}
                tableHeader={t('dbHealth.col.table', 'Table')}
              />
            </GlassPanel>
          </FadeIn>

          {/* Table List */}
          <FadeIn delay={0.3}>
            <GlassPanel padding="lg" style={styles.panel}>
              <View style={styles.panelHeader}>
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('dbHealth.tablesTitle', 'Tables')}
                </AppText>
                <View style={styles.sortControls}>
                  <AppText style={styles.sortGlyph} tone="muted">
                    {'\u21C5'}
                  </AppText>
                  {SORT_KEYS.map(key => (
                    <SortButton
                      active={sortKey === key}
                      key={key}
                      label={sortLabels[key]}
                      onPress={() => setSortKey(key)}
                    />
                  ))}
                </View>
              </View>

              {statsLoading ? (
                <View style={styles.tableSkeletonStack}>
                  {Array.from({length: 6}).map((_, i) => (
                    <Skeleton height={40} key={i} />
                  ))}
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.table}>
                    <View style={styles.headerRow}>
                      {tableColumns.map(column => (
                        <HeaderCell column={column} key={column.key} />
                      ))}
                    </View>
                    {sortedTables.length === 0 ? (
                      <View style={[styles.emptyRow, {width: fullTableWidth}]}>
                        <AppText tone="muted" variant="caption">
                          {t('dbHealth.noTables', 'No tables found')}
                        </AppText>
                      </View>
                    ) : (
                      sortedTables.map(tbl => (
                        <View key={tbl.name} style={styles.row}>
                          {tableColumns.map(column => (
                            <DataCell column={column} key={column.key} row={tbl} />
                          ))}
                        </View>
                      ))
                    )}
                  </View>
                </ScrollView>
              )}
            </GlassPanel>
          </FadeIn>

          {/* Sidebar: Migration Status + Connection Pool */}
          <FadeIn delay={0.4}>
            <View style={styles.sidebar}>
              {/* Migration Status */}
              <GlassPanel padding="lg" style={styles.panel}>
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('dbHealth.migrationTitle', 'Migration Status')}
                </AppText>
                {migrationLoading ? (
                  <Skeleton height={128} />
                ) : migrationData ? (
                  <View style={styles.detailStack}>
                    <View style={styles.detailRow}>
                      <AppText style={styles.detailLabel} tone="muted" variant="caption">
                        {t('dbHealth.currentVersion', 'Current Version')}
                      </AppText>
                      <AppText style={styles.versionValue} weight="bold">
                        {String(migrationVersion)}
                      </AppText>
                    </View>
                    <View style={styles.detailRow}>
                      <AppText style={styles.detailLabel} tone="muted" variant="caption">
                        {t('dbHealth.status', 'Status')}
                      </AppText>
                      <AppText
                        style={migrationDirty ? styles.statusDirty : styles.statusClean}
                        variant="caption"
                        weight="semibold">
                        {migrationDirty
                          ? t('dbHealth.dirty', '\u26A0 Dirty')
                          : t('dbHealth.clean', '\u2713 Clean')}
                      </AppText>
                    </View>
                    {migrationPending > 0 ? (
                      <View style={styles.detailRow}>
                        <AppText style={styles.detailLabel} tone="muted" variant="caption">
                          {t('dbHealth.pending', 'Pending')}
                        </AppText>
                        <AppText style={styles.pendingValue} variant="caption" weight="semibold">
                          {migrationPending}
                        </AppText>
                      </View>
                    ) : null}
                    {migrations.length > 0 ? (
                      <View style={styles.migrationDivider}>
                        <AppText style={styles.migrationSectionTitle} tone="muted">
                          {t('dbHealth.recentMigrations', 'Recent Migrations')}
                        </AppText>
                        <View style={styles.migrationList}>
                          {migrations
                            .slice(-5)
                            .reverse()
                            .map(m => (
                              <View key={m.version} style={styles.migrationItem}>
                                <AppText
                                  numberOfLines={1}
                                  style={styles.migrationItemName}
                                  variant="caption">
                                  v{m.version} {m.name}
                                </AppText>
                                {m.appliedAt ? (
                                  <AppText style={styles.migrationItemTime} tone="muted">
                                    {formatRelative(m.appliedAt)}
                                  </AppText>
                                ) : null}
                              </View>
                            ))}
                        </View>
                      </View>
                    ) : (
                      <EmptyState
                        message={t('dbHealth.noMigrations', 'No migration history available')}
                        title={t('dbHealth.recentMigrations', 'Recent Migrations')}
                      />
                    )}
                  </View>
                ) : (
                  <EmptyState
                    message={t('dbHealth.noMigrationData', 'Migration data unavailable')}
                    title={t('dbHealth.migrationTitle', 'Migration Status')}
                  />
                )}
              </GlassPanel>

              {/* Connection Pool */}
              <GlassPanel padding="lg" style={styles.panel}>
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('dbHealth.poolTitle', 'Connection Pool')}
                </AppText>
                {poolLoading ? (
                  <Skeleton height={160} />
                ) : pool?.maxOpen != null ? (
                  <View style={styles.detailStack}>
                    {[
                      {label: t('dbHealth.pool.maxOpen', 'Max Open'), value: pool.maxOpen},
                      {label: t('dbHealth.pool.open', 'Open'), value: pool.open},
                      {label: t('dbHealth.pool.inUse', 'In Use'), value: pool.inUse},
                      {label: t('dbHealth.pool.idle', 'Idle'), value: pool.idle},
                      {label: t('dbHealth.pool.waitCount', 'Wait Count'), value: pool.waitCount},
                      {
                        label: t('dbHealth.pool.waitDuration', 'Wait Duration'),
                        value: `${fmtInt(pool.waitDurationMs ?? 0)}ms`,
                      },
                    ].map(item => (
                      <View key={item.label} style={styles.detailRow}>
                        <AppText style={styles.detailLabel} tone="muted" variant="caption">
                          {item.label}
                        </AppText>
                        <AppText style={styles.poolValue}>{item.value}</AppText>
                      </View>
                    ))}
                    <UsageBar
                      label={t('dbHealth.poolUsage', 'Pool Usage')}
                      percentLabel={`${fmtInt(poolUsage)}%`}
                      usage={poolUsage}
                    />
                  </View>
                ) : (
                  <EmptyState
                    message={t('dbHealth.noPoolData', 'Connection pool data unavailable')}
                    title={t('dbHealth.poolTitle', 'Connection Pool')}
                  />
                )}
              </GlassPanel>
            </View>
          </FadeIn>
        </View>
      </ErrorBoundary>
    </ScrollView>
  );
}

DBHealthPage.displayName = 'DBHealthPage';

const MONO = 'monospace';

const styles = StyleSheet.create({
  bannerCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  cell: {
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  cellRight: {
    alignItems: 'flex-end',
  },
  chartBars: {
    gap: spacing.sm,
  },
  chartFill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: '100%',
  },
  chartHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chartHeaderTable: {
    letterSpacing: 0.3,
  },
  chartHeaderValue: {
    letterSpacing: 0.3,
  },
  chartLabel: {
    color: colors.textPrimary,
    width: 116,
  },
  chartLegend: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  chartLegendSwatch: {
    backgroundColor: colors.accent,
    borderRadius: 3,
    height: 10,
    width: 10,
  },
  chartRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chartTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flex: 1,
    height: 12,
    overflow: 'hidden',
  },
  chartValue: {
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    width: 72,
  },
  chartWrap: {
    gap: spacing.sm,
  },
  dangerBanner: {
    alignItems: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  dangerBody: {
    color: colors.textSecondary,
  },
  dangerGlyph: {
    color: colors.danger,
    fontSize: typography.body,
  },
  dangerTitle: {
    color: colors.danger,
  },
  detailLabel: {
    flexShrink: 1,
  },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  detailStack: {
    gap: spacing.md,
  },
  emptyRow: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerCell: {
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  headerRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingBottom: spacing.sm,
  },
  headerText: {
    letterSpacing: 0.3,
  },
  migrationDivider: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  migrationItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  migrationItemName: {
    color: colors.textSecondary,
    flex: 1,
    fontFamily: MONO,
  },
  migrationItemTime: {
    fontSize: 10,
  },
  migrationList: {
    gap: spacing.sm,
  },
  migrationSectionTitle: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  monoMuted: {
    color: colors.textMuted,
    fontFamily: MONO,
  },
  monoSecondary: {
    color: colors.textSecondary,
    fontFamily: MONO,
  },
  nameCell: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  nameText: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontFamily: MONO,
  },
  nameTextLarge: {
    color: colors.warning,
    flexShrink: 1,
    fontFamily: MONO,
  },
  pageSubtitle: {
    lineHeight: 18,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  panel: {
    gap: spacing.md,
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  pendingValue: {
    color: colors.warning,
  },
  poolValue: {
    color: colors.textPrimary,
    fontFamily: MONO,
  },
  pressed: {
    opacity: 0.78,
  },
  refreshGlyph: {
    fontSize: typography.caption,
  },
  refreshRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingVertical: spacing.sm,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  sidebar: {
    gap: spacing.lg,
  },
  skeleton: {
    backgroundColor: 'rgba(148, 163, 184, 0.18)',
    borderRadius: 6,
  },
  sortButton: {
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  sortButtonActive: {
    backgroundColor: colors.accent,
  },
  sortButtonIdle: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  sortButtonText: {
    color: colors.textPrimary,
  },
  sortButtonTextActive: {
    color: colors.background,
  },
  sortControls: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sortGlyph: {
    fontSize: typography.caption,
  },
  stack: {
    gap: spacing.lg,
  },
  statusClean: {
    color: colors.success,
  },
  statusDirty: {
    color: colors.danger,
  },
  summaryCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  table: {
    flexDirection: 'column',
  },
  tableSkeletonStack: {
    gap: spacing.sm,
  },
  usageCaption: {
    fontSize: 10,
  },
  usageFill: {
    borderRadius: 999,
    height: '100%',
  },
  usageFillAccent: {
    backgroundColor: colors.accent,
  },
  usageFillDanger: {
    backgroundColor: colors.danger,
  },
  usageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  usageTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 8,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  usageWrap: {
    marginTop: spacing.xs,
  },
  versionValue: {
    color: colors.textPrimary,
    fontFamily: MONO,
  },
  warningGlyph: {
    color: colors.warning,
    fontSize: typography.caption,
  },
});
