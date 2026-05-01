import { type ReactNode, useState, useCallback, useEffect, useMemo } from 'react'
import { cn } from '../../lib/cn'
import { tableTokens } from '../../lib/tokens'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { Pagination } from './Pagination'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  sortable?: boolean
  className?: string
}

export interface PaginationConfig {
  defaultPageSize?: number;
  pageSizeOptions?: number[];
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (row: T) => string | number
  sortKey?: string
  sortDir?: 'asc' | 'desc'
  onSort?: (key: string) => void
  emptyMessage?: string
  className?: string
  compact?: boolean
  pagination?: boolean | PaginationConfig
  /**
   * Column keys to keep visible on viewports below `md` (768px). Columns NOT
   * listed here become `hidden md:table-cell`. When omitted, every column is
   * shown at every viewport width and the table relies on the wrapper's
   * `overflow-x-auto` to scroll horizontally on phones.
   *
   * MOBILE_GUIDELINES.md asks every multi-column DataTable to specify this so
   * mobile users see the essential columns without horizontal scroll.
   *
   * @example mobileColumns={['name', 'status']}
   */
  mobileColumns?: string[]
}

/** Sortable glass-styled data table with consistent styling and optional pagination. */
export function DataTable<T>({
  columns, data, keyExtractor, sortKey, sortDir, onSort, emptyMessage = 'No data', className, compact, pagination, mobileColumns,
}: DataTableProps<T>) {
  const paginationEnabled = !!pagination
  const paginationConfig: PaginationConfig = typeof pagination === 'object' ? pagination : {}
  const defaultPageSize = paginationConfig.defaultPageSize ?? 25
  const pageSizeOptions = paginationConfig.pageSizeOptions ?? [20, 50, 100]

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)

  // Reset to page 1 when data changes (e.g. filters applied)
  useEffect(() => { setPage(1) }, [data.length])

  const paginatedData = paginationEnabled
    ? data.slice((page - 1) * pageSize, page * pageSize)
    : data

  const mobileSet = useMemo(
    () => (mobileColumns ? new Set(mobileColumns) : null),
    [mobileColumns],
  )

  // CSS-driven hide: when a column is NOT in the mobile allowlist we add
  // `hidden md:table-cell` so it disappears below md but reappears on tablet.
  const colHiddenClass = (key: string) =>
    mobileSet && !mobileSet.has(key) ? 'hidden md:table-cell' : ''

  return (
    <div className={cn('overflow-x-auto rounded-xl', className)}>
      <table className={tableTokens.wrapper}>
        <thead>
          <tr className={tableTokens.head}>
            {columns.map(col => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  compact ? 'px-3 py-2' : tableTokens.headCell,
                  col.sortable && 'cursor-pointer select-none hover:text-[var(--text-secondary)]',
                  colHiddenClass(col.key),
                  col.className,
                )}
                onClick={() => col.sortable && onSort?.(col.key)}
                onKeyDown={col.sortable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort?.(col.key) } } : undefined}
                aria-sort={col.sortable && sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                {...(col.sortable ? { tabIndex: 0, role: 'button' as const } : {})}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && sortKey === col.key && (
                    sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={tableTokens.body}>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            paginatedData.map(row => (
              <tr key={keyExtractor(row)} className={tableTokens.row}>
                {columns.map(col => (
                  <td
                    key={col.key}
                    className={cn(
                      compact ? 'px-3 py-2' : tableTokens.cell,
                      colHiddenClass(col.key),
                      col.className,
                    )}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {paginationEnabled && data.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
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
