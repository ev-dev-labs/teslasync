// Native parity port of web/src/components/ui/DataTable.tsx.
//
// `DataTable<T>` is the app's full-featured sortable/glass data table: column
// sorting, single/multi row selection (with shift-range), row expansion,
// pagination, density modes, persisted column visibility + reorder, per-column
// resize, CSV export, react-virtual row virtualization, and per-row right-click
// context menus. The public API (Column<T>, PaginationConfig, DataTableProps<T>,
// the DataTable component, and the useSortToggle / useTableSelection /
// useTableExpansion helper hooks) is preserved verbatim so callers port 1:1.
//
// The web source pulls a large surface of browser/web-only modules with no
// native parity (rule 4/7). None of them have a parity port yet, so this file
// is a self-contained native-safe reimplementation. Mapping decisions:
//   - DOM table markup (<table>/<thead>/<tbody>/<tr>/<td>/<th>) -> View rows +
//     cells. The horizontal `overflow-x-auto` wrapper -> a horizontal
//     ScrollView; `maxHeight` + sticky-thead -> a pinned header View above a
//     vertical ScrollView (native sticky-header equivalent). Columns get fixed
//     widths (defaultWidth ?? DEFAULT_COL_WIDTH) so horizontal scroll works.
//   - lucide-react icons (ChevronUp/Down/Right, AlertTriangle, Download,
//     GripVertical, Loader2) have no native analog and become text glyphs
//     (▲ ▼ ▸ ▾ ⚠ ↓) or, for the export spinner, a React Native
//     ActivityIndicator. All are flagged decorative where the web used
//     aria-hidden.
//   - react-i18next `useTranslation` is absent from native deps -> a local
//     fallback hook returning the inline English fallback, with `{{token}}`
//     interpolation (same approach as the SearchInput / ChartContainer ports).
//     Every i18n key is referenced verbatim so intent is preserved.
//   - `@/lib/cn` (Tailwind class merge) has no native analog; styling moves to
//     StyleSheet + density-derived inline padding. `className` is kept on props
//     for source compatibility but ignored (destructured as `_className`).
//   - `@/lib/columnOrderStore` is localStorage-backed; its pure transforms
//     (applyColumnLayout / defaultColumnLayout / effectiveColumnOrder /
//     moveColumn / toggleHiddenColumn) are ported verbatim, and the
//     localStorage read/write helpers are replaced by an in-process Map keyed
//     by tableId — IDENTICAL logic, session-scoped persistence (does not
//     survive app restart; documented). The one-shot legacy `.visible`
//     migration is dropped (no localStorage to migrate from).
//   - `@/lib/csvExport`: toCSV / escapeCell / defaultExportFilename are ported
//     verbatim. `downloadCSV` is a Blob/anchor browser API with no React Native
//     filesystem/Share dependency available, so it is a documented no-op — the
//     CSV is still generated (exercising toCSV) and `exporting` state still
//     toggles; only the file write is unavailable.
//   - `./Pagination` (DOM <select> + lucide) -> an inline native pagination bar
//     (showing X–Y of Z, pressable page-size chips, « ‹ › » nav) preserving the
//     same prop contract.
//   - `./DataTableColumnMenu` (DOM popover + HTML5 drag) -> a native Modal with
//     per-column visibility checkboxes + up/down reorder buttons + reset,
//     driven by the same ported pure transforms.
//   - `./DataTableBulkBar` -> an inline tinted toolbar row shown when rows are
//     selected (count + clear + caller bulkActions slot).
//   - `./DataTableResizer` + the `resizable` prop's drag-to-resize is a
//     pointer/`col-resize` affordance with no touch analog -> unavailable on
//     native (columns honor defaultWidth; the in-memory width store is read but
//     never written). Documented.
//   - `./ContextMenu`'s right-click `openMenu(items, x, y)` -> row `onLongPress`
//     opening a native action-sheet Modal with the same ContextMenuItem list
//     (the faithful touch mapping for a right-click menu). Screen coords are
//     dropped (the sheet is centered).
//   - `../feedback/SectionErrorBoundary` -> an inline `RowErrorBoundary` class
//     that renders the same "table failed to render" fallback when a cell
//     renderer throws.
//   - `@tanstack/react-virtual` row windowing is absent from native deps; the
//     table renders the full paginated row set inside the (optionally bounded)
//     vertical ScrollView. The `virtualized` flag still drives the bounded-
//     height + pinned-header defaults; `rowHeight` / `overscan` are accepted on
//     the props type but unused on native (documented).
//
// Visual intent: the web `--text-*` / cyan-selection / glass surfaces map to the
// shared native tokens (colors.textPrimary/Secondary/Muted, colors.accent for
// the cyan selection + sort affordances, colors.surface*/border). Tailwind
// spacing -> px (1 unit = 4px). The `density='auto'` mode follows the web
// `ui_density` CSS-variable cascade; native has no such cascade, so it resolves
// statically to the default 'comfortable' paddings (documented).

import React, {
  Component,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

type RowKey = string | number;

// ── Local i18n fallback ───────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback with `{{token}}` interpolation. The hook shape mirrors
// the web `const { t } = useTranslation()` so call sites are unchanged.
type TParams = Record<string, string | number>;
type TFn = (key: string, fallback: string, params?: TParams) => string;

function interpolate(fallback: string, params?: TParams): string {
  if (!params) {
    return fallback;
  }
  return fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const value = params[key];
    return value == null ? match : String(value);
  });
}

function useTranslation(): {t: TFn} {
  const t = useCallback<TFn>(
    (_key, fallback, params) => interpolate(fallback, params),
    [],
  );
  return {t};
}

// ── Column layout transforms (ported verbatim from lib/columnOrderStore) ────
export interface ColumnLayout {
  /** Column-key order. Keys not present here keep their default position
   *  AFTER any present keys (in source order). */
  order: string[];
  /** Column keys hidden by the user. */
  hidden: string[];
}

// In-process replacement for the localStorage-backed column-layout store. Same
// per-tableId keying and shape; session-scoped (not persisted across app
// restarts — documented in the header / sidecar).
const layoutStore = new Map<string, ColumnLayout>();

function getStoredLayout(tableId: string): ColumnLayout | null {
  return layoutStore.get(tableId) ?? null;
}

function setStoredLayout(tableId: string, layout: ColumnLayout): void {
  layoutStore.set(tableId, {order: layout.order, hidden: layout.hidden});
}

function clearStoredLayout(tableId: string): void {
  layoutStore.delete(tableId);
}

function applyColumnLayout<C extends {key: string; defaultVisible?: boolean}>(
  columns: readonly C[],
  layout: ColumnLayout | null,
): C[] {
  if (!layout) {
    return columns.filter(c => c.defaultVisible !== false);
  }
  const knownKeys = new Set(columns.map(c => c.key));
  const hiddenSet = new Set(layout.hidden.filter(k => knownKeys.has(k)));
  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  for (const k of layout.order) {
    if (knownKeys.has(k) && !seen.has(k)) {
      orderedKeys.push(k);
      seen.add(k);
    }
  }
  for (const c of columns) {
    if (!seen.has(c.key)) {
      orderedKeys.push(c.key);
      seen.add(c.key);
    }
  }
  const visibleKeys = orderedKeys.filter(k => !hiddenSet.has(k));
  if (visibleKeys.length === 0) {
    return columns.filter(c => c.defaultVisible !== false);
  }
  const byKey = new Map(columns.map(c => [c.key, c] as const));
  return visibleKeys
    .map(k => byKey.get(k))
    .filter((c): c is C => Boolean(c));
}

function effectiveColumnOrder<C extends {key: string}>(
  columns: readonly C[],
  layout: ColumnLayout | null,
): string[] {
  if (!layout || layout.order.length === 0) {
    return columns.map(c => c.key);
  }
  const knownKeys = new Set(columns.map(c => c.key));
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const k of layout.order) {
    if (knownKeys.has(k) && !seen.has(k)) {
      ordered.push(k);
      seen.add(k);
    }
  }
  for (const c of columns) {
    if (!seen.has(c.key)) {
      ordered.push(c.key);
      seen.add(c.key);
    }
  }
  return ordered;
}

function moveColumn(
  currentOrder: readonly string[],
  key: string,
  toIndex: number,
): string[] {
  const fromIndex = currentOrder.indexOf(key);
  if (fromIndex < 0) {
    return currentOrder.slice();
  }
  const next = currentOrder.slice();
  next.splice(fromIndex, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, key);
  return next;
}

function toggleHiddenColumn(layout: ColumnLayout, key: string): ColumnLayout {
  const isHidden = layout.hidden.includes(key);
  return {
    order: layout.order.slice(),
    hidden: isHidden
      ? layout.hidden.filter(k => k !== key)
      : [...layout.hidden, key],
  };
}

function defaultColumnLayout<C extends {key: string; defaultVisible?: boolean}>(
  columns: readonly C[],
): ColumnLayout {
  return {
    order: columns.map(c => c.key),
    hidden: columns.filter(c => c.defaultVisible === false).map(c => c.key),
  };
}

// ── CSV export (ported verbatim from lib/csvExport) ─────────────────────────
export type CsvCellValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | object;

export interface CsvColumn<T> {
  key: string;
  header?: string;
  accessor?: (row: T) => CsvCellValue;
}

function escapeCell(value: CsvCellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  let str: string;
  if (typeof value === 'string') {
    str = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    str = String(value);
  } else {
    try {
      str = JSON.stringify(value);
    } catch {
      str = String(value);
    }
  }
  if (/[",\r\n]/.test(str) || str !== str.trim()) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): string {
  const header = columns.map(c => escapeCell(c.header ?? c.key)).join(',');
  const body = rows
    .map(row =>
      columns
        .map(c => {
          const v = c.accessor
            ? c.accessor(row)
            : (row as unknown as Record<string, unknown>)[c.key];
          return escapeCell(v as CsvCellValue);
        })
        .join(','),
    )
    .join('\r\n');
  return body.length > 0 ? `${header}\r\n${body}` : header;
}

function defaultExportFilename(prefix: string, date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${prefix}-${yyyy}-${mm}-${dd}`;
}

// Native-safe stand-in for the browser Blob/anchor download. React Native has
// no DOM filesystem download and no Share/FS dependency is available, so the
// generated CSV cannot be written to disk. The CSV is still produced upstream
// (exercising toCSV); this is the documented "unavailable" boundary.
function downloadCSV(_filename: string, _csv: string): void {
  /* unavailable on native — see file header / sidecar */
}

// ── Context menu item (ported from components/ui/ContextMenu) ────────────────
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  shortcut?: string;
}

// ── Public API types (preserved from the web source) ────────────────────────
export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
  defaultVisible?: boolean;
  visibleOnMobile?: boolean;
  defaultWidth?: number | 'auto';
  minWidth?: number;
  maxWidth?: number;
  align?: 'left' | 'center' | 'right';
}

export interface PaginationConfig {
  defaultPageSize?: number;
  pageSizeOptions?: number[];
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => RowKey;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  emptyMessage?: string;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Legacy boolean density toggle. Equivalent to `density='compact'`. */
  compact?: boolean;
  /** Information density for row heights / cell padding. `'auto'` resolves to
   *  'comfortable' on native (no CSS-variable density cascade). */
  density?: 'compact' | 'comfortable' | 'spacious' | 'auto';
  pagination?: boolean | PaginationConfig;
  /** Name for the row error boundary + CSV export filename fallback. */
  name?: string;
  /** Column keys kept visible below the `md` (768px) breakpoint. */
  mobileColumns?: string[];
  /** Stable id used to persist column visibility & order (session-scoped on
   *  native). Required for selection/menu persistence. */
  tableId?: string;
  selectable?: 'single' | 'multi' | 'none';
  selectedKeys?: RowKey[];
  onSelectionChange?: (keys: RowKey[]) => void;
  bulkActions?: (selected: T[]) => ReactNode;
  /** Pin the header above a scrolling body. Defaults to true. */
  stickyHeader?: boolean;
  maxHeight?: number | string;
  expandable?: boolean;
  expandedKeys?: RowKey[];
  onExpandedChange?: (keys: RowKey[]) => void;
  renderExpanded?: (row: T) => ReactNode;
  /** Drag-to-resize columns. Unavailable on native (no col-resize affordance);
   *  columns honor `defaultWidth`. */
  resizable?: boolean;
  /** @deprecated alias for `columnVisibility`. */
  showColumnsMenu?: boolean;
  columnVisibility?: boolean;
  columnReorder?: boolean;
  exportable?: boolean;
  exportFilename?: string;
  exportRow?: (row: T) => Record<string, CsvCellValue>;
  exportAll?: () => Promise<T[]>;
  /** Opt-in virtualization on web. On native the full paginated set renders;
   *  this flag only drives the bounded-height + pinned-header defaults. */
  virtualized?: boolean;
  /** Accepted for source compatibility; unused on native (no react-virtual). */
  rowHeight?: number;
  /** Accepted for source compatibility; unused on native (no react-virtual). */
  overscan?: number;
  rowContextMenu?: (row: T) => ContextMenuItem[];
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_COL_WIDTH = 140;
const LEADING_COL_WIDTH = 44;

interface DensityPadding {
  cellH: number;
  cellV: number;
  headH: number;
  headV: number;
  leadH: number;
  leadV: number;
}

function densityPadding(
  density: 'compact' | 'comfortable' | 'spacious' | 'auto',
): DensityPadding {
  if (density === 'compact') {
    return {cellH: 12, cellV: 8, headH: 12, headV: 8, leadH: 8, leadV: 8};
  }
  if (density === 'spacious') {
    return {cellH: 20, cellV: 16, headH: 20, headV: 16, leadH: 16, leadV: 16};
  }
  // 'comfortable' and 'auto' both resolve to the default density (px-4 py-3 ->
  // 16/12, leading px-3 py-3 -> 12/12). 'auto' has no CSS-variable cascade on
  // native, so it resolves statically here.
  return {cellH: 16, cellV: 12, headH: 16, headV: 12, leadH: 12, leadV: 12};
}

function alignItemsFor(
  align?: 'left' | 'center' | 'right',
): 'flex-start' | 'center' | 'flex-end' {
  if (align === 'right') {
    return 'flex-end';
  }
  if (align === 'center') {
    return 'center';
  }
  return 'flex-start';
}

function textAlignFor(
  align?: 'left' | 'center' | 'right',
): 'left' | 'center' | 'right' {
  return align ?? 'left';
}

// React Native cannot render bare strings/numbers outside <Text>; wrap scalar
// cell/label content in AppText while passing caller-supplied native nodes
// through unchanged (mirrors the InlineCallout renderNode approach).
function renderNode(
  node: ReactNode,
  textStyle?: StyleProp<TextStyle>,
): ReactNode {
  if (node == null || node === false) {
    return null;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return <AppText style={textStyle}>{node}</AppText>;
  }
  return node;
}

// ── Inline row error boundary (replaces SectionErrorBoundary) ───────────────
interface RowErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}
interface RowErrorBoundaryState {
  hasError: boolean;
}
class RowErrorBoundary extends Component<
  RowErrorBoundaryProps,
  RowErrorBoundaryState
> {
  state: RowErrorBoundaryState = {hasError: false};

  static getDerivedStateFromError(): RowErrorBoundaryState {
    return {hasError: true};
  }

  componentDidCatch(): void {
    /* parity: the web SectionErrorBoundary logged to console; swallow here. */
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

// ── Checkbox / radio cell ───────────────────────────────────────────────────
interface CheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  radio?: boolean;
  onPress: () => void;
  label: string;
}
function Checkbox({checked, indeterminate, radio, onPress, label}: CheckboxProps) {
  const on = checked || indeterminate;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole={radio ? 'radio' : 'checkbox'}
      accessibilityState={{checked: indeterminate ? 'mixed' : checked}}
      hitSlop={8}
      onPress={onPress}
      style={[
        styles.checkbox,
        radio && styles.checkboxRadio,
        on && styles.checkboxOn,
      ]}>
      {indeterminate ? (
        <AppText style={styles.checkGlyph}>–</AppText>
      ) : checked ? (
        <AppText style={styles.checkGlyph}>{radio ? '●' : '✓'}</AppText>
      ) : null}
    </Pressable>
  );
}

// ── Expand toggle ───────────────────────────────────────────────────────────
interface ExpandToggleProps {
  expanded: boolean;
  onPress: () => void;
  label: string;
}
function ExpandToggle({expanded, onPress, label}: ExpandToggleProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{expanded}}
      hitSlop={8}
      onPress={onPress}
      style={styles.expandBtn}>
      <AppText style={styles.expandGlyph}>{expanded ? '▾' : '▸'}</AppText>
    </Pressable>
  );
}

// ── Native pagination bar (replaces ./Pagination) ───────────────────────────
interface NativePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions: number[];
  t: TFn;
}
function NativePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions,
  t,
}: NativePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const atStart = page <= 1;
  const atEnd = page >= totalPages;

  const navBtn = (
    glyph: string,
    label: string,
    disabled: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={[styles.pageNavBtn, disabled && styles.pageNavBtnDisabled]}>
      <AppText style={styles.pageNavGlyph}>{glyph}</AppText>
    </Pressable>
  );

  return (
    <View accessibilityRole="toolbar" style={styles.pagination}>
      <AppText style={styles.pageInfo}>
        {t('pagination.showing', 'Showing {{start}}–{{end}} of {{total}}', {
          start: total > 0 ? start : 0,
          end,
          total,
        })}
      </AppText>
      <View style={styles.pageControls}>
        {onPageSizeChange ? (
          <View style={styles.pageSizeRow}>
            {pageSizeOptions.map(size => {
              const active = size === pageSize;
              return (
                <Pressable
                  accessibilityLabel={t('pagination.perPage', '{{count}} / page', {
                    count: size,
                  })}
                  accessibilityRole="button"
                  accessibilityState={{selected: active}}
                  hitSlop={4}
                  key={size}
                  onPress={() => onPageSizeChange(size)}
                  style={[styles.pageSizeChip, active && styles.pageSizeChipOn]}>
                  <AppText
                    style={[
                      styles.pageSizeChipText,
                      active && styles.pageSizeChipTextOn,
                    ]}>
                    {String(size)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <View style={styles.pageNavRow}>
          {navBtn('«', t('pagination.first', 'First page'), atStart, () =>
            onPageChange(1),
          )}
          {navBtn('‹', t('pagination.prev', 'Previous page'), atStart, () =>
            onPageChange(page - 1),
          )}
          {navBtn('›', t('pagination.next', 'Next page'), atEnd, () =>
            onPageChange(page + 1),
          )}
          {navBtn('»', t('pagination.last', 'Last page'), atEnd, () =>
            onPageChange(totalPages),
          )}
        </View>
      </View>
    </View>
  );
}

// ── Column visibility + reorder Modal (replaces ./DataTableColumnMenu) ───────
interface MenuColumn {
  key: string;
  header: string;
  defaultVisible?: boolean;
}
interface ColumnMenuModalProps {
  visible: boolean;
  onClose: () => void;
  columns: MenuColumn[];
  layout: ColumnLayout | null;
  onChange: (next: ColumnLayout) => void;
  onReset: () => void;
  reorderable: boolean;
  toggleable: boolean;
  t: TFn;
}
function ColumnMenuModal({
  visible,
  onClose,
  columns,
  layout,
  onChange,
  onReset,
  reorderable,
  toggleable,
  t,
}: ColumnMenuModalProps) {
  const order = effectiveColumnOrder(columns, layout);
  const hiddenSet = new Set(
    layout
      ? layout.hidden
      : columns.filter(c => c.defaultVisible === false).map(c => c.key),
  );

  const move = (key: string, toIndex: number) => {
    const next = moveColumn(order, key, toIndex);
    const base = layout ?? defaultColumnLayout(columns);
    onChange({order: next, hidden: base.hidden.slice()});
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={() => undefined}>
          <AppText style={styles.modalTitle}>
            {t('table.columns.title', 'Columns')}
          </AppText>
          <ScrollView style={styles.modalList}>
            {order.map((key, idx) => {
              const col = columns.find(c => c.key === key);
              if (!col) {
                return null;
              }
              const hidden = hiddenSet.has(key);
              return (
                <View key={key} style={styles.menuRow}>
                  {toggleable ? (
                    <Checkbox
                      checked={!hidden}
                      label={t('table.columns.show', 'Show column')}
                      onPress={() => {
                        const base = layout ?? defaultColumnLayout(columns);
                        onChange(toggleHiddenColumn(base, key));
                      }}
                    />
                  ) : null}
                  <AppText numberOfLines={1} style={styles.menuLabel}>
                    {col.header || key}
                  </AppText>
                  {reorderable ? (
                    <View style={styles.menuReorder}>
                      <Pressable
                        accessibilityLabel={t('table.columns.moveUp', 'Move up')}
                        accessibilityRole="button"
                        accessibilityState={{disabled: idx === 0}}
                        disabled={idx === 0}
                        hitSlop={6}
                        onPress={() => move(key, idx - 1)}
                        style={[
                          styles.menuArrow,
                          idx === 0 && styles.menuArrowDisabled,
                        ]}>
                        <AppText style={styles.menuArrowGlyph}>↑</AppText>
                      </Pressable>
                      <Pressable
                        accessibilityLabel={t(
                          'table.columns.moveDown',
                          'Move down',
                        )}
                        accessibilityRole="button"
                        accessibilityState={{disabled: idx === order.length - 1}}
                        disabled={idx === order.length - 1}
                        hitSlop={6}
                        onPress={() => move(key, idx + 1)}
                        style={[
                          styles.menuArrow,
                          idx === order.length - 1 && styles.menuArrowDisabled,
                        ]}>
                        <AppText style={styles.menuArrowGlyph}>↓</AppText>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
          <View style={styles.menuFooter}>
            <Pressable hitSlop={6} onPress={onReset}>
              <AppText style={styles.menuReset}>
                {t('table.columns.reset', 'Reset')}
              </AppText>
            </Pressable>
            <Pressable hitSlop={6} onPress={onClose}>
              <AppText style={styles.menuDone}>
                {t('table.columns.done', 'Done')}
              </AppText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Row context-menu action sheet (replaces ./ContextMenu right-click) ───────
interface ContextMenuModalProps {
  items: ContextMenuItem[] | null;
  onClose: () => void;
}
function ContextMenuModal({items, onClose}: ContextMenuModalProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={items != null}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          {(items ?? []).map(item => (
            <Pressable
              accessibilityRole="menuitem"
              accessibilityState={{disabled: item.disabled}}
              disabled={item.disabled}
              key={item.id}
              onPress={() => {
                onClose();
                item.onClick();
              }}
              style={({pressed}) => [
                styles.sheetItem,
                pressed && styles.sheetItemPressed,
                item.disabled && styles.sheetItemDisabled,
              ]}>
              {item.icon ? (
                <View style={styles.sheetIcon}>{renderNode(item.icon)}</View>
              ) : null}
              <AppText
                style={[
                  styles.sheetLabel,
                  item.destructive && styles.sheetLabelDanger,
                ]}>
                {item.label}
              </AppText>
              {item.shortcut ? (
                <AppText style={styles.sheetShortcut}>{item.shortcut}</AppText>
              ) : null}
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Sortable glass-styled data table — native parity port. All advanced props
 *  are optional; passing only `columns` + `data` gives the base table. */
export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  sortKey,
  sortDir,
  onSort,
  emptyMessage = 'No data',
  className: _className,
  compact,
  density,
  pagination,
  name,
  mobileColumns,
  tableId,
  selectable = 'none',
  selectedKeys,
  onSelectionChange,
  bulkActions,
  stickyHeader = true,
  maxHeight,
  expandable = false,
  expandedKeys,
  onExpandedChange,
  renderExpanded,
  showColumnsMenu = false,
  columnVisibility = false,
  columnReorder = false,
  exportable = false,
  exportFilename,
  exportRow,
  exportAll,
  virtualized = false,
  rowContextMenu,
  style,
}: DataTableProps<T>) {
  const {t} = useTranslation();
  const {width: viewportWidth} = useWindowDimensions();

  // Resolve effective density. Explicit `density` wins; the legacy `compact`
  // boolean maps to 'compact'; otherwise default to 'auto' (-> 'comfortable').
  const effectiveDensity: 'compact' | 'comfortable' | 'spacious' | 'auto' =
    density ?? (compact ? 'compact' : 'auto');
  const pad = densityPadding(effectiveDensity);

  const paginationEnabled = !!pagination;
  const paginationConfig: PaginationConfig =
    typeof pagination === 'object' ? pagination : {};
  const defaultPageSize = paginationConfig.defaultPageSize ?? 25;
  const pageSizeOptions = paginationConfig.pageSizeOptions ?? [20, 50, 100];

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  // Reset to page 1 when data length changes (e.g. filters applied).
  useEffect(() => {
    setPage(1);
  }, [data.length]);

  // ── Column layout (order + hidden, persisted by tableId in-session) ───────
  const columnKeys = useMemo(() => columns.map(c => c.key), [columns]);
  const [layout, setLayoutState] = useState<ColumnLayout | null>(() =>
    tableId ? getStoredLayout(tableId) : null,
  );

  // Drop stale order/hidden entries when the columns prop shrinks at runtime,
  // but never resurrect a column the user explicitly hid.
  useEffect(() => {
    if (!layout) {
      return;
    }
    const known = new Set(columnKeys);
    const filteredOrder = layout.order.filter(k => known.has(k));
    const filteredHidden = layout.hidden.filter(k => known.has(k));
    if (
      filteredOrder.length !== layout.order.length ||
      filteredHidden.length !== layout.hidden.length
    ) {
      setLayoutState({order: filteredOrder, hidden: filteredHidden});
    }
  }, [layout, columnKeys]);

  const persistLayout = useCallback(
    (next: ColumnLayout) => {
      setLayoutState(next);
      if (tableId) {
        setStoredLayout(tableId, next);
      }
    },
    [tableId],
  );

  const resetLayout = useCallback(() => {
    setLayoutState(null);
    if (tableId) {
      clearStoredLayout(tableId);
    }
  }, [tableId]);

  const visibleColumns = useMemo(
    () => applyColumnLayout(columns, layout),
    [columns, layout],
  );

  // ── Mobile allow-list ─────────────────────────────────────────────────────
  const effectiveMobileColumns = useMemo(() => {
    if (mobileColumns) {
      return mobileColumns;
    }
    const derived = columns.filter(c => c.visibleOnMobile).map(c => c.key);
    return derived.length > 0 ? derived : null;
  }, [mobileColumns, columns]);
  const mobileSet = useMemo(
    () => (effectiveMobileColumns ? new Set(effectiveMobileColumns) : null),
    [effectiveMobileColumns],
  );
  // Native maps the Tailwind `md:` breakpoint (768px) to the live viewport
  // width: below it, columns not in the mobile allow-list are hidden (the web
  // `hidden md:table-cell` behavior); at/above it, every column shows.
  const isNarrow = viewportWidth < 768;
  const renderColumns = useMemo(
    () =>
      visibleColumns.filter(
        c => !(mobileSet && isNarrow && !mobileSet.has(c.key)),
      ),
    [visibleColumns, mobileSet, isNarrow],
  );

  // ── Column widths (read-only on native; resize drag unavailable) ──────────
  const widthFor = useCallback((col: Column<T>): number => {
    if (typeof col.defaultWidth === 'number') {
      return col.defaultWidth;
    }
    return DEFAULT_COL_WIDTH;
  }, []);

  // ── Selection ─────────────────────────────────────────────────────────────
  const isSelectable = selectable !== 'none';
  const selection = useMemo(() => selectedKeys ?? [], [selectedKeys]);
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const lastClickedKey = useRef<RowKey | null>(null);

  const allRowKeys = useMemo(
    () => data.map(keyExtractor),
    [data, keyExtractor],
  );
  const allSelected =
    isSelectable &&
    allRowKeys.length > 0 &&
    allRowKeys.every(k => selectionSet.has(k));
  const someSelected =
    isSelectable && allRowKeys.some(k => selectionSet.has(k)) && !allSelected;

  const setSelection = useCallback(
    (next: RowKey[]) => onSelectionChange?.(next),
    [onSelectionChange],
  );

  // `shift` mirrors the web shiftKey range-select. Touch has no modifier key,
  // so callers on hardware keyboards (RN-Web/desktop) may still pass true; the
  // additive-range logic is preserved verbatim.
  const toggleRow = useCallback(
    (rowKey: RowKey, shift = false) => {
      if (selectable === 'single') {
        setSelection(selectionSet.has(rowKey) ? [] : [rowKey]);
        lastClickedKey.current = rowKey;
        return;
      }
      if (shift && lastClickedKey.current != null) {
        const fromIdx = allRowKeys.indexOf(lastClickedKey.current);
        const toIdx = allRowKeys.indexOf(rowKey);
        if (fromIdx >= 0 && toIdx >= 0) {
          const [a, b] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
          const range = allRowKeys.slice(a, b + 1);
          const next = new Set(selection);
          for (const k of range) {
            next.add(k);
          }
          setSelection(Array.from(next));
          lastClickedKey.current = rowKey;
          return;
        }
      }
      const next = new Set(selection);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      setSelection(Array.from(next));
      lastClickedKey.current = rowKey;
    },
    [selectable, selection, selectionSet, allRowKeys, setSelection],
  );

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelection([]);
    } else {
      setSelection(allRowKeys);
    }
  }, [allSelected, allRowKeys, setSelection]);

  const clearSelection = useCallback(() => setSelection([]), [setSelection]);

  // ── Expansion ─────────────────────────────────────────────────────────────
  const expansion = useMemo(() => expandedKeys ?? [], [expandedKeys]);
  const expansionSet = useMemo(() => new Set(expansion), [expansion]);
  const toggleExpand = useCallback(
    (rowKey: RowKey) => {
      if (!onExpandedChange) {
        return;
      }
      const next = new Set(expansion);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      onExpandedChange(Array.from(next));
    },
    [expansion, onExpandedChange],
  );

  // ── Pagination slice ──────────────────────────────────────────────────────
  const paginatedData = paginationEnabled
    ? data.slice((page - 1) * pageSize, page * pageSize)
    : data;

  // ── Selected rows for bulk-actions slot ───────────────────────────────────
  const selectedRows = useMemo(
    () =>
      isSelectable
        ? data.filter(row => selectionSet.has(keyExtractor(row)))
        : [],
    [data, isSelectable, selectionSet, keyExtractor],
  );

  // ── CSV export (download unavailable on native; CSV still generated) ──────
  const [exporting, setExporting] = useState(false);
  const handleExportCsv = useCallback(async () => {
    if (exporting) {
      return;
    }
    setExporting(true);
    try {
      const sourceRows: T[] = exportAll ? await exportAll() : data;
      const filenameBase =
        exportFilename ?? defaultExportFilename(tableId ?? name ?? 'table');
      const csvCols: CsvColumn<T>[] = visibleColumns.map(col => ({
        key: col.key,
        header: col.header || col.key,
        accessor: exportRow
          ? row => {
              const obj = exportRow(row);
              const v = obj[col.key];
              return v === undefined ? null : v;
            }
          : row => {
              const v = (row as unknown as Record<string, unknown>)[col.key];
              if (v == null) {
                return null;
              }
              if (
                typeof v === 'string' ||
                typeof v === 'number' ||
                typeof v === 'boolean'
              ) {
                return v;
              }
              return v as object;
            },
      }));
      const csv = toCSV(sourceRows, csvCols);
      downloadCSV(filenameBase, csv);
    } finally {
      setExporting(false);
    }
  }, [
    exporting,
    exportAll,
    data,
    exportFilename,
    tableId,
    name,
    visibleColumns,
    exportRow,
  ]);

  // ── Layout/visibility menu gating ─────────────────────────────────────────
  const visibilityRequested = showColumnsMenu || columnVisibility;
  const reorderRequested = columnReorder;
  const showColumnMenu =
    (visibilityRequested || reorderRequested) && Boolean(tableId);
  const [menuOpen, setMenuOpen] = useState(false);

  // ── Context menu (long-press) ─────────────────────────────────────────────
  const [contextItems, setContextItems] = useState<ContextMenuItem[] | null>(
    null,
  );

  // ── Virtualization defaults (no react-virtual; full render) ───────────────
  const virtualizationActive = virtualized && !expandable && data.length > 0;
  const effectiveMaxHeight = maxHeight ?? (virtualizationActive ? 600 : undefined);
  const numericMaxHeight =
    typeof effectiveMaxHeight === 'number' ? effectiveMaxHeight : undefined;
  const effectiveStickyHeader = stickyHeader || virtualizationActive;

  const leadingColCount = (isSelectable ? 1 : 0) + (expandable ? 1 : 0);
  const totalWidth =
    leadingColCount * LEADING_COL_WIDTH +
    renderColumns.reduce((sum, col) => sum + widthFor(col), 0);

  const menuColumns: MenuColumn[] = useMemo(
    () =>
      columns.map(c => ({
        key: c.key,
        header: c.header,
        defaultVisible: c.defaultVisible,
      })),
    [columns],
  );

  const bodyFallback = (
    <View style={[styles.messageRow, {width: totalWidth}]}>
      <AppText style={styles.messageGlyph}>⚠</AppText>
      <AppText style={styles.messageText}>
        {t('errors.section.tableTitle', 'This table failed to render')}
      </AppText>
    </View>
  );

  const cellTextStyle = useMemo<StyleProp<TextStyle>>(
    () => ({color: colors.textPrimary, fontSize: 14, lineHeight: 20}),
    [],
  );

  const renderHeader = () => (
    <View style={[styles.headRow, {width: totalWidth}]}>
      {isSelectable ? (
        <View
          style={[
            styles.leadingCell,
            {paddingHorizontal: pad.leadH, paddingVertical: pad.leadV},
          ]}>
          {selectable === 'multi' ? (
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              label={
                allSelected
                  ? t('table.selection.deselectAll', 'Deselect all rows')
                  : t('table.selection.selectAll', 'Select all rows')
              }
              onPress={toggleAll}
            />
          ) : null}
        </View>
      ) : null}
      {expandable ? <View style={styles.leadingCell} /> : null}
      {renderColumns.map(col => {
        const sorted = col.sortable && sortKey === col.key;
        return (
          <View
            key={col.key}
            style={[
              styles.headCell,
              {
                width: widthFor(col),
                paddingHorizontal: pad.headH,
                paddingVertical: pad.headV,
                alignItems: alignItemsFor(col.align),
              },
            ]}>
            {col.sortable ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => onSort?.(col.key)}
                style={styles.headSortBtn}>
                <AppText
                  style={[styles.headText, {textAlign: textAlignFor(col.align)}]}>
                  {col.header}
                </AppText>
                {sorted ? (
                  <AppText style={styles.sortGlyph}>
                    {sortDir === 'asc' ? '▲' : '▼'}
                  </AppText>
                ) : null}
              </Pressable>
            ) : (
              <AppText
                style={[styles.headText, {textAlign: textAlignFor(col.align)}]}>
                {col.header}
              </AppText>
            )}
          </View>
        );
      })}
    </View>
  );

  const renderDataRow = (row: T): ReactNode => {
    const rowKey = keyExtractor(row);
    const selected = isSelectable && selectionSet.has(rowKey);
    const expanded = expandable && expansionSet.has(rowKey);
    const cells = (
      <View
        style={[
          styles.row,
          {width: totalWidth},
          selected && styles.rowSelected,
        ]}>
        {isSelectable ? (
          <View
            style={[
              styles.leadingCell,
              {paddingHorizontal: pad.leadH, paddingVertical: pad.leadV},
            ]}>
            <Checkbox
              checked={selected}
              radio={selectable === 'single'}
              label={
                selected
                  ? t('table.selection.deselectRow', 'Deselect row')
                  : t('table.selection.selectRow', 'Select row')
              }
              onPress={() => toggleRow(rowKey)}
            />
          </View>
        ) : null}
        {expandable ? (
          <View
            style={[
              styles.leadingCell,
              {paddingHorizontal: pad.leadH, paddingVertical: pad.leadV},
            ]}>
            <ExpandToggle
              expanded={expanded}
              label={
                expanded
                  ? t('table.expand.collapse', 'Collapse row')
                  : t('table.expand.expand', 'Expand row')
              }
              onPress={() => toggleExpand(rowKey)}
            />
          </View>
        ) : null}
        {renderColumns.map(col => (
          <View
            key={col.key}
            style={[
              styles.cell,
              {
                width: widthFor(col),
                paddingHorizontal: pad.cellH,
                paddingVertical: pad.cellV,
                alignItems: alignItemsFor(col.align),
              },
            ]}>
            {renderNode(col.render(row), [
              cellTextStyle,
              {textAlign: textAlignFor(col.align)},
            ])}
          </View>
        ))}
      </View>
    );

    const rowEl = rowContextMenu ? (
      <Pressable
        accessibilityRole="button"
        onLongPress={() => {
          const items = rowContextMenu(row);
          if (items && items.length > 0) {
            setContextItems(items);
          }
        }}>
        {cells}
      </Pressable>
    ) : (
      cells
    );

    return (
      <Fragment key={rowKey}>
        {rowEl}
        {expanded && renderExpanded ? (
          <View style={[styles.expandedCell, {width: totalWidth}]}>
            {renderNode(renderExpanded(row), cellTextStyle)}
          </View>
        ) : null}
      </Fragment>
    );
  };

  const bodyContent =
    data.length === 0 ? (
      <View style={[styles.messageRow, {width: totalWidth}]}>
        <AppText style={styles.messageText}>{emptyMessage}</AppText>
      </View>
    ) : (
      <RowErrorBoundary fallback={bodyFallback}>
        {paginatedData.map(renderDataRow)}
      </RowErrorBoundary>
    );

  const header = renderHeader();
  const scrollableBody =
    numericMaxHeight != null ? (
      <ScrollView nestedScrollEnabled style={{maxHeight: numericMaxHeight}}>
        {!effectiveStickyHeader ? header : null}
        {bodyContent}
      </ScrollView>
    ) : (
      <View>
        {!effectiveStickyHeader ? header : null}
        {bodyContent}
      </View>
    );

  const showToolbar =
    showColumnMenu || (isSelectable && selectedRows.length > 0) || exportable;

  return (
    <View style={[styles.root, style]}>
      {showToolbar ? (
        <View style={styles.toolbar}>
          <View style={styles.toolbarLeft}>
            {isSelectable && selectedRows.length > 0 ? (
              <View style={styles.bulkBar}>
                <AppText style={styles.bulkCount}>
                  {t('table.selection.count', '{{count}} selected', {
                    count: selectedRows.length,
                  })}
                </AppText>
                <Pressable hitSlop={6} onPress={clearSelection}>
                  <AppText style={styles.bulkClear}>
                    {t('table.selection.clear', 'Clear')}
                  </AppText>
                </Pressable>
                {bulkActions ? (
                  <View style={styles.bulkActions}>
                    {bulkActions(selectedRows)}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
          <View style={styles.toolbarRight}>
            {exportable ? (
              <Pressable
                accessibilityLabel={t('table.export.csv', 'Download table as CSV')}
                accessibilityRole="button"
                accessibilityState={{disabled: exporting || data.length === 0}}
                disabled={exporting || data.length === 0}
                onPress={handleExportCsv}
                style={[
                  styles.toolBtn,
                  (exporting || data.length === 0) && styles.toolBtnDisabled,
                ]}>
                {exporting ? (
                  <ActivityIndicator color={colors.textSecondary} size="small" />
                ) : (
                  <AppText style={styles.toolBtnGlyph}>↓</AppText>
                )}
                <AppText style={styles.toolBtnText}>
                  {t('table.export.csvButton', 'Download CSV')}
                </AppText>
              </Pressable>
            ) : null}
            {showColumnMenu ? (
              <Pressable
                accessibilityLabel={t('table.columns.button', 'Columns')}
                accessibilityRole="button"
                onPress={() => setMenuOpen(true)}
                style={styles.toolBtn}>
                <AppText style={styles.toolBtnGlyph}>⋮</AppText>
                <AppText style={styles.toolBtnText}>
                  {t('table.columns.button', 'Columns')}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.hScroll}>
        <View style={{width: totalWidth}}>
          {effectiveStickyHeader ? header : null}
          {scrollableBody}
        </View>
      </ScrollView>

      {paginationEnabled && data.length > 0 ? (
        <NativePagination
          onPageChange={setPage}
          onPageSizeChange={size => {
            setPageSize(size);
            setPage(1);
          }}
          page={page}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          t={t}
          total={data.length}
        />
      ) : null}

      {showColumnMenu ? (
        <ColumnMenuModal
          columns={menuColumns}
          layout={layout}
          onChange={persistLayout}
          onClose={() => setMenuOpen(false)}
          onReset={() => {
            resetLayout();
            setMenuOpen(false);
          }}
          reorderable={reorderRequested}
          t={t}
          toggleable={visibilityRequested}
          visible={menuOpen}
        />
      ) : null}

      <ContextMenuModal
        items={contextItems}
        onClose={() => setContextItems(null)}
      />
    </View>
  );
}

DataTable.displayName = 'DataTable';

/** Toggle sort key/direction. Pure state logic — ported verbatim. */
export function useSortToggle(
  defaultKey?: string,
  defaultDir: 'asc' | 'desc' = 'desc',
) {
  const [sortKey, setSortKey] = useState(defaultKey ?? '');
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
    <R,>(rows: R[], accessor: (row: R, key: string) => number | string) => {
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

  return {sortKey, sortDir, onSort, sortFn};
}

/** Convenience hook for selection state. Pure state logic — ported verbatim. */
export function useTableSelection<K extends RowKey = RowKey>(initial: K[] = []) {
  const [selectedKeys, setSelectedKeys] = useState<K[]>(initial);
  const clear = useCallback(() => setSelectedKeys([]), []);
  return {selectedKeys, setSelectedKeys, clear};
}

/** Convenience hook for expansion state. Pure state logic — ported verbatim. */
export function useTableExpansion<K extends RowKey = RowKey>(initial: K[] = []) {
  const [expandedKeys, setExpandedKeys] = useState<K[]>(initial);
  const clear = useCallback(() => setExpandedKeys([]), []);
  return {expandedKeys, setExpandedKeys, clear};
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.sm,
  },
  hScroll: {
    borderRadius: 12,
  },
  // ── Toolbar ──
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  toolbarLeft: {
    flexShrink: 1,
    minWidth: 0,
  },
  toolbarRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bulkBar: {
    alignItems: 'center',
    backgroundColor: 'rgba(53, 213, 255, 0.06)',
    borderColor: 'rgba(53, 213, 255, 0.2)',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bulkCount: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  bulkClear: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '500',
  },
  bulkActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toolBtn: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  toolBtnDisabled: {
    opacity: 0.5,
  },
  toolBtnGlyph: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  toolBtnText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  // ── Header ──
  headRow: {
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomWidth: 1,
    flexDirection: 'row',
  },
  headCell: {
    justifyContent: 'center',
  },
  headSortBtn: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  headText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sortGlyph: {
    color: colors.accent,
    fontSize: 9,
  },
  // ── Rows / cells ──
  row: {
    borderTopColor: 'rgba(255, 255, 255, 0.03)',
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  rowSelected: {
    backgroundColor: 'rgba(53, 213, 255, 0.1)',
  },
  cell: {
    justifyContent: 'center',
  },
  leadingCell: {
    alignItems: 'center',
    justifyContent: 'center',
    width: LEADING_COL_WIDTH,
  },
  expandedCell: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderLeftColor: 'rgba(53, 213, 255, 0.4)',
    borderLeftWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  messageRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 36,
  },
  messageGlyph: {
    color: colors.danger,
    fontSize: 14,
  },
  messageText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  // ── Checkbox / radio ──
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  checkboxRadio: {
    borderRadius: 9999,
  },
  checkboxOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  checkGlyph: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 13,
  },
  // ── Expand toggle ──
  expandBtn: {
    alignItems: 'center',
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  expandGlyph: {
    color: colors.textMuted,
    fontSize: 12,
  },
  // ── Pagination ──
  pagination: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  pageInfo: {
    color: colors.textMuted,
    fontSize: 12,
  },
  pageControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  pageSizeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  pageSizeChip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pageSizeChipOn: {
    backgroundColor: colors.accentSoft,
  },
  pageSizeChipText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  pageSizeChipTextOn: {
    color: colors.accent,
    fontWeight: '600',
  },
  pageNavRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  pageNavBtn: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  pageNavBtnDisabled: {
    opacity: 0.4,
  },
  pageNavGlyph: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  // ── Modals ──
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    maxHeight: '80%',
    padding: spacing.lg,
    width: '100%',
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  modalList: {
    flexGrow: 0,
  },
  menuRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  menuLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
  },
  menuReorder: {
    flexDirection: 'row',
    gap: 4,
  },
  menuArrow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  menuArrowDisabled: {
    opacity: 0.4,
  },
  menuArrowGlyph: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  menuFooter: {
    flexDirection: 'row',
    gap: spacing.lg,
    justifyContent: 'flex-end',
    marginTop: spacing.md,
  },
  menuReset: {
    color: colors.textMuted,
    fontSize: 14,
  },
  menuDone: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  // ── Context-menu sheet ──
  sheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
  sheetItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sheetItemPressed: {
    backgroundColor: colors.surfaceHover,
  },
  sheetItemDisabled: {
    opacity: 0.45,
  },
  sheetIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
  },
  sheetLabelDanger: {
    color: colors.danger,
  },
  sheetShortcut: {
    color: colors.textMuted,
    fontSize: 12,
  },
});

export default DataTable;
