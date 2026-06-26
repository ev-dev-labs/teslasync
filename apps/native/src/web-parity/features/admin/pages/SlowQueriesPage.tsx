// Native parity port of web/src/features/admin/pages/SlowQueriesPage.tsx.
//
// Slow Queries page for admin observability: the top-N slowest queries from
// pg_stat_statements with a sortable order (mean_time / total_time / calls /
// max_time) and a configurable limit. Each row shows the query fingerprint,
// call count, time stats, rows returned and the shared-buffer cache hit/read
// ratio so operators can tell "slow but cached" from "slow because of I/O".
// Backed by GET /api/v1/admin/observability/slow-queries.
//
// Every web behavior + state name is preserved (the `orderBy`/`limit` state,
// the `useSlowQueries(orderBy, limit)` query, `subsystemMissing` 503 detection,
// `rows = query.data?.slow_queries ?? []`, the seven-column `columns` useMemo,
// the empty-state-vs-DataTable branch, and the `cacheHitRatio` helper). The web
// DOM/Tailwind stack is replaced with React Native primitives + the native
// parity component library:
//
//   - `@/components/layout` PageContainer (title/subtitle/`query`) has no native
//     parity component, so a local screen scaffold reproduces the header (title
//     + subtitle), the query-driven freshness chip via the native `StatusPill`,
//     and the page-level boundary via the native `ErrorBoundary`.
//   - `@/components/ui` Select (a browser <select>) becomes a local NativeSelect:
//     a Pressable trigger that reveals a themed option list (the IngestXRayPage
//     precedent), preserving value/options/onChange.
//   - `@/components/ui` DataTable/Column (a browser <table>) becomes a native
//     header row + data rows inside a horizontal ScrollView so every column
//     stays usable on a phone, preserving each column's `align` + `render`
//     config, the `keyExtractor` (row key = `query_id`), and the `emptyMessage`.
//   - `@/components/ui` GlassPanel (web `p-6`) reuses the native parity GlassPanel
//     with `padding="lg"` (24px).
//   - `@/components/ui/Typography` PanelTitle/Caption become themed AppText; Code
//     (text-xs font-mono) becomes a monospace AppText cell with single-line
//     truncation (the web `truncate`) and the full fingerprint exposed via
//     accessibilityLabel (the web `title` tooltip has no native analog).
//   - `@/components/feedback` EmptyState reuses the already-ported native parity
//     component; AlertBanner becomes a local WarningBanner; SectionErrorBoundary
//     becomes the native ErrorBoundary in `inline` mode (same default inline
//     fallback + Retry the web SectionErrorBoundary defers to).
//   - `@/components/motion` FadeIn becomes a reduced-motion-aware mount fade.
//   - lucide-react `Timer` (decorative empty-state glyph) has no native icon
//     dependency; the native EmptyState carries the meaning via title/message.
//   - `@/lib/numberFormat` fmtNumber is inlined native-safe (locale precision
//     defaults to the web global 2), matching the DiskForecastPage precedent.
//   - `@/lib/resilience` isApiError reuses the native parity client export.
//   - `@/hooks/usePageTitle` (sets document.title) is a native no-op shim — RN
//     has no document — but the `t()` title call is preserved.
//   - react-i18next useTranslation becomes a local fallback shim so every
//     `admin.slowQueries.*` key + English copy is preserved verbatim.

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
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {StatusPill} from '../../../../components/ui/StatusPill';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {isApiError} from '../../../api/client';
import {
  useSlowQueries,
  type SlowQueryOrderBy,
  type SlowQueryRow,
} from '../../../api/hooks/useOperatorConfidence';
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

/* ─── sort/limit options (carried over verbatim from the web source) ───────── */

const ORDER_BY_OPTIONS: ReadonlyArray<{
  value: SlowQueryOrderBy;
  labelKey: string;
  fallback: string;
}> = [
  {value: 'mean_time', labelKey: 'admin.slowQueries.orderMean', fallback: 'Mean time'},
  {value: 'total_time', labelKey: 'admin.slowQueries.orderTotal', fallback: 'Total time'},
  {value: 'calls', labelKey: 'admin.slowQueries.orderCalls', fallback: 'Calls'},
  {value: 'max_time', labelKey: 'admin.slowQueries.orderMax', fallback: 'Max time'},
];

const LIMIT_OPTIONS = [10, 25, 50, 100];

/* ─── Column type (web `@/components/ui` DataTable export) ──────────────────── */

interface Column {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: SlowQueryRow) => ReactNode;
}

const COLUMN_WIDTHS: Record<string, number> = {
  cache: 132,
  calls: 96,
  fingerprint: 280,
  max_time_ms: 110,
  mean_time_ms: 110,
  rows_returned: 96,
  total_time_ms: 120,
};

const DEFAULT_WIDTH = 120;

/* ─── NativeSelect (web `@/components/ui` Select dropdown) ──────────────────── */

interface NativeSelectOption {
  value: string;
  label: string;
}

function NativeSelect({
  value,
  options,
  onChange,
  accessibilityLabel,
  width,
}: {
  value: string;
  options: NativeSelectOption[];
  onChange: (value: string) => void;
  accessibilityLabel: string;
  width: number;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <View style={[styles.select, {width}]}>
      <Pressable
        accessibilityHint="Opens the option list"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(prev => !prev)}
        style={({pressed}) => [styles.selectTrigger, pressed && styles.selectPressed]}>
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
                  pressed && styles.selectPressed,
                ]}>
                <AppText numberOfLines={1} style={styles.selectOptionText}>
                  {option.label}
                </AppText>
                {isSelected ? (
                  <AppText style={styles.selectCheck} tone="accent">
                    {'\u2713'}
                  </AppText>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

NativeSelect.displayName = 'NativeSelect';

/* ─── WarningBanner (web `@/components/feedback` AlertBanner variant="warning") */

function WarningBanner({children, title}: {children: ReactNode; title: string}) {
  return (
    <View accessibilityRole="alert" style={styles.banner}>
      <View pointerEvents="none" style={styles.bannerIcon}>
        <AppText style={styles.bannerIconGlyph} weight="bold">
          {'\u26A0'}
        </AppText>
      </View>
      <View style={styles.bannerCopy}>
        <AppText style={styles.bannerTitle} variant="caption" weight="semibold">
          {title}
        </AppText>
        <AppText style={styles.bannerBody} variant="caption">
          {children}
        </AppText>
      </View>
    </View>
  );
}

WarningBanner.displayName = 'WarningBanner';

/* ─── FadeIn (web `@/components/motion` FadeIn) ─────────────────────────────── */

function FadeIn({children, style}: {children: ReactNode; style?: StyleProp<ViewStyle>}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      duration: 320,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);

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

/* ─── native table cells (web DataTable header + body) ─────────────────────── */

function HeaderCell({column}: {column: Column}) {
  const width = COLUMN_WIDTHS[column.key] ?? DEFAULT_WIDTH;
  return (
    <View style={[styles.headerCell, {width}, column.align === 'right' ? styles.cellRight : null]}>
      <AppText style={styles.headerText} tone="muted" variant="caption" weight="semibold">
        {column.header}
      </AppText>
    </View>
  );
}

HeaderCell.displayName = 'HeaderCell';

function DataCell({column, row}: {column: Column; row: SlowQueryRow}) {
  const width = COLUMN_WIDTHS[column.key] ?? DEFAULT_WIDTH;
  return (
    <View style={[styles.cell, {width}, column.align === 'right' ? styles.cellRight : null]}>
      {column.render(row)}
    </View>
  );
}

DataCell.displayName = 'DataCell';

function tableWidth(columns: Column[]): number {
  return columns.reduce(
    (sum, column) => sum + (COLUMN_WIDTHS[column.key] ?? DEFAULT_WIDTH) + spacing.md,
    0,
  );
}

/* ─── query-driven freshness chip (web PageContainer `<DataFreshnessAuto>`) ─── */

interface FreshnessQueryLike {
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
}

function FreshnessChip({query, t}: {query: FreshnessQueryLike; t: NativeTFunction}) {
  if (query.isError) {
    return <StatusPill label={t('common.freshness.error', 'Error')} state="offline" />;
  }
  if (query.isFetching) {
    return <StatusPill label={t('common.freshness.updating', 'Updating\u2026')} state="warning" />;
  }
  if (query.isStale) {
    return <StatusPill label={t('common.freshness.stale', 'Stale')} state="warning" />;
  }
  return <StatusPill label={t('common.freshness.live', 'Live')} state="online" />;
}

FreshnessChip.displayName = 'FreshnessChip';

/* ─── SlowQueriesPage ──────────────────────────────────────────────────────── */

export default function SlowQueriesPage() {
  const t = useNativeTranslationFallback();
  usePageTitle(t('admin.slowQueries.pageTitle', 'Slow Queries'));

  const [orderBy, setOrderBy] = useState<SlowQueryOrderBy>('mean_time');
  const [limit, setLimit] = useState<number>(25);

  const query = useSlowQueries(orderBy, limit);
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;
  const rows = useMemo(() => query.data?.slow_queries ?? [], [query.data]);

  const columns = useMemo<Column[]>(
    () => [
      {
        key: 'fingerprint',
        header: t('admin.slowQueries.colFingerprint', 'Query fingerprint'),
        render: r => (
          <View style={styles.fingerprintCell}>
            <AppText accessibilityLabel={r.fingerprint} numberOfLines={1} style={styles.codeText}>
              {r.fingerprint || '\u2014'}
            </AppText>
          </View>
        ),
      },
      {
        key: 'calls',
        header: t('admin.slowQueries.colCalls', 'Calls'),
        align: 'right',
        render: r => <AppText style={styles.numeric}>{fmtNumber(r.calls)}</AppText>,
      },
      {
        key: 'mean_time_ms',
        header: t('admin.slowQueries.colMean', 'Mean (ms)'),
        align: 'right',
        render: r => <AppText style={styles.numeric}>{fmtNumber(r.mean_time_ms, 2)}</AppText>,
      },
      {
        key: 'max_time_ms',
        header: t('admin.slowQueries.colMax', 'Max (ms)'),
        align: 'right',
        render: r => <AppText style={styles.numeric}>{fmtNumber(r.max_time_ms, 2)}</AppText>,
      },
      {
        key: 'total_time_ms',
        header: t('admin.slowQueries.colTotal', 'Total (ms)'),
        align: 'right',
        render: r => <AppText style={styles.numeric}>{fmtNumber(r.total_time_ms, 0)}</AppText>,
      },
      {
        key: 'rows_returned',
        header: t('admin.slowQueries.colRows', 'Rows'),
        align: 'right',
        render: r => <AppText style={styles.numeric}>{fmtNumber(r.rows_returned)}</AppText>,
      },
      {
        key: 'cache',
        header: t('admin.slowQueries.colCache', 'Cache hit ratio'),
        align: 'right',
        render: r => <AppText style={styles.numeric}>{cacheHitRatio(r)}</AppText>,
      },
    ],
    [t],
  );

  const fullTableWidth = tableWidth(columns);
  const showEmptyState =
    rows.length === 0 && !query.isLoading && !subsystemMissing;

  const orderByOptions: NativeSelectOption[] = ORDER_BY_OPTIONS.map(opt => ({
    value: opt.value,
    label: t(opt.labelKey, opt.fallback),
  }));
  const limitOptions: NativeSelectOption[] = LIMIT_OPTIONS.map(n => ({
    value: String(n),
    label: String(n),
  }));

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="admin-slow-queries">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {t('admin.slowQueries.pageTitle', 'Slow Queries')}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {t(
              'admin.slowQueries.subtitle',
              'Top queries from pg_stat_statements. Sort by mean time to surface the slowest individual calls, or total time to surface the costliest in aggregate.',
            )}
          </AppText>
        </View>
        <FreshnessChip query={query} t={t} />
      </View>

      <ErrorBoundary name="slow-queries-page">
        <FadeIn>
          <View style={styles.stack}>
            {subsystemMissing ? (
              <WarningBanner title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}>
                {t(
                  'admin.slowQueries.notConfigured',
                  'pg_stat_statements is not installed on this PostgreSQL instance. Run `CREATE EXTENSION pg_stat_statements;` and add it to shared_preload_libraries to enable this page.',
                )}
              </WarningBanner>
            ) : null}

            <GlassPanel padding="lg">
              <View style={styles.panelHeader}>
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('admin.slowQueries.tableTitle', 'Top queries')}
                </AppText>
                <View style={styles.controlsRow}>
                  <View style={styles.labeledControl}>
                    <AppText tone="muted" variant="caption">
                      {t('admin.slowQueries.orderBy', 'Order by')}
                    </AppText>
                    <NativeSelect
                      accessibilityLabel={t('admin.slowQueries.orderBy', 'Order by')}
                      onChange={v => setOrderBy(v as SlowQueryOrderBy)}
                      options={orderByOptions}
                      value={orderBy}
                      width={150}
                    />
                  </View>
                  <View style={styles.labeledControl}>
                    <AppText tone="muted" variant="caption">
                      {t('admin.slowQueries.limit', 'Limit')}
                    </AppText>
                    <NativeSelect
                      accessibilityLabel={t('admin.slowQueries.limit', 'Limit')}
                      onChange={v => setLimit(Number(v))}
                      options={limitOptions}
                      value={String(limit)}
                      width={96}
                    />
                  </View>
                </View>
              </View>
              <ErrorBoundary inline name="slow-queries-table">
                {showEmptyState ? (
                  <EmptyState
                    message={t(
                      'admin.slowQueries.emptyMessage',
                      'pg_stat_statements is empty or has been reset recently. Slow queries will accumulate here as the system processes load.',
                    )}
                    title={t('admin.slowQueries.emptyTitle', 'No slow queries')}
                  />
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.table}>
                      <View style={styles.headerRow}>
                        {columns.map(column => (
                          <HeaderCell column={column} key={column.key} />
                        ))}
                      </View>
                      {rows.length === 0 ? (
                        <View style={[styles.emptyRow, {width: fullTableWidth}]}>
                          <AppText tone="muted" variant="caption">
                            {t('admin.slowQueries.emptyTable', 'No slow queries')}
                          </AppText>
                        </View>
                      ) : (
                        rows.map(row => (
                          <View key={row.query_id} style={styles.row}>
                            {columns.map(column => (
                              <DataCell column={column} key={column.key} row={row} />
                            ))}
                          </View>
                        ))
                      )}
                    </View>
                  </ScrollView>
                )}
              </ErrorBoundary>
            </GlassPanel>
          </View>
        </FadeIn>
      </ErrorBoundary>
    </ScrollView>
  );
}

SlowQueriesPage.displayName = 'SlowQueriesPage';

function cacheHitRatio(row: SlowQueryRow): string {
  const hit = row.shared_blks_hit ?? 0;
  const read = row.shared_blks_read ?? 0;
  const total = hit + read;
  if (total <= 0) {
    return '\u2014';
  }
  return `${fmtNumber((hit / total) * 100, 1)}%`;
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'flex-start',
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  bannerBody: {
    color: colors.textSecondary,
  },
  bannerCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  bannerIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerIconGlyph: {
    color: colors.warning,
    fontSize: typography.body,
  },
  bannerTitle: {
    color: colors.warning,
  },
  cell: {
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  cellRight: {
    alignItems: 'flex-end',
  },
  codeText: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: typography.caption,
  },
  controlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    zIndex: 1,
  },
  emptyRow: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  fingerprintCell: {
    flex: 1,
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
  labeledControl: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  numeric: {
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  pageSubtitle: {
    lineHeight: 18,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  panelHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
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
  select: {
    position: 'relative',
  },
  selectCheck: {
    fontSize: 14,
  },
  selectChevron: {
    fontSize: 12,
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
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectOptionSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  selectOptionText: {
    flex: 1,
  },
  selectPressed: {
    opacity: 0.78,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  selectValue: {
    flex: 1,
  },
  stack: {
    gap: spacing.lg,
  },
  table: {
    flexDirection: 'column',
  },
});
