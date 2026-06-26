// Native parity port of
// web/src/features/admin/components/feature-flags/ChangesPanel.tsx.
//
// Feature Flags — change-audit panel. Renders the recent flag-change log,
// optionally scoped to a single flag key. The panel always renders its own
// loading + empty states in-place rather than gating the whole page: when there
// are zero rows and we are not loading it returns an EmptyState; otherwise it
// returns a table whose own emptyMessage carries the "Loading audit log…" copy
// while a request is in flight. The web behaviour is preserved exactly,
// including the scopedKey-driven tableId and the loading-vs-empty message
// routing.
//
// Web dependencies absent from the native parity manifest are made native-safe
// (contract rules 4 & 5) and documented in the sidecar:
//
//   - react-i18next `useTranslation` (web L8) -> inlined useNativeTranslation():
//     a stable (key, fallback, options?) => fallback-with-{{interpolation}} shim
//     (the established QueryError / EditConflictBanner pattern). Every i18n key +
//     default string is preserved, including the scopedKey `{{key}}`
//     interpolation in the scoped empty message.
//   - `@/components/ui` Badge / DataTable / `Column<T>` (web L10): no native
//     module. Badge -> an inline variant pill (success/danger/neutral, mirroring
//     `OP_VARIANT[op] ?? 'neutral'`). DataTable -> a static native table (header +
//     rows keyed by `keyExtractor`) wrapped in a horizontal ScrollView so all
//     seven audit columns stay reachable on a phone without hiding any data, with
//     the `defaultPageSize: 25` + `pageSizeOptions: [25, 50, 100]` paging
//     preserved (prev/next pager + page-size chips). `Column<T>` is carried as a
//     native-pragmatic subset (key/header/visibleOnMobile/render); the web
//     table's sort / resize / column-visibility menu / virtualization have no
//     analogue in this static native table. The web `mobileColumns` allow-list
//     (and per-column `visibleOnMobile`) is honoured by de-emphasising the header
//     of any column outside the allow-list, mirroring the web `<md` priority
//     without dropping columns.
//   - `@/components/data-display` TimeStamp (web L11) -> the already-ported native
//     web-parity TimeStamp (same `value` + `format="absolute"`).
//   - `@/components/feedback` EmptyState (web L12) -> the native EmptyState
//     (title + message; the web call intentionally passes no action — the
//     "no-action" comment — so none is supplied here).
//   - `@/types/admin-diagnostics` FeatureFlagChange / FeatureFlagOperation
//     (web L13-16): the native types module is not yet ported, so the two types
//     are mirrored locally and re-exported to keep this file self-contained and
//     typecheck-clean.
//
// CSS vars / Tailwind map to tokens: --text-muted -> colors.textMuted,
// font-mono -> a Platform-selected monospace family, text-xs -> AppText
// variant="caption". No DOM-only modules, HTML elements, Recharts, Leaflet, or
// web UI components are imported — only react, react-native primitives, and
// existing apps/native components / tokens.

import React, {useCallback, useMemo, useState, type ReactNode} from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import {TimeStamp} from '../../../../components/data-display/TimeStamp';

/**
 * Native mirror of web/src/types/admin-diagnostics.ts `FeatureFlagOperation`
 * (native types module not yet ported). Operation enum from
 * internal/database/feature_flag_changes_repo.go.
 */
export type FeatureFlagOperation = 'set' | 'delete';

/**
 * Native mirror of web/src/types/admin-diagnostics.ts `FeatureFlagChange`. Flag
 * values are stored as JSON in Postgres and surface here as `unknown`.
 */
export interface FeatureFlagChange {
  id: number;
  changed_at: string;
  actor: string;
  actor_ip: string;
  flag_key: string;
  operation: FeatureFlagOperation;
  old_value: unknown;
  new_value: unknown;
  reason: string;
  trace_id: string;
}

interface ChangesPanelProps {
  rows: FeatureFlagChange[];
  loading: boolean;
  scopedKey?: string | null;
}

/** Badge tone vocabulary used by the operation pill. */
type BadgeVariant = 'success' | 'danger' | 'neutral';

/**
 * Native-pragmatic subset of the web `@/components/ui` DataTable `Column<T>`.
 * Only the fields this panel consumes are carried; the web table's interactive
 * column features (sortable / resizable / visibility menu / widths) have no
 * analogue in this static native table.
 */
export interface Column<T> {
  key: string;
  header: string;
  visibleOnMobile?: boolean;
  render: (row: T) => ReactNode;
}

const OP_VARIANT: Record<FeatureFlagOperation, 'success' | 'danger'> = {
  set: 'success',
  delete: 'danger',
};

const COLUMN_WIDTH = 150;

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  macos: 'Menlo',
  android: 'monospace',
  windows: 'Consolas',
  default: 'monospace',
});

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

// react-i18next useTranslation replacement: returns the English fallback,
// reproducing i18next `{{name}}` interpolation against that fallback copy.
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

function compact(value: unknown): string {
  if (value == null) return '—';
  try {
    const s = JSON.stringify(value);
    if (s && s.length > 60) return `${s.slice(0, 57)}…`;
    return s ?? '—';
  } catch {
    return '—';
  }
}

function Badge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeToneStyles[variant]]}>
      <AppText
        style={[styles.badgeLabel, badgeTextStyles[variant]]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

interface DataTableProps<T> {
  tableId: string;
  name: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  emptyMessage: string;
  pagination?: {defaultPageSize?: number; pageSizeOptions?: number[]};
  mobileColumns?: string[];
}

function DataTable<T>({
  tableId,
  name,
  columns,
  data,
  keyExtractor,
  emptyMessage,
  pagination,
  mobileColumns,
}: DataTableProps<T>) {
  const defaultPageSize = pagination?.defaultPageSize ?? 25;
  const pageSizeOptions = pagination?.pageSizeOptions ?? [20, 50, 100];
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(0);

  // Mirror the web mobile allow-list: explicit `mobileColumns`, else the
  // columns flagged `visibleOnMobile`, else null (treat every column as primary).
  const mobileSet = useMemo(() => {
    if (mobileColumns) return new Set(mobileColumns);
    const derived = columns.filter(c => c.visibleOnMobile).map(c => c.key);
    return derived.length > 0 ? new Set(derived) : null;
  }, [mobileColumns, columns]);

  const pageCount = Math.max(1, Math.ceil(data.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * pageSize;
  const visibleRows = data.slice(start, start + pageSize);

  if (data.length === 0) {
    return (
      <View style={styles.tableEmpty} testID={tableId}>
        <AppText tone="muted" variant="caption">
          {emptyMessage}
        </AppText>
      </View>
    );
  }

  return (
    <View accessibilityLabel={name} testID={tableId}>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            {columns.map(column => (
              <View key={column.key} style={styles.cell}>
                <AppText
                  style={styles.headerCellText}
                  tone={
                    mobileSet && !mobileSet.has(column.key) ? 'muted' : 'secondary'
                  }
                  variant="caption"
                  weight="semibold">
                  {column.header}
                </AppText>
              </View>
            ))}
          </View>
          {visibleRows.map(row => (
            <View key={String(keyExtractor(row))} style={[styles.row, styles.bodyRow]}>
              {columns.map(column => (
                <View key={column.key} style={styles.cell}>
                  {column.render(row)}
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      <TableFooter
        currentPage={currentPage}
        onPageChange={setPage}
        onPageSizeChange={size => {
          setPageSize(size);
          setPage(0);
        }}
        pageCount={pageCount}
        pageSize={pageSize}
        pageSizeOptions={pageSizeOptions}
      />
    </View>
  );
}

interface TableFooterProps {
  currentPage: number;
  pageCount: number;
  pageSize: number;
  pageSizeOptions: number[];
  onPageChange: (updater: (prev: number) => number) => void;
  onPageSizeChange: (size: number) => void;
}

function TableFooter({
  currentPage,
  pageCount,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: TableFooterProps) {
  const showPager = pageCount > 1;
  const showSizes = pageSizeOptions.length > 1;
  if (!showPager && !showSizes) {
    return null;
  }

  return (
    <View style={styles.footer}>
      {showSizes ? (
        <View style={styles.pageSizeRow}>
          {pageSizeOptions.map(size => {
            const active = size === pageSize;
            return (
              <Pressable
                key={size}
                accessibilityRole="button"
                accessibilityState={{selected: active}}
                hitSlop={4}
                onPress={() => onPageSizeChange(size)}
                style={({pressed}) => [
                  styles.sizeChip,
                  active && styles.sizeChipActive,
                  pressed && styles.pressed,
                ]}>
                <AppText
                  style={styles.sizeChipLabel}
                  tone={active ? 'accent' : 'muted'}
                  variant="caption"
                  weight="semibold">
                  {String(size)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {showPager ? (
        <View style={styles.pager}>
          <Pressable
            accessibilityLabel="Previous page"
            accessibilityRole="button"
            accessibilityState={{disabled: currentPage === 0}}
            disabled={currentPage === 0}
            hitSlop={8}
            onPress={() => onPageChange(p => Math.max(0, p - 1))}
            style={({pressed}) => [
              styles.pagerButton,
              currentPage === 0 && styles.disabled,
              pressed && currentPage !== 0 && styles.pressed,
            ]}>
            <SemanticIcon decorative name="previous" size="sm" style={styles.pagerIcon} />
          </Pressable>
          <AppText style={styles.pagerLabel} tone="muted" variant="caption">
            {`${currentPage + 1} / ${pageCount}`}
          </AppText>
          <Pressable
            accessibilityLabel="Next page"
            accessibilityRole="button"
            accessibilityState={{disabled: currentPage >= pageCount - 1}}
            disabled={currentPage >= pageCount - 1}
            hitSlop={8}
            onPress={() => onPageChange(p => Math.min(pageCount - 1, p + 1))}
            style={({pressed}) => [
              styles.pagerButton,
              currentPage >= pageCount - 1 && styles.disabled,
              pressed && currentPage < pageCount - 1 && styles.pressed,
            ]}>
            <SemanticIcon decorative name="next" size="sm" style={styles.pagerIcon} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function ChangesPanel({rows, loading, scopedKey}: ChangesPanelProps) {
  const t = useNativeTranslation();

  const columns: Column<FeatureFlagChange>[] = [
    {
      key: 'changed_at',
      header: t('admin.flags.audit.cols.changedAt', 'Changed at'),
      visibleOnMobile: true,
      render: row => <TimeStamp value={row.changed_at} format="absolute" />,
    },
    {
      key: 'actor',
      header: t('admin.flags.audit.cols.actor', 'Actor'),
      visibleOnMobile: true,
      render: row => (
        <AppText style={styles.mono} tone="muted" variant="caption">
          {row.actor || '—'}
        </AppText>
      ),
    },
    {
      key: 'flag_key',
      header: t('admin.flags.audit.cols.flagKey', 'Key'),
      render: row => (
        <AppText style={styles.mono} variant="caption">
          {row.flag_key}
        </AppText>
      ),
    },
    {
      key: 'operation',
      header: t('admin.flags.audit.cols.operation', 'Op'),
      visibleOnMobile: true,
      render: row => (
        <Badge variant={OP_VARIANT[row.operation] ?? 'neutral'}>
          {row.operation}
        </Badge>
      ),
    },
    {
      key: 'old_value',
      header: t('admin.flags.audit.cols.oldValue', 'Old'),
      render: row => (
        <AppText style={styles.mono} tone="muted" variant="caption">
          {compact(row.old_value)}
        </AppText>
      ),
    },
    {
      key: 'new_value',
      header: t('admin.flags.audit.cols.newValue', 'New'),
      render: row => (
        <AppText style={styles.mono} tone="muted" variant="caption">
          {compact(row.new_value)}
        </AppText>
      ),
    },
    {
      key: 'reason',
      header: t('admin.flags.audit.cols.reason', 'Reason'),
      render: row => (
        <AppText tone="muted" variant="caption">
          {row.reason || '—'}
        </AppText>
      ),
    },
  ];

  if (!loading && rows.length === 0) {
    return (
      <EmptyState
        title={t('admin.flags.audit.empty.title', 'No flag changes yet')}
        message={
          scopedKey
            ? t(
                'admin.flags.audit.empty.scopedMessage',
                'No audit rows for "{{key}}" — edit the value above to start the trail.',
                {key: scopedKey},
              )
            : t(
                'admin.flags.audit.empty.globalMessage',
                'Flag changes will appear here once an operator edits a value.',
              )
        }
      />
    );
  }

  return (
    <DataTable<FeatureFlagChange>
      columns={columns}
      data={rows}
      emptyMessage={
        loading
          ? t('admin.flags.audit.loading', 'Loading audit log…')
          : t('admin.flags.audit.empty.title', 'No flag changes yet')
      }
      keyExtractor={row => row.id}
      mobileColumns={['changed_at', 'actor', 'operation']}
      name="flag-changes"
      pagination={{defaultPageSize: 25, pageSizeOptions: [25, 50, 100]}}
      tableId={scopedKey ? 'admin:flag-changes-scoped' : 'admin:flag-changes'}
    />
  );
}

const styles = StyleSheet.create({
  table: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableEmpty: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  headerRow: {
    backgroundColor: colors.surfaceSelected,
  },
  bodyRow: {
    backgroundColor: colors.surfaceRaised,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  cell: {
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    width: COLUMN_WIDTH,
  },
  headerCellText: {
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  mono: {
    fontFamily: MONO_FONT,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  pageSizeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  sizeChip: {
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  sizeChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  sizeChipLabel: {
    letterSpacing: 0.2,
  },
  pager: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  pagerButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  pagerIcon: {
    borderWidth: 0,
  },
  pagerLabel: {
    minWidth: 36,
    textAlign: 'center',
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeLabel: {
    letterSpacing: 0.2,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.82,
  },
});

const badgeToneStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  success: {
    color: colors.success,
  },
  danger: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textMuted,
  },
});
