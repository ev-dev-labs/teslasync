import { type ReactNode, type MouseEvent as ReactMouseEvent, isValidElement, useState, useCallback, useEffect, useMemo, useRef, useDeferredValue } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '../../lib/cn'
import { tableTokens } from '../../lib/tokens'
import { ChevronUp, ChevronDown, ChevronRight, ArrowUpDown, AlertTriangle, GripVertical } from 'lucide-react'
import { Pagination, type PaginationProps } from './Pagination'
import { Button } from './Button'
import { Select } from './Select'
import { MobileDataTableAdapter } from './MobileDataTableAdapter'
import type { MobileDataTablePresentation } from './MobileDataTableAdapter.types'
import { isMobileGridWidth } from './mobile-grid-reference/helpers'
import { Checkbox } from './Checkbox'
import { SectionErrorBoundary } from '../feedback/SectionErrorBoundary'
import { DataTableColumnMenu } from './DataTableColumnMenu'
import { DataTableBulkBar } from './DataTableBulkBar'
import { DataTableHeaderFilter } from './DataTableHeaderFilter'
import { DataTableValueFilter } from './DataTableValueFilter'
import {
  buildTableFilterValues, compactTableValueSelection, matchesTableValueSelection,
  selectedTableValueKeys, type TableRawValue, type TableValueSelections,
} from './tableValueFilters'
import { Text } from './Typography'
import { DataTableResizer } from './DataTableResizer'
import { useContextMenu, type ContextMenuItem } from './ContextMenu'
import { VisuallyHidden } from '../a11y/VisuallyHidden'
import { TableToolbar, type TableControls } from '../forms/TableToolbar'
import type { ExportScope } from '../forms/ListExportMenu'
import { useStatusAnnouncer } from '@/hooks/useStatusAnnouncer'
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
  downloadJSON,
  defaultExportFilename,
  type CsvColumn,
  type CsvCellValue,
} from '../../lib/csvExport'

type RowKey = string | number

/**
 * Maximum characters taken from a derived row label.
 *
 * A first column that renders a sentence would otherwise turn every
 * checkbox name into a paragraph, which is slower to listen to than the
 * generic wording it replaced.
 */
const MAX_DERIVED_ROW_LABEL = 60

/** How deep to dig into a cell renderer's JSX looking for its text. */
const ROW_LABEL_SEARCH_DEPTH = 4

/**
 * Pull the human-readable text out of whatever a cell renderer returned.
 *
 * Cell renderers almost never return a bare string — the overwhelmingly
 * common shape is `<span className="…">{row.name}</span>`, a badge, or a
 * flex row with an icon. Reading only `typeof rendered === 'string'`
 * therefore missed nearly every table, which is why so many selection
 * checkboxes still fell back to "Select row".
 *
 * The walk is shallow (`ROW_LABEL_SEARCH_DEPTH`) and skips
 * `aria-hidden` subtrees, so decorative icons and screen-reader-hidden
 * chrome never leak into the name. It never mounts anything — cell
 * renderers are pure by contract, and this only reads the element tree
 * they already returned for the row being drawn.
 *
 * @returns Trimmed text, or null when the cell has no readable content.
 */
export function extractRenderedText(
  node: ReactNode,
  depth = 0,
): string | null {
  if (node == null || typeof node === 'boolean') return null
  if (typeof node === 'string') {
    const trimmed = node.trim()
    return trimmed || null
  }
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) {
    const parts = node
      .map((child) => extractRenderedText(child, depth + 1))
      .filter((part): part is string => Boolean(part))
    const joined = parts.join(' ').trim()
    return joined || null
  }
  if (depth >= ROW_LABEL_SEARCH_DEPTH) return null
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode; 'aria-hidden'?: unknown }
    // Decorative content is hidden from assistive tech on screen; it must
    // not sneak back in through a checkbox name.
    if (props?.['aria-hidden'] === true || props?.['aria-hidden'] === 'true') {
      return null
    }
    return extractRenderedText(props?.children, depth + 1)
  }
  return null
}

/**
 * True when a row key is a machine identifier that must never be spoken.
 *
 * Screen readers read an unpronounceable token character by character.
 * "Select 3 f a 9 c 2 dash 1 b 4 e dash 4 c 7 d …" is strictly worse
 * than the generic "Select row" — it is longer, conveys nothing, and
 * cannot be repeated back by a voice-control user.
 *
 * Rejected:
 *   - UUIDs (with or without dashes)
 *   - hex digests (git SHAs, content hashes)
 *   - bare numeric primary keys ("Select 4291")
 *   - anything long enough to be a random token rather than a name
 *
 * Kept: short, word-shaped keys such as `drives:list` or `model-3`,
 * which do read acceptably.
 */
export function isOpaqueRowKey(key: string): boolean {
  const value = key.trim()
  if (!value) return true
  if (/^\d+$/.test(value)) return true
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return true
  }
  // Hex digests: 12+ hex characters with no word structure.
  if (/^[0-9a-f]{12,}$/i.test(value)) return true
  // Long opaque tokens (nanoid, base64url, ULID). A genuine human label
  // this long would contain a space.
  if (value.length > 24 && !/\s/.test(value)) return true
  return false
}

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  /** Canonical export value for computed or component-rendered cells. */
  exportValue?: (row: T) => CsvCellValue
  /** Optional column-scoped filter opened by the header's filter icon. */
  filter?: ReactNode
  filterActive?: boolean
  onFilterClear?: () => void
  /** Canonical raw value, independent of display units. Opts the column into enabled value filters. */
  filterValue?: (row: T) => TableRawValue
  filterValueLabel?: (value: TableRawValue, row: T) => string
  /** Subtle divider before this column, retained when reordered. */
  groupStart?: boolean
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
  /** Opt-in below 640px of allocated container width; the same table pipeline owns both surfaces. */
  mobilePresentation?: MobileDataTablePresentation<T>
  /** Remove the outer frame when the enclosing panel already owns the surface. */
  variant?: 'standalone' | 'embedded'
  columns: Column<T>[]
  data: T[]
  /** Local loaded-row filters only. Never enable automatically for server pagination. */
  enableValueFilters?: boolean
  /** Loaded candidates independent of caller-owned search/conditions. */
  filterData?: T[]
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
   *   - `'compact'`     — initially uses tight rows
   *   - `'comfortable'` — initially uses default rows
   *   - `'spacious'`    — initially uses loose rows
   *   - `'auto'`        — follows the user's `ui_density` setting via
   *                      density Tailwind utilities (`px-d-pad-x ...`)
   *
   * When omitted, DataTable defaults to `'auto'` (so the global
   * preference flows through every default-styled table). Pass an
   * explicit value for the table's initial density. A saved table-local
   * choice takes precedence; controls.density delegates ownership to the
   * caller and takes precedence over both.
   */
  density?: 'compact' | 'comfortable' | 'spacious' | 'auto'
  pagination?: boolean | PaginationConfig
  /**
   * Caller-owned paging for already paged rows and a filtered/server total.
   * Takes precedence over `pagination`: DataTable never slices these rows again.
   * The footer remains visible even for one page or zero rows.
   */
  paginationControls?: PaginationProps
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
  /**
   * Row-identifying text for the selection checkbox's accessible name,
   * so screen-reader users hear "Select Model 3 — 12 Mar" instead of
   * forty identical "Select row" checkboxes.
   *
   * When omitted, DataTable derives the label from the first visible
   * column when that column renders plain text, and falls back to the
   * generic wording when it cannot.
   */
  rowLabel?: (row: T) => string
  /**
   * Accessible name for the `<table>` element, rendered as a
   * visually-hidden `<caption>`.
   *
   * Defaults to `name`, then `tableId`. Set it explicitly whenever a
   * page renders more than one table, so the AT elements list can tell
   * them apart.
   */
  caption?: string
  /** Page-owned controls placed beside the column menu in the table toolbar. */
  toolbarActions?: ReactNode
  /** Page-owned heading placed on the left of the same toolbar. */
  toolbarHeading?: ReactNode
  /** Typed, caller-owned search, density and CSV/JSON actions. No implicit loaded-row search or export. */
  controls?: TableControls
  /** Defaults to true unless legacy toolbarActions owns the controls. */
  showDensityControl?: boolean
  /** Disable default loaded-row search for previews/pickers. Never implicit with paginationControls. */
  searchable?: boolean
  /** Disable when the page owns a separate selection/action toolbar. */
  showSelectionSummary?: boolean
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
   *  `tableId`. Enabled by default when tableId is present; pass false to opt out. */
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
   *  `tableId`. Enabled by default for persistent tables unless this prop or
   *  its legacy alias explicitly opts out. Equivalent to showColumnsMenu. */
  columnVisibility?: boolean
  /** Allow drag-to-reorder column headers and surface ↑/↓ keyboard
   *  fallback in the column menu. Persists in
   *  localStorage[`teslasync.table.${tableId}.columns`]. Requires
   *  `tableId`. Enabled by default for persistent tables; pass false to opt out.
   *  Shares the same popover as visibility, without overriding its opt-out. */
  columnReorder?: boolean

  // ── Per-table CSV / JSON export ────────────────────────────────────────
  /** Defaults on for local tables, off for caller pagination or legacy action
   *  toolbars. Pass false for sensitive previews/pickers. exportAll can opt
   *  server tables into full-result export without inventing a server query. */
  exportable?: boolean
  /** Filename for the exported CSV (without extension). Defaults to a
   *  date-stamped fallback like `table-2026-05-01`. */
  exportFilename?: string
  /** Override serialization. Otherwise uses Column.exportValue. CSV prefers
   *  readable display text; JSON preserves matching data keys. Rich renderers
   *  without readable children should provide Column.exportValue. */
  exportRow?: (row: T) => Record<string, CsvCellValue>
  /** Serialize original scoped rows without visible-column projection.
   *  Caller-owned controls.exports takes precedence over this callback. */
  onExport?: (format: 'csv' | 'json', rows: readonly T[], scope: ExportScope) => void | Promise<void>
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
  mobilePresentation,
  variant = 'standalone',
  columns,
  data,
  enableValueFilters = false,
  filterData,
  keyExtractor,
  sortKey,
  sortDir,
  onSort,
  emptyMessage = 'No data',
  className,
  compact,
  density,
  pagination,
  paginationControls,
  mobileColumns,
  name,
  tableId,
  selectable = 'none',
  selectedKeys,
  rowLabel,
  caption,
  onSelectionChange,
  bulkActions,
  stickyHeader = true,
  maxHeight,
  expandable = false,
  expandedKeys,
  onExpandedChange,
  renderExpanded,
  resizable = Boolean(tableId),
  showColumnsMenu,
  columnVisibility,
  columnReorder = Boolean(tableId),
  exportable,
  exportFilename,
  exportRow,
  onExport,
  exportAll,
  virtualized = false,
  rowHeight,
  overscan,
  rowContextMenu,
  toolbarActions,
  toolbarHeading,
  controls,
  showDensityControl = !toolbarActions,
  searchable = !toolbarActions,
  showSelectionSummary = true,
}: DataTableProps<T>) {
  const { t } = useTranslation()
  const frameRef = useRef<HTMLDivElement>(null)
  const [mobileActive, setMobileActive] = useState(false)
  const mobileEnabled = mobilePresentation != null
  useEffect(() => {
    if (!mobileEnabled || !frameRef.current || typeof ResizeObserver === 'undefined') {
      setMobileActive(false)
      return
    }
    const frame = frameRef.current
    const update = (width: number) => {
      if (width > 0) setMobileActive(isMobileGridWidth(width))
    }
    update(frame.getBoundingClientRect().width)
    const observer = new ResizeObserver(entries => {
      const entry = entries.find(value => value.target === frame)
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [mobileEnabled])
  const [localSearch, setLocalSearch] = useState('')
  const deferredLocalSearch = useDeferredValue(localSearch)
  const localSearchEnabled = searchable && !paginationControls && !controls?.search
  const [valueSelections, setValueSelections] = useState<TableValueSelections>({})
  const valueColumns = useMemo(() => enableValueFilters
    ? columns.filter(column => column.filterValue != null) : [], [columns, enableValueFilters])
  const candidateRows = filterData ?? data
  const valueOptions = useMemo(() => new Map(valueColumns.map(column => [
    column.key,
    buildTableFilterValues(candidateRows, row => column.filterValue?.(row) ?? null,
      (value, row) => column.filterValueLabel?.(value, row)
        ?? (value == null ? '—' : extractRenderedText(column.render(row)) ?? String(value))),
  ])), [valueColumns, candidateRows])
  const filteredData = useMemo(() => {
    const query = localSearchEnabled ? deferredLocalSearch.trim().toLocaleLowerCase() : ''
    return data.filter(row => valueColumns.every(column =>
      matchesTableValueSelection(column.filterValue?.(row) ?? null, valueSelections[column.key]),
    ) && (!query || columns.some(column => {
      const raw = (row as unknown as Record<string, unknown>)[column.key]
      const text = extractRenderedText(column.render(row))
        ?? (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : '')
      return text.toLocaleLowerCase().includes(query)
    })))
  }, [data, valueColumns, valueSelections, columns, localSearchEnabled, deferredLocalSearch])
  const searchControls = controls?.search ?? (localSearchEnabled ? {
    value: localSearch,
    onChange: setLocalSearch,
    ariaLabel: t('table.search.loadedRows', 'Search loaded rows'),
    placeholder: t('table.search.loadedRows', 'Search loaded rows'),
    pending: !Object.is(localSearch, deferredLocalSearch),
  } : undefined)
  const hasValueFilters = valueColumns.some(column => valueSelections[column.key] != null)
  // Shared context menu host. We call this once per
  // table render so the imperative `openMenu` reference stays stable
  // across row renders.
  const { openMenu } = useContextMenu()
  // Untouched tables still follow global density; only an explicit local
  // choice is persisted. Caller-owned density bypasses the local choice.
  const densityStorageKey = tableId ? `${STORAGE_PREFIX}.${tableId}.density` : null
  const [localDensity, setLocalDensity] = useState<'compact' | 'comfortable' | null>(() => {
    const stored = densityStorageKey ? readStored<unknown>(densityStorageKey) : null
    return stored === 'compact' || stored === 'comfortable' ? stored : null
  })
  useEffect(() => {
    const stored = densityStorageKey ? readStored<unknown>(densityStorageKey) : null
    setLocalDensity(stored === 'compact' || stored === 'comfortable' ? stored : null)
  }, [densityStorageKey])
  const effectiveDensity: 'compact' | 'comfortable' | 'spacious' | 'auto' =
    controls?.density
      ? controls.density.value === 'compact' ? 'compact' : 'comfortable'
      : localDensity ?? density ?? (compact ? 'compact' : 'auto')
  const [globalCompact, setGlobalCompact] = useState(() =>
    typeof document !== 'undefined' && document.body.dataset.density === 'compact')
  useEffect(() => {
    if (effectiveDensity !== 'auto') return
    const syncDensity = () => setGlobalCompact(document.body.dataset.density === 'compact')
    syncDensity()
    const observer = new MutationObserver(syncDensity)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-density'] })
    return () => observer.disconnect()
  }, [effectiveDensity])
  const densityControls = controls?.density ?? (showDensityControl ? {
    value: effectiveDensity === 'compact' || (effectiveDensity === 'auto'
      && globalCompact)
      ? 'compact' as const : 'comfortable' as const,
    onChange: (next: 'compact' | 'comfortable' | 'table') => {
      if (next === 'table') return
      setLocalDensity(next)
      if (densityStorageKey) writeStored(densityStorageKey, next)
    },
  } : undefined)
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
  const paginationEnabled = !!pagination && !paginationControls
  const paginationConfig: PaginationConfig = typeof pagination === 'object' ? pagination : {}
  const defaultPageSize =
    paginationConfig.defaultPageSize ?? paginationConfig.pageSizeOptions?.[0] ?? 25
  const pageSizeOptions = paginationConfig.pageSizeOptions ?? [25, 50, 100]
  const pageSizeStorageKey =
    paginationEnabled && tableId ? `${STORAGE_PREFIX}.${tableId}.page-size` : null

  const [page, setPage] = useState(1)
  // Cumulative mobile reveal must not overwrite the desktop page on resize.
  const [mobilePage, setMobilePage] = useState(1)
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
    setMobilePage(1)
    if (pageSizeStorageKey) writeStored(pageSizeStorageKey, size)
  }, [pageSizeOptions, pageSizeStorageKey])

  // Reset to page 1 when data length changes (e.g. filters applied).
  useEffect(() => {
    setPage(1)
    setMobilePage(1)
  }, [data.length, valueSelections, enableValueFilters, deferredLocalSearch])
  useEffect(() => {
    if (mobileActive) setMobilePage(1)
  }, [mobileActive, data, sortKey, sortDir])

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
  const { announceSelection, announceSort } = useStatusAnnouncer()
  const isSelectable = selectable !== 'none'
  const selection = selectedKeys ?? []
  const selectionSet = useMemo(() => new Set(selection), [selection])
  const lastClickedKey = useRef<RowKey | null>(null)

  const allRowKeys = useMemo(() => filteredData.map(keyExtractor), [filteredData, keyExtractor])
  const allSelected = isSelectable && allRowKeys.length > 0 && allRowKeys.every(k => selectionSet.has(k))
  const someSelected = isSelectable && allRowKeys.some(k => selectionSet.has(k)) && !allSelected

  const setSelection = useCallback(
    (next: RowKey[]) => {
      onSelectionChange?.(next)
      // A11Y: selection is a state change with no visual focus move, so
      // without a live-region message a screen-reader user has no idea
      // whether their Space press registered — or how many rows a
      // shift-range just swept in. Governed by `useStatusAnnouncer`, so a
      // fast click-drag across 40 rows speaks once with the final count.
      announceSelection(next.length, allRowKeys.length)
    },
    [onSelectionChange, announceSelection, allRowKeys.length],
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
    if (hasValueFilters || paginationControls || (localSearchEnabled && deferredLocalSearch.trim())) {
      const matchingKeys = new Set(allRowKeys)
      setSelection(allSelected
        ? selection.filter(key => !matchingKeys.has(key))
        : Array.from(new Set([...selection, ...allRowKeys])))
      return
    }
    if (allSelected) setSelection([])
    else setSelection(allRowKeys)
  }, [hasValueFilters, paginationControls, localSearchEnabled, deferredLocalSearch,
    selection, allSelected, allRowKeys, setSelection])

  const clearSelection = useCallback(() => setSelection([]), [setSelection])

  // A11Y: sorting re-orders rows underneath the user with no focus move
  // and no visible-to-AT cue beyond the `aria-sort` attribute — which is
  // only discovered by navigating back to the header. Announce the new
  // order instead. Fires on the sortKey/sortDir edge (never on mount) so
  // a table that renders pre-sorted stays quiet.
  const sortSignature = `${sortKey ?? ''}:${sortDir ?? ''}`
  const lastSortSignature = useRef(sortSignature)
  useEffect(() => {
    if (lastSortSignature.current === sortSignature) return
    lastSortSignature.current = sortSignature
    if (!sortKey) return
    const column = columns.find(c => c.key === sortKey)
    if (!column) return
    announceSort(column.header, sortDir === 'desc' ? 'desc' : 'asc')
  }, [sortSignature, sortKey, sortDir, columns, announceSort])

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
    ? filteredData.slice((page - 1) * pageSize, page * pageSize)
    : filteredData
  const footerControls: PaginationProps | undefined = paginationControls ?? (
    paginationEnabled && filteredData.length > 0 ? {
      page, pageSize, total: filteredData.length, onPageChange: setPage,
      onPageSizeChange: handlePageSizeChange, pageSizeOptions,
    } : undefined
  )

  // ── Selected rows for bulk actions slot ────────────────────────────────
  const selectedRows = useMemo(
    () => (isSelectable ? data.filter(row => selectionSet.has(keyExtractor(row))) : []),
    [data, isSelectable, selectionSet, keyExtractor],
  )

  const handleExport = useCallback(async (format: 'csv' | 'json', scope: ExportScope) => {
    const sourceRows = scope === 'selected' ? selectedRows : exportAll ? await exportAll() : filteredData
    if (onExport) {
      await onExport(format, sourceRows, scope)
      return
    }
    const rows = sourceRows.map(row => {
      const flattened = exportRow?.(row)
      const record: Record<string, CsvCellValue> = {}
      visibleColumns.forEach(column => {
        if (flattened) {
          record[column.key] = flattened[column.key] ?? null
        } else if (column.exportValue) {
          record[column.key] = column.exportValue(row)
        } else {
          const value = (row as unknown as Record<string, unknown>)[column.key]
          const rendered = extractRenderedText(column.render(row))
          record[column.key] = format === 'csv' && rendered != null ? rendered
            : value === null || typeof value === 'string' || typeof value === 'number'
            || typeof value === 'boolean' || typeof value === 'object'
            ? value : rendered
        }
      })
      return record
    })
    const filename = exportFilename ?? defaultExportFilename(tableId ?? name ?? 'table')
    if (format === 'json') {
      downloadJSON(filename, rows)
    } else {
      const csvColumns: CsvColumn<Record<string, CsvCellValue>>[] = visibleColumns.map(column => ({
        key: column.key, header: column.header || column.key,
      }))
      downloadCSV(filename, toCSV(rows, csvColumns))
    }
  }, [exportAll, filteredData, selectedRows, exportFilename, tableId, name, visibleColumns, exportRow, onExport])
  const exportControls = exportable === false ? undefined : controls?.exports
    ?? (exportable === true || exportAll || (!paginationControls && !toolbarActions) ? {
      onExportCsv: (scope: ExportScope) => handleExport('csv', scope),
      onExportJson: (scope: ExportScope) => handleExport('json', scope),
      selectedCount: selectedRows.length,
      visibleCount: exportAll ? undefined : filteredData.length,
      disabled: !exportAll && filteredData.length === 0 && selectedRows.length === 0,
      description: exportAll
        ? t('table.export.fullResultScope', 'Non-selected exports use the full-result handler; selection exports include only selected loaded rows.')
        : t('table.export.loadedScope', 'Exports include only matching loaded rows, or selected loaded rows.'),
    } : undefined)

  // Total visible column count for colSpan calcs (incl. selection / expand).
  const leadingColCount = (isSelectable ? 1 : 0) + (expandable ? 1 : 0)
  const totalCols = leadingColCount + visibleColumns.length

  // ── Accessible naming (A11Y) ───────────────────────────────────────────
  // A `<table>` with no name is announced as "table" and nothing else, so
  // a page with three tables gives the user no way to tell them apart in
  // the elements list. Prefer an explicit caption, then the boundary
  // `name`, then the stable `tableId`, and only fall back to a generic
  // string when a caller supplied none of them.
  const accessibleTableName =
    caption ?? name ?? tableId ?? t('table.genericName', 'Data table')

  /**
   * Row-identifying label for the selection checkbox.
   *
   * "Select row" repeated 40 times is useless: the user cannot tell which
   * row they are about to toggle without leaving the checkbox to read the
   * cells. Resolution order:
   *
   *   1. an explicit `rowLabel(row)` from the call site — always best,
   *      because only the page knows which field identifies a row;
   *   2. the first visible column's rendered TEXT, dug out of the JSX
   *      that renderer returns (see {@link extractRenderedText}); most
   *      renderers wrap the value in a `<span>` or a badge, so reading
   *      only a bare string would almost never hit;
   *   3. the row key — but only if it is human-meaningful.
   *
   * Step 3 is deliberately hostile to database identifiers. A UUID
   * announced by a screen reader is read out character by character —
   * "Select 3 f a 9 c 2 dash 1 b 4 e dash …" — which is materially worse
   * than the generic "Select row" it replaced. {@link isOpaqueRowKey}
   * rejects those, and `null` here means the caller falls back to the
   * generic wording.
   */
  const rowLabelFor = useCallback(
    (row: T, rowKey: RowKey): string | null => {
      if (rowLabel) {
        const explicit = rowLabel(row)?.trim()
        if (explicit) return explicit
      }
      const first = visibleColumns[0]
      if (first) {
        const derived = extractRenderedText(first.render(row))
        if (derived) {
          return derived.length > MAX_DERIVED_ROW_LABEL
            ? `${derived.slice(0, MAX_DERIVED_ROW_LABEL).trimEnd()}…`
            : derived
        }
      }
      if (typeof rowKey === 'string' && !isOpaqueRowKey(rowKey)) {
        return rowKey.trim()
      }
      return null
    },
    [rowLabel, visibleColumns],
  )

  // ── Virtualization ─────────────────────────────────────────────────────
  // Only enabled when explicitly opted in AND there's no `expandable` slot
  // (variable row heights are out of scope). When the user passes both, we
  // gracefully fall back to non-virtualized rendering with a dev warning.
  const virtualizationActive = virtualized && !mobileActive && !expandable && data.length > 0
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
    // React stringifies keys; native identity and body/expansion namespaces must stay distinct.
    const reconciliationKey = `${typeof rowKey}:${rowKey}`
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
    const selectedRowLabel = isSelectable ? rowLabelFor(row, rowKey) : null
    const selectionLabel = selectedRowLabel
      ? selected
        ? t('table.selection.deselectRowNamed', 'Deselect {{row}}', { row: selectedRowLabel })
        : t('table.selection.selectRowNamed', 'Select {{row}}', { row: selectedRowLabel })
      : selected
        ? t('table.selection.deselectRow', 'Deselect row')
        : t('table.selection.selectRow', 'Select row')
    const rows: ReactNode[] = [
      <tr
        key={`row:${reconciliationKey}`}
        className={trClass}
        data-selected={selected ? 'true' : undefined}
        data-expanded={expanded ? 'true' : undefined}
        aria-selected={isSelectable ? selected : undefined}
        onContextMenu={handleRowContextMenu}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
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
          <td className="w-12 min-w-12 p-0 text-center align-middle">
            {selectable === 'multi' ? (
              <div className="flex justify-center">
                <Checkbox
                  checked={selected}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleRow(rowKey, e)
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  onChange={() => { /* handled in onClick to retain shift selection */ }}
                  aria-label={selectionLabel}
                />
              </div>
            ) : (
              <input
                type="radio"
                checked={selected}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleRow(rowKey, e)
                }}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={() => { /* handled in onClick */ }}
                aria-label={selectionLabel}
                className="border-[var(--border-strong)] bg-[var(--surface-2)] text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
              />
            )}
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
            data-column-key={col.key}
            className={cn(
              cellPaddingClass,
              col.align === 'right' && 'tabular-nums',
              col.groupStart && tableTokens.groupStart,
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
        <tr key={`expanded:${reconciliationKey}`} data-expanded-content="true">
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
    'max-w-full overscroll-x-contain',
    effectiveStickyHeader || effectiveMaxHeight != null
      ? tableTokens.scrollContainer
      : 'overflow-x-auto',
    'rounded-none border-0',
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
  const visibilityRequested = showColumnsMenu === undefined && columnVisibility === undefined
    ? Boolean(tableId)
    : Boolean(showColumnsMenu || columnVisibility)
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
      const visible = new Set(applyColumnLayout(columns, base).map((column) => column.key))
      const hidden = columns.filter((column) => !visible.has(column.key)).map((column) => column.key)
      persistLayout({ order: nextOrder, hidden })
    },
    [headerReorderEnabled, layout, columns, persistLayout],
  )

  const handleHeaderDragEnd = useCallback(() => {
    dragColumnKeyRef.current = null
    setDragOverKey(null)
  }, [])

  const hasSelectionSummary = showSelectionSummary && isSelectable && selectedRows.length > 0
  const showToolbar =
    Boolean(toolbarActions || toolbarHeading || controls || densityControls || searchControls || exportControls) ||
    showColumnMenu ||
    hasSelectionSummary

  const renderColumnFilter = (col: Column<T>) => (col.filter || valueOptions.has(col.key)) ? (
    <DataTableHeaderFilter label={col.header}
      active={col.filterActive || (enableValueFilters && valueSelections[col.key] != null)}
      onClear={valueOptions.has(col.key) ? () => {
        setValueSelections(previous => {
          const next = { ...previous }
          delete next[col.key]
          return next
        })
        col.onFilterClear?.()
      } : col.onFilterClear}>
      {valueOptions.has(col.key) ? (
        <DataTableValueFilter
          options={valueOptions.get(col.key) ?? []}
          selected={selectedTableValueKeys(valueSelections[col.key],
            (valueOptions.get(col.key) ?? []).flatMap(option => option.keys ?? [option.value]))}
          onChange={values => {
            setPage(1)
            setValueSelections(previous => {
              const next = { ...previous }
              if (values == null) delete next[col.key]
              else next[col.key] = compactTableValueSelection(values,
                (valueOptions.get(col.key) ?? []).flatMap(option => option.keys ?? [option.value]))
              return next
            })
          }}
          condition={col.filter}
          conditionActive={col.filterActive}
        />
      ) : col.filter}
    </DataTableHeaderFilter>
  ) : null

  return (
    <>
    <div ref={frameRef} className={cn(
      variant === 'embedded' ? 'min-w-0 max-w-full' : tableTokens.frame,
      'space-y-0 overflow-visible p-0',
      mobilePresentation && 'mgr-host',
    )}
      data-grid-frame="" data-grid-variant={variant}>
      {/* Toolbar row (selection bulk-bar + columns picker + export) */}
      {showToolbar && (
        <TableToolbar
          className={cn(tableTokens.toolbar, 'rounded-t-xl border-b border-[var(--border-default)] p-3',
            mobileActive && '[&_button]:min-h-11 [&_button]:min-w-11 [&_input]:min-h-11')}
          search={searchControls}
          density={densityControls}
          exports={exportControls}
          heading={(toolbarHeading || hasSelectionSummary) ? <>
            {toolbarHeading}
            {hasSelectionSummary && (
              <DataTableBulkBar count={selectedRows.length} onClear={clearSelection}>
                {bulkActions?.(selectedRows)}
              </DataTableBulkBar>
            )}
          </> : undefined}
          actions={toolbarActions}
          columns={showColumnMenu ? (
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
            ) : undefined}
        />
      )}

      {hasValueFilters && (
        <Text as="p" size="xs" color="muted" role="status" className="px-3 py-2">
          {t('table.filter.loadedRowCount', '{{filtered}} matching / {{loaded}} loaded rows', {
            filtered: filteredData.length, loaded: candidateRows.length,
          })}
        </Text>
      )}
      {mobileActive && mobilePresentation ? (
        <SectionErrorBoundary name={`table:${name ?? tableId ?? 'DataTable'}:mobile`}>
          <MobileDataTableAdapter
            rows={paginationEnabled ? filteredData.slice(0, mobilePage * pageSize) : filteredData}
            columns={visibleColumns} allColumns={columns} keyExtractor={keyExtractor}
            presentation={mobilePresentation} label={accessibleTableName} rowLabel={rowLabel}
            selectedKeys={selectionSet} selectable={isSelectable && Boolean(onSelectionChange)}
            multiSelect={selectable === 'multi'}
            allSelected={allSelected} someSelected={someSelected}
            onToggleAll={toggleAll} onToggle={toggleRow}
            emptyMessage={emptyMessage}
            expandedContent={expandable ? renderExpanded : undefined}
            expandedKeys={expansionSet}
            onToggleExpanded={expandable && onExpandedChange ? toggleExpand : undefined}
            rowActions={rowContextMenu ? row => rowContextMenu(row).map(action => (
              <Button key={action.id} size="sm" variant={action.destructive ? 'danger' : 'secondary'}
                disabled={action.disabled} icon={action.icon} onClick={action.onClick}>
                {action.label}
              </Button>
            )) : undefined}
            onLoadMore={paginationEnabled && mobilePage * pageSize < filteredData.length
              ? () => setMobilePage(previous => previous + 1) : undefined}
            nextCount={Math.min(pageSize, Math.max(0, filteredData.length - mobilePage * pageSize))}
            onClear={searchControls || enableValueFilters || columns.some(column => column.onFilterClear) || mobilePresentation.onClear ? () => {
              searchControls?.onChange('')
              setValueSelections({})
              columns.forEach(column => column.onFilterClear?.())
              mobilePresentation.onClear?.()
            } : undefined}
            count={<Text size="sm" color="muted" role="status">
              {paginationEnabled && t('developerReference.mobileGrid.footer.showing', 'Showing {{count}} of {{total}}', {
                count: Math.min(mobilePage * pageSize, filteredData.length), total: filteredData.length,
              })}
              {' · '}{t('table.filter.loadedRowCount', '{{filtered}} matching / {{loaded}} loaded rows', {
                filtered: filteredData.length, loaded: data.length,
              })}
            </Text>}
            controls={<>
              {visibleColumns.map(col => <div key={col.key} className="flex items-center gap-1">
                {col.sortable && onSort && <Button size="sm" variant="secondary" className="min-h-11"
                  aria-label={col.header} onClick={() => onSort(col.key)}>
                  {col.header}{sortKey === col.key && (sortDir === 'asc'
                    ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                    : <ChevronDown className="h-3 w-3" aria-hidden="true" />)}
                </Button>}
                {renderColumnFilter(col)}
              </div>)}
              {paginationEnabled && <Select
                aria-label={t('pagination.pageSize', 'Rows per page')}
                value={String(pageSize)}
                options={pageSizeOptions.map(size => ({ value: String(size), label: String(size) }))}
                onChange={event => handlePageSizeChange(Number(event.target.value))} />}
            </>}
          />
        </SectionErrorBoundary>
      ) : <div ref={scrollContainerRef} className={cn(wrapperClass,
        !showToolbar && !footerControls ? 'rounded-xl'
          : !showToolbar ? 'rounded-t-xl' : !footerControls ? 'rounded-b-xl' : undefined,
      )} style={wrapperStyle} data-grid-viewport="">
        {/* Preserve native table semantics, not an ARIA grid with a different cell-navigation contract. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <table tabIndex={footerControls ? 0 : undefined} className={cn(tableTokens.wrapper, footerControls && 'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]')} aria-label={accessibleTableName}
          onKeyDown={event => {
            if (!footerControls || event.defaultPrevented || event.target !== event.currentTarget
              || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
            const size = Number.isSafeInteger(footerControls.pageSize) && footerControls.pageSize > 0
              ? footerControls.pageSize : (footerControls.pageSizeOptions?.find(value => Number.isSafeInteger(value) && value > 0) ?? 25)
            const total = Number.isFinite(footerControls.total)
              ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(footerControls.total))) : 0
            const lastPage = Math.max(1, Math.ceil(total / size))
            const currentPage = Number.isFinite(footerControls.page)
              ? Math.min(lastPage, Math.max(1, Math.floor(footerControls.page))) : 1
            const target = event.key === 'PageDown' ? Math.min(lastPage, currentPage + 1)
              : event.key === 'PageUp' ? Math.max(1, currentPage - 1)
                : event.key === 'Home' ? 1 : event.key === 'End' ? lastPage : null
            if (target == null) return
            event.preventDefault()
            if (target !== currentPage) footerControls.onPageChange(target)
          }}>
          {/* A11Y: a `<caption>` is the only table-native accessible name,
              and screen readers announce it when the user enters the grid
              ("Drives, table, 8 columns, 24 rows"). It is visually hidden
              because the surrounding panel already carries a visible
              heading — duplicating it on screen would be redundant, but
              omitting it entirely leaves the table anonymous. */}
          <VisuallyHidden as="caption">{accessibleTableName}</VisuallyHidden>
          <thead>
            <tr className={headRowClass}>
              {/* Selection header */}
              {isSelectable && (
                <th
                  scope="col"
                  className="w-12 min-w-12 p-0 text-center align-middle"
                >
                  {selectable === 'multi' ? (
                    <div className="flex justify-center">
                      <Checkbox
                        checked={allSelected}
                        indeterminate={someSelected}
                        onChange={toggleAll}
                        aria-label={
                          allSelected
                            ? t('table.selection.deselectAll', 'Deselect all rows')
                            : t('table.selection.selectAll', 'Select all rows')
                        }
                      />
                    </div>
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
                    aria-label={col.header || undefined}
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
                      'whitespace-nowrap font-semibold',
                      col.groupStart && tableTokens.groupStart,
                      col.sortable && sortKey === col.key && 'text-[var(--text-primary)]',
                      resizable && 'relative group/th',
                      headerReorderEnabled && 'relative cursor-grab active:cursor-grabbing',
                      isDragOverTarget && 'bg-cyan-500/10 outline outline-1 outline-cyan-400/40',
                      col.className,
                    )}
                    style={w != null ? { width: w, minWidth: w } : undefined}
                    aria-sort={
                      col.sortable && (onSort || sortKey === col.key)
                        ? sortKey === col.key
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          // A11Y: `none` (rather than omitting the
                          // attribute) is what tells the user the column
                          // IS sortable but is not currently the sort
                          // key. Omitting it makes a sortable column
                          // indistinguishable from a static one.
                          : 'none'
                        : undefined
                    }
                  >
                    <div className={cn('flex items-center gap-1', col.align === 'right' && 'justify-end', col.align === 'center' && 'justify-center')}>
                      {headerReorderEnabled && (
                        <span
                          aria-hidden="true"
                          data-testid={`datatable-column-grip-${col.key}`}
                          className="absolute left-0.5 inline-flex h-4 w-3 items-center justify-center text-[var(--text-muted)] opacity-0 group-hover/th:opacity-60"
                        >
                          <GripVertical className="h-3 w-3" />
                        </span>
                      )}
                      {col.sortable && onSort ? (
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
                          {sortKey !== col.key && <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          {col.header}
                        </span>
                      )}
                    {renderColumnFilter(col)}
                    </div>
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
              {filteredData.length === 0 ? (
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
      </div>}
      {footerControls && (!mobileActive || paginationControls) && (
        <div className="shrink-0 rounded-b-xl border-t border-[var(--border-default)] bg-[var(--surface-1)] px-3 py-3"
          data-grid-footer="">
          <Pagination {...footerControls} />
        </div>
      )}
    </div>
    </>
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
