// Native parity port of web/src/features/admin/pages/DiskForecastPage.tsx.
//
// Disk Forecast page: per-hypertable disk usage with a compressed/uncompressed
// split, growth rate (bytes/day), and an estimate of days-to-quota when the
// deployment configured `HYPERTABLE_QUOTA_BYTES`. Severity comes straight from
// the backend so threshold tuning is a single Go ship. Backed by
// GET /api/v1/admin/observability/disk-forecast.
//
// Every web behavior + state name is preserved (the `useDiskForecast` query,
// `subsystemMissing` 503 detection, `rows`, the `fleetTotals` useMemo reducer,
// the `columns` useMemo, the four StatCard fleet totals, and the
// empty/loading/subsystem branching). The web DOM/Tailwind stack is replaced
// with React Native primitives + the native parity component library:
//
//   - `@/components/layout` `PageContainer` (title/subtitle/`query`) has no
//     native parity component, so a local screen scaffold reproduces the header
//     (title + subtitle), the query-driven freshness chip via the native
//     `StatusPill`, and the `PageErrorBoundary` wrapper via the native
//     `ErrorBoundary`.
//   - `@/components/ui` `DataTable`/`Column` is a browser <table>; it becomes a
//     native header row + data rows inside a horizontal `ScrollView` so every
//     column stays usable on a phone, preserving the `align` + `render` config,
//     `keyExtractor` (row key = `hypertable_name`), and the `emptyMessage`.
//   - `@/components/ui` `Badge` (variant chip) becomes a local themed
//     `SeverityBadge`; `@/components/feedback` `AlertBanner` becomes a local
//     `WarningBanner`; `PanelTitle`/`Caption` become themed `AppText`.
//   - `@/components/data-display` `StatCard` and `@/components/feedback`
//     `EmptyState` reuse the already-ported native parity components.
//   - `@/components/motion` `FadeIn` becomes a reduced-motion-aware mount fade.
//   - `@/components/feedback` `SectionErrorBoundary name="disk-forecast-table"`
//     becomes the native `ErrorBoundary` in `inline` mode (same default inline
//     fallback + Retry the web SectionErrorBoundary defers to).
//   - lucide-react `Database` (decorative empty-state glyph) has no native icon
//     dependency; the native `EmptyState` carries the meaning via title/message.
//   - `@/lib/numberFormat` `formatBytes`/`fmtNumber` are inlined native-safe
//     (binary units incl. GB; locale precision defaults to the web global 2),
//     matching the EntriesTable parity precedent.
//   - `@/lib/resilience` `isApiError` reuses the native parity client export.
//   - `@/hooks/usePageTitle` (sets document.title) is a native no-op shim — RN
//     has no document — but the `t()` title call is preserved.
//   - react-i18next `useTranslation` becomes a local fallback shim that still
//     interpolates `{{count}}`/`{{pct}}` so every `admin.diskForecast.*` key +
//     English copy is preserved verbatim.

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
  useDiskForecast,
  type DiskForecastSeverity,
  type HypertableSize,
} from '../../../api/hooks/useOperatorConfidence';
import {StatCard} from '../../../components/data-display/StatCard';
import {ErrorBoundary} from '../../../components/feedback/ErrorBoundary';

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

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) {
    return '\u2014';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/* ─── severity maps (carried over verbatim from the web source) ────────────── */

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

const SEVERITY_VARIANT: Record<DiskForecastSeverity, BadgeVariant> = {
  ok: 'success',
  warn: 'warning',
  critical: 'danger',
  unknown: 'neutral',
};

const SEVERITY_LABEL: Record<DiskForecastSeverity, string> = {
  ok: 'OK',
  warn: 'Warn',
  critical: 'Critical',
  unknown: '\u2014',
};

/* ─── Column type (web `@/components/ui` DataTable export) ──────────────────── */

interface Column {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: HypertableSize) => ReactNode;
}

const COLUMN_WIDTHS: Record<string, number> = {
  days: 120,
  growth: 132,
  hypertable: 208,
  severity: 112,
  split: 188,
  total: 116,
};

const DEFAULT_WIDTH = 140;

/* ─── SeverityBadge (web `@/components/ui` Badge) ──────────────────────────── */

function SeverityBadge({label, variant}: {label: string; variant: BadgeVariant}) {
  return (
    <View style={[styles.badge, badgeStyles[variant]]}>
      <AppText style={[styles.badgeText, badgeTextStyles[variant]]} variant="caption" weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

SeverityBadge.displayName = 'SeverityBadge';

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

function DataCell({column, row}: {column: Column; row: HypertableSize}) {
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

/* ─── DiskForecastPage ─────────────────────────────────────────────────────── */

export default function DiskForecastPage() {
  const t = useNativeTranslationFallback();
  usePageTitle(t('admin.diskForecast.pageTitle', 'Disk Forecast'));

  const query = useDiskForecast();
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;
  const rows = useMemo(() => query.data?.hypertables ?? [], [query.data]);

  const fleetTotals = useMemo(() => {
    const total = rows.reduce((acc, r) => acc + r.total_bytes, 0);
    const uncompressed = rows.reduce((acc, r) => acc + r.uncompressed_bytes, 0);
    const compressed = rows.reduce((acc, r) => acc + r.compressed_bytes, 0);
    const growth = rows.reduce((acc, r) => acc + r.growth_bytes_per_day, 0);
    return {total, uncompressed, compressed, growth};
  }, [rows]);

  const columns = useMemo<Column[]>(
    () => [
      {
        key: 'hypertable',
        header: t('admin.diskForecast.colTable', 'Hypertable'),
        render: r => (
          <View style={styles.tableNameCell}>
            <AppText numberOfLines={1} style={styles.tableName} weight="semibold">
              {r.hypertable_name}
            </AppText>
            <AppText style={styles.caption} tone="muted" variant="caption">
              {t('admin.diskForecast.chunkCount', '{{count}} chunks', {
                count: r.chunk_count,
              })}
            </AppText>
          </View>
        ),
      },
      {
        key: 'total',
        header: t('admin.diskForecast.colTotal', 'Total'),
        align: 'right',
        render: r => <AppText style={styles.numeric}>{formatBytes(r.total_bytes)}</AppText>,
      },
      {
        key: 'split',
        header: t('admin.diskForecast.colSplit', 'Uncompressed / compressed'),
        align: 'right',
        render: r => (
          <View style={styles.splitCell}>
            <AppText style={styles.numeric}>{formatBytes(r.uncompressed_bytes)}</AppText>
            <AppText style={styles.caption} tone="muted" variant="caption">
              {`${formatBytes(r.compressed_bytes)} ${t('admin.diskForecast.compressedSuffix', 'compressed')}`}
            </AppText>
          </View>
        ),
      },
      {
        key: 'growth',
        header: t('admin.diskForecast.colGrowth', 'Growth (per day)'),
        align: 'right',
        render: r => (
          <AppText style={styles.numeric}>{`${formatBytes(r.growth_bytes_per_day)}/d`}</AppText>
        ),
      },
      {
        key: 'days',
        header: t('admin.diskForecast.colDays', 'Days to quota'),
        align: 'right',
        render: r => (
          <AppText style={styles.numeric}>
            {r.est_days_to_quota === null || r.est_days_to_quota === undefined
              ? '\u2014'
              : fmtNumber(r.est_days_to_quota)}
          </AppText>
        ),
      },
      {
        key: 'severity',
        header: t('admin.diskForecast.colSeverity', 'Severity'),
        align: 'right',
        render: r => (
          <SeverityBadge
            label={SEVERITY_LABEL[r.severity] ?? r.severity}
            variant={SEVERITY_VARIANT[r.severity] ?? 'neutral'}
          />
        ),
      },
    ],
    [t],
  );

  const fullTableWidth = tableWidth(columns);
  const showEmptyState =
    rows.length === 0 && !query.isLoading && !subsystemMissing;

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="admin-disk-forecast">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {t('admin.diskForecast.pageTitle', 'Disk Forecast')}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {t(
              'admin.diskForecast.subtitle',
              'Per-hypertable disk usage with compressed/uncompressed split and days-to-quota estimate. Severity reflects the configured quota threshold.',
            )}
          </AppText>
        </View>
        <FreshnessChip query={query} t={t} />
      </View>

      <ErrorBoundary name="disk-forecast-page">
        <FadeIn>
          <View style={styles.stack}>
            {subsystemMissing ? (
              <WarningBanner title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}>
                {t(
                  'admin.diskForecast.notConfigured',
                  'TimescaleDB hypertable metrics are unavailable on this deployment. This page requires TimescaleDB to be installed and accessible.',
                )}
              </WarningBanner>
            ) : null}

            {rows.length > 0 ? (
              <View style={styles.statGrid}>
                <StatCard
                  label={t('admin.diskForecast.fleetTotal', 'Total disk')}
                  style={styles.statCard}
                  sublabel={t('admin.diskForecast.tableCount', '{{count}} hypertables', {
                    count: rows.length,
                  })}
                  value={formatBytes(fleetTotals.total)}
                />
                <StatCard
                  label={t('admin.diskForecast.fleetUncompressed', 'Uncompressed')}
                  style={styles.statCard}
                  sublabel={
                    fleetTotals.total > 0
                      ? t('admin.diskForecast.percentSub', '{{pct}}% of total', {
                          pct: ((fleetTotals.uncompressed / fleetTotals.total) * 100).toFixed(1),
                        })
                      : '\u2014'
                  }
                  value={formatBytes(fleetTotals.uncompressed)}
                />
                <StatCard
                  label={t('admin.diskForecast.fleetCompressed', 'Compressed')}
                  style={styles.statCard}
                  sublabel={
                    fleetTotals.total > 0
                      ? t('admin.diskForecast.percentSub', '{{pct}}% of total', {
                          pct: ((fleetTotals.compressed / fleetTotals.total) * 100).toFixed(1),
                        })
                      : '\u2014'
                  }
                  value={formatBytes(fleetTotals.compressed)}
                />
                <StatCard
                  label={t('admin.diskForecast.fleetGrowth', 'Growth (per day)')}
                  style={styles.statCard}
                  sublabel={t('admin.diskForecast.growthSub', 'Sum across all hypertables')}
                  value={`${formatBytes(fleetTotals.growth)}/d`}
                />
              </View>
            ) : null}

            <View style={styles.panel}>
              <AppText style={styles.panelTitle} weight="semibold">
                {t('admin.diskForecast.tableTitle', 'Hypertables')}
              </AppText>
              <ErrorBoundary inline name="disk-forecast-table">
                {showEmptyState ? (
                  <EmptyState
                    message={t(
                      'admin.diskForecast.emptyMessage',
                      'No hypertables found in this database. The disk forecast surfaces TimescaleDB hypertables only.',
                    )}
                    title={t('admin.diskForecast.emptyTitle', 'No hypertables')}
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
                            {t('admin.diskForecast.emptyTable', 'No hypertables')}
                          </AppText>
                        </View>
                      ) : (
                        rows.map(row => (
                          <View key={row.hypertable_name} style={styles.row}>
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
            </View>
          </View>
        </FadeIn>
      </ErrorBoundary>
    </ScrollView>
  );
}

DiskForecastPage.displayName = 'DiskForecastPage';

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-end',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 16,
  },
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
  caption: {
    lineHeight: 16,
  },
  cell: {
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  cellRight: {
    alignItems: 'flex-end',
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
  panel: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
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
  splitCell: {
    alignItems: 'flex-end',
  },
  stack: {
    gap: spacing.lg,
  },
  statCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  table: {
    flexDirection: 'column',
  },
  tableName: {
    color: colors.textPrimary,
  },
  tableNameCell: {
    gap: 2,
  },
});

const badgeStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
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

const badgeTextStyles = StyleSheet.create({
  danger: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
});
