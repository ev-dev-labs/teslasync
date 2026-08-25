import { type ReactNode, type MouseEvent as ReactMouseEvent, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '../../lib/cn'
import { tableTokens } from '../../lib/tokens'
import { ChevronUp, ChevronDown, ChevronRight, AlertTriangle, Download, GripVertical, Loader2 } from 'lucide-react'
import { Pagination } from './Pagination'
import { SectionErrorBoundary } from '../feedback/SectionErrorBoundary'
import { DataTableColumnMenu } from './DataTableColumnMenu'
import { DataTableBulkBar } from './DataTableBulkBar'
import { DataTableResizer } from './DataTableResizer'
import { useContextMenu, type ContextMenuItem } from './ContextMenu'
import {
  applyColumnLayout,
  defaultColumnLayout,
  effectiveColumnOrder,
  getColumnLayout,
  moveColumn,
  readLegacyVisibleLayout,
  resetColumnLayout,
  setColumnLayout,
  writeLegacyVisibleArray,
  type ColumnLayout,
} from '../../lib/columnOrderStore'
import {
  toCSV,
  downloadCSV,
  defaultExportFilename,
  type CsvColumn,
  type CsvCellValue,
} from '../../lib/csvExport'

type RowKey = string | number

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  sortable?: boolean
  className?: string
  // Column display options:
  /** Default visible column? Defaults to true. Hidden columns appear in the
   *  column-visibility menu so users can re-show them. */
  defaultVisible?: boolean
  /** When set, this column is shown at <md viewports. Used to derive the
   *  effective `mobileColumns` allow-list when the prop isn't supplied. */
  visibleOnMobile?: boolean
  /** Initial width in pixels (or 'auto'). When `resizable` is true the user's
   *  drag overrides this and is persisted by `tableId`. */
  defaultWidth?: number | 'auto'
  /** Min width allowed when resizing. Defaults to 60. */
  minWidth?: number
  /** Max width allowed when resizing. Defaults to 800. */
  maxWidth?: number
  /** Right-align numeric columns; default 'left'. */
  align?: 'left' | 'center' | 'right'
}

export interface PaginationConfig {
  defaultPageSize?: number;
  pageSizeOptions?: number[];
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (row: T) => RowKey
  sortKey?: string
  sortDir?: 'asc' | 'desc'
  onSort?: (key: string) => void
  emptyMessage?: string
  className?: string
  /**
   * Legacy boolean density toggle. Equivalent to `density='compact'`.
   * Preserved for older callers; new code
   * should pass `density` directly.
   */
  compact?: boolean
  /**
   * Information density for row heights / cell padding.
   *
   *   - `'compact'`     — forces tight rows regardless of user setting
   *   - `'comfortable'` — forces default rows regardless of user setting
   *   - `'spacious'`    — forces loose rows regardless of user setting
   *   - `'auto'`        — follows the user's `ui_density` setting via
   *                      density Tailwind utilities (`px-d-pad-x ...`)
   *
   * When omitted, DataTable defaults to `'auto'` (so the global
   * preference flows through every default-styled table). Pass an
   * explicit value when a specific table should look identical to all
   * users regardless of preference (e.g. data-dense log viewers).
   */
  density?: 'compact' | 'comfortable' | 'spacious' | 'auto'
  pagination?: boolean | PaginationConfig
  /**
   * Optional name for the SectionErrorBoundary that wraps row rendering.
   * Surfaces in console logs as `[ErrorBoundary:table:<name>]` when a row
   * renderer throws. Defaults to "DataTable".
   */
  name?: string
  /**
   * Column keys to keep visible on viewports below `md` (768px). Columns NOT
   * listed here become `hidden md:table-cell`. When omitted, the effective
   * allow-list is derived from `Column.visibleOnMobile`. If neither is set,
   * every column is shown at every viewport width and the table relies on the
   * wrapper's `overflow-x-auto` to scroll horizontally on phones.
   *
   * MOBILE_GUIDELINES.md asks every multi-column DataTable to specify this so
   * mobile users see the essential columns without horizontal scroll.
   *
   * @example mobileColumns={['name', 'status']}
   */
  mobileColumns?: string[]

  // ── Persistent table controls ─────────────────────────────────────────
  /** Stable identifier used to persist column visibility & widths in
   *  localStorage. Required when using `selectable`, `resizable`, or
   *  the column-visibility menu.
   *
   *  Every `<DataTable>` caller under `web/src/features/**` MUST set
   *  `tableId`. The
   *  `audit:datatable-tableid` script (chained from `npm run lint`) fails
   *  the build if a new caller forgets it. Without `tableId`, column
   *  visibility / widths / page-size silently reset on every
   *  reload — which is the single biggest "the app forgot what I was
   *  doing" complaint.
   *
   *  Choose a stable, descriptive id of the form `<feature>:<purpose>`
   *  (e.g. `tableId="drives:list"`, `tableId="admin:audit-logs"`).
   *  Renaming an existing id orphans every user's persisted layout, so
   *  treat ids as part of the public contract once shipped. */
  tableId?: string

  // SELECTION
  /** 'multi' = checkbox column + select-all + shift-click range. 'single' =
   *  radio-style (one row at a time). 'none' or undefined = no selection. */
  selectable?: 'single' | 'multi' | 'none'
  /** Controlled list of selected row keys. */
  selectedKeys?: RowKey[]
  /** Called whenever the selection changes. */
  onSelectionChange?: (keys: RowKey[]) => void
  /** Renders above the header when `selectedKeys.length > 0`. The selected
   *  rows are passed in for convenient lookup of the actual data. */
  bulkActions?: (selected: T[]) => ReactNode

  // STICKY / SCROLL
  /** Make the `<thead>` stick to the top of the wrapper while the body scrolls.
   *  Defaults to `true` so every DataTable in the app has consistent sticky-
   *  header behavior. Pass `false` to opt out (e.g. very short tables in
   *  modals where a sticky header adds visual weight without value). */
  stickyHeader?: boolean
  /** Cap the wrapper height; combined with `stickyHeader` lets long tables
   *  scroll vertically inside their panel. */
  maxHeight?: number | string

  // EXPANSION
  /** Render a leading chevron column that toggles row expansion. */
  expandable?: boolean
  /** Controlled list of expanded row keys. */
  expandedKeys?: RowKey[]
  /** Called whenever expansion changes. */
  onExpandedChange?: (keys: RowKey[]) => void
  /** Required when `expandable` is true: render the row drawer body. */
  renderExpanded?: (row: T) => ReactNode

  // RESIZE
  /** Allow users to drag column right edges to resize. Persists per-column
   *  widths in localStorage[`teslasync.table.${tableId}.widths`]. Requires
   *  `tableId`. */
  resizable?: boolean

  // COLUMN VISIBILITY
  /** Render the "Columns" picker button above the table. Persists user choice
   *  in localStorage[`teslasync.table.${tableId}.visible`]. Requires
   *  `tableId`.
   *
   *  @deprecated Use `columnVisibility` (Phase-46 / Prompt 45) — this prop
   *    is preserved for back-compat and is now an alias. New callers should
   *    pass `columnVisibility` so the intent is explicit. */
  showColumnsMenu?: boolean

  // ── Column reorder + visibility ───────────────────────────────────────
  /** Render the combined Columns popover (visibility checklist). Persists
   *  in localStorage[`teslasync.table.${tableId}.columns`]. Requires
   *  `tableId`. Equivalent to (and replaces) `showColumnsMenu`. */
  columnVisibility?: boolean
  /** Allow drag-to-reorder column headers and surface ↑/↓ keyboard
   *  fallback in the column menu. Persists in
   *  localStorage[`teslasync.table.${tableId}.columns`]. Requires
   *  `tableId`. Implies `columnVisibility` (the same popover hosts both). */
  columnReorder?: boolean

  // ── Per-table CSV export ───────────────────────────────────────────────
  /** Show a "Download CSV" button in the table toolbar. The CSV is generated
   *  from the currently visible columns and the currently sorted/filtered
   *  data the table has been given. */
  exportable?: boolean
  /** Filename for the exported CSV (without extension). Defaults to a
   *  date-stamped fallback like `table-2026-05-01`. */
  exportFilename?: string
  /** Override how a row is serialized. Defaults to extracting each visible
   *  column key from the row. */
  exportRow?: (row: T) => Record<string, CsvCellValue>
  /** Optional async hook for paginated/server-side data: when provided the
   *  export awaits this fetcher to obtain the full row set instead of using
   *  whatever's currently visible. */
  exportAll?: () => Promise<T[]>

  // ── Row virtualization ─────────────────────────────────────────────────
  /** Opt-in row virtualization for high-volume tables (1000+ rows).
   *  Mounts only the rows currently in the viewport (plus `overscan`),
   *  which keeps the DOM small and scrolling at 60fps regardless of how
   *  many rows the table has been given.
   *
   *  Constraints:
   *    - Requires fixed-height rows. `expandable` is NOT supported (variable
   *      heights are out of scope) — when both are passed the table falls
   *      back to non-virtualized rendering.
   *    - Auto-enables `stickyHeader` and `maxHeight` (defaults to 600px when
   *      neither is provided) so the scroll container has a bounded height.
   *
   *  Selection, sort, column visibility, resize, and CSV export all remain
   *  fully functional under virtualization. */
  virtualized?: boolean
  /** Estimated row height in pixels when `virtualized` is true. Defaults to
   *  44 (default density) or 36 (compact density). The virtualizer adapts
   *  to actual rendered sizes, so an estimate within a few pixels is fine. */
  rowHeight?: number
  /** Number of off-screen rows to render above/below the viewport when
   *  virtualized. Defaults to 8 — higher values smooth fast scrolling at
   *  the cost of slightly more DOM. */
  overscan?: number

  // ── Per-row right-click context menu ───────────────────────────────────
  /** Optional builder that returns a list of `ContextMenuItem`s to show
   *  when the user right-clicks a body row. Returning an empty array (or
   *  omitting this prop entirely) leaves the browser's native context
   *  menu intact — no preventDefault, no shared menu. The shared
   *  `<ContextMenuRoot/>` mounted in `App.tsx` renders the popup; this
   *  prop only declares which actions belong to which row. */
  rowContextMenu?: (row: T) => ContextMenuItem[]
}

const STORAGE_PREFIX = 'teslasync.table'

function readStored<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeStored<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / disabled — ignore */
  }
}

function alignClass(align?: 'left' | 'center' | 'right'): string {
  if (align === 'right') return 'text-right'
  if (align === 'center') return 'text-center'
  return ''
}

/** Sortable glass-styled data table with consistent styling and optional
 *  pagination, selection, expansion, sticky header, column visibility &
 *  per-column resize.
 *
 *  All advanced props are optional — passing only `columns` + `data` gives the
 *  same lightweight behavior as the base table. */
export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  sortKey,
  sortDir,
  onSort,
  emptyMessage = 'No data',
  className,
  compact,
  density,
  pagination,
  mobileColumns,
  name,
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
  resizable = false,
  showColumnsMenu = false,
  columnVisibility = false,
  columnReorder = false,
  exportable = false,
  exportFilename,
  exportRow,
  exportAll,
  virtualized = false,
  rowHeight,
  overscan,
  rowContextMenu,
}: DataTableProps<T>) {
  const { t } = useTranslation()
  // Shared context menu host. We call this once per
  // table render so the imperative `openMenu` reference stays stable
  // across row renders.
  const { openMenu } = useContextMenu()
  // Resolve effective density. Explicit `density` wins; otherwise the
  // legacy `compact` boolean maps to 'compact'; otherwise default to
  // 'auto' so the global setting flows through.
  const effectiveDensity: 'compact' | 'comfortable' | 'spacious' | 'auto' =
    density ?? (compact ? 'compact' : 'auto')
  // Static density modes use the historical fixed paddings (32 / 44 /
  // 56 px row heights). 'auto' uses density Tailwind utilities that
  // read CSS vars set by `body[data-density="..."]` so the table
  // reflows live when the user changes the setting.
  const cellPaddingClass: string =
    effectiveDensity === 'compact'
      ? 'px-3 py-2'
      : effectiveDensity === 'spacious'
        ? 'px-5 py-4'
        : effectiveDensity === 'comfortable'
          ? tableTokens.cell
          : 'px-d-pad-x py-d-pad-y text-d-base'
  const leadingPaddingClass: string =
    effectiveDensity === 'compact'
      ? 'px-2 py-2'
      : effectiveDensity === 'spacious'
        ? 'px-4 py-4'
        : effectiveDensity === 'comfortable'
          ? 'px-3 py-3'
          : 'px-d-pad-x py-d-pad-y'
  const headCellPaddingClass: string =
    effectiveDensity === 'compact'
      ? 'px-3 py-2'
      : effectiveDensity === 'spacious'
        ? 'px-5 py-4'
        : effectiveDensity === 'comfortable'
          ? tableTokens.headCell
          : 'px-d-pad-x py-d-pad-y text-d-base'
  const paginationEnabled = !!pagination
  const paginationConfig: PaginationConfig = typeof pagination === 'object' ? pagination : {}
  const defaultPageSize =
    paginationConfig.defaultPageSize ?? paginationConfig.pageSizeOptions?.[0] ?? 25
  const pageSizeOptions = paginationConfig.pageSizeOptions ?? [25, 50, 100]
  const pageSizeStorageKey =
    paginationEnabled && tableId ? `${STORAGE_PREFIX}.${tableId}.page-size` : null

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    if (!pageSizeStorageKey) return defaultPageSize
    const stored = readStored<unknown>(pageSizeStorageKey)
    return typeof stored === 'number' &&
      Number.isInteger(stored) &&
      stored > 0 &&
      pageSizeOptions.includes(stored)
      ? stored
      : defaultPageSize
  })

  const handlePageSizeChange = useCallback((size: number) => {
    if (!Number.isInteger(size) || size <= 0 || !pageSizeOptions.includes(size)) return
    setPageSize(size)
    setPage(1)
    if (pageSizeStorageKey) writeStored(pageSizeStorageKey, size)
  }, [pageSizeOptions, pageSizeStorageKey])

  // Reset to page 1 when data length changes (e.g. filters applied).
  useEffect(() => { setPage(1) }, [data.length])

  // ── Column layout (order + hidden, persisted by tableId) ───────────────
  // The legacy `visibleKeys` state is unified with a
  // richer `{ order, hidden }` layout that also captures column position.
  // The legacy `.visible` key is read once on mount as a one-shot
  // migration so existing users don't lose their visibility prefs.
  const columnKeys = useMemo(() => columns.map(c => c.key), [columns])
  const [layout, setLayoutState] = useState<ColumnLayout | null>(() => {
    if (!tableId) return null
    const stored = getColumnLayout(tableId)
    if (stored) return stored
    return readLegacyVisibleLayout(tableId, columnKeys)
  })

  // Drop stale order/hidden entries when the columns prop shrinks at
  // runtime, but never resurrect a column the user explicitly hid.
  useEffect(() => {
    if (!layout) return
    const known = new Set(columnKeys)
    const filteredOrder = layout.order.filter(k => known.has(k))
    const filteredHidden = layout.hidden.filter(k => known.has(k))
    if (
      filteredOrder.length !== layout.order.length ||
      filteredHidden.length !== layout.hidden.length
    ) {
      setLayoutState({ order: filteredOrder, hidden: filteredHidden })
    }
  }, [layout, columnKeys])

  const persistLayout = useCallback(
    (next: ColumnLayout) => {
      setLayoutState(next)
      if (tableId) {
        setColumnLayout(tableId, next)
        // Mirror the visible-keys list to the legacy `.visible` storage key so
        // any legacy reader (and the legacy assertion in
        // DataTable.test.tsx) continues to work without modification.
        const visibleKeys = applyColumnLayout(columns, next).map((c) => c.key)
        writeLegacyVisibleArray(tableId, visibleKeys)
      }
    },
    [tableId, columns],
  )

  const resetLayout = useCallback(() => {
    setLayoutState(null)
    if (tableId) resetColumnLayout(tableId)
  }, [tableId])

  const visibleColumns = useMemo(
    () => applyColumnLayout(columns, layout),
    [columns, layout],
  )

  // ── Mobile allow-list ───────────────────────────────────────────────────
  const effectiveMobileColumns = useMemo(() => {
    if (mobileColumns) return mobileColumns
    const derived = columns.filter(c => c.visibleOnMobile).map(c => c.key)
    return derived.length > 0 ? derived : null
  }, [mobileColumns, columns])
  const mobileSet = useMemo(
    () => (effectiveMobileColumns ? new Set(effectiveMobileColumns) : null),
    [effectiveMobileColumns],
  )
  const colHiddenClass = (key: string) =>
    mobileSet && !mobileSet.has(key) ? 'hidden md:table-cell' : ''

  // ── Column widths (persisted by tableId) ───────────────────────────────
  const widthsStorageKey = tableId ? `${STORAGE_PREFIX}.${tableId}.widths` : null
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    if (!widthsStorageKey) return {}
    return readStored<Record<string, number>>(widthsStorageKey) ?? {}
  })
  const setColumnWidth = useCallback((key: string, width: number) => {
    setWidths(prev => ({ ...prev, [key]: width }))
  }, [])
  const persistColumnWidth = useCallback(
    (key: string, width: number) => {
      if (!widthsStorageKey) return
      setWidths(prev => {
        const next = { ...prev, [key]: width }
        writeStored(widthsStorageKey, next)
        return next
      })
    },
    [widthsStorageKey],
  )
  const widthFor = (col: Column<T>): number | undefined => {
    const stored = widths[col.key]
    if (typeof stored === 'number') return stored
    if (typeof col.defaultWidth === 'number') return col.defaultWidth
    return undefined
  }

  // ── Selection ───────────────────────────────────────────────────────────
  const isSelectable = selectable !== 'none'
  const selection = selectedKeys ?? []
  const selectionSet = useMemo(() => new Set(selection), [selection])
  const lastClickedKey = useRef<RowKey | null>(null)

  const allRowKeys = useMemo(() => data.map(keyExtractor), [data, keyExtractor])
  const allSelected = isSelectable && allRowKeys.length > 0 && allRowKeys.every(k => selectionSet.has(k))
  const someSelected = isSelectable && allRowKeys.some(k => selectionSet.has(k)) && !allSelected
  const headerCheckboxRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someSelected
  }, [someSelected])

  const setSelection = useCallback(
    (next: RowKey[]) => onSelectionChange?.(next),
    [onSelectionChange],
  )

  const toggleRow = useCallback(
    (rowKey: RowKey, e: React.MouseEvent | React.ChangeEvent | React.KeyboardEvent) => {
      const shift = 'shiftKey' in e ? (e as React.MouseEvent).shiftKey : false
      if (selectable === 'single') {
        setSelection(selectionSet.has(rowKey) ? [] : [rowKey])
        lastClickedKey.current = rowKey
        return
      }
      // multi
      if (shift && lastClickedKey.current != null) {
        const fromIdx = allRowKeys.indexOf(lastClickedKey.current)
        const toIdx = allRowKeys.indexOf(rowKey)
        if (fromIdx >= 0 && toIdx >= 0) {
          const [a, b] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
          const range = allRowKeys.slice(a, b + 1)
          // Behavior: range is added to selection (additive), not replacing.
          const next = new Set(selection)
          for (const k of range) next.add(k)
          setSelection(Array.from(next))
          lastClickedKey.current = rowKey
          return
        }
      }
      const next = new Set(selection)
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      setSelection(Array.from(next))
      lastClickedKey.current = rowKey
    },
    [selectable, selection, selectionSet, allRowKeys, setSelection],
  )

  const toggleAll = useCallback(() => {
    if (allSelected) setSelection([])
    else setSelection(allRowKeys)
  }, [allSelected, allRowKeys, setSelection])

  const clearSelection = useCallback(() => setSelection([]), [setSelection])

  // ── Expansion ───────────────────────────────────────────────────────────
  const expansion = expandedKeys ?? []
  const expansionSet = useMemo(() => new Set(expansion), [expansion])
  const toggleExpand = useCallback(
    (rowKey: RowKey) => {
      if (!onExpandedChange) return
      const next = new Set(expansion)
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      onExpandedChange(Array.from(next))
    },
    [expansion, onExpandedChange],
  )

  // ── Pagination slice ───────────────────────────────────────────────────
  const paginatedData = paginationEnabled
    ? data.slice((page - 1) * pageSize, page * pageSize)
    : data

  // ── Selected rows for bulk actions slot ────────────────────────────────
  const selectedRows = useMemo(
    () => (isSelectable ? data.filter(row => selectionSet.has(keyExtractor(row))) : []),
    [data, isSelectable, selectionSet, keyExtractor],
  )

  // ── CSV export ─────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false)
  const handleExportCsv = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
      const sourceRows: T[] = exportAll ? await exportAll() : data
      const filenameBase = exportFilename ?? defaultExportFilename(tableId ?? name ?? 'table')
      const csvCols: CsvColumn<T>[] = visibleColumns.map((col) => ({
        key: col.key,
        header: col.header || col.key,
        accessor: exportRow
          ? (row) => {
              const obj = exportRow(row)
              const v = obj[col.key]
              return v === undefined ? null : v
            }
          : (row) => {
              // Default: shallow lookup. Renders that produce React nodes are
              // not exportable — callers should pass `exportRow` to flatten
              // formatted values to plain CSV cells.
              const v = (row as unknown as Record<string, unknown>)[col.key]
              if (v == null) return null
              if (
                typeof v === 'string' ||
                typeof v === 'number' ||
                typeof v === 'boolean'
              ) {
                return v
              }
              // Fall back to JSON for nested structures so the row still exports.
              return v as object
            },
      }))
      const csv = toCSV(sourceRows, csvCols)
      downloadCSV(filenameBase, csv)
    } finally {
      setExporting(false)
    }
  }, [exporting, exportAll, data, exportFilename, tableId, name, visibleColumns, exportRow])

  // Total visible column count for colSpan calcs (incl. selection / expand).
  const leadingColCount = (isSelectable ? 1 : 0) + (expandable ? 1 : 0)
  const totalCols = leadingColCount + visibleColumns.length

  // ── Virtualization ─────────────────────────────────────────────────────
  // Only enabled when explicitly opted in AND there's no `expandable` slot
  // (variable row heights are out of scope). When the user passes both, we
  // gracefully fall back to non-virtualized rendering with a dev warning.
  const virtualizationActive = virtualized && !expandable && data.length > 0
  // Density-aware default row-height estimate. When `density='auto'`,
  // read the live body data attr at mount; otherwise pick the matching
  // fixed height. The virtualizer adapts to actual rendered sizes so
  // an estimate within a few pixels is fine.
  const densityRowHeight = (() => {
    if (effectiveDensity === 'compact') return 32
    if (effectiveDensity === 'spacious') return 56
    if (effectiveDensity === 'comfortable') return 44
    if (typeof document !== 'undefined') {
      const d = document.body.dataset.density
      if (d === 'compact') return 32
      if (d === 'spacious') return 56
    }
    return 44
  })()
  const effectiveRowHeight = rowHeight ?? densityRowHeight
  const effectiveOverscan = overscan ?? 8
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: virtualizationActive ? paginatedData.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => effectiveRowHeight,
    overscan: effectiveOverscan,
  })
  const virtualItems = virtualizationActive ? virtualizer.getVirtualItems() : []
  const virtualTotalSize = virtualizationActive ? virtualizer.getTotalSize() : 0
  const virtualPadTop = virtualItems[0]?.start ?? 0
  // When the virtualizer hasn't measured the viewport yet (or there are no
  // visible items because the container has zero height — e.g. jsdom in
  // unit tests), fall back to rendering the full estimated height as bottom
  // padding so the scroll container reports its true scrollHeight. Once the
  // virtualizer measures and produces virtual items, this collapses back to
  // the precise tail padding.
  const virtualPadBottom = virtualItems.length
    ? virtualTotalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0)
    : virtualTotalSize
  useEffect(() => {
    if (virtualized && expandable && import.meta.env.DEV) {
      console.warn(
        '[DataTable] `virtualized` and `expandable` cannot be combined ' +
        '(variable row heights are out of scope). Falling back to ' +
        'non-virtualized rendering.',
      )
    }
  }, [virtualized, expandable])

  // tbody can only hold <tr>, so the boundary fallback must also be a <tr>
  // to keep markup valid when a row renderer throws.
  const bodyFallback = (
    <tr>
      <td
        colSpan={totalCols}
        className="px-4 py-8 text-center text-sm text-[var(--text-muted)]"
      >
        <span className="inline-flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-tesla-red" aria-hidden="true" />
          {t('errors.section.tableTitle', 'This table failed to render')}
        </span>
      </td>
    </tr>
  )

  // Render a single data row (plus its optional expanded drawer row when
  // expandable). Used by both the standard render path and the virtualized
  // render path so selection / expansion / styling stay perfectly in sync.
  const renderDataRow = (row: T): ReactNode[] => {
    const rowKey = keyExtractor(row)
    const selected = isSelectable && selectionSet.has(rowKey)
    const expanded = expandable && expansionSet.has(rowKey)
    const trClass = cn(
      tableTokens.row,
      selected && tableTokens.rowSelected,
    )
    const handleRowContextMenu = rowContextMenu
      ? (e: ReactMouseEvent<HTMLTableRowElement>) => {
          // Allow right-clicks on form controls / links to keep their
          // native menus (text-input copy/paste, link-context, etc.).
          const target = e.target as HTMLElement
          if (target.closest('input, textarea, select, a')) return
          const items = rowContextMenu(row)
          if (!items || items.length === 0) return
          e.preventDefault()
          openMenu(items, e.clientX, e.clientY)
        }
      : undefined
    const rows: ReactNode[] = [
      <tr
        key={rowKey}
        className={trClass}
        data-selected={selected ? 'true' : undefined}
        data-expanded={expanded ? 'true' : undefined}
        aria-selected={isSelectable ? selected : undefined}
        onContextMenu={handleRowContextMenu}
        onKeyDown={(e) => {
          if (e.key === ' ' && isSelectable) {
            e.preventDefault()
            toggleRow(rowKey, e)
          } else if (e.key === 'Enter' && expandable) {
            e.preventDefault()
            toggleExpand(rowKey)
          }
        }}
        tabIndex={isSelectable || expandable ? 0 : undefined}
      >
        {isSelectable && (
          <td className={cn(leadingPaddingClass, tableTokens.leadingColWidth)}>
            <input
              type={selectable === 'single' ? 'radio' : 'checkbox'}
              checked={selected}
              // Stop the click bubbling so a click on the checkbox
              // doesn't also fire the row's onClick (when consumers
              // attach one via `tr` wrappers around content).
              onClick={(e) => {
                e.stopPropagation()
                toggleRow(rowKey, e)
              }}
              // Read-only because we drive state via onClick to
              // capture shiftKey for range selection.
              onChange={() => { /* handled in onClick */ }}
              aria-label={
                selected
                  ? t('table.selection.deselectRow', 'Deselect row')
                  : t('table.selection.selectRow', 'Select row')
              }
              className={cn(
                'border-[var(--border-strong)] bg-[var(--surface-2)] text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0',
                selectable === 'single' ? '' : 'rounded',
              )}
            />
          </td>
        )}
        {expandable && (
          <td className={cn(leadingPaddingClass, tableTokens.leadingColWidth)}>
            <button
              type="button"
              onClick={() => toggleExpand(rowKey)}
              aria-expanded={expanded}
              aria-label={
                expanded
                  ? t('table.expand.collapse', 'Collapse row')
                  : t('table.expand.expand', 'Expand row')
              }
              className={cn(
                'touch-target-overlay inline-flex h-5 w-5 items-center justify-center rounded',
                'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
                'transition-colors',
              )}
            >
              <ChevronRight
                className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')}
                aria-hidden="true"
              />
            </button>
          </td>
        )}
        {visibleColumns.map(col => (
          <td
            key={col.key}
            className={cn(
              cellPaddingClass,
              colHiddenClass(col.key),
              alignClass(col.align),
              col.className,
            )}
          >
            {col.render(row)}
          </td>
        ))}
      </tr>,
    ]
    if (expanded && renderExpanded) {
      rows.push(
        <tr key={`${rowKey}-expanded`} data-expanded-content="true">
          <td colSpan={totalCols} className={tableTokens.expandedCell}>
            {renderExpanded(row)}
          </td>
        </tr>,
      )
    }
    return rows
  }

  // ── Render ──────────────────────────────────────────────────────────────
  // Sticky headers are on by default (see `stickyHeader` prop) so every
  // DataTable in the app pins its column titles when the body scrolls.
  // Virtualization additionally requires a bounded wrapper height so the
  // virtualizer can compute the viewport — we default to maxHeight=600 in
  // that case. Callers can opt out per-table with `stickyHeader={false}`.
  const effectiveMaxHeight = maxHeight ?? (virtualizationActive ? 600 : undefined)
  const effectiveStickyHeader = stickyHeader || virtualizationActive

  const wrapperStyle = effectiveMaxHeight != null
    ? { maxHeight: typeof effectiveMaxHeight === 'number' ? `${effectiveMaxHeight}px` : effectiveMaxHeight }
    : undefined

  const wrapperClass = cn(
    effectiveStickyHeader || effectiveMaxHeight != null
      ? tableTokens.scrollContainer
      : 'overflow-x-auto rounded-panel border border-[var(--border-default)]',
    className,
  )

  const headRowClass = cn(
    tableTokens.head,
    effectiveStickyHeader && tableTokens.stickyHead,
    // Windows High Contrast / forced-colors mode.
    // The default `border-b border-white/[0.06]` from `tableTokens.head`
    // collapses to invisible against the OS Canvas background, leaving
    // table headers indistinguishable from the body. Pin the bottom edge
    // to a system colour so the column-header row stays a clear visual
    // boundary for low-vision users.
    'forced-colors:border-b forced-colors:border-[CanvasText]',
  )

  // `showColumnsMenu` is the back-compat alias for
  // `columnVisibility`. When EITHER is true (or `columnReorder` is true,
  // since reorder always implies the menu), we surface the new combined
  // `<DataTableColumnMenu>` popover.
  const visibilityRequested = showColumnsMenu || columnVisibility
  const reorderRequested = columnReorder
  const showColumnMenu = (visibilityRequested || reorderRequested) && Boolean(tableId)
  const headerReorderEnabled = reorderRequested && Boolean(tableId)

  // Drag state for HTML5 column reorder. Stored in refs because the
  // values aren't read during render — they're consumed inside drag
  // event handlers — and we don't want a re-render on every dragover.
  const dragColumnKeyRef = useRef<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  const handleHeaderDragStart = useCallback(
    (key: string, e: React.DragEvent<HTMLTableCellElement>) => {
      if (!headerReorderEnabled) return
      dragColumnKeyRef.current = key
      // Some browsers refuse to fire `drop` without setData on dataTransfer.
      try {
        e.dataTransfer.setData('text/plain', key)
        e.dataTransfer.effectAllowed = 'move'
      } catch {
        /* jsdom or a hardened CSP — drop will still fire from our handler. */
      }
    },
    [headerReorderEnabled],
  )

  const handleHeaderDragOver = useCallback(
    (key: string, e: React.DragEvent<HTMLTableCellElement>) => {
      if (!headerReorderEnabled) return
      if (!dragColumnKeyRef.current || dragColumnKeyRef.current === key) return
      e.preventDefault()
      try {
        e.dataTransfer.dropEffect = 'move'
      } catch {
        /* ignore */
      }
      if (dragOverKey !== key) setDragOverKey(key)
    },
    [headerReorderEnabled, dragOverKey],
  )

  const handleHeaderDragLeave = useCallback(
    (key: string) => {
      if (!headerReorderEnabled) return
      if (dragOverKey === key) setDragOverKey(null)
    },
    [headerReorderEnabled, dragOverKey],
  )

  const handleHeaderDrop = useCallback(
    (targetKey: string, e: React.DragEvent<HTMLTableCellElement>) => {
      if (!headerReorderEnabled) return
      const sourceKey = dragColumnKeyRef.current
      dragColumnKeyRef.current = null
      setDragOverKey(null)
      if (!sourceKey || sourceKey === targetKey) return
      e.preventDefault()
      const base: ColumnLayout = layout ?? defaultColumnLayout(columns)
      const currentOrder = effectiveColumnOrder(columns, base)
      const targetIndex = currentOrder.indexOf(targetKey)
      if (targetIndex < 0) return
      const nextOrder = moveColumn(currentOrder, sourceKey, targetIndex)
      persistLayout({ order: nextOrder, hidden: base.hidden.slice() })
    },
    [headerReorderEnabled, layout, columns, persistLayout],
  )

  const handleHeaderDragEnd = useCallback(() => {
    dragColumnKeyRef.current = null
    setDragOverKey(null)
  }, [])

  const showToolbar =
    showColumnMenu ||
    (isSelectable && selectedRows.length > 0) ||
    exportable

  return (
    <div className="space-y-2">
      {/* Toolbar row (selection bulk-bar + columns picker + export) */}
      {showToolbar && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            {isSelectable && selectedRows.length > 0 && (
              <DataTableBulkBar count={selectedRows.length} onClear={clearSelection}>
                {bulkActions?.(selectedRows)}
              </DataTableBulkBar>
            )}
          </div>
          <div className="flex items-center gap-2">
            {exportable && (
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={exporting || data.length === 0}
                aria-label={t('table.export.csv', 'Download table as CSV')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs',
                  'border border-white/[0.08] bg-white/[0.03]',
                  'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/[0.06]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
                  'transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {exporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{t('table.export.csvButton', 'Download CSV')}</span>
              </button>
            )}
            {showColumnMenu && (
              <DataTableColumnMenu
                columns={columns.map(c => ({
                  key: c.key,
                  header: c.header,
                  defaultVisible: c.defaultVisible,
                }))}
                layout={layout}
                onChange={persistLayout}
                onReset={resetLayout}
                reorderable={reorderRequested}
                toggleable={visibilityRequested}
              />
            )}
          </div>
        </div>
      )}

      <div ref={scrollContainerRef} className={wrapperClass} style={wrapperStyle}>
        <table className={tableTokens.wrapper}>
          <thead>
            <tr className={headRowClass}>
              {/* Selection header */}
              {isSelectable && (
                <th
                  scope="col"
                  className={cn(leadingPaddingClass, tableTokens.leadingColWidth)}
                >
                  {selectable === 'multi' ? (
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label={
                        allSelected
                          ? t('table.selection.deselectAll', 'Deselect all rows')
                          : t('table.selection.selectAll', 'Select all rows')
                      }
                      className="rounded border-[var(--border-strong)] bg-[var(--surface-2)] text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                    />
                  ) : null}
                </th>
              )}
              {/* Expand header */}
              {expandable && (
                <th
                  scope="col"
                  aria-label={t('table.expand.column', 'Expand row')}
                  className={cn(leadingPaddingClass, tableTokens.leadingColWidth)}
                />
              )}
              {visibleColumns.map(col => {
                const w = widthFor(col)
                const isDragOverTarget = headerReorderEnabled && dragOverKey === col.key
                return (
                  <th
                    key={col.key}
                    scope="col"
                    draggable={headerReorderEnabled || undefined}
                    onDragStart={headerReorderEnabled ? (e) => handleHeaderDragStart(col.key, e) : undefined}
                    onDragOver={headerReorderEnabled ? (e) => handleHeaderDragOver(col.key, e) : undefined}
                    onDragLeave={headerReorderEnabled ? () => handleHeaderDragLeave(col.key) : undefined}
                    onDrop={headerReorderEnabled ? (e) => handleHeaderDrop(col.key, e) : undefined}
                    onDragEnd={headerReorderEnabled ? handleHeaderDragEnd : undefined}
                    data-column-key={col.key}
                    data-drag-over={isDragOverTarget ? 'true' : undefined}
                    className={cn(
                      headCellPaddingClass,
                      colHiddenClass(col.key),
                      alignClass(col.align),
                      resizable && 'relative group/th',
                      headerReorderEnabled && 'relative cursor-grab active:cursor-grabbing',
                      isDragOverTarget && 'bg-cyan-500/10 outline outline-1 outline-cyan-400/40',
                      col.className,
                    )}
                    style={w != null ? { width: w, minWidth: w } : undefined}
                    aria-sort={col.sortable && sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {headerReorderEnabled && (
                        <span
                          aria-hidden="true"
                          data-testid={`datatable-column-grip-${col.key}`}
                          className="inline-flex h-4 w-3 items-center justify-center text-[var(--text-muted)]/60 hover:text-[var(--text-muted)]"
                        >
                          <GripVertical className="h-3 w-3" />
                        </span>
                      )}
                      {col.sortable ? (
                        <button
                          type="button"
                          onClick={() => onSort?.(col.key)}
                          className={cn(
                            'inline-flex items-center gap-1 cursor-pointer select-none rounded',
                            'hover:text-[var(--text-secondary)]',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
                          )}
                        >
                          <span>{col.header}</span>
                          {sortKey === col.key && (
                            sortDir === 'asc'
                              ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                              : <ChevronDown className="h-3 w-3" aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          {col.header}
                        </span>
                      )}
                    </span>
                    {resizable && tableId && (
                      <DataTableResizer
                        columnKey={col.key}
                        width={w ?? 120}
                        minWidth={col.minWidth}
                        maxWidth={col.maxWidth}
                        onResize={(next) => setColumnWidth(col.key, next)}
                        onResizeEnd={(final) => persistColumnWidth(col.key, final)}
                        label={t('table.columns.resizeLabel', 'Resize column {{col}}', { col: col.header })}
                      />
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className={tableTokens.body}>
            <SectionErrorBoundary name={`table:${name ?? tableId ?? 'DataTable'}`} fallback={bodyFallback}>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={totalCols} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                    {emptyMessage}
                  </td>
                </tr>
              ) : virtualizationActive ? (
                <>
                  {virtualPadTop > 0 && (
                    <tr aria-hidden="true" data-virtual-spacer="top">
                      <td colSpan={totalCols} className="p-0 border-0" style={{ height: virtualPadTop }} />
                    </tr>
                  )}
                  {virtualItems.flatMap((vi) => {
                    const row = paginatedData[vi.index]
                    if (row === undefined) return []
                    return renderDataRow(row)
                  })}
                  {virtualPadBottom > 0 && (
                    <tr aria-hidden="true" data-virtual-spacer="bottom">
                      <td colSpan={totalCols} className="p-0 border-0" style={{ height: virtualPadBottom }} />
                    </tr>
                  )}
                </>
              ) : (
                paginatedData.flatMap(renderDataRow)
              )}
            </SectionErrorBoundary>
          </tbody>
        </table>
      </div>
      {paginationEnabled && data.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data.length}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
          pageSizeOptions={pageSizeOptions}
        />
      )}
    </div>
  )
}

export function useSortToggle(defaultKey?: string, defaultDir: 'asc' | 'desc' = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey ?? '')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultDir)

  const onSort = useCallback((key: string) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }, [sortKey])

  const sortFn = useCallback(<T,>(data: T[], accessor: (row: T, key: string) => number | string) => {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      const av = accessor(a, sortKey)
      const bv = accessor(b, sortKey)
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [sortKey, sortDir])

  return { sortKey, sortDir, onSort, sortFn }
}

/**
 * Convenience hook for selection state. Maintains a list of selected row
 * keys and exposes setters that are stable across renders. Pair with
 * `<DataTable selectable="multi" selectedKeys={selectedKeys} onSelectionChange={setSelectedKeys} />`.
 */
export function useTableSelection<K extends RowKey = RowKey>(initial: K[] = []) {
  const [selectedKeys, setSelectedKeys] = useState<K[]>(initial)
  const clear = useCallback(() => setSelectedKeys([]), [])
  return { selectedKeys, setSelectedKeys, clear }
}

/**
 * Convenience hook for expansion state. Maintains a list of expanded row
 * keys. Pair with `<DataTable expandable expandedKeys={...} onExpandedChange={...} />`.
 */
export function useTableExpansion<K extends RowKey = RowKey>(initial: K[] = []) {
  const [expandedKeys, setExpandedKeys] = useState<K[]>(initial)
  const clear = useCallback(() => setExpandedKeys([]), [])
  return { expandedKeys, setExpandedKeys, clear }
}
