/**
 * Ingest X-Ray — per-field statistics table (native parity port of
 * web/src/features/admin/components/ingest-xray/XRayFieldsTable.tsx).
 *
 * Sortable by sample_count + last_seen_at so an operator can immediately
 * answer "which field hasn't arrived recently?" or "which field is the
 * loudest?".
 *
 * Browser-only / unconverted web dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L8): replaced by the established
 *     native-safe `useNativeTranslationFallback` returning `t(key, fallback)
 *     => fallback` (the sibling ClientUtilitiesSection / HttpStatusTool
 *     precedent). Every i18n key + English default is preserved verbatim.
 *   - `@/components/ui` `Badge` / `DataTable` / `useSortToggle` / `type Column`
 *     (web L10-15): none have a native parity port yet, so minimal native-safe
 *     equivalents are reproduced locally (the established "reproduce locally
 *     when no native parity port exists" precedent) — a chip-style neutral
 *     `Badge`, a controlled-sort `DataTable<T>` supporting exactly the props
 *     this component passes (columns/sort/pagination/mobileColumns), the
 *     `useSortToggle` hook (verbatim sortKey/sortDir/onSort semantics), and
 *     the `Column<T>` shape (key/header/render/sortable/visibleOnMobile/align).
 *   - `@/components/data-display` `TimeStamp` (web L16): reproduced locally as a
 *     native `TimeStamp` that renders the relative label (the web component's
 *     `format="relative"` body). The web hover Tooltip showing the absolute
 *     alternate is a DOM-hover affordance with no native analog, so it is
 *     dropped (documented).
 *   - `@/lib/numberFormat` `fmtInt` (web L17): reproduced locally as a faithful
 *     `fmtInt(v) -> safeNumber(v).toLocaleString('en-US', { 0 fraction digits })`.
 *   - `formatValueKind` + `IngestXRayFieldStat` (web L18-19): imported from the
 *     already-converted native parity hook `../../../../api/hooks/useIngestXRay`
 *     (the web type lives in `@/types/admin-diagnostics`; the native hook
 *     re-exports the identical {field, sample_count, last_seen_at, value_kind}
 *     shape, so it is the single native source of truth).
 *   - The web responsive Tailwind/`var(--text-*)` styling maps to native
 *     StyleSheet + theme tokens. `mobileColumns` / `visibleOnMobile` are ported
 *     verbatim as table metadata; on the single-column native surface the full
 *     four-column table is rendered (matching the existing native DataTable
 *     precedents and preserving the Kind-badge visual intent).
 */
import React, {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../../theme/tokens';
import {
  formatValueKind,
  type IngestXRayFieldStat,
} from '../../../../api/hooks/useIngestXRay';

/* ── native translation fallback (native-safe port of react-i18next) ── */

type NativeTFunction = (key: string, fallback: string) => string;

/** Mirrors `t(key, default)`: returns the English default. */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ── fmtInt (native-safe port of `@/lib/numberFormat` fmtInt) ── */

/** Format as integer with locale separators: fmtInt(12345.6) -> "12,346". */
export function fmtInt(v: unknown): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/* ── TimeStamp (native-safe port of `@/components/data-display` TimeStamp) ── */

/**
 * Relative label for an ISO/epoch/Date value, mirroring the web
 * `formatRelative`: "just now" (<60s), "Xm ago" (<60m), "Xh ago" (<24h),
 * "Xd ago" (<7d), else a short absolute date. Renders the universal "—"
 * placeholder for null / unparseable values.
 */
function formatRelative(value: string | number | Date | null | undefined): string {
  if (value == null) {
    return '\u2014';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '\u2014';
  }
  const diff = Date.now() - date.getTime();
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
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function TimeStamp({
  value,
  testID,
}: {
  value: string | number | Date | null | undefined;
  testID?: string;
}) {
  return (
    <AppText style={styles.timestamp} testID={testID} tone="secondary">
      {formatRelative(value)}
    </AppText>
  );
}

/* ── Badge (native-safe port of `@/components/ui` Badge, variant="neutral") ── */

function Badge({children, testID}: {children: ReactNode; testID?: string}) {
  return (
    <View style={styles.badge} testID={testID}>
      <AppText style={styles.badgeText}>{children}</AppText>
    </View>
  );
}

/* ── Local native-safe DataTable (reproduce `@/components/ui` DataTable) ── */

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  /** Web responsive metadata: shown at <md viewports. Ported verbatim. */
  visibleOnMobile?: boolean;
  /** Right-align numeric columns; default 'left'. */
  align?: 'left' | 'center' | 'right';
}

export interface PaginationConfig {
  defaultPageSize?: number;
  pageSizeOptions?: number[];
}

type SortDir = 'asc' | 'desc';

interface DataTableProps<T> {
  tableId: string;
  name: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  sortKey?: string;
  sortDir?: SortDir;
  onSort?: (key: string) => void;
  emptyMessage?: string;
  pagination?: PaginationConfig;
  /** Web responsive allow-list. Ported verbatim as table metadata. */
  mobileColumns?: string[];
}

/**
 * Controlled-sort hook — verbatim semantics of `@/components/ui`
 * `useSortToggle`: tapping the active key flips direction, tapping a new key
 * selects it and resets to 'desc'.
 */
export function useSortToggle(defaultKey?: string, defaultDir: SortDir = 'desc') {
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

  return {sortKey, sortDir, onSort};
}

const SORT_GLYPH = {
  asc: '\u25B2',
  desc: '\u25BC',
  none: '\u2195',
} as const;

function alignStyle(align?: 'left' | 'center' | 'right'): {
  cell: ViewStyle;
  text: TextStyle;
} {
  if (align === 'right') {
    return {cell: {justifyContent: 'flex-end'}, text: {textAlign: 'right'}};
  }
  if (align === 'center') {
    return {cell: {justifyContent: 'center'}, text: {textAlign: 'center'}};
  }
  return {cell: {justifyContent: 'flex-start'}, text: {textAlign: 'left'}};
}

function isTextNode(node: ReactNode): node is string | number {
  return typeof node === 'string' || typeof node === 'number';
}

function DataTable<T>({
  tableId,
  name,
  columns,
  data,
  keyExtractor,
  sortKey,
  sortDir,
  onSort,
  emptyMessage = 'No data',
  pagination,
}: DataTableProps<T>) {
  const defaultPageSize = pagination?.defaultPageSize ?? 25;
  const pageSizeOptions = pagination?.pageSizeOptions ?? [20, 50, 100];

  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(1);

  const pageCount =
    pagination && data.length > 0 ? Math.ceil(data.length / pageSize) : 1;
  const safePage = Math.min(page, pageCount);
  const visible = pagination
    ? data.slice((safePage - 1) * pageSize, safePage * pageSize)
    : data;

  const changePageSize = useCallback((next: number) => {
    setPageSize(next);
    setPage(1);
  }, []);

  return (
    <View accessibilityLabel={name} style={styles.table} testID={tableId}>
      <View style={[styles.row, styles.headerRow]}>
        {columns.map(col => {
          const {cell, text} = alignStyle(col.align);
          const active = col.sortable && sortKey === col.key;
          const glyph = !col.sortable
            ? null
            : active
              ? SORT_GLYPH[sortDir ?? 'desc']
              : SORT_GLYPH.none;
          const headerInner = (
            <>
              <AppText
                numberOfLines={1}
                style={[styles.headerText, text]}
                tone="secondary"
                weight="semibold">
                {col.header}
              </AppText>
              {glyph ? (
                <AppText style={styles.sortGlyph} tone={active ? 'accent' : 'muted'}>
                  {` ${glyph}`}
                </AppText>
              ) : null}
            </>
          );
          return col.sortable && onSort ? (
            <Pressable
              accessibilityRole="button"
              key={col.key}
              onPress={() => onSort(col.key)}
              style={[styles.cell, cell]}
              testID={`${tableId}-header-${col.key}`}>
              {headerInner}
            </Pressable>
          ) : (
            <View
              key={col.key}
              style={[styles.cell, cell]}
              testID={`${tableId}-header-${col.key}`}>
              {headerInner}
            </View>
          );
        })}
      </View>

      {visible.length === 0 ? (
        <View style={styles.emptyRow} testID={`${tableId}-empty`}>
          <AppText style={styles.emptyText} tone="muted">
            {emptyMessage}
          </AppText>
        </View>
      ) : (
        visible.map(row => {
          const rowKey = keyExtractor(row);
          return (
            <View
              key={String(rowKey)}
              style={[styles.row, styles.bodyRow]}
              testID={`${tableId}-row-${rowKey}`}>
              {columns.map(col => {
                const {cell, text} = alignStyle(col.align);
                const content = col.render(row);
                return (
                  <View key={col.key} style={[styles.cell, cell]}>
                    {isTextNode(content) ? (
                      <AppText numberOfLines={1} style={[styles.cellText, text]}>
                        {content}
                      </AppText>
                    ) : (
                      content
                    )}
                  </View>
                );
              })}
            </View>
          );
        })
      )}

      {pagination && data.length > 0 ? (
        <View style={styles.pager} testID={`${tableId}-pager`}>
          <View style={styles.pageSizeRow}>
            {pageSizeOptions.map(size => {
              const selected = size === pageSize;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={size}
                  onPress={() => changePageSize(size)}
                  style={({pressed}) => [
                    styles.pageSizeChip,
                    selected && styles.pageSizeChipActive,
                    pressed && styles.pressed,
                  ]}
                  testID={`${tableId}-pagesize-${size}`}>
                  <AppText
                    style={styles.pageSizeText}
                    tone={selected ? 'accent' : 'muted'}>
                    {String(size)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.pagerNav}>
            <Pressable
              accessibilityRole="button"
              disabled={safePage <= 1}
              onPress={() => setPage(p => Math.max(1, p - 1))}
              style={({pressed}) => [
                styles.pagerButton,
                (safePage <= 1 || pressed) && styles.pressed,
              ]}
              testID={`${tableId}-pager-prev`}>
              <AppText style={styles.pagerLabel} tone="secondary">
                {'\u2039'}
              </AppText>
            </Pressable>
            <AppText
              style={styles.pagerInfo}
              testID={`${tableId}-pager-info`}
              tone="muted">
              {`${safePage} / ${pageCount}`}
            </AppText>
            <Pressable
              accessibilityRole="button"
              disabled={safePage >= pageCount}
              onPress={() => setPage(p => Math.min(pageCount, p + 1))}
              style={({pressed}) => [
                styles.pagerButton,
                (safePage >= pageCount || pressed) && styles.pressed,
              ]}
              testID={`${tableId}-pager-next`}>
              <AppText style={styles.pagerLabel} tone="secondary">
                {'\u203A'}
              </AppText>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   XRayFieldsTable — sortable per-field statistics table
   ═══════════════════════════════════════════════════════════════════════ */

interface XRayFieldsTableProps {
  rows: IngestXRayFieldStat[];
  loading: boolean;
}

export function XRayFieldsTable({rows, loading}: XRayFieldsTableProps) {
  const t = useNativeTranslationFallback();
  const {sortKey, sortDir, onSort} = useSortToggle('sample_count', 'desc');

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'field':
        return a.field.localeCompare(b.field) * dir;
      case 'sample_count':
        return (a.sample_count - b.sample_count) * dir;
      case 'last_seen_at':
        return (Date.parse(a.last_seen_at) - Date.parse(b.last_seen_at)) * dir;
      case 'value_kind':
        return (a.value_kind - b.value_kind) * dir;
      default:
        return 0;
    }
  });

  const columns: Column<IngestXRayFieldStat>[] = [
    {
      key: 'field',
      header: t('admin.xray.fields.cols.field', 'Field'),
      sortable: true,
      visibleOnMobile: true,
      render: row => (
        <AppText numberOfLines={1} style={styles.fieldText}>
          {row.field}
        </AppText>
      ),
    },
    {
      key: 'sample_count',
      header: t('admin.xray.fields.cols.count', 'Samples'),
      sortable: true,
      align: 'right',
      visibleOnMobile: true,
      render: row => fmtInt(row.sample_count),
    },
    {
      key: 'last_seen_at',
      header: t('admin.xray.fields.cols.lastSeen', 'Last seen'),
      sortable: true,
      visibleOnMobile: true,
      render: row => <TimeStamp value={row.last_seen_at} />,
    },
    {
      key: 'value_kind',
      header: t('admin.xray.fields.cols.kind', 'Kind'),
      sortable: true,
      render: row => <Badge>{formatValueKind(row.value_kind)}</Badge>,
    },
  ];

  const mobileColumns = useMemo(() => ['field', 'sample_count', 'last_seen_at'], []);

  return (
    <GlassPanel style={styles.panel}>
      <DataTable<IngestXRayFieldStat>
        tableId="admin:xray-fields"
        name="xray-fields"
        columns={columns}
        data={sorted}
        keyExtractor={row => row.field}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={onSort}
        emptyMessage={
          loading
            ? t('admin.xray.fields.loading', 'Loading\u2026')
            : t(
                'admin.xray.fields.empty',
                'No samples in this window. Try widening the window or confirm the vehicle is publishing.',
              )
        }
        pagination={{defaultPageSize: 50, pageSizeOptions: [25, 50, 100]}}
        mobileColumns={mobileColumns}
      />
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: spacing.sm,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerRow: {
    backgroundColor: colors.surfaceRaised,
  },
  bodyRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerText: {
    fontSize: typography.caption,
  },
  sortGlyph: {
    fontSize: typography.caption,
  },
  cellText: {
    fontSize: typography.caption,
    color: colors.textPrimary,
  },
  fieldText: {
    fontFamily: 'monospace',
    fontSize: typography.caption,
    color: colors.textPrimary,
  },
  timestamp: {
    fontSize: typography.caption,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  emptyRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.caption,
    textAlign: 'center',
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pageSizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pageSizeChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pageSizeChipActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  pageSizeText: {
    fontSize: typography.caption,
  },
  pagerNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pagerButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pagerLabel: {
    fontSize: 14,
  },
  pagerInfo: {
    fontSize: typography.caption,
  },
  pressed: {
    opacity: 0.5,
  },
});
