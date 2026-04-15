import { type ReactNode, useState, useCallback, useEffect } from 'react'
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
}

/** Sortable glass-styled data table with consistent styling and optional pagination. */
export function DataTable<T>({
  columns, data, keyExtractor, sortKey, sortDir, onSort, emptyMessage = 'No data', className, compact, pagination,
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
                  <td key={col.key} className={cn(compact ? 'px-3 py-2' : tableTokens.cell, col.className)}>
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
